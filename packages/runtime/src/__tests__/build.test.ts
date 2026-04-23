// build() round-trip.
//
// Unit:        validates input handling without booting a VMM.
// Integration: boots the base rootfs, writes a marker file via the install
//              hook, freezes, then spawns from the produced snapshot and
//              asserts the marker's content + mode survive. Skips when the
//              HVF test binary or base rootfs tarball aren't staged. Stays
//              off the apt/network path — libslirp stability under sustained
//              transfer is a separate concern (#82).

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build, BuildError, resolveBaseRootfs, VsockExec, spawn } from "../index.ts";

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

function integrationPrereqs(): { binary: string; base: string } | undefined {
  const binary = findBootTestBinary();
  const base = resolve(releaseAssets, "rootfs-debian-arm64.tar.gz");
  const kernel = resolve(microvmRoot, "test-fixtures/Image");
  const dtb = resolve(microvmRoot, "test-fixtures/virt.dtb");
  if (!binary || !existsSync(base) || !existsSync(kernel) || !existsSync(dtb)) {
    return undefined;
  }
  return { binary, base };
}

describe("build", () => {
  it("rejects a missing base rootfs path", async () => {
    await expect(
      build({
        base: "/nonexistent/rootfs.tar.gz",
        install: async () => {},
        out: join(tmpdir(), "ignored.tar.gz"),
      }),
    ).rejects.toBeInstanceOf(BuildError);
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
      expect(() => resolveBaseRootfs("/nope/does/not/exist.tar.gz")).toThrow(BuildError);
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
        expect(() => resolveBaseRootfs()).toThrow(BuildError);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it(
    "produces a snapshot tarball that spawn() can consume",
    async () => {
      const prereqs = integrationPrereqs();
      if (!prereqs) {
        console.warn(
          "skip build integration: run `bash scripts/build-base-assets.sh` and `zig build test` first",
        );
        return;
      }

      const workDir = mkdtempSync(join(tmpdir(), "machinen-build-test-"));
      const out = join(workDir, "warm.tar.gz");

      try {
        // The install hook writes a file with a recognizable payload and
        // a non-default mode. The round-trip below asserts both survive:
        // content proves repackDiskTarToGz captured the write; mode proves
        // tar `--numeric-owner` / perms were preserved. No network — the
        // apt path depends on libslirp under sustained load, which is
        // tracked separately (#82) and is not what this test validates.
        const result = await build({
          binary: prereqs.binary,
          cwd: microvmRoot,
          env: { MACHINEN_BOOT_TEST: "1", MACHINEN_DEBUG: "1" },
          base: prereqs.base,
          install: async (vm) => {
            await vm.exec(
              "mkdir -p /warm && printf machinen-build-ok > /warm/marker && chmod 0640 /warm/marker",
            );
          },
          out,
          timeoutMs: 3 * 60 * 1000,
        });

        expect(existsSync(result.snapshotPath)).toBe(true);
        // Sanity: the snapshot is the base rootfs plus our marker; it
        // should be within spitting distance of the base tarball size.
        expect(result.sizeBytes).toBeGreaterThan(30 * 1024 * 1024);

        // Round-trip: boot from the produced snapshot and read the marker.
        const bundleDir = mkdtempSync(join(tmpdir(), "machinen-build-spawn-"));
        const udsPath = join(workDir, "exec.sock");
        try {
          execSync(`mkdir -p ${join(bundleDir, "rootfs")}`);
          execSync(
            `printf '%s' '${JSON.stringify({
              cmd: ["/exec-agent"],
              env: { PATH: "/usr/local/bin:/usr/bin:/bin:/sbin" },
            })}' > ${join(bundleDir, "machinen-config.json")}`,
          );

          const vm = await spawn({
            binary: prereqs.binary,
            cwd: microvmRoot,
            env: {
              MACHINEN_BOOT_TEST: "1",
              MACHINEN_VSOCK: `in:1978:${udsPath}`,
            },
            baseRootfs: result.snapshotPath,
            bundle: bundleDir,
            timeoutMs: null,
          });
          try {
            const content = await VsockExec.run(udsPath, "cat /warm/marker", {
              connectTimeoutMs: 60_000,
            });
            expect(content.exitCode).toBe(0);
            expect(content.stdout).toBe("machinen-build-ok");

            const mode = await VsockExec.run(udsPath, "stat -c %a /warm/marker");
            expect(mode.exitCode).toBe(0);
            expect(mode.stdout.trim()).toBe("640");
          } finally {
            await vm.kill();
          }
        } finally {
          rmSync(bundleDir, { recursive: true, force: true });
          try {
            rmSync(udsPath);
          } catch {}
        }
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
    5 * 60 * 1000,
  );
});
