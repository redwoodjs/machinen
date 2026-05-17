// Read the resident-set size of a host pid, in bytes (#274).
//
// Linux  → /proc/<pid>/status:VmRSS (kB; multiply by 1024).
// Darwin → the VMM's own `phys_footprint` sample, written into the
//          MACHINEN_STATS_FILE every ~500 ms by a sampler thread
//          (see `packages/microvm/src/stats.zig`). Falls back to
//          `ps -o rss=` when no statsPath is supplied (e.g. for an
//          arbitrary host pid that isn't a machinen VMM) or when the
//          stats file is missing / hasn't been initialised yet.
// other  → null (we don't measure on platforms machinen doesn't ship for).
//
// Why prefer phys_footprint on Darwin: after balloon reclaim the VMM
// calls `madvise(MADV_FREE_REUSABLE)`. Reusable pages stay counted
// in `task_basic_info.resident_size` (what `ps -o rss=` reads) until
// the kernel actually reclaims them under memory pressure, but they
// are excluded from `phys_footprint` immediately. So `ps rss` makes
// reclaim look broken even when it's working; `phys_footprint`
// (Activity Monitor's "Memory" column) shows the truth.
//
// Synchronous because callers — `machinen ls` and `vm.memoryStats()` —
// fetch the number once, at the moment they need it. There's no
// daemon, no caching: a stale RSS would be worse than a fresh one a
// few ms later.
//
// Returns `null` (not 0) when the read fails so the caller can tell
// "VMM is gone / unreadable" apart from "VMM is alive but using zero
// pages" (which never happens in practice but is the natural floor).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { platform as osPlatform } from "node:os";
import { readBalloonStats } from "./balloon-stats.ts";

/** A pid plus the absolute path to its stats file (when available). */
export interface RssTarget {
  pid: number;
  /**
   * MACHINEN_STATS_FILE path for this VMM (registry entry's
   * `statsPath`). On Darwin we read `phys_footprint` from this file
   * in preference to `ps -o rss=`. Optional / undefined for arbitrary
   * pids that aren't machinen-managed; those fall back to ps.
   */
  statsPath?: string;
}

/** RSS bytes for one pid, or null if not readable. */
export function readHostRssBytes(pid: number, statsPath?: string): number | null {
  if (osPlatform() === "linux") {
    return readVmRssLinux(pid);
  }
  if (osPlatform() === "darwin") {
    const fromStats = readPhysFootprintFromStats(statsPath);
    if (fromStats !== null) {
      return fromStats;
    }
    return readPsRssDarwin([pid]).get(pid) ?? null;
  }
  return null;
}

/**
 * Bulk variant for `machinen ls`: one syscall (Linux) or one
 * subprocess (Darwin) for every live VM, instead of N. Pids that
 * can't be read are simply absent from the result map — caller
 * decides whether to render "?" or skip the row.
 */
export function readHostRssBytesMulti(
  targets: ReadonlyArray<RssTarget | number>,
): Map<number, number> {
  const normalised = normaliseRssTargets(targets);
  if (normalised.length === 0) {
    return new Map<number, number>();
  }
  if (osPlatform() === "linux") {
    return readHostRssBytesLinuxMulti(normalised);
  }
  if (osPlatform() === "darwin") {
    return readHostRssBytesDarwinMulti(normalised);
  }
  return new Map<number, number>();
}

function normaliseRssTargets(targets: ReadonlyArray<RssTarget | number>): RssTarget[] {
  return targets.map((target) => (typeof target === "number" ? { pid: target } : target));
}

function readHostRssBytesLinuxMulti(targets: RssTarget[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const { pid } of targets) {
    const value = readVmRssLinux(pid);
    if (value !== null) {
      out.set(pid, value);
    }
  }
  return out;
}

function readHostRssBytesDarwinMulti(targets: RssTarget[]): Map<number, number> {
  // Per-VM phys_footprint from the stats file is free (one
  // readFileSync per VM, ~µs). Anything that doesn't have a
  // statsPath, or whose stats file hasn't been written to yet,
  // falls through to a single bulk `ps` call.
  const out = new Map<number, number>();
  const fallbackPids = collectDarwinRssFromStats(targets, out);
  appendDarwinPsFallback(out, fallbackPids);
  return out;
}

function collectDarwinRssFromStats(targets: RssTarget[], out: Map<number, number>): number[] {
  const fallbackPids: number[] = [];
  for (const { pid, statsPath } of targets) {
    const fromStats = readPhysFootprintFromStats(statsPath);
    if (fromStats !== null) {
      out.set(pid, fromStats);
    } else {
      fallbackPids.push(pid);
    }
  }
  return fallbackPids;
}

function appendDarwinPsFallback(out: Map<number, number>, fallbackPids: number[]): void {
  if (fallbackPids.length === 0) {
    return;
  }
  for (const [pid, rss] of readPsRssDarwin(fallbackPids)) {
    out.set(pid, rss);
  }
}

function readVmRssLinux(pid: number): number | null {
  try {
    const text = readFileSync(`/proc/${pid}/status`, "utf8");
    const m = /^VmRSS:\s+(\d+)\s+kB$/m.exec(text);
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

/**
 * Read `phys_footprint` from a VMM's stats file. Returns null when
 * no path was supplied, the file is missing/short, or the sampler
 * hasn't written its first reading yet (counter still 0).
 */
function readPhysFootprintFromStats(statsPath: string | undefined): number | null {
  if (!statsPath) {
    return null;
  }
  const stats = readBalloonStats(statsPath);
  if (!stats || stats.hostPhysFootprintBytes === 0) {
    return null;
  }
  return stats.hostPhysFootprintBytes;
}

function readPsRssDarwin(pids: readonly number[]): Map<number, number> {
  const out = new Map<number, number>();
  // Pre-filter out dead / out-of-range pids: macOS `ps` errors out the
  // whole call when *any* argument fails its validation (e.g. a pid
  // larger than the kernel's MAXPID). `kill(pid, 0)` is a permission-
  // less liveness probe.
  const live: number[] = [];
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      live.push(pid);
    } catch {
      // Dead, recycled, or out of range — leave it out of the call.
    }
  }
  if (live.length === 0) {
    return out;
  }
  let stdout: string;
  try {
    stdout = execFileSync("/bin/ps", ["-o", "pid=,rss=", "-p", live.join(",")], {
      encoding: "utf8",
      timeout: 1_000,
    });
  } catch {
    return out;
  }
  for (const line of stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!m) {
      continue;
    }
    const rss = Number(m[2]);
    if (Number.isFinite(rss) && rss > 0) {
      out.set(Number(m[1]), rss * 1024);
    }
  }
  return out;
}
