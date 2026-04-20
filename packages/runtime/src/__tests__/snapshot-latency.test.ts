// Latency marker test: spawn from a prebuilt snapshot, record how
// long until the restored workload logs "restore OK". Not a pass/fail
// gate — documentation of where the numbers stand today so we know
// what sub-second would have to beat.
//
// Preconditions (the test skips gracefully if either is missing):
//   1. A built VMM binary under packages/microvm/.zig-cache/o/*/test.
//   2. A disk.img pre-seeded with a CRIU snapshot —
//      `packages/microvm/test-fixtures/smoke.sh spawn` produces one.
//
// Run manually:
//   pnpm vitest run packages/runtime/src/__tests__/snapshot-latency.test.ts --reporter=verbose

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { spawn } from "../index.ts";

const microvmRoot = resolve(import.meta.dirname, "../../../microvm");

function findBootTestBinary(): string | undefined {
  const cacheDir = resolve(microvmRoot, ".zig-cache/o");
  if (!existsSync(cacheDir)) {
    return undefined;
  }
  for (const name of readdirSync(cacheDir).sort((a, b) => {
    const am = statSync(resolve(cacheDir, a)).mtimeMs;
    const bm = statSync(resolve(cacheDir, b)).mtimeMs;
    return bm - am;
  })) {
    const p = resolve(cacheDir, name, "test");
    if (!existsSync(p)) {
      continue;
    }
    try {
      if (execSync(`strings ${p}`, { encoding: "utf8" }).includes("MACHINEN_BOOT_TEST")) {
        return p;
      }
    } catch {}
  }
  return undefined;
}

describe("latency", () => {
  it("records how long a cold spawn-from-snapshot takes to reach 'restore OK'", async () => {
    const binary = findBootTestBinary();
    const disk = resolve(microvmRoot, "test-fixtures/disk.img");
    if (!binary || !existsSync(disk)) {
      console.warn("skip: binary or disk.img missing (run smoke.sh spawn first)");
      return;
    }

    const t0 = Date.now();
    const vm = await spawn({
      binary,
      cwd: microvmRoot,
      env: { MACHINEN_BOOT_TEST: "1" },
      disk,
      timeoutMs: null,
    });

    // Stream stderr and stop watching the moment the restored workload
    // prints "restore OK". That's the first moment the caller could
    // reasonably start driving the sandbox.
    const restoreOkMs: number = await new Promise((done) => {
      let buf = "";
      const timeout = setTimeout(() => done(Date.now() - t0), 45_000);
      timeout.unref();
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        if (buf.includes("restore OK")) {
          vm.stderr.off("data", onData);
          clearTimeout(timeout);
          done(Date.now() - t0);
        }
      };
      vm.stderr.on("data", onData);
    });

    // Let the restored process run a few ticks, then tear down.
    await new Promise((r) => setTimeout(r, 3_000));
    await vm.kill();

    console.log(
      JSON.stringify({
        spawnToRestoreOkMs: restoreOkMs,
        note: "cold VMM boot + kernel + criu-ns restore to 'restore OK'",
      }),
    );
  }, 60_000);
});
