// `boot()` and its options surface. Owns the host-side VMM lifecycle:
// asset resolution, port-forward validation, gvproxy bring-up, initramfs
// pack, rootdisk materialization, VMM spawn + pdeathsig wrap, registry
// write, live-mount helper spawn, the returned `VmHandle`, and the
// `--detached` readiness gate.

import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import debugLib from "debug";

import { readBalloonStats } from "../balloon-stats.ts";
import { bootSnapshotPath, writeBootSnapshot } from "../detached-log.ts";
import { BootError, ExecError, RegistryError, SnapshotError } from "../errors.ts";
import { VsockExec } from "../exec.ts";
import { runGc } from "../gc.ts";
import {
  describePortHolder,
  ensureGvproxy,
  exposePort,
  probeHostPortFree,
  spawnGvproxy,
  warnGvproxyMissing,
} from "../gvproxy.ts";
import type { OnLog } from "../log.ts";
import {
  spawnDetachedMountServer,
  type DetachedMountServerHandle,
} from "../mount-server-detached.ts";
import { ensurePdeathsig, wrapWithPdeathsig } from "../pdeathsig.ts";
import { PhaseTimer } from "../phase-timer.ts";
import { readProcessIdentity } from "../pid-validate.ts";
import { readHostRssBytes } from "../proc-rss.ts";
import { reflinkCopy } from "../reflink.ts";
import { claimName, findEntry, patchEntry, removeEntry, writeEntry } from "../registry.ts";
import { ensureRootfsImage, markRootfsImageClean } from "../rootfs-img.ts";
import { resolveLiveMounts, type ResolvedLiveMount, synthesizeAndPackBundle } from "./bundle.ts";
import { performFork } from "./fork.ts";
import type { MemoryStats, VmHandle } from "../vm-handle.ts";
import {
  allocateSparseFile,
  autoSizeMemoryMib,
  buildGuestHostname,
  buildWriteFileCmds,
  collect,
  CONSOLE_TAIL_BYTES,
  parseVsockUdsPath,
  resolveVmmBinary,
  setGuestHostname,
  SNAP_SCRATCH_BYTES,
  teeOnLog,
  validateMemoryMib,
} from "./helpers.ts";
import { performSnapshot, type SnapshotContext } from "./snapshot.ts";
import { resolveSnapshotEngine, SNAPLET_FILE } from "./snapshot-engine.ts";

const debug = debugLib("machinen:boot");
const vmmDebug = debugLib("machinen:vmm");

export interface BootOptions {
  /**
   * Path to a rootfs tarball to boot from (e.g. the output of
   * `provision()`, or `rootfs-debian-arm64.tar.gz` shipped in releases).
   * Paired with `cmd` — both required, or neither (test-mode binary
   * boots and snapshot-only restores both skip initramfs packing).
   */
  image?: string;
  /**
   * Command to run inside the guest. Packed into the synthesized
   * `/machinen-config.json`. Paired with `image` — both required, or
   * neither.
   */
  cmd?: string[];
  /**
   * Env vars exposed to the guest workload. Packed into the synthesized
   * `/machinen-config.json`. Distinct from `vmmEnv`, which only affects
   * the host-side VMM process.
   */
  env?: Record<string, string>;
  /**
   * Working directory for the guest cmd. Lands as `cwd` in the
   * synthesized `/machinen-config.json`; `/init` calls `chdir()` to
   * this path before exec'ing the cmd. Useful with `mount` /
   * `liveMounts` to land directly inside the share (e.g.
   * `guestCwd: "/mnt/workspace"`).
   *
   * Must be absolute. Throws `BOOT_CWD_INVALID` for relative paths or
   * paths containing NULs. Same precedence as `cmd`/`env`: an
   * image-baked `cwd` is overridden by this field when both are set.
   */
  guestCwd?: string;
  /**
   * Attach a scratch virtio-blk device (`/dev/vdb`, or `/dev/vda` on
   * pre-#114 layouts) so this VM can be CRIU-snapshotted later via
   * `vm.snapshot()`. Three forms:
   *
   *   - `undefined` (default) — the runtime auto-allocates a per-boot
   *     ~8 GiB sparse scratch in `tmpdir()` and unlinks it on VM exit.
   *     Disk usage stays at zero until the guest writes; the upside is
   *     every booted VM is snapshotable without re-booting. See #50.
   *
   *   - `'<path>'` — caller-managed file. Used as-is (must exist).
   *     Used by `restore()` to attach a tar archive of the bundle's
   *     CRIU images on `/dev/vdb`; the guest's
   *     `/sbin/machinen-restore` untars it and runs `criu restore`.
   *     The runtime synthesizes `cmd: ['/sbin/machinen-restore']` if
   *     no other cmd is given.
   *
   *   - `false` — opt out entirely. No `/dev/vdb` attached. Use when
   *     you don't need snapshot capability and want to skip the
   *     (sparse, but still nonzero) inode allocation — typical for
   *     fast-cycling test boots.
   */
  snapshot?: string | false;
  /**
   * Boot the guest with the rootfs on a virtio-blk device (`/dev/vda`)
   * instead of inflating the whole rootfs into a RAM-backed tmpfs via
   * the initramfs. See #114.
   *
   * Default: `true` whenever `image` is set. The runtime materializes
   * an ext4 image from `image` (cached at
   * `~/.cache/machinen/rootfs/<sha256>.img`) and attaches it as the
   * rootdisk; the guest's `/init` mounts + chroots into it before
   * running the user cmd. Materialization needs `mke2fs` (or
   * `mkfs.ext4`) on PATH — `brew install e2fsprogs` on macOS, the
   * `e2fsprogs` package on Linux.
   *
   *   - `string` — path to a pre-built ext4 `.img` file to attach
   *                directly. Skips the materialize step + cache.
   *   - `false`  — opt out: keep the cpio-as-rootfs path. The whole
   *                rootfs lands in a tmpfs at boot (RAM scales ~8×
   *                with rootfs size). Mostly an escape hatch for
   *                tooling that doesn't need disk-backed semantics
   *                (e.g. `provision()` itself).
   */
  rootDisk?: boolean | string;
  /**
   * Absolute target size (bytes) for the materialized rootdisk image.
   * Defaults to `max(2 GiB, treeBytes * 2.5)` — generous enough that
   * boot-time `npm install -g <large package>` / `apt install ...`
   * land without ENOSPC. Bump this for workloads that write more
   * (e.g. 8 GiB for a build tree, 16 GiB for a model cache).
   *
   * The host file is sparse — unused capacity costs nothing on disk
   * until the guest writes. The guest's online ext4 grow (in /init)
   * resizes the on-disk filesystem to fill the file on every boot,
   * so bumping this against an existing cached image works without
   * a rematerialize.
   *
   * Ignored when `rootDisk` is a string path (the caller-provided
   * image is taken as-is) or `rootDisk: false`. See #131.
   */
  rootDiskSizeBytes?: number;
  /**
   * Optional name to register this VM under (`attach({ name })`
   * lookup key). Path-shaped strings ("worker/9012") are allowed.
   * Names are unique while live — `boot()` throws
   * `REGISTRY_NAME_IN_USE` if another VM already holds the name.
   */
  name?: string;
  /**
   * Bookkeeping: absolute path to the snapshot bundle this VM was
   * forked from. Set by `restore({ snapDir })`; visible in
   * `machinen ls`. Plain `boot()` leaves it undefined.
   */
  forkedFrom?: string;
  /**
   * A single host directory exposed to the guest as a writable
   * filesystem rooted under `/mnt/<guest>/`. Guest writes survive
   * snapshot/restore but never leak to the host source dir.
   *
   * Implementation (#272): the runtime builds a content-addressed
   * read-only squashfs lower from `host` (cached in
   * `~/.cache/machinen/mountdisk/`) and a per-VM ext4 sparse upper
   * (4 GiB by default; bump via `mountDiskUpperSizeBytes`). Both
   * files are fd-passed to the VMM, surfacing inside the guest as
   * `/dev/vdc` (RO) and `/dev/vdd` (RW); /init layers them as a
   * single overlayfs at `<guest>/`. The squashfs lower stays
   * sealed for the VM's lifetime; writes go to the upper, which
   * is reflinked into snapshot bundles so forks see prior writes
   * without touching the source dir.
   *
   * Trade-off vs. `liveMount`: `mount` is copy-into-disk-image (no
   * runtime channel back to the host source dir, snapshots cleanly,
   * but writes don't propagate to the host); `liveMount` is a live
   * vsock-FUSE pass-through (writes land on the host, doesn't survive
   * snapshot/restore). Pick `mount` for inputs the guest may modify
   * but the host shouldn't see; `liveMount` for shared scratch.
   *
   * See #64 (original `mount`), #78 (`liveMount`), #114 (rootdisk
   * relocation; same shape), #272 (this overlay relocation).
   */
  mount?: { host: string; guest: string };
  /**
   * Absolute target size (bytes) for the per-VM ext4 RW upper of
   * the `--mount` overlay (#272). Sparse, so unused capacity costs
   * nothing on the host disk. Mirrors `rootDiskSizeBytes` (#131) —
   * over-provision so the guest has plenty of room to write into
   * the mount before hitting ENOSPC.
   *
   * Must be a positive multiple of 4096. Default 4 GiB.
   */
  mountDiskUpperSizeBytes?: number;
  /**
   * Internal: when set, skips the squashfs+ext4 materialization
   * pipeline and uses pre-existing lower/upper files (typically the
   * ones a snapshot bundle carries). Used by `restore()` to
   * reconstruct the overlay without re-running `mksquashfs` on the
   * host source dir (which may not exist on the restoring host).
   *
   * The runtime reflinks `upperPath` into a per-VM path so guest
   * writes don't mutate the bundle in-place.
   *
   * @internal
   */
  _restoreMountDisk?: {
    guest: string;
    lowerPath: string;
    upperPath: string;
  };
  /**
   * Snaplet engine restore: absolute path to the bundle's
   * `state.snaplet`. Set by `restore()` when it detects a snaplet
   * bundle. `boot()` forwards it to the VMM as `MACHINEN_RESTORE_PATH`
   * — the VMM loads that whole-VM state before the first vCPU run, so
   * the guest resumes mid-execution instead of cold-booting.
   *
   * @internal
   */
  _snapletRestorePath?: string;
  /**
   * Host directories exposed to the guest as live-share FUSE mounts
   * (#78). Unlike `mount` (copy-once into the boot rootfs), these stay
   * connected to the host: the guest reads on demand via a vsock FUSE
   * relay, and nothing is copied at boot. `mode` defaults to `"rw"` —
   * guest writes land on the host (#151, #156). Set `"ro"` for a
   * one-way share (host caches, untrusted guests).
   *
   * Each guest path must live under `/mnt/` (same rule as `mount`).
   * Repeatable; each entry gets its own vsock port.
   *
   * Snapshot / restore / fork (#273): liveMount has no guest-side
   * state worth checkpointing — reads come from the host on demand,
   * writes (in `"rw"`) land on the host immediately. The runtime
   * unmounts each mount before CRIU dumps, then re-establishes a
   * fresh window on the other side: for `vm.snapshot({ leaveRunning:
   * true })` and `vm.fork()` the source's workload sees `/mnt/<guest>/`
   * disappear for the dump duration (typically seconds, scales with
   * memory size) before reappearing under fresh server state. Open
   * fds across that window see EBADF on next syscall — same shape
   * as "don't snapshot during a database write." Workloads that
   * quiesce before snapshot are unaffected.
   *
   * Concurrent writes from multiple forks against the same host
   * directory are no different from any other shared filesystem —
   * the runtime re-establishes the window per-VM but doesn't
   * coordinate writes between siblings. If two forks need
   * non-overlapping write surfaces, point each at a distinct
   * `host` path or use `mount` (copy-once, per-VM upper).
   *
   * Restore on a host where the recorded `host` path doesn't exist:
   * fails loudly via `BOOT_MOUNT_HOST_NOT_FOUND`. Pass
   * `restore({ liveMounts: [...] })` to override per-`guest` —
   * each override entry's `guest` must match a recorded entry.
   *
   * Security note: a live-share mount gives a compromised guest a
   * persistent channel back to the host filesystem. Containment keeps
   * that bounded to the configured host root. `mount` (copy-once) has
   * no such runtime channel and is strictly safer — prefer it for
   * inputs you don't need write-through on.
   */
  liveMounts?: Array<{ host: string; guest: string; mode?: "ro" | "rw" }>;
  /**
   * Host -> guest TCP port forwards installed via gvproxy's control
   * API. Each entry maps `hostPort` on the host (bound to `hostAddr`,
   * default `127.0.0.1`) to `guestPort` inside the guest.
   */
  portForward?: Array<{ hostPort: number; guestPort: number; hostAddr?: string }>;

