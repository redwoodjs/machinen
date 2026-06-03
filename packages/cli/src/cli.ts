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
//   machinen capture postgres --out <dir> --dump <file> ...
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
  rmSync,
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
  NODEJS_MEMORY_IR_INVALID_REFUSAL_CODE,
  NODEJS_MEMORY_IR_MATERIALIZER_FILENAME,
  createNodejsMemoryIrMaterializerModule,
  validateNodejsMemoryIrDocument,
  PRODUCT_PORTABLE_POSTGRES_DUMP,
  ProductLevel4EventfdError,
  ProductLevel4PingSocketError,
  ProductLevel4PipeError,
  ProductLevel4TcpListenerError,
  ProductLevel4TimerfdError,
  ProductPortablePostgresError,
  ProductSelectedNativeError,
  buildArbitraryProcessLevel5SeedMatrix,
  buildNodeLevel5AppSupportMatrix,
  buildNodeLevel5FrameworkCapabilityMatrix,
  buildProductClaimRegistry,
  evaluateNodeLevel5FrameworkCapabilityClaimReady,
  evaluateNodeLevel5FrameworkCapabilityReadiness,
  createProductLevel4EventfdSnapshot,
  createProductLevel4PingSocketSnapshot,
  createProductLevel4PipeSnapshot,
  createProductLevel4TcpListenerSnapshot,
  createProductLevel4TimerfdSnapshot,
  createNodeLevel5DeclaredSubsetCapture,
  createNodeLevel5ProductSnapshot,
  createNodeLevel5ProductSupport80ArtifactBundle,
  createProductPortablePostgresSnapshot,
  createProductSelectedNativeSnapshot,
  filterProductClaimRegistry,
  formatMachinenError,
  isMachinenError,
  isProductLevel4EventfdBundle,
  isProductLevel4PingSocketBundle,
  isProductLevel4PipeBundle,
  isProductLevel4TcpListenerBundle,
  isProductLevel4TimerfdBundle,
  isNodeLevel5ProductSnapshotBundle,
  isProductPortablePostgresBundle,
  isProductSelectedNativeBundle,
  createArbitraryProcessLevel5SeedReport,
  loadNodeLevel5FrameworkIntrospectionCorpusReport,
  loadNodeLevel5FrameworkProductEvidenceReport,
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
  productPortablePostgresFileSha256,
  productClaimFamilies,
  productClaimStatuses,
  nodeLevel5ProductSupport80UnsupportedDetectors,
  nodeLevel5ProductSupport100ClaimRegistry,
  productSupportLevels,
  readHostRssBytesMulti,
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
  verifyNodeLevel5FrameworkIntrospectionCorpusReport,
  verifyNodeLevel5InstalledThirdPartyAppCorpusReport,
  verifyNodeLevel5ThirdPartyAppCorpusReport,
  restoreProductLevel4EventfdSnapshot,
  restoreProductLevel4PingSocketSnapshot,
  restoreProductLevel4PipeSnapshot,
  restoreProductLevel4TcpListenerSnapshot,
  restoreProductLevel4TimerfdSnapshot,
  restoreProductPortablePostgresSnapshot,
  restoreProductSelectedNativeSnapshot,
  runGc,
  validatePid,
} from "@machinen/runtime";
import type {
  LogEvent,
  ProductClaimFamily,
  ProductClaimStatus,
  ProductLevel4EventfdDescriptor,
  ProductLevel4EventfdRestoreSummary,
  ProductLevel4PingSocketDescriptor,
  ProductLevel4PingSocketRestoreSummary,
  ProductLevel4PipeDescriptor,
  ProductLevel4PipeRestoreSummary,
  ProductLevel4TcpListenerDescriptor,
  ProductLevel4TcpListenerRestoreSummary,
  ProductLevel4TimerfdDescriptor,
  ProductLevel4TimerfdRestoreSummary,
  ProductSupportLevel,
  NodeLevel5ProductSnapshotDirection,
  NodeLevel5ProductSupport80FamilyId,
  RegistryEntry,
  VmHandle,
} from "@machinen/runtime";
import debugLib from "debug";

import pkg from "../package.json" with { type: "json" };
import { buildAgentContext } from "./agent-context.ts";
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
import { appendFeedback, feedbackPath, postUpstream, readFeedback } from "./feedback.ts";
import { formatMem } from "./format-mem.ts";
import { formatPorts } from "./format-ports.ts";
import {
  detectLevel5RestoreAdapter,
  restoreLevel5RuntimeBundle,
  writeNodeLevel5ProofCompositionSnapshot,
  writeNodeLevel5RuntimeProfileSnapshot,
} from "./level5-runtime-adapters.ts";
import { parseForkArgs } from "./parse-fork-args.ts";
import type {
  PortableRestoreAdapter,
  PortableRestoreExecutionInput,
  PortableRestorePlanInput,
  PortableRestoreRefusalInput,
  PortableRestoreValidationInput,
  PortableRestoreVerifyInput,
} from "./portable-restore-adapter.ts";
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
import { tailLines } from "./tail-lines.ts";

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
  validateOptionalGuestAssetArchitecture(abs, spec.cpu);
}

// fallow-ignore-next-line complexity
function validateOptionalGuestAssetArchitecture(dir: string, cpu: GuestCpu): void {
  for (const name of ["init", "exec-agent"]) {
    const path = join(dir, name);
    if (!existsSync(path)) {
      continue;
    }
    const actual = readElfGuestCpu(path);
    if (!actual) {
      die(`MACHINEN_ASSETS_DIR=${dir} contains ${name}, but it is not a recognized Linux ELF`);
    }
    if (actual !== cpu) {
      die(
        `MACHINEN_ASSETS_DIR=${dir} contains ${name} for ${actual}, but this host will boot ${cpu} guests.\n` +
          `  Rebuild assets with MACHINEN_GUEST_ARCH=${cpu} ./scripts/build-base-assets.sh, or remove stale ${name}.`,
      );
    }
  }
}

// fallow-ignore-next-line complexity
function readElfGuestCpu(path: string): GuestCpu | null {
  const bytes = readFileSync(path);
  if (
    bytes.length < 20 ||
    bytes[0] !== 0x7f ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0x4c ||
    bytes[3] !== 0x46
  ) {
    return null;
  }
  const littleEndian = bytes[5] === 1;
  const machine = littleEndian ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18);
  if (machine === 0x3e) {
    return "amd64";
  }
  if (machine === 0xb7) {
    return "arm64";
  }
  return null;
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

type CapturePostgresOptions = {
  json: boolean;
  dryRun: boolean;
  out?: string;
  sourceArch?: "arm64" | "amd64";
  targetArch?: "arm64" | "amd64";
  dump?: string;
  sourceVerifierOutput?: string;
  postgresVersion?: string;
  checkpointLsn?: string;
  initSql?: string;
  workloadSql?: string;
  verifierSql?: string;
  dataManifest?: string;
  activeTransactions?: number;
  activeSessions?: number;
  dirtyWal?: boolean;
  hostMountedDataDir?: boolean;
  physicalDataDirCopy?: boolean;
  postgresDockerHost?: string;
  postgresContainer?: string;
  postgresDatabase?: string;
};

type CaptureTcpListenerOptions = {
  json: boolean;
  dryRun: boolean;
  out?: string;
  sourceArch?: "arm64" | "amd64";
  targetArch?: "arm64" | "amd64";
  sourceVerifierOutput?: string;
  bindAddress?: string;
  port?: number;
  backlog?: number;
  noReuseaddr?: boolean;
  acceptQueue?: "empty" | "non-empty" | "unknown";
  activeConnections?: boolean;
  unsupportedOptions?: boolean;
  partialIo?: boolean;
  activeSyscall?: boolean;
};

type CaptureTimerfdOptions = {
  json: boolean;
  dryRun: boolean;
  out?: string;
  sourceArch?: "arm64" | "amd64";
  targetArch?: "arm64" | "amd64";
  sourceVerifierOutput?: string;
  remainingMs?: number;
  clock?: "monotonic" | "realtime";
  intervalMs?: number;
  absolute?: boolean;
  cancelOnSet?: boolean;
  unreadExpirations?: number;
  noCloexec?: boolean;
  nonblocking?: boolean;
  activeRead?: boolean;
};

type CapturePipeOptions = {
  json: boolean;
  dryRun: boolean;
  out?: string;
  sourceArch?: "arm64" | "amd64";
  targetArch?: "arm64" | "amd64";
  sourceVerifierOutput?: string;
  readFd?: number;
  writeFd?: number;
  buffer?: "empty" | "bytes" | "unknown";
  bufferedBytesHex?: string;
  peerLifetime?: "open" | "closed" | "unknown";
  waiters?: "none" | "unknown";
  readiness?: "not-readable" | "readable" | "unknown";
  noCloexec?: boolean;
  nonblocking?: boolean;
  activeSyscall?: boolean;
};

type CaptureEventfdOptions = {
  json: boolean;
  dryRun: boolean;
  out?: string;
  sourceArch?: "arm64" | "amd64";
  targetArch?: "arm64" | "amd64";
  sourceVerifierOutput?: string;
  counter?: string;
  semaphore?: boolean;
  waiters?: "none" | "unknown";
  aliases?: "none" | "present" | "unknown";
  noCloexec?: boolean;
  nonblocking?: boolean;
  activeSyscall?: boolean;
};

type CapturePingSocketOptions = {
  json: boolean;
  dryRun: boolean;
  out?: string;
  sourceArch?: "arm64" | "amd64";
  targetArch?: "arm64" | "amd64";
  socketKind?: "ping-dgram-icmp" | "raw-icmp";
  sourceVerifierOutput?: string;
  echoIdentifier?: number;
  echoSequence?: number;
  activeRecvmsg?: boolean;
  unreadReceiveQueue?: boolean;
  inflightPackets?: boolean;
  ambiguousRouteOrNamespace?: boolean;
  missingCredentialOrCapability?: boolean;
  unsupportedRawSocketOption?: boolean;
};

type CaptureNativeOptions = {
  json: boolean;
  dryRun: boolean;
  out?: string;
  sourceArch?: "arm64" | "amd64";
  targetArch?: "arm64" | "amd64";
  sourceVerifierOutput?: string;
  sourceCapture?: string;
  targetPlan?: string;
  activeSyscall?: boolean;
  unsupportedResourceState?: boolean;
};

