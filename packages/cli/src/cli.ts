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
//   machinen install [--version <tag>]
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
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  attach,
  boot,
  formatMachinenError,
  isMachinenError,
  list,
  readHostRssBytesMulti,
  restore,
  runGc,
  validatePid,
} from "@machinen/runtime";
import type { RegistryEntry } from "@machinen/runtime";
import debugLib from "debug";

import pkg from "../package.json" with { type: "json" };
import { buildAgentContext } from "./agent-context.ts";
import { appendFeedback, feedbackPath, postUpstream, readFeedback } from "./feedback.ts";
import { formatMem } from "./format-mem.ts";
import { formatPorts } from "./format-ports.ts";
import { parseForkArgs } from "./parse-fork-args.ts";
import { parseRestoreArgs } from "./parse-restore-args.ts";
import { parseRunArgs } from "./parse-run-args.ts";
import { extractTarget, type Target } from "./parse-target.ts";
import { tailLines } from "./tail-lines.ts";

const debug = debugLib("machinen:cli");

const VERSION = pkg.version;
// Slash-free tag shape — GitHub's release web UI and the
// `releases/download/<tag>/<asset>` URL pattern both fall over when the
// tag itself contains a `/` (the router can't tell where the tag ends
// and the asset path begins). The previous `@machinen/runtime@0.0.0`
// tag created releases that the API could see but no public URL could
// fetch from. Keep the shape `runtime-v<semver>`.
const RELEASE_TAG = `runtime-v${VERSION}`;
const REPO = "redwoodjs/machinen";
const CACHE_ROOT = join(homedir(), ".machinen");

// ------------------------------------------------------------
// Base-asset cache
// ------------------------------------------------------------

function cacheDirFor(tag: string): string {
  return join(CACHE_ROOT, tag);
}

function baseDirFor(tag: string, distro = "debian", cpu = "arm64"): string {
  return join(cacheDirFor(tag), "bases", `${distro}-${cpu}`);
}

function baseAssetsComplete(tag: string): boolean {
  const base = baseDirFor(tag);
  return (
    existsSync(join(base, "Image")) &&
    existsSync(join(base, "virt.dtb")) &&
    existsSync(join(base, "rootfs.tar.gz"))
  );
}

// Names match what `./scripts/build-base-assets.sh` produces under
// `release-assets/` — the same files that get uploaded to the GH
// Release and downloaded by `ensureBaseAssets`.
const ASSETS_DIR_FILES = ["Image-arm64", "virt-arm64.dtb", "rootfs-debian-arm64.tar.gz"];

function validateAssetsDir(dir: string): void {
  const abs = resolve(dir);
  if (!existsSync(abs)) {
    die(`MACHINEN_ASSETS_DIR=${dir} does not exist`);
  }
  const missing = ASSETS_DIR_FILES.filter((f) => !existsSync(join(abs, f)));
  if (missing.length > 0) {
    die(
      `MACHINEN_ASSETS_DIR=${dir} is missing: ${missing.join(", ")}\n` +
        `  Produce them with ./scripts/build-base-assets.sh (outputs to ./release-assets/).`,
    );
  }
}

async function ensureBaseAssets(tag: string): Promise<string> {
  const base = baseDirFor(tag);
  const kernel = join(base, "Image");
  const dtb = join(base, "virt.dtb");
  const tarball = join(base, "rootfs.tar.gz");

  if (existsSync(kernel) && existsSync(dtb) && existsSync(tarball)) {
    return base;
  }

  mkdirSync(base, { recursive: true });

  // The repo is private, so the public `releases/download/<tag>/<asset>`
  // path 404s for unauthenticated callers. Look up asset IDs once via
  // the API (with the host's `gh auth token`) and stream each one
  // through `releases/assets/<id>` with `Accept: application/octet-stream`,
  // which is the same path `gh release download` uses internally.
  const token = ghAuthToken();
  const assetIndex = await fetchReleaseAssets(tag, token);

  const assets = [
    { name: "Image-arm64", dest: kernel },
    { name: "virt-arm64.dtb", dest: dtb },
    { name: "rootfs-debian-arm64.tar.gz", dest: tarball },
  ];

  await Promise.all(assets.map((a) => downloadWithChecksum(a.name, a.dest, assetIndex, token)));

  const current = join(CACHE_ROOT, "current");
  try {
    if (existsSync(current) || isSymlink(current)) {
      unlinkSync(current);
    }
  } catch {}
  symlinkSync(tag, current, "dir");

  return base;
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

function ghAuthToken(): string {
  // `gh auth token` is the user-facing way to get the OAuth token —
  // matches the project's stance of "user authenticates via gh, never
  // raw API keys" (see CLAUDE.md). Errors loud if gh isn't installed
  // or the user hasn't logged in: re-running with a hint is much
  // friendlier than a downstream 401 on the API call.
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    die(
      `failed to read gh auth token (${msg}).\n` +
        "  Install GitHub CLI and run `gh auth login` so the runtime can fetch\n" +
        `  release assets from the private repo ${REPO}.`,
    );
  }
}

interface ReleaseAssetIndex {
  byName: Map<string, number>;
}

async function fetchReleaseAssets(tag: string, token: string): Promise<ReleaseAssetIndex> {
  const url = `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    die(
      `lookup release ${tag} failed: ${res.status} ${res.statusText}\n` +
        `  url: ${url}\n` +
        "  check that `gh auth token` returns a token with repo-read scope, and that the\n" +
        `  release tag exists in ${REPO}.`,
    );
  }
  const body = (await res.json()) as { assets?: Array<{ id: number; name: string }> };
  const byName = new Map<string, number>();
  for (const a of body.assets ?? []) {
    byName.set(a.name, a.id);
  }
  return { byName };
}

async function downloadWithChecksum(
  asset: string,
  dest: string,
  index: ReleaseAssetIndex,
  token: string,
): Promise<void> {
  const tmp = `${dest}.partial`;

  process.stderr.write(`  fetch ${asset}\n`);
  await downloadAssetById(asset, tmp, index, token);

  const sha = (await fetchAssetText(`${asset}.sha256`, index, token)).trim().split(/\s+/)[0];
  const got = sha256OfFile(tmp);
  if (sha && got !== sha) {
    unlinkSync(tmp);
    die(`checksum mismatch for ${asset}: expected ${sha}, got ${got}`);
  }
  renameSync(tmp, dest);
}

async function downloadAssetById(
  name: string,
  dest: string,
  index: ReleaseAssetIndex,
  token: string,
): Promise<void> {
  const id = index.byName.get(name);
  if (id === undefined) {
    die(`asset not found in release: ${name}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  const url = `https://api.github.com/repos/${REPO}/releases/assets/${id}`;
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok || !res.body) {
    die(`fetch asset ${name} failed: ${res.status} ${res.statusText}`);
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
}

