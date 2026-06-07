// machinen CLI — boot a microVM and drive it (exec, snapshot, attach),
// plus pre-fetch the kernel + rootfs assets published alongside each
// release tag.
//
// Surface:
//   machinen boot [opts] -- <cmd>
//   machinen restore <snap-dir> [--name <name>] [-p <hostPort>:<guestPort>]
//   machinen ls (alias: ps)
//   machinen exec <name|pid> -- <cmd>
//   machinen snapshot <name|pid> <out-dir>
//   machinen attach <name|pid> [--shell <cmd>]   # PTY shell
//   machinen repl   <name|pid>                   # per-line exec
//   machinen support [--json] [--family <family>] [--level <support-level>]
//   machinen completion <bash|zsh|fish>
//   machinen --version | -h | --help

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { arch as osArch, homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  attach,
  boot,
  buildNodeLevel5AppSupportMatrix,
  createNodeLevel5DeclaredSubsetCapture,
  createNodeLevel5ProductSnapshot,
  createNodeLevel5ProductSupport80ArtifactBundle,
  formatMachinenError,
  isMachinenError,
  isNodeLevel5ProductSnapshotBundle,
  loadNodeLevel5ProductSupport80ArtifactBundle,
  loadNodeLevel5RealAppCorpusReport,
  loadNodeLevel5RealAppRefusalCorpusReport,
  loadNodeLevel5GenericVmCorpusReport,
  loadNodeLevel5GenericVmRefusalArtifactsReport,
  loadNodeLevel5GenericVmRetainedEvidenceReport,
  loadNodeLevel5GenericVmRowArtifactsReport,
  loadNodeLevel5InstalledThirdPartyAppCorpusReport,
  loadNodeLevel5ProductSupport85ReadinessReport,
  loadNodeLevel5ThirdPartyAppCorpusReport,
  list,
  nodeLevel5ProductSupport80UnsupportedDetectors,
  nodeLevel5ProductSupport85ClaimRegistry,
  restore,
  restoreNodeLevel5DeclaredSubset,
  restoreNodeLevel5ProductSnapshot,
  evaluateNodeLevel5ProductSupport85ClaimReady,
  evaluateNodeLevel5ProductSupport85Readiness,
  verifyNodeLevel5ProductSupport80ArtifactBundle,
  verifyNodeLevel5RealAppCorpusReport,
  verifyNodeLevel5RealAppRefusalCorpusReport,
  verifyNodeLevel5GenericVmCorpusReport,
  verifyNodeLevel5GenericVmRefusalArtifactsReport,
  verifyNodeLevel5GenericVmRetainedEvidenceReport,
  verifyNodeLevel5GenericVmRowArtifactsReport,
  verifyNodeLevel5InstalledThirdPartyAppCorpusReport,
  verifyNodeLevel5ThirdPartyAppCorpusReport,
} from "@machinen/runtime";
import type {
  LogEvent,
  NodeLevel5ProductSnapshotDirection,
  NodeLevel5ProductSupport80FamilyId,
  RegistryEntry,
  VmHandle,
} from "@machinen/runtime";
import debugLib from "debug";

import pkg from "../package.json" with { type: "json" };
import {
  cleanServiceStableRefusalCodes,
  type CleanServiceCapture,
  type CleanServiceManifest,
} from "./clean-service/manifest.ts";
import {
  cleanServiceFromNode,
  inspectPortableNodeVm,
  type PortableNodeSnapshotBundle,
  type PortableNodeSnapshotCapture,
} from "./clean-service/node-adapter.ts";
import { inspectPortableGoVm } from "./clean-service/go-adapter.ts";
import { inspectPortablePythonVm } from "./clean-service/python-adapter.ts";
import {
  cmdRestoreCleanService as restoreCleanServiceBundle,
  shouldRestoreCleanService as shouldRestoreCleanServiceBundle,
} from "./clean-service/restore.ts";
import {
  detectLevel5RestoreAdapter,
  restoreLevel5RuntimeBundle,
  writeNodeLevel5ProofCompositionSnapshot,
  writeNodeLevel5RuntimeProfileSnapshot,
} from "./level5-runtime-adapters.ts";
import { parseForkArgs } from "./parse-fork-args.ts";
import { parseRestoreArgs } from "./parse-restore-args.ts";
import { parseRunArgs } from "./parse-run-args.ts";
import { extractTarget, type Target } from "./parse-target.ts";
import {
  formatElapsed,
  isQuiet,
  NoiseFilter,
  printDiagnostics,
  printHeadline,
  RingBuffer,
} from "./quiet.ts";
import { cmdAgentContext, cmdCompletion, cmdFeedback } from "./commands/misc.ts";
import { cmdGc, cmdLs } from "./commands/registry.ts";
import { cmdMove } from "./commands/move.ts";
import { cmdExec } from "./commands/exec.ts";
import { cmdAttach, cmdRepl } from "./commands/attach.ts";
import { cmdSupport } from "./commands/support.ts";
import { cmdStop } from "./commands/stop.ts";

const debug = debugLib("machinen:cli");

const VERSION = pkg.version;
// Slash-free tag shape — the `releases/download/<tag>/<asset>` URL
// pattern fails when the tag contains a `/` (the router can't tell
// where the tag ends and the asset path begins). Keep the shape
// `runtime-v<semver>`.
const RELEASE_TAG = `runtime-v${VERSION}`;
// Base assets ship as GitHub Releases on the public companion repo so
// the CLI can fetch them anonymously over plain HTTPS. The source repo
// is private; only the release artifacts go here.
const ASSETS_BASE_URL = "https://github.com/redwoodjs/machinen.dev/releases/download";
const CACHE_ROOT = join(homedir(), ".machinen");

// ------------------------------------------------------------
// Base-asset cache
// ------------------------------------------------------------

function cacheDirFor(tag: string): string {
  return join(CACHE_ROOT, tag);
}

type GuestCpu = "arm64" | "amd64";

type BaseAssetSpec = {
  cpu: GuestCpu;
  kernelAsset: string;
  dtbAsset?: string;
  rootfsAsset: string;
};

function guestCpu(): GuestCpu {
  const override = process.env.MACHINEN_GUEST_ARCH;
  if (override === "arm64" || override === "amd64") {
    return override;
  }
  return osArch() === "x64" ? "amd64" : "arm64";
}

function baseAssetSpec(): BaseAssetSpec {
  return guestCpu() === "amd64"
    ? {
        cpu: "amd64",
        kernelAsset: "bzImage-x86_64",
        rootfsAsset: "rootfs-debian-amd64.tar.gz",
      }
    : {
        cpu: "arm64",
        kernelAsset: "Image-arm64",
        dtbAsset: "virt-arm64.dtb",
        rootfsAsset: "rootfs-debian-arm64.tar.gz",
      };
}

function baseDirFor(tag: string, distro = "debian", cpu = guestCpu()): string {
  return join(cacheDirFor(tag), "bases", `${distro}-${cpu}`);
}

function baseAssetsComplete(tag: string): boolean {
  const spec = baseAssetSpec();
  const base = baseDirFor(tag, "debian", spec.cpu);
  return (
    existsSync(join(base, "Image")) &&
    (!spec.dtbAsset || existsSync(join(base, "virt.dtb"))) &&
    existsSync(join(base, "rootfs.tar.gz"))
  );
}

function validateAssetsDir(dir: string): void {
  const abs = resolve(dir);
  if (!existsSync(abs)) {
    die(`MACHINEN_ASSETS_DIR=${dir} does not exist`);
  }
  const spec = baseAssetSpec();
  const required = [spec.kernelAsset, spec.rootfsAsset, ...(spec.dtbAsset ? [spec.dtbAsset] : [])];
  const missing = required.filter((f) => !existsSync(join(abs, f)));
  if (missing.length > 0) {
    die(
      `MACHINEN_ASSETS_DIR=${dir} is missing for ${spec.cpu}: ${missing.join(", ")}\n` +
        `  Produce them with ./scripts/build-base-assets.sh (outputs to ./release-assets/).`,
    );
  }
}

async function ensureBaseAssets(tag: string): Promise<string> {
  const spec = baseAssetSpec();
  const base = baseDirFor(tag, "debian", spec.cpu);
  if (cachedBaseAssetsReady(base, spec)) {
    return base;
  }

  mkdirSync(base, { recursive: true });
  await downloadBaseAssets(tag, base, spec);
  replaceCurrentBaseSymlink(tag);
  return base;
}

function cachedBaseAssetsReady(base: string, spec: BaseAssetSpec): boolean {
  if (!existsSync(join(base, "Image"))) {
    return false;
  }
  if (spec.dtbAsset && !existsSync(join(base, "virt.dtb"))) {
    return false;
  }
  return existsSync(join(base, "rootfs.tar.gz"));
}

async function downloadBaseAssets(tag: string, base: string, spec: BaseAssetSpec): Promise<void> {
  await Promise.all(
    baseAssetDownloads(base, spec).map((a) => downloadWithChecksum(a.name, a.dest, tag)),
  );
}

function baseAssetDownloads(
  base: string,
  spec: BaseAssetSpec,
): Array<{ name: string; dest: string }> {
  const assets = [{ name: spec.kernelAsset, dest: join(base, "Image") }];
  if (spec.dtbAsset) {
    assets.push({ name: spec.dtbAsset, dest: join(base, "virt.dtb") });
  }
  assets.push({ name: spec.rootfsAsset, dest: join(base, "rootfs.tar.gz") });
  return assets;
}

function replaceCurrentBaseSymlink(tag: string): void {
  const current = join(CACHE_ROOT, "current");
  try {
    unlinkCurrentSymlink(current);
  } catch {}
  symlinkSync(tag, current, "dir");
}

function unlinkCurrentSymlink(current: string): void {
  if (existsSync(current) || isSymlink(current)) {
    unlinkSync(current);
  }
}

