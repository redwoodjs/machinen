import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import { isNativeBootPlanResult, type PlannedLiveMount } from "./boot-plan-schema.ts";

type SnapshotMountDiskInput = { guest: string; lowerPath: string; upperPath: string };
type SnapshotVmstateInput = {
  statePath?: string;
  chainId: string;
  checkpointParent?: string;
  checkpointSequence: number;
};

export function planBootSnapshotContextNative(input: {
  mountDisk?: SnapshotMountDiskInput;
  liveMounts: ReadonlyArray<PlannedLiveMount>;
  vmstate: SnapshotVmstateInput;
}): {
  mountDisk?: SnapshotMountDiskInput;
  liveMounts?: Array<{ host: string; guest: string; mode: "ro" | "rw" }>;
  vmstateChain?: { chainId: string; parentDir?: string; sequence: number };
} {
  const plan = callRuntimeHelper({
    command: "boot-plan",
    data: {
      memoryMib: null,
      resourcesMemory: null,
      autoMemoryMib: null,
      hostTotalBytes: null,
      vmmMemoryPreset: true,
      hasImage: false,
      hasCmd: false,
      rootDisk: "false",
      snapshotMountGuest: input.mountDisk?.guest ?? null,
      snapshotMountLowerPath: input.mountDisk?.lowerPath ?? null,
      snapshotMountUpperPath: input.mountDisk?.upperPath ?? null,
      snapshotLiveMounts: [...input.liveMounts],
      snapshotVmstatePath: input.vmstate.statePath ?? null,
      snapshotVmstateChainId: input.vmstate.chainId,
      snapshotVmstateCheckpointParent: input.vmstate.checkpointParent ?? null,
      snapshotVmstateCheckpointSequence: String(input.vmstate.checkpointSequence),
    },
    errorCode: "BOOT_SNAPSHOT_NOT_FOUND",
    makeError: snapshotContextPlanError,
    isData: isNativeBootPlanResult,
  }).snapshotContext;
  return {
    mountDisk: plan.mountDisk ?? undefined,
    liveMounts: plan.liveMounts.length > 0 ? plan.liveMounts : undefined,
    vmstateChain: plan.vmstateChain
      ? {
          chainId: plan.vmstateChain.chainId,
          parentDir: plan.vmstateChain.parentDir ?? undefined,
          sequence: plan.vmstateChain.sequence,
        }
      : undefined,
  };
}

const snapshotContextPlanError = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
): Error => new BootError(code, message, opts);
