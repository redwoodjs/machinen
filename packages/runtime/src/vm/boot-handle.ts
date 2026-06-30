import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";

import { readBalloonStats } from "../balloon-stats.ts";
import {
  bootReadinessFailureMessage,
  bootStderrTail,
  runVsockWithBootDiagnostics,
  waitForDetachedExecAgent,
} from "./boot-diagnostics.ts";
import { writeBootSnapshot } from "../detached-log.ts";
import { BootError, ExecError, SnapshotError } from "../errors.ts";
import { VsockExec } from "../exec.ts";
import { readHostRssBytes } from "../proc-rss.ts";
import { findEntry, writeEntry } from "../registry.ts";
import type { OnLog } from "../log.ts";
import type { VmHandle } from "../vm-handle.ts";
import type { ResolvedLiveMount } from "./bundle.ts";
import type { ResolvedCpuResourcePolicy } from "./cpu-resources.ts";
import { performForkWithRestore } from "./fork-core.ts";
import { buildWriteFileCmds, teeOnLog } from "./helpers.ts";
import { performSnapshot, type SnapshotContext } from "./snapshot.ts";
import { resolveSnapshotEngine } from "./snapshot-engine.ts";
import { makeReseedVmstateEntropy, makeSyncVmstateSnapshot } from "./vsock-handle-ops.ts";
import type { BootVmstateRuntime, MountDiskPaths } from "./boot.ts";

// `boot()` owns the returned handle, including `vm.fork()`, but `restore()`
// itself calls back into `boot()`. Load the runtime entry lazily so the static
// graph stays acyclic while source runs (`../index.ts`) and bundled dist runs
// (`./index.js`) both resolve to the public restore export.
function runtimeEntryImportPath(): string {
  if (import.meta.url.endsWith("/vm/boot-handle.ts")) {
    return "../index.ts";
  }
  if (import.meta.url.endsWith("/vm/boot-handle.js")) {
    return "../index.js";
  }
  return "./index.js";
}

interface BootHandleArgs {
  child: ChildProcessWithoutNullStreams;
  childPid: number;
  vmName: string | undefined;
  timeoutMs: number | null;
  outputCollector: Promise<string>;
  errorCollector: Promise<string>;
  vsockUdsPath: string | undefined;
  onLog: OnLog | undefined;
  statsFilePath: string | undefined;
  memoryCeilingMib: number | undefined;
  diskAbs: string | undefined;
  vmstateStatePath: string | undefined;
  snapshot: BootSnapshotContextArgs;
}

interface BootSnapshotContextArgs {
  child: ChildProcessWithoutNullStreams;
  childPid: number;
  vmName: string | undefined;
  sourceImageAbs: string | undefined;
  rootDiskPath: string | undefined;
  rootDiskMode: "block" | "none";
  memoryCeilingMib: number | undefined;
  env: Record<string, string>;
  diskAbs: string | undefined;
  mountDiskPaths: MountDiskPaths | undefined;
  liveMountsResolved: ResolvedLiveMount[];
  nested: boolean | undefined;
  cpuPolicy: ResolvedCpuResourcePolicy | undefined;
  vmstate: BootVmstateRuntime;
}

export function createBootVmHandle(args: BootHandleArgs): VmHandle {
  let handle: VmHandle;
  handle = {
    pid: args.childPid,
    name: args.vmName,
    stdin: args.child.stdin,
    stdout: args.child.stdout,
    stderr: args.child.stderr,
    wait: makeWait(args.child, args.timeoutMs),
    kill: makeKill(args.child),
    detach: makeDetach(args.child),
    output: () => args.outputCollector,
    errorOutput: () => args.errorCollector,
    exec: makeExec(args.vsockUdsPath, args.onLog, args.child, args.errorCollector),
    execRaw: makeExecRaw(args.vsockUdsPath, args.onLog, args.child, args.errorCollector),
    reseedVmstateEntropy: makeReseedVmstateEntropy(
      args.vsockUdsPath,
      args.child,
      args.errorCollector,
    ),
    syncVmstateSnapshot: makeSyncVmstateSnapshot(
      args.vsockUdsPath,
      args.child,
      args.errorCollector,
    ),
    execPty: makeExecPty(args.vsockUdsPath),
    writeFile: makeWriteFile(() => handle),
    memoryStats: makeMemoryStats(args.childPid, args.statsFilePath, args.memoryCeilingMib),
    snapshot: makeSnapshot(args, () => buildBootSnapshotContext(args.snapshot, handle)),
    fork: makeFork(args, () => buildBootSnapshotContext(args.snapshot, handle)),
  };
  return handle;
}

