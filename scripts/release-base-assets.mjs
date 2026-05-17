#!/usr/bin/env node
// Publish and verify the public base assets that @machinen/cli downloads
// from redwoodjs/machinen.dev. This is intentionally a single Node entrypoint
// (usable by CI and by a human with `gh auth login`) so manual asset releases
// go through the same checksum refresh + fetch-back guard as automated ones.
//
// Guardrail for redwoodjs/machinen.dev#9: runtime-v0.3.3 shipped rootfs bytes
// that did not match the published .sha256 sidecar. `publish` always rewrites
// checksums from the exact payload bytes it is about to upload, uploads with
// --clobber, then verifies by downloading through the public URLs the CLI uses.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_REPO = "redwoodjs/machinen.dev";
const DEFAULT_ASSETS_DIR = resolve(REPO_ROOT, "release-assets");
const PAYLOAD_ASSETS = [
  "Image-arm64",
  "virt-arm64.dtb",
  "rootfs-debian-arm64.tar.gz",
  "rootfs-debian-arm64.img.gz",
  "bzImage-x86_64",
  "rootfs-debian-amd64.tar.gz",
  "rootfs-debian-amd64.img.gz",
];
const OPTIONAL_UPLOAD_ASSETS = [
  "Image-arm64.inputs-sha256",
  "rootfs-debian-arm64.tar.gz.inputs-sha256",
  "bzImage-x86_64.inputs-sha256",
  "rootfs-debian-amd64.tar.gz.inputs-sha256",
];

function usage(exitCode = 2) {
  const text = `usage:
  node scripts/release-base-assets.mjs publish [options]
  node scripts/release-base-assets.mjs verify  [options]
  node scripts/release-base-assets.mjs checksums [options]

commands:
  checksums  Rewrite release-assets/*.sha256 for required payloads and verify locally.
  verify     Download public assets + .sha256 sidecars and verify them.
  publish    checksums -> gh release create/upload -> verify.

options:
  --tag <tag>           Release tag. Defaults to runtime-v<packages/runtime version>.
  --repo <owner/repo>   Target repo. Default: ${DEFAULT_REPO}
  --assets-dir <dir>    Local assets dir. Default: release-assets
  --base-url <url>      Verification URL base. Default: GitHub release download URL.
  --asset <name>        Payload to verify/publish. Repeatable. Default: required payloads.
  --tries <n>           Verification attempts. Default: env or 6.
  --sleep <seconds>     Seconds between verification attempts. Default: env or 10.
  --dry-run             For publish: refresh/check local checksums, print upload plan only.

Environment mirrors the options for manual use:
  MACHINEN_RELEASE_ASSETS_DIR, MACHINEN_RELEASE_ASSETS_BASE_URL,
  MACHINEN_RELEASE_VERIFY_TRIES, MACHINEN_RELEASE_VERIFY_SLEEP
`;
  console.error(text.trimEnd());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const command = argv.shift();
  if (!command || command === "-h" || command === "--help") {
    usage(command ? 0 : 2);
  }
  if (!["publish", "verify", "checksums"].includes(command)) {
    usage(2);
  }

  const envAssetsDir = process.env.MACHINEN_RELEASE_ASSETS_DIR;
  const opts = {
    command,
    repo: DEFAULT_REPO,
    assetsDir: envAssetsDir ?? DEFAULT_ASSETS_DIR,
    compareLocal: command !== "verify" || Boolean(envAssetsDir),
    baseUrl: process.env.MACHINEN_RELEASE_ASSETS_BASE_URL,
    assets: [],
    tries: Number(process.env.MACHINEN_RELEASE_VERIFY_TRIES ?? 6),
    sleepSeconds: Number(process.env.MACHINEN_RELEASE_VERIFY_SLEEP ?? 10),
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) {
        usage(2);
      }
      return value;
    };
    if (arg === "--tag") {
      opts.tag = next();
    } else if (arg?.startsWith("--tag=")) {
      opts.tag = arg.slice("--tag=".length);
    } else if (arg === "--repo") {
      opts.repo = next();
    } else if (arg?.startsWith("--repo=")) {
      opts.repo = arg.slice("--repo=".length);
    } else if (arg === "--assets-dir") {
      opts.assetsDir = next();
      opts.compareLocal = true;
    } else if (arg?.startsWith("--assets-dir=")) {
      opts.assetsDir = arg.slice("--assets-dir=".length);
      opts.compareLocal = true;
    } else if (arg === "--base-url") {
      opts.baseUrl = next();
    } else if (arg?.startsWith("--base-url=")) {
      opts.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--asset") {
      opts.assets.push(next());
    } else if (arg?.startsWith("--asset=")) {
      opts.assets.push(arg.slice("--asset=".length));
    } else if (arg === "--tries") {
      opts.tries = Number(next());
    } else if (arg?.startsWith("--tries=")) {
      opts.tries = Number(arg.slice("--tries=".length));
    } else if (arg === "--sleep") {
      opts.sleepSeconds = Number(next());
    } else if (arg?.startsWith("--sleep=")) {
      opts.sleepSeconds = Number(arg.slice("--sleep=".length));
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else {
      usage(2);
    }
  }

  opts.assetsDir = resolve(opts.assetsDir);
  opts.assets = opts.assets.length > 0 ? opts.assets : [...PAYLOAD_ASSETS];
  if (!Number.isInteger(opts.tries) || opts.tries < 1) {
    throw new Error("--tries must be a positive integer");
  }
  if (!Number.isFinite(opts.sleepSeconds) || opts.sleepSeconds < 0) {
    throw new Error("--sleep must be a non-negative number");
  }
  return opts;
}

