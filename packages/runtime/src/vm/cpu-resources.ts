import { planBootCpuResourcesNative } from "../native/boot-plan.ts";

export interface BootCpuResourceOptions {
  /** Maximum guest-visible vCPUs. Phase 1 supports only 1. */
  maxVcpus?: number;
  /** Maximum host CPU budget. Fractional values are scheduling quota, not guest CPUs. */
  quotaCpus?: number;
  /** Relative CPU share when VMs contend. Mirrors cgroup v2 cpu.weight range. */
  weight?: number;
}

export interface ResolvedCpuResourcePolicy {
  maxVcpus: number;
  quotaCpus?: number;
  weight: number;
}

export const DEFAULT_CPU_WEIGHT = 100;

export function resolveCpuResourcePolicy(
  cpu: BootCpuResourceOptions | undefined,
): ResolvedCpuResourcePolicy | undefined {
  return planBootCpuResourcesNative(cpu);
}
