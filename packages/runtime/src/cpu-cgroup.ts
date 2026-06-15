import { existsSync, mkdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform as osPlatform } from "node:os";
import { randomBytes } from "node:crypto";
import { BootError } from "./errors.ts";
import { DEFAULT_CPU_WEIGHT, type ResolvedCpuResourcePolicy } from "./vm/cpu-resources.ts";

const DEFAULT_CGROUP_PARENT = "/sys/fs/cgroup";
const CPU_PERIOD_US = 100_000;

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
  if (osPlatform() !== "linux") {
    return { status: "unsupported", reason: "hard CPU quota uses Linux cgroup v2" };
  }
  const parentDir = opts.parentDir ?? process.env.MACHINEN_CGROUP_PARENT ?? DEFAULT_CGROUP_PARENT;
  if (!looksLikeCgroupV2(parentDir)) {
    throw new BootError(
      "BOOT_CPU_UNSUPPORTED",
      `boot: resources.cpu requires Linux cgroup v2 CPU controls, but ${parentDir} is not usable.`,
    );
  }
  const cgroupPath = createCpuCgroup(parentDir, opts.id ?? String(pid));
  try {
    writeCpuQuota(cgroupPath, policy.quotaCpus);
    writeCpuWeight(cgroupPath, policy.weight);
    writeFileSync(join(cgroupPath, "cgroup.procs"), `${pid}\n`);
    return { status: "linux-cgroup-v2", cgroupPath };
  } catch (err) {
    removeCpuCgroup(cgroupPath);
    throw new BootError(
      "BOOT_CPU_UNSUPPORTED",
      `boot: failed to apply resources.cpu cgroup controls: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export function cpuPolicyNeedsCgroup(policy: ResolvedCpuResourcePolicy): boolean {
  return policy.quotaCpus !== undefined || policy.weight !== DEFAULT_CPU_WEIGHT;
}

export function removeCpuCgroup(cgroupPath: string | undefined): void {
  if (!cgroupPath || !existsSync(cgroupPath)) {
    return;
  }
  try {
    rmdirSync(cgroupPath);
  } catch {
    if (!cgroupPath.startsWith("/sys/fs/cgroup/")) {
      try {
        rmSync(cgroupPath, { recursive: true, force: true });
      } catch {}
    }
  }
}

function looksLikeCgroupV2(parentDir: string): boolean {
  if (parentDir === DEFAULT_CGROUP_PARENT && !existsSync(join(parentDir, "cgroup.controllers"))) {
    return false;
  }
  return existsSync(parentDir);
}

function createCpuCgroup(parentDir: string, id: string): string {
  mkdirSync(parentDir, { recursive: true });
  const safeId = id.replace(/[^a-zA-Z0-9_.-]/g, "-");
  const cgroupPath = join(parentDir, `machinen-vm-${safeId}-${randomBytes(4).toString("hex")}`);
  mkdirSync(cgroupPath);
  return cgroupPath;
}

function writeCpuQuota(cgroupPath: string, quotaCpus: number | undefined): void {
  if (quotaCpus === undefined) {
    return;
  }
  const quotaUs = Math.max(1, Math.round(quotaCpus * CPU_PERIOD_US));
  writeFileSync(join(cgroupPath, "cpu.max"), `${quotaUs} ${CPU_PERIOD_US}\n`);
}

function writeCpuWeight(cgroupPath: string, weight: number): void {
  writeFileSync(join(cgroupPath, "cpu.weight"), `${weight}\n`);
}
