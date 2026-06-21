import { ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type ProvisionBootPlan } from "./boot-plan-schema.ts";

export function planProvisionBootNative(input: {
  basePath: string;
  kernelPath: string;
  dtbPath?: string;
  udsPath: string;
  scratchDiskPath: string;
  rootDiskPath: string;
  vmmEnv?: Record<string, string>;
}): ProvisionBootPlan {
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
      provisionBasePath: input.basePath,
      provisionKernelPath: input.kernelPath,
      provisionDtbPath: input.dtbPath ?? null,
      provisionUdsPath: input.udsPath,
      provisionScratchDiskPath: input.scratchDiskPath,
      provisionRootDiskPath: input.rootDiskPath,
      provisionBootVmmEnv: input.vmmEnv ?? {},
    },
    errorCode: "PROVISION_BASE_NOT_FOUND",
    makeError: provisionBootPlanError,
    isData: isNativeBootPlanResult,
  }).provisionBoot;
}

const provisionBootPlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new ProvisionError(code, message, opts);
