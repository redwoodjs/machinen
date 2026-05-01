// machinen CLI — boot a microVM and drive it (exec, snapshot, attach),
// plus pre-fetch the kernel + rootfs assets published alongside each
// release tag.
//
// Surface:
//   machinen boot [opts] -- <cmd>
//   machinen restore <snap-dir> [--name <name>]
//   machinen ls (alias: ps)
//   machinen exec ( --name <name> | --pid <pid> ) -- <cmd>
//   machinen snapshot ( --name <name> | --pid <pid> ) --out-dir <dir>
//   machinen attach ( --name <name> | --pid <pid> ) [--shell <cmd>]   # PTY shell
//   machinen repl   ( --name <name> | --pid <pid> )                   # per-line exec
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
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

import {
  attach,
  boot,
  formatMachinenError,
  isMachinenError,
  list,
  restore,
} from "@machinen/runtime";
import debugLib from "debug";

import pkg from "../package.json" with { type: "json" };
import { parseRunArgs } from "./parse-run-args.ts";

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
  } = parsed;

  if (positional.length > 1) {
    die(
      "usage: machinen boot [<image>] [--snapshot <path>] [--name <name>] " +
        "[--cwd <abs-path>] " +
        "[--mount ...] [--mount-live ...] [--env KEY=VALUE]... [-- <cmd> [args...]]",
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
      // Interactive CLI: the session lives as long as the guest does.
      // Don't impose the default 60s cap.
      timeoutMs: null,
    });
  } catch (err) {
    handleError(err);
  }

  vm.stdout.pipe(process.stdout);
  vm.stderr.pipe(process.stderr);
  process.stdin.pipe(vm.stdin);

  // Propagate SIGINT/SIGTERM to the VMM child. A terminal Ctrl-C
  // already signals the whole process group (both us and the VMM), so
  // this mostly matters when only the CLI is signalled — e.g. a
  // supervisor sending SIGTERM to node, or `kill -INT <cli-pid>` from
  // another shell. Without this, the VMM survives as an orphan.
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
  }
}

async function cmdInstall(args: string[]): Promise<number> {
  const tag = argValue(args, "--version") ?? RELEASE_TAG;
  process.stderr.write(`Installing base assets for ${tag} into ${cacheDirFor(tag)}\n`);
  const base = await ensureBaseAssets(tag);
  process.stderr.write(`Ready: ${base}\n`);
  return 0;
}

async function cmdRestore(args: string[]): Promise<number> {
  // `machinen restore <snap-dir> [--name <name>]`. The bundle dir
  // (produced by `machinen snapshot`) holds disk.img + meta.json.
  const positional: string[] = [];
  let name: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--name" || a.startsWith("--name=")) {
      name = a === "--name" ? args[++i] : a.slice("--name=".length);
      if (!name) {
        die("--name requires a value");
      }
    } else if (a.startsWith("-")) {
      die(`unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    die("usage: machinen restore <snap-dir> [--name <name>]");
  }
  const snapDir = resolve(positional[0]!);

  // Restore needs the base rootfs in the initramfs (criu, machinen-
  // restore, etc), so resolve it the same way `cmdBoot` does.
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

  let vm;
  try {
    vm = await restore({
      snapDir,
      image: imagePath,
      kernel: kernelPath,
      dtb: dtbPath,
      name,
      timeoutMs: null,
    });
  } catch (err) {
    handleError(err);
  }

  process.stderr.write(`restored as: ${vm.name ?? "<anonymous>"} (pid ${vm.pid})\n`);

  vm.stdout.pipe(process.stdout);
  vm.stderr.pipe(process.stderr);
  process.stdin.pipe(vm.stdin);

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
  }
}

async function cmdLs(_args: string[]): Promise<number> {
  const entries = list();
  if (entries.length === 0) {
    process.stdout.write("(no running VMs)\n");
    return 0;
  }
  // Plain tabular output. PID is the runtime handle; NAME is the
  // optional human label; FORKED-FROM lets you trace lineage when
  // the VM was created via `machinen restore`.
  const header = ["PID", "NAME", "UP", "FORKED-FROM"];
  const rows = entries.map((e) => [
    String(e.pid),
    e.name ?? "-",
    formatUptime(Date.now() - e.startedAt),
    e.forkedFrom ?? "-",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
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

async function cmdExec(args: string[]): Promise<number> {
  // Pull --tty out before the `--` boundary so it isn't passed to the
  // workload. Auto-enable when stdin is a TTY and no --tty was passed
  // explicitly is *not* what we want — `machinen exec --name foo --
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
    die("usage: machinen exec ( --name <name> | --pid <pid> ) [--tty] -- <cmd>");
  }
  const pre = filtered.slice(0, dashIdx);
  const cmdArgs = filtered.slice(dashIdx + 1);
  const target = parseTargetFlags(pre, "exec");
  const vm = await attach(target).catch(handleError);
  try {
    // Shell out via `sh -c` on the guest so caller can pass piped
    // commands naturally. Users who want raw exec of a single binary
    // can quote it like `machinen exec --name foo -- /bin/ls`.
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
  // Pull --out-dir out of the arg list, then parse the target flags.
  let outDir: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--out-dir" || a.startsWith("--out-dir=")) {
      outDir = a === "--out-dir" ? args[++i] : a.slice("--out-dir=".length);
      if (!outDir) {
        die("--out-dir requires a directory path");
      }
    } else {
      rest.push(a);
    }
  }
  if (!outDir) {
    die("usage: machinen snapshot ( --name <name> | --pid <pid> ) --out-dir <dir>");
  }
  const target = parseTargetFlags(rest, "snapshot");
  const vm = await attach(target).catch(handleError);
  try {
    const res = await vm.snapshot({
      outDir: resolve(outDir),
      onLog: (evt) => {
        process.stderr.write(evt.chunk);
      },
    });
    process.stdout.write(`snapshot: ${res.snapDir} (${res.elapsedMs}ms)\n`);
    return 0;
  } catch (err) {
    handleError(err);
  } finally {
    await vm.detach();
  }
}

