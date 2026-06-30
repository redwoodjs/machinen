import type { PlannedLiveMount } from "./boot-plan-schema.ts";
import { planBootCoreNative } from "./boot-plan.ts";

export function validateBatchLiveMountsNative(
  liveMounts: ReadonlyArray<PlannedLiveMount>,
  vsockUdsPath: string | undefined,
): boolean {
  return planBootCoreNative({
    liveMountsResolved: [...liveMounts],
    vsockUdsPath,
    batchLiveMountValidationRequired: true,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).batchLiveMountSyncRequired;
}
