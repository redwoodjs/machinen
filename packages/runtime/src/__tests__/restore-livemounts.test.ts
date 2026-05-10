// Unit tests for #273 — `restore()`'s live-mount override merge logic.
// The full snapshot/restore round-trip is exercised end-to-end in
// scripts/smoke-tests.sh; here we cover the pure-function corners
// (override matching, BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN, legacy bundle
// passthrough) that don't need a running VM to verify.

import { describe, expect, it } from "vitest";
import { resolveRestoreLiveMounts } from "../vm/index.ts";
import { BootError, isMachinenError } from "../errors.ts";

describe("resolveRestoreLiveMounts", () => {
  it("returns undefined for a legacy bundle with no caller overrides", () => {
    expect(resolveRestoreLiveMounts(undefined, undefined)).toBeUndefined();
    expect(resolveRestoreLiveMounts([], undefined)).toBeUndefined();
    expect(resolveRestoreLiveMounts(undefined, [])).toBeUndefined();
  });

  it("forwards opts.liveMounts as-is for legacy bundles (no meta.liveMounts)", () => {
    // Bundles taken before #273 have meta.liveMounts === undefined.
    // Backward-compat: callers can still pass liveMounts to add fresh
    // ones on the restored VM.
    const overrides = [
      { host: "/host/work", guest: "/mnt/work", mode: "rw" as const },
      { host: "/host/data", guest: "/mnt/data", mode: "ro" as const },
    ];
    const result = resolveRestoreLiveMounts(undefined, overrides);
    expect(result).toEqual(overrides);
  });

  it("re-establishes recorded mounts as-is when no overrides are passed", () => {
    const recorded = [
      { guest: "/mnt/work", host: "/Users/alice/work", mode: "rw" as const },
      { guest: "/mnt/cache", host: "/Users/alice/cache", mode: "ro" as const },
    ];
    const result = resolveRestoreLiveMounts(recorded, undefined);
    expect(result).toEqual(recorded);
  });

  it("applies per-guest host override and preserves recorded mode", () => {
    // Cross-host restore: alice's bundle landing on bob's machine.
    // The host path is remapped; the mode falls back to whatever the
    // bundle recorded so the user doesn't have to repeat it.
    const recorded = [{ guest: "/mnt/work", host: "/Users/alice/work", mode: "rw" as const }];
    const overrides = [{ guest: "/mnt/work", host: "/Users/bob/work" }];
    expect(resolveRestoreLiveMounts(recorded, overrides)).toEqual([
      { guest: "/mnt/work", host: "/Users/bob/work", mode: "rw" },
    ]);
  });

  it("override.mode wins over recorded.mode when both are set", () => {
    // Host B wants the same data exposed read-only even though the
    // source had it rw. Override.mode trumps, no merge surprise.
    const recorded = [{ guest: "/mnt/work", host: "/Users/alice/work", mode: "rw" as const }];
    const overrides = [{ guest: "/mnt/work", host: "/Users/bob/work", mode: "ro" as const }];
    expect(resolveRestoreLiveMounts(recorded, overrides)).toEqual([
      { guest: "/mnt/work", host: "/Users/bob/work", mode: "ro" },
    ]);
  });

  it("partial overrides leave non-overridden recorded entries untouched", () => {
    const recorded = [
      { guest: "/mnt/work", host: "/Users/alice/work", mode: "rw" as const },
      { guest: "/mnt/cache", host: "/Users/alice/cache", mode: "ro" as const },
      { guest: "/mnt/notes", host: "/Users/alice/notes", mode: "rw" as const },
    ];
    const overrides = [{ guest: "/mnt/cache", host: "/Users/bob/cache" }];
    expect(resolveRestoreLiveMounts(recorded, overrides)).toEqual([
      { guest: "/mnt/work", host: "/Users/alice/work", mode: "rw" },
      { guest: "/mnt/cache", host: "/Users/bob/cache", mode: "ro" },
      { guest: "/mnt/notes", host: "/Users/alice/notes", mode: "rw" },
    ]);
  });

  it("throws BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN when override.guest doesn't match", () => {
    // Caller tried to add a new mount via opts.liveMounts. Refused —
    // restore() reproduces topology, doesn't extend it. The error
    // message lists the recorded guests so the user can fix the typo.
    const recorded = [{ guest: "/mnt/work", host: "/Users/alice/work", mode: "rw" as const }];
    const overrides = [{ host: "/Users/bob/extra", guest: "/mnt/typo", mode: "rw" as const }];
    let caught: unknown;
    try {
      resolveRestoreLiveMounts(recorded, overrides);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BootError);
    expect(isMachinenError(caught, "BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN")).toBe(true);
    const msg = (caught as Error).message;
    expect(msg).toMatch(/guest=\/mnt\/typo/);
    expect(msg).toMatch(/\/mnt\/work/);
  });

  it("a single bad override aborts before any good ones are applied", () => {
    // Atomicity: don't half-apply. The user gets one error per call,
    // not a state that's been partially mutated under their feet.
    const recorded = [{ guest: "/mnt/work", host: "/Users/alice/work", mode: "rw" as const }];
    const overrides = [
      { guest: "/mnt/work", host: "/Users/bob/work", mode: "rw" as const },
      { guest: "/mnt/typo", host: "/Users/bob/typo", mode: "rw" as const },
    ];
    expect(() => resolveRestoreLiveMounts(recorded, overrides)).toThrow(
      /BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN|\/mnt\/typo/,
    );
  });
});
