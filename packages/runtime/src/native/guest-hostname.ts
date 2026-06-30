import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type GuestHostnameSetInput = {
  pid: number;
  name?: string;
  vsockUdsPath?: string;
  skip?: boolean;
};

export const planGuestHostnameSetNative = defineBootPlanProjection<
  GuestHostnameSetInput,
  string | undefined
>({
  errorCode: "BOOT_VMM_MISSING",
  makeError: guestHostnamePlanError,
  data: (input) => ({
    guestHostnameSetPid: String(input.pid),
    guestHostnameSetName: input.name ?? null,
    guestHostnameSetVsockUdsPath: input.vsockUdsPath ?? null,
    guestHostnameSetSkip: input.skip === true,
  }),
  output: (plan) => plan.guestHostnameSet ?? undefined,
});

function guestHostnamePlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new BootError(code, message, opts);
}
