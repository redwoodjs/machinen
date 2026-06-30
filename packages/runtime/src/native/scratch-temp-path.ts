import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";

type ScratchTempPathResult = NativeBootPlanResult & { scratchTempPath: string };

export function planBootScratchTempPathNative(input: {
  kind: "restore" | "auto";
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
      scratchTempKind: input.kind,
      scratchTempDir: input.tmpDir,
      scratchTempPid: String(input.pid),
      scratchTempNonce: input.nonce,
    },
    isData: isScratchTempPathResult,
  }).scratchTempPath;
}

function isScratchTempPathResult(value: unknown): value is ScratchTempPathResult {
  if (!isNativeBootPlanResult(value)) {
    return false;
  }
  return typeof (value as { scratchTempPath?: unknown }).scratchTempPath === "string";
}
