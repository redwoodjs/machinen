// Round-trip coverage for the host↔VMM stats wire format (#274).
// The Zig writer (packages/microvm/src/stats.zig) writes two u64 LE
// counters into a 16-byte file; the host reader walks the same bytes.
// This test pretends to be the Zig writer.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBalloonStats, STATS_FILE_SIZE } from "../balloon-stats.ts";

describe("readBalloonStats", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "balloon-stats-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("decodes both counters from a 16-byte little-endian file", () => {
    const path = join(dir, "stats.bin");
    const buf = Buffer.alloc(STATS_FILE_SIZE);
    buf.writeBigUInt64LE(0x1122_3344_5566_7788n, 0);
    buf.writeBigUInt64LE(0x99aa_bbcc_ddee_ff00n, 8);
    writeFileSync(path, buf);
    expect(readBalloonStats(path)).toEqual({
      bytesReported: Number(0x1122_3344_5566_7788n),
      bytesInflated: Number(0x99aa_bbcc_ddee_ff00n),
    });
  });

  it("decodes the all-zero initial state", () => {
    const path = join(dir, "stats.bin");
    writeFileSync(path, Buffer.alloc(STATS_FILE_SIZE));
    expect(readBalloonStats(path)).toEqual({
      bytesReported: 0,
      bytesInflated: 0,
    });
  });

  it("returns null when the file is missing", () => {
    expect(readBalloonStats(join(dir, "nope.bin"))).toBeNull();
  });

  it("returns null when the file is shorter than the header", () => {
    const path = join(dir, "short.bin");
    writeFileSync(path, Buffer.alloc(STATS_FILE_SIZE - 1));
    expect(readBalloonStats(path)).toBeNull();
  });

  it("ignores trailing bytes past the documented header", () => {
    // Forward-compat: a future schema bump may extend the file. The
    // reader must not error on a longer file — it just reads the
    // first 16 bytes.
    const path = join(dir, "long.bin");
    const buf = Buffer.alloc(STATS_FILE_SIZE + 32);
    buf.writeBigUInt64LE(4096n, 0);
    buf.writeBigUInt64LE(0n, 8);
    writeFileSync(path, buf);
    expect(readBalloonStats(path)).toEqual({
      bytesReported: 4096,
      bytesInflated: 0,
    });
  });
});
