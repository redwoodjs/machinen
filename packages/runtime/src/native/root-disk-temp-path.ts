import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type RootDiskTempPathResult = NativeBootPlanResult & { rootDiskTempPath: string };

type RootDiskTempPathInput = {
  kind: "restore" | "cached";
  tmpDir: string;
  pid: number;
  nonce: string;
};

export const planBootRootDiskTempPathNative = defineBootPlanProjection<
  RootDiskTempPathInput,
  string,
  RootDiskTempPathResult
>({
  data: (input) => ({
    rootDiskTempKind: input.kind,
    rootDiskTempDir: input.tmpDir,
    rootDiskTempPid: String(input.pid),
    rootDiskTempNonce: input.nonce,
  }),
  output: (plan) => plan.rootDiskTempPath,
  isData: isRootDiskTempPathResult,
});

function isRootDiskTempPathResult(value: unknown): value is RootDiskTempPathResult {
  if (!isNativeBootPlanResult(value)) {
    return false;
  }
  return typeof (value as { rootDiskTempPath?: unknown }).rootDiskTempPath === "string";
}
