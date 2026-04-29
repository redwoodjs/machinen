// Materialize a `.tar.gz` rootfs into an ext4 `.img` and cache the
// result, keyed by sha256 of the tarball.
//
// Architectural shape (#114):
//   * Wire format / `provision()` output stays `.tar.gz` — compressible,
//     deterministic, easy to ship.
//   * Runtime materializes a per-tarball `.img` on first boot and
//     re-uses it on subsequent boots. The kernel pages the rootfs in
//     on demand from the disk instead of inflating the whole tree into
//     a RAM-backed tmpfs.
//
// Cache layout:
//   ~/.cache/machinen/rootfs/<sha256>.img         ← cached image
//   ~/.cache/machinen/rootfs/<sha256>.staging/    ← in-progress (atomic
//                                                  rename on success)
//
// Materialization is synchronous and uses the host's `mke2fs -d`
// (e2fsprogs) to write an ext4 image directly from a staging directory
// — no privileged loop mount required. On hosts that don't ship the
// tool the function throws with a clear install hint; the runtime
// falls back to the legacy initramfs-as-rootfs path in that case.
//
// Cache-hit safety (#134): the cached `.img` is the same file the
// guest writes to via virtio-blk. If the previous VMM died mid-write
// (kill -9, host crash, panic), the ext4 journal is left half-applied
// and the next mount fails with "JBD2: Invalid checksum recovering
// data block … / EXT4-fs (vda): error loading journal". Without
// intervention every future boot of the same image hits the same
// broken file. Before returning a cache-hit path we run `e2fsck -fy`
// so any unreplayable journal / orphaned-inode state gets fixed (or,
// if it can't be fixed, the file is wiped and rematerialized from
// the tarball).
//
// Clean-shutdown sentinel (#170): e2fsck handles the journal but
// not torn data-block writes. A test killed mid-`apt`/`pnpm` can
// leave bytes inside the ext4 fs that fsck declares clean yet the
// kernel later faults on with `EXT4-fs error … checksumming
// directory block` at runtime. We pair the cache file with a
// sibling marker `<sha>.img.ok` whose presence means "the previous
// owner exited cleanly." On entry the marker is atomically removed
// before the path is handed to the VMM; on a clean child exit the
// runtime calls `markRootfsImageClean()` to recreate it. A cache
// hit with no marker is treated as poisoned — wiped and
// rematerialized from the tarball.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { arch, homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import debugLib from "debug";
import { ProvisionError } from "./errors.ts";

const debug = debugLib("machinen:rootfs-img");

/** Default cache root: `~/.cache/machinen/rootfs`. */
export function rootfsImgCacheDir(): string {
  return join(homedir(), ".cache", "machinen", "rootfs");
}

function okMarkerPath(imgPath: string): string {
  return `${imgPath}.ok`;
}

/**
 * Mark a cached rootfs image as "cleanly released" by writing the
 * sentinel that `ensureRootfsImage()` looks for on the next boot.
 * Called by the runtime after a VMM child exits without a signal —
 * an exit-code-only termination means the kernel had time to flush
 * and dismount the ext4 fs, so reusing the file is safe.
 *
 * No-op if the image doesn't exist (e.g. the runtime never
 * materialized one). Failures are swallowed: a missing marker just
 * means the next boot rebuilds from the tarball, which is wasteful
 * but never wrong.
 */
