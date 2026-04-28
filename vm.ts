// Boot a machinen microVM from the provisioned ./app.tar.gz with this
// clone's source live-mounted at /mnt/workspace.
//
//   pnpm provision   # one-time, builds ./app.tar.gz (run from canonical)
//   pnpm vm-pick     # CoW-clone for an issue/PR, then auto-boot
//   pnpm vm          # boot from inside an already-prepared clone
//
// vm.ts must run inside a clone — a directory created by `pnpm vm-pick`
// containing a `.machinen-vm/origin` marker that points at the canonical
// checkout. Runtime + release-assets + app.tar.gz all resolve against
// that origin so clones never need to build machinen themselves.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// --- origin marker: where the canonical machinen checkout lives ---------
const ORIGIN_FILE = join(HERE, ".machinen-vm", "origin");
if (!existsSync(ORIGIN_FILE)) {
  console.error(
    `vm.ts: no .machinen-vm/origin marker at ${HERE}.\n` +
      "       vm.ts must run inside a clone created by `pnpm vm-pick`.\n" +
      "       Run `pnpm vm-pick` from the canonical checkout first.",
  );
  process.exit(1);
}
const MAIN_REPO = readFileSync(ORIGIN_FILE, "utf8").trim();
if (!existsSync(MAIN_REPO)) {
  console.error(`vm.ts: origin marker points at ${MAIN_REPO}, which doesn't exist.`);
  process.exit(1);
}

// e2fsprogs is keg-only on Homebrew (its `mkfs.ext4`/`mke2fs` would
// collide with macOS's `newfs_*` family). The runtime now bundles
// mke2fs, but keep the PATH munge as a fallback.
const BREW_E2FS = "/opt/homebrew/opt/e2fsprogs/sbin";
if (existsSync(BREW_E2FS) && !(process.env.PATH ?? "").includes(BREW_E2FS)) {
  process.env.PATH = `${BREW_E2FS}:${process.env.PATH ?? ""}`;
}

// Resolve runtime against the canonical's node_modules — clones don't
// build machinen themselves.
const mainRequire = createRequire(join(MAIN_REPO, "package.json"));
const runtimeEntry = mainRequire.resolve("@machinen/runtime");
const { boot } = (await import(
  pathToFileURL(runtimeEntry).href
)) as typeof import("@machinen/runtime");

const ASSETS = process.env.MACHINEN_ASSETS_DIR ?? resolve(MAIN_REPO, "release-assets");
const CACHE_DIR = join(homedir(), ".cache", "machinen", basename(MAIN_REPO));
await mkdir(CACHE_DIR, { recursive: true });
const IMAGE = join(CACHE_DIR, "app.tar.gz");

if (!existsSync(IMAGE)) {
  console.error(`vm.ts: ${IMAGE} not found — run \`pnpm provision\` from ${MAIN_REPO} first.`);
  process.exit(1);
}

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

// --- secrets from host --------------------------------------------------
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

// Claude Code's OAuth blob lives in the macOS Keychain under
// "Claude Code-credentials". -w prints the JSON blob. On the guest,
// /etc/bash.bashrc (staged at provision time) writes it to
// ~/.claude/.credentials.json on first interactive shell, then unsets
// the env var.
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
  liveMounts: [{ host: HERE, guest: "/mnt/workspace", mode: "rw" }],
  env: secretEnv,
  vmmEnv: { MACHINEN_RAM_BYTES: String(ramForImage(IMAGE)) },
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
