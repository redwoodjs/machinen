import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";

type RootDiskTempPathResult = NativeBootPlanResult & { rootDiskTempPath: string };

export function planBootRootDiskTempPathNative(input: {
  kind: "restore" | "cached";
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
      rootDiskTempKind: input.kind,
      rootDiskTempDir: input.tmpDir,
      rootDiskTempPid: String(input.pid),
      rootDiskTempNonce: input.nonce,
    },
    isData: isRootDiskTempPathResult,
  }).rootDiskTempPath;
}

function isRootDiskTempPathResult(value: unknown): value is RootDiskTempPathResult {
  if (!isNativeBootPlanResult(value)) {
    return false;
  }
  return typeof (value as { rootDiskTempPath?: unknown }).rootDiskTempPath === "string";
}
