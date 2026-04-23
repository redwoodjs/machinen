// build() — boot the base rootfs, run a user install hook via vsock,
// freeze the resulting filesystem state to a new rootfs tarball.
//
// The first cut (v1) produces a *filesystem* snapshot only: a tarball
// that layers on top of the base rootfs. It is designed to be consumed
// via `spawn({ baseRootfs: <build-output> })`, which overlays it onto
// the base at pack-time the same way a bundle rootfs does. No CRIU
// process freeze in this cut — sub-second spawn is explicitly a
// #77 non-goal. The next cut adds CRIU dump on top of this flow.
//
// Minimum correct round-trip:
//
//   const snap = await build({
//     base: "./rootfs-debian-arm64.tar.gz",
//     install: async vm => {
//       await vm.exec("apt-get update");
//       await vm.exec("apt-get install -y --no-install-recommends tree");
//     },
//     out: "./warm.tar.gz",
//   });
//
//   const vm = await spawn({
//     baseRootfs: snap.snapshotPath,
//     bundle: "./my-app-bundle",
//   });

import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
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
import { VsockExec, type VsockExecResult } from "./exec.ts";
import { spawn } from "./index.ts";

export class BuildError extends Error {}

/**
 * The object passed to the user's `install` hook. For now, the only
 * method is `exec()`; later iterations will add `writeFile()`,
 * `readFile()`, etc. built on the existing `VsockFiles` agent.
 */
export interface BuildHandle {
  /**
   * Run a shell command inside the guest. Throws BuildError on non-zero
   * exit (callers who want to inspect failures should use `execRaw`).
   *
   * The command is passed verbatim to `sh -c` inside the guest, so
   * shell syntax (pipes, redirection, env) works.
   */
  exec(cmd: string): Promise<VsockExecResult>;

  /** Like exec(), but does not throw on non-zero exit. */
  execRaw(cmd: string): Promise<VsockExecResult>;
}

export interface BuildOptions {
  /**
   * Path to the base rootfs tarball to start from. Typically the
   * `rootfs-debian-arm64.tar.gz` produced by
   * `scripts/build-base-assets.sh` or shipped in a machinen release.
   *
   * Optional — when omitted, `build()` resolves it via `resolveBaseRootfs()`
   * (MACHINEN_ASSETS_DIR env override, falling back to the `@machinen/cli`
   * cache at `~/.machinen/@machinen/runtime@<version>/bases/debian-arm64/`).
   */
  base?: string;

  /**
   * User-supplied provisioning steps. Runs inside the guest via vsock.
   */
  install: (vm: BuildHandle) => Promise<void>;

  /**
   * Output path for the resulting rootfs tarball. Will be overwritten.
   * Consumed via `spawn({ baseRootfs: out })`.
   */
  out: string;

  /**
   * Optional VMM binary path. Same lookup rules as `spawn()` — if
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
   * Extra env passed to the VMM. Useful for dev overrides like
   * `MACHINEN_BOOT_TEST`, `MACHINEN_KERNEL`, `MACHINEN_DTB`.
   */
  env?: Record<string, string>;

  /** Path to the guest kernel. Same semantics as `spawn({ kernel })`. */
  kernel?: string;

  /** Path to the guest DTB. Same semantics as `spawn({ dtb })`. */
  dtb?: string;
}

