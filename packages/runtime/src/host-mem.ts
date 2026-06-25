// Host memory probes for VM fork backpressure and memory auto-sizing.
//
// Machinen needs a fresh view of host memory before starting/forking VMs so a
// runaway workload does not push the host into OOM. This module asks the native
// runtime helper for available and total physical memory, then applies the
// runtime's backpressure policy.
//
// The native helper owns platform details: Linux reads `/proc/meminfo`; Darwin
// reads `vm_stat`/`sysctl`. Callers should treat these as point-in-time probes,
// not cached capacity guarantees.

import { BootError } from "./errors.ts";
import { readHostMemoryNative } from "./native/host-memory.ts";

/**
 * Bytes of memory the OS reports as available right now. "Available"
 * is the loose union the kernel exposes:
 *   - Linux  → /proc/meminfo MemAvailable (post-3.14 kernels — every
 *              distro machinen runs on). MemAvailable already accounts
 *              for reclaimable slab + page-cache, so it's the right
 *              answer for "could a new process allocate X bytes
 *              without paging or OOM?".
 *   - Darwin → vm_stat free + speculative + purgeable. Inactive is
 *              excluded because it's dirty and needs a pageout, which
 *              wouldn't help a fork that needs RAM right now.
 *   - other  → explicit helper error on platforms we do not support.
 */
export async function readHostFreeBytes(): Promise<number> {
  return readHostMemoryNative().freeBytes;
}

/** Total physical memory in bytes, read by the native runtime helper. */
export function readHostTotalBytes(): number {
  return readHostMemoryNative().totalBytes;
}

/**
 * Default fraction of host memory we require to be free before
 * `vm.fork()` is allowed to proceed. The gate exists to keep a
 * runaway script from OOM-killing arbitrary host processes — not
 * to enforce a particular working-set policy. 1% on a 24 GiB host
 * = ~250 MiB, enough headroom for the lazy-restore criu spawn
 * (#266) plus a typical workload's UFFD page-in burst, while still
 * tripping early enough that a host with only a few hundred MiB
 * free fails fast instead of triggering the kernel OOM killer.
 *
 * Smoke-test rationale: a host running `pnpm smoke-tests` sees
 * five sequential VMs leave it with ~1 GiB free in steady state.
 * Anything stricter than this default trips on real-world dev
 * loops; anything looser stops being a meaningful gate.
 */
export const DEFAULT_FREE_MEMORY_THRESHOLD = 0.01;

export interface CheckForkBackpressureOptions {
  /**
   * Fraction of host total memory that must remain free for a fork
   * to proceed. Pass `0` (or any non-positive number) to disable the
   * gate entirely. Capped at `1` — `0.5` already means "refuse
   * unless half the host is free."
   */
  threshold: number;
  /** Pluggable for tests; defaults to {@link readHostFreeBytes}. */
  readFree?: () => Promise<number>;
  /** Pluggable for tests; defaults to {@link readHostTotalBytes}. */
  totalBytes?: number;
}

/**
 * Refuse a fork when the host is under memory pressure. Throws
 * `BootError("FORK_MEMORY_BACKPRESSURE")` when free < total *
 * threshold, modeled on the throw-immediately shape of #267's
 * `BOOT_PORT_FORWARD_IN_USE` gate. Caller is responsible for any
 * retry policy.
 */
export async function checkForkBackpressure(opts: CheckForkBackpressureOptions): Promise<void> {
  if (!Number.isFinite(opts.threshold) || opts.threshold <= 0) {
    return;
  }
  const totalBytes = opts.totalBytes ?? readHostTotalBytes();
  const required = Math.floor(totalBytes * Math.min(opts.threshold, 1));
  const freeBytes = await (opts.readFree ?? readHostFreeBytes)();
  if (freeBytes >= required) {
    return;
  }
  const freeMib = Math.round(freeBytes / (1024 * 1024));
  const requiredMib = Math.round(required / (1024 * 1024));
  const totalMib = Math.round(totalBytes / (1024 * 1024));
  const pct = (opts.threshold * 100).toFixed(1).replace(/\.0$/, "");
  throw new BootError(
    "FORK_MEMORY_BACKPRESSURE",
    `vm.fork: host memory under pressure — ${freeMib} MiB free of ${totalMib} MiB ` +
      `total, threshold ${pct}% (${requiredMib} MiB) required. ` +
      `Wait for memory to free up and retry, or pass freeMemoryThreshold: 0 to ` +
      `disable the gate.`,
    { retryable: true },
  );
}
