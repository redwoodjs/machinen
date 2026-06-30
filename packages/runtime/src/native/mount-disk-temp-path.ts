import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";

type MountDiskTempPathResult = NativeBootPlanResult & { mountDiskTempPath: string };

export function planBootMountDiskTempPathNative(input: {
  kind: "restore-upper";
  tmpDir: string;
  pid: number;
  nonce: string;
}): string {
  return callRuntimeHelper({
    command: "boot-plan",
    data: {
      memoryMib: null,
      resourcesMemory: null,
      autoMemoryMib: null,
      hostTotalBytes: null,
      vmmMemoryPreset: true,
      hasImage: false,
      hasCmd: false,
      rootDisk: "false",
      mountDiskTempKind: input.kind,
      mountDiskTempDir: input.tmpDir,
      mountDiskTempPid: String(input.pid),
      mountDiskTempNonce: input.nonce,
    },
    isData: isMountDiskTempPathResult,
  }).mountDiskTempPath;
}

function isMountDiskTempPathResult(value: unknown): value is MountDiskTempPathResult {
  if (!isNativeBootPlanResult(value)) {
    return false;
  }
  return typeof (value as { mountDiskTempPath?: unknown }).mountDiskTempPath === "string";
}
