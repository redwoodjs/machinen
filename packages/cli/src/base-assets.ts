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
import { pipeline } from "node:stream/promises";

import pkg from "../package.json" with { type: "json" };
import { die } from "./errors.ts";
import { isQuiet } from "./quiet.ts";

export const VERSION = pkg.version;
export const RELEASE_TAG = `runtime-v${VERSION}`;

const ASSETS_BASE_URL = "https://github.com/redwoodjs/machinen.dev/releases/download";
const CACHE_ROOT = join(homedir(), ".machinen");

export function cacheDirFor(tag: string): string {
  return join(CACHE_ROOT, tag);
}

export type GuestCpu = "arm64" | "amd64";

type BaseAssetSpec = {
  cpu: GuestCpu;
  kernelAsset: string;
  dtbAsset?: string;
  rootfsAsset: string;
};

export interface CliBaseAssetPaths {
  kernelPath: string;
  dtbPath?: string;
  defaultImagePath: string;
  baseDir: string;
}

export function guestCpu(): GuestCpu {
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
      }
    : {
        cpu: "arm64",
        kernelAsset: "Image-arm64",
        dtbAsset: "virt-arm64.dtb",
        rootfsAsset: "rootfs-debian-arm64.tar.gz",
      };
}

function baseDirFor(tag: string, distro = "debian", cpu = guestCpu()): string {
  return join(cacheDirFor(tag), "bases", `${distro}-${cpu}`);
}

export function baseAssetsComplete(tag: string): boolean {
  const spec = baseAssetSpec();
  const base = baseDirFor(tag, "debian", spec.cpu);
  return (
    existsSync(join(base, "Image")) &&
    (!spec.dtbAsset || existsSync(join(base, "virt.dtb"))) &&
    existsSync(join(base, "rootfs.tar.gz"))
  );
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

export async function ensureBaseAssets(tag: string): Promise<string> {
  const spec = baseAssetSpec();
  const base = baseDirFor(tag, "debian", spec.cpu);
  if (cachedBaseAssetsReady(base, spec)) {
    return base;
  }

  mkdirSync(base, { recursive: true });
  await downloadBaseAssets(tag, base, spec);
  replaceCurrentBaseSymlink(tag);
  return base;
}

function cachedBaseAssetsReady(base: string, spec: BaseAssetSpec): boolean {
  if (!existsSync(join(base, "Image"))) {
    return false;
  }
  if (spec.dtbAsset && !existsSync(join(base, "virt.dtb"))) {
    return false;
  }
  return existsSync(join(base, "rootfs.tar.gz"));
}

async function downloadBaseAssets(tag: string, base: string, spec: BaseAssetSpec): Promise<void> {
  await Promise.all(
    baseAssetDownloads(base, spec).map((a) => downloadWithChecksum(a.name, a.dest, tag)),
  );
}

function baseAssetDownloads(
  base: string,
  spec: BaseAssetSpec,
): Array<{ name: string; dest: string }> {
  const assets = [{ name: spec.kernelAsset, dest: join(base, "Image") }];
  if (spec.dtbAsset) {
    assets.push({ name: spec.dtbAsset, dest: join(base, "virt.dtb") });
  }
  assets.push({ name: spec.rootfsAsset, dest: join(base, "rootfs.tar.gz") });
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

async function downloadWithChecksum(asset: string, dest: string, tag: string): Promise<void> {
  const tmp = `${dest}.partial`;
  if (!isQuiet()) {
    process.stderr.write(`  fetch ${asset}\n`);
  }
  await downloadAsset(asset, tmp, tag);

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

async function downloadAsset(name: string, dest: string, tag: string): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true });
  const url = assetUrl(name, tag);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    die(
      `fetch asset ${name} failed: ${res.status} ${res.statusText}\n` +
        `  url: ${url}\n` +
        "  check that the release tag exists on github.com/redwoodjs/machinen.dev.",
    );
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
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

export function sha256Bytes(bytes: Buffer | string): string {
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
