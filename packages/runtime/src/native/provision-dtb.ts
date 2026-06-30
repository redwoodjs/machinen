import { ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { type ProvisionDtbPlan } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type ProvisionDtbInput = {
  guestArchOverride?: string;
  hostArch?: string;
};

export const planProvisionDtbNative = defineBootPlanProjection<ProvisionDtbInput, ProvisionDtbPlan>(
  {
    errorCode: "PROVISION_DTB_NOT_FOUND",
    makeError: provisionDtbPlanError,
    data: (input) => ({
      provisionGuestArchOverride: input.guestArchOverride ?? null,
      provisionHostArch: input.hostArch ?? null,
    }),
    output: (plan) => plan.provisionDtb,
  },
);

function provisionDtbPlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new ProvisionError(code, message, opts);
}