  // --- host/VMM-process config ---

  /**
   * Absolute or cwd-relative path to the VMM binary. Optional —
   * if omitted, `boot()` resolves it via `resolveVmmBinary()`.
   */
  binary?: string;
  /** Working directory for the VMM (for finding fixture files). */
  cwd?: string;
  /** Extra argv for the VMM. */
  args?: string[];
  /** Path to the guest kernel Image. Forwarded as `MACHINEN_KERNEL`. */
  kernel?: string;
  /** Path to the guest device-tree blob. Forwarded as `MACHINEN_DTB`. */
  dtb?: string;
  /**
   * Guest RAM ceiling, in MiB (decimal integer; no unit suffixes). The
   * VMM reads this as `MACHINEN_MEMORY` (#263 phase A). Defaults to
   * `min(host_ram_mib / 2, 16384)` with a floor of 512 — sized for
   * typical dev workloads while leaving the host responsive. The
   * ceiling is approximately free until the guest touches a page (see
   * `packages/microvm/docs/memory.md`), so over-provisioning costs
   * little until phase B's balloon lands and lets it actually shrink.
   *
   * This is documented as a debug knob — most workloads should never
   * need to set it.
   */
  memory?: number;
  /**
   * Wrap the VMM through the parent-death shim so it dies with this
   * runtime process. Default true — the right answer for the common
   * "boot, do work, exit" CLI flow.
   *
   * Set to false when the VMM is supposed to outlive the spawning
   * process. `vm.fork()` (#216) sets this so the forked sibling
   * survives `cli fork` returning. Without it, the kqueue-watching
   * shim catches the CLI exit and SIGTERMs the fork mid-startup.
   */
  pdeathsig?: boolean;
  /**
   * Milliseconds to wait in `wait()` before giving up and rejecting.
   * Defaults to 60s. Pass `null` to wait forever.
   */
  timeoutMs?: number | null;
  /**
   * Env passed to the VMM process on the host side (not exposed to the
   * guest workload). Mostly for dev/test flags like `MACHINEN_BOOT_TEST`.
   */
  vmmEnv?: Record<string, string>;
  /**
   * Streaming log callback — fires for every byte of guest output:
   * kernel console (VMM stderr) and every exec invocation made through
   * the returned handle. See `LogEvent.source` to tell them apart. See
   * #83. For per-call output-only tees on a single exec, use
   * `vm.exec({ onStdout, onStderr })` instead.
   */
  onLog?: OnLog;
  /**
   * Detach the VMM from the runtime parent so the parent can exit
   * while the VM keeps running (issue #150 phase 2). When set, `boot()`
   * blocks only until the guest produces its first console byte
   * (readiness signal) and then resolves a handle whose `.wait()` /
   * `.output()` no longer reflect the live VM — the parent has unrefed
   * the child and is free to exit.
   *
   * Forces `pdeathsig: false` (otherwise the parent's exit kills the
   * VMM, defeating the purpose). Compatible with every other boot
   * option: gvproxy + live-mount FUSE servers spawn as detached
   * daemons wrapped through `pdeathsig --watch-pid <vmm>`, and `mount`
   * (squashfs+ext4 overlay) is fd-passed to the VMM at spawn so the
   * supervisor holds no live state afterwards.
   *
   * Cleanup of per-boot reflink disks, bundle dirs, and vsock UDS
   * directories normally happens in the parent's `child.once("exit")`
   * hook. After detach the parent is gone, so those leak until the
   * follow-up `machinen gc` / `machinen stop` commands (PR2 of #150)
   * land. Use `--detached` only when you understand that trade-off.
   *
   * Reattach with `attach({ name | pid })` from another process —
   * the registry entry stays live, the vsock UDS is still listening.
   */
  detached?: boolean;
}

type MountDiskPaths = {
  lowerPath: string;
  upperPath: string;
  guest: string;
  upperSizeBytes: number;
};

/**
 * Boot a microVM and return a handle to interact with it.
 *
 * @throws {BootError} BOOT_VMM_MISSING | BOOT_VMM_PACKAGE_BROKEN |
 *   BOOT_IMAGE_NOT_FOUND | BOOT_SNAPSHOT_NOT_FOUND |
 *   BOOT_KERNEL_NOT_FOUND | BOOT_DTB_NOT_FOUND |
 *   BOOT_CMD_WITHOUT_IMAGE | BOOT_CMD_MISSING |
 *   BOOT_MOUNT_INVALID | BOOT_MOUNT_HOST_NOT_FOUND |
 *   BOOT_PORT_FORWARD_INVALID | BOOT_PORT_FORWARD_CONFLICT |
 *   BOOT_PORT_FORWARD_NO_GVPROXY | BOOT_PORT_FORWARD_IN_USE |
 *   BOOT_PACK_FAILED
 */
