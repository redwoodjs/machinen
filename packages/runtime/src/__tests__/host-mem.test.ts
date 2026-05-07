// Unit coverage for #274 fork backpressure. The OS-specific readers
// (readHostFreeBytes) get a smoke test that just verifies they return
// a positive number on the running platform — actually mocking
// /proc/meminfo or vm_stat would test the regex parser more than the
// behavior we care about. The interesting tests are around
// `checkForkBackpressure`'s threshold logic, which is the part fork
// orchestration depends on.

import { describe, expect, it } from "vitest";
import { BootError } from "../errors.ts";
import {
  checkForkBackpressure,
  DEFAULT_FREE_MEMORY_THRESHOLD,
  readHostFreeBytes,
  readHostTotalBytes,
} from "../host-mem.ts";

describe("readHostFreeBytes", () => {
  it("returns a positive number on the running platform", async () => {
    const free = await readHostFreeBytes();
    expect(free).toBeGreaterThan(0);
    expect(free).toBeLessThanOrEqual(readHostTotalBytes());
  });
});

describe("checkForkBackpressure", () => {
  const GIB = 1024 * 1024 * 1024;

  it("passes when free memory is comfortably above the threshold", async () => {
    await expect(
      checkForkBackpressure({
        threshold: 0.05,
        readFree: async () => 8 * GIB,
        totalBytes: 32 * GIB,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws FORK_MEMORY_BACKPRESSURE when free is below threshold", async () => {
    await expect(
      checkForkBackpressure({
        threshold: 0.1,
        readFree: async () => 1 * GIB,
        totalBytes: 32 * GIB,
      }),
    ).rejects.toMatchObject({
      code: "FORK_MEMORY_BACKPRESSURE",
      retryable: true,
    });
  });

  it("includes free / required / total MiB and the threshold pct in the message", async () => {
    let err: unknown;
    try {
      await checkForkBackpressure({
        threshold: 0.1,
        readFree: async () => 0.5 * GIB,
        totalBytes: 32 * GIB,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BootError);
    const msg = (err as BootError).message;
    expect(msg).toContain("512 MiB free");
    expect(msg).toContain("32768 MiB total");
    expect(msg).toContain("threshold 10%");
    expect(msg).toContain("3277 MiB");
  });

  it("disabled when threshold <= 0 even when free is zero", async () => {
    await expect(
      checkForkBackpressure({
        threshold: 0,
        readFree: async () => 0,
        totalBytes: 32 * GIB,
      }),
    ).resolves.toBeUndefined();
    await expect(
      checkForkBackpressure({
        threshold: -1,
        readFree: async () => 0,
        totalBytes: 32 * GIB,
      }),
    ).resolves.toBeUndefined();
  });

  it("ignores NaN/Infinity thresholds (degraded to disabled)", async () => {
    // A bogus threshold should soft-fail rather than nuke a fork that
    // would otherwise be fine. The user's CLI parser is the wrong place
    // to crash on a config error.
    await expect(
      checkForkBackpressure({
        threshold: NaN,
        readFree: async () => 0,
        totalBytes: 32 * GIB,
      }),
    ).resolves.toBeUndefined();
    await expect(
      checkForkBackpressure({
        threshold: Number.POSITIVE_INFINITY,
        readFree: async () => 0,
        totalBytes: 32 * GIB,
      }),
    ).resolves.toBeUndefined();
  });

  it("caps threshold at 1 — passes when free >= total", async () => {
    // threshold = 5 (a typo) shouldn't always fail; it caps at 1
    // (= require total bytes free). With total bytes free, it passes.
    await expect(
      checkForkBackpressure({
        threshold: 5,
        readFree: async () => 32 * GIB,
        totalBytes: 32 * GIB,
      }),
    ).resolves.toBeUndefined();
  });

  it("default threshold matches the documented 1%", () => {
    expect(DEFAULT_FREE_MEMORY_THRESHOLD).toBe(0.01);
  });
});
