// Detached-boot console snapshot.
//
// `boot({ detached: true })` (issue #150 phase 2) lets the runtime
// parent exit while the Zig VMM keeps running. After exit the stderr
// pipe is broken — VMM writes to it return EPIPE, which `main.zig`
// silences with `signal(SIGPIPE, SIG_IGN)`. Live post-detach console
// bytes are dropped on the floor; the only surviving diagnostic is
// what we capture *before* unref.
//
// `writeBootSnapshot()` flushes the in-RAM stderr ring-buffer (the
// Phase 1 `collect()` cap, ~1 MiB) to a one-shot file at detach time
// so a post-mortem on a detached VM's boot still has the kernel
// console + early-userspace output. Live tailing of a detached VM is
// out of scope for v1 — Phase 3 either folds logging into Zig with
// SIGHUP-reopen or routes through a forwarder daemon.

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const BOOT_LOG_DIR_ENV = "MACHINEN_DETACHED_LOG_DIR";

/**
 * Default directory for `<pid>.boot.log` snapshots. Honors
 * `MACHINEN_DETACHED_LOG_DIR` so tests can scope writes to a tmpdir
 * without scribbling under `$HOME`.
 */
export function detachedLogRoot(): string {
  return process.env[BOOT_LOG_DIR_ENV] ?? join(homedir(), ".machinen", "logs");
}

/** Path the next snapshot for `pid` will be written to. */
export function bootSnapshotPath(pid: number): string {
  return join(detachedLogRoot(), `${pid}.boot.log`);
}

/**
 * Atomically write the captured boot console to `path`. Best-effort:
 * a failure here must not block the detach — the VMM is already
 * running and the boot succeeded, so a missing snapshot is a
 * diagnostic loss, not a correctness issue. Returns `true` on
 * success, `false` if the write was skipped or failed.
 */
export function writeBootSnapshot(path: string, contents: string): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    return true;
  } catch {
    return false;
  }
}
