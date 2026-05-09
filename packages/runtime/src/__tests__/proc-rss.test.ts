// Smoke coverage for the host-RSS readers used by `vm.memoryStats()`
// and the `machinen ls` MEM column (#274). The OS-side regex / ps
// parsers can't be deterministically mocked without spinning up a
// real process — so the no-statsPath tests just verify that, against
// the running test process itself, the readers return a sensible
// positive number. The statsPath-aware tests pretend to be the VMM
// sampler thread by writing the same wire format into a tmpfile.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STATS_FILE_SIZE } from "../balloon-stats.ts";
import { readHostRssBytes, readHostRssBytesMulti } from "../proc-rss.ts";

describe("readHostRssBytes", () => {
  it("returns a positive number for the running process", () => {
    const rss = readHostRssBytes(process.pid);
    expect(rss).not.toBeNull();
    expect(rss!).toBeGreaterThan(0);
  });

  it("returns null for a pid that's almost certainly dead", () => {
    // 0x7fff_ffff — outside the kernel's pid_max on every Unix.
    expect(readHostRssBytes(0x7fff_ffff)).toBeNull();
  });
});

describe("readHostRssBytesMulti", () => {
  it("returns a map keyed by pid for the live processes it could read", () => {
    const map = readHostRssBytesMulti([process.pid, 0x7fff_ffff]);
    expect(map.get(process.pid)).toBeGreaterThan(0);
    expect(map.has(0x7fff_ffff)).toBe(false);
  });

  it("accepts the {pid, statsPath} target shape too", () => {
    const map = readHostRssBytesMulti([{ pid: process.pid }]);
    expect(map.get(process.pid)).toBeGreaterThan(0);
  });

  it("returns an empty map for an empty input (no syscall)", () => {
    expect(readHostRssBytesMulti([]).size).toBe(0);
  });
});

describe("readHostRssBytes with statsPath (Darwin phys_footprint path)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "proc-rss-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prefers the stats-file phys_footprint when non-zero on Darwin", () => {
    if (process.platform !== "darwin") {
      return;
    }
    const statsPath = join(dir, "stats.bin");
    const buf = Buffer.alloc(STATS_FILE_SIZE);
    // Pretend the sampler thread wrote a phys_footprint of 12345678.
    buf.writeBigUInt64LE(12_345_678n, 16);
    writeFileSync(statsPath, buf);
    expect(readHostRssBytes(process.pid, statsPath)).toBe(12_345_678);
  });

  it("falls back to ps when the stats file phys_footprint is still 0", () => {
    if (process.platform !== "darwin") {
      return;
    }
    const statsPath = join(dir, "stats.bin");
    // All-zero stats file (sampler hasn't written its first reading).
    writeFileSync(statsPath, Buffer.alloc(STATS_FILE_SIZE));
    const rss = readHostRssBytes(process.pid, statsPath);
    expect(rss).not.toBeNull();
    expect(rss!).toBeGreaterThan(0);
  });

  it("falls back to ps when the stats file is missing", () => {
    if (process.platform !== "darwin") {
      return;
    }
    const rss = readHostRssBytes(process.pid, join(dir, "missing.bin"));
    expect(rss).not.toBeNull();
    expect(rss!).toBeGreaterThan(0);
  });
});
