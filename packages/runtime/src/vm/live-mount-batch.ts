import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BootError, ExecError } from "../errors.ts";
import type { VmHandle } from "../vm-handle.ts";
import type { BootOptions } from "./boot.ts";
import type { ResolvedLiveMount } from "./bundle.ts";

export function validateBatchLiveMounts(
  opts: BootOptions,
  liveMounts: ResolvedLiveMount[],
  vsockUdsPath: string | undefined,
): void {
  if (!liveMounts.some((lm) => lm.sync === "batch")) {
    return;
  }
  if (opts.detached) {
    throw new BootError(
      "BOOT_MOUNT_INVALID",
      "liveMounts: sync='batch' cannot be used with detach yet",
    );
  }
  if (!vsockUdsPath) {
    throw new BootError(
      "BOOT_MOUNT_INVALID",
      "liveMounts: sync='batch' requires the exec vsock bridge",
    );
  }
}

export function withBatchLiveMountSync(
  handle: VmHandle,
  liveMounts: ResolvedLiveMount[],
): VmHandle {
  const batchMounts = liveMounts.filter((lm) => lm.sync === "batch");
  if (batchMounts.length === 0) {
    return handle;
  }
  const baseExecRaw = handle.execRaw;
  const sync = () => syncBatchLiveMounts(baseExecRaw, batchMounts);
  return {
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
    kill: async () => {
      await sync().catch(() => undefined);
      return handle.kill();
    },
  };
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

async function syncBatchLiveMounts(
  execRaw: VmHandle["execRaw"],
  mounts: ResolvedLiveMount[],
): Promise<void> {
  for (const mount of mounts) {
    await syncOneBatchLiveMount(execRaw, mount);
  }
}

async function syncOneBatchLiveMount(
  execRaw: VmHandle["execRaw"],
  mount: ResolvedLiveMount,
): Promise<void> {
  const chunks: Buffer[] = [];
  const stderr: Buffer[] = [];
  const result = await execRaw(`cd ${shellQuote(mount.guest)} && tar -cf - .`, {
    execTimeoutMs: 300_000,
    onStdout: (chunk) => chunks.push(Buffer.from(chunk)),
    onStderr: (chunk) => stderr.push(Buffer.from(chunk)),
  });
  if (result.exitCode !== 0) {
    throw new ExecError(
      "EXEC_NONZERO_EXIT",
      `batch live mount sync failed for ${mount.guest}: ${Buffer.concat(stderr).toString("utf8")}`,
    );
  }
  applyBatchTarToHost(mount.host, Buffer.concat(chunks));
}

function applyBatchTarToHost(hostDir: string, tarBytes: Buffer): void {
  const tempDir = mkdtempSync(join(tmpdir(), "machinen-batch-sync-"));
  try {
    const extract = spawnSync("tar", ["-xf", "-", "-C", tempDir], {
      input: tarBytes,
      encoding: "buffer",
      stdio: ["pipe", "ignore", "pipe"],
    });
    if (extract.error) {
      throw extract.error;
    }
    if (extract.status !== 0) {
      throw new Error(`host batch tar exited ${extract.status}: ${extract.stderr}`);
    }
    mirrorDirectory(tempDir, hostDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function mirrorDirectory(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(to)) {
    rmSync(join(to, entry), { recursive: true, force: true });
  }
  const copy = spawnSync("cp", ["-a", `${from}/.`, to], { stdio: ["ignore", "ignore", "pipe"] });
  if (copy.error) {
    throw copy.error;
  }
  if (copy.status !== 0) {
    throw new Error(`host batch copy exited ${copy.status}: ${copy.stderr}`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
