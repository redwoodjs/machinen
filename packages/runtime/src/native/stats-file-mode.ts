import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type StatsFileModePlan } from "./boot-plan-schema.ts";

export function planBootStatsFileModeNative(existingPath: string | undefined): StatsFileModePlan {
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
      existingStatsFile: existingPath ?? null,
    },
    isData: isNativeBootPlanResult,
  }).statsFileMode;
}
