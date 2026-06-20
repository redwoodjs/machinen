// Phase A unit coverage for #263: auto-sizing the guest RAM ceiling
// and validating the `boot({ memory })` knob. The end-to-end "does
// the guest actually see N MiB?" check lives in the smoke suite —
// this file just covers the policy + validation logic.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  _internal,
  attach,
  autoSizeMemoryMib,
  boot,
  BootError,
  STATS_FILE_SIZE,
} from "../index.ts";

const { resolveMemoryCeilingMib, validateMemoryMib } = _internal;

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

describe("autoSizeMemoryMib", () => {
  it("uses a modest 4 GiB ceiling for normal desktops", () => {
    // This is a guest RAM ceiling, not current host memory use. Do not
    // scale it up just because the developer has a large machine.
    expect(autoSizeMemoryMib(32 * 1024 * 1024 * 1024)).toBe(4096);
    expect(autoSizeMemoryMib(16 * 1024 * 1024 * 1024)).toBe(4096);
    expect(autoSizeMemoryMib(8 * 1024 * 1024 * 1024)).toBe(4096);
  });

  it("uses half the host on smaller machines", () => {
    expect(autoSizeMemoryMib(6 * 1024 * 1024 * 1024)).toBe(3072);
    expect(autoSizeMemoryMib(4 * 1024 * 1024 * 1024)).toBe(2048);
  });

  it("stays capped at 4 GiB even on huge hosts", () => {
    expect(autoSizeMemoryMib(256 * 1024 * 1024 * 1024)).toBe(4096);
    expect(autoSizeMemoryMib(1024 * 1024 * 1024 * 1024)).toBe(4096);
  });

  it("respects the 512 MiB floor on tiny hosts", () => {
    // A 512 MiB host (CI runner, container) gets the floor instead
    // of 256 MiB — boot_*.zig's 16 MiB assert would still pass, but
    // 256 MiB leaves no room for Debian + a workload.
    expect(autoSizeMemoryMib(512 * 1024 * 1024)).toBe(512);
    expect(autoSizeMemoryMib(256 * 1024 * 1024)).toBe(512);
    expect(autoSizeMemoryMib(0)).toBe(512);
  });
});

describe("boot-plan helper schema", () => {
  it("plans guest env defaults without overriding caller-provided values", () => {
    expect(helperTmp).toBeDefined();
    const helper = join(helperTmp!, "bin", "machinen-runtime-helper");
    const requestData = {
      memoryMib: null,
      resourcesMemory: null,
      autoMemoryMib: "1024",
      hostTotalBytes: null,
      vmmMemoryPreset: false,
      hasImage: false,
      hasCmd: false,
      rootDisk: "false",
      guestEnv: { FOO: "bar", MACHINEN_VM_HOSTNAME_WAIT: "0" },
      name: "worker",
      vsockUdsPath: "/tmp/exec.sock",
    };
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: requestData })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data.mergedGuestEnv).toEqual({
      FOO: "bar",
      MACHINEN_VM_HOSTNAME_WAIT: "0",
      MACHINEN_VM_NAME: "worker",
    });
  });

  it("plans vsock specs from caller env or auto UDS paths", () => {
    expect(helperTmp).toBeDefined();
    const helper = join(helperTmp!, "bin", "machinen-runtime-helper");
    const baseData = {
      memoryMib: null,
      resourcesMemory: null,
      autoMemoryMib: "1024",
      hostTotalBytes: null,
      vmmMemoryPreset: false,
      hasImage: false,
      hasCmd: false,
      rootDisk: "false",
    };
    const existing = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: { ...baseData, existingVsockSpec: "out:1970:/tmp/a.sock,in:1978:/tmp/b.sock" },
      })}\n`,
      encoding: "utf8",
    });
    expect(existing.status).toBe(0);
    expect(JSON.parse(existing.stdout).data).toMatchObject({
      vsockUdsPath: "/tmp/a.sock",
      vmmVsock: null,
    });

    const auto = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: { ...baseData, autoVsockUdsPath: "/tmp/exec.sock" },
      })}\n`,
      encoding: "utf8",
    });
    expect(auto.status).toBe(0);
    expect(JSON.parse(auto.stdout).data).toMatchObject({
      vsockUdsPath: "/tmp/exec.sock",
      vmmVsock: "in:1978:/tmp/exec.sock",
    });
  });

  it("rejects invalid portForward shape", () => {
    expect(helperTmp).toBeDefined();
    const helper = join(helperTmp!, "bin", "machinen-runtime-helper");
    const requestData = {
      memoryMib: null,
      resourcesMemory: null,
      autoMemoryMib: "1024",
      hostTotalBytes: null,
      vmmMemoryPreset: false,
      hasImage: false,
      hasCmd: false,
      rootDisk: "false",
      portForward: [{ hostPort: 8080, guestPort: 70000 }],
    };
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: requestData })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      protocolVersion: 1,
      error: { code: "BOOT_PORT_FORWARD_INVALID" },
    });
  });

  it("rejects unknown request fields", () => {
    expect(helperTmp).toBeDefined();
    const helper = join(helperTmp!, "bin", "machinen-runtime-helper");
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          memoryMib: null,
          resourcesMemory: null,
          autoMemoryMib: "1024",
          hostTotalBytes: null,
          vmmMemoryPreset: false,
          hasImage: false,
          hasCmd: false,
          rootDisk: "false",
          extra: true,
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      protocolVersion: 1,
      error: { code: "UNKNOWN_FIELD" },
    });
  });
});

