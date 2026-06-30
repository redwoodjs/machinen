import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type RestoreImagePlan = {
  path: string | null;
  error: "explicit-missing" | "meta-missing" | "missing" | null;
};

type RestoreImageNativeData = NativeBootPlanResult & {
  restoreImage: RestoreImagePlan;
};

type RestoreImageInput = {
  explicitPath?: string;
  explicitExists?: boolean;
  metaSourcePath?: string;
  metaSourceExists?: boolean;
};

export const planRestoreImageNative = defineBootPlanProjection<
  RestoreImageInput,
  RestoreImagePlan,
  RestoreImageNativeData
>({
  errorCode: "BOOT_IMAGE_NOT_FOUND",
  data: restoreImageRequestData,
  output: (response) => response.restoreImage,
  isData: isRestoreImageData,
  makeError: restoreImagePlanError,
});

function restoreImageRequestData(input: RestoreImageInput): Record<string, unknown> {
  return {
    restoreImageExplicitPath: input.explicitPath ?? null,
    restoreImageExplicitExists: input.explicitExists ?? null,
    restoreImageMetaSourcePath: input.metaSourcePath ?? null,
    restoreImageMetaSourceExists: input.metaSourceExists ?? null,
  };
}

function isRestoreImageData(value: unknown): value is RestoreImageNativeData {
  if (!isNativeBootPlanResult(value)) {
    return false;
  }
  const plan = (value as { restoreImage?: unknown }).restoreImage;
  if (!plan || typeof plan !== "object") {
    return false;
  }
  const fields = plan as { path?: unknown; error?: unknown };
  return nullableString(fields.path) && isRestoreImageError(fields.error);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRestoreImageError(value: unknown): value is RestoreImagePlan["error"] {
  return (
    value === null ||
    value === "explicit-missing" ||
    value === "meta-missing" ||
    value === "missing"
  );
}

function restoreImagePlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new BootError(code, message, opts);
}
