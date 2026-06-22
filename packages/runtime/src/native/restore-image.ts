import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";

type RestoreImagePlan = {
  path: string | null;
  error: "explicit-missing" | "meta-missing" | "missing" | null;
};

type RestoreImageNativeData = NativeBootPlanResult & {
  restoreImage: RestoreImagePlan;
};

export function planRestoreImageNative(input: {
  explicitPath?: string;
  explicitExists?: boolean;
  metaSourcePath?: string;
  metaSourceExists?: boolean;
}): RestoreImagePlan {
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
      restoreImageExplicitPath: input.explicitPath ?? null,
      restoreImageExplicitExists: input.explicitExists ?? null,
      restoreImageMetaSourcePath: input.metaSourcePath ?? null,
      restoreImageMetaSourceExists: input.metaSourceExists ?? null,
    },
    errorCode: "BOOT_IMAGE_NOT_FOUND",
    makeError: restoreImagePlanError,
    isData: isRestoreImageData,
  }).restoreImage;
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

const restoreImagePlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new BootError(code, message, opts);
