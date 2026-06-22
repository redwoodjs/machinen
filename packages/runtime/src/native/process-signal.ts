import { RegistryError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";

type NativeProcessSignal = "0" | "SIGTERM" | "SIGKILL";

type ProcessSignalResult = {
  signaled: boolean;
  alive: boolean;
};

export function signalProcessNative(input: {
  pid: number;
  signal: NativeProcessSignal;
}): ProcessSignalResult {
  return callRuntimeHelper({
    command: "process-signal",
    data: {
      pid: input.pid,
      signal: input.signal,
    },
    errorCode: "REGISTRY_VM_NOT_FOUND",
    makeError: processSignalError,
    isData: isProcessSignalResult,
  });
}

function isProcessSignalResult(value: unknown): value is ProcessSignalResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const result = value as Partial<ProcessSignalResult>;
  return typeof result.signaled === "boolean" && typeof result.alive === "boolean";
}

const processSignalError = (code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error =>
  new RegistryError(code, message, opts);