function isSymlink(p: string): boolean {
  // lstatSync (NOT statSync) so we still detect a dangling symlink whose
  // target was removed — `existsSync` and `statSync` both follow the
  // link and return false in that case, leaving stale `current`
  // symlinks in place and breaking the unlink+symlinkSync replace below.
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

async function downloadWithChecksum(asset: string, dest: string, tag: string): Promise<void> {
  const tmp = `${dest}.partial`;

  // Per-asset progress is useful detail when an operator is
  // debugging a fetch (slow network, asset name typo) but noise
  // for everyone else. Suppressed in quiet mode (#286); the caller
  // prints one headline + "ready in <t>s" instead.
  if (!isQuiet()) {
    process.stderr.write(`  fetch ${asset}\n`);
  }
  await downloadAsset(asset, tmp, tag);

  const sha = (await fetchAssetText(`${asset}.sha256`, tag)).trim().split(/\s+/)[0];
  const got = sha256OfFile(tmp);
  if (sha && got !== sha) {
    unlinkSync(tmp);
    die(`checksum mismatch for ${asset}: expected ${sha}, got ${got}`);
  }
  renameSync(tmp, dest);
}

function assetUrl(name: string, tag: string): string {
  return `${ASSETS_BASE_URL}/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

async function downloadAsset(name: string, dest: string, tag: string): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true });
  const url = assetUrl(name, tag);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    die(
      `fetch asset ${name} failed: ${res.status} ${res.statusText}\n` +
        `  url: ${url}\n` +
        "  check that the release tag exists on github.com/redwoodjs/machinen.dev.",
    );
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
}

async function fetchAssetText(name: string, tag: string): Promise<string> {
  const url = assetUrl(name, tag);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    die(`fetch asset ${name} failed: ${res.status} ${res.statusText}\n  url: ${url}`);
  }
  return res.text();
}

function sha256OfFile(path: string): string {
  return sha256Bytes(readFileSync(path));
}

function sha256Bytes(bytes: Buffer | string): string {
  const hash = createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}

// Boot/restore wire host stdin into the VMM's stdin pipe (the guest
// serial console). In cooked mode the host kernel's tty driver eats
// Ctrl-C as SIGINT before the byte reaches the guest, so killing
// `ping` in the guest would tear down the whole VM. Flip stdin to raw
// so 0x03 / arrows pass through untranslated; the guest's own tty
// turns Ctrl-C into SIGINT for its foreground process.
//
// Ctrl-D (0x04) is intercepted on the host side (see pipeStdinToVm)
// and shuts the VM down cleanly. Raw-mode stdin means the host kernel
// no longer turns it into EOF for us, and forwarding it to the guest
// is rarely useful — most workloads don't read stdin, and the workloads
// that do (interactive shells) already accept Ctrl-D as "log out", which
// the VM-level shutdown is just a louder version of.
function rawModeStdinIfTTY(): () => void {
  const stdin = process.stdin;
  if (stdin.isTTY !== true) {
    return () => {};
  }
  const wasRaw = stdin.isRaw === true;
  stdin.setRawMode(true);
  return () => {
    if (!wasRaw) {
      try {
        stdin.setRawMode(false);
      } catch {
        // Already restored or stream destroyed; ignore.
      }
    }
  };
}

// Pipe host stdin to the VMM's stdin, intercepting Ctrl-D as a host
// shutdown trigger. Pre-Ctrl-D bytes flow through verbatim; the 0x04
// byte itself and anything after it in the same chunk are dropped.
// onCtrlD fires once, on the first Ctrl-D seen.
//
// When stdin isn't a TTY (piped/redirected), Ctrl-D doesn't apply —
// 0x04 in input is just data — so we wire stdin straight through.
function pipeStdinToVm(vmStdin: NodeJS.WritableStream, onCtrlD: () => void): void {
  const stdin = process.stdin;
  if (stdin.isTTY !== true) {
    stdin.pipe(vmStdin);
    return;
  }
  let fired = false;
  const intercept = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      const idx = chunk.indexOf(0x04);
      if (idx === -1) {
        cb(null, chunk);
        return;
      }
      if (idx > 0) {
        this.push(chunk.subarray(0, idx));
      }
      cb();
      if (!fired) {
        fired = true;
        onCtrlD();
      }
    },
  });
  stdin.pipe(intercept).pipe(vmStdin);
}

// Print the "press Ctrl-D to stop" hint. In operator mode
// (DEBUG=machinen:*) the boot/restore output buries the first hint
// under kernel logs and init checkpoints; we reprint once the scroll
// settles to put it back where the user is most likely to read it.
// In quiet mode (#286) the headline lines are short and stable, so
// one hint right after them is enough — no reprint, no clutter.
//
// Returns a cancel function for the pending reprint — call from the
// finally block so the timer doesn't fire after the VM has already
// exited.
function printCtrlDHint(repeatAfterMs = 3000): () => void {
  if (process.stdin.isTTY !== true) {
    return () => {};
  }
  const msg = "machinen: press Ctrl-D to stop\n";
  process.stderr.write(msg);
  if (isQuiet()) {
    return () => {};
  }
  const t = setTimeout(() => {
    process.stderr.write(msg);
  }, repeatAfterMs);
  t.unref();
  return () => clearTimeout(t);
}

// ------------------------------------------------------------
// Generic flag extractors
// ------------------------------------------------------------

/**
 * Strip `--json` (a top-level CLI convention — every data-returning
 * command supports it) from the arg list and report whether it was set.
 * Bool flag, no value form. Always-stripped so subcommand parsers don't
 * need to know about it.
 */
function consumeJsonFlag(args: string[]): { json: boolean; rest: string[] } {
  const rest: string[] = [];
  let json = false;
  for (const a of args) {
    if (a === "--json") {
      json = true;
    } else {
      rest.push(a);
    }
  }
  return { json, rest };
}

/**
 * Strip `--dry-run`/`-n` from the arg list. Same role as
 * `consumeJsonFlag` but for mutating commands. Each command picks its
 * own taxonomy — `gc` and `stop` both land here; subcommand-specific
 * dry-run semantics are described in the agent-context envelope.
 */
function consumeDryRunFlag(args: string[]): { dryRun: boolean; rest: string[] } {
  const rest: string[] = [];
  let dryRun = false;
  for (const a of args) {
    if (a === "--dry-run" || a === "-n") {
      dryRun = true;
    } else {
      rest.push(a);
    }
  }
  return { dryRun, rest };
}

/** Newline-terminated JSON to stdout. Single source for every `--json` payload. */
function emitJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + "\n");
}

/** Structured error for `--json` mode. Goes to stderr; caller exits non-zero. */
function emitJsonError(code: string, message: string): void {
  process.stderr.write(JSON.stringify({ schema_version: 1, error: { code, message } }) + "\n");
}

// ------------------------------------------------------------
// Commands
// ------------------------------------------------------------

interface CliBaseAssetPaths {
  kernelPath: string;
  dtbPath?: string;
  defaultImagePath: string;
  baseDir: string;
}

async function resolveCliBaseAssets(): Promise<CliBaseAssetPaths> {
  const assetsOverride = process.env.MACHINEN_ASSETS_DIR;
  if (assetsOverride) {
    validateAssetsDir(assetsOverride);
  } else if (!baseAssetsComplete(RELEASE_TAG)) {
    process.stderr.write(`machinen: fetching base assets for ${RELEASE_TAG} (first run)\n`);
    await ensureBaseAssets(RELEASE_TAG);
  }
  return cliBaseAssetPaths(assetsOverride);
}

function cliBaseAssetPaths(assetsOverride: string | undefined): CliBaseAssetPaths {
  const spec = baseAssetSpec();
  const baseDir = cliBaseDir(assetsOverride, spec.cpu);
  return {
    baseDir,
    kernelPath: cliKernelPath(baseDir, assetsOverride, spec),
    dtbPath: cliDtbPath(baseDir, assetsOverride, spec),
    defaultImagePath: cliRootfsPath(baseDir, assetsOverride, spec),
  };
}

function cliBaseDir(assetsOverride: string | undefined, cpu: GuestCpu): string {
  if (assetsOverride) {
    return resolve(assetsOverride);
  }
  return baseDirFor(RELEASE_TAG, "debian", cpu);
}

function cliKernelPath(
  baseDir: string,
  assetsOverride: string | undefined,
  spec: BaseAssetSpec,
): string {
  return join(baseDir, assetsOverride ? spec.kernelAsset : "Image");
}

function cliDtbPath(
  baseDir: string,
  assetsOverride: string | undefined,
  spec: BaseAssetSpec,
): string | undefined {
  if (!spec.dtbAsset) {
    return undefined;
  }
  return join(baseDir, assetsOverride ? spec.dtbAsset : "virt.dtb");
}

function cliRootfsPath(
  baseDir: string,
  assetsOverride: string | undefined,
  spec: BaseAssetSpec,
): string {
  return join(baseDir, assetsOverride ? spec.rootfsAsset : "rootfs.tar.gz");
}

function resolveOptionalImageOverride(imageOverride: string | undefined): string | undefined {
  if (!imageOverride) {
    return undefined;
  }
  const imagePath = resolve(imageOverride);
  if (!existsSync(imagePath)) {
    die(`--image: file not found: ${imagePath}`);
  }
  return imagePath;
}

interface QuietRunState {
  headlineName: string;
  showHeadlines: boolean;
  buffer: RingBuffer;
  filter: NoiseFilter | null;
  filterOut: PassThrough | null;
  onLog?: (evt: LogEvent) => void;
}

interface AttachedSessionOptions {
  filter: NoiseFilter | null;
  filterOut?: PassThrough | null;
  buffer: RingBuffer;
  preReadyExitSummary: (code: number) => string;
}

async function runAttachedVmSession(vm: VmHandle, opts: AttachedSessionOptions): Promise<number> {
  vm.stdout.pipe(process.stdout);
  if (!opts.filter) {
    vm.stderr.pipe(process.stderr);
  }
  const restoreStdin = rawModeStdinIfTTY();
  const cancelHintRepeat = printCtrlDHint();
  const signalState = installVmSignalHandlers(vm);

  pipeStdinToVm(vm.stdin, () => {
    process.stderr.write("\nmachinen: Ctrl-D — stopping VM\n");
    signalState.forwardedSignal = "SIGTERM";
    void vm.kill();
  });
  opts.filterOut?.pipe(process.stderr);

  try {
    return await waitForAttachedVm(vm, opts, signalState);
  } finally {
    signalState.remove();
    cancelHintRepeat();
    restoreStdin();
  }
}

type ForwardedSignal = "SIGINT" | "SIGTERM" | null;

interface VmSignalState {
  forwardedSignal: ForwardedSignal;
  remove: () => void;
}

function installVmSignalHandlers(vm: VmHandle): VmSignalState {
  const state: VmSignalState = { forwardedSignal: null, remove: () => {} };
  const onSigint = () => {
    state.forwardedSignal = "SIGINT";
    void vm.kill();
  };
  const onSigterm = () => {
    state.forwardedSignal = "SIGTERM";
    void vm.kill();
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  state.remove = () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
  return state;
}

async function waitForAttachedVm(
  vm: VmHandle,
  opts: AttachedSessionOptions,
  signalState: VmSignalState,
): Promise<number> {
  const { code } = await vm.wait();
  opts.filter?.flush();
  const signalExitCode = forwardedSignalExitCode(signalState.forwardedSignal);
  if (signalExitCode !== undefined) {
    return signalExitCode;
  }
  if (shouldPrintPreReadyDiagnostics(opts.filter, code, signalState.forwardedSignal)) {
    printDiagnostics(opts.preReadyExitSummary(code!), { buffer: opts.buffer });
  }
  return code ?? 0;
}

function forwardedSignalExitCode(signal: ForwardedSignal): number | undefined {
  if (signal === "SIGINT") {
    return 130;
  }
  if (signal === "SIGTERM") {
    return 143;
  }
  return undefined;
}

function shouldPrintPreReadyDiagnostics(
  filter: NoiseFilter | null,
  code: number | null,
  forwardedSignal: ForwardedSignal,
): boolean {
  if (!filter) {
    return false;
  }
  if (filter.ready || forwardedSignal) {
    return false;
  }
  return isNonZeroExit(code);
}

function isNonZeroExit(code: number | null): boolean {
  if (code === null) {
    return false;
  }
  return code !== 0;
}

type ParsedBootArgs = ReturnType<typeof parseRunArgs>;

async function cmdBoot(args: string[]): Promise<number> {
  const parsed = parseBootCommandArgs(args);
  validateBootCommandArgs(parsed);

  const imageOverride = parsed.positional[0];
  const paths = await resolveCliBaseAssets();
  const imagePath = imageOverride ? resolve(imageOverride) : paths.defaultImagePath;
  logBootPlan(paths, imagePath, parsed);

  const quiet = createBootQuietState(parsed, imageOverride);
  const vm = await startBootVm(parsed, paths, imagePath, bootEnvCommand(parsed), quiet);
  if (parsed.detached) {
    reportDetachedBoot(vm, parsed);
    return 0;
  }
  return runBootAttachedSession(vm, quiet);
}

function parseBootCommandArgs(args: string[]): ParsedBootArgs {
  try {
    return parseRunArgs(args);
  } catch (err) {
    handleError(err);
  }
}

function validateBootCommandArgs(parsed: ParsedBootArgs): void {
  if (parsed.json && !parsed.detached) {
    die("boot --json is only meaningful with --detach (attached boots take over stdio).");
  }
  if (parsed.positional.length > 1) {
    die(bootUsage());
  }
}

function bootUsage(): string {
  return (
    "usage: machinen boot [<image>] [--snapshot <path>] [--name <name>] " +
    "[--cwd <abs-path>] " +
    "[--mount ...] [--mount-live ...] [--env KEY=VALUE]... [--detached] " +
    "[--nested] [--memory <mib>] [-- <cmd> [args...]]"
  );
}

function logBootPlan(paths: CliBaseAssetPaths, imagePath: string, parsed: ParsedBootArgs): void {
  debug(
    "boot baseDir=%s kernel=%s dtb=%s image=%s snapshot=%s name=%s",
    paths.baseDir,
    paths.kernelPath,
    paths.dtbPath,
    imagePath,
    parsed.snapshot ?? "<none>",
    parsed.name ?? "<unset>",
  );
}

function bootEnvCommand(parsed: ParsedBootArgs): string[] | undefined {
  // Wrap the user cmd in /usr/bin/env so bare names like `node` or
  // `bash` are PATH-resolved. The guest init uses execve(), which
  // needs an absolute path for argv[0]; /usr/bin/env is the standard
  // shim for this. When the caller passes no `-- cmd`, the image may
  // carry a baked-in default (see `provision({ cmd })`); boot() falls
  // back to that automatically.
  if (parsed.double_dash_args.length === 0) {
    return undefined;
  }
  return ["/usr/bin/env", ...parsed.double_dash_args];
}

function createBootQuietState(
  parsed: ParsedBootArgs,
  imageOverride: string | undefined,
): QuietRunState {
  const headlineName = parsed.name ?? deriveBootName(imageOverride);
  const showHeadlines = shouldShowBootHeadlines(parsed);
  const buffer = new RingBuffer();
  if (!showHeadlines) {
    return { headlineName, showHeadlines, buffer, filter: null, filterOut: null };
  }
  return createVisibleBootQuietState(parsed, headlineName, showHeadlines, buffer);
}

function shouldShowBootHeadlines(parsed: ParsedBootArgs): boolean {
  if (!isQuiet()) {
    return false;
  }
  if (parsed.detached && parsed.json) {
    return false;
  }
  return true;
}

function createVisibleBootQuietState(
  parsed: ParsedBootArgs,
  headlineName: string,
  showHeadlines: boolean,
  buffer: RingBuffer,
): QuietRunState {
  printHeadline(`booting ${headlineName}…`);
  if (parsed.detached) {
    return bootBufferOnlyQuietState(headlineName, showHeadlines, buffer);
  }
  return bootFilteredQuietState(headlineName, showHeadlines, buffer, Date.now());
}

function bootBufferOnlyQuietState(
  headlineName: string,
  showHeadlines: boolean,
  buffer: RingBuffer,
): QuietRunState {
  return {
    headlineName,
    showHeadlines,
    buffer,
    filter: null,
    filterOut: null,
    onLog: guestConsoleOnLog((chunk) => buffer.push(chunk)),
  };
}

function bootFilteredQuietState(
  headlineName: string,
  showHeadlines: boolean,
  buffer: RingBuffer,
  bootT0: number,
): QuietRunState {
  const filterOut = new PassThrough();
  const filter = new NoiseFilter({
    buffer,
    out: filterOut,
    onReady: () => {
      printHeadline("guest ready");
      printHeadline(`ready in ${formatElapsed(Date.now() - bootT0)}`);
    },
  });
  return {
    headlineName,
    showHeadlines,
    buffer,
    filter,
    filterOut,
    onLog: guestConsoleOnLog((chunk) => filter.push(chunk)),
  };
}

function guestConsoleOnLog(push: (chunk: Buffer) => void): (evt: LogEvent) => void {
  return (evt) => {
    if (evt.source === "guest-console") {
      push(evt.chunk);
    }
  };
}

async function startBootVm(
  parsed: ParsedBootArgs,
  paths: CliBaseAssetPaths,
  imagePath: string,
  cmd: string[] | undefined,
  quiet: QuietRunState,
): Promise<VmHandle> {
  try {
    return await boot({
      // Always pass the base rootfs so /sbin/machinen-restore and
      // friends are in the initramfs even on a bare `machinen restore
      // <snap>` (no --image, no -- cmd).
      image: imagePath,
      cmd,
      env: parsed.env,
      kernel: paths.kernelPath,
      dtb: paths.dtbPath,
      mount: parsed.mount,
      liveMounts: parsed.liveMounts,
      portForward: parsed.portForward,
      snapshot: parsed.snapshot,
      nested: parsed.nested,
      name: parsed.name,
      guestCwd: parsed.guestCwd,
      detached: parsed.detached,
      memory: parsed.memory,
      onLog: quiet.onLog,
      // Interactive CLI: the session lives as long as the guest does.
      // Don't impose the default 60s cap. Detached boots fall back to
      // the runtime's own readiness timeout (60s) so the CLI can't
      // hang forever waiting for first-guest-byte.
      timeoutMs: parsed.detached ? undefined : null,
    });
  } catch (err) {
    handleBootFailure(err, quiet);
  }
}

// fallow-ignore-next-line code-duplication
function handleBootFailure(err: unknown, quiet: QuietRunState): never {
  quiet.filter?.flush();
  if (quiet.showHeadlines) {
    failQuiet(`boot ${quiet.headlineName} failed: ${describeError(err)}`, {
      buffer: quiet.buffer,
    });
  }
  handleError(err);
}

function reportDetachedBoot(vm: VmHandle, parsed: ParsedBootArgs): void {
  // #150 phase 2: detached boot — VMM is already unrefed inside boot()
  // and the registry entry stays live for `machinen attach`. Print a
  // short hint so users know how to reach the VM and exit cleanly.
  if (parsed.json) {
    emitDetachedBootJson(vm, parsed);
    return;
  }
  printDetachedBootHint(vm, parsed);
}

function emitDetachedBootJson(vm: VmHandle, parsed: ParsedBootArgs): void {
  emitJson({ schema_version: 1, pid: vm.pid, name: parsed.name ?? null, detached: true });
}

