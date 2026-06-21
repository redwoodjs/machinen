import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type RegistryProcessPlan } from "./boot-plan-schema.ts";

export function planBootRegistryProcessNative(input: {
  hostPlatform: string;
  vmmBinary: string;
  vmmPdeathsig: boolean;
  vmmObservedExeBase?: string;
  gvPid?: number;
  gvExe?: string;
  gvObservedExeBase?: string;
}): { vmmExe: string; gvproxyExe?: string } {
  const plan: RegistryProcessPlan = callRuntimeHelper({
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
      registryHostPlatform: input.hostPlatform,
      registryVmmBinary: input.vmmBinary,
      registryVmmPdeathsig: input.vmmPdeathsig,
      registryVmmObservedExeBase: input.vmmObservedExeBase ?? null,
      registryGvPid: input.gvPid === undefined ? null : String(input.gvPid),
      registryGvExe: input.gvExe ?? null,
      registryGvObservedExeBase: input.gvObservedExeBase ?? null,
    },
    errorCode: "BOOT_VMM_MISSING",
    makeError: registryProcessPlanError,
    isData: isNativeBootPlanResult,
  }).registryProcess;
  if (!plan.vmmExe) {
    throw new BootError(
      "BOOT_VMM_MISSING",
      "boot: native planner returned no registry VMM executable",
    );
  }
  return { vmmExe: plan.vmmExe, gvproxyExe: plan.gvproxyExe ?? undefined };
}

const registryProcessPlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new BootError(code, message, opts);