function makeDetach(child: ChildProcessWithoutNullStreams): VmHandle["detach"] {
  return async () => {
    child.stdin.end();
    child.unref();
  };
}

function makeExec(
  vsockUdsPath: string | undefined,
  onLog: OnLog | undefined,
  child: ChildProcessWithoutNullStreams,
  errorCollector: Promise<string>,
): VmHandle["exec"] {
  return async (cmd, execOpts) => {
    const udsPath = requireVsockPath(vsockUdsPath, "exec");
    const res = await runVsockWithBootDiagnostics(child, errorCollector, () =>
      VsockExec.run(udsPath, cmd, teeOnLog(cmd, execOpts, onLog)),
    );
    if (res.exitCode !== 0) {
      throw new ExecError(
        "EXEC_NONZERO_EXIT",
        `vm.exec failed (code ${res.exitCode}): ${cmd}\nstderr:\n${res.stderr}`,
      );
    }
    return res;
  };
}

function makeExecRaw(
  vsockUdsPath: string | undefined,
  onLog: OnLog | undefined,
  child: ChildProcessWithoutNullStreams,
  errorCollector: Promise<string>,
): VmHandle["execRaw"] {
  return (cmd, execOpts) => {
    if (!vsockUdsPath) {
      return Promise.reject(missingVsockError("execRaw"));
    }
    return runVsockWithBootDiagnostics(child, errorCollector, () =>
      VsockExec.run(vsockUdsPath, cmd, teeOnLog(cmd, execOpts, onLog)),
    );
  };
}

function makeExecPty(vsockUdsPath: string | undefined): VmHandle["execPty"] {
  return (cmd, ptyOpts) => {
    if (!vsockUdsPath) {
      return rejectedPtyHandle(missingVsockError("execPty"));
    }
    return VsockExec.startPty(vsockUdsPath, cmd, ptyOpts);
  };
}

function rejectedPtyHandle(err: Error): ReturnType<VmHandle["execPty"]> {
  return {
    result: Promise.reject(err),
    resize: () => {},
    cancel: () => {},
  };
}

function requireVsockPath(vsockUdsPath: string | undefined, method: string): string {
  if (!vsockUdsPath) {
    throw missingVsockError(method);
  }
  return vsockUdsPath;
}

function missingVsockError(method: string): ExecError {
  return new ExecError(
    "EXEC_VSOCK_UNAVAILABLE",
    `vm.${method}: no vsock UDS available — MACHINEN_VSOCK was set to an ` +
      "unrecognized spec. Expected `in:<port>:<uds-path>`.",
  );
}

function makeWriteFile(getHandle: () => VmHandle): VmHandle["writeFile"] {
  return async (guestPath, contents, writeOpts) => {
    for (const cmd of buildWriteFileCmds(guestPath, contents, writeOpts)) {
      await getHandle().exec(cmd);
    }
  };
}

function makeMemoryStats(
  childPid: number,
  statsFilePath: string | undefined,
  memoryCeilingMib: number | undefined,
): VmHandle["memoryStats"] {
  return async () => {
    const balloon = statsFilePath ? readBalloonStats(statsFilePath) : null;
    const lazyTotal = findEntry({ pid: childPid })?.lazyPagesTotal ?? 0;
    const balloonReclaimedBytes = balloon?.bytesReported ?? 0;
    return {
      ceilingMib: memoryCeilingMib ?? null,
      hostRssBytes: readHostRssBytes(childPid, statsFilePath),
      balloonReclaimedBytes,
      balloonInflatedBytes: balloonReclaimedBytes,
      lazyPagesPending: lazyTotal,
    };
  };
}

function makeSnapshot(
  args: BootHandleArgs,
  snapshotContext: () => SnapshotContext,
): VmHandle["snapshot"] {
  return async (snapshotOpts) => {
    ensureSnapshotBacking(args.diskAbs, args.vmstateStatePath, "snapshot");
    return performSnapshot(snapshotContext(), snapshotOpts);
  };
}

