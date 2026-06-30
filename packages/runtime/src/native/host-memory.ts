import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { defineRuntimeCommand } from "./runtime-command.ts";

interface HostMemoryReading {
  freeBytes: number;
  totalBytes: number;
}

export const readHostMemoryNative = defineRuntimeCommand<void, HostMemoryReading>({
  command: "host-memory",
  errorCode: "FORK_MEMORY_BACKPRESSURE",
  data: () => ({}),
  makeError: hostMemoryError,
  isData: isHostMemoryReading,
});

function hostMemoryError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}

function isHostMemoryReading(value: unknown): value is HostMemoryReading {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<HostMemoryReading>;
  return positiveNumber(data.freeBytes) && positiveNumber(data.totalBytes);
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