async function fetchAssetText(
  name: string,
  index: ReleaseAssetIndex,
  token: string,
): Promise<string> {
  const id = index.byName.get(name);
  if (id === undefined) {
    die(`asset not found in release: ${name}`);
  }
  const url = `https://api.github.com/repos/${REPO}/releases/assets/${id}`;
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    die(`fetch asset ${name} failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function sha256OfFile(path: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
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

// Print the "press Ctrl-D to stop" hint and schedule a second print
// `repeatAfterMs` later. The boot/restore output buries the first hint
// under kernel logs and init checkpoints; reprinting once the scroll
// settles puts it back where the user is most likely to read it.
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

async function cmdBoot(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseRunArgs(args);
  } catch (err) {
    handleError(err);
  }
  const {
    positional,
    double_dash_args,
    mount,
    liveMounts,
    env,
    portForward,
    snapshot,
    name,
    guestCwd,
    detached,
    memory,
    json,
  } = parsed;
  if (json && !detached) {
    die("boot --json is only meaningful with --detach (attached boots take over stdio).");
  }

  if (positional.length > 1) {
    die(
      "usage: machinen boot [<image>] [--snapshot <path>] [--name <name>] " +
        "[--cwd <abs-path>] " +
        "[--mount ...] [--mount-live ...] [--env KEY=VALUE]... [--detached] " +
        "[--memory <mib>] [-- <cmd> [args...]]",
    );
  }
  const imageOverride = positional[0];

  // Base assets (kernel + dtb + rootfs) are needed to boot.
  //
  // MACHINEN_ASSETS_DIR overrides the cache entirely — used for local
  // dev against `./scripts/build-base-assets.sh` output, airgapped
  // installs, and anywhere a GitHub Releases fetch isn't possible.
  // Otherwise auto-download them on first run so users don't have to
  // remember `machinen install`.
  const assetsOverride = process.env.MACHINEN_ASSETS_DIR;
  if (assetsOverride) {
    validateAssetsDir(assetsOverride);
  } else if (!baseAssetsComplete(RELEASE_TAG)) {
    process.stderr.write(`machinen: fetching base assets for ${RELEASE_TAG} (first run)\n`);
    await ensureBaseAssets(RELEASE_TAG);
  }

  // Resolve the kernel, DTB, and base rootfs tarball.
  // MACHINEN_ASSETS_DIR uses the unrenamed build-base-assets.sh output
  // names; the cache renames on download (see `ensureBaseAssets`'s
  // `assets` array). When the caller passes an image positional, it
  // replaces the default base rootfs; kernel + DTB still come from
  // the cache.
  const baseDir = assetsOverride ? resolve(assetsOverride) : baseDirFor(RELEASE_TAG);
  const kernelPath = join(baseDir, assetsOverride ? "Image-arm64" : "Image");
  const dtbPath = join(baseDir, assetsOverride ? "virt-arm64.dtb" : "virt.dtb");
  const defaultImagePath = join(
    baseDir,
    assetsOverride ? "rootfs-debian-arm64.tar.gz" : "rootfs.tar.gz",
  );
  const imagePath = imageOverride ? resolve(imageOverride) : defaultImagePath;
  debug(
    "boot baseDir=%s kernel=%s dtb=%s image=%s snapshot=%s name=%s",
    baseDir,
    kernelPath,
    dtbPath,
    imagePath,
    snapshot ?? "<none>",
    name ?? "<unset>",
  );

  // Wrap the user cmd in /usr/bin/env so bare names like `node` or
  // `bash` are PATH-resolved. The guest init uses execve(), which
  // needs an absolute path for argv[0]; /usr/bin/env is the standard
  // shim for this. When the caller passes no `-- cmd`, the image may
  // carry a baked-in default (see `provision({ cmd })`); boot() falls
  // back to that automatically.
  const cmd = double_dash_args.length > 0 ? ["/usr/bin/env", ...double_dash_args] : undefined;

  let vm;
  try {
    vm = await boot({
      // Always pass the base rootfs so /sbin/machinen-restore and
      // friends are in the initramfs even on a bare `machinen restore
      // <snap>` (no --image, no -- cmd).
      image: imagePath,
      cmd,
      env,
      kernel: kernelPath,
      dtb: dtbPath,
      mount,
      liveMounts,
      portForward,
      snapshot,
      name,
      guestCwd,
      detached,
      memory,
      // Interactive CLI: the session lives as long as the guest does.
      // Don't impose the default 60s cap. Detached boots fall back to
      // the runtime's own readiness timeout (60s) so the CLI can't
      // hang forever waiting for first-guest-byte.
      timeoutMs: detached ? undefined : null,
    });
  } catch (err) {
    handleError(err);
  }

  // #150 phase 2: detached boot — VMM is already unrefed inside boot()
  // and the registry entry stays live for `machinen attach`. Print a
  // short hint so users know how to reach the VM and exit cleanly.
  // Cleanup of per-boot disks/dirs is documented as a known limitation
  // of PR1; PR2 ships `machinen gc` and `machinen stop`.
  if (detached) {
    if (json) {
      emitJson({
        schema_version: 1,
        pid: vm.pid,
        name: name ?? null,
        detached: true,
      });
    } else {
      const target = name ?? `pid ${vm.pid}`;
      process.stderr.write(
        `machinen: detached (${target}). ` +
          `Reattach: machinen attach ${name ?? vm.pid}\n` +
          `Stop: kill ${vm.pid}  (machinen stop ships in PR2)\n`,
      );
    }
    return 0;
  }

  vm.stdout.pipe(process.stdout);
  vm.stderr.pipe(process.stderr);
  const restoreStdin = rawModeStdinIfTTY();
  const cancelHintRepeat = printCtrlDHint();

  // Propagate SIGINT/SIGTERM to the VMM child. With stdin in raw mode
  // the host kernel no longer turns keyboard Ctrl-C into SIGINT (the
  // byte goes through to the guest), so this only fires when the CLI
  // is signalled directly — e.g. a supervisor sending SIGTERM to node,
  // or `kill -INT <cli-pid>` from another shell. Without this, the
  // VMM survives as an orphan.
  //
  // Ctrl-D from the user's terminal lands in pipeStdinToVm below and
  // funnels into the same vm.kill() path with SIGTERM exit semantics.
  let forwardedSignal: "SIGINT" | "SIGTERM" | null = null;
  const onSigint = () => {
    forwardedSignal = "SIGINT";
    void vm.kill();
  };
  const onSigterm = () => {
    forwardedSignal = "SIGTERM";
    void vm.kill();
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  pipeStdinToVm(vm.stdin, () => {
    process.stderr.write("\nmachinen: Ctrl-D — stopping VM\n");
    forwardedSignal = "SIGTERM";
    void vm.kill();
  });

  try {
    const { code } = await vm.wait();
    if (forwardedSignal === "SIGINT") {
      return 130;
    }
    if (forwardedSignal === "SIGTERM") {
      return 143;
    }
    return code ?? 0;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    cancelHintRepeat();
    restoreStdin();
  }
}

