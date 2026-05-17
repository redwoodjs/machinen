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

const RELEASE_COMMANDS = new Set(["publish", "verify", "checksums"]);
const RELEASE_VALUE_OPTIONS = new Map([
  ["--tag", (opts, value) => (opts.tag = value)],
  ["--repo", (opts, value) => (opts.repo = value)],
  ["--assets-dir", setAssetsDirOption],
  ["--base-url", (opts, value) => (opts.baseUrl = value)],
  ["--asset", (opts, value) => opts.assets.push(value)],
  ["--tries", (opts, value) => (opts.tries = Number(value))],
  ["--sleep", (opts, value) => (opts.sleepSeconds = Number(value))],
]);
const RELEASE_BARE_OPTIONS = new Map([["--dry-run", (opts) => (opts.dryRun = true)]]);

function parseArgs(argv) {
  const command = argv[0];
  const helpExitCode = releaseHelpExitCode(command);
  if (helpExitCode !== undefined) {
    usage(helpExitCode);
  }
  if (!RELEASE_COMMANDS.has(command)) {
    usage(2);
  }

  const opts = defaultReleaseOptions(command);
  parseReleaseOptions(argv.slice(1), opts);
  finalizeReleaseOptions(opts);
  return opts;
}

function releaseHelpExitCode(command) {
  if (!command) {
    return 2;
  }
  if (command === "-h") {
    return 0;
  }
  if (command === "--help") {
    return 0;
  }
  return undefined;
}

function defaultReleaseOptions(command) {
  const envAssetsDir = process.env.MACHINEN_RELEASE_ASSETS_DIR;
  return {
    command,
    repo: DEFAULT_REPO,
    assetsDir: releaseAssetsDir(envAssetsDir),
    compareLocal: shouldCompareLocalAssets(command, envAssetsDir),
    baseUrl: process.env.MACHINEN_RELEASE_ASSETS_BASE_URL,
    assets: [],
    tries: Number(process.env.MACHINEN_RELEASE_VERIFY_TRIES ?? 6),
    sleepSeconds: Number(process.env.MACHINEN_RELEASE_VERIFY_SLEEP ?? 10),
    dryRun: false,
  };
}

function releaseAssetsDir(envAssetsDir) {
  if (envAssetsDir) {
    return envAssetsDir;
  }
  return DEFAULT_ASSETS_DIR;
}

function shouldCompareLocalAssets(command, envAssetsDir) {
  if (command !== "verify") {
    return true;
  }
  return Boolean(envAssetsDir);
}

function parseReleaseOptions(args, opts) {
  for (let i = 0; i < args.length; i++) {
    const parsed = splitReleaseOption(args[i]);
    const valueHandler = RELEASE_VALUE_OPTIONS.get(parsed.key);
    if (valueHandler) {
      const { value, nextIndex } = releaseOptionValue(args, i, parsed);
      valueHandler(opts, value);
      i = nextIndex;
      continue;
    }
    if (runBareReleaseOption(opts, parsed)) {
      continue;
    }
    usage(2);
  }
}

function runBareReleaseOption(opts, parsed) {
  if (parsed.hasInlineValue) {
    return false;
  }
  const handler = RELEASE_BARE_OPTIONS.get(parsed.key);
  if (!handler) {
    return false;
  }
  handler(opts);
  return true;
}

function splitReleaseOption(arg) {
  const eq = arg?.indexOf("=") ?? -1;
  if (eq === -1) {
    return { key: arg, hasInlineValue: false, value: undefined };
  }
  return { key: arg.slice(0, eq), hasInlineValue: true, value: arg.slice(eq + 1) };
}

function releaseOptionValue(args, index, parsed) {
  if (parsed.hasInlineValue) {
    return { value: parsed.value, nextIndex: index };
  }
  const value = args[index + 1];
  if (!value) {
    usage(2);
  }
  return { value, nextIndex: index + 1 };
}

function setAssetsDirOption(opts, value) {
  opts.assetsDir = value;
  opts.compareLocal = true;
}

function finalizeReleaseOptions(opts) {
  opts.assetsDir = resolve(opts.assetsDir);
  opts.assets = releaseAssetsList(opts.assets);
  assertPositiveInteger(opts.tries, "--tries must be a positive integer");
  assertNonNegativeNumber(opts.sleepSeconds, "--sleep must be a non-negative number");
}

function releaseAssetsList(assets) {
  if (assets.length > 0) {
    return assets;
  }
  return [...PAYLOAD_ASSETS];
}

