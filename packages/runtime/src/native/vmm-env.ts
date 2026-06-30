import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult } from "./boot-plan-schema.ts";

export function planBootVmmEnvNative(input: {
  hostEnv: Record<string, string | undefined>;
  overrides?: Record<string, string>;
}): Record<string, string> {
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
      vmmEnvBase: definedStringRecord(input.hostEnv),
      vmmEnvOverrides: input.overrides ?? {},
    },
    isData: isNativeBootPlanResult,
  }).vmmEnv;
}

function definedStringRecord(input: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