export function markRootfsImageClean(imgPath: string): void {
  if (!existsSync(imgPath)) {
    return;
  }
  const okPath = okMarkerPath(imgPath);
  // tmp + fsync + atomic rename so the marker is durable. If the
  // host crashes between rename and the next reboot, we still see
  // a complete `.ok` file rather than a half-written one.
  const tmp = `${okPath}.tmp.${process.pid}`;
  let fd = -1;
  try {
    fd = openSync(tmp, "w");
    fsyncSync(fd);
    closeSync(fd);
    fd = -1;
    renameSync(tmp, okPath);
  } catch (err) {
    debug("markRootfsImageClean failed img=%s err=%s", imgPath, (err as Error).message);
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

export interface EnsureRootfsImageOptions {
  /**
   * Override the cache directory. Default: `~/.cache/machinen/rootfs`.
   * Useful for tests.
   */
  cacheDir?: string;
  /**
   * Force re-materialization even if a cached image is already present.
   * Mostly for debugging the materializer.
   */
  force?: boolean;
  /**
   * Slack multiplier above the unpacked tarball size when sizing the
   * ext4 filesystem. Default: 2.5 — leaves enough room for the guest
   * to install a few hundred MB of packages on top of the base rootfs
   * before hitting ENOSPC. Sparse files cost nothing on disk until
   * written, so over-provisioning is essentially free; the trade-off
   * is a higher upper bound on physical disk use if the guest decides
   * to fill the filesystem.
   */
  sizeMultiplier?: number;
  /**
   * Minimum image size in bytes. The materializer enforces at least
   * this for small rootfs where the multiplier alone would leave
   * insufficient room for a real workload. Default: 2 GiB — boot-time
   * `npm install -g <large package>`, `apt install`, etc. land here
   * (#131). Sparse, so unused capacity is free.
   */
  minSizeBytes?: number;
  /**
   * Absolute target size in bytes. When set, overrides `sizeMultiplier`
   * and `minSizeBytes` entirely — fresh materializations get exactly
   * this size, cached `.img`s smaller than this are sparse-extended
   * (truncate(2)) so the next boot's online ext4 grow can fill them.
   * For the user-facing `boot({ rootDiskSizeBytes })` knob (#131).
   */
  sizeBytes?: number;
}

/**
 * Resolve `tarPath` to a cached ext4 `.img`, materializing it on first
 * call. Returns the absolute path to the cached image.
 *
 * Cache key: sha256 of the tarball. Same tarball → same image, even
 * across runs and processes. Concurrent callers do not race because
 * we materialize into a uniquely-named staging directory and atomically
 * rename into place — at worst two callers do redundant work; the
 * loser of the rename race re-checks and uses the winner's image.
 *
 * Lifecycle (#170): the returned path is handed back in the "in-use"
 * state (no `.ok` marker on disk). The caller is expected to invoke
 * `markRootfsImageClean(path)` once they're done — `boot()` does this
 * from its child-exit handler when the VMM exits without a signal,
 * `provision()` does it after cloning the image read-only. If the
 * marker is never recreated (caller crashed mid-write or simply
 * forgot), the next `ensureRootfsImage()` for the same tarball
 * treats the image as poisoned and rebuilds it.
 *
 * @throws {ProvisionError} ROOTFS_IMG_TOOL_MISSING (no e2fsprogs found)
 *   | PROVISION_BASE_NOT_FOUND (tarball missing) |
 *   PROVISION_INSTALL_HOOK_FAILED (tar / mke2fs failed)
 */
export function ensureRootfsImage(tarPath: string, opts: EnsureRootfsImageOptions = {}): string {
  const tarAbs = resolve(tarPath);
  if (!existsSync(tarAbs)) {
    throw new ProvisionError(
      "PROVISION_BASE_NOT_FOUND",
      `ensureRootfsImage: tarball not found at ${tarAbs}`,
    );
  }
  const cacheDir = opts.cacheDir ?? rootfsImgCacheDir();
  mkdirSync(cacheDir, { recursive: true });

  const sha = sha256OfFile(tarAbs);
  const imgPath = join(cacheDir, `${sha}.img`);
  const okPath = okMarkerPath(imgPath);
  if (!opts.force && existsSync(imgPath)) {
    debug("cache hit sha=%s img=%s", sha.slice(0, 12), imgPath);
    // #170: require the clean-shutdown marker. Missing means the
    // previous VMM was killed mid-write — fsck won't catch torn data
    // blocks, so treat the image as poisoned and rebuild from the
    // tarball.
    if (!existsSync(okPath)) {
      debug("cache hit but no clean marker, wiping img=%s", imgPath);
      try {
        unlinkSync(imgPath);
      } catch {}
    } else {
      // Atomically clear the marker BEFORE handing the path off, so
      // a kill between here and `markRootfsImageClean()` leaves the
      // image flagged dirty for the next boot.
      try {
        unlinkSync(okPath);
      } catch {}
      if (cachedImageIsUsable(imgPath)) {
        // #131: if the caller asked for a larger image than what's on
        // disk (typically because they bumped `rootDiskSizeBytes`, or
        // because the materializer's defaults grew), sparse-extend the
        // file in place. The on-disk ext4 fs is still sized to the old
        // file; /init's tryRootDiskPivot resizes it online via
        // EXT4_IOC_RESIZE_FS so the guest sees the new capacity.
        // truncate-up on a sparse file is free; truncate-down would
        // chop bytes, so we never shrink.
        if (opts.sizeBytes !== undefined) {
          try {
            const cur = statSync(imgPath).size;
            if (opts.sizeBytes > cur) {
              truncateSync(imgPath, opts.sizeBytes);
              debug("cache hit grew img=%s from=%d to=%d", imgPath, cur, opts.sizeBytes);
            }
          } catch (err) {
            debug("cache hit grow failed img=%s err=%s", imgPath, (err as Error).message);
          }
        }
        return imgPath;
      }
      // Unrecoverable. Wipe and fall through to materialize a fresh image
      // from the tarball — same path a force=true caller would take.
      debug("cache hit unusable, wiping img=%s", imgPath);
      try {
        unlinkSync(imgPath);
      } catch {}
    }
  }

  // Resolve mke2fs in four steps:
  //   1. `MACHINEN_MKE2FS` env override — for users pinning a specific
  //      build (e.g. a debug binary, or a vendored copy outside the
  //      bundled package). Mirrors `MACHINEN_VMM` / `MACHINEN_GVPROXY`.
  //   2. The bundled `@machinen/e2fsprogs-<arch>-<os>` package (zero
  //      user setup, present in normal installs). Each arch package
  //      declares matching `os` + `cpu` so npm/pnpm only installs the
  //      one that fits the host.
  //   3. PATH (for hosts that have e2fsprogs installed system-wide).
  //   4. Homebrew's keg-only prefix on macOS (#124) — `brew install
  //      e2fsprogs` deliberately doesn't symlink mke2fs onto PATH.
  const names = ["mke2fs", "mkfs.ext4"];
  const mke2fs =
    resolveMke2fsEnvOverride() ??
    findBundledMke2fs() ??
    whichFirst(names) ??
    findKegOnlyE2fs(names);
  if (!mke2fs) {
    throw new ProvisionError(
      "ROOTFS_IMG_TOOL_MISSING",
      "ensureRootfsImage: no e2fsprogs binary found (no bundled package " +
        "for this platform; looked for mke2fs / mkfs.ext4 on PATH and in " +
        "Homebrew's keg-only prefix). Install it:\n" +
        "  • macOS:  brew install e2fsprogs\n" +
        "            (e2fsprogs is keg-only on Homebrew; machinen also " +
        "probes /opt/homebrew/opt/e2fsprogs/sbin and " +
        "/usr/local/opt/e2fsprogs/sbin automatically)\n" +
        "  • Linux:  apt-get install -y e2fsprogs (or your distro's package)\n" +
        "  • or set MACHINEN_MKE2FS=/abs/path/to/mke2fs to point at a vendored copy\n" +
        "  • or skip virtio-blk root and let boot() use the legacy " +
        "initramfs-as-rootfs path.",
    );
  }

  const stagingDir = mkdtempSync(join(cacheDir, `${sha.slice(0, 12)}-staging-`));
  const stagingTree = join(stagingDir, "tree");
  const stagingImg = join(stagingDir, "rootfs.img");
  mkdirSync(stagingTree, { recursive: true });
  try {
    debug("materialize sha=%s tar=%s", sha.slice(0, 12), tarAbs);

    // 1. Extract the tarball into the staging directory. tar handles
    //    both gzip and plain.
    const extract = spawnSync("tar", ["-xf", tarAbs, "-C", stagingTree], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (extract.status !== 0) {
      throw new ProvisionError(
        "PROVISION_INSTALL_HOOK_FAILED",
        `ensureRootfsImage: tar -xf failed (code ${extract.status}): ${extract.stderr?.toString() ?? ""}`,
      );
    }

    // 2. Size the image. Three-way:
    //    - sizeBytes wins outright when the caller passes it (the
    //      user-facing rootDiskSizeBytes override; #131).
    //    - Otherwise, max(minSizeBytes, treeBytes * sizeMultiplier).
    //    Sparse files cost nothing on disk until written, so over-
    //    provisioning the upper bound here is essentially free; the
    //    guest's online ext4 grow (in /init) makes any extra capacity
    //    visible without a rematerialize.
    const treeBytes = duBytes(stagingTree);
    const multiplier = opts.sizeMultiplier ?? 2.5;
    const minBytes = opts.minSizeBytes ?? 2 * 1024 * 1024 * 1024;
    const sizeBytes = opts.sizeBytes ?? Math.max(minBytes, Math.ceil(treeBytes * multiplier));
    debug(
      "size tree=%d size=%d multiplier=%s explicit=%s",
      treeBytes,
      sizeBytes,
      multiplier,
      opts.sizeBytes !== undefined,
    );
    allocateSparseFile(stagingImg, sizeBytes);

    // 3. mke2fs -d <tree> -t ext4 -F <img> <size-in-blocks>. The 4-KiB
    //    block size matches the kernel's default page size on arm64
    //    so reads are page-cache-aligned.
    const blocks = Math.floor(sizeBytes / 4096);
    const mk = spawnSync(
      mke2fs,
      ["-d", stagingTree, "-t", "ext4", "-F", "-q", "-b", "4096", stagingImg, String(blocks)],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    if (mk.status !== 0) {
      throw new ProvisionError(
        "PROVISION_INSTALL_HOOK_FAILED",
        `ensureRootfsImage: ${mke2fs} failed (code ${mk.status}): ${mk.stderr?.toString() ?? ""}`,
      );
    }

    // 4. Atomic rename into the cache. Concurrent materializers can
    //    race here; the second `rename` clobbers the first, but both
    //    files have identical content (same sha), so it doesn't
    //    matter who wins.
    renameSync(stagingImg, imgPath);
    debug("materialize done sha=%s img=%s sizeBytes=%d", sha.slice(0, 12), imgPath, sizeBytes);
    return imgPath;
  } finally {
    try {
      rmSync(stagingDir, { recursive: true, force: true });
    } catch {}
  }
}

// Decide whether a cache-hit `.img` is safe to hand back to virtio-blk.
//
// `e2fsck -fy <img>` does the heavy lifting: replays the journal, fixes
// orphaned inodes / cross-linked blocks, and exits 0 (clean) or 1/2
// (errors corrected, no manual intervention required) when the image
// is recoverable. Any other exit code (4 = uncorrected errors,
// 8 = operational error, …) means the image is unusable; the caller
// wipes it and rematerializes from the tarball.
//
// Pre-flights:
//   * Skip when the file doesn't carry the ext4 superblock magic.
//     Lets test fixtures plant arbitrary bytes at the cache path
//     without tripping fsck, and matches the legacy behavior of
//     trusting whatever's in the cache for non-ext4 layouts.
//   * Skip when no `e2fsck` is on PATH. Cache hits historically didn't
//     require e2fsprogs (you could pre-bake a `.img` and drop it in);
//     we don't want to regress that. Hosts that DO ship e2fsprogs get
//     the corruption recovery for free.
function cachedImageIsUsable(imgPath: string): boolean {
  if (!looksLikeExt4(imgPath)) {
    return true;
  }
  const e2fsck = whichFirst(["e2fsck"]);
  if (!e2fsck) {
    debug("no e2fsck on PATH; trusting cached img=%s", imgPath);
    return true;
  }
  // -f forces a full check even when the superblock is marked clean
  // (a half-applied journal is invisible to the cleanliness flag).
  // -y answers yes to every prompt so the call is non-interactive.
  const r = spawnSync(e2fsck, ["-fy", imgPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Exit codes per e2fsck(8): 0 = no errors, 1 = errors corrected,
  // 2 = errors corrected (reboot suggested — host kernel doesn't care).
  // Anything else = unusable.
  if (r.status === 0 || r.status === 1 || r.status === 2) {
    return true;
  }
  debug(
    "e2fsck rejected img=%s status=%s stderr=%s",
    imgPath,
    r.status,
    r.stderr?.toString().slice(0, 200) ?? "",
  );
  return false;
}

// Sniff the ext4 superblock magic at offset 1080 (1024-byte superblock
// offset + 0x38 byte offset of `s_magic` inside it). Cheap to do and
// avoids a fork+exec for files that obviously aren't ext4.
function looksLikeExt4(path: string): boolean {
  let fd = -1;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(2);
    const nread = readSync(fd, buf, 0, 2, 1080);
    if (nread !== 2) {
      return false;
    }
    return buf.readUInt16LE(0) === 0xef53;
  } catch {
    return false;
  } finally {
    if (fd >= 0) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

function sha256OfFile(path: string): string {
  // Streaming hash — these tarballs are big (hundreds of MB) and we
  // call this on every boot in the cache-hit path.
  const h = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    while (true) {
      const nread = readSync(fd, buf, 0, buf.length, null);
      if (nread <= 0) {
        break;
      }
      h.update(buf.subarray(0, nread));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
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

// Homebrew installs e2fsprogs keg-only because mkfs.ext4 / mke2fs would
// shadow the BSD newfs_* family. The binaries land here instead of on
// PATH, so users who run the recommended `brew install` see "not found"
// errors anyway. Probe these prefixes directly so the install Just Works.
const KEG_ONLY_E2FS_DIRS = [
  "/opt/homebrew/opt/e2fsprogs/sbin", // Apple Silicon
  "/usr/local/opt/e2fsprogs/sbin", // Intel
];

function findKegOnlyE2fs(
  names: string[],
  dirs: readonly string[] = KEG_ONLY_E2FS_DIRS,
): string | undefined {
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

// Honor `MACHINEN_MKE2FS` so users can pin a specific binary without
// reaching for the bundled / PATH / keg-only fallbacks. An override
// that points at nothing is a user mistake — surface it loudly rather
// than silently falling through to the next step.
function resolveMke2fsEnvOverride(): string | undefined {
  const envOverride = process.env.MACHINEN_MKE2FS;
  if (!envOverride) {
    return undefined;
  }
  if (existsSync(envOverride)) {
    debug("resolved via MACHINEN_MKE2FS=%s", envOverride);
    return envOverride;
  }
  throw new ProvisionError(
    "ROOTFS_IMG_TOOL_MISSING",
    `MACHINEN_MKE2FS=${envOverride} is set but that file does not exist.`,
  );
}

// Look for `@machinen/e2fsprogs-<arch>-<os>`, our optional per-arch
// binary package. npm/pnpm install only the package whose `os` + `cpu`
// match the host, so a successful resolve means the binary is on disk
// and runnable here. Avoids the host-install dance for every user.
const require_ = createRequire(import.meta.url);

function findBundledMke2fs(): string | undefined {
  const pkg = `@machinen/e2fsprogs-${arch()}-${platform()}`;
  try {
    const pkgJson = require_.resolve(`${pkg}/package.json`);
    const candidate = join(dirname(pkgJson), "bin", "mke2fs");
    if (existsSync(candidate)) {
      return candidate;
    }
  } catch {
    // Optional dep not installed for this arch+os — fall through.
  }
  return undefined;
}

function duBytes(path: string): number {
  // `du -sk` returns size-on-disk in 1-KiB blocks. Faster than walking
  // ourselves and works on both GNU and BSD du.
  try {
    const out = execFileSync("du", ["-sk", path], { encoding: "utf8" }).trim();
    const kib = parseInt(out.split(/\s+/, 1)[0]!, 10);
    if (Number.isFinite(kib) && kib > 0) {
      return kib * 1024;
    }
  } catch {}
  // Fallback: stat the directory itself (won't be accurate for trees).
  return statSync(path).size || 0;
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

// Visible to tests that want to assert without invoking the real
// materializer.
export const _internal = {
  sha256OfFile,
  whichFirst,
  cachedImageIsUsable,
  looksLikeExt4,
  findKegOnlyE2fs,
  findBundledMke2fs,
  resolveMke2fsEnvOverride,
  okMarkerPath,
};
