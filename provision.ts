// Build a "ready-to-work" rootfs by running an install hook inside a
// base rootfs, then freezing the result to a tarball.
//
//   pnpm provision           # incremental — runs only what changed
//   pnpm provision --force   # ignore the stamp, full rebuild
//
// See packages/runtime docs and the comments in vm.ts for the runtime
// model (initramfs-as-rootfs, copy-once vs. live mounts, etc.).

import { provision } from "@machinen/runtime";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Homebrew's e2fsprogs is keg-only — see vm.ts for rationale.
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

// Build artifacts live in ~/.cache so they don't get dragged into the
// guest's view of the workspace via the live mount in vm.ts.
const CACHE_DIR = join(homedir(), ".cache", "machinen", basename(HERE));
mkdirSync(CACHE_DIR, { recursive: true });
const OUT = join(CACHE_DIR, "app.tar.gz");
const STAMP = `${OUT}.stamp`;
const FORCE = process.argv.includes("--force");

// pnpm version is pinned by the host repo's `packageManager` field —
// match it inside the guest so installs use the same resolver.
const PKG = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")) as {
  packageManager?: string;
};
const PNPM_VERSION = (() => {
  const pm = PKG.packageManager ?? "";
  const m = /^pnpm@([\d.]+)/.exec(pm);
  if (!m) {
    throw new Error(`provision: cannot parse packageManager from package.json: ${pm}`);
  }
  return m[1];
})();

const installSteps = async (vm: import("@machinen/runtime").VmHandle) => {
  // Remount tmpfs root at size=100% so pnpm/apt installs don't hit ENOSPC.
  await vm.exec("mount -o remount,size=100% /");

  // gvproxy DNS jitter under apt's parallel fan-out — same hardening as
  // the reference setup.
  const aptResilience = [
    'Acquire::Retries "5";',
    'Acquire::Queue-Mode "access";',
    'Acquire::http::Pipeline-Depth "0";',
    'Acquire::http::Timeout "60";',
    'Acquire::https::Timeout "60";',
  ].join("\n");
  const aptResilienceB64 = Buffer.from(aptResilience).toString("base64");
  await vm.exec(
    `echo ${aptResilienceB64} | base64 -d > /etc/apt/apt.conf.d/99-machinen-resilience`,
  );

  // System packages.
  //   ripgrep, fd-find        — fast code search.
  //   jq                       — JSON munging.
  //   less, vim-tiny           — usable interactive shell.
  //   openssh-client, gh       — git/ssh + GitHub CLI.
  // fd-find is shipped as `/usr/bin/fdfind`; symlink to the upstream name.
  await vm.exec(
    "apt-get update -qq && " +
      "apt-get install -y --no-install-recommends " +
      "bash git build-essential ca-certificates curl " +
      "ripgrep fd-find jq less vim-tiny openssh-client gh && " +
      "ln -sf /usr/bin/fdfind /usr/local/bin/fd",
  );

  // Pre-bake git identity so commits inside the guest don't prompt.
  await vm.exec(
    "git config --global user.email 'peter.pistorius@gmail.com' && " +
      "git config --global user.name 'Peter Pistorius' && " +
      "git config --global init.defaultBranch main",
  );

  // Node + pnpm + claude code via fnm. Idempotent: re-running a fnm/npm
  // install of an already-installed version is sub-second.
  await vm.exec(
    "export FNM_DIR=/root/.local/share/fnm && " +
      "fnm install 22 && " +
      "fnm default 22 && " +
      "NODE_BIN=$(fnm exec --using=22 -- sh -c 'dirname $(which node)') && " +
      "ln -sf $NODE_BIN/node /usr/local/bin/node && " +
      "ln -sf $NODE_BIN/npm  /usr/local/bin/npm  && " +
      "ln -sf $NODE_BIN/npx  /usr/local/bin/npx  && " +
      `fnm exec --using=22 npm install -g pnpm@${PNPM_VERSION} @anthropic-ai/claude-code && ` +
      "ln -sf $NODE_BIN/pnpm   /usr/local/bin/pnpm && " +
      "ln -sf $NODE_BIN/claude /usr/local/bin/claude",
  );

  // Claude Code on Linux falls back to ~/.claude/.credentials.json when
  // no keychain is present. The actual token is injected per-boot from
  // the host's Keychain (see vm.ts) — we only stage the directory and
  // a tiny boot-time helper that materializes the file from $CLAUDE_CREDENTIALS.
  //
  // The helper is sourced from /etc/profile.d/, so it runs whenever bash
  // starts as a login shell (which is how vm.ts spawns it).
  const claudeBootstrap = [
    "#!/bin/sh",
    "# Materialize ~/.claude/.credentials.json from the boot env, once.",
    'if [ -n "${CLAUDE_CREDENTIALS:-}" ]; then',
    '  mkdir -p "$HOME/.claude"',
    '  printf "%s" "$CLAUDE_CREDENTIALS" > "$HOME/.claude/.credentials.json"',
    '  chmod 600 "$HOME/.claude/.credentials.json"',
    "  unset CLAUDE_CREDENTIALS",
    "fi",
    "",
  ].join("\n");
  const claudeBootstrapB64 = Buffer.from(claudeBootstrap).toString("base64");
  await vm.exec(
    `echo ${claudeBootstrapB64} | base64 -d > /etc/profile.d/00-claude-credentials.sh && ` +
      "chmod 0755 /etc/profile.d/00-claude-credentials.sh",
  );

  // Sanity check.
  await vm.exec(
    "node --version && pnpm --version && claude --version && bash --version | head -1 && git --version && gh --version | head -1",
  );
};

