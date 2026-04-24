// VM registry — on-disk record of running microVMs so a second
// process can find, attach to, and drive them.
//
// Layout:
//
//   ~/.machinen/vms/<id>/meta.json
//
// `meta.json` contains the fields needed to reconnect: pid, the vsock
// UDS path, and optional human-friendly name + image ref. `boot()`
// writes the entry on spawn and removes it on child exit.
//
// `list()` walks the directory and prunes entries whose pid is no
// longer alive. `attach()` looks up an entry by id or name and reads
// it the same way.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import debugLib from "debug";

const debug = debugLib("machinen:registry");

export interface RegistryEntry {
  /** Auto-generated short id. Unique per VM. */
  id: string;
  /** Optional human-friendly name (from `boot({ name })`). */
  name?: string;
  /** PID of the VMM process on this host. */
  pid: number;
  /** Host-side vsock UDS the exec-agent is reachable on. */
  socketPath: string;
  /** Path to the image the VM was booted from (diagnostic only). */
  imagePath?: string;
  /**
   * Host-side path of the disk file attached as /dev/vda (from
   * `boot({ snapshot: <path> })`). Required for `attach().snapshot()`
   * so the attached handle knows which file to copy to the caller's
   * outPath after the guest dump completes. Undefined for VMs booted
   * without a disk.
   */
  diskPath?: string;
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

/** Generate a short (8-hex) id. */
export function newVmId(): string {
  return randomBytes(4).toString("hex");
}

/** Write a registry entry, creating the directory tree if needed. */
export function writeEntry(entry: RegistryEntry): void {
  const root = registryRoot();
  const dir = join(root, entry.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify(entry));
  debug(
    "write id=%s name=%s pid=%d sock=%s",
    entry.id,
    entry.name ?? "<unset>",
    entry.pid,
    entry.socketPath,
  );
}

/** Remove a registry entry. No-op if it's already gone. */
export function removeEntry(id: string): void {
  debug("remove id=%s", id);
  try {
    rmSync(join(registryRoot(), id), { recursive: true, force: true });
  } catch {}
}

/** Read an entry by id. Returns undefined if the directory or file is missing. */
export function readEntry(id: string): RegistryEntry | undefined {
  const path = join(registryRoot(), id, "meta.json");
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
 * List all registry entries whose pid is still alive. Prunes stale
 * entries (pid no longer alive) as a side effect, so a crashed VMM
 * doesn't leave a stuck record behind.
 */
export function list(): RegistryEntry[] {
  const root = registryRoot();
  if (!existsSync(root)) {
    return [];
  }
  const out: RegistryEntry[] = [];
  let pruned = 0;
  for (const id of readdirSync(root)) {
    const entry = readEntry(id);
    if (!entry) {
      // Malformed or missing meta.json — clean it up.
      removeEntry(id);
      pruned++;
      continue;
    }
    if (!isAlive(entry.pid)) {
      removeEntry(entry.id);
      pruned++;
      continue;
    }
    out.push(entry);
  }
  debug("list root=%s alive=%d pruned=%d", root, out.length, pruned);
  return out;
}

/**
 * Look up a running VM by id or name. Returns undefined if not found
 * or if the backing pid is dead (in which case the entry is pruned).
 */
export function findEntry(query: { id?: string; name?: string }): RegistryEntry | undefined {
  if (!query.id && !query.name) {
    return undefined;
  }
  if (query.id) {
    const entry = readEntry(query.id);
    if (!entry) {
      return undefined;
    }
    if (!isAlive(entry.pid)) {
      removeEntry(entry.id);
      return undefined;
    }
    return entry;
  }
  // Name-based lookup: walk + filter.
  for (const entry of list()) {
    if (entry.name === query.name) {
      return entry;
    }
  }
  return undefined;
}