export async function boot(opts: BootOptions = {}): Promise<VmHandle> {
  const bootT0 = Date.now();
  // #221: per-phase wall-clock timeline emitted as one line under
  // DEBUG=machinen:boot once the VMM produces its first console byte.
  const phases = new PhaseTimer();
  debug(
    "boot entry image=%s cmd=%j name=%s portForward=%d hasSnapshot=%s mount=%s",
    opts.image ?? "<none>",
    opts.cmd ?? null,
    opts.name ?? "<unset>",
    (opts.portForward ?? []).length,
    Boolean(opts.snapshot),
    opts.mount ? `${opts.mount.host}->${opts.mount.guest}` : "<none>",
  );

  phases.start("asset-resolve");
  // #150: detached boots are compatible with every boot option. gvproxy
  // and each live-mount FUSE server spawn as detached daemons wrapped
  // through `pdeathsig --watch-pid <vmm>`; `mount` (squashfs+ext4) is
  // fd-passed to the VMM at spawn so the supervisor holds no live state
  // after that. Per-boot artifacts are tracked in the registry so
  // `machinen gc` / `machinen stop` reap them after supervisor exit.
  const portForward = opts.portForward ?? [];
  await validatePortForwardOpts(opts, portForward);

  const binaryInput = opts.binary ?? resolveVmmBinary();
  const binary = resolve(opts.cwd ?? process.cwd(), binaryInput);
  if (!existsSync(binary)) {
    throw new BootError("BOOT_VMM_MISSING", `VMM binary not found at ${binary}`);
  }
  // `cmd` requires an image to run against. `image` alone is allowed
  // — the image may carry a baked-in default cmd (see
  // `provision({ cmd })`); if it doesn't and the user didn't pass
  // one, `synthesizeAndPackBundle` errors with a clear message.
  if (opts.cmd && !opts.image) {
    throw new BootError("BOOT_CMD_WITHOUT_IMAGE", "boot: `image` is required when `cmd` is set.");
  }
  phases.end("asset-resolve");

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...opts.vmmEnv,
  };
  const memoryCeilingMib = setMemoryCeiling(opts, env);

  phases.start("disk-prep");
  const { diskAbs, perBootSnapDisk } = prepareScratchDisk(opts, env);
  phases.end("disk-prep");

  // #114: rootdisk-by-default. Boot mounts the rootfs from a
  // virtio-blk device (/dev/vda) instead of inflating the whole tree
  // into a RAM-backed tmpfs at boot. The user passes `rootDisk: false`
  // to opt back into the legacy cpio-as-rootfs path (rare — mostly for
  // tests that need to assert the initramfs path explicitly).
  // Resolution + materialization happens later, alongside packBundle,
  // so per-arg validation (mount paths, liveMount, baked-cmd) fires
  // before we spend time hashing the tarball.
  const wantsRootDisk = opts.rootDisk !== false && (opts.rootDisk !== undefined || !!opts.image);
  if (wantsRootDisk && typeof opts.rootDisk !== "string" && !opts.image) {
    throw new BootError(
      "BOOT_CMD_WITHOUT_IMAGE",
      "boot: rootDisk: true requires an `image` (the .tar.gz to materialize).",
    );
  }
  validateKernelDtb(opts, env);

  let { vsockUdsPath, vsockTempDir } = setupVsockBridge(env);
  const { statsFilePath, statsTempDir } = setupStatsFile(env, vsockTempDir);

  // Snaplet engine wiring. Every VM booted under
  // MACHINEN_SNAPSHOT_ENGINE=snaplet gets a per-VM whole-VM state
  // file the VMM dumps to on SIGUSR1 — `performSnapshotSnaplet`
  // (driven by `machinen snapshot` / `fork`) signals the VMM and
  // picks the file up. Restore is the mirror: `restore()` hands the
  // bundle's `state.snaplet` down via `_snapletRestorePath`, which we
  // forward to the VMM as MACHINEN_RESTORE_PATH so it loads that
  // whole-VM state before the first vCPU run.
  let snapletStatePath: string | undefined;
  if (resolveSnapshotEngine() === "snaplet") {
    if (!vsockTempDir) {
      vsockTempDir = mkdtempSync(join(tmpdir(), "machinen-vsock-"));
    }
    snapletStatePath = join(vsockTempDir, SNAPLET_FILE);
    env.MACHINEN_SNAPSHOT_PATH = snapletStatePath;
  }
  if (opts._snapletRestorePath) {
    env.MACHINEN_RESTORE_PATH = opts._snapletRestorePath;
  }

  // #78: resolve live-share mounts. Each gets a fresh vsock port (base
  // 1970, the band below the exec/file/secrets/winsize agents) and a
  // UDS per mount so the VMM's MACHINEN_VSOCK spec can include one
  // entry per mount. We compute these here so the port↔guest pairs can
  // be baked into machinen-config.json at pack time — the guest's
  // /init reads the same pairs and forks the FUSE agent per entry.
  let liveMountsResolved: ResolvedLiveMount[] = [];
  if ((opts.liveMounts ?? []).length > 0) {
    if (!vsockTempDir) {
      vsockTempDir = mkdtempSync(join(tmpdir(), "machinen-vsock-"));
    }
    liveMountsResolved = resolveLiveMounts(opts.liveMounts!, opts.cwd, vsockTempDir);
    for (const lm of liveMountsResolved) {
      // `out:` — the guest fuse-agent connects to (cid=2, port=lm.port);
      // when the VMM sees the REQUEST it dials the host's UDS where
      // the mount-server is listening. Using `in:` here would have the
      // VMM also listen on the UDS (clobbering the mount-server), and
      // since fuse-agent doesn't initiate, nothing would ever bridge.
      env.MACHINEN_VSOCK = `${env.MACHINEN_VSOCK},out:${lm.port}:${lm.udsPath}`;
    }
  }

  // gvproxy + host→guest port forwards (#87) are set up before the
  // VMM boots so packBundle sees a populated MACHINEN_NET_SOCKET. If
  // anything downstream throws (packBundle validation, exposePort
  // failure, nodeSpawn failure), the outer catch shuts gvproxy back
  // down — otherwise a failed boot would leave orphans behind.
  let gvStop: (() => void) | undefined;
  let gvPid: number | undefined;
  let gvExe: string | undefined;
  let gvSocketDir: string | undefined;
  const liveMountServers: DetachedMountServerHandle[] = [];
  let bundleTempDir: string | undefined;
  // #272: paths to the materialized squashfs lower + per-VM ext4
  // upper for the `--mount` overlay. The lower lives in the host
  // cache and survives this boot; the upper is per-VM and gets
  // unlinked on VM exit unless a snapshot reflinks it first.
  let mountDiskPaths: MountDiskPaths | undefined;
  let perBootMountUpper: string | undefined;
  let perBootRootDisk: string | undefined;
  const mergedGuestEnv: Record<string, string> = { ...opts.env };

  // Surface the VM name in the guest so an interactive shell prompt
  // (\h in bash's default Debian PS1) tells the user which VM they're
  // attached to. machinen-supervisor.sh consumes this and calls
  // sethostname() before spawning the workload. We don't have the host
  // VMM pid yet — that's only known after spawn — so the name-less case
  // simply doesn't set a hostname; users who want a labelled prompt
  // pass --name.
  if (opts.name && !mergedGuestEnv.MACHINEN_VM_NAME) {
    mergedGuestEnv.MACHINEN_VM_NAME = opts.name;
  }

  try {
    phases.start("net-services");
    phases.start("net-services.gvproxy");
    const gv = await bringUpGvproxy(opts, binary, env, portForward);
    gvStop = gv.gvStop;
    gvPid = gv.gvPid;
    gvExe = gv.gvExe;
    gvSocketDir = gv.gvSocketDir;
    phases.end("net-services.gvproxy");
    // #78: live-share servers used to spawn here, before the VMM. As
    // of #150 phase 3 they're standalone helpers wrapped through
    // pdeathsig --watch-pid, so we need the VMM's pid first. The
    // helpers spawn after `vmm-spawn` below — the guest's fuse-agent
    // doesn't dial until userspace is up, so the ~50ms helper-spawn
    // delay is invisible.
    phases.end("net-services");

    // Pack an initramfs whenever the guest needs userspace (image +
    // cmd + snapshot-only restore all need /init + synthesized
    // machinen-config.json). Test-mode zig boots fall through with no
    // INITRD env set — the VMM uses its own fixture initramfs.
    if (opts.image || opts.cmd || opts.snapshot) {
      phases.start("initramfs-pack");
      const packed = synthesizeAndPackBundle(opts, mergedGuestEnv, liveMountsResolved, {
        useTiny: wantsRootDisk,
        env,
        mountDiskUpperSizeBytes: opts.mountDiskUpperSizeBytes,
        onPhase: (name, ms) => phases.mark(`initramfs-pack.${name}`, ms),
      });
      bundleTempDir = packed.tempDir;
      env.MACHINEN_INITRD = packed.cpioPath;
      // #272: stash the materialized squashfs lower / ext4 upper so
      // the spawn block can openSync + fd-pass them. The per-VM upper
      // gets unlinked on VM exit alongside the per-boot rootdisk
      // reflink; the lower stays in the host cache.
      mountDiskPaths = packed.mountDisk;
      const packMs = phases.end("initramfs-pack");
      debug("initramfs packed cpio=%s elapsed=%dms", packed.cpioPath, packMs ?? -1);
    }

    // #114: rootDisk materialization. After all input validation has
    // passed (so a bad mount path or missing image fails before we
    // hash a multi-GB tarball). On a cache hit this is a few ms.
    phases.start("rootdisk-materialize");
    if (wantsRootDisk) {
      perBootRootDisk = materializeRootdisk(opts, env, phases);
    }
    phases.end("rootdisk-materialize");
  } catch (err) {
    // No live-mount helpers yet at this point (they spawn post-VMM,
    // see #150 phase 3) — only the gv + per-boot disks need rolling
    // back. The post-VMM mount-server failure path below has its own
    // inline cleanup that includes SIGKILLing the VMM.
    rollbackPreSpawn({
      gvStop,
      bundleTempDir,
      vsockTempDir,
      perBootRootDisk,
      perBootSnapDisk,
      perBootMountUpper,
    });
    throw err;
  }

  // Wrap through the parent-death shim so the VMM dies with the
  // runtime instead of orphaning to PID 1 holding the rootdisk fd and
  // ~1.7 GiB RSS (#200). Mirrors `spawnGvproxy`. Falls through to a
  // direct spawn if the shim is unavailable (no `cc`, opted-out,
  // unsupported platform).
  //
  // Detached mode (#150) explicitly wants the orphan: the parent CLI
  // exits while the VMM keeps running. Force pdeathsig off, ignoring
  // any caller value, since both `pdeathsig: true` and the default
  // `undefined` would otherwise SIGTERM the VMM the moment the parent
  // exits.
  phases.start("vmm-spawn");
  const vmmPdeathsig = opts.detached || opts.pdeathsig === false ? null : await ensurePdeathsig();
  const wrappedVmm = wrapWithPdeathsig(vmmPdeathsig, binary, opts.args ?? []);
  const stdio: Array<"pipe" | number> = ["pipe", "pipe", "pipe"];
  const mountDiskFds = mountDiskPaths ? openMountDiskFds(mountDiskPaths, env, stdio) : undefined;
  if (mountDiskPaths) {
    perBootMountUpper = mountDiskPaths.upperPath;
  }
  const child = nodeSpawn(wrappedVmm.command, wrappedVmm.args, {
    cwd: opts.cwd,
    env,
    stdio,
  }) as ChildProcessWithoutNullStreams;
  // The child has dup'd both fds; close our copies in the parent so
  // the file isn't held open beyond what the child needs. Closing
  // here is safe — the child has its own dup'd fd via posix_spawn /
  // libuv's fd inheritance.
  if (mountDiskFds) {
    closeFds(mountDiskFds.lowerFd, mountDiskFds.upperFd);
  }
  phases.end("vmm-spawn");
  // first-guest-byte starts ticking from VMM-spawn — that's the point
  // after which any console output is real guest progress.
  phases.start("first-guest-byte");
  debug(
    "VMM spawned pid=%d binary=%s wrapped=%s elapsedSinceEntry=%dms",
    child.pid ?? -1,
    binary,
    vmmPdeathsig ? "yes" : "no",
    Date.now() - bootT0,
  );

  // #98: register the running VM so another process can attach. The
  // entry is keyed by pid (kernel-unique while alive); optional name
  // lets `attach({ name })` look it up by something memorable.
  //
  // INVARIANT (#150 phase 2): name claim + registry write must
  // complete synchronously before any `await` — in particular,
  // before the readiness gate further down can call `handle.detach()`
  // and unref the child. Detaching a name-conflict losers' child
  // means the SIGKILL above wouldn't reach an orphaned-to-PID-1 VMM.
  // Today the structure enforces this (no awaits between here and
  // the gate); don't reorder.
  const vmName = opts.name;
  // Resolved once: shared by the registry entry and any future snapshot
  // ctx so the bundle's meta.json points at the same absolute path the
  // source booted from. Cheap (just a path resolve), so unconditional.
  const sourceImageAbs = opts.image ? resolve(opts.cwd ?? process.cwd(), opts.image) : undefined;
  const childPid = child.pid ?? -1;
  if (vmName && childPid > 0) {
    claimNameOrThrow(vmName, childPid, child);
  }
  // #150 phase 2: detached VMs record where the boot-console snapshot
  // will land so `attach` / `ls` / `gc` can find it later.
  const bootLogPath = opts.detached && childPid > 0 ? bootSnapshotPath(childPid) : undefined;
  // #150 phase 2 PR2: persist per-boot artifacts in the registry so
  // `machinen gc` / `machinen stop` can clean them up after the
  // parent has exited.
  const cleanupPaths = collectCleanupPaths({
    perBootRootDisk,
    perBootSnapDisk,
    perBootMountUpper,
    bundleTempDir,
    vsockTempDir,
    statsTempDir,
    gvSocketDir,
  });
  const registered =
    childPid > 0 && vsockUdsPath
      ? registerInRegistry({
          childPid,
          vmName,
          vsockUdsPath,
          sourceImageAbs,
          diskAbs,
          forkedFrom: opts.forkedFrom,
          bootLogPath,
          cleanupPaths,
          binary,
          vmmPdeathsig,
          gvPid,
          gvExe,
          portForward,
          memoryCeilingMib,
          statsFilePath,
          mountDiskPaths,
          liveMountsResolved,
          snapletStatePath,
        })
      : false;

  installVmExitCleanup({
    child,
    childPid,
    bootT0,
    perBootRootDisk,
    perBootSnapDisk,
    perBootMountUpper,
    bundleTempDir,
    vsockTempDir,
    statsTempDir,
    gvStop,
    liveMountServers,
    registered,
  });

  const timeoutMs = opts.timeoutMs === undefined ? 60_000 : opts.timeoutMs;

  // Start collecting stdout/stderr eagerly. Doing it lazily on the
  // first call to `.output()` / `.errorOutput()` loses data: the
  // streams can flush + close before the listener attaches, and more
  // importantly, the child backpressures if no one is reading (the
  // PL011 echo path writes a lot of bytes during kernel boot, enough
  // to fill a pipe buffer if nothing's draining it).
  //
  // `collect()` ring-buffers to `CONSOLE_TAIL_BYTES` so a multi-hour
  // VM doesn't drag the supervisor toward OOM (issue #150).
  const outputCollector = collect(child.stdout);
  const errorCollector = collect(child.stderr);
  const onLog = opts.onLog;
  if (onLog) {
    child.stderr.on("data", (chunk: Buffer) => {
      onLog({ source: "guest-console", chunk });
    });
  }
  // DEBUG=machinen:vmm tees the VMM's stderr (kernel + early-userspace
  // console) to the host stderr in real time. Replaces the legacy
  // MACHINEN_BUILD_DEBUG flag.
  if (vmmDebug.enabled) {
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
  }
  installFlushPhases(child, phases, onLog);

  // #150 phase 2: in-flight ring buffer of stderr captured *only* for
  // detached boots, dumped to `bootLogPath` once readiness fires. The
  // existing `errorCollector` resolves on stream close — too late for
  // the detach handoff. Capped at the same `CONSOLE_TAIL_BYTES` Phase 1
  // uses, so a slow boot can't balloon the supervisor heap before
  // detach completes.
  const detachedBootChunks: Buffer[] = [];
  if (opts.detached) {
    installDetachedBootCapture(child, detachedBootChunks);
  }

  // #150 phase 3: spawn the live-share mount servers as detached
  // helpers parented (via pdeathsig --watch-pid) to the VMM. The
  // helpers survive supervisor exit and die with the VMM. Spawned
  // here so we have child.pid to watch and the exit hook above is
  // already registered (it iterates `liveMountServers` for stop).
  // On failure: SIGKILL the VMM; the exit hook reaps everything
  // including helpers we did manage to start.
  if (liveMountsResolved.length > 0) {
    phases.start("net-services.live-mounts");
    await spawnLiveMountServersForBoot({
      liveMountsResolved,
      childPid,
      child,
      registered,
      liveMountServers,
    });
    phases.end("net-services.live-mounts");
  }

  const handle: VmHandle = {
    pid: childPid,
    name: vmName,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    wait: makeWait(child, timeoutMs),
    kill: makeKill(child),
    output: () => outputCollector,
    errorOutput: () => errorCollector,

    async detach() {
      // Drop the locally-booted process's hold without killing it:
      // unref stdio and unregister from the registry. The VMM keeps
      // running; `attach({ name | id })` from another process can
      // pick it back up via the vsock UDS, which is *not* cleaned up
      // on detach (only on VMM exit).
      child.stdin.end();
      child.unref();
      // Intentionally leave the registry entry in place — detach means
      // "someone else will attach," not "this VM is gone."
    },

    async exec(cmd, execOpts) {
      if (!vsockUdsPath) {
        throw new ExecError(
          "EXEC_VSOCK_UNAVAILABLE",
          "vm.exec: no vsock UDS available — MACHINEN_VSOCK was set to an " +
            "unrecognized spec. Expected `in:<port>:<uds-path>`.",
        );
      }
      const res = await VsockExec.run(vsockUdsPath, cmd, teeOnLog(cmd, execOpts, onLog));
      if (res.exitCode !== 0) {
        throw new ExecError(
          "EXEC_NONZERO_EXIT",
          `vm.exec failed (code ${res.exitCode}): ${cmd}\nstderr:\n${res.stderr}`,
        );
      }
      return res;
    },

    execRaw(cmd, execOpts) {
      if (!vsockUdsPath) {
        return Promise.reject(
          new ExecError(
            "EXEC_VSOCK_UNAVAILABLE",
            "vm.execRaw: no vsock UDS available — MACHINEN_VSOCK was set to " +
              "an unrecognized spec. Expected `in:<port>:<uds-path>`.",
          ),
        );
      }
      return VsockExec.run(vsockUdsPath, cmd, teeOnLog(cmd, execOpts, onLog));
    },

    execPty(cmd, ptyOpts) {
      if (!vsockUdsPath) {
        // Synchronous-handle API can't reject like execRaw — surface
        // a handle whose `result` is already a rejected promise.
        const err = new ExecError(
          "EXEC_VSOCK_UNAVAILABLE",
          "vm.execPty: no vsock UDS available — MACHINEN_VSOCK was set to " +
            "an unrecognized spec. Expected `in:<port>:<uds-path>`.",
        );
        return {
          result: Promise.reject(err),
          resize: () => {},
          cancel: () => {},
        };
      }
      return VsockExec.startPty(vsockUdsPath, cmd, ptyOpts);
    },

    async writeFile(guestPath, contents, writeOpts) {
      for (const cmd of buildWriteFileCmds(guestPath, contents, writeOpts)) {
        await this.exec(cmd);
      }
    },

    async memoryStats(): Promise<MemoryStats> {
      const balloon = statsFilePath ? readBalloonStats(statsFilePath) : null;
      // Re-read the registry for lazy bookkeeping — restore() patches
      // the entry with `lazyPagesTotal` after boot returns, and the
      // handle was constructed before that patch.
      const cur = findEntry({ pid: childPid });
      const lazyTotal = cur?.lazyPagesTotal ?? 0;
      let bytesServed = 0;
      for (const server of liveMountServers) {
        bytesServed += server.bytesServedOnPagesImg();
      }
      const pagesServed = Math.floor(bytesServed / 4096);
      return {
        ceilingMib: memoryCeilingMib ?? null,
        hostRssBytes: readHostRssBytes(childPid, statsFilePath),
        balloonInflatedBytes: balloon?.bytesReported ?? 0,
        lazyPagesPending: Math.max(0, lazyTotal - pagesServed),
      };
    },

    async snapshot(snapshotOpts) {
      // The criu engine writes its images onto the scratch disk; the
      // snaplet engine dumps the whole VM to a host file and needs no
      // guest-side scratch.
      if (resolveSnapshotEngine() === "criu" && !diskAbs) {
        throw new SnapshotError(
          "SNAPSHOT_NO_DISK",
          "vm.snapshot: this VM was booted with `snapshot: false` (no scratch " +
            "disk attached). Re-boot without that flag — the runtime will " +
            "auto-allocate a sparse scratch — or pass `snapshot: '<path>'`.",
        );
      }
      return performSnapshot(buildBootSnapshotContext(), snapshotOpts);
    },

    async fork(forkOpts) {
      if (resolveSnapshotEngine() === "criu" && !diskAbs) {
        throw new SnapshotError(
          "SNAPSHOT_NO_DISK",
          "vm.fork: source VM has no scratch disk (booted with `snapshot: false`). " +
            "Re-boot the source without that flag so it can be snapshotted.",
        );
      }
      return performFork(buildBootSnapshotContext(), forkOpts ?? {});
    },
  };

  // #273: shared snapshot-context builder for the boot-owned
  // `snapshot()` and `fork()` paths. Threads the live-share mount
  // config + lifecycle hooks through to performSnapshot so it can:
  //   - record `liveMounts` in the bundle's meta.json,
  //   - tear down the host-side mount-server instances after the
  //     dump completes (the guest's preflight already unmounted),
  //   - respawn fresh ones on the same UDSes for `leaveRunning` so
  //     `/sbin/machinen-remount` reconnects to clean state.
  // For attach-handle snapshots, the registry doesn't carry the
  // resolved config so a parallel ctx omits these fields — see
  // attach()'s snapshot() implementation below.
  function buildBootSnapshotContext(): SnapshotContext {
    const liveMountsForCtx =
      liveMountsResolved.length > 0
        ? liveMountsResolved.map((lm) => ({
            host: lm.host,
            guest: lm.guest,
            mode: lm.mode,
          }))
        : undefined;
    return {
      pid: childPid,
      sourceName: vmName,
      sourceImage: sourceImageAbs,
      diskPath: diskAbs!,
      mountDisk: mountDiskPaths
        ? {
            guest: mountDiskPaths.guest,
            lowerPath: mountDiskPaths.lowerPath,
            upperPath: mountDiskPaths.upperPath,
          }
        : undefined,
      liveMounts: liveMountsForCtx,
      snapletPath: snapletStatePath,
      stopLiveMountServers: liveMountsForCtx
        ? async () => {
            // Stop in place, then clear the array so the boot exit
            // hook doesn't double-stop. Idempotent stops are safe but
            // the array is also the source of truth for memoryStats's
            // bytesServedOnPagesImg sum — stale handles would skew that.
            await Promise.all(liveMountServers.map((s) => s.stop().catch(() => {})));
            liveMountServers.length = 0;
          }
        : undefined,
      respawnLiveMountServers: liveMountsForCtx
        ? async () => {
            // Fresh inode + handle tables. Same UDS path so the
            // guest's re-fork'd fuse-agent (started via vsock-exec
            // of /sbin/machinen-remount) reconnects to a listening
            // server. memoryStats's lazy-pages accounting resets to
            // zero, which is correct — restored guests start a new
            // fault stream.
            //
            // The respawned helpers watch the same VMM pid as the
            // originals — even after a CRIU restore the kernel pid
            // doesn't change.
            for (const lm of liveMountsResolved) {
              const fresh = await spawnDetachedMountServer({
                udsPath: lm.udsPath,
                rootAbs: lm.host,
                mode: lm.mode,
                vmmPid: childPid,
                statsPath: lm.statsPath,
              });
              liveMountServers.push(fresh);
            }
          }
        : undefined,
      execRaw: (cmd, execOpts) => handle.execRaw(cmd, execOpts),
      wait: () => handle.wait(),
      kill: () => handle.kill(),
      teeGuestConsole: (onChunk) => {
        child.stderr.on("data", onChunk);
      },
      errorOutput: () => handle.errorOutput(),
    };
  }

  // Set a per-VM kernel hostname so `\h` prompts and other
  // hostname-aware tooling can tell VMs apart. Fire-and-forget
  // over vsock — for fresh boots this races bash startup, so a
  // workload shell may still cache the kernel's pre-call value
  // (`(none)` on Linux). Subsequent shells (e.g. via
  // `machinen attach`) read the post-call value. Suppressed when
  // we have no vsock UDS (boot-without-exec-agent paths).
  if (vsockUdsPath) {
    void setGuestHostname(handle, buildGuestHostname(handle.pid, handle.name));
  }

  if (opts.detached && bootLogPath) {
    await gateOnDetachedReadiness({
      child,
      timeoutMs,
      bootLogPath,
      detachedBootChunks,
      handle,
    });
  }

  return handle;
}