// --- stamp check ---------------------------------------------------------

const sourceHash = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex");

if (!FORCE && existsSync(OUT) && existsSync(STAMP)) {
  const prior = readFileSync(STAMP, "utf8").trim();
  if (prior === sourceHash) {
    console.log(`provision: ${OUT} is up to date (stamp matches) — skipping.`);
    console.log("           pass --force to rebuild.");
    process.exit(0);
  }
}

// --- incremental base ----------------------------------------------------

const base = !FORCE && existsSync(OUT) ? OUT : join(ASSETS, "rootfs-debian-arm64.tar.gz");
console.log(`provision: base=${base === OUT ? "./app.tar.gz (incremental)" : base}`);

// RAM auto-size from gzipped rootfs — see vm.ts for the formula's derivation.
function ramForImage(path: string): number {
  const compressed = statSync(path).size;
  const GIB = 1024 * 1024 * 1024;
  const raw = Math.max(4 * GIB, compressed * 16 + 2 * GIB);
  const align = 256 * 1024 * 1024;
  return Math.ceil(raw / align) * align;
}
console.log(
  `provision: ram=${(ramForImage(base) / 1024 ** 3).toFixed(1)} GiB ` +
    `(base=${(statSync(base).size / 1024 ** 2).toFixed(0)} MB)`,
);

// --- run -----------------------------------------------------------------

const result = await provision({
  base,
  kernel: join(ASSETS, "Image-arm64"),
  dtb: join(ASSETS, "virt-arm64.dtb"),
  out: OUT,

  // 1 GiB scratch is too small once node_modules + global npm pkgs land.
  scratchDiskSizeBytes: 8 * 1024 * 1024 * 1024,

  vmmEnv: { MACHINEN_RAM_BYTES: String(ramForImage(base)) },

  cmd: ["/usr/bin/env", "/bin/bash", "-i"],
  env: {
    PATH: "/root/.local/share/fnm:/usr/local/bin:/usr/bin:/bin:/sbin",
    HOME: "/root",
    TERM: "xterm-256color",
    PS1: "(machinen) # ",
  },

  onLog: (evt) => {
    if (evt.source === "exec-stdout" || evt.source === "guest-console") {
      process.stdout.write(evt.chunk);
    } else if (evt.source === "exec-stderr") {
      process.stderr.write(evt.chunk);
    }
  },

  timeoutMs: 30 * 60_000,
  install: installSteps,
});

writeFileSync(STAMP, sourceHash);
console.log(`\nBuilt ${result.imagePath} (${(result.elapsedMs / 1000).toFixed(1)}s)`);
