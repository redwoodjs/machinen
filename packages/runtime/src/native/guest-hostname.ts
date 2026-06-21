import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult } from "./boot-plan-schema.ts";

export function planGuestHostnameSetNative(input: {
  pid: number;
  name?: string;
  vsockUdsPath?: string;
  skip?: boolean;
}): string | undefined {
  const plan = callRuntimeHelper({
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
      guestHostnameSetPid: String(input.pid),
      guestHostnameSetName: input.name ?? null,
      guestHostnameSetVsockUdsPath: input.vsockUdsPath ?? null,
      guestHostnameSetSkip: input.skip === true,
    },
    errorCode: "BOOT_VMM_MISSING",
    makeError: guestHostnamePlanError,
    isData: isNativeBootPlanResult,
  });
  return plan.guestHostnameSet ?? undefined;
}

const guestHostnamePlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new BootError(code, message, opts);