// =============================================================
// Helpers
// =============================================================

// Validate portForward up front — before resolving the binary or
// touching the filesystem — so caller-input errors surface with a
// clear message. The env-dependent "pre-set MACHINEN_NET_SOCKET"
// check happens alongside since it only reads env.
async function validatePortForwardOpts(
  opts: BootOptions,
  portForward: NonNullable<BootOptions["portForward"]>,
): Promise<void> {
  if (portForward.length === 0) {
    return;
  }
  const preSetNetSock =
    (opts.vmmEnv && opts.vmmEnv.MACHINEN_NET_SOCKET) || process.env.MACHINEN_NET_SOCKET;
  if (preSetNetSock) {
    throw new BootError(
      "BOOT_PORT_FORWARD_INVALID",
      "portForward requires the runtime to own gvproxy, but MACHINEN_NET_SOCKET " +
        "is already set. Either drop the env var or install the forwards yourself " +
        "against your gvproxy's control API.",
    );
  }
  const seen = new Set<number>();
  for (const m of portForward) {
    for (const [label, port] of [
      ["hostPort", m.hostPort],
      ["guestPort", m.guestPort],
    ] as const) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new BootError(
          "BOOT_PORT_FORWARD_INVALID",
          `portForward: ${label} must be an integer in 1..65535 (got ${port})`,
        );
      }
    }
    if (seen.has(m.hostPort)) {
      throw new BootError(
        "BOOT_PORT_FORWARD_CONFLICT",
        `portForward: duplicate hostPort ${m.hostPort}`,
      );
    }
    seen.add(m.hostPort);
  }
  // Pre-flight bind probe per requested host port. Without this,
  // gvproxy's control API surfaces `address already in use` as an
  // opaque GVPROXY_EXPOSE_FAILED 500 *after* we've spawned it. The
  // common cause is an orphaned gvproxy from a prior `kill -9` of
  // the runtime — the kernel reparents it to PID 1 and it keeps
  // holding the host port. Surface the orphan hypothesis directly
  // so the user knows what to clean up. See #115.
  for (const m of portForward) {
    const host = m.hostAddr ?? "127.0.0.1";
    const errno = await probeHostPortFree(host, m.hostPort);
    if (!errno) {
      continue;
    }
    // Best-effort: name the offending PID and flag whether it's
    // machinen-owned. lsof failures are non-fatal — fall back to the
    // generic orphan-gvproxy hypothesis so the message still helps.
    const holder = await describePortHolder(m.hostPort).catch(() => null);
    const detail = holder
      ? `${holder}.`
      : "Common cause: an orphaned gvproxy from a prior `kill -9` of the VMM. " +
        "Try `pkill -f gvproxy` to clear it, or pick a different host port.";
    throw new BootError(
      "BOOT_PORT_FORWARD_IN_USE",
      `portForward: host port ${host}:${m.hostPort} is already in use (${errno}). ${detail}`,
    );
  }
}

