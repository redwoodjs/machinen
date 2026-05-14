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
import type { SnapshotEngine } from "./vm/snapshot-engine.ts";
import type { RestoreOptions } from "./vm/index.ts";

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
   *   <outDir>/img/                ← CRIU image files (pages-*.img,
   *                                  pagemap-*.img, core-*.img,
   *                                  dump.log, ...)
   *   <outDir>/meta.json           ← source name + timestamp +
   *                                  optional mountDisk pointers
   *   <outDir>/mount-lower.sqfs    ← squashfs RO lower (only when
   *                                  the source VM had `mount` set)
   *   <outDir>/mount-upper.img     ← ext4 RW upper (only when
   *                                  the source VM had `mount` set)
   *
   * `mount-lower.sqfs` and `mount-upper.img` are reflinked from the
   * runtime's per-VM materialization (#272), so on APFS / btrfs / xfs
   * the snapshot is essentially free space-wise even for a large
   * mount payload — blocks stay shared until either side writes.
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
   * Read the host's view of this VM's memory: the ceiling the VMM was
   * sized at, the host RSS the VMM is currently holding, the bytes
   * the virtio-balloon device has reported back to the host, and the
   * count of lazy-restore pages the guest hasn't faulted in yet (#274).
   *
   * Pure read, no side effects. The numbers come from:
   *   - `ceiling`           — captured at boot from the resolved
   *                            `MACHINEN_MEMORY` env (fork: from the
   *                            registry entry).
   *   - `hostRss`           — `/proc/<vmm>/status:VmRSS` on Linux,
   *                            `ps -o rss=` on Darwin. May be `null`
   *                            if the VMM exited between calls.
   *   - `balloonInflated`   — running total of bytes the balloon
   *                            device has reclaimed via free-page
   *                            reporting (`mmap MAP_FIXED` on the
   *                            reported runs). Read out of the shared
   *                            stats file the VMM mmaps at startup.
   *                            `0` when the VMM was launched without
   *                            `MACHINEN_STATS_FILE`.
   *   - `lazyPagesPending`  — for forks restored lazily (#266), the
   *                            count of pages the rewriter marked
   *                            PE_LAZY at restore time minus pages
   *                            served from `pages-*.img` over the
   *                            FUSE mount since. `0` for eager
   *                            restores and plain boots.
   */
  memoryStats(): Promise<MemoryStats>;

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

/**
 * Host-observable memory state for one VM (#274). All four fields are
 * snapshots of "now" — call `memoryStats()` again to refresh.
 */
export interface MemoryStats {
  /**
   * Ceiling the VMM was sized at (MiB). The actual RSS climbs into
   * this on demand and is reclaimed by the balloon (#263 phase B);
   * the ceiling itself is fixed for the lifetime of the VM. `null`
   * when the runtime didn't pick the value (caller pre-set
   * `MACHINEN_MEMORY` via `vmmEnv`) — we won't honestly report a
   * number we don't own.
   */
  ceilingMib: number | null;
  /**
   * Resident bytes the host kernel sees the VMM holding. `null`
   * when the VMM has exited or `/proc/<pid>/status` / `ps` couldn't
   * be read.
   */
  hostRssBytes: number | null;
  /**
   * Bytes the virtio-balloon device has reclaimed via free-page
   * reporting since the VMM started. Strictly increases over the
   * VMM's lifetime; if `hostRssBytes` is well below ceiling, balloon
   * reclaim is the reason. Read out of the shared stats file the VMM
   * writes via `MACHINEN_STATS_FILE`. `0` when the VMM was launched
   * without that env var.
   */
  balloonInflatedBytes: number;
  /**
   * Pages the lazy-restore path (#266) has registered as PE_LAZY but
   * the guest hasn't faulted in yet. Approximated as
   * `entriesFlagged - bytesServedFromPagesImg / 4096`, clamped to
   * `>= 0`. `0` for eager restores and plain (non-restored) boots.
   */
  lazyPagesPending: number;
}

export interface WriteFileOptions {
  /** Octal mode for the destination file (e.g. `0o755`). Default: leave as-is. */
  mode?: number;
  /** `mkdir -p` the parent directory before writing. Default: true. */
  recursive?: boolean;
  /** Append to the file instead of overwriting. Default: false. */
  append?: boolean;
}

/**
 * Options for `vm.snapshot(opts)`.
 *
 * Live-share mount note (#273): VMs booted with `liveMounts: [...]`
 * are snapshottable. The runtime unmounts each FUSE mount before
 * CRIU dumps and (for `leaveRunning: true`) re-establishes them
 * after. Bytes are NOT captured into the bundle — only the host
 * path / guest path / mode get recorded in `meta.liveMounts` so
 * `restore()` can reconnect a live window on the other side. See
 * the `liveMounts` doc on `BootOptions` for the full contract.
 */
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
  /** Which backend produced the bundle. */
  engine: SnapshotEngine;
  /** Absolute path to the snapshot bundle directory. */
  snapDir: string;
  /**
   * Absolute path to the CRIU image directory inside the bundle.
   * Set by the criu engine only; undefined for snaplet bundles.
   */
  imgDir?: string;
  /**
   * Absolute path to the `.snaplet` whole-VM state file inside the
   * bundle. Set by the snaplet engine only; undefined for criu bundles.
   */
  snapletPath?: string;
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
  /**
   * Which backend wrote this bundle — `"criu"` (process-tree images
   * under `img/`) or `"snaplet"` (whole-VM `state.snaplet`). `restore()`
   * also auto-detects from the bundle's contents; this field is the
   * explicit record. Absent on bundles predating the snaplet engine
   * (treated as `"criu"`).
   */
  engine?: SnapshotEngine;
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
  /**
   * #272: when the source VM was booted with `mount: { host, guest }`,
   * the snapshot bundle includes both halves of the overlay so a
   * restore (same- or cross-host) can mount the same overlay without
   * consulting the host source dir.
   *   - `guest`: absolute guest path the overlay mounts at.
   *   - `lower`: basename of the squashfs RO lower in the bundle dir.
   *   - `upper`: basename of the ext4 RW upper in the bundle dir.
   */
  mountDisk?: {
    guest: string;
    lower: string;
    upper: string;
  };
  /**
   * #273: live-share mounts (`liveMounts: [...]` at boot) the source
   * VM had at snapshot time. Unlike `mountDisk`, no bytes are captured
   * — `host` is the path on the host that was being live-shared,
   * recorded so `restore()` can re-establish the same window on the
   * restoring host. Each entry is the resolved config from the
   * source's `resolveLiveMounts()`:
   *   - `guest`: absolute guest path the mount lands at.
   *   - `host`:  absolute host path that was being shared.
   *   - `mode`:  `"ro"` or `"rw"`, the share's write semantics.
   *
   * Restore policy: the bundle's recorded mounts are re-established
   * verbatim by default. Pass `restore({ liveMounts })` to override
   * per-guest `host`/`mode` — each override entry's `guest` must match
   * a recorded entry, else BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN.
   * Cross-host bundles where a recorded `host` doesn't exist on the
   * restoring host fail loudly via the boot-time existence check —
   * users remap with the override knob.
   */
  liveMounts?: Array<{
    guest: string;
    host: string;
    mode: "ro" | "rw";
  }>;
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
  /**
   * Opt into lazy-pages restore for the fork — vsock-FUSE-mounted
   * bundle + `criu restore --lazy-pages`. Default false: the runtime
   * packs the CRIU image into a tar on `/dev/vdb` and the guest does
   * an eager load.
   *
   * Lazy keeps fork RSS proportional to the pages the sibling
   * actually touches, not the full snapshot size. Worth setting when
   * the source dumped a large heap that the fork will only sample.
   * Cannot combine with `--detach` (the lazy path needs the host's
   * FUSE server alive as long as the guest may fault, see #150
   * phase 3); the runtime falls back to eager in that case.
   */
  lazy?: boolean;
  /**
   * Backpressure gate (#274). Fraction of host total memory that must
   * be free before `vm.fork()` is allowed to proceed; if `MemAvailable`
   * (Linux) / `vm_stat free+speculative+purgeable` (Darwin) drops below
   * `totalmem() * threshold`, the fork is refused with
   * `FORK_MEMORY_BACKPRESSURE`. Mirrors the throw-immediately shape of
   * #267's port-conflict gate — caller decides whether to retry.
   *
   * Default 1% (`0.01`) — about 250 MiB on a 24 GiB host. The gate
   * exists to head off OOM kills, not to enforce a working-set
   * policy; bigger thresholds trip on real dev loops that boot
   * several VMs in sequence. Pass `0` to disable the gate entirely
   * (useful in tests or when you're knowingly running close to the
   * edge).
   */
  freeMemoryThreshold?: number;
}
