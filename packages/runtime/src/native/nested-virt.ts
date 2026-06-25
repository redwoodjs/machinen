import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";

export interface NestedVirtProbeObservation {
  platform: string;
  arch: string;
  linuxDevKvm?: boolean;
  linuxKvmNested?: string | null;
  linuxKvmArmNested?: string | null;
  darwinHvSupport?: string | null;
  darwinProductVersion?: string | null;
  darwinCpuBrand?: string | null;
}

interface NestedVirtNativeProbeResult {
  supported: boolean;
  reason?: string;
}

export function probeNestedVirtualizationNative(
  observed?: NestedVirtProbeObservation,
): NestedVirtNativeProbeResult {
  return callRuntimeHelper({
    command: "nested-virt-probe",
    data: observed ? { observed } : {},
    errorCode: "BOOT_NESTED_VIRT_UNSUPPORTED",
    makeError: nestedVirtError,
    isData: isNestedVirtNativeProbeResult,
  });
}

function nestedVirtError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}

function isNestedVirtNativeProbeResult(value: unknown): value is NestedVirtNativeProbeResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<NestedVirtNativeProbeResult>;
  if (typeof data.supported !== "boolean") {
    return false;
  }
  return data.reason === undefined || typeof data.reason === "string";
}
