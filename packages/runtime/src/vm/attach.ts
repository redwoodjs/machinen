// Reconnect to a running VM registered by an earlier `boot()` call.

import debugLib from "debug";

import { readBalloonStats } from "../balloon-stats.ts";
import { ExecError, RegistryError, SnapshotError } from "../errors.ts";
import { VsockExec } from "../exec.ts";
import type { OnLog } from "../log.ts";
import { readHostRssBytes } from "../proc-rss.ts";
import { findEntry, isAlive, writeEntry } from "../registry.ts";
import { performFork } from "./fork.ts";
import type { MemoryStats, VmHandle } from "../vm-handle.ts";
import { buildWriteFileCmds, teeOnLog } from "./helpers.ts";
import { performSnapshot, type SnapshotContext } from "./snapshot.ts";
import { resolveSnapshotEngine } from "./snapshot-engine.ts";

const debugAttach = debugLib("machinen:attach");

export interface AttachOptions {
  /**
   * Look up a VM by the host pid of its VMM process. Kernel-unique
   * while alive; mutually exclusive with `name`. Exactly one of
   * `pid` / `name` is required.
   */
  pid?: number;
  /** Look up a VM by the name passed to `boot({ name })`. */
  name?: string;
  /**
   * Streaming log callback — fires for every byte of output from execs
   * made through the returned handle. See #83. Guest kernel console is
   * not available on attach handles (it belongs to the process that
   * called `boot()`), so only `exec-stdout` / `exec-stderr` sources fire.
   */
  onLog?: OnLog;
}

/**
 * Reconnect to a running VM registered by an earlier `boot()` call
 * (possibly from a different process). Returns a `VmHandle` that can
 * `exec()`, `snapshot()`, and `kill()` the remote VM via the vsock
 * bridge the booter left behind.
 *
 * Attached handles have inert stream properties (`stdin`/`stdout`/
 * `stderr` are empty `PassThrough`s) — those belong to the original
 * booter. `output()`/`errorOutput()` resolve with the empty string.
 * `wait()` polls the pid rather than listening for `exit`.
 *
 * @throws {RegistryError} REGISTRY_VM_NOT_FOUND
 */
