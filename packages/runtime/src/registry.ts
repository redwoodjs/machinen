// VM registry — on-disk record of running microVMs so a second
// process can find, attach to, and drive them.
//
// Layout:
//
//   ~/.machinen/vms/<pid>/meta.json     ← one per running VM
//   ~/.machinen/vms/names/<name>        ← name pin file, contents = pid
//                                          (mkdir -p the parent dirs;
//                                           the leaf is the pin)
//
// `meta.json` carries everything needed to reconnect: the vsock UDS
// path, optional human-friendly name, source image / disk paths, etc.
// `boot()` writes the entry on spawn and removes it on child exit.
//
// PID is the primary key. It's kernel-unique while alive, already
// surfaced by the OS, and means we don't need a separate auto-id —
// `attach({ pid })` reads `<pid>/meta.json` directly. Names are an
// optional human label, enforced unique-while-live via the pin tree
// so `attach({ name })` always resolves to one VM.
//
// `list()` walks the directory and prunes entries whose pid is no
// longer alive — including any name pins that point at the dead pid.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import debugLib from "debug";
import { validatePid } from "./pid-validate.ts";

const debug = debugLib("machinen:registry");

export interface RegistryEntry {
  /** PID of the VMM process on this host — primary key. */
  pid: number;
  /** Optional human-friendly name (from `boot({ name })`). Path-shaped allowed. */
  name?: string;
  /** Host-side vsock UDS the exec-agent is reachable on. */
  socketPath: string;
  /** Path to the image the VM was booted from (diagnostic only). */
  imagePath?: string;
  /**
   * Host-side path of the root block device currently attached as
   * `/dev/vda`. Vmstate snapshots need the exact bytes because the
   * whole-VM state captures RAM/device/vCPU state, not disk blocks.
   */
  rootDiskPath?: string;
  /** Whether the VM intentionally booted without a root block device. */
  rootDiskMode?: "block" | "none";
  /**
   * Host-side path of the scratch disk attached to the guest. Used by
   * `attach().snapshot()` so an attach-owned handle can find the
   * guest-side scratch disk that backs the in-VM dump.
   */
  diskPath?: string;
  /**
   * Vmstate engine only: absolute path the VMM writes its `.vmstate`
   * whole-VM state file to (the `MACHINEN_SNAPSHOT_PATH` it booted
   * with). Persisted so an attach-owned `vm.snapshot()` / `vm.fork()`
   * can SIGUSR1 the VMM and pick the state file up. Undefined for VMs
   * booted without the vmstate engine.
   */
  vmstatePath?: string;
  /** Per-VM incremental checkpoint chain id. New on every fresh boot/restore. */
  vmstateChainId?: string;
  /** Absolute bundle path the next vmstate checkpoint should parent to. */
  vmstateCheckpointParent?: string;
  /** Per-chain checkpoint sequence already written by this VM. */
  vmstateCheckpointSequence?: number;
  /**
   * Absolute path to the snapshot directory this VM was forked from
   * (set by `restore({ snapDir })`). Visible in `ls`; informational.
   */
  forkedFrom?: string;
  /**
   * Path to the one-shot boot-console snapshot written at detach time
   * (issue #150 phase 2). Only set on entries booted with
   * `--detached`; live post-detach console bytes are dropped on the
   * floor (the VMM ignores SIGPIPE), so this file is the only record
   * of the boot sequence on a detached VM.
   */
  bootLogPath?: string;
  /**
   * Per-boot artifacts that need to be removed when the VMM exits.
   * Today the in-process exit hook handles this for non-detached
   * boots. After detach (#150 phase 2) the parent is gone before the
   * VMM exits — `machinen gc` / `machinen stop` use this list to
   * clean up afterward. Each entry is an absolute path to either a
   * file (per-boot disk image) or a directory (bundle / vsock UDS).
   */
  cleanupPaths?: string[];
  /**
   * Absolute path to the VMM binary that was spawned. `machinen gc`
   * compares this against `/proc/<pid>/exe` (Linux) or `ps -o comm=`
   * (macOS) before treating an entry as live — without it, a recycled
   * pid that happens to belong to some other process would look alive
   * to `kill(pid, 0)` and the entry would be kept around forever.
   */
  vmmExe?: string;
  /**
   * PID of the gvproxy process spawned alongside this VMM (issue #150
   * phase 2 PR3). Recorded so `machinen stop` can SIGTERM gvproxy at
   * the same time as the VMM, and so `machinen gc` can validate /
   * reap it independently. Undefined when the VM was booted without
   * networking (no gvproxy binary, or `MACHINEN_NET_SOCKET` was
   * pre-set by the caller).
   */
  gvproxyPid?: number;
  /**
   * Absolute path to the gvproxy binary spawned for this VM. Used by
   * `machinen stop` for the same anti-recycling check the VMM gets
   * via `vmmExe` — we don't want to SIGTERM whatever process inherits
   * gvproxy's pid weeks later.
   */
  gvproxyExe?: string;
  /**
   * Host→guest port forwards configured at boot/fork time. Surfaced
   * in `machinen ls` so users can see which host port maps to which
   * VM without re-reading the launch command. Undefined when the VM
   * was booted without `-p` / `portForward: []`.
   */
  portForward?: Array<{ hostPort: number; guestPort: number; hostAddr?: string }>;
  /**
   * Guest RAM ceiling in MiB, as resolved by `boot()` (either the
   * caller's `memory:` option or `autoSizeMemoryMib()` for this host
   * — see #263 phase A). Surfaced in `machinen ls` (MEM column) and
   * read by `vm.memoryStats()` so callers can compare host RSS
   * against the ceiling without re-deriving it. Undefined when the
   * caller pre-set `MACHINEN_MEMORY` via `vmmEnv` and we never
   * computed our own.
   */
  memoryCeilingMib?: number;
  /**
   * Absolute path to the shared stats file the VMM writes balloon
   * counters to (#274). 16 bytes, mmaped MAP_SHARED on the VMM side
   * via `MACHINEN_STATS_FILE`. Persisted so an attach-owned handle
   * can read the same counters its boot-owned sibling sees. Undefined
   * for VMMs launched outside the runtime (which never received the
   * env var).
   */
  statsPath?: string;
  /**
   * Total pages the lazy-pages rewriter (#266) marked PE_LAZY when
   * the VM was restored. Set on restore-derived entries, undefined
   * for plain boots and eager restores. Surfaced via
   * `vm.memoryStats().lazyPagesPending`.
   */
  lazyPagesTotal?: number;
  /**
   * #272: when the VM was booted with `mount: { host, guest }`, the
   * runtime materialized a squashfs RO lower + ext4 RW upper. Persist
   * those host paths so an attach-owned `vm.snapshot()` /
   * `vm.fork()` can reflink them into the snapshot bundle exactly
   * like the boot-owned handle does — without this, a CLI-side
   * `machinen snapshot <vm>` produces a bundle missing
   * `mount-lower.sqfs` / `mount-upper.img` and a later `restore`
   * silently boots without the overlay.
   */
  mountDisk?: {
    guest: string;
    lowerPath: string;
    upperPath: string;
  };
  /**
   * #273: live-share mounts (`liveMounts: [...]` at boot) the VM was
   * started with. Persisted so an attach-owned `vm.snapshot()` /
   * `vm.fork()` can record the same `meta.liveMounts` block in the
   * bundle. Since #332 every live mount is served by an in-VMM
   * virtio-fs device — there's no host-side process to record, reap,
   * or reconnect to. The per-mount virtio-fs tag isn't recorded
   * either; it's re-derived from the resolved order on restore.
   */
  liveMounts?: Array<{
    guest: string;
    host: string;
    mode: "ro" | "rw";
  }>;
  /** ms epoch when the entry was created. */
  startedAt: number;
}

