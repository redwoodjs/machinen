import { ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { type ProvisionCliCachePlan } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type ProvisionCliCacheInput = {
  homeDir: string;
  version: string;
  guestArchOverride?: string;
  hostArch?: string;
};

export const planProvisionCliCacheNative = defineBootPlanProjection<
  ProvisionCliCacheInput,
  ProvisionCliCachePlan
>({
  errorCode: "PROVISION_BASE_NOT_FOUND",
  makeError: provisionCliCachePlanError,
  data: (input) => ({
    provisionCliCacheHome: input.homeDir,
    provisionCliCacheVersion: input.version,
    provisionGuestArchOverride: input.guestArchOverride ?? null,
    provisionHostArch: input.hostArch ?? null,
  }),
  output: (plan) => plan.provisionCliCache,
});

function provisionCliCachePlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new ProvisionError(code, message, opts);
}
