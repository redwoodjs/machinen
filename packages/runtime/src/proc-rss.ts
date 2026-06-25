// Host RSS probes for running VMM processes.
//
// Used by `machinen ls` and `vm.memoryStats()` to report how much host memory a
// VMM process is currently holding. This module calls the native runtime helper
// and returns best-effort readings: unreadable/dead pids become `null` or absent
// map entries instead of hard failures.
//
// On Darwin, Machinen prefers the VMM stats file's `phys_footprint` because it
// reflects reclaimed balloon pages better than plain `ps` RSS.

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