const REGISTRY_ROOT_ENV = "MACHINEN_REGISTRY_DIR";

/**
 * Absolute path to the registry root. Honors `MACHINEN_REGISTRY_DIR`
 * so tests can point at a scratch dir without stomping on real entries.
 */
export function registryRoot(): string {
  return process.env[REGISTRY_ROOT_ENV] ?? join(homedir(), ".machinen", "vms");
}

function namesDir(): string {
  return join(registryRoot(), "names");
}

function pinPath(name: string): string {
  return join(namesDir(), name);
}

/**
 * Write a registry entry, creating the directory tree if needed.
 * If `entry.name` is set, also creates the name pin file pointing
 * at the pid. Caller is responsible for ensuring the name is free
 * (use `claimName` before `writeEntry`).
 */
export function writeEntry(entry: RegistryEntry): void {
  const root = registryRoot();
  const dir = join(root, String(entry.pid));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify(entry));
  if (entry.name) {
    const pin = pinPath(entry.name);
    mkdirSync(dirname(pin), { recursive: true });
    // O_CREAT only — `claimName` already guaranteed exclusivity. If
    // a stale pin somehow lingered past claim, overwrite is safe
    // (the previous owner is dead by definition).
    writeFileSync(pin, String(entry.pid));
  }
  debug("write pid=%d name=%s sock=%s", entry.pid, entry.name ?? "<unset>", entry.socketPath);
}

