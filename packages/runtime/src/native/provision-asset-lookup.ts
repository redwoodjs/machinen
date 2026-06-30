import { ProvisionError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { type ProvisionAssetLookupPlan } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type ProvisionAssetLookupInput = {
  explicitPath?: string;
  explicitExists?: boolean;
  assetsDirPath?: string;
  assetsDirExists?: boolean;
  cachePath?: string;
  cacheExists?: boolean;
};

export const planProvisionAssetLookupNative = defineBootPlanProjection<
  ProvisionAssetLookupInput,
  ProvisionAssetLookupPlan
>({
  errorCode: "PROVISION_BASE_NOT_FOUND",
  makeError: provisionAssetLookupPlanError,
  data: (input) => ({
    provisionAssetExplicitPath: input.explicitPath ?? null,
    provisionAssetExplicitExists: input.explicitExists ?? null,
    provisionAssetAssetsDirPath: input.assetsDirPath ?? null,
    provisionAssetAssetsDirExists: input.assetsDirExists ?? null,
    provisionAssetCachePath: input.cachePath ?? null,
    provisionAssetCacheExists: input.cacheExists ?? null,
  }),
  output: (plan) => plan.provisionAssetLookup,
});

function provisionAssetLookupPlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new ProvisionError(code, message, opts);
}
