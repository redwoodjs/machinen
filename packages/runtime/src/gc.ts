// `machinen gc` / `machinen stop` cleanup of registry entries whose
// VMM is gone (issue #150 phase 2 PR2).
//
// Why this isn't just `kill(pid, 0)`: the boot()-side exit hook used
// to handle every cleanup synchronously when the parent CLI was
// pinned to the VMM. Detached boots break that — the parent exits
// before the VMM does, so per-boot reflink disks, bundle dirs, and
// vsock UDS dirs leak. `runGc` is the backstop: walk the registry,
// drop entries whose pid is dead or has been recycled to some other
// process, and rm their recorded cleanupPaths + bootLogPath.
//
// Pid recycling is handled by `validatePid` (see pid-validate.ts).

import { existsSync, rmSync, statSync, unlinkSync } from "node:fs";
import debugLib from "debug";
import { validatePid, type PidStatus } from "./pid-validate.ts";
import { listAll, removeEntry, type RegistryEntry } from "./registry.ts";

const debug = debugLib("machinen:gc");

/** Per-entry record of what `runGc` did (or would do, with dryRun). */
export interface GcResult {
  pid: number;
  name?: string;
  status: PidStatus;
  /** Paths removed (or that would be removed under `dryRun`). */
  removedPaths: string[];
  /** Paths the gc tried to rm but couldn't (already gone, EPERM, …). */
  failedPaths: string[];
  /** True if the registry entry was (or would be) dropped. */
  registryRemoved: boolean;
}

export interface RunGcOptions {
  /**
   * When true, list what would be cleaned without touching the disk
   * or registry. Used by `machinen gc --dry-run` and tests.
   */
  dryRun?: boolean;
  /**
   * Only act on this single entry (skip everything else in the
   * registry). Used by `machinen stop` after killing a specific VM.
   */
  pid?: number;
}

/**
 * Walk the registry; for each entry that's dead or pid-recycled,
 * remove its cleanupPaths + bootLog + registry entry. Returns one
 * result per entry processed (live entries are skipped silently).
 */
export function runGc(opts: RunGcOptions = {}): GcResult[] {
  const entries = listAll().filter((e) => opts.pid === undefined || e.pid === opts.pid);
  const out: GcResult[] = [];
  for (const entry of entries) {
    const status = validatePid(entry.pid, {
      vmmExe: entry.vmmExe,
      startedAt: entry.startedAt,
    });
    if (status === "alive") {
      continue;
    }
    out.push(reapEntry(entry, status, opts.dryRun ?? false));
  }
  return out;
}

function reapEntry(entry: RegistryEntry, status: PidStatus, dryRun: boolean): GcResult {
  debug(
    "reap pid=%d name=%s status=%s dryRun=%s",
    entry.pid,
    entry.name ?? "<unset>",
    status,
    dryRun,
  );
  const removedPaths: string[] = [];
  const failedPaths: string[] = [];
  const candidates: string[] = [];
  if (entry.cleanupPaths) {
    for (const p of entry.cleanupPaths) {
      candidates.push(p);
    }
  }
  if (entry.bootLogPath) {
    candidates.push(entry.bootLogPath);
  }
  for (const p of candidates) {
    if (!existsSync(p)) {
      // Treat already-gone as success — the goal is that the path
      // doesn't exist after gc runs.
      continue;
    }
    if (dryRun) {
      removedPaths.push(p);
      continue;
    }
    if (rmPath(p)) {
      removedPaths.push(p);
    } else {
      failedPaths.push(p);
    }
  }
  if (!dryRun) {
    removeEntry(entry.pid);
  }
  return {
    pid: entry.pid,
    name: entry.name,
    status,
    removedPaths,
    failedPaths,
    registryRemoved: true,
  };
}

function rmPath(p: string): boolean {
  try {
    const st = statSync(p);
    if (st.isDirectory()) {
      rmSync(p, { recursive: true, force: true });
    } else {
      unlinkSync(p);
    }
    return true;
  } catch {
    return false;
  }
}
