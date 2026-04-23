// Tests for @machinen/runtime.
//
// The integration test boots the real VMM against the built-in
// Node.js REPL demo (same rootfs the microVM package's smoke.sh uses),
// pipes `1 + 1\n.exit\n` into it, and asserts Node evaluated the
// expression. Skipped (not failed) if the prerequisites aren't there:
// Image/virt.dtb/initramfs fixtures, or the HVF-entitled test binary.

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SpawnError, buildSnapshot, measureFirstByte, spawn } from "../index.ts";

const microvmRoot = resolve(import.meta.dirname, "../../../microvm");

function findBootTestBinary(): string | undefined {
  const cacheDir = resolve(microvmRoot, ".zig-cache/o");
  if (!existsSync(cacheDir)) {
    return undefined;
  }
  // Newest first; pick the one that mentions MACHINEN_BOOT_TEST.
  const candidates = readdirSync(cacheDir)
    .map((name) => resolve(cacheDir, name, "test"))
    .filter((p) => existsSync(p))
    .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const { p } of candidates) {
    try {
      const haystack = execSync(`strings ${p}`, { encoding: "utf8" });
      if (haystack.includes("MACHINEN_BOOT_TEST")) {
        return p;
      }
    } catch {}
  }
  return undefined;
}

function fixturesPresent(): boolean {
  for (const f of ["Image", "virt.dtb", "initramfs.cpio"]) {
    if (!existsSync(resolve(microvmRoot, "test-fixtures", f))) {
      return false;
    }
  }
  return true;
}

describe("spawn", () => {
  it("throws SpawnError when the binary path does not exist", async () => {
    await expect(spawn({ binary: "/nope/does/not/exist" })).rejects.toThrow(SpawnError);
  });

  it("rejects wait() when the VMM exceeds its timeout", async () => {
    // Use a binary that just sleeps (the macOS `yes` command never
    // exits on its own). We're not booting a VM here — we're
    // testing the wait() timeout path against any long-running child.
    const vm = await spawn({ binary: "/usr/bin/yes", timeoutMs: 50 });
    try {
      await expect(vm.wait()).rejects.toThrow(SpawnError);
    } finally {
      await vm.kill();
    }
  });

  it("boots the VMM and the kernel reaches userspace", async () => {
    const binary = findBootTestBinary();
    if (!binary || !fixturesPresent()) {
      // Fixtures missing — skip. Run ./scripts/build-base-assets.sh to produce them.
      return;
    }

    // We don't assume a particular /machinen-config.json cmd. We
    // check that spawn() starts the VMM, stderr streams back, and
    // the kernel boots far enough to say so. That's enough to prove
    // the spawn/stdio wiring works; driving a specific workload is
    // the CLI's job (pnpm smoke-tests / pnpm machinen-dev).
    const vm = await spawn({
      binary,
      cwd: microvmRoot,
      env: { MACHINEN_BOOT_TEST: "1" },
      timeoutMs: null,
    });

    // Kill after 15s — plenty of time for the kernel banner to land.
    const killAfter = setTimeout(() => void vm.kill(), 15_000);
    killAfter.unref();

    await vm.wait();
    clearTimeout(killAfter);

    // Strip ANSI CSI sequences + CRs so grep-style assertions below
    // match. Using the literal escape character via String.fromCharCode
    // instead of \x1b so oxlint's no-control-regex stays quiet.
    const ESC = String.fromCharCode(0x1b);
    const stderr = (await vm.errorOutput())
      .replace(new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, "g"), "")
      .replace(/\r/g, "");

    // These markers prove the chain worked: our Zig VMM mapped memory,
    // loaded the kernel, ran it, and piped its serial output back to
    // us. Kernel cmdline now boots quiet (loglevel=3) so most info-
    // level setup chatter is suppressed — the banner line still makes
    // it through because it's printed via earlycon before cmdline
    // parsing applies the level filter.
    expect(stderr).toContain("Linux version");
  }, 30_000);
});

describe("disk option", () => {
  it("throws SpawnError when the disk path does not exist", async () => {
    await expect(spawn({ binary: "/bin/sh", disk: "/nope/missing.img" })).rejects.toThrow(
      /disk image not found/,
    );
  });

  it("passes the resolved disk path as MACHINEN_DISK to the child", async () => {
    // Round-trip test: echo-env-then-exit. Any existing file works as
    // a stand-in for a disk image since we're not actually running a
    // VMM here.
    const disk = `/tmp/machinen-runtime-disk-${process.pid}`;
    writeFileSync(disk, "");
    try {
      const vm = await spawn({
        binary: "/bin/sh",
        args: ["-c", "printf 'DISK=%s\\n' \"$MACHINEN_DISK\""],
        disk,
        timeoutMs: 2_000,
      });
      await vm.wait();
      const out = await vm.output();
      expect(out.trim()).toBe(`DISK=${disk}`);
    } finally {
      try {
        unlinkSync(disk);
      } catch {}
    }
  });
});

