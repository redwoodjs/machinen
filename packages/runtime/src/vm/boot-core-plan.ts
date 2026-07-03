import { totalmem } from "node:os";

import { BootError } from "../errors.ts";
import type { BootOptions } from "./boot.ts";
import type { ResolvedCpuResourcePolicy } from "./cpu-resources.ts";
import type { BootResourcesOptions } from "./memory-resources.ts";

export interface BootCorePlan {
  vmmMemory: string | null;
  memoryCeilingMib: number | null;
  cpuPolicy: ResolvedCpuResourcePolicy | undefined;
  timeoutMs: number | null;
  detachedReadinessTimeoutMs: number;
  wantsRootDisk: boolean;
  needsInitramfs: boolean;
  usePdeathsig: boolean;
}

type RootDiskPlanMode = "unset" | "false" | "path" | "true";

export function planBootCore(opts: BootOptions, env: Record<string, string>): BootCorePlan {
  validateCommandImagePair(opts);
  const rootDisk = planRootDiskMode(opts);
  const wantsRootDisk = resolveWantsRootDisk(opts, rootDisk);
  const timeoutMs = resolveBootTimeout(opts.timeoutMs);
  const memoryCeilingMib = resolveBootMemoryForEnv(opts, env);
  return {
    vmmMemory: memoryCeilingMib === null ? null : String(memoryCeilingMib),
    memoryCeilingMib,
    cpuPolicy: resolveBootCpuPolicy(opts.resources?.cpu),
    timeoutMs,
    detachedReadinessTimeoutMs: timeoutMs ?? 60_000,
    wantsRootDisk,
    needsInitramfs: needsInitramfs(opts),
    usePdeathsig: opts.detached ? false : (opts.pdeathsig ?? true),
  };
}

function validateCommandImagePair(opts: BootOptions): void {
  if (opts.cmd !== undefined && opts.image === undefined) {
    throw new BootError("BOOT_CMD_WITHOUT_IMAGE", "boot: `image` is required when `cmd` is set.");
  }
}

function planRootDiskMode(opts: BootOptions): RootDiskPlanMode {
  if (opts.rootDisk === false) {
    return "false";
  }
  if (opts._rootDiskRestorePath !== undefined || typeof opts.rootDisk === "string") {
    return "path";
  }
  return opts.rootDisk === true ? "true" : "unset";
}

function resolveWantsRootDisk(opts: BootOptions, rootDisk: RootDiskPlanMode): boolean {
  const wantsRootDisk = rootDisk !== "false" && wantsRootDiskForMode(rootDisk, opts.image);
  if (wantsRootDisk && rootDisk !== "path" && opts.image === undefined) {
    throw new BootError(
      "BOOT_CMD_WITHOUT_IMAGE",
      "boot: rootDisk: true requires an `image` (the .tar.gz to materialize).",
    );
  }
  return wantsRootDisk;
}

function wantsRootDiskForMode(rootDisk: RootDiskPlanMode, image: string | undefined): boolean {
  return rootDisk === "path" || rootDisk === "true" || image !== undefined;
}

function resolveBootTimeout(timeoutMs: BootOptions["timeoutMs"]): number | null {
  return timeoutMs === null ? null : (timeoutMs ?? 60_000);
}

function resolveBootMemoryForEnv(opts: BootOptions, env: Record<string, string>): number | null {
  return env.MACHINEN_MEMORY === undefined ? resolveBootMemoryCeiling(opts) : null;
}

function resolveBootMemoryCeiling(opts: BootOptions): number {
  const resourceMemory = opts.resources?.memory;
  validateMemoryReclaim(resourceMemory?.reclaim);
  const aliasCeiling = validateOptionalMemory(
    opts.memory,
    "boot: memory must be a positive integer at least 512 MiB",
  );
  const resourceCeiling = validateOptionalMemory(
    resourceMemory?.maxMib,
    "boot: memory must be a positive integer at least 512 MiB",
  );
  validateMemoryConflict(aliasCeiling, resourceCeiling);
  return resourceCeiling ?? aliasCeiling ?? autoSizeMemoryMibFast(totalmem());
}

function validateMemoryReclaim(reclaim: BootResourcesOptions["memory"]["reclaim"]): void {
  if (reclaim !== undefined && reclaim !== "auto") {
    throw new BootError(
      "BOOT_MEMORY_INVALID",
      'boot: resources.memory.reclaim must be "auto" when set.',
    );
  }
}

function validateMemoryConflict(
  aliasCeiling: number | undefined,
  resourceCeiling: number | undefined,
): void {
  if (aliasCeiling === undefined || resourceCeiling === undefined) {
    return;
  }
  if (aliasCeiling !== resourceCeiling) {
    throw new BootError(
      "BOOT_MEMORY_INVALID",
      "boot: memory conflicts with resources.memory.maxMib. Use one value.",
    );
  }
}

function validateOptionalMemory(value: number | undefined, message: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 512) {
    throw new BootError("BOOT_MEMORY_INVALID", message);
  }
  return value;
}

function autoSizeMemoryMibFast(hostBytes: number): number {
  const hostMib = Math.floor(hostBytes / (1024 * 1024));
  return Math.max(512, Math.min(Math.floor(hostMib / 2), 4096));
}

function resolveBootCpuPolicy(
  cpu: BootResourcesOptions["cpu"],
): ResolvedCpuResourcePolicy | undefined {
  if (!cpu) {
    return undefined;
  }
  const maxVcpus = resolveMaxVcpus(cpu.maxVcpus);
  return {
    maxVcpus,
    quotaCpus: resolveQuotaCpus(cpu.quotaCpus, maxVcpus),
    weight: resolveCpuWeight(cpu.weight),
  };
}

function resolveMaxVcpus(value: number | undefined): number {
  const maxVcpus = value ?? 1;
  if (!Number.isInteger(maxVcpus) || maxVcpus < 1) {
    throw new BootError(
      "BOOT_CPU_INVALID",
      "boot: resources.cpu.maxVcpus must be a positive integer",
    );
  }
  if (maxVcpus !== 1) {
    throw new BootError(
      "BOOT_CPU_INVALID",
      "boot: resources.cpu.maxVcpus greater than 1 is not supported yet. CPU quota is scheduling budget, not extra guest-visible CPUs.",
    );
  }
  return maxVcpus;
}

function resolveQuotaCpus(value: number | undefined, maxVcpus: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new BootError("BOOT_CPU_INVALID", "boot: resources.cpu.quotaCpus must be > 0 when set");
  }
  if (value > maxVcpus) {
    throw new BootError(
      "BOOT_CPU_INVALID",
      "boot: resources.cpu.quotaCpus cannot exceed resources.cpu.maxVcpus",
    );
  }
  return value;
}

function resolveCpuWeight(value: number | undefined): number {
  const weight = value ?? 100;
  if (!Number.isInteger(weight) || weight < 1 || weight > 10_000) {
    throw new BootError(
      "BOOT_CPU_INVALID",
      "boot: resources.cpu.weight must be an integer in 1..10000",
    );
  }
  return weight;
}

function needsInitramfs(opts: BootOptions): boolean {
  return opts.image !== undefined || opts.cmd !== undefined || Boolean(opts.snapshot);
}
