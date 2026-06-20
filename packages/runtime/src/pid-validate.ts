// Anti-recycling check for `machinen gc` / `machinen stop`.
//
// `kill(pid, 0)` only tells us "some process with this pid exists" —
// the kernel happily recycles pids, so a long-dead VMM's pid can land
// on an unrelated process. The native runtime helper verifies the pid
// against OS process identity instead: exe basename plus start time
// when the platform can report it.

import { readProcessIdentityNative, validatePidNative } from "./native/pid.ts";

/** Result of `validatePid` — easy to switch on at the call site. */
export type PidStatus = "alive" | "dead" | "recycled";

interface ProcessIdentity {
  exeBase: string;
  startedAtMs?: number;
}

/**
 * Return whether the running process at `pid` is still our VMM.
 *
 * - `alive`     — pid is alive AND the exe + start-time match.
 * - `dead`      — pid is gone or unreachable.
 * - `recycled`  — pid is alive but the process is not ours.
 *
 * Falls back to `alive` when the recorded entry lacks `vmmExe` /
 * `startedAt` (older entries from before PR2). Conservative on
 * purpose: the gc decision then leans on process liveness alone.
 */
export function validatePid(
  pid: number,
  expected: { vmmExe?: string; startedAt?: number },
): PidStatus {
  if (!Number.isInteger(pid) || pid <= 0) {
    return "dead";
  }
  return validatePidNative({ pid, expected });
}

/**
 * Read the OS's view of `pid`'s exe basename and start time. Exposed
 * so `boot()` can snapshot the values at spawn time and persist them
 * into the registry entry — that way `validatePid` later compares
 * apples-to-apples.
 */
export function readProcessIdentity(pid: number): ProcessIdentity | undefined {
  if (!Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  return fromNativeIdentity(readProcessIdentityNative(pid));
}

function fromNativeIdentity(identity: ProcessIdentity | undefined): ProcessIdentity | undefined {
  if (!identity) {
    return undefined;
  }
  return {
    exeBase: identity.exeBase,
    startedAtMs: identity.startedAtMs,
  };
}