function assertPositiveInteger(value, message) {
  if (!Number.isInteger(value)) {
    throw new Error(message);
  }
  if (value < 1) {
    throw new Error(message);
  }
}

function assertNonNegativeNumber(value, message) {
  if (!Number.isFinite(value)) {
    throw new Error(message);
  }
  if (value < 0) {
    throw new Error(message);
  }
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
      await verifyPublishedAsset({ baseUrl, assetsDir, compareLocal, tmp, asset });
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function verifyPublishedAsset({ baseUrl, assetsDir, compareLocal, tmp, asset }) {
  console.log(`verify ${asset}`);
  const sidecarUrl = assetUrl(baseUrl, `${asset}.sha256`);
  const payloadUrl = assetUrl(baseUrl, asset);
  const remoteExpected = parseSidecar(await fetchText(sidecarUrl), sidecarUrl);
  const expected = await expectedPublishedChecksum({
    assetsDir,
    asset,
    compareLocal,
    remoteExpected,
  });
  const downloaded = join(tmp, asset.replace(/[/:]/g, "_"));

  await downloadToFile(payloadUrl, downloaded);
  const got = await sha256File(downloaded);
  assertChecksumMatch(got, expected, `checksum mismatch for ${asset}`);
  console.log(`  ok ${asset} ${got}`);
}

async function expectedPublishedChecksum({ assetsDir, asset, compareLocal, remoteExpected }) {
  if (!compareLocal) {
    return remoteExpected;
  }
  const localExpected = await verifiedLocalChecksum(assetsDir, asset);
  assertChecksumMatch(
    remoteExpected,
    localExpected,
    `published checksum sidecar mismatch for ${asset}`,
  );
  return localExpected;
}

async function verifiedLocalChecksum(assetsDir, asset) {
  const localSidecar = join(assetsDir, `${asset}.sha256`);
  const localExpected = parseSidecar(await readFile(localSidecar, "utf8"), localSidecar);
  const localGot = await localPayloadSha(assetsDir, asset);
  assertChecksumMatch(localGot, localExpected, `local checksum sidecar mismatch for ${asset}`);
  return localExpected;
}

function assertChecksumMatch(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function verifyPublished(opts) {
  let lastError;
  for (let attempt = 1; attempt <= opts.tries; attempt++) {
    const result = await verifyPublishedAttempt(opts, attempt);
    if (result.ok) {
      return;
    }
    lastError = result.error;
  }
  throw new Error(
    `release-assets: verification failed after ${opts.tries} attempt(s): ${lastError?.message}`,
  );
}

async function verifyPublishedAttempt(opts, attempt) {
  try {
    await verifyPublishedOnce(opts);
    console.log(`release-assets: verified ${opts.assets.length} asset(s) for ${opts.tag}`);
    return { ok: true };
  } catch (err) {
    await delayVerificationRetry(opts, attempt, err);
    return { ok: false, error: err };
  }
}

async function delayVerificationRetry(opts, attempt, err) {
  if (attempt >= opts.tries) {
    return;
  }
  console.error(
    `release-assets: verification attempt ${attempt}/${opts.tries} failed: ${err.message}`,
  );
  await new Promise((resolveSleep) =>
    setTimeout(resolveSleep, Math.round(opts.sleepSeconds * 1000)),
  );
}

function runGh(args, { allowFailure = false } = {}) {
  const result = spawnSync("gh", args, {
    cwd: REPO_ROOT,
    stdio: ghStdio(allowFailure),
    env: process.env,
  });
  assertGhSuccess(args, allowFailure, result.status);
  return exitStatus(result.status);
}

function ghStdio(allowFailure) {
  if (allowFailure) {
    return "ignore";
  }
  return "inherit";
}

function assertGhSuccess(args, allowFailure, status) {
  if (allowFailure) {
    return;
  }
  if (status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed with exit code ${status}`);
  }
}

function exitStatus(status) {
  if (status === null) {
    return 1;
  }
  return status;
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

const RELEASE_COMMAND_RUNNERS = new Map([
  ["checksums", runChecksumsCommand],
  ["verify", verifyPublished],
  ["publish", publish],
]);

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await fillReleaseDefaults(opts);
  await RELEASE_COMMAND_RUNNERS.get(opts.command)(opts);
}

async function fillReleaseDefaults(opts) {
  if (opts.tag === undefined) {
    opts.tag = await defaultTag();
  }
  if (opts.baseUrl === undefined) {
    opts.baseUrl = releaseBaseUrl(opts.repo, opts.tag);
  }
}

async function runChecksumsCommand(opts) {
  await rewriteChecksums(opts.assetsDir, opts.assets);
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
