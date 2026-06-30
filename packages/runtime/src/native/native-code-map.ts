import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { defineRuntimeCommand } from "./runtime-command.ts";
import type { NativeProcessImageRefusal } from "../native-process-image.ts";
import type { NativeCodeMapRequest, NativeCodeMapResult } from "../native-code-map.ts";

export const buildNativeCodeMapNative = defineRuntimeCommand<
  NativeCodeMapRequest,
  NativeCodeMapResult
>({
  command: "native-code-map",
  errorCode: "BOOT_PORTABLE_UNSUPPORTED",
  makeError: nativeCodeMapError,
  isData: isNativeCodeMapResult,
});

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

type CodeLocationCheck = (location: Record<string, unknown>) => boolean;

const codeLocationChecks: CodeLocationCheck[] = [
  (location) => typeof location.id === "string",
  (location) => typeof location.sourceMapping === "string",
  (location) => typeof location.sourceAddress === "string",
  (location) => isOptionalString(location.targetAddress),
  (location) => isCodeLocationState(location.state),
  (location) => location.refusal === undefined || isRefusal(location.refusal),
];

function isCodeLocation(value: unknown): boolean {
  return isObject(value) && codeLocationChecks.every((check) => check(value));
}

function isCodeLocationState(value: unknown): boolean {
  return value === "mapped" || value === "pending" || value === "refused";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isRefusal(value: unknown): value is NativeProcessImageRefusal {
  if (!value || typeof value !== "object") {
    return false;
  }
  const refusal = value as Partial<NativeProcessImageRefusal>;
  return typeof refusal.code === "string" && typeof refusal.message === "string";
}

function nativeCodeMapError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}