async function defaultTag() {
  const raw = await readFile(resolve(REPO_ROOT, "packages/runtime/package.json"), "utf8");
  const pkg = JSON.parse(raw);
  return `runtime-v${pkg.version}`;
}

function releaseBaseUrl(repo, tag) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}`;
}

function assetUrl(baseUrl, asset) {
  return `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(asset)}`;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  const file = createReadStream(path);
  for await (const chunk of file) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function parseSidecar(text, label) {
  const sha = text.trim().split(/\s+/)[0]?.toLowerCase();
  if (!sha || !/^[0-9a-f]{64}$/.test(sha)) {
    throw new Error(`invalid sha256 sidecar for ${label}`);
  }
  return sha;
}

async function localPayloadSha(assetsDir, asset) {
  const payload = join(assetsDir, asset);
  if (!(await exists(payload))) {
    throw new Error(`missing release asset: ${payload}`);
  }
  return sha256File(payload);
}

async function rewriteChecksums(assetsDir, assets) {
  console.log(`refresh checksums in ${assetsDir}`);
  for (const asset of assets) {
    const sha = await localPayloadSha(assetsDir, asset);
    await writeFile(join(assetsDir, `${asset}.sha256`), `${sha}  ${asset}\n`);
    console.log(`  ${sha}  ${asset}`);
  }
  await verifyLocalChecksums(assetsDir, assets);
}

async function verifyLocalChecksums(assetsDir, assets) {
  for (const asset of assets) {
    const sidecarPath = join(assetsDir, `${asset}.sha256`);
    if (!(await exists(sidecarPath))) {
      throw new Error(`missing checksum sidecar: ${sidecarPath}`);
    }
    const expected = parseSidecar(await readFile(sidecarPath, "utf8"), sidecarPath);
    const got = await localPayloadSha(assetsDir, asset);
    if (got !== expected) {
      throw new Error(
        `local checksum sidecar mismatch for ${asset}: expected ${expected}, got ${got}`,
      );
    }
  }
}

async function downloadToFile(urlString, dest) {
  const url = new URL(urlString);
  await mkdir(dirname(dest), { recursive: true });
  if (url.protocol === "file:") {
    await copyFile(fileURLToPath(url), dest);
    return;
  }

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`fetch failed: ${urlString}: ${res.status} ${res.statusText}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function fetchText(urlString) {
  const url = new URL(urlString);
  if (url.protocol === "file:") {
    return readFile(fileURLToPath(url), "utf8");
  }
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`fetch failed: ${urlString}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function verifyPublishedOnce({ baseUrl, assets, assetsDir, compareLocal }) {
  const tmp = await mkdtemp(join(tmpdir(), "machinen-release-assets-"));
  try {
    for (const asset of assets) {
      console.log(`verify ${asset}`);
      const sidecarUrl = assetUrl(baseUrl, `${asset}.sha256`);
      const payloadUrl = assetUrl(baseUrl, asset);
      const remoteExpected = parseSidecar(await fetchText(sidecarUrl), sidecarUrl);

      let expected = remoteExpected;
      if (compareLocal) {
        const localSidecar = join(assetsDir, `${asset}.sha256`);
        const localExpected = parseSidecar(await readFile(localSidecar, "utf8"), localSidecar);
        const localGot = await localPayloadSha(assetsDir, asset);
        if (localGot !== localExpected) {
          throw new Error(
            `local checksum sidecar mismatch for ${asset}: expected ${localExpected}, got ${localGot}`,
          );
        }
        if (remoteExpected !== localExpected) {
          throw new Error(
            `published checksum sidecar mismatch for ${asset}: expected ${localExpected}, got ${remoteExpected}`,
          );
        }
        expected = localExpected;
      }

      const downloaded = join(tmp, asset.replace(/[/:]/g, "_"));
      await downloadToFile(payloadUrl, downloaded);
      const got = await sha256File(downloaded);
      if (got !== expected) {
        throw new Error(`checksum mismatch for ${asset}: expected ${expected}, got ${got}`);
      }
      console.log(`  ok ${asset} ${got}`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function verifyPublished(opts) {
  let lastError;
  for (let attempt = 1; attempt <= opts.tries; attempt++) {
    try {
      await verifyPublishedOnce(opts);
      console.log(`release-assets: verified ${opts.assets.length} asset(s) for ${opts.tag}`);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < opts.tries) {
        console.error(
          `release-assets: verification attempt ${attempt}/${opts.tries} failed: ${err.message}`,
        );
        await new Promise((resolveSleep) =>
          setTimeout(resolveSleep, Math.round(opts.sleepSeconds * 1000)),
        );
      }
    }
  }
  throw new Error(
    `release-assets: verification failed after ${opts.tries} attempt(s): ${lastError?.message}`,
  );
}

function runGh(args, { allowFailure = false } = {}) {
  const result = spawnSync("gh", args, {
    cwd: REPO_ROOT,
    stdio: allowFailure ? "ignore" : "inherit",
    env: process.env,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.status ?? 1;
}

async function uploadList(assetsDir, assets) {
  const files = [];
  for (const asset of assets) {
    files.push(join(assetsDir, asset), join(assetsDir, `${asset}.sha256`));
  }
  for (const asset of OPTIONAL_UPLOAD_ASSETS) {
    const path = join(assetsDir, asset);
    if (await exists(path)) {
      files.push(path);
    }
  }
  return files;
}

async function publish(opts) {
  await rewriteChecksums(opts.assetsDir, opts.assets);
  const files = await uploadList(opts.assetsDir, opts.assets);

  console.log(`publish ${opts.tag} -> ${opts.repo}`);
  for (const file of files) {
    console.log(`  upload ${basename(file)}`);
  }
  if (opts.dryRun) {
    console.log("dry-run: not creating or uploading release assets");
    return;
  }

  if (runGh(["release", "view", opts.tag, "--repo", opts.repo], { allowFailure: true }) !== 0) {
    runGh([
      "release",
      "create",
      opts.tag,
      "--repo",
      opts.repo,
      "--title",
      opts.tag,
      "--notes",
      `Base assets for @machinen/runtime@${opts.tag.replace(/^runtime-v/, "")}.`,
    ]);
  }
  runGh(["release", "upload", opts.tag, "--repo", opts.repo, ...files, "--clobber"]);

  await verifyPublished(opts);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  opts.tag ??= await defaultTag();
  opts.baseUrl ??= releaseBaseUrl(opts.repo, opts.tag);

  if (opts.command === "checksums") {
    await rewriteChecksums(opts.assetsDir, opts.assets);
  } else if (opts.command === "verify") {
    await verifyPublished(opts);
  } else {
    await publish(opts);
  }
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
