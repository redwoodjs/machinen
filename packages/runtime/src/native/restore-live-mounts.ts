import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type RestoreLiveMount } from "./boot-plan-schema.ts";

type RestoreLiveMountInput = { host: string; guest: string; mode?: "ro" | "rw" };
type RecordedRestoreLiveMount = { host: string; guest: string; mode: "ro" | "rw" };

export function planRestoreLiveMountsNative(
  recorded: ReadonlyArray<RecordedRestoreLiveMount> | undefined,
  overrides: ReadonlyArray<RestoreLiveMountInput> | undefined,
): RestoreLiveMount[] {
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
      restoreLiveMountsRecorded: recorded ?? [],
      restoreLiveMountsOverrides: overrides ?? [],
    },
    errorCode: "BOOT_MOUNT_INVALID",
    makeError: restoreLiveMountPlanError,
    isData: isNativeBootPlanResult,
  }).restoreLiveMounts;
}

const restoreLiveMountPlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new BootError(code, message, opts);
