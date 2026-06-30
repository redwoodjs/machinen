import { ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";

interface RootfsCacheKeyData {
  sha: string;
  source: "sidecar" | "file";
}

interface RootfsMaterializeRequest {
  tarAbs: string;
  cacheDir: string;
  sha: string;
  imgPath: string;
  mke2fs: string;
  sizeMultiplier?: number;
  minSizeBytes?: number;
  sizeBytes?: number;
}

interface RootfsMaterializeData {
  imgPath: string;
  sizeBytes: number;
  phases: {
    stagingCreate: number;
    tarExtract: number;
    size: number;
    sparseAllocate: number;
    mke2fs: number;
    rename: number;
    stagingCleanup: number;
  };
}

interface RootfsPrebakeDecompressRequest {
  path: string;
  dst: string;
  format: "gz" | "zst";
}

interface RootfsPrebakeDecompressData {
  ok: boolean;
  sha256?: string;
}

interface RootfsPrebakeTreeRequest {
  tarPath: string;
  treeDir: string;
  cacheDir: string;
  mke2fs: string;
}

interface RootfsPrebakeTreeData {
  ok: boolean;
  skipped?: boolean;
  sha?: string;
  imgPath?: string;
  sizeBytes?: number;
  phases: {
    sha256: number;
    mke2fs: number;
  };
}

export function rootfsCacheKeyNative(tar: string): RootfsCacheKeyData {
  return callRuntimeHelper({
    command: "rootfs-cache-key",
    data: { tar },
    errorCode: "PROVISION_BASE_NOT_FOUND",
    makeError: rootfsError,
    isData: isRootfsCacheKeyData,
  });
}

export function rootfsMaterializeNative(request: RootfsMaterializeRequest): RootfsMaterializeData {
  return callRuntimeHelper({
    command: "rootfs-materialize",
    data: request,
    errorCode: "PROVISION_INSTALL_HOOK_FAILED",
    makeError: rootfsError,
    isData: isRootfsMaterializeData,
  });
}

export function rootfsPrebakeDecompressNative(
  request: RootfsPrebakeDecompressRequest,
): RootfsPrebakeDecompressData {
  return callRuntimeHelper({
    command: "rootfs-prebake-decompress",
    data: request,
    errorCode: "PROVISION_INSTALL_HOOK_FAILED",
    makeError: rootfsError,
    isData: isRootfsPrebakeDecompressData,
  });
}

export function rootfsPrebakeTreeNative(request: RootfsPrebakeTreeRequest): RootfsPrebakeTreeData {
  return callRuntimeHelper({
    command: "rootfs-prebake-tree",
    data: request,
    errorCode: "PROVISION_INSTALL_HOOK_FAILED",
    makeError: rootfsError,
    isData: isRootfsPrebakeTreeData,
  });
}

function rootfsError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new ProvisionError(code, message, opts);
}

function isRootfsCacheKeyData(value: unknown): value is RootfsCacheKeyData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<RootfsCacheKeyData>;
  return (
    /^[0-9a-f]{64}$/.test(data.sha ?? "") && (data.source === "sidecar" || data.source === "file")
  );
}

function isRootfsMaterializeData(value: unknown): value is RootfsMaterializeData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<RootfsMaterializeData>;
  return (
    typeof data.imgPath === "string" &&
    typeof data.sizeBytes === "number" &&
    Number.isFinite(data.sizeBytes) &&
    isMaterializePhases(data.phases)
  );
}

function isRootfsPrebakeDecompressData(value: unknown): value is RootfsPrebakeDecompressData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<RootfsPrebakeDecompressData>;
  return (
    typeof data.ok === "boolean" &&
    (data.sha256 === undefined || /^[0-9a-f]{64}$/.test(data.sha256))
  );
}

function isRootfsPrebakeTreeData(value: unknown): value is RootfsPrebakeTreeData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<RootfsPrebakeTreeData>;
  return (
    typeof data.ok === "boolean" &&
    optionalBoolean(data.skipped) &&
    optionalSha(data.sha) &&
    optionalString(data.imgPath) &&
    optionalFiniteNumber(data.sizeBytes) &&
    isPrebakeTreePhases(data.phases)
  );
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function optionalSha(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^[0-9a-f]{64}$/.test(value));
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isPrebakeTreePhases(value: unknown): value is RootfsPrebakeTreeData["phases"] {
  if (!value || typeof value !== "object") {
    return false;
  }
  const phases = value as Partial<RootfsPrebakeTreeData["phases"]>;
  return isFiniteNumber(phases.sha256) && isFiniteNumber(phases.mke2fs);
}

const MATERIALIZE_PHASES = [
  "stagingCreate",
  "tarExtract",
  "size",
  "sparseAllocate",
  "mke2fs",
  "rename",
  "stagingCleanup",
] as const;

function isMaterializePhases(value: unknown): value is RootfsMaterializeData["phases"] {
  if (!value || typeof value !== "object") {
    return false;
  }
  const phases = value as Partial<Record<(typeof MATERIALIZE_PHASES)[number], unknown>>;
  return MATERIALIZE_PHASES.every((name) => isFiniteNumber(phases[name]));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