/**
 * Merge a partial entry into the existing one for `pid`. Used when a
 * field becomes known after the initial `writeEntry` — e.g. the
 * lazy-restore page total, patched in after `restore()` boots the VM.
 * No-op if no entry exists.
 */
export function patchEntry(pid: number, patch: Partial<RegistryEntry>): void {
  const existing = readEntry(pid);
  if (!existing) {
    debug("patch pid=%d skipped (no entry)", pid);
    return;
  }
  const merged: RegistryEntry = { ...existing, ...patch, pid: existing.pid };
  // Reuse writeEntry so the name pin is preserved.
  writeEntry(merged);
}

/**
 * Remove a registry entry by pid. No-op if it's already gone. Also
 * removes the matching name pin if the entry carried one.
 */
export function removeEntry(pid: number): void {
  debug("remove pid=%d", pid);
  const root = registryRoot();
  // Read meta first to recover the name (so we can drop the pin).
  const entry = readEntry(pid);
  if (entry?.name) {
    const pin = pinPath(entry.name);
    try {
      unlinkSync(pin);
    } catch {}
    // For path-shaped names (`<src>/<pid>` chained restore — #208) the
    // pin's parent dirs were created by `claimName`'s recursive mkdir.
    // Walk up and rmdir any that are now empty, stopping at namesDir().
    // rmdirSync errors on non-empty dirs, so siblings stay intact.
    pruneEmptyParents(dirname(pin));
  }
  try {
    rmSync(join(root, String(pid)), { recursive: true, force: true });
  } catch {}
}

function pruneEmptyParents(dir: string): void {
  const stop = namesDir();
  let cur = dir;
  while (cur.startsWith(stop) && cur !== stop) {
    try {
      rmdirSync(cur);
    } catch {
      return;
    }
    cur = dirname(cur);
  }
}

/** Read an entry by pid. Returns undefined if the directory or file is missing. */
export function readEntry(pid: number): RegistryEntry | undefined {
  const path = join(registryRoot(), String(pid), "meta.json");
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RegistryEntry;
  } catch {
    return undefined;
  }
}

/**
 * Check whether a pid points at a live process. Uses `kill(pid, 0)` — a
 * no-op signal that tells us whether we're allowed to signal the process.
 * Returns false if the process is gone OR if we don't have permission,
 * which is good enough for reaper purposes (unreachable == treat as dead).
 */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a name pin pointing at `heldPid` should be treated as stale.
 *
 * A pin is stale when any of these is true:
 *   1. heldPid isn't a sane positive integer.
 *   2. The matching `<pid>/meta.json` is gone — `writeEntry` /
 *      `removeEntry` always pair the meta dir with the pin, so a pin
 *      without an entry is by definition orphaned (e.g. a crash
 *      between writeEntry and registry rollback, or a manual
 *      `rm -rf ~/.machinen/vms/<pid>`).
 *   3. `validatePid` says the pid is `dead` or has been `recycled` to
 *      some other process. This is what `runGc` uses; without it
 *      `claimName` would happily refuse to free the pin because
 *      `kill(pid,0)` succeeds for the unrelated process now sitting
 *      on that pid.
 */
