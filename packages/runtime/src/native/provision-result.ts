import { ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type ProvisionResultPlan = {
  imagePath: string;
  sizeBytes: number;
  elapsedMs: number;
};

type ProvisionResultNativeData = NativeBootPlanResult & {
  provisionResult: ProvisionResultPlan;
};

export const planProvisionResultNative = defineBootPlanProjection<
  ProvisionResultPlan,
  ProvisionResultPlan,
  ProvisionResultNativeData
>({
  errorCode: "PROVISION_BASE_NOT_FOUND",
  makeError: provisionResultPlanError,
  data: (input) => ({
    provisionResultImagePath: input.imagePath,
    provisionResultSizeBytes: String(input.sizeBytes),
    provisionResultElapsedMs: String(input.elapsedMs),
  }),
  output: (plan) => plan.provisionResult,
  isData: isProvisionResultData,
});

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

function provisionResultPlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new ProvisionError(code, message, opts);
}
