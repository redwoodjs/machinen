import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";

type StatsFileTempModePlan = {
  action: "existing" | "reuse" | "allocate";
  existingPath: string | null;
  tempDir: string | null;
};

type StatsFileTempModeResult = NativeBootPlanResult & {
  statsFileTempMode: StatsFileTempModePlan;
};

export function planBootStatsFileTempModeNative(input: {
  existingPath?: string;
  vsockTempDir?: string;
}): StatsFileTempModePlan {
  return callRuntimeHelper({
    command: "boot-plan",
    data: {
      ...baseStatsFileModeData(input),
      statsFileVsockTempDir: input.vsockTempDir ?? null,
    },
    isData: isStatsFileTempModeResult,
  }).statsFileTempMode;
}

function baseStatsFileModeData(input: { existingPath?: string }) {
  return {
    memoryMib: null,
    resourcesMemory: null,
    autoMemoryMib: null,
    hostTotalBytes: null,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
    existingStatsFile: input.existingPath ?? null,
  };
}

function isStatsFileTempModeResult(value: unknown): value is StatsFileTempModeResult {
  if (!isNativeBootPlanResult(value)) {
    return false;
  }
  return isStatsFileTempModePlan((value as { statsFileTempMode?: unknown }).statsFileTempMode);
}

function isStatsFileTempModePlan(value: unknown): value is StatsFileTempModePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<StatsFileTempModePlan>;
  return (
    (plan.action === "existing" || plan.action === "reuse" || plan.action === "allocate") &&
    (typeof plan.existingPath === "string" || plan.existingPath === null) &&
    (typeof plan.tempDir === "string" || plan.tempDir === null)
  );
}
