import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";

interface HostMemoryReading {
  freeBytes: number;
  totalBytes: number;
}

export function readHostMemoryNative(): HostMemoryReading {
  return callRuntimeHelper({
    command: "host-memory",
    data: {},
    errorCode: "FORK_MEMORY_BACKPRESSURE",
    makeError: hostMemoryError,
    isData: isHostMemoryReading,
  });
}

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