async function cmdInstall(args: string[]): Promise<number> {
  const { json, rest } = consumeJsonFlag(args);
  const tag = argValue(rest, "--version") ?? RELEASE_TAG;
  const wasComplete = baseAssetsComplete(tag);
  if (!json) {
    process.stderr.write(`Installing base assets for ${tag} into ${cacheDirFor(tag)}\n`);
  }
  const base = await ensureBaseAssets(tag);
  if (json) {
    emitJson({
      schema_version: 1,
      tag,
      base_dir: base,
      fetched: !wasComplete,
    });
  } else {
    process.stderr.write(`Ready: ${base}\n`);
  }
  return 0;
}

async function cmdRestore(args: string[]): Promise<number> {
  // `machinen restore <snap-dir> [--image <tarball>] [--name <name>]
  // [--lazy] [-p <hostPort>:<guestPort>]`. The bundle dir
  // (produced by `machinen snapshot`) holds img/<criu-images> +
  // meta.json. The bundle carries CRIU's process images but not the
  // workload's rootfs, so any process whose memory map references
  // files outside the base debian rootfs (e.g. /usr/bin/node from a
  // `provision()`d tarball) needs the same workload tarball passed
  // here as `--image`. Without it, criu fails its file-backed VMA
  // restore with "Can't open file <path> on restore: No such file
  // or directory" and /sbin/machinen-restore exits 1, panicking the
  // guest kernel ("Attempted to kill init!").
  //
  // Restore is eager by default: the runtime packs the CRIU image
  // as a tar on /dev/vdb, the guest's /sbin/machinen-restore untars
  // into tmpfs, and CRIU loads everything up front. Pass `--lazy`
  // to opt into the #266 path — vsock-FUSE-mount the bundle into
  // the guest and run `criu restore --lazy-pages` so workload pages
  // flow in only when faulted. Lazy keeps host RSS proportional to
  // the touched set but doesn't compose with `--detach` and trades
  // simplicity for a per-page UFFD round-trip cost.
  let parsed;
  try {
    parsed = parseRestoreArgs(args);
  } catch (err) {
    handleError(err);
  }
  const { positional, name, image: imageOverride, portForward, lazy, liveMounts } = parsed;
  if (positional.length !== 1) {
    die(
      "usage: machinen restore <snap-dir> [--image <tarball>] [--name <name>] " +
        "[--lazy] [-p <hostPort>:<guestPort>] " +
        "[--mount-live <host>:<guest>[:<mode>]]",
    );
  }
  const snapDir = resolve(positional[0]!);

  // Kernel + dtb always come from the base assets (the workload tarball
  // doesn't carry them). The rootfs comes from --image when given, or
  // falls back to meta.sourceImage inside restore() so the same-host
  // quickstart works without a flag. The base release rootfs is no
  // longer a silent default — workloads beyond a bare /bin/sh need
  // their own tarball, and a confused-by-default restore that panics
  // the guest kernel was the original bug we shipped this fix for.
  const assetsOverride = process.env.MACHINEN_ASSETS_DIR;
  if (assetsOverride) {
    validateAssetsDir(assetsOverride);
  } else if (!baseAssetsComplete(RELEASE_TAG)) {
    process.stderr.write(`machinen: fetching base assets for ${RELEASE_TAG} (first run)\n`);
    await ensureBaseAssets(RELEASE_TAG);
  }
  const baseDir = assetsOverride ? resolve(assetsOverride) : baseDirFor(RELEASE_TAG);
  const kernelPath = join(baseDir, assetsOverride ? "Image-arm64" : "Image");
  const dtbPath = join(baseDir, assetsOverride ? "virt-arm64.dtb" : "virt.dtb");

  let imagePath: string | undefined;
  if (imageOverride) {
    imagePath = resolve(imageOverride);
    if (!existsSync(imagePath)) {
      die(`--image: file not found: ${imagePath}`);
    }
  }

  let vm;
  try {
    vm = await restore({
      snapDir,
      image: imagePath,
      kernel: kernelPath,
      dtb: dtbPath,
      name,
      lazy,
      portForward: portForward.length > 0 ? portForward : undefined,
      // #273: per-guest overrides for the bundle's recorded
      // liveMounts. Empty list = use the bundle's recorded mounts
      // verbatim; non-empty entries replace the matching guest's
      // host/mode (BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN if no match).
      liveMounts: liveMounts.length > 0 ? liveMounts : undefined,
      timeoutMs: null,
    });
  } catch (err) {
    handleError(err);
  }

  process.stderr.write(`restored as: ${vm.name ?? "<anonymous>"} (pid ${vm.pid})\n`);

  vm.stdout.pipe(process.stdout);
  vm.stderr.pipe(process.stderr);
  const restoreStdin = rawModeStdinIfTTY();
  const cancelHintRepeat = printCtrlDHint();

  let forwardedSignal: "SIGINT" | "SIGTERM" | null = null;
  const onSigint = () => {
    forwardedSignal = "SIGINT";
    void vm.kill();
  };
  const onSigterm = () => {
    forwardedSignal = "SIGTERM";
    void vm.kill();
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  pipeStdinToVm(vm.stdin, () => {
    process.stderr.write("\nmachinen: Ctrl-D — stopping VM\n");
    forwardedSignal = "SIGTERM";
    void vm.kill();
  });

  try {
    const { code } = await vm.wait();
    if (forwardedSignal === "SIGINT") {
      return 130;
    }
    if (forwardedSignal === "SIGTERM") {
      return 143;
    }
    return code ?? 0;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    cancelHintRepeat();
    restoreStdin();
  }
}

async function cmdLs(args: string[]): Promise<number> {
  const { json, rest } = consumeJsonFlag(args);
  if (rest.length > 0) {
    die(`unknown argument: ${rest[0]}`);
  }
  const entries = list();
  const rssByPid = readHostRssBytesMulti(
    entries.map((e) => ({ pid: e.pid, statsPath: e.statsPath })),
  );
  if (json) {
    emitJson({
      schema_version: 1,
      vms: entries.map((e) => ({
        pid: e.pid,
        name: e.name ?? null,
        started_at: e.startedAt,
        uptime_ms: Date.now() - e.startedAt,
        memory: {
          rss_bytes: rssByPid.get(e.pid) ?? null,
          ceiling_mib: e.memoryCeilingMib ?? null,
        },
        ports: e.portForward ?? [],
        forked_from: e.forkedFrom ?? null,
      })),
    });
    return 0;
  }
  if (entries.length === 0) {
    process.stdout.write("(no running VMs)\n");
    return 0;
  }
  // Plain tabular output. PID is the runtime handle; NAME is the
  // optional human label; MEM is `hostRss/ceiling` (#274); PORTS lists
  // `<hostPort>:<guestPort>` pairs configured at boot/fork
  // (comma-separated, `-` if none); FORKED-FROM lets you trace
  // lineage when the VM was created via `machinen restore`.
  const header = ["PID", "NAME", "UP", "MEM", "PORTS", "FORKED-FROM"];
  const rows = entries.map((e) => [
    String(e.pid),
    e.name ?? "-",
    formatUptime(Date.now() - e.startedAt),
    formatMem(rssByPid.get(e.pid) ?? null, e.memoryCeilingMib),
    formatPorts(e.portForward),
    e.forkedFrom ?? "-",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const gap = "  ";
  const fullWidth = widths.reduce((sum, w) => sum + w, 0) + gap.length * (widths.length - 1);
  // Hide MEM (column index 3) on terminals that can't fit the full
  // line. Pipes / non-TTY stdout report `process.stdout.columns`
  // undefined — keep the column there so scripts get a stable shape.
  const cols = process.stdout.columns;
  const includeMem = cols === undefined || fullWidth <= cols;
  const visible = includeMem
    ? header.map((_, i) => i)
    : header.map((_, i) => i).filter((i) => i !== 3);
  const line = (cells: string[]) => visible.map((i) => cells[i]!.padEnd(widths[i]!)).join(gap);
  process.stdout.write(line(header) + "\n");
  for (const row of rows) {
    process.stdout.write(line(row) + "\n");
  }
  return 0;
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
  const { json, rest: afterJson } = consumeJsonFlag(args);
  const { dryRun, rest } = consumeDryRunFlag(afterJson);
  for (const a of rest) {
    die(`unknown flag: ${a}`);
  }
  const results = runGc({ dryRun });
  if (json) {
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
    return 0;
  }
  if (results.length === 0) {
    process.stdout.write("(nothing to clean up)\n");
    return 0;
  }
  for (const r of results) {
    const label = r.name ? `${r.name} (pid ${r.pid})` : `pid ${r.pid}`;
    const verb = dryRun ? "would clean" : "cleaned";
    process.stdout.write(`${verb} ${label} [${r.status}]: ${r.removedPaths.length} path(s)\n`);
    for (const p of r.removedPaths) {
      process.stdout.write(`  ${p}\n`);
    }
    for (const p of r.failedPaths) {
      process.stdout.write(`  failed: ${p}\n`);
    }
  }
  return 0;
}

// `machinen stop <name|pid>` — SIGTERM the VMM, escalate to SIGKILL
// after 2s, then gc its entry. Resolves `--detached` boots' Ctrl-C
// problem: the CLI no longer holds the VMM, so a separate `stop`
// command is the only way to ask for a clean shutdown.
async function cmdStop(args: string[]): Promise<number> {
  const { json, rest: afterJson } = consumeJsonFlag(args);
  const { dryRun, rest: afterDry } = consumeDryRunFlag(afterJson);
  let force = false;
  const rest: string[] = [];
  for (const a of afterDry) {
    if (a === "--force" || a === "-9") {
      force = true;
    } else {
      rest.push(a);
    }
  }
  const target = parseTargetFlags(rest, "stop");
  const entry = lookupEntry(target);
  if (!entry) {
    if (json) {
      emitJsonError("VM_NOT_FOUND", `no running VM matched ${describeTarget(target)}`);
    } else {
      process.stderr.write(`machinen stop: no running VM matched ${describeTarget(target)}\n`);
    }
    return 1;
  }
  const emitStop = (status: "stopped" | "would_stop" | "already_dead" | "recycled"): void => {
    if (json) {
      emitJson({
        schema_version: 1,
        pid: entry.pid,
        name: entry.name ?? null,
        status,
        dry_run: dryRun,
      });
    }
  };
  // Pid-validate before signalling — refuses to kill a recycled pid.
  const status = validatePid(entry.pid, {
    vmmExe: entry.vmmExe,
    startedAt: entry.startedAt,
  });
  if (status === "recycled") {
    if (!json) {
      process.stderr.write(
        `machinen stop: registry entry pid ${entry.pid} is now held by an unrelated process; ` +
          (dryRun ? "would skip kill and gc.\n" : "skipping kill and running gc.\n"),
      );
    }
    if (!dryRun) {
      runGc({ pid: entry.pid });
    }
    emitStop("recycled");
    return 0;
  }
  if (status === "dead") {
    if (!json) {
      process.stderr.write(
        `machinen stop: pid ${entry.pid} already gone; ` +
          (dryRun ? "would gc.\n" : "running gc.\n"),
      );
    }
    if (!dryRun) {
      runGc({ pid: entry.pid });
    }
    emitStop("already_dead");
    return 0;
  }
  if (dryRun) {
    if (!json) {
      const label = entry.name ? `${entry.name} (pid ${entry.pid})` : `pid ${entry.pid}`;
      const sigLabel = force ? "SIGKILL" : "SIGTERM (escalates to SIGKILL after 2s)";
      process.stdout.write(`would ${sigLabel} ${label}\n`);
    }
    emitStop("would_stop");
    return 0;
  }
  const sig = force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(entry.pid, sig);
  } catch (err) {
    const msg = `failed to signal pid ${entry.pid}: ${err instanceof Error ? err.message : String(err)}`;
    if (json) {
      emitJsonError("STOP_KILL_FAILED", msg);
    } else {
      process.stderr.write(`machinen stop: ${msg}\n`);
    }
    return 1;
  }
  if (!force) {
    await waitForExit(entry.pid, 2_000);
    try {
      process.kill(entry.pid, 0);
      // Still alive — escalate.
      try {
        process.kill(entry.pid, "SIGKILL");
      } catch {}
    } catch {
      // Already gone.
    }
  }
  // #150 phase 2 PR3: signal gvproxy too. Detached gvproxy survives
  // the parent's exit on its own (no pdeathsig); without this it'd
  // outlive every `machinen stop`, holding host ports and leaking
  // the qemu/control sockets. Anti-recycling guard mirrors the VMM
  // path — basename match against the recorded gvproxy binary, so
  // an unrelated pid that inherited gvproxy's slot weeks later
  // doesn't get killed. Wait for it to exit so the test/user can
  // assume "stop returned → process is gone" without a follow-up
  // poll.
  if (entry.gvproxyPid && entry.gvproxyExe) {
    const gvStatus = validatePid(entry.gvproxyPid, { vmmExe: entry.gvproxyExe });
    if (gvStatus === "alive") {
      try {
        process.kill(entry.gvproxyPid, sig);
      } catch (err) {
        process.stderr.write(
          `machinen stop: failed to signal gvproxy pid ${entry.gvproxyPid}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
      if (!force) {
        await waitForExit(entry.gvproxyPid, 2_000);
        try {
          process.kill(entry.gvproxyPid, 0);
          try {
            process.kill(entry.gvproxyPid, "SIGKILL");
          } catch {}
        } catch {}
      }
    } else if (gvStatus === "recycled") {
      process.stderr.write(
        `machinen stop: gvproxy pid ${entry.gvproxyPid} now held by an unrelated process; skipping.\n`,
      );
    }
  }
  // #150 phase 3: signal each detached live-mount helper too. They
  // die with the VMM via pdeathsig already, but signaling explicitly
  // lets us wait for clean exit and avoids a window where SIGTERM-on-
  // VMM races the helper's own pdeathsig-triggered shutdown.
  // Anti-recycling guard mirrors the gvproxy path.
  for (const helper of entry.liveMountServers ?? []) {
    const status = validatePid(helper.pid, { vmmExe: helper.exe });
    if (status === "alive") {
      try {
        process.kill(helper.pid, sig);
      } catch (err) {
        process.stderr.write(
          `machinen stop: failed to signal mount-server pid ${helper.pid}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
      if (!force) {
        await waitForExit(helper.pid, 2_000);
        try {
          process.kill(helper.pid, 0);
          try {
            process.kill(helper.pid, "SIGKILL");
          } catch {}
        } catch {}
      }
    } else if (status === "recycled") {
      process.stderr.write(
        `machinen stop: mount-server pid ${helper.pid} now held by an unrelated process; skipping.\n`,
      );
    }
  }
  // Final gc to drop the registry entry + cleanupPaths (including the
  // gvproxy socket dir that PR3 added to the cleanup list).
  runGc({ pid: entry.pid });
  if (json) {
    emitStop("stopped");
  } else {
    const label = entry.name ? `${entry.name} (pid ${entry.pid})` : `pid ${entry.pid}`;
    process.stdout.write(`stopped ${label}\n`);
  }
  return 0;
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
  for (const e of list()) {
    if ("name" in target && e.name === target.name) {
      return e;
    }
    if ("pid" in target && e.pid === target.pid) {
      return e;
    }
  }
  return undefined;
}

function describeTarget(target: { name: string } | { pid: number }): string {
  return "name" in target ? `name ${target.name}` : `pid ${target.pid}`;
}

async function cmdExec(args: string[]): Promise<number> {
  // Pull --tty out before the `--` boundary so it isn't passed to the
  // workload. Auto-enable when stdin is a TTY and no --tty was passed
  // explicitly is *not* what we want — `machinen exec foo --
  // ps aux` from a terminal should still be one-shot pipes, otherwise
  // every output gets line-discipline-translated. Caller opts in.
  let usePty = false;
  const filtered: string[] = [];
  for (const a of args) {
    if (a === "--tty" || a === "--pty") {
      usePty = true;
    } else {
      filtered.push(a);
    }
  }
  const dashIdx = filtered.indexOf("--");
  if (dashIdx === -1 || dashIdx === filtered.length - 1) {
    die("usage: machinen exec <name|pid> [--tty] -- <cmd>");
  }
  const pre = filtered.slice(0, dashIdx);
  const cmdArgs = filtered.slice(dashIdx + 1);
  const target = parseTargetFlags(pre, "exec");
  const vm = await attach(target).catch(handleError);
  try {
    // Shell out via `sh -c` on the guest so caller can pass piped
    // commands naturally. Users who want raw exec of a single binary
    // can quote it like `machinen exec foo -- /bin/ls`.
    const joined = cmdArgs.join(" ");
    if (usePty) {
      if (!process.stdin.isTTY) {
        die("machinen exec --tty: stdin is not a TTY; pass via terminal or drop --tty");
      }
      return await runPtyExec(vm, joined);
    }
    const res = await vm.execRaw(joined, {
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    });
    return res.exitCode;
  } finally {
    await vm.detach();
  }
}

async function runPtyExec(
  vm: {
    execPty: (
      cmd: string,
      opts: import("@machinen/runtime").VsockExecPtyOptions,
    ) => import("@machinen/runtime").VsockExecPtyHandle;
  },
  cmd: string,
): Promise<number> {
  // PTY mode (#133): bidirectional bytes between this terminal and a
  // guest pseudoterminal. Flip stdin to raw so Ctrl-C, arrows, and
  // function keys reach the guest as untranslated bytes; restore on
  // every exit path so the user's shell isn't left in raw mode.
  // Caller is responsible for asserting stdin is a TTY (the right
  // error message depends on whether you got here via `attach` or
  // `exec --tty`).
  const stdin = process.stdin;
  const stdout = process.stdout;
  const initialCols = stdout.columns ?? 80;
  const initialRows = stdout.rows ?? 24;

  const wasRaw = stdin.isRaw === true;
  stdin.setRawMode(true);
  stdin.resume();

  const handle = vm.execPty(cmd, {
    cols: initialCols,
    rows: initialRows,
    stdin,
    stdout,
  });

  const onResize = () => {
    handle.resize(stdout.columns ?? initialCols, stdout.rows ?? initialRows);
  };
  stdout.on("resize", onResize);

  try {
    const { exitCode } = await handle.result;
    return exitCode;
  } finally {
    stdout.removeListener("resize", onResize);
    if (!wasRaw) {
      try {
        stdin.setRawMode(false);
      } catch {
        // Already restored or stream destroyed; ignore.
      }
    }
    // Don't .pause() — the parent process will exit shortly.
  }
}

async function cmdSnapshot(args: string[]): Promise<number> {
  // Form: `machinen snapshot <target> <out-dir>`. We strip --json /
  // --dry-run / --keep-alive first; the first two positionals left
  // are the target and the out-dir.
  const { json, rest: afterJson } = consumeJsonFlag(args);
  const { dryRun, rest: afterDry } = consumeDryRunFlag(afterJson);
  let keepAlive = false;
  const remaining: string[] = [];
  for (const a of afterDry) {
    if (a === "--keep-alive") {
      // Source survives the dump (CRIU --leave-running). Default
      // closes inherited TCP sockets — two live copies sharing the
      // same connection state can't both talk to the peer cleanly.
      keepAlive = true;
    } else {
      remaining.push(a);
    }
  }
  const { target, rest: afterTarget } = resolveTarget(remaining, "snapshot");
  if (afterTarget.length === 0) {
    die("usage: machinen snapshot <name|pid> <out-dir> [--keep-alive] [--dry-run] [--json]");
  }
  if (afterTarget.length > 1) {
    die(`unknown argument: ${afterTarget[1]}`);
  }
  const outDir = afterTarget[0]!;
  const resolvedOutDir = resolve(outDir);
  if (dryRun) {
    // Validate target exists + out-dir is creatable (parent must exist
    // and be writable). Don't actually freeze the source.
    const entry = lookupEntry(target);
    if (!entry) {
      const msg = `no running VM matched ${describeTarget(target)}`;
      if (json) {
        emitJsonError("VM_NOT_FOUND", msg);
      } else {
        process.stderr.write(`machinen snapshot: ${msg}\n`);
      }
      return 1;
    }
    if (json) {
      emitJson({
        schema_version: 1,
        snap_dir: resolvedOutDir,
        elapsed_ms: 0,
        dry_run: true,
      });
    } else {
      const label = entry.name ? `${entry.name} (pid ${entry.pid})` : `pid ${entry.pid}`;
      process.stdout.write(
        `would snapshot ${label} → ${resolvedOutDir}` + (keepAlive ? " (--keep-alive)\n" : "\n"),
      );
    }
    return 0;
  }
  const vm = await attach(target).catch(handleError);
  try {
    const res = await vm.snapshot({
      outDir: resolvedOutDir,
      leaveRunning: keepAlive,
      tcpClose: keepAlive,
      onLog: (evt) => {
        if (evt.source !== "phase") {
          process.stderr.write(evt.chunk);
        }
      },
    });
    if (json) {
      emitJson({
        schema_version: 1,
        snap_dir: res.snapDir,
        elapsed_ms: res.elapsedMs,
        dry_run: false,
      });
    } else {
      process.stdout.write(`snapshot: ${res.snapDir} (${res.elapsedMs}ms)\n`);
    }
    return 0;
  } catch (err) {
    handleError(err);
  } finally {
    await vm.detach();
  }
}

async function cmdFork(args: string[]): Promise<number> {
  // `machinen fork ( --name <src> | --pid <pid> ) [--new-name <dst>]
  //                [--out-dir <dir>] [--tcp-keep] [--detach]
  //                [-p ...] [--mount ...] [--mount-live ...]
  //                [--env KEY=VALUE]... [--cwd <abs>] [--memory <mib>]`.
  //
  // Snapshots the source live (--leave-running), restores into a
  // sibling, and by default attaches the fork's console to host
  // stdio so the user lands inside the new VM (same shape as
  // `machinen restore`). `--detach` keeps the fire-and-forget shape
  // (CI / scripted workflows): print identity, hand off, return.
  // Source keeps running either way.
  //
  // The boot-shaped flags (`--mount`, `--mount-live`, `--env`, `--cwd`,
  // `--memory`) take effect on the *forked* sibling, not the source.
  // Fork = snapshot + restore, so anything you can pass to `boot` /
  // `restore` works here too.
  // --json is a top-level convention; pull it out before the fork
  // parser so it doesn't end up in `rest` and trip parseTargetFlags.
  const { json, rest: forkArgs } = consumeJsonFlag(args);
  let parsed;
  try {
    parsed = parseForkArgs(forkArgs);
  } catch (err) {
    handleError(err);
  }
  const {
    newName,
    outDir,
    tcpKeep,
    detach,
    lazy,
    portForward,
    mount,
    liveMounts,
    env,
    guestCwd,
    memory,
    rest,
  } = parsed;
  const target = parseTargetFlags(rest, "fork");
  if (json && !detach) {
    die("fork --json is only meaningful with --detach (attached forks take over stdio).");
  }

  // The fork is a fresh restore boot, so it needs the same base
  // assets `cmdRestore` resolves (kernel + dtb + rootfs in the
  // initramfs for /sbin/machinen-restore + criu).
  const assetsOverride = process.env.MACHINEN_ASSETS_DIR;
  if (assetsOverride) {
    validateAssetsDir(assetsOverride);
  } else if (!baseAssetsComplete(RELEASE_TAG)) {
    process.stderr.write(`machinen: fetching base assets for ${RELEASE_TAG} (first run)\n`);
    await ensureBaseAssets(RELEASE_TAG);
  }
  const baseDir = assetsOverride ? resolve(assetsOverride) : baseDirFor(RELEASE_TAG);
  const kernelPath = join(baseDir, assetsOverride ? "Image-arm64" : "Image");
  const dtbPath = join(baseDir, assetsOverride ? "virt-arm64.dtb" : "virt.dtb");
  const imagePath = join(baseDir, assetsOverride ? "rootfs-debian-arm64.tar.gz" : "rootfs.tar.gz");

  // The runtime's ephemeral-bundle cleanup hangs off `fork.wait()`,
  // which the CLI can't await — `cmdFork` returns as soon as the
  // fork is registered. So the CLI always materializes an explicit
  // outDir (caller-supplied or a temp dir we print) and skips the
  // runtime's ephemeral mode. When --out-dir was omitted the user
  // is responsible for `rm -rf`-ing the printed path.
  const resolvedOutDir = outDir ? resolve(outDir) : mkdtempSync(join(tmpdir(), "machinen-fork-"));
  const vm = await attach(target).catch(handleError);
  try {
    const fork = await vm.fork({
      name: newName,
      outDir: resolvedOutDir,
      image: imagePath,
      kernel: kernelPath,
      dtb: dtbPath,
      tcpKeep,
      lazy,
      portForward: portForward.length > 0 ? portForward : undefined,
      mount,
      liveMounts,
      env,
      guestCwd,
      memory,
      onLog: (evt) => {
        if (evt.source !== "phase") {
          process.stderr.write(evt.chunk);
        }
      },
    });
    if (!json) {
      process.stderr.write(`forked: ${fork.name ?? "<anonymous>"} (pid ${fork.pid})\n`);
      if (!outDir) {
        process.stderr.write(`bundle: ${resolvedOutDir} (rm -rf when the fork exits)\n`);
      }
    }
    if (detach) {
      // Fire-and-forget: hand the fork off to its own VMM process
      // (boot was spawned with pdeathsig=false so it survives this
      // CLI exit) and return.
      await fork.detach();
      if (json) {
        emitJson({
          schema_version: 1,
          pid: fork.pid,
          name: fork.name ?? null,
          source: "name" in target ? target.name : `pid ${target.pid}`,
          bundle_dir: resolvedOutDir,
          ephemeral: !outDir,
        });
      }
      return 0;
    }

    // Drop the user into the fork's interactive console — same shape
    // as `cmdRestore`. The source VM keeps running in the background,
    // owned by whoever booted it; we never had its console fd.
    fork.stdout.pipe(process.stdout);
    fork.stderr.pipe(process.stderr);
    const restoreStdin = rawModeStdinIfTTY();
    const cancelHintRepeat = printCtrlDHint();
    // The source shell printed PS1 to the source's tty before the
    // dump, so the restored shell starts up sitting in read() without
    // redrawing — without this nudge the user has to hit Enter
    // themselves to see anything past `machinen-restore: starting…`.
    // The CR makes bash treat it as an empty Enter and reprints the
    // prompt. Wait ~1.5s before sending: at `vm.fork()`-resolve the
    // VMM's just spawned and the kernel is still booting; bytes sent
    // earlier get dropped before bash starts reading from the tty.
    const promptNudge = setTimeout(() => {
      try {
        fork.stdin.write("\r");
      } catch {
        // fork already exited / pipe closed — nothing to nudge.
      }
    }, 1500);
    promptNudge.unref();

    let forwardedSignal: "SIGINT" | "SIGTERM" | null = null;
    const onSigint = () => {
      forwardedSignal = "SIGINT";
      void fork.kill();
    };
    const onSigterm = () => {
      forwardedSignal = "SIGTERM";
      void fork.kill();
    };
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    pipeStdinToVm(fork.stdin, () => {
      process.stderr.write("\nmachinen: Ctrl-D — stopping VM\n");
      forwardedSignal = "SIGTERM";
      void fork.kill();
    });
    try {
      const { code } = await fork.wait();
      if (forwardedSignal === "SIGINT") {
        return 130;
      }
      if (forwardedSignal === "SIGTERM") {
        return 143;
      }
      return code ?? 0;
    } finally {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      cancelHintRepeat();
      restoreStdin();
    }
  } catch (err) {
    handleError(err);
  } finally {
    await vm.detach();
  }
}

async function cmdAttach(args: string[]): Promise<number> {
  // Pull `--shell` and `--tail` out before the target flags so the
  // unknown-arg checks in `parseTargetFlags` don't reject them.
  // `--shell` defaults to `bash -i` — the Debian base rootfs ships
  // bash, and `-i` gets job control, history, and a prompt.
  let shell = "/bin/bash -i";
  let tail: number | "all" | undefined;
  const filtered: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--shell" || a.startsWith("--shell=")) {
      const v = a === "--shell" ? args[++i] : a.slice("--shell=".length);
      if (!v) {
        die("--shell requires a value");
      }
      shell = v;
    } else if (a === "--tail" || a.startsWith("--tail=")) {
      // `--tail` (no value) prints the whole snapshot. `--tail N`
      // prints the last N lines. The snapshot is capped at ~1 MiB so
      // even the no-value form is bounded.
      let v: string | undefined;
      if (a === "--tail") {
        const peek = args[i + 1];
        if (peek && /^[0-9]+$/.test(peek)) {
          v = peek;
          i++;
        }
      } else {
        v = a.slice("--tail=".length);
      }
      if (v === undefined) {
        tail = "all";
      } else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) {
          die(`--tail: expected a non-negative integer, got '${v}'`);
        }
        tail = n;
      }
    } else {
      filtered.push(a);
    }
  }
  const target = parseTargetFlags(filtered, "attach");
  // #150 phase 2 PR3: --tail dumps the boot-console snapshot before
  // (or instead of) the interactive shell. Look up the registry
  // entry directly — `attach()` only returns a VmHandle, not the
  // entry, and we need `bootLogPath` from the registry.
  if (tail !== undefined) {
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
    printBootLogTail(entry.bootLogPath, tail);
  }
  // Resolve the target before the TTY check: a typo in --name should
  // surface "no running VM found", not the TTY error. The TTY error
  // is only useful once we know the VM exists.
  const vm = await attach(target).catch(handleError);
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
  process.stderr.write(`repl: ${vm.name ?? `pid ${vm.pid}`}\n`);
  process.stderr.write(
    `each line is a fresh one-shot exec — cd / env vars / history do NOT persist.\n` +
      `for an interactive shell with job control + TUI support, use:\n` +
      `  machinen attach ${vm.name ?? vm.pid}\n` +
      `Ctrl-D to exit.\n`,
  );
  try {
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    for await (const line of rl) {
      if (line.length === 0) {
        continue;
      }
      await vm.execRaw(line, {
        onStdout: (chunk) => process.stdout.write(chunk),
        onStderr: (chunk) => process.stderr.write(chunk),
      });
    }
    return 0;
  } finally {
    await vm.detach();
  }
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
  const { json, rest: afterJson } = consumeJsonFlag(args);
  let listMode = false;
  const positional: string[] = [];
  for (const a of afterJson) {
    if (a === "--list") {
      listMode = true;
    } else if (a.startsWith("--")) {
      die(`unknown argument: ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (listMode) {
    if (positional.length > 0) {
      die("machinen feedback --list takes no positional arguments");
    }
    const entries = readFeedback();
    if (json) {
      emitJson({ schema_version: 1, entries });
      return 0;
    }
    if (entries.length === 0) {
      process.stdout.write("(no feedback recorded)\n");
      return 0;
    }
    for (const e of entries) {
      process.stdout.write(`${e.timestamp}  ${e.text}\n`);
    }
    return 0;
  }
  if (positional.length === 0) {
    die('usage: machinen feedback "<text>" | machinen feedback --list');
  }
  const text = positional.join(" ");
  const path = feedbackPath();
  const entry = {
    timestamp: new Date().toISOString(),
    cli_version: VERSION,
    text,
  };
  appendFeedback(entry, path);
  const upstream = await postUpstream(entry);
  if (json) {
    emitJson({
      schema_version: 1,
      recorded: true,
      path,
      upstream_status: upstream.status,
    });
    return 0;
  }
  if (upstream.attempted && upstream.status !== null) {
    process.stdout.write(
      `feedback recorded locally and sent upstream (status: ${upstream.status})\n`,
    );
  } else if (upstream.attempted) {
    process.stdout.write(`feedback recorded locally; upstream POST failed: ${upstream.error}\n`);
  } else {
    process.stdout.write("feedback recorded locally (1 entry)\n");
  }
  return 0;
}

async function cmdCompletion(args: string[]): Promise<number> {
  const shell = args[0] ?? "bash";
  if (shell === "bash") {
    process.stdout.write(BASH_COMPLETION);
    return 0;
  }
  if (shell === "zsh") {
    process.stdout.write(ZSH_COMPLETION);
    return 0;
  }
  if (shell === "fish") {
    process.stdout.write(FISH_COMPLETION);
    return 0;
  }
  die(`unsupported shell: ${shell} (expected bash | zsh | fish)`);
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
  local cmds="boot restore install list ls ps exec snapshot fork attach repl gc stop feedback agent-context completion --version --help -h -v"
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
  cmds=(boot restore install list ls ps exec snapshot fork attach repl gc stop feedback agent-context completion)
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
set -l cmds boot restore install list ls ps exec snapshot fork attach repl gc stop feedback agent-context completion
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
 */
function handleError(err: unknown): never {
  if (isMachinenError(err)) {
    process.stderr.write(`machinen: ${formatMachinenError(err)}\n`);
    process.exit(1);
  }
  throw err;
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
      `    -p <hostPort>:<guestPort>                    Forward host:hostPort → guest:guestPort.\n` +
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
      `  machinen snapshot <name|pid> <out-dir> [--keep-alive]\n` +
      `                                                 CRIU-snapshot a running VM into <d>.\n` +
      `                                                 Default: source VM exits as part of the\n` +
      `                                                 dump. --keep-alive leaves it running\n` +
      `                                                 (and closes inherited TCP sockets to\n` +
      `                                                 avoid two live copies racing on shared\n` +
      `                                                 connection state).\n` +
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
      `                                                 boot --detach, feedback, agent-context.\n` +
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
      `\n` +
      `Environment:\n` +
      `  MACHINEN_VMM                             Override the VMM binary path (dev)\n` +
      `  MACHINEN_ASSETS_DIR                      Use base assets from this directory\n` +
      `                                           instead of the cache / GH Releases\n` +
      `  MACHINEN_REGISTRY_DIR                    Override registry location (default\n` +
      `                                           ~/.machinen/vms)\n` +
      `\n` +
      `Cache:\n` +
      `  ~/.machinen/<tag>/bases/debian-arm64/\n`,
  );
}

// ------------------------------------------------------------
// Entry
// ------------------------------------------------------------

async function main(): Promise<number> {
  const [sub, ...rest] = process.argv.slice(2);
  debug("dispatch sub=%s argc=%d", sub ?? "<empty>", rest.length);

  if (!sub || sub === "-h" || sub === "--help") {
    printHelp();
    return sub ? 0 : 1;
  }
  if (sub === "--version" || sub === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  switch (sub) {
    case "boot":
      return cmdBoot(rest);
    case "restore":
      return cmdRestore(rest);
    case "install":
      return cmdInstall(rest);
    case "list":
    case "ls":
    case "ps":
      return cmdLs(rest);
    case "exec":
      return cmdExec(rest);
    case "snapshot":
      return cmdSnapshot(rest);
    case "fork":
      return cmdFork(rest);
    case "attach":
      return cmdAttach(rest);
    case "repl":
      return cmdRepl(rest);
    case "completion":
      return cmdCompletion(rest);
    case "gc":
      return cmdGc(rest);
    case "stop":
      return cmdStop(rest);
    case "feedback":
      return cmdFeedback(rest);
    case "agent-context":
      return cmdAgentContext(rest);
    default:
      die(`unknown command: ${sub}\nRun 'machinen --help' for usage.`);
  }
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
