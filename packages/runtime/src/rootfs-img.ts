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
//
// Prebake fast path (#223): when the release build shipped an
// already-materialized `<basename>.img.gz` next to the tarball
// (build-base-assets.sh runs mke2fs once at release time), we
// gunzip it directly into the cache instead of doing tar -xf +
// mke2fs every cold boot. Drops cold rootdisk-materialize from
// ~1100 ms to ~150 ms (gunzip-only). The cache key stays the
// tarball sha so the .ok marker, sparse-extend, and per-boot
// reflink clones (#121) all work unchanged. Falls back to the
// materialize path when no sibling is present (provision()-built
// tarballs, fixture builds) or when the sibling fails to
// decompress / lacks the ext4 magic — the fallback is invisible
// to the caller.

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
import { reflinkCopy } from "./reflink.ts";

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
  /**
   * Sub-phase callback for the caller's PhaseTimer (#233 follow-up).
   * Fires for each measurable internal step: `sha256`, `e2fsck`,
   * `sparse-extend`, `tar-extract`, `mke2fs`, `gunzip-prebake`. The
   * caller typically does `phases.mark("<parent>.${name}", ms)` so
   * the breakdown shows up alongside the parent phase.
   */
  onPhase?: (name: string, ms: number) => void;
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

  const shaT0 = Date.now();
  const sha = sha256OfFile(tarAbs);
  opts.onPhase?.("sha256", Date.now() - shaT0);
  const imgPath = join(cacheDir, `${sha}.img`);

  if (!opts.force) {
    const reused = tryReuseCachedImage(imgPath, sha, opts);
    if (reused) {
      return reused;
    }
    const prebaked = tryPrebakeFastPath(tarAbs, cacheDir, sha, imgPath, opts);
    if (prebaked) {
      return prebaked;
    }
  }

  const mke2fs = resolveMke2fsBin();
  return materializeFromTar(tarAbs, sha, mke2fs, cacheDir, imgPath, opts);
}

// #170 cache-hit path: require the clean-shutdown marker, then e2fsck
// the image, then optionally sparse-extend. Returns the image path on
// reuse, undefined on miss or unrecoverable image (the caller falls
// through to prebake / materialize).
//
// We deliberately do NOT `unlinkSync(imgPath)` here on the wipe
// paths. Concurrent callers (parallel test files, multiple `boot()`
// calls) may already hold imgPath as a cache-hit return value and
// be about to reflink from it — deleting the file out from under
// them races to ENOENT. The renameSync at the end of the materialize
// / prebake paths atomically replaces imgPath with fresh bytes, so
// the wipe is redundant; falling through is sufficient.
function tryReuseCachedImage(
  imgPath: string,
  sha: string,
  opts: EnsureRootfsImageOptions,
): string | undefined {
  if (!existsSync(imgPath)) {
    return undefined;
  }
  debug("cache hit sha=%s img=%s", sha.slice(0, 12), imgPath);
  const okPath = okMarkerPath(imgPath);
  if (!existsSync(okPath)) {
    debug("cache hit but no clean marker, will rematerialize img=%s", imgPath);
    return undefined;
  }
  // Atomically clear the marker BEFORE handing the path off, so
  // a kill between here and `markRootfsImageClean()` leaves the
  // image flagged dirty for the next boot.
  try {
    unlinkSync(okPath);
  } catch {}
  const fsckT0 = Date.now();
  const usable = cachedImageIsUsable(imgPath);
  opts.onPhase?.("e2fsck", Date.now() - fsckT0);
  if (!usable) {
    debug("cache hit unusable, will rematerialize img=%s", imgPath);
    return undefined;
  }
  growCachedImageIfRequested(imgPath, opts);
  return imgPath;
}

// #131: if the caller asked for a larger image than what's on
// disk (typically because they bumped `rootDiskSizeBytes`, or
// because the materializer's defaults grew), sparse-extend the
// file in place. The on-disk ext4 fs is still sized to the old
// file; /init's tryRootDiskPivot resizes it online via
// EXT4_IOC_RESIZE_FS so the guest sees the new capacity.
// truncate-up on a sparse file is free; truncate-down would
// chop bytes, so we never shrink.
function growCachedImageIfRequested(imgPath: string, opts: EnsureRootfsImageOptions): void {
  if (opts.sizeBytes === undefined) {
    return;
  }
  const truncT0 = Date.now();
  try {
    const cur = statSync(imgPath).size;
    if (opts.sizeBytes > cur) {
      truncateSync(imgPath, opts.sizeBytes);
      debug("cache hit grew img=%s from=%d to=%d", imgPath, cur, opts.sizeBytes);
    }
  } catch (err) {
    debug("cache hit grow failed img=%s err=%s", imgPath, (err as Error).message);
  }
  opts.onPhase?.("sparse-extend", Date.now() - truncT0);
}