function printDetachedBootHint(vm: VmHandle, parsed: ParsedBootArgs): void {
  const target = parsed.name ?? `pid ${vm.pid}`;
  process.stderr.write(
    `machinen: detached (${target}). ` +
      `Reattach: machinen attach ${parsed.name ?? vm.pid}\n` +
      `Stop: kill ${vm.pid}  (machinen stop ships in PR2)\n`,
  );
}

function runBootAttachedSession(vm: VmHandle, quiet: QuietRunState): Promise<number> {
  // Quiet mode: the NoiseFilter already routes vm.stderr (via the
  // `onLog` hook installed by boot()) into the ring buffer + stderr,
  // splitting boot noise from workload output. Operator mode
  // (filter === null) keeps the legacy raw passthrough.
  // In quiet mode, don't display the workload's first prompt until
  // stdin is in raw mode and piped to the VM.
  return runAttachedVmSession(vm, {
    filter: quiet.filter,
    filterOut: quiet.filterOut,
    buffer: quiet.buffer,
    preReadyExitSummary: (code) =>
      `boot ${quiet.headlineName} exited ${code} before reaching ready`,
  });
}

async function cmdInstall(args: string[]): Promise<number> {
  const opts = parseInstallOptions(args);
  const result = await installBaseAssets(opts);
  reportInstallResult(opts, result);
  return 0;
}

interface InstallOptions {
  json: boolean;
  tag: string;
}

interface InstallResult {
  base: string;
  wasComplete: boolean;
  elapsedMs: number;
}

function parseInstallOptions(args: string[]): InstallOptions {
  const { json, rest } = consumeJsonFlag(args);
  return { json, tag: argValue(rest, "--version") ?? RELEASE_TAG };
}

async function installBaseAssets(opts: InstallOptions): Promise<InstallResult> {
  const wasComplete = baseAssetsComplete(opts.tag);
  const t0 = Date.now();
  printInstallStart(opts);
  try {
    const base = await ensureBaseAssets(opts.tag);
    return { base, wasComplete, elapsedMs: Date.now() - t0 };
  } catch (err) {
    reportInstallFailure(opts, err);
    throw err;
  }
}

function printInstallStart(opts: InstallOptions): void {
  if (opts.json) {
    return;
  }
  process.stderr.write(`installing base assets for ${opts.tag}…\n`);
  if (!isQuiet()) {
    process.stderr.write(`  into ${cacheDirFor(opts.tag)}\n`);
  }
}

function reportInstallFailure(opts: InstallOptions, err: unknown): void {
  if (isQuiet() && !opts.json) {
    failQuiet(`install ${opts.tag} failed: ${describeError(err)}`);
  }
}

function reportInstallResult(opts: InstallOptions, result: InstallResult): void {
  if (opts.json) {
    emitInstallJson(opts, result);
    return;
  }
  printInstallReady(result);
}

function emitInstallJson(opts: InstallOptions, result: InstallResult): void {
  emitJson({
    schema_version: 1,
    tag: opts.tag,
    base_dir: result.base,
    fetched: !result.wasComplete,
  });
}

function printInstallReady(result: InstallResult): void {
  if (result.wasComplete) {
    process.stderr.write(`ready: ${result.base} (cached)\n`);
    return;
  }
  process.stderr.write(`ready in ${formatElapsed(result.elapsedMs)}: ${result.base}\n`);
}

type ParsedRestoreCommandArgs = ReturnType<typeof parseRestoreArgs>;

// fallow-ignore-next-line complexity
function cmdCapture(args: string[]): number {
  const { json, rest: withoutJson } = consumeJsonFlag(args);
  const { dryRun, rest } = consumeDryRunFlag(withoutJson);
  if (rest[0] === "node-level5") {
    return cmdCaptureNodeLevel5DeclaredSubset({ json, dryRun, rest });
  }
  die(captureUsage());
}

// fallow-ignore-next-line complexity code-duplication
function cmdCaptureNodeLevel5DeclaredSubset(input: {
  json: boolean;
  dryRun: boolean;
  rest: string[];
}): number {
  const options = parseNodeLevel5DeclaredSubsetCaptureArgs(input.rest.slice(1));
  if (!options.out) {
    reportNodeLevel5DeclaredSubsetCliRefusal(
      input.json,
      "node-level5-declared-subset-output-required",
      "machinen capture node-level5 requires --out <dir>",
    );
  }
  const summary = createNodeLevel5DeclaredSubsetCapture({
    outDir: options.out,
    sourceArch: options.sourceArch,
    targetArch: options.targetArch,
    experimental: options.experimental,
    productSupportClaimed: options.productSupportClaimed,
    dryRun: input.dryRun,
  });
  return reportNodeLevel5DeclaredSubsetSummary(input.json, summary, {
    accepted: (value) => `captured experimental node-level5 manifest: ${value.manifestPath}\n`,
    refused: (value) => `refused experimental node-level5 capture: ${value.refusal?.code}\n`,
  });
}

type NodeLevel5DeclaredSubsetCliOptions = {
  out: string;
  manifest: string;
  sourceArch: "arm64" | "amd64";
  targetArch: "arm64" | "amd64";
  experimental: boolean;
  productSupportClaimed: boolean;
  rawCpuRestore: boolean;
};

function parseNodeLevel5DeclaredSubsetCaptureArgs(
  args: string[],
): Pick<
  NodeLevel5DeclaredSubsetCliOptions,
  "out" | "sourceArch" | "targetArch" | "experimental" | "productSupportClaimed"
> {
  return parseNodeLevel5DeclaredSubsetCliArgs(args, "capture");
}

function parseNodeLevel5DeclaredSubsetRestoreArgs(
  args: string[],
): Pick<
  NodeLevel5DeclaredSubsetCliOptions,
  "manifest" | "experimental" | "productSupportClaimed" | "rawCpuRestore"
> {
  return parseNodeLevel5DeclaredSubsetCliArgs(args, "restore");
}

// fallow-ignore-next-line complexity
function parseNodeLevel5DeclaredSubsetCliArgs(
  args: string[],
  mode: "capture" | "restore",
): NodeLevel5DeclaredSubsetCliOptions {
  const options = defaultNodeLevel5DeclaredSubsetCliOptions();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--experimental-node-level5") {
      options.experimental = true;
    } else if (arg === "--claim-product-support") {
      options.productSupportClaimed = true;
    } else if (mode === "capture" && arg === "--out") {
      options.out = takeCaptureValue(args, (index += 1), "--out");
    } else if (mode === "capture" && arg === "--source-arch") {
      options.sourceArch = parseProductArch(
        takeCaptureValue(args, (index += 1), "--source-arch"),
        "--source-arch",
      );
    } else if (mode === "capture" && arg === "--target-arch") {
      options.targetArch = parseProductArch(
        takeCaptureValue(args, (index += 1), "--target-arch"),
        "--target-arch",
      );
    } else if (mode === "restore" && arg === "--raw-cpu-restore") {
      options.rawCpuRestore = true;
    } else if (mode === "restore" && arg === "--manifest") {
      options.manifest = takeCaptureValue(args, (index += 1), "--manifest");
    } else if (mode === "restore" && !arg.startsWith("-") && !options.manifest) {
      options.manifest = arg;
    } else {
      die(`unknown node-level5 ${mode} argument: ${arg}`);
    }
  }
  return options;
}

function defaultNodeLevel5DeclaredSubsetCliOptions(): NodeLevel5DeclaredSubsetCliOptions {
  return {
    out: "",
    manifest: "",
    sourceArch: "arm64",
    targetArch: "amd64",
    experimental: false,
    productSupportClaimed: false,
    rawCpuRestore: false,
  };
}

function reportNodeLevel5DeclaredSubsetCliRefusal(
  json: boolean,
  code: string,
  message: string,
): never {
  if (json) {
    emitJsonError(code, message);
  } else {
    process.stderr.write(`machinen: ${message} (${code})\n`);
  }
  process.exit(1);
}

type NodeLevel5DeclaredSubsetCliSummary = {
  accepted: boolean;
  manifestPath?: string;
  refusal?: { code: string };
};

function reportNodeLevel5DeclaredSubsetSummary<TSummary extends NodeLevel5DeclaredSubsetCliSummary>(
  json: boolean,
  summary: TSummary,
  messages: {
    accepted: (summary: TSummary) => string;
    refused: (summary: TSummary) => string;
  },
): number {
  if (json) {
    emitJson(summary);
  } else {
    process.stderr.write(summary.accepted ? messages.accepted(summary) : messages.refused(summary));
  }
  return summary.accepted ? 0 : 1;
}

type NodeLevel5ProductSnapshotCliOptions = {
  out?: string;
  target?: Target;
};

type RequiredNodeLevel5SnapshotOptions = {
  out: string;
  target: Target;
};

type NodeLevel5ProductSnapshotTargetMetadata = {
  runtime?: "node" | "unknown";
  appDir?: string;
  pid?: number;
  argv?: string;
  executable?: string;
};

type NodeLevel5ArtifactCliOptions = {
  out?: string;
  root?: string;
  family?: NodeLevel5ProductSupport80FamilyId;
  direction?: "arm64-to-amd64" | "amd64-to-arm64";
};

// fallow-ignore-next-line complexity
function cmdNodeLevel5(args: string[]): number {
  const { json, rest } = consumeJsonFlag(args);
  if (rest[0] === "artifacts") {
    return cmdNodeLevel5Artifacts(rest.slice(1), json);
  }
  if (rest[0] === "detectors") {
    return cmdNodeLevel5Detectors(rest.slice(1), json);
  }
  if (rest[0] === "claims") {
    return cmdNodeLevel5Claims(rest.slice(1), json);
  }
  if (rest[0] === "support-matrix") {
    return cmdNodeLevel5SupportMatrix(rest.slice(1), json);
  }
  if (rest[0] === "release-gate") {
    return cmdNodeLevel5ReleaseGate(rest.slice(1), json);
  }
  if (rest[0] === "85-readiness") {
    return cmdNodeLevel5ProductSupport85Readiness(rest.slice(1), json);
  }
  if (rest[0] === "85-claim-ready") {
    return cmdNodeLevel5ProductSupport85ClaimReady(rest.slice(1), json);
  }
  if (rest[0] === "abi-check") {
    return cmdNodeLevel5AbiCheck(rest.slice(1), json);
  }
  die(nodeLevel5Usage());
}