describe("resolveMemoryCeilingMib", () => {
  it("uses resources.memory.maxMib as the canonical ceiling", () => {
    expect(
      resolveMemoryCeilingMib(
        { resources: { memory: { maxMib: 4096, reclaim: "auto" } } },
        () => 1024,
      ),
    ).toBe(4096);
  });

  it("keeps boot({ memory }) as a compatibility alias", () => {
    expect(resolveMemoryCeilingMib({ memory: 2048 }, () => 1024)).toBe(2048);
  });

  it("allows matching memory and resources.memory.maxMib values", () => {
    expect(
      resolveMemoryCeilingMib(
        { memory: 2048, resources: { memory: { maxMib: 2048, reclaim: "auto" } } },
        () => 1024,
      ),
    ).toBe(2048);
  });

  it("rejects conflicting memory aliases", () => {
    expect(() =>
      resolveMemoryCeilingMib(
        { memory: 1024, resources: { memory: { maxMib: 2048, reclaim: "auto" } } },
        () => 1024,
      ),
    ).toThrow(/conflicts/);
  });

  it("rejects unsupported reclaim policies", () => {
    expect(() =>
      resolveMemoryCeilingMib(
        { resources: { memory: { maxMib: 2048, reclaim: "manual" as "auto" } } },
        () => 1024,
      ),
    ).toThrow(/resources\.memory\.reclaim must be "auto"/);
  });

  it("falls back to auto sizing when no explicit ceiling is set", () => {
    expect(resolveMemoryCeilingMib({}, () => 1536)).toBe(1536);
  });
});

describe("memoryStats", () => {
  it("reports the reclaimed-by-balloon counter on boot and attach handles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-memory-stats-test-"));
    const priorRegistryDir = process.env.MACHINEN_REGISTRY_DIR;
    process.env.MACHINEN_REGISTRY_DIR = join(dir, "registry");
    const statsPath = join(dir, "stats.bin");
    const stats = Buffer.alloc(STATS_FILE_SIZE);
    stats.writeBigUInt64LE(123_456n, 0);
    writeFileSync(statsPath, stats);

    const vm = await boot({
      binary: "/bin/sleep",
      args: ["10"],
      resources: { memory: { maxMib: 1024, reclaim: "auto" } },
      vmmEnv: { MACHINEN_STATS_FILE: statsPath },
      timeoutMs: 5_000,
    });
    try {
      const bootStats = await vm.memoryStats();
      expect(bootStats.ceilingMib).toBe(1024);
      expect(bootStats.hostRssBytes).toBeGreaterThan(0);
      expect(bootStats.balloonReclaimedBytes).toBe(123_456);
      expect(bootStats.balloonInflatedBytes).toBe(123_456);

      const attached = await attach({ pid: vm.pid });
      const attachStats = await attached.memoryStats();
      expect(attachStats.ceilingMib).toBe(1024);
      expect(attachStats.hostRssBytes).toBeGreaterThan(0);
      expect(attachStats.balloonReclaimedBytes).toBe(123_456);
      expect(attachStats.balloonInflatedBytes).toBe(123_456);
    } finally {
      await vm.kill();
      if (priorRegistryDir === undefined) {
        delete process.env.MACHINEN_REGISTRY_DIR;
      } else {
        process.env.MACHINEN_REGISTRY_DIR = priorRegistryDir;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("validateMemoryMib", () => {
  it("accepts integers at or above the 512 MiB floor", () => {
    expect(validateMemoryMib(512)).toBe(512);
    expect(validateMemoryMib(1024)).toBe(1024);
    expect(validateMemoryMib(32768)).toBe(32768);
  });

  it("rejects negative values", () => {
    expect(() => validateMemoryMib(-1)).toThrow(BootError);
    try {
      validateMemoryMib(-1);
    } catch (err) {
      expect((err as BootError).code).toBe("BOOT_MEMORY_INVALID");
    }
  });

  it("rejects zero", () => {
    expect(() => validateMemoryMib(0)).toThrow(BootError);
  });

  it("rejects non-integers", () => {
    expect(() => validateMemoryMib(512.5)).toThrow(BootError);
    expect(() => validateMemoryMib(NaN)).toThrow(BootError);
    expect(() => validateMemoryMib(Infinity)).toThrow(BootError);
  });

  it("rejects below the 512 MiB floor", () => {
    expect(() => validateMemoryMib(64)).toThrow(BootError);
    expect(() => validateMemoryMib(511)).toThrow(BootError);
  });
});
