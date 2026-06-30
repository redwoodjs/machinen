import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type RootDiskMaterializeModePlan = { action: "restore" | "caller" | "cached" };
type RootDiskMaterializeModeResult = NativeBootPlanResult & {
  rootDiskMaterializeMode: RootDiskMaterializeModePlan;
};

type RootDiskMaterializeModeInput = {
  restorePath?: string;
  callerPath?: string;
};

export const planBootRootDiskMaterializeModeNative = defineBootPlanProjection<
  RootDiskMaterializeModeInput,
  RootDiskMaterializeModePlan,
  RootDiskMaterializeModeResult
>({
  data: (input) => ({
    rootDiskMaterializeRestorePath: input.restorePath ?? null,
    rootDiskMaterializeCallerPath: input.callerPath ?? null,
  }),
  output: (plan) => plan.rootDiskMaterializeMode,
  isData: isRootDiskMaterializeModeResult,
});

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
