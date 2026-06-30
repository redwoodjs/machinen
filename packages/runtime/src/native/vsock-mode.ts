import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type VsockModePlan } from "./boot-plan-schema.ts";

export function planBootVsockModeNative(existingSpec: string | undefined): VsockModePlan {
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
      existingVsockSpec: existingSpec ?? null,
    },
    isData: isNativeBootPlanResult,
  }).vsockMode;
}
