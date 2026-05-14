// Reconnect to a running VM registered by an earlier `boot()` call.

import debugLib from "debug";

import { readBalloonStats } from "../balloon-stats.ts";
import { ExecError, RegistryError, SnapshotError } from "../errors.ts";
import { VsockExec } from "../exec.ts";
import type { OnLog } from "../log.ts";
import { readHostRssBytes } from "../proc-rss.ts";
import { findEntry, isAlive } from "../registry.ts";
import { performFork } from "./fork.ts";
import type { MemoryStats, VmHandle } from "../vm-handle.ts";
import { buildWriteFileCmds, teeOnLog } from "./helpers.ts";
import { performSnapshot, type SnapshotContext } from "./snapshot.ts";

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
  const entry = findEntry(opts);
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
      if (!entry.diskPath) {
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
      if (!entry.diskPath) {
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
  // boot process persisted) and intentionally leaves the
  // stop/respawnLiveMountServers callbacks undefined — the detached
  // mount-server helpers belong to the OWNING process, so this
  // process can't bind their UDSes. performSnapshot's choreography
  // tolerates the gap: kill snapshots clean up via the owning
  // process's exit hook; leaveRunning paths still exec
  // /sbin/machinen-remount, and the re-fork'd fuse-agent dials the
  // owning process's still-listening UDS.
  function buildAttachSnapshotContext(): SnapshotContext {
    return {
      pid: entry.pid,
      sourceName: entry.name,
      sourceImage: entry.imagePath,
      diskPath: entry.diskPath!,
      // #272: re-hydrate mount-overlay paths from the registry so
      // attach-owned snapshots reflink the lower+upper into the
      // bundle exactly like boot-owned snapshots do.
      mountDisk: entry.mountDisk,
      liveMounts: entry.liveMounts,
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
