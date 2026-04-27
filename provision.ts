// Build a "ready-to-work" rootfs by running an install hook inside a
// base rootfs, then freezing the result to a tarball.
//
//   pnpm provision           # incremental — runs only what changed
//   pnpm provision --force   # ignore the stamp, full rebuild
//
// Three speedups stack up:
//
//   1. Incremental base. After the first successful provision we use
//      ./app.tar.gz itself as the base for re-provisions. apt-get
//      install of an already-installed package is a few seconds, fnm
//      install of an already-installed Node is instant. Only newly-
//      added install steps actually do work.
//
//   2. Hash-stamp. We hash the install hook's source. If the hash
//      matches and ./app.tar.gz exists, we skip the whole thing —
//      no boot, no work. Same trick `scripts/build.sh` uses.
//
//   3. Already free: the runtime's artifact-cache fronts
//      nodejs.org/dist for fnm, so Node downloads land in
//      ~/.machinen/cache after the first hit.
//
// What's NOT cached today: apt .deb files and npm tarballs. Those
// re-download from upstream on a cold rebuild.
//
// Output: ./app.tar.gz, plus ./app.tar.gz.stamp (hook hash for #2).

import { provision } from "@machinen/runtime";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Homebrew's e2fsprogs is keg-only — see machinen.ts for rationale.
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
// guest's initramfs by `mount: { host: HERE, ... }` in machinen.ts.
// See machinen.ts for the rationale.
const CACHE_DIR = join(homedir(), ".cache", "machinen", basename(HERE));
mkdirSync(CACHE_DIR, { recursive: true });
const OUT = join(CACHE_DIR, "app.tar.gz");
const STAMP = `${OUT}.stamp`;
const FORCE = process.argv.includes("--force");

