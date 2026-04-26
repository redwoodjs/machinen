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

import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
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
import { boot, type VmHandle } from "./index.ts";
import type { OnLog } from "./log.ts";

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

  /** Path to the guest kernel. Same semantics as `boot({ kernel })`. */
  kernel?: string;

  /** Path to the guest DTB. Same semantics as `boot({ dtb })`. */
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
 * filesystems; everything else goes into the tar stream we then write
 * raw to `/dev/vda`. At pack-time there is no filesystem on the disk,
 * so we're appending tar directly to the block device. The host reads
 * it back the same way (the trailing two zero blocks mark the end).
 */
const TAR_TO_DISK_CMD = [
  "tar",
  "-C /",
  "--exclude=./proc",
  "--exclude=./sys",
  "--exclude=./dev",
  "--exclude=./tmp",
  "--exclude=./run",
  "--exclude=./mnt",
  "--exclude=./machinen-config.json",
  "--exclude=./etc/machinen-boot-epoch",
  "--sort=name",
  "--numeric-owner",
  "--owner=0",
  "--group=0",
  "-cf /dev/vda",
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
  if (explicit) {
    const abs = resolve(cwd, explicit);
    if (!existsSync(abs)) {
      throw new ProvisionError("PROVISION_BASE_NOT_FOUND", `base rootfs tarball not found: ${abs}`);
    }
    return abs;
  }

  const assetsDir = process.env.MACHINEN_ASSETS_DIR;
  if (assetsDir) {
    const p = resolve(assetsDir, "rootfs-debian-arm64.tar.gz");
    if (!existsSync(p)) {
      throw new ProvisionError(
        "PROVISION_ASSETS_DIR_INVALID",
        `MACHINEN_ASSETS_DIR=${assetsDir} does not contain rootfs-debian-arm64.tar.gz`,
      );
    }
    return p;
  }

  const cached = cliCachedRootfsPath();
  if (existsSync(cached)) {
    return cached;
  }

  throw new ProvisionError(
    "PROVISION_BASE_NOT_FOUND",
    `base rootfs not found. Either:\n` +
      `  - pass \`base\` explicitly, or\n` +
      `  - set MACHINEN_ASSETS_DIR to a directory containing rootfs-debian-arm64.tar.gz, or\n` +
      `  - install @machinen/cli and run it once to populate ${cached}`,
  );
}

function cliCachedRootfsPath(): string {
  // Mirrors `@machinen/cli`'s `baseDirFor(RELEASE_TAG)` where
  // RELEASE_TAG = `@machinen/runtime@${VERSION}`.
  const pkgPath = resolve(import.meta.dirname, "..", "package.json");
  const version = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;
  return join(
    homedir(),
    ".machinen",
    `@machinen/runtime@${version}`,
    "bases",
    "debian-arm64",
    "rootfs.tar.gz",
  );
}

/**
 * Boot the base rootfs, run the user install hook, and freeze the
 * resulting filesystem state to a new tarball at `opts.out`.
 *
 * @throws {ProvisionError} PROVISION_BASE_NOT_FOUND |
 *   PROVISION_ASSETS_DIR_INVALID | PROVISION_INSTALL_HOOK_FAILED |
 *   PROVISION_DISK_TOO_SMALL
 * @throws {BootError} see `boot()` — propagated from the inner boot
 */
