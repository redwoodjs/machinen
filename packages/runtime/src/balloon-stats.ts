// Read the shared host↔VMM stats file the balloon backend writes to
// (#274). The VMM creates a 24-byte file at the path passed in via
// `MACHINEN_STATS_FILE`, mmaps it MAP_SHARED, and atomically updates
// three u64 LE counters: two from the balloon handler (reported /
// inflated bytes) and one from a Darwin-only sampler thread that
// polls this VMM's `phys_footprint`. The native runtime helper reads
// the same layout so the host-side wire parsing stays in native code.
//
// Wire layout (must match `packages/microvm/src/stats.zig`):
//   offset  0:  u64 LE  bytesReported           (free-page-reporting reclaim)
//   offset  8:  u64 LE  bytesInflated           (inflate-queue, usually 0)
//   offset 16:  u64 LE  hostPhysFootprintBytes  (Darwin-only; 0 on Linux)
//
// The struct is `extern struct` on the Zig side, so layout is stable
// across compiler revisions; bumping it requires updating both files
// together.

import { readBalloonStatsNative } from "./native/balloon-stats.ts";

export const STATS_FILE_SIZE = 24;

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
  /**
   * Latest sample of this VMM's Darwin `phys_footprint` (the metric
   * that backs Activity Monitor's "Memory" column and excludes
   * `MADV_FREE_REUSABLE` pages). Refreshed every ~500 ms by a
   * sampler thread inside the VMM. Always 0 on Linux — there's no
   * Darwin-equivalent metric and the runtime reads
   * `/proc/<pid>/status:VmRSS` instead, which already reflects
   * `MADV_DONTNEED` reclaim.
   */
  hostPhysFootprintBytes: number;
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
  return readBalloonStatsNative(path);
}
