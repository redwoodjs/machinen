// Materialize a host directory into a deterministic, content-addressed
// squashfs image and (lazily) build a per-VM ext4 upper image to layer
// on top via overlayfs (#272).
//
// Architectural shape:
//   * The user's `mount: { host, guest }` payload no longer rides in
//     the initramfs cpio (#114-style relocation). It now lives on two
//     virtio-blk slots:
//
//       /dev/vdc — squashfs RO lower, content-addressed in
//                  ~/.cache/machinen/mountdisk/<key>.sqfs
//       /dev/vdd — ext4 RW upper, per-VM sparse file in tmpdir()
//
//     /init mounts both inside the guest and layers an overlayfs at
//     /<guest>/. Guest writes go to the upper; the lower stays sealed.
//
//   * Cache layout, mirroring rootfs-img.ts:
//
//       ~/.cache/machinen/mountdisk/<key>.sqfs
//       ~/.cache/machinen/mountdisk/<key>.sqfs.ok      ← clean-shutdown
//       ~/.cache/machinen/mountdisk/<key>.staging-...  ← in-progress
//
//   * Cache key is a tree-manifest hash: each path under host gets a
//     line of `<relpath>\0<mode>\0<size>\0<mtime_ns>\0<symlink|sha>\n`
//     and the whole list (sorted by relpath) is sha256'd. This is more
//     conservative than sha-of-tarball — symlink targets and mtimes
//     bake in — but mksquashfs would have to read every file anyway
//     for the actual build, so the manifest hash is essentially free
//     on the cache-miss path. Cache hits pay one walk + read of every
//     file; if that's too expensive on huge trees we can fall back to
//     `(relpath, mode, size, mtime_ns)` later. Start strict.
//
// Materialization uses `mksquashfs` (squashfs-tools) with
// determinism flags `-mkfs-time 0 -all-time 0 -no-progress -no-recovery
// -comp zstd`. We resolve mksquashfs in four steps, exactly mirroring
// rootfs-img.ts's mke2fs lookup:
//
//   1. `MACHINEN_MKSQUASHFS` env override
//   2. The bundled `@machinen/squashfs-tools-<arch>-<os>` package
//   3. PATH (for hosts that have squashfs-tools installed system-wide)
//   4. Homebrew's keg-only / opt prefix on darwin
//
// On hosts that don't ship a usable mksquashfs the function throws
// `BOOT_MOUNTDISK_TOOL_MISSING` — there is NO fallback to the cpio
// overlay path. The runtime expects a working bundled package, the
// caller's PATH, or the env override.

