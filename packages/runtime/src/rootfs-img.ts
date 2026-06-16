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
import { join, resolve } from "node:path";
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
  /**
   * Sub-phase callback for the caller's PhaseTimer (#233 follow-up).
   * Fires for each measurable internal step: `sha256`, `e2fsck`,
   * `sparse-extend`, `tar-extract`, `mke2fs`, `gunzip-prebake`. The
   * caller typically does `phases.mark("<parent>.${name}", ms)` so
   * the breakdown shows up alongside the parent phase.
   */
  onPhase?: (name: string, ms: number) => void;
}

interface RootfsCachePaths {
  tarAbs: string;
  cacheDir: string;
  sha: string;
  imgPath: string;
  okPath: string;
}

interface RootfsStagingPaths {
  stagingDir: string;
  stagingTree: string;
  stagingImg: string;
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
  const paths = resolveRootfsCachePaths(tarPath, opts);
  return (
    tryReusableCachedRootfs(paths, opts) ??
    tryPrebakedRootfs(paths, opts) ??
    materializeRootfsFromTar(paths, opts, resolveMke2fsOrThrow())
  );
}

function resolveRootfsCachePaths(
  tarPath: string,
  opts: EnsureRootfsImageOptions,
): RootfsCachePaths {
  const tarAbs = resolve(tarPath);
  if (!existsSync(tarAbs)) {
    throw new ProvisionError(
      "PROVISION_BASE_NOT_FOUND",
      `ensureRootfsImage: tarball not found at ${tarAbs}`,
    );
  }
  const cacheDir = opts.cacheDir ?? rootfsImgCacheDir();
  const cacheDirT0 = Date.now();
  mkdirSync(cacheDir, { recursive: true });
  opts.onPhase?.("cache-dir", Date.now() - cacheDirT0);

  const shaT0 = Date.now();
  const sha = sha256OfFile(tarAbs);
  opts.onPhase?.("sha256", Date.now() - shaT0);
  const imgPath = join(cacheDir, `${sha}.img`);
  return { tarAbs, cacheDir, sha, imgPath, okPath: okMarkerPath(imgPath) };
}

function tryReusableCachedRootfs(
  paths: RootfsCachePaths,
  opts: EnsureRootfsImageOptions,
): string | undefined {
  const probeT0 = Date.now();
  const cachePresent = !opts.force && existsSync(paths.imgPath);
  opts.onPhase?.("cache-probe", Date.now() - probeT0);
  if (!cachePresent) {
    return undefined;
  }
  debug("cache hit sha=%s img=%s", paths.sha.slice(0, 12), paths.imgPath);
  if (!cachedImageHasCleanMarker(paths, opts)) {
    return undefined;
  }
  const markInUseT0 = Date.now();
  markCachedImageInUse(paths.okPath);
  opts.onPhase?.("cache-mark-in-use", Date.now() - markInUseT0);
  if (!fsckCachedRootfs(paths.imgPath, opts)) {
    debug("cache hit unusable, will rematerialize img=%s", paths.imgPath);
    return undefined;
  }
  growCachedRootfsIfRequested(paths.imgPath, opts);
  return paths.imgPath;
}

function cachedImageHasCleanMarker(
  paths: RootfsCachePaths,
  opts: EnsureRootfsImageOptions,
): boolean {
  const markerT0 = Date.now();
  const hasMarker = existsSync(paths.okPath);
  opts.onPhase?.("cache-clean-marker", Date.now() - markerT0);
  if (hasMarker) {
    return true;
  }
  debug("cache hit but no clean marker, will rematerialize img=%s", paths.imgPath);
  return false;
}

function markCachedImageInUse(okPath: string): void {
  // Atomically clear the marker BEFORE handing the path off, so a kill
  // before markRootfsImageClean() leaves the image flagged dirty.
  try {
    unlinkSync(okPath);
  } catch {}
}

function fsckCachedRootfs(imgPath: string, opts: EnsureRootfsImageOptions): boolean {
  const fsckT0 = Date.now();
  const usable = cachedImageIsUsable(imgPath);
  opts.onPhase?.("e2fsck", Date.now() - fsckT0);
  return usable;
}

