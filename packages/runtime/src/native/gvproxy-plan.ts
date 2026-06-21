import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type GvproxyPlan } from "./boot-plan-schema.ts";

type PortForwardMapping = { hostPort: number; guestPort: number; hostAddr?: string };

export function planGvproxyNative(input: {
  portForward: ReadonlyArray<PortForwardMapping>;
  existingNetSocket?: string;
  gvproxyPath?: string;
  planningRequired?: boolean;
}): GvproxyPlan {
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
      portForward: [...input.portForward],
      gvproxyPlanningRequired: input.planningRequired === true,
      gvproxyNetSocket: input.existingNetSocket ?? null,
      gvproxyPath: input.gvproxyPath ?? null,
    },
    errorCode: "BOOT_PORT_FORWARD_NO_GVPROXY",
    makeError: gvproxyPlanError,
    isData: isNativeBootPlanResult,
  }).gvproxyPlan;
}

const gvproxyPlanError = (code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error =>
  new BootError(code, message, opts);
