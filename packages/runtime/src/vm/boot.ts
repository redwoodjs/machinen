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
  applyNestedVirtualizationEnv,
  preflightNestedVirtualization,
  probeVmmNestedVirtualization,
} from "../nested-virt.ts";
import { ensurePdeathsig, wrapWithPdeathsig } from "../pdeathsig.ts";
import { PhaseTimer } from "../phase-timer.ts";
import { readProcessIdentity } from "../pid-validate.ts";
import { readHostRssBytes } from "../proc-rss.ts";
import { reflinkCopy } from "../reflink.ts";
import { claimName, findEntry, removeEntry, writeEntry } from "../registry.ts";
import { ensureRootfsImage, markRootfsImageClean } from "../rootfs-img.ts";
import { resolveLiveMounts, type ResolvedLiveMount, synthesizeAndPackBundle } from "./bundle.ts";
import { performForkWithRestore } from "./fork-core.ts";
import type { VmHandle } from "../vm-handle.ts";
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
import { resolveSnapshotEngine, VMSTATE_FILE } from "./snapshot-engine.ts";

const debug = debugLib("machinen:boot");
const vmmDebug = debugLib("machinen:vmm");
const vmstateDebug = debugLib("machinen:vmstate");
const restoreDebug = debugLib("machinen:restore");

