import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

const validateLiveMountRemovedOptionsCommand = defineBootPlanProjection<
  { hasCache: boolean; hasSync: boolean; index: number },
  void
>({
  errorCode: "BOOT_MOUNT_INVALID",
  makeError: bootPlanError,
  data: (input) => ({
    liveMountRemovedOptionIndex: String(input.index),
    liveMountRemovedOptionHasCache: input.hasCache,
    liveMountRemovedOptionHasSync: input.hasSync,
  }),
  output: () => undefined,
});

export function validateLiveMountRemovedOptionsNative(mount: object, index: number): void {
  const hasCache = "cache" in mount;
  const hasSync = "sync" in mount;
  if (hasCache || hasSync) {
    validateLiveMountRemovedOptionsCommand({ hasCache, hasSync, index });
  }
}

function bootPlanError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}
