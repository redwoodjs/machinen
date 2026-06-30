// Linux CPU controls for Machinen VMM processes.
//
// `resources.cpu` is enforced by placing the VMM process into a cgroup v2
// CPU group. This module is the TypeScript policy layer: it decides whether a
// CPU policy needs native cgroup setup, calls the runtime helper to create/apply
// the group, and removes that group when the VM stops.
//
// `quotaCpus` becomes a hard scheduling cap via `cpu.max`; `weight` becomes a
// relative share via `cpu.weight`. These controls affect host scheduling of the
// VMM process, not guest-visible vCPU count. Non-Linux hosts report unsupported.

import { DEFAULT_CPU_WEIGHT, type ResolvedCpuResourcePolicy } from "./vm/cpu-resources.ts";
import { applyCpuCgroupNative, removeCpuCgroupNative } from "./native/cpu-cgroup.ts";

const DEFAULT_CGROUP_PARENT = "/sys/fs/cgroup";

type CpuControlStatus = "none" | "linux-cgroup-v2" | "unsupported";

export interface CpuControlResult {
  status: CpuControlStatus;
  cgroupPath?: string;
  reason?: string;
}

interface ApplyCpuControlOptions {
  parentDir?: string;
  id?: string;
}

export function applyCpuControls(
  pid: number,
  policy: ResolvedCpuResourcePolicy | undefined,
  opts: ApplyCpuControlOptions = {},
): CpuControlResult {
  if (policy === undefined || !cpuPolicyNeedsCgroup(policy)) {
    return { status: "none" };
  }
  return applyCpuCgroupNative({
    pid,
    weight: policy.weight,
    quotaCpus: policy.quotaCpus,
    parentDir: opts.parentDir ?? process.env.MACHINEN_CGROUP_PARENT ?? DEFAULT_CGROUP_PARENT,
    id: opts.id ?? String(pid),
  });
}

export function cpuPolicyNeedsCgroup(policy: ResolvedCpuResourcePolicy): boolean {
  return policy.quotaCpus !== undefined || policy.weight !== DEFAULT_CPU_WEIGHT;
}

export function removeCpuCgroup(cgroupPath: string | undefined): void {
  if (!cgroupPath) {
    return;
  }
  removeCpuCgroupNative(cgroupPath);
}
