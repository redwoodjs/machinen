import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type RegistryLifecyclePlan } from "./boot-plan-schema.ts";

export function planBootRegistryLifecycleNative(input: {
  name?: string;
  childPid: number;
  vsockUdsPath?: string;
}): RegistryLifecyclePlan {
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
      registryLifecycleName: input.name ?? null,
      registryChildPid: String(input.childPid),
      registryLifecycleVsockUdsPath: input.vsockUdsPath ?? null,
    },
    isData: isNativeBootPlanResult,
  }).registryLifecycle;
}
