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

import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { arch, homedir, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import debugLib from "debug";
import { BootError, ProvisionError } from "./errors.ts";
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
  if (!existsSync(hostResolved)) {
    throw new BootError(
      "BOOT_MOUNT_HOST_NOT_FOUND",
      `ensureMountDiskImage: host directory not found at ${hostResolved}`,
    );
  }
  if (!statSync(hostResolved).isDirectory()) {
    throw new BootError(
      "BOOT_MOUNT_INVALID",
      `ensureMountDiskImage: host path must be a directory: ${hostResolved}`,
    );
  }

  const cacheDir = opts.cacheDir ?? mountdiskImgCacheDir();
  mkdirSync(cacheDir, { recursive: true });

  const hashT0 = Date.now();
  const key = treeManifestHash(hostResolved);
  opts.onPhase?.("manifest-hash", Date.now() - hashT0);
  const imgPath = join(cacheDir, `${key}.sqfs`);
  const okPath = okMarkerPath(imgPath);

  if (!opts.force && existsSync(imgPath)) {
    debug("cache hit key=%s img=%s", key.slice(0, 12), imgPath);
    if (!existsSync(okPath)) {
      // No clean-shutdown marker → the previous owner died mid-build
      // (or the file was hand-placed). Treat as poisoned and rebuild.
      debug("cache hit but no clean marker — rematerialising img=%s", imgPath);
    } else {
      try {
        unlinkSync(okPath);
      } catch {}
      return { lowerPath: imgPath, key };
    }
  }

  // Resolve mksquashfs. Same precedence as `resolveMksquashfs()` below.
  const mksquashfs = resolveMksquashfs();
  if (!mksquashfs) {
    throw new BootError(
      "BOOT_MOUNTDISK_TOOL_MISSING",
      "ensureMountDiskImage: no mksquashfs binary found (no bundled " +
        "package for this platform; looked for mksquashfs on PATH and " +
        "in Homebrew's prefix). Install it:\n" +
        "  • macOS:  brew install squashfs\n" +
        "  • Linux:  apt-get install -y squashfs-tools (or your distro's package)\n" +
        "  • or set MACHINEN_MKSQUASHFS=/abs/path/to/mksquashfs to point at a vendored copy.",
    );
  }

  // Materialize into a staging file so a host crash mid-write doesn't
  // leave a torn `.sqfs` in the cache.
  const stagingDir = mkdtempSync(join(cacheDir, `${key.slice(0, 12)}-staging-`));
  const stagingImg = join(stagingDir, "lower.sqfs");
  try {
    debug("materialize key=%s host=%s", key.slice(0, 12), hostResolved);
    const mkT0 = Date.now();
    const args = [
      hostResolved,
      stagingImg,
      // Determinism: zero out the filesystem-level timestamp and the
      // per-file timestamps so the same input produces the same bytes.
      "-mkfs-time",
      "0",
      "-all-time",
      "0",
      // Quiet output and disable on-write recovery file (we own the
      // staging dir; if it dies we delete it).
      "-no-progress",
      "-no-recovery",
      // Compression: zstd matches the kernel's CONFIG_SQUASHFS_ZSTD.
      "-comp",
      "zstd",
      // Don't capture xattrs — we don't need them for the per-mount
      // payload, and skipping makes the manifest hash and the
      // mksquashfs output align (no xattr bytes vary across host fs).
      "-no-xattrs",
    ];
    const mk = spawnSync(mksquashfs, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    opts.onPhase?.("mksquashfs", Date.now() - mkT0);
    if (mk.status !== 0) {
      throw new ProvisionError(
        "PROVISION_INSTALL_HOOK_FAILED",
        `ensureMountDiskImage: ${mksquashfs} failed (code ${mk.status}): ${mk.stderr?.toString() ?? ""}`,
      );
    }

    // squashfs-tools writes a length that's a multiple of 4 KiB but
    // not always of 512. Round up to the next 512-byte sector if
    // needed — the VMM's blk.Backend asserts on the alignment.
    const renameT0 = Date.now();
    padTo512Boundary(stagingImg);
    renameSync(stagingImg, imgPath);
    opts.onPhase?.("staging-rename", Date.now() - renameT0);
    debug("materialize done key=%s img=%s", key.slice(0, 12), imgPath);
    return { lowerPath: imgPath, key };
  } finally {
    try {
      rmSync(stagingDir, { recursive: true, force: true });
    } catch {}
  }
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
  const sizeBytes = opts.sizeBytes ?? 4 * 1024 * 1024 * 1024; // 4 GiB
  if (sizeBytes <= 0 || sizeBytes % 4096 !== 0) {
    throw new BootError(
      "BOOT_MOUNT_INVALID",
      `mountDiskUpperSizeBytes must be a positive multiple of 4096 (got ${sizeBytes})`,
    );
  }
  // mke2fs lookup is shared with rootfs-img.ts.
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

  const upperPath = join(tmpdir(), `machinen-mountdisk-upper-${process.pid}-${randomSuffix()}.img`);
  allocateSparseFile(upperPath, sizeBytes);
  const blocks = Math.floor(sizeBytes / 4096);
  const r = spawnSync(mke2fs, ["-t", "ext4", "-F", "-q", "-b", "4096", upperPath, String(blocks)], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (r.status !== 0) {
    try {
      unlinkSync(upperPath);
    } catch {}
    throw new ProvisionError(
      "PROVISION_INSTALL_HOOK_FAILED",
      `ensureMountDiskUpper: ${mke2fs} failed (code ${r.status}): ${r.stderr?.toString() ?? ""}`,
    );
  }
  return { upperPath, sizeBytes };
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

function allocateSparseFile(path: string, sizeBytes: number): void {
  const fd = openSync(path, "w");
  try {
    const buf = Buffer.alloc(1);
    writeSync(fd, buf, 0, 1, sizeBytes - 1);
  } finally {
    closeSync(fd);
  }
}

/**
 * Pad a file's length up to the next multiple of 512 bytes. Squashfs
 * writes 4-KiB-aligned images, but mksquashfs sometimes emits a tail
 * that's not 512-aligned (xattr table, padding) — and the VMM's
 * blk.Backend.initFromFd asserts on `size % 512 == 0`. We grow with
 * truncate-up (sparse, free) rather than rewriting the file.
 */
function padTo512Boundary(path: string): void {
  const sz = statSync(path).size;
  const remainder = sz % 512;
  if (remainder === 0) {
    return;
  }
  const padded = sz + (512 - remainder);
  truncateSync(path, padded);
}

function randomSuffix(): string {
  // 12 hex chars is overkill for collision avoidance inside one process.
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);
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
  padTo512Boundary,
};
