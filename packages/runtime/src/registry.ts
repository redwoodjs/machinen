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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import debugLib from "debug";

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
   * Host-side path of the disk file attached as /dev/vda (from
   * `boot({ snapshot: <path> })`). Required for `vm.snapshot()` —
   * attached handles read it from the registry to find the host
   * file to copy after the guest dump completes.
   */
  diskPath?: string;
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
 * Remove a registry entry by pid. No-op if it's already gone. Also
 * removes the matching name pin if the entry carried one.
 */
export function removeEntry(pid: number): void {
  debug("remove pid=%d", pid);
  const root = registryRoot();
  // Read meta first to recover the name (so we can drop the pin).
  const entry = readEntry(pid);
  if (entry?.name) {
    try {
      unlinkSync(pinPath(entry.name));
    } catch {}
  }
  try {
    rmSync(join(root, String(pid)), { recursive: true, force: true });
  } catch {}
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
    if (!isAlive(entry.pid)) {
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
 * Walk the names tree, unlink any pin whose pid is dead. Idempotent.
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
    if (!Number.isInteger(pid) || pid <= 0 || !isAlive(pid)) {
      try {
        unlinkSync(pinAbs);
      } catch {}
    }
  });
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
      // EEXIST: someone holds the pin. If they're dead, drop it and retry.
      let heldPid = -1;
      try {
        heldPid = Number(readFileSync(pin, "utf8").trim());
      } catch {}
      if (heldPid > 0 && isAlive(heldPid)) {
        debug("claimName name=%s held by live pid=%d — refusing", name, heldPid);
        return false;
      }
      debug("claimName name=%s stale pin (heldPid=%d) — unlinking", name, heldPid);
      try {
        unlinkSync(pin);
      } catch {}
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
    if (!isAlive(entry.pid)) {
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
    if (!Number.isInteger(pid) || pid <= 0 || !isAlive(pid)) {
      try {
        unlinkSync(pin);
      } catch {}
      return undefined;
    }
    return readEntry(pid);
  }
  return undefined;
}
