import { ExecError } from "../errors.ts";
import { validateBatchLiveMountsNative } from "../native/live-mount-batch.ts";
import type { VmHandle } from "../vm-handle.ts";
import type { BootOptions } from "./boot.ts";
import { withGuestShutdown } from "./guest-shutdown.ts";
const BATCH_SYNC_SCRIPT = "/run/machinen-batch-sync.sh";

interface BatchLiveMount {
  host: string;
  guest: string;
  mode?: "ro" | "rw";
}

export function validateBatchLiveMounts(
  _opts: BootOptions,
  liveMounts: ReadonlyArray<BatchLiveMount & { tag: string; mode: "ro" | "rw" }>,
  vsockUdsPath: string | undefined,
): void {
  if (liveMounts.length > 0) {
    validateBatchLiveMountsNative(liveMounts, vsockUdsPath);
  }
}

export function withBatchLiveMountSync(
  handle: VmHandle,
  liveMounts: ReadonlyArray<BatchLiveMount>,
): VmHandle {
  const baseExecRaw = handle.execRaw;
  const batchMounts = liveMounts.filter(isWritableBatchLiveMount);
  if (batchMounts.length === 0) {
    return withGuestShutdown(handle, baseExecRaw);
  }
  const sync = () => syncBatchLiveMounts(baseExecRaw);
  const batchHandle: VmHandle = {
    ...handle,
    execRaw: (cmd, opts) => syncAfterBatchOperation(() => baseExecRaw(cmd, opts), sync),
    exec: (cmd, opts) => syncAfterBatchOperation(() => handle.exec(cmd, opts), sync),
    snapshot: async (opts) => {
      await sync();
      return handle.snapshot(opts);
    },
    fork: async (opts) => {
      await sync();
      return handle.fork(opts);
    },
  };
  return withGuestShutdown(batchHandle, baseExecRaw);
}

function isWritableBatchLiveMount(mount: BatchLiveMount): mount is Required<BatchLiveMount> {
  return mount.mode === "rw";
}

async function syncAfterBatchOperation<T>(
  operation: () => Promise<T>,
  sync: () => Promise<void>,
): Promise<T> {
  let result: T | undefined;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (err) {
    operationError = err;
  }
  try {
    await sync();
  } catch (syncError) {
    if (operationError === undefined) {
      throw syncError;
    }
  }
  if (operationError !== undefined) {
    throw operationError;
  }
  return result as T;
}

async function syncBatchLiveMounts(execRaw: VmHandle["execRaw"]): Promise<void> {
  const stderr: Buffer[] = [];
  const result = await execRaw(`/bin/sh ${BATCH_SYNC_SCRIPT}`, {
    execTimeoutMs: 300_000,
    onStderr: (chunk) => stderr.push(Buffer.from(chunk)),
  });
  if (result.exitCode !== 0) {
    throw new ExecError(
      "EXEC_NONZERO_EXIT",
      `batch live mount sync failed: ${Buffer.concat(stderr).toString("utf8")}`,
    );
  }
}
