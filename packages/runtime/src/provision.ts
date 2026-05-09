// provision() — boot the base rootfs, run a user install hook via
// vsock, freeze the resulting filesystem state to a new rootfs tarball.
//
// Produces a *filesystem* image only: a tarball consumed via
// `boot({ image: <provision-output> })`. Orthogonal to `vm.snapshot()`,
// which captures live CRIU process state.
//
// Minimum correct round-trip:
//
//   const snap = await provision({
//     base: "./rootfs-debian-arm64.tar.gz",
//     install: async vm => {
//       await vm.exec("apt-get update");
//       await vm.exec("apt-get install -y --no-install-recommends tree");
//     },
//     out: "./warm.tar.gz",
//   });
//
//   const vm = await boot({
//     image: snap.imagePath,
//     cmd: ["/bin/sh"],
//   });

import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import debugLib from "debug";
import { ProvisionError } from "./errors.ts";
import { VsockExec } from "./exec.ts";
import type { OnLog } from "./log.ts";
import { PhaseTimer } from "./phase-timer.ts";
import { reflinkCopy } from "./reflink.ts";
import { boot, warmImageConfigCache } from "./vm.ts";
import type { VmHandle } from "./vm-handle.ts";
import { ensureRootfsImage, markRootfsImageClean, resolveMke2fs } from "./rootfs-img.ts";

const debug = debugLib("machinen:provision");
const vmmDebug = debugLib("machinen:vmm");

export interface ProvisionOptions {
  /**
   * Path to the base rootfs tarball to start from. Typically the
   * `rootfs-debian-arm64.tar.gz` produced by
   * `scripts/build-base-assets.sh` or shipped in a machinen release.
   *
   * Optional — when omitted, `provision()` resolves it via `resolveBaseRootfs()`
   * (MACHINEN_ASSETS_DIR env override, falling back to the `@machinen/cli`
   * cache at `~/.machinen/@machinen/runtime@<version>/bases/debian-arm64/`).
   */
  base?: string;

  /**
   * User-supplied provisioning steps. Runs inside the guest via vsock.
   */
  install: (vm: VmHandle) => Promise<void>;

  /**
   * Output path for the resulting rootfs tarball. Will be overwritten.
   * Consumed via `boot({ image: out })`.
   */
  out: string;

  /**
   * Default cmd baked into the image as `/machinen-config.json`.
   * When the image is later booted via `boot({ image })` without a
   * user-supplied `cmd`, the guest runs this. User-supplied `cmd` on
   * `boot()` still wins if provided.
   */
  cmd?: string[];

  /**
   * Default guest env baked into the image alongside `cmd`. Merged
   * with `boot({ env })` at boot time, with the caller's `env`
   * overriding on key collision.
   */
  env?: Record<string, string>;

  /**
   * Optional VMM binary path. Same lookup rules as `boot()` — if
   * omitted, resolves `@machinen/vmm-<arch>-<os>`.
   */
  binary?: string;

  /** Working directory. Defaults to process.cwd(). */
  cwd?: string;

  /**
   * Size of the scratch disk used to ferry the tarball from guest to
   * host. Must be larger than the expected post-install rootfs size.
   * Default: 1 GiB (sparse, so it doesn't actually take that space).
   */
  scratchDiskSizeBytes?: number;

  /**
   * Wall-clock ceiling for the whole build. If the install hook plus
   * the final archive + shutdown doesn't finish in this window, we
   * SIGKILL the VMM and fail. Default: 10 minutes.
   */
  timeoutMs?: number;

  /**
   * Extra env passed to the VMM process on the host side. Useful for
   * dev overrides like `MACHINEN_BOOT_TEST`. Distinct from `env`,
   * which bakes guest-workload env into the produced image.
   */
  vmmEnv?: Record<string, string>;

  /**
   * Path to the guest kernel. Optional — when omitted, `provision()`
   * resolves it via `resolveBaseKernel()` (MACHINEN_ASSETS_DIR override,
   * falling back to the `@machinen/cli` cache). Same semantics as
   * `boot({ kernel })` once resolved.
   */
  kernel?: string;