function pinIsStale(heldPid: number): boolean {
  if (!Number.isInteger(heldPid) || heldPid <= 0) {
    return true;
  }
  const entry = readEntry(heldPid);
  if (!entry) {
    return true;
  }
  return (
    validatePid(heldPid, {
      vmmExe: entry.vmmExe,
      startedAt: entry.startedAt,
    }) !== "alive"
  );
}

/**
 * List every registry entry on disk, including ones whose pid is
 * dead. Side-effect-free: nothing is removed, no pins are pruned.
 *
 * `machinen gc` (issue #150 phase 2 PR2) needs this to see dead
 * entries before deciding whether to drop their cleanupPaths —
 * `list()` would have already removed the registry directory by the
 * time gc looked, leaving no record of what to clean up.
 */
export function listAll(): RegistryEntry[] {
  const root = registryRoot();
  if (!existsSync(root)) {
    return [];
  }
  const out: RegistryEntry[] = [];
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name === "names") {
      continue;
    }
    const pidNum = Number(dirent.name);
    if (!Number.isInteger(pidNum) || pidNum <= 0) {
      continue;
    }
    const entry = readEntry(pidNum);
    if (entry) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * List all registry entries whose pid is still alive. Prunes stale
 * entries (pid no longer alive) and orphaned name pins as a side
 * effect, so a crashed VMM doesn't leave a stuck record behind.
 */
export function list(): RegistryEntry[] {
  const root = registryRoot();
  if (!existsSync(root)) {
    return [];
  }
  const out: RegistryEntry[] = [];
  let pruned = 0;
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }
    if (dirent.name === "names") {
      continue;
    }
    const pidNum = Number(dirent.name);
    if (!Number.isInteger(pidNum) || pidNum <= 0) {
      // Foreign directory — skip.
      continue;
    }
    const entry = readEntry(pidNum);
    if (!entry) {
      removeEntry(pidNum);
      pruned++;
      continue;
    }
    const status = validatePid(entry.pid, {
      vmmExe: entry.vmmExe,
      startedAt: entry.startedAt,
    });
    if (status !== "alive") {
      removeEntry(entry.pid);
      pruned++;
      continue;
    }
    out.push(entry);
  }
  pruneStaleNamePins();
  debug("list root=%s alive=%d pruned=%d", root, out.length, pruned);
  return out;
}

/**
 * Walk the names tree, unlink any pin that's stale per `pinIsStale`
 * (dead, recycled, or orphaned with no matching meta), then sweep
 * empty subdirectories left behind. Idempotent.
 */
function pruneStaleNamePins(): void {
  const base = namesDir();
  if (!existsSync(base)) {
    return;
  }
  walkPins(base, (pinAbs) => {
    let pid: number;
    try {
      pid = Number(readFileSync(pinAbs, "utf8").trim());
    } catch {
      // Unreadable pin — drop it.
      try {
        unlinkSync(pinAbs);
      } catch {}
      return;
    }
    if (pinIsStale(pid)) {
      try {
        unlinkSync(pinAbs);
      } catch {}
    }
  });
  // Sweep any empty subdirectories left under `names/` — pre-#268
  // path-shaped pins didn't prune their parents on removal, so old
  // leftovers can accumulate. rmdir errors on non-empty dirs, so
  // siblings holding live pins stay intact.
  sweepEmptyPinDirs(base);
}

function walkPins(dir: string, onFile: (path: string) => void): void {
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      walkPins(full, onFile);
    } else if (dirent.isFile()) {
      onFile(full);
    }
  }
}

