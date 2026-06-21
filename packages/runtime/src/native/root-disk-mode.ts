import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type BootRootDiskMode } from "./boot-plan-schema.ts";

export function planBootRootDiskModeNative(input: {
  rootDisk?: boolean | string;
  restorePath?: string;
}): BootRootDiskMode {
  const plan = callRuntimeHelper({
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
      rootDiskOptionFalse: input.rootDisk === false,
      rootDiskOptionTrue: input.rootDisk === true,
      rootDiskOptionPath: typeof input.rootDisk === "string" ? input.rootDisk : null,
      rootDiskRestorePath: input.restorePath ?? null,
    },
    errorCode: "BOOT_VMM_MISSING",
    makeError: rootDiskModePlanError,
    isData: isNativeBootPlanResult,
  });
  return plan.rootDiskMode;
}

const rootDiskModePlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new BootError(code, message, opts);
