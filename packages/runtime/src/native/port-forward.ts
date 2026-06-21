import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type PortForwardProbePlan } from "./boot-plan-schema.ts";

type PortForwardMapping = { hostPort: number; guestPort: number; hostAddr?: string };

export function planPortForwardProbeNative(
  portForward: ReadonlyArray<PortForwardMapping>,
): PortForwardProbePlan[] {
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
      portForward: [...portForward],
    },
    errorCode: "BOOT_PORT_FORWARD_INVALID",
    makeError: portForwardPlanError,
    isData: isNativeBootPlanResult,
  }).portForwardProbe;
}

export function validatePortForwardNetSocketNative(
  portForward: ReadonlyArray<PortForwardMapping>,
  netSocket: string | undefined,
): void {
  callRuntimeHelper({
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
      portForward: [...portForward],
      portForwardNetSocket: netSocket ?? null,
    },
    errorCode: "BOOT_PORT_FORWARD_INVALID",
    makeError: portForwardPlanError,
    isData: isNativeBootPlanResult,
  });
}

const portForwardPlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new BootError(code, message, opts);
