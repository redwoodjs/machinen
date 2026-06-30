import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type MountDiskUpperSizeResult = NativeBootPlanResult & { mountDiskUpperSizeBytes: number };

export const planMountDiskUpperSizeNative = defineBootPlanProjection<
  number | undefined,
  number,
  MountDiskUpperSizeResult
>({
  errorCode: "BOOT_MOUNT_INVALID",
  makeError: bootPlanError,
  data: (sizeBytes) => ({
    mountDiskUpperSizeOption: sizeBytes === undefined ? null : String(sizeBytes),
  }),
  output: (plan) => plan.mountDiskUpperSizeBytes,
  isData: isMountDiskUpperSizeResult,
});

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

function bootPlanError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}
