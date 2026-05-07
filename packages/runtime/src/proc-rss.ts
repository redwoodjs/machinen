// Read the resident-set size of a host pid, in bytes (#274).
//
// Linux  → /proc/<pid>/status:VmRSS (kB; multiply by 1024).
// Darwin → `ps -o rss= -p <pid>` (KiB on darwin, multiply by 1024).
// other  → null (we don't measure on platforms machinen doesn't ship for).
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

/** RSS bytes for one pid, or null if not readable. */
export function readHostRssBytes(pid: number): number | null {
  if (osPlatform() === "linux") {
    return readVmRssLinux(pid);
  }
  if (osPlatform() === "darwin") {
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
export function readHostRssBytesMulti(pids: readonly number[]): Map<number, number> {
  if (pids.length === 0) {
    return new Map();
  }
  if (osPlatform() === "linux") {
    const out = new Map<number, number>();
    for (const pid of pids) {
      const v = readVmRssLinux(pid);
      if (v !== null) {
        out.set(pid, v);
      }
    }
    return out;
  }
  if (osPlatform() === "darwin") {
    return readPsRssDarwin(pids);
  }
  return new Map();
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
