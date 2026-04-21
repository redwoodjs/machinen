// machinen CLI — spawn a microVM from a bundle directory, and
// pre-fetch the kernel + rootfs assets published alongside each
// release tag.
//
// v0 surface (see .docs/learnings/microvm/distribution-plan.md):
//   machinen run <bundle-dir>
//   machinen install [--version <tag>]
//   machinen --version | -h | --help
//
// Deferred (needs runtime API changes):
//   machinen run -- <cmd>           (base-only, no bundle)
//   machinen run --env FOO=bar ...
//   machinen run --base alpine

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

import { spawn, SpawnError } from "@machinen/runtime";

import pkg from "../package.json" with { type: "json" };

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

async function cmdRun(args: string[]): Promise<number> {
  const { positional, double_dash_args } = splitDoubleDash(args);

  if (positional.length === 0 && double_dash_args.length > 0) {
    die(
      `'machinen run -- <cmd>' (base-only spawn) is not yet supported.\n` +
        `  Hand it a bundle directory for now: machinen run <bundle-dir>\n` +
        `  See .docs/learnings/microvm/distribution-plan.md §Runtime resolution.`,
    );
  }

  if (positional.length !== 1) {
    die("usage: machinen run <bundle-dir>");
  }

  const bundle = resolve(positional[0]);
  if (!existsSync(bundle)) {
    die(`bundle directory not found: ${bundle}`);
  }

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
  // `assets` array).
  const baseDir = assetsOverride ? resolve(assetsOverride) : baseDirFor(RELEASE_TAG);
  const kernelPath = join(baseDir, assetsOverride ? "Image-arm64" : "Image");
  const dtbPath = join(baseDir, assetsOverride ? "virt-arm64.dtb" : "virt.dtb");
  const baseRootfsPath = join(
    baseDir,
    assetsOverride ? "rootfs-debian-arm64.tar.gz" : "rootfs.tar.gz",
  );

  let vm;
  try {
    vm = await spawn({
      bundle,
      kernel: kernelPath,
      dtb: dtbPath,
      baseRootfs: baseRootfsPath,
      // Interactive CLI: the session lives as long as the guest does.
      // Don't impose the default 60s cap.
      timeoutMs: null,
    });
  } catch (err) {
    if (err instanceof SpawnError) {
      die(err.message);
    }
    throw err;
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

// ------------------------------------------------------------
// Arg helpers
// ------------------------------------------------------------

function splitDoubleDash(argv: string[]): { positional: string[]; double_dash_args: string[] } {
  const idx = argv.indexOf("--");
  if (idx === -1) {
    return { positional: argv, double_dash_args: [] };
  }
  return { positional: argv.slice(0, idx), double_dash_args: argv.slice(idx + 1) };
}

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

function printHelp(): void {
  process.stdout.write(
    `machinen ${VERSION}\n` +
      `\n` +
      `Usage:\n` +
      `  machinen run <bundle-dir>       Spawn a microVM from a bundle\n` +
      `  machinen install                Pre-fetch the current-tag base assets\n` +
      `    --version <tag>               Pin to a specific release tag\n` +
      `  machinen --version | -h         Print version / help\n` +
      `\n` +
      `Environment:\n` +
      `  MACHINEN_VMM                    Override the VMM binary path (dev)\n` +
      `  MACHINEN_ASSETS_DIR             Use base assets from this directory\n` +
      `                                  instead of the cache / GH Releases\n` +
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

  if (!sub || sub === "-h" || sub === "--help") {
    printHelp();
    return sub ? 0 : 1;
  }
  if (sub === "--version" || sub === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  switch (sub) {
    case "run":
      return cmdRun(rest);
    case "install":
      return cmdInstall(rest);
    default:
      die(`unknown command: ${sub}\nRun 'machinen --help' for usage.`);
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      `machinen: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  },
);
