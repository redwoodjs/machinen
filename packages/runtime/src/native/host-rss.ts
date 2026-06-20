import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";

interface HostRssTarget {
  pid: number;
  statsPath?: string;
}

interface HostRssReading {
  pid: number;
  rssBytes: number;
}

interface HostRssData {
  readings: HostRssReading[];
}

export function hostRssNative(targets: readonly HostRssTarget[]): HostRssReading[] {
  return callRuntimeHelper({
    command: "host-rss",
    data: { targets },
    errorCode: "BOOT_PACK_FAILED",
    makeError: hostRssError,
    isData: isHostRssData,
  }).readings;
}

function hostRssError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}

function isHostRssData(value: unknown): value is HostRssData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<HostRssData>;
  return Array.isArray(data.readings) && data.readings.every(isHostRssReading);
}

function isHostRssReading(value: unknown): value is HostRssReading {
  if (!value || typeof value !== "object") {
    return false;
  }
  const reading = value as Partial<HostRssReading>;
  return isPositiveInteger(reading.pid) && isPositiveInteger(reading.rssBytes);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
