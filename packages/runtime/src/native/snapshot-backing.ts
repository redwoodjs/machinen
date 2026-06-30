import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";
import { defineBootPlanProjectionWithArgs } from "./boot-plan-command.ts";

type SnapshotBackingPlan = { allowed: boolean };
type SnapshotBackingResult = NativeBootPlanResult & { snapshotBacking: SnapshotBackingPlan };

export const planBootSnapshotBackingNative = defineBootPlanProjectionWithArgs<
  [engine: string, action: "snapshot" | "fork", diskPath?: string, vmstatePath?: string],
  SnapshotBackingPlan,
  SnapshotBackingResult
>({
  data: (engine, action, diskPath, vmstatePath) => ({
    snapshotBackingEngine: engine,
    snapshotBackingAction: action,
    snapshotBackingDiskPath: diskPath ?? null,
    snapshotBackingVmstatePath: vmstatePath ?? null,
  }),
  output: (plan) => plan.snapshotBacking,
  isData: isSnapshotBackingResult,
});

function isSnapshotBackingResult(value: unknown): value is SnapshotBackingResult {
  return (
    isNativeBootPlanResult(value) &&
    isSnapshotBackingPlan((value as { snapshotBacking?: unknown }).snapshotBacking)
  );
}

function isSnapshotBackingPlan(value: unknown): value is SnapshotBackingPlan {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as SnapshotBackingPlan).allowed === "boolean"
  );
}
