// `boot()` and its options surface. Owns the host-side VMM lifecycle:
// asset resolution, port-forward validation, gvproxy bring-up, initramfs
// pack, rootdisk materialization, VMM spawn + pdeathsig wrap, registry
// write, live-mount helper spawn, the returned `VmHandle`, and the
// `--detached` readiness gate.

import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import debugLib from "debug";

import { readBalloonStats } from "../balloon-stats.ts";
import {
  bootReadinessFailureMessage,
  bootStderrTail,
  runVsockWithBootDiagnostics,
  waitForDetachedExecAgent,
} from "./boot-diagnostics.ts";
import { makeReseedVmstateEntropy, makeSyncVmstateSnapshot } from "./vsock-handle-ops.ts";
import { detachedLogRoot, writeBootSnapshot } from "../detached-log.ts";
import { BootError, ExecError, RegistryError, SnapshotError } from "../errors.ts";
import { VsockExec } from "../exec.ts";
import { runGc } from "../gc.ts";
import { ensureGvproxy, exposePort, spawnGvproxy, warnGvproxyMissing } from "../gvproxy.ts";
import type { OnLog } from "../log.ts";
import {
  applyNestedVirtualizationEnv,
  preflightNestedVirtualization,
  probeVmmNestedVirtualization,
} from "../nested-virt.ts";
import { ensurePdeathsig } from "../pdeathsig.ts";
import { PhaseTimer } from "../phase-timer.ts";
import { applyCpuControls, type CpuControlResult } from "../cpu-cgroup.ts";
import { readHostRssBytes } from "../proc-rss.ts";
import { planBootMountDiskFdEnvNative } from "../native/boot-plan.ts";
import { planGuestHostnameSetNative } from "../native/guest-hostname.ts";
import { planBootSnapshotBackingNative as planSnapshotBacking } from "../native/snapshot-backing.ts";
import { planBootSnapshotContextNative } from "../native/snapshot-context.ts";
import { claimName, findEntry, writeEntry } from "../registry.ts";
import { setupKernelDtbEnv } from "./boot-assets.ts";
import { planBootCore } from "./boot-core-plan.ts";
import { buildMergedGuestEnv, setupLiveMountEnv } from "./boot-guest-env.ts";
import { planPortForwardOpts } from "./boot-port-forward.ts";
import { materializeRootdisk } from "./boot-rootdisk.ts";
import { prepareScratchDisk } from "./boot-scratch.ts";
import { setupVmstateBoot, type BootVmstateRuntime } from "./boot-vmstate.ts";
import { setupVsockBridge } from "./boot-vsock.ts";
import type { ResolvedCpuResourcePolicy } from "./cpu-resources.ts";
import { synthesizeAndPackBundle, type ResolvedLiveMount } from "./bundle.ts";
import { installVmExitCleanup } from "./exit-cleanup.ts";
import { performForkWithRestore } from "./fork-core.ts";
import { validateBatchLiveMounts, withBatchLiveMountSync } from "./live-mount-batch.ts";
import type { BootResourcesOptions } from "./memory-resources.ts";
import { registryCpu } from "./registry-cpu.ts";
import type { VmHandle } from "../vm-handle.ts";
import {
  buildWriteFileCmds,
  collect,
  CONSOLE_TAIL_BYTES,
  resolveVmmBinary,
  setGuestHostname,
  teeOnLog,
} from "./helpers.ts";
import { performSnapshot, type SnapshotContext } from "./snapshot.ts";
import { resolveSnapshotEngine } from "./snapshot-engine.ts";
import { setupStatsFile } from "./stats-file.ts";
import {
  installInheritedStdio,
  makeKill,
  makeWait,
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
   * Copy one host directory into a writable guest overlay at a safe absolute
   * path. Guest writes survive snapshot/restore but do not touch the host.
   * Use `liveMounts` when writes should sync back. Pass `unsafeGuestPath: true`
   * only when intentionally mounting over a reserved runtime path.
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
   * Host directories exposed as live virtio-fs shares. `ro` is read-only;
   * `rw` writes sync back to the host in batches. Guest paths must be safe
   * absolute paths unless `unsafeGuestPath: true` is set intentionally.
   * Snapshot / restore / fork record path topology, not file bytes.
   */
  liveMounts?: Array<{
    host: string;
    guest: string;
    mode?: "ro" | "rw";
    unsafeGuestPath?: boolean;
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
  /**
   * Path to the guest kernel Image. Forwarded as `MACHINEN_KERNEL`.
   * Optional for normal boots; when `binary` is omitted, `boot()` resolves
   * the release base kernel from `MACHINEN_ASSETS_DIR` or the CLI cache.
   */
  kernel?: string;
  /**
   * Path to the guest device-tree blob. Forwarded as `MACHINEN_DTB`.
   * Optional for normal boots; when `binary` is omitted, `boot()` resolves
   * the release base DTB on guest architectures that need one.
   */
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

  // In-flight ring buffer of stderr for early boot diagnostics. Attach
  // before the generic collector so very fast VMM exits do not lose their
  // panic line to the first `data` listener. Detached boots dump this to
  // `bootLogPath`; attached boots use it when exec-agent calls fail before
  // the stderr stream has closed.
  const bootDiagnosticChunks: Buffer[] = [];
  installBootStderrCapture(child, bootDiagnosticChunks);

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

  let handle = createBootVmHandle({
    child,
    childPid,
    vmName,
    timeoutMs,
    outputCollector,
    errorCollector,
    stderrTail: () => bootStderrTail(bootDiagnosticChunks),
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
  const plannedHostname = planGuestHostnameSetNative({
    pid: handle.pid,
    name: handle.name,
    vsockUdsPath,
    skip: env.MACHINEN_SKIP_GUEST_HOSTNAME === "1",
  });
  if (plannedHostname) {
    void setGuestHostname(handle, plannedHostname);
  }

  if (opts.detached && bootLogPath) {
    await gateOnDetachedReadiness({
      child,
      timeoutMs: plan.detachedReadinessTimeoutMs,
      bootLogPath,
      detachedBootChunks: bootDiagnosticChunks,
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

interface BootPlan {
  portForward: NonNullable<BootOptions["portForward"]>;
  binary: string;
  env: Record<string, string>;
  memoryCeilingMib: number | undefined;
  cpuPolicy: ResolvedCpuResourcePolicy | undefined;
  timeoutMs: number | null;
  detachedReadinessTimeoutMs: number;
  diskAbs: string | undefined;
  perBootSnapDisk: string | undefined;
  wantsRootDisk: boolean;
  needsInitramfs: boolean;
  vsockUdsPath: string | undefined;
  vsockTempDir: string | undefined;
  statsFilePath: string | undefined;
  statsTempDir: string | undefined;
  usePdeathsig: boolean;
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
  plan.env.MACHINEN_INITRD = packed.cpioPath;
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

interface SpawnedBootVmm {
  child: ChildProcessWithoutNullStreams;
  vmmPdeathsig: string | null;
  perBootMountUpper: string | undefined;
  cpuControl: CpuControlResult;
}

async function spawnBootVmm(args: SpawnBootArgs): Promise<SpawnedBootVmm> {
  args.phases.start("vmm-spawn");
  const vmmPdeathsig = await resolveVmmPdeathsig(args.plan.usePdeathsig);
  const vmmArgv = planBootVmmArgv(args.plan.binary, args.opts.args ?? [], vmmPdeathsig);
  const stdio: Array<"pipe" | number> = ["pipe", "pipe", "pipe"];
  const mountDiskFds = maybeOpenMountDiskFds(args.resources.mountDiskPaths, args.plan.env, stdio);
  const child = nodeSpawn(vmmArgv.command, vmmArgv.args, {
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

async function resolveVmmPdeathsig(usePdeathsig: boolean): Promise<string | null> {
  return usePdeathsig ? ensurePdeathsig() : null;
}

function planBootVmmArgv(
  binary: string,
  args: string[],
  pdeathsigPath: string | null,
): { command: string; args: string[] } {
  return pdeathsigPath
    ? { command: pdeathsigPath, args: [binary, ...args] }
    : { command: binary, args };
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

interface BootRegistryLifecyclePlan {
  claimName: string | null;
  shouldWrite: boolean;
}

function registerSpawnedBoot(args: {
  opts: BootOptions;
  plan: BootPlan;
  resources: BootResources;
  spawned: SpawnedBootVmm;
  bootT0: number;
}): BootRegistryState {
  const state = buildBootRegistryState(args.opts, args.resources, args.spawned);
  const lifecycle = planBootRegistryLifecycle({
    name: state.vmName,
    childPid: state.childPid,
    vsockUdsPath: args.plan.vsockUdsPath,
  });
  claimBootNameIfNeeded(state, args.spawned.child, lifecycle);
  const registered = writeBootRegistryIfPossible(args, state, lifecycle);
  installBootExitCleanup(args, state, registered);
  return state;
}

function buildBootRegistryState(
  opts: BootOptions,
  resources: BootResources,
  spawned: SpawnedBootVmm,
): BootRegistryState {
  const childPid = spawned.child.pid ?? -1;
  const rootDiskPath = resources.perBootRootDisk ?? registryCallerRootDiskPath(opts);
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

function registryCallerRootDiskPath(opts: BootOptions): string | undefined {
  return typeof opts.rootDisk === "string"
    ? resolve(opts.cwd ?? process.cwd(), opts.rootDisk)
    : undefined;
}

function registryBootLogPath(opts: BootOptions, childPid: number): string | undefined {
  if (!opts.detached || childPid <= 0) {
    return undefined;
  }
  return join(detachedLogRoot(), `${childPid}.boot.log`);
}

function planBootRegistryLifecycle(input: {
  name?: string;
  childPid: number;
  vsockUdsPath?: string;
}): BootRegistryLifecyclePlan {
  const hasLivePid = input.childPid > 0;
  return {
    claimName: hasLivePid ? (input.name ?? null) : null,
    shouldWrite: hasLivePid && input.vsockUdsPath !== undefined,
  };
}

function claimBootNameIfNeeded(
  state: BootRegistryState,
  child: ChildProcessWithoutNullStreams,
  lifecycle: BootRegistryLifecyclePlan,
): void {
  if (lifecycle.claimName) {
    claimNameOrThrow(lifecycle.claimName, state.childPid, child);
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
  lifecycle: BootRegistryLifecyclePlan,
): boolean {
  if (!lifecycle.shouldWrite) {
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
  const vmstate = registryVmstate(args.plan.vmstate);
  return {
    childPid: state.childPid,
    vmName: state.vmName,
    vsockUdsPath: args.plan.vsockUdsPath!,
    sourceImageAbs: state.sourceImageAbs,
    kernelPath: args.plan.env.MACHINEN_KERNEL,
    dtbPath: args.plan.env.MACHINEN_DTB,
    rootDiskPath: state.rootDiskPath,
    rootDiskMode: state.rootDiskMode,
    diskPath: args.plan.diskAbs,
    forkedFrom: args.opts.forkedFrom,
    bootLogPath: state.bootLogPath,
    cleanupPaths: cleanupPathsForBoot(args.plan, args.resources, args.spawned),
    binary: args.plan.binary,
    vmmPdeathsig: args.spawned.vmmPdeathsig,
    gvPid: args.resources.gvPid,
    gvExe: args.resources.gvExe,
    portForward: args.plan.portForward,
    memoryCeilingMib: args.plan.memoryCeilingMib,
    cpuPolicy: args.plan.cpuPolicy,
    cpuControl: args.spawned.cpuControl,
    statsPath: args.plan.statsFilePath,
    mountDiskPaths: args.resources.mountDiskPaths,
    liveMountsResolved: args.plan.liveMountsResolved,
    vmstateStatePath: vmstate.statePath ?? undefined,
    vmstateChainId: vmstate.chainId ?? undefined,
    vmstateCheckpointParent: vmstate.checkpointParent ?? undefined,
    vmstateCheckpointSequence: vmstate.checkpointSequence ?? undefined,
    nested: args.opts.nested || undefined,
  };
}

function registryVmstate(vmstate: BootVmstateRuntime): {
  statePath?: string;
  chainId?: string;
  checkpointParent?: string;
  checkpointSequence?: number;
} {
  if (!vmstate.statePath) {
    return {};
  }
  return {
    statePath: vmstate.statePath,
    chainId: vmstate.chainId,
    checkpointParent: vmstate.checkpointParent,
    checkpointSequence: vmstate.checkpointSequence,
  };
}

function cleanupPathsForBoot(
  plan: BootPlan,
  resources: BootResources,
  spawned: SpawnedBootVmm,
): string[] {
  return [
    resources.perBootRootDisk,
    plan.perBootSnapDisk,
    spawned.perBootMountUpper,
    resources.bundleTempDir,
    plan.vsockTempDir,
    plan.statsTempDir,
    resources.gvSocketDir,
    spawned.cpuControl.cgroupPath,
  ].filter((path): path is string => path !== undefined);
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
    cpuCgroupPath: args.spawned.cpuControl.cgroupPath,
    gvStop: args.resources.gvStop,
    registered,
  });
}

async function prepareBootPlan(opts: BootOptions, phases: PhaseTimer): Promise<BootPlan> {
  const assets = await resolveBootAssets(opts, phases);
  const env = buildVmmEnv(opts);
  configureNestedVirtualization(opts, assets.binary, env);
  const corePlan = planBootCore(opts, env);
  if (corePlan.vmmMemory !== null) {
    env.MACHINEN_MEMORY = corePlan.vmmMemory;
  }
  const memoryCeilingMib = corePlan.memoryCeilingMib ?? undefined;
  const cpuPolicy = corePlan.cpuPolicy ?? undefined;
  const scratch = prepareBootScratchDisk(opts, env, phases);
  const wantsRootDisk = corePlan.wantsRootDisk;
  setupKernelDtbEnv(opts, env);
  const vsock = setupVsockBridge(env);
  const stats = setupStatsFile(env, vsock.vsockTempDir);
  const vmstateSetup = setupVmstateBoot(opts, env, vsock.vsockTempDir);
  const liveMountsResolved = setupLiveMountEnv(opts, env);
  validateBatchLiveMounts(opts, liveMountsResolved, vsock.vsockUdsPath);
  return {
    ...assets,
    env,
    memoryCeilingMib,
    cpuPolicy,
    timeoutMs: corePlan.timeoutMs,
    detachedReadinessTimeoutMs: corePlan.detachedReadinessTimeoutMs,
    ...scratch,
    wantsRootDisk,
    needsInitramfs: corePlan.needsInitramfs,
    vsockUdsPath: vsock.vsockUdsPath,
    vsockTempDir: vmstateSetup.vsockTempDir,
    ...stats,
    usePdeathsig: corePlan.usePdeathsig,
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
  const portForward = await planPortForwardOpts(opts);
  const binary = resolveBootBinary(opts);
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

function buildVmmEnv(opts: BootOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...opts.vmmEnv };
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
  if (env.MACHINEN_NET_SOCKET !== undefined) {
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
        "portForward requires gvproxy, but no gvproxy binary was found.",
      );
    }
    debug("gvproxy not found — booting without networking");
    warnGvproxyMissing();
    return { gvStop: undefined, gvPid: undefined, gvExe: undefined, gvSocketDir: undefined };
  }
  const gvproxyPath = gvBin;
  debug("starting gvproxy bin=%s", gvproxyPath);
  // Detach gvproxy alongside the VMM so the parent can exit
  // without stranding the guest's networking (#150 phase 2 PR3).
  const gv = await spawnGvproxy(gvproxyPath, { detached: opts.detached });
  env.MACHINEN_NET_SOCKET = gv.socketPath;
  for (const m of portForward) {
    await exposePort(gv.controlSocketPath, m);
  }
  return {
    gvStop: gv.stop,
    gvPid: gv.child.pid,
    gvExe: gvproxyPath,
    gvSocketDir: gv.socketDir,
  };
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
  const lowerChildFd = stdio.length;
  stdio.push(lowerFd);
  const upperChildFd = stdio.length;
  stdio.push(upperFd);
  Object.assign(
    env,
    planBootMountDiskFdEnvNative({ lowerFd: lowerChildFd, upperFd: upperChildFd }),
  );
  return { lowerFd, upperFd };
}

function closeFds(...fds: number[]): void {
  for (const fd of fds) {
    try {
      closeSync(fd);
    } catch {}
  }
}

// Backstop for stale/recycled-pid name pins: run GC, retry once,
// then fail if a live VMM still owns the name.
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

interface RegisterArgs {
  childPid: number;
  vmName: string | undefined;
  vsockUdsPath: string;
  sourceImageAbs: string | undefined;
  kernelPath: string | undefined;
  dtbPath: string | undefined;
  rootDiskPath: string | undefined;
  rootDiskMode: "block" | "none";
  diskPath: string | undefined;
  forkedFrom: string | undefined;
  bootLogPath: string | undefined;
  cleanupPaths: string[];
  binary: string;
  vmmPdeathsig: string | null;
  gvPid: number | undefined;
  gvExe: string | undefined;
  portForward: NonNullable<BootOptions["portForward"]>;
  memoryCeilingMib: number | undefined;
  cpuPolicy: ResolvedCpuResourcePolicy | undefined;
  cpuControl: CpuControlResult;
  statsPath: string | undefined;
  mountDiskPaths: MountDiskPaths | undefined;
  liveMountsResolved: ResolvedLiveMount[];
  vmstateStatePath: string | undefined;
  vmstateChainId: string | undefined;
  vmstateCheckpointParent: string | undefined;
  vmstateCheckpointSequence: number | undefined;
  nested: boolean | undefined;
}

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
  const processPlan = registryProcessPlan(args);
  return {
    pid: args.childPid,
    name: args.vmName,
    socketPath: args.vsockUdsPath,
    imagePath: args.sourceImageAbs,
    kernelPath: args.kernelPath,
    dtbPath: args.dtbPath,
    rootDiskPath: args.rootDiskPath,
    rootDiskMode: args.rootDiskMode,
    diskPath: args.diskPath,
    forkedFrom: args.forkedFrom,
    bootLogPath: args.bootLogPath,
    cleanupPaths: nonEmptyList(args.cleanupPaths),
    vmmExe: processPlan.vmmExe,
    gvproxyPid: args.gvPid,
    gvproxyExe: processPlan.gvproxyExe,
    portForward: registryPortForward(args.portForward),
    memoryCeilingMib: args.memoryCeilingMib,
    cpu: registryCpu(args.cpuPolicy, args.cpuControl),
    statsPath: args.statsPath,
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

function registryProcessPlan(args: RegisterArgs): { vmmExe: string; gvproxyExe?: string } {
  return {
    vmmExe: process.platform === "darwin" && args.vmmPdeathsig ? args.vmmPdeathsig : args.binary,
    gvproxyExe: args.gvExe,
  };
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
  return nonEmptyList(liveMountsResolved.map(({ guest, host, mode }) => ({ guest, host, mode })));
}

function registryPortForward(portForward: NonNullable<BootOptions["portForward"]>) {
  return nonEmptyList(portForward);
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

function installBootStderrCapture(child: ChildProcessWithoutNullStreams, sink: Buffer[]): void {
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
  stderrTail: () => string;
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
    exec: makeExec(args.vsockUdsPath, args.onLog, args.child, args.errorCollector, args.stderrTail),
    execRaw: makeExecRaw(
      args.vsockUdsPath,
      args.onLog,
      args.child,
      args.errorCollector,
      args.stderrTail,
    ),
    reseedVmstateEntropy: makeReseedVmstateEntropy(
      args.vsockUdsPath,
      args.child,
      args.errorCollector,
      args.stderrTail,
    ),
    syncVmstateSnapshot: makeSyncVmstateSnapshot(
      args.vsockUdsPath,
      args.child,
      args.errorCollector,
      args.stderrTail,
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
  stderrTail: () => string,
): VmHandle["exec"] {
  return async (cmd, execOpts) => {
    const udsPath = requireVsockPath(vsockUdsPath, "exec");
    const res = await runVsockWithBootDiagnostics(child, errorCollector, stderrTail, () =>
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
  stderrTail: () => string,
): VmHandle["execRaw"] {
  return (cmd, execOpts) => {
    if (!vsockUdsPath) {
      return Promise.reject(missingVsockError("execRaw"));
    }
    return runVsockWithBootDiagnostics(child, errorCollector, stderrTail, () =>
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
  const plan = planSnapshotBacking(resolveSnapshotEngine(), action, diskAbs, vmstateStatePath);
  if (!plan.allowed) {
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
  const execRawForSnapshot: SnapshotContext["execRaw"] = handle.execRaw.bind(handle);
  const syncVmstateForSnapshot = handle.syncVmstateSnapshot?.bind(handle);
  const waitForSnapshot = handle.wait.bind(handle);
  const killForSnapshot = handle.kill.bind(handle);
  const snapshotPlan = planBootSnapshotContextNative({
    mountDisk: args.mountDiskPaths,
    liveMounts: args.liveMountsResolved,
    vmstate: args.vmstate,
  });
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
    mountDisk: snapshotPlan.mountDisk,
    liveMounts: snapshotPlan.liveMounts,
    vmstatePath: args.vmstate.statePath,
    vmstateChain: snapshotPlan.vmstateChain,
    updateVmstateChain: snapshotVmstateUpdater(args.vmstate, args.childPid),
    nested: args.nested,
    execRaw: execRawForSnapshot,
    syncVmstateSnapshot: syncVmstateForSnapshot,
    wait: waitForSnapshot,
    kill: killForSnapshot,
    teeGuestConsole: (onChunk) => {
      args.child.stderr.on("data", onChunk);
    },
    errorOutput: () => handle.errorOutput(),
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
async function gateOnDetachedReadiness(args: {
  child: ChildProcessWithoutNullStreams;
  timeoutMs: number;
  bootLogPath: string;
  detachedBootChunks: Buffer[];
  handle: VmHandle;
}): Promise<void> {
  const outcome = await waitForDetachedExecAgent(args, args.timeoutMs);
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
        `boot --detached: exec-agent did not become reachable within ${args.timeoutMs}ms.`,
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
