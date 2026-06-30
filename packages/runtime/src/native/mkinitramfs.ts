import { MkinitramfsError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { defineRuntimeCommand } from "./runtime-command.ts";

interface NativeMkinitramfsRequest {
  mode: "tiny" | "rootfs" | "workspace" | "minimal";
  out: string;
  rootfs?: string;
  workspace?: string;
  mountpoint?: string;
  excludes?: string[];
  maxMb?: number;
  initPath?: string;
  config?: string;
  configPath?: string;
  injectInit?: boolean;
  allowMissingInit?: boolean;
  execAgentPath?: string;
  mountGuest?: string;
}

interface NativeMkinitramfsData {
  out: string;
  bytes: number;
  workspaceBytes: number;
}

export const packMkinitramfsNative = defineRuntimeCommand<
  NativeMkinitramfsRequest,
  NativeMkinitramfsData
>({
  command: "mkinitramfs",
  errorCode: "MKINITRAMFS_BASE_EXTRACT_FAILED",
  makeError: mkinitramfsError,
  isData: isNativeMkinitramfsData,
});

function mkinitramfsError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): MkinitramfsError {
  return new MkinitramfsError(code, message, opts);
}

function isNativeMkinitramfsData(value: unknown): value is NativeMkinitramfsData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<NativeMkinitramfsData>;
  return (
    typeof data.out === "string" &&
    typeof data.bytes === "number" &&
    Number.isFinite(data.bytes) &&
    typeof data.workspaceBytes === "number" &&
    Number.isFinite(data.workspaceBytes)
  );
}
