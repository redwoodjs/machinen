import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { type PortForwardProbePlan } from "./boot-plan-schema.ts";
import { defineBootPlanProjection, defineBootPlanProjectionWithArgs } from "./boot-plan-command.ts";

type PortForwardMapping = { hostPort: number; guestPort: number; hostAddr?: string };

export const planPortForwardProbeNative = defineBootPlanProjection<
  ReadonlyArray<PortForwardMapping>,
  PortForwardProbePlan[]
>({
  errorCode: "BOOT_PORT_FORWARD_INVALID",
  makeError: portForwardPlanError,
  data: (portForward) => ({ portForward: [...portForward] }),
  output: (plan) => plan.portForwardProbe,
});

const validatePortForwardNetSocketCommand = defineBootPlanProjectionWithArgs<
  [portForward: ReadonlyArray<PortForwardMapping>, netSocket: string | undefined],
  void
>({
  errorCode: "BOOT_PORT_FORWARD_INVALID",
  makeError: portForwardPlanError,
  data: (portForward, netSocket) => ({
    portForward: [...portForward],
    portForwardNetSocket: netSocket ?? null,
  }),
  output: () => undefined,
});

export function validatePortForwardNetSocketNative(
  portForward: ReadonlyArray<PortForwardMapping>,
  netSocket: string | undefined,
): void {
  validatePortForwardNetSocketCommand(portForward, netSocket);
}

function portForwardPlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new BootError(code, message, opts);
}