function makeFork(args: BootHandleArgs, snapshotContext: () => SnapshotContext): VmHandle["fork"] {
  return async (forkOpts) => {
    ensureSnapshotBacking(args.diskAbs, args.vmstateStatePath, "fork");
    return performForkWithRestore(snapshotContext(), forkOpts ?? {}, restoreForFork);
  };
}

async function restoreForFork(
  restoreOpts: Parameters<typeof performForkWithRestore>[2] extends (
    opts: infer T,
  ) => Promise<VmHandle>
    ? T
    : never,
): Promise<VmHandle> {
  const runtimeEntryPath = runtimeEntryImportPath();
  const { restore } = await import(runtimeEntryPath);
  return restore(restoreOpts);
}

function ensureSnapshotBacking(
  diskAbs: string | undefined,
  vmstateStatePath: string | undefined,
  action: "snapshot" | "fork",
): void {
  const engine = resolveSnapshotEngine();
  if (engine === "criu" && !diskAbs) {
    throw noSnapshotBackingError(action);
  }
  if (engine === "vmstate" && !vmstateStatePath) {
    throw noSnapshotBackingError(action);
  }
}

function noSnapshotBackingError(action: "snapshot" | "fork"): SnapshotError {
  return new SnapshotError("SNAPSHOT_NO_DISK", NO_SNAPSHOT_BACKING_MESSAGES[action]);
}

const NO_SNAPSHOT_BACKING_MESSAGES = {
  snapshot:
    "vm.snapshot: this VM was booted with `snapshot: false` (no scratch " +
    "disk attached). Re-boot without that flag — the runtime will " +
    "auto-allocate a sparse scratch — or pass `snapshot: '<path>'`.",
  fork:
    "vm.fork: source VM has no scratch disk (booted with `snapshot: false`). " +
    "Re-boot the source without that flag so it can be snapshotted.",
} as const;

function buildBootSnapshotContext(
  args: BootSnapshotContextArgs,
  handle: VmHandle,
): SnapshotContext {
  return {
    pid: args.childPid,
    sourceName: args.vmName,
    sourceImage: args.sourceImageAbs,
    rootDiskPath: args.rootDiskPath,
    rootDiskMode: args.rootDiskMode,
    memoryCeilingMib: args.memoryCeilingMib,
    kernelPath: args.env.MACHINEN_KERNEL,
    dtbPath: args.env.MACHINEN_DTB,
    diskPath: args.diskAbs!,
    mountDisk: snapshotMountDisk(args.mountDiskPaths),
    liveMounts: snapshotLiveMounts(args.liveMountsResolved),
    vmstatePath: args.vmstate.statePath,
    vmstateChain: snapshotVmstateChain(args.vmstate),
    updateVmstateChain: snapshotVmstateUpdater(args.vmstate, args.childPid),
    maxVcpus: args.cpuPolicy?.maxVcpus,
    nested: args.nested,
    execRaw: handle.execRaw,
    syncVmstateSnapshot: handle.syncVmstateSnapshot,
    wait: handle.wait,
    kill: handle.kill,
    teeGuestConsole: (onChunk) => {
      args.child.stderr.on("data", onChunk);
    },
    errorOutput: () => handle.errorOutput(),
  };
}

function snapshotMountDisk(mountDiskPaths: MountDiskPaths | undefined) {
  if (!mountDiskPaths) {
    return undefined;
  }
  return {
    guest: mountDiskPaths.guest,
    lowerPath: mountDiskPaths.lowerPath,
    upperPath: mountDiskPaths.upperPath,
  };
}

function snapshotLiveMounts(liveMountsResolved: ResolvedLiveMount[]) {
  return nonEmptyList(
    liveMountsResolved.map((lm) => ({
      host: lm.host,
      guest: lm.guest,
      mode: lm.mode,
    })),
  );
}

function nonEmptyList<T>(items: T[]): T[] | undefined {
  return items.length > 0 ? items : undefined;
}

function snapshotVmstateChain(vmstate: BootVmstateRuntime): SnapshotContext["vmstateChain"] {
  if (!vmstate.statePath) {
    return undefined;
  }
  return {
    chainId: vmstate.chainId,
    parentDir: vmstate.checkpointParent,
    sequence: vmstate.checkpointSequence,
  };
}