// fallow-ignore-next-line complexity
function cmdNodeLevel5Artifacts(args: string[], json: boolean): number {
  const [sub, ...rest] = args;
  const options = parseNodeLevel5ArtifactArgs(rest);
  if (sub === "write") {
    if (!options.out || !options.family || !options.direction) {
      die("machinen node-level5 artifacts write requires --out, --family, and --direction");
    }
    const bundle = createNodeLevel5ProductSupport80ArtifactBundle({
      outDir: resolve(options.out),
      familyId: options.family,
      direction: options.direction,
    });
    return reportNodeLevel5ProductCommand(json, { accepted: true, bundle });
  }
  if (sub === "verify") {
    if (!options.root || !options.family || !options.direction) {
      die("machinen node-level5 artifacts verify requires --root, --family, and --direction");
    }
    try {
      assertSafeNodeLevel5ArtifactRootPath(options.root);
      return reportNodeLevel5ProductCommand(
        json,
        verifyNodeLevel5RetainedArtifact({
          root: options.root,
          family: options.family,
          direction: options.direction,
        }),
      );
    } catch (error) {
      return reportNodeLevel5ProductCommand(json, {
        accepted: false,
        code: "node-level5-artifact-bundle-invalid",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  die(nodeLevel5Usage());
}

function cmdNodeLevel5Detectors(args: string[], json: boolean): number {
  const artifact = readOptionalNodeLevel5RetainedArtifact(args);
  return reportNodeLevel5ProductCommand(json, {
    accepted: true,
    kind: "machinen.node-level5-detector-registry-summary",
    detectors: nodeLevel5ProductSupport80UnsupportedDetectors,
    retainedArtifact: artifact,
  });
}

function cmdNodeLevel5Claims(args: string[], json: boolean): number {
  const artifact = readOptionalNodeLevel5RetainedArtifact(args);
  return reportNodeLevel5ProductCommand(json, {
    accepted: true,
    kind: "machinen.node-level5-claim-registry-summary",
    claimRegistry: nodeLevel5ProductSupport85ClaimRegistry,
    retainedArtifact: artifact,
  });
}

function cmdNodeLevel5SupportMatrix(args: string[], json: boolean): number {
  const artifact = readOptionalNodeLevel5RetainedArtifact(args);
  return reportNodeLevel5ProductCommand(json, {
    ...buildNodeLevel5AppSupportMatrix(),
    retainedArtifact: artifact,
  });
}

function cmdNodeLevel5ReleaseGate(args: string[], json: boolean): number {
  const corpus = readOptionalNodeLevel5RealAppCorpus(args);
  const refusalCorpus = readOptionalNodeLevel5RealAppRefusalCorpus(args);
  const thirdPartyAppCorpus = readOptionalNodeLevel5ThirdPartyAppCorpus(args);
  const installedThirdPartyAppCorpus = readOptionalNodeLevel5InstalledThirdPartyAppCorpus(args);
  const genericVmCorpus = readOptionalNodeLevel5GenericVmCorpus(args);
  const genericVmRetainedEvidence = readOptionalNodeLevel5GenericVmRetainedEvidence(args);
  const genericVmRowArtifacts = readOptionalNodeLevel5GenericVmRowArtifacts(args);
  const genericVmRefusalArtifacts = readOptionalNodeLevel5GenericVmRefusalArtifacts(args);
  const artifact = readOptionalNodeLevel5RetainedArtifact(nodeLevel5ReleaseGateArtifactArgs(args));
  const accepted = [
    artifact,
    corpus,
    refusalCorpus,
    thirdPartyAppCorpus,
    installedThirdPartyAppCorpus,
    genericVmCorpus,
    genericVmRetainedEvidence,
    genericVmRowArtifacts,
    genericVmRefusalArtifacts,
  ].every((item) => (item ? item.accepted === true : true));
  return reportNodeLevel5ProductCommand(json, {
    accepted,
    kind: "machinen.node-level5-release-gate-summary",
    nodeProductSupportClaimed: 85,
    broadNodeProductSupportClaimed: 25,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    retainedArtifact: artifact,
    realAppCorpus: corpus,
    realAppRefusalCorpus: refusalCorpus,
    thirdPartyAppCorpus,
    installedThirdPartyAppCorpus,
    genericVmCorpus,
    genericVmRetainedEvidence,
    genericVmRowArtifacts,
    genericVmRefusalArtifacts,
  });
}

const nodeLevel5ReleaseGateReportFlags = new Set([
  "--include-real-app-corpus",
  "--include-refusal-corpus",
  "--include-third-party-app-corpus",
  "--include-installed-third-party-app-corpus",
  "--include-generic-vm-corpus",
  "--include-generic-vm-retained-evidence",
  "--include-generic-vm-row-artifacts",
  "--include-generic-vm-refusal-artifacts",
  "--corpus-report",
  "--refusal-corpus-report",
  "--third-party-app-corpus-report",
  "--installed-third-party-app-corpus-report",
  "--generic-vm-corpus-report",
  "--generic-vm-retained-evidence-report",
  "--generic-vm-row-artifacts-report",
  "--generic-vm-refusal-artifacts-report",
]);
const nodeLevel5ReleaseGateReportValueFlags = new Set([
  "--corpus-report",
  "--refusal-corpus-report",
  "--third-party-app-corpus-report",
  "--installed-third-party-app-corpus-report",
  "--generic-vm-corpus-report",
  "--generic-vm-retained-evidence-report",
  "--generic-vm-row-artifacts-report",
  "--generic-vm-refusal-artifacts-report",
]);

function cmdNodeLevel5ProductSupport85Readiness(args: string[], json: boolean): number {
  const reportPath = requiredNodeLevel5GenericVmCorpusReportPath(args, "85-readiness");
  const retainedEvidencePath = optionalNodeLevel5GenericVmRetainedEvidenceReportPath(args);
  const rowArtifactsPath = optionalNodeLevel5GenericVmRowArtifactsReportPath(args);
  const refusalArtifactsPath = optionalNodeLevel5GenericVmRefusalArtifactsReportPath(args);
  const summary = evaluateNodeLevel5ProductSupport85Readiness({
    genericVmCorpusReport: loadNodeLevel5GenericVmCorpusReport(resolve(reportPath)),
    ...(retainedEvidencePath
      ? {
          genericVmRetainedEvidenceReport: loadNodeLevel5GenericVmRetainedEvidenceReport(
            resolve(retainedEvidencePath),
          ),
        }
      : {}),
    ...(rowArtifactsPath
      ? {
          genericVmRowArtifactsReport: loadNodeLevel5GenericVmRowArtifactsReport(
            resolve(rowArtifactsPath),
          ),
        }
      : {}),
    ...(refusalArtifactsPath
      ? {
          genericVmRefusalArtifactsReport: loadNodeLevel5GenericVmRefusalArtifactsReport(
            resolve(refusalArtifactsPath),
          ),
        }
      : {}),
  });
  return reportNodeLevel5ProductCommand(json, summary);
}

function cmdNodeLevel5ProductSupport85ClaimReady(args: string[], json: boolean): number {
  const readinessPath = requiredNodeLevel5ProductSupport85ReadinessReportPath(args);
  const summary = evaluateNodeLevel5ProductSupport85ClaimReady({
    readinessReport: loadNodeLevel5ProductSupport85ReadinessReport(resolve(readinessPath)),
  });
  return reportNodeLevel5ProductCommand(json, summary);
}

function requiredNodeLevel5ProductSupport85ReadinessReportPath(args: string[]): string {
  const reportFlag = args.indexOf("--readiness-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die("machinen node-level5 85-claim-ready requires --readiness-report <file>");
  }
  return path;
}

function nodeLevel5ReleaseGateArtifactArgs(args: string[]): string[] {
  return args.filter((arg, index) => !isNodeLevel5ReleaseGateReportArg(args, arg, index));
}

function isNodeLevel5ReleaseGateReportArg(args: string[], arg: string, index: number): boolean {
  return (
    nodeLevel5ReleaseGateReportFlags.has(arg) ||
    nodeLevel5ReleaseGateReportValueFlags.has(args[index - 1] ?? "")
  );
}

function readOptionalNodeLevel5RealAppCorpus(args: string[]): Record<string, unknown> | undefined {
  const path = nodeLevel5RealAppCorpusReportPath(args);
  return path ? verifyNodeLevel5RealAppCorpusPath(path) : undefined;
}

function nodeLevel5RealAppCorpusReportPath(args: string[]): string | undefined {
  if (!args.includes("--include-real-app-corpus")) {
    return undefined;
  }
  const reportFlag = args.indexOf("--corpus-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die(
      "machinen node-level5 release-gate --include-real-app-corpus requires --corpus-report <file>",
    );
  }
  return path;
}

function verifyNodeLevel5RealAppCorpusPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5RealAppCorpusReport(loadNodeLevel5RealAppCorpusReport(resolve(path)));
  } catch (error) {
    return invalidNodeLevel5RealAppCorpus(error);
  }
}

function invalidNodeLevel5RealAppCorpus(error: unknown): Record<string, unknown> {
  return invalidNodeLevel5ReleaseReport("node-level5-real-app-corpus-invalid", error);
}

function readOptionalNodeLevel5RealAppRefusalCorpus(
  args: string[],
): Record<string, unknown> | undefined {
  const path = nodeLevel5RealAppRefusalCorpusReportPath(args);
  return path ? verifyNodeLevel5RealAppRefusalCorpusPath(path) : undefined;
}

function nodeLevel5RealAppRefusalCorpusReportPath(args: string[]): string | undefined {
  if (!args.includes("--include-refusal-corpus")) {
    return undefined;
  }
  const reportFlag = args.indexOf("--refusal-corpus-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die(
      "machinen node-level5 release-gate --include-refusal-corpus requires --refusal-corpus-report <file>",
    );
  }
  return path;
}

function verifyNodeLevel5RealAppRefusalCorpusPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5RealAppRefusalCorpusReport(
      loadNodeLevel5RealAppRefusalCorpusReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport("node-level5-real-app-refusal-corpus-invalid", error);
  }
}

function readOptionalNodeLevel5ThirdPartyAppCorpus(
  args: string[],
): Record<string, unknown> | undefined {
  const path = nodeLevel5ThirdPartyAppCorpusReportPath(args);
  return path ? verifyNodeLevel5ThirdPartyAppCorpusPath(path) : undefined;
}

function nodeLevel5ThirdPartyAppCorpusReportPath(args: string[]): string | undefined {
  if (!args.includes("--include-third-party-app-corpus")) {
    return undefined;
  }
  const reportFlag = args.indexOf("--third-party-app-corpus-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die(
      "machinen node-level5 release-gate --include-third-party-app-corpus requires --third-party-app-corpus-report <file>",
    );
  }
  return path;
}

function verifyNodeLevel5ThirdPartyAppCorpusPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5ThirdPartyAppCorpusReport(
      loadNodeLevel5ThirdPartyAppCorpusReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport("node-level5-third-party-app-corpus-invalid", error);
  }
}

function readOptionalNodeLevel5InstalledThirdPartyAppCorpus(
  args: string[],
): Record<string, unknown> | undefined {
  const path = nodeLevel5InstalledThirdPartyAppCorpusReportPath(args);
  return path ? verifyNodeLevel5InstalledThirdPartyAppCorpusPath(path) : undefined;
}

function nodeLevel5InstalledThirdPartyAppCorpusReportPath(args: string[]): string | undefined {
  if (!args.includes("--include-installed-third-party-app-corpus")) {
    return undefined;
  }
  const reportFlag = args.indexOf("--installed-third-party-app-corpus-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die(
      "machinen node-level5 release-gate --include-installed-third-party-app-corpus requires --installed-third-party-app-corpus-report <file>",
    );
  }
  return path;
}

function verifyNodeLevel5InstalledThirdPartyAppCorpusPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5InstalledThirdPartyAppCorpusReport(
      loadNodeLevel5InstalledThirdPartyAppCorpusReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport(
      "node-level5-installed-third-party-app-corpus-invalid",
      error,
    );
  }
}

function readOptionalNodeLevel5GenericVmCorpus(
  args: string[],
): Record<string, unknown> | undefined {
  const path = nodeLevel5GenericVmCorpusReportPath(args);
  return path ? verifyNodeLevel5GenericVmCorpusPath(path) : undefined;
}

function nodeLevel5GenericVmCorpusReportPath(args: string[]): string | undefined {
  if (!args.includes("--include-generic-vm-corpus")) {
    return undefined;
  }
  return requiredNodeLevel5GenericVmCorpusReportPath(
    args,
    "release-gate --include-generic-vm-corpus",
  );
}

function requiredNodeLevel5GenericVmCorpusReportPath(args: string[], command: string): string {
  const reportFlag = args.indexOf("--generic-vm-corpus-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die(`machinen node-level5 ${command} requires --generic-vm-corpus-report <file>`);
  }
  return path;
}

function verifyNodeLevel5GenericVmCorpusPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5GenericVmCorpusReport(
      loadNodeLevel5GenericVmCorpusReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport("node-level5-generic-vm-corpus-invalid", error);
  }
}

function readOptionalNodeLevel5GenericVmRetainedEvidence(
  args: string[],
): Record<string, unknown> | undefined {
  if (!args.includes("--include-generic-vm-retained-evidence")) {
    return undefined;
  }
  const path = requiredNodeLevel5GenericVmRetainedEvidenceReportPath(
    args,
    "release-gate --include-generic-vm-retained-evidence",
  );
  return verifyNodeLevel5GenericVmRetainedEvidencePath(path);
}

function optionalNodeLevel5GenericVmRetainedEvidenceReportPath(args: string[]): string | undefined {
  const reportFlag = args.indexOf("--generic-vm-retained-evidence-report");
  return reportFlag === -1 ? undefined : args[reportFlag + 1];
}

function requiredNodeLevel5GenericVmRetainedEvidenceReportPath(
  args: string[],
  command: string,
): string {
  const path = optionalNodeLevel5GenericVmRetainedEvidenceReportPath(args);
  if (!path) {
    die(`machinen node-level5 ${command} requires --generic-vm-retained-evidence-report <file>`);
  }
  return path;
}

function verifyNodeLevel5GenericVmRetainedEvidencePath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5GenericVmRetainedEvidenceReport(
      loadNodeLevel5GenericVmRetainedEvidenceReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport(
      "node-level5-generic-vm-retained-evidence-invalid",
      error,
    );
  }
}

function readOptionalNodeLevel5GenericVmRowArtifacts(
  args: string[],
): Record<string, unknown> | undefined {
  if (!args.includes("--include-generic-vm-row-artifacts")) {
    return undefined;
  }
  const path = requiredNodeLevel5GenericVmRowArtifactsReportPath(
    args,
    "release-gate --include-generic-vm-row-artifacts",
  );
  return verifyNodeLevel5GenericVmRowArtifactsPath(path);
}

function optionalNodeLevel5GenericVmRowArtifactsReportPath(args: string[]): string | undefined {
  const reportFlag = args.indexOf("--generic-vm-row-artifacts-report");
  return reportFlag === -1 ? undefined : args[reportFlag + 1];
}

function requiredNodeLevel5GenericVmRowArtifactsReportPath(
  args: string[],
  command: string,
): string {
  const path = optionalNodeLevel5GenericVmRowArtifactsReportPath(args);
  if (!path) {
    die(`machinen node-level5 ${command} requires --generic-vm-row-artifacts-report <file>`);
  }
  return path;
}

function verifyNodeLevel5GenericVmRowArtifactsPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5GenericVmRowArtifactsReport(
      loadNodeLevel5GenericVmRowArtifactsReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport("node-level5-generic-vm-row-artifacts-invalid", error);
  }
}

function readOptionalNodeLevel5GenericVmRefusalArtifacts(
  args: string[],
): Record<string, unknown> | undefined {
  if (!args.includes("--include-generic-vm-refusal-artifacts")) {
    return undefined;
  }
  const path = requiredNodeLevel5GenericVmRefusalArtifactsReportPath(
    args,
    "release-gate --include-generic-vm-refusal-artifacts",
  );
  return verifyNodeLevel5GenericVmRefusalArtifactsPath(path);
}

function optionalNodeLevel5GenericVmRefusalArtifactsReportPath(args: string[]): string | undefined {
  const reportFlag = args.indexOf("--generic-vm-refusal-artifacts-report");
  return reportFlag === -1 ? undefined : args[reportFlag + 1];
}

function requiredNodeLevel5GenericVmRefusalArtifactsReportPath(
  args: string[],
  command: string,
): string {
  const path = optionalNodeLevel5GenericVmRefusalArtifactsReportPath(args);
  if (!path) {
    die(`machinen node-level5 ${command} requires --generic-vm-refusal-artifacts-report <file>`);
  }
  return path;
}

function verifyNodeLevel5GenericVmRefusalArtifactsPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5GenericVmRefusalArtifactsReport(
      loadNodeLevel5GenericVmRefusalArtifactsReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport(
      "node-level5-generic-vm-refusal-artifacts-invalid",
      error,
    );
  }
}

function invalidNodeLevel5ReleaseReport(code: string, error: unknown): Record<string, unknown> {
  return {
    accepted: false,
    code,
    message: error instanceof Error ? error.message : String(error),
  };
}

// fallow-ignore-next-line complexity
function readOptionalNodeLevel5RetainedArtifact(
  args: string[],
): Record<string, unknown> | undefined {
  if (args.length === 0) {
    return undefined;
  }
  try {
    const options = parseNodeLevel5ArtifactArgs(args);
    if (!options.root || !options.family || !options.direction) {
      die(
        "machinen node-level5 retained artifact commands require --root, --family, and --direction",
      );
    }
    assertSafeNodeLevel5ArtifactRootPath(options.root);
    return verifyNodeLevel5RetainedArtifact({
      root: options.root,
      family: options.family,
      direction: options.direction,
    });
  } catch (error) {
    return {
      accepted: false,
      code: "node-level5-artifact-bundle-invalid",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function verifyNodeLevel5RetainedArtifact(
  options: Required<Pick<NodeLevel5ArtifactCliOptions, "root" | "family" | "direction">>,
): Record<string, unknown> {
  const bundle = loadNodeLevel5ProductSupport80ArtifactBundle({
    artifactRoot: resolve(options.root),
    familyId: options.family,
    direction: options.direction,
  });
  return verifyNodeLevel5ProductSupport80ArtifactBundle(bundle);
}

function assertSafeNodeLevel5ArtifactRootPath(path: string): void {
  if (path.split(/[\\/]+/u).includes("..")) {
    throw new Error("Node Level 5 artifact root must not contain path traversal segments");
  }
}

// fallow-ignore-next-line complexity
function parseNodeLevel5ArtifactArgs(args: string[]): NodeLevel5ArtifactCliOptions {
  const options: NodeLevel5ArtifactCliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--out") {
      options.out = takeCaptureValue(args, (index += 1), "--out");
    } else if (arg === "--root") {
      options.root = takeCaptureValue(args, (index += 1), "--root");
    } else if (arg === "--family") {
      options.family = takeCaptureValue(
        args,
        (index += 1),
        "--family",
      ) as NodeLevel5ProductSupport80FamilyId;
    } else if (arg === "--direction") {
      options.direction = takeCaptureValue(args, (index += 1), "--direction") as
        | "arm64-to-amd64"
        | "amd64-to-arm64";
    } else {
      die(`unknown node-level5 artifact argument: ${arg}`);
    }
  }
  return options;
}

// fallow-ignore-next-line complexity
function cmdNodeLevel5AbiCheck(args: string[], json: boolean): number {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    values.set(args[index]!, args[index + 1] ?? "");
  }
  const accepted =
    values.get("--node") === "22.x" &&
    values.get("--v8") === "12.x pointer-compressed" &&
    values.get("--libuv") === "supported idle handles plus selected hard-facility boundaries";
  return reportNodeLevel5ProductCommand(json, {
    accepted,
    kind: "machinen.node-level5-abi-check-summary",
    refusal: accepted ? undefined : { code: "node-level5-unknown-abi-refused" },
  });
}

