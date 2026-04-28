// Exec primitive end-to-end.
//
// Boots the Debian base bundle with the exec-agent as the workload,
// opens the vsock UDS from the host, drives a few commands, asserts
// we got the expected output + exit codes.
//
// Skips when fixtures / rootfs-debian / HVF-entitled VMM binary aren't
// present.

import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boot } from "../index.ts";

const microvmRoot = resolve(import.meta.dirname, "../../../microvm");

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

function fixturesPresent(): boolean {
  for (const f of ["Image", "virt.dtb"]) {
    if (!existsSync(resolve(microvmRoot, "test-fixtures", f))) {
      return false;
    }
  }
  return true;
}

describe("VsockExec", () => {
  it("runs commands inside a booted bundle and returns exit codes", async () => {
    const binary = findBootTestBinary();
    if (!binary || !fixturesPresent()) {
      return;
    }
    const debianTar = resolve(microvmRoot, "../../release-assets/rootfs-debian-arm64.tar.gz");
    const modulesTar = resolve(microvmRoot, "../../release-assets/modules-arm64.tar.gz");
    if (!existsSync(debianTar) || !existsSync(modulesTar)) {
      return;
    }
    const udsPath = join(tmpdir(), `machinen-exec-${process.pid}.sock`);
    // Belt-and-suspenders — node:net won't connect to a stale file,
    // and our bridge will refuse to bind on top of one.
    try {
      rmSync(udsPath);
    } catch {}

    try {
      const vm = await boot({
        binary,
        cwd: microvmRoot,
        vmmEnv: {
          MACHINEN_BOOT_TEST: "1",
          MACHINEN_VSOCK: `in:1978:${udsPath}`,
          // Test-fixture binary loads test-fixtures/Image directly, so
          // the runtime never sees a MACHINEN_KERNEL it can probe for
          // modules. Hand it the path explicitly.
          MACHINEN_MODULES: modulesTar,
        },
        image: debianTar,
        cmd: ["/exec-agent"],
        env: { PATH: "/usr/local/bin:/usr/bin:/bin:/sbin" },
        timeoutMs: null,
      });
      try {
        const first = await vm.execRaw("echo from-guest && uname -m", {
          connectTimeoutMs: 60_000,
        });
        expect(first.exitCode).toBe(0);
        expect(first.stdout).toContain("from-guest");
        expect(first.stdout).toMatch(/aarch64|arm64/);

        // Second connection should reuse the same (persistent) agent.
        const second = await vm.execRaw("false");
        expect(second.exitCode).toBe(1);

        const third = await vm.execRaw("apt-get --version");
        expect(third.exitCode).toBe(0);
        expect(third.stdout).toContain("apt");
      } finally {
        await vm.kill();
      }
    } finally {
      try {
        rmSync(udsPath);
      } catch {}
    }
  }, 120_000);
});
