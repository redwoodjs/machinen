// Detached-boot v1 (issue #150 phase 2). Covers:
//   - boot-console snapshot writer (writeBootSnapshot + path layout)
//   - regression guard against re-introducing the helper-compat gate.
//     portForward, liveMounts (in-VMM virtio-fs), and `mount`
//     (squashfs+ext4) all hold no live supervisor state after readiness.
//     Live mounts, including batch sync, remain detach-compatible — assert
//     boot() doesn't refuse them.
//
// The end-to-end "boot --detached, parent exits, VMM keeps running"
// flow needs the real VMM binary and lives in the smoke suite —
// keeping it out of the unit tests so this file stays fast.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot, isMachinenError } from "../index.ts";
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

describe("boot({ detached }) accepts live-mount options", () => {
  // Regression guard. Each boot() call resolves to a BootError because
  // the image path is fake — the assertion is only that the failure is
  // some downstream BootError, never a compat-gate refusal. Runs before
  // any VMM spawn, so no fixtures needed.

  it("does NOT reject --mount (squashfs+ext4 is fd-passed at spawn)", async () => {
    const err = await boot({
      detached: true,
      image: "/tmp/does-not-exist.tar.gz",
      mount: { host: "/tmp", guest: "/mnt/in" },
    }).catch((e) => e);
    expect(isMachinenError(err)).toBe(true);
    expect((err as { code: string }).code).not.toMatch(/INCOMPATIBLE/);
  });

  it("does NOT reject liveMounts (in-VMM virtio-fs)", async () => {
    const err = await boot({
      detached: true,
      image: "/tmp/does-not-exist.tar.gz",
      liveMounts: [{ host: "/tmp", guest: "/mnt/live" }],
    }).catch((e) => e);
    expect(isMachinenError(err)).toBe(true);
    expect((err as { code: string }).code).not.toMatch(/INCOMPATIBLE/);
  });

  it("does NOT reject batch liveMounts with detach", async () => {
    const err = await boot({
      detached: true,
      image: "/tmp/does-not-exist.tar.gz",
      liveMounts: [{ host: "/tmp", guest: "/mnt/live", sync: "batch" }],
    }).catch((e) => e);
    expect(isMachinenError(err)).toBe(true);
    expect((err as { code: string }).code).not.toBe("BOOT_MOUNT_INVALID");
  });
});