// #223 + #233: prebake fast path. If a sibling `<basename>.img` (or
// `<basename>.img.gz`) sits next to the tarball, populate the cache
// from it and skip tar+mke2fs. The bytes are an ext4 image; the
// cache key (tarball sha) is the same one the materialize path
// would write to, so downstream (per-boot reflink, sparse-extend,
// .ok marker) is unchanged. The uncompressed form (emitted by
// provision()) reflinks in essentially for free; the gzipped form
// (shipped with releases) has to gunzip. Returns the image path on
// success; undefined when there's no sibling or the prebake failed
// (caller falls through to materialize — slow but always correct).
function tryPrebakeFastPath(
  tarAbs: string,
  cacheDir: string,
  sha: string,
  imgPath: string,
  opts: EnsureRootfsImageOptions,
): string | undefined {
  const sibling = siblingPrebakePath(tarAbs);
  if (!sibling || !existsSync(sibling.path)) {
    return undefined;
  }
  const prebakeT0 = Date.now();
  const fast = tryPrebakeFromSibling({
    sibling: sibling.path,
    gzipped: sibling.gzipped,
    cacheDir,
    sha,
    imgPath,
    sizeBytes: opts.sizeBytes,
  });
  opts.onPhase?.(sibling.gzipped ? "gunzip-prebake" : "reflink-prebake", Date.now() - prebakeT0);
  return fast ?? undefined;
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
function resolveMke2fsBin(): string {
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
  return mke2fs;
}

// Slow path: extract the tarball into a staging tree, size the image,
// run mke2fs over the tree, atomically rename into the cache. Cleans
// up the staging dir on any exit.
function materializeFromTar(
  tarAbs: string,
  sha: string,
  mke2fs: string,
  cacheDir: string,
  imgPath: string,
  opts: EnsureRootfsImageOptions,
): string {
  const stagingDir = mkdtempSync(join(cacheDir, `${sha.slice(0, 12)}-staging-`));
  const stagingTree = join(stagingDir, "tree");
  const stagingImg = join(stagingDir, "rootfs.img");
  mkdirSync(stagingTree, { recursive: true });
  try {
    debug("materialize sha=%s tar=%s", sha.slice(0, 12), tarAbs);

    // 1. Extract the tarball into the staging directory. tar handles
    //    both gzip and plain.
    const extractT0 = Date.now();
    extractTarball(tarAbs, stagingTree);
    opts.onPhase?.("tar-extract", Date.now() - extractT0);

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
    const mkT0 = Date.now();
    const mk = spawnSync(
      mke2fs,
      ["-d", stagingTree, "-t", "ext4", "-F", "-q", "-b", "4096", stagingImg, String(blocks)],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    opts.onPhase?.("mke2fs", Date.now() - mkT0);
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

// Resolve the prebake sibling next to a tarball. Two forms exist:
//   * `<basename>.img` — uncompressed, sparse. Emitted by `provision()`
//     (#233 follow-up): reflinks straight into the cache, near-zero
//     handoff cost. Use this when both files live on the same APFS /
//     reflink-capable volume.
//   * `<basename>.img.gz` — gzipped. Shipped by build-base-assets.sh
//     for release tarballs where download size matters more than
//     decompress speed.
// Prefer the uncompressed form when present; fall back to the gzipped
// form. Returns undefined when neither suffix matches the input path.
function siblingPrebakePath(tarAbs: string): { path: string; gzipped: boolean } | undefined {
  const m = /^(.*)(\.tar\.gz|\.tgz|\.tar)$/i.exec(tarAbs);
  if (!m) {
    return undefined;
  }
  const stem = m[1];
  const uncompressed = `${stem}.img`;
  if (existsSync(uncompressed)) {
    return { path: uncompressed, gzipped: false };
  }
  return { path: `${stem}.img.gz`, gzipped: true };
}

// Populate the cache from a prebuilt sibling. Two shapes:
//   * gzipped=true  — `<base>.img.gz` from a release build. Decompress
//                     into a staging file with `gunzip -c`.
//   * gzipped=false — `<base>.img` from `provision()`. Reflink-copy
//                     directly into the staging file (instant on APFS
//                     when the sibling and cache live on one volume).
// Either way we sniff ext4 magic before the atomic rename — a corrupt
// sibling shouldn't poison the cache. Any failure returns undefined
// and the caller falls through to the slow materialize path.
function tryPrebakeFromSibling(args: {
  sibling: string;
  gzipped: boolean;
  cacheDir: string;
  sha: string;
  imgPath: string;
  sizeBytes?: number;
}): string | undefined {
  const { sibling, gzipped, cacheDir, sha, imgPath, sizeBytes } = args;
  const stagingDir = mkdtempSync(join(cacheDir, `${sha.slice(0, 12)}-prebake-`));
  const stagingImg = join(stagingDir, "rootfs.img");
  try {
    debug("prebake try sibling=%s gzipped=%s sha=%s", sibling, gzipped, sha.slice(0, 12));
    if (gzipped) {
      const dstFd = openSync(stagingImg, "w");
      let gunzipOk = false;
      try {
        const r = spawnSync("gunzip", ["-c", sibling], {
          stdio: ["ignore", dstFd, "pipe"],
        });
        gunzipOk = r.status === 0;
        if (!gunzipOk) {
          debug(
            "prebake gunzip failed sibling=%s status=%s stderr=%s",
            sibling,
            r.status,
            r.stderr?.toString().slice(0, 200) ?? "",
          );
        }
      } finally {
        closeSync(dstFd);
      }
      if (!gunzipOk) {
        return undefined;
      }
    } else {
      try {
        reflinkCopy(sibling, stagingImg);
      } catch (err) {
        debug("prebake reflink failed sibling=%s err=%s", sibling, (err as Error).message);
        return undefined;
      }
    }
    // Sniff ext4 magic so a corrupted / wrong-content sibling can't
    // pollute the cache. We don't run e2fsck here — the build
    // pipeline already produced a clean fs, and a host crash this
    // soon after rename is rare enough that the .ok marker handles
    // it on the next boot.
    if (!looksLikeExt4(stagingImg)) {
      debug("prebake sibling did not yield an ext4 image — falling back");
      return undefined;
    }
    // #131: sparse-extend in place if the caller wants more headroom
    // than the prebuilt image's native size.
    if (sizeBytes !== undefined) {
      const cur = statSync(stagingImg).size;
      if (sizeBytes > cur) {
        truncateSync(stagingImg, sizeBytes);
      }
    }
    renameSync(stagingImg, imgPath);
    debug("prebake done sha=%s img=%s", sha.slice(0, 12), imgPath);
    return imgPath;
  } catch (err) {
    debug("prebake error sibling=%s err=%s", sibling, (err as Error).message);
    return undefined;
  } finally {
    try {
      rmSync(stagingDir, { recursive: true, force: true });
    } catch {}
  }
}

// Extract `tarPath` into `dest` with mode-bit fidelity.
//
// `-p` (--preserve-permissions) matters: BSD tar (the macOS default)
// applies the host umask when extracting as non-root, which silently
// drops the sticky bit and other "extra" mode bits declared in the
// archive. /tmp ships at 1777 in our base rootfs but extracts as 0755
// without -p, which bakes into the ext4 image and breaks `apt-get`
// in the booted guest — apt drops to the `_apt` user for fetches and
// can't write to /tmp, so apt-key fails and Release files look
// unsigned (#262). GNU tar treats -p as a no-op for non-root (umask
// is already not applied there), so adding it is safe on every host.
function extractTarball(tarPath: string, dest: string): void {
  const r = spawnSync("tar", ["-xpf", tarPath, "-C", dest], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (r.status !== 0) {
    throw new ProvisionError(
      "PROVISION_INSTALL_HOOK_FAILED",
      `ensureRootfsImage: tar -xpf failed (code ${r.status}): ${r.stderr?.toString() ?? ""}`,
    );
  }
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
 * Resolve the mke2fs binary path using the same lookup order as
 * `ensureRootfsImage` itself: env override → bundled package → PATH →
 * Homebrew keg-only. Returns `undefined` when no binary is available
 * (callers should treat this as "skip the optimization", not an error).
 *
 * Exported so `provision()` can prebake an `<out>.img.gz` sibling
 * alongside its `<out>.tar.gz` output (#233 follow-up). Without that,
 * every fresh `provision()` invalidates the cached `<sha>.img` and the
 * next `boot()` pays ~10 s for tar-extract + mke2fs.
 */
export function resolveMke2fs(): string | undefined {
  const names = ["mke2fs", "mkfs.ext4"];
  return (
    resolveMke2fsEnvOverride() ?? findBundledMke2fs() ?? whichFirst(names) ?? findKegOnlyE2fs(names)
  );
}

// Visible to tests that want to assert without invoking the real
// materializer.
export const _rootfsImgInternal = {
  sha256OfFile,
  whichFirst,
  cachedImageIsUsable,
  looksLikeExt4,
  findKegOnlyE2fs,
  findBundledMke2fs,
  resolveMke2fsEnvOverride,
  okMarkerPath,
  siblingPrebakePath,
  extractTarball,
};
