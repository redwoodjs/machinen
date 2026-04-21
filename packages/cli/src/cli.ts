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
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { arch, homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";

import { spawn } from "@machinen/runtime";

import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;
const RELEASE_TAG = `@machinen/runtime@${VERSION}`;
const REPO = "redwoodjs/machinen";
const CACHE_ROOT = join(homedir(), ".machinen");

const require_ = createRequire(import.meta.url);

// ------------------------------------------------------------
// VMM binary resolution
// ------------------------------------------------------------

function resolveVmmBinary(): string {
  // 1. explicit env var (dev-mode override)
  const envOverride = process.env.MACHINEN_VMM;
  if (envOverride) {
    const abs = resolve(envOverride);
    if (!existsSync(abs)) {
      die(`MACHINEN_VMM is set to ${envOverride}, but that file does not exist.`);
    }
    return abs;
  }

  // 2. platform-matched @machinen/vmm-<arch>-<os> package
  const key = `${arch()}-${platform()}`;
  const pkgName = `@machinen/vmm-${key}`;
  try {
    const mod = require_(pkgName) as { binary: string };
    if (!mod.binary || !existsSync(mod.binary)) {
      die(`${pkgName} is installed but its binary is missing at ${mod.binary}.`);
    }
    return mod.binary;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    die(
      `No VMM binary found for ${key}.\n` +
        `  Expected package: ${pkgName}\n` +
        `  Error: ${msg}\n` +
        `  Install: npm i -g @machinen/cli  (pulls the right VMM via optionalDependencies)`,
    );
  }
}

// ------------------------------------------------------------
// Base-asset cache
// ------------------------------------------------------------

function cacheDirFor(tag: string): string {
  return join(CACHE_ROOT, tag);
}

function baseDirFor(tag: string, distro = "debian", cpu = "arm64"): string {
  return join(cacheDirFor(tag), "bases", `${distro}-${cpu}`);
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
    if (existsSync(current) || isSymlink(current)) unlinkSync(current);
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
  if (!res.ok) die(`fetch ${url} failed: ${res.status} ${res.statusText}`);
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
  if (!existsSync(bundle)) die(`bundle directory not found: ${bundle}`);

  const binary = resolveVmmBinary();
  const vm = await spawn({ binary, bundle });

  vm.stdout.pipe(process.stdout);
  vm.stderr.pipe(process.stderr);
  process.stdin.pipe(vm.stdin);

  const { code } = await vm.wait();
  return code ?? 0;
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
  if (idx === -1) return { positional: argv, double_dash_args: [] };
  return { positional: argv.slice(0, idx), double_dash_args: argv.slice(idx + 1) };
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
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
    process.stderr.write(`machinen: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