  /**
   * Path to the guest DTB. Optional — when omitted, resolved via
   * `resolveBaseDtb()` from the same fallback chain as `kernel`.
   */
  dtb?: string;

  /**
   * Streaming log callback — fires for every byte of guest output
   * during the build: guest kernel console, every `vm.exec()` call
   * the install hook makes, and the internal tar / poweroff execs.
   * See `LogEvent.source` to tell them apart. See #83.
   */
  onLog?: OnLog;
}

export interface ProvisionResult {
  /** Absolute path to the output tarball. */
  imagePath: string;

  /** Size of the output tarball in bytes. */
  sizeBytes: number;

  /** Wall-clock time from build() entry to return. */
  elapsedMs: number;
}

/**
 * The guest-side command we run after `install` completes to capture
 * the rootfs state onto the scratch disk. Excludes volatile + special
 * filesystems; everything else goes into the tar stream we write raw
 * to `/dev/vdb`. The scratch disk is the second virtio-blk slot (vda
 * holds the live ext4 rootfs the guest is running from); at pack-time
 * vdb has no filesystem so we append tar directly to the block device.
 * The host reads it back the same way (the trailing two zero blocks
 * mark the end).
 */
const TAR_TO_DISK_CMD = [
  "tar",
  "-C /",
  "--exclude=./proc",
  "--exclude=./sys",
  "--exclude=./dev",
  "--exclude=./tmp",
  "--exclude=./run",
  "--exclude=./machinen-config.json",
  "--exclude=./etc/machinen-boot-epoch",
  "--sort=name",
  "--numeric-owner",
  "--owner=0",
  "--group=0",
  "-cf /dev/vdb",
  ".",
].join(" ");

/**
 * Resolve the path to the base rootfs tarball, in the same order
 * `provision()` itself does:
 *
 *   1. `explicit` — the caller-supplied path (resolved against `cwd`).
 *   2. `MACHINEN_ASSETS_DIR` env var — points at a directory laid out like
 *      `scripts/build-base-assets.sh`'s output (contains
 *      `rootfs-debian-arm64.tar.gz`). Same convention `@machinen/cli`
 *      honors for local/dev builds.
 *   3. `@machinen/cli`'s on-disk cache at
 *      `~/.machinen/@machinen/runtime@<version>/bases/debian-arm64/rootfs.tar.gz`.
 *      Populated by running `machinen` once against the installed runtime.
 *
 * Throws `ProvisionError` with guidance if none of those turn up a file.
 * Exported so callers can pre-check or build their own tooling on it.
 *
 * @throws {ProvisionError} PROVISION_BASE_NOT_FOUND | PROVISION_ASSETS_DIR_INVALID
 */
export function resolveBaseRootfs(explicit?: string, cwd: string = process.cwd()): string {
  return resolveBaseAsset(
    {
      kind: "base rootfs tarball",
      param: "base",
      assetsDirName: "rootfs-debian-arm64.tar.gz",
      cliCacheName: "rootfs.tar.gz",
      missingCode: "PROVISION_BASE_NOT_FOUND",
    },
    explicit,
    cwd,
  );
}

/**
 * Resolve the path to the guest kernel Image. Same fallback chain as
 * `resolveBaseRootfs`: explicit → `MACHINEN_ASSETS_DIR/Image-arm64` →
 * `@machinen/cli` cache at `<base>/Image`. Exported for callers that
 * want to pre-check or wire the path into `boot()`.
 *
 * @throws {ProvisionError} PROVISION_KERNEL_NOT_FOUND |
 *   PROVISION_ASSETS_DIR_INVALID
 */
export function resolveBaseKernel(explicit?: string, cwd: string = process.cwd()): string {
  return resolveBaseAsset(
    {
      kind: "kernel image",
      param: "kernel",
      assetsDirName: "Image-arm64",
      cliCacheName: "Image",
      missingCode: "PROVISION_KERNEL_NOT_FOUND",
    },
    explicit,
    cwd,
  );
}