export interface BootOptions {
  /**
   * Path to a rootfs tarball to boot from (e.g. the output of
   * `provision()`, or an arch-specific base rootfs tarball shipped in
   * releases: `rootfs-debian-arm64.tar.gz` / `rootfs-debian-amd64.tar.gz`).
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
   * but writes don't propagate to the host); `liveMount` is an in-VMM
   * virtio-fs pass-through (writes land on the host and restore/fork
   * re-establish the same guest mount topology). Pick `mount` for inputs the
   * guest may modify but the host shouldn't see; `liveMount` for shared scratch.
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
   * Vmstate engine restore: absolute path to the bundle's
   * `state.vmstate`. Set by `restore()` when it detects a vmstate
   * bundle. `boot()` forwards it to the VMM as `MACHINEN_RESTORE_PATH`
   * — the VMM loads that whole-VM state before the first vCPU run, so
   * the guest resumes mid-execution instead of cold-booting.
   *
   * @internal
   */
  _vmstateRestorePath?: string;
  /**
   * Vmstate restore: exact root block image from the snapshot bundle.
   * `boot()` reflink-clones this into a per-VM temp file before
   * attaching it so the restored guest cannot mutate the bundle.
   *
   * @internal
   */
  _rootDiskRestorePath?: string;
  /**
   * Host directories exposed to the guest as live-share mounts (#78,
   * #332). Unlike `mount` (copy-once into the boot rootfs), these stay
   * connected to the host: the guest reads on demand and nothing is
   * copied at boot. `mode` defaults to `"rw"` — guest writes land on
   * the host (#151, #156). Set `"ro"` for a one-way share (host
   * caches, untrusted guests).
   *
   * Each guest path must live under `/mnt/` (same rule as `mount`).
   * Repeatable up to 5 entries per VM — each is served by its own
   * in-VMM virtio-fs device (the VMM wires 5 virtio-fs slots). The
   * FUSE opcode handlers run inside the VMM and the guest mounts each
   * share directly with `mount -t virtiofs` — no agent process, no
   * vsock hop. Requires a guest kernel with `CONFIG_VIRTIO_FS` — every
   * machinen-built kernel has it. (The older FUSE-over-vsock transport
   * and its `protocol` knob were removed in #338.)
   *
   * Snapshot / restore / fork (#273): liveMount has no guest-side
   * state worth checkpointing — reads come from the host on demand,
   * writes (in `"rw"`) land on the host immediately. The in-VMM
   * virtio-fs device persists across the CRIU dump, so the workload's
   * view of `/mnt/<guest>/` survives `vm.snapshot({ leaveRunning:
   * true })` and `vm.fork()` without an unmount/remount window.
   *
   * Concurrent writes from multiple forks against the same host
   * directory are no different from any other shared filesystem —
   * each VM gets its own device but the runtime doesn't coordinate
   * writes between siblings. If two forks need non-overlapping write
   * surfaces, point each at a distinct `host` path or use `mount`
   * (copy-once, per-VM upper).
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
  liveMounts?: Array<{
    host: string;
    guest: string;
    mode?: "ro" | "rw";
  }>;
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
   * Opt in to exposing arm64 EL2 / `/dev/kvm` to the guest so the
   * workload can start its own VMs. This is intentionally off by
   * default: it requires Linux/arm64 KVM with nested EL2 support, or
   * macOS 15+ on M3/M4-class Apple Silicon, and provider-level
   * snapshots of a nested-enabled VM are refused until EL2 vmstate
   * capture is audited.
   *
   * When set, the runtime does a best-effort host preflight and passes
   * `MACHINEN_NESTED=1` to the VMM. The VMM's backend probe is still
   * authoritative.
   */
  nested?: boolean;
  /**
   * Guest RAM ceiling, in MiB (decimal integer; no unit suffixes). The
   * VMM reads this as `MACHINEN_MEMORY` (#263 phase A). This is the
   * guest's memory layout limit, not the host memory used right now.
   * Defaults to `min(host_ram_mib / 2, 4096)` with a floor of 512 — a
   * modest ceiling for typical dev workloads. The ceiling is
   * approximately free until the guest touches a page (see
   * `packages/microvm/docs/memory.md`), but a bigger ceiling still
   * increases guest metadata and the possible high-water mark.
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
   * option: gvproxy is tracked in the registry, live mounts are served
   * by in-VMM virtio-fs devices, and `mount` (squashfs+ext4 overlay)
   * is fd-passed to the VMM at spawn so the supervisor holds no live
   * state afterwards.
   *
   * Cleanup of per-boot reflink disks, bundle dirs, and vsock UDS
   * directories normally happens in the parent's `child.once("exit")`
   * hook. After detach the parent is gone, so those leak until
   * `machinen gc` / `machinen stop` reaps them.
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

  const plan = await prepareBootPlan(opts, phases);
  const {
    env,
    memoryCeilingMib,
    diskAbs,
    vsockUdsPath,
    statsFilePath,
    vmstate,
    liveMountsResolved,
  } = plan;

  const resources = await prepareBootResources(opts, plan, phases);
  const { mountDiskPaths } = resources;

  const spawned = await spawnBootVmm({ opts, plan, resources, phases, bootT0 });
  const child = spawned.child;
  const registry = registerSpawnedBoot({ opts, plan, resources, spawned, bootT0 });
  const {
    childPid,
    vmName,
    sourceImageAbs,
    rootDiskPath: rootDiskPathForRegistry,
    rootDiskMode: rootDiskModeForRegistry,
    bootLogPath,
  } = registry;

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
  installVmstateTimingRelay(child);
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

  const handle = createBootVmHandle({
    child,
    childPid,
    vmName,
    timeoutMs,
    outputCollector,
    errorCollector,
    vsockUdsPath,
    onLog,
    statsFilePath,
    memoryCeilingMib,
    diskAbs,
    vmstateStatePath: vmstate.statePath,
    snapshot: {
      child,
      childPid,
      vmName,
      sourceImageAbs,
      rootDiskPath: rootDiskPathForRegistry,
      rootDiskMode: rootDiskModeForRegistry,
      memoryCeilingMib,
      env,
      diskAbs,
      mountDiskPaths,
      liveMountsResolved,
      nested: opts.nested,
      vmstate,
    },
  });

  // Set a per-VM kernel hostname so `\h` prompts and other
  // hostname-aware tooling can tell VMs apart. Fire-and-forget
  // over vsock — for fresh boots this races bash startup, so a
  // workload shell may still cache the kernel's pre-call value
  // (`(none)` on Linux). Subsequent shells (e.g. via
  // `machinen attach`) read the post-call value. Suppressed when
  // we have no vsock UDS (boot-without-exec-agent paths).
  if (vsockUdsPath && env.MACHINEN_SKIP_GUEST_HOSTNAME !== "1") {
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

interface BootPlan {
  portForward: NonNullable<BootOptions["portForward"]>;
  binary: string;
  env: Record<string, string>;
  memoryCeilingMib: number | undefined;
  diskAbs: string | undefined;
  perBootSnapDisk: string | undefined;
  wantsRootDisk: boolean;
  vsockUdsPath: string | undefined;
  vsockTempDir: string | undefined;
  statsFilePath: string | undefined;
  statsTempDir: string | undefined;
  vmstate: BootVmstateRuntime;
  liveMountsResolved: ResolvedLiveMount[];
  mergedGuestEnv: Record<string, string>;
}

interface BootResources {
  gvStop: (() => void) | undefined;
  gvPid: number | undefined;
  gvExe: string | undefined;
  gvSocketDir: string | undefined;
  bundleTempDir: string | undefined;
  mountDiskPaths: MountDiskPaths | undefined;
  perBootRootDisk: string | undefined;
}

async function prepareBootResources(
  opts: BootOptions,
  plan: BootPlan,
  phases: PhaseTimer,
): Promise<BootResources> {
  let resources: BootResources = emptyBootResources();
  try {
    resources = {
      ...resources,
      ...(await setupBootNetServices(opts, plan, phases)),
      ...packBootInitramfsIfNeeded(opts, plan, phases),
    };
    resources.perBootRootDisk = materializeRootdiskIfNeeded(opts, plan, phases);
    return resources;
  } catch (err) {
    rollbackPreSpawn({
      gvStop: resources.gvStop,
      bundleTempDir: resources.bundleTempDir,
      vsockTempDir: plan.vsockTempDir,
      perBootRootDisk: resources.perBootRootDisk,
      perBootSnapDisk: plan.perBootSnapDisk,
      perBootMountUpper: undefined,
    });
    throw err;
  }
}

function emptyBootResources(): BootResources {
  return {
    gvStop: undefined,
    gvPid: undefined,
    gvExe: undefined,
    gvSocketDir: undefined,
    bundleTempDir: undefined,
    mountDiskPaths: undefined,
    perBootRootDisk: undefined,
  };
}

async function setupBootNetServices(
  opts: BootOptions,
  plan: BootPlan,
  phases: PhaseTimer,
): Promise<Pick<BootResources, "gvStop" | "gvPid" | "gvExe" | "gvSocketDir">> {
  phases.start("net-services");
  phases.start("net-services.gvproxy");
  const gv = await bringUpGvproxy(opts, plan.binary, plan.env, plan.portForward);
  phases.end("net-services.gvproxy");
  phases.end("net-services");
  return gv;
}

function packBootInitramfsIfNeeded(
  opts: BootOptions,
  plan: BootPlan,
  phases: PhaseTimer,
): Pick<BootResources, "bundleTempDir" | "mountDiskPaths"> {
  if (!bootNeedsInitramfs(opts)) {
    return { bundleTempDir: undefined, mountDiskPaths: undefined };
  }
  phases.start("initramfs-pack");
  const packed = synthesizeAndPackBundle(opts, plan.mergedGuestEnv, plan.liveMountsResolved, {
    useTiny: plan.wantsRootDisk,
    env: plan.env,
    mountDiskUpperSizeBytes: opts.mountDiskUpperSizeBytes,
    onPhase: (name, ms) => phases.mark(`initramfs-pack.${name}`, ms),
  });
  plan.env.MACHINEN_INITRD = packed.cpioPath;
  const packMs = phases.end("initramfs-pack");
  debug("initramfs packed cpio=%s elapsed=%dms", packed.cpioPath, packMs ?? -1);
  return { bundleTempDir: packed.tempDir, mountDiskPaths: packed.mountDisk };
}

function bootNeedsInitramfs(opts: BootOptions): boolean {
  return Boolean(opts.image || opts.cmd || opts.snapshot);
}

function materializeRootdiskIfNeeded(
  opts: BootOptions,
  plan: BootPlan,
  phases: PhaseTimer,
): string | undefined {
  phases.start("rootdisk-materialize");
  const perBootRootDisk = plan.wantsRootDisk
    ? materializeRootdisk(opts, plan.env, phases)
    : undefined;
  phases.end("rootdisk-materialize");
  return perBootRootDisk;
}

interface SpawnBootArgs {
  opts: BootOptions;
  plan: BootPlan;
  resources: BootResources;
  phases: PhaseTimer;
  bootT0: number;
}

interface SpawnedBootVmm {
  child: ChildProcessWithoutNullStreams;
  vmmPdeathsig: string | null;
  perBootMountUpper: string | undefined;
}

async function spawnBootVmm(args: SpawnBootArgs): Promise<SpawnedBootVmm> {
  args.phases.start("vmm-spawn");
  const vmmPdeathsig = await resolveVmmPdeathsig(args.opts);
  const wrappedVmm = wrapWithPdeathsig(vmmPdeathsig, args.plan.binary, args.opts.args ?? []);
  const stdio: Array<"pipe" | number> = ["pipe", "pipe", "pipe"];
  const mountDiskFds = maybeOpenMountDiskFds(args.resources.mountDiskPaths, args.plan.env, stdio);
  const child = nodeSpawn(wrappedVmm.command, wrappedVmm.args, {
    cwd: args.opts.cwd,
    env: args.plan.env,
    stdio,
  }) as ChildProcessWithoutNullStreams;
  closeMountDiskFds(mountDiskFds);
  args.phases.end("vmm-spawn");
  args.phases.start("first-guest-byte");
  logVmmSpawn(child, args.plan.binary, vmmPdeathsig, args.bootT0);
  return { child, vmmPdeathsig, perBootMountUpper: args.resources.mountDiskPaths?.upperPath };
}

async function resolveVmmPdeathsig(opts: BootOptions): Promise<string | null> {
  if (opts.detached || opts.pdeathsig === false) {
    return null;
  }
  return ensurePdeathsig();
}

function maybeOpenMountDiskFds(
  mountDiskPaths: MountDiskPaths | undefined,
  env: Record<string, string>,
  stdio: Array<"pipe" | number>,
): { lowerFd: number; upperFd: number } | undefined {
  return mountDiskPaths ? openMountDiskFds(mountDiskPaths, env, stdio) : undefined;
}

function closeMountDiskFds(fds: { lowerFd: number; upperFd: number } | undefined): void {
  if (fds) {
    closeFds(fds.lowerFd, fds.upperFd);
  }
}

function logVmmSpawn(
  child: ChildProcessWithoutNullStreams,
  binary: string,
  vmmPdeathsig: string | null,
  bootT0: number,
): void {
  debug(
    "VMM spawned pid=%d binary=%s wrapped=%s elapsedSinceEntry=%dms",
    child.pid ?? -1,
    binary,
    vmmPdeathsig ? "yes" : "no",
    Date.now() - bootT0,
  );
}

interface BootRegistryState {
  childPid: number;
  vmName: string | undefined;
  sourceImageAbs: string | undefined;
  rootDiskPath: string | undefined;
  rootDiskMode: "block" | "none";
  bootLogPath: string | undefined;
}

function registerSpawnedBoot(args: {
  opts: BootOptions;
  plan: BootPlan;
  resources: BootResources;
  spawned: SpawnedBootVmm;
  bootT0: number;
}): BootRegistryState {
  const state = buildBootRegistryState(args.opts, args.resources, args.spawned);
  claimBootNameIfNeeded(state, args.spawned.child);
  const registered = writeBootRegistryIfPossible(args, state);
  installBootExitCleanup(args, state, registered);
  return state;
}

function buildBootRegistryState(
  opts: BootOptions,
  resources: BootResources,
  spawned: SpawnedBootVmm,
): BootRegistryState {
  const childPid = spawned.child.pid ?? -1;
  const rootDiskPath = registryRootDiskPath(opts, resources.perBootRootDisk);
  return {
    childPid,
    vmName: opts.name,
    sourceImageAbs: registrySourceImage(opts),
    rootDiskPath,
    rootDiskMode: rootDiskPath ? "block" : "none",
    bootLogPath: registryBootLogPath(opts, childPid),
  };
}

function registrySourceImage(opts: BootOptions): string | undefined {
  return opts.image ? resolve(opts.cwd ?? process.cwd(), opts.image) : undefined;
}

function registryRootDiskPath(
  opts: BootOptions,
  perBootRootDisk: string | undefined,
): string | undefined {
  if (perBootRootDisk) {
    return perBootRootDisk;
  }
  return typeof opts.rootDisk === "string"
    ? resolve(opts.cwd ?? process.cwd(), opts.rootDisk)
    : undefined;
}

function registryBootLogPath(opts: BootOptions, childPid: number): string | undefined {
  return opts.detached && childPid > 0 ? bootSnapshotPath(childPid) : undefined;
}

function claimBootNameIfNeeded(
  state: BootRegistryState,
  child: ChildProcessWithoutNullStreams,
): void {
  if (state.vmName && state.childPid > 0) {
    claimNameOrThrow(state.vmName, state.childPid, child);
  }
}

function writeBootRegistryIfPossible(
  args: {
    opts: BootOptions;
    plan: BootPlan;
    resources: BootResources;
    spawned: SpawnedBootVmm;
  },
  state: BootRegistryState,
): boolean {
  if (state.childPid <= 0 || !args.plan.vsockUdsPath) {
    return false;
  }
  return registerInRegistry(buildRegisterArgs(args, state));
}

function buildRegisterArgs(
  args: {
    opts: BootOptions;
    plan: BootPlan;
    resources: BootResources;
    spawned: SpawnedBootVmm;
  },
  state: BootRegistryState,
): RegisterArgs {
  return {
    childPid: state.childPid,
    vmName: state.vmName,
    vsockUdsPath: args.plan.vsockUdsPath!,
    sourceImageAbs: state.sourceImageAbs,
    rootDiskPath: state.rootDiskPath,
    rootDiskMode: state.rootDiskMode,
    diskAbs: args.plan.diskAbs,
    forkedFrom: args.opts.forkedFrom,
    bootLogPath: state.bootLogPath,
    cleanupPaths: cleanupPathsForBoot(args.plan, args.resources, args.spawned),
    binary: args.plan.binary,
    vmmPdeathsig: args.spawned.vmmPdeathsig,
    gvPid: args.resources.gvPid,
    gvExe: args.resources.gvExe,
    portForward: args.plan.portForward,
    memoryCeilingMib: args.plan.memoryCeilingMib,
    statsFilePath: args.plan.statsFilePath,
    mountDiskPaths: args.resources.mountDiskPaths,
    liveMountsResolved: args.plan.liveMountsResolved,
    vmstateStatePath: args.plan.vmstate.statePath,
    vmstateChainId: vmstateValue(args.plan.vmstate, args.plan.vmstate.chainId),
    vmstateCheckpointParent: vmstateValue(args.plan.vmstate, args.plan.vmstate.checkpointParent),
    vmstateCheckpointSequence: vmstateValue(
      args.plan.vmstate,
      args.plan.vmstate.checkpointSequence,
    ),
    nested: args.opts.nested,
  };
}

function vmstateValue<T>(vmstate: BootVmstateRuntime, value: T): T | undefined {
  return vmstate.statePath ? value : undefined;
}

function cleanupPathsForBoot(
  plan: BootPlan,
  resources: BootResources,
  spawned: SpawnedBootVmm,
): string[] {
  return collectCleanupPaths({
    perBootRootDisk: resources.perBootRootDisk,
    perBootSnapDisk: plan.perBootSnapDisk,
    perBootMountUpper: spawned.perBootMountUpper,
    bundleTempDir: resources.bundleTempDir,
    vsockTempDir: plan.vsockTempDir,
    statsTempDir: plan.statsTempDir,
    gvSocketDir: resources.gvSocketDir,
  });
}

function installBootExitCleanup(
  args: {
    plan: BootPlan;
    resources: BootResources;
    spawned: SpawnedBootVmm;
    bootT0: number;
  },
  state: BootRegistryState,
  registered: boolean,
): void {
  installVmExitCleanup({
    child: args.spawned.child,
    childPid: state.childPid,
    bootT0: args.bootT0,
    perBootRootDisk: args.resources.perBootRootDisk,
    perBootSnapDisk: args.plan.perBootSnapDisk,
    perBootMountUpper: args.spawned.perBootMountUpper,
    bundleTempDir: args.resources.bundleTempDir,
    vsockTempDir: args.plan.vsockTempDir,
    statsTempDir: args.plan.statsTempDir,
    gvStop: args.resources.gvStop,
    registered,
  });
}

async function prepareBootPlan(opts: BootOptions, phases: PhaseTimer): Promise<BootPlan> {
  const assets = await resolveBootAssets(opts, phases);
  const env = buildVmmEnv(opts);
  configureNestedVirtualization(opts, assets.binary, env);
  const memoryCeilingMib = setMemoryCeiling(opts, env);
  const scratch = prepareBootScratchDisk(opts, env, phases);
  const wantsRootDisk = wantsRootDiskBoot(opts);
  validateRootDiskRequest(opts, wantsRootDisk);
  validateKernelDtb(opts, env);
  const vsock = setupVsockBridge(env);
  const stats = setupStatsFile(env, vsock.vsockTempDir);
  const vmstateSetup = setupVmstateBoot(opts, env, vsock.vsockTempDir);
  const liveMountsResolved = setupLiveMountEnv(opts, env);
  return {
    ...assets,
    env,
    memoryCeilingMib,
    ...scratch,
    wantsRootDisk,
    vsockUdsPath: vsock.vsockUdsPath,
    vsockTempDir: vmstateSetup.vsockTempDir,
    ...stats,
    vmstate: vmstateSetup.vmstate,
    liveMountsResolved,
    mergedGuestEnv: buildMergedGuestEnv(opts, vsock.vsockUdsPath),
  };
}

async function resolveBootAssets(
  opts: BootOptions,
  phases: PhaseTimer,
): Promise<Pick<BootPlan, "portForward" | "binary">> {
  phases.start("asset-resolve");
  const portForward = opts.portForward ?? [];
  await validatePortForwardOpts(opts, portForward);
  const binary = resolveBootBinary(opts);
  validateBootCommandPair(opts);
  phases.end("asset-resolve");
  return { portForward, binary };
}

function resolveBootBinary(opts: BootOptions): string {
  const binaryInput = opts.binary ?? resolveVmmBinary();
  const binary = resolve(opts.cwd ?? process.cwd(), binaryInput);
  if (!existsSync(binary)) {
    throw new BootError("BOOT_VMM_MISSING", `VMM binary not found at ${binary}`);
  }
  return binary;
}

function validateBootCommandPair(opts: BootOptions): void {
  if (opts.cmd && !opts.image) {
    throw new BootError("BOOT_CMD_WITHOUT_IMAGE", "boot: `image` is required when `cmd` is set.");
  }
}

function buildVmmEnv(opts: BootOptions): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    ...opts.vmmEnv,
  };
}

function prepareBootScratchDisk(
  opts: BootOptions,
  env: Record<string, string>,
  phases: PhaseTimer,
): Pick<BootPlan, "diskAbs" | "perBootSnapDisk"> {
  phases.start("disk-prep");
  const scratch = prepareScratchDisk(opts, env);
  phases.end("disk-prep");
  return scratch;
}

function wantsRootDiskBoot(opts: BootOptions): boolean {
  return (
    opts.rootDisk !== false &&
    (opts._rootDiskRestorePath !== undefined || opts.rootDisk !== undefined || !!opts.image)
  );
}

function validateRootDiskRequest(opts: BootOptions, wantsRootDisk: boolean): void {
  if (wantsRootDisk && typeof opts.rootDisk !== "string" && !opts.image) {
    throw new BootError(
      "BOOT_CMD_WITHOUT_IMAGE",
      "boot: rootDisk: true requires an `image` (the .tar.gz to materialize).",
    );
  }
}

function setupVmstateBoot(
  opts: BootOptions,
  env: Record<string, string>,
  inputVsockTempDir: string | undefined,
): { vmstate: BootVmstateRuntime; vsockTempDir: string | undefined } {
  let vsockTempDir = inputVsockTempDir;
  const vmstate: BootVmstateRuntime = {
    statePath: undefined,
    chainId: randomBytes(16).toString("hex"),
    checkpointParent: opts._vmstateRestorePath ? opts.forkedFrom : undefined,
    checkpointSequence: 0,
  };
  if (resolveSnapshotEngine() === "vmstate" && opts.snapshot !== false) {
    vsockTempDir = ensureVsockTempDir(vsockTempDir);
    vmstate.statePath = join(vsockTempDir, VMSTATE_FILE);
    env.MACHINEN_SNAPSHOT_PATH = vmstate.statePath;
  }
  configureVmstateRestoreEnv(opts, env);
  return { vmstate, vsockTempDir };
}

function ensureVsockTempDir(vsockTempDir: string | undefined): string {
  return vsockTempDir ?? mkdtempSync(join(tmpdir(), "machinen-vsock-"));
}

function configureVmstateRestoreEnv(opts: BootOptions, env: Record<string, string>): void {
  if (!opts._vmstateRestorePath) {
    return;
  }
  env.MACHINEN_RESTORE_PATH = opts._vmstateRestorePath;
  if (shouldEnableVmstateTiming(env)) {
    env.MACHINEN_VMSTATE_TIMING = "1";
  }
}

function shouldEnableVmstateTiming(env: Record<string, string>): boolean {
  return (vmstateDebug.enabled || restoreDebug.enabled) && !env.MACHINEN_VMSTATE_TIMING;
}

function setupLiveMountEnv(opts: BootOptions, env: Record<string, string>): ResolvedLiveMount[] {
  const liveMounts = opts.liveMounts ?? [];
  if (liveMounts.length === 0) {
    return [];
  }
  const resolved = resolveLiveMounts(liveMounts, opts.cwd);
  resolved.forEach((lm, i) => {
    env[`MACHINEN_VIRTIOFS_${i}`] = `${lm.tag}:${lm.mode}:${lm.host}`;
  });
  return resolved;
}

function buildMergedGuestEnv(
  opts: BootOptions,
  vsockUdsPath: string | undefined,
): Record<string, string> {
  const mergedGuestEnv: Record<string, string> = { ...opts.env };
  applyGuestNameFallback(opts, mergedGuestEnv);
  applyHostnameWait(vsockUdsPath, mergedGuestEnv);
  return mergedGuestEnv;
}

function applyGuestNameFallback(opts: BootOptions, mergedGuestEnv: Record<string, string>): void {
  if (opts.name && !mergedGuestEnv.MACHINEN_VM_NAME) {
    mergedGuestEnv.MACHINEN_VM_NAME = opts.name;
  }
}

function applyHostnameWait(
  vsockUdsPath: string | undefined,
  mergedGuestEnv: Record<string, string>,
): void {
  if (vsockUdsPath && !mergedGuestEnv.MACHINEN_VM_HOSTNAME_WAIT) {
    mergedGuestEnv.MACHINEN_VM_HOSTNAME_WAIT = "1";
  }
}

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
  rejectPresetNetSocket(opts);
  validatePortForwardShape(portForward);
  await validatePortForwardAvailability(portForward);
}

function rejectPresetNetSocket(opts: BootOptions): void {
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
}

function validatePortForwardShape(portForward: NonNullable<BootOptions["portForward"]>): void {
  const seen = new Set<number>();
  for (const mapping of portForward) {
    validatePortMappingNumbers(mapping);
    rejectDuplicateHostPort(mapping.hostPort, seen);
  }
}

function validatePortMappingNumbers(
  mapping: NonNullable<BootOptions["portForward"]>[number],
): void {
  for (const [label, port] of portMappingPorts(mapping)) {
    if (!validTcpPort(port)) {
      throw new BootError(
        "BOOT_PORT_FORWARD_INVALID",
        `portForward: ${label} must be an integer in 1..65535 (got ${port})`,
      );
    }
  }
}

function portMappingPorts(
  mapping: NonNullable<BootOptions["portForward"]>[number],
): Array<readonly ["hostPort" | "guestPort", number]> {
  return [
    ["hostPort", mapping.hostPort],
    ["guestPort", mapping.guestPort],
  ];
}

function validTcpPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function rejectDuplicateHostPort(hostPort: number, seen: Set<number>): void {
  if (seen.has(hostPort)) {
    throw new BootError(
      "BOOT_PORT_FORWARD_CONFLICT",
      `portForward: duplicate hostPort ${hostPort}`,
    );
  }
  seen.add(hostPort);
}

async function validatePortForwardAvailability(
  portForward: NonNullable<BootOptions["portForward"]>,
): Promise<void> {
  for (const mapping of portForward) {
    await validateHostPortFree(mapping);
  }
}

async function validateHostPortFree(
  mapping: NonNullable<BootOptions["portForward"]>[number],
): Promise<void> {
  const host = mapping.hostAddr ?? "127.0.0.1";
  const errno = await probeHostPortFree(host, mapping.hostPort);
  if (!errno) {
    return;
  }
  throw new BootError(
    "BOOT_PORT_FORWARD_IN_USE",
    `portForward: host port ${host}:${mapping.hostPort} is already in use (${errno}). ${await portHolderDetail(mapping.hostPort)}`,
  );
}

async function portHolderDetail(hostPort: number): Promise<string> {
  const holder = await describePortHolder(hostPort).catch(() => null);
  return holder
    ? `${holder}.`
    : "Common cause: an orphaned gvproxy from a prior `kill -9` of the VMM. " +
        "Try `pkill -f gvproxy` to clear it, or pick a different host port.";
}

// #263 phase A: forward the guest RAM ceiling so the VMM doesn't
// fall back to its boot_*.zig hardcoded default. An explicit caller
// value via vmmEnv wins over our auto-size; that's the documented
// debug-knob escape hatch. Returns the resolved ceiling so it can be
// persisted on the registry entry; undefined when caller pre-set
// MACHINEN_MEMORY (the runtime didn't pick the number, so it can't
// honestly report it).
function configureNestedVirtualization(
  opts: BootOptions,
  binary: string,
  env: Record<string, string>,
): void {
  if (opts.nested) {
    preflightNestedVirtualization();
    probeVmmNestedVirtualization(binary, opts.cwd, env);
  }
  applyNestedVirtualizationEnv(opts.nested, env);
}

// `boot()` owns the returned handle, including `vm.fork()`, but `restore()`
// itself calls back into `boot()`. Load the runtime entry lazily so the static
// graph stays acyclic while source runs (`../index.ts`) and bundled dist runs
// (`./index.js`) both resolve to the public restore export.
function runtimeEntryImportPath(): string {
  if (import.meta.url.endsWith("/vm/boot.ts")) {
    return "../index.ts";
  }
  if (import.meta.url.endsWith("/vm/boot.js")) {
    return "../index.js";
  }
  return "./index.js";
}

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
  if (opts._rootDiskRestorePath) {
    const rootDiskAbs = resolve(opts.cwd ?? process.cwd(), opts._rootDiskRestorePath);
    if (!existsSync(rootDiskAbs)) {
      throw new BootError(
        "BOOT_SNAPSHOT_NOT_FOUND",
        `restore: vmstate rootdisk image not found: ${rootDiskAbs}`,
      );
    }
    const perBoot = join(
      tmpdir(),
      `machinen-rootdisk-restore-${process.pid}-${randomBytes(6).toString("hex")}.img`,
    );
    const reflinkT0 = Date.now();
    reflinkCopy(rootDiskAbs, perBoot);
    phases.mark("rootdisk-materialize.restore-reflink", Date.now() - reflinkT0);
    env.MACHINEN_ROOTDISK = perBoot;
    return perBoot;
  }
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
// Live mounts are in-VMM virtio-fs devices configured through env, so
// there are no separate live-mount helper processes to roll back.
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
  rootDiskPath: string | undefined;
  rootDiskMode: "block" | "none";
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
  vmstateStatePath: string | undefined;
  vmstateChainId: string | undefined;
  vmstateCheckpointParent: string | undefined;
  vmstateCheckpointSequence: number | undefined;
  nested: boolean | undefined;
}

// Write the registry entry. Returns true on success; registry-write
// failures are best-effort (attach won't find this VM but local
// boot-and-use still works fine).
function registerInRegistry(args: RegisterArgs): boolean {
  try {
    writeEntry(buildRegistryEntry(args));
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

function buildRegistryEntry(args: RegisterArgs) {
  return {
    pid: args.childPid,
    name: args.vmName,
    socketPath: args.vsockUdsPath,
    imagePath: args.sourceImageAbs,
    rootDiskPath: args.rootDiskPath,
    rootDiskMode: args.rootDiskMode,
    diskPath: args.diskAbs,
    forkedFrom: args.forkedFrom,
    bootLogPath: args.bootLogPath,
    cleanupPaths: nonEmptyList(args.cleanupPaths),
    vmmExe: registryVmmExe(args),
    gvproxyPid: args.gvPid,
    gvproxyExe: registryGvproxyExe(args),
    portForward: nonEmptyList(args.portForward),
    memoryCeilingMib: args.memoryCeilingMib,
    statsPath: args.statsFilePath,
    vmstatePath: args.vmstateStatePath,
    vmstateChainId: args.vmstateChainId,
    vmstateCheckpointParent: args.vmstateCheckpointParent,
    vmstateCheckpointSequence: args.vmstateCheckpointSequence,
    nested: args.nested || undefined,
    mountDisk: registryMountDisk(args.mountDiskPaths),
    liveMounts: registryLiveMounts(args.liveMountsResolved),
    startedAt: Date.now(),
  };
}

function nonEmptyList<T>(items: T[]): T[] | undefined {
  return items.length > 0 ? items : undefined;
}

function registryVmmExe(args: RegisterArgs): string {
  // The pdeathsig shim works differently per platform. On macOS child.pid
  // is the watcher, so snapshot its identity now; on Linux the shim execs in
  // place, so deferring avoids recording the shim during the exec race.
  if (process.platform === "darwin" && args.vmmPdeathsig) {
    return readProcessIdentity(args.childPid)?.exeBase ?? args.binary;
  }
  return args.binary;
}

function registryGvproxyExe(args: RegisterArgs): string | undefined {
  if (process.platform === "darwin" && args.gvPid !== undefined && args.gvPid > 0) {
    return readProcessIdentity(args.gvPid)?.exeBase ?? args.gvExe;
  }
  return args.gvExe;
}

function registryMountDisk(mountDiskPaths: MountDiskPaths | undefined) {
  if (!mountDiskPaths) {
    return undefined;
  }
  return {
    guest: mountDiskPaths.guest,
    lowerPath: mountDiskPaths.lowerPath,
    upperPath: mountDiskPaths.upperPath,
  };
}

function registryLiveMounts(liveMountsResolved: ResolvedLiveMount[]) {
  return nonEmptyList(
    liveMountsResolved.map(({ guest, host, mode }) => ({
      guest,
      host,
      mode,
    })),
  );
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
  registered: boolean;
}

// On VMM exit, reap every per-boot artifact:
//   - reflink copies (#121, #272) so guest writes don't persist;
//   - bundle/vsock/stats temp dirs;
//   - the gvproxy child;
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
function installVmstateTimingRelay(child: ChildProcessWithoutNullStreams): void {
  if (!vmstateDebug.enabled && !restoreDebug.enabled) {
    return;
  }
  const timingDebug = vmstateDebug.enabled ? vmstateDebug : restoreDebug;
  let carry = "";
  const flushLine = (line: string) => {
    if (line.startsWith("vmstate restore timing ")) {
      timingDebug("%s", line);
    }
  };
  child.stderr.on("data", (chunk: Buffer) => {
    const text = carry + chunk.toString("utf8");
    const lines = text.split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) {
      flushLine(line);
    }
  });
  child.once("exit", () => {
    if (carry) {
      flushLine(carry);
      carry = "";
    }
  });
}

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
  vmstate: BootVmstateRuntime;
}

interface BootVmstateRuntime {
  statePath: string | undefined;
  chainId: string;
  checkpointParent: string | undefined;
  checkpointSequence: number;
}

function createBootVmHandle(args: BootHandleArgs): VmHandle {
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
    exec: makeExec(args.vsockUdsPath, args.onLog),
    execRaw: makeExecRaw(args.vsockUdsPath, args.onLog),
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

function makeExec(vsockUdsPath: string | undefined, onLog: OnLog | undefined): VmHandle["exec"] {
  return async (cmd, execOpts) => {
    const udsPath = requireVsockPath(vsockUdsPath, "exec");
    const res = await VsockExec.run(udsPath, cmd, teeOnLog(cmd, execOpts, onLog));
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
): VmHandle["execRaw"] {
  return (cmd, execOpts) => {
    if (!vsockUdsPath) {
      return Promise.reject(missingVsockError("execRaw"));
    }
    return VsockExec.run(vsockUdsPath, cmd, teeOnLog(cmd, execOpts, onLog));
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
    return {
      ceilingMib: memoryCeilingMib ?? null,
      hostRssBytes: readHostRssBytes(childPid, statsFilePath),
      balloonInflatedBytes: balloon?.bytesReported ?? 0,
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
    nested: args.nested,
    execRaw: (cmd, execOpts) => handle.execRaw(cmd, execOpts),
    wait: () => handle.wait(),
    kill: () => handle.kill(),
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
