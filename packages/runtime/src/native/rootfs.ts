import { ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";

interface RootfsCacheKeyData {
  sha: string;
  source: "sidecar" | "file";
}

export function rootfsCacheKeyNative(tar: string): RootfsCacheKeyData {
  return callRuntimeHelper({
    command: "rootfs-cache-key",
    data: { tar },
    errorCode: "PROVISION_BASE_NOT_FOUND",
    makeError: rootfsError,
    isData: isRootfsCacheKeyData,
  });
}

function rootfsError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new ProvisionError(code, message, opts);
}

function isRootfsCacheKeyData(value: unknown): value is RootfsCacheKeyData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<RootfsCacheKeyData>;
  return (
    /^[0-9a-f]{64}$/.test(data.sha ?? "") && (data.source === "sidecar" || data.source === "file")
  );
}
