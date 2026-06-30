import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";

export interface NativeReflinkCopyResult {
  mode: "cow" | "copy";
  primitive: "darwin-cp-c" | "node-ficlone-force" | "linux-cp-sparse" | "node-copy";
  fallbackReason?: string;
}

export function reflinkCopyNative(src: string, dst: string): NativeReflinkCopyResult {
  return callRuntimeHelper({
    command: "reflink-copy",
    data: { src, dst },
    errorCode: "BOOT_PACK_FAILED",
    makeError: reflinkError,
    isData: isNativeReflinkCopyResult,
  });
}

function reflinkError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}

function isNativeReflinkCopyResult(value: unknown): value is NativeReflinkCopyResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<NativeReflinkCopyResult>;
  return (
    (data.mode === "cow" || data.mode === "copy") &&
    isPrimitive(data.primitive) &&
    (data.fallbackReason === undefined || typeof data.fallbackReason === "string")
  );
}

function isPrimitive(value: unknown): value is NativeReflinkCopyResult["primitive"] {
  return (
    value === "darwin-cp-c" ||
    value === "node-ficlone-force" ||
    value === "linux-cp-sparse" ||
    value === "node-copy"
  );
}
