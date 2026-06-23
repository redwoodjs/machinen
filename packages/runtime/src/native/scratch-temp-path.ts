import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type ScratchTempPathResult = NativeBootPlanResult & { scratchTempPath: string };

type ScratchTempPathInput = {
  kind: "restore" | "auto";
  tmpDir: string;
  pid: number;
  nonce: string;
};

export const planBootScratchTempPathNative = defineBootPlanProjection<
  ScratchTempPathInput,
  string,
  ScratchTempPathResult
>({
  data: (input) => ({
    scratchTempKind: input.kind,
    scratchTempDir: input.tmpDir,
    scratchTempPid: String(input.pid),
    scratchTempNonce: input.nonce,
  }),
  output: (plan) => plan.scratchTempPath,
  isData: isScratchTempPathResult,
});

function isScratchTempPathResult(value: unknown): value is ScratchTempPathResult {
  if (!isNativeBootPlanResult(value)) {
    return false;
  }
  return typeof (value as { scratchTempPath?: unknown }).scratchTempPath === "string";
}
