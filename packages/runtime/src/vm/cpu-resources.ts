import { BootError } from "../errors.ts";

export interface BootCpuResourceOptions {
  /** Maximum guest-visible vCPUs. */
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

const DEFAULT_CPU_MAX_VCPUS = 1;
const MAX_CPU_MAX_VCPUS = 64;
export const DEFAULT_CPU_WEIGHT = 100;
const MIN_CPU_WEIGHT = 1;
const MAX_CPU_WEIGHT = 10_000;

export function resolveCpuResourcePolicy(
  cpu: BootCpuResourceOptions | undefined,
): ResolvedCpuResourcePolicy | undefined {
  if (cpu === undefined) {
    return undefined;
  }
  const maxVcpus = validateMaxVcpus(cpu.maxVcpus ?? DEFAULT_CPU_MAX_VCPUS);
  const quotaCpus = validateQuotaCpus(cpu.quotaCpus, maxVcpus);
  const weight = validateCpuWeight(cpu.weight ?? DEFAULT_CPU_WEIGHT);
  return quotaCpus === undefined ? { maxVcpus, weight } : { maxVcpus, quotaCpus, weight };
}

function validateMaxVcpus(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new BootError(
      "BOOT_CPU_INVALID",
      `boot: resources.cpu.maxVcpus must be a positive integer (got ${String(value)}).`,
    );
  }
  if (value > MAX_CPU_MAX_VCPUS) {
    throw new BootError(
      "BOOT_CPU_INVALID",
      `boot: resources.cpu.maxVcpus must be <= ${MAX_CPU_MAX_VCPUS} (got ${String(value)}).`,
    );
  }
  if (value > DEFAULT_CPU_MAX_VCPUS && !multiVcpuHostSupported()) {
    throw new BootError(
      "BOOT_CPU_UNSUPPORTED",
      "boot: resources.cpu.maxVcpus greater than 1 is currently supported only on linux/x64 KVM and darwin/arm64 HVF hosts. " +
        "CPU quota is scheduling budget, not extra guest-visible CPUs.",
    );
  }
  return value;
}

export function multiVcpuHostSupported(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): boolean {
  return (platform === "linux" && arch === "x64") || (platform === "darwin" && arch === "arm64");
}

function validateQuotaCpus(value: number | undefined, maxVcpus: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new BootError(
      "BOOT_CPU_INVALID",
      `boot: resources.cpu.quotaCpus must be > 0 when set (got ${String(value)}).`,
    );
  }
  if (value > maxVcpus) {
    throw new BootError(
      "BOOT_CPU_INVALID",
      `boot: resources.cpu.quotaCpus (${value}) cannot exceed resources.cpu.maxVcpus (${maxVcpus}).`,
    );
  }
  return value;
}

function validateCpuWeight(value: number): number {
  if (!Number.isInteger(value) || value < MIN_CPU_WEIGHT || value > MAX_CPU_WEIGHT) {
    throw new BootError(
      "BOOT_CPU_INVALID",
      `boot: resources.cpu.weight must be an integer in ${MIN_CPU_WEIGHT}..${MAX_CPU_WEIGHT} (got ${String(value)}).`,
    );
  }
  return value;
}
