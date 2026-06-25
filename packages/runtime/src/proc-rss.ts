// Read the resident-set size of a host pid, in bytes (#274).
//
// Linux  → machinen-runtime-helper reads /proc/<pid>/status:VmRSS.
// Darwin → machinen-runtime-helper prefers the VMM stats file's
//          phys_footprint sample, then falls back to `ps -o rss=`.
// other  → null / absent map entries (unsupported by the native helper).
//
// Synchronous because callers — `machinen ls` and `vm.memoryStats()` —
// fetch the number once, at the moment they need it. There's no
// daemon, no caching: a stale RSS would be worse than a fresh one a
// few ms later.
//
// Returns `null` (not 0) when the read fails so the caller can tell
// "VMM is gone / unreadable" apart from "VMM is alive but using zero
// pages" (which never happens in practice but is the natural floor).

import { hostRssNative } from "./native/host-rss.ts";

/** A pid plus the absolute path to its stats file (when available). */
export interface RssTarget {
  pid: number;
  /**
   * MACHINEN_STATS_FILE path for this VMM (registry entry's
   * `statsPath`). On Darwin the native helper reads `phys_footprint`
   * from this file in preference to `ps -o rss=`. Optional / undefined
   * for arbitrary pids that aren't machinen-managed; those fall back to ps.
   */
  statsPath?: string;
}

/** RSS bytes for one pid, or null if not readable. */
export function readHostRssBytes(pid: number, statsPath?: string): number | null {
  return readHostRssBytesMulti([{ pid, statsPath }]).get(pid) ?? null;
}

/**
 * Bulk variant for `machinen ls`. Pids that can't be read are simply
 * absent from the result map — caller decides whether to render "?" or
 * skip the row.
 */
export function readHostRssBytesMulti(
  targets: ReadonlyArray<RssTarget | number>,
): Map<number, number> {
  const normalised = normaliseRssTargets(targets);
  if (normalised.length === 0) {
    return new Map<number, number>();
  }
  const out = new Map<number, number>();
  for (const { pid, rssBytes } of hostRssNative(normalised)) {
    out.set(pid, rssBytes);
  }
  return out;
}

function normaliseRssTargets(targets: ReadonlyArray<RssTarget | number>): RssTarget[] {
  const out: RssTarget[] = [];
  for (const target of targets) {
    const item = typeof target === "number" ? { pid: target } : target;
    if (isValidPid(item.pid)) {
      out.push(item);
    }
  }
  return out;
}

function isValidPid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0 && pid <= 0xffff_ffff;
}
