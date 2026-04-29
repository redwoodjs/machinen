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
   *   <outDir>/disk.img      ← CRIU image set on an ext4 volume
   *   <outDir>/meta.json     ← source name + timestamp
   *
   * The caller must have booted the VM with `snapshot: '<scratch>'`
   * so the guest had a /dev/vda to dump into; otherwise this throws
   * `SNAPSHOT_NO_DISK`.
   *
   * Guest contract: the rootfs ships a dump helper callable via
   * vsock exec — default `/sbin/machinen-dump`, override via
   * `opts.dumpCmd`. The helper runs `criu dump` against the
   * workload tree, syncs the ext4 images, and lets
   * `/sbin/machinen-supervisor` trigger PSCI SYSTEM_OFF. Success is
   * signalled by a clean VMM exit before `opts.timeoutMs` elapses
   * plus an mtime bump on the disk file — timer expiration throws
   * `SNAPSHOT_TIMEOUT`; an untouched disk throws
   * `SNAPSHOT_DUMP_FAILED`.
   *
   * Supported on both boot-owned and attach handles — attach uses
   * the `diskPath` stored in the VM registry entry at boot time.
   *
   * The VM exits as part of the dump. To continue using the VM
   * afterwards, restore from the produced snapshot bundle.
   */
  snapshot(opts: SnapshotOptions): Promise<SnapshotResult>;
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
}

export interface SnapshotResult {
  /** Absolute path to the snapshot bundle directory. */
  snapDir: string;
  /** Absolute path to the disk image inside the bundle. */
  diskPath: string;
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
  /** ms epoch when `vm.snapshot()` returned. */
  snappedAt: number;
}
