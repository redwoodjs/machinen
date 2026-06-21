import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";

type MountDiskUpperSizeResult = NativeBootPlanResult & { mountDiskUpperSizeBytes: number };

export function planMountDiskUpperSizeNative(sizeBytes: number | undefined): number {
  return callRuntimeHelper({
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
      mountDiskUpperSizeOption: sizeBytes === undefined ? null : String(sizeBytes),
    },
    errorCode: "BOOT_MOUNT_INVALID",
    makeError: bootPlanError,
    isData: isMountDiskUpperSizeResult,
  }).mountDiskUpperSizeBytes;
}

function isMountDiskUpperSizeResult(value: unknown): value is MountDiskUpperSizeResult {
  if (!isNativeBootPlanResult(value)) {
    return false;
  }
  const plan = value as unknown as { mountDiskUpperSizeBytes?: unknown };
  return (
    typeof plan.mountDiskUpperSizeBytes === "number" &&
    Number.isFinite(plan.mountDiskUpperSizeBytes)
  );
}

const bootPlanError = (code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error =>
  new BootError(code, message, opts);
