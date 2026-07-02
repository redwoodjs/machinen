import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applyCpuControls, cpuPolicyNeedsCgroup, removeCpuCgroup } from "../cpu-cgroup.ts";

const tempDirs: string[] = [];
let helperTmp: string | undefined;
let previousHelper: string | undefined;

beforeAll(() => {
  helperTmp = mkdtempSync(join(tmpdir(), "machinen-runtime-helper-test-"));
  execFileSync("zig", ["build", "--prefix", helperTmp], {
    cwd: join(process.cwd(), "packages", "runtime/native"),
    stdio: "pipe",
  });
  previousHelper = process.env.MACHINEN_RUNTIME_HELPER;
  process.env.MACHINEN_RUNTIME_HELPER = join(helperTmp, "bin", "machinen-runtime-helper");
});

afterAll(() => {
  if (previousHelper === undefined) {
    delete process.env.MACHINEN_RUNTIME_HELPER;
  } else {
    process.env.MACHINEN_RUNTIME_HELPER = previousHelper;
  }
  if (helperTmp) {
    rmSync(helperTmp, { recursive: true, force: true });
  }
});

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

  it("reports unsupported for cgroup writes outside Linux", () => {
    if (platform() === "linux") {
      return;
    }
    const parentDir = tempCgroupParent();
    const result = applyCpuControls(
      4321,
      { maxVcpus: 1, quotaCpus: 0.5, weight: 250 },
      { parentDir, id: "unit" },
    );
    expect(result.status).toBe("unsupported");
    expect(result.reason).toContain("Linux cgroup v2");
  });

  it("writes cgroup v2 cpu.max, cpu.weight, and cgroup.procs", () => {
    if (platform() !== "linux") {
      return;
    }
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
    if (platform() !== "linux") {
      return;
    }
    const parentDir = tempCgroupParent();
    const result = applyCpuControls(4321, { maxVcpus: 2, weight: 50 }, { parentDir, id: "weight" });

    expect(readFileSync(join(result.cgroupPath!, "cpu.weight"), "utf8")).toBe("50\n");
    expect(existsSync(join(result.cgroupPath!, "cpu.max"))).toBe(false);
  });
});
