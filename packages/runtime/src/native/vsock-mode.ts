import { type VsockModePlan } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

export const planBootVsockModeNative = defineBootPlanProjection<string | undefined, VsockModePlan>({
  data: (existingSpec) => ({ existingVsockSpec: existingSpec ?? null }),
  output: (plan) => plan.vsockMode,
});