export async function attach(opts: AttachOptions): Promise<VmHandle> {
  debugAttach("attach lookup pid=%s name=%s", opts.pid ?? "<unset>", opts.name ?? "<unset>");
  let entry = findEntry(opts);
  if (!entry) {
    const q = opts.pid !== undefined ? `pid ${opts.pid}` : `name ${opts.name}`;
    debugAttach("attach miss for %s", q);
    throw new RegistryError("REGISTRY_VM_NOT_FOUND", `attach: no running VM found for ${q}`);
  }
  debugAttach(
    "attach hit pid=%d name=%s sock=%s",
    entry.pid,
    entry.name ?? "<unset>",
    entry.socketPath,
  );
  const { PassThrough } = await import("node:stream");
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.end();
  stderr.end();

  const waitForExit = async (): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }> => {
    // Poll the pid at 200ms cadence. Rough, but adequate for a
    // rarely-hit path (usually attach is used for exec/snapshot, not
    // for waiting on termination).
    while (isAlive(entry.pid)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    return { code: null, signal: null };
  };

  const handle: VmHandle = {
    pid: entry.pid,
    name: entry.name,
    stdin,
    stdout,
    stderr,

    async wait() {
      return waitForExit();
    },

    async kill() {
      if (!isAlive(entry.pid)) {
        return;
      }
      try {
        process.kill(entry.pid, "SIGKILL");
      } catch {
        // Already dead.
      }
      await waitForExit();
    },

    async detach() {
      // No-op for attach handles — there's no local child to unref.
    },

    async output() {
      return "";
    },

    async errorOutput() {
      return "";
    },

    async exec(cmd, execOpts) {
      const res = await VsockExec.run(entry.socketPath, cmd, teeOnLog(cmd, execOpts, opts.onLog));
      if (res.exitCode !== 0) {
        throw new ExecError(
          "EXEC_NONZERO_EXIT",
          `vm.exec failed (code ${res.exitCode}): ${cmd}\nstderr:\n${res.stderr}`,
        );
      }
      return res;
    },

    execRaw(cmd, execOpts) {
      return VsockExec.run(entry.socketPath, cmd, teeOnLog(cmd, execOpts, opts.onLog));
    },

    execPty(cmd, ptyOpts) {
      return VsockExec.startPty(entry.socketPath, cmd, ptyOpts);
    },

    listSessions() {
      return VsockExec.listPtySessions(entry.socketPath);
    },

    killSession(name) {
      return VsockExec.killPtySession(entry.socketPath, name);
    },

    async writeFile(guestPath, contents, writeOpts) {
      for (const cmd of buildWriteFileCmds(guestPath, contents, writeOpts)) {
        await this.exec(cmd);
      }
    },

    async memoryStats(): Promise<MemoryStats> {
      const balloon = entry.statsPath ? readBalloonStats(entry.statsPath) : null;
      return {
        ceilingMib: entry.memoryCeilingMib ?? null,
        hostRssBytes: readHostRssBytes(entry.pid, entry.statsPath),
        balloonInflatedBytes: balloon?.bytesReported ?? 0,
        lazyPagesPending: 0,
      };
    },

    async snapshot(snapshotOpts) {
      // A VM can be snapshotted only if its resolved engine has a
      // backing store recorded in the registry: criu writes its images
      // onto the guest-side scratch disk, vmstate dumps the whole VM to
      // a host state file. `snapshot: false` records neither.
      const engine = resolveSnapshotEngine();
      if ((engine === "criu" && !entry.diskPath) || (engine === "vmstate" && !entry.vmstatePath)) {
        throw new SnapshotError(
          "SNAPSHOT_NO_DISK",
          "vm.snapshot: this VM was booted with `snapshot: false` (no scratch " +
            "disk attached). Re-boot without that flag — the runtime will " +
            "auto-allocate a sparse scratch — or pass `snapshot: '<path>'`.",
        );
      }
      return performSnapshot(buildAttachSnapshotContext(), snapshotOpts);
    },

    async fork(forkOpts) {
      const engine = resolveSnapshotEngine();
      if ((engine === "criu" && !entry.diskPath) || (engine === "vmstate" && !entry.vmstatePath)) {
        throw new SnapshotError(
          "SNAPSHOT_NO_DISK",
          "vm.fork: source VM has no scratch disk (booted with `snapshot: false`).",
        );
      }
      return performFork(buildAttachSnapshotContext(), forkOpts ?? {});
    },
  };

  // #273: snapshot ctx for the attach surface. Mirrors the boot-handle
  // builder but reads liveMount config from the registry (which the
  // boot process persisted). Since #332 every live mount is served by
  // an in-VMM virtio-fs device carried across the CRIU dump by the
  // VMM, so there's nothing host-side for either handle to manage.
  function buildAttachSnapshotContext(): SnapshotContext {
    return {
      pid: entry.pid,
      sourceName: entry.name,
      sourceImage: entry.imagePath,
      rootDiskPath: entry.rootDiskPath,
      rootDiskMode: entry.rootDiskMode,
      memoryCeilingMib: entry.memoryCeilingMib,
      diskPath: entry.diskPath!,
      // #272: re-hydrate mount-overlay paths from the registry so
      // attach-owned snapshots reflink the lower+upper into the
      // bundle exactly like boot-owned snapshots do.
      mountDisk: entry.mountDisk,
      liveMounts: entry.liveMounts,
      // Vmstate engine: the VMM's whole-VM state-file path, persisted
      // at boot. performSnapshotVmstate SIGUSR1s the VMM and reads it.
      vmstatePath: entry.vmstatePath,
      vmstateChain: entry.vmstatePath
        ? {
            chainId: entry.vmstateChainId ?? `attached-${entry.pid}`,
            parentDir: entry.vmstateCheckpointParent,
            sequence: entry.vmstateCheckpointSequence ?? 0,
          }
        : undefined,
      updateVmstateChain: entry.vmstatePath
        ? ({ parentDir, sequence }) => {
            entry = {
              ...entry!,
              vmstateChainId: entry!.vmstateChainId ?? `attached-${entry!.pid}`,
              vmstateCheckpointParent: parentDir,
              vmstateCheckpointSequence: sequence,
            };
            writeEntry(entry);
          }
        : undefined,
      nested: entry.nested,
      execRaw: (cmd, execOpts) => handle.execRaw(cmd, execOpts),
      wait: () => handle.wait(),
      kill: () => handle.kill(),
      // Attach handles don't own the VMM child, so there's no guest
      // console stream to tee. Dump/CRIU failure detail still flows
      // via exec-stdout / exec-stderr tags.
      teeGuestConsole: undefined,
      errorOutput: async () => "",
    };
  }
  return handle;
}
