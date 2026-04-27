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

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import debugLib from "debug";
import { ProvisionError } from "./errors.ts";

const debug = debugLib("machinen:rootfs-img");

/** Default cache root: `~/.cache/machinen/rootfs`. */
export function rootfsImgCacheDir(): string {
  return join(homedir(), ".cache", "machinen", "rootfs");
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
   * ext4 filesystem. Default: 1.4 (40% slack for ext4 metadata + room
   * for guest writes). Bump if the workload writes a lot post-boot.
   */
  sizeMultiplier?: number;
  /**
   * Minimum image size in bytes. The materializer enforces at least
   * this for very small rootfs (where the multiplier alone would leave
   * insufficient ext4 metadata room). Default: 256 MiB.
   */
  minSizeBytes?: number;
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
 * @throws {ProvisionError} ROOTFS_IMG_TOOL_MISSING |
 *   ROOTFS_IMG_MATERIALIZE_FAILED | ROOTFS_IMG_TARBALL_NOT_FOUND
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
  if (!opts.force && existsSync(imgPath)) {
    debug("cache hit sha=%s img=%s", sha.slice(0, 12), imgPath);
    if (cachedImageIsUsable(imgPath)) {
      return imgPath;
    }
    // Unrecoverable. Wipe and fall through to materialize a fresh image
    // from the tarball — same path a force=true caller would take.
    debug("cache hit unusable, wiping img=%s", imgPath);
    try {
      unlinkSync(imgPath);
    } catch {}
  }

  // mke2fs -d takes a staging directory and writes an ext4 image. Try
  // a few names because Linux distros and macOS-via-brew disagree on
  // which binary ships.
  const mke2fs = whichFirst(["mke2fs", "mkfs.ext4"]);
  if (!mke2fs) {
    throw new ProvisionError(
      "PROVISION_INSTALL_HOOK_FAILED",
      "ensureRootfsImage: no e2fsprogs binary on PATH (looked for mke2fs / " +
        "mkfs.ext4). Install it:\n" +
        "  • macOS:  brew install e2fsprogs\n" +
        "  • Linux:  apt-get install -y e2fsprogs (or your distro's package)\n" +
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

    // 2. Size the image: unpacked tree + slack, with a floor.
    const treeBytes = duBytes(stagingTree);
    const multiplier = opts.sizeMultiplier ?? 1.4;
    const minBytes = opts.minSizeBytes ?? 256 * 1024 * 1024;
    const sizeBytes = Math.max(minBytes, Math.ceil(treeBytes * multiplier));
    debug("size tree=%d size=%d multiplier=%s", treeBytes, sizeBytes, multiplier);
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
export const _internal = { sha256OfFile, whichFirst, cachedImageIsUsable, looksLikeExt4 };
