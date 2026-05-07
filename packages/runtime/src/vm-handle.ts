// Shape of the host-side handle returned by `boot()` / `attach()` /
// `restore()`. Lives in its own file so sibling modules (`provision.ts`,
// `multiplex.ts`) can import the type without creating an import cycle
// through `index.ts`.

import type { Readable, Writable } from "node:stream";
import type {
  VsockExecOptions,
  VsockExecPtyHandle,
  VsockExecPtyOptions,
  VsockExecResult,
} from "./exec.ts";
import type { OnLog } from "./log.ts";
import type { RestoreOptions } from "./vm.ts";

export interface VmHandle {
  /**
   * PID of the host-side VMM process — primary identifier across
   * boot/attach. Kernel-unique while alive; reused after exit, so
   * pass it to `attach({ pid })` while the VM is live (or use
   * `--name` for a stable handle).
   */
  readonly pid: number;
  /** Optional human-friendly name passed to `boot({ name })`. */
  readonly name?: string;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;

  /** Resolves when the VM process exits. Rejects on timeout. */
  wait(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;

  /** Send SIGKILL to the VM. Resolves once it's really gone. */
  kill(): Promise<void>;

  /**
   * Drop this host-side handle without killing the VMM. The VM keeps
   * running and can be re-attached from another process. For locally-
   * booted handles this closes captured streams; `wait()` and
   * `exec()` become unreliable afterwards.
   */
  detach(): Promise<void>;

  /**
   * Buffer stdout until the process exits; return it as a UTF-8 string.
   * Capped at ~1 MiB tail — long-running VMs keep only the most recent
   * bytes (issue #150). Sufficient for kernel boot console + test
   * assertions; not a full transcript.
   */
  output(): Promise<string>;

  /** Same as `output()` but for stderr (where guest console lands). */
  errorOutput(): Promise<string>;

  /**
   * Run a shell command inside the guest via the vsock exec-agent. Throws
   * BootError on non-zero exit; callers who want to inspect failure
   * should use `execRaw`.
   *
   * Requires the rootfs to have the exec-agent running on vsock port 1978
   * (the standard debian base ships it). The vsock bridge is set up
   * automatically by `boot()` unless the caller pre-set MACHINEN_VSOCK.
   */
  exec(cmd: string, opts?: VsockExecOptions): Promise<VsockExecResult>;

  /** Like `exec()` but returns non-zero exit codes instead of throwing. */
  execRaw(cmd: string, opts?: VsockExecOptions): Promise<VsockExecResult>;

  /**
   * Run a shell command inside a pseudoterminal. Bidirectional bytes
   * flow between `opts.stdin` and `opts.stdout`; the returned handle's
   * `.resize(cols, rows)` propagates window-size changes (hook your
   * host's SIGWINCH).
   *
   * Caller is responsible for putting the host terminal in raw mode
   * before calling and restoring it after `.result` settles — without
   * raw mode, Ctrl-C / arrow keys / etc. won't reach the guest as
   * untranslated bytes. See #133.
   */
  execPty(cmd: string, opts: VsockExecPtyOptions): VsockExecPtyHandle;

  /**
   * Write `contents` to `guestPath` inside the VM. Convenience over
   * `vm.exec(...)` for the common "drop a config file from the host"
   * case — no quoting/heredoc gymnastics, binary-safe via base64.
   *
   * Parent directories are created by default (`recursive: true`).
   * Pass `mode` to set the file mode (octal, e.g. `0o755`).
   * Pass `append: true` to append instead of overwrite.
   *
   * Best for small-to-medium files (configs, scripts) — the contents
   * ride through a single vsock exec frame, so very large blobs are
   * better handled with `--mount` / `VsockFiles.push`.
   *
   * Throws `ExecError` (`EXEC_NONZERO_EXIT`) if the underlying shell
   * write fails (e.g. permissions, full disk, missing `base64`).
   *
   * @throws {ExecError} EXEC_VSOCK_UNAVAILABLE | EXEC_NONZERO_EXIT |
   *   EXEC_AGENT_UNAVAILABLE (retryable) | EXEC_AGENT_TIMEOUT (retryable)
   */
  writeFile(guestPath: string, contents: Buffer | string, opts?: WriteFileOptions): Promise<void>;

  /**
   * Freeze this VM with CRIU and write a snapshot bundle into
   * `opts.outDir`. The bundle is a directory containing:
   *
   *   <outDir>/img/          ← CRIU image files (pages-*.img,
   *                            pagemap-*.img, core-*.img, dump.log, ...)
   *   <outDir>/meta.json     ← source name + timestamp
   *
   * The caller must have booted the VM with a scratch disk (`snapshot:
   * '<path>'` or default auto-allocation) so the guest had `/dev/vdb`
   * to dump into; otherwise this throws `SNAPSHOT_NO_DISK`.
   *
   * Guest contract: the rootfs ships a dump helper callable via
   * vsock exec — default `/sbin/machinen-dump`, override via
   * `opts.dumpCmd`. The helper runs `criu dump --leave-running` and
   * tars the resulting image set out on stdout, which the host
   * extracts into `<outDir>/img/`. For destructive snapshots (default)
   * the runtime then issues `/sbin/machinen-poweroff` over vsock to
   * bring the VMM down; `opts.leaveRunning: true` skips that step
   * and the source VM keeps running.
   *
   * `SNAPSHOT_TIMEOUT` if the dump exec doesn't return within
   * `opts.timeoutMs`; `SNAPSHOT_DUMP_FAILED` if it returns non-zero
   * or the streamed bundle is empty.
   *
   * Supported on both boot-owned and attach handles — attach uses
   * the `diskPath` stored in the VM registry entry at boot time.
   *
   * By default the VM exits as part of the dump (CRIU kills the
   * dumped tree on success). Pass `opts.leaveRunning: true` to keep
   * the source VM alive — the workload resumes from the dump point
   * and the bundle can be restored into a sibling VM (`vm.fork()`).
   */
  snapshot(opts: SnapshotOptions): Promise<SnapshotResult>;

  /**
   * Snapshot this VM without killing it and immediately restore the
   * bundle into a new sibling VM. Both source and fork keep running,
   * independently addressable. See #216.
   *
   * Wraps `vm.snapshot({ leaveRunning: true })` + `restore()` with
   * the safety defaults a fork wants:
   *   - `tcpKeep: false` (default) → the fork sees ECONNRESET on
   *     inherited TCP sockets, source keeps them. Set `tcpKeep: true`
   *     if you want both copies to share state (rarely correct).
   *   - `portForward: []` (default) → host ports are NOT inherited
   *     (they're global; source + fork would race). Pass new
   *     forwards explicitly.
   *
   * Returns a handle to the forked VM. The source VM is unaffected
   * apart from being briefly frozen during `criu dump`.
   *
   * Bundle lifecycle: when `opts.outDir` is set, the bundle is kept
   * and you can re-restore from it. When omitted, the bundle is
   * written to a temp dir and removed when the fork exits.
   */
  fork(opts?: ForkOptions): Promise<VmHandle>;
}

export interface WriteFileOptions {
  /** Octal mode for the destination file (e.g. `0o755`). Default: leave as-is. */
  mode?: number;
  /** `mkdir -p` the parent directory before writing. Default: true. */
  recursive?: boolean;
  /** Append to the file instead of overwriting. Default: false. */
  append?: boolean;
}

export interface SnapshotOptions {
  /**
   * Directory the snapshot bundle is written to. Created if missing
   * and required to be empty (or absent) so a previous snapshot
   * can't be silently overwritten.
   */
  outDir: string;
  /**
   * Command to run in the guest to trigger the CRIU dump. Defaults to
   * `/sbin/machinen-dump`.
   */
  dumpCmd?: string;
  /**
   * Wall-clock ceiling for the dump + shutdown. If the VMM hasn't exited
   * in this window we SIGKILL it and fail. Default 90s.
   */
  timeoutMs?: number;
  /**
   * Streaming log callback — fires for every byte the dump emits
   * (guest console + the dump exec). See #83. When both the snapshot
   * call and `boot({ onLog })` have a callback set, both fire.
   */
  onLog?: OnLog;
  /**
   * Pass `--leave-running` to `criu dump` so the source workload
   * survives the snapshot. The VMM stays up after the dump; success
   * is signalled by the dump exec returning 0 instead of by VMM exit.
   * Used by `vm.fork()` (#216).
   *
   * Default: false (current destructive snapshot behavior).
   */
  leaveRunning?: boolean;
  /**
   * Omit `--tcp-established` from `criu dump`. Restored sockets come
   * back in CLOSED state — the workload sees ECONNRESET on first
   * I/O, which is the right semantic when the dump is the source for
   * a fork (otherwise both copies would race on the same connection
   * state). See #216.
   *
   * Default: false (preserve TCP — current snapshot/restore behavior).
   */
  tcpClose?: boolean;
}

export interface SnapshotResult {
  /** Absolute path to the snapshot bundle directory. */
  snapDir: string;
  /** Absolute path to the CRIU image directory inside the bundle. */
  imgDir: string;
  /** Time from `snapshot()` entry to VMM exit, in milliseconds. */
  elapsedMs: number;
  /** Guest console output captured during the dump. */
  consoleLog: string;
}

/**
 * On-disk shape of the bundle's `meta.json`. Read by `restore()`
 * to reconstruct the source VM's name when registering the fork.
 */
export interface SnapshotMeta {
  /** Name passed to `boot({ name })` when the source VM was started. */
  sourceName?: string;
  /**
   * Absolute path of the rootfs tarball the source VM was booted with
   * (`boot({ image })` or its restored equivalent). `restore()` uses
   * this as the default rootfs, so the same-host quickstart works
   * without callers having to repeat the image path. Cross-host
   * restores need either the path to resolve on the new host, or an
   * explicit `image` override.
   */
  sourceImage?: string;
  /** ms epoch when `vm.snapshot()` returned. */
  snappedAt: number;
}

/**
 * Fork = `vm.snapshot({ leaveRunning: true })` + `restore(...)` rolled
 * into one call. The shape mirrors `RestoreOptions` (so anything you
 * could pass to `restore()` works on a fork) plus two fork-only knobs:
 * `outDir` (where to write the bundle) and `tcpKeep` (snapshot half).
 *
 * Notably this means `mount`, `liveMounts`, `env`, `guestCwd`, `memory`,
 * etc. are all settable on the fork — they take effect on the restored
 * sibling, not the source.
 *
 * `snapDir` is omitted because `vm.fork()` produces the bundle itself.
 * Re-included here are the fork-shaped docs for `name`, `portForward`,
 * `timeoutMs`, and `onLog` so call sites see the fork-specific defaults
 * instead of the boot/restore ones.
 */
export interface ForkOptions extends Omit<RestoreOptions, "snapDir"> {
  /**
   * If set, the snapshot bundle is written here and kept after the
   * fork exits — re-restore from this path to spawn another sibling.
   * If omitted, the bundle is written to a temp dir and removed
   * when the fork's VMM exits.
   */
  outDir?: string;
  /**
   * Default false: omit `--tcp-established` from the dump so the
   * fork sees ECONNRESET on sockets the source had open. Set true
   * to clone live TCP state into the fork (both VMs then race on
   * the same connection — only correct in narrow scenarios).
   */
  tcpKeep?: boolean;
  /**
   * Name for the forked VM. When omitted, restore()'s auto-naming
   * kicks in: `<sourceName>/<fork.pid>`.
   */
  name?: string;
  /**
   * Host→guest port forwards for the fork. NOT inherited from the
   * source — host ports are global and source + fork would race on
   * the same bind. Pass explicitly when the fork needs forwards.
   */
  portForward?: Array<{ hostPort: number; guestPort: number; hostAddr?: string }>;
  /**
   * Wall-clock ceiling for the restored fork's `wait()`. Defaults to
   * `null` (forever) — forks are typically long-lived sibling VMs and
   * interactive sessions can sit idle. Set a finite deadline if you
   * want the fork to be reaped after N ms of unresponsiveness. The
   * dump half uses `performSnapshot`'s own 90s default and isn't
   * configurable here.
   */
  timeoutMs?: number | null;
  /**
   * Streaming log callback for the snapshot half. Same shape as
   * `vm.snapshot({ onLog })`. Also used by the restore boot.
   */
  onLog?: OnLog;
}
