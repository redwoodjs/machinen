// Detached-boot v1 (issue #150 phase 2). Covers:
//   - boot-console snapshot writer (writeBootSnapshot + path layout)
//   - the runtime's BOOT_DETACHED_INCOMPATIBLE gate against helpers
//     that only live in the JS supervisor (mount, liveMounts,
//     portForward).
//
// The end-to-end "boot --detached, parent exits, VMM keeps running"
// flow needs the real VMM binary and lives in the smoke suite —
// keeping it out of the unit tests so this file stays fast.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot, BootError, isMachinenError } from "../index.ts";
import { bootSnapshotPath, writeBootSnapshot, detachedLogRoot } from "../detached-log.ts";

describe("detached-log helpers", () => {
  let tmp: string;
  let prevDir: string | undefined;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "machinen-detached-log-"));
    prevDir = process.env.MACHINEN_DETACHED_LOG_DIR;
    process.env.MACHINEN_DETACHED_LOG_DIR = tmp;
  });
  afterEach(() => {
    if (prevDir === undefined) {
      delete process.env.MACHINEN_DETACHED_LOG_DIR;
    } else {
      process.env.MACHINEN_DETACHED_LOG_DIR = prevDir;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("derives <root>/<pid>.boot.log from the env-overridable root", () => {
    expect(detachedLogRoot()).toBe(tmp);
    expect(bootSnapshotPath(4321)).toBe(join(tmp, "4321.boot.log"));
  });

  it("writes the snapshot atomically and returns true", () => {
    const path = bootSnapshotPath(99);
    const ok = writeBootSnapshot(path, "boot console bytes\n");
    expect(ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("boot console bytes\n");
  });

  it("creates parent dirs on demand", () => {
    process.env.MACHINEN_DETACHED_LOG_DIR = join(tmp, "nested", "deep");
    const path = bootSnapshotPath(1);
    expect(writeBootSnapshot(path, "x")).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("x");
  });

  it("returns false when the path can't be written (best-effort)", () => {
    // /dev/null/foo is guaranteed-unwritable on every Unix the
    // runtime targets — `mkdir -p /dev/null/...` and `open(..., O_WRONLY)`
    // both fail with ENOTDIR.
    expect(writeBootSnapshot("/dev/null/never/here.log", "x")).toBe(false);
  });
});

describe("boot({ detached }) compatibility gate", () => {
  // The gate runs before any VMM resolution / spawn, so these tests
  // need no fixtures and stay pure-JS-fast.

  it("rejects --mount with a clear BOOT_DETACHED_INCOMPATIBLE", async () => {
    const err = await boot({
      detached: true,
      image: "/tmp/does-not-exist.tar.gz",
      mount: { host: "/tmp", guest: "/mnt/in" },
    }).catch((e) => e);
    expect(isMachinenError(err, "BOOT_DETACHED_INCOMPATIBLE")).toBe(true);
    expect(err).toBeInstanceOf(BootError);
    expect(err.message).toContain("mount");
  });

  it("rejects --mount-live", async () => {
    const err = await boot({
      detached: true,
      image: "/tmp/does-not-exist.tar.gz",
      liveMounts: [{ host: "/tmp", guest: "/mnt/live" }],
    }).catch((e) => e);
    expect(isMachinenError(err, "BOOT_DETACHED_INCOMPATIBLE")).toBe(true);
    expect(err.message).toContain("liveMounts");
  });

  it("rejects --portForward", async () => {
    const err = await boot({
      detached: true,
      image: "/tmp/does-not-exist.tar.gz",
      portForward: [{ hostPort: 8080, guestPort: 80 }],
    }).catch((e) => e);
    expect(isMachinenError(err, "BOOT_DETACHED_INCOMPATIBLE")).toBe(true);
    expect(err.message).toContain("portForward");
  });

  it("lists every incompatible option in one error", async () => {
    const err = await boot({
      detached: true,
      image: "/tmp/does-not-exist.tar.gz",
      mount: { host: "/tmp", guest: "/mnt/in" },
      liveMounts: [{ host: "/tmp", guest: "/mnt/live" }],
      portForward: [{ hostPort: 8080, guestPort: 80 }],
    }).catch((e) => e);
    expect(isMachinenError(err, "BOOT_DETACHED_INCOMPATIBLE")).toBe(true);
    expect(err.message).toContain("mount");
    expect(err.message).toContain("liveMounts");
    expect(err.message).toContain("portForward");
  });
});
