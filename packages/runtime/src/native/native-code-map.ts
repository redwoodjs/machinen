import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import type { NativeProcessImageRefusal } from "../native-process-image.ts";
import type { NativeCodeMapRequest, NativeCodeMapResult } from "../native-code-map.ts";

export function buildNativeCodeMapNative(request: NativeCodeMapRequest): NativeCodeMapResult {
  return callRuntimeHelper({
    command: "native-code-map",
    data: request,
    errorCode: "BOOT_PORTABLE_UNSUPPORTED",
    makeError: nativeCodeMapError,
    isData: isNativeCodeMapResult,
  });
}

function isNativeCodeMapResult(value: unknown): value is NativeCodeMapResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const result = value as Partial<NativeCodeMapResult>;
  return (
    Array.isArray(result.codeLocations) &&
    result.codeLocations.every(isCodeLocation) &&
    Array.isArray(result.refusals) &&
    result.refusals.every(isRefusal)
  );
}

function isCodeLocation(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const location = value as Record<string, unknown>;
  return (
    typeof location.id === "string" &&
    typeof location.sourceMapping === "string" &&
    typeof location.sourceAddress === "string" &&
    (location.targetAddress === undefined || typeof location.targetAddress === "string") &&
    (location.state === "mapped" || location.state === "pending" || location.state === "refused") &&
    (location.refusal === undefined || isRefusal(location.refusal))
  );
}

function isRefusal(value: unknown): value is NativeProcessImageRefusal {
  if (!value || typeof value !== "object") {
    return false;
  }
  const refusal = value as Partial<NativeProcessImageRefusal>;
  return typeof refusal.code === "string" && typeof refusal.message === "string";
}

const nativeCodeMapError = (code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error =>
  new BootError(code, message, opts);
