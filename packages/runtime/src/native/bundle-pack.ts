import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type BundlePackPlan } from "./boot-plan-schema.ts";

export function planBootBundlePackNative(input: {
  useTiny: boolean;
  mountGuest?: string;
  restoreMountGuest?: string;
}): BundlePackPlan {
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
      bundlePackUseTiny: input.useTiny,
      bundlePackMountGuest: input.mountGuest ?? null,
      bundlePackRestoreMountGuest: input.restoreMountGuest ?? null,
    },
    errorCode: "BOOT_PACK_FAILED",
    makeError: bundlePackPlanError,
    isData: isNativeBootPlanResult,
  }).bundlePack;
}

const bundlePackPlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new BootError(code, message, opts);
