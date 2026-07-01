import { existsSync, readFileSync } from "node:fs";
import { arch as osArch, homedir } from "node:os";
import { join, resolve } from "node:path";

import { ProvisionError } from "./errors.ts";
import { planProvisionAssetsForHostNative } from "./native/boot-plan.ts";
import { planProvisionAssetLookupNative } from "./native/provision-asset-lookup.ts";
import { planProvisionCliCacheNative } from "./native/provision-cli-cache.ts";
import { planProvisionDtbNative } from "./native/provision-dtb.ts";

/**
 * Resolve the path to the base rootfs tarball. Fallback chain:
 * explicit → `MACHINEN_ASSETS_DIR/<arch rootfs>` → `@machinen/cli`
 * cache at `<base>/rootfs.tar.gz`.
 *
 * @throws {ProvisionError} PROVISION_BASE_NOT_FOUND |
 *   PROVISION_ASSETS_DIR_INVALID
 */
export function resolveBaseRootfs(explicit?: string, cwd: string = process.cwd()): string {
  const spec = baseAssetSpec();
  return resolveBaseAsset(
    {
      kind: "base rootfs",
      param: "base",
      assetsDirName: spec.rootfsAsset,
      cliCacheName: "rootfs.tar.gz",
      missingCode: "PROVISION_BASE_NOT_FOUND",
    },
    explicit,
    cwd,
  );
}

/**
 * Resolve the path to the guest kernel image. Same fallback chain as
 * `resolveBaseRootfs`: explicit → `MACHINEN_ASSETS_DIR/<arch kernel>` →
 * `@machinen/cli` cache at `<base>/Image`.
 *
 * @throws {ProvisionError} PROVISION_KERNEL_NOT_FOUND |
 *   PROVISION_ASSETS_DIR_INVALID
 */
export function resolveBaseKernel(explicit?: string, cwd: string = process.cwd()): string {
  const spec = baseAssetSpec();
  return resolveBaseAsset(
    {
      kind: "kernel image",
      param: "kernel",
      assetsDirName: spec.kernelAsset,
      cliCacheName: "Image",
      missingCode: "PROVISION_KERNEL_NOT_FOUND",
    },
    explicit,
    cwd,
  );
}

/**
 * Resolve the path to the guest DTB. amd64 guests do not use a DTB unless
 * the caller passes one explicitly. arm64 follows the same fallback chain as
 * `resolveBaseRootfs`: explicit → `MACHINEN_ASSETS_DIR/virt-arm64.dtb` →
 * `@machinen/cli` cache at `<base>/virt.dtb`.
 *
 * @throws {ProvisionError} PROVISION_DTB_NOT_FOUND |
 *   PROVISION_ASSETS_DIR_INVALID
 */
export function resolveBaseDtb(explicit?: string, cwd: string = process.cwd()): string | undefined {
  if (explicit) {
    return resolveBaseAsset(
      {
        kind: "device tree blob",
        param: "dtb",
        assetsDirName: "virt-arm64.dtb",
        cliCacheName: "virt.dtb",
        missingCode: "PROVISION_DTB_NOT_FOUND",
      },
      explicit,
      cwd,
    );
  }

  const plan = planProvisionDtbNative({
    guestArchOverride: process.env.MACHINEN_GUEST_ARCH,
    hostArch: osArch(),
  });
  if (!plan.required) {
    return undefined;
  }
  return resolveBaseAsset(
    {
      kind: "device tree blob",
      param: "dtb",
      assetsDirName: plan.asset ?? "virt-arm64.dtb",
      cliCacheName: plan.cliCacheName ?? "virt.dtb",
      missingCode: "PROVISION_DTB_NOT_FOUND",
    },
    undefined,
    cwd,
  );
}

type GuestCpu = "arm64" | "amd64";

function baseAssetSpec(): {
  cpu: GuestCpu;
  kernelAsset: string;
  dtbAsset?: string;
  rootfsAsset: string;
} {
  const plan = planProvisionAssetsForHostNative({
    guestArchOverride: process.env.MACHINEN_GUEST_ARCH,
    hostArch: osArch(),
  });
  return {
    cpu: plan.cpu,
    kernelAsset: plan.kernelAsset,
    ...(plan.dtbAsset ? { dtbAsset: plan.dtbAsset } : {}),
    rootfsAsset: plan.rootfsAsset,
  };
}

