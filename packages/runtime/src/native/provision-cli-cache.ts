import { ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type ProvisionCliCachePlan } from "./boot-plan-schema.ts";

export function planProvisionCliCacheNative(input: {
  homeDir: string;
  version: string;
  guestArchOverride?: string;
  hostArch?: string;
}): ProvisionCliCachePlan {
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
      provisionCliCacheHome: input.homeDir,
      provisionCliCacheVersion: input.version,
      provisionGuestArchOverride: input.guestArchOverride ?? null,
      provisionHostArch: input.hostArch ?? null,
    },
    errorCode: "PROVISION_BASE_NOT_FOUND",
    makeError: provisionCliCachePlanError,
    isData: isNativeBootPlanResult,
  }).provisionCliCache;
}

const provisionCliCachePlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new ProvisionError(code, message, opts);
