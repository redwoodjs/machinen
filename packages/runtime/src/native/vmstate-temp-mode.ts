import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type VmstateTempModePlan } from "./boot-plan-schema.ts";

export function planBootVmstateTempModeNative(
  engine: string,
  snapshotDisabled: boolean,
  existingTempDir?: string,
): VmstateTempModePlan {
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
      bootVmstateEngine: engine,
      bootVmstateSnapshotDisabled: snapshotDisabled,
      bootVmstateExistingTempDir: existingTempDir ?? null,
    },
    isData: isNativeBootPlanResult,
  }).vmstateTempMode;
}
