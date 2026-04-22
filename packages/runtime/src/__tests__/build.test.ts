// build() round-trip.
//
// Unit:        validates input handling without booting a VMM.
// Integration: boots the base rootfs, runs `apt-get install tree` via the
//              install hook, freezes, then spawns from the produced
//              snapshot and asserts `tree --version` runs. Skips when
//              the HVF test binary or base rootfs tarball aren't staged.

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { build, BuildError, VsockExec, spawn } from "../index.ts";

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

  it("produces a snapshot tarball that spawn() can consume", async () => {
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
      const result = await build({
        binary: prereqs.binary,
        cwd: microvmRoot,
        env: { MACHINEN_BOOT_TEST: "1", MACHINEN_DEBUG: "1" },
        base: prereqs.base,
        install: async (vm) => {
          // A single apt-get install is the smallest honest proof that
          // the install hook and round-trip work — the package is
          // present post-build iff our repackDiskTarToGz captured state
          // correctly. `apt-get update` is retried because libslirp's
          // user-mode network stack is flaky under sustained transfer
          // and occasionally drops hash-index downloads; unrelated to
          // what we're testing here.
          let lastErr: unknown;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              await vm.exec("apt-get update");
              lastErr = undefined;
              break;
            } catch (err) {
              lastErr = err;
            }
          }
          if (lastErr) throw lastErr;
          await vm.exec("apt-get install -y --no-install-recommends tree");
        },
        out,
        // Leave some slack for apt over slirp DNS.
        timeoutMs: 5 * 60 * 1000,
      });

      expect(existsSync(result.snapshotPath)).toBe(true);
      expect(result.sizeBytes).toBeGreaterThan(30 * 1024 * 1024);

      // Round-trip: boot from the produced snapshot, assert tree runs.
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
          const res = await VsockExec.run(udsPath, "tree --version", {
            connectTimeoutMs: 60_000,
          });
          expect(res.exitCode).toBe(0);
          expect(res.stdout).toMatch(/tree/i);
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
  }, 10 * 60 * 1000);
});
