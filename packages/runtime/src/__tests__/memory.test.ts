// Phase A unit coverage for #263: auto-sizing the guest RAM ceiling
// and validating the `boot({ memory })` knob. The end-to-end "does
// the guest actually see N MiB?" check lives in the smoke suite —
// this file just covers the policy + validation logic.

import { describe, expect, it } from "vitest";
import { _internal, autoSizeMemoryMib, BootError } from "../index.ts";

const { validateMemoryMib } = _internal;

describe("autoSizeMemoryMib", () => {
  it("uses a modest 4 GiB ceiling for normal desktops", () => {
    // This is a guest RAM ceiling, not current host memory use. Do not
    // scale it up just because the developer has a large machine.
    expect(autoSizeMemoryMib(32 * 1024 * 1024 * 1024)).toBe(4096);
    expect(autoSizeMemoryMib(16 * 1024 * 1024 * 1024)).toBe(4096);
    expect(autoSizeMemoryMib(8 * 1024 * 1024 * 1024)).toBe(4096);
  });

  it("uses half the host on smaller machines", () => {
    expect(autoSizeMemoryMib(6 * 1024 * 1024 * 1024)).toBe(3072);
    expect(autoSizeMemoryMib(4 * 1024 * 1024 * 1024)).toBe(2048);
  });

  it("stays capped at 4 GiB even on huge hosts", () => {
    expect(autoSizeMemoryMib(256 * 1024 * 1024 * 1024)).toBe(4096);
    expect(autoSizeMemoryMib(1024 * 1024 * 1024 * 1024)).toBe(4096);
  });

  it("respects the 512 MiB floor on tiny hosts", () => {
    // A 512 MiB host (CI runner, container) gets the floor instead
    // of 256 MiB — boot_*.zig's 16 MiB assert would still pass, but
    // 256 MiB leaves no room for Debian + a workload.
    expect(autoSizeMemoryMib(512 * 1024 * 1024)).toBe(512);
    expect(autoSizeMemoryMib(256 * 1024 * 1024)).toBe(512);
    expect(autoSizeMemoryMib(0)).toBe(512);
  });
});

describe("validateMemoryMib", () => {
  it("accepts integers at or above the 512 MiB floor", () => {
    expect(validateMemoryMib(512)).toBe(512);
    expect(validateMemoryMib(1024)).toBe(1024);
    expect(validateMemoryMib(32768)).toBe(32768);
  });

  it("rejects negative values", () => {
    expect(() => validateMemoryMib(-1)).toThrow(BootError);
    try {
      validateMemoryMib(-1);
    } catch (err) {
      expect((err as BootError).code).toBe("BOOT_MEMORY_INVALID");
    }
  });

  it("rejects zero", () => {
    expect(() => validateMemoryMib(0)).toThrow(BootError);
  });

  it("rejects non-integers", () => {
    expect(() => validateMemoryMib(512.5)).toThrow(BootError);
    expect(() => validateMemoryMib(NaN)).toThrow(BootError);
    expect(() => validateMemoryMib(Infinity)).toThrow(BootError);
  });

  it("rejects below the 512 MiB floor", () => {
    expect(() => validateMemoryMib(64)).toThrow(BootError);
    expect(() => validateMemoryMib(511)).toThrow(BootError);
  });
});
