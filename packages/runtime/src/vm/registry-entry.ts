// Registry entry construction for the Linux provider.
//
// Extracted from `boot.ts` so the boot orchestration file stays within the
// repo's file-size guard while gaining provider metadata. Pure: it maps a
// spawn description onto a `RegistryEntry` and touches no process state.

import type { CpuControlResult } from "../cpu-cgroup.ts";
import { registryCpu } from "./registry-cpu.ts";
import { LINUX_CAPABILITIES, type ProviderId } from "../provider/types.ts";
import type { RegistryEntry } from "../registry.ts";
import type { BootOptions } from "./boot.ts";
import type { ResolvedCpuResourcePolicy } from "./cpu-resources.ts";
import type { ResolvedLiveMount } from "./bundle.ts";

export interface LinuxRegistryArgs {
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

export interface MountDiskPaths {
  lowerPath: string;
  upperPath: string;
  guest: string;
  upperSizeBytes: number;
}

export function linuxProviderId(): ProviderId {
  return process.platform === "darwin" ? "machinen-hvf" : "machinen-kvm";
}

export function buildLinuxRegistryEntry(args: LinuxRegistryArgs): RegistryEntry {
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
    guestOS: "linux",
    provider: linuxProviderId(),
    capabilities: LINUX_CAPABILITIES,
    mountDisk: registryMountDisk(args.mountDiskPaths),
    liveMounts: registryLiveMounts(args.liveMountsResolved),
    startedAt: Date.now(),
  };
}

function nonEmptyList<T>(items: T[]): T[] | undefined {
  return items.length > 0 ? items : undefined;
}

function registryProcessPlan(args: LinuxRegistryArgs): { vmmExe: string; gvproxyExe?: string } {
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
