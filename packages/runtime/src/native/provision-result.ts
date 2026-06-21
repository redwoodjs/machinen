import { ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";

export type ProvisionResultPlan = {
  imagePath: string;
  sizeBytes: number;
  elapsedMs: number;
};

type ProvisionResultNativeData = NativeBootPlanResult & {
  provisionResult: ProvisionResultPlan;
};

export function planProvisionResultNative(input: ProvisionResultPlan): ProvisionResultPlan {
  const plan = callRuntimeHelper({
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
      provisionResultImagePath: input.imagePath,
      provisionResultSizeBytes: String(input.sizeBytes),
      provisionResultElapsedMs: String(input.elapsedMs),
    },
    errorCode: "PROVISION_BASE_NOT_FOUND",
    makeError: provisionResultPlanError,
    isData: isProvisionResultData,
  }).provisionResult;

  return {
    imagePath: plan.imagePath,
    sizeBytes: plan.sizeBytes,
    elapsedMs: plan.elapsedMs,
  };
}

function isProvisionResultData(value: unknown): value is ProvisionResultNativeData {
  if (!isNativeBootPlanResult(value)) {
    return false;
  }
  const result = (value as { provisionResult?: unknown }).provisionResult;
  if (!result || typeof result !== "object") {
    return false;
  }
  const fields = result as { imagePath?: unknown; sizeBytes?: unknown; elapsedMs?: unknown };
  return (
    typeof fields.imagePath === "string" &&
    typeof fields.sizeBytes === "number" &&
    typeof fields.elapsedMs === "number"
  );
}

const provisionResultPlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new ProvisionError(code, message, opts);