// fallow-ignore-next-line complexity
function cmdCapture(args: string[]): number {
  const { json, rest: withoutJson } = consumeJsonFlag(args);
  const { dryRun, rest } = consumeDryRunFlag(withoutJson);
  if (rest[0] === "postgres") {
    return cmdCapturePostgres({ json, dryRun, rest });
  }
  if (rest[0] === "eventfd") {
    return cmdCaptureEventfd({ json, dryRun, rest });
  }
  if (rest[0] === "pipe") {
    return cmdCapturePipe({ json, dryRun, rest });
  }
  if (rest[0] === "timerfd") {
    return cmdCaptureTimerfd({ json, dryRun, rest });
  }
  if (rest[0] === "tcp-listener") {
    return cmdCaptureTcpListener({ json, dryRun, rest });
  }
  if (rest[0] === "ping-socket") {
    return cmdCapturePingSocket({ json, dryRun, rest });
  }
  if (rest[0] === "native") {
    return cmdCaptureNative({ json, dryRun, rest });
  }
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

// fallow-ignore-next-line complexity
function cmdCapturePostgres(input: { json: boolean; dryRun: boolean; rest: string[] }): number {
  const options = parseCapturePostgresArgs(input);
  const required = [
    ["--out", options.out],
    ["--source-arch", options.sourceArch],
    ["--target-arch", options.targetArch],
    ["--postgres-version", options.postgresVersion],
    ["--checkpoint-lsn", options.checkpointLsn],
  ] as const;
  assertCaptureRequired(required);
  const noDumpProductCapture = options.dump === undefined;
  if (noDumpProductCapture) {
    assertCaptureRequired([
      ["--postgres-container", options.postgresContainer],
      ["--database", options.postgresDatabase],
      ["--verifier-sql", options.verifierSql],
    ] as const);
  } else {
    assertCaptureRequired([["--source-verifier-output", options.sourceVerifierOutput]] as const);
  }
  try {
    const postgresEvidence = noDumpProductCapture
      ? capturePostgresDockerEvidence(options)
      : undefined;
    const result = createProductPortablePostgresSnapshot({
      outDir: options.out!,
      sourceArch: options.sourceArch!,
      targetArch: options.targetArch!,
      logicalDumpPath: postgresEvidence?.dumpPath ?? options.dump!,
      sourceVerifierOutput:
        postgresEvidence?.sourceVerifierOutput ??
        readFileSync(resolve(options.sourceVerifierOutput!), "utf8").trim(),
      postgresVersion: options.postgresVersion!,
      checkpointLsn: options.checkpointLsn!,
      initSqlSha256: optionalFileSha256(options.initSql),
      workloadSqlSha256: optionalFileSha256(options.workloadSql),
      verifierSqlSha256: optionalFileSha256(options.verifierSql),
      dataManifestSha256: optionalFileSha256(options.dataManifest),
      activeTransactions: options.activeTransactions,
      activeSessions: options.activeSessions,
      dirtyWal: options.dirtyWal,
      hostMountedDataDir: options.hostMountedDataDir,
      physicalDataDirCopy: options.physicalDataDirCopy,
      dryRun: options.dryRun,
    });
    return reportProductCaptureResult(options.json, result, "postgres");
  } catch (err) {
    handleProductPortablePostgresError(err, options.json);
  }
}

// fallow-ignore-next-line complexity
function cmdCaptureTcpListener(input: { json: boolean; dryRun: boolean; rest: string[] }): number {
  const options = parseCaptureTcpListenerArgs(input);
  const required = [
    ["--out", options.out],
    ["--source-arch", options.sourceArch],
    ["--target-arch", options.targetArch],
    ["--source-verifier-output", options.sourceVerifierOutput],
    ["--bind-address", options.bindAddress],
    ["--port", options.port],
    ["--backlog", options.backlog],
  ] as const;
  assertCaptureRequired(required);
  try {
    const result = createProductLevel4TcpListenerSnapshot({
      outDir: options.out!,
      sourceArch: options.sourceArch!,
      targetArch: options.targetArch!,
      sourceVerifierOutput: readFileSync(resolve(options.sourceVerifierOutput!), "utf8").trim(),
      bindAddress: options.bindAddress!,
      port: options.port!,
      backlog: options.backlog!,
      reuseAddr: options.noReuseaddr ? false : true,
      acceptQueue: options.acceptQueue,
      activeConnections: options.activeConnections,
      unsupportedOptions: options.unsupportedOptions,
      partialIo: options.partialIo,
      activeSyscall: options.activeSyscall,
      dryRun: options.dryRun,
    });
    return reportProductCaptureResult(options.json, result, "tcp-listener");
  } catch (err) {
    handleProductLevel4TcpListenerError(err, options.json);
  }
}

// fallow-ignore-next-line complexity
function cmdCaptureTimerfd(input: { json: boolean; dryRun: boolean; rest: string[] }): number {
  const options = parseCaptureTimerfdArgs(input);
  const required = [
    ["--out", options.out],
    ["--source-arch", options.sourceArch],
    ["--target-arch", options.targetArch],
    ["--source-verifier-output", options.sourceVerifierOutput],
    ["--remaining-ms", options.remainingMs],
  ] as const;
  assertCaptureRequired(required);
  try {
    const result = createProductLevel4TimerfdSnapshot({
      outDir: options.out!,
      sourceArch: options.sourceArch!,
      targetArch: options.targetArch!,
      sourceVerifierOutput: readFileSync(resolve(options.sourceVerifierOutput!), "utf8").trim(),
      remainingMs: options.remainingMs!,
      clock: options.clock,
      intervalMs: options.intervalMs,
      absolute: options.absolute,
      cancelOnSet: options.cancelOnSet,
      unreadExpirations: options.unreadExpirations,
      closeOnExec: options.noCloexec ? false : true,
      nonblocking: options.nonblocking,
      activeRead: options.activeRead,
      dryRun: options.dryRun,
    });
    return reportProductCaptureResult(options.json, result, "timerfd");
  } catch (err) {
    handleProductLevel4TimerfdError(err, options.json);
  }
}

// fallow-ignore-next-line complexity
function cmdCapturePipe(input: { json: boolean; dryRun: boolean; rest: string[] }): number {
  const options = parseCapturePipeArgs(input);
  const required = [
    ["--out", options.out],
    ["--source-arch", options.sourceArch],
    ["--target-arch", options.targetArch],
    ["--source-verifier-output", options.sourceVerifierOutput],
    ["--read-fd", options.readFd],
    ["--write-fd", options.writeFd],
  ] as const;
  assertCaptureRequired(required);
  try {
    const result = createProductLevel4PipeSnapshot({
      outDir: options.out!,
      sourceArch: options.sourceArch!,
      targetArch: options.targetArch!,
      sourceVerifierOutput: readFileSync(resolve(options.sourceVerifierOutput!), "utf8").trim(),
      readFd: options.readFd!,
      writeFd: options.writeFd!,
      buffer: options.buffer,
      bufferedBytesHex: options.bufferedBytesHex,
      peerLifetime: options.peerLifetime,
      waiters: options.waiters,
      readiness: options.readiness,
      closeOnExec: options.noCloexec ? false : true,
      nonblocking: options.nonblocking,
      activeSyscall: options.activeSyscall,
      dryRun: options.dryRun,
    });
    return reportProductCaptureResult(options.json, result, "pipe");
  } catch (err) {
    handleProductLevel4PipeError(err, options.json);
  }
}

// fallow-ignore-next-line complexity
function cmdCaptureEventfd(input: { json: boolean; dryRun: boolean; rest: string[] }): number {
  const options = parseCaptureEventfdArgs(input);
  const required = [
    ["--out", options.out],
    ["--source-arch", options.sourceArch],
    ["--target-arch", options.targetArch],
    ["--source-verifier-output", options.sourceVerifierOutput],
    ["--counter", options.counter],
  ] as const;
  assertCaptureRequired(required);
  try {
    const result = createProductLevel4EventfdSnapshot({
      outDir: options.out!,
      sourceArch: options.sourceArch!,
      targetArch: options.targetArch!,
      sourceVerifierOutput: readFileSync(resolve(options.sourceVerifierOutput!), "utf8").trim(),
      counter: options.counter!,
      semaphore: options.semaphore,
      waiters: options.waiters,
      aliases: options.aliases,
      closeOnExec: options.noCloexec ? false : true,
      nonblocking: options.nonblocking,
      activeSyscall: options.activeSyscall,
      dryRun: options.dryRun,
    });
    return reportProductCaptureResult(options.json, result, "eventfd");
  } catch (err) {
    handleProductLevel4EventfdError(err, options.json);
  }
}

// fallow-ignore-next-line complexity
function cmdCapturePingSocket(input: { json: boolean; dryRun: boolean; rest: string[] }): number {
  const options = parseCapturePingSocketArgs(input);
  const required = [
    ["--out", options.out],
    ["--source-arch", options.sourceArch],
    ["--target-arch", options.targetArch],
    ["--socket-kind", options.socketKind],
    ["--source-verifier-output", options.sourceVerifierOutput],
    ["--echo-id", options.echoIdentifier],
    ["--echo-seq", options.echoSequence],
  ] as const;
  assertCaptureRequired(required);
  try {
    const result = createProductLevel4PingSocketSnapshot({
      outDir: options.out!,
      sourceArch: options.sourceArch!,
      targetArch: options.targetArch!,
      socketKind: options.socketKind!,
      sourceVerifierOutput: readFileSync(resolve(options.sourceVerifierOutput!), "utf8").trim(),
      echoIdentifier: options.echoIdentifier!,
      echoSequence: options.echoSequence!,
      route: "loopback",
      namespace: "target-loopback",
      activeRecvmsg: options.activeRecvmsg,
      unreadReceiveQueue: options.unreadReceiveQueue,
      inflightPackets: options.inflightPackets,
      ambiguousRouteOrNamespace: options.ambiguousRouteOrNamespace,
      missingCredentialOrCapability: options.missingCredentialOrCapability,
      unsupportedRawSocketOption: options.unsupportedRawSocketOption,
      dryRun: options.dryRun,
    });
    return reportProductCaptureResult(options.json, result, "ping socket");
  } catch (err) {
    handleProductLevel4PingSocketError(err, options.json);
  }
}

function cmdCaptureNative(input: { json: boolean; dryRun: boolean; rest: string[] }): number {
  const options = parseCaptureNativeArgs(input);
  const required = [
    ["--out", options.out],
    ["--source-arch", options.sourceArch],
    ["--target-arch", options.targetArch],
    ["--source-verifier-output", options.sourceVerifierOutput],
  ] as const;
  assertCaptureRequired(required);
  try {
    const result = createProductSelectedNativeSnapshot({
      outDir: options.out!,
      sourceArch: options.sourceArch!,
      targetArch: options.targetArch!,
      sourceVerifierOutput: readFileSync(resolve(options.sourceVerifierOutput!), "utf8").trim(),
      sourceCapturePath: options.sourceCapture,
      targetPlanPath: options.targetPlan,
      activeSyscall: options.activeSyscall,
      unsupportedResourceState: options.unsupportedResourceState,
      dryRun: options.dryRun,
    });
    return reportProductCaptureResult(options.json, result, "selected native");
  } catch (err) {
    handleProductSelectedNativeError(err, options.json);
  }
}

function assertCaptureRequired(required: ReadonlyArray<readonly [string, unknown]>): void {
  for (const [flag, value] of required) {
    if (value === undefined || value === "") {
      die(`${captureUsage()}\nmissing required ${flag}`);
    }
  }
}

// fallow-ignore-next-line complexity
function reportProductCaptureResult(
  json: boolean,
  result: {
    state: "completed" | "refused";
    bundleDir: string;
    refusal?: { expectedRefusalCode: string };
  },
  label: string,
): number {
  if (json) {
    emitJson({ schema_version: 1, ...result });
  } else if (result.state === "completed") {
    process.stderr.write(`captured portable ${label} bundle: ${result.bundleDir}\n`);
  } else {
    process.stderr.write(
      `refused portable ${label} capture: ${result.refusal?.expectedRefusalCode ?? "unknown"}\n`,
    );
  }
  return result.state === "completed" ? 0 : 1;
}

// fallow-ignore-next-line complexity
function consumeCommonProductCaptureOption(
  options: {
    out?: string;
    sourceArch?: "arm64" | "amd64";
    targetArch?: "arm64" | "amd64";
    sourceVerifierOutput?: string;
  },
  rest: string[],
  index: number,
  arg: string,
): number | undefined {
  switch (arg) {
    case "--out":
      options.out = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--source-arch":
      options.sourceArch = parseProductArch(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--target-arch":
      options.targetArch = parseProductArch(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--source-verifier-output":
      options.sourceVerifierOutput = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    default:
      return undefined;
  }
}

function parseCaptureTcpListenerArgs(input: {
  json: boolean;
  dryRun: boolean;
  rest: string[];
}): CaptureTcpListenerOptions {
  return parseProductCaptureArgs(input, consumeTcpListenerCaptureOption);
}

function parseCaptureTimerfdArgs(input: {
  json: boolean;
  dryRun: boolean;
  rest: string[];
}): CaptureTimerfdOptions {
  return parseProductCaptureArgs(input, consumeTimerfdCaptureOption);
}

function parseCapturePipeArgs(input: {
  json: boolean;
  dryRun: boolean;
  rest: string[];
}): CapturePipeOptions {
  return parseProductCaptureArgs(input, consumePipeCaptureOption);
}

function parseCaptureEventfdArgs(input: {
  json: boolean;
  dryRun: boolean;
  rest: string[];
}): CaptureEventfdOptions {
  return parseProductCaptureArgs(input, consumeEventfdCaptureOption);
}

function parseCapturePingSocketArgs(input: {
  json: boolean;
  dryRun: boolean;
  rest: string[];
}): CapturePingSocketOptions {
  return parseProductCaptureArgs(input, consumePingCaptureOption);
}

function parseCaptureNativeArgs(input: {
  json: boolean;
  dryRun: boolean;
  rest: string[];
}): CaptureNativeOptions {
  return parseProductCaptureArgs(input, consumeNativeCaptureOption);
}

function parseCapturePostgresArgs(input: {
  json: boolean;
  dryRun: boolean;
  rest: string[];
}): CapturePostgresOptions {
  return parseProductCaptureArgs(input, consumePostgresCaptureOption);
}

function parseProductCaptureArgs<
  T extends {
    json: boolean;
    dryRun: boolean;
    out?: string;
    sourceArch?: "arm64" | "amd64";
    targetArch?: "arm64" | "amd64";
    sourceVerifierOutput?: string;
  },
>(
  input: { json: boolean; dryRun: boolean; rest: string[] },
  consumeSpecificOption: (
    options: T,
    rest: string[],
    index: number,
    arg: string,
  ) => number | undefined,
): T {
  const { json, dryRun, rest } = input;
  const options = { json, dryRun } as T;
  for (let index = 1; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const nextIndex =
      consumeCommonProductCaptureOption(options, rest, index, arg) ??
      consumeSpecificOption(options, rest, index, arg);
    if (nextIndex === undefined) {
      die(`${captureUsage()}\nunknown argument: ${arg}`);
    }
    index = nextIndex;
  }
  return options;
}

// fallow-ignore-next-line complexity
function consumeTcpListenerCaptureOption(
  options: CaptureTcpListenerOptions,
  rest: string[],
  index: number,
  arg: string,
): number | undefined {
  switch (arg) {
    case "--bind-address":
      options.bindAddress = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--port":
      options.port = parseTcpPort(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--backlog":
      options.backlog = parseTcpBacklog(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--accept-queue":
      options.acceptQueue = parseTcpAcceptQueue(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--no-reuseaddr":
      options.noReuseaddr = true;
      return index;
    case "--active-connections":
      options.activeConnections = true;
      return index;
    case "--unsupported-options":
      options.unsupportedOptions = true;
      return index;
    case "--partial-io":
      options.partialIo = true;
      return index;
    case "--active-syscall":
      options.activeSyscall = true;
      return index;
    default:
      return undefined;
  }
}

// fallow-ignore-next-line complexity
function consumeTimerfdCaptureOption(
  options: CaptureTimerfdOptions,
  rest: string[],
  index: number,
  arg: string,
): number | undefined {
  switch (arg) {
    case "--remaining-ms":
      options.remainingMs = parsePositiveInteger(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--clock":
      options.clock = parseTimerfdClock(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--interval-ms":
      options.intervalMs = parseNonNegativeInteger(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--unread-expirations":
      options.unreadExpirations = parseNonNegativeInteger(
        takeCaptureValue(rest, index + 1, arg),
        arg,
      );
      return index + 1;
    case "--absolute":
      options.absolute = true;
      return index;
    case "--cancel-on-set":
      options.cancelOnSet = true;
      return index;
    case "--no-cloexec":
      options.noCloexec = true;
      return index;
    case "--nonblocking":
      options.nonblocking = true;
      return index;
    case "--active-read":
      options.activeRead = true;
      return index;
    default:
      return undefined;
  }
}

// fallow-ignore-next-line complexity
function consumePipeCaptureOption(
  options: CapturePipeOptions,
  rest: string[],
  index: number,
  arg: string,
): number | undefined {
  switch (arg) {
    case "--read-fd":
      options.readFd = parsePipeFd(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--write-fd":
      options.writeFd = parsePipeFd(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--buffer":
      options.buffer = parsePipeBuffer(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--buffered-bytes-hex":
      options.bufferedBytesHex = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--peer-lifetime":
      options.peerLifetime = parsePipePeerLifetime(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--waiters":
      options.waiters = parseEventfdWaiters(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--readiness":
      options.readiness = parsePipeReadiness(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--no-cloexec":
      options.noCloexec = true;
      return index;
    case "--nonblocking":
      options.nonblocking = true;
      return index;
    case "--active-syscall":
      options.activeSyscall = true;
      return index;
    default:
      return undefined;
  }
}

// fallow-ignore-next-line complexity
function consumeEventfdCaptureOption(
  options: CaptureEventfdOptions,
  rest: string[],
  index: number,
  arg: string,
): number | undefined {
  switch (arg) {
    case "--counter":
      options.counter = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--semaphore":
      options.semaphore = true;
      return index;
    case "--waiters":
      options.waiters = parseEventfdWaiters(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--aliases":
      options.aliases = parseEventfdAliases(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--no-cloexec":
      options.noCloexec = true;
      return index;
    case "--nonblocking":
      options.nonblocking = true;
      return index;
    case "--active-syscall":
      options.activeSyscall = true;
      return index;
    default:
      return undefined;
  }
}

// fallow-ignore-next-line complexity
function consumePingCaptureOption(
  options: CapturePingSocketOptions,
  rest: string[],
  index: number,
  arg: string,
): number | undefined {
  switch (arg) {
    case "--socket-kind":
      options.socketKind = parsePingSocketKind(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--echo-id":
      options.echoIdentifier = parseUint16(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--echo-seq":
      options.echoSequence = parseUint16(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--active-recvmsg":
      options.activeRecvmsg = true;
      return index;
    case "--unread-receive-queue":
      options.unreadReceiveQueue = true;
      return index;
    case "--inflight-packets":
      options.inflightPackets = true;
      return index;
    case "--ambiguous-route-or-namespace":
      options.ambiguousRouteOrNamespace = true;
      return index;
    case "--missing-credential-or-capability":
      options.missingCredentialOrCapability = true;
      return index;
    case "--unsupported-raw-socket-option":
      options.unsupportedRawSocketOption = true;
      return index;
    default:
      return undefined;
  }
}

// fallow-ignore-next-line complexity
function consumeNativeCaptureOption(
  options: CaptureNativeOptions,
  rest: string[],
  index: number,
  arg: string,
): number | undefined {
  switch (arg) {
    case "--source-capture":
      options.sourceCapture = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--target-plan":
      options.targetPlan = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--active-syscall":
      options.activeSyscall = true;
      return index;
    case "--unsupported-resource-state":
      options.unsupportedResourceState = true;
      return index;
    default:
      return undefined;
  }
}

function consumePostgresCaptureOption(
  options: CapturePostgresOptions,
  rest: string[],
  index: number,
  arg: string,
): number | undefined {
  switch (arg) {
    case "--dump":
      options.dump = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--postgres-version":
      options.postgresVersion = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--checkpoint-lsn":
      options.checkpointLsn = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--init-sql":
      options.initSql = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--workload-sql":
      options.workloadSql = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--verifier-sql":
      options.verifierSql = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--data-manifest":
      options.dataManifest = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--postgres-docker-host":
      options.postgresDockerHost = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--postgres-container":
      options.postgresContainer = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--database":
      options.postgresDatabase = takeCaptureValue(rest, index + 1, arg);
      return index + 1;
    case "--active-transactions":
      options.activeTransactions = parseNonNegativeInteger(
        takeCaptureValue(rest, index + 1, arg),
        arg,
      );
      return index + 1;
    case "--active-sessions":
      options.activeSessions = parseNonNegativeInteger(takeCaptureValue(rest, index + 1, arg), arg);
      return index + 1;
    case "--dirty-wal":
      options.dirtyWal = true;
      return index;
    case "--host-mounted-data-dir":
      options.hostMountedDataDir = true;
      return index;
    case "--physical-data-dir-copy":
      options.physicalDataDirCopy = true;
      return index;
    default:
      return undefined;
  }
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
  if (rest[0] === "framework-capabilities") {
    return cmdNodeLevel5FrameworkCapabilities(rest.slice(1), json);
  }
  if (rest[0] === "framework-readiness") {
    return cmdNodeLevel5FrameworkReadiness(rest.slice(1), json);
  }
  if (rest[0] === "framework-claim-ready") {
    return cmdNodeLevel5FrameworkClaimReady(rest.slice(1), json);
  }
  if (rest[0] === "arbitrary-process-seed") {
    return cmdNodeLevel5ArbitraryProcessSeed(rest.slice(1), json);
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
    claimRegistry: nodeLevel5ProductSupport100ClaimRegistry,
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

function cmdNodeLevel5FrameworkCapabilities(args: string[], json: boolean): number {
  if (args.length > 0) {
    die(`unknown node-level5 framework-capabilities argument: ${args[0]}`);
  }
  return reportNodeLevel5ProductCommand(json, buildNodeLevel5FrameworkCapabilityMatrix());
}

function cmdNodeLevel5ArbitraryProcessSeed(args: string[], json: boolean): number {
  const out = valueAfterNodeLevel5Flag(args, "--out");
  const payload = out
    ? createArbitraryProcessLevel5SeedReport({ outDir: resolve(out) })
    : buildArbitraryProcessLevel5SeedMatrix();
  return reportNodeLevel5ProductCommand(json, payload);
}

function valueAfterNodeLevel5Flag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function cmdNodeLevel5FrameworkReadiness(args: string[], json: boolean): number {
  const reportFlag = args.indexOf("--framework-introspection-corpus-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die(
      "machinen node-level5 framework-readiness requires --framework-introspection-corpus-report <file>",
    );
  }
  const summary = evaluateNodeLevel5FrameworkCapabilityReadiness({
    frameworkIntrospectionCorpusReport: loadNodeLevel5FrameworkIntrospectionCorpusReport(
      resolve(path),
    ),
  });
  return reportNodeLevel5ProductCommand(json, summary);
}

function cmdNodeLevel5FrameworkClaimReady(args: string[], json: boolean): number {
  const readinessPath = requiredNodeLevel5FrameworkFlag(
    args,
    "--readiness-report",
    "framework-claim-ready",
  );
  const productEvidencePath = requiredNodeLevel5FrameworkFlag(
    args,
    "--framework-product-evidence-report",
    "framework-claim-ready",
  );
  const summary = evaluateNodeLevel5FrameworkCapabilityClaimReady({
    readinessReport: JSON.parse(readFileSync(resolve(readinessPath), "utf8")),
    productEvidenceReport: loadNodeLevel5FrameworkProductEvidenceReport(
      resolve(productEvidencePath),
    ),
  });
  return reportNodeLevel5ProductCommand(json, summary);
}

function requiredNodeLevel5FrameworkFlag(args: string[], flag: string, command: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value) {
    die(`machinen node-level5 ${command} requires ${flag} <file>`);
  }
  return value;
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
  const frameworkIntrospectionCorpus = readOptionalNodeLevel5FrameworkIntrospectionCorpus(args);
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
    frameworkIntrospectionCorpus,
  ].every((item) => (item ? item.accepted === true : true));
  return reportNodeLevel5ProductCommand(json, {
    accepted,
    kind: "machinen.node-level5-release-gate-summary",
    nodeProductSupportClaimed: 0,
    broadNodeProductSupportClaimed: 0,
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
    frameworkIntrospectionCorpus,
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
  "--include-framework-introspection-corpus",
  "--corpus-report",
  "--refusal-corpus-report",
  "--third-party-app-corpus-report",
  "--installed-third-party-app-corpus-report",
  "--generic-vm-corpus-report",
  "--generic-vm-retained-evidence-report",
  "--generic-vm-row-artifacts-report",
  "--generic-vm-refusal-artifacts-report",
  "--framework-introspection-corpus-report",
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
  "--framework-introspection-corpus-report",
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

function readOptionalNodeLevel5FrameworkIntrospectionCorpus(
  args: string[],
): Record<string, unknown> | undefined {
  return args.includes("--include-framework-introspection-corpus")
    ? verifyNodeLevel5FrameworkIntrospectionCorpusPath(
        requiredNodeLevel5FrameworkIntrospectionCorpusReportPath(args),
      )
    : undefined;
}

function requiredNodeLevel5FrameworkIntrospectionCorpusReportPath(args: string[]): string {
  const reportFlag = args.indexOf("--framework-introspection-corpus-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die(
      "machinen node-level5 release-gate --include-framework-introspection-corpus requires --framework-introspection-corpus-report <file>",
    );
  }
  return path;
}

function verifyNodeLevel5FrameworkIntrospectionCorpusPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5FrameworkIntrospectionCorpusReport(
      loadNodeLevel5FrameworkIntrospectionCorpusReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport(
      "node-level5-framework-introspection-corpus-invalid",
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
    "       machinen node-level5 framework-capabilities [--json]\n" +
    "       machinen node-level5 framework-readiness --framework-introspection-corpus-report <file> [--json]\n" +
    "       machinen node-level5 framework-claim-ready --readiness-report <file> --framework-product-evidence-report <file> [--json]\n" +
    "       machinen node-level5 arbitrary-process-seed [--out <dir>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-corpus --generic-vm-corpus-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-retained-evidence --generic-vm-retained-evidence-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-row-artifacts --generic-vm-row-artifacts-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-refusal-artifacts --generic-vm-refusal-artifacts-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-framework-introspection-corpus --framework-introspection-corpus-report <file>] [--json]\n" +
    "       machinen node-level5 85-readiness --generic-vm-corpus-report <file> [--generic-vm-retained-evidence-report <file>] [--generic-vm-row-artifacts-report <file>] [--generic-vm-refusal-artifacts-report <file>] [--json]\n" +
    "       machinen node-level5 85-claim-ready --readiness-report <file> [--json]\n"
  );
}

function captureUsage(): string {
  return (
    "usage: machinen capture postgres --out <dir> --source-arch <arm64|amd64> " +
    "--target-arch <arm64|amd64> --dump <file> --source-verifier-output <file> " +
    "--postgres-version <version> --checkpoint-lsn <lsn> [--json] [--dry-run]\n" +
    "       machinen capture postgres --out <dir> --source-arch <arm64|amd64> " +
    "--target-arch <arm64|amd64> --postgres-container <name> --database <db> " +
    "--verifier-sql <file> --postgres-version <version> --checkpoint-lsn <lsn> " +
    "[--postgres-docker-host local|user@host] [--json] [--dry-run]\n" +
    "       machinen capture eventfd --out <dir> --source-arch <arm64|amd64> " +
    "--target-arch <arm64|amd64> --source-verifier-output <file> --counter <n> " +
    "[--json] [--dry-run]\n" +
    "       machinen capture pipe --out <dir> --source-arch <arm64|amd64> " +
    "--target-arch <arm64|amd64> --source-verifier-output <file> " +
    "--read-fd <n> --write-fd <n> [--json] [--dry-run]\n" +
    "       machinen capture timerfd --out <dir> --source-arch <arm64|amd64> " +
    "--target-arch <arm64|amd64> --source-verifier-output <file> " +
    "--remaining-ms <n> [--json] [--dry-run]\n" +
    "       machinen capture tcp-listener --out <dir> --source-arch <arm64|amd64> " +
    "--target-arch <arm64|amd64> --source-verifier-output <file> " +
    "--bind-address 127.0.0.1 --port <n> --backlog <n> [--json] [--dry-run]\n" +
    "       machinen capture ping-socket --out <dir> --source-arch <arm64|amd64> " +
    "--target-arch <arm64|amd64> --socket-kind <ping-dgram-icmp|raw-icmp> " +
    "--source-verifier-output <file> --echo-id <n> --echo-seq <n> [--json] [--dry-run]\n" +
    "       machinen capture native --out <dir> --source-arch <arm64|amd64> " +
    "--target-arch <arm64|amd64> --source-verifier-output <file> " +
    "[--source-capture <file>] [--target-plan <file>] [--json] [--dry-run]\n" +
    "       machinen capture node-level5 --experimental-node-level5 --out <dir> " +
    "[--source-arch <arm64|amd64>] [--target-arch <arm64|amd64>] [--json] [--dry-run]"
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

function parseTimerfdClock(value: string, flag: string): "monotonic" | "realtime" {
  if (value === "monotonic" || value === "realtime") {
    return value;
  }
  die(`${flag} must be monotonic or realtime`);
}

function parseTcpPort(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    die(`${flag} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function parseTcpBacklog(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 128) {
    die(`${flag} must be an integer between 1 and 128`);
  }
  return parsed;
}

function parseTcpAcceptQueue(value: string, flag: string): "empty" | "non-empty" | "unknown" {
  if (value === "empty" || value === "non-empty" || value === "unknown") {
    return value;
  }
  die(`${flag} must be empty, non-empty, or unknown`);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    die(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parsePipeFd(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1024) {
    die(`${flag} must be an integer between 0 and 1024`);
  }
  return parsed;
}

function parsePipeBuffer(value: string, flag: string): "empty" | "bytes" | "unknown" {
  if (value === "empty" || value === "bytes" || value === "unknown") {
    return value;
  }
  die(`${flag} must be empty, bytes, or unknown`);
}

function parsePipePeerLifetime(value: string, flag: string): "open" | "closed" | "unknown" {
  if (value === "open" || value === "closed" || value === "unknown") {
    return value;
  }
  die(`${flag} must be open, closed, or unknown`);
}

function parsePipeReadiness(value: string, flag: string): "not-readable" | "readable" | "unknown" {
  if (value === "not-readable" || value === "readable" || value === "unknown") {
    return value;
  }
  die(`${flag} must be not-readable, readable, or unknown`);
}

function parseEventfdWaiters(value: string, flag: string): "none" | "unknown" {
  if (value === "none" || value === "unknown") {
    return value;
  }
  die(`${flag} must be none or unknown`);
}

function parseEventfdAliases(value: string, flag: string): "none" | "present" | "unknown" {
  if (value === "none" || value === "present" || value === "unknown") {
    return value;
  }
  die(`${flag} must be none, present, or unknown`);
}

function parsePingSocketKind(value: string, flag: string): "ping-dgram-icmp" | "raw-icmp" {
  if (value === "ping-dgram-icmp" || value === "raw-icmp") {
    return value;
  }
  die(`${flag} must be ping-dgram-icmp or raw-icmp`);
}

function parseUint16(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65535) {
    die(`${flag} must be an integer between 0 and 65535`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    die(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function optionalFileSha256(path: string | undefined): string | undefined {
  return path ? productPortablePostgresFileSha256(resolve(path)) : undefined;
}

type SupportOptions = {
  json: boolean;
  family?: ProductClaimFamily;
  runtime?: string;
  status?: ProductClaimStatus;
  profile?: string;
  resourceFamily?: string;
  refusalCode?: string;
  level?: ProductSupportLevel;
};

function cmdSupport(args: string[]): number {
  const options = parseSupportArgs(args);
  const registry = buildProductClaimRegistry(readProductProofProfilesForCli());
  const entries = filterProductClaimRegistry(registry.entries, {
    family: options.family,
    runtime: options.runtime,
    status: options.status,
    profile: options.profile,
    resourceFamily: options.resourceFamily,
    refusalCode: options.refusalCode,
    supportLevel: options.level,
  });
  const payload = {
    schema_version: 1,
    kind: "machinen.product-support-status",
    filters: {
      family: options.family,
      runtime: options.runtime,
      status: options.status,
      profile: options.profile,
      resourceFamily: options.resourceFamily,
      refusalCode: options.refusalCode,
      level: options.level,
    },
    summary: registry.summary,
    count: entries.length,
    entries,
  };
  if (options.json) {
    emitJson(payload);
    return 0;
  }
  process.stdout.write(formatSupportText(payload));
  return 0;
}

// fallow-ignore-next-line complexity
function parseSupportArgs(args: string[]): SupportOptions {
  const { json, rest } = consumeJsonFlag(args);
  const options: SupportOptions = { json };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    switch (arg) {
      case "--family":
        options.family = parseSupportFamily(takeCaptureValue(rest, ++index, arg));
        break;
      case "--runtime":
        options.runtime = takeCaptureValue(rest, ++index, arg);
        break;
      case "--status":
        options.status = parseSupportStatus(takeCaptureValue(rest, ++index, arg));
        break;
      case "--profile":
        options.profile = takeCaptureValue(rest, ++index, arg);
        break;
      case "--resource-family":
        options.resourceFamily = takeCaptureValue(rest, ++index, arg);
        break;
      case "--refusal-code":
        options.refusalCode = takeCaptureValue(rest, ++index, arg);
        break;
      case "--level":
        options.level = parseSupportLevel(takeCaptureValue(rest, ++index, arg));
        break;
      default:
        die(`${supportUsage()}\nunknown argument: ${arg}`);
    }
  }
  return options;
}

function supportUsage(): string {
  return (
    "usage: machinen support [--family <family>] [--runtime <runtime>] " +
    "[--status <status>] [--profile <name>] [--resource-family <family>] " +
    "[--refusal-code <code>] [--level <support-level>] [--json]"
  );
}

function parseSupportFamily(value: string): ProductClaimFamily {
  if ((productClaimFamilies as readonly string[]).includes(value)) {
    return value as ProductClaimFamily;
  }
  die(`--family must be one of: ${productClaimFamilies.join(", ")}`);
}

function parseSupportStatus(value: string): ProductClaimStatus {
  if ((productClaimStatuses as readonly string[]).includes(value)) {
    return value as ProductClaimStatus;
  }
  die(`--status must be one of: ${productClaimStatuses.join(", ")}`);
}

function parseSupportLevel(value: string): ProductSupportLevel {
  if ((productSupportLevels as readonly string[]).includes(value)) {
    return value as ProductSupportLevel;
  }
  die(`--level must be one of: ${productSupportLevels.join(", ")}`);
}

function readProductProofProfilesForCli(): Array<Record<string, unknown> & { name: string }> {
  const candidates = [
    join(process.cwd(), "scripts/portable-machine-proof-profiles.json"),
    join(
      dirname(dirname(dirname(resolve(process.argv[1] ?? ".")))),
      "scripts/portable-machine-proof-profiles.json",
    ),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    die("could not locate scripts/portable-machine-proof-profiles.json for support discovery");
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Array<
    Record<string, unknown> & { name: string }
  >;
  return parsed;
}

function formatSupportText(payload: {
  summary: ReturnType<typeof buildProductClaimRegistry>["summary"];
  count: number;
  entries: Array<ReturnType<typeof buildProductClaimRegistry>["entries"][number]>;
}): string {
  const lines = [
    `product support claims: ${payload.count}/${payload.summary.total}`,
    `implemented=${payload.summary.implementedProductSupport} refused=${payload.summary.stableProductRefusals} proof-only=${payload.summary.proofOnlyFixtures}`,
  ];
  for (const entry of payload.entries.slice(0, 25)) {
    lines.push(
      `${entry.name}\t${entry.family}\t${entry.supportLevel}\t${entry.productStatus}\t${entry.productRefusalCode ?? "-"}`,
    );
  }
  if (payload.entries.length > 25) {
    lines.push(`... ${payload.entries.length - 25} more; pass --json for the full registry`);
  }
  return `${lines.join("\n")}\n`;
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
  if (isPortableVmProductBundle(snapDir)) {
    return await cmdRestorePortableVmProductBundle(parsed, snapDir, json);
  }
  const portableAdapter = detectPortableRestoreAdapter(snapDir);
  if (portableAdapter) {
    return cmdRestorePortableAdapter(portableAdapter, parsed, snapDir, json);
  }
  if (isNodeLevel5ProductSnapshotBundle(snapDir)) {
    return cmdRestoreNodeLevel5ProductSnapshot(snapDir, json);
  }
  if (isProductPortablePostgresBundle(snapDir)) {
    return cmdRestoreProductPortablePostgres(parsed, snapDir, json);
  }
  if (isProductSelectedNativeBundle(snapDir)) {
    return cmdRestoreProductSelectedNative(parsed, snapDir, json);
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
    die("restore --json is only supported for product portable bundles");
  }
  const paths = await resolveCliBaseAssets();
  const quiet = createRestoreQuietState(parsed, snapDir);
  const vm = await startRestoreVm(parsed, snapDir, paths, quiet);
  reportRestoreSuccess(vm, quiet);
  return runRestoreAttachedSession(vm, quiet);
}

const PORTABLE_VM_PRODUCT_SCOPE = "portable-vm-all3-product-snapshot-restore-v1";
const PORTABLE_VM_PLAN_KIND = "machinen.portable-vm-manifest-plan";

function isPortableVmProductBundle(snapDir: string): boolean {
  return (
    existsSync(join(snapDir, "portable-vm-all3-manifest.json")) &&
    existsSync(join(snapDir, "source-architecture.txt")) &&
    existsSync(join(snapDir, "target-restore.sh")) &&
    existsSync(join(snapDir, "target-verify.sh"))
  );
}

// fallow-ignore-next-line complexity
async function cmdRestorePortableVmProductBundle(
  parsed: ParsedRestoreCommandArgs,
  snapDir: string,
  json: boolean,
): Promise<number> {
  const started = Date.now();
  const sourceArch = readPortableVmSourceArchitecture(snapDir);
  const targetArch = guestCpu();
  const planRefusal = evaluatePortableVmRestorePlan(snapDir, sourceArch, targetArch);
  const materializerRefusal = planRefusal ?? preparePortableVmNodeMemoryMaterializer(snapDir);
  if (materializerRefusal) {
    const refusal = portableVmRestoreRefusal(
      materializerRefusal.code,
      materializerRefusal.message,
      sourceArch,
      targetArch,
    );
    writeFileSync(
      join(snapDir, "portable-vm-product-restore-summary.json"),
      `${JSON.stringify(refusal, null, 2)}\n`,
    );
    reportPortableVmRestoreSummary(json, refusal);
    return 1;
  }
  const name = parsed.name ?? deriveBootName(snapDir);
  const paths = await resolveCliBaseAssets();
  const vm = await boot({
    image: paths.defaultImagePath,
    kernel: paths.kernelPath,
    dtb: paths.dtbPath,
    name,
    detached: true,
    cmd: ["sleep", "100000"],
    liveMounts: [{ host: snapDir, guest: "/mnt/capture", mode: "ro" }],
    timeoutMs: undefined,
  });
  let continuationStarted = false;
  try {
    const restoreResult = await vm.execRaw("/mnt/capture/target-restore.sh", {
      connectTimeoutMs: 180_000,
      execTimeoutMs: 180_000,
    });
    if (restoreResult.exitCode !== 0) {
      throw new Error(
        restoreResult.stderr || restoreResult.stdout || "portable VM target restore failed",
      );
    }
    const verifyResult = await vm.execRaw("/mnt/capture/target-verify.sh", {
      connectTimeoutMs: 180_000,
      execTimeoutMs: 90_000,
    });
    if (verifyResult.exitCode !== 0) {
      throw new Error(
        verifyResult.stderr || verifyResult.stdout || "portable VM target verifier failed",
      );
    }
    const targetRestore = JSON.parse(restoreResult.stdout) as Record<string, unknown>;
    const targetVerify = JSON.parse(verifyResult.stdout) as Record<string, unknown>;
    const summary = {
      kind: "machinen.portable-vm-product-restore-summary",
      version: 1,
      accepted: true,
      scope: PORTABLE_VM_PRODUCT_SCOPE,
      state: "completed",
      migrationCompleted: true,
      sourceArch,
      targetArch,
      sourceArchitectureDetected: true,
      targetArchitectureDetected: true,
      targetVmStarted: true,
      restoredName: vm.name ?? name,
      restoredPid: vm.pid,
      targetRestore,
      targetVerify,
      workloads: {
        filesystem: (targetVerify.filesystem as Record<string, unknown>)?.accepted === true,
        service: (targetVerify.service as Record<string, unknown>)?.accepted === true,
        sqlite: (targetVerify.sqlite as Record<string, unknown>)?.accepted === true,
        nodejs: summarizePortableVmNodePlan(snapDir, targetVerify),
      },
      portableVmPlan: summarizePortableVmRestorePlan(snapDir),
      claimGuard: portableVmClaimGuard(),
      elapsedMs: Date.now() - started,
    };
    writeFileSync(
      join(snapDir, "portable-vm-product-restore-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    continuationStarted = true;
    reportPortableVmRestoreSummary(json, summary);
    return 0;
  } catch (error) {
    const refusal = portableVmRestoreRefusal(
      "portable-vm-target-restore-failed",
      describeError(error),
      sourceArch,
      targetArch,
    );
    writeFileSync(
      join(snapDir, "portable-vm-product-restore-summary.json"),
      `${JSON.stringify(refusal, null, 2)}\n`,
    );
    reportPortableVmRestoreSummary(json, refusal);
    return 1;
  } finally {
    if (continuationStarted) {
      await vm.detach();
    } else {
      await vm.kill().catch(() => undefined);
    }
  }
}

// fallow-ignore-next-line complexity
function evaluatePortableVmRestorePlan(
  snapDir: string,
  sourceArch: GuestCpu,
  targetArch: GuestCpu,
): { code: string; message: string } | null {
  const planPath = join(snapDir, "portable-vm-manifest-plan.json");
  if (!existsSync(planPath)) {
    return {
      code: "portable-vm-portability-plan-missing",
      message:
        "portable VM restore requires a generated Portable VM Manifest / VM Portability Plan",
    };
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as Record<string, unknown>;
  if (plan.kind !== PORTABLE_VM_PLAN_KIND) {
    return {
      code: "portable-vm-portability-plan-invalid",
      message: "portable VM plan kind is invalid",
    };
  }
  if (plan.scope !== PORTABLE_VM_PRODUCT_SCOPE) {
    return {
      code: "portable-vm-portability-plan-invalid",
      message: "portable VM plan scope is invalid",
    };
  }
  if (plan.sourceArchitecture !== sourceArch) {
    return {
      code: "portable-vm-source-architecture-mismatch",
      message: `portable VM plan source architecture ${String(plan.sourceArchitecture)} does not match bundle source architecture ${sourceArch}`,
    };
  }
  const allowedTargets = (plan.targetPolicy as Record<string, unknown> | undefined)
    ?.allowedTargetArchitectures;
  if (Array.isArray(allowedTargets) && !allowedTargets.includes(targetArch)) {
    return {
      code: "portable-vm-target-architecture-unsupported",
      message: `portable VM plan does not allow target architecture ${targetArch}`,
    };
  }
  const rows = portableVmPlanRows(plan);
  const refused = rows.find((row) => row.disposition === "refused");
  if (refused) {
    return {
      code:
        typeof refused.refusalCode === "string"
          ? refused.refusalCode
          : "portable-vm-plan-row-refused",
      message:
        typeof refused.message === "string"
          ? refused.message
          : `portable VM plan refused ${String(refused.id ?? refused.category ?? "unknown row")}`,
    };
  }
  for (const required of ["filesystem", "service", "sqlite"] as const) {
    const row = rows.find((candidate) => candidate.category === required);
    if (!row || row.disposition !== "product-supported") {
      return {
        code: "portable-vm-required-plan-row-missing",
        message: `portable VM plan is missing required product-supported ${required} row`,
      };
    }
  }
  return null;
}

function portableVmPlanRows(plan: Record<string, unknown>): Array<Record<string, unknown>> {
  const restorePlan = plan.restorePlan as Record<string, unknown> | undefined;
  return Array.isArray(restorePlan?.rows)
    ? (restorePlan.rows as Array<Record<string, unknown>>)
    : [];
}

function preparePortableVmNodeMemoryMaterializer(
  snapDir: string,
): { code: string; message: string } | null {
  const irPath = join(snapDir, "nodejs-memory-ir.json");
  if (!existsSync(irPath)) {
    return null;
  }
  const parsed = parsePortableVmNodeMemoryIr(irPath);
  const validation = validateNodejsMemoryIrDocument(parsed);
  if (!validation.accepted) {
    return {
      code: validation.refusalCode ?? NODEJS_MEMORY_IR_INVALID_REFUSAL_CODE,
      message: `Node memory IR is not materializable: ${validation.errors.join("; ")}`,
    };
  }
  writeFileSync(
    join(snapDir, NODEJS_MEMORY_IR_MATERIALIZER_FILENAME),
    createNodejsMemoryIrMaterializerModule(),
  );
  return null;
}

function parsePortableVmNodeMemoryIr(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    return { kind: "invalid-json", error: describeError(error) };
  }
}

function summarizePortableVmRestorePlan(snapDir: string): Record<string, unknown> {
  const plan = JSON.parse(
    readFileSync(join(snapDir, "portable-vm-manifest-plan.json"), "utf8"),
  ) as Record<string, unknown>;
  const rows = portableVmPlanRows(plan);
  return {
    kind: PORTABLE_VM_PLAN_KIND,
    scope: plan.scope,
    sourceArchitecture: plan.sourceArchitecture,
    rowCount: rows.length,
    productSupportedRows: rows.filter((row) => row.disposition === "product-supported").length,
    refusedRows: rows.filter((row) => row.disposition === "refused").length,
    nodejsRows: rows.filter((row) => row.category === "nodejs").length,
    nodejsClassifiedRows: rows.filter(
      (row) => row.category === "nodejs" && row.disposition === "classified",
    ).length,
    nodejsMemoryRows: rows.filter(
      (row) => row.category === "nodejs" && row.id === "nodejs-memory-ir",
    ).length,
    unknownStatePolicy: (plan.targetPolicy as Record<string, unknown> | undefined)
      ?.unknownStatePolicy,
  };
}

function summarizePortableVmNodePlan(
  snapDir: string,
  targetVerify?: Record<string, unknown>,
): Record<string, unknown> {
  const plan = JSON.parse(
    readFileSync(join(snapDir, "portable-vm-manifest-plan.json"), "utf8"),
  ) as Record<string, unknown>;
  const rows = portableVmPlanRows(plan).filter((row) => row.category === "nodejs");
  return {
    ...summarizePortableVmNodeRows(rows),
    ...summarizePortableVmNodeMemoryVerifier(targetVerify),
    arbitraryNodeProcessRestoreClaimed: false,
    rawV8HeapRestoreUsed: false,
  };
}

function summarizePortableVmNodeRows(
  rows: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    classified: rows.some((row) => row.disposition === "classified"),
    rowCount: rows.length,
    refusedRows: rows.filter((row) => row.disposition === "refused").length,
    memoryRows: rows.filter((row) => row.id === "nodejs-memory-ir").length,
    memoryMaterializationRows: rows.filter(isPortableVmNodeMemoryMaterializationRow).length,
  };
}

function summarizePortableVmNodeMemoryVerifier(
  targetVerify?: Record<string, unknown>,
): Record<string, unknown> {
  const nodejsMemory = portableVmNodeMemoryVerifierRecord(targetVerify);
  return {
    memoryVerified: nodejsMemory.accepted === true,
    memoryMaterializedRows: portableVmNodeMemoryMaterializedRows(nodejsMemory),
  };
}

function portableVmNodeMemoryVerifierRecord(
  targetVerify?: Record<string, unknown>,
): Record<string, unknown> {
  if (!targetVerify) {
    return {};
  }
  return portableVmRecordValue(targetVerify.nodejsMemory);
}

function portableVmNodeMemoryMaterializedRows(nodejsMemory: Record<string, unknown>): number {
  const rows = nodejsMemory.materializedRows;
  if (typeof rows !== "number") {
    return 0;
  }
  return rows;
}

function portableVmRecordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isPortableVmNodeMemoryMaterializationRow(row: Record<string, unknown>): boolean {
  return row.restoreStrategy === "materialize-nodejs-memory-ir-target-native";
}

function portableVmRestoreRefusal(
  code: string,
  message: string,
  sourceArch: GuestCpu,
  targetArch: GuestCpu,
): Record<string, unknown> {
  return {
    kind: "machinen.portable-vm-product-restore-summary",
    version: 1,
    accepted: false,
    scope: PORTABLE_VM_PRODUCT_SCOPE,
    state: "refused",
    migrationCompleted: false,
    sourceArch,
    targetArch,
    sourceArchitectureDetected: true,
    targetArchitectureDetected: true,
    refusal: { code, message },
    claimGuard: portableVmClaimGuard(),
  };
}

function portableVmClaimGuard(): Record<string, false> {
  return {
    arbitraryVmRestoreClaimed: false,
    rawVmStateReplayUsed: false,
    sourceIsaEmulationUsed: false,
    metadataOnlyShortcutAccepted: false,
  };
}

// fallow-ignore-next-line complexity
function reportPortableVmRestoreSummary(json: boolean, summary: Record<string, unknown>): void {
  if (json) {
    emitJson({ schema_version: 1, ...summary });
    return;
  }
  if (summary.accepted === true) {
    process.stdout.write("portable VM restore completed\n");
    return;
  }
  const refusal = summary.refusal as { code?: string; message?: string } | undefined;
  process.stderr.write(`portable VM restore refused: ${refusal?.code ?? "unknown"}\n`);
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
    "       machinen restore <portable-postgres-bundle> --target-arch <arm64|amd64> " +
    "--target-verifier-output <file> [--json]\n" +
    "       machinen restore <portable-postgres-bundle> --target-arch <arm64|amd64> " +
    "--postgres-container <name> --database <db> --target-verifier-sql <file> " +
    "[--postgres-docker-host local|user@host] [--json]\n" +
    "       machinen restore <portable-eventfd-bundle> --target-arch <arm64|amd64> " +
    "[--target-verifier-output <file>] [--json]\n" +
    "       machinen restore <portable-pipe-bundle> --target-arch <arm64|amd64> " +
    "[--target-verifier-output <file>] [--json]\n" +
    "       machinen restore <portable-timerfd-bundle> --target-arch <arm64|amd64> " +
    "[--target-verifier-output <file>] [--json]\n" +
    "       machinen restore <portable-tcp-listener-bundle> --target-arch <arm64|amd64> " +
    "[--target-verifier-output <file>] [--json]\n" +
    "       machinen restore <portable-ping-socket-bundle> --target-arch <arm64|amd64> " +
    "[--target-verifier-output <file>] [--json]\n" +
    "       machinen restore <selected-native-bundle> --target-arch <arm64|amd64> " +
    "--target-verifier-output <file> [--json]\n" +
    "       machinen restore <node-level5-proof-bundle> " +
    "[--allow-proof-only-success] [--json]\n" +
    "       machinen restore node-level5 --experimental-node-level5 <manifest> [--json]"
  );
}

// fallow-ignore-next-line complexity
function cmdRestoreProductPortablePostgres(
  parsed: ParsedRestoreCommandArgs,
  snapDir: string,
  json: boolean,
): number {
  if (!parsed.targetArch) {
    die(restoreUsage());
  }
  const dockerRestore = parsed.targetVerifierOutput === undefined;
  if (dockerRestore) {
    if (
      !parsed.postgresContainer ||
      !parsed.postgresDatabase ||
      !parsed.postgresTargetVerifierSql
    ) {
      die(restoreUsage());
    }
  }
  try {
    const postgresEvidence = dockerRestore
      ? restorePostgresDockerBundle(snapDir, parsed)
      : undefined;
    const summary = restoreProductPortablePostgresSnapshot({
      bundleDir: snapDir,
      targetArch: parsed.targetArch,
      targetVerifierOutput:
        postgresEvidence?.targetVerifierOutput ??
        readFileSync(resolve(parsed.targetVerifierOutput!), "utf8").trim(),
    });
    return reportProductRestoreResult(json, summary, {
      restored: `restored portable postgres bundle: ${snapDir}\n`,
      refusedPrefix: "refused portable postgres restore",
    });
  } catch (err) {
    handleProductPortablePostgresError(err, json);
  }
}

// fallow-ignore-next-line complexity
function cmdRestoreProductSelectedNative(
  parsed: ParsedRestoreCommandArgs,
  snapDir: string,
  json: boolean,
): number {
  if (!parsed.targetArch || !parsed.targetVerifierOutput) {
    die(restoreUsage());
  }
  try {
    const summary = restoreProductSelectedNativeSnapshot({
      bundleDir: snapDir,
      targetArch: parsed.targetArch,
      targetVerifierOutput: readFileSync(resolve(parsed.targetVerifierOutput), "utf8").trim(),
    });
    return reportProductRestoreResult(json, summary, {
      restored: `restored selected native bundle: ${snapDir}\n`,
      refusedPrefix: "refused selected native restore",
    });
  } catch (err) {
    handleProductSelectedNativeError(err, json);
  }
}

// fallow-ignore-next-line complexity
function reportProductRestoreResult(
  json: boolean,
  summary: {
    migrationCompleted: boolean;
    refusal?: { expectedRefusalCode?: string };
  },
  messages: { restored: string; refusedPrefix: string },
): number {
  if (json) {
    emitJson({ schema_version: 1, ...summary });
  } else if (summary.migrationCompleted) {
    process.stderr.write(messages.restored);
  } else {
    process.stderr.write(
      `${messages.refusedPrefix}: ${summary.refusal?.expectedRefusalCode ?? "unknown"}\n`,
    );
  }
  return summary.migrationCompleted ? 0 : 1;
}

type TcpListenerPortableRestoreValidation =
  | {
      ok: true;
      descriptor: ProductLevel4TcpListenerDescriptor;
      summary: ProductLevel4TcpListenerRestoreSummary;
    }
  | {
      ok: false;
      descriptor?: ProductLevel4TcpListenerDescriptor;
      summary: ProductLevel4TcpListenerRestoreSummary;
    };

type TcpListenerPortableRestorePlan = PortableRestoreWorkloadPlan & {
  descriptor: ProductLevel4TcpListenerDescriptor;
  summary: ProductLevel4TcpListenerRestoreSummary;
};

type TimerfdPortableRestoreValidation =
  | {
      ok: true;
      descriptor: ProductLevel4TimerfdDescriptor;
      summary: ProductLevel4TimerfdRestoreSummary;
    }
  | {
      ok: false;
      descriptor?: ProductLevel4TimerfdDescriptor;
      summary: ProductLevel4TimerfdRestoreSummary;
    };

type TimerfdPortableRestorePlan = PortableRestoreWorkloadPlan & {
  descriptor: ProductLevel4TimerfdDescriptor;
  summary: ProductLevel4TimerfdRestoreSummary;
};

type PipePortableRestoreValidation =
  | {
      ok: true;
      descriptor: ProductLevel4PipeDescriptor;
      summary: ProductLevel4PipeRestoreSummary;
    }
  | {
      ok: false;
      descriptor?: ProductLevel4PipeDescriptor;
      summary: ProductLevel4PipeRestoreSummary;
    };

type PipePortableRestorePlan = PortableRestoreWorkloadPlan & {
  descriptor: ProductLevel4PipeDescriptor;
  summary: ProductLevel4PipeRestoreSummary;
};

type EventfdPortableRestoreValidation =
  | {
      ok: true;
      descriptor: ProductLevel4EventfdDescriptor;
      summary: ProductLevel4EventfdRestoreSummary;
    }
  | {
      ok: false;
      descriptor?: ProductLevel4EventfdDescriptor;
      summary: ProductLevel4EventfdRestoreSummary;
    };

type EventfdPortableRestorePlan = PortableRestoreWorkloadPlan & {
  descriptor: ProductLevel4EventfdDescriptor;
  summary: ProductLevel4EventfdRestoreSummary;
};

type PingPortableRestoreValidation =
  | {
      ok: true;
      descriptor: ProductLevel4PingSocketDescriptor;
      summary: ProductLevel4PingSocketRestoreSummary;
    }
  | {
      ok: false;
      descriptor?: ProductLevel4PingSocketDescriptor;
      summary: ProductLevel4PingSocketRestoreSummary;
    };

type PingPortableRestorePlan = PortableRestoreWorkloadPlan & {
  descriptor: ProductLevel4PingSocketDescriptor;
  summary: ProductLevel4PingSocketRestoreSummary;
};

type RegisteredPortableRestoreAdapter = PortableRestoreAdapter<any, any, Record<string, unknown>>;

type PortableRestoreWorkloadPlan = {
  name: string;
  descriptorGuestPath: string;
  descriptorText: string;
  workloadLabel: string;
  foregroundCommand: string;
  detachedCommand: string;
  verifyCommand: string;
  summaryPath: string;
  buildDetachedSummary: (input: { vm: VmHandle; elapsedMs: number }) => Record<string, unknown>;
};

const tcpListenerPortableRestoreAdapter = {
  profile: "tcp-listener-v1-loopback-empty-accept-queue",
  detect: isProductLevel4TcpListenerBundle,
  validate: validateTcpListenerPortableRestore,
  plan: planTcpListenerPortableRestore,
  foregroundRestore: foregroundTcpListenerPortableRestore,
  detachedRestore: detachedTcpListenerPortableRestore,
  verify: verifyTcpListenerPortableRestore,
  refuse: refuseTcpListenerPortableRestore,
} satisfies PortableRestoreAdapter<
  TcpListenerPortableRestoreValidation,
  TcpListenerPortableRestorePlan,
  Record<string, unknown>
>;

const timerfdPortableRestoreAdapter = {
  profile: "timerfd-relative-oneshot-v1-monotonic",
  detect: isProductLevel4TimerfdBundle,
  validate: validateTimerfdPortableRestore,
  plan: planTimerfdPortableRestore,
  foregroundRestore: foregroundTimerfdPortableRestore,
  detachedRestore: detachedTimerfdPortableRestore,
  verify: verifyTimerfdPortableRestore,
  refuse: refuseTimerfdPortableRestore,
} satisfies PortableRestoreAdapter<
  TimerfdPortableRestoreValidation,
  TimerfdPortableRestorePlan,
  Record<string, unknown>
>;

const pipePortableRestoreAdapter = {
  profile: "pipe-pair-v1-empty-no-waiters",
  detect: isProductLevel4PipeBundle,
  validate: validatePipePortableRestore,
  plan: planPipePortableRestore,
  foregroundRestore: foregroundPipePortableRestore,
  detachedRestore: detachedPipePortableRestore,
  verify: verifyPipePortableRestore,
  refuse: refusePipePortableRestore,
} satisfies PortableRestoreAdapter<
  PipePortableRestoreValidation,
  PipePortableRestorePlan,
  Record<string, unknown>
>;

const eventfdPortableRestoreAdapter = {
  profile: "eventfd-counter-v1-nonsemaphore-no-waiters",
  detect: isProductLevel4EventfdBundle,
  validate: validateEventfdPortableRestore,
  plan: planEventfdPortableRestore,
  foregroundRestore: foregroundEventfdPortableRestore,
  detachedRestore: detachedEventfdPortableRestore,
  verify: verifyEventfdPortableRestore,
  refuse: refuseEventfdPortableRestore,
} satisfies PortableRestoreAdapter<
  EventfdPortableRestoreValidation,
  EventfdPortableRestorePlan,
  Record<string, unknown>
>;

const pingPortableRestoreAdapter = {
  profile: "ping-level4-socket-reconstruction-v1",
  detect: isProductLevel4PingSocketBundle,
  validate: validatePingPortableRestore,
  plan: planPingPortableRestore,
  foregroundRestore: foregroundPingPortableRestore,
  detachedRestore: detachedPingPortableRestore,
  verify: verifyPingPortableRestore,
  refuse: refusePingPortableRestore,
} satisfies PortableRestoreAdapter<
  PingPortableRestoreValidation,
  PingPortableRestorePlan,
  Record<string, unknown>
>;

const portableRestoreAdapters = [
  pingPortableRestoreAdapter,
  eventfdPortableRestoreAdapter,
  pipePortableRestoreAdapter,
  timerfdPortableRestoreAdapter,
  tcpListenerPortableRestoreAdapter,
] as const satisfies readonly RegisteredPortableRestoreAdapter[];

function detectPortableRestoreAdapter(
  snapDir: string,
): RegisteredPortableRestoreAdapter | undefined {
  return portableRestoreAdapters.find((adapter) => adapter.detect(snapDir));
}

// fallow-ignore-next-line complexity
async function cmdRestorePortableAdapter(
  adapter: RegisteredPortableRestoreAdapter,
  parsed: ParsedRestoreCommandArgs,
  snapDir: string,
  json: boolean,
): Promise<number> {
  if (!parsed.targetArch) {
    die(restoreUsage());
  }
  try {
    const validation = adapter.validate({ parsed, snapDir, json });
    if (!validation.ok) {
      return adapter.refuse({ parsed, snapDir, json, validation });
    }
    const plan = adapter.plan({ parsed, snapDir, json, validation });
    if (!json) {
      return await adapter.foregroundRestore({ parsed, snapDir, json, plan });
    }
    const summary = await adapter.detachedRestore({ parsed, snapDir, json, plan });
    emitJson({ schema_version: 1, ...summary });
    return 0;
  } catch (err) {
    handlePortableRestoreAdapterError(err, json);
  }
}

function validateTcpListenerPortableRestore({
  parsed,
  snapDir,
}: PortableRestoreValidationInput): TcpListenerPortableRestoreValidation {
  if (!parsed.targetArch) {
    die(restoreUsage());
  }
  const descriptor = readProductLevel4TcpListenerDescriptor(snapDir);
  const verifierOutput = parsed.targetVerifierOutput
    ? readFileSync(resolve(parsed.targetVerifierOutput), "utf8").trim()
    : descriptor.sourceVerifierOutput;
  const summary = restoreProductLevel4TcpListenerSnapshot({
    bundleDir: snapDir,
    targetArch: parsed.targetArch,
    targetVerifierOutput: verifierOutput,
  });
  if (!summary.migrationCompleted) {
    return { ok: false, descriptor, summary };
  }
  return { ok: true, descriptor, summary };
}

function planTcpListenerPortableRestore({
  parsed,
  snapDir,
  validation,
}: PortableRestorePlanInput<TcpListenerPortableRestoreValidation>): TcpListenerPortableRestorePlan {
  if (!validation.ok) {
    throw new ProductLevel4TcpListenerError(
      "TCP_LISTENER_RESTORE_PLAN_REFUSED",
      "cannot plan a refused TCP listener portable restore",
    );
  }
  assertLocalTcpListenerRestoreTargetArch(parsed.targetArch);
  const descriptor = validation.descriptor;
  const name = parsed.name ?? deriveBootName(snapDir);
  return {
    descriptor,
    summary: validation.summary,
    name,
    descriptorGuestPath: "/tmp/machinen-restored-tcp-listener-descriptor.json",
    descriptorText: JSON.stringify(descriptor, null, 2),
    workloadLabel: "restored TCP listener",
    foregroundCommand: foregroundRestoredTcpListenerCommand(descriptor),
    detachedCommand: startRestoredTcpListenerCommand(descriptor),
    verifyCommand: verifyRestoredTcpListenerCommand(descriptor),
    summaryPath: join(snapDir, "portable-tcp-listener-target-vm-restore-summary.json"),
    buildDetachedSummary: ({ vm, elapsedMs }) =>
      buildTcpListenerDetachedRestoreSummary({
        descriptor,
        summary: validation.summary,
        vm,
        name,
        elapsedMs,
      }),
  };
}

function foregroundTcpListenerPortableRestore({
  plan,
}: PortableRestoreExecutionInput<TcpListenerPortableRestorePlan>): Promise<number> {
  return runPortableForegroundRestore(plan);
}

function detachedTcpListenerPortableRestore({
  plan,
}: PortableRestoreExecutionInput<TcpListenerPortableRestorePlan>): Promise<
  Record<string, unknown>
> {
  return runPortableDetachedRestore(plan, tcpListenerPortableRestoreAdapter);
}

async function verifyTcpListenerPortableRestore({
  vm,
  plan,
}: PortableRestoreVerifyInput<TcpListenerPortableRestorePlan>): Promise<void> {
  const verify = await vm.execRaw(plan.verifyCommand, { execTimeoutMs: 20_000 });
  if (verify.exitCode !== 0) {
    throw new ProductLevel4TcpListenerError(
      "TCP_LISTENER_TARGET_VM_VERIFIER_FAILED",
      verify.stderr || verify.stdout || "target VM TCP listener verifier failed",
    );
  }
}

function refuseTcpListenerPortableRestore({
  json,
  snapDir,
  validation,
}: PortableRestoreRefusalInput<TcpListenerPortableRestoreValidation>): number {
  reportProductLevel4TcpListenerRestoreSummary(snapDir, json, validation.summary);
  return 1;
}

function validateTimerfdPortableRestore({
  parsed,
  snapDir,
}: PortableRestoreValidationInput): TimerfdPortableRestoreValidation {
  if (!parsed.targetArch) {
    die(restoreUsage());
  }
  const descriptor = readProductLevel4TimerfdDescriptor(snapDir);
  const verifierOutput = parsed.targetVerifierOutput
    ? readFileSync(resolve(parsed.targetVerifierOutput), "utf8").trim()
    : descriptor.sourceVerifierOutput;
  const summary = restoreProductLevel4TimerfdSnapshot({
    bundleDir: snapDir,
    targetArch: parsed.targetArch,
    targetVerifierOutput: verifierOutput,
  });
  if (!summary.migrationCompleted) {
    return { ok: false, descriptor, summary };
  }
  return { ok: true, descriptor, summary };
}

function planTimerfdPortableRestore({
  parsed,
  snapDir,
  validation,
}: PortableRestorePlanInput<TimerfdPortableRestoreValidation>): TimerfdPortableRestorePlan {
  if (!validation.ok) {
    throw new ProductLevel4TimerfdError(
      "TIMERFD_RESTORE_PLAN_REFUSED",
      "cannot plan a refused timerfd portable restore",
    );
  }
  assertLocalTimerfdRestoreTargetArch(parsed.targetArch);
  const descriptor = validation.descriptor;
  const name = parsed.name ?? deriveBootName(snapDir);
  return {
    descriptor,
    summary: validation.summary,
    name,
    descriptorGuestPath: "/tmp/machinen-restored-timerfd-descriptor.json",
    descriptorText: JSON.stringify(descriptor, null, 2),
    workloadLabel: "restored timerfd",
    foregroundCommand: foregroundRestoredTimerfdCommand(descriptor),
    detachedCommand: startRestoredTimerfdCommand(descriptor),
    verifyCommand: verifyRestoredTimerfdCommand(descriptor),
    summaryPath: join(snapDir, "portable-timerfd-target-vm-restore-summary.json"),
    buildDetachedSummary: ({ vm, elapsedMs }) =>
      buildTimerfdDetachedRestoreSummary({
        descriptor,
        summary: validation.summary,
        vm,
        name,
        elapsedMs,
      }),
  };
}

function foregroundTimerfdPortableRestore({
  plan,
}: PortableRestoreExecutionInput<TimerfdPortableRestorePlan>): Promise<number> {
  return runPortableForegroundRestore(plan);
}

function detachedTimerfdPortableRestore({
  plan,
}: PortableRestoreExecutionInput<TimerfdPortableRestorePlan>): Promise<Record<string, unknown>> {
  return runPortableDetachedRestore(plan, timerfdPortableRestoreAdapter);
}

async function verifyTimerfdPortableRestore({
  vm,
  plan,
}: PortableRestoreVerifyInput<TimerfdPortableRestorePlan>): Promise<void> {
  const verify = await vm.execRaw(plan.verifyCommand, { execTimeoutMs: 20_000 });
  if (verify.exitCode !== 0) {
    throw new ProductLevel4TimerfdError(
      "TIMERFD_TARGET_VM_VERIFIER_FAILED",
      verify.stderr || verify.stdout || "target VM timerfd verifier failed",
    );
  }
}

function refuseTimerfdPortableRestore({
  json,
  snapDir,
  validation,
}: PortableRestoreRefusalInput<TimerfdPortableRestoreValidation>): number {
  reportProductLevel4TimerfdRestoreSummary(snapDir, json, validation.summary);
  return 1;
}

function validatePipePortableRestore({
  parsed,
  snapDir,
}: PortableRestoreValidationInput): PipePortableRestoreValidation {
  if (!parsed.targetArch) {
    die(restoreUsage());
  }
  const descriptor = readProductLevel4PipeDescriptor(snapDir);
  const verifierOutput = parsed.targetVerifierOutput
    ? readFileSync(resolve(parsed.targetVerifierOutput), "utf8").trim()
    : descriptor.sourceVerifierOutput;
  const summary = restoreProductLevel4PipeSnapshot({
    bundleDir: snapDir,
    targetArch: parsed.targetArch,
    targetVerifierOutput: verifierOutput,
  });
  if (!summary.migrationCompleted) {
    return { ok: false, descriptor, summary };
  }
  return { ok: true, descriptor, summary };
}

function planPipePortableRestore({
  parsed,
  snapDir,
  validation,
}: PortableRestorePlanInput<PipePortableRestoreValidation>): PipePortableRestorePlan {
  if (!validation.ok) {
    throw new ProductLevel4PipeError(
      "PIPE_RESTORE_PLAN_REFUSED",
      "cannot plan a refused pipe portable restore",
    );
  }
  assertLocalPipeRestoreTargetArch(parsed.targetArch);
  const descriptor = validation.descriptor;
  const name = parsed.name ?? deriveBootName(snapDir);
  return {
    descriptor,
    summary: validation.summary,
    name,
    descriptorGuestPath: "/tmp/machinen-restored-pipe-descriptor.json",
    descriptorText: JSON.stringify(descriptor, null, 2),
    workloadLabel: "restored pipe",
    foregroundCommand: foregroundRestoredPipeCommand(descriptor),
    detachedCommand: startRestoredPipeCommand(descriptor),
    verifyCommand: verifyRestoredPipeCommand(descriptor),
    summaryPath: join(snapDir, "portable-pipe-target-vm-restore-summary.json"),
    buildDetachedSummary: ({ vm, elapsedMs }) =>
      buildPipeDetachedRestoreSummary({
        descriptor,
        summary: validation.summary,
        vm,
        name,
        elapsedMs,
      }),
  };
}

function foregroundPipePortableRestore({
  plan,
}: PortableRestoreExecutionInput<PipePortableRestorePlan>): Promise<number> {
  return runPortableForegroundRestore(plan);
}

function detachedPipePortableRestore({
  plan,
}: PortableRestoreExecutionInput<PipePortableRestorePlan>): Promise<Record<string, unknown>> {
  return runPortableDetachedRestore(plan, pipePortableRestoreAdapter);
}

async function verifyPipePortableRestore({
  vm,
  plan,
}: PortableRestoreVerifyInput<PipePortableRestorePlan>): Promise<void> {
  const verify = await vm.execRaw(plan.verifyCommand, { execTimeoutMs: 20_000 });
  if (verify.exitCode !== 0) {
    throw new ProductLevel4PipeError(
      "PIPE_TARGET_VM_VERIFIER_FAILED",
      verify.stderr || verify.stdout || "target VM pipe verifier failed",
    );
  }
}

function refusePipePortableRestore({
  json,
  snapDir,
  validation,
}: PortableRestoreRefusalInput<PipePortableRestoreValidation>): number {
  reportProductLevel4PipeRestoreSummary(snapDir, json, validation.summary);
  return 1;
}

function validateEventfdPortableRestore({
  parsed,
  snapDir,
}: PortableRestoreValidationInput): EventfdPortableRestoreValidation {
  if (!parsed.targetArch) {
    die(restoreUsage());
  }
  const descriptor = readProductLevel4EventfdDescriptor(snapDir);
  const verifierOutput = parsed.targetVerifierOutput
    ? readFileSync(resolve(parsed.targetVerifierOutput), "utf8").trim()
    : descriptor.sourceVerifierOutput;
  const summary = restoreProductLevel4EventfdSnapshot({
    bundleDir: snapDir,
    targetArch: parsed.targetArch,
    targetVerifierOutput: verifierOutput,
  });
  if (!summary.migrationCompleted) {
    return { ok: false, descriptor, summary };
  }
  return { ok: true, descriptor, summary };
}

function planEventfdPortableRestore({
  parsed,
  snapDir,
  validation,
}: PortableRestorePlanInput<EventfdPortableRestoreValidation>): EventfdPortableRestorePlan {
  if (!validation.ok) {
    throw new ProductLevel4EventfdError(
      "EVENTFD_RESTORE_PLAN_REFUSED",
      "cannot plan a refused eventfd portable restore",
    );
  }
  assertLocalEventfdRestoreTargetArch(parsed.targetArch);
  const descriptor = validation.descriptor;
  const name = parsed.name ?? deriveBootName(snapDir);
  return {
    descriptor,
    summary: validation.summary,
    name,
    descriptorGuestPath: "/tmp/machinen-restored-eventfd-descriptor.json",
    descriptorText: JSON.stringify(descriptor, null, 2),
    workloadLabel: "restored eventfd",
    foregroundCommand: foregroundRestoredEventfdCommand(descriptor),
    detachedCommand: startRestoredEventfdCommand(descriptor),
    verifyCommand: verifyRestoredEventfdCommand(descriptor),
    summaryPath: join(snapDir, "portable-eventfd-target-vm-restore-summary.json"),
    buildDetachedSummary: ({ vm, elapsedMs }) =>
      buildEventfdDetachedRestoreSummary({
        descriptor,
        summary: validation.summary,
        vm,
        name,
        elapsedMs,
      }),
  };
}

function foregroundEventfdPortableRestore({
  plan,
}: PortableRestoreExecutionInput<EventfdPortableRestorePlan>): Promise<number> {
  return runPortableForegroundRestore(plan);
}

function detachedEventfdPortableRestore({
  plan,
}: PortableRestoreExecutionInput<EventfdPortableRestorePlan>): Promise<Record<string, unknown>> {
  return runPortableDetachedRestore(plan, eventfdPortableRestoreAdapter);
}

async function verifyEventfdPortableRestore({
  vm,
  plan,
}: PortableRestoreVerifyInput<EventfdPortableRestorePlan>): Promise<void> {
  const verify = await vm.execRaw(plan.verifyCommand, { execTimeoutMs: 20_000 });
  if (verify.exitCode !== 0) {
    throw new ProductLevel4EventfdError(
      "EVENTFD_TARGET_VM_VERIFIER_FAILED",
      verify.stderr || verify.stdout || "target VM eventfd verifier failed",
    );
  }
}

function refuseEventfdPortableRestore({
  json,
  snapDir,
  validation,
}: PortableRestoreRefusalInput<EventfdPortableRestoreValidation>): number {
  reportProductLevel4EventfdRestoreSummary(snapDir, json, validation.summary);
  return 1;
}

function validatePingPortableRestore({
  parsed,
  snapDir,
}: PortableRestoreValidationInput): PingPortableRestoreValidation {
  if (!parsed.targetArch) {
    die(restoreUsage());
  }
  const descriptor = readProductLevel4PingSocketDescriptor(snapDir);
  const verifierOutput = parsed.targetVerifierOutput
    ? readFileSync(resolve(parsed.targetVerifierOutput), "utf8").trim()
    : descriptor.sourceVerifierOutput;
  const summary = restoreProductLevel4PingSocketSnapshot({
    bundleDir: snapDir,
    targetArch: parsed.targetArch,
    targetVerifierOutput: verifierOutput,
  });
  if (!summary.migrationCompleted) {
    return { ok: false, descriptor, summary };
  }
  return { ok: true, descriptor, summary };
}

function planPingPortableRestore({
  parsed,
  snapDir,
  validation,
}: PortableRestorePlanInput<PingPortableRestoreValidation>): PingPortableRestorePlan {
  if (!validation.ok) {
    throw new ProductLevel4PingSocketError(
      "PING_SOCKET_RESTORE_PLAN_REFUSED",
      "cannot plan a refused ping portable restore",
    );
  }
  assertLocalPingRestoreTargetArch(parsed.targetArch);
  const descriptor = validation.descriptor;
  const name = parsed.name ?? deriveBootName(snapDir);
  return {
    descriptor,
    summary: validation.summary,
    name,
    descriptorGuestPath: "/tmp/machinen-restored-ping-descriptor.json",
    descriptorText: JSON.stringify(descriptor, null, 2),
    workloadLabel: "restored ping",
    foregroundCommand: foregroundRestoredPingCommand(descriptor),
    detachedCommand: startRestoredPingCommand(descriptor),
    verifyCommand: verifyRestoredPingCommand(descriptor),
    summaryPath: join(snapDir, "portable-ping-socket-target-vm-restore-summary.json"),
    buildDetachedSummary: ({ vm, elapsedMs }) =>
      buildPingDetachedRestoreSummary({
        descriptor,
        summary: validation.summary,
        vm,
        name,
        elapsedMs,
      }),
  };
}

function foregroundPingPortableRestore({
  plan,
}: PortableRestoreExecutionInput<PingPortableRestorePlan>): Promise<number> {
  return runPortableForegroundRestore(plan);
}

function detachedPingPortableRestore({
  plan,
}: PortableRestoreExecutionInput<PingPortableRestorePlan>): Promise<Record<string, unknown>> {
  return runPortableDetachedRestore(plan, pingPortableRestoreAdapter);
}

async function verifyPingPortableRestore({
  vm,
  plan,
}: PortableRestoreVerifyInput<PingPortableRestorePlan>): Promise<void> {
  const verify = await vm.execRaw(plan.verifyCommand, { execTimeoutMs: 20_000 });
  if (verify.exitCode !== 0) {
    throw new ProductLevel4PingSocketError(
      "PING_SOCKET_TARGET_VM_VERIFIER_FAILED",
      verify.stderr || verify.stdout || "target VM ping verifier failed",
    );
  }
}

function refusePingPortableRestore({
  json,
  snapDir,
  validation,
}: PortableRestoreRefusalInput<PingPortableRestoreValidation>): number {
  reportProductLevel4PingSocketRestoreSummary(snapDir, json, validation.summary);
  return 1;
}

function readProductLevel4TcpListenerDescriptor(
  snapDir: string,
): ProductLevel4TcpListenerDescriptor {
  return JSON.parse(
    readFileSync(join(snapDir, "portable-tcp-listener.json"), "utf8"),
  ) as ProductLevel4TcpListenerDescriptor;
}

function reportProductLevel4TcpListenerRestoreSummary(
  snapDir: string,
  json: boolean,
  summary: ProductLevel4TcpListenerRestoreSummary,
): void {
  if (json) {
    emitJson({ schema_version: 1, ...summary });
  } else {
    process.stderr.write(
      `refused portable TCP listener restore: ${summary.refusal?.expectedRefusalCode ?? "unknown"}\n`,
    );
  }
}

function readProductLevel4TimerfdDescriptor(snapDir: string): ProductLevel4TimerfdDescriptor {
  return JSON.parse(
    readFileSync(join(snapDir, "portable-timerfd.json"), "utf8"),
  ) as ProductLevel4TimerfdDescriptor;
}

function reportProductLevel4TimerfdRestoreSummary(
  snapDir: string,
  json: boolean,
  summary: ProductLevel4TimerfdRestoreSummary,
): void {
  if (json) {
    emitJson({ schema_version: 1, ...summary });
  } else {
    process.stderr.write(
      `refused portable timerfd restore: ${summary.refusal?.expectedRefusalCode ?? "unknown"}\n`,
    );
  }
}

function readProductLevel4PipeDescriptor(snapDir: string): ProductLevel4PipeDescriptor {
  return JSON.parse(
    readFileSync(join(snapDir, "portable-pipe.json"), "utf8"),
  ) as ProductLevel4PipeDescriptor;
}

function reportProductLevel4PipeRestoreSummary(
  snapDir: string,
  json: boolean,
  summary: ProductLevel4PipeRestoreSummary,
): void {
  if (json) {
    emitJson({ schema_version: 1, ...summary });
  } else {
    process.stderr.write(
      `refused portable pipe restore: ${summary.refusal?.expectedRefusalCode ?? "unknown"}\n`,
    );
  }
}

function readProductLevel4EventfdDescriptor(snapDir: string): ProductLevel4EventfdDescriptor {
  return JSON.parse(
    readFileSync(join(snapDir, "portable-eventfd.json"), "utf8"),
  ) as ProductLevel4EventfdDescriptor;
}

function reportProductLevel4EventfdRestoreSummary(
  snapDir: string,
  json: boolean,
  summary: ProductLevel4EventfdRestoreSummary,
): void {
  if (json) {
    emitJson({ schema_version: 1, ...summary });
  } else {
    process.stderr.write(
      `refused portable eventfd restore: ${summary.refusal?.expectedRefusalCode ?? "unknown"}\n`,
    );
  }
}

function readProductLevel4PingSocketDescriptor(snapDir: string): ProductLevel4PingSocketDescriptor {
  return JSON.parse(
    readFileSync(join(snapDir, "portable-ping-socket.json"), "utf8"),
  ) as ProductLevel4PingSocketDescriptor;
}

function reportProductLevel4PingSocketRestoreSummary(
  snapDir: string,
  json: boolean,
  summary: ProductLevel4PingSocketRestoreSummary,
): void {
  if (json) {
    emitJson({ schema_version: 1, ...summary });
  } else {
    process.stderr.write(
      `refused portable ping socket restore: ${summary.refusal?.expectedRefusalCode ?? "unknown"}\n`,
    );
  }
}

async function runPortableForegroundRestore(input: PortableRestoreWorkloadPlan): Promise<number> {
  const paths = await resolveCliBaseAssets();
  process.stderr.write(`restoring portable workload as foreground VM: ${input.name}\n`);
  process.stderr.write("booting target VM...\n");
  const vm = await boot({
    image: paths.defaultImagePath,
    kernel: paths.kernelPath,
    dtb: paths.dtbPath,
    name: input.name,
    detached: true,
    cmd: ["sleep", "100000"],
    timeoutMs: undefined,
  });
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
    process.stderr.write("\nportable restore interrupted; stopping target VM...\n");
    void vm
      .kill()
      .catch(() => undefined)
      .finally(() => process.exit(130));
  };
  process.on("SIGINT", onSigint);
  try {
    process.stderr.write(`target VM ready; attaching ${input.workloadLabel}...\n`);
    await vm.writeFile(input.descriptorGuestPath, input.descriptorText);
    const result = await vm
      .execRaw(input.foregroundCommand, {
        onStdout: (chunk) => process.stdout.write(chunk),
        onStderr: (chunk) => process.stderr.write(chunk),
        execTimeoutMs: null,
      })
      .catch((err: unknown) => {
        if (interrupted) {
          return { exitCode: 130 };
        }
        throw err;
      });
    return interrupted ? 130 : result.exitCode;
  } finally {
    process.off("SIGINT", onSigint);
    await vm.kill().catch(() => undefined);
  }
}

async function runPortableDetachedRestore(
  plan: PortableRestoreWorkloadPlan,
  adapter: Pick<
    PortableRestoreAdapter<any, PortableRestoreWorkloadPlan, Record<string, unknown>>,
    "verify"
  >,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const paths = await resolveCliBaseAssets();
  const vm = await boot({
    image: paths.defaultImagePath,
    kernel: paths.kernelPath,
    dtb: paths.dtbPath,
    name: plan.name,
    detached: true,
    cmd: ["sleep", "100000"],
    timeoutMs: undefined,
  });
  let continuationStarted = false;
  try {
    await vm.writeFile(plan.descriptorGuestPath, plan.descriptorText);
    await vm.execRaw(plan.detachedCommand, { execTimeoutMs: 15_000 });
    await adapter.verify({ vm, plan });
    const summary = plan.buildDetachedSummary({ vm, elapsedMs: Date.now() - started });
    writeFileSync(plan.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    continuationStarted = true;
    return summary;
  } finally {
    if (continuationStarted) {
      await vm.detach();
    } else {
      await vm.kill().catch(() => undefined);
    }
  }
}

function buildDetachedRestoreTargetVmFields(input: { vm: VmHandle; name: string }) {
  return {
    targetVerifierResult: "passed",
    targetVmStarted: true,
    restoredName: input.vm.name ?? input.name,
    restoredPid: input.vm.pid,
    targetOutputObserved: true,
  };
}

function buildDetachedRestoreSummaryBase(input: {
  summary: object;
  vm: VmHandle;
  name: string;
  outputLogPath: string;
  processField: string;
  elapsedMs: number;
}): Record<string, unknown> {
  return {
    ...input.summary,
    ...buildDetachedRestoreTargetVmFields({ vm: input.vm, name: input.name }),
    outputLogPath: input.outputLogPath,
    [input.processField]: "running",
    elapsedMs: input.elapsedMs,
  };
}

function buildDetachedRestoreSummaryWithSemantics(input: {
  summary: object;
  vm: VmHandle;
  name: string;
  outputLogPath: string;
  processField: string;
  elapsedMs: number;
  continuationSemantics: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...buildDetachedRestoreSummaryBase(input),
    continuationSemantics: input.continuationSemantics,
  };
}

function buildDescriptorDetachedRestoreSummary<TDescriptor, TSummary extends object>(
  input: {
    descriptor: TDescriptor;
    summary: TSummary;
    vm: VmHandle;
    name: string;
    elapsedMs: number;
  },
  details: (descriptor: TDescriptor) => {
    outputLogPath: string;
    processField: string;
    continuationSemantics: Record<string, unknown>;
  },
): Record<string, unknown> {
  return buildDetachedRestoreSummaryWithSemantics({
    summary: input.summary,
    vm: input.vm,
    name: input.name,
    elapsedMs: input.elapsedMs,
    ...details(input.descriptor),
  });
}

function buildTcpListenerDetachedRestoreSummary(input: {
  descriptor: ProductLevel4TcpListenerDescriptor;
  summary: ProductLevel4TcpListenerRestoreSummary;
  vm: VmHandle;
  name: string;
  elapsedMs: number;
}): Record<string, unknown> {
  return buildDescriptorDetachedRestoreSummary(input, (descriptor) => ({
    outputLogPath: descriptor.continuation.outputLogPath,
    processField: "targetTcpListenerProcess",
    continuationSemantics: {
      family: descriptor.listener.family,
      protocol: descriptor.listener.protocol,
      bindAddress: descriptor.listener.bindAddress,
      port: descriptor.listener.port,
      backlog: descriptor.listener.backlog,
      reuseAddr: descriptor.listener.reuseAddr,
      acceptQueue: descriptor.listener.acceptQueue,
      listenerPolicy: descriptor.continuation.listenerPolicy,
      acceptQueuePolicy: descriptor.continuation.acceptQueuePolicy,
    },
  }));
}

function buildTimerfdDetachedRestoreSummary(input: {
  descriptor: ProductLevel4TimerfdDescriptor;
  summary: ProductLevel4TimerfdRestoreSummary;
  vm: VmHandle;
  name: string;
  elapsedMs: number;
}): Record<string, unknown> {
  return buildDescriptorDetachedRestoreSummary(input, (descriptor) => ({
    outputLogPath: descriptor.continuation.outputLogPath,
    processField: "targetTimerfdProcess",
    continuationSemantics: {
      clock: descriptor.timerfd.clock,
      mode: descriptor.timerfd.mode,
      remainingMs: descriptor.timerfd.remainingMs,
      intervalMs: descriptor.timerfd.intervalMs,
      unreadExpirations: descriptor.timerfd.unreadExpirations,
      closeOnExec: descriptor.timerfd.closeOnExec,
      timerPolicy: descriptor.continuation.timerPolicy,
      expirationPolicy: descriptor.continuation.expirationPolicy,
    },
  }));
}

function buildPipeDetachedRestoreSummary(input: {
  descriptor: ProductLevel4PipeDescriptor;
  summary: ProductLevel4PipeRestoreSummary;
  vm: VmHandle;
  name: string;
  elapsedMs: number;
}): Record<string, unknown> {
  return buildDescriptorDetachedRestoreSummary(input, (descriptor) => ({
    outputLogPath: descriptor.continuation.outputLogPath,
    processField: "targetPipeProcess",
    continuationSemantics: {
      readFd: descriptor.pipe.readFd,
      writeFd: descriptor.pipe.writeFd,
      buffer: descriptor.pipe.buffer,
      peerLifetime: descriptor.pipe.peerLifetime,
      waiters: descriptor.pipe.waiters,
      readiness: descriptor.pipe.readiness,
      closeOnExec: descriptor.pipe.closeOnExec,
      pipePolicy: descriptor.continuation.pipePolicy,
      readinessPolicy: descriptor.continuation.readinessPolicy,
    },
  }));
}

function buildEventfdDetachedRestoreSummary(input: {
  descriptor: ProductLevel4EventfdDescriptor;
  summary: ProductLevel4EventfdRestoreSummary;
  vm: VmHandle;
  name: string;
  elapsedMs: number;
}): Record<string, unknown> {
  return buildDescriptorDetachedRestoreSummary(input, (descriptor) => ({
    outputLogPath: descriptor.continuation.outputLogPath,
    processField: "targetEventfdProcess",
    continuationSemantics: {
      counter: descriptor.eventfd.counter,
      semaphore: descriptor.eventfd.semaphore,
      waiters: descriptor.eventfd.waiters,
      aliases: descriptor.eventfd.aliases,
      readiness: descriptor.eventfd.readiness,
      closeOnExec: descriptor.eventfd.closeOnExec,
      counterPolicy: descriptor.continuation.counterPolicy,
      readinessPolicy: descriptor.continuation.readinessPolicy,
    },
  }));
}

// fallow-ignore-next-line complexity
function buildPingDetachedRestoreSummary(input: {
  descriptor: ProductLevel4PingSocketDescriptor;
  summary: ProductLevel4PingSocketRestoreSummary;
  vm: VmHandle;
  name: string;
  elapsedMs: number;
}): Record<string, unknown> {
  const { descriptor, summary, vm, name, elapsedMs } = input;
  return buildDetachedRestoreSummaryWithSemantics({
    summary,
    vm,
    name,
    elapsedMs,
    outputLogPath: descriptor.continuation?.outputLogPath ?? "/tmp/machinen-restored-ping.log",
    processField: "targetPingProcess",
    continuationSemantics: {
      destination: descriptor.continuation?.destination ?? "127.0.0.1",
      intervalMs: descriptor.continuation?.intervalMs ?? 1000,
      echoIdentifier: descriptor.socket.echoIdentifier,
      nextSequence: descriptor.socket.echoSequence,
      sequencePolicy:
        descriptor.continuation?.sequencePolicy ?? "continue-at-next-supported-boundary",
      idPolicy:
        descriptor.continuation?.idPolicy ?? "descriptor-preserved-when-target-ping-supports-it",
      textOutputSequencePolicy:
        descriptor.continuation?.textOutputSequencePolicy ??
        "machinen-helper-renders-descriptor-sequence",
    },
  });
}

function assertLocalTcpListenerRestoreTargetArch(targetArch: string | undefined): void {
  if (targetArch !== guestCpu()) {
    throw new ProductLevel4TcpListenerError(
      "TCP_LISTENER_TARGET_GUEST_ARCH_MISMATCH",
      `target arch ${targetArch} requires restoring on a ${targetArch} Machinen guest host; current guest arch is ${guestCpu()}`,
    );
  }
}

function foregroundRestoredTcpListenerCommand(
  descriptor: ProductLevel4TcpListenerDescriptor,
): string {
  return (
    "echo $$ >/tmp/machinen-restored-tcp-listener.pid; exec " +
    restoredTcpListenerPerlCommand(descriptor)
  );
}

function startRestoredTcpListenerCommand(descriptor: ProductLevel4TcpListenerDescriptor): string {
  const logPath = descriptor.continuation.outputLogPath;
  return (
    `rm -f ${shellQuote(logPath)} /tmp/machinen-restored-tcp-listener.pid; ` +
    `( exec ${restoredTcpListenerPerlCommand(descriptor)} ) >${shellQuote(logPath)} 2>&1 & ` +
    "echo $! >/tmp/machinen-restored-tcp-listener.pid"
  );
}

function restoredTcpListenerPerlCommand(descriptor: ProductLevel4TcpListenerDescriptor): string {
  return `perl -e ${shellQuote(restoredTcpListenerPerlProgram(descriptor))}`;
}

function restoredTcpListenerPerlProgram(descriptor: ProductLevel4TcpListenerDescriptor): string {
  return [
    "use strict; use warnings; $|=1; use Socket qw(AF_INET SOCK_STREAM SOL_SOCKET SO_REUSEADDR inet_aton sockaddr_in);",
    'socket(my $srv, AF_INET, SOCK_STREAM, 0) or die "socket: $!\\n";',
    'setsockopt($srv, SOL_SOCKET, SO_REUSEADDR, pack("i", 1)) or die "setsockopt reuseaddr: $!\\n";',
    `my $addr = ${perlStringLiteral(descriptor.listener.bindAddress)}; my $port = ${descriptor.listener.port}; my $backlog = ${descriptor.listener.backlog};`,
    'bind($srv, sockaddr_in($port, inet_aton($addr))) or die "bind: $!\\n";',
    'listen($srv, $backlog) or die "listen: $!\\n";',
    'print "MACHINEN_TCP_LISTENER_RESTORED family=inet protocol=tcp bind=$addr:$port backlog=$backlog acceptQueue=empty reuseaddr=true fd=" . fileno($srv) . "\\n";',
    "my $alive = 0;",
    "$SIG{TERM} = sub { exit 0; };",
    'while (1) { sleep 1; $alive++; print "MACHINEN_TCP_LISTENER_ALIVE bind=$addr:$port tick=$alive\\n"; }',
  ].join(" ");
}

function verifyRestoredTcpListenerCommand(descriptor: ProductLevel4TcpListenerDescriptor): string {
  const logPath = descriptor.continuation.outputLogPath;
  return [
    "pid=$(cat /tmp/machinen-restored-tcp-listener.pid 2>/dev/null || true)",
    '[ -n "$pid" ] && [ -d "/proc/$pid" ] || exit 2',
    `for i in $(seq 1 20); do grep -q 'MACHINEN_TCP_LISTENER_RESTORED family=inet protocol=tcp bind=${descriptor.listener.bindAddress}:${descriptor.listener.port} backlog=${descriptor.listener.backlog}' ${shellQuote(logPath)} && exit 0; sleep 0.5; done`,
    `cat ${shellQuote(logPath)} 2>/dev/null`,
    "exit 3",
  ].join("; ");
}

function assertLocalTimerfdRestoreTargetArch(targetArch: string | undefined): void {
  if (targetArch !== guestCpu()) {
    throw new ProductLevel4TimerfdError(
      "TIMERFD_TARGET_GUEST_ARCH_MISMATCH",
      `target arch ${targetArch} requires restoring on a ${targetArch} Machinen guest host; current guest arch is ${guestCpu()}`,
    );
  }
}

function foregroundRestoredTimerfdCommand(descriptor: ProductLevel4TimerfdDescriptor): string {
  return (
    "echo $$ >/tmp/machinen-restored-timerfd.pid; exec " + restoredTimerfdPerlCommand(descriptor)
  );
}

function startRestoredTimerfdCommand(descriptor: ProductLevel4TimerfdDescriptor): string {
  const logPath = descriptor.continuation.outputLogPath;
  return (
    `rm -f ${shellQuote(logPath)} /tmp/machinen-restored-timerfd.pid; ` +
    `( exec ${restoredTimerfdPerlCommand(descriptor)} ) >${shellQuote(logPath)} 2>&1 & ` +
    "echo $! >/tmp/machinen-restored-timerfd.pid"
  );
}

function restoredTimerfdPerlCommand(descriptor: ProductLevel4TimerfdDescriptor): string {
  return `perl -e ${shellQuote(restoredTimerfdPerlProgram(descriptor))}`;
}

function restoredTimerfdPerlProgram(descriptor: ProductLevel4TimerfdDescriptor): string {
  const seconds = Math.floor(descriptor.timerfd.remainingMs / 1000);
  const nanoseconds = (descriptor.timerfd.remainingMs % 1000) * 1_000_000;
  return [
    "use strict; use warnings; $|=1;",
    "my $arch = qx(uname -m); chomp $arch;",
    'my $create = $arch eq "x86_64" ? 283 : 85;',
    'my $settime = $arch eq "x86_64" ? 286 : 86;',
    "my $CLOCK_MONOTONIC = 1; my $TFD_CLOEXEC = 02000000;",
    "my $fd = syscall($create, $CLOCK_MONOTONIC, $TFD_CLOEXEC);",
    'die "timerfd_create: $!\\n" if $fd < 0;',
    `my $seconds = ${seconds}; my $nanoseconds = ${nanoseconds};`,
    'my $spec = pack("q<q<q<q<", 0, 0, $seconds, $nanoseconds);',
    'syscall($settime, $fd, 0, $spec, 0) == 0 or die "timerfd_settime: $!\\n";',
    `my $remaining_ms = ${descriptor.timerfd.remainingMs};`,
    'print "MACHINEN_TIMERFD_RESTORED clock=monotonic mode=relative remainingMs=$remaining_ms intervalMs=0 expirations=0 flags=cloexec fd=$fd\\n";',
    "my $alive = 0;",
    "$SIG{TERM} = sub { exit 0; };",
    'while (1) { sleep 1; $alive++; print "MACHINEN_TIMERFD_ALIVE remainingMs=$remaining_ms tick=$alive\\n"; }',
  ].join(" ");
}

function verifyRestoredTimerfdCommand(descriptor: ProductLevel4TimerfdDescriptor): string {
  const logPath = descriptor.continuation.outputLogPath;
  return [
    "pid=$(cat /tmp/machinen-restored-timerfd.pid 2>/dev/null || true)",
    '[ -n "$pid" ] && [ -d "/proc/$pid" ] || exit 2',
    `for i in $(seq 1 20); do grep -q 'MACHINEN_TIMERFD_RESTORED clock=monotonic mode=relative remainingMs=${descriptor.timerfd.remainingMs}' ${shellQuote(logPath)} && exit 0; sleep 0.5; done`,
    `cat ${shellQuote(logPath)} 2>/dev/null`,
    "exit 3",
  ].join("; ");
}

function assertLocalPipeRestoreTargetArch(targetArch: string | undefined): void {
  if (targetArch !== guestCpu()) {
    throw new ProductLevel4PipeError(
      "PIPE_TARGET_GUEST_ARCH_MISMATCH",
      `target arch ${targetArch} requires restoring on a ${targetArch} Machinen guest host; current guest arch is ${guestCpu()}`,
    );
  }
}

function foregroundRestoredPipeCommand(descriptor: ProductLevel4PipeDescriptor): string {
  return "echo $$ >/tmp/machinen-restored-pipe.pid; exec " + restoredPipePerlCommand(descriptor);
}

function startRestoredPipeCommand(descriptor: ProductLevel4PipeDescriptor): string {
  const logPath = descriptor.continuation.outputLogPath;
  return (
    `rm -f ${shellQuote(logPath)} /tmp/machinen-restored-pipe.pid; ` +
    `( exec ${restoredPipePerlCommand(descriptor)} ) >${shellQuote(logPath)} 2>&1 & ` +
    "echo $! >/tmp/machinen-restored-pipe.pid"
  );
}

function restoredPipePerlCommand(descriptor: ProductLevel4PipeDescriptor): string {
  return `perl -e ${shellQuote(restoredPipePerlProgram(descriptor))}`;
}

function restoredPipePerlProgram(descriptor: ProductLevel4PipeDescriptor): string {
  return [
    "use strict; use warnings; $|=1; use Fcntl qw(F_GETFD F_SETFD FD_CLOEXEC);",
    'pipe(my $read, my $write) or die "pipe: $!\\n";',
    'fcntl($read, F_SETFD, FD_CLOEXEC) or die "pipe read cloexec: $!\\n";',
    'fcntl($write, F_SETFD, FD_CLOEXEC) or die "pipe write cloexec: $!\\n";',
    'my $rin = ""; vec($rin, fileno($read), 1) = 1;',
    "my $ready = select(my $rout = $rin, undef, undef, 0);",
    'die "pipe read end unexpectedly readable\\n" if $ready != 0;',
    `my $source_read_fd = ${descriptor.pipe.readFd};`,
    `my $source_write_fd = ${descriptor.pipe.writeFd};`,
    'print "MACHINEN_PIPE_RESTORED readFd=$source_read_fd writeFd=$source_write_fd targetReadFd=" . fileno($read) . " targetWriteFd=" . fileno($write) . " buffer=empty peer=open waiters=none readiness=not-readable flags=cloexec\\n";',
    "my $alive = 0;",
    "$SIG{TERM} = sub { exit 0; };",
    'while (1) { sleep 1; $alive++; print "MACHINEN_PIPE_ALIVE buffer=empty tick=$alive\\n"; }',
  ].join(" ");
}

function verifyRestoredPipeCommand(descriptor: ProductLevel4PipeDescriptor): string {
  const logPath = descriptor.continuation.outputLogPath;
  return [
    "pid=$(cat /tmp/machinen-restored-pipe.pid 2>/dev/null || true)",
    '[ -n "$pid" ] && [ -d "/proc/$pid" ] || exit 2',
    `for i in $(seq 1 20); do grep -q 'MACHINEN_PIPE_RESTORED readFd=${descriptor.pipe.readFd} writeFd=${descriptor.pipe.writeFd}' ${shellQuote(logPath)} && exit 0; sleep 0.5; done`,
    `cat ${shellQuote(logPath)} 2>/dev/null`,
    "exit 3",
  ].join("; ");
}

function assertLocalEventfdRestoreTargetArch(targetArch: string | undefined): void {
  if (targetArch !== guestCpu()) {
    throw new ProductLevel4EventfdError(
      "EVENTFD_TARGET_GUEST_ARCH_MISMATCH",
      `target arch ${targetArch} requires restoring on a ${targetArch} Machinen guest host; current guest arch is ${guestCpu()}`,
    );
  }
}

function foregroundRestoredEventfdCommand(descriptor: ProductLevel4EventfdDescriptor): string {
  return (
    "echo $$ >/tmp/machinen-restored-eventfd.pid; exec " + restoredEventfdPerlCommand(descriptor)
  );
}

function startRestoredEventfdCommand(descriptor: ProductLevel4EventfdDescriptor): string {
  const logPath = descriptor.continuation.outputLogPath;
  return (
    `rm -f ${shellQuote(logPath)} /tmp/machinen-restored-eventfd.pid; ` +
    `( exec ${restoredEventfdPerlCommand(descriptor)} ) >${shellQuote(logPath)} 2>&1 & ` +
    "echo $! >/tmp/machinen-restored-eventfd.pid"
  );
}

function restoredEventfdPerlCommand(descriptor: ProductLevel4EventfdDescriptor): string {
  return `perl -e ${shellQuote(restoredEventfdPerlProgram(descriptor))}`;
}

function restoredEventfdPerlProgram(descriptor: ProductLevel4EventfdDescriptor): string {
  const counter = descriptor.eventfd.counter;
  return [
    "use strict; use warnings; $|=1;",
    `my $counter = ${counter};`,
    "my $arch = qx(uname -m); chomp $arch;",
    'my $nr = $arch eq "x86_64" ? 290 : 19;',
    "my $EFD_CLOEXEC = 02000000;",
    "my $fd = syscall($nr, 0, $EFD_CLOEXEC);",
    'die "eventfd: $!\\n" if $fd < 0;',
    'open(my $efh, "+<&=", $fd) or die "eventfd fdopen: $!\\n";',
    'syswrite($efh, pack("Q<", $counter), 8) == 8 or die "eventfd write: $!\\n";',
    'sysread($efh, my $buf, 8) == 8 or die "eventfd read: $!\\n";',
    'my $observed = unpack("Q<", $buf);',
    'print "MACHINEN_EVENTFD_RESTORED counter=$observed semaphore=0 waiters=none aliases=none readiness=readable flags=cloexec fd=$fd\\n";',
    'syswrite($efh, pack("Q<", $observed), 8) == 8 or die "eventfd restore: $!\\n";',
    "my $alive = 0;",
    "$SIG{TERM} = sub { exit 0; };",
    'while (1) { sleep 1; $alive++; print "MACHINEN_EVENTFD_ALIVE counter=$observed tick=$alive\\n"; }',
  ].join(" ");
}

function verifyRestoredEventfdCommand(descriptor: ProductLevel4EventfdDescriptor): string {
  const logPath = descriptor.continuation.outputLogPath;
  return [
    "pid=$(cat /tmp/machinen-restored-eventfd.pid 2>/dev/null || true)",
    '[ -n "$pid" ] && [ -d "/proc/$pid" ] || exit 2',
    `for i in $(seq 1 20); do grep -q 'MACHINEN_EVENTFD_RESTORED counter=${descriptor.eventfd.counter}' ${shellQuote(logPath)} && exit 0; sleep 0.5; done`,
    `cat ${shellQuote(logPath)} 2>/dev/null`,
    "exit 3",
  ].join("; ");
}

function assertLocalPingRestoreTargetArch(targetArch: string | undefined): void {
  if (targetArch !== guestCpu()) {
    throw new ProductLevel4PingSocketError(
      "PING_SOCKET_TARGET_GUEST_ARCH_MISMATCH",
      `target arch ${targetArch} requires restoring on a ${targetArch} Machinen guest host; current guest arch is ${guestCpu()}`,
    );
  }
}

function foregroundRestoredPingCommand(descriptor: ProductLevel4PingSocketDescriptor): string {
  return "echo $$ >/tmp/machinen-restored-ping.pid; " + restoredPingLoopCommand(descriptor);
}

function startRestoredPingCommand(descriptor: ProductLevel4PingSocketDescriptor): string {
  const logPath = descriptor.continuation?.outputLogPath ?? "/tmp/machinen-restored-ping.log";
  return (
    `rm -f ${shellQuote(logPath)} /tmp/machinen-restored-ping.pid; ` +
    `( ${restoredPingLoopCommand(descriptor)} ) >${shellQuote(logPath)} 2>&1 & ` +
    "echo $! >/tmp/machinen-restored-ping.pid"
  );
}

// fallow-ignore-next-line complexity
function restoredPingLoopCommand(descriptor: ProductLevel4PingSocketDescriptor): string {
  const destination = descriptor.continuation?.destination ?? "127.0.0.1";
  const intervalSeconds = formatPingIntervalSeconds(descriptor.continuation?.intervalMs ?? 1000);
  const startSequence = descriptor.socket.echoSequence;
  const rewriteHeaderAndReply =
    `sed -n -e '/^PING /p' ` +
    `-e '/bytes from/ { s/icmp_seq=[0-9][0-9]*/icmp_seq='"$seq"'/; p; }'`;
  const rewriteReply = `sed -n -e '/bytes from/ { s/icmp_seq=[0-9][0-9]*/icmp_seq='"$seq"'/; p; }'`;
  return (
    `seq=${startSequence}; printed_header=0; ` +
    "while :; do " +
    'if [ "$printed_header" = 0 ]; then ' +
    `/usr/bin/ping -n -c 1 -W 1 ${shellQuote(destination)} | ${rewriteHeaderAndReply}; ` +
    "printed_header=1; " +
    "else " +
    `/usr/bin/ping -n -c 1 -W 1 ${shellQuote(destination)} | ${rewriteReply}; ` +
    "fi; " +
    "seq=$((seq + 1)); " +
    `sleep ${intervalSeconds}; ` +
    "done"
  );
}

function formatPingIntervalSeconds(intervalMs: number): string {
  const seconds = Math.max(1, intervalMs) / 1000;
  return seconds
    .toFixed(3)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

function verifyRestoredPingCommand(descriptor: ProductLevel4PingSocketDescriptor): string {
  const logPath = descriptor.continuation?.outputLogPath ?? "/tmp/machinen-restored-ping.log";
  return [
    "pid=$(cat /tmp/machinen-restored-ping.pid 2>/dev/null || true)",
    '[ -n "$pid" ] && [ -d "/proc/$pid" ] || exit 2',
    `for i in $(seq 1 20); do grep -q '64 bytes from' ${shellQuote(logPath)} && exit 0; sleep 0.5; done`,
    `cat ${shellQuote(logPath)} 2>/dev/null`,
    "exit 3",
  ].join("; ");
}

function handlePortableRestoreAdapterError(err: unknown, json: boolean): never {
  const known = portableRestoreAdapterError(err);
  if (known) {
    reportKnownProductError(known, json);
  }
  handleError(err);
}

function portableRestoreAdapterError(err: unknown): { code: string; message: string } | undefined {
  if (isPortableRestoreProductError(err)) {
    return { code: err.code, message: err.message };
  }
  return undefined;
}

function isPortableRestoreProductError(
  err: unknown,
): err is
  | ProductLevel4EventfdError
  | ProductLevel4PingSocketError
  | ProductLevel4PipeError
  | ProductLevel4TcpListenerError
  | ProductLevel4TimerfdError {
  const constructors = [
    ProductLevel4EventfdError,
    ProductLevel4PingSocketError,
    ProductLevel4PipeError,
    ProductLevel4TcpListenerError,
    ProductLevel4TimerfdError,
  ];
  return constructors.some((errorConstructor) => err instanceof errorConstructor);
}

function reportKnownProductError(error: { code: string; message: string }, json: boolean): never {
  if (json) {
    emitJsonError(error.code, error.message);
    process.exit(1);
  }
  die(error.message);
}

// fallow-ignore-next-line code-duplication
function handleProductPortablePostgresError(err: unknown, json: boolean): never {
  if (err instanceof ProductPortablePostgresError) {
    if (json) {
      emitJsonError(err.code, err.message);
      process.exit(1);
    }
    die(err.message);
  }
  handleError(err);
}

function handleProductSelectedNativeError(err: unknown, json: boolean): never {
  if (err instanceof ProductSelectedNativeError) {
    reportKnownProductError(err, json);
  }
  handleError(err);
}

function handleProductLevel4TcpListenerError(err: unknown, json: boolean): never {
  if (err instanceof ProductLevel4TcpListenerError) {
    reportKnownProductError(err, json);
  }
  handleError(err);
}

function handleProductLevel4TimerfdError(err: unknown, json: boolean): never {
  if (err instanceof ProductLevel4TimerfdError) {
    reportKnownProductError(err, json);
  }
  handleError(err);
}

function handleProductLevel4PipeError(err: unknown, json: boolean): never {
  if (err instanceof ProductLevel4PipeError) {
    reportKnownProductError(err, json);
  }
  handleError(err);
}

function handleProductLevel4EventfdError(err: unknown, json: boolean): never {
  if (err instanceof ProductLevel4EventfdError) {
    if (json) {
      emitJsonError(err.code, err.message);
      process.exit(1);
    }
    die(err.message);
  }
  handleError(err);
}

function handleProductLevel4PingSocketError(err: unknown, json: boolean): never {
  if (err instanceof ProductLevel4PingSocketError) {
    if (json) {
      emitJsonError(err.code, err.message);
      process.exit(1);
    }
    die(err.message);
  }
  handleError(err);
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

function perlStringLiteral(value: string): string {
  return `q(${value.replaceAll(")", "\\)")})`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

type PostgresDockerTarget = {
  host: string;
  container: string;
  database: string;
};

type PostgresDockerEvidence = {
  dumpPath: string;
  sourceVerifierOutput: string;
};

function capturePostgresDockerEvidence(options: CapturePostgresOptions): PostgresDockerEvidence {
  const target = postgresDockerTargetFromCapture(options);
  const temp = mkdtempSync(join(tmpdir(), "machinen-postgres-capture-"));
  const dumpPath = join(temp, PRODUCT_PORTABLE_POSTGRES_DUMP);
  const rolePrelude = postgresDockerRolePrelude(target);
  const dump = postgresDockerPgDump(target);
  writeFileSync(dumpPath, Buffer.concat([Buffer.from(rolePrelude, "utf8"), dump]));
  return {
    dumpPath,
    sourceVerifierOutput: postgresDockerPsql(
      target,
      readFileSync(resolve(options.verifierSql!), "utf8"),
      {
        tuplesOnly: true,
      },
    ).trim(),
  };
}

function restorePostgresDockerBundle(
  snapDir: string,
  parsed: ParsedRestoreCommandArgs,
): { targetVerifierOutput: string } {
  const target = postgresDockerTargetFromRestore(parsed);
  const dump = readFileSync(join(snapDir, PRODUCT_PORTABLE_POSTGRES_DUMP));
  postgresDockerPsql(
    { ...target, database: "postgres" },
    `DROP DATABASE IF EXISTS ${postgresIdentifier(target.database)};\nCREATE DATABASE ${postgresIdentifier(target.database)};\n`,
    { tuplesOnly: false },
  );
  postgresDockerPsql(target, dump, { tuplesOnly: false });
  return {
    targetVerifierOutput: postgresDockerPsql(
      target,
      readFileSync(resolve(parsed.postgresTargetVerifierSql!), "utf8"),
      { tuplesOnly: true },
    ).trim(),
  };
}

function postgresDockerTargetFromCapture(options: CapturePostgresOptions): PostgresDockerTarget {
  return {
    host: options.postgresDockerHost ?? "local",
    container: options.postgresContainer!,
    database: options.postgresDatabase!,
  };
}

function postgresDockerTargetFromRestore(parsed: ParsedRestoreCommandArgs): PostgresDockerTarget {
  return {
    host: parsed.postgresDockerHost ?? "local",
    container: parsed.postgresContainer!,
    database: parsed.postgresDatabase!,
  };
}

function postgresDockerRolePrelude(target: PostgresDockerTarget): string {
  const roles = postgresDockerPsql(
    { ...target, database: "postgres" },
    "SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' AND rolname <> 'postgres' ORDER BY rolname;",
    { tuplesOnly: true },
  )
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (roles.length === 0) {
    return "";
  }
  return `${roles
    .map(
      (role) =>
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${postgresStringLiteral(role)}) THEN CREATE ROLE ${postgresIdentifier(role)}; END IF; END $$;`,
    )
    .join("\n")}\n`;
}

function postgresDockerPgDump(target: PostgresDockerTarget): Buffer {
  const args = [
    "exec",
    target.container,
    "pg_dump",
    "-U",
    "postgres",
    "--no-owner",
    "--format=plain",
    "--dbname",
    target.database,
  ];
  return postgresDockerExec(target.host, args);
}

function postgresDockerPsql(
  target: PostgresDockerTarget,
  input: string | Buffer,
  options: { tuplesOnly: boolean },
): string {
  const args = [
    "exec",
    "-i",
    target.container,
    "psql",
    "-U",
    "postgres",
    "-d",
    target.database,
    "-v",
    "ON_ERROR_STOP=1",
    ...(options.tuplesOnly ? ["-At"] : []),
  ];
  return postgresDockerExec(target.host, args, input).toString("utf8");
}

function postgresDockerExec(host: string, dockerArgs: string[], input?: string | Buffer): Buffer {
  if (host === "local") {
    return execFileSync("docker", dockerArgs, {
      input,
      maxBuffer: 128 * 1024 * 1024,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
  }
  return execFileSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, dockerShellCommand(dockerArgs)],
    {
      input,
      maxBuffer: 128 * 1024 * 1024,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    },
  );
}

function dockerShellCommand(args: string[]): string {
  return `docker ${args.map(shellQuote).join(" ")}`;
}

function postgresIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    die(`invalid PostgreSQL identifier: ${value}`);
  }
  return value;
}

function postgresStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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

async function cmdLs(args: string[]): Promise<number> {
  const { json, rest } = consumeJsonFlag(args);
  if (rest.length > 0) {
    die(`unknown argument: ${rest[0]}`);
  }
  const entries = list();
  const rssByPid = rssByRegistryPid(entries);
  if (json) {
    emitLsJson(entries, rssByPid);
  } else {
    printLsTable(entries, rssByPid);
  }
  return 0;
}

function rssByRegistryPid(entries: RegistryEntry[]): Map<number, number> {
  return readHostRssBytesMulti(
    entries.map((entry) => ({ pid: entry.pid, statsPath: entry.statsPath })),
  );
}

function emitLsJson(entries: RegistryEntry[], rssByPid: Map<number, number>): void {
  emitJson({
    schema_version: 1,
    vms: entries.map((entry) => vmJson(entry, rssByPid)),
  });
}

function vmJson(entry: RegistryEntry, rssByPid: Map<number, number>): unknown {
  return {
    pid: entry.pid,
    name: nullable(entry.name),
    started_at: entry.startedAt,
    uptime_ms: Date.now() - entry.startedAt,
    memory: vmMemoryJson(entry, rssByPid),
    ports: portsJson(entry),
    forked_from: nullable(entry.forkedFrom),
  };
}

function portsJson(entry: RegistryEntry): NonNullable<RegistryEntry["portForward"]> {
  if (entry.portForward === undefined) {
    return [];
  }
  return entry.portForward;
}

function vmMemoryJson(entry: RegistryEntry, rssByPid: Map<number, number>): unknown {
  return {
    rss_bytes: nullable(rssByPid.get(entry.pid)),
    ceiling_mib: nullable(entry.memoryCeilingMib),
  };
}

function nullable<T>(value: T | undefined): T | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

function printLsTable(entries: RegistryEntry[], rssByPid: Map<number, number>): void {
  if (entries.length === 0) {
    process.stdout.write("(no running VMs)\n");
    return;
  }
  const header = ["PID", "NAME", "UP", "MEM", "PORTS", "FORKED-FROM"];
  const rows = lsRows(entries, rssByPid);
  const widths = tableWidths(header, rows);
  const visible = visibleLsColumns(header, widths);
  printTable(header, rows, widths, visible);
}

function lsRows(entries: RegistryEntry[], rssByPid: Map<number, number>): string[][] {
  return entries.map((entry) => [
    String(entry.pid),
    entry.name ?? "-",
    formatUptime(Date.now() - entry.startedAt),
    formatMem(rssByPid.get(entry.pid) ?? null, entry.memoryCeilingMib),
    formatPorts(entry.portForward),
    entry.forkedFrom ?? "-",
  ]);
}

function tableWidths(header: string[], rows: string[][]): number[] {
  return header.map((heading, index) =>
    Math.max(heading.length, ...rows.map((row) => row[index]!.length)),
  );
}

function visibleLsColumns(header: string[], widths: number[]): number[] {
  const gap = "  ";
  const fullWidth =
    widths.reduce((sum, width) => sum + width, 0) + gap.length * (widths.length - 1);
  // Hide MEM (column index 3) on terminals that can't fit the full
  // line. Pipes / non-TTY stdout report `process.stdout.columns`
  // undefined — keep the column there so scripts get a stable shape.
  const cols = process.stdout.columns;
  const includeMem = cols === undefined || fullWidth <= cols;
  return includeMem ? header.map((_, i) => i) : header.map((_, i) => i).filter((i) => i !== 3);
}

function printTable(header: string[], rows: string[][], widths: number[], visible: number[]): void {
  process.stdout.write(formatTableLine(header, widths, visible) + "\n");
  for (const row of rows) {
    process.stdout.write(formatTableLine(row, widths, visible) + "\n");
  }
}

function formatTableLine(cells: string[], widths: number[], visible: number[]): string {
  return visible.map((index) => cells[index]!.padEnd(widths[index]!)).join("  ");
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h`;
  }
  return `${Math.floor(h / 24)}d`;
}

// `machinen gc` — drop registry entries whose VMM is dead (or whose
// pid was recycled to some other process) and remove their per-boot
// artifacts. Backstop for `--detached` boots, where the in-process
// exit hook can't run because the parent is gone (issue #150 phase 2
// PR2).
async function cmdGc(args: string[]): Promise<number> {
  const { json, dryRun, rest } = parseGcOptions(args);
  dieOnUnexpectedArgs(rest);
  const results = runGc({ dryRun });
  if (json) {
    emitGcJson(dryRun, results);
  } else {
    printGcResults(results, dryRun);
  }
  return 0;
}

function parseGcOptions(args: string[]): { json: boolean; dryRun: boolean; rest: string[] } {
  const { json, rest: afterJson } = consumeJsonFlag(args);
  const { dryRun, rest } = consumeDryRunFlag(afterJson);
  return { json, dryRun, rest };
}

function dieOnUnexpectedArgs(args: string[]): void {
  for (const arg of args) {
    die(`unknown flag: ${arg}`);
  }
}

function emitGcJson(dryRun: boolean, results: ReturnType<typeof runGc>): void {
  emitJson({
    schema_version: 1,
    dry_run: dryRun,
    results: results.map((r) => ({
      pid: r.pid,
      name: r.name ?? null,
      status: r.status,
      removed_paths: r.removedPaths,
      failed_paths: r.failedPaths,
    })),
  });
}

function printGcResults(results: ReturnType<typeof runGc>, dryRun: boolean): void {
  if (results.length === 0) {
    process.stdout.write("(nothing to clean up)\n");
    return;
  }
  for (const result of results) {
    printGcResult(result, dryRun);
  }
}

function printGcResult(result: ReturnType<typeof runGc>[number], dryRun: boolean): void {
  const label = result.name ? `${result.name} (pid ${result.pid})` : `pid ${result.pid}`;
  const verb = dryRun ? "would clean" : "cleaned";
  process.stdout.write(
    `${verb} ${label} [${result.status}]: ${result.removedPaths.length} path(s)\n`,
  );
  printIndentedPaths(result.removedPaths, "");
  printIndentedPaths(result.failedPaths, "failed: ");
}

function printIndentedPaths(paths: string[], prefix: string): void {
  for (const path of paths) {
    process.stdout.write(`  ${prefix}${path}\n`);
  }
}

// `machinen stop <name|pid>` — SIGTERM the VMM, escalate to SIGKILL
// after 2s, then gc its entry. Resolves `--detached` boots' Ctrl-C
// problem: the CLI no longer holds the VMM, so a separate `stop`
// command is the only way to ask for a clean shutdown.
async function cmdStop(args: string[]): Promise<number> {
  const opts = parseStopOptions(args);
  const entry = lookupEntry(opts.target);
  if (!entry) {
    reportStopMissingTarget(opts);
    return 1;
  }
  return stopExistingEntry(entry, opts);
}

async function stopExistingEntry(entry: RegistryEntry, opts: StopOptions): Promise<number> {
  const status = validateStopEntry(entry);
  if (await handleInactiveStopEntry(entry, status, opts)) {
    return 0;
  }
  if (opts.dryRun) {
    reportStopDryRun(entry, opts);
    return 0;
  }
  return stopLiveEntry(entry, opts);
}

async function stopLiveEntry(entry: RegistryEntry, opts: StopOptions): Promise<number> {
  const sig = stopSignal(opts.force);
  if (!signalStopProcess(entry.pid, sig, opts, "STOP_KILL_FAILED")) {
    return 1;
  }
  await escalateIfNeeded(entry.pid, opts.force);
  await stopGvproxy(entry, sig, opts.force);
  finishStoppedEntry(entry, opts);
  return 0;
}

type StopStatus = "stopped" | "would_stop" | "already_dead" | "recycled";

interface StopOptions {
  json: boolean;
  dryRun: boolean;
  force: boolean;
  target: Target;
}

function parseStopOptions(args: string[]): StopOptions {
  const { json, rest: afterJson } = consumeJsonFlag(args);
  const { dryRun, rest: afterDry } = consumeDryRunFlag(afterJson);
  const { force, rest } = consumeForceFlag(afterDry);
  return { json, dryRun, force, target: parseTargetFlags(rest, "stop") };
}

function consumeForceFlag(args: string[]): { force: boolean; rest: string[] } {
  const rest: string[] = [];
  let force = false;
  for (const arg of args) {
    if (arg === "--force" || arg === "-9") {
      force = true;
    } else {
      rest.push(arg);
    }
  }
  return { force, rest };
}

function reportStopMissingTarget(opts: StopOptions): void {
  const message = `no running VM matched ${describeTarget(opts.target)}`;
  if (opts.json) {
    emitJsonError("VM_NOT_FOUND", message);
  } else {
    process.stderr.write(`machinen stop: ${message}\n`);
  }
}

function emitStop(entry: RegistryEntry, opts: StopOptions, status: StopStatus): void {
  if (!opts.json) {
    return;
  }
  emitJson({
    schema_version: 1,
    pid: entry.pid,
    name: entry.name ?? null,
    status,
    dry_run: opts.dryRun,
  });
}

function validateStopEntry(entry: RegistryEntry) {
  // Pid-validate before signalling — refuses to kill a recycled pid.
  return validatePid(entry.pid, {
    vmmExe: entry.vmmExe,
    startedAt: entry.startedAt,
  });
}

async function handleInactiveStopEntry(
  entry: RegistryEntry,
  status: ReturnType<typeof validateStopEntry>,
  opts: StopOptions,
): Promise<boolean> {
  if (status === "recycled") {
    reportRecycledStopEntry(entry, opts);
    gcStoppedEntry(entry, opts.dryRun);
    emitStop(entry, opts, "recycled");
    return true;
  }
  if (status === "dead") {
    reportDeadStopEntry(entry, opts);
    gcStoppedEntry(entry, opts.dryRun);
    emitStop(entry, opts, "already_dead");
    return true;
  }
  return false;
}

function reportRecycledStopEntry(entry: RegistryEntry, opts: StopOptions): void {
  if (opts.json) {
    return;
  }
  process.stderr.write(
    `machinen stop: registry entry pid ${entry.pid} is now held by an unrelated process; ` +
      (opts.dryRun ? "would skip kill and gc.\n" : "skipping kill and running gc.\n"),
  );
}

function reportDeadStopEntry(entry: RegistryEntry, opts: StopOptions): void {
  if (opts.json) {
    return;
  }
  process.stderr.write(
    `machinen stop: pid ${entry.pid} already gone; ` +
      (opts.dryRun ? "would gc.\n" : "running gc.\n"),
  );
}

function gcStoppedEntry(entry: RegistryEntry, dryRun: boolean): void {
  if (!dryRun) {
    runGc({ pid: entry.pid });
  }
}

function reportStopDryRun(entry: RegistryEntry, opts: StopOptions): void {
  if (!opts.json) {
    const sigLabel = opts.force ? "SIGKILL" : "SIGTERM (escalates to SIGKILL after 2s)";
    process.stdout.write(`would ${sigLabel} ${entryLabel(entry)}\n`);
  }
  emitStop(entry, opts, "would_stop");
}

function stopSignal(force: boolean): NodeJS.Signals {
  return force ? "SIGKILL" : "SIGTERM";
}

function signalStopProcess(
  pid: number,
  signal: NodeJS.Signals,
  opts: Pick<StopOptions, "json">,
  errorCode: string,
): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    reportStopSignalError(pid, err, opts, errorCode);
    return false;
  }
}

function reportStopSignalError(
  pid: number,
  err: unknown,
  opts: Pick<StopOptions, "json">,
  errorCode: string,
): void {
  const msg = `failed to signal pid ${pid}: ${describeError(err)}`;
  if (opts.json) {
    emitJsonError(errorCode, msg);
  } else {
    process.stderr.write(`machinen stop: ${msg}\n`);
  }
}

async function escalateIfNeeded(pid: number, force: boolean): Promise<void> {
  if (force) {
    return;
  }
  await waitForExit(pid, 2_000);
  if (pidIsAlive(pid)) {
    tryKill(pid, "SIGKILL");
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {}
}

async function stopGvproxy(
  entry: RegistryEntry,
  signal: NodeJS.Signals,
  force: boolean,
): Promise<void> {
  // #150 phase 2 PR3: signal gvproxy too. Detached gvproxy survives
  // the parent's exit on its own (no pdeathsig); without this it'd
  // outlive every `machinen stop`, holding host ports and leaking
  // the qemu/control sockets. Anti-recycling guard mirrors the VMM
  // path — basename match against the recorded gvproxy binary.
  if (!entry.gvproxyPid || !entry.gvproxyExe) {
    return;
  }
  await handleGvproxyStatus(
    entry.gvproxyPid,
    validatePid(entry.gvproxyPid, { vmmExe: entry.gvproxyExe }),
    signal,
    force,
  );
}

async function handleGvproxyStatus(
  pid: number,
  status: ReturnType<typeof validatePid>,
  signal: NodeJS.Signals,
  force: boolean,
): Promise<void> {
  if (status === "alive") {
    await signalGvproxy(pid, signal, force);
  } else if (status === "recycled") {
    process.stderr.write(
      `machinen stop: gvproxy pid ${pid} now held by an unrelated process; skipping.\n`,
    );
  }
}

async function signalGvproxy(pid: number, signal: NodeJS.Signals, force: boolean): Promise<void> {
  if (!signalStopProcess(pid, signal, { json: false }, "STOP_GVPROXY_KILL_FAILED")) {
    return;
  }
  await escalateIfNeeded(pid, force);
}

function finishStoppedEntry(entry: RegistryEntry, opts: StopOptions): void {
  // Final gc to drop the registry entry + cleanupPaths (including the
  // gvproxy socket dir that PR3 added to the cleanup list).
  runGc({ pid: entry.pid });
  if (opts.json) {
    emitStop(entry, opts, "stopped");
  } else {
    process.stdout.write(`stopped ${entryLabel(entry)}\n`);
  }
}

function entryLabel(entry: RegistryEntry): string {
  return entry.name ? `${entry.name} (pid ${entry.pid})` : `pid ${entry.pid}`;
}

/**
 * Poll `kill(pid, 0)` until the process is gone or the deadline
 * passes. Polling beats kqueue/inotify here — the pid we're watching
 * is *not* our child, so there's no SIGCHLD to listen for.
 */
async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
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

async function cmdExec(args: string[]): Promise<number> {
  const parsed = parseExecArgs(args);
  const vm = await attach(parsed.target).catch(handleError);
  try {
    return await runExecCommand(vm, parsed);
  } finally {
    await vm.detach();
  }
}

interface ParsedExecArgs {
  target: Target;
  cmd: string;
  usePty: boolean;
}

function parseExecArgs(args: string[]): ParsedExecArgs {
  const { usePty, filtered } = consumeExecPtyFlag(args);
  const dashIdx = filtered.indexOf("--");
  if (dashIdx === -1 || dashIdx === filtered.length - 1) {
    die("usage: machinen exec <name|pid> [--tty] -- <cmd>");
  }
  return {
    usePty,
    target: parseTargetFlags(filtered.slice(0, dashIdx), "exec"),
    cmd: filtered.slice(dashIdx + 1).join(" "),
  };
}

function consumeExecPtyFlag(args: string[]): { usePty: boolean; filtered: string[] } {
  // Pull --tty out before the `--` boundary so it isn't passed to the
  // workload. Caller opts into line-discipline translation explicitly.
  const filtered: string[] = [];
  let usePty = false;
  for (const arg of args) {
    if (arg === "--tty" || arg === "--pty") {
      usePty = true;
    } else {
      filtered.push(arg);
    }
  }
  return { usePty, filtered };
}

async function runExecCommand(vm: VmHandle, parsed: ParsedExecArgs): Promise<number> {
  if (parsed.usePty) {
    assertExecPtyTty();
    return runPtyExec(vm, parsed.cmd);
  }
  return runRawExec(vm, parsed.cmd);
}

function assertExecPtyTty(): void {
  if (!process.stdin.isTTY) {
    die("machinen exec --tty: stdin is not a TTY; pass via terminal or drop --tty");
  }
}

async function runRawExec(vm: VmHandle, cmd: string): Promise<number> {
  // Shell out via `sh -c` on the guest so caller can pass piped
  // commands naturally. Users who want raw exec of a single binary
  // can quote it like `machinen exec foo -- /bin/ls`.
  const res = await vm.execRaw(cmd, {
    onStdout: (chunk) => process.stdout.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
  });
  return res.exitCode;
}

async function runPtyExec(vm: VmHandle, cmd: string): Promise<number> {
  // PTY mode (#133): bidirectional bytes between this terminal and a
  // guest pseudoterminal. Flip stdin to raw so Ctrl-C, arrows, and
  // function keys reach the guest as untranslated bytes; restore on
  // every exit path so the user's shell isn't left in raw mode.
  // Caller is responsible for asserting stdin is a TTY (the right
  // error message depends on whether you got here via `attach` or
  // `exec --tty`).
  const tty = enterPtyRawMode();
  const handle = vm.execPty(cmd, {
    cols: tty.cols,
    rows: tty.rows,
    stdin: process.stdin,
    stdout: process.stdout,
  });
  const onResize = () =>
    handle.resize(process.stdout.columns ?? tty.cols, process.stdout.rows ?? tty.rows);
  process.stdout.on("resize", onResize);
  try {
    const { exitCode } = await handle.result;
    return exitCode;
  } finally {
    process.stdout.removeListener("resize", onResize);
    tty.restore();
  }
}

function enterPtyRawMode(): { cols: number; rows: number; restore: () => void } {
  const wasRaw = process.stdin.isRaw === true;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return {
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
    restore: () => restorePtyRawMode(wasRaw),
  };
}

function restorePtyRawMode(wasRaw: boolean): void {
  if (wasRaw) {
    return;
  }
  try {
    process.stdin.setRawMode(false);
  } catch {
    // Already restored or stream destroyed; ignore.
  }
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
  portable: boolean;
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
  const { portable, rest: afterPortable } = consumePortableSnapshotFlag(afterKeepAlive);
  const { outDir: flaggedOutDir, rest } = consumeSnapshotOutFlag(afterPortable);
  const { target, rest: afterTarget } = resolveTarget(rest, "snapshot");
  const outDir = parseSnapshotOutDir(afterTarget, flaggedOutDir);
  return { json, dryRun, keepAlive, portable, target, outDir, resolvedOutDir: resolve(outDir) };
}

function consumePortableSnapshotFlag(args: string[]): { portable: boolean; rest: string[] } {
  const rest: string[] = [];
  let portable = false;
  for (const arg of args) {
    if (arg === "--portable") {
      portable = true;
    } else {
      rest.push(arg);
    }
  }
  return { portable, rest };
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
    "usage: machinen snapshot <name|pid> <out-dir> [--portable] [--keep-alive] [--dry-run] [--json]\n" +
    "       machinen snapshot <name|pid> --out <dir> [--portable] [--keep-alive] [--dry-run] [--json]"
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
    if (opts.portable) {
      return await runPortableVmSnapshot(vm, opts);
    }
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

async function runPortableVmSnapshot(vm: VmHandle, opts: SnapshotOptionsCli): Promise<number> {
  const started = Date.now();
  const exportCommand = portableVmSnapshotExportCommand();
  const exported = await vm.execRaw(exportCommand, { execTimeoutMs: 60_000 });
  if (exported.exitCode !== 0) {
    reportPortableVmSnapshotRefusal(
      opts,
      exported.stderr || exported.stdout || "portable VM source layout missing",
    );
    return 1;
  }
  const archive = Buffer.from(exported.stdout.trim(), "base64");
  const tempDir = mkdtempSync(join(tmpdir(), "machinen-portable-vm-snapshot-"));
  const archivePath = join(tempDir, "portable-vm.tar");
  rmSync(opts.resolvedOutDir, { recursive: true, force: true });
  mkdirSync(opts.resolvedOutDir, { recursive: true });
  writeFileSync(archivePath, archive);
  execFileSync("tar", ["-xf", archivePath, "-C", opts.resolvedOutDir]);
  rmSync(tempDir, { recursive: true, force: true });
  const summary = readPortableVmSnapshotSummary(opts.resolvedOutDir);
  reportPortableVmSnapshotSuccess(opts, summary, Date.now() - started);
  return 0;
}

function portableVmSnapshotExportCommand(): string {
  return `sh -eu -c ${shellQuote(portableVmSnapshotGuestAgentScript())}`;
}

function portableVmSnapshotGuestAgentScript(): string {
  return String.raw`
resolve_source() {
  configured_source=$(printenv MACHINEN_PORTABLE_VM_SOURCE || true)
  if [ -n "$configured_source" ] && [ -d "$configured_source" ]; then
    printf '%s\n' "$configured_source"
    return 0
  fi
  for candidate in /run/machinen/portable-vm/source-bundle /mnt/portable-vm-source /opt/machinen-portable-vm-source/bundle; do
    if [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

src=$(resolve_source) || { echo 'portable VM guest inventory agent could not find a source bundle' >&2; exit 41; }
[ -f "$src/portable-vm-all3-manifest.json" ] || { echo 'portable VM manifest missing' >&2; exit 42; }
[ -d "$src/filesystem/root" ] || { echo 'portable VM filesystem root missing' >&2; exit 43; }
[ -f "$src/service-manifest.json" ] || { echo 'portable VM service manifest missing' >&2; exit 44; }
[ -f "$src/sqlite-dump.sql" ] || { echo 'portable VM sqlite dump missing' >&2; exit 45; }

machine=$(uname -m)
case "$machine" in
  x86_64) source_arch=amd64 ;;
  aarch64|arm64) source_arch=arm64 ;;
  *) echo "unsupported source architecture: $machine" >&2; exit 46 ;;
esac

work=$(mktemp -d)
cp -a "$src/." "$work/"
printf '%s\n' "$source_arch" >"$work/source-architecture.txt"

refusal_rows=''
add_refusal() {
  id="$1"
  category="$2"
  code="$3"
  message="$4"
  refusal_rows="$refusal_rows,
      { \"id\": \"$id\", \"category\": \"$category\", \"disposition\": \"refused\", \"refusalCode\": \"$code\", \"message\": \"$message\" }"
}
[ ! -f "$src/portable-vm-active-db-state.refuse" ] || add_refusal active-db-state database portable-vm-active-db-state-unsupported 'dirty or active database state must be quiesced before portable VM restore'
[ ! -f "$src/portable-vm-active-network-stream.refuse" ] || add_refusal active-network-stream network portable-vm-active-network-stream-unsupported 'active network streams are refused; only listener reconstruction is supported'
[ ! -f "$src/portable-vm-unknown-live-process.refuse" ] || add_refusal unknown-live-process process portable-vm-unknown-live-process-unsupported 'unknown live processes are refused by default'
[ ! -f "$src/portable-vm-opaque-device-state.refuse" ] || add_refusal opaque-device-state device portable-vm-opaque-device-state-unsupported 'opaque device state is refused by default'
[ ! -f "$src/portable-vm-active-syscall.refuse" ] || add_refusal active-syscall process portable-vm-active-syscall-unsupported 'active syscall state is refused by default'
[ ! -f "$src/node-portability-active-websocket.refuse" ] || add_refusal nodejs-active-websocket nodejs node-portability-active-websocket-unsupported 'active WebSocket sessions are refused by default'
[ ! -f "$src/node-portability-worker-thread.refuse" ] || add_refusal nodejs-worker-thread nodejs node-portability-worker-thread-unsupported 'worker thread live state is refused by default'
[ ! -f "$src/node-portability-native-addon.refuse" ] || add_refusal nodejs-native-addon nodejs node-portability-native-addon-unsupported 'native addon live/ABI state is refused by default'
[ ! -f "$src/node-portability-child-process.refuse" ] || add_refusal nodejs-child-process nodejs node-portability-child-process-unsupported 'child process trees are refused by default'
[ ! -f "$src/node-portability-active-request.refuse" ] || add_refusal nodejs-active-request nodejs node-portability-active-request-unsupported 'in-flight Node HTTP requests are refused by default'
[ ! -f "$src/node-portability-outbound-connection.refuse" ] || add_refusal nodejs-outbound-connection nodejs node-portability-outbound-connection-unsupported 'outbound connection state is refused by default'
[ ! -f "$src/nodejs-memory-pending-promise.refuse" ] || add_refusal nodejs-memory-pending-promise nodejs node-portability-memory-pending-promise-unsupported 'pending Promise state is refused by default'
[ ! -f "$src/nodejs-memory-pending-microtask.refuse" ] || add_refusal nodejs-memory-pending-microtask nodejs node-portability-memory-pending-microtask-unsupported 'pending microtask state is refused by default'
[ ! -f "$src/nodejs-memory-active-socket.refuse" ] || add_refusal nodejs-memory-active-socket nodejs node-portability-memory-active-socket-unsupported 'active socket state is refused by default'
[ ! -f "$src/nodejs-memory-active-request.refuse" ] || add_refusal nodejs-memory-active-request nodejs node-portability-memory-active-request-unsupported 'active request state is refused by default'
[ ! -f "$src/nodejs-memory-worker.refuse" ] || add_refusal nodejs-memory-worker nodejs node-portability-memory-worker-unsupported 'worker live state is refused by default'
[ ! -f "$src/nodejs-memory-native-addon.refuse" ] || add_refusal nodejs-memory-native-addon nodejs node-portability-memory-native-addon-unsupported 'native addon memory state is refused by default'
[ ! -f "$src/nodejs-memory-child-process.refuse" ] || add_refusal nodejs-memory-child-process nodejs node-portability-memory-child-process-unsupported 'child process memory state is refused by default'
[ ! -f "$src/nodejs-memory-opaque-native-state.refuse" ] || add_refusal nodejs-memory-opaque-native-state nodejs node-portability-memory-opaque-native-state-unsupported 'opaque native state is refused by default'
[ ! -f "$src/nodejs-memory-raw-v8-state.refuse" ] || add_refusal nodejs-memory-raw-v8-state nodejs node-portability-memory-raw-v8-state-unsupported 'raw V8 state is refused by default'

node_inventory_items=''
node_plan_rows=''
node_memory_items=''
node_memory_plan_rows=''
node_package_json=''
if [ -d "$src/filesystem/root" ]; then
  node_package_json=$(find "$src/filesystem/root" -maxdepth 6 -name package.json -type f 2>/dev/null | head -n 1 || true)
fi
if [ -f "$src/nodejs-memory-ir.json" ]; then
  cat >"$work/nodejs-memory-classification.json" <<NODEMEMJSON
{
  "kind": "machinen.nodejs-memory-classification",
  "version": 1,
  "status": "classified",
  "sourceArchitecture": "$source_arch",
  "memoryIr": "nodejs-memory-ir.json",
  "restoreStrategy": "materialize-nodejs-memory-ir-target-native",
  "compatibilityIndex": "portability/nodejs/index.json",
  "claimGuard": {
    "arbitraryNodeProcessRestoreClaimed": false,
    "rawV8HeapRestoreUsed": false,
    "rawCpuStateReplayUsed": false,
    "sourceIsaEmulationUsed": false
  }
}
NODEMEMJSON
  node_memory_items=',
    { "id": "nodejs-memory-ir", "category": "nodejs", "path": "nodejs-memory-ir.json", "classification": "nodejs-memory-classification.json", "disposition": "product-supported" }'
  node_memory_plan_rows=',
      { "id": "nodejs-memory-ir", "category": "nodejs", "disposition": "product-supported", "restoreStrategy": "materialize-nodejs-memory-ir-target-native", "artifact": "nodejs-memory-ir.json", "classification": "nodejs-memory-classification.json", "compatibilityIndex": "portability/nodejs/index.json" }'
fi

if [ -n "$node_package_json" ]; then
  node_package_rel=$(printf '%s\n' "$node_package_json" | sed "s|^$src/||")
  node_app_dir=$(dirname "$node_package_json")
  node_app_rel=$(printf '%s\n' "$node_app_dir" | sed "s|^$src/||")
  node_package_manager="npm"
  [ ! -f "$node_app_dir/pnpm-lock.yaml" ] || node_package_manager="pnpm"
  [ ! -f "$node_app_dir/yarn.lock" ] || node_package_manager="yarn"
  cat >"$work/nodejs-portability-inventory.json" <<NODEJSON
{
  "kind": "machinen.nodejs-portability-inventory",
  "version": 1,
  "status": "classified",
  "sourceArchitecture": "$source_arch",
  "packageJson": "$node_package_rel",
  "appDir": "$node_app_rel",
  "packageManager": "$node_package_manager",
  "compatibilityIndex": "portability/nodejs/index.json",
  "claimGuard": {
    "arbitraryNodeProcessRestoreClaimed": false,
    "rawV8HeapRestoreUsed": false,
    "rawCpuStateReplayUsed": false,
    "sourceIsaEmulationUsed": false
  }
}
NODEJSON
  node_inventory_items=',
    { "id": "nodejs-package-json", "category": "nodejs", "path": "nodejs-portability-inventory.json", "disposition": "classified" }'
  node_plan_rows=',
      { "id": "nodejs-package-json", "category": "nodejs", "disposition": "classified", "restoreStrategy": "classify-against-node-portability-compatibility-index", "artifact": "nodejs-portability-inventory.json", "compatibilityIndex": "portability/nodejs/index.json" }'
fi

cat >"$work/portable-vm-raw-inventory.json" <<JSON
{
  "kind": "machinen.portable-vm-raw-inventory",
  "version": 1,
  "scope": "${PORTABLE_VM_PRODUCT_SCOPE}",
  "sourceArchitecture": "$source_arch",
  "sourceArchitectureDetected": true,
  "sourceArchitectureDetection": "uname -m inside source VM",
  "sourcePathDetection": "guest portable VM inventory agent resolved source bundle",
  "sourcePath": "$src",
  "items": [
    { "id": "filesystem-root", "category": "filesystem", "path": "filesystem/root", "disposition": "product-supported" },
    { "id": "selected-service", "category": "service", "path": "service-manifest.json", "disposition": "product-supported" },
    { "id": "clean-sqlite", "category": "sqlite", "path": "sqlite-dump.sql", "disposition": "product-supported" }$node_inventory_items$node_memory_items
  ]
}
JSON

cat >"$work/portable-vm-manifest-plan.json" <<JSON
{
  "kind": "${PORTABLE_VM_PLAN_KIND}",
  "version": 1,
  "status": "product-generated",
  "scope": "${PORTABLE_VM_PRODUCT_SCOPE}",
  "sourceArchitecture": "$source_arch",
  "sourceArchitectureDetected": true,
  "targetPolicy": {
    "restoreMode": "target-native-reconstruction",
    "allowedTargetArchitectures": ["arm64", "amd64"],
    "unknownStatePolicy": "refuse-by-default",
    "architectureDetection": "detect-target-architecture-at-restore-time"
  },
  "restorePlan": {
    "rows": [
      { "id": "filesystem-root", "category": "filesystem", "disposition": "product-supported", "restoreStrategy": "copy-content-addressed-file-tree", "artifact": "filesystem-manifest.json" },
      { "id": "selected-service", "category": "service", "disposition": "product-supported", "restoreStrategy": "start-target-native-selected-service", "artifact": "service-manifest.json" },
      { "id": "clean-sqlite", "category": "sqlite", "disposition": "product-supported", "restoreStrategy": "restore-clean-logical-sqlite-dump", "artifact": "sqlite-logical.json" }$node_plan_rows$node_memory_plan_rows$refusal_rows
    ]
  },
  "claimGuard": {
    "arbitraryVmRestoreClaimed": false,
    "rawVmStateReplayUsed": false,
    "sourceIsaEmulationUsed": false,
    "metadataOnlyShortcutAccepted": false
  }
}
JSON

printf '{"kind":"machinen.portable-vm-product-snapshot-summary","version":1,"accepted":true,"scope":"${PORTABLE_VM_PRODUCT_SCOPE}","sourceArchitecture":"%s","sourceArchitectureDetected":true,"sourceArchitectureDetection":"uname -m inside source VM","sourcePathDetection":"guest portable VM inventory agent","sourcePath":"%s","portableVmManifest":"portable-vm-raw-inventory.json","portableVmPlan":"portable-vm-manifest-plan.json","arbitraryVmRestoreClaimed":false,"rawVmStateReplayUsed":false}\n' "$source_arch" "$src" >"$work/portable-vm-snapshot-summary.json"

tar -C "$work" -cf - . | base64 -w0
rm -rf "$work"
`;
}

function readPortableVmSnapshotSummary(bundleDir: string): Record<string, unknown> {
  const summaryPath = join(bundleDir, "portable-vm-snapshot-summary.json");
  if (!existsSync(summaryPath)) {
    return { accepted: true, sourceArchitecture: readPortableVmSourceArchitecture(bundleDir) };
  }
  return JSON.parse(readFileSync(summaryPath, "utf8")) as Record<string, unknown>;
}

function readPortableVmSourceArchitecture(bundleDir: string): GuestCpu {
  const value = readFileSync(join(bundleDir, "source-architecture.txt"), "utf8").trim();
  if (value === "arm64" || value === "amd64") {
    return value;
  }
  throw new Error(`portable VM source architecture is invalid: ${value}`);
}

function reportPortableVmSnapshotRefusal(opts: SnapshotOptionsCli, message: string): void {
  if (opts.json) {
    emitJson({
      schema_version: 1,
      kind: "machinen.portable-vm-product-snapshot-summary",
      accepted: false,
      migrationCompleted: false,
      refusal: { code: "portable-vm-source-layout-unsupported", message: message.trim() },
    });
    return;
  }
  process.stderr.write(`machinen snapshot --portable: ${message.trim()}\n`);
}

function reportPortableVmSnapshotSuccess(
  opts: SnapshotOptionsCli,
  summary: Record<string, unknown>,
  elapsedMs: number,
): void {
  if (opts.json) {
    emitJson({
      schema_version: 1,
      ...summary,
      snapshotDir: opts.resolvedOutDir,
      elapsedMs,
      dryRun: false,
    });
    return;
  }
  process.stdout.write(`portable VM snapshot: ${opts.resolvedOutDir} (${elapsedMs}ms)\n`);
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

async function cmdAttach(args: string[]): Promise<number> {
  const opts = parseAttachOptions(args);
  printAttachTailIfRequested(opts);
  // Resolve the target before the TTY check: a typo in --name should
  // surface "no running VM found", not the TTY error. The TTY error
  // is only useful once we know the VM exists.
  const vm = await attach(opts.target).catch(handleError);
  return runAttachedPty(vm, opts.shell);
}

interface AttachOptionsCli {
  shell: string;
  tail?: number | "all";
  target: Target;
}

function parseAttachOptions(args: string[]): AttachOptionsCli {
  const state = {
    shell: "/bin/bash -i",
    tail: undefined as number | "all" | undefined,
    rest: [] as string[],
  };
  for (let i = 0; i < args.length; i++) {
    i = consumeAttachArg(args, i, state);
  }
  return { shell: state.shell, tail: state.tail, target: parseTargetFlags(state.rest, "attach") };
}

type AttachArgHandler = (
  args: string[],
  index: number,
  arg: string,
  state: { shell: string; tail?: number | "all"; rest: string[] },
) => number;

function consumeAttachArg(
  args: string[],
  index: number,
  state: { shell: string; tail?: number | "all"; rest: string[] },
): number {
  const arg = args[index]!;
  const handler = attachArgHandler(arg);
  if (handler) {
    return handler(args, index, arg, state);
  }
  state.rest.push(arg);
  return index;
}

const ATTACH_ARG_HANDLERS: Array<[(arg: string) => boolean, AttachArgHandler]> = [
  [(arg) => arg === "--shell" || arg.startsWith("--shell="), consumeAttachShell],
  [(arg) => arg === "--tail" || arg.startsWith("--tail="), consumeAttachTail],
];

function attachArgHandler(arg: string): AttachArgHandler | undefined {
  return ATTACH_ARG_HANDLERS.find(([matches]) => matches(arg))?.[1];
}

function consumeAttachShell(
  args: string[],
  index: number,
  arg: string,
  state: { shell: string },
): number {
  const value = arg === "--shell" ? args[index + 1] : arg.slice("--shell=".length);
  if (!value) {
    die("--shell requires a value");
  }
  state.shell = value;
  return arg === "--shell" ? index + 1 : index;
}

function consumeAttachTail(
  args: string[],
  index: number,
  arg: string,
  state: { tail?: number | "all" },
): number {
  const { value, nextIndex } = attachTailValue(args, index, arg);
  state.tail = parseAttachTail(value);
  return nextIndex;
}

function attachTailValue(
  args: string[],
  index: number,
  arg: string,
): { value: string | undefined; nextIndex: number } {
  if (arg !== "--tail") {
    return { value: arg.slice("--tail=".length), nextIndex: index };
  }
  const peek = args[index + 1];
  if (peek && /^[0-9]+$/.test(peek)) {
    return { value: peek, nextIndex: index + 1 };
  }
  return { value: undefined, nextIndex: index };
}

function parseAttachTail(value: string | undefined): number | "all" {
  // `--tail` (no value) prints the whole snapshot. `--tail N`
  // prints the last N lines. The snapshot is capped at ~1 MiB so
  // even the no-value form is bounded.
  if (value === undefined) {
    return "all";
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    die(`--tail: expected a non-negative integer, got '${value}'`);
  }
  return n;
}

function printAttachTailIfRequested(opts: AttachOptionsCli): void {
  // #150 phase 2 PR3: --tail dumps the boot-console snapshot before
  // (or instead of) the interactive shell. Look up the registry entry
  // directly — `attach()` only returns a VmHandle, not the registry row.
  if (opts.tail === undefined) {
    return;
  }
  const entry = lookupAttachTailEntry(opts.target);
  printBootLogTail(entry.bootLogPath!, opts.tail);
}

function lookupAttachTailEntry(target: Target): RegistryEntry {
  const entry = lookupEntry(target);
  if (!entry) {
    die(`machinen attach: no running VM matched ${describeTarget(target)}`);
  }
  if (!entry.bootLogPath) {
    die(
      `machinen attach --tail: VM was not booted with --detached, no snapshot exists. ` +
        `Use 'machinen attach' (no --tail) for live console access.`,
    );
  }
  return entry;
}

async function runAttachedPty(vm: VmHandle, shell: string): Promise<number> {
  if (!process.stdin.isTTY) {
    await vm.detach();
    die("machinen attach: stdin is not a TTY (pipe scripts via `machinen repl` instead)");
  }
  process.stderr.write(`attached to ${vm.name ?? `pid ${vm.pid}`} — exit the shell to detach.\n`);
  try {
    return await runPtyExec(vm, shell);
  } finally {
    await vm.detach();
  }
}

function printBootLogTail(path: string, tail: number | "all"): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (err) {
    process.stderr.write(
      `machinen attach --tail: couldn't read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return;
  }
  process.stderr.write(tailLines(content, tail));
}

async function cmdRepl(args: string[]): Promise<number> {
  // Per-line exec REPL — every line you type is a fresh one-shot
  // command, so `cd`, env vars, and shell history do NOT carry over.
  // This is the niche `attach` used to fill; kept around for piping
  // a script of one-liners (e.g. `cat cmds.txt | machinen repl ...`).
  // For an actual interactive shell, use `machinen attach`.
  const target = parseTargetFlags(args, "repl");
  const vm = await attach(target).catch(handleError);
  printReplIntro(vm);
  try {
    await runReplLoop(vm);
    return 0;
  } finally {
    await vm.detach();
  }
}

function printReplIntro(vm: VmHandle): void {
  process.stderr.write(`repl: ${vm.name ?? `pid ${vm.pid}`}\n`);
  process.stderr.write(
    `each line is a fresh one-shot exec — cd / env vars / history do NOT persist.\n` +
      `for an interactive shell with job control + TUI support, use:\n` +
      `  machinen attach ${vm.name ?? vm.pid}\n` +
      `Ctrl-D to exit.\n`,
  );
}

async function runReplLoop(vm: VmHandle): Promise<void> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  for await (const line of rl) {
    await runReplLine(vm, line);
  }
}

async function runReplLine(vm: VmHandle, line: string): Promise<void> {
  if (line.length === 0) {
    return;
  }
  await vm.execRaw(line, {
    onStdout: (chunk) => process.stdout.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
  });
}

async function cmdAgentContext(args: string[]): Promise<number> {
  // The whole point of `agent-context` is structured output, so --json
  // is implicit. Reject anything else so we don't quietly ignore typos
  // that an agent might rely on.
  for (const a of args) {
    if (a !== "--json") {
      die(`unknown argument: ${a}`);
    }
  }
  emitJson(buildAgentContext());
  return 0;
}

async function cmdFeedback(args: string[]): Promise<number> {
  // Two shapes:
  //   machinen feedback "<text>"        — append a JSONL entry
  //   machinen feedback --list          — print recent entries
  // --json on either form returns a structured envelope.
  const opts = parseFeedbackOptions(args);
  if (opts.listMode) {
    return listFeedback(opts);
  }
  return recordFeedback(opts);
}

interface FeedbackOptions {
  json: boolean;
  listMode: boolean;
  positional: string[];
}

function parseFeedbackOptions(args: string[]): FeedbackOptions {
  const { json, rest } = consumeJsonFlag(args);
  const opts: FeedbackOptions = { json, listMode: false, positional: [] };
  for (const arg of rest) {
    consumeFeedbackArg(opts, arg);
  }
  return opts;
}

function consumeFeedbackArg(opts: FeedbackOptions, arg: string): void {
  if (arg === "--list") {
    opts.listMode = true;
    return;
  }
  if (arg.startsWith("--")) {
    die(`unknown argument: ${arg}`);
  }
  opts.positional.push(arg);
}

function listFeedback(opts: FeedbackOptions): number {
  if (opts.positional.length > 0) {
    die("machinen feedback --list takes no positional arguments");
  }
  const entries = readFeedback();
  if (opts.json) {
    emitJson({ schema_version: 1, entries });
    return 0;
  }
  printFeedbackEntries(entries);
  return 0;
}

function printFeedbackEntries(entries: ReturnType<typeof readFeedback>): void {
  if (entries.length === 0) {
    process.stdout.write("(no feedback recorded)\n");
    return;
  }
  for (const entry of entries) {
    process.stdout.write(`${entry.timestamp}  ${entry.text}\n`);
  }
}

async function recordFeedback(opts: FeedbackOptions): Promise<number> {
  if (opts.positional.length === 0) {
    die('usage: machinen feedback "<text>" | machinen feedback --list');
  }
  const path = feedbackPath();
  const entry = newFeedbackEntry(opts.positional.join(" "));
  appendFeedback(entry, path);
  const upstream = await postUpstream(entry);
  reportFeedbackRecorded(opts, path, upstream);
  return 0;
}

function newFeedbackEntry(text: string): Parameters<typeof appendFeedback>[0] {
  return {
    timestamp: new Date().toISOString(),
    cli_version: VERSION,
    text,
  };
}

function reportFeedbackRecorded(
  opts: FeedbackOptions,
  path: string,
  upstream: Awaited<ReturnType<typeof postUpstream>>,
): void {
  if (opts.json) {
    emitJson({ schema_version: 1, recorded: true, path, upstream_status: upstream.status });
    return;
  }
  process.stdout.write(feedbackRecordedMessage(upstream));
}

function feedbackRecordedMessage(upstream: Awaited<ReturnType<typeof postUpstream>>): string {
  if (upstream.attempted && upstream.status !== null) {
    return `feedback recorded locally and sent upstream (status: ${upstream.status})\n`;
  }
  if (upstream.attempted) {
    return `feedback recorded locally; upstream POST failed: ${upstream.error}\n`;
  }
  return "feedback recorded locally (1 entry)\n";
}

async function cmdCompletion(args: string[]): Promise<number> {
  const shell = args[0] ?? "bash";
  const completion = completionForShell(shell);
  if (completion === undefined) {
    die(`unsupported shell: ${shell} (expected bash | zsh | fish)`);
  }
  process.stdout.write(completion);
  return 0;
}

function completionForShell(shell: string): string | undefined {
  return new Map([
    ["bash", BASH_COMPLETION],
    ["zsh", ZSH_COMPLETION],
    ["fish", FISH_COMPLETION],
  ]).get(shell);
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

// Names live in column 2 of `machinen ls`; pids in column 1. Both
// are completion candidates for the first positional on
// exec/snapshot/fork/attach/repl/stop.
const BASH_COMPLETION = `# machinen bash completion — source this from ~/.bashrc, or:
#   eval "$(machinen completion bash)"
_machinen_completion() {
  local cur prev words cword
  _init_completion || return
  local cmds="boot capture support restore install list ls ps exec snapshot fork attach repl gc stop feedback agent-context completion --version --help -h -v"
  if [[ \${cword} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${cmds}" -- "\${cur}") )
    return
  fi
  case "\${words[1]}" in
    exec|snapshot|fork|attach|repl|stop)
      # First positional after the subcommand is the target.
      if [[ \${cword} -eq 2 ]]; then
        local targets
        targets=$(machinen ls 2>/dev/null | awk 'NR>1{print $1; if ($2!="-") print $2}')
        COMPREPLY=( $(compgen -W "\${targets}" -- "\${cur}") )
        return
      fi
      ;;
    gc)
      COMPREPLY=( $(compgen -W "--dry-run" -- "\${cur}") )
      return
      ;;
  esac
}
complete -F _machinen_completion machinen mn
`;

const ZSH_COMPLETION = `# machinen zsh completion — source this from ~/.zshrc, or:
#   eval "$(machinen completion zsh)"
_machinen() {
  local -a cmds
  cmds=(boot capture support restore install list ls ps exec snapshot fork attach repl gc stop feedback agent-context completion)
  if (( CURRENT == 2 )); then
    _describe 'command' cmds
    return
  fi
  case "\${words[2]}" in
    exec|snapshot|fork|attach|repl|stop)
      # First positional after the subcommand is the target.
      if (( CURRENT == 3 )); then
        local -a targets
        targets=(\${(f)"$(machinen ls 2>/dev/null | awk 'NR>1{print $1; if ($2!="-") print $2}')"})
        _describe 'target' targets
        return
      fi
      ;;
    gc)
      _describe 'flag' '(--dry-run)'
      return
      ;;
  esac
}
compdef _machinen machinen mn
`;

const FISH_COMPLETION = `# machinen fish completion — source this from your config.fish, or:
#   machinen completion fish | source
set -l cmds boot capture support restore install list ls ps exec snapshot fork attach repl gc stop feedback agent-context completion
for bin in machinen mn
  complete -c $bin -f -n 'not __fish_seen_subcommand_from $cmds' -a "$cmds"
  for sub in exec snapshot fork attach repl stop
    # First positional after the subcommand: complete with VM names + pids.
    complete -c $bin -f -n "__fish_seen_subcommand_from $sub" \\
      -a '(machinen ls 2>/dev/null | awk \\'NR>1{print $1; if ($2!="-") print $2}\\')'
  end
  complete -c $bin -f -n "__fish_seen_subcommand_from gc" -l dry-run
end
`;

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
      `  machinen capture postgres --out <dir> --source-arch <arm64|amd64>\n` +
      `                    --target-arch <arm64|amd64> --dump <file>\n` +
      `                    --source-verifier-output <file> --postgres-version <v>\n` +
      `                    --checkpoint-lsn <lsn> [--json] [--dry-run]\n` +
      `                                                 Capture the implemented portable\n` +
      `                                                 PostgreSQL logical-state product\n` +
      `                                                 bundle. Inputs are produced from a\n` +
      `                                                 real Machinen source VM with pg_dump,\n` +
      `                                                 CHECKPOINT, and verifier SQL.\n` +
      `  machinen capture eventfd --out <dir> --source-arch <arm64|amd64>\n` +
      `                    --target-arch <arm64|amd64> --source-verifier-output <file>\n` +
      `                    --counter <n> [--json]\n` +
      `                                                 Capture the implemented narrow Level 4\n` +
      `                                                 eventfd counter descriptor. Unsafe\n` +
      `                                                 waiters, aliases, semaphore mode, and\n` +
      `                                                 active syscalls refuse fail-closed.\n` +
      `  machinen capture pipe --out <dir> --source-arch <arm64|amd64>\n` +
      `                    --target-arch <arm64|amd64> --source-verifier-output <file>\n` +
      `                    --read-fd <n> --write-fd <n> [--json]\n` +
      `                                                 Capture the implemented narrow Level 4\n` +
      `                                                 empty pipe pair descriptor. Buffered\n` +
      `                                                 bytes, waiters, closed peers, and\n` +
      `                                                 active syscalls refuse fail-closed.\n` +
      `  machinen capture timerfd --out <dir> --source-arch <arm64|amd64>\n` +
      `                    --target-arch <arm64|amd64> --source-verifier-output <file>\n` +
      `                    --remaining-ms <n> [--json]\n` +
      `                                                 Capture the implemented narrow Level 4\n` +
      `                                                 relative one-shot timerfd descriptor.\n` +
      `                                                 Unread expirations, periodic timers,\n` +
      `                                                 absolute timers, and active reads refuse.\n` +
      `  machinen capture tcp-listener --out <dir> --source-arch <arm64|amd64>\n` +
      `                    --target-arch <arm64|amd64> --source-verifier-output <file>\n` +
      `                    --bind-address 127.0.0.1 --port <n> --backlog <n> [--json]\n` +
      `                                                 Capture the implemented narrow Level 4\n` +
      `                                                 loopback TCP listener descriptor.\n` +
      `                                                 Active connections, accept queues,\n` +
      `                                                 partial IO, and active syscalls refuse.\n` +
      `  machinen capture ping-socket --out <dir> --source-arch <arm64|amd64>\n` +
      `                    --target-arch <arm64|amd64> --socket-kind <ping-dgram-icmp|raw-icmp>\n` +
      `                    --source-verifier-output <file> --echo-id <n> --echo-seq <n> [--json]\n` +
      `                                                 Capture the implemented narrow Level 4\n` +
      `                                                 ping/raw ICMP socket descriptor.\n` +
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
      `  machinen restore <portable-postgres-bundle> --target-arch <arm64|amd64>\n` +
      `                    --target-verifier-output <file> [--json]\n` +
      `                                                 Complete the portable PostgreSQL\n` +
      `                                                 product restore after importing the\n` +
      `                                                 descriptor dump into target-native\n` +
      `                                                 PostgreSQL and running verifier SQL.\n` +
      `  machinen restore <portable-eventfd-bundle> --target-arch <arm64|amd64>\n` +
      `                    [--target-verifier-output <file>] [--json]\n` +
      `                                                 Boot a target VM and recreate the narrow\n` +
      `                                                 Level 4 eventfd counter target-natively.\n` +
      `  machinen restore <portable-pipe-bundle> --target-arch <arm64|amd64>\n` +
      `                    [--target-verifier-output <file>] [--json]\n` +
      `                                                 Boot a target VM and recreate the narrow\n` +
      `                                                 Level 4 pipe pair target-natively.\n` +
      `  machinen restore <portable-timerfd-bundle> --target-arch <arm64|amd64>\n` +
      `                    [--target-verifier-output <file>] [--json]\n` +
      `                                                 Boot a target VM and recreate the narrow\n` +
      `                                                 Level 4 timerfd target-natively.\n` +
      `  machinen restore <portable-tcp-listener-bundle> --target-arch <arm64|amd64>\n` +
      `                    [--target-verifier-output <file>] [--json]\n` +
      `                                                 Boot a target VM and recreate the narrow\n` +
      `                                                 Level 4 TCP listener target-natively.\n` +
      `  machinen restore <portable-ping-socket-bundle> --target-arch <arm64|amd64>\n` +
      `                    [--target-verifier-output <file>] [--json]\n` +
      `                                                 Boot a target VM and continue the narrow\n` +
      `                                                 Level 4 ping workload target-natively.\n` +
      `\n` +
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
      `  machinen snapshot <name|pid> <out-dir> [--portable] [--keep-alive]\n` +
      `  machinen snapshot <name|pid> --out <dir> [--portable] [--keep-alive]\n` +
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
      `                                                 boot --detach, support, feedback,\n` +
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
      `  machinen capture postgres --out ./pg.portable --source-arch arm64 --target-arch amd64 \\\n` +
      `    --dump ./pg.dump --source-verifier-output ./verify.txt --postgres-version 15 \\\n` +
      `    --checkpoint-lsn 0/16B6C50\n` +
      `  machinen restore ./pg.portable --target-arch amd64 --target-verifier-output ./verify.txt\n` +
      `  machinen capture eventfd --out ./eventfd.portable --source-arch arm64 --target-arch amd64 \\\n` +
      `    --source-verifier-output ./eventfd.verify --counter 42\n` +
      `  machinen restore ./eventfd.portable --target-arch amd64 --json\n` +
      `  machinen capture pipe --out ./pipe.portable --source-arch arm64 --target-arch amd64 \\\n` +
      `    --source-verifier-output ./pipe.verify --read-fd 10 --write-fd 12\n` +
      `  machinen restore ./pipe.portable --target-arch amd64 --json\n` +
      `  machinen capture timerfd --out ./timerfd.portable --source-arch arm64 --target-arch amd64 \\\n` +
      `    --source-verifier-output ./timerfd.verify --remaining-ms 60000\n` +
      `  machinen restore ./timerfd.portable --target-arch amd64 --json\n` +
      `  machinen capture tcp-listener --out ./tcp.portable --source-arch arm64 --target-arch amd64 \\\n` +
      `    --source-verifier-output ./tcp.verify --bind-address 127.0.0.1 --port 18080 --backlog 16\n` +
      `  machinen restore ./tcp.portable --target-arch amd64 --json\n` +
      `  machinen capture ping-socket --out ./ping.portable --source-arch arm64 --target-arch amd64 \\\n` +
      `    --socket-kind ping-dgram-icmp --source-verifier-output ./ping.verify --echo-id 7 --echo-seq 1\n` +
      `  machinen restore ./ping.portable --target-arch amd64 --json\n` +
      `  machinen support --family network-ping-socket --json\n` +
      `\n` +
      `Environment:\n` +
      `  MACHINEN_VMM                             Override the VMM binary path (dev)\n` +
      `  MACHINEN_ASSETS_DIR                      Use base assets from this directory\n` +
      `                                           instead of the cache / GH Releases\n` +
      `  MACHINEN_GUEST_ARCH                      Guest asset arch: arm64 or amd64\n` +
      `  MACHINEN_SNAPSHOT_ENGINE                Snapshot engine: vmstate (default),\n` +
      `                                           criu, or portable (Level 4 ping\n` +
      `                                           machine subset; experimental for others)\n` +
      `  MACHINEN_PORTABLE_TARGET_ARCH           Optional portable ping target arch override\n` +
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
