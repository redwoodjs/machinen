import { ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { type ProvisionBootPlan } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type ProvisionBootInput = {
  basePath: string;
  kernelPath: string;
  dtbPath?: string;
  udsPath: string;
  scratchDiskPath: string;
  rootDiskPath: string;
  vmmEnv?: Record<string, string>;
};

export const planProvisionBootNative = defineBootPlanProjection<
  ProvisionBootInput,
  ProvisionBootPlan
>({
  errorCode: "PROVISION_BASE_NOT_FOUND",
  makeError: provisionBootPlanError,
  data: (input) => ({
    provisionBasePath: input.basePath,
    provisionKernelPath: input.kernelPath,
    provisionDtbPath: input.dtbPath ?? null,
    provisionUdsPath: input.udsPath,
    provisionScratchDiskPath: input.scratchDiskPath,
    provisionRootDiskPath: input.rootDiskPath,
    provisionBootVmmEnv: input.vmmEnv ?? {},
  }),
  output: (plan) => plan.provisionBoot,
});

function provisionBootPlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new ProvisionError(code, message, opts);
}