// #263 phase A: forward the guest RAM ceiling so the VMM doesn't
// fall back to its boot_*.zig hardcoded default. An explicit caller
// value via vmmEnv wins over our auto-size; that's the documented
// debug-knob escape hatch. Returns the resolved ceiling so it can be
// persisted on the registry entry; undefined when caller pre-set
// MACHINEN_MEMORY (the runtime didn't pick the number, so it can't
// honestly report it).
function setMemoryCeiling(opts: BootOptions, env: Record<string, string>): number | undefined {
  if (env.MACHINEN_MEMORY !== undefined) {
    return undefined;
  }
  const ceiling = opts.memory !== undefined ? validateMemoryMib(opts.memory) : autoSizeMemoryMib();
  env.MACHINEN_MEMORY = String(ceiling);
  return ceiling;
}

// The scratch virtio-blk device serves two unrelated workloads:
//   - caller-supplied path (string): a CRIU snapshot bundle to
//     restore from at boot — the runtime synthesizes
//     /sbin/machinen-restore when no cmd is given. The bundle is
//     reflink-cloned into a per-boot path so a future `vm.snapshot()`
//     against the restored VM doesn't corrupt the source bundle
//     when machinen-dump.sh re-formats the disk (#207).
//   - default (undefined): per-boot sparse scratch so any VM is
//     CRIU-dumpable later via vm.snapshot(). 8 GiB sparse means zero
//     real disk until the guest writes; cleaned up alongside the
//     rootdisk reflink on VM exit. Don't synthesize restore for this
//     case (the file is empty).
//   - `false`: opt out, no /dev/vdb. Test-fast paths use this.
function prepareScratchDisk(
  opts: BootOptions,
  env: Record<string, string>,
): { diskAbs: string | undefined; perBootSnapDisk: string | undefined } {
  if (opts.snapshot === false) {
    return { diskAbs: undefined, perBootSnapDisk: undefined };
  }
  if (typeof opts.snapshot === "string") {
    const bundleDisk = resolve(opts.cwd ?? process.cwd(), opts.snapshot);
    if (!existsSync(bundleDisk)) {
      throw new BootError("BOOT_SNAPSHOT_NOT_FOUND", `snapshot image not found: ${bundleDisk}`);
    }
    // An explicit `cmd` means the caller is running their own workload
    // (e.g. provision()'s tar-to-/dev/vdb dump), not restoring a CRIU
    // bundle — so attach the disk in place. The reflink-clone below is
    // only needed for the restore path, where machinen-dump.sh later
    // mkfs's the scratch disk and would otherwise corrupt the source
    // bundle on the host fs (#207).
    if (opts.cmd) {
      env.MACHINEN_DISK = bundleDisk;
      debug("snap-restore in-place (explicit cmd) path=%s", bundleDisk);
      return { diskAbs: bundleDisk, perBootSnapDisk: undefined };
    }
    // Reflink-clone the bundle disk into a per-boot path so the
    // restored VM can be snapshotted again (#207). Same pattern as
    // #121 for the rootdisk: COPYFILE_FICLONE → cheap shared blocks
    // until guest writes, falls back to a full copy on non-reflink
    // filesystems.
    const perBoot = join(
      tmpdir(),
      `machinen-snap-restore-${process.pid}-${randomBytes(6).toString("hex")}.img`,
    );
    reflinkCopy(bundleDisk, perBoot);
    env.MACHINEN_DISK = perBoot;
    debug("snap-restore reflink-clone src=%s dst=%s", bundleDisk, perBoot);
    return { diskAbs: perBoot, perBootSnapDisk: perBoot };
  }
  if (!opts.image) {
    return { diskAbs: undefined, perBootSnapDisk: undefined };
  }
  // Auto-allocate only when the caller is booting a real image-backed
  // guest. VMM-only smoke boots (no image — e.g. MACHINEN_BOOT_TEST=1)
  // would otherwise be handed a zero-byte file as /dev/vda, failing
  // root mount; they have nothing to snapshot anyway. `cmd && !image`
  // already errors above, so this check covers all snapshotable
  // workload paths.
  const scratchPath = join(
    tmpdir(),
    `machinen-snap-${process.pid}-${randomBytes(6).toString("hex")}.img`,
  );
  allocateSparseFile(scratchPath, SNAP_SCRATCH_BYTES);
  env.MACHINEN_DISK = scratchPath;
  debug("snap-scratch auto path=%s sizeBytes=%d", scratchPath, SNAP_SCRATCH_BYTES);
  return { diskAbs: scratchPath, perBootSnapDisk: scratchPath };
}

