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

  it("plans CPU resource policy defaults and fractional quota", () => {
    expect(helperTmp).toBeDefined();
    const helper = join(helperTmp!, "bin", "machinen-runtime-helper");
    const requestData = {
      memoryMib: null,
      resourcesMemory: null,
      resourcesCpu: { maxVcpus: "1", quotaCpus: "0.5", weight: "200" },
      autoMemoryMib: "1024",
      hostTotalBytes: null,
      vmmMemoryPreset: false,
      hasImage: false,
      hasCmd: false,
      rootDisk: "false",
    };
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: requestData })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data.cpuPolicy).toEqual({
      maxVcpus: 1,
      quotaCpus: 0.5,
      weight: 200,
    });
  });

  it("plans portForward defaults and preserves hostAddr", () => {
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
    const omitted = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: baseData })}\n`,
      encoding: "utf8",
    });
    expect(omitted.status).toBe(0);
    expect(JSON.parse(omitted.stdout).data.plannedPortForward).toEqual([]);

    const planned = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          ...baseData,
          portForward: [
            { hostPort: 8080, guestPort: 80, hostAddr: "127.0.0.1" },
            { hostPort: 8443, guestPort: 443 },
          ],
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(planned.status).toBe(0);
    expect(JSON.parse(planned.stdout).data.plannedPortForward).toEqual([
      { hostPort: 8080, guestPort: 80, hostAddr: "127.0.0.1" },
      { hostPort: 8443, guestPort: 443 },
    ]);
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

  it("plans vmstate snapshot restore and timing env", () => {
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
      vmstatePath: "/tmp/state.vmstate",
      restorePath: "/tmp/restore.vmstate",
      enableVmstateTiming: true,
    };
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: requestData })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({
      vmmSnapshotPath: "/tmp/state.vmstate",
      vmmRestorePath: "/tmp/restore.vmstate",
      vmmVmstateTiming: "1",
    });
  });

  it("plans nested virtualization VMM env", () => {
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
    const requested = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: { ...baseData, nested: true } })}\n`,
      encoding: "utf8",
    });
    expect(requested.status).toBe(0);
    expect(JSON.parse(requested.stdout).data.vmmNested).toBe("1");

    const omitted = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: baseData })}\n`,
      encoding: "utf8",
    });
    expect(omitted.status).toBe(0);
    expect(JSON.parse(omitted.stdout).data.vmmNested).toBeNull();
  });

  it("plans bundle commands from explicit image restore and live-mount inputs", () => {
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
    const image = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: { ...baseData, bundleImageCmd: ["/bin/true"] } })}\n`,
      encoding: "utf8",
    });
    expect(image.status).toBe(0);
    expect(JSON.parse(image.stdout).data.bundleCommand).toEqual([
      "/sbin/machinen-supervisor",
      "/bin/true",
    ]);

    const restore = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: { ...baseData, bundleSnapshotRestore: true } })}\n`,
      encoding: "utf8",
    });
    expect(restore.status).toBe(0);
    expect(JSON.parse(restore.stdout).data.bundleCommand).toEqual(["/sbin/machinen-restore"]);

    const live = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          ...baseData,
          bundleExplicitCmd: ["/bin/echo", "hi"],
          bundleLiveMounts: [
            { host: "/host", guest: "/mnt/live", mode: "rw", tag: "machinen-lm0" },
          ],
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(live.status).toBe(0);
    const liveCommand = JSON.parse(live.stdout).data.bundleCommand;
    expect(liveCommand.slice(0, 5)).toEqual([
      "/sbin/machinen-supervisor",
      "/bin/sh",
      "-c",
      expect.stringContaining("batch_sync"),
      "machinen-batch-wrapper",
    ]);
    expect(liveCommand.slice(5)).toEqual(["/bin/echo", "hi"]);
  });

  it("plans scratch disk modes", () => {
    expect(helperTmp).toBeDefined();
    const helper = join(helperTmp!, "bin", "machinen-runtime-helper");
    const baseData = {
      memoryMib: null,
      resourcesMemory: null,
      autoMemoryMib: "1024",
      hostTotalBytes: null,
      vmmMemoryPreset: false,
      hasImage: true,
      hasCmd: false,
      rootDisk: "false",
    };
    const restore = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          ...baseData,
          scratchMode: "path",
          scratchSnapshotPath: "/tmp/source.img",
          scratchRestoreClonePath: "/tmp/clone.img",
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(restore.status).toBe(0);
    expect(JSON.parse(restore.stdout).data.scratchDisk).toEqual({
      action: "clone",
      diskPath: "/tmp/clone.img",
      perBootSnapDisk: "/tmp/clone.img",
      vmmDisk: "/tmp/clone.img",
    });

    const existing = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          ...baseData,
          hasCmd: true,
          scratchMode: "path",
          scratchSnapshotPath: "/tmp/source.img",
          scratchRestoreClonePath: "/tmp/clone.img",
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(existing.status).toBe(0);
    expect(JSON.parse(existing.stdout).data.scratchDisk).toEqual({
      action: "existing",
      diskPath: "/tmp/source.img",
      perBootSnapDisk: null,
      vmmDisk: "/tmp/source.img",
    });

    const auto = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: { ...baseData, scratchMode: "auto", scratchAutoPath: "/tmp/auto.img" },
      })}\n`,
      encoding: "utf8",
    });
    expect(auto.status).toBe(0);
    expect(JSON.parse(auto.stdout).data.scratchDisk).toEqual({
      action: "allocate",
      diskPath: "/tmp/auto.img",
      perBootSnapDisk: "/tmp/auto.img",
      vmmDisk: "/tmp/auto.img",
    });
  });

  it("plans provision runtime defaults paths and explicit limits", () => {
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
    const explicit = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          ...baseData,
          provisionWorkDir: "/tmp/machinen-provision-test",
          provisionScratchSizeBytes: "4096",
          provisionTimeoutMs: "12345",
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(explicit.status).toBe(0);
    expect(JSON.parse(explicit.stdout).data.provisionRuntime).toEqual({
      scratchSizeBytes: 4096,
      deadlineMs: 12345,
      diskPath: "/tmp/machinen-provision-test/scratch.img",
      rootDiskPath: "/tmp/machinen-provision-test/rootfs.img",
      udsPath: "/tmp/machinen-provision-test/exec.sock",
    });

    const defaults = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: baseData })}\n`,
      encoding: "utf8",
    });
    expect(defaults.status).toBe(0);
    expect(JSON.parse(defaults.stdout).data.provisionRuntime).toEqual({
      scratchSizeBytes: 1024 * 1024 * 1024,
      deadlineMs: 10 * 60 * 1000,
      diskPath: null,
      rootDiskPath: null,
      udsPath: null,
    });
  });

  it("plans provision image config payloads", () => {
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
    const withConfig = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          ...baseData,
          provisionImageConfigHasCmd: true,
          provisionImageConfigCmd: ["/bin/echo", "hi"],
          provisionImageConfigHasEnv: true,
          provisionImageConfigEnv: { FOO: "bar" },
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(withConfig.status).toBe(0);
    expect(JSON.parse(withConfig.stdout).data.provisionImageConfig).toEqual({
      cmd: ["/bin/echo", "hi"],
      env: { FOO: "bar" },
    });

    const empty = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: baseData })}\n`,
      encoding: "utf8",
    });
    expect(empty.status).toBe(0);
    expect(JSON.parse(empty.stdout).data.provisionImageConfig).toBeNull();
  });

  it("plans provision workload and repack commands", () => {
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
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          ...baseData,
          provisionRepackDiskPath: "/tmp/scratch.img",
          provisionRepackOutPath: "/tmp/out.tar.gz",
          provisionRepackExtractDir: "/tmp/extract",
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout).data;
    expect(data.provisionWorkload.tarToDiskCommand).toContain("--exclude=./proc");
    expect(data.provisionWorkload.tarToDiskCommand).toContain("-cf /dev/vdb .");
    expect(data.provisionWorkload.poweroffCommand).toBe("/sbin/machinen-poweroff");
    expect(data.provisionRepack).toEqual({
      extractArgs: ["-xf", "/tmp/scratch.img", "-C", "/tmp/extract"],
      targzArgs: ["-czf", "/tmp/out.tar.gz", "-C", "/tmp/extract", "."],
    });
  });

  it("plans provision boot inputs", () => {
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
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          ...baseData,
          provisionBasePath: "/base.tar.gz",
          provisionKernelPath: "/Image",
          provisionDtbPath: "/virt.dtb",
          provisionUdsPath: "/tmp/exec.sock",
          provisionScratchDiskPath: "/tmp/scratch.img",
          provisionRootDiskPath: "/tmp/rootfs.img",
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data.provisionBoot).toEqual({
      imagePath: "/base.tar.gz",
      kernelPath: "/Image",
      dtbPath: "/virt.dtb",
      vmmVsock: "in:1978:/tmp/exec.sock",
      cmd: ["/exec-agent"],
      env: { PATH: "/usr/local/bin:/usr/bin:/bin:/sbin" },
      snapshotPath: "/tmp/scratch.img",
      rootDiskPath: "/tmp/rootfs.img",
    });
  });

  it("plans provision asset names", () => {
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
    const amd64 = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: { ...baseData, provisionGuestCpu: "amd64" },
      })}\n`,
      encoding: "utf8",
    });
    expect(amd64.status).toBe(0);
    expect(JSON.parse(amd64.stdout).data.provisionAssets).toEqual({
      cpu: "amd64",
      kernelAsset: "bzImage-x86_64",
      dtbAsset: null,
      rootfsAsset: "rootfs-debian-amd64.tar.gz",
    });

    const arm64 = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: { ...baseData, provisionGuestCpu: "arm64" },
      })}\n`,
      encoding: "utf8",
    });
    expect(arm64.status).toBe(0);
    expect(JSON.parse(arm64.stdout).data.provisionAssets).toEqual({
      cpu: "arm64",
      kernelAsset: "Image-arm64",
      dtbAsset: "virt-arm64.dtb",
      rootfsAsset: "rootfs-debian-arm64.tar.gz",
    });
  });

  it("plans bundle env overlays", () => {
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
      bundleImageEnv: { FOO: "image", BAR: "image" },
      bundleGuestEnv: { FOO: "guest", BAZ: "guest" },
    };
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: requestData })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data.bundleEnv).toEqual({
      FOO: "guest",
      BAR: "image",
      BAZ: "guest",
    });
  });

  it("plans rootdisk runtime actions", () => {
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
        data: { ...baseData, rootDiskRuntimeMode: "path", rootDiskSourcePath: "/tmp/root.img" },
      })}\n`,
      encoding: "utf8",
    });
    expect(existing.status).toBe(0);
    expect(JSON.parse(existing.stdout).data.rootDiskRuntime).toEqual({
      action: "existing",
      sourcePath: "/tmp/root.img",
      targetPath: null,
      perBootRootDisk: null,
      vmmRootDisk: "/tmp/root.img",
    });

    const cached = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          ...baseData,
          rootDiskRuntimeMode: "cached",
          rootDiskSourcePath: "/tmp/cache.img",
          rootDiskClonePath: "/tmp/boot.img",
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(cached.status).toBe(0);
    expect(JSON.parse(cached.stdout).data.rootDiskRuntime).toEqual({
      action: "clone-cached",
      sourcePath: "/tmp/cache.img",
      targetPath: "/tmp/boot.img",
      perBootRootDisk: "/tmp/boot.img",
      vmmRootDisk: "/tmp/boot.img",
    });
  });

  it("plans mountdisk runtime actions", () => {
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
    const restore = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          ...baseData,
          mountDiskRuntimeMode: "restore",
          mountDiskLowerPath: "/tmp/lower.sqfs",
          mountDiskUpperPath: "/tmp/upper-copy.img",
          mountDiskSourceUpperPath: "/tmp/upper.img",
          mountDiskGuest: "/mnt/data",
          mountDiskUpperSize: "4096",
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(restore.status).toBe(0);
    expect(JSON.parse(restore.stdout).data.mountDiskRuntime).toEqual({
      action: "restore",
      lowerPath: "/tmp/lower.sqfs",
      upperPath: "/tmp/upper-copy.img",
      sourceUpperPath: "/tmp/upper.img",
      guest: "/mnt/data",
      upperSizeBytes: 4096,
    });

    const fresh = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          ...baseData,
          mountDiskRuntimeMode: "fresh",
          mountDiskLowerPath: "/tmp/lower.sqfs",
          mountDiskUpperPath: "/tmp/upper.img",
          mountDiskGuest: "/mnt/data",
          mountDiskUpperSize: "8192",
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(fresh.status).toBe(0);
    expect(JSON.parse(fresh.stdout).data.mountDiskRuntime).toEqual({
      action: "fresh",
      lowerPath: "/tmp/lower.sqfs",
      upperPath: "/tmp/upper.img",
      sourceUpperPath: null,
      guest: "/mnt/data",
      upperSizeBytes: 8192,
    });
  });

  it("plans registry cleanup paths, mount shapes, and CPU shape", () => {
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
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: {
          ...baseData,
          registrySourceImagePath: "/images/rootfs.tar.gz",
          registryPerBootRootDisk: "/tmp/root.img",
          registryCallerRootDiskPath: "/caller/root.img",
          registryPerBootSnapDisk: null,
          registryPerBootMountUpper: "/tmp/upper.img",
          registryBundleTempDir: "/tmp/bundle",
          registryVsockTempDir: "/tmp/vsock",
          registryStatsTempDir: null,
          registryGvSocketDir: "/tmp/gv",
          registryCpuCgroupPath: "/sys/fs/cgroup/machinen",
          registryCpuPolicyMaxVcpus: "1",
          registryCpuPolicyQuotaCpus: "0.5",
          registryCpuPolicyWeight: "200",
          registryCpuControlStatus: "linux-cgroup-v2",
          registryCpuControlReason: "limited",
          registryVmstatePath: "/tmp/state.vmstate",
          registryVmstateChainId: "chain-1",
          registryVmstateCheckpointParent: "/snap/parent",
          registryVmstateCheckpointSequence: "3",
          registryNested: true,
          registryMountGuest: "/mnt/data",
          registryMountLowerPath: "/cache/lower.sqfs",
          registryMountUpperPath: "/tmp/upper.img",
          portForward: [
            { hostPort: 8080, guestPort: 80, hostAddr: "127.0.0.1" },
            { hostPort: 8443, guestPort: 443 },
          ],
          liveMountsResolved: [
            { host: "/host/work", guest: "/mnt/work", mode: "rw", tag: "machinen-lm0" },
            { host: "/host/cache", guest: "/mnt/cache", mode: "ro", tag: "machinen-lm1" },
          ],
        },
      })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data.registryShape).toEqual({
      sourceImagePath: "/images/rootfs.tar.gz",
      rootDiskPath: "/tmp/root.img",
      rootDiskMode: "block",
      cleanupPaths: [
        "/tmp/root.img",
        "/tmp/upper.img",
        "/tmp/bundle",
        "/tmp/vsock",
        "/tmp/gv",
        "/sys/fs/cgroup/machinen",
      ],
      mountDisk: {
        guest: "/mnt/data",
        lowerPath: "/cache/lower.sqfs",
        upperPath: "/tmp/upper.img",
      },
      liveMounts: [
        { guest: "/mnt/work", host: "/host/work", mode: "rw" },
        { guest: "/mnt/cache", host: "/host/cache", mode: "ro" },
      ],
      portForward: [
        { hostPort: 8080, guestPort: 80, hostAddr: "127.0.0.1" },
        { hostPort: 8443, guestPort: 443 },
      ],
      cpu: {
        maxVcpus: 1,
        quotaCpus: 0.5,
        weight: 200,
        enforcement: { status: "linux-cgroup-v2", reason: "limited" },
      },
      vmstate: {
        statePath: "/tmp/state.vmstate",
        chainId: "chain-1",
        checkpointParent: "/snap/parent",
        checkpointSequence: 3,
      },
      nested: true,
    });
  });

  it("plans machinen-config guest payloads", () => {
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
      configCmd: ["/bin/sh", "-c", "echo hi"],
      configEnv: { FOO: "bar" },
      configGuestCwd: "/mnt/work",
      configImageCwd: "/srv/app",
      configLiveMounts: [{ host: "/host", guest: "/mnt/live", mode: "ro", tag: "machinen-lm0" }],
    };
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: requestData })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data.machinenConfig).toEqual({
      cmd: ["/bin/sh", "-c", "echo hi"],
      env: { FOO: "bar" },
      cwd: "/mnt/work",
      liveMounts: [{ guest: "/mnt/live", tag: "machinen-lm0", mode: "ro" }],
    });
  });

  it("plans live-mount guest paths modes and tags", () => {
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
      liveMounts: [
        { host: "./a", guest: "/mnt/a/" },
        { host: "./b", guest: "/mnt/b", mode: "ro" },
      ],
    };
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: requestData })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data.plannedLiveMounts).toEqual([
      { host: "./a", guest: "/mnt/a", mode: "rw", tag: "machinen-lm0" },
      { host: "./b", guest: "/mnt/b", mode: "ro", tag: "machinen-lm1" },
    ]);
  });

  it("plans stats-file env from caller or runtime-owned paths", () => {
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
        data: { ...baseData, existingStatsFile: "/tmp/caller-stats.bin" },
      })}\n`,
      encoding: "utf8",
    });
    expect(existing.status).toBe(0);
    expect(JSON.parse(existing.stdout).data).toMatchObject({
      statsFilePath: "/tmp/caller-stats.bin",
      vmmStatsFile: null,
    });

    const planned = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({
        protocolVersion: 1,
        data: { ...baseData, statsFilePath: "/tmp/runtime-stats.bin" },
      })}\n`,
      encoding: "utf8",
    });
    expect(planned.status).toBe(0);
    expect(JSON.parse(planned.stdout).data).toMatchObject({
      statsFilePath: "/tmp/runtime-stats.bin",
      vmmStatsFile: "/tmp/runtime-stats.bin",
    });
  });

  it("plans virtiofs env entries for resolved live mounts", () => {
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
      liveMountsResolved: [
        { host: "/host/a", guest: "/mnt/a", mode: "rw", tag: "machinen-lm0" },
        { host: "/host/b", guest: "/mnt/b", mode: "ro", tag: "machinen-lm1" },
      ],
    };
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: requestData })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data.virtiofsEnv).toEqual({
      MACHINEN_VIRTIOFS_0: "machinen-lm0:rw:/host/a",
      MACHINEN_VIRTIOFS_1: "machinen-lm1:ro:/host/b",
    });
  });

  it("plans kernel and dtb env paths", () => {
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
      kernelPath: "/tmp/Image",
      dtbPath: "/tmp/virt.dtb",
    };
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: requestData })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({
      vmmKernel: "/tmp/Image",
      vmmDtb: "/tmp/virt.dtb",
    });
  });

  it("plans VMM argv with optional pdeathsig wrapping", () => {
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
      vmmBinary: "/bin/vmm",
      vmmArgs: ["--dev", "1"],
      pdeathsigPath: "/bin/pdeathsig",
    };
    const result = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: requestData })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({
      vmmCommand: "/bin/pdeathsig",
      vmmArgs: ["/bin/vmm", "--dev", "1"],
    });
  });

  it("plans whether initramfs packing is needed", () => {
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
    const none = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: baseData })}\n`,
      encoding: "utf8",
    });
    expect(none.status).toBe(0);
    expect(JSON.parse(none.stdout).data.needsInitramfs).toBe(false);

    const image = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: { ...baseData, hasImage: true } })}\n`,
      encoding: "utf8",
    });
    expect(image.status).toBe(0);
    expect(JSON.parse(image.stdout).data.needsInitramfs).toBe(true);

    const snapshot = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: { ...baseData, hasSnapshot: true } })}\n`,
      encoding: "utf8",
    });
    expect(snapshot.status).toBe(0);
    expect(JSON.parse(snapshot.stdout).data.needsInitramfs).toBe(true);
  });

  it("plans pdeathsig default detach and explicit opt-out", () => {
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
    const enabled = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: baseData })}\n`,
      encoding: "utf8",
    });
    expect(enabled.status).toBe(0);
    expect(JSON.parse(enabled.stdout).data.usePdeathsig).toBe(true);

    const detached = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: { ...baseData, detached: true } })}\n`,
      encoding: "utf8",
    });
    expect(detached.status).toBe(0);
    expect(JSON.parse(detached.stdout).data.usePdeathsig).toBe(false);

    const disabled = spawnSync(helper, ["boot-plan"], {
      input: `${JSON.stringify({ protocolVersion: 1, data: { ...baseData, pdeathsig: false } })}\n`,
      encoding: "utf8",
    });
    expect(disabled.status).toBe(0);
    expect(JSON.parse(disabled.stdout).data.usePdeathsig).toBe(false);
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
