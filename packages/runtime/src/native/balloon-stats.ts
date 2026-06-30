import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { defineRuntimeCommand } from "./runtime-command.ts";
import type { BalloonCounters } from "../balloon-stats.ts";

interface BalloonStatsResult {
  counters: BalloonCounters | null;
}

export const readBalloonStatsNative = defineRuntimeCommand<
  string,
  BalloonStatsResult,
  BalloonCounters | null
>({
  command: "balloon-stats",
  errorCode: "BOOT_VMM_PACKAGE_BROKEN",
  data: (path) => ({ path }),
  output: (response) => response.counters,
  makeError: balloonStatsError,
  isData: isBalloonStatsResult,
});

function balloonStatsError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}

function isBalloonStatsResult(value: unknown): value is BalloonStatsResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<BalloonStatsResult>;
  return data.counters === null || isBalloonCounters(data.counters);
}

function isBalloonCounters(value: unknown): value is BalloonCounters {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<BalloonCounters>;
  return (
    nonNegativeNumber(data.bytesReported) &&
    nonNegativeNumber(data.bytesInflated) &&
    nonNegativeNumber(data.hostPhysFootprintBytes)
  );
}

function nonNegativeNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
