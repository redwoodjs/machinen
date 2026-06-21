import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";

type SnapshotBackingPlan = { allowed: boolean };
type SnapshotBackingResult = NativeBootPlanResult & { snapshotBacking: SnapshotBackingPlan };

export function planBootSnapshotBackingNative(
  engine: string,
  action: "snapshot" | "fork",
  diskPath?: string,
  vmstatePath?: string,
): SnapshotBackingPlan {
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
      snapshotBackingEngine: engine,
      snapshotBackingAction: action,
      snapshotBackingDiskPath: diskPath ?? null,
      snapshotBackingVmstatePath: vmstatePath ?? null,
    },
    isData: isSnapshotBackingResult,
  }).snapshotBacking;
}

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
