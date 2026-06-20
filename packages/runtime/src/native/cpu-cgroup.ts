import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";

export type NativeCpuControlStatus = "linux-cgroup-v2" | "unsupported";

export interface NativeCpuControlResult {
  status: NativeCpuControlStatus;
  cgroupPath?: string;
  reason?: string;
}

interface CpuCgroupApplyRequest {
  pid: number;
  weight: number;
  quotaCpus?: number;
  parentDir: string;
  id: string;
}

interface CpuCgroupRemoveData {
  ok: true;
}

export function applyCpuCgroupNative(request: CpuCgroupApplyRequest): NativeCpuControlResult {
  return callRuntimeHelper({
    command: "cpu-cgroup-apply",
    data: request,
    errorCode: "BOOT_CPU_UNSUPPORTED",
    makeError: cpuCgroupError,
    isData: isNativeCpuControlResult,
  });
}

export function removeCpuCgroupNative(cgroupPath: string): void {
  callRuntimeHelper({
    command: "cpu-cgroup-remove",
    data: { cgroupPath },
    errorCode: "BOOT_CPU_UNSUPPORTED",
    makeError: cpuCgroupError,
    isData: isCpuCgroupRemoveData,
  });
}

function cpuCgroupError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}

function isNativeCpuControlResult(value: unknown): value is NativeCpuControlResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<NativeCpuControlResult>;
  return (
    (data.status === "linux-cgroup-v2" || data.status === "unsupported") &&
    optionalString(data.cgroupPath) &&
    optionalString(data.reason)
  );
}

function isCpuCgroupRemoveData(value: unknown): value is CpuCgroupRemoveData {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (value as Partial<CpuCgroupRemoveData>).ok === true;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}
