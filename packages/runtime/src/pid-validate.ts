// PID liveness and recycling checks for registry operations.
//
// A pid being alive does not prove it is still our VMM: operating systems reuse
// pids. This module asks the native runtime helper for process identity and
// validates the registry's recorded exe/start-time against the current process.
//
// Used by `machinen gc`, `stop`, `attach`, and registry listing so stale entries
// are cleaned up without accidentally treating an unrelated recycled pid as a
// Machinen VM.

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