import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { arch, homedir, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import debugLib from "debug";
import { BootError } from "./errors.ts";
import { planMountDiskUpperSizeNative } from "./native/mount-disk-upper-size.ts";
import { ensureMountDiskImageNative, ensureMountDiskUpperNative } from "./native/mountdisk.ts";
import { treeManifestHashNative } from "./native/tree-manifest-hash.ts";
import { resolveMke2fs } from "./rootfs-img.ts";

const debug = debugLib("machinen:mountdisk-img");

/** Default cache root: `~/.cache/machinen/mountdisk`. */
export function mountdiskImgCacheDir(): string {
  return join(homedir(), ".cache", "machinen", "mountdisk");
}

function okMarkerPath(imgPath: string): string {
  return `${imgPath}.ok`;
}

/**
 * Mark a cached squashfs lower as "cleanly released," same idiom as
 * `markRootfsImageClean()`. The lower is read-only inside the guest
 * so corruption is unlikely, but a host crash mid-write during the
 * initial mksquashfs would leave a truncated file in the cache.
 *
 * No-op when the image doesn't exist. Failures are swallowed.
 */
export function markMountDiskImageClean(imgPath: string): void {
  if (!existsSync(imgPath)) {
    return;
  }
  const okPath = okMarkerPath(imgPath);
  const tmp = `${okPath}.tmp.${process.pid}`;
  let fd = -1;
  try {
    fd = openSync(tmp, "w");
    fsyncSync(fd);
    closeSync(fd);
    fd = -1;
    renameSync(tmp, okPath);
  } catch (err) {
    debug("markMountDiskImageClean failed img=%s err=%s", imgPath, (err as Error).message);
    if (fd >= 0) {
      try {
        closeSync(fd);
      } catch {}
    }
    try {
      unlinkSync(tmp);
    } catch {}
  }
}

export interface EnsureMountDiskImageOptions {
  /** Override the cache directory. Default: `~/.cache/machinen/mountdisk`. */
  cacheDir?: string;
  /** Force re-materialization. Mostly for debugging the materializer. */
  force?: boolean;
  /**
   * Sub-phase callback for the caller's PhaseTimer. Fires for each
   * measurable internal step: `manifest-hash`, `mksquashfs`,
   * `staging-rename`. The caller usually does
   * `phases.mark("<parent>.${name}", ms)`.
   */
  onPhase?: (name: string, ms: number) => void;
}

export interface EnsureMountDiskImageResult {
  /** Absolute path to the cached squashfs lower. */
  lowerPath: string;
  /** Tree-manifest sha256 — also the cache key. Useful for tests. */
  key: string;
}

/**
 * Resolve `hostAbs` to a content-addressed squashfs lower image,
 * materializing it on first call. Returns the absolute path to the
 * cached `.sqfs`.
 *
 * Cache key: sha256 of a sorted manifest covering relpath, mode,
 * size, mtime_ns, and either the symlink target or the per-file
 * sha256. Same input tree → same image, even across runs and
 * processes. Concurrent callers don't race because we materialize
 * into a uniquely-named staging directory and atomically rename.
 *
 * Lifecycle (mirrors rootfs-img.ts): the returned path is in the
 * "in-use" state (no `.ok` marker on disk). The caller invokes
 * `markMountDiskImageClean(path)` once they're done.
 *
 * @throws {BootError} BOOT_MOUNTDISK_TOOL_MISSING when no mksquashfs
 *   binary is found |
 *   {ProvisionError} PROVISION_INSTALL_HOOK_FAILED when mksquashfs
 *   exits non-zero |
 *   {BootError} BOOT_MOUNT_HOST_NOT_FOUND when the source dir is
 *   missing |
 *   {BootError} BOOT_MOUNT_INVALID when the source dir isn't a
 *   directory.
 */
export function ensureMountDiskImage(
  hostAbs: string,
  opts: EnsureMountDiskImageOptions = {},
): EnsureMountDiskImageResult {
  const hostResolved = resolve(hostAbs);
  const cacheDir = opts.cacheDir ?? mountdiskImgCacheDir();
  mkdirSync(cacheDir, { recursive: true });

  const result = ensureMountDiskImageNative({
    host: hostResolved,
    cacheDir,
    force: opts.force ?? false,
    mksquashfsEnvOverride: process.env.MACHINEN_MKSQUASHFS || undefined,
    mksquashfsCandidates: mksquashfsCandidates(),
  });

  opts.onPhase?.("manifest-hash", result.phases.manifestHash);
  if (result.phases.mksquashfs > 0) {
    opts.onPhase?.("mksquashfs", result.phases.mksquashfs);
  }
  if (result.phases.stagingRename > 0) {
    opts.onPhase?.("staging-rename", result.phases.stagingRename);
  }

  debug(
    "%s key=%s img=%s",
    result.cacheHit ? "cache hit" : "materialize done",
    result.key.slice(0, 12),
    result.lowerPath,
  );
  return { lowerPath: result.lowerPath, key: result.key };
}

export interface EnsureMountDiskUpperOptions {
  /**
   * Target size in bytes. Default 4 GiB. Sparse, so unused capacity
   * costs nothing on the host disk. Mirrors `rootDiskSizeBytes` —
   * over-provision to give the guest room to write without
   * having to grow the file mid-VM.
   */
  sizeBytes?: number;
}

export interface EnsureMountDiskUpperResult {
  /** Absolute path to the per-VM ext4 upper image. */
  upperPath: string;
  /** Size in bytes the file was allocated at. */
  sizeBytes: number;
}

/**
 * Materialize a per-VM ext4 RW upper image for the mount overlay.
 * Each call returns a fresh sparse file in `tmpdir()` — the upper is
 * specific to one VM and gets cleaned up alongside the per-boot
 * rootdisk reflink. Snapshots reflink the upper into the bundle so
 * writes survive snapshot/restore.
 *
 * Mirrors rootfs-img.ts's mke2fs lookup for the file-format step;
 * shares the same `BOOT_MOUNTDISK_TOOL_MISSING` failure mode if
 * mke2fs is unavailable (the runtime needs e2fsprogs anyway for the
 * rootdisk path, so this is rarely the failure that fires first).
 *
 * @throws {BootError} BOOT_MOUNTDISK_TOOL_MISSING when no mke2fs is
 *   available |
 *   {ProvisionError} PROVISION_INSTALL_HOOK_FAILED when mke2fs fails.
 */
export function ensureMountDiskUpper(
  opts: EnsureMountDiskUpperOptions = {},
): EnsureMountDiskUpperResult {
  const sizeBytes = planMountDiskUpperSizeNative(opts.sizeBytes);
  const mke2fs = resolveMke2fs();
  if (!mke2fs) {
    throw new BootError(
      "BOOT_MOUNTDISK_TOOL_MISSING",
      "ensureMountDiskUpper: no mke2fs binary found. The mount overlay's " +
        "RW upper is an ext4 image; install e2fsprogs (same hint as the " +
        "rootdisk path):\n" +
        "  • macOS:  brew install e2fsprogs\n" +
        "  • Linux:  apt-get install -y e2fsprogs",
    );
  }

  return ensureMountDiskUpperNative({
    tmpDir: tmpdir(),
    sizeBytes,
    mke2fs,
  });
}

/**
 * Resolve the mksquashfs binary path using the same lookup order as
 * `ensureMountDiskImage` itself: env override → bundled package →
 * PATH → Homebrew opt prefix. Returns `undefined` when no binary is
 * available.
 */
export function resolveMksquashfs(): string | undefined {
  return (
    resolveMksquashfsEnvOverride() ??
    findBundledMksquashfs() ??
    whichFirst(["mksquashfs"]) ??
    findKegOnlyMksquashfs()
  );
}

function mksquashfsCandidates(): string[] {
  return [findBundledMksquashfs(), whichFirst(["mksquashfs"]), findKegOnlyMksquashfs()].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
}

// --- internals --------------------------------------------------------

function resolveMksquashfsEnvOverride(): string | undefined {
  const envOverride = process.env.MACHINEN_MKSQUASHFS;
  if (!envOverride) {
    return undefined;
  }
  if (existsSync(envOverride)) {
    debug("resolved via MACHINEN_MKSQUASHFS=%s", envOverride);
    return envOverride;
  }
  throw new BootError(
    "BOOT_MOUNTDISK_TOOL_MISSING",
    `MACHINEN_MKSQUASHFS=${envOverride} is set but that file does not exist.`,
  );
}

const require_ = createRequire(import.meta.url);

function findBundledMksquashfs(): string | undefined {
  const pkg = `@machinen/native-${arch()}-${platform()}`;
  try {
    const mod = require_(pkg) as { mksquashfs?: string };
    if (mod.mksquashfs && existsSync(mod.mksquashfs)) {
      return mod.mksquashfs;
    }
  } catch {
    // Optional dep not installed for this arch+os.
  }
  return undefined;
}

// Same set of brew opt prefixes the rootfs path probes — squashfs is
// not keg-only the way e2fsprogs is, but Homebrew sometimes installs
// it under /opt/homebrew/opt/squashfs/bin/. Probe defensively.
const KEG_ONLY_DIRS = [
  "/opt/homebrew/opt/squashfs/bin", // Apple Silicon
  "/usr/local/opt/squashfs/bin", // Intel
  "/opt/homebrew/bin", // brew default if symlinked
];

function findKegOnlyMksquashfs(): string | undefined {
  for (const dir of KEG_ONLY_DIRS) {
    const candidate = join(dir, "mksquashfs");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function whichFirst(names: string[]): string | undefined {
  for (const name of names) {
    try {
      const out = execFileSync("/usr/bin/env", ["which", name], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (out) {
        return out;
      }
    } catch {
      // not on PATH — try the next.
    }
  }
  return undefined;
}

/**
 * Compute the mountdisk cache-key manifest hash in Zig. The manifest
 * contract is intentionally still documented and tested here, but the
 * filesystem walk, metadata normalization, and file hashing live in
 * `machinen-runtime-helper tree-manifest-hash`.
 */
export function treeManifestHash(root: string): string {
  return treeManifestHashNative(root);
}

/**
 * Visible to tests that want to assert without invoking the real
 * materializer.
 */
export const _mountdiskImgInternal = {
  okMarkerPath,
  resolveMksquashfsEnvOverride,
  findBundledMksquashfs,
  findKegOnlyMksquashfs,
  treeManifestHash,
};
