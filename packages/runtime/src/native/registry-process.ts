import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import {
  isNativeBootPlanResult,
  type NativeBootPlanResult,
  type RegistryProcessPlan,
} from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type RegistryProcessIdentityPlan = { vmmPid: number | null; gvPid: number | null };
type RegistryProcessIdentityResult = NativeBootPlanResult & {
  registryProcessIdentity: RegistryProcessIdentityPlan;
};

type RegistryProcessIdentityInput = {
  hostPlatform: string;
  childPid: number;
  vmmPdeathsig: boolean;
  gvPid?: number;
};

type RegistryProcessInput = {
  hostPlatform: string;
  vmmBinary: string;
  vmmPdeathsig: boolean;
  vmmObservedExeBase?: string;
  gvPid?: number;
  gvExe?: string;
  gvObservedExeBase?: string;
};

export const planBootRegistryProcessIdentityNative = defineBootPlanProjection<
  RegistryProcessIdentityInput,
  { vmmPid?: number; gvPid?: number },
  RegistryProcessIdentityResult
>({
  errorCode: "BOOT_VMM_MISSING",
  makeError: registryProcessPlanError,
  data: registryProcessIdentityData,
  output: (plan) => ({
    vmmPid: plan.registryProcessIdentity.vmmPid ?? undefined,
    gvPid: plan.registryProcessIdentity.gvPid ?? undefined,
  }),
  isData: isRegistryProcessIdentityResult,
});

export const planBootRegistryProcessNative = defineBootPlanProjection<
  RegistryProcessInput,
  { vmmExe: string; gvproxyExe?: string }
>({
  errorCode: "BOOT_VMM_MISSING",
  makeError: registryProcessPlanError,
  data: registryProcessData,
  output: (plan) => registryProcessOutput(plan.registryProcess),
});

function registryProcessIdentityData(input: RegistryProcessIdentityInput): Record<string, unknown> {
  return {
    registryHostPlatform: input.hostPlatform,
    registryChildPid: String(input.childPid),
    registryVmmPdeathsig: input.vmmPdeathsig,
    registryGvPid: input.gvPid === undefined ? null : String(input.gvPid),
  };
}

function registryProcessData(input: RegistryProcessInput): Record<string, unknown> {
  return {
    registryHostPlatform: input.hostPlatform,
    registryVmmBinary: input.vmmBinary,
    registryVmmPdeathsig: input.vmmPdeathsig,
    registryVmmObservedExeBase: input.vmmObservedExeBase ?? null,
    registryGvPid: input.gvPid === undefined ? null : String(input.gvPid),
    registryGvExe: input.gvExe ?? null,
    registryGvObservedExeBase: input.gvObservedExeBase ?? null,
  };
}

function registryProcessOutput(plan: RegistryProcessPlan): { vmmExe: string; gvproxyExe?: string } {
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

function registryProcessPlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new BootError(code, message, opts);
}
