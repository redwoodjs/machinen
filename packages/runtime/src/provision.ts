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
//     base: "./rootfs-debian-arm64.tar.gz", // or rootfs-debian-amd64.tar.gz
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
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { arch as osArch, homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import debugLib from "debug";
import { ProvisionError } from "./errors.ts";
import { VsockExec } from "./exec.ts";
import type { OnLog } from "./log.ts";
import { planProvisionAssetsNative, planProvisionBootNative } from "./native/boot-plan.ts";
import { PhaseTimer } from "./phase-timer.ts";
import { reflinkCopy } from "./reflink.ts";
import { boot, warmImageConfigCache } from "./vm/index.ts";
import type { VmHandle } from "./vm-handle.ts";
import {
  ensureRootfsImage,
  markRootfsImageClean,
  prebakeRootfsImageFromTree,
} from "./rootfs-img.ts";

const debug = debugLib("machinen:provision");
const vmmDebug = debugLib("machinen:vmm");

export interface ProvisionOptions {
  /**
   * Path to the base rootfs tarball to start from. Typically the
   * arch-specific rootfs tarball produced by `scripts/build-base-assets.sh`
   * (`rootfs-debian-arm64.tar.gz` or `rootfs-debian-amd64.tar.gz`) or
   * shipped in a machinen release.
   *
   * Optional — when omitted, `provision()` resolves it via `resolveBaseRootfs()`
   * (MACHINEN_ASSETS_DIR env override, falling back to the `@machinen/cli`
   * cache for the selected guest arch).
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
   * omitted, resolves `@machinen/native-<arch>-<os>`.
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
 *      `scripts/build-base-assets.sh`'s output (contains the selected
 *      arch's rootfs tarball). Same convention `@machinen/cli` honors for
 *      local/dev builds.
 *   3. `@machinen/cli`'s on-disk cache at
 *      `~/.machinen/@machinen/runtime@<version>/bases/debian-<arch>/rootfs.tar.gz`.
 *      Populated by running `machinen` once against the installed runtime.
 *
 * Throws `ProvisionError` with guidance if none of those turn up a file.
 * Exported so callers can pre-check or build their own tooling on it.
 *
 * @throws {ProvisionError} PROVISION_BASE_NOT_FOUND | PROVISION_ASSETS_DIR_INVALID
 */
export function resolveBaseRootfs(explicit?: string, cwd: string = process.cwd()): string {
  const spec = baseAssetSpec();
  return resolveBaseAsset(
    {
      kind: "base rootfs tarball",
      param: "base",
      assetsDirName: spec.rootfsAsset,
      cliCacheName: "rootfs.tar.gz",
      missingCode: "PROVISION_BASE_NOT_FOUND",
    },
    explicit,
    cwd,
  );
}

/**
 * Resolve the path to the guest kernel image. Same fallback chain as
 * `resolveBaseRootfs`: explicit → `MACHINEN_ASSETS_DIR/<arch kernel>` →
 * `@machinen/cli` cache at `<base>/Image`. Exported for callers that
 * want to pre-check or wire the path into `boot()`.
 *
 * @throws {ProvisionError} PROVISION_KERNEL_NOT_FOUND |
 *   PROVISION_ASSETS_DIR_INVALID
 */
export function resolveBaseKernel(explicit?: string, cwd: string = process.cwd()): string {
  const spec = baseAssetSpec();
  return resolveBaseAsset(
    {
      kind: "kernel image",
      param: "kernel",
      assetsDirName: spec.kernelAsset,
      cliCacheName: "Image",
      missingCode: "PROVISION_KERNEL_NOT_FOUND",
    },
    explicit,
    cwd,
  );
}

/**
 * Resolve the path to the guest DTB. amd64 guests do not use a DTB unless
 * the caller passes one explicitly. arm64 follows the same fallback chain as
 * `resolveBaseRootfs`: explicit → `MACHINEN_ASSETS_DIR/virt-arm64.dtb` →
 * `@machinen/cli` cache at `<base>/virt.dtb`.
 *
 * @throws {ProvisionError} PROVISION_DTB_NOT_FOUND |
 *   PROVISION_ASSETS_DIR_INVALID
 */
export function resolveBaseDtb(explicit?: string, cwd: string = process.cwd()): string | undefined {
  if (!explicit && guestCpu() === "amd64") {
    return undefined;
  }
  const spec = baseAssetSpec();
  return resolveBaseAsset(
    {
      kind: "device tree blob",
      param: "dtb",
      assetsDirName: spec.dtbAsset ?? "virt-arm64.dtb",
      cliCacheName: "virt.dtb",
      missingCode: "PROVISION_DTB_NOT_FOUND",
    },
    explicit,
    cwd,
  );
}

type GuestCpu = "arm64" | "amd64";

function guestCpu(): GuestCpu {
  const override = process.env.MACHINEN_GUEST_ARCH;
  if (override === "arm64" || override === "amd64") {
    return override;
  }
  return osArch() === "x64" ? "amd64" : "arm64";
}

function baseAssetSpec(): {
  cpu: GuestCpu;
  kernelAsset: string;
  dtbAsset?: string;
  rootfsAsset: string;
} {
  const plan = planProvisionAssetsNative(guestCpu());
  return {
    cpu: plan.cpu,
    kernelAsset: plan.kernelAsset,
    ...(plan.dtbAsset ? { dtbAsset: plan.dtbAsset } : {}),
    rootfsAsset: plan.rootfsAsset,
  };
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
  const spec = baseAssetSpec();
  return join(homedir(), ".machinen", `runtime-v${version}`, "bases", `debian-${spec.cpu}`);
}

interface ProvisionContext {
  cwd: string;
  baseAbs: string;
  kernelAbs: string;
  dtbAbs: string | undefined;
  outAbs: string;
  t0: number;
  workDir: string;
  diskPath: string;
  rootDiskPath: string;
  udsPath: string;
  phases: PhaseTimer;
}

interface ProvisionStderrTail {
  tail: () => string;
}

const PROVISION_STDERR_TAIL_MAX = 128 * 1024;

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
  const ctx = createProvisionContext(opts);
  try {
    prepareProvisionDisks(opts, ctx);
    const vm = await bootProvisionVm(opts, ctx);
    await runProvisionVmWorkload(opts, ctx, vm);
    repackProvisionOutput(opts, ctx);
    return finishProvision(opts, ctx);
  } finally {
    cleanupProvisionWorkDir(ctx.workDir);
  }
}

function createProvisionContext(opts: ProvisionOptions): ProvisionContext {
  const cwd = opts.cwd ?? process.cwd();
  const baseAbs = resolveBaseRootfs(opts.base, cwd);
  const kernelAbs = resolveBaseKernel(opts.kernel, cwd);
  const dtbAbs = resolveBaseDtb(opts.dtb, cwd);
  const outAbs = resolve(cwd, opts.out);
  mkdirSync(dirname(outAbs), { recursive: true });

  const workDir = mkdtempSync(join(tmpdir(), "machinen-provision-"));
  const ctx = {
    cwd,
    baseAbs,
    kernelAbs,
    dtbAbs,
    outAbs,
    t0: Date.now(),
    workDir,
    diskPath: join(workDir, "scratch.img"),
    rootDiskPath: join(workDir, "rootfs.img"),
    udsPath: join(workDir, "exec.sock"),
    phases: new PhaseTimer(),
  };
  debug("provision start base=%s out=%s workDir=%s", baseAbs, outAbs, workDir);
  return ctx;
}

function prepareProvisionDisks(opts: ProvisionOptions, ctx: ProvisionContext): void {
  allocateProvisionScratch(opts, ctx);
  cloneProvisionRootDisk(ctx);
}

function allocateProvisionScratch(opts: ProvisionOptions, ctx: ProvisionContext): void {
  const scratchBytes = opts.scratchDiskSizeBytes ?? 1024 * 1024 * 1024;
  allocateSparseFile(ctx.diskPath, scratchBytes);
  debug("scratch disk allocated path=%s sizeBytes=%d", ctx.diskPath, scratchBytes);
}

function cloneProvisionRootDisk(ctx: ProvisionContext): void {
  ctx.phases.start("rootdisk-prep");
  const cachedImg = ensureRootfsImage(ctx.baseAbs, {
    onPhase: (name, ms) => ctx.phases.mark(`rootdisk-prep.${name}`, ms),
  });
  const reflinkT0 = Date.now();
  reflinkCopy(cachedImg, ctx.rootDiskPath);
  ctx.phases.mark("rootdisk-prep.reflink", Date.now() - reflinkT0);
  debug("rootdisk cloned src=%s dst=%s", cachedImg, ctx.rootDiskPath);
  markRootfsImageClean(cachedImg);
  ctx.phases.end("rootdisk-prep");
}

async function bootProvisionVm(opts: ProvisionOptions, ctx: ProvisionContext): Promise<VmHandle> {
  ctx.phases.start("boot");
  const plan = planProvisionBootNative({
    basePath: ctx.baseAbs,
    kernelPath: ctx.kernelAbs,
    dtbPath: ctx.dtbAbs,
    udsPath: ctx.udsPath,
    scratchDiskPath: ctx.diskPath,
    rootDiskPath: ctx.rootDiskPath,
  });
  const vm = await boot({
    binary: opts.binary,
    cwd: opts.cwd,
    vmmEnv: {
      ...opts.vmmEnv,
      ...(plan.vmmVsock ? { MACHINEN_VSOCK: plan.vmmVsock } : {}),
    },
    kernel: requireProvisionPlanString(plan.kernelPath, "kernelPath"),
    ...(plan.dtbPath ? { dtb: plan.dtbPath } : {}),
    image: requireProvisionPlanString(plan.imagePath, "imagePath"),
    cmd: plan.cmd,
    env: plan.env,
    snapshot: requireProvisionPlanString(plan.snapshotPath, "snapshotPath"),
    rootDisk: requireProvisionPlanString(plan.rootDiskPath, "rootDiskPath"),
    timeoutMs: null,
    onLog: opts.onLog,
  });
  ctx.phases.end("boot");
  return vm;
}

function requireProvisionPlanString(value: string | null, field: string): string {
  if (value === null) {
    throw new ProvisionError(
      "PROVISION_BASE_NOT_FOUND",
      `provision native planner returned missing ${field}`,
    );
  }
  return value;
}

async function runProvisionVmWorkload(
  opts: ProvisionOptions,
  ctx: ProvisionContext,
  vm: VmHandle,
): Promise<void> {
  const deadlineMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const killTimer = setTimeout(() => void vm.kill(), deadlineMs);
  killTimer.unref();
  const stderrTail = captureProvisionStderrTail(vm);
  try {
    await runInstallHook(opts, ctx, vm, stderrTail);
    await tarProvisionRootfsToDisk(opts, ctx, deadlineMs);
    await poweroffProvisionGuest(opts, ctx, vm);
  } finally {
    clearTimeout(killTimer);
    await killProvisionVm(vm);
  }
}

function captureProvisionStderrTail(vm: VmHandle): ProvisionStderrTail {
  const tailBuf: Buffer[] = [];
  let tailBytes = 0;
  vm.stderr.on("data", (chunk: Buffer) => {
    tailBuf.push(chunk);
    tailBytes += chunk.length;
    while (tailBytes > PROVISION_STDERR_TAIL_MAX && tailBuf.length > 1) {
      tailBytes -= tailBuf[0]!.length;
      tailBuf.shift();
    }
    if (vmmDebug.enabled) {
      process.stderr.write(chunk);
    }
  });
  return {
    tail: () => Buffer.concat(tailBuf).slice(-PROVISION_STDERR_TAIL_MAX).toString("utf8"),
  };
}

async function runInstallHook(
  opts: ProvisionOptions,
  ctx: ProvisionContext,
  vm: VmHandle,
  stderrTail: ProvisionStderrTail,
): Promise<void> {
  const installT0 = Date.now();
  debug("install hook entry");
  ctx.phases.start("install");
  try {
    await opts.install(vm);
  } catch (err) {
    throw installHookError(err, stderrTail.tail());
  }
  ctx.phases.end("install");
  debug("install hook done elapsed=%dms", Date.now() - installT0);
}

function installHookError(err: unknown, tail: string): ProvisionError {
  const msg = err instanceof Error ? err.message : String(err);
  debug("install hook failed err=%s tailBytes=%d", msg, tail.length);
  return new ProvisionError(
    "PROVISION_INSTALL_HOOK_FAILED",
    `install hook failed: ${msg}\n--- VMM stderr (last 8 KB) ---\n${tail}`,
    { cause: err },
  );
}

async function tarProvisionRootfsToDisk(
  opts: ProvisionOptions,
  ctx: ProvisionContext,
  deadlineMs: number,
): Promise<void> {
  debug("tar / -> /dev/vdb starting");
  const tarT0 = Date.now();
  ctx.phases.start("tar-to-disk");
  const tar = await VsockExec.run(ctx.udsPath, TAR_TO_DISK_CMD, {
    execTimeoutMs: deadlineMs,
    ...tapExecForLog(TAR_TO_DISK_CMD, opts.onLog),
  });
  ctx.phases.end("tar-to-disk");
  debug("tar / -> /dev/vdb done exit=%d elapsed=%dms", tar.exitCode, Date.now() - tarT0);
  if (tar.exitCode !== 0) {
    throw new ProvisionError(
      "PROVISION_DISK_TOO_SMALL",
      `tar / to /dev/vdb failed (code ${tar.exitCode}) — scratch disk may be too small.\n` +
        `Bump scratchDiskSizeBytes. stderr:\n${tar.stderr}`,
    );
  }
}

async function poweroffProvisionGuest(
  opts: ProvisionOptions,
  ctx: ProvisionContext,
  vm: VmHandle,
): Promise<void> {
  debug("requesting guest poweroff");
  ctx.phases.start("poweroff-wait");
  await VsockExec.run(ctx.udsPath, "/sbin/machinen-poweroff", {
    connectTimeoutMs: 2_000,
    ...tapExecForLog("/sbin/machinen-poweroff", opts.onLog),
  }).catch(() => {});
  console.error("provision: waiting for guest exit…");
  await vm.wait();
  ctx.phases.end("poweroff-wait");
  debug("guest exited");
}

async function killProvisionVm(vm: VmHandle): Promise<void> {
  if (vm.pid > 0) {
    await vm.kill().catch(() => {});
  }
}

function repackProvisionOutput(opts: ProvisionOptions, ctx: ProvisionContext): void {
  debug("repack disk tar -> %s starting", ctx.outAbs);
  const repackT0 = Date.now();
  ctx.phases.start("repack-targz");
  repackDiskTarToGz(ctx.diskPath, ctx.outAbs, {
    cmd: opts.cmd,
    env: opts.env,
    onPhase: (name, ms) => ctx.phases.mark(`repack-targz.${name}`, ms),
  });
  ctx.phases.end("repack-targz");
  debug("repack done elapsed=%dms", Date.now() - repackT0);
}

function finishProvision(opts: ProvisionOptions, ctx: ProvisionContext): ProvisionResult {
  const sizeBytes = statSync(ctx.outAbs).size;
  warmImageConfigCache(ctx.outAbs, provisionImageConfig(opts));
  const elapsedMs = Date.now() - ctx.t0;
  debug("provision complete sizeBytes=%d totalElapsed=%dms", sizeBytes, elapsedMs);
  ctx.phases.flush(debug, "provision", elapsedMs);
  opts.onLog?.(ctx.phases.toEvent("provision", elapsedMs));
  return { imagePath: ctx.outAbs, sizeBytes, elapsedMs };
}

function provisionImageConfig(
  opts: ProvisionOptions,
): { cmd?: string[]; env?: Record<string, string> } | null {
  if (!opts.cmd && !opts.env) {
    return null;
  }
  return {
    ...(opts.cmd ? { cmd: opts.cmd } : {}),
    ...(opts.env ? { env: opts.env } : {}),
  };
}

function cleanupProvisionWorkDir(workDir: string): void {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {}
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
 * #233 follow-up: also prebakes the runtime cache image. The
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
    prebakeRootfsImageFromTree({
      tarPath: outAbs,
      treeDir: extractDir,
      onPhase: opts.onPhase,
    });
  } finally {
    try {
      rmSync(extractDir, { recursive: true, force: true });
    } catch {}
  }
}