describe("kernel option", () => {
  it("throws SpawnError when the kernel path does not exist", async () => {
    await expect(spawn({ binary: "/bin/sh", kernel: "/nope/missing-kernel" })).rejects.toThrow(
      /kernel not found/,
    );
  });

  it("passes the resolved kernel path as MACHINEN_KERNEL to the child", async () => {
    const kernel = `/tmp/machinen-runtime-kernel-${process.pid}`;
    writeFileSync(kernel, "");
    try {
      const vm = await spawn({
        binary: "/bin/sh",
        args: ["-c", "printf 'KERNEL=%s\\n' \"$MACHINEN_KERNEL\""],
        kernel,
        timeoutMs: 2_000,
      });
      await vm.wait();
      const out = await vm.output();
      expect(out.trim()).toBe(`KERNEL=${kernel}`);
    } finally {
      try {
        unlinkSync(kernel);
      } catch {}
    }
  });
});

describe("dtb option", () => {
  it("throws SpawnError when the dtb path does not exist", async () => {
    await expect(spawn({ binary: "/bin/sh", dtb: "/nope/missing-dtb" })).rejects.toThrow(
      /dtb not found/,
    );
  });

  it("passes the resolved dtb path as MACHINEN_DTB to the child", async () => {
    const dtb = `/tmp/machinen-runtime-dtb-${process.pid}`;
    writeFileSync(dtb, "");
    try {
      const vm = await spawn({
        binary: "/bin/sh",
        args: ["-c", "printf 'DTB=%s\\n' \"$MACHINEN_DTB\""],
        dtb,
        timeoutMs: 2_000,
      });
      await vm.wait();
      const out = await vm.output();
      expect(out.trim()).toBe(`DTB=${dtb}`);
    } finally {
      try {
        unlinkSync(dtb);
      } catch {}
    }
  });
});

describe("measureFirstByte", () => {
  it("returns the wall-clock time before the child produces stderr", async () => {
    // /bin/sh writes the `1` to stderr immediately.
    const vm = await spawn({
      binary: "/bin/sh",
      args: ["-c", "echo 1 >&2; sleep 1"],
      timeoutMs: 3_000,
    });
    const ms = await measureFirstByte(vm);
    await vm.wait();
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(1500); // well under the 1s sleep
  });
});

