import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type RegistryProcessPlan } from "./boot-plan-schema.ts";

type RegistryProcessIdentityPlan = { vmmPid: number | null; gvPid: number | null };
type RegistryProcessIdentityResult = { registryProcessIdentity: RegistryProcessIdentityPlan };

export function planBootRegistryProcessIdentityNative(input: {
  hostPlatform: string;
  childPid: number;
  vmmPdeathsig: boolean;
  gvPid?: number;
}): { vmmPid?: number; gvPid?: number } {
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
      registryHostPlatform: input.hostPlatform,
      registryChildPid: String(input.childPid),
      registryVmmPdeathsig: input.vmmPdeathsig,
      registryGvPid: input.gvPid === undefined ? null : String(input.gvPid),
    },
    errorCode: "BOOT_VMM_MISSING",
    makeError: registryProcessPlanError,
    isData: isRegistryProcessIdentityResult,
  }).registryProcessIdentity;
  return { vmmPid: plan.vmmPid ?? undefined, gvPid: plan.gvPid ?? undefined };
}

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

function isRegistryProcessIdentityResult(value: unknown): value is RegistryProcessIdentityResult {
  if (!isNativeBootPlanResult(value)) {
    return false;
  }
  const identity = (value as { registryProcessIdentity?: unknown }).registryProcessIdentity;
  if (!identity || typeof identity !== "object") {
    return false;
  }
  const plan = identity as Partial<RegistryProcessIdentityPlan>;
  return isNullableFiniteNumber(plan.vmmPid) && isNullableFiniteNumber(plan.gvPid);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

const registryProcessPlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new BootError(code, message, opts);
