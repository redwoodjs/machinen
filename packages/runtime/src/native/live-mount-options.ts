import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult } from "./boot-plan-schema.ts";

export function validateLiveMountRemovedOptionsNative(mount: object, index: number): void {
  const hasCache = "cache" in mount;
  const hasSync = "sync" in mount;
  if (!hasCache && !hasSync) {
    return;
  }
  callRuntimeHelper({
    command: "boot-plan",
    data: {
      memoryMib: null,
      resourcesMemory: null,
      autoMemoryMib: null,
      hostTotalBytes: null,
      vmmMemoryPreset: true,
      hasImage: false,
      hasCmd: false,
      rootDisk: "false",
      liveMountRemovedOptionIndex: String(index),
      liveMountRemovedOptionHasCache: hasCache,
      liveMountRemovedOptionHasSync: hasSync,
    },
    errorCode: "BOOT_MOUNT_INVALID",
    makeError: bootPlanError,
    isData: isNativeBootPlanResult,
  });
}

const bootPlanError = (code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error =>
  new BootError(code, message, opts);