// The install hook, factored out so we can hash it for the stamp. Any
// change here invalidates the stamp and triggers a re-provision.
const installSteps = async (vm: import("@machinen/runtime").VmHandle) => {
  // The kernel mounts the initramfs root as tmpfs sized at its default
  // of 50% of total RAM. With our 8.5 GiB allocation that's a ~4.25 GiB
  // ceiling; once the unpacked rootfs (~1.5 GB) plus npm's cache +
  // staging + node_modules destination pile on, ENOSPC fires
  // mid-install. Remount with size=100% so the tmpfs can use every
  // byte the kernel has — costs nothing because RAM pages are
  // committed lazily.
  await vm.exec("mount -o remount,size=100% /");

  // gvproxy's DNS forwarder occasionally drops a query under apt's
  // parallel download fan-out — symptoms are "Temporary failure
  // resolving 'deb.debian.org'" mid-install. Configure apt to retry
  // and serialize downloads so DNS pressure stays low.
  //
  // Base64-encode + shell-decode because vm.exec() disallows literal
  // newlines in the command (it's a single-line vsock protocol),
  // and a heredoc would embed them.
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

  // System packages. apt-get is idempotent — if these are already
  // installed (incremental rebuild), it's a fast no-op.
  //
  // Beyond the build essentials we add:
  //   ripgrep, fd-find        — fast code search (pi shells out to these).
  //   gh, 1password-cli       — GitHub + 1Password CLIs inside the guest.
  //   jq                       — JSON munging in scripts.
  //   less, vim-tiny           — usable interactive shell.
  //   openssh-client           — git over ssh, scp, etc.
  //   gnupg, debsig-verify     — needed for the 1Password apt repo.
  await vm.exec(
    "apt-get update -qq && " +
      "apt-get install -y --no-install-recommends " +
      "bash git build-essential ca-certificates curl " +
      "ripgrep fd-find gh jq less vim-tiny openssh-client gnupg debsig-verify",
  );

  // Debian ships fd as `fdfind`; pi expects `fd`, so add the common alias.
  // Then install 1Password CLI from its apt repo so `op` exists inside
  // the guest too.
  await vm.exec(
    "ln -sf /usr/bin/fdfind /usr/local/bin/fd && " +
      "ARCH=$(dpkg --print-architecture) && " +
      "mkdir -p /etc/apt/keyrings " +
      "/etc/debsig/policies/AC2D62742012EA22 " +
      "/usr/share/debsig/keyrings/AC2D62742012EA22 && " +
      "curl -fsSL https://downloads.1password.com/linux/keys/1password.asc | " +
      "gpg --dearmor --yes -o /etc/apt/keyrings/1password.gpg && " +
      "echo \"deb [arch=$ARCH signed-by=/etc/apt/keyrings/1password.gpg] https://downloads.1password.com/linux/debian/$ARCH stable main\" > /etc/apt/sources.list.d/1password.list && " +
      "curl -fsSL https://downloads.1password.com/linux/debian/debsig/1password.pol -o /etc/debsig/policies/AC2D62742012EA22/1password.pol && " +
      "curl -fsSL https://downloads.1password.com/linux/keys/1password.asc | gpg --dearmor --yes -o /usr/share/debsig/keyrings/AC2D62742012EA22/debsig.gpg && " +
      "apt-get update -qq && " +
      "apt-get install -y --no-install-recommends 1password-cli",
  );

  // Pre-bake git identity so commits inside the guest don't prompt.
  await vm.exec(
    "git config --global user.email 'peter.pistorius@gmail.com' && " +
      "git config --global user.name 'Peter Pistorius' && " +
      "git config --global init.defaultBranch main",
  );

  // Node + pnpm + pi via fnm. With rootDisk:true (machinen #114) the
  // rootfs lives on a virtio-blk ext4 disk, not in RAM, so pi's native
  // deps (tree-sitter et al.) no longer threaten the old initramfs
  // ceiling — it's cheaper to bake pi here once than reinstall on
  // every boot. Idempotent: fnm install / npm install -g of an
  // already-installed version is sub-second.
  await vm.exec(
    "export FNM_DIR=/root/.local/share/fnm && " +
      "fnm install 22 && " +
      "fnm default 22 && " +
      "NODE_BIN=$(fnm exec --using=22 -- sh -c 'dirname $(which node)') && " +
      "ln -sf $NODE_BIN/node /usr/local/bin/node && " +
      "ln -sf $NODE_BIN/npm  /usr/local/bin/npm  && " +
      "ln -sf $NODE_BIN/npx  /usr/local/bin/npx  && " +
      "fnm exec --using=22 npm install -g pnpm @mariozechner/pi-coding-agent && " +
      "ln -sf $NODE_BIN/pnpm /usr/local/bin/pnpm && " +
      "ln -sf $NODE_BIN/pi   /usr/local/bin/pi",
  );

  // Stage a pi extension that registers the cheapestinference provider.
  // The apiKey field is the NAME of an env var pi will read at runtime —
  // the actual value is set inside the guest (for example by exporting
  // CHEAPEST_INFERENCE_API_KEY or reading it via `op`). This keeps the
  // rootfs free of secrets while letting pi route through the proxy.
  //
  // Confirmed from https://docs.cheapestinference.com/getting-started/quickstart/:
  //   - OpenAI-compatible at https://api.cheapestinference.com/v1
  //   - Anthropic-compatible at https://api.cheapestinference.com/anthropic
  //   - Authorization: Bearer YOUR_API_KEY (so authHeader: true)
  //
  // pi extension contract (custom-provider.md):
  //   - The dir must contain a package.json whose `pi.extensions` array
  //     lists the entry file. A bare index.ts is NOT discovered.
  //   - ProviderModelConfig requires id, name, reasoning, input, cost,
  //     contextWindow, maxTokens. Partial models are dropped.
  //   - Async factories run before startup, so we can dynamically pull
  //     the model list from GET /v1/models.
  const piExtension = [
    "import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';",
    "",
    "export default async function (pi: ExtensionAPI) {",
    "  const apiKey = process.env.CHEAPEST_INFERENCE_API_KEY;",
    "  const baseUrl = 'https://api.cheapestinference.com/v1';",
    "",
    "  // Sensible defaults for fields the /v1/models endpoint doesn't",
    "  // surface. cost=0 disables usage-based cost reporting in pi; that's",
    "  // fine until cheapestinference exposes pricing via the API.",
    "  const toModel = (m: { id: string; name?: string; context_window?: number; max_tokens?: number }) => ({",
    "    id: m.id,",
    "    name: m.name ?? m.id,",
    "    reasoning: false,",
    "    input: ['text'] as ('text' | 'image')[],",
    "    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },",
    "    contextWindow: m.context_window ?? 128000,",
    "    maxTokens: m.max_tokens ?? 4096,",
    "  });",
    "",
    "  // Fallback if the live fetch fails — at least one model so the",
    "  // provider still appears in pi's model picker.",
    "  let models = [toModel({ id: 'deepseek-chat', name: 'DeepSeek Chat' })];",
    "",
    "  if (apiKey) {",
    "    try {",
    "      const res = await fetch(`${baseUrl}/models`, {",
    "        headers: { Authorization: `Bearer ${apiKey}` },",
    "      });",
    "      if (res.ok) {",
    "        const payload = (await res.json()) as { data: Array<{ id: string; name?: string; context_window?: number; max_tokens?: number }> };",
    "        if (Array.isArray(payload.data) && payload.data.length > 0) {",
    "          models = payload.data.map(toModel);",
    "        }",
    "      }",
    "    } catch {",
    "      // Network/JSON failure — keep the fallback list.",
    "    }",
    "  }",
    "",
    "  pi.registerProvider('cheapestinference', {",
    "    baseUrl,",
    "    apiKey: 'CHEAPEST_INFERENCE_API_KEY', // env-var name, not the value",
    "    api: 'openai-completions',",
    "    authHeader: true,",
    "    models,",
    "  });",
    "}",
  ].join("\n");
  const piExtensionB64 = Buffer.from(piExtension).toString("base64");
  // pi discovers extensions via package.json's `pi.extensions` array.
  const piManifest = JSON.stringify(
    {
      name: "pi-extension-cheapestinference",
      private: true,
      version: "0.0.0",
      type: "module",
      pi: { extensions: ["./index.ts"] },
    },
    null,
    2,
  );
  const piManifestB64 = Buffer.from(piManifest).toString("base64");
  await vm.exec(
    "mkdir -p /root/.pi/agent/extensions/cheapestinference && " +
      `echo ${piExtensionB64} | base64 -d > /root/.pi/agent/extensions/cheapestinference/index.ts && ` +
      `echo ${piManifestB64} | base64 -d > /root/.pi/agent/extensions/cheapestinference/package.json`,
  );

  // Sanity check.
  await vm.exec(
    "node --version && pnpm --version && pi --version && bash --version | head -1 && git --version && fd --version && rg --version && gh --version && op --version",
  );
};

