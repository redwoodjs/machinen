// Anti-recycling check for `machinen gc` / `machinen stop`.
//
// `kill(pid, 0)` only tells us "some process with this pid exists" —
// the kernel happily recycles pids, so a long-dead VMM's pid can land
// on an unrelated process. If gc trusts kill(0) alone, two things go
// wrong: it leaves cleanupPaths around for the recycled-pid entry,
// and `machinen stop <name>` ends up SIGTERM-ing whatever happened to
// inherit that pid.
//
// The fix is to also confirm the process *is the original VMM*:
//   - exe path matches the recorded `entry.vmmExe`, and
//   - process start time is within a small skew of `entry.startedAt`.
//
// Linux: `/proc/<pid>/exe` is a symlink to the on-disk exe; readlink
// is rock-solid. `/proc/<pid>/stat` field 22 (starttime in clock
// ticks since boot) gives the start time we cross-check.
//
// macOS: no /proc. `ps -o comm=,lstart= -p <pid>` is the portable
// answer; comm is the basename, lstart is a wall-clock human-readable
// timestamp. Comparing basenames means we miss exe-replacement
// attacks, but the threat model here is pid recycling on a
// development laptop — comm + lstart-within-skew is enough.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { platform } from "node:os";
import { basename } from "node:path";

/**
 * Skew tolerance for start-time comparison. macOS `ps` only gives us
 * second-level resolution and the registry records ms; allow a few
 * seconds either way to absorb both. Smaller would be tighter but
 * would false-positive on slow boots where Date.now() (in JS, after
 * spawn) and ps's start time (in the kernel, before exec) differ by
 * a noticeable amount.
 */
const STARTTIME_SKEW_MS = 5_000;

/** Result of `validatePid` — easy to switch on at the call site. */
export type PidStatus = "alive" | "dead" | "recycled";

/**
 * Return whether the running process at `pid` is still our VMM.
 *
 * - `alive`     — pid is alive AND the exe + start-time match.
 * - `dead`      — kill(pid, 0) failed (gone or permission-denied,
 *                 either way unreachable).
 * - `recycled`  — pid is alive but the process isn't ours (different
 *                 exe, or start time outside skew).
 *
 * Falls back to `alive` when the recorded entry lacks `vmmExe` /
 * `startedAt` (older entries from before PR2). Conservative on
 * purpose: the gc decision then leans on `kill(pid, 0)` alone, same
 * behaviour we had before.
 */
export function validatePid(
  pid: number,
  expected: { vmmExe?: string; startedAt?: number },
): PidStatus {
  if (!Number.isInteger(pid) || pid <= 0) {
    return "dead";
  }
  try {
    process.kill(pid, 0);
  } catch {
    return "dead";
  }
  // No way to distinguish — be conservative.
  if (!expected.vmmExe && expected.startedAt === undefined) {
    return "alive";
  }
  const observed = readProcessIdentity(pid);
  if (!observed) {
    // Couldn't read /proc or ps; don't lie that it's recycled — fall
    // back to the kill(0) result.
    return "alive";
  }
  if (expected.vmmExe) {
    const expectedBase = basename(expected.vmmExe);
    if (observed.exeBase !== expectedBase) {
      return "recycled";
    }
  }
  if (expected.startedAt !== undefined && observed.startedAtMs !== undefined) {
    if (Math.abs(observed.startedAtMs - expected.startedAt) > STARTTIME_SKEW_MS) {
      return "recycled";
    }
  }
  return "alive";
}

interface ProcessIdentity {
  exeBase: string;
  startedAtMs?: number;
}

function readProcessIdentity(pid: number): ProcessIdentity | undefined {
  if (platform() === "linux") {
    return readLinuxIdentity(pid);
  }
  return readPsIdentity(pid);
}

function readLinuxIdentity(pid: number): ProcessIdentity | undefined {
  let exeBase: string;
  try {
    exeBase = basename(readlinkSync(`/proc/${pid}/exe`));
  } catch {
    return undefined;
  }
  // /proc/<pid>/stat layout: pid (comm) state … starttime[22] (in
  // clock ticks since boot). The comm field is parens-wrapped and
  // can contain spaces, so split on the *last* `)` to skip it.
  let startedAtMs: number | undefined;
  try {
    if (existsSync(`/proc/${pid}/stat`)) {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const lastParen = stat.lastIndexOf(")");
      if (lastParen !== -1) {
        const fields = stat.slice(lastParen + 2).split(" ");
        // After the comm field, indices restart from 0 (state).
        // starttime is the original field 22 → index 22 - 3 = 19.
        const ticksRaw = fields[19];
        const ticks = Number(ticksRaw);
        const btime = readBootTimeSeconds();
        if (Number.isFinite(ticks) && btime !== undefined) {
          // SC_CLK_TCK is 100 on every Linux the runtime targets;
          // not exposed by Node, hard-coded with this assumption.
          startedAtMs = (btime + ticks / 100) * 1000;
        }
      }
    }
  } catch {
    // start-time is best-effort — exe match alone is plenty signal.
  }
  return { exeBase, startedAtMs };
}

function readBootTimeSeconds(): number | undefined {
  try {
    const stat = readFileSync("/proc/stat", "utf8");
    for (const line of stat.split("\n")) {
      if (line.startsWith("btime ")) {
        const v = Number(line.slice(6).trim());
        return Number.isFinite(v) ? v : undefined;
      }
    }
  } catch {}
  return undefined;
}

function readPsIdentity(pid: number): ProcessIdentity | undefined {
  let out: string;
  try {
    out = execFileSync("ps", ["-o", "comm=,lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
  const trimmed = out.trim();
  if (!trimmed) {
    return undefined;
  }
  // Format from `man ps`: comm is one whitespace-separated token; the
  // rest is the lstart wall-clock string ("Sun May  3 07:13:52 2026"),
  // which Date.parse can read directly (the locale-independent
  // ctime-ish format ps uses).
  const m = trimmed.match(/^(\S+)\s+(.+)$/);
  if (!m) {
    return undefined;
  }
  const exeBase = basename(m[1]!);
  const lstartMs = Date.parse(m[2]!);
  return {
    exeBase,
    startedAtMs: Number.isFinite(lstartMs) ? lstartMs : undefined,
  };
}
