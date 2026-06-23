import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type BundleMountDiskModePlan = { action: "none" | "restore" | "fresh" };
type BundleMountDiskModeResult = NativeBootPlanResult & {
  bundleMountDiskMode: BundleMountDiskModePlan;
};

type BundleMountDiskModeInput = {
  useTiny: boolean;
  mountGuest?: string;
  restoreMountGuest?: string;
};

export const planBootBundleMountDiskModeNative = defineBootPlanProjection<
  BundleMountDiskModeInput,
  BundleMountDiskModePlan,
  BundleMountDiskModeResult
>({
  data: (input) => ({
    bundlePackUseTiny: input.useTiny,
    bundlePackMountGuest: input.mountGuest ?? null,
    bundlePackRestoreMountGuest: input.restoreMountGuest ?? null,
  }),
  output: (plan) => plan.bundleMountDiskMode,
  isData: isBundleMountDiskModeResult,
});

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
