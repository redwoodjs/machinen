import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { closeSync, openSync, rmSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import debugLib from "debug";

import { bootSnapshotPath } from "../detached-log.ts";
import { BootError, RegistryError } from "../errors.ts";
import { runGc } from "../gc.ts";
import { readProcessIdentity } from "../pid-validate.ts";
import { claimName, writeEntry } from "../registry.ts";
import type { CpuControlResult } from "../cpu-cgroup.ts";
import type { ResolvedLiveMount } from "./bundle.ts";
import type { ResolvedCpuResourcePolicy } from "./cpu-resources.ts";
import { installVmExitCleanup } from "./exit-cleanup.ts";
import { registryCpu } from "./registry-cpu.ts";
import type {
  BootOptions,
  BootPlan,
  BootResources,
  BootVmstateRuntime,
  MountDiskPaths,
  SpawnedBootVmm,
} from "./boot.ts";

const debug = debugLib("machinen:boot");

export function maybeOpenMountDiskFds(
  mountDiskPaths: MountDiskPaths | undefined,
  env: Record<string, string>,
  stdio: Array<"pipe" | number>,
): { lowerFd: number; upperFd: number } | undefined {
  return mountDiskPaths ? openMountDiskFds(mountDiskPaths, env, stdio) : undefined;
}

export function closeMountDiskFds(fds: { lowerFd: number; upperFd: number } | undefined): void {
  if (fds) {
    closeFds(fds.lowerFd, fds.upperFd);
  }
}

interface BootRegistryState {
  childPid: number;
  vmName: string | undefined;
  sourceImageAbs: string | undefined;
  rootDiskPath: string | undefined;
  rootDiskMode: "block" | "none";
  bootLogPath: string | undefined;
}

export function registerSpawnedBoot(args: {
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
    cpuPolicy: args.plan.cpuPolicy,
    cpuControl: args.spawned.cpuControl,
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
    cpuCgroupPath: spawned.cpuControl.cgroupPath,
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
    cpuCgroupPath: args.spawned.cpuControl.cgroupPath,
    gvStop: args.resources.gvStop,
    registered,
  });
}

// Roll back gvproxy + per-boot disks/dirs after a pre-spawn failure.
// Live mounts are in-VMM virtio-fs devices configured through env, so
// there are no separate live-mount helper processes to roll back.
export function rollbackPreSpawn(state: {
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
  cpuCgroupPath: string | undefined;
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
    state.cpuCgroupPath,
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
  cpuPolicy: ResolvedCpuResourcePolicy | undefined;
  cpuControl: CpuControlResult;
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
    cpu: registryCpu(args.cpuPolicy, args.cpuControl),
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
