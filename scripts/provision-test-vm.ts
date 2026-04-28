// Provision a small purpose-built rootfs for the FUSE workload tests
// (#165 layer 2). Kept separate from `pnpm provision` so the dev VM
// stays minimal — these tools (rsync, sqlite3) are only relevant when
// driving real workloads against the live mount.
//
//   pnpm provision-test-vm           # incremental — runs only when the install hook changes
//   pnpm provision-test-vm --force   # ignore the stamp, full rebuild
//
// Output: ~/.cache/machinen/<repo>/test-vm.tar.gz
//
// Consumed by packages/runtime/src/__tests__/mount-server-workloads.test.ts
// — the test file's `runIf` gate flips to true once this lands. Without
// it, the workload tests skip locally with an instructive message.

import type { VmHandle } from "@machinen/runtime";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Same anchor pattern as provision.ts — `git rev-parse --git-common-dir`
// always points at the *main* `.git`, even from a worktree, so the
// cache key (and therefore the output tarball) is per-repo, not
// per-worktree.
function mainRepoRoot(): string {
  const commonDir = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  return dirname(commonDir);
}
const MAIN_REPO = mainRepoRoot();

const ASSETS = process.env.MACHINEN_ASSETS_DIR ?? resolve(MAIN_REPO, "release-assets");
const CACHE_DIR = join(homedir(), ".cache", "machinen", basename(MAIN_REPO));
mkdirSync(CACHE_DIR, { recursive: true });
const OUT = join(CACHE_DIR, "test-vm.tar.gz");
const STAMP = `${OUT}.stamp`;
const FORCE = process.argv.includes("--force");

// Resolve runtime against MAIN_REPO's node_modules — same trick
// provision.ts uses.
const { provision } = (await import(
  resolve(MAIN_REPO, "node_modules/@machinen/runtime/dist/index.js")
)) as typeof import("@machinen/runtime");

// Minimal install: only the tools the workload tests need. The base
// rootfs from scripts/build-base-assets.sh is bare Debian — even git
// isn't in it. tar lives in coreutils; everything else gets added here.
const installSteps = async (vm: VmHandle): Promise<void> => {
  await vm.exec(
    "apt-get update -qq && " +
      "apt-get install -y --no-install-recommends git rsync sqlite3 && " +
      "apt-get clean && rm -rf /var/lib/apt/lists/*",
  );
  // file:// clones from the live FUSE mount fall foul of CVE-2022-24765
  // "dubious ownership" warnings — the FUSE uid won't match the guest's
  // uid. safe.directory '*' opts out, same as the dev provision.
  await vm.exec("git config --global --add safe.directory '*'");
};

// Stamp = hash of this file's contents. Any edit (new package, version
// bump, hook tweak) invalidates the cached image automatically.
const sourceHash = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex");

if (!FORCE && existsSync(OUT) && existsSync(STAMP)) {
  const prior = readFileSync(STAMP, "utf8").trim();
  if (prior === sourceHash) {
    console.log(`provision-test-vm: ${OUT} is up to date (stamp matches) — skipping.`);
    console.log("                   pass --force to rebuild.");
    process.exit(0);
  }
}

const base = join(ASSETS, "rootfs-debian-arm64.tar.gz");
if (!existsSync(base)) {
  console.error(`provision-test-vm: base rootfs not found at ${base}.`);
  console.error("                   run scripts/build-base-assets.sh first.");
  process.exit(1);
}

function ramForImage(path: string): number {
  const compressed = statSync(path).size;
  const GIB = 1024 ** 3;
  const raw = Math.max(2 * GIB, compressed * 8 + GIB);
  const align = 256 * 1024 * 1024;
  return Math.ceil(raw / align) * align;
}

console.log(
  `provision-test-vm: base=${base}\n` +
    `provision-test-vm: ram=${(ramForImage(base) / 1024 ** 3).toFixed(1)} GiB`,
);

const result = await provision({
  base,
  kernel: join(ASSETS, "Image-arm64"),
  dtb: join(ASSETS, "virt-arm64.dtb"),
  out: OUT,
  vmmEnv: { MACHINEN_RAM_BYTES: String(ramForImage(base)) },
  cmd: ["/bin/bash", "-lc", "exec bash -i"],
  env: {
    PATH: "/usr/local/bin:/usr/bin:/bin:/sbin",
    HOME: "/root",
    TERM: "xterm-256color",
  },
  onLog: (evt) => {
    if (evt.source === "exec-stdout" || evt.source === "guest-console") {
      process.stdout.write(evt.chunk);
    } else if (evt.source === "exec-stderr") {
      process.stderr.write(evt.chunk);
    }
  },
  timeoutMs: 10 * 60_000,
  install: installSteps,
});

writeFileSync(STAMP, sourceHash);
console.log(
  `\nprovision-test-vm: built ${result.imagePath} (${(result.elapsedMs / 1000).toFixed(1)}s)`,
);
