import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyCpuControls, cpuPolicyNeedsCgroup, removeCpuCgroup } from "../cpu-cgroup.ts";

const tempDirs: string[] = [];

function tempCgroupParent(): string {
  const dir = mkdtempSync(join(tmpdir(), "machinen-cpu-cgroup-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("cpu cgroup controls", () => {
  it("does nothing when no policy or only no-op defaults are requested", () => {
    expect(applyCpuControls(123, undefined)).toEqual({ status: "none" });
    expect(applyCpuControls(123, { maxVcpus: 1, weight: 100 })).toEqual({ status: "none" });
    expect(applyCpuControls(123, { maxVcpus: 2, weight: 100 })).toEqual({ status: "none" });
    expect(cpuPolicyNeedsCgroup({ maxVcpus: 1, weight: 100 })).toBe(false);
    expect(cpuPolicyNeedsCgroup({ maxVcpus: 2, weight: 100 })).toBe(false);
  });

  it("writes cgroup v2 cpu.max, cpu.weight, and cgroup.procs", () => {
    const parentDir = tempCgroupParent();
    const result = applyCpuControls(
      4321,
      { maxVcpus: 4, quotaCpus: 0.5, weight: 250 },
      { parentDir, id: "unit" },
    );

    expect(result.status).toBe("linux-cgroup-v2");
    expect(result.cgroupPath).toContain("machinen-vm-unit-");
    expect(readFileSync(join(result.cgroupPath!, "cpu.max"), "utf8")).toBe("50000 100000\n");
    expect(readFileSync(join(result.cgroupPath!, "cpu.weight"), "utf8")).toBe("250\n");
    expect(readFileSync(join(result.cgroupPath!, "cgroup.procs"), "utf8")).toBe("4321\n");

    removeCpuCgroup(result.cgroupPath);
    expect(existsSync(result.cgroupPath!)).toBe(false);
  });

  it("enforces weight without a hard quota when weight differs from the default", () => {
    const parentDir = tempCgroupParent();
    const result = applyCpuControls(4321, { maxVcpus: 2, weight: 50 }, { parentDir, id: "weight" });

    expect(readFileSync(join(result.cgroupPath!, "cpu.weight"), "utf8")).toBe("50\n");
    expect(existsSync(join(result.cgroupPath!, "cpu.max"))).toBe(false);
  });
});
