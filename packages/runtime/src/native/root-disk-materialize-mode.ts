import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";

type RootDiskMaterializeModePlan = { action: "restore" | "caller" | "cached" };
type RootDiskMaterializeModeResult = NativeBootPlanResult & {
  rootDiskMaterializeMode: RootDiskMaterializeModePlan;
};

export function planBootRootDiskMaterializeModeNative(input: {
  restorePath?: string;
  callerPath?: string;
}): RootDiskMaterializeModePlan {
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
      rootDiskMaterializeRestorePath: input.restorePath ?? null,
      rootDiskMaterializeCallerPath: input.callerPath ?? null,
    },
    isData: isRootDiskMaterializeModeResult,
  }).rootDiskMaterializeMode;
}

function isRootDiskMaterializeModeResult(value: unknown): value is RootDiskMaterializeModeResult {
  if (!isNativeBootPlanResult(value)) {
    return false;
  }
  return isRootDiskMaterializeModePlan(
    (value as { rootDiskMaterializeMode?: unknown }).rootDiskMaterializeMode,
  );
}

function isRootDiskMaterializeModePlan(value: unknown): value is RootDiskMaterializeModePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<RootDiskMaterializeModePlan>;
  return plan.action === "restore" || plan.action === "caller" || plan.action === "cached";
}
