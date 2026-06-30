import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type MountDiskTempPathResult = NativeBootPlanResult & { mountDiskTempPath: string };

type MountDiskTempPathInput = {
  kind: "restore-upper";
  tmpDir: string;
  pid: number;
  nonce: string;
};

export const planBootMountDiskTempPathNative = defineBootPlanProjection<
  MountDiskTempPathInput,
  string,
  MountDiskTempPathResult
>({
  data: (input) => ({
    mountDiskTempKind: input.kind,
    mountDiskTempDir: input.tmpDir,
    mountDiskTempPid: String(input.pid),
    mountDiskTempNonce: input.nonce,
  }),
  output: (plan) => plan.mountDiskTempPath,
  isData: isMountDiskTempPathResult,
});

function isMountDiskTempPathResult(value: unknown): value is MountDiskTempPathResult {
  if (!isNativeBootPlanResult(value)) {
    return false;
  }
  return typeof (value as { mountDiskTempPath?: unknown }).mountDiskTempPath === "string";
}
