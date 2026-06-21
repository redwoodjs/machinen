import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult } from "./boot-plan-schema.ts";

type ScratchModePlan = "false" | "path" | "auto";

export function planBootScratchModeNative(snapshot: string | false | undefined): ScratchModePlan {
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
      scratchOptionFalse: snapshot === false,
      scratchOptionPath: typeof snapshot === "string" ? snapshot : null,
    },
    errorCode: "BOOT_VMM_MISSING",
    makeError: scratchModePlanError,
    isData: isNativeBootPlanResult,
  });
  return plan.plannedScratchMode === "unset" ? "auto" : plan.plannedScratchMode;
}

const scratchModePlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new BootError(code, message, opts);
