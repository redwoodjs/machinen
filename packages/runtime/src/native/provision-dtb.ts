import { ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type ProvisionDtbPlan } from "./boot-plan-schema.ts";

export function planProvisionDtbNative(input: {
  guestArchOverride?: string;
  hostArch?: string;
}): ProvisionDtbPlan {
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
      provisionGuestArchOverride: input.guestArchOverride ?? null,
      provisionHostArch: input.hostArch ?? null,
    },
    errorCode: "PROVISION_DTB_NOT_FOUND",
    makeError: provisionDtbPlanError,
    isData: isNativeBootPlanResult,
  }).provisionDtb;
}

const provisionDtbPlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new ProvisionError(code, message, opts);