interface BaseAssetSpec {
  kind: string;
  param: string;
  assetsDirName: string;
  cliCacheName: string;
  missingCode:
    | "PROVISION_BASE_NOT_FOUND"
    | "PROVISION_KERNEL_NOT_FOUND"
    | "PROVISION_DTB_NOT_FOUND";
}

function resolveBaseAsset(spec: BaseAssetSpec, explicit: string | undefined, cwd: string): string {
  const lookup = provisionAssetLookupRequest(spec, explicit, cwd);
  const plan = planProvisionAssetLookupNative(lookup);
  return resolvedProvisionAssetPath(spec, lookup, plan);
}

interface ProvisionAssetLookupRequest {
  explicitPath?: string;
  explicitExists?: boolean;
  assetsDir?: string;
  assetsDirPath?: string;
  assetsDirExists?: boolean;
  cachePath?: string;
  cacheExists?: boolean;
}

function provisionAssetLookupRequest(
  spec: BaseAssetSpec,
  explicit: string | undefined,
  cwd: string,
): ProvisionAssetLookupRequest {
  const explicitPath = explicit ? resolve(cwd, explicit) : undefined;
  const assetsDir = process.env.MACHINEN_ASSETS_DIR;
  const assetsDirPath =
    !explicitPath && assetsDir ? resolve(assetsDir, spec.assetsDirName) : undefined;
  const cachePath =
    !explicitPath && !assetsDirPath ? join(cliCachedBaseDir(), spec.cliCacheName) : undefined;
  return {
    explicitPath,
    explicitExists: explicitPath ? existsSync(explicitPath) : undefined,
    assetsDir,
    assetsDirPath,
    assetsDirExists: assetsDirPath ? existsSync(assetsDirPath) : undefined,
    cachePath,
    cacheExists: cachePath ? existsSync(cachePath) : undefined,
  };
}

function resolvedProvisionAssetPath(
  spec: BaseAssetSpec,
  lookup: ProvisionAssetLookupRequest,
  plan: ReturnType<typeof planProvisionAssetLookupNative>,
): string {
  if (plan.path) {
    return plan.path;
  }
  if (plan.error === "assets-dir-invalid") {
    throw new ProvisionError(
      "PROVISION_ASSETS_DIR_INVALID",
      `MACHINEN_ASSETS_DIR=${lookup.assetsDir} does not contain ${spec.assetsDirName}`,
    );
  }
  throw missingProvisionAssetError(spec, lookup);
}

function missingProvisionAssetError(
  spec: BaseAssetSpec,
  lookup: ProvisionAssetLookupRequest,
): ProvisionError {
  if (lookup.explicitPath) {
    return new ProvisionError(spec.missingCode, `${spec.kind} not found: ${lookup.explicitPath}`);
  }
  const missingPath = lookup.cachePath ?? join(cliCachedBaseDir(), spec.cliCacheName);
  return new ProvisionError(
    spec.missingCode,
    `${spec.kind} not found. Either:\n` +
      `  - pass \`${spec.param}\` explicitly, or\n` +
      `  - set MACHINEN_ASSETS_DIR to a directory containing ${spec.assetsDirName}, or\n` +
      `  - install @machinen/cli and run it once to populate ${missingPath}`,
  );
}

function cliCachedBaseDir(): string {
  // Mirrors `@machinen/cli`'s `baseDirFor(RELEASE_TAG)` where
  // RELEASE_TAG = `runtime-v${VERSION}`.
  const pkgPath = resolve(import.meta.dirname, "..", "package.json");
  const version = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;
  const plan = planProvisionCliCacheNative({
    homeDir: homedir(),
    version,
    guestArchOverride: process.env.MACHINEN_GUEST_ARCH,
    hostArch: osArch(),
  });
  if (!plan.baseDir) {
    throw new ProvisionError(
      "PROVISION_BASE_NOT_FOUND",
      "provision native planner returned missing cli cache base dir",
    );
  }
  return plan.baseDir;
}
