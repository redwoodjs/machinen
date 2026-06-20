import { RegistryError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";

interface CleanupPathResult {
  removed: boolean;
  failed: boolean;
}

export function cleanupPathNative(path: string, dryRun: boolean): CleanupPathResult {
  return callRuntimeHelper({
    command: "cleanup-path",
    data: { path, dryRun },
    errorCode: "REGISTRY_VM_NOT_FOUND",
    makeError: cleanupPathError,
    isData: isCleanupPathResult,
  });
}

function cleanupPathError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new RegistryError(code, message, opts);
}

function isCleanupPathResult(value: unknown): value is CleanupPathResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<CleanupPathResult>;
  return typeof data.removed === "boolean" && typeof data.failed === "boolean";
}