/**
 * Resolve the path to the guest DTB. Same fallback chain as
 * `resolveBaseRootfs`: explicit → `MACHINEN_ASSETS_DIR/virt-arm64.dtb` →
 * `@machinen/cli` cache at `<base>/virt.dtb`.
 *
 * @throws {ProvisionError} PROVISION_DTB_NOT_FOUND |
 *   PROVISION_ASSETS_DIR_INVALID
 */
export function resolveBaseDtb(explicit?: string, cwd: string = process.cwd()): string {
  return resolveBaseAsset(
    {
      kind: "device tree blob",
      param: "dtb",
      assetsDirName: "virt-arm64.dtb",
      cliCacheName: "virt.dtb",
      missingCode: "PROVISION_DTB_NOT_FOUND",
    },
    explicit,
    cwd,
  );
}

interface BaseAssetSpec {
  kind: string;
  param: string;
  assetsDirName: string;
  cliCacheName: string;
  missingCode:
    | "PROVISION_BASE_NOT_FOUND"
    | "PROVISION_KERNEL_NOT_FOUND"
    | "PROVISION_DTB_NOT_FOUND";
}

function resolveBaseAsset(spec: BaseAssetSpec, explicit: string | undefined, cwd: string): string {
  if (explicit) {
    const abs = resolve(cwd, explicit);
    if (!existsSync(abs)) {
      throw new ProvisionError(spec.missingCode, `${spec.kind} not found: ${abs}`);
    }
    return abs;
  }

  const assetsDir = process.env.MACHINEN_ASSETS_DIR;
  if (assetsDir) {
    const p = resolve(assetsDir, spec.assetsDirName);
    if (!existsSync(p)) {
      throw new ProvisionError(
        "PROVISION_ASSETS_DIR_INVALID",
        `MACHINEN_ASSETS_DIR=${assetsDir} does not contain ${spec.assetsDirName}`,
      );
    }
    return p;
  }

  const cached = join(cliCachedBaseDir(), spec.cliCacheName);
  if (existsSync(cached)) {
    return cached;
  }

  throw new ProvisionError(
    spec.missingCode,
    `${spec.kind} not found. Either:\n` +
      `  - pass \`${spec.param}\` explicitly, or\n` +
      `  - set MACHINEN_ASSETS_DIR to a directory containing ${spec.assetsDirName}, or\n` +
      `  - install @machinen/cli and run it once to populate ${cached}`,
  );
}

function cliCachedBaseDir(): string {
  // Mirrors `@machinen/cli`'s `baseDirFor(RELEASE_TAG)` where
  // RELEASE_TAG = `runtime-v${VERSION}` (slash-free so the GitHub
  // release URL pattern works — see the comment on RELEASE_TAG in
  // packages/cli/src/cli.ts).
  const pkgPath = resolve(import.meta.dirname, "..", "package.json");
  const version = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;
  return join(homedir(), ".machinen", `runtime-v${version}`, "bases", "debian-arm64");
}

/**
 * Boot the base rootfs, run the user install hook, and freeze the
 * resulting filesystem state to a new tarball at `opts.out`.
 *
 * @throws {ProvisionError} PROVISION_BASE_NOT_FOUND |
 *   PROVISION_KERNEL_NOT_FOUND | PROVISION_DTB_NOT_FOUND |
 *   PROVISION_ASSETS_DIR_INVALID | PROVISION_INSTALL_HOOK_FAILED |
 *   PROVISION_DISK_TOO_SMALL
 * @throws {BootError} see `boot()` — propagated from the inner boot
 */
