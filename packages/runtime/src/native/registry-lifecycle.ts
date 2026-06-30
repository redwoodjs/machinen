import { type RegistryLifecyclePlan } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type RegistryLifecycleInput = {
  name?: string;
  childPid: number;
  vsockUdsPath?: string;
};

export const planBootRegistryLifecycleNative = defineBootPlanProjection<
  RegistryLifecycleInput,
  RegistryLifecyclePlan
>({
  data: (input) => ({
    registryLifecycleName: input.name ?? null,
    registryChildPid: String(input.childPid),
    registryLifecycleVsockUdsPath: input.vsockUdsPath ?? null,
  }),
  output: (plan) => plan.registryLifecycle,
});
