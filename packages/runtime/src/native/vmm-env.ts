import { defineBootPlanProjection } from "./boot-plan-command.ts";

type VmmEnvInput = {
  hostEnv: Record<string, string | undefined>;
  overrides?: Record<string, string>;
};

export const planBootVmmEnvNative = defineBootPlanProjection<VmmEnvInput, Record<string, string>>({
  data: (input) => ({
    vmmEnvBase: definedStringRecord(input.hostEnv),
    vmmEnvOverrides: input.overrides ?? {},
  }),
  output: (plan) => plan.vmmEnv,
});

function definedStringRecord(input: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
