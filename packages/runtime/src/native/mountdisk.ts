import { BootError, ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";

interface EnsureMountDiskImageNativeRequest {
  host: string;
  cacheDir: string;
  force?: boolean;
  mksquashfsCandidates?: string[];
  mksquashfsEnvOverride?: string;
}

interface EnsureMountDiskImageNativeData {
  lowerPath: string;
  key: string;
  cacheHit: boolean;
  phases: {
    manifestHash: number;
    mksquashfs: number;
    stagingRename: number;
  };
}

interface EnsureMountDiskUpperNativeRequest {
  tmpDir: string;
  sizeBytes: number;
  mke2fs: string;
}

interface EnsureMountDiskUpperNativeData {
  upperPath: string;
  sizeBytes: number;
}

export function ensureMountDiskImageNative(
  request: EnsureMountDiskImageNativeRequest,
): EnsureMountDiskImageNativeData {
  return callRuntimeHelper({
    command: "mountdisk-image",
    data: request,
    errorCode: "BOOT_MOUNTDISK_TOOL_MISSING",
    makeError: mountdiskError,
    isData: isEnsureMountDiskImageNativeData,
  });
}

export function ensureMountDiskUpperNative(
  request: EnsureMountDiskUpperNativeRequest,
): EnsureMountDiskUpperNativeData {
  return callRuntimeHelper({
    command: "mountdisk-upper",
    data: request,
    errorCode: "BOOT_MOUNTDISK_TOOL_MISSING",
    makeError: mountdiskError,
    isData: isEnsureMountDiskUpperNativeData,
  });
}

function mountdiskError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  if (code === "PROVISION_INSTALL_HOOK_FAILED") {
    return new ProvisionError(code, message, opts);
  }
  return new BootError(code, message, opts);
}

function isEnsureMountDiskImageNativeData(value: unknown): value is EnsureMountDiskImageNativeData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<EnsureMountDiskImageNativeData>;
  return (
    typeof data.lowerPath === "string" &&
    /^[0-9a-f]{64}$/.test(data.key ?? "") &&
    typeof data.cacheHit === "boolean" &&
    isPhases(data.phases)
  );
}

function isPhases(value: unknown): value is EnsureMountDiskImageNativeData["phases"] {
  if (!value || typeof value !== "object") {
    return false;
  }
  const phases = value as Partial<EnsureMountDiskImageNativeData["phases"]>;
  return (
    typeof phases.manifestHash === "number" &&
    Number.isFinite(phases.manifestHash) &&
    typeof phases.mksquashfs === "number" &&
    Number.isFinite(phases.mksquashfs) &&
    typeof phases.stagingRename === "number" &&
    Number.isFinite(phases.stagingRename)
  );
}

function isEnsureMountDiskUpperNativeData(value: unknown): value is EnsureMountDiskUpperNativeData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<EnsureMountDiskUpperNativeData>;
  return (
    typeof data.upperPath === "string" &&
    typeof data.sizeBytes === "number" &&
    Number.isFinite(data.sizeBytes)
  );
}
