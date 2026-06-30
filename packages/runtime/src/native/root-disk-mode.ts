import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { type BootRootDiskMode } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type RootDiskModeInput = {
  rootDisk?: boolean | string;
  restorePath?: string;
};

export const planBootRootDiskModeNative = defineBootPlanProjection<
  RootDiskModeInput,
  BootRootDiskMode
>({
  errorCode: "BOOT_VMM_MISSING",
  makeError: rootDiskModePlanError,
  data: (input) => ({
    rootDisk: "unset",
    hasImage: input.rootDisk === true,
    rootDiskOptionFalse: input.rootDisk === false,
    rootDiskOptionTrue: input.rootDisk === true,
    rootDiskOptionPath: typeof input.rootDisk === "string" ? input.rootDisk : null,
    rootDiskRestorePath: input.restorePath ?? null,
  }),
  output: (plan) => plan.rootDiskMode,
});

function rootDiskModePlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new BootError(code, message, opts);
}
