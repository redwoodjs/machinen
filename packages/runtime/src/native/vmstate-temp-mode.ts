import { type VmstateTempModePlan } from "./boot-plan-schema.ts";
import { defineBootPlanProjectionWithArgs } from "./boot-plan-command.ts";

export const planBootVmstateTempModeNative = defineBootPlanProjectionWithArgs<
  [engine: string, snapshotDisabled: boolean, existingTempDir?: string],
  VmstateTempModePlan
>({
  data: (engine, snapshotDisabled, existingTempDir) => ({
    bootVmstateEngine: engine,
    bootVmstateSnapshotDisabled: snapshotDisabled,
    bootVmstateExistingTempDir: existingTempDir ?? null,
  }),
  output: (plan) => plan.vmstateTempMode,
});
