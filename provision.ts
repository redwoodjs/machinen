// Build a "ready-to-work" rootfs by running an install hook inside a
// base rootfs, then freezing the result to a tarball.
//
//   pnpm provision           # incremental — runs only what changed
//   pnpm provision --force   # ignore the stamp, full rebuild
//
// Always anchors on the main repo (resolved via `git rev-parse
// --git-common-dir`), so a fresh worktree can run `pnpm vm` and reuse
// the same app.tar.gz / release-assets / runtime binaries — no need to
// rebuild machinen inside every worktree.

import type { VmHandle } from "@machinen/runtime";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// provision belongs on the canonical checkout — clones share its
// app.tar.gz via vm.ts's MAIN_REPO anchor, so re-provisioning from
// inside a clone would shard the cache by clone path.
if (existsSync(join(HERE, ".machinen-vm", "origin"))) {
  console.error(
    `provision: refusing to run inside a clone (.machinen-vm/origin found at ${HERE}).\n` +
      "           Run from the canonical checkout instead.",
  );
  process.exit(1);
}

// --- main-repo anchor -----------------------------------------------------
//
// `git rev-parse --git-common-dir` always points at the *main* `.git`,
// even from inside a linked worktree. Its parent is the main checkout.
// We anchor every host-side path here so worktrees inherit main's
// runtime, release-assets, and cache.
function mainRepoRoot(): string {
  try {
    const commonDir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    return dirname(commonDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.error(`provision: could not resolve main repo from ${HERE} (${msg})`);
    process.exit(1);
  }
}
const MAIN_REPO = mainRepoRoot();

// Homebrew's e2fsprogs is keg-only — see vm.ts for rationale. (The
// runtime now bundles mke2fs, but keep the PATH munge as a fallback.)
const BREW_E2FS = "/opt/homebrew/opt/e2fsprogs/sbin";
if (existsSync(BREW_E2FS) && !(process.env.PATH ?? "").includes(BREW_E2FS)) {
  process.env.PATH = `${BREW_E2FS}:${process.env.PATH ?? ""}`;
}

// Resolve @machinen/runtime against the *main repo*'s node_modules, not
// the worktree's. Worktrees rarely have runtime built — main always does.
const mainRequire = createRequire(join(MAIN_REPO, "package.json"));
const runtimeEntry = mainRequire.resolve("@machinen/runtime");
const { provision } = (await import(
  pathToFileURL(runtimeEntry).href
)) as typeof import("@machinen/runtime");

const ASSETS = process.env.MACHINEN_ASSETS_DIR ?? resolve(MAIN_REPO, "release-assets");

// Cache key on the main repo basename so every worktree shares one
// app.tar.gz. Build artifacts must live OUTSIDE the project dir or
// they show up inside the guest via vm.ts's live mount.
const CACHE_DIR = join(homedir(), ".cache", "machinen", basename(MAIN_REPO));
mkdirSync(CACHE_DIR, { recursive: true });
const OUT = join(CACHE_DIR, "app.tar.gz");
const STAMP = `${OUT}.stamp`;
const FORCE = process.argv.includes("--force");

// Match the host repo's pinned pnpm version inside the guest.
const PKG = JSON.parse(readFileSync(join(MAIN_REPO, "package.json"), "utf8")) as {
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

// #177: dev-VM tty resize forwarding. The launcher in vm.ts only does
// anything if /sbin/machinen-winsize-agent is on disk, so push it here.
// build-base-assets.sh bakes it into fresh release-assets, but users
// with stale rootfs tarballs (most local checkouts) wouldn't get it
// without this refresh. Source from the test-fixtures build output —
// `bash packages/microvm/test-fixtures/assets/build-init.sh` from
// packages/microvm produces the binary; no fail if missing because the
// dev VM degrades to the e7e1db1 stty-on-bootstrap behavior (fine for
// initial paint; just no SIGWINCH propagation mid-session).
const WINSIZE_AGENT_HOST_PATH = resolve(
  MAIN_REPO,
  "packages/microvm/test-fixtures/winsize-agent",
);
const winsizeAgentBin = existsSync(WINSIZE_AGENT_HOST_PATH)
  ? readFileSync(WINSIZE_AGENT_HOST_PATH)
  : null;
if (!winsizeAgentBin) {
  console.warn(
    `provision: ${WINSIZE_AGENT_HOST_PATH} missing — host SIGWINCH won't reach the guest.\n` +
      "           Build it with `bash packages/microvm/test-fixtures/assets/build-init.sh`\n" +
      "           from packages/microvm, then re-run provision.",
  );
}

const installSteps = async (vm: VmHandle) => {
  // /tmp + /var/tmp need to exist with sticky-1777 before anything that
  // drops privs (apt → _apt). Two reasons they may be off:
  //   • Fresh base — mke2fs -d on macOS as a non-root user captures
  //     uid 501 and silently drops sticky bits, so /tmp lands at 0755.
  //   • Incremental base — the prior provision's tar excludes ./tmp,
  //     so the directory is missing entirely on this boot.
  // mkdir -p + chmod handles both shapes.
  await vm.exec("mkdir -p /tmp /var/tmp && chmod 1777 /tmp /var/tmp");

  // gvproxy DNS jitter under apt's parallel fan-out.
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
  // Symlink fd-find's binary to the upstream `fd` name.
  await vm.exec(
    "apt-get update -qq && " +
      "apt-get install -y --no-install-recommends " +
      "bash git build-essential ca-certificates curl " +
      "ripgrep fd-find jq less vim-tiny openssh-client gh && " +
      "ln -sf /usr/bin/fdfind /usr/local/bin/fd",
  );

  // Pre-bake git identity. safe.directory '*' silences git's
  // CVE-2022-24765 "dubious ownership" check — necessary because
  // /mnt/workspace is FUSE-mounted with uids that may not line up.
  await vm.exec(
    "git config --global user.email 'peter.pistorius@gmail.com' && " +
      "git config --global user.name 'Peter Pistorius' && " +
      "git config --global init.defaultBranch main && " +
      "git config --global --add safe.directory '*'",
  );

  // Node + pnpm + Claude Code via fnm. Idempotent on rebuilds.
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

  // Materialize Claude Code credentials on first login. The boot cmd
  // is `bash -lc` (login shell), so /etc/profile + profile.d run and
  // this snippet fires before the interactive bash shows a prompt.
  //
  // CLAUDE_CREDENTIALS  -> ~/.claude/.credentials.json (OAuth tokens;
  //                        rewritten every boot so a rotated host token
  //                        propagates).
  // CLAUDE_ACCOUNT_JSON -> ~/.claude.json. Holds the identity slice
  //                        (userID, oauthAccount, hasCompletedOnboarding).
  //                        Merged into any existing file via jq so we
  //                        refresh stale identity without clobbering
  //                        VM-accumulated state. Falls back to overwrite
  //                        when jq isn't available or the existing file
  //                        is unparseable.
  const profileSnippet = [
    "#!/bin/sh",
    'if [ -n "${CLAUDE_CREDENTIALS:-}" ]; then',
    '  mkdir -p "$HOME/.claude"',
    '  printf "%s" "$CLAUDE_CREDENTIALS" > "$HOME/.claude/.credentials.json"',
    '  chmod 600 "$HOME/.claude/.credentials.json"',
    "  unset CLAUDE_CREDENTIALS",
    "fi",
    'if [ -n "${CLAUDE_ACCOUNT_JSON:-}" ]; then',
    '  if [ -e "$HOME/.claude.json" ] && command -v jq >/dev/null 2>&1 && \\',
    '     jq -e . "$HOME/.claude.json" >/dev/null 2>&1; then',
    "    tmp=$(mktemp) && \\",
    '      jq -s ".[0] * .[1]" "$HOME/.claude.json" <(printf "%s" "$CLAUDE_ACCOUNT_JSON") > "$tmp" && \\',
    '      mv "$tmp" "$HOME/.claude.json"',
    "  else",
    '    printf "%s" "$CLAUDE_ACCOUNT_JSON" > "$HOME/.claude.json"',
    "  fi",
    '  chmod 600 "$HOME/.claude.json"',
    "fi",
    "unset CLAUDE_ACCOUNT_JSON",
    "",
  ].join("\n");
  const profileSnippetB64 = Buffer.from(profileSnippet).toString("base64");
  await vm.exec(
    `echo ${profileSnippetB64} | base64 -d > /etc/profile.d/00-machinen.sh && ` +
      "chmod 0755 /etc/profile.d/00-machinen.sh",
  );

  // #177 dev-VM tty resize agent. Overwrite even if /sbin/machinen-winsize-agent
  // already exists in the base rootfs, so the freshest local build wins
  // (mirrors the /fuse-agent + /init refresh idiom in init.zig).
  if (winsizeAgentBin) {
    await vm.writeFile("/sbin/machinen-winsize-agent", winsizeAgentBin, {
      mode: 0o755,
    });
  }

  // Sanity check.
  await vm.exec(
    "node --version && pnpm --version && claude --version && bash --version | head -1 && git --version && gh --version | head -1",
  );
};

// --- stamp check ----------------------------------------------------------

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

// --- incremental base -----------------------------------------------------

const base = !FORCE && existsSync(OUT) ? OUT : join(ASSETS, "rootfs-debian-arm64.tar.gz");
console.log(`provision: base=${base === OUT ? "./app.tar.gz (incremental)" : base}`);

// --- run ------------------------------------------------------------------

const result = await provision({
  base,
  kernel: join(ASSETS, "Image-arm64"),
  dtb: join(ASSETS, "virt-arm64.dtb"),
  out: OUT,

  // 1 GiB scratch is too small once node_modules + global npm pkgs land.
  scratchDiskSizeBytes: 8 * 1024 * 1024 * 1024,

  // Boot directly into /mnt/workspace via a thin -c wrapper. The
  // FUSE mount used by liveMounts is currently root-only, so we run
  // as root; `--dangerously-skip-permissions` won't work for `claude`
  // inside the VM until fuse-agent supports allow_other.
  cmd: ["/bin/bash", "-lc", "cd /mnt/workspace 2>/dev/null; exec bash -i"],
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
