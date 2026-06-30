import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { type GvproxyPlan } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type PortForwardMapping = { hostPort: number; guestPort: number; hostAddr?: string };

type GvproxyInput = {
  portForward: ReadonlyArray<PortForwardMapping>;
  existingNetSocket?: string;
  gvproxyPath?: string;
  planningRequired?: boolean;
};

export const planGvproxyNative = defineBootPlanProjection<GvproxyInput, GvproxyPlan>({
  errorCode: "BOOT_PORT_FORWARD_NO_GVPROXY",
  makeError: gvproxyPlanError,
  data: (input) => ({
    portForward: [...input.portForward],
    gvproxyPlanningRequired: input.planningRequired === true,
    gvproxyNetSocket: input.existingNetSocket ?? null,
    gvproxyPath: input.gvproxyPath ?? null,
  }),
  output: (plan) => plan.gvproxyPlan,
});

function gvproxyPlanError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}
