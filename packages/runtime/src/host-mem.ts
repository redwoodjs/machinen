// Host-memory observation for `vm.fork()` backpressure (#274).
//
// A runaway script that calls `vm.fork()` faster than memory frees
// will eventually push the host past its OOM threshold and the
// kernel picks an arbitrary VMM (or any other host process) to
// kill. Throwing a clear backpressure error before that happens —
// the same retry/error idiom #267's port-conflict gate uses — lets
// the caller back off or surface the pressure to its own user.
//
// The native runtime helper reads `/proc/meminfo` on Linux and
// `vm_stat`/`sysctl` on Darwin. It is zero-state — no daemon, no probe
// socket, no caching. The check fires once per `vm.fork()`.

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
