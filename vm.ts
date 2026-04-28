// Boot a machinen microVM from the provisioned ./app.tar.gz with the
// current git worktree live-mounted at /mnt/workspace.
//
//   pnpm provision   # one-time, builds ./app.tar.gz
//   pnpm vm          # boots from app.tar.gz
//
// Hard requirement: vm.ts only runs from a linked git worktree (the kind
// `wt-pick` creates). Running it from the main checkout aborts — that's
// the convention to keep the main tree clean and per-issue work isolated.

import { boot } from "@machinen/runtime";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// e2fsprogs is keg-only on Homebrew (its `mkfs.ext4`/`mke2fs` would
// collide with macOS's `newfs_*` family) — its binaries live under
// /opt/homebrew/opt/e2fsprogs/sbin/. Harmless on Linux / when absent.
const BREW_E2FS = "/opt/homebrew/opt/e2fsprogs/sbin";
if (existsSync(BREW_E2FS) && !(process.env.PATH ?? "").includes(BREW_E2FS)) {
  process.env.PATH = `${BREW_E2FS}:${process.env.PATH ?? ""}`;
}

const require = createRequire(import.meta.url);
const runtimeEntry = require.resolve("@machinen/runtime");
const ASSETS =
  process.env.MACHINEN_ASSETS_DIR ??
  resolve(dirname(runtimeEntry), "..", "..", "..", "release-assets");

const HERE = dirname(fileURLToPath(import.meta.url));

// --- worktree guard ------------------------------------------------------
//
// `git rev-parse --git-dir` returns `.git` (or absolute `<repo>/.git`) in
// the main checkout, but `<repo>/.git/worktrees/<name>` inside a linked
// worktree. `--git-common-dir` always points at the main `.git`. When the
// two differ we're in a linked worktree.
function ensureWorktree(): void {
  const run = (args: string[]): string =>
    execFileSync("git", args, {
      cwd: HERE,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  let gitDir: string;
  let commonDir: string;
  try {
    gitDir = run(["rev-parse", "--absolute-git-dir"]);
    commonDir = run(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.error(`vm.ts: not a git repo at ${HERE} (${msg})`);
    process.exit(1);
  }
  if (gitDir === commonDir) {
    console.error(
      `vm.ts: refusing to boot from the main checkout (${HERE}).\n` +
        "       vm.ts only runs from a linked worktree. Use `wt-pick` to\n" +
        "       create or switch to a per-issue worktree, then re-run pnpm vm.",
    );
    process.exit(1);
  }
}
ensureWorktree();

// Build artifacts live OUTSIDE the project dir so they're not visible
// inside the guest via the live mount of HERE → /mnt/workspace.
const CACHE_DIR = join(homedir(), ".cache", "machinen", basename(HERE));
await mkdir(CACHE_DIR, { recursive: true });
const IMAGE = join(CACHE_DIR, "app.tar.gz");

if (!existsSync(IMAGE)) {
  console.error(`vm.ts: ${IMAGE} not found — run \`pnpm provision\` first.`);
  process.exit(1);
}

// RAM scales with gzipped rootfs size — see provision.ts for the formula.
function ramForImage(path: string): number {
  const compressed = statSync(path).size;
  const GIB = 1024 * 1024 * 1024;
  const raw = Math.max(4 * GIB, compressed * 16 + 2 * GIB);
  const align = 256 * 1024 * 1024;
  return Math.ceil(raw / align) * align;
}
process.stderr.write(
  `[machinen] ram=${(ramForImage(IMAGE) / 1024 ** 3).toFixed(1)} GiB ` +
    `(image=${(statSync(IMAGE).size / 1024 ** 2).toFixed(0)} MB)\n`,
);

// --- secrets from host ---------------------------------------------------
//
// All secrets are pulled per-boot from the host (gh / Keychain) and
// injected into the guest as env vars. Nothing is baked into app.tar.gz.
function readHostCmd(label: string, file: string, args: string[]): string {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.error(`vm.ts: failed to read ${label}: ${msg}`);
    console.error(`            (cmd: ${file} ${args.join(" ")})`);
    process.exit(1);
  }
}

const ghToken = readHostCmd("GH_TOKEN", "gh", ["auth", "token"]);

// Claude Code stores its OAuth blob in the macOS Keychain under
// "Claude Code-credentials". -w prints just the password (the JSON blob).
// On the guest, /etc/profile.d/00-claude-credentials.sh (staged at
// provision time) writes it to ~/.claude/.credentials.json on first
// shell start, then unsets the env var.
const claudeCreds = readHostCmd("Claude Code credentials", "security", [
  "find-generic-password",
  "-s",
  "Claude Code-credentials",
  "-w",
]);

const secretEnv: Record<string, string> = {
  GH_TOKEN: ghToken,
  GITHUB_TOKEN: ghToken,
  CLAUDE_CREDENTIALS: claudeCreds,
};

const vm = await boot({
  kernel: join(ASSETS, "Image-arm64"),
  dtb: join(ASSETS, "virt-arm64.dtb"),
  image: IMAGE,
  // Live-share mount: host edits land in the guest's view immediately.
  liveMounts: [{ host: HERE, guest: "/mnt/workspace", mode: "rw" }],
  env: secretEnv,
  vmmEnv: { MACHINEN_RAM_BYTES: String(ramForImage(IMAGE)) },
  // Interactive — don't apply the default 60s ceiling.
  timeoutMs: null,
});

const stdin = process.stdin as NodeJS.ReadStream & {
  setRawMode?: (m: boolean) => void;
};
const isTty = stdin.isTTY === true && typeof stdin.setRawMode === "function";
if (isTty) {
  stdin.setRawMode!(true);
}

vm.stdout.pipe(process.stdout);
vm.stderr.pipe(process.stderr);
process.stdin.pipe(vm.stdin);

const { code } = await vm.wait();
if (isTty) {
  stdin.setRawMode!(false);
}
process.exit(code ?? 0);
