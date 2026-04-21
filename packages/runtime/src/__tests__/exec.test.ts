// Exec primitive end-to-end.
//
// Boots the Debian base bundle with the exec-agent as the workload,
// opens the vsock UDS from the host, drives a few commands, asserts
// we got the expected output + exit codes.
//
// Skips when fixtures / rootfs-debian / HVF-entitled VMM binary aren't
// present.

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VsockExec, spawn } from "../index.ts";

const microvmRoot = resolve(import.meta.dirname, "../../../microvm");

function findBootTestBinary(): string | undefined {
  const cacheDir = resolve(microvmRoot, ".zig-cache/o");
  if (!existsSync(cacheDir)) return undefined;
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
  for (const f of ["Image", "virt.dtb"]) {
    if (!existsSync(resolve(microvmRoot, "test-fixtures", f))) return false;
  }
  return true;
}

describe("VsockExec", () => {
  it("runs commands inside a booted bundle and returns exit codes", async () => {
    const binary = findBootTestBinary();
    if (!binary || !fixturesPresent()) return;
    const debianRootfs = resolve(microvmRoot, "test-fixtures/rootfs-debian");
    if (!existsSync(debianRootfs)) return;
    if (!existsSync(join(debianRootfs, "sbin/machinen-exec-agent"))) return;

    const bundleDir = mkdtempSync(join(tmpdir(), "machinen-exec-bundle-"));
    const udsPath = join(tmpdir(), `machinen-exec-${process.pid}.sock`);
    // Belt-and-suspenders — node:net won't connect to a stale file,
    // and our bridge will refuse to bind on top of one.
    try {
      rmSync(udsPath);
    } catch {}

    try {
      execSync(`ln -s ${debianRootfs} ${join(bundleDir, "rootfs")}`);
      writeFileSync(
        join(bundleDir, "machinen-config.json"),
        JSON.stringify({
          cmd: ["/sbin/machinen-exec-agent"],
          env: { PATH: "/usr/local/bin:/usr/bin:/bin:/sbin" },
        }),
      );

      const vm = await spawn({
        binary,
        cwd: microvmRoot,
        env: {
          MACHINEN_BOOT_TEST: "1",
          MACHINEN_DISK: "",
          MACHINEN_VSOCK: `in:1978:${udsPath}`,
        },
        bundle: bundleDir,
        timeoutMs: null,
      });
      try {
        const first = await VsockExec.run(udsPath, "echo from-guest && uname -m", {
          connectTimeoutMs: 60_000,
        });
        expect(first.exitCode).toBe(0);
        expect(first.stdout).toContain("from-guest");
        expect(first.stdout).toMatch(/aarch64|arm64/);

        // Second connection should reuse the same (persistent) agent.
        const second = await VsockExec.run(udsPath, "false");
        expect(second.exitCode).toBe(1);

        const third = await VsockExec.run(udsPath, "apt-get --version");
        expect(third.exitCode).toBe(0);
        expect(third.stdout).toContain("apt");
      } finally {
        await vm.kill();
      }
    } finally {
      rmSync(bundleDir, { recursive: true, force: true });
      try {
        rmSync(udsPath);
      } catch {}
    }
  }, 120_000);
});
