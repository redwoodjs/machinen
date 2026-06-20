import { RegistryError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";

type NativePidStatus = "alive" | "dead" | "recycled";

interface NativeProcessIdentity {
  exeBase: string;
  startedAtMs?: number;
}

interface PidValidateResponse {
  status: NativePidStatus;
}

interface ProcessIdentityResponse {
  identity: NativeProcessIdentity | null;
}

export function validatePidNative(request: {
  pid: number;
  expected: { vmmExe?: string; startedAt?: number };
}): NativePidStatus {
  return callRuntimeHelper({
    command: "pid-validate",
    data: request,
    errorCode: "REGISTRY_VM_NOT_FOUND",
    makeError: registryError,
    isData: isPidValidateResponse,
  }).status;
}

export function readProcessIdentityNative(pid: number): NativeProcessIdentity | undefined {
  const response = callRuntimeHelper({
    command: "process-identity",
    data: { pid },
    errorCode: "REGISTRY_VM_NOT_FOUND",
    makeError: registryError,
    isData: isProcessIdentityResponse,
  });
  return response.identity ?? undefined;
}

function registryError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new RegistryError(code, message, opts);
}

function isPidValidateResponse(value: unknown): value is PidValidateResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const status = (value as Partial<PidValidateResponse>).status;
  return status === "alive" || status === "dead" || status === "recycled";
}

function isProcessIdentityResponse(value: unknown): value is ProcessIdentityResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const identity = (value as Partial<ProcessIdentityResponse>).identity;
  return identity === null || isNativeProcessIdentity(identity);
}

function isNativeProcessIdentity(value: unknown): value is NativeProcessIdentity {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<NativeProcessIdentity>;
  return typeof data.exeBase === "string" && optionalNumber(data.startedAtMs);
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}