function growCachedRootfsIfRequested(imgPath: string, opts: EnsureRootfsImageOptions): void {
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

function tryPrebakedRootfs(
  paths: RootfsCachePaths,
  opts: EnsureRootfsImageOptions,
): string | undefined {
  if (opts.force) {
    return undefined;
  }
  const siblingProbeT0 = Date.now();
  const sibling = siblingPrebakePath(paths.tarAbs);
  const siblingExists = Boolean(sibling && existsSync(sibling));
  opts.onPhase?.("prebake-probe", Date.now() - siblingProbeT0);
  if (!sibling || !siblingExists) {
    return undefined;
  }
  const prebakeT0 = Date.now();
  const fast = tryPrebakeFromSibling({
    sibling,
    cacheDir: paths.cacheDir,
    sha: paths.sha,
    imgPath: paths.imgPath,
    sizeBytes: opts.sizeBytes,
  });
  opts.onPhase?.("gunzip-prebake", Date.now() - prebakeT0);
  return fast;
}

function resolveMke2fsOrThrow(): string {
  const mke2fs = resolveMke2fs();
  if (mke2fs) {
    return mke2fs;
  }
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

function materializeRootfsFromTar(
  paths: RootfsCachePaths,
  opts: EnsureRootfsImageOptions,
  mke2fs: string,
): string {
  const stagingT0 = Date.now();
  const staging = createRootfsStaging(paths);
  opts.onPhase?.("staging-create", Date.now() - stagingT0);
  try {
    debug("materialize sha=%s tar=%s", paths.sha.slice(0, 12), paths.tarAbs);
    extractRootfsTarball(paths.tarAbs, staging.stagingTree, opts);
    const sizeBytes = sizeRootfsImage(staging.stagingTree, opts);
    const allocT0 = Date.now();
    allocateSparseFile(staging.stagingImg, sizeBytes);
    opts.onPhase?.("sparse-allocate", Date.now() - allocT0);
    runMke2fs(mke2fs, staging.stagingTree, staging.stagingImg, sizeBytes, opts);
    const renameT0 = Date.now();
    renameSync(staging.stagingImg, paths.imgPath);
    opts.onPhase?.("rename", Date.now() - renameT0);
    debug(
      "materialize done sha=%s img=%s sizeBytes=%d",
      paths.sha.slice(0, 12),
      paths.imgPath,
      sizeBytes,
    );
    return paths.imgPath;
  } finally {
    const cleanupT0 = Date.now();
    try {
      rmSync(staging.stagingDir, { recursive: true, force: true });
    } catch {}
    opts.onPhase?.("staging-cleanup", Date.now() - cleanupT0);
  }
}

function createRootfsStaging(paths: RootfsCachePaths): RootfsStagingPaths {
  const stagingDir = mkdtempSync(join(paths.cacheDir, `${paths.sha.slice(0, 12)}-staging-`));
  const stagingTree = join(stagingDir, "tree");
  mkdirSync(stagingTree, { recursive: true });
  return { stagingDir, stagingTree, stagingImg: join(stagingDir, "rootfs.img") };
}

function extractRootfsTarball(
  tarAbs: string,
  stagingTree: string,
  opts: EnsureRootfsImageOptions,
): void {
  const extractT0 = Date.now();
  extractTarball(tarAbs, stagingTree);
  opts.onPhase?.("tar-extract", Date.now() - extractT0);
}

function sizeRootfsImage(stagingTree: string, opts: EnsureRootfsImageOptions): number {
  const sizeT0 = Date.now();
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
  opts.onPhase?.("size", Date.now() - sizeT0);
  return sizeBytes;
}

function runMke2fs(
  mke2fs: string,
  stagingTree: string,
  stagingImg: string,
  sizeBytes: number,
  opts: EnsureRootfsImageOptions,
): void {
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

// Look up `mke2fs` from `@machinen/native-<arch>-<os>`, the consolidated
// host-tool package. npm/pnpm install only the package whose `os` +
// `cpu` match the host, so a successful resolve of its `mke2fs` export
// means the binary is on disk and runnable here. Avoids the
// host-install dance for every user.
const require_ = createRequire(import.meta.url);

function findBundledMke2fs(): string | undefined {
  const pkg = `@machinen/native-${arch()}-${platform()}`;
  try {
    const mod = require_(pkg) as { mke2fs?: string };
    if (mod.mke2fs && existsSync(mod.mke2fs)) {
      return mod.mke2fs;
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

// Resolve the prebake sibling next to a tarball. Only one form is
// supported: `<basename>.img.gz` — gzipped ext4 image, shipped by
// build-base-assets.sh for release tarballs where download size
// matters more than decompress speed. Returns undefined when the
// input path doesn't end in a recognized tarball suffix.
//
// `provision()` no longer emits an uncompressed sibling; it writes
// the prebake straight into the runtime cache via
// `prebakeRootfsImageFromTree()` instead.
function siblingPrebakePath(tarAbs: string): string | undefined {
  const m = /^(.*)(\.tar\.gz|\.tgz|\.tar)$/i.exec(tarAbs);
  if (!m) {
    return undefined;
  }
  return `${m[1]}.img.gz`;
}

// Populate the cache from a release-built `<base>.img.gz` sibling.
// Decompresses into a staging file with `gunzip -c`, sniffs ext4
// magic so a corrupt sibling can't poison the cache, then atomically
// renames into place. Any failure returns undefined and the caller
// falls through to the slow materialize path.
function tryPrebakeFromSibling(args: {
  sibling: string;
  cacheDir: string;
  sha: string;
  imgPath: string;
  sizeBytes?: number;
}): string | undefined {
  const { sibling, cacheDir, sha, imgPath, sizeBytes } = args;
  const stagingDir = mkdtempSync(join(cacheDir, `${sha.slice(0, 12)}-prebake-`));
  const stagingImg = join(stagingDir, "rootfs.img");
  try {
    debug("prebake try sibling=%s sha=%s", sibling, sha.slice(0, 12));
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
 * Exported so other tools that need to run mke2fs (e.g. `mountdisk-img`)
 * resolve the binary through the same lookup chain.
 */
export function resolveMke2fs(): string | undefined {
  const names = ["mke2fs", "mkfs.ext4"];
  return (
    resolveMke2fsEnvOverride() ?? findBundledMke2fs() ?? whichFirst(names) ?? findKegOnlyE2fs(names)
  );
}

/**
 * Pre-populate the runtime cache image for `tarPath` from an already-
 * extracted source `treeDir`, skipping the materialize path on the
 * next `ensureRootfsImage()` for the same tarball. Called by
 * `provision()` right after it writes the tarball — re-uses the
 * staging tree it has on hand so the cost is just one mke2fs pass
 * (~3 s) instead of tar-extract + mke2fs (~10 s) on first boot.
 *
 * Hashes the tarball to derive the cache key, runs mke2fs on
 * `treeDir` directly into a staging file under the cache, atomically
 * renames into `<cacheDir>/<sha>.img`, then writes the `.ok` clean-
 * shutdown marker (the freshly-built fs has never been mounted, so
 * it's clean by definition).
 *
 * Best-effort: no mke2fs binary, mke2fs error, or hash failure is
 * logged and swallowed; the next boot just pays the cold materialize
 * cost. Skipped entirely when a usable cache image already exists
 * for this sha — avoids racing a concurrent `boot()` that has the
 * file open via virtio-blk.
 */
export function prebakeRootfsImageFromTree(args: {
  tarPath: string;
  treeDir: string;
  cacheDir?: string;
  onPhase?: (name: string, ms: number) => void;
}): void {
  const { tarPath, treeDir, onPhase } = args;
  const cacheDir = args.cacheDir ?? rootfsImgCacheDir();

  try {
    const mke2fs = resolveMke2fs();
    if (!mke2fs) {
      debug("prebake skip: no mke2fs available");
      return;
    }

    mkdirSync(cacheDir, { recursive: true });
    const shaT0 = Date.now();
    const sha = sha256OfFile(tarPath);
    onPhase?.("prebake.sha256", Date.now() - shaT0);
    const imgPath = join(cacheDir, `${sha}.img`);
    if (existsSync(imgPath)) {
      // Skip when the cache is already populated — a concurrent boot()
      // may have the file open via virtio-blk, and renaming over it
      // would leave that boot writing to a dead inode while the next
      // boot reads our fresh bytes.
      debug("prebake skip: cache already populated sha=%s", sha.slice(0, 12));
      return;
    }

    const stagingDir = mkdtempSync(join(cacheDir, `${sha.slice(0, 12)}-prebake-tree-`));
    const stagingImg = join(stagingDir, "rootfs.img");
    try {
      const treeBytes = duBytes(treeDir);
      const sizeBytes = Math.max(2 * 1024 * 1024 * 1024, Math.ceil(treeBytes * 2.5));
      allocateSparseFile(stagingImg, sizeBytes);

      const blocks = Math.floor(sizeBytes / 4096);
      const mkT0 = Date.now();
      const mk = spawnSync(
        mke2fs,
        ["-d", treeDir, "-t", "ext4", "-F", "-q", "-b", "4096", stagingImg, String(blocks)],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      onPhase?.("prebake.mke2fs", Date.now() - mkT0);
      if (mk.status !== 0) {
        debug(
          "prebake mke2fs failed status=%s stderr=%s",
          mk.status,
          mk.stderr?.toString().slice(0, 200) ?? "",
        );
        return;
      }

      renameSync(stagingImg, imgPath);
      markRootfsImageClean(imgPath);
      debug("prebake emitted cache=%s sizeBytes=%d", imgPath, sizeBytes);
    } finally {
      try {
        rmSync(stagingDir, { recursive: true, force: true });
      } catch {}
    }
  } catch (err) {
    debug("prebake error err=%s", (err as Error).message);
  }
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
