// provision() round-trip.
//
// Unit:        validates input handling without booting a VMM.
// Integration: boots the base rootfs, writes a marker file via the install
//              hook, freezes, then spawns from the produced snapshot and
//              asserts the marker's content + mode survive. Skips when the
//              HVF test binary or base rootfs tarball aren't staged. Stays
//              off the network path — this test is about filesystem
//              round-trip, not download reliability.

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boot,
  provision,
  ProvisionError,
  resolveBaseDtb,
  resolveBaseKernel,
  resolveBaseRootfs,
} from "../index.ts";

const microvmRoot = resolve(import.meta.dirname, "../../../microvm");
const releaseAssets = resolve(microvmRoot, "../../release-assets");

function findBootTestBinary(): string | undefined {
  const cacheDir = resolve(microvmRoot, ".zig-cache/o");
  if (!existsSync(cacheDir)) {
    return undefined;
  }
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

function integrationPrereqs():
  | { binary: string; base: string; kernel: string; dtb: string }
  | undefined {
  const binary = findBootTestBinary();
  const base = resolve(releaseAssets, "rootfs-debian-arm64.tar.gz");
  const kernel = resolve(microvmRoot, "test-fixtures/Image");
  const dtb = resolve(microvmRoot, "test-fixtures/virt.dtb");
  if (!binary || !existsSync(base) || !existsSync(kernel) || !existsSync(dtb)) {
    return undefined;
  }
  return { binary, base, kernel, dtb };
}

describe("provision", () => {
  const originalGuestArch = process.env.MACHINEN_GUEST_ARCH;
  beforeEach(() => {
    process.env.MACHINEN_GUEST_ARCH = "arm64";
  });
  afterEach(() => {
    if (originalGuestArch === undefined) {
      delete process.env.MACHINEN_GUEST_ARCH;
    } else {
      process.env.MACHINEN_GUEST_ARCH = originalGuestArch;
    }
  });

  it("rejects a missing base rootfs path", async () => {
    await expect(
      provision({
        base: "/nonexistent/rootfs.tar.gz",
        install: async () => {},
        out: join(tmpdir(), "ignored.tar.gz"),
      }),
    ).rejects.toBeInstanceOf(ProvisionError);
  });

  describe("resolveBaseRootfs", () => {
    const originalAssetsDir = process.env.MACHINEN_ASSETS_DIR;
    afterEach(() => {
      if (originalAssetsDir === undefined) {
        delete process.env.MACHINEN_ASSETS_DIR;
      } else {
        process.env.MACHINEN_ASSETS_DIR = originalAssetsDir;
      }
    });

    it("honors an explicit path", () => {
      const dir = mkdtempSync(join(tmpdir(), "machinen-base-explicit-"));
      const p = join(dir, "explicit.tar.gz");
      try {
        writeFileSync(p, "");
        expect(resolveBaseRootfs(p)).toBe(p);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("throws if the explicit path is missing", () => {
      expect(() => resolveBaseRootfs("/nope/does/not/exist.tar.gz")).toThrow(ProvisionError);
    });

    it("falls back to MACHINEN_ASSETS_DIR when base is omitted", () => {
      const dir = mkdtempSync(join(tmpdir(), "machinen-base-envdir-"));
      const p = join(dir, "rootfs-debian-arm64.tar.gz");
      try {
        writeFileSync(p, "");
        process.env.MACHINEN_ASSETS_DIR = dir;
        expect(resolveBaseRootfs()).toBe(p);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("throws if MACHINEN_ASSETS_DIR is set but missing the tarball", () => {
      const dir = mkdtempSync(join(tmpdir(), "machinen-base-envdir-empty-"));
      try {
        process.env.MACHINEN_ASSETS_DIR = dir;
        expect(() => resolveBaseRootfs()).toThrow(ProvisionError);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("resolveBaseKernel", () => {
    const originalAssetsDir = process.env.MACHINEN_ASSETS_DIR;
    afterEach(() => {
      if (originalAssetsDir === undefined) {
        delete process.env.MACHINEN_ASSETS_DIR;
      } else {
        process.env.MACHINEN_ASSETS_DIR = originalAssetsDir;
      }
    });

    it("honors an explicit path", () => {
      const dir = mkdtempSync(join(tmpdir(), "machinen-kernel-explicit-"));
      const p = join(dir, "Image");
      try {
        writeFileSync(p, "");
        expect(resolveBaseKernel(p)).toBe(p);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("throws if the explicit path is missing", () => {
      expect(() => resolveBaseKernel("/nope/does/not/exist/Image")).toThrow(ProvisionError);
    });

    it("falls back to MACHINEN_ASSETS_DIR/Image-arm64 when kernel is omitted", () => {
      const dir = mkdtempSync(join(tmpdir(), "machinen-kernel-envdir-"));
      const p = join(dir, "Image-arm64");
      try {
        writeFileSync(p, "");
        process.env.MACHINEN_ASSETS_DIR = dir;
        expect(resolveBaseKernel()).toBe(p);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("throws if MACHINEN_ASSETS_DIR is set but missing the kernel", () => {
      const dir = mkdtempSync(join(tmpdir(), "machinen-kernel-envdir-empty-"));
      try {
        process.env.MACHINEN_ASSETS_DIR = dir;
        expect(() => resolveBaseKernel()).toThrow(ProvisionError);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("resolveBaseDtb", () => {
    const originalAssetsDir = process.env.MACHINEN_ASSETS_DIR;
    afterEach(() => {
      if (originalAssetsDir === undefined) {
        delete process.env.MACHINEN_ASSETS_DIR;
      } else {
        process.env.MACHINEN_ASSETS_DIR = originalAssetsDir;
      }
    });

    it("honors an explicit path", () => {
      const dir = mkdtempSync(join(tmpdir(), "machinen-dtb-explicit-"));
      const p = join(dir, "virt.dtb");
      try {
        writeFileSync(p, "");
        expect(resolveBaseDtb(p)).toBe(p);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("throws if the explicit path is missing", () => {
      expect(() => resolveBaseDtb("/nope/does/not/exist/virt.dtb")).toThrow(ProvisionError);
    });

    it("falls back to MACHINEN_ASSETS_DIR/virt-arm64.dtb when dtb is omitted", () => {
      const dir = mkdtempSync(join(tmpdir(), "machinen-dtb-envdir-"));
      const p = join(dir, "virt-arm64.dtb");
      try {
        writeFileSync(p, "");
        process.env.MACHINEN_ASSETS_DIR = dir;
        expect(resolveBaseDtb()).toBe(p);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("throws if MACHINEN_ASSETS_DIR is set but missing the dtb", () => {
      const dir = mkdtempSync(join(tmpdir(), "machinen-dtb-envdir-empty-"));
      try {
        process.env.MACHINEN_ASSETS_DIR = dir;
        expect(() => resolveBaseDtb()).toThrow(ProvisionError);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it(
    "produces a snapshot tarball that boot() can consume",
    async () => {
      const prereqs = integrationPrereqs();
      if (!prereqs) {
        console.warn(
          "skip provision integration: run `bash scripts/build-base-assets.sh` and `zig build test` first",
        );
        return;
      }

      const workDir = mkdtempSync(join(tmpdir(), "machinen-provision-test-"));
      const out = join(workDir, "warm.tar.gz");

      try {
        // The install hook writes a file with a recognizable payload and
        // a non-default mode. The round-trip below asserts both survive:
        // content proves repackDiskTarToGz captured the write; mode proves
        // tar `--numeric-owner` / perms were preserved. No network — the
        // apt path is orthogonal to what this test validates.
        const result = await provision({
          binary: prereqs.binary,
          cwd: microvmRoot,
          vmmEnv: {
            MACHINEN_BOOT_TEST: "1",
            MACHINEN_DEBUG: "1",
          },
          base: prereqs.base,
          kernel: prereqs.kernel,
          dtb: prereqs.dtb,
          install: async (vm) => {
            await vm.exec(
              "mkdir -p /warm && printf machinen-provision-ok > /warm/marker && chmod 0640 /warm/marker",
            );
          },
          out,
          timeoutMs: 3 * 60 * 1000,
        });

        expect(existsSync(result.imagePath)).toBe(true);
        // Sanity: the snapshot is the base rootfs plus our marker; it
        // should be within spitting distance of the base tarball size.
        expect(result.sizeBytes).toBeGreaterThan(30 * 1024 * 1024);

        // Round-trip: boot from the produced snapshot and read the marker.
        const vm = await boot({
          binary: prereqs.binary,
          cwd: microvmRoot,
          vmmEnv: {
            MACHINEN_BOOT_TEST: "1",
          },
          image: result.imagePath,
          kernel: prereqs.kernel,
          dtb: prereqs.dtb,
          cmd: ["/exec-agent"],
          env: { PATH: "/usr/local/bin:/usr/bin:/bin:/sbin" },
          timeoutMs: null,
        });
        try {
          const content = await vm.exec("cat /warm/marker", { connectTimeoutMs: 60_000 });
          expect(content.exitCode).toBe(0);
          expect(content.stdout).toBe("machinen-provision-ok");

          const mode = await vm.exec("stat -c %a /warm/marker");
          expect(mode.exitCode).toBe(0);
          expect(mode.stdout.trim()).toBe("640");
        } finally {
          await vm.kill();
        }
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
    5 * 60 * 1000,
  );
});