async function cmdAttach(args: string[]): Promise<number> {
  // Pull `--shell` out before the target flags so unknown-arg checks
  // in `parseTargetFlags` don't reject it. Default to `bash -i` —
  // the Debian base rootfs ships bash, and `-i` gets job control,
  // history, and a prompt.
  let shell = "/bin/bash -i";
  const filtered: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--shell" || a.startsWith("--shell=")) {
      const v = a === "--shell" ? args[++i] : a.slice("--shell=".length);
      if (!v) {
        die("--shell requires a value");
      }
      shell = v;
    } else {
      filtered.push(a);
    }
  }
  const target = parseTargetFlags(filtered, "attach");
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
      `  machinen attach ${vm.name ? `--name ${vm.name}` : `--pid ${vm.pid}`}\n` +
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
 * Pull `--name <s>` / `--pid <n>` out of an arg list. Exactly one of
 * the two must be present; reject zero, both, or unknown flags. The
 * shape returned matches `AttachOptions` so callers can pass it
 * straight to `attach()`.
 */
function parseTargetFlags(args: string[], cmd: string): { name: string } | { pid: number } {
  let name: string | undefined;
  let pid: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--name" || a.startsWith("--name=")) {
      const v = a === "--name" ? args[++i] : a.slice("--name=".length);
      if (!v) {
        die(`--name requires a value`);
      }
      name = v;
    } else if (a === "--pid" || a.startsWith("--pid=")) {
      const v = a === "--pid" ? args[++i] : a.slice("--pid=".length);
      if (!v || !/^[0-9]+$/.test(v)) {
        die(`--pid requires a numeric value`);
      }
      pid = Number(v);
    } else {
      die(`unknown argument: ${a}`);
    }
  }
  if (name && pid !== undefined) {
    die(`machinen ${cmd}: pass --name OR --pid, not both`);
  }
  if (!name && pid === undefined) {
    die(`machinen ${cmd}: requires --name <name> or --pid <pid>`);
  }
  if (name) {
    return { name };
  }
  return { pid: pid! };
}

// Names live in column 2 of `machinen ls`; pids in column 1. Both
// are used as completion candidates after `--name`/`--pid` on
// exec/snapshot/attach/repl.
const BASH_COMPLETION = `# machinen bash completion — source this from ~/.bashrc, or:
#   eval "$(machinen completion bash)"
_machinen_completion() {
  local cur prev words cword
  _init_completion || return
  local cmds="boot restore install ls ps exec snapshot attach repl completion --version --help -h -v"
  if [[ \${cword} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${cmds}" -- "\${cur}") )
    return
  fi
  case "\${prev}" in
    --name)
      local names
      names=$(machinen ls 2>/dev/null | awk 'NR>1 && $2!="-"{print $2}')
      COMPREPLY=( $(compgen -W "\${names}" -- "\${cur}") )
      return
      ;;
    --pid)
      local pids
      pids=$(machinen ls 2>/dev/null | awk 'NR>1{print $1}')
      COMPREPLY=( $(compgen -W "\${pids}" -- "\${cur}") )
      return
      ;;
  esac
  case "\${words[1]}" in
    exec|snapshot|attach|repl)
      COMPREPLY=( $(compgen -W "--name --pid" -- "\${cur}") )
      return
      ;;
  esac
}
complete -F _machinen_completion machinen
`;