// --- stamp check (#2) -----------------------------------------------------

// Hash the source of this file — any edit (a new install step, a
// changed package list, even a comment) bumps the hash and forces a
// rebuild. Cheaper than trying to enumerate which inputs matter.
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

// --- incremental base (#1) ------------------------------------------------

// First run: start from the upstream Debian-minbase rootfs.
// Subsequent runs: start from our own previous output. apt sees the
// installed packages and runs a fast diff instead of pulling 70+ MB.
const base =
  !FORCE && existsSync(OUT)
    ? OUT
    : join(ASSETS, "rootfs-debian-arm64.tar.gz");
console.log(`provision: base=${base === OUT ? "./app.tar.gz (incremental)" : base}`);

// Pick a guest RAM size from the gzipped rootfs tarball size.
//
// Why: with initramfs-as-rootfs, `/` is a tmpfs and the kernel sizes
// it at ~50% of guest RAM. The tmpfs has to fit:
//   1. the unpacked rootfs (≈ 4× the compressed tarball)
//   2. an `npm install` / `apt install` delta during provision (can
//      be hundreds of MB; npm peaks at 2× the install size because
//      it stages in /tmp before renaming into node_modules)
//   3. slack
//
// So RAM ≥ 4 × (unpacked + delta + slack). Empirically `compressed
// × 16 + 2 GiB` covers a Debian-shaped rootfs through several
// rounds of `npm install -g`. Floored at 4 GiB so tiny base images
// don't get under-provisioned. Aligned to 256 MiB because the
// kernel likes round-ish memory maps.
//
// This is a Band-Aid for the "rootfs lives in RAM" architecture; the
// real fix is virtio-blk root (redwoodjs/machinen#114) which makes
// RAM independent of rootfs size.
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

// --- run -------------------------------------------------------------------

const result = await provision({
  base,
  kernel: join(ASSETS, "Image-arm64"),
  dtb: join(ASSETS, "virt-arm64.dtb"),
  out: OUT,

  // The runtime's default scratch disk is 1 GiB — small enough that
  // anything heavier than the base Debian rootfs (e.g. once you've
  // npm-installed pi-coding-agent + its tree-sitter natives) hits
  // PROVISION_DISK_TOO_SMALL during the final tar-to-/dev/vda step.
  // 8 GiB sparse costs ~0 on host disk until something writes to it,
  // so just give it room to grow.
  scratchDiskSizeBytes: 8 * 1024 * 1024 * 1024,

  // Auto-size guest RAM from the chosen base tarball — see ramForImage().
  // The provision boot has the same RAM-vs-initramfs ceiling as a regular
  // boot, so this mirrors machinen.ts.
  vmmEnv: { MACHINEN_RAM_BYTES: String(ramForImage(base)) },

  cmd: ["/usr/bin/env", "/bin/bash", "-i"],
  env: {
    PATH: "/root/.local/share/fnm:/usr/local/bin:/usr/bin:/bin:/sbin",
    HOME: "/root",
    TERM: "xterm-256color",
    PS1: "(rsdk) # ",
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
