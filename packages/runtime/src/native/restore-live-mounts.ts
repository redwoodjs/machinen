import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { type RestoreLiveMount } from "./boot-plan-schema.ts";
import { defineBootPlanProjectionWithArgs } from "./boot-plan-command.ts";

type RestoreLiveMountInput = { host: string; guest: string; mode?: "ro" | "rw" };
type RecordedRestoreLiveMount = { host: string; guest: string; mode: "ro" | "rw" };

export const planRestoreLiveMountsNative = defineBootPlanProjectionWithArgs<
  [
    recorded: ReadonlyArray<RecordedRestoreLiveMount> | undefined,
    overrides: ReadonlyArray<RestoreLiveMountInput> | undefined,
  ],
  RestoreLiveMount[]
>({
  errorCode: "BOOT_MOUNT_INVALID",
  makeError: restoreLiveMountPlanError,
  data: (recorded, overrides) => ({
    restoreLiveMountsRecorded: recorded ?? [],
    restoreLiveMountsOverrides: overrides ?? [],
  }),
  output: (plan) => plan.restoreLiveMounts,
});

function restoreLiveMountPlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new BootError(code, message, opts);
}