function validateKernelDtb(opts: BootOptions, env: Record<string, string>): void {
  if (opts.kernel) {
    const abs = resolve(opts.cwd ?? process.cwd(), opts.kernel);
    if (!existsSync(abs)) {
      throw new BootError("BOOT_KERNEL_NOT_FOUND", `kernel not found: ${abs}`);
    }
    env.MACHINEN_KERNEL = abs;
  }
  if (opts.dtb) {
    const abs = resolve(opts.cwd ?? process.cwd(), opts.dtb);
    if (!existsSync(abs)) {
      throw new BootError("BOOT_DTB_NOT_FOUND", `dtb not found: ${abs}`);
    }
    env.MACHINEN_DTB = abs;
  }
}

// #94: always wire up a vsock UDS bridge so `vm.exec()` works out of
// the box. Callers who set their own `MACHINEN_VSOCK` (e.g. the build
// flow) win — we parse their spec to extract the UDS path for exec.
function setupVsockBridge(env: Record<string, string>): {
  vsockUdsPath: string | undefined;
  vsockTempDir: string | undefined;
} {
  if (env.MACHINEN_VSOCK) {
    const vsockUdsPath = parseVsockUdsPath(env.MACHINEN_VSOCK);
    debug(
      "vsock spec from caller env: %s (uds=%s)",
      env.MACHINEN_VSOCK,
      vsockUdsPath ?? "<unparsed>",
    );
    return { vsockUdsPath, vsockTempDir: undefined };
  }
  const vsockTempDir = mkdtempSync(join(tmpdir(), "machinen-vsock-"));
  const vsockUdsPath = join(vsockTempDir, "exec.sock");
  env.MACHINEN_VSOCK = `in:1978:${vsockUdsPath}`;
  debug("vsock auto uds=%s", vsockUdsPath);
  return { vsockUdsPath, vsockTempDir };
}

