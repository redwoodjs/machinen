import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type BootScratchMode } from "./boot-plan-schema.ts";

export function planBootScratchModeNative(snapshot: string | false | undefined): BootScratchMode {
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
      scratchOptionFalse: snapshot === false,
      scratchOptionPath: typeof snapshot === "string" ? snapshot : null,
    },
    errorCode: "BOOT_VMM_MISSING",
    makeError: scratchModePlanError,
    isData: isNativeBootPlanResult,
  });
  return plan.plannedScratchMode;
}

const scratchModePlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new BootError(code, message, opts);