export async function provision(opts: ProvisionOptions): Promise<ProvisionResult> {
  const cwd = opts.cwd ?? process.cwd();
  const baseAbs = resolveBaseRootfs(opts.base, cwd);
  const outAbs = resolve(cwd, opts.out);

  const t0 = Date.now();
  const workDir = mkdtempSync(join(tmpdir(), "machinen-provision-"));
  const diskPath = join(workDir, "scratch.img");
  const udsPath = join(workDir, "exec.sock");
  debug("provision start base=%s out=%s workDir=%s", baseAbs, outAbs, workDir);

  try {
    // Allocate the scratch disk sparsely. The guest tars its filesystem
    // into this block device; the host then repacks the raw tar stream
    // into the output tarball.
    const scratchBytes = opts.scratchDiskSizeBytes ?? 1024 * 1024 * 1024;
    allocateSparseFile(diskPath, scratchBytes);
    debug("scratch disk allocated path=%s sizeBytes=%d", diskPath, scratchBytes);

    // Boot the VMM with the base rootfs as the image and the exec-agent
    // as the cmd. We set MACHINEN_VSOCK explicitly via `vmmEnv` so the
    // UDS path lives under workDir (predictable cleanup) rather than
    // boot()'s auto-allocated tmp dir.
    const vm = await boot({
      binary: opts.binary,
      cwd: opts.cwd,
      vmmEnv: {
        ...opts.vmmEnv,
        MACHINEN_VSOCK: `in:1978:${udsPath}`,
      },
      kernel: opts.kernel,
      dtb: opts.dtb,
      image: baseAbs,
      cmd: ["/exec-agent"],
      env: { PATH: "/usr/local/bin:/usr/bin:/bin:/sbin" },
      snapshot: diskPath,
      // Opt out of the disk-backed boot path: the post-install
      // `tar / -cf /dev/vda` below writes the captured rootfs onto
      // the snapshot disk (which is /dev/vda when no rootdisk is
      // attached). Promoting provision() to virtio-blk root would
      // need a /dev/vdb-aware tar dump and is tracked separately.
      rootDisk: false,
      // We drive the guest to exit via /sbin/machinen-poweroff at the
      // end; wait() has its own ceiling below.
      timeoutMs: null,
      // Forward guest console + install-hook exec output to the caller.
      // Internal tar / poweroff execs are forwarded explicitly below.
      onLog: opts.onLog,
    });

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
      debug("install hook done elapsed=%dms", Date.now() - installT0);

      // Post-install: archive / to /dev/vda, then tell the guest to
      // power off cleanly (PSCI SYSTEM_OFF via /sbin/machinen-poweroff).
      // A failed tar here means our scratch disk was too small; surface
      // that specifically.
      debug("tar / -> /dev/vda starting");
      const tarT0 = Date.now();
      const tar = await VsockExec.run(udsPath, TAR_TO_DISK_CMD, {
        execTimeoutMs: deadlineMs,
        ...tapExecForLog(TAR_TO_DISK_CMD, opts.onLog),
      });
      debug("tar / -> /dev/vda done exit=%d elapsed=%dms", tar.exitCode, Date.now() - tarT0);
      if (tar.exitCode !== 0) {
        throw new ProvisionError(
          "PROVISION_DISK_TOO_SMALL",
          `tar / to /dev/vda failed (code ${tar.exitCode}) — scratch disk may be too small.\n` +
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
      await VsockExec.run(udsPath, "/sbin/machinen-poweroff", {
        connectTimeoutMs: 2_000,
        ...tapExecForLog("/sbin/machinen-poweroff", opts.onLog),
      }).catch(() => {});

      await vm.wait();
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
    repackDiskTarToGz(diskPath, outAbs, { cmd: opts.cmd, env: opts.env });
    debug("repack done elapsed=%dms", Date.now() - repackT0);

    const sizeBytes = statSync(outAbs).size;
    debug("provision complete sizeBytes=%d totalElapsed=%dms", sizeBytes, Date.now() - t0);
    return {
      imagePath: outAbs,
      sizeBytes,
      elapsedMs: Date.now() - t0,
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
 */
function repackDiskTarToGz(
  diskPath: string,
  outAbs: string,
  bakedConfig?: { cmd?: string[]; env?: Record<string, string> },
): void {
  const extractDir = mkdtempSync(join(tmpdir(), "machinen-provision-extract-"));
  try {
    execFileSync("tar", ["-xf", diskPath, "-C", extractDir]);
    // Bake the image's default cmd/env into /machinen-config.json so
    // `boot({ image })` can run without every caller re-passing the
    // same cmd. User-supplied cmd/env on boot() still override.
    if (bakedConfig && (bakedConfig.cmd || bakedConfig.env)) {
      writeFileSync(
        join(extractDir, "machinen-config.json"),
        JSON.stringify({
          ...(bakedConfig.cmd ? { cmd: bakedConfig.cmd } : {}),
          ...(bakedConfig.env ? { env: bakedConfig.env } : {}),
        }),
      );
    }
    execFileSync("tar", ["-czf", outAbs, "-C", extractDir, "."], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  } finally {
    try {
      rmSync(extractDir, { recursive: true, force: true });
    } catch {}
  }
}