const ZSH_COMPLETION = `# machinen zsh completion — source this from ~/.zshrc, or:
#   eval "$(machinen completion zsh)"
_machinen() {
  local -a cmds
  cmds=(boot restore install ls ps exec snapshot attach repl completion)
  if (( CURRENT == 2 )); then
    _describe 'command' cmds
    return
  fi
  case "\${words[CURRENT-1]}" in
    --name)
      local -a names
      names=(\${(f)"$(machinen ls 2>/dev/null | awk 'NR>1 && $2!="-"{print $2}')"})
      _describe 'name' names
      return
      ;;
    --pid)
      local -a pids
      pids=(\${(f)"$(machinen ls 2>/dev/null | awk 'NR>1{print $1}')"})
      _describe 'pid' pids
      return
      ;;
  esac
  case "\${words[2]}" in
    exec|snapshot|attach|repl)
      _describe 'flag' '(--name --pid)'
      return
      ;;
  esac
}
compdef _machinen machinen
`;

const FISH_COMPLETION = `# machinen fish completion — source this from your config.fish, or:
#   machinen completion fish | source
set -l cmds boot restore install ls ps exec snapshot attach repl completion
complete -c machinen -f -n 'not __fish_seen_subcommand_from $cmds' -a "$cmds"
for sub in exec snapshot attach repl
  complete -c machinen -f -n "__fish_seen_subcommand_from $sub" -l name \\
    -a '(machinen ls 2>/dev/null | awk \\'NR>1 && $2!="-"{print $2}\\')'
  complete -c machinen -f -n "__fish_seen_subcommand_from $sub" -l pid \\
    -a '(machinen ls 2>/dev/null | awk \\'NR>1{print $1}\\')'
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
      `  machinen restore <snap-dir> [--name <name>]    Restore a VM from a snapshot bundle.\n` +
      `                                                 Anonymous restores auto-name as\n` +
      `                                                 <source>/<pid>.\n` +
      `\n` +
      `  machinen ls   (alias: ps)                      List running VMs (PID, NAME, UP,\n` +
      `                                                 FORKED-FROM)\n` +
      `\n` +
      `  Targeting a running VM:\n` +
      `    --name <name>     |  --pid <pid>             pick exactly one\n` +
      `\n` +
      `  machinen exec     <target-flag> [--tty] -- <cmd>\n` +
      `                                                 Run a command in a running VM. Pass\n` +
      `                                                 --tty for a real PTY session — needed\n` +
      `                                                 for an interactive shell, vim, htop,\n` +
      `                                                 or anything that wants job control.\n` +
      `                                                 Without --tty stdio is line-buffered\n` +
      `                                                 pipes (good for one-shot commands).\n` +
      `                                                 Example:\n` +
      `                                                   machinen exec <target-flag> --tty -- bash -i\n` +
      `  machinen snapshot <target-flag> --out-dir <d>  CRIU-snapshot a running VM into <d>\n` +
      `  machinen attach   <target-flag> [--shell <c>]  Drop into an interactive PTY shell\n` +
      `                                                 in the running VM (default \`bash -i\`).\n` +
      `                                                 \`cd\`, env vars, history, job control\n` +
      `                                                 and full-screen TUIs all work. Exit\n` +
      `                                                 the shell (Ctrl-D) to detach.\n` +
      `  machinen repl     <target-flag>                Per-line exec REPL: each line is a\n` +
      `                                                 fresh one-shot \`exec\`, no persistent\n` +
      `                                                 state. Useful for piping a script of\n` +
      `                                                 one-liners; for an interactive shell\n` +
      `                                                 use \`machinen attach\` instead.\n` +
      `\n` +
      `  machinen install                               Pre-fetch the current-tag base assets\n` +
      `    --version <tag>                              Pin to a specific release tag\n` +
      `  machinen completion <shell>                    Emit shell completion (bash|zsh|fish)\n` +
      `  machinen --version | -h                        Print version / help\n` +
      `\n` +
      `Examples:\n` +
      `  machinen boot --name worker -- node server.js\n` +
      `  machinen ls\n` +
      `  machinen exec --name worker -- ps aux                # one-off command\n` +
      `  machinen exec --name worker --tty -- bash -i         # interactive shell w/ job control\n` +
      `  machinen exec --name worker --tty -- vim /etc/passwd # full-screen TUI in a PTY\n` +
      `  machinen snapshot --name worker --out-dir ./warm\n` +
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
    case "ls":
    case "ps":
      return cmdLs(rest);
    case "exec":
      return cmdExec(rest);
    case "snapshot":
      return cmdSnapshot(rest);
    case "attach":
      return cmdAttach(rest);
    case "repl":
      return cmdRepl(rest);
    case "completion":
      return cmdCompletion(rest);
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
