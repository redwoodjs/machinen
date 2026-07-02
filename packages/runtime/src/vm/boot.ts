import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import debugLib from "debug";

import { BootError } from "../errors.ts";
import type { OnLog } from "../log.ts";
import { ensurePdeathsig, wrapWithPdeathsig } from "../pdeathsig.ts";
import { PhaseTimer } from "../phase-timer.ts";
import { applyCpuControls, type CpuControlResult } from "../cpu-cgroup.ts";
import {
  planBootCoreNative,
  planBootInitrdEnvNative,
  planBootVirtiofsEnvNative,
  planBootVmstateEnvNative,
  planBootVmstateRuntimeNative,
} from "../native/boot-plan.ts";
import { planBootRootDiskModeNative } from "../native/root-disk-mode.ts";
import { planBootVmmEnvNative } from "../native/vmm-env.ts";
import { planBootVmstateTempModeNative as planVmstateTempMode } from "../native/vmstate-temp-mode.ts";
import { materializeRootdisk } from "./boot-rootdisk.ts";
import { resolveCpuResourcePolicy, type ResolvedCpuResourcePolicy } from "./cpu-resources.ts";
import { resolveLiveMounts, synthesizeAndPackBundle, type ResolvedLiveMount } from "./bundle.ts";
import { validateBatchLiveMounts, withBatchLiveMountSync } from "./live-mount-batch.ts";
import type { BootResourcesOptions } from "./memory-resources.ts";
import type { VmHandle } from "../vm-handle.ts";
import {
  buildGuestHostname,
  collect,
  CONSOLE_TAIL_BYTES,
  resolveVmmBinary,
  setGuestHostname,
} from "./helpers.ts";
import { resolveSnapshotEngine } from "./snapshot-engine.ts";
import { setupKernelDtbEnv } from "./boot-assets.ts";
import { createBootVmHandle, gateOnDetachedReadiness } from "./boot-handle.ts";
import {
  bringUpGvproxy,
  configureNestedVirtualization,
  prepareScratchDisk,
  setupStatsFile,
  setupVsockBridge,
  validatePortForwardOpts,
} from "./boot-env.ts";
import {
  closeMountDiskFds,
  maybeOpenMountDiskFds,
  registerSpawnedBoot,
  rollbackPreSpawn,
} from "./boot-registry.ts";
import {
  installInheritedStdio,
  validateBootStdio,
  withInheritedStdioCleanup,
} from "./handle-lifecycle.ts";

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
   *     checkpoint images on `/dev/vdb`; the guest's
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
   * Pass `unsafeGuestPath: true` only when intentionally mounting over
   * a reserved runtime path.
   *
   * See #64 (original `mount`), #78 (`liveMount`), #114 (rootdisk
   * relocation; same shape), #272 (this overlay relocation).
   */
  mount?: { host: string; guest: string; unsafeGuestPath?: boolean };
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
   * #332). Unlike `mount` (copy-once), these stay connected to the
   * host: guest reads stream on demand and `"rw"` writes sync back to
   * the host. Set `"ro"` for a one-way share.
   *
   * Each guest path must live under `/mnt/`. Up to 5 entries are served
   * by in-VMM virtio-fs devices; no guest agent or vsock transport is
   * involved. Metadata uses the fast policy. `ro` mounts are read-only;
   * `rw` mounts sync writes back to the host in batches after guest
   * workload exit and host lifecycle calls.
   *
   * Snapshot / restore / fork record host path, guest path, and mode,
   * but not bytes. Restoring on another host fails if the recorded host
   * path is missing; pass `restore({ liveMounts })` with matching
   * `guest` paths to remap host/mode.
   *
   * Security note: a live-share mount is a persistent guest-to-host
   * filesystem channel bounded to the configured host root. Prefer
   * `mount` for untrusted inputs that do not need write-through.
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
  /** Explicit resource goals for the VM. Prefer this for user-facing memory policy. */
  resources?: BootResourcesOptions;
  /**
   * Compatibility alias for `resources.memory.maxMib`, in MiB. This is
   * a guest-visible ceiling, not current host RSS; prefer
   * `resources.memory` for user-facing policy.
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
   * Host stdio behavior for foreground boots. The default, `"pipe"`, preserves
   * the existing runtime behavior: callers read/write `vm.stdin`, `vm.stdout`,
   * and `vm.stderr` themselves. `"inherit"` connects those streams to the
   * current process and puts TTY stdin in raw mode until the VM exits, matching
   * the ergonomics of Node's `child_process.spawn({ stdio: "inherit" })`.
   *
   * `stdio: "inherit"` is for foreground workloads and cannot be combined with
   * `detached: true`.
   */
  stdio?: "pipe" | "inherit";
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