export async function provision(opts: ProvisionOptions): Promise<ProvisionResult> {
  const cwd = opts.cwd ?? process.cwd();
  const baseAbs = resolveBaseRootfs(opts.base, cwd);
  const kernelAbs = resolveBaseKernel(opts.kernel, cwd);
  const dtbAbs = resolveBaseDtb(opts.dtb, cwd);
  const outAbs = resolve(cwd, opts.out);

  const t0 = Date.now();
  const workDir = mkdtempSync(join(tmpdir(), "machinen-provision-"));
  const diskPath = join(workDir, "scratch.img");
  const rootDiskPath = join(workDir, "rootfs.img");
  const udsPath = join(workDir, "exec.sock");
  debug("provision start base=%s out=%s workDir=%s", baseAbs, outAbs, workDir);

  // #233: per-phase wall-clock timeline emitted as a `PhaseLogEvent`
  // via opts.onLog (and as a debug one-liner under DEBUG=machinen:provision).
  // Mirrors boot()'s instrumentation so host scripts can show callers
  // where provision wall time actually goes — install hooks rarely
  // dominate; the inner boot, tar, and repack do.
  const phases = new PhaseTimer();

  try {
    // Allocate the scratch disk sparsely. The guest tars its filesystem
    // into this block device; the host then repacks the raw tar stream
    // into the output tarball.
    const scratchBytes = opts.scratchDiskSizeBytes ?? 1024 * 1024 * 1024;
    allocateSparseFile(diskPath, scratchBytes);
    debug("scratch disk allocated path=%s sizeBytes=%d", diskPath, scratchBytes);

    // Materialize the base tarball into an ext4 image and COW-clone it
    // into the workDir. The install hook mutates this throwaway copy, so
    // the persistent ~/.cache/machinen/rootfs/<sha>.img cache stays
    // pristine for normal `boot({ image })` callers that share the same
    // base. reflinkCopy → APFS clonefile / Linux FICLONE on reflink-
    // capable fs (free); falls back to a regular copy elsewhere
    // (one-time cost, sparse).
    phases.start("rootdisk-prep");
    const cachedImg = ensureRootfsImage(baseAbs, {
      onPhase: (name, ms) => phases.mark(`rootdisk-prep.${name}`, ms),
    });
    const reflinkT0 = Date.now();
    reflinkCopy(cachedImg, rootDiskPath);
    phases.mark("rootdisk-prep.reflink", Date.now() - reflinkT0);
    debug("rootdisk cloned src=%s dst=%s", cachedImg, rootDiskPath);
    // The cached `<sha>.img` was only READ here — the FICLONE / copy
    // landed in workDir, and the upcoming boot() targets that copy via
    // `rootDisk: rootDiskPath`. Restore the clean-shutdown marker the
    // cache entry semantics expect (#170): without this the next
    // provision() with the same base would see a missing `.ok` and
    // wastefully rematerialize a known-good image.
    markRootfsImageClean(cachedImg);
    phases.end("rootdisk-prep");

    // Boot the VMM with the base rootfs on /dev/vda (mounted ext4) and
    // the exec-agent as the cmd. The scratch disk lands on /dev/vdb,
    // ready for the post-install tar dump. We set MACHINEN_VSOCK
    // explicitly via `vmmEnv` so the UDS path lives under workDir
    // (predictable cleanup) rather than boot()'s auto-allocated tmp dir.
    phases.start("boot");
    const vm = await boot({
      binary: opts.binary,
      cwd: opts.cwd,
      vmmEnv: {
        ...opts.vmmEnv,
        MACHINEN_VSOCK: `in:1978:${udsPath}`,
      },
      kernel: kernelAbs,
      dtb: dtbAbs,
      image: baseAbs,
      cmd: ["/exec-agent"],
      env: { PATH: "/usr/local/bin:/usr/bin:/bin:/sbin" },
      snapshot: diskPath,
      rootDisk: rootDiskPath,
      // We drive the guest to exit via /sbin/machinen-poweroff at the
      // end; wait() has its own ceiling below.
      timeoutMs: null,
      // Forward guest console + install-hook exec output to the caller.
      // Internal tar / poweroff execs are forwarded explicitly below.
      onLog: opts.onLog,
    });
    phases.end("boot");

    const deadlineMs = opts.timeoutMs ?? 10 * 60 * 1000;
    const killTimer = setTimeout(() => void vm.kill(), deadlineMs);
    killTimer.unref();

    // Buffer stderr so a timed-out VsockExec can surface the VMM's
    // actual complaint instead of a bare ENOENT on the UDS. Keep up to
    // 128 KB so we catch kernel boot output + vsock bridge messages,
    // not just the zig unit-test tail.
    const tailBuf: Buffer[] = [];
    let tailBytes = 0;
    const TAIL_MAX = 128 * 1024;
    vm.stderr.on("data", (chunk: Buffer) => {
      tailBuf.push(chunk);
      tailBytes += chunk.length;
      while (tailBytes > TAIL_MAX && tailBuf.length > 1) {
        tailBytes -= tailBuf[0]!.length;
        tailBuf.shift();
      }
      if (vmmDebug.enabled) {
        process.stderr.write(chunk);
      }
    });
    const stderrTail = () => Buffer.concat(tailBuf).slice(-TAIL_MAX).toString("utf8");

    try {
      // Hand control to the install hook. The spawned VM already has
      // exec()/execRaw() hooked up to the vsock UDS we set via env, so
      // the hook uses the same VmHandle shape as any other caller.
      const installT0 = Date.now();
      debug("install hook entry");
      phases.start("install");
      try {
        await opts.install(vm);
      } catch (err) {
        const tail = stderrTail();
        const msg = err instanceof Error ? err.message : String(err);
        debug("install hook failed err=%s tailBytes=%d", msg, tail.length);
        throw new ProvisionError(
          "PROVISION_INSTALL_HOOK_FAILED",
          `install hook failed: ${msg}\n--- VMM stderr (last 8 KB) ---\n${tail}`,
          { cause: err },
        );
      }
      phases.end("install");
      debug("install hook done elapsed=%dms", Date.now() - installT0);

      // Post-install: archive / to /dev/vdb (the scratch disk), then
      // tell the guest to power off cleanly (PSCI SYSTEM_OFF via
      // /sbin/machinen-poweroff). A failed tar here means our scratch
      // disk was too small; surface that specifically.
      debug("tar / -> /dev/vdb starting");
      const tarT0 = Date.now();
      phases.start("tar-to-disk");
      const tar = await VsockExec.run(udsPath, TAR_TO_DISK_CMD, {
        execTimeoutMs: deadlineMs,
        ...tapExecForLog(TAR_TO_DISK_CMD, opts.onLog),
      });
      phases.end("tar-to-disk");
      debug("tar / -> /dev/vdb done exit=%d elapsed=%dms", tar.exitCode, Date.now() - tarT0);
      if (tar.exitCode !== 0) {
        throw new ProvisionError(
          "PROVISION_DISK_TOO_SMALL",
          `tar / to /dev/vdb failed (code ${tar.exitCode}) — scratch disk may be too small.\n` +
            `Bump scratchDiskSizeBytes. stderr:\n${tar.stderr}`,
        );
      }

      // Poweroff. /sbin/machinen-poweroff syncs, calls reboot(POWER_OFF),
      // and the VMM exits on PSCI SYSTEM_OFF. The connection can fail in
      // several equivalent ways (ECONNRESET mid-transaction, "agent
      // closed before X frame", or a fast-retry hitting ECONNREFUSED
      // after the VMM has already exited) — all are fine; vm.wait()
      // below is the real success signal. Short connect timeout so
      // we don't burn 30s retrying a bridge that's already gone.
      debug("requesting guest poweroff");
      phases.start("poweroff-wait");
      await VsockExec.run(udsPath, "/sbin/machinen-poweroff", {
        connectTimeoutMs: 2_000,
        ...tapExecForLog("/sbin/machinen-poweroff", opts.onLog),
      }).catch(() => {});

      // Surface progress without requiring DEBUG. The kernel's last
      // visible line is `reboot: Power down`, after which there's a
      // 30–90 s gap of silent host-side CPU. See #162.
      console.error("provision: waiting for guest exit…");
      await vm.wait();
      phases.end("poweroff-wait");
      debug("guest exited");
    } finally {
      clearTimeout(killTimer);
      if (vm.pid > 0) {
        await vm.kill().catch(() => {});
      }
    }

    // Scratch disk now holds a raw tar stream (padded with zeros up to
    // the scratch size). Repack it as a gzipped tarball at `out`, which
    // trims trailing zeros and normalizes compression.
    debug("repack disk tar -> %s starting", outAbs);
    const repackT0 = Date.now();
    phases.start("repack-targz");
    repackDiskTarToGz(diskPath, outAbs, {
      cmd: opts.cmd,
      env: opts.env,
      onPhase: (name, ms) => phases.mark(`repack-targz.${name}`, ms),
    });
    phases.end("repack-targz");
    debug("repack done elapsed=%dms", Date.now() - repackT0);

    const sizeBytes = statSync(outAbs).size;
    // Warm boot()'s image-config cache (#233 follow-up): we know the
    // exact bytes that landed in the tarball's machinen-config.json,
    // so the next boot() can skip the ~1 s `tar -xzOf` decompress.
    warmImageConfigCache(
      outAbs,
      opts.cmd || opts.env
        ? {
            ...(opts.cmd ? { cmd: opts.cmd } : {}),
            ...(opts.env ? { env: opts.env } : {}),
          }
        : null,
    );
    const elapsedMs = Date.now() - t0;
    debug("provision complete sizeBytes=%d totalElapsed=%dms", sizeBytes, elapsedMs);
    phases.flush(debug, "provision", elapsedMs);
    opts.onLog?.(phases.toEvent("provision", elapsedMs));
    return {
      imagePath: outAbs,
      sizeBytes,
      elapsedMs,
    };
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Bridge a raw `VsockExec.run` call into the provision-level `onLog`.
 * The bare VsockExec calls inside provision (tar, poweroff) don't go
 * through the VmHandle, so they miss the handle-level tee; this applies
 * the same `exec-stdout` / `exec-stderr` tagging shape by hand.
 */
function tapExecForLog(
  cmd: string,
  onLog: OnLog | undefined,
): { onStdout?: (chunk: Buffer) => void; onStderr?: (chunk: Buffer) => void } {
  if (!onLog) {
    return {};
  }
  return {
    onStdout: (chunk) => onLog({ source: "exec-stdout", cmd, chunk }),
    onStderr: (chunk) => onLog({ source: "exec-stderr", cmd, chunk }),
  };
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
 * Read the raw tar stream the guest wrote to the scratch disk and
 * re-emit it as a gzipped tarball. Extract+re-tar rather than pipe tar
 * through gzip directly: `tar -x` reliably stops at the two-zero-block
 * trailer on a padded block device, so we don't have to size-trim the
 * scratch file ourselves.
 *
 * The guest's tar already normalized ordering + ownership via GNU flags
 * (`--sort=name --numeric-owner --owner=0 --group=0`), so the extracted
 * tree is already deterministic. The host re-tar only needs to gzip;
 * using only the flags both GNU tar (Linux/CI) and bsdtar (macOS) accept
 * keeps the build path cross-platform. Byte-for-byte reproducibility
 * across hosts is a nice-to-have we can layer on later if it ever
 * matters (swap in a Node-side tar writer).
 *
 * #233 follow-up: also emits a `<out>.img.gz` prebake sibling. The
 * extracted tree is already on disk for re-tar; mke2fs from it costs
 * a few seconds and saves ~10 s on every subsequent `boot()` of this
 * tarball (the cached `<sha>.img` would otherwise miss on every
 * provision and force a tar-extract + mke2fs on the next boot). When
 * mke2fs isn't available we silently skip the prebake — provision
 * still produces a valid tarball, the next boot just pays the cold-
 * materialize price.
 */
function repackDiskTarToGz(
  diskPath: string,
  outAbs: string,
  opts: {
    cmd?: string[];
    env?: Record<string, string>;
    onPhase?: (name: string, ms: number) => void;
  } = {},
): void {
  const extractDir = mkdtempSync(join(tmpdir(), "machinen-provision-extract-"));
  try {
    // Visible progress so the silent multi-GB tar pass doesn't look
    // like a hang. See #162.
    console.error("provision: packaging rootfs…");
    const extractT0 = Date.now();
    execFileSync("tar", ["-xf", diskPath, "-C", extractDir]);
    opts.onPhase?.("disk-tar-extract", Date.now() - extractT0);
    // Bake the image's default cmd/env into /machinen-config.json so
    // `boot({ image })` can run without every caller re-passing the
    // same cmd. User-supplied cmd/env on boot() still override.
    if (opts.cmd || opts.env) {
      writeFileSync(
        join(extractDir, "machinen-config.json"),
        JSON.stringify({
          ...(opts.cmd ? { cmd: opts.cmd } : {}),
          ...(opts.env ? { env: opts.env } : {}),
        }),
      );
    }
    const tarT0 = Date.now();
    execFileSync("tar", ["-czf", outAbs, "-C", extractDir, "."], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    opts.onPhase?.("targz", Date.now() - tarT0);
    emitPrebakeSibling(extractDir, outAbs, opts.onPhase);
  } finally {
    try {
      rmSync(extractDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Build `<outAbs>.img` from the already-extracted rootfs tree so the
 * next `boot()` against `<outAbs>` hits `tryPrebakeFromSibling` and
 * reflinks the file straight into the cache instead of cold-materialize
 * (tar-extract + mke2fs ≈ 10 s on a typical dev rootfs).
 *
 * We emit the uncompressed `.img` form (sparse, ~500 MB on disk for a
 * 2 GiB allocated image with a typical Debian rootfs) rather than the
 * gzipped `.img.gz` form release builds use: the prebake then reflinks
 * from sibling to cache in milliseconds, vs ~2 s for `gunzip`. Build-
 * time gzip would also add ~25 s on a single-threaded host. Disk cost
 * is similar — gzip(.img) and sparse(.img) both land ~500 MB on APFS.
 *
 * Best-effort: any failure (no mke2fs binary, mke2fs error, unexpected
 * outAbs suffix) is logged and swallowed; the tarball alone is still
 * a complete provision output, the next boot just falls back to the
 * slow materialize path.
 */
function emitPrebakeSibling(
  treeDir: string,
  outAbs: string,
  onPhase?: (name: string, ms: number) => void,
): void {
  const mke2fs = resolveMke2fs();
  if (!mke2fs) {
    debug("prebake skip: no mke2fs available");
    return;
  }
  const m = /^(.*)(\.tar\.gz|\.tgz|\.tar)$/i.exec(outAbs);
  if (!m) {
    debug("prebake skip: outAbs %s lacks a recognized tarball suffix", outAbs);
    return;
  }
  const prebakePath = `${m[1]}.img`;
  const tmpImg = `${prebakePath}.tmp.${process.pid}`;

  try {
    const treeBytes = duBytes(treeDir);
    const sizeBytes = Math.max(2 * 1024 * 1024 * 1024, Math.ceil(treeBytes * 2.5));
    allocateSparseFile(tmpImg, sizeBytes);

    const blocks = Math.floor(sizeBytes / 4096);
    const mkT0 = Date.now();
    const mk = spawnSync(
      mke2fs,
      ["-d", treeDir, "-t", "ext4", "-F", "-q", "-b", "4096", tmpImg, String(blocks)],
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

    renameSync(tmpImg, prebakePath);
    debug("prebake emitted prebake=%s sizeBytes=%d", prebakePath, sizeBytes);
  } catch (err) {
    debug("prebake error err=%s", (err as Error).message);
  } finally {
    try {
      rmSync(tmpImg, { force: true });
    } catch {}
  }
}

/**
 * `du -sk <path>` in bytes. Mirrors the helper in rootfs-img.ts;
 * duplicated here to keep that module's surface narrow.
 */
function duBytes(path: string): number {
  try {
    const out = execFileSync("du", ["-sk", path], { encoding: "utf8" }).trim();
    const kib = parseInt(out.split(/\s+/, 1)[0]!, 10);
    if (Number.isFinite(kib) && kib > 0) {
      return kib * 1024;
    }
  } catch {}
  return statSync(path).size || 0;
}
