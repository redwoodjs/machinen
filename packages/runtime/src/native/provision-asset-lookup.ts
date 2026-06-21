import { ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type ProvisionAssetLookupPlan } from "./boot-plan-schema.ts";

export function planProvisionAssetLookupNative(input: {
  explicitPath?: string;
  explicitExists?: boolean;
  assetsDirPath?: string;
  assetsDirExists?: boolean;
  cachePath?: string;
  cacheExists?: boolean;
}): ProvisionAssetLookupPlan {
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
      provisionAssetExplicitPath: input.explicitPath ?? null,
      provisionAssetExplicitExists: input.explicitExists ?? null,
      provisionAssetAssetsDirPath: input.assetsDirPath ?? null,
      provisionAssetAssetsDirExists: input.assetsDirExists ?? null,
      provisionAssetCachePath: input.cachePath ?? null,
      provisionAssetCacheExists: input.cacheExists ?? null,
    },
    errorCode: "PROVISION_BASE_NOT_FOUND",
    makeError: provisionAssetLookupPlanError,
    isData: isNativeBootPlanResult,
  }).provisionAssetLookup;
}

const provisionAssetLookupPlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new ProvisionError(code, message, opts);
