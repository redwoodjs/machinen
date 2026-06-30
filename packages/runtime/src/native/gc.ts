import { RegistryError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { defineRuntimeCommandWithArgs } from "./runtime-command.ts";

interface CleanupPathResult {
  removed: boolean;
  failed: boolean;
}

export const cleanupPathNative = defineRuntimeCommandWithArgs<
  [path: string, dryRun: boolean],
  CleanupPathResult
>({
  command: "cleanup-path",
  errorCode: "REGISTRY_VM_NOT_FOUND",
  data: (path, dryRun) => ({ path, dryRun }),
  makeError: cleanupPathError,
  isData: isCleanupPathResult,
});

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
