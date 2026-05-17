// Shared fork implementation. Kept separate from fork.ts so boot.ts can
// install a VmHandle.fork method without importing restore.ts through fork.ts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import debugLib from "debug";

import { checkForkBackpressure, DEFAULT_FREE_MEMORY_THRESHOLD } from "../host-mem.ts";
import type { ForkOptions, SnapshotResult, VmHandle } from "../vm-handle.ts";
import { performSnapshot, type SnapshotContext } from "./snapshot.ts";

const debugFork = debugLib("machinen:fork");

type ForkRestoreOptions = Omit<ForkOptions, "outDir" | "tcpKeep"> & {
  snapDir: string;
  portForward: NonNullable<ForkOptions["portForward"]>;
  pdeathsig: false;
  timeoutMs: number | null;
};

type RestoreVm = (opts: ForkRestoreOptions) => Promise<VmHandle>;

/**
 * Snapshot the VM with --leave-running, immediately restore the
 * bundle into a sibling, and (optionally) clean up the bundle when
 * the fork exits. Shared between boot-owned and attach-owned handles.
 *
 * Bundle lifecycle:
 *   - opts.outDir set:    bundle stays at that path; caller owns cleanup.
 *   - opts.outDir absent: bundle in a temp dir, removed on fork.wait().
 */
export async function performForkWithRestore(
  ctx: SnapshotContext,
  opts: ForkOptions,
  restoreVm: RestoreVm,
): Promise<VmHandle> {
  // #274: refuse the fork up-front when the host is already under
  // memory pressure. Modeled on the #267 port-conflict gate — throw
  // immediately, let the caller back off. Runs before `performSnapshot`
  // so a doomed fork doesn't briefly freeze the source via criu dump
  // only to fail at restore.
  await checkForkBackpressure({
    threshold: opts.freeMemoryThreshold ?? DEFAULT_FREE_MEMORY_THRESHOLD,
  });

  const ephemeral = !opts.outDir;
  const snapDir = opts.outDir
    ? resolve(opts.outDir)
    : mkdtempSync(join(tmpdir(), "machinen-fork-"));
  debugFork(
    "fork start srcPid=%d srcName=%s snapDir=%s ephemeral=%s tcpKeep=%s",
    ctx.pid,
    ctx.sourceName ?? "<unset>",
    snapDir,
    ephemeral,
    opts.tcpKeep === true,
  );

  // Snapshot half: source survives. tcpClose flips the spec's default.
  // Uses performSnapshot's own 90s default ceiling — the dump half is
  // not user-configurable through ForkOptions today.
  let snap: SnapshotResult;
  try {
    snap = await performSnapshot(ctx, {
      outDir: snapDir,
      leaveRunning: true,
      tcpClose: opts.tcpKeep !== true,
      onLog: opts.onLog,
    });
  } catch (err) {
    cleanupEphemeralForkBundle(ephemeral, snapDir);
    throw err;
  }
  debugFork("fork dump complete elapsedMs=%d", snap.elapsedMs);

  // Restore half: a fresh sibling VM. boot() inside restore() auto-
  // allocates its own vsock UDS and (if needed) gvproxy — vsock
  // identity and L2 networking are isolated per-VM.
  //
  // Strip the two fork-only fields (outDir, tcpKeep) and forward the
  // rest of `opts` straight to restore(). This is the "fork = snapshot
  // + restore, no diverging path" surface: every BootOptions field the
  // user could pass at boot time also works on a fork (mount,
  // liveMounts, env, guestCwd, memory, kernel, dtb, …) and lands on
  // the restored sibling.
  //
  // Two invariants we preserve regardless of caller input:
  //   - portForward: NOT inherited from source. Host ports are global,
  //     so source + fork would race on the same bind. Caller must
  //     re-declare any forwards they want on the fork.
  //   - pdeathsig: forced false. The fork outlives the process that
  //     spawned it (CLI returns immediately; programmatic callers
  //     detach()). The parent-death shim would SIGTERM the fork on
  //     CLI exit otherwise.
  //   - timeoutMs: defaults to null (forever) instead of boot()'s 60s.
  //     Forks are long-lived siblings; an idle interactive console
  //     would otherwise be reaped mid-shell. Caller can override.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { outDir: _outDir, tcpKeep: _tcpKeep, ...restoreOpts } = opts;
  let fork: VmHandle;
  try {
    fork = await restoreVm({
      ...restoreOpts,
      snapDir,
      portForward: opts.portForward ?? [],
      pdeathsig: false,
      timeoutMs: opts.timeoutMs ?? null,
    });
  } catch (err) {
    cleanupEphemeralForkBundle(ephemeral, snapDir);
    throw err;
  }
  debugFork("fork restored pid=%d name=%s", fork.pid, fork.name ?? "<unset>");

  if (ephemeral) {
    void fork
      .wait()
      .catch(() => {})
      .finally(() => cleanupEphemeralForkBundle(ephemeral, snapDir));
  }
  return fork;
}

function cleanupEphemeralForkBundle(ephemeral: boolean, snapDir: string): void {
  if (!ephemeral) {
    return;
  }
  try {
    rmSync(snapDir, { recursive: true, force: true });
    debugFork("fork ephemeral bundle cleaned up snapDir=%s", snapDir);
  } catch (cleanupErr) {
    debugFork(
      "fork ephemeral cleanup failed snapDir=%s err=%s",
      snapDir,
      cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
    );
  }
}
