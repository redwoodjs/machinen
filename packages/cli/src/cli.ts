// machinen CLI — boot a microVM and drive it (exec, snapshot, attach),
// plus pre-fetch the kernel + rootfs assets published alongside each
// release tag.
//
// Surface:
//   machinen boot [opts] -- <cmd>
//   machinen restore <snap-dir> [--name <name>]
//   machinen ls
//   machinen exec ( --name <name> | --pid <pid> ) -- <cmd>
//   machinen snapshot ( --name <name> | --pid <pid> ) --out-dir <dir>
//   machinen attach ( --name <name> | --pid <pid> )    # line-based shell REPL
//   machinen install [--version <tag>]
//   machinen completion <bash|zsh|fish>
//   machinen --version | -h | --help

import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
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
const RELEASE_TAG = `@machinen/runtime@${VERSION}`;
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

  const assets = [
    { name: "Image-arm64", dest: kernel },
    { name: "virt-arm64.dtb", dest: dtb },
    { name: "rootfs-debian-arm64.tar.gz", dest: tarball },
  ];

  await Promise.all(assets.map((a) => downloadWithChecksum(tag, a.name, a.dest)));

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
  try {
    return statSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

async function downloadWithChecksum(tag: string, asset: string, dest: string): Promise<void> {
  const base = `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}`;
  const tmp = `${dest}.partial`;

  process.stderr.write(`  fetch ${asset}\n`);
  await downloadTo(`${base}/${asset}`, tmp);

  const sha = (await fetchText(`${base}/${asset}.sha256`)).trim().split(/\s+/)[0];
  const got = sha256OfFile(tmp);
  if (sha && got !== sha) {
    unlinkSync(tmp);
    die(`checksum mismatch for ${asset}: expected ${sha}, got ${got}`);
  }
  renameSync(tmp, dest);
}

async function downloadTo(url: string, dest: string): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    die(`fetch ${url} failed: ${res.status} ${res.statusText}`);
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    die(`fetch ${url} failed: ${res.status} ${res.statusText}`);
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
  const { positional, double_dash_args, mount, liveMounts, env, portForward, snapshot, name } =
    parsed;

  if (positional.length > 1) {
    die(
      "usage: machinen boot [<image>] [--snapshot <path>] [--name <name>] " +
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
  const dashIdx = args.indexOf("--");
  if (dashIdx === -1 || dashIdx === args.length - 1) {
    die("usage: machinen exec ( --name <name> | --pid <pid> ) -- <cmd>");
  }
  const pre = args.slice(0, dashIdx);
  const cmdArgs = args.slice(dashIdx + 1);
  const target = parseTargetFlags(pre, "exec");
  const vm = await attach(target).catch(handleError);
  try {
    // Shell out via `sh -c` on the guest so caller can pass piped
    // commands naturally. Users who want raw exec of a single binary
    // can quote it like `machinen exec --name foo -- /bin/ls`.
    const joined = cmdArgs.join(" ");
    const res = await vm.execRaw(joined, {
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    });
    return res.exitCode;
  } finally {
    await vm.detach();
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
    const res = await vm.snapshot({ outDir: resolve(outDir) });
    process.stdout.write(`snapshot: ${res.snapDir} (${res.elapsedMs}ms)\n`);
    return 0;
  } catch (err) {
    handleError(err);
  } finally {
    await vm.detach();
  }
}

async function cmdAttach(args: string[]): Promise<number> {
  const target = parseTargetFlags(args, "attach");
  const vm = await attach(target).catch(handleError);
  process.stderr.write(`attached to ${vm.name ?? `pid ${vm.pid}`}\n`);
  process.stderr.write(`type commands; Ctrl-D to detach.\n`);
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
// exec/snapshot/attach.
const BASH_COMPLETION = `# machinen bash completion — source this from ~/.bashrc, or:
#   eval "$(machinen completion bash)"
_machinen_completion() {
  local cur prev words cword
  _init_completion || return
  local cmds="boot restore install ls exec snapshot attach completion --version --help -h -v"
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
    exec|snapshot|attach)
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
  cmds=(boot restore install ls exec snapshot attach completion)
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
    exec|snapshot|attach)
      _describe 'flag' '(--name --pid)'
      return
      ;;
  esac
}
compdef _machinen machinen
`;

const FISH_COMPLETION = `# machinen fish completion — source this from your config.fish, or:
#   machinen completion fish | source
set -l cmds boot restore install ls exec snapshot attach completion
complete -c machinen -f -n 'not __fish_seen_subcommand_from $cmds' -a "$cmds"
for sub in exec snapshot attach
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
      `    --mount-live <host-dir>:<guest-path>         Live-share a host dir over FUSE.\n` +
      `                                                 Guest reads stream in on demand; no\n` +
      `                                                 copy at boot. Read-only for now.\n` +
      `    --env KEY=VALUE                              Set an env var inside the guest.\n` +
      `    -p <hostPort>:<guestPort>                    Forward host:hostPort → guest:guestPort.\n` +
      `\n` +
      `  machinen restore <snap-dir> [--name <name>]    Restore a VM from a snapshot bundle.\n` +
      `                                                 Anonymous restores auto-name as\n` +
      `                                                 <source>/<pid>.\n` +
      `\n` +
      `  machinen ls                                    List running VMs (PID, NAME, UP,\n` +
      `                                                 FORKED-FROM)\n` +
      `\n` +
      `  Targeting a running VM:\n` +
      `    --name <name>     |  --pid <pid>             pick exactly one\n` +
      `\n` +
      `  machinen exec     <target-flag> -- <cmd>       Run a command in a running VM\n` +
      `  machinen snapshot <target-flag> --out-dir <d>  CRIU-snapshot a running VM into <d>\n` +
      `  machinen attach   <target-flag>                Line-based shell against a running VM\n` +
      `\n` +
      `  machinen install                               Pre-fetch the current-tag base assets\n` +
      `    --version <tag>                              Pin to a specific release tag\n` +
      `  machinen completion <shell>                    Emit shell completion (bash|zsh|fish)\n` +
      `  machinen --version | -h                        Print version / help\n` +
      `\n` +
      `Examples:\n` +
      `  machinen boot --name worker -- node server.js\n` +
      `  machinen ls\n` +
      `  machinen exec --name worker -- ps aux\n` +
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
      return cmdLs(rest);
    case "exec":
      return cmdExec(rest);
    case "snapshot":
      return cmdSnapshot(rest);
    case "attach":
      return cmdAttach(rest);
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