function reportNodeLevel5ProductCommand(json: boolean, summary: Record<string, unknown>): number {
  if (json) {
    emitJson(summary);
  } else {
    process.stderr.write(`${summary.accepted ? "accepted" : "refused"} node-level5 command\n`);
  }
  return summary.accepted === false ? 1 : 0;
}

function nodeLevel5Usage(): string {
  return (
    "usage: machinen node-level5 artifacts <write|verify> ... [--json]\n" +
    "       machinen node-level5 support-matrix [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-corpus --generic-vm-corpus-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-retained-evidence --generic-vm-retained-evidence-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-row-artifacts --generic-vm-row-artifacts-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-refusal-artifacts --generic-vm-refusal-artifacts-report <file>] [--json]\n" +
    "       machinen node-level5 85-readiness --generic-vm-corpus-report <file> [--generic-vm-retained-evidence-report <file>] [--generic-vm-row-artifacts-report <file>] [--generic-vm-refusal-artifacts-report <file>] [--json]\n" +
    "       machinen node-level5 85-claim-ready --readiness-report <file> [--json]\n"
  );
}

function captureUsage(): string {
  return (
    "usage: machinen capture node-level5 --out <dir> " +
    "[--source-arch <arm64|amd64>] [--target-arch <arm64|amd64>] " +
    "[--experimental-node-level5] [--claim-product-support] [--json] [--dry-run]"
  );
}
function takeCaptureValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) {
    die(`${flag} requires a value`);
  }
  return value;
}

function parseProductArch(value: string, flag: string): "arm64" | "amd64" {
  if (value === "arm64" || value === "amd64") {
    return value;
  }
  die(`${flag} must be arm64 or amd64`);
}

// fallow-ignore-next-line complexity code-duplication
function cmdRestoreNodeLevel5DeclaredSubset(input: { json: boolean; rest: string[] }): number {
  const options = parseNodeLevel5DeclaredSubsetRestoreArgs(input.rest);
  if (!options.manifest) {
    reportNodeLevel5DeclaredSubsetCliRefusal(
      input.json,
      "node-level5-declared-subset-manifest-required",
      "machinen restore node-level5 requires <manifest> or --manifest <file>",
    );
  }
  const summary = restoreNodeLevel5DeclaredSubset({
    manifestPath: resolve(options.manifest),
    experimental: options.experimental,
    rawCpuRestore: options.rawCpuRestore,
    productSupportClaimed: options.productSupportClaimed,
  });
  return reportNodeLevel5DeclaredSubsetSummary(input.json, summary, {
    accepted: (value) =>
      `accepted experimental node-level5 restore manifest: ${value.manifestPath}\n`,
    refused: (value) => `refused experimental node-level5 restore: ${value.refusal?.code}\n`,
  });
}

// fallow-ignore-next-line complexity
async function cmdRestore(args: string[]): Promise<number> {
  // `machinen restore <snap-dir> [--image <tarball>] [--name <name>]
  // [--lazy] [-p <hostPort>:<guestPort>]`. Restore is eager by
  // default; `--lazy` opts into the #266 CRIU lazy-pages path.
  const { json, rest } = consumeJsonFlag(args);
  if (rest[0] === "node-level5") {
    return cmdRestoreNodeLevel5DeclaredSubset({ json, rest: rest.slice(1) });
  }
  const parsed = parseRestoreCommandArgs(rest);
  validateRestoreCommandArgs(parsed);
  const snapDir = resolve(parsed.positional[0]!);
  if (isNodeLevel5ProductSnapshotBundle(snapDir)) {
    return cmdRestoreNodeLevel5ProductSnapshot(snapDir, json);
  }
  if (!shouldPreferVmstateRestore(snapDir)) {
    if (isNodeLevel5ProofCompositionBundle(snapDir)) {
      return await cmdRestoreNodeLevel5ProofComposition(snapDir, json, parsed);
    }
    if (shouldRestoreCleanServiceBundle(snapDir, guestCpu)) {
      return restoreCleanServiceBundle({
        snapDir,
        json,
        name: parsed.name,
        resolveCliBaseAssets,
        guestCpu,
        deriveBootName,
        emitJson,
        shellQuote,
      });
    }
    if (shouldRestorePortableNode(snapDir)) {
      return cmdRestorePortableNode(parsed, snapDir, json);
    }
  }
  if (json) {
    die("restore --json is only supported for supported descriptor restore paths");
  }
  const paths = await resolveCliBaseAssets();
  const quiet = createRestoreQuietState(parsed, snapDir);
  const vm = await startRestoreVm(parsed, snapDir, paths, quiet);
  reportRestoreSuccess(vm, quiet);
  return runRestoreAttachedSession(vm, quiet);
}

function cmdRestoreNodeLevel5ProductSnapshot(snapDir: string, json: boolean): number {
  try {
    return reportNodeLevel5ProductSnapshotRestore(
      restoreNodeLevel5ProductSnapshot({ snapshotDir: snapDir }),
      json,
    );
  } catch (error) {
    return reportNodeLevel5ProductSnapshotRestoreError(error, json);
  }
}

function reportNodeLevel5ProductSnapshotRestore(
  summary: ReturnType<typeof restoreNodeLevel5ProductSnapshot>,
  json: boolean,
): number {
  if (json) {
    emitJson(summary);
  } else {
    process.stdout.write(`restored node snapshot: ${summary.familyId} ${summary.direction}\n`);
  }
  return summary.accepted ? 0 : 1;
}

function reportNodeLevel5ProductSnapshotRestoreError(error: unknown, json: boolean): number {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    emitJsonError("node-level5-product-snapshot-invalid", message);
  } else {
    process.stderr.write(`machinen restore: ${message}\n`);
  }
  return 1;
}

function parseRestoreCommandArgs(args: string[]): ParsedRestoreCommandArgs {
  try {
    return parseRestoreArgs(args);
  } catch (err) {
    handleError(err);
  }
}

function validateRestoreCommandArgs(parsed: ParsedRestoreCommandArgs): void {
  if (parsed.positional.length !== 1) {
    die(restoreUsage());
  }
}

function restoreUsage(): string {
  return (
    "usage: machinen restore <snap-dir> [--image <tarball>] [--name <name>] " +
    "[--lazy] [-p <hostPort>:<guestPort>] " +
    "[--mount-live <host>:<guest>[:<mode>]]\n" +
    "       machinen restore <node-level5-proof-bundle> " +
    "[--allow-proof-only-success] [--json]\n" +
    "       machinen restore node-level5 --experimental-node-level5 <manifest> [--json]"
  );
}

function isNodeLevel5ProofCompositionBundle(snapDir: string): boolean {
  return detectLevel5RestoreAdapter(snapDir) !== undefined;
}

async function cmdRestoreNodeLevel5ProofComposition(
  snapDir: string,
  json: boolean,
  parsed: ParsedRestoreCommandArgs,
): Promise<number> {
  const result = await restoreLevel5RuntimeBundle(snapDir, {
    verifyProofOnly: parsed.verifyProofOnly,
    allowProofOnlySuccess: parsed.allowProofOnlySuccess,
    targetRestore: {
      name: parsed.name,
      portForward: parsed.portForward,
      resolveCliBaseAssets,
      deriveBootName,
      shellQuote,
    },
  });
  if (json) {
    emitJson({ schema_version: 1, ...result.summary });
  } else {
    const targetProof = result.summary.targetProof;
    process.stderr.write(
      `Node Level 5 proof verifier: ${targetProof.status}; target-native Node continuation observed=${targetProof.targetVerifierObservedActualNodeContinuation}; noSourceIsaEmulation=${targetProof.noSourceIsaEmulation}; noSidecarOutput=${targetProof.noSidecarOutput}; noMetadataOnlySuccess=${targetProof.noMetadataOnlySuccess}\n`,
    );
    if (result.summary.refusal) {
      process.stderr.write(`${result.summary.refusal.message}\n`);
    } else {
      process.stderr.write(
        "Node Level 5 HTTP profile restore completed selected state continuation\n",
      );
    }
  }
  return result.exitCode;
}

