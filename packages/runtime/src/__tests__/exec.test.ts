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

const FIXTURE_FILES = ["Image", "virt.dtb"];

// #212: replace silent skip on missing fixtures with a loud throw so a
// stale or absent kernel cannot masquerade as a passing run. Set
// MACHINEN_REQUIRE_FIXTURES=0 to keep the legacy skip on hosts that
// can't build the microVM artifacts.
function requireFixturesOrSkip(extraPaths: string[] = []): {
  skip: boolean;
  binary: string;
} {
  const binary = findBootTestBinary();
  const missing: string[] = [];
  if (!binary) {
    missing.push("microvm/.zig-cache boot-test binary");
  }
  for (const f of FIXTURE_FILES) {
    if (!existsSync(resolve(microvmRoot, "test-fixtures", f))) {
      missing.push(`test-fixtures/${f}`);
    }
  }
  for (const p of extraPaths) {
    if (!existsSync(p)) {
      missing.push(p);
    }
  }
  if (missing.length === 0) {
    return { skip: false, binary: binary! };
  }
  if (process.env.MACHINEN_REQUIRE_FIXTURES === "0") {
    return { skip: true, binary: "" };
  }
  throw new Error(
    `test requires microVM fixtures (missing: ${missing.join(", ")}); ` +
      `run scripts/build-base-assets.sh + pnpm provision ` +
      `(or set MACHINEN_REQUIRE_FIXTURES=0 to opt out)`,
  );
}

describe("VsockExec", () => {
  it("runs commands inside a booted bundle and returns exit codes", async () => {
    const debianTar = resolve(microvmRoot, "../../release-assets/rootfs-debian-arm64.tar.gz");
    const { skip, binary } = requireFixturesOrSkip([debianTar]);
    if (skip) {
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