export type MountDiskPaths = {
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
  validateBootStdio(opts);
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

  const timeoutMs = plan.timeoutMs;

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
  const inheritedStdio = opts.stdio === "inherit" ? installInheritedStdio(child) : undefined;
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

  let handle = createBootVmHandle({
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
      cpuPolicy: plan.cpuPolicy,
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
      timeoutMs: plan.detachedReadinessTimeoutMs,
      bootLogPath,
      detachedBootChunks,
      handle,
    });
  }

  handle = withBatchLiveMountSync(handle, liveMountsResolved);
  if (inheritedStdio) {
    handle = withInheritedStdioCleanup(handle, inheritedStdio);
  }
  return handle;
}

// =============================================================
// Helpers
// =============================================================

export interface BootPlan {
  portForward: NonNullable<BootOptions["portForward"]>;
  binary: string;
  env: Record<string, string>;
  memoryCeilingMib: number | undefined;
  cpuPolicy: ResolvedCpuResourcePolicy | undefined;
  diskAbs: string | undefined;
  perBootSnapDisk: string | undefined;
  wantsRootDisk: boolean;
  needsInitramfs: boolean;
  timeoutMs: number | null;
  detachedReadinessTimeoutMs: number;
  usePdeathsig: boolean;
  vsockUdsPath: string | undefined;
  vsockTempDir: string | undefined;
  statsFilePath: string | undefined;
  statsTempDir: string | undefined;
  vmstate: BootVmstateRuntime;
  liveMountsResolved: ResolvedLiveMount[];
  mergedGuestEnv: Record<string, string>;
}

export interface BootResources {
  gvStop: (() => void) | undefined;
  gvPid: number | undefined;
  gvExe: string | undefined;
  gvSocketDir: string | undefined;
  bundleTempDir: string | undefined;
  mountDiskPaths: MountDiskPaths | undefined;
  perBootRootDisk: string | undefined;
}

