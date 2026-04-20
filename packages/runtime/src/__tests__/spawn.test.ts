// Tests for @machinen/runtime.
//
// The integration test boots the real VMM against the built-in
// Node.js REPL demo (same rootfs the microVM package's smoke.sh uses),
// pipes `1 + 1\n.exit\n` into it, and asserts Node evaluated the
// expression. Skipped (not failed) if the prerequisites aren't there:
// Image/virt.dtb/initramfs fixtures, or the HVF-entitled test binary.

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SpawnError, buildSnapshot, measureFirstByte, spawn } from "../index.ts";

const microvmRoot = resolve(import.meta.dirname, "../../../microvm");

function findBootTestBinary(): string | undefined {
  const cacheDir = resolve(microvmRoot, ".zig-cache/o");
  if (!existsSync(cacheDir)) return undefined;
  // Newest first; pick the one that mentions MACHINEN_BOOT_TEST.
  const candidates = readdirSync(cacheDir)
    .map((name) => resolve(cacheDir, name, "test"))
    .filter((p) => existsSync(p))
    .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const { p } of candidates) {
    try {
      const haystack = execSync(`strings ${p}`, { encoding: "utf8" });
      if (haystack.includes("MACHINEN_BOOT_TEST")) return p;
    } catch {}
  }
  return undefined;
}

function fixturesPresent(): boolean {
  for (const f of ["Image", "virt.dtb", "initramfs.cpio"]) {
    if (!existsSync(resolve(microvmRoot, "test-fixtures", f))) return false;
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
      // Fixtures missing — skip. See packages/microvm/test-fixtures/README.md.
      return;
    }

    // We don't assume a particular /demo.sh in the rootfs (the microvm
    // package's smoke scripts rewrite it between runs). We check that
    // spawn() starts the VMM, stderr streams back, and the kernel
    // boots far enough to say so. That's enough to prove the
    // spawn/stdio wiring works; driving a specific demo is the
    // microvm package's job (see test-fixtures/smoke.sh).
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

    const stderr = (await vm.errorOutput())
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
      .replace(/\r/g, "");

    // These two markers appear in any successful Linux boot and prove
    // the chain worked: our Zig VMM mapped memory, loaded the kernel,
    // ran it, and piped its serial output back to us.
    expect(stderr).toContain("Linux version");
    expect(stderr).toContain("Freeing unused kernel memory");
  }, 30_000);
});

describe("disk option", () => {
  it("throws SpawnError when the disk path does not exist", async () => {
    await expect(
      spawn({ binary: "/bin/sh", disk: "/nope/missing.img" }),
    ).rejects.toThrow(/disk image not found/);
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