export interface BuildResult {
  /** Absolute path to the output tarball. */
  snapshotPath: string;

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
 * `build()` itself does:
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
 * Throws `BuildError` with guidance if none of those turn up a file.
 * Exported so callers can pre-check or build their own tooling on it.
 */
export function resolveBaseRootfs(explicit?: string, cwd: string = process.cwd()): string {
  if (explicit) {
    const abs = resolve(cwd, explicit);
    if (!existsSync(abs)) {
      throw new BuildError(`base rootfs tarball not found: ${abs}`);
    }
    return abs;
  }

  const assetsDir = process.env.MACHINEN_ASSETS_DIR;
  if (assetsDir) {
    const p = resolve(assetsDir, "rootfs-debian-arm64.tar.gz");
    if (!existsSync(p)) {
      throw new BuildError(
        `MACHINEN_ASSETS_DIR=${assetsDir} does not contain rootfs-debian-arm64.tar.gz`,
      );
    }
    return p;
  }

  const cached = cliCachedRootfsPath();
  if (existsSync(cached)) {
    return cached;
  }

  throw new BuildError(
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

export async function build(opts: BuildOptions): Promise<BuildResult> {
  const cwd = opts.cwd ?? process.cwd();
  const baseAbs = resolveBaseRootfs(opts.base, cwd);
  const outAbs = resolve(cwd, opts.out);

  const t0 = Date.now();
  const workDir = mkdtempSync(join(tmpdir(), "machinen-build-"));
  const bundleDir = join(workDir, "bundle");
  const rootfsDir = join(bundleDir, "rootfs");
  const diskPath = join(workDir, "scratch.img");
  const udsPath = join(workDir, "exec.sock");

  try {
    // Minimal bundle: just a machinen-config.json pointing at the
    // exec-agent. rootfs/ stays empty — the base rootfs is merged in
    // by packBundle via `baseRootfs`.
    mkdirSync(rootfsDir, { recursive: true });
    writeFileSync(
      join(bundleDir, "machinen-config.json"),
      JSON.stringify({
        cmd: ["/exec-agent"],
        env: { PATH: "/usr/local/bin:/usr/bin:/bin:/sbin" },
      }),
    );

    // Allocate the scratch disk sparsely.
    allocateSparseFile(diskPath, opts.scratchDiskSizeBytes ?? 1024 * 1024 * 1024);

    // Spawn the VMM. MACHINEN_VSOCK=in:1978:<uds> bridges the guest's
    // vsock listener at port 1978 to a host UDS we can connect to.
    const vm = await spawn({
      binary: opts.binary,
      cwd: opts.cwd,
      env: {
        ...opts.env,
        MACHINEN_VSOCK: `in:1978:${udsPath}`,
      },
      kernel: opts.kernel,
      dtb: opts.dtb,
      baseRootfs: baseAbs,
      bundle: bundleDir,
      disk: diskPath,
      // We drive the guest to exit via /sbin/machinen-poweroff at the
      // end; wait() has its own ceiling below.
      timeoutMs: null,
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
      if (process.env.MACHINEN_BUILD_DEBUG) {
        process.stderr.write(chunk);
      }
    });
    const stderrTail = () => Buffer.concat(tailBuf).slice(-TAIL_MAX).toString("utf8");

    try {
      // Hand control to the install hook. Per-command exec timeout
      // inherits the outer build deadline — any single command that
      // runs that long has already blown the budget; VsockExec's own
      // 5-min default would otherwise trip first on slow libslirp.
      const handle: BuildHandle = {
        exec: async (cmd: string) => {
          const res = await VsockExec.run(udsPath, cmd, { execTimeoutMs: deadlineMs });
          if (res.exitCode !== 0) {
            throw new BuildError(
              `exec failed (code ${res.exitCode}): ${cmd}\nstderr:\n${res.stderr}`,
            );
          }
          return res;
        },
        execRaw: (cmd: string) => VsockExec.run(udsPath, cmd, { execTimeoutMs: deadlineMs }),
      };
      try {
        await opts.install(handle);
      } catch (err) {
        const tail = stderrTail();
        const msg = err instanceof Error ? err.message : String(err);
        throw new BuildError(
          `install hook failed: ${msg}\n--- VMM stderr (last 8 KB) ---\n${tail}`,
        );
      }

      // Post-install: archive / to /dev/vda, then tell the guest to
      // power off cleanly (PSCI SYSTEM_OFF via /sbin/machinen-poweroff).
      // A failed tar here means our scratch disk was too small; surface
      // that specifically.
      const tar = await VsockExec.run(udsPath, TAR_TO_DISK_CMD, {
        execTimeoutMs: deadlineMs,
      });
      if (tar.exitCode !== 0) {
        throw new BuildError(
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
      await VsockExec.run(udsPath, "/sbin/machinen-poweroff", {
        connectTimeoutMs: 2_000,
      }).catch(() => {});

      await vm.wait();
    } finally {
      clearTimeout(killTimer);
      if (vm.pid > 0) {
        await vm.kill().catch(() => {});
      }
    }

    // Scratch disk now holds a raw tar stream (padded with zeros up to
    // the scratch size). Repack it as a gzipped tarball at `out`, which
    // trims trailing zeros and normalizes compression.
    repackDiskTarToGz(diskPath, outAbs);

    const sizeBytes = statSync(outAbs).size;
    return {
      snapshotPath: outAbs,
      sizeBytes,
      elapsedMs: Date.now() - t0,
    };
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {}
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
function repackDiskTarToGz(diskPath: string, outAbs: string): void {
  const extractDir = mkdtempSync(join(tmpdir(), "machinen-build-extract-"));
  try {
    execFileSync("tar", ["-xf", diskPath, "-C", extractDir]);
    execFileSync("tar", ["-czf", outAbs, "-C", extractDir, "."], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  } finally {
    try {
      rmSync(extractDir, { recursive: true, force: true });
    } catch {}
  }
}