// #274: shared stats file the balloon backend writes counters to.
// 16 bytes (two u64 LE atomics, see balloon-stats.ts + stats.zig).
// Pre-allocated zero-filled here so the VMM's mmap'd writer and our
// host-side reader see a coherent layout even before the first
// reporting chain. Co-located under `vsockTempDir` when we own one
// (so cleanup rides along on its rmSync); otherwise allocated in
// tmpdir() with its own cleanup entry. Skipped when the caller
// already pre-set `MACHINEN_STATS_FILE` (debug knob).
function setupStatsFile(
  env: Record<string, string>,
  vsockTempDir: string | undefined,
): { statsFilePath: string | undefined; statsTempDir: string | undefined } {
  if (env.MACHINEN_STATS_FILE !== undefined) {
    return { statsFilePath: env.MACHINEN_STATS_FILE, statsTempDir: undefined };
  }
  let statsTempDir: string | undefined;
  let statsFilePath: string;
  if (vsockTempDir) {
    statsFilePath = join(vsockTempDir, "stats.bin");
  } else {
    statsTempDir = mkdtempSync(join(tmpdir(), "machinen-stats-"));
    statsFilePath = join(statsTempDir, "stats.bin");
  }
  const fd = openSync(statsFilePath, "w");
  try {
    writeSync(fd, Buffer.alloc(16), 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  env.MACHINEN_STATS_FILE = statsFilePath;
  return { statsFilePath, statsTempDir };
}

interface GvproxyResult {
  gvStop: (() => void) | undefined;
  gvPid: number | undefined;
  gvExe: string | undefined;
  gvSocketDir: string | undefined;
}

async function bringUpGvproxy(
  opts: BootOptions,
  binary: string,
  env: Record<string, string>,
  portForward: NonNullable<BootOptions["portForward"]>,
): Promise<GvproxyResult> {
  if (env.MACHINEN_NET_SOCKET) {
    debug("MACHINEN_NET_SOCKET already set — skipping gvproxy spawn");
    return { gvStop: undefined, gvPid: undefined, gvExe: undefined, gvSocketDir: undefined };
  }
  // Auto-install gvproxy on first use if not already resolvable —
  // visible stderr line; cached under ~/.machinen so subsequent
  // boots are silent. See #83 follow-up.
  const gvBin = await ensureGvproxy(binary);
  if (!gvBin) {
    if (portForward.length > 0) {
      throw new BootError(
        "BOOT_PORT_FORWARD_NO_GVPROXY",
        "portForward requires gvproxy, but no gvproxy binary was found. " +
          "Install gvproxy or point MACHINEN_GVPROXY at one.",
      );
    }
    debug("gvproxy not found — booting without networking");
    warnGvproxyMissing();
    return { gvStop: undefined, gvPid: undefined, gvExe: undefined, gvSocketDir: undefined };
  }
  debug("starting gvproxy bin=%s", gvBin);
  // Detach gvproxy alongside the VMM so the parent can exit
  // without stranding the guest's networking (#150 phase 2 PR3).
  const gv = await spawnGvproxy(gvBin, { detached: opts.detached });
  env.MACHINEN_NET_SOCKET = gv.socketPath;
  for (const m of portForward) {
    await exposePort(gv.controlSocketPath, m);
  }
  return {
    gvStop: gv.stop,
    gvPid: gv.child.pid,
    gvExe: gvBin,
    gvSocketDir: gv.socketDir,
  };
}

// Materialize the rootdisk image and reflink it into a per-boot path
// so guest writes don't leak across boots. Returns the per-boot
// reflink path so the exit hook can unlink it; undefined when the
// caller passed a pre-built image (`rootDisk: '<path>'`) — that
// file's lifecycle is the caller's.
function materializeRootdisk(
  opts: BootOptions,
  env: Record<string, string>,
  phases: PhaseTimer,
): string | undefined {
  if (typeof opts.rootDisk === "string") {
    const rootDiskAbs = resolve(opts.cwd ?? process.cwd(), opts.rootDisk);
    if (!existsSync(rootDiskAbs)) {
      throw new BootError("BOOT_IMAGE_NOT_FOUND", `rootDisk image not found: ${rootDiskAbs}`);
    }
    env.MACHINEN_ROOTDISK = rootDiskAbs;
    return undefined;
  }
  // #121: hand the VMM a per-boot reflink clone of the cached
  // template, never the template itself. virtio-blk mounts the
  // image read-write, so without the clone every boot from the
  // same tarball would inherit the previous boot's writes
  // (apt installs leaking, /var/log poisoning, two concurrent
  // boots stomping each other's filesystem). COPYFILE_FICLONE →
  // APFS clonefile / Linux FICLONE on reflink-capable fs (free,
  // shared blocks until the guest writes); falls back to a
  // regular copy elsewhere (one-time cost, sparse).
  const baseAbs = resolve(opts.cwd ?? process.cwd(), opts.image!);
  const cachedImg = ensureRootfsImage(baseAbs, {
    sizeBytes: opts.rootDiskSizeBytes,
    // #233 follow-up: surface the sub-steps of ensureRootfsImage
    // (sha256, e2fsck, sparse-extend, …) as dot-separated
    // children of `rootdisk-materialize` in the boot timeline.
    onPhase: (name, ms) => phases.mark(`rootdisk-materialize.${name}`, ms),
  });
  const perBoot = join(
    tmpdir(),
    `machinen-rootdisk-${process.pid}-${randomBytes(6).toString("hex")}.img`,
  );
  const reflinkT0 = Date.now();
  reflinkCopy(cachedImg, perBoot);
  phases.mark("rootdisk-materialize.reflink", Date.now() - reflinkT0);
  // The cache file was only READ here — restore the
  // clean-shutdown marker so the next boot finds a usable
  // template instead of wiping and rematerializing (#170).
  markRootfsImageClean(cachedImg);
  env.MACHINEN_ROOTDISK = perBoot;
  return perBoot;
}

// Roll back gvproxy + per-boot disks/dirs after a pre-spawn failure.
// No live-mount helpers exist yet at this point (they spawn post-VMM
// in #150 phase 3) — only the gv + per-boot disks need rolling back.
function rollbackPreSpawn(state: {
  gvStop: (() => void) | undefined;
  bundleTempDir: string | undefined;
  vsockTempDir: string | undefined;
  perBootRootDisk: string | undefined;
  perBootSnapDisk: string | undefined;
  perBootMountUpper: string | undefined;
}): void {
  if (state.gvStop) {
    state.gvStop();
  }
  for (const dir of [state.bundleTempDir, state.vsockTempDir]) {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }
  for (const file of [state.perBootRootDisk, state.perBootSnapDisk, state.perBootMountUpper]) {
    if (file) {
      try {
        unlinkSync(file);
      } catch {}
    }
  }
}

// #272: openSync the squashfs lower (O_RDONLY) and the per-VM ext4
// upper (O_RDWR) and append both fds to `stdio` so the VMM child
// inherits them. The child receives them at array indexes 3 and 4,
// so we tell the VMM to wrap fds 3 and 4 as the slot-5 / slot-6
// virtio-blk backends via env vars. The host source dir is never
// opened by the child — the fds are the only handle into the payload.
function openMountDiskFds(
  mountDiskPaths: MountDiskPaths,
  env: Record<string, string>,
  stdio: Array<"pipe" | number>,
): { lowerFd: number; upperFd: number } {
  let lowerFd: number | undefined;
  let upperFd: number | undefined;
  try {
    lowerFd = openSync(mountDiskPaths.lowerPath, "r");
    upperFd = openSync(mountDiskPaths.upperPath, "r+");
  } catch (err) {
    if (lowerFd !== undefined) {
      try {
        closeSync(lowerFd);
      } catch {}
    }
    throw new BootError(
      "BOOT_MOUNTDISK_TOOL_MISSING",
      `boot: failed to open mountdisk fd: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  stdio.push(lowerFd, upperFd);
  env.MACHINEN_MOUNTDISK_LOWER_FD = "3";
  env.MACHINEN_MOUNTDISK_UPPER_FD = "4";
  return { lowerFd, upperFd };
}

function closeFds(...fds: number[]): void {
  for (const fd of fds) {
    try {
      closeSync(fd);
    } catch {}
  }
}

// Backstop for the recycled-pid case: `claimName` already drops pins
// whose holder fails the recycling/orphan check, but a pre-#268 entry
// without `vmmExe`/`startedAt` falls back to `kill(pid,0)` and can
// stay pinned by an unrelated process now sitting on the recycled
// pid. `runGc` walks the whole registry (also cleaning cleanupPaths)
// and we retry the claim once. If a still-live VMM genuinely holds
// the name, the retry fails and we throw.
function claimNameOrThrow(
  vmName: string,
  childPid: number,
  child: ChildProcessWithoutNullStreams,
): void {
  if (claimName(vmName, childPid)) {
    return;
  }
  runGc();
  if (claimName(vmName, childPid)) {
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch {}
  throw new RegistryError(
    "REGISTRY_NAME_IN_USE",
    `boot: name '${vmName}' is already held by another live VM. ` +
      `Pick a different --name or kill the existing VM first.`,
  );
}

function collectCleanupPaths(state: {
  perBootRootDisk: string | undefined;
  perBootSnapDisk: string | undefined;
  perBootMountUpper: string | undefined;
  bundleTempDir: string | undefined;
  vsockTempDir: string | undefined;
  statsTempDir: string | undefined;
  gvSocketDir: string | undefined;
}): string[] {
  const paths: string[] = [];
  for (const p of [
    state.perBootRootDisk,
    state.perBootSnapDisk,
    state.perBootMountUpper,
    state.bundleTempDir,
    state.vsockTempDir,
    state.statsTempDir,
    state.gvSocketDir,
  ]) {
    if (p) {
      paths.push(p);
    }
  }
  return paths;
}

interface RegisterArgs {
  childPid: number;
  vmName: string | undefined;
  vsockUdsPath: string;
  sourceImageAbs: string | undefined;
  diskAbs: string | undefined;
  forkedFrom: string | undefined;
  bootLogPath: string | undefined;
  cleanupPaths: string[];
  binary: string;
  vmmPdeathsig: string | null;
  gvPid: number | undefined;
  gvExe: string | undefined;
  portForward: NonNullable<BootOptions["portForward"]>;
  memoryCeilingMib: number | undefined;
  statsFilePath: string | undefined;
  mountDiskPaths: MountDiskPaths | undefined;
  liveMountsResolved: ResolvedLiveMount[];
  snapletStatePath: string | undefined;
}

// Write the registry entry. Returns true on success; registry-write
// failures are best-effort (attach won't find this VM but local
// boot-and-use still works fine).
function registerInRegistry(args: RegisterArgs): boolean {
  try {
    writeEntry({
      pid: args.childPid,
      name: args.vmName,
      socketPath: args.vsockUdsPath,
      imagePath: args.sourceImageAbs,
      diskPath: args.diskAbs,
      forkedFrom: args.forkedFrom,
      bootLogPath: args.bootLogPath,
      cleanupPaths: args.cleanupPaths.length > 0 ? args.cleanupPaths : undefined,
      // The pdeathsig shim works differently per platform, and that
      // changes what `child.pid` actually IS:
      //   - Linux: shim does `prctl(PR_SET_PDEATHSIG); execvp(target)`
      //     in-place, so once the kernel runs `execvp` `child.pid`
      //     is the target binary. /proc/<pid>/exe stabilizes at the
      //     target's path.
      //   - macOS: shim forks (parent is the long-lived kqueue
      //     watcher; the child execvp's the target), so `child.pid`
      //     is *the watcher* forever, and `ps` reports the shim's
      //     own argv[0] for that pid.
      // For the registry's vmmExe field we want whatever the OS
      // will keep reporting for `child.pid` once everything settles.
      // On macOS that's the shim ("pdeathsig"), so snapshot it now.
      // On Linux that's the target — and we deliberately *don't*
      // snapshot, because there's a race between Node's `spawn()`
      // returning and the shim's execvp firing where /proc/<pid>/exe
      // still resolves to the shim path. Storing the snapshot in
      // that window persists "pdeathsig" and validatePid later sees
      // "yes" / the real VMM and reports `recycled` forever —
      // exactly what ate two CI tests when this code first landed.
      vmmExe:
        process.platform === "darwin" && args.vmmPdeathsig
          ? (readProcessIdentity(args.childPid)?.exeBase ?? args.binary)
          : args.binary,
      gvproxyPid: args.gvPid,
      // Same Linux-vs-macOS shim semantics as `vmmExe` above.
      gvproxyExe:
        process.platform === "darwin" && args.gvPid !== undefined && args.gvPid > 0
          ? (readProcessIdentity(args.gvPid)?.exeBase ?? args.gvExe)
          : args.gvExe,
      portForward: args.portForward.length > 0 ? args.portForward : undefined,
      memoryCeilingMib: args.memoryCeilingMib,
      statsPath: args.statsFilePath,
      // Snaplet engine: persist the VMM's whole-VM state-file path so
      // an attach-owned `vm.snapshot()` / `vm.fork()` can SIGUSR1 the
      // VMM and pick the .snaplet up. Undefined for criu-engine VMs.
      snapletPath: args.snapletStatePath,
      // #272: persist mount-overlay paths so an attach-owned
      // vm.snapshot()/fork() can reflink the lower+upper into the
      // bundle. Without this, `machinen snapshot <vm>` from
      // the CLI produces a bundle that's missing the overlay halves.
      mountDisk: args.mountDiskPaths
        ? {
            guest: args.mountDiskPaths.guest,
            lowerPath: args.mountDiskPaths.lowerPath,
            upperPath: args.mountDiskPaths.upperPath,
          }
        : undefined,
      // #273: persist live-share mount config so an attach-owned
      // snapshot/fork can write the same `meta.liveMounts` block
      // and trigger /sbin/machinen-remount post-dump on
      // leaveRunning paths. Host UDS / vsock port aren't carried —
      // those are this process's private state and the attach side
      // doesn't need them (the source's servers stay listening
      // through the dump and the re-fork'd fuse-agent reconnects).
      liveMounts:
        args.liveMountsResolved.length > 0
          ? args.liveMountsResolved.map(({ guest, host, mode }) => ({ guest, host, mode }))
          : undefined,
      startedAt: Date.now(),
    });
    debug("registered pid=%d name=%s", args.childPid, args.vmName ?? "<unset>");
    return true;
  } catch (err) {
    debug(
      "registry write failed (best-effort) err=%s",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

interface ExitCleanupState {
  child: ChildProcessWithoutNullStreams;
  childPid: number;
  bootT0: number;
  perBootRootDisk: string | undefined;
  perBootSnapDisk: string | undefined;
  perBootMountUpper: string | undefined;
  bundleTempDir: string | undefined;
  vsockTempDir: string | undefined;
  statsTempDir: string | undefined;
  gvStop: (() => void) | undefined;
  liveMountServers: DetachedMountServerHandle[];
  registered: boolean;
}

// On VMM exit, reap every per-boot artifact:
//   - reflink copies (#121, #272) so guest writes don't persist;
//   - bundle/vsock/stats temp dirs;
//   - gvproxy + live-mount server children;
//   - the registry entry.
// All best-effort: a clean exit, signal exit, and kernel panic all
// land here, and the cached `<sha>.img` template is kept clean inline
// at copy time, so nothing here depends on graceful exit.
function installVmExitCleanup(state: ExitCleanupState): void {
  state.child.once("exit", (code, signal) => {
    debug(
      "VMM exit pid=%d code=%s signal=%s lifetimeMs=%d",
      state.childPid,
      code,
      signal,
      Date.now() - state.bootT0,
    );
    for (const file of [state.perBootRootDisk, state.perBootSnapDisk, state.perBootMountUpper]) {
      if (file) {
        try {
          unlinkSync(file);
        } catch {}
      }
    }
    for (const dir of [state.bundleTempDir, state.vsockTempDir, state.statsTempDir]) {
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      }
    }
    if (state.gvStop) {
      state.gvStop();
    }
    for (const server of state.liveMountServers) {
      void server.stop().catch(() => {});
    }
    if (state.registered) {
      removeEntry(state.childPid);
    }
  });
}

// #221/#233: stamp first-guest-byte and emit the boot timeline. Either
// path (first stderr byte, or VMM exit before any output) flushes
// exactly once — `phases.end` is a no-op the second time around. Also
// emits a `phase` LogEvent so callers can fold the breakdown into
// their own UI without parsing debug strings.
function installFlushPhases(
  child: ChildProcessWithoutNullStreams,
  phases: PhaseTimer,
  onLog: OnLog | undefined,
): void {
  let phasesFlushed = false;
  const flush = () => {
    if (phasesFlushed) {
      return;
    }
    phasesFlushed = true;
    phases.end("first-guest-byte");
    phases.flush(debug, "boot");
    onLog?.(phases.toEvent("boot"));
  };
  child.stderr.once("data", flush);
  child.once("exit", flush);
}

function installDetachedBootCapture(child: ChildProcessWithoutNullStreams, sink: Buffer[]): void {
  let bytes = 0;
  child.stderr.on("data", (chunk: Buffer) => {
    sink.push(chunk);
    bytes += chunk.length;
    while (sink.length > 1 && bytes - sink[0]!.length >= CONSOLE_TAIL_BYTES) {
      bytes -= sink.shift()!.length;
    }
  });
}

// Spawn one detached mount-server helper per resolved live-mount,
// then patch the registry entry with their pids+exes. On any spawn
// failure: SIGKILL the VMM; the exit hook reaps everything (including
// the helpers we did manage to start) via `liveMountServers`.
async function spawnLiveMountServersForBoot(args: {
  liveMountsResolved: ResolvedLiveMount[];
  childPid: number;
  child: ChildProcessWithoutNullStreams;
  registered: boolean;
  liveMountServers: DetachedMountServerHandle[];
}): Promise<void> {
  try {
    for (const lm of args.liveMountsResolved) {
      const lmHandle = await spawnDetachedMountServer({
        udsPath: lm.udsPath,
        rootAbs: lm.host,
        mode: lm.mode,
        vmmPid: args.childPid,
        statsPath: lm.statsPath,
      });
      args.liveMountServers.push(lmHandle);
    }
  } catch (err) {
    try {
      args.child.kill("SIGKILL");
    } catch {}
    throw err;
  }
  if (!args.registered) {
    return;
  }
  // `machinen stop` SIGTERMs the helpers alongside the VMM;
  // `machinen gc` validates pid+exe to detect recycled pids the
  // same way it does for the VMM and gvproxy.
  try {
    patchEntry(args.childPid, {
      liveMountServers: args.liveMountServers.map((h) => ({ pid: h.pid, exe: h.exe })),
    });
  } catch (err) {
    debug(
      "registry patch (liveMountServers) failed (best-effort) err=%s",
      err instanceof Error ? err.message : String(err),
    );
  }
}

// #150 phase 2: detached mode blocks until the guest produces its
// first console byte (readiness), then dumps the boot snapshot,
// unrefs the child, and resolves. Two failure shapes to gate on:
//
//   - VMM dies in the readiness window. The exit hook above will
//     have torn down per-boot disks / vsock dirs / gvproxy / cache /
//     live mounts already; we still need to surface the failure to
//     the caller instead of silently resolving. Snapshot whatever
//     stderr we captured before death so a post-mortem has bytes
//     to work with.
//   - Readiness never arrives. Cap at `timeoutMs` (caller default
//     60s, CLI passes null for interactive boots — but `--detached`
//     forces a finite wait so the CLI can exit cleanly).
async function gateOnDetachedReadiness(args: {
  child: ChildProcessWithoutNullStreams;
  timeoutMs: number | null;
  bootLogPath: string;
  detachedBootChunks: Buffer[];
  handle: VmHandle;
}): Promise<void> {
  const readinessTimeoutMs = args.timeoutMs ?? 60_000;
  let onByte: (() => void) | null = null;
  let onExit: (() => void) | null = null;
  const readiness = new Promise<"ready" | "exit">((resolve) => {
    onByte = () => resolve("ready");
    onExit = () => resolve("exit");
    args.child.stderr.once("data", onByte);
    args.child.once("exit", onExit);
  });
  const timeoutP = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), readinessTimeoutMs).unref();
  });
  const outcome = await Promise.race([readiness, timeoutP]);
  // Cleanup whichever listeners didn't fire so a throw below doesn't
  // leave orphaned handlers holding the event loop.
  if (onByte) {
    args.child.stderr.removeListener("data", onByte);
  }
  if (onExit) {
    args.child.removeListener("exit", onExit);
  }
  // Always dump whatever stderr we have so far — failure paths
  // benefit from the snapshot more than success paths do.
  writeBootSnapshot(args.bootLogPath, Buffer.concat(args.detachedBootChunks).toString("utf8"));
  if (outcome === "exit") {
    throw new BootError(
      "BOOT_DETACHED_READINESS_FAILED",
      `boot --detached: VMM exited before readiness (code=${args.child.exitCode} signal=${args.child.signalCode}). ` +
        `Boot console snapshot at ${args.bootLogPath}`,
    );
  }
  if (outcome === "timeout") {
    // The VMM is still alive but never wrote a console byte. Kill
    // it (parent still holds the pdeathsig-less child handle) so
    // we don't leave an orphan after throwing.
    try {
      args.child.kill("SIGTERM");
    } catch {}
    throw new BootError(
      "BOOT_DETACHED_READINESS_FAILED",
      `boot --detached: VMM did not signal readiness within ${readinessTimeoutMs}ms. ` +
        `Boot console snapshot at ${args.bootLogPath}`,
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
