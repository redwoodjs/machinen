import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type ScratchModePlan = "false" | "path" | "auto";

export const planBootScratchModeNative = defineBootPlanProjection<
  string | false | undefined,
  ScratchModePlan
>({
  errorCode: "BOOT_VMM_MISSING",
  makeError: scratchModePlanError,
  data: (snapshot) => ({
    scratchOptionFalse: snapshot === false,
    scratchOptionPath: typeof snapshot === "string" ? snapshot : null,
  }),
  output: (plan) => (plan.plannedScratchMode === "unset" ? "auto" : plan.plannedScratchMode),
});

function scratchModePlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new BootError(code, message, opts);
}
