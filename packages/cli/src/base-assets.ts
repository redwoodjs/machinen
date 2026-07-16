import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { arch as osArch, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import pkg from "../package.json" with { type: "json" };
import { DownloadProgress } from "./download-progress.ts";
import { die } from "./errors.ts";
import { isQuiet } from "./quiet.ts";

export const VERSION = pkg.version;
export const RELEASE_TAG = `runtime-v${VERSION}`;

const ASSETS_BASE_URL = "https://github.com/redwoodjs/machinen/releases/download";
const CACHE_ROOT = join(homedir(), ".machinen");

export function cacheDirFor(tag: string): string {
  return join(CACHE_ROOT, tag);
}

type GuestCpu = "arm64" | "amd64";

type BaseAssetSpec = {
  cpu: GuestCpu;
  kernelAsset: string;
  dtbAsset?: string;
  rootfsAsset: string;
  rootfsPrebakeGzAsset: string;
  rootfsPrebakeZstAsset: string;
};

export interface CliBaseAssetPaths {
  kernelPath: string;
  dtbPath?: string;
  defaultImagePath: string;
  baseDir: string;
}

function guestCpu(): GuestCpu {
  const override = process.env.MACHINEN_GUEST_ARCH;
  if (override === "arm64" || override === "amd64") {
    return override;
  }
  return osArch() === "x64" ? "amd64" : "arm64";
}

function baseAssetSpec(): BaseAssetSpec {
  return guestCpu() === "amd64"
    ? {
        cpu: "amd64",
        kernelAsset: "bzImage-x86_64",
        rootfsAsset: "rootfs-debian-amd64.tar.gz",
        rootfsPrebakeGzAsset: "rootfs-debian-amd64.img.gz",
        rootfsPrebakeZstAsset: "rootfs-debian-amd64.img.zst",
      }
    : {
        cpu: "arm64",
        kernelAsset: "Image-arm64",
        dtbAsset: "virt-arm64.dtb",
        rootfsAsset: "rootfs-debian-arm64.tar.gz",
        rootfsPrebakeGzAsset: "rootfs-debian-arm64.img.gz",
        rootfsPrebakeZstAsset: "rootfs-debian-arm64.img.zst",
      };
}

function baseDirFor(tag: string, distro = "debian", cpu = guestCpu()): string {
  return join(cacheDirFor(tag), "bases", `${distro}-${cpu}`);
}

export function baseAssetsComplete(tag: string): boolean {
  const spec = baseAssetSpec();
  const base = baseDirFor(tag, "debian", spec.cpu);
  return cachedBaseAssetFiles(spec).every((file) => existsSync(join(base, file)));
}

function cachedBaseAssetFiles(spec: BaseAssetSpec): string[] {
  return [
    "Image",
    ...(spec.dtbAsset ? ["virt.dtb"] : []),
    "rootfs.tar.gz",
    "rootfs.img.gz",
    "rootfs.img.zst",
  ];
}

function validateAssetsDir(dir: string): void {
  const abs = resolve(dir);
  if (!existsSync(abs)) {
    die(`MACHINEN_ASSETS_DIR=${dir} does not exist`);
  }
  const spec = baseAssetSpec();
  const required = [spec.kernelAsset, spec.rootfsAsset, ...(spec.dtbAsset ? [spec.dtbAsset] : [])];
  const missing = required.filter((f) => !existsSync(join(abs, f)));
  if (missing.length > 0) {
    die(
      `MACHINEN_ASSETS_DIR=${dir} is missing for ${spec.cpu}: ${missing.join(", ")}\n` +
        `  Produce them with ./scripts/build-base-assets.sh (outputs to ./release-assets/).`,
    );
  }
}

export async function ensureBaseAssets(
  tag: string,
  opts: { progress?: boolean } = {},
): Promise<string> {
  const spec = baseAssetSpec();
  const base = baseDirFor(tag, "debian", spec.cpu);
  if (cachedBaseAssetsReady(base, spec)) {
    return base;
  }

  mkdirSync(base, { recursive: true });
  await downloadBaseAssets(tag, base, spec, opts.progress !== false);
  replaceCurrentBaseSymlink(tag);
  return base;
}

function cachedBaseAssetsReady(base: string, spec: BaseAssetSpec): boolean {
  return cachedBaseAssetFiles(spec).every((file) => existsSync(join(base, file)));
}

async function downloadBaseAssets(
  tag: string,
  base: string,
  spec: BaseAssetSpec,
  reportProgress: boolean,
): Promise<void> {
  const downloads = baseAssetDownloads(base, spec);
  const progress = reportProgress ? new DownloadProgress(downloads.map(({ name }) => name)) : null;
  let success = false;
  try {
    await Promise.all(
      downloads.map((download) =>
        downloadWithChecksum(download.name, download.dest, tag, progress),
      ),
    );
    success = true;
  } finally {
    progress?.close(success);
  }
}

function baseAssetDownloads(
  base: string,
  spec: BaseAssetSpec,
): Array<{ name: string; dest: string }> {
  const assets = [{ name: spec.kernelAsset, dest: join(base, "Image") }];
  if (spec.dtbAsset) {
    assets.push({ name: spec.dtbAsset, dest: join(base, "virt.dtb") });
  }
  assets.push(
    { name: spec.rootfsAsset, dest: join(base, "rootfs.tar.gz") },
    { name: spec.rootfsPrebakeGzAsset, dest: join(base, "rootfs.img.gz") },
    { name: spec.rootfsPrebakeZstAsset, dest: join(base, "rootfs.img.zst") },
  );
  return assets;
}

function replaceCurrentBaseSymlink(tag: string): void {
  const current = join(CACHE_ROOT, "current");
  try {
    unlinkCurrentSymlink(current);
  } catch {}
  symlinkSync(tag, current, "dir");
}

function unlinkCurrentSymlink(current: string): void {
  if (existsSync(current) || isSymlink(current)) {
    unlinkSync(current);
  }
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

async function downloadWithChecksum(
  asset: string,
  dest: string,
  tag: string,
  progress: DownloadProgress | null,
): Promise<void> {
  const tmp = `${dest}.partial`;
  if (!isQuiet()) {
    process.stderr.write(`  fetch ${asset}\n`);
  }
  await downloadAsset(asset, tmp, tag, progress);

  const sha = (await fetchAssetText(`${asset}.sha256`, tag)).trim().split(/\s+/)[0];
  const got = sha256OfFile(tmp);
  if (sha && got !== sha) {
    unlinkSync(tmp);
    die(`checksum mismatch for ${asset}: expected ${sha}, got ${got}`);
  }
  renameSync(tmp, dest);
}

function assetUrl(name: string, tag: string): string {
  return `${ASSETS_BASE_URL}/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

async function downloadAsset(
  name: string,
  dest: string,
  tag: string,
  progress: DownloadProgress | null,
): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true });
  const url = assetUrl(name, tag);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    die(
      `fetch asset ${name} failed: ${res.status} ${res.statusText}\n` +
        `  url: ${url}\n` +
        "  check that the release tag exists on github.com/redwoodjs/machinen.",
    );
  }
  progress?.beginAsset(name, responseContentLength(res));
  const countBytes = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      progress?.addBytes(name, chunk.byteLength);
      callback(null, chunk);
    },
  });
  await pipeline(res.body as unknown as NodeJS.ReadableStream, countBytes, createWriteStream(dest));
  progress?.finishAsset(name);
}

function responseContentLength(response: Response): number | undefined {
  const value = response.headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) {
    return undefined;
  }
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

async function fetchAssetText(name: string, tag: string): Promise<string> {
  const url = assetUrl(name, tag);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    die(`fetch asset ${name} failed: ${res.status} ${res.statusText}\n  url: ${url}`);
  }
  return res.text();
}

function sha256OfFile(path: string): string {
  return sha256Bytes(readFileSync(path));
}

function sha256Bytes(bytes: Buffer | string): string {
  const hash = createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}

export async function resolveCliBaseAssets(): Promise<CliBaseAssetPaths> {
  const assetsOverride = process.env.MACHINEN_ASSETS_DIR;
  if (assetsOverride) {
    validateAssetsDir(assetsOverride);
  } else if (!baseAssetsComplete(RELEASE_TAG)) {
    process.stderr.write(`machinen: fetching base assets for ${RELEASE_TAG} (first run)\n`);
    await ensureBaseAssets(RELEASE_TAG);
  }
  return cliBaseAssetPaths(assetsOverride);
}

function cliBaseAssetPaths(assetsOverride: string | undefined): CliBaseAssetPaths {
  const spec = baseAssetSpec();
  const baseDir = cliBaseDir(assetsOverride, spec.cpu);
  return {
    baseDir,
    kernelPath: cliKernelPath(baseDir, assetsOverride, spec),
    dtbPath: cliDtbPath(baseDir, assetsOverride, spec),
    defaultImagePath: cliRootfsPath(baseDir, assetsOverride, spec),
  };
}

function cliBaseDir(assetsOverride: string | undefined, cpu: GuestCpu): string {
  if (assetsOverride) {
    return resolve(assetsOverride);
  }
  return baseDirFor(RELEASE_TAG, "debian", cpu);
}

function cliKernelPath(
  baseDir: string,
  assetsOverride: string | undefined,
  spec: BaseAssetSpec,
): string {
  return join(baseDir, assetsOverride ? spec.kernelAsset : "Image");
}

function cliDtbPath(
  baseDir: string,
  assetsOverride: string | undefined,
  spec: BaseAssetSpec,
): string | undefined {
  if (!spec.dtbAsset) {
    return undefined;
  }
  return join(baseDir, assetsOverride ? spec.dtbAsset : "virt.dtb");
}

function cliRootfsPath(
  baseDir: string,
  assetsOverride: string | undefined,
  spec: BaseAssetSpec,
): string {
  return join(baseDir, assetsOverride ? spec.rootfsAsset : "rootfs.tar.gz");
}

export function deriveBootName(imageOverride: string | undefined): string {
  if (!imageOverride) {
    return "vm";
  }
  const base = imageOverride.split("/").pop() ?? imageOverride;
  return base
    .replace(/\.tar\.gz$/i, "")
    .replace(/\.tgz$/i, "")
    .replace(/\.tar$/i, "")
    .replace(/\.gz$/i, "");
}

export function resolveOptionalImageOverride(
  imageOverride: string | undefined,
): string | undefined {
  if (!imageOverride) {
    return undefined;
  }
  const imagePath = resolve(imageOverride);
  if (!existsSync(imagePath)) {
    die(`--image: file not found: ${imagePath}`);
  }
  return imagePath;
}