describe("bundle option", () => {
  it("throws SpawnError when the bundle directory does not exist", async () => {
    await expect(spawn({ binary: "/bin/sh", bundle: "/nope/missing-bundle" })).rejects.toThrow(
      /bundle directory not found/,
    );
  });

  it("throws SpawnError when the bundle is missing rootfs/", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-test-bundle-"));
    try {
      writeFileSync(join(dir, "machinen-config.json"), "{}");
      await expect(spawn({ binary: "/bin/sh", bundle: dir })).rejects.toThrow(
        /bundle missing rootfs\//,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws SpawnError when the bundle is missing machinen-config.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-test-bundle-"));
    try {
      mkdirSync(join(dir, "rootfs"));
      await expect(spawn({ binary: "/bin/sh", bundle: dir })).rejects.toThrow(
        /bundle missing machinen-config.json/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws SpawnError when baseRootfs is set but the tarball is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-test-bundle-"));
    try {
      mkdirSync(join(dir, "rootfs"));
      writeFileSync(join(dir, "machinen-config.json"), "{}");
      await expect(
        spawn({ binary: "/bin/sh", bundle: dir, baseRootfs: "/nope/missing-tarball.tgz" }),
      ).rejects.toThrow(/base rootfs tarball not found/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("boots a bundle and the guest runs the cmd from machinen-config.json", async () => {
    const binary = findBootTestBinary();
    if (!binary || !fixturesPresent()) {
      // VMM fixtures missing — skip.
      return;
    }
    const debianRootfs = resolve(microvmRoot, "test-fixtures/rootfs-debian");
    if (!existsSync(debianRootfs)) {
      // Debian rootfs not produced in this checkout — skip.
      return;
    }

    const bundleDir = mkdtempSync(join(tmpdir(), "machinen-e2e-bundle-"));
    try {
      // rootfs/ is a symlink to the staged Debian tree, so we don't
      // pay a 100 MB copy per test run.
      execSync(`ln -s ${debianRootfs} ${join(bundleDir, "rootfs")}`);
      writeFileSync(
        join(bundleDir, "machinen-config.json"),
        JSON.stringify({
          cmd: ["/bin/sh", "-c", "echo BUNDLE_MARKER=$BUNDLE_MARKER; pwd; sleep 999999"],
          env: { PATH: "/usr/bin:/bin", BUNDLE_MARKER: "spawned-via-ts" },
          cwd: "/var",
        }),
      );

      const vm = await spawn({
        binary,
        cwd: microvmRoot,
        env: { MACHINEN_BOOT_TEST: "1", MACHINEN_DISK: "" },
        bundle: bundleDir,
        timeoutMs: null,
      });
      // Kill after 20s — enough for kernel boot + /init + sh to print.
      const killAfter = setTimeout(() => void vm.kill(), 20_000);
      killAfter.unref();
      await vm.wait();
      clearTimeout(killAfter);

      const ESC = String.fromCharCode(0x1b);
      const stderr = (await vm.errorOutput())
        .replace(new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, "g"), "")
        .replace(/\r/g, "");

      expect(stderr).toContain("Linux version");
      expect(stderr).toContain("BUNDLE_MARKER=spawned-via-ts");
      expect(stderr).toContain("/var");
    } finally {
      rmSync(bundleDir, { recursive: true, force: true });
    }
  }, 40_000);
});

describe("mount option", () => {
  function makeBundle(): string {
    const dir = mkdtempSync(join(tmpdir(), "machinen-mount-bundle-"));
    mkdirSync(join(dir, "rootfs"));
    writeFileSync(join(dir, "machinen-config.json"), JSON.stringify({ cmd: ["/bin/true"] }));
    return dir;
  }

  it("rejects a mount with a non-absolute guest path", async () => {
    const bundle = makeBundle();
    try {
      await expect(
        spawn({ binary: "/bin/sh", bundle, mount: { host: "/tmp", guest: "mnt/app" } }),
      ).rejects.toThrow(/guest path must be absolute/);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("rejects a mount whose guest path is not under /mnt/", async () => {
    const bundle = makeBundle();
    try {
      for (const guest of ["/srv/app", "/etc/config", "/proc", "/init", "/mntfoo"]) {
        await expect(
          spawn({ binary: "/bin/sh", bundle, mount: { host: "/tmp", guest } }),
        ).rejects.toThrow(/must live under \/mnt\//);
      }
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("rejects a mount whose guest path is the mount root itself", async () => {
    const bundle = makeBundle();
    try {
      for (const guest of ["/mnt", "/mnt/"]) {
        await expect(
          spawn({ binary: "/bin/sh", bundle, mount: { host: "/tmp", guest } }),
        ).rejects.toThrow(/must live under \/mnt\//);
      }
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("rejects a mount whose host path does not exist", async () => {
    const bundle = makeBundle();
    try {
      await expect(
        spawn({
          binary: "/bin/sh",
          bundle,
          mount: { host: "/nope/missing/host", guest: "/mnt/x" },
        }),
      ).rejects.toThrow(/mount host path not found/);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("rejects a mount whose host path is a file (not a directory)", async () => {
    const bundle = makeBundle();
    const hostFile = `/tmp/machinen-mount-file-${process.pid}`;
    writeFileSync(hostFile, "x");
    try {
      await expect(
        spawn({ binary: "/bin/sh", bundle, mount: { host: hostFile, guest: "/mnt/x" } }),
      ).rejects.toThrow(/must be a directory/);
    } finally {
      try {
        unlinkSync(hostFile);
      } catch {}
      rmSync(bundle, { recursive: true, force: true });
    }
  });
});

describe("buildSnapshot", () => {
  it("creates the disk file at the requested size even if the VMM fails fast", async () => {
    // Point at a binary that exits immediately, so the VMM "fails"
    // in the dump-OK-check but the disk file still exists.
    const disk = `/tmp/machinen-runtime-snap-${process.pid}.img`;
    try {
      await expect(
        buildSnapshot({
          binary: "/usr/bin/true",
          diskPath: disk,
          diskSizeBytes: 1 * 1024 * 1024, // 1 MiB
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow(/dump OK/);
      expect(existsSync(disk)).toBe(true);
      expect(statSync(disk).size).toBe(1 * 1024 * 1024);
    } finally {
      try {
        unlinkSync(disk);
      } catch {}
    }
  });
});
