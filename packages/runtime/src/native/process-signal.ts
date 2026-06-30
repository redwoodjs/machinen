import { RegistryError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { defineRuntimeCommand } from "./runtime-command.ts";

type NativeProcessSignal = "0" | "SIGTERM" | "SIGKILL";

type ProcessSignalResult = {
  signaled: boolean;
  alive: boolean;
};

export const signalProcessNative = defineRuntimeCommand<
  { pid: number; signal: NativeProcessSignal },
  ProcessSignalResult
>({
  command: "process-signal",
  errorCode: "REGISTRY_VM_NOT_FOUND",
  makeError: processSignalError,
  isData: isProcessSignalResult,
});

function isProcessSignalResult(value: unknown): value is ProcessSignalResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const result = value as Partial<ProcessSignalResult>;
  return typeof result.signaled === "boolean" && typeof result.alive === "boolean";
}

function processSignalError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new RegistryError(code, message, opts);
}