function shouldPreferVmstateRestore(snapDir: string): boolean {
  if (!existsSync(join(snapDir, "state.vmstate"))) {
    return false;
  }
  const manifestPath = join(snapDir, "portable-node.json");
  if (!existsSync(manifestPath)) {
    return true;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PortableNodeSnapshotBundle;
  return manifest.sourceArch === guestCpu();
}

function shouldRestorePortableNode(snapDir: string): boolean {
  const manifestPath = join(snapDir, "portable-node.json");
  if (!existsSync(manifestPath)) {
    return false;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PortableNodeSnapshotBundle;
  return manifest.sourceArch !== guestCpu() || !existsSync(join(snapDir, "state.vmstate"));
}

// fallow-ignore-next-line complexity
async function cmdRestorePortableNode(
  parsed: ParsedRestoreCommandArgs,
  snapDir: string,
  json: boolean,
): Promise<number> {
  const started = Date.now();
  const manifest = JSON.parse(
    readFileSync(join(snapDir, "portable-node.json"), "utf8"),
  ) as PortableNodeSnapshotBundle;
  if (manifest.sourceArch === guestCpu()) {
    return reportPortableNodeRestoreRefusal(
      snapDir,
      json,
      manifest,
      "node-target-architecture-mismatch",
      "portable Node restore requires a destination architecture different from the source architecture; use vmstate restore for same-architecture bundles",
      started,
    );
  }
  const appTarPath = join(snapDir, manifest.appTar.path);
  const appTar = readFileSync(appTarPath);
  if (sha256Bytes(appTar) !== manifest.appTar.sha256) {
    return reportPortableNodeRestoreRefusal(
      snapDir,
      json,
      manifest,
      "node-portable-app-digest-mismatch",
      "portable Node app tarball digest does not match descriptor",
      started,
    );
  }
  const paths = await resolveCliBaseAssets();
  const name = parsed.name ?? deriveBootName(snapDir);
  const vm = await boot({
    image: paths.defaultImagePath,
    kernel: paths.kernelPath,
    dtb: paths.dtbPath,
    name,
    detached: true,
    cmd: ["sleep", "100000"],
    timeoutMs: undefined,
  }).catch(handleError);
  try {
    await vm.exec(
      "export DEBIAN_FRONTEND=noninteractive; " +
        "if ! command -v node >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends nodejs curl ca-certificates; fi",
      { execTimeoutMs: 180_000 },
    );
    const targetNode = await vm.execRaw("node --version", { execTimeoutMs: 5_000 });
    if (targetNode.exitCode !== 0 || targetNode.stdout.trim() !== manifest.nodeVersion) {
      return reportPortableNodeRestoreRefusal(
        snapDir,
        json,
        manifest,
        "node-source-target-version-mismatch",
        `source Node ${manifest.nodeVersion} does not match target Node ${targetNode.stdout.trim() || "unavailable"}`,
        started,
      );
    }
    await vm.writeFile("/tmp/machinen-portable-node-app.tar.gz", appTar);
    await vm.exec(
      "rm -rf /opt/machinen-portable-node-app && mkdir -p /opt/machinen-portable-node-app && tar -xzf /tmp/machinen-portable-node-app.tar.gz -C /opt/machinen-portable-node-app",
    );
    await vm.exec(startPortableNodeCommand(manifest), { execTimeoutMs: 15_000 });
    const verify = await vm.execRaw(verifyPortableNodeCommand(manifest), { execTimeoutMs: 30_000 });
    if (verify.exitCode !== 0) {
      return reportPortableNodeRestoreRefusal(
        snapDir,
        json,
        manifest,
        "node-target-verifier-mismatch",
        verify.stderr || verify.stdout || "target verifier failed",
        started,
      );
    }
    const summary = portableNodeRestoreSummary(manifest, "completed", started, {
      migrationCompleted: true,
      targetVerifierResult: "passed",
      restoredName: vm.name ?? name,
    });
    // fallow-ignore-next-line code-duplication
    writeFileSync(
      join(snapDir, "portable-node-restore-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    if (json) {
      emitJson({ schema_version: 1, ...summary });
    } else {
      process.stderr.write(`restored portable Node as: ${vm.name ?? name} (pid ${vm.pid})\n`);
    }
    return 0;
  } finally {
    await vm.detach();
  }
}

function startPortableNodeCommand(manifest: PortableNodeSnapshotBundle): string {
  const nodeIndex = manifest.argv.findIndex((arg) => /(^|\/)node(?:$|[0-9.-])/u.test(arg));
  const nodeArgs = manifest.argv
    .slice(nodeIndex + 1)
    .map(shellQuote)
    .join(" ");
  return `cd /opt/machinen-portable-node-app && nohup node ${nodeArgs} >/tmp/machinen-portable-node.log 2>&1 &`;
}

function verifyPortableNodeCommand(manifest: PortableNodeSnapshotBundle): string {
  return `for i in $(seq 1 80); do got=$(curl -fsS http://127.0.0.1:${manifest.guestPort}/ 2>/dev/null | sha256sum | awk '{print $1}') && test "$got" = ${shellQuote(manifest.verifier.sha256)} && exit 0; sleep 0.25; done; cat /tmp/machinen-portable-node.log 2>/dev/null; exit 1`;
}

function reportPortableNodeRestoreRefusal(
  snapDir: string,
  json: boolean,
  manifest: PortableNodeSnapshotBundle,
  code: string,
  message: string,
  started: number,
): number {
  const summary = portableNodeRestoreSummary(manifest, "refused", started, {
    migrationCompleted: false,
    targetVerifierResult: "failed",
    refusal: { code, message },
  });
  // fallow-ignore-next-line code-duplication
  writeFileSync(
    join(snapDir, "portable-node-restore-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  if (json) {
    emitJson({ schema_version: 1, ...summary });
  } else {
    process.stderr.write(`refused portable Node restore: ${code}: ${message}\n`);
  }
  return 1;
}

function portableNodeRestoreSummary(
  manifest: PortableNodeSnapshotBundle,
  state: "completed" | "refused",
  started: number,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    kind: "machinen.portable-node-restore-summary",
    formatVersion: 1,
    runtime: "node",
    subset: manifest.subset,
    state,
    sourceArch: manifest.sourceArch,
    targetArch: guestCpu(),
    elapsedMs: Date.now() - started,
    sourceIsaEmulationUsed: false,
    sourceTextReplayAcceptedAsRestore: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
    ...extra,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function createRestoreQuietState(parsed: ParsedRestoreCommandArgs, snapDir: string): QuietRunState {
  const headlineName = parsed.name ?? deriveBootName(snapDir);
  const buffer = new RingBuffer();
  if (!isQuiet()) {
    return { headlineName, showHeadlines: false, buffer, filter: null, filterOut: null };
  }
  printHeadline(`restoring ${headlineName}…`);
  return restoreFilteredQuietState(headlineName, buffer, Date.now());
}

function restoreFilteredQuietState(
  headlineName: string,
  buffer: RingBuffer,
  restoreT0: number,
): QuietRunState {
  // onReady fires on the first non-noise line — typically the
  // restored workload's first stdout/stderr write. We print the
  // "restored" headline there so timing is wall-clock honest.
  const filter = new NoiseFilter({
    buffer,
    out: process.stderr,
    onReady: () => {
      printHeadline(`restored in ${formatElapsed(Date.now() - restoreT0)}`);
    },
  });
  return {
    headlineName,
    showHeadlines: true,
    buffer,
    filter,
    filterOut: null,
    onLog: guestConsoleOnLog((chunk) => filter.push(chunk)),
  };
}

async function startRestoreVm(
  parsed: ParsedRestoreCommandArgs,
  snapDir: string,
  paths: CliBaseAssetPaths,
  quiet: QuietRunState,
): Promise<VmHandle> {
  try {
    return await restore({
      snapDir,
      image: resolveOptionalImageOverride(parsed.image),
      kernel: paths.kernelPath,
      dtb: paths.dtbPath,
      name: parsed.name,
      lazy: parsed.lazy,
      portForward: optionalList(parsed.portForward),
      // #273: per-guest overrides for the bundle's recorded
      // liveMounts. Empty list = use the bundle's recorded mounts
      // verbatim; non-empty entries replace the matching guest's
      // host/mode (BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN if no match).
      liveMounts: optionalList(parsed.liveMounts),
      timeoutMs: null,
      onLog: quiet.onLog,
    });
  } catch (err) {
    handleRestoreFailure(err, quiet);
  }
}

function optionalList<T>(items: T[]): T[] | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return items;
}

// fallow-ignore-next-line code-duplication
function handleRestoreFailure(err: unknown, quiet: QuietRunState): never {
  quiet.filter?.flush();
  if (quiet.showHeadlines) {
    failQuiet(`restore ${quiet.headlineName} failed: ${describeError(err)}`, {
      buffer: quiet.buffer,
    });
  }
  handleError(err);
}

function reportRestoreSuccess(vm: VmHandle, quiet: QuietRunState): void {
  if (!quiet.showHeadlines) {
    process.stderr.write(`restored as: ${vm.name ?? "<anonymous>"} (pid ${vm.pid})\n`);
  }
}

function runRestoreAttachedSession(vm: VmHandle, quiet: QuietRunState): Promise<number> {
  return runAttachedVmSession(vm, {
    filter: quiet.filter,
    buffer: quiet.buffer,
    preReadyExitSummary: (code) =>
      `restore ${quiet.headlineName} exited ${code} before reaching ready`,
  });
}

async function cmdSnapshot(args: string[]): Promise<number> {
  if (isNodeLevel5HostPidHarnessSnapshotCommand(args)) {
    return cmdSnapshotNodeLevel5HostPidHarness(args);
  }
  const opts = parseSnapshotOptions(args);
  if (opts.dryRun) {
    return snapshotDryRun(opts);
  }
  return runSnapshot(opts);
}

function isNodeLevel5HostPidHarnessSnapshotCommand(args: string[]): boolean {
  return allowNodeLevel5HostPidHarnessTarget() && isNodeLevel5HostPidHarnessShape(args);
}

function isNodeLevel5HostPidHarnessShape(args: string[]): boolean {
  return args[0] === "node" && isDigitsOnly(args[1]) && args.includes("--out");
}

function isDigitsOnly(value: string | undefined): boolean {
  return /^[0-9]+$/.test(value ?? "");
}

async function cmdSnapshotNodeLevel5HostPidHarness(args: string[]): Promise<number> {
  const { json, rest } = consumeJsonFlag(args);
  const options = requireNodeLevel5HostPidHarnessOptions(rest.filter((arg) => arg !== "node"));
  return runNodeLevel5HostPidHarnessSnapshot({ ...options, target: options.target }, json);
}

function requireNodeLevel5HostPidHarnessOptions(
  args: string[],
): RequiredNodeLevel5SnapshotOptions & { target: { pid: number } } {
  const options = parseNodeLevel5ProductSnapshotArgs(args);
  if (!options.out || !options.target || !("pid" in options.target)) {
    die(
      "usage: MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT=1 machinen snapshot node <host-pid> --out <dir> [--json]",
    );
  }
  return { out: options.out, target: options.target };
}

function runNodeLevel5HostPidHarnessSnapshot(
  options: RequiredNodeLevel5SnapshotOptions & { target: { pid: number } },
  json: boolean,
): number {
  if (!allowNodeLevel5HostPidHarnessTarget()) {
    die("usage: machinen snapshot <vm-name> --out <dir> [--json]");
  }
  return reportNodeLevel5ProductSnapshot(
    createNodeLevel5ProductSnapshot({
      outDir: resolve(options.out),
      target: resolveNodeLevel5ProductSnapshotTarget(options.target),
      direction: nodeLevel5ProductSnapshotDirectionOverride(),
    }),
    json,
  );
}

function allowNodeLevel5HostPidHarnessTarget(): boolean {
  // Diagnostic/release-corpus harness only. The public product surface is
  // `machinen snapshot <vm-name> --out <dir>` and detects Node inside the VM.
  return process.env.MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT === "1";
}

function nodeLevel5ProductSnapshotDirectionOverride():
  | NodeLevel5ProductSnapshotDirection
  | undefined {
  const direction = process.env.MACHINEN_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION;
  if (!direction) {
    return undefined;
  }
  if (direction === "arm64-to-amd64" || direction === "amd64-to-arm64") {
    return direction;
  }
  die(
    "invalid MACHINEN_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION; expected arm64-to-amd64 or amd64-to-arm64",
  );
}

function reportNodeLevel5ProductSnapshot(
  summary: ReturnType<typeof createNodeLevel5ProductSnapshot>,
  json: boolean,
): number {
  if (json) {
    emitJson(summary);
    return summary.accepted ? 0 : 1;
  }
  writeNodeLevel5ProductSnapshotHumanSummary(summary);
  return summary.accepted ? 0 : 1;
}

function writeNodeLevel5ProductSnapshotHumanSummary(
  summary: ReturnType<typeof createNodeLevel5ProductSnapshot>,
): void {
  if (summary.accepted) {
    process.stdout.write(`snapshot written: ${summary.snapshotDir}\n`);
    return;
  }
  process.stderr.write(`machinen snapshot: ${summary.refusal?.message}\n`);
}

function parseNodeLevel5ProductSnapshotArgs(args: string[]): NodeLevel5ProductSnapshotCliOptions {
  const outFlag = args.indexOf("--out");
  if (outFlag === -1) {
    return parseNodeLevel5ProductSnapshotTargetOnly(args);
  }
  const out = takeCaptureValue(args, outFlag + 1, "--out");
  const positional = args.filter((_, index) => index !== outFlag && index !== outFlag + 1);
  return { out, target: parseNodeLevel5ProductSnapshotTargetOnly(positional).target };
}

function parseNodeLevel5ProductSnapshotTargetOnly(
  args: string[],
): Pick<NodeLevel5ProductSnapshotCliOptions, "target"> {
  if (args.length === 0) {
    return {};
  }
  if (args.length > 1) {
    die(`unknown snapshot host-pid harness argument: ${args[1]}`);
  }
  return { target: /^[0-9]+$/.test(args[0]!) ? { pid: Number(args[0]) } : { name: args[0]! } };
}

function resolveNodeLevel5ProductSnapshotTarget(target: Target) {
  const entry = lookupEntry(target);
  const pid = nodeLevel5ProductSnapshotTargetPid(target, entry);
  return {
    target: nodeLevel5ProductSnapshotTargetName(target),
    targetKind: nodeLevel5ProductSnapshotTargetKind(target),
    pid,
    registryMatched: Boolean(entry),
    ...nodeLevel5ProductSnapshotTargetEvidence(pid),
  };
}

function nodeLevel5ProductSnapshotTargetEvidence(
  pid: number | undefined,
): NodeLevel5ProductSnapshotTargetMetadata {
  if (!pid) {
    return { runtime: "unknown" };
  }
  return inspectNodeLevel5ProductSnapshotPid(pid);
}

function nodeLevel5ProductSnapshotTargetName(target: Target): string {
  return "name" in target ? target.name : String(target.pid);
}

function nodeLevel5ProductSnapshotTargetKind(target: Target): "name" | "pid" {
  return "name" in target ? "name" : "pid";
}

function nodeLevel5ProductSnapshotTargetPid(
  target: Target,
  entry: RegistryEntry | undefined,
): number | undefined {
  return "pid" in target ? target.pid : entry?.pid;
}

function inspectNodeLevel5ProductSnapshotPid(pid: number): NodeLevel5ProductSnapshotTargetMetadata {
  const executable = readProcessField(pid, "comm");
  const argv = readProcessField(pid, "args");
  return {
    runtime: isNodeLevel5ProductSnapshotNodeProcess(executable, argv) ? "node" : "unknown",
    appDir: readProcessCwd(pid),
    pid,
    executable,
    argv,
  };
}

function readProcessField(pid: number, field: "comm" | "args"): string | undefined {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", `${field}=`], {
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
}

function readProcessCwd(pid: number): string | undefined {
  try {
    const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
    });
    return output
      .split("\n")
      .find((line) => line.startsWith("n"))
      ?.slice(1);
  } catch {
    return undefined;
  }
}

function isNodeLevel5ProductSnapshotNodeProcess(
  executable: string | undefined,
  argv: string | undefined,
): boolean {
  return /(^|\/)node(?:$|\s)/u.test(executable ?? "") || /(^|\s)node(?:$|\s)/u.test(argv ?? "");
}

interface SnapshotOptionsCli {
  json: boolean;
  dryRun: boolean;
  keepAlive: boolean;
  target: Target;
  outDir: string;
  resolvedOutDir: string;
}

function parseSnapshotOptions(args: string[]): SnapshotOptionsCli {
  // Forms: `machinen snapshot <target> <out-dir>` and
  // `machinen snapshot <target> --out <dir>`. We strip --json /
  // --dry-run / --keep-alive first; the first positional left is the target.
  const { json, rest: afterJson } = consumeJsonFlag(args);
  const { dryRun, rest: afterDry } = consumeDryRunFlag(afterJson);
  const { keepAlive, rest: afterKeepAlive } = consumeKeepAliveFlag(afterDry);
  const { outDir: flaggedOutDir, rest } = consumeSnapshotOutFlag(afterKeepAlive);
  const { target, rest: afterTarget } = resolveTarget(rest, "snapshot");
  const outDir = parseSnapshotOutDir(afterTarget, flaggedOutDir);
  return { json, dryRun, keepAlive, target, outDir, resolvedOutDir: resolve(outDir) };
}

function consumeKeepAliveFlag(args: string[]): { keepAlive: boolean; rest: string[] } {
  const rest: string[] = [];
  let keepAlive = false;
  for (const arg of args) {
    if (arg === "--keep-alive") {
      keepAlive = true;
    } else {
      rest.push(arg);
    }
  }
  return { keepAlive, rest };
}

function consumeSnapshotOutFlag(args: string[]): { outDir: string | undefined; rest: string[] } {
  const outFlag = args.indexOf("--out");
  if (outFlag === -1) {
    return { outDir: undefined, rest: args };
  }
  const outDir = takeCaptureValue(args, outFlag + 1, "--out");
  const rest = args.filter((_, index) => index !== outFlag && index !== outFlag + 1);
  return { outDir, rest };
}

function parseSnapshotOutDir(args: string[], flaggedOutDir?: string): string {
  return flaggedOutDir
    ? parseFlaggedSnapshotOutDir(args, flaggedOutDir)
    : parsePositionalSnapshotOutDir(args);
}

function parseFlaggedSnapshotOutDir(args: string[], flaggedOutDir: string): string {
  if (args.length > 0) {
    die(`unknown argument: ${args[0]}`);
  }
  return flaggedOutDir;
}

function parsePositionalSnapshotOutDir(args: string[]): string {
  if (args.length === 0) {
    die(snapshotUsage());
  }
  if (args.length > 1) {
    die(`unknown argument: ${args[1]}`);
  }
  return args[0]!;
}

function snapshotUsage(): string {
  return (
    "usage: machinen snapshot <name|pid> <out-dir> [--keep-alive] [--dry-run] [--json]\n" +
    "       machinen snapshot <name|pid> --out <dir> [--keep-alive] [--dry-run] [--json]"
  );
}

function snapshotDryRun(opts: SnapshotOptionsCli): number {
  // Validate target exists + out-dir is creatable (parent must exist
  // and be writable). Don't actually freeze the source.
  const entry = lookupEntry(opts.target);
  if (!entry) {
    reportSnapshotMissingTarget(opts);
    return 1;
  }
  reportSnapshotDryRun(entry, opts);
  return 0;
}

function reportSnapshotMissingTarget(opts: SnapshotOptionsCli): void {
  const msg = `no running VM matched ${describeTarget(opts.target)}`;
  if (opts.json) {
    emitJsonError("VM_NOT_FOUND", msg);
  } else {
    process.stderr.write(`machinen snapshot: ${msg}\n`);
  }
}

function reportSnapshotDryRun(entry: RegistryEntry, opts: SnapshotOptionsCli): void {
  if (opts.json) {
    emitSnapshotJson(opts.resolvedOutDir, 0, true);
    return;
  }
  const suffix = opts.keepAlive ? " (--keep-alive)\n" : "\n";
  process.stdout.write(`would snapshot ${entryLabel(entry)} → ${opts.resolvedOutDir}${suffix}`);
}

// fallow-ignore-next-line complexity
async function runSnapshot(opts: SnapshotOptionsCli): Promise<number> {
  const entry = lookupEntry(opts.target);
  const vm = await attach(opts.target).catch(handleError);
  const quiet = createSnapshotQuietState(vm, opts);
  try {
    const adapterOpts = { guestCpu, sha256Bytes };
    const portableNode = await inspectPortableNodeVm(vm, entry, adapterOpts);
    const cleanService = portableNode
      ? cleanServiceFromNode(portableNode)
      : ((await inspectPortablePythonVm(vm, entry, adapterOpts)) ??
        (await inspectPortableGoVm(vm, entry, adapterOpts)));
    const res = await vm.snapshot({
      outDir: opts.resolvedOutDir,
      leaveRunning: opts.keepAlive,
      tcpClose: opts.keepAlive,
      onLog: snapshotOnLog(quiet),
    });
    if (cleanService) {
      writeCleanServiceSnapshot(res.snapDir, cleanService);
    }
    if (portableNode) {
      writePortableNodeSnapshot(res.snapDir, portableNode);
      writeNodeLevel5ProofCompositionSnapshot(res.snapDir, portableNode);
      writeNodeLevel5RuntimeProfileSnapshot(res.snapDir, portableNode);
    }
    reportSnapshotSuccess(res.snapDir, res.elapsedMs, opts);
    return 0;
  } catch (err) {
    handleSnapshotFailure(err, quiet);
  } finally {
    await vm.detach();
  }
}

function createSnapshotQuietState(vm: VmHandle, opts: SnapshotOptionsCli): QuietRunState {
  // #286: quiet snapshot UX. Snapshot's onLog stream is the CRIU
  // dump-side chatter (machinen-dump.sh + criu's per-phase progress).
  const headlineName = vm.name ?? `pid ${vm.pid}`;
  const showHeadlines = isQuiet() && !opts.json;
  const buffer = new RingBuffer();
  if (showHeadlines) {
    printHeadline(`snapshotting ${headlineName}…`);
  }
  return { headlineName, showHeadlines, buffer, filter: null, filterOut: null };
}

function snapshotOnLog(quiet: QuietRunState): (evt: LogEvent) => void {
  return (evt) => {
    if (evt.source === "phase") {
      return;
    }
    if (quiet.showHeadlines) {
      quiet.buffer.push(evt.chunk);
    } else {
      process.stderr.write(evt.chunk);
    }
  };
}

function writeCleanServiceSnapshot(snapDir: string, bundle: CleanServiceCapture): void {
  const { artifactBytesByPath, ...manifest } = bundle;
  for (const [artifactPath, bytes] of Object.entries(artifactBytesByPath)) {
    writeFileSync(join(snapDir, artifactPath), bytes);
  }
  writeFileSync(
    join(snapDir, "portable-clean-service.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeCleanServiceMeta(snapDir, manifest);
}

function writeCleanServiceMeta(snapDir: string, manifest: CleanServiceManifest): void {
  const metaPath = join(snapDir, "meta.json");
  if (!existsSync(metaPath)) {
    return;
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
  meta.portable = {
    formatVersion: manifest.formatVersion,
    contract: "machinen.clean-service-v1",
    sourceArchitecture: manifest.sourceArch,
    crossArchitectureRoutePolicy: manifest.routePolicy,
    components: manifest.components.map((component) => ({
      id: component.id,
      runtime: component.runtime,
      subset: component.subset,
      detected: true,
      captured: true,
      refused: false,
      provenance: component.provenance,
      integrity: {
        artifactSha256: component.artifact.sha256,
        artifactPath: component.artifact.path,
      },
      verifier: component.verifier,
      kernelResources: component.kernelResources,
      refusalSemantics: {
        migrationCompleted: false,
        stableCodes: cleanServiceStableRefusalCodes(),
      },
    })),
    security: manifest.security,
  };
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
}

function writePortableNodeSnapshot(snapDir: string, bundle: PortableNodeSnapshotCapture): void {
  const { appTarBytes, ...manifest } = bundle;
  writeFileSync(join(snapDir, "portable-node-app.tar.gz"), appTarBytes);
  writeFileSync(join(snapDir, "portable-node.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const metaPath = join(snapDir, "meta.json");
  if (existsSync(metaPath) && !existsSync(join(snapDir, "portable-clean-service.json"))) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    meta.portable = {
      formatVersion: 1,
      sourceArchitecture: manifest.sourceArch,
      crossArchitectureRoutePolicy: "portable-components-when-target-arch-differs",
      components: [
        {
          id: "nodejs:primary-http-service",
          runtime: "nodejs",
          subset: manifest.subset,
          detected: true,
          captured: true,
          refused: false,
          provenance: { sourceCwd: manifest.sourceCwd, argv: manifest.argv },
          integrity: { appTarSha256: manifest.appTar.sha256 },
          verifier: manifest.verifier,
          refusalSemantics: {
            migrationCompleted: false,
            stableCodes: [
              "node-inspector-session-unsupported",
              "node-child-process-tree-unsupported",
              "node-native-addon-abi-state-unsupported",
              "node-host-mounted-state-ambiguous",
              "node-active-tcp-session-unsupported",
              "node-target-verifier-missing",
            ],
          },
        },
      ],
    };
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  }
}

function reportSnapshotSuccess(snapDir: string, elapsedMs: number, opts: SnapshotOptionsCli): void {
  if (opts.json) {
    emitSnapshotJson(snapDir, elapsedMs, false);
    return;
  }
  process.stdout.write(`snapshot: ${snapDir} (${elapsedMs}ms)\n`);
}

function emitSnapshotJson(snapDir: string, elapsedMs: number, dryRun: boolean): void {
  emitJson({ schema_version: 1, snap_dir: snapDir, elapsed_ms: elapsedMs, dry_run: dryRun });
}

function handleSnapshotFailure(err: unknown, quiet: QuietRunState): never {
  if (quiet.showHeadlines) {
    failQuiet(`snapshot ${quiet.headlineName} failed: ${describeError(err)}`, {
      buffer: quiet.buffer,
    });
  }
  handleError(err);
}

type ParsedForkCommandArgs = ReturnType<typeof parseForkArgs>;

async function cmdFork(args: string[]): Promise<number> {
  const opts = await prepareForkCommand(args);
  const vm = await attach(opts.target).catch(handleError);
  try {
    const fork = await startForkVm(vm, opts);
    reportForkStarted(fork, opts);
    if (opts.parsed.detach) {
      return detachFork(fork, opts);
    }
    return runForkAttachedSession(fork, opts.quiet);
  } catch (err) {
    handleError(err);
  } finally {
    await vm.detach();
  }
}

interface ForkCommandOptions {
  json: boolean;
  target: Target;
  parsed: ParsedForkCommandArgs;
  paths: CliBaseAssetPaths;
  resolvedOutDir: string;
  quiet: QuietRunState;
}

async function prepareForkCommand(args: string[]): Promise<ForkCommandOptions> {
  const { json, rest } = consumeJsonFlag(args);
  const parsed = parseForkCommandArgs(rest);
  const target = parseTargetFlags(parsed.rest, "fork");
  validateForkCommand(json, parsed);
  const paths = await resolveCliBaseAssets();
  const resolvedOutDir = resolveForkOutDir(parsed.outDir);
  return {
    json,
    target,
    parsed,
    paths,
    resolvedOutDir,
    quiet: createForkQuietState(json, parsed, target),
  };
}

function parseForkCommandArgs(args: string[]): ParsedForkCommandArgs {
  try {
    return parseForkArgs(args);
  } catch (err) {
    handleError(err);
  }
}

function validateForkCommand(json: boolean, parsed: ParsedForkCommandArgs): void {
  if (json && !parsed.detach) {
    die("fork --json is only meaningful with --detach (attached forks take over stdio).");
  }
}

function resolveForkOutDir(outDir: string | undefined): string {
  // The runtime's ephemeral-bundle cleanup hangs off `fork.wait()`,
  // which the CLI can't await — `cmdFork` returns as soon as the
  // fork is registered. So the CLI always materializes an explicit
  // outDir (caller-supplied or a temp dir we print) and skips the
  // runtime's ephemeral mode.
  if (outDir) {
    return resolve(outDir);
  }
  return mkdtempSync(join(tmpdir(), "machinen-fork-"));
}

function createForkQuietState(
  json: boolean,
  parsed: ParsedForkCommandArgs,
  target: Target,
): QuietRunState {
  const sourceLabel = describeForkSource(target);
  const headlineName = parsed.newName ?? sourceLabel;
  const buffer = new RingBuffer();
  if (!shouldShowForkHeadlines(json, parsed)) {
    return forkOperatorQuietState(headlineName, buffer);
  }
  return createVisibleForkQuietState(parsed, sourceLabel, headlineName, buffer);
}

function shouldShowForkHeadlines(json: boolean, parsed: ParsedForkCommandArgs): boolean {
  if (!isQuiet()) {
    return false;
  }
  if (parsed.detach && json) {
    return false;
  }
  return true;
}

function createVisibleForkQuietState(
  parsed: ParsedForkCommandArgs,
  sourceLabel: string,
  headlineName: string,
  buffer: RingBuffer,
): QuietRunState {
  printHeadline(`forking ${sourceLabel} → ${headlineName}…`);
  if (parsed.detach) {
    return bootBufferOnlyQuietState(headlineName, true, buffer);
  }
  return forkFilteredQuietState(headlineName, true, buffer, Date.now());
}

function describeForkSource(target: Target): string {
  return "name" in target ? target.name : `pid ${target.pid}`;
}

function forkOperatorQuietState(headlineName: string, buffer: RingBuffer): QuietRunState {
  return {
    headlineName,
    showHeadlines: false,
    buffer,
    filter: null,
    filterOut: null,
    onLog: operatorForkOnLog,
  };
}

function operatorForkOnLog(evt: LogEvent): void {
  // Operator mode: legacy live-stream of every non-phase chunk (the
  // runtime emits phase events too — those are timing metadata, not
  // console output, so they're filtered out).
  if (evt.source !== "phase") {
    process.stderr.write(evt.chunk);
  }
}

function forkFilteredQuietState(
  headlineName: string,
  showHeadlines: boolean,
  buffer: RingBuffer,
  forkT0: number,
): QuietRunState {
  const filter = new NoiseFilter({
    buffer,
    out: process.stderr,
    onReady: () => {
      printHeadline(`fork ready in ${formatElapsed(Date.now() - forkT0)}`);
    },
  });
  return {
    headlineName,
    showHeadlines,
    buffer,
    filter,
    filterOut: null,
    onLog: guestConsoleOnLog((chunk) => filter.push(chunk)),
  };
}

async function startForkVm(vm: VmHandle, opts: ForkCommandOptions): Promise<VmHandle> {
  try {
    return await vm.fork({
      name: opts.parsed.newName,
      outDir: opts.resolvedOutDir,
      image: opts.paths.defaultImagePath,
      kernel: opts.paths.kernelPath,
      dtb: opts.paths.dtbPath,
      tcpKeep: opts.parsed.tcpKeep,
      lazy: opts.parsed.lazy,
      portForward: optionalList(opts.parsed.portForward),
      mount: opts.parsed.mount,
      liveMounts: opts.parsed.liveMounts,
      env: opts.parsed.env,
      guestCwd: opts.parsed.guestCwd,
      memory: opts.parsed.memory,
      onLog: opts.quiet.onLog,
    });
  } catch (err) {
    handleForkFailure(err, opts.quiet);
  }
}

// fallow-ignore-next-line code-duplication
function handleForkFailure(err: unknown, quiet: QuietRunState): never {
  quiet.filter?.flush();
  if (quiet.showHeadlines) {
    failQuiet(`fork ${quiet.headlineName} failed: ${describeError(err)}`, {
      buffer: quiet.buffer,
    });
  }
  handleError(err);
}

function reportForkStarted(fork: VmHandle, opts: ForkCommandOptions): void {
  if (!shouldPrintForkStarted(opts)) {
    return;
  }
  process.stderr.write(`forked: ${fork.name ?? "<anonymous>"} (pid ${fork.pid})\n`);
  printForkBundleHint(opts);
}

function shouldPrintForkStarted(opts: ForkCommandOptions): boolean {
  if (opts.quiet.showHeadlines) {
    return false;
  }
  return !opts.json;
}

function printForkBundleHint(opts: ForkCommandOptions): void {
  if (!opts.parsed.outDir) {
    process.stderr.write(`bundle: ${opts.resolvedOutDir} (rm -rf when the fork exits)\n`);
  }
}

async function detachFork(fork: VmHandle, opts: ForkCommandOptions): Promise<number> {
  // Fire-and-forget: hand the fork off to its own VMM process
  // (boot was spawned with pdeathsig=false so it survives this CLI exit) and return.
  await fork.detach();
  if (opts.json) {
    emitJson({
      schema_version: 1,
      pid: fork.pid,
      name: fork.name ?? null,
      source: describeForkSource(opts.target),
      bundle_dir: opts.resolvedOutDir,
      ephemeral: !opts.parsed.outDir,
    });
  }
  return 0;
}

async function runForkAttachedSession(fork: VmHandle, quiet: QuietRunState): Promise<number> {
  const cancelPromptNudge = scheduleForkPromptNudge(fork);
  try {
    return await runAttachedVmSession(fork, {
      filter: quiet.filter,
      buffer: quiet.buffer,
      preReadyExitSummary: (code) =>
        `fork ${quiet.headlineName} exited ${code} before reaching ready`,
    });
  } finally {
    cancelPromptNudge();
  }
}

function scheduleForkPromptNudge(fork: VmHandle): () => void {
  // The source shell printed PS1 to the source's tty before the dump,
  // so the restored shell starts up sitting in read() without redrawing.
  const promptNudge = setTimeout(() => tryWriteForkPromptNudge(fork), 1500);
  promptNudge.unref();
  return () => clearTimeout(promptNudge);
}

function tryWriteForkPromptNudge(fork: VmHandle): void {
  try {
    fork.stdin.write("\r");
  } catch {
    // fork already exited / pipe closed — nothing to nudge.
  }
}

/**
 * Wrap the pure `extractTarget` parser with the CLI's error
 * formatting. Callers either use this directly (snapshot, which has a
 * second positional <out-dir>) or via the `parseTargetFlags` shim
 * (everyone else).
 */
function resolveTarget(args: string[], cmd: string): { target: Target; rest: string[] } {
  try {
    return extractTarget(args, cmd);
  } catch (err) {
    handleError(err);
  }
}

/**
 * Shim for callers that don't accept extra positionals. Errors on any
 * leftover args.
 */
function parseTargetFlags(args: string[], cmd: string): Target {
  const { target, rest } = resolveTarget(args, cmd);
  if (rest.length > 0) {
    die(`unknown argument: ${rest[0]}`);
  }
  return target;
}

function lookupEntry(target: { name: string } | { pid: number }): RegistryEntry | undefined {
  return list().find((entry) => entryMatchesTarget(entry, target));
}

function entryMatchesTarget(
  entry: RegistryEntry,
  target: { name: string } | { pid: number },
): boolean {
  if ("name" in target) {
    return entry.name === target.name;
  }
  return entry.pid === target.pid;
}

function describeTarget(target: { name: string } | { pid: number }): string {
  return "name" in target ? `name ${target.name}` : `pid ${target.pid}`;
}

function entryLabel(entry: RegistryEntry): string {
  return entry.name ? `${entry.name} (pid ${entry.pid})` : `pid ${entry.pid}`;
}

// ------------------------------------------------------------
// Arg helpers
// ------------------------------------------------------------

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) {
    return undefined;
  }
  return argv[i + 1];
}

function die(msg: string): never {
  process.stderr.write(`machinen: ${msg}\n`);
  process.exit(1);
}

/**
 * Unified error handler. MachinenError gets a formatted `(CODE): message`
 * + cause chain and an exit(1). Anything else re-throws so Node prints
 * the full stack — those are genuine surprises we want to see.
 *
 * In quiet mode (#286) the same line lands inside the caller's
 * `printDiagnostics()` envelope when the failure has a buffered tail
 * to dump. Callers route through `failQuiet()` in that case; this
 * stays the fall-through for everything else.
 */
function handleError(err: unknown): never {
  if (isMachinenError(err)) {
    process.stderr.write(`machinen: ${formatMachinenError(err)}\n`);
    process.exit(1);
  }
  throw err;
}

/**
 * Print a failure summary + diagnostics envelope and exit non-zero.
 * Used by boot/restore/fork/snapshot/install when a buffered tail of
 * suppressed output would otherwise be lost. In operator mode
 * (DEBUG=machinen:*) the envelope is a no-op — the user has already
 * seen the live stream — but the summary line still prints.
 */
function failQuiet(
  summary: string,
  opts: { buffer?: RingBuffer | string; tails?: Record<string, string> } = {},
): never {
  printDiagnostics(summary, opts);
  process.exit(1);
}

function describeError(err: unknown): string {
  if (isMachinenError(err)) {
    return formatMachinenError(err);
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Derive the headline name for a VM when `--name` wasn't passed.
 * Strips the tarball extensions (`.tar.gz`, `.tgz`, `.tar`) and any
 * directory components so `./counter.tar.gz` shows as `counter`.
 * Falls back to `vm` for image-less boots (e.g. `boot -- bash`).
 */
function deriveBootName(imageOverride: string | undefined): string {
  if (!imageOverride) {
    return "vm";
  }
  const base = imageOverride.split("/").pop() ?? imageOverride;
  return base
    .replace(/\.tar\.gz$/i, "")
    .replace(/\.tgz$/i, "")
    .replace(/\.tar$/i, "")
    .replace(/\.gz$/i, "");
}

function printHelp(): void {
  process.stdout.write(
    `machinen ${VERSION}\n` +
      `\n` +
      `Usage:\n` +
      `  machinen boot [opts] -- <cmd>                  Boot a microVM and run <cmd>\n` +
      `    --name <name>                                Register under a unique human name\n` +
      `                                                 (path-shaped allowed: 'a/b/c').\n` +
      `    --snapshot <path>                            Attach <path> as /dev/vda — scratch\n` +
      `                                                 disk for a future vm.snapshot().\n` +
      `    --mount <host-dir>:<guest-path>              Expose one host dir inside the guest\n` +
      `                                                 (path under /mnt/; copy-once).\n` +
      `    --mount-live <host-dir>:<guest-path>[:<mode>]\n` +
      `                                                 Live-share a host dir over FUSE.\n` +
      `                                                 Guest reads stream in on demand; no\n` +
      `                                                 copy at boot. mode is 'rw' (default,\n` +
      `                                                 write-through) or 'ro' (read-only).\n` +
      `    --env KEY=VALUE                              Set an env var inside the guest.\n` +
      `    --cwd <abs-path>                             Start the guest cmd in this directory\n` +
      `                                                 (must be absolute).\n` +
      `    --nested                                     Expose arm64 EL2 / /dev/kvm to the guest\n` +
      `                                                 when the host supports it.\n` +
      `    -p <hostPort>:<guestPort>                    Forward host:hostPort → guest:guestPort.\n` +
      `\n` +
      `  machinen move scan [--json]                  Scan host PID graph state classes.\n` +
      `  machinen move save <pid> <out> [--issue]     Write a move descriptor or refusal evidence.\n` +
      `  machinen move load <descriptor> [--json]     Validate a move descriptor fail-closed.\n` +
      `\n` +
      `  machinen support [--family <family>] [--status <status>] [--level <level>] [--json]\n` +
      `                                                 Discover product support/refusal level\n` +
      `                                                 status for every proof profile.\n` +
      `\n` +
      `  machinen restore <snap-dir> [--image <tar.gz>] [--name <name>] [-p ...]\n` +
      `                              [--mount-live <host>:<guest>[:<mode>]]\n` +
      `                                                 Restore a VM from a snapshot bundle.\n` +
      `                                                 Anonymous restores auto-name as\n` +
      `                                                 <source>/<pid>. Pass --image with the\n` +
      `                                                 same tarball used to boot the source VM\n` +
      `                                                 when the workload references files\n` +
      `                                                 outside the base rootfs (e.g. node).\n` +
      `                                                 -p <hostPort>:<guestPort> forwards a host\n` +
      `                                                 port into the restored VM; forwards are\n` +
      `                                                 NOT inherited from the source (host ports\n` +
      `                                                 are global), so pick host ports nothing\n` +
      `                                                 else is binding.\n` +
      `  machinen list  (alias: ls, ps)                 List running VMs (PID, NAME, UP,\n` +
      `                                                 PORTS, FORKED-FROM). Pass --json for\n` +
      `                                                 a structured payload on stdout.\n` +
      `\n` +
      `  Targeting a running VM:\n` +
      `    Pass the name or pid as the first positional arg.\n` +
      `    Digits-only is interpreted as a pid; everything else as a name.\n` +
      `\n` +
      `  machinen exec     <name|pid> [--tty] -- <cmd>\n` +
      `                                                 Run a command in a running VM. Pass\n` +
      `                                                 --tty for a real PTY session — needed\n` +
      `                                                 for an interactive shell, vim, htop,\n` +
      `                                                 or anything that wants job control.\n` +
      `                                                 Without --tty stdio is line-buffered\n` +
      `                                                 pipes (good for one-shot commands).\n` +
      `                                                 Example:\n` +
      `                                                   machinen exec <name|pid> --tty -- bash -i\n` +
      `  machinen snapshot <name|pid> <out-dir> [--keep-alive]\n` +
      `  machinen snapshot <name|pid> --out <dir> [--keep-alive]\n` +
      `                                                 Checkpoint a running VM into <d>.\n` +
      `                                                 Node workloads are detected inside the VM;\n` +
      `                                                 no Node-only snapshot selector is needed.\n` +
      `                                                 Default vmstate snapshots are incremental\n` +
      `                                                 and non-destructive. CRIU snapshots stay\n` +
      `                                                 non-incremental; --keep-alive leaves them\n` +
      `                                                 running and closes inherited TCP sockets.\n` +
      `  machinen fork     <name|pid> [--new-name <n>] [--out-dir <d>] [--tcp-keep] [--detach]\n` +
      `                    [-p ...] [--mount ...] [--mount-live ...] [--env KEY=VALUE]...\n` +
      `                    [--cwd <abs>] [--memory <mib>]\n` +
      `                                                 Snapshot the source live (it keeps\n` +
      `                                                 running) and restore into a sibling VM,\n` +
      `                                                 dropping the caller into the fork's\n` +
      `                                                 interactive console. Pass --detach to\n` +
      `                                                 hand the fork off and return immediately\n` +
      `                                                 (CI / scripted use).\n` +
      `                                                 Without --out-dir, the bundle is\n` +
      `                                                 ephemeral and removed when the fork exits.\n` +
      `                                                 -p <hostPort>:<guestPort> forwards a host\n` +
      `                                                 port into the fork; host forwards are NOT\n` +
      `                                                 inherited from the source (host ports are\n` +
      `                                                 global), so pick a host port the source\n` +
      `                                                 isn't already using.\n` +
      `                                                 The boot-shaped flags (--mount,\n` +
      `                                                 --mount-live, --env, --cwd, --memory)\n` +
      `                                                 take effect on the forked sibling, not\n` +
      `                                                 the source.\n` +
      `  machinen attach   <name|pid> [--shell <c>]    Drop into an interactive PTY shell\n` +
      `                                                 in the running VM (default \`bash -i\`).\n` +
      `                                                 \`cd\`, env vars, history, job control\n` +
      `                                                 and full-screen TUIs all work. Exit\n` +
      `                                                 the shell (Ctrl-D) to detach.\n` +
      `  machinen repl     <name|pid>                   Per-line exec REPL: each line is a\n` +
      `                                                 fresh one-shot \`exec\`, no persistent\n` +
      `                                                 state. Useful for piping a script of\n` +
      `                                                 one-liners; for an interactive shell\n` +
      `                                                 use \`machinen attach\` instead.\n` +
      `\n` +
      `  machinen install                               Pre-fetch the current-tag base assets\n` +
      `    --version <tag>                              Pin to a specific release tag\n` +
      `  machinen agent-context                         Versioned JSON describing every command,\n` +
      `                                                 flag, and exit code. Source-of-truth\n` +
      `                                                 for agent introspection.\n` +
      `  machinen feedback "<text>"                     Record a friction note locally\n` +
      `                                                 (~/.machinen/feedback.jsonl). With\n` +
      `                                                 MACHINEN_FEEDBACK_ENDPOINT set, also\n` +
      `                                                 POSTs upstream. \`--list\` prints recent\n` +
      `                                                 entries.\n` +
      `  machinen completion <shell>                    Emit shell completion (bash|zsh|fish)\n` +
      `  machinen --version | -h                        Print version / help\n` +
      `\n` +
      `Global flags:\n` +
      `  --json                                         Emit machine-readable JSON to stdout.\n` +
      `                                                 Supported on: list, gc, install,\n` +
      `                                                 snapshot, stop, fork --detach,\n` +
      `                                                 boot --detach, support, move, feedback,\n` +
      `                                                 agent-context.\n` +
      `  --dry-run                                      Preview a mutating command without\n` +
      `                                                 side effects. Supported on: gc, stop,\n` +
      `                                                 snapshot.\n` +
      `\n` +
      `Examples:\n` +
      `  machinen boot --name worker -- node server.js\n` +
      `  machinen ls\n` +
      `  machinen exec worker -- ps aux                       # one-off command\n` +
      `  machinen exec worker --tty -- bash -i                # interactive shell w/ job control\n` +
      `  machinen exec worker --tty -- vim /etc/passwd        # full-screen TUI in a PTY\n` +
      `  machinen snapshot worker ./warm                      # CRIU snapshot bundle\n` +
      `  machinen restore ./warm\n` +
      `  machinen move scan --json\n` +
      `  machinen move save 1234 ./move.json --issue\n` +
      `  machinen move load ./move.json --json\n` +
      `  machinen support --family network-ping-socket --json\n` +
      `\n` +
      `Environment:\n` +
      `  MACHINEN_VMM                             Override the VMM binary path (dev)\n` +
      `  MACHINEN_ASSETS_DIR                      Use base assets from this directory\n` +
      `                                           instead of the cache / GH Releases\n` +
      `  MACHINEN_GUEST_ARCH                      Guest asset arch: arm64 or amd64\n` +
      `  MACHINEN_SNAPSHOT_ENGINE                Snapshot engine: vmstate (default),\n` +
      `                                           criu, or portable (legacy portable routes\n` +
      `                                           refuse; use machinen move for cross-ISA)\n` +
      `  MACHINEN_REGISTRY_DIR                    Override registry location (default\n` +
      `                                           ~/.machinen/vms)\n` +
      `\n` +
      `Cache:\n` +
      `  ~/.machinen/<tag>/bases/debian-arm64/ or debian-amd64/\n`,
  );
}

// ------------------------------------------------------------
// Entry
// ------------------------------------------------------------

type CommandHandler = (args: string[]) => number | Promise<number>;

const COMMAND_HANDLERS = new Map<string, CommandHandler>([
  ["boot", cmdBoot],
  ["capture", cmdCapture],
  ["move", cmdMove],
  ["node-level5", cmdNodeLevel5],
  ["support", cmdSupport],
  ["restore", cmdRestore],
  ["install", cmdInstall],
  ["list", cmdLs],
  ["ls", cmdLs],
  ["ps", cmdLs],
  ["exec", cmdExec],
  ["snapshot", cmdSnapshot],
  ["fork", cmdFork],
  ["attach", cmdAttach],
  ["repl", cmdRepl],
  ["completion", cmdCompletion],
  ["gc", cmdGc],
  ["stop", cmdStop],
  ["feedback", cmdFeedback],
  ["agent-context", cmdAgentContext],
]);

async function main(): Promise<number> {
  const [sub, ...rest] = process.argv.slice(2);
  debug("dispatch sub=%s argc=%d", commandLabel(sub), rest.length);

  const topLevelCode = maybeHandleTopLevelCommand(sub);
  if (topLevelCode !== undefined) {
    return topLevelCode;
  }
  return dispatchSubcommand(sub!, rest);
}

function commandLabel(sub: string | undefined): string {
  if (sub === undefined) {
    return "<empty>";
  }
  return sub;
}

function maybeHandleTopLevelCommand(sub: string | undefined): number | undefined {
  const helpCode = maybePrintTopLevelHelp(sub);
  if (helpCode !== undefined) {
    return helpCode;
  }
  return maybePrintVersion(sub);
}

function dispatchSubcommand(sub: string, rest: string[]): number | Promise<number> {
  const handler = COMMAND_HANDLERS.get(sub);
  if (handler) {
    return handler(rest);
  }
  die(`unknown command: ${sub}\nRun 'machinen --help' for usage.`);
}

function maybePrintTopLevelHelp(sub: string | undefined): number | undefined {
  if (!sub) {
    printHelp();
    return 1;
  }
  if (sub === "-h") {
    printHelp();
    return 0;
  }
  if (sub === "--help") {
    printHelp();
    return 0;
  }
  return undefined;
}

function maybePrintVersion(sub: string | undefined): number | undefined {
  if (sub === "--version") {
    return printVersion();
  }
  if (sub === "-v") {
    return printVersion();
  }
  return undefined;
}

function printVersion(): number {
  process.stdout.write(`${VERSION}\n`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (isMachinenError(err)) {
      process.stderr.write(`machinen: ${formatMachinenError(err)}\n`);
      process.exit(1);
    }
    process.stderr.write(
      `machinen: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  },
);
