import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type StatsFileTempModePlan = {
  action: "existing" | "reuse" | "allocate";
  existingPath: string | null;
  tempDir: string | null;
};

type StatsFileTempModeResult = NativeBootPlanResult & {
  statsFileTempMode: StatsFileTempModePlan;
};

type StatsFileTempModeInput = {
  existingPath?: string;
  vsockTempDir?: string;
};

export const planBootStatsFileTempModeNative = defineBootPlanProjection<
  StatsFileTempModeInput,
  StatsFileTempModePlan,
  StatsFileTempModeResult
>({
  data: (input) => ({
    existingStatsFile: input.existingPath ?? null,
    statsFileVsockTempDir: input.vsockTempDir ?? null,
  }),
  output: (plan) => plan.statsFileTempMode,
  isData: isStatsFileTempModeResult,
});

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