function sweepEmptyPinDirs(dir: string): void {
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const child = join(dir, dirent.name);
    sweepEmptyPinDirs(child);
    try {
      rmdirSync(child);
    } catch {}
  }
}

/**
 * Try to atomically reserve `name` for `pid`. Returns true on success,
 * false if the name is held by another live VM. If a stale pin (pid
 * dead) is in the way, it's removed and we retry once.
 *
 * Layered semantics: `O_CREAT|O_EXCL` is the underlying primitive,
 * but Node's `writeFileSync(..., { flag: "wx" })` is the equivalent
 * and works on every platform we ship.
 */
export function claimName(name: string, pid: number): boolean {
  const pin = pinPath(name);
  // Path-shaped names like `<src>/<pid>` (chained restore — #208) need
  // their parent dir to exist. mkdir is idempotent for directories;
  // it throws EEXIST when a regular file blocks the parent path —
  // typical when the source VM is alive and pinned at `<src>` (the
  // fork case, #216). Treat that as "name unavailable" so callers
  // can fall back to a non-nested name rather than crash.
  try {
    mkdirSync(dirname(pin), { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      debug("claimName name=%s parent path is a live pin — refusing", name);
      return false;
    }
    throw err;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(pin, String(pid), { flag: "wx" });
      debug("claimName name=%s pid=%d (attempt=%d)", name, pid, attempt);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw err;
      }
      // EEXIST: a file or a directory occupies the pin path. An empty
      // directory is a leftover from a path-shaped child pin whose
      // leaf was unlinked (pre-#268 removeEntry didn't prune parents).
      // A non-empty directory is holding live nested pins — refuse.
      let isDir = false;
      try {
        isDir = statSync(pin).isDirectory();
      } catch {}
      if (isDir) {
        try {
          rmdirSync(pin);
          debug("claimName name=%s removed empty stale dir — retrying", name);
          continue;
        } catch {
          debug("claimName name=%s dir holds live nested pins — refusing", name);
          return false;
        }
      }
      // Pin is a regular file. If the holder fails the recycling /
      // orphan check, drop the pin (and any orphaned meta dir) and
      // retry. `kill(pid,0)` alone isn't enough — a recycled pid will
      // succeed it, leaving the pin pinned forever.
      let heldPid = -1;
      try {
        heldPid = Number(readFileSync(pin, "utf8").trim());
      } catch {}
      if (heldPid > 0 && !pinIsStale(heldPid)) {
        debug("claimName name=%s held by live pid=%d — refusing", name, heldPid);
        return false;
      }
      debug("claimName name=%s stale pin (heldPid=%d) — reaping", name, heldPid);
      try {
        unlinkSync(pin);
      } catch {}
      if (heldPid > 0) {
        // If the meta dir lingered (orphaned writeEntry, or recycled
        // pid), drop it now — otherwise the next list() would prune
        // it but we want claimName to leave a clean slate either way.
        try {
          rmSync(join(registryRoot(), String(heldPid)), { recursive: true, force: true });
        } catch {}
      }
    }
  }
  return false;
}

/**
 * Look up a running VM by pid or name. Returns undefined if not found
 * or if the backing pid is dead (in which case the entry is pruned).
 */
export function findEntry(query: { pid?: number; name?: string }): RegistryEntry | undefined {
  if (query.pid !== undefined) {
    const entry = readEntry(query.pid);
    if (!entry) {
      return undefined;
    }
    const status = validatePid(entry.pid, {
      vmmExe: entry.vmmExe,
      startedAt: entry.startedAt,
    });
    if (status !== "alive") {
      removeEntry(entry.pid);
      return undefined;
    }
    return entry;
  }
  if (query.name !== undefined) {
    const pin = pinPath(query.name);
    if (!existsSync(pin)) {
      return undefined;
    }
    let pid = -1;
    try {
      pid = Number(readFileSync(pin, "utf8").trim());
    } catch {
      return undefined;
    }
    if (pinIsStale(pid)) {
      try {
        unlinkSync(pin);
      } catch {}
      return undefined;
    }
    return readEntry(pid);
  }
  return undefined;
}
