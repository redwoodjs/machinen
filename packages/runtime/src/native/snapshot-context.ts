import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { type PlannedLiveMount } from "./boot-plan-schema.ts";
import { defineBootPlanProjection } from "./boot-plan-command.ts";

type SnapshotMountDiskInput = { guest: string; lowerPath: string; upperPath: string };
type SnapshotVmstateInput = {
  statePath?: string;
  chainId: string;
  checkpointParent?: string;
  checkpointSequence: number;
};

type SnapshotContextInput = {
  mountDisk?: SnapshotMountDiskInput;
  liveMounts: ReadonlyArray<PlannedLiveMount>;
  vmstate: SnapshotVmstateInput;
};

type SnapshotContextPlan = {
  mountDisk?: SnapshotMountDiskInput;
  liveMounts?: Array<{ host: string; guest: string; mode: "ro" | "rw" }>;
  vmstateChain?: { chainId: string; parentDir?: string; sequence: number };
};

export const planBootSnapshotContextNative = defineBootPlanProjection<
  SnapshotContextInput,
  SnapshotContextPlan
>({
  errorCode: "BOOT_SNAPSHOT_NOT_FOUND",
  makeError: snapshotContextPlanError,
  data: snapshotContextData,
  output: (plan) => ({
    mountDisk: plan.snapshotContext.mountDisk ?? undefined,
    liveMounts:
      plan.snapshotContext.liveMounts.length > 0 ? plan.snapshotContext.liveMounts : undefined,
    vmstateChain: plan.snapshotContext.vmstateChain
      ? {
          chainId: plan.snapshotContext.vmstateChain.chainId,
          parentDir: plan.snapshotContext.vmstateChain.parentDir ?? undefined,
          sequence: plan.snapshotContext.vmstateChain.sequence,
        }
      : undefined,
  }),
});

function snapshotContextData(input: SnapshotContextInput): Record<string, unknown> {
  return {
    snapshotMountGuest: input.mountDisk?.guest ?? null,
    snapshotMountLowerPath: input.mountDisk?.lowerPath ?? null,
    snapshotMountUpperPath: input.mountDisk?.upperPath ?? null,
    snapshotLiveMounts: [...input.liveMounts],
    snapshotVmstatePath: input.vmstate.statePath ?? null,
    snapshotVmstateChainId: input.vmstate.chainId,
    snapshotVmstateCheckpointParent: input.vmstate.checkpointParent ?? null,
    snapshotVmstateCheckpointSequence: String(input.vmstate.checkpointSequence),
  };
}

function snapshotContextPlanError(
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error {
  return new BootError(code, message, opts);
}
