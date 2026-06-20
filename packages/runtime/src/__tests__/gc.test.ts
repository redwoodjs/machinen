// `runGc` + `validatePid` (issue #150 phase 2 PR2). The unit tests
// don't boot a VMM — they fabricate registry entries on disk and
// drive `runGc` against a scratch root. The end-to-end "stop a
// detached VM and prove its files are gone" lives in the smoke
// suite.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runGc, validatePid } from "../index.ts";
import { listAll, type RegistryEntry } from "../registry.ts";

let helperTmp: string | undefined;
let previousHelper: string | undefined;

beforeAll(() => {
  helperTmp = mkdtempSync(join(tmpdir(), "machinen-runtime-helper-test-"));
  execFileSync("zig", ["build", "--prefix", helperTmp], {
    cwd: join(process.cwd(), "packages", "runtime/native"),
    stdio: "pipe",
  });
  previousHelper = process.env.MACHINEN_RUNTIME_HELPER;
  process.env.MACHINEN_RUNTIME_HELPER = join(helperTmp, "bin", "machinen-runtime-helper");
});

afterAll(() => {
  if (previousHelper === undefined) {
    delete process.env.MACHINEN_RUNTIME_HELPER;
  } else {
    process.env.MACHINEN_RUNTIME_HELPER = previousHelper;
  }
  if (helperTmp) {
    rmSync(helperTmp, { recursive: true, force: true });
  }
});

function makeEntry(root: string, e: RegistryEntry): void {
  const dir = join(root, String(e.pid));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify(e));
  if (e.name) {
    const namesDir = join(root, "names");
    mkdirSync(namesDir, { recursive: true });
    writeFileSync(join(namesDir, e.name), String(e.pid));
  }
}

describe("validatePid", () => {
  it("returns 'dead' for a pid that's gone", () => {
    // 999999 is well outside the typical pid space + nothing's
    // listening on it on a dev box; close enough to a guaranteed-
    // dead pid for the purpose of this assertion.
    expect(validatePid(999_999, {})).toBe("dead");
  });

  it("returns 'dead' for invalid pids", () => {
    expect(validatePid(0, {})).toBe("dead");
    expect(validatePid(-1, {})).toBe("dead");
    expect(validatePid(1.5, {})).toBe("dead");
  });

  it("returns 'alive' for our own pid with no expectations", () => {
    expect(validatePid(process.pid, {})).toBe("alive");
  });

  it("returns 'recycled' when exe basename doesn't match", () => {
    // `node` is what Vitest runs the worker as; expecting
    // "totally-other-binary" forces a mismatch.
    expect(validatePid(process.pid, { vmmExe: "/nope/totally-other-binary" })).toBe("recycled");
  });

  it("returns 'recycled' when startedAt is far outside skew", () => {
    // 1h in the past — well outside the 5s skew tolerance.
    const longAgo = Date.now() - 60 * 60 * 1000;
    expect(validatePid(process.pid, { startedAt: longAgo })).toBe("recycled");
  });
});

describe("runGc", () => {
  let root: string;
  let prevRoot: string | undefined;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "machinen-gc-test-"));
    prevRoot = process.env.MACHINEN_REGISTRY_DIR;
    process.env.MACHINEN_REGISTRY_DIR = root;
  });
  afterEach(() => {
    if (prevRoot === undefined) {
      delete process.env.MACHINEN_REGISTRY_DIR;
    } else {
      process.env.MACHINEN_REGISTRY_DIR = prevRoot;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("does nothing on an empty registry", () => {
    expect(runGc()).toEqual([]);
  });

  it("leaves alive entries alone", () => {
    makeEntry(root, {
      pid: process.pid,
      socketPath: join(root, "sock"),
      startedAt: Date.now(),
    });
    expect(runGc()).toEqual([]);
    expect(listAll().length).toBe(1);
  });

  it("reaps a dead-pid entry and rms its cleanupPaths", () => {
    // Real layout: per-boot disks in tmpdir, boot snapshot in
    // ~/.machinen/logs — separate trees. Mirror that here so the
    // recursive rm of one doesn't accidentally hit the other.
    const perBootDir = mkdtempSync(join(tmpdir(), "machinen-gc-disks-"));
    const perBootFile = join(perBootDir, "perboot.img");
    writeFileSync(perBootFile, "x");
    const logDir = mkdtempSync(join(tmpdir(), "machinen-gc-logs-"));
    const bootLog = join(logDir, "999999.boot.log");
    writeFileSync(bootLog, "boot console");
    makeEntry(root, {
      pid: 999_999,
      socketPath: "/nope",
      cleanupPaths: [perBootFile, perBootDir],
      bootLogPath: bootLog,
      startedAt: Date.now(),
    });
    try {
      const results = runGc();
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("dead");
      expect(results[0]!.removedPaths.sort()).toEqual([bootLog, perBootDir, perBootFile].sort());
      expect(existsSync(perBootFile)).toBe(false);
      expect(existsSync(perBootDir)).toBe(false);
      expect(existsSync(bootLog)).toBe(false);
      expect(listAll()).toEqual([]);
    } finally {
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  it("dry-run reports without touching disk or registry", () => {
    const scratchDir = mkdtempSync(join(tmpdir(), "machinen-gc-dry-"));
    const scratchFile = join(scratchDir, "perboot.img");
    writeFileSync(scratchFile, "x");
    makeEntry(root, {
      pid: 999_998,
      socketPath: "/nope",
      cleanupPaths: [scratchFile],
      startedAt: Date.now(),
    });
    const results = runGc({ dryRun: true });
    expect(results).toHaveLength(1);
    expect(results[0]!.removedPaths).toEqual([scratchFile]);
    expect(existsSync(scratchFile)).toBe(true);
    expect(listAll()).toHaveLength(1);
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it("filters by pid when opts.pid is set", () => {
    makeEntry(root, { pid: 999_001, socketPath: "/a", startedAt: Date.now() });
    makeEntry(root, { pid: 999_002, socketPath: "/b", startedAt: Date.now() });
    const results = runGc({ pid: 999_001 });
    expect(results).toHaveLength(1);
    expect(results[0]!.pid).toBe(999_001);
    expect(
      listAll()
        .map((e) => e.pid)
        .sort(),
    ).toEqual([999_002]);
  });

  it("treats recycled pids the same as dead (rms cleanupPaths)", async () => {
    // Spawn a short-lived `sleep` and use *its* pid. validatePid
    // sees the process is alive but exe doesn't match the recorded
    // VMM exe → "recycled" → reap.
    const child = spawn("sleep", ["10"], { detached: true, stdio: "ignore" });
    child.unref();
    try {
      // Ensure the child actually exists before we depend on its pid.
      execFileSync("kill", ["-0", String(child.pid)]);
      const scratch = mkdtempSync(join(tmpdir(), "machinen-gc-recycled-"));
      makeEntry(root, {
        pid: child.pid!,
        socketPath: "/nope",
        cleanupPaths: [scratch],
        // Mismatched exe + ancient startedAt — both signal recycled.
        vmmExe: "/usr/local/bin/machinen-vm-fake",
        startedAt: Date.now() - 60 * 60 * 1000,
      });
      const results = runGc();
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("recycled");
      expect(existsSync(scratch)).toBe(false);
    } finally {
      try {
        process.kill(child.pid!, "SIGKILL");
      } catch {}
    }
  });
});