function snapshotVmstateUpdater(
  vmstate: BootVmstateRuntime,
  childPid: number,
): SnapshotContext["updateVmstateChain"] {
  if (!vmstate.statePath) {
    return undefined;
  }
  return ({ parentDir, sequence }) =>
    updateVmstateChainState(vmstate, childPid, parentDir, sequence);
}

function updateVmstateChainState(
  vmstate: BootVmstateRuntime,
  childPid: number,
  parentDir: string | undefined,
  sequence: number,
): void {
  vmstate.checkpointParent = parentDir;
  vmstate.checkpointSequence = sequence;
  const cur = findEntry({ pid: childPid });
  if (cur) {
    writeEntry({
      ...cur,
      vmstateChainId: vmstate.chainId,
      vmstateCheckpointParent: vmstate.checkpointParent,
      vmstateCheckpointSequence: vmstate.checkpointSequence,
    });
  }
}

// #150/#944: detached mode waits for exec-agent readiness, not just
// the first console byte, so early guest panics become BootErrors.
export async function gateOnDetachedReadiness(args: {
  child: ChildProcessWithoutNullStreams;
  timeoutMs: number | null;
  bootLogPath: string;
  detachedBootChunks: Buffer[];
  handle: VmHandle;
}): Promise<void> {
  const readinessTimeoutMs = args.timeoutMs ?? 60_000;
  const outcome = await waitForDetachedExecAgent(args, readinessTimeoutMs);
  const stderrTail = bootStderrTail(args.detachedBootChunks);
  writeBootSnapshot(args.bootLogPath, stderrTail);
  if (outcome.kind === "exit") {
    throw new BootError(
      "BOOT_DETACHED_READINESS_FAILED",
      bootReadinessFailureMessage(
        `boot --detached: VMM exited before exec-agent readiness (code=${args.child.exitCode} signal=${args.child.signalCode}).`,
        args.bootLogPath,
        stderrTail,
      ),
      { cause: outcome.lastError },
    );
  }
  if (outcome.kind === "timeout") {
    try {
      args.child.kill("SIGTERM");
    } catch {}
    throw new BootError(
      "BOOT_DETACHED_READINESS_FAILED",
      bootReadinessFailureMessage(
        `boot --detached: exec-agent did not become reachable within ${readinessTimeoutMs}ms.`,
        args.bootLogPath,
        stderrTail,
      ),
      { cause: outcome.lastError },
    );
  }
  // Ready. Stop accumulating stderr — the snapshot is already on
  // disk, and post-detach bytes are the SIGPIPE-ignored bit-bucket.
  args.detachedBootChunks.length = 0;
  await args.handle.detach();
}

function makeWait(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number | null,
): VmHandle["wait"] {
  return async () => {
    // If the child already exited before we got here, `once("exit")`
    // never fires — the event has already been emitted. Check first.
    if (child.exitCode !== null || child.signalCode !== null) {
      return { code: child.exitCode, signal: child.signalCode };
    }
    const settled = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
    const race =
      timeoutMs === null
        ? settled
        : Promise.race([
            settled,
            new Promise<never>((_, reject) => {
              setTimeout(
                () =>
                  reject(new BootError("BOOT_TIMEOUT", `VMM did not exit within ${timeoutMs}ms`)),
                timeoutMs,
              ).unref();
            }),
          ]);
    const [code, signal] = await race;
    return { code, signal };
  };
}

function makeKill(child: ChildProcessWithoutNullStreams): VmHandle["kill"] {
  return async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    // Send SIGTERM, not SIGKILL: on darwin the spawn target is the
    // pdeathsig shim, which can't catch SIGKILL — that orphans its
    // inner VMM (#200), keeping the stderr pipe open so any caller
    // awaiting `errorOutput()` (collected via stream "close") never
    // wakes up. The shim does catch SIGTERM and forwards it to the
    // VMM, which exits cleanly. Linux has the same shape via
    // PR_SET_PDEATHSIG, so the same path applies.
    child.kill("SIGTERM");
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    // Escalate to SIGKILL if the shim+inner don't exit within 2s —
    // covers a wedged inner that ignores SIGTERM. SIGKILL'ing the
    // shim still orphans the inner, but at that point the inner is
    // already unresponsive and we've done what we can from here.
    const escalate = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 2_000);
    escalate.unref();
    try {
      await once(child, "exit");
    } finally {
      clearTimeout(escalate);
    }
  };
}
