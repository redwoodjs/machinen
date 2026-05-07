// Read the shared host↔VMM stats file the balloon backend writes to
// (#274). The VMM creates a 16-byte file at the path passed in via
// `MACHINEN_STATS_FILE`, mmaps it MAP_SHARED, and atomically updates
// two u64 LE counters on every reporting / inflate chain. The host
// reads those bytes via plain `readFileSync` — the OS's page cache
// already gives us a coherent view of the mmap'd region.
//
// Wire layout (must match `packages/microvm/src/stats.zig`):
//   offset 0:  u64 LE  bytes_reported   (free-page-reporting reclaim)
//   offset 8:  u64 LE  bytes_inflated   (inflate-queue, usually 0)
//
// The struct is `extern struct` on the Zig side, so layout is stable
// across compiler revisions; bumping it requires updating both files
// together.

import { readFileSync } from "node:fs";

export const STATS_FILE_SIZE = 16;

export interface BalloonCounters {
  /** Total bytes the balloon device has reclaimed via reporting. */
  bytesReported: number;
  /**
   * Total bytes the inflate queue has seen. We don't drive inflate
   * (`num_pages` stays 0), so this stays at 0 in well-behaved
   * deployments — non-zero means a buggy/hostile guest is pushing
   * pages into the balloon on its own.
   */
  bytesInflated: number;
}

/**
 * Read the balloon-stats file at `path`. Returns `null` when:
 *   - the file is missing (VMM was launched without
 *     `MACHINEN_STATS_FILE`, or the path is stale),
 *   - it's shorter than `STATS_FILE_SIZE` (truncated mid-write — not
 *     possible with the mmap'd writer, but defensive against an
 *     out-of-band actor),
 *   - it's unreadable (permissions, gone between stat and read).
 */
export function readBalloonStats(path: string): BalloonCounters | null {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  if (buf.length < STATS_FILE_SIZE) {
    return null;
  }
  return {
    bytesReported: Number(buf.readBigUInt64LE(0)),
    bytesInflated: Number(buf.readBigUInt64LE(8)),
  };
}
