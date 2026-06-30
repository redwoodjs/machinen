import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";

type BundleMountDiskModePlan = { action: "none" | "restore" | "fresh" };
type BundleMountDiskModeResult = NativeBootPlanResult & {
  bundleMountDiskMode: BundleMountDiskModePlan;
};

export function planBootBundleMountDiskModeNative(input: {
  useTiny: boolean;
  mountGuest?: string;
  restoreMountGuest?: string;
}): BundleMountDiskModePlan {
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
    isData: isBundleMountDiskModeResult,
  }).bundleMountDiskMode;
}

function isBundleMountDiskModeResult(value: unknown): value is BundleMountDiskModeResult {
  return (
    isNativeBootPlanResult(value) &&
    isBundleMountDiskModePlan((value as { bundleMountDiskMode?: unknown }).bundleMountDiskMode)
  );
}

function isBundleMountDiskModePlan(value: unknown): value is BundleMountDiskModePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<BundleMountDiskModePlan>;
  return plan.action === "none" || plan.action === "restore" || plan.action === "fresh";
}