export interface BootVmstateRuntime {
  statePath: string | undefined;
  chainId: string;
  checkpointParent: string | undefined;
  checkpointSequence: number;
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
  if (!plan.needsInitramfs) {
    return { bundleTempDir: undefined, mountDiskPaths: undefined };
  }
  phases.start("initramfs-pack");
  const packed = synthesizeAndPackBundle(opts, plan.mergedGuestEnv, plan.liveMountsResolved, {
    useTiny: plan.wantsRootDisk,
    env: plan.env,
    mountDiskUpperSizeBytes: opts.mountDiskUpperSizeBytes,
    onPhase: (name, ms) => phases.mark(`initramfs-pack.${name}`, ms),
  });
  plan.env.MACHINEN_INITRD = planBootInitrdEnvNative(packed.cpioPath);
  const packMs = phases.end("initramfs-pack");
  debug("initramfs packed cpio=%s elapsed=%dms", packed.cpioPath, packMs ?? -1);
  return { bundleTempDir: packed.tempDir, mountDiskPaths: packed.mountDisk };
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

export interface SpawnedBootVmm {
  child: ChildProcessWithoutNullStreams;
  vmmPdeathsig: string | null;
  perBootMountUpper: string | undefined;
  cpuControl: CpuControlResult;
}

async function spawnBootVmm(args: SpawnBootArgs): Promise<SpawnedBootVmm> {
  args.phases.start("vmm-spawn");
  const vmmPdeathsig = await resolveVmmPdeathsig(args.plan);
  const wrappedVmm = wrapWithPdeathsig(vmmPdeathsig, args.plan.binary, args.opts.args ?? []);
  const stdio: Array<"pipe" | number> = ["pipe", "pipe", "pipe"];
  const mountDiskFds = maybeOpenMountDiskFds(args.resources.mountDiskPaths, args.plan.env, stdio);
  const child = nodeSpawn(wrappedVmm.command, wrappedVmm.args, {
    cwd: args.opts.cwd,
    env: args.plan.env,
    stdio,
  }) as ChildProcessWithoutNullStreams;
  closeMountDiskFds(mountDiskFds);
  const cpuControl = applySpawnedCpuControls(child, args.plan.cpuPolicy);
  args.phases.end("vmm-spawn");
  args.phases.start("first-guest-byte");
  logVmmSpawn(child, args.plan.binary, vmmPdeathsig, args.bootT0);
  return {
    child,
    vmmPdeathsig,
    perBootMountUpper: args.resources.mountDiskPaths?.upperPath,
    cpuControl,
  };
}

function applySpawnedCpuControls(
  child: ChildProcessWithoutNullStreams,
  cpuPolicy: ResolvedCpuResourcePolicy | undefined,
): CpuControlResult {
  try {
    return applyCpuControls(child.pid ?? -1, cpuPolicy);
  } catch (err) {
    try {
      child.kill("SIGKILL");
    } catch {}
    throw err;
  }
}

async function resolveVmmPdeathsig(plan: BootPlan): Promise<string | null> {
  return plan.usePdeathsig ? ensurePdeathsig() : null;
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

async function prepareBootPlan(opts: BootOptions, phases: PhaseTimer): Promise<BootPlan> {
  const assets = await resolveBootAssets(opts, phases);
  const env = buildVmmEnv(opts);
  configureNestedVirtualization(opts, assets.binary, env);
  const core = resolveCoreBootPlan(opts, env);
  const cpuPolicy = resolveCpuResourcePolicy(opts.resources?.cpu);
  setVcpuCount(cpuPolicy, env);
  const scratch = prepareBootScratchDisk(opts, env, phases);
  setupKernelDtbEnv(opts, env);
  const vsock = setupVsockBridge(env);
  const stats = setupStatsFile(env, vsock.vsockTempDir);
  const vmstateSetup = setupVmstateBoot(opts, env, vsock.vsockTempDir, cpuPolicy);
  const liveMountsResolved = setupLiveMountEnv(opts, env);
  validateBatchLiveMounts(opts, liveMountsResolved, vsock.vsockUdsPath);
  return {
    ...assets,
    env,
    memoryCeilingMib: core.memoryCeilingMib,
    cpuPolicy,
    ...scratch,
    wantsRootDisk: core.wantsRootDisk,
    needsInitramfs: core.needsInitramfs,
    timeoutMs: core.timeoutMs,
    detachedReadinessTimeoutMs: core.detachedReadinessTimeoutMs,
    usePdeathsig: core.usePdeathsig,
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
  return planBootVmmEnvNative({
    hostEnv: process.env,
    overrides: opts.vmmEnv,
  });
}

function resolveCoreBootPlan(
  opts: BootOptions,
  env: Record<string, string>,
): {
  memoryCeilingMib: number | undefined;
  wantsRootDisk: boolean;
  needsInitramfs: boolean;
  timeoutMs: number | null;
  detachedReadinessTimeoutMs: number;
  usePdeathsig: boolean;
} {
  const plan = planBootCoreNative({
    memoryMib: opts.memory,
    resourcesMemory: opts.resources?.memory,
    vmmMemoryPreset: env.MACHINEN_MEMORY !== undefined,
    hasImage: opts.image !== undefined,
    hasCmd: opts.cmd !== undefined,
    hasSnapshot: Boolean(opts.snapshot),
    detached: opts.detached,
    pdeathsig: opts.pdeathsig,
    bootTimeoutMs: opts.timeoutMs,
    rootDisk: rootDiskPlanMode(opts),
  });
  if (plan.vmmMemory !== null) {
    env.MACHINEN_MEMORY = plan.vmmMemory;
  }
  return {
    memoryCeilingMib: plan.memoryCeilingMib ?? undefined,
    wantsRootDisk: plan.wantsRootDisk,
    needsInitramfs: plan.needsInitramfs,
    timeoutMs: plan.timeoutMs,
    detachedReadinessTimeoutMs: plan.detachedReadinessTimeoutMs,
    usePdeathsig: plan.usePdeathsig,
  };
}

function rootDiskPlanMode(opts: BootOptions): "unset" | "false" | "path" | "true" {
  if (opts.rootDisk === false) {
    return "false";
  }
  if (opts._rootDiskRestorePath !== undefined) {
    return "path";
  }
  return planBootRootDiskModeNative({
    rootDisk: opts.rootDisk,
    restorePath: opts._rootDiskRestorePath,
  });
}

function setVcpuCount(
  cpuPolicy: ResolvedCpuResourcePolicy | undefined,
  env: Record<string, string>,
): void {
  env.MACHINEN_MAX_VCPUS = String(cpuPolicy?.maxVcpus ?? 1);
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

function setupVmstateBoot(
  opts: BootOptions,
  env: Record<string, string>,
  inputVsockTempDir: string | undefined,
  cpuPolicy: ResolvedCpuResourcePolicy | undefined,
): { vmstate: BootVmstateRuntime; vsockTempDir: string | undefined } {
  let vsockTempDir = inputVsockTempDir;
  let stateTempDir: string | undefined;
  const chainId = randomBytes(16).toString("hex");
  const tempMode = planVmstateTempMode(
    resolveSnapshotEngine(),
    opts.snapshot === false || isMultiVcpu(cpuPolicy),
    vsockTempDir,
  );
  if (tempMode.action === "allocate") {
    stateTempDir = vsockTempDir = mkdtempSync(join(tmpdir(), "machinen-vsock-"));
  } else if (tempMode.tempDir) {
    stateTempDir = vsockTempDir = tempMode.tempDir;
  }
  const runtime = planBootVmstateRuntimeNative({
    stateTempDir,
    chainId,
    restorePath: opts._vmstateRestorePath,
    forkedFrom: opts.forkedFrom,
  });
  const vmstate: BootVmstateRuntime = {
    statePath: runtime.statePath ?? undefined,
    chainId: runtime.chainId ?? chainId,
    checkpointParent: runtime.checkpointParent ?? undefined,
    checkpointSequence: runtime.checkpointSequence ?? 0,
  };
  applyVmstateEnvPlan(opts, env, vmstate.statePath);
  return { vmstate, vsockTempDir };
}

function isMultiVcpu(cpuPolicy: ResolvedCpuResourcePolicy | undefined): boolean {
  return (cpuPolicy?.maxVcpus ?? 1) > 1;
}

function applyVmstateEnvPlan(
  opts: BootOptions,
  env: Record<string, string>,
  vmstatePath: string | undefined,
): void {
  const plan = planBootVmstateEnvNative({
    vmstatePath,
    restorePath: opts._vmstateRestorePath,
    enableTiming: vmstateDebug.enabled || restoreDebug.enabled,
    existingTiming: env.MACHINEN_VMSTATE_TIMING,
  });
  if (plan.snapshotPath) {
    env.MACHINEN_SNAPSHOT_PATH = plan.snapshotPath;
  }
  if (plan.restorePath) {
    env.MACHINEN_RESTORE_PATH = plan.restorePath;
  }
  if (plan.vmstateTiming) {
    env.MACHINEN_VMSTATE_TIMING = plan.vmstateTiming;
  }
}

function setupLiveMountEnv(opts: BootOptions, env: Record<string, string>): ResolvedLiveMount[] {
  const liveMounts = opts.liveMounts ?? [];
  if (liveMounts.length === 0) {
    return [];
  }
  const resolved = resolveLiveMounts(liveMounts, opts.cwd);
  Object.assign(env, planBootVirtiofsEnvNative(resolved));
  return resolved;
}

function buildMergedGuestEnv(
  opts: BootOptions,
  vsockUdsPath: string | undefined,
): Record<string, string> {
  return planBootCoreNative({
    guestEnv: opts.env,
    name: opts.name,
    vsockUdsPath,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).mergedGuestEnv;
}

// Validate portForward up front — before resolving the binary or
// touching the filesystem — so caller-input errors surface with a
// clear message. The env-dependent "pre-set MACHINEN_NET_SOCKET"
// check happens alongside since it only reads env.
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
