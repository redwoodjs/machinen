import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { type BundlePackPlan } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type BundlePackInput = {
  useTiny: boolean;
  mountGuest?: string;
  restoreMountGuest?: string;
};

export const planBootBundlePackNative = defineBootPlanProjection<BundlePackInput, BundlePackPlan>({
  errorCode: "BOOT_PACK_FAILED",
  makeError: bundlePackPlanError,
  data: (input) => ({
    bundlePackUseTiny: input.useTiny,
    bundlePackMountGuest: input.mountGuest ?? null,
    bundlePackRestoreMountGuest: input.restoreMountGuest ?? null,
  }),
  output: (plan) => plan.bundlePack,
});

function bundlePackPlanError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}
