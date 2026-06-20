// Build an initramfs cpio archive for the microvm boot path.
//
// The newc cpio encoder and filesystem/archive walking live in the
// runtime Zig helper. This TypeScript module keeps the public API,
// input validation, config/env patching, merge staging, and CLI glue.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { arch as osArch, platform as osPlatform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import debugLib from "debug";
import { MkinitramfsError } from "./errors.ts";
import { packMkinitramfsNative } from "./native/mkinitramfs.ts";

const require_ = createRequire(import.meta.url);
const debug = debugLib("machinen:mkinitramfs");

/**
 * Default excludes applied to --workspace packs. Skip the usual dev
 * droppings that nobody wants dragged into a tmpfs at boot.
 */
const DEFAULT_WORKSPACE_EXCLUDES = new Set<string>([
  ".git",
  "node_modules",
  ".zig-cache",
  "target",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  "venv",
  ".DS_Store",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  ".pnpm-store",
]);

/** Parse an excludes file (one fnmatch-style pattern per line, `#` comments). */
function loadExcludes(path: string): string[] {
  const raw = readFileSync(path, "utf8");
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const stripped = line.split("#", 1)[0]!.trim();
    if (stripped) {
      out.push(stripped.replace(/^\//, ""));
    }
  }
  return out;
}

export interface PackBundleOptions {
  /** Bundle directory with rootfs/ + machinen-config.json. */
  bundle: string;
  /** Path to the initramfs cpio to write. */
  out: string;
  /**
   * Optional arch-specific base rootfs tarball
   * (`rootfs-debian-arm64.tar.gz` or `rootfs-debian-amd64.tar.gz`).
   */
  base?: string;
  /**
   * A single host directory copied into the guest between the base
   * tarball and the bundle's rootfs. Bundle files win on path
   * collisions. The caller is responsible for validating host exists
   * and is a directory, and that guest lives under `/mnt/`. See #64.
   */
  mount?: { host: string; guest: string };
  /**
   * Extra env vars to merge into the bundle's machinen-config.json `env`
   * field before packing. The bundle's on-disk env wins on key collision
   * (same precedence as the mount overlay — bundle always gets the last
   * word). See #89.
   */
  env?: Record<string, string>;
  /** fnmatch patterns matched against each rootfs-relative path. */
  excludes?: string[];
  /** Optional path to the compiled /init. Default: ../microvm/test-fixtures/init relative to this file. */
  initPath?: string;
  /**
   * Optional path to the compiled /exec-agent. Default: same dir as
   * /init under packages/microvm/test-fixtures/. Used to override the
   * stale /exec-agent that may live in a re-provisioned base tarball.
   */
  execAgentPath?: string;
}

interface PackBundlePaths {
  rootfsDir: string;
  cfgPath: string;
}

interface PackBundleSource {
  packSrc: string;
  mergeTmp?: string;
}

export function packBundle(opts: PackBundleOptions): void {
  const t0 = Date.now();
  const paths = validatePackBundleInputs(opts);
  const source = preparePackBundleSource(opts, paths.rootfsDir);
  try {
    const initPath = opts.initPath ?? defaultInitPath();
    validateInitReadable(initPath);
    packMkinitramfsNative({
      mode: "rootfs",
      rootfs: source.packSrc,
      out: opts.out,
      excludes: opts.excludes ?? [],
      initPath,
      config: patchConfigEnv(readFileSync(paths.cfgPath), opts.env).toString("utf8"),
      injectInit: true,
      allowMissingInit: allowMissingInitFixture(),
      execAgentPath: opts.execAgentPath ?? defaultExecAgentPath(),
    });
    debug("packBundle done elapsed=%dms", Date.now() - t0);
  } finally {
    cleanupMergedPackSource(source.mergeTmp);
  }
}

function validatePackBundleInputs(opts: PackBundleOptions): PackBundlePaths {
  const rootfsDir = join(opts.bundle, "rootfs");
  const cfgPath = join(opts.bundle, "machinen-config.json");
  if (!statSync(rootfsDir).isDirectory()) {
    throw new MkinitramfsError("MKINITRAMFS_BUNDLE_INVALID", `--bundle: missing ${rootfsDir}`);
  }
  if (!statSync(cfgPath).isFile()) {
    throw new MkinitramfsError("MKINITRAMFS_BUNDLE_INVALID", `--bundle: missing ${cfgPath}`);
  }
  return { rootfsDir, cfgPath };
}

function preparePackBundleSource(opts: PackBundleOptions, rootfsDir: string): PackBundleSource {
  const needsMerge = Boolean(opts.base) || Boolean(opts.mount);
  debug(
    "packBundle bundle=%s out=%s base=%s mount=%s needsMerge=%s",
    opts.bundle,
    opts.out,
    opts.base ?? "<none>",
    opts.mount ? `${opts.mount.host}->${opts.mount.guest}` : "<none>",
    needsMerge,
  );
  if (!needsMerge) {
    return { packSrc: rootfsDir };
  }
  return prepareMergedPackSource(opts, rootfsDir);
}

function prepareMergedPackSource(opts: PackBundleOptions, rootfsDir: string): PackBundleSource {
  const mergeTmp = mkdtempSync(join(tmpdir(), "machinen-mkinitramfs-"));
  try {
    if (opts.base) {
      extractBaseRootfs(opts.base, mergeTmp);
    }
    if (opts.mount) {
      overlayMount(mergeTmp, opts.mount.host, opts.mount.guest);
    }
    cpSync(rootfsDir, mergeTmp, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
    return { packSrc: mergeTmp, mergeTmp };
  } catch (err) {
    cleanupMergedPackSource(mergeTmp);
    throw err;
  }
}

function extractBaseRootfs(base: string, mergeTmp: string): void {
  const extractT0 = Date.now();
  const res = spawnSync("tar", ["-xzf", base, "-C", mergeTmp]);
  if (res.status !== 0) {
    throw new MkinitramfsError(
      "MKINITRAMFS_BASE_EXTRACT_FAILED",
      `tar -xzf ${base} failed: ${res.stderr?.toString() ?? ""}`,
    );
  }
  debug("base extracted elapsed=%dms", Date.now() - extractT0);
}

function cleanupMergedPackSource(mergeTmp: string | undefined): void {
  if (mergeTmp) {
    rmSync(mergeTmp, { recursive: true, force: true });
  }
}

/**
 * Merge runtime-injected env into the bundle's machinen-config.json
 * `env` object. Bundle keys win on collision.
 */
export function patchConfigEnv(config: Buffer, env?: Record<string, string>): Buffer {
  if (!env || Object.keys(env).length === 0) {
    return config;
  }
  const parsed = JSON.parse(config.toString("utf8")) as {
    env?: Record<string, string>;
    [k: string]: unknown;
  };
  const existing = parsed.env ?? {};
  parsed.env = { ...env, ...existing };
  return Buffer.from(JSON.stringify(parsed), "utf8");
}

/** Copy a host directory into the merged rootfs at `guest`. */
function overlayMount(mergeRoot: string, hostAbs: string, guest: string): void {
  const rel = guest.replace(/^\/+/, "");
  const dst = join(mergeRoot, rel);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(hostAbs, dst, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  });
}

export interface PackTinyBundleOptions {
  /** Bundle directory with machinen-config.json. The bundle's rootfs/ is ignored — the on-disk rootfs is on /dev/vda. */
  bundle: string;
  /** Path to the initramfs cpio to write. */
  out: string;
  /** Extra env merged into the bundle's machinen-config.json. Bundle keys win on collision. */
  env?: Record<string, string>;
  /**
   * Guest mountpoint for the `--mount` overlay (#272). When set, the
   * cpio carries `/etc/machinen-mountdisk-guest` with this path so
   * /init knows where to layer the squashfs+ext4 overlay after the
   * rootdisk pivot. The actual payload rides on virtio-blk slots 5+6,
   * not in the cpio. Must be an absolute path under `/mnt/`.
   */
  mountGuest?: string;
  /** Optional override for the compiled /init. Default: ../microvm/test-fixtures/init relative to this file. */
  initPath?: string;
}

/**
 * Build the tiny initramfs used by every user-facing boot() (#119).
 *
 * Layout:
 *   /init                            compiled Zig init
 *   /machinen-config.json            cmd/env/cwd/liveMounts for /init
 *   /etc/machinen-boot-epoch         wall clock seed for the guest
 *   /etc/machinen-mountdisk-guest    optional, target dir for the
 *                                    `--mount` overlay (#272). The
 *                                    actual payload rides on virtio-
 *                                    blk slots 5+6, not in the cpio.
 *   /dev/console                     char node 5,1 — kernel needs it
 *                                    before /init re-opens the console
 *   /tmp                             sticky 1777
 *
 * No /lib/modules tree, no kmod, no /modules/*.ko, no Debian userland.
 * The custom kernel ships with virtio_*, ext4, vsock, squashfs, and
 * overlayfs built in (scripts/build-kernel-arm64.sh), so /init pivots
 * straight into /dev/vda without a finit_module pass.
 */
export function packTinyBundle(opts: PackTinyBundleOptions): void {
  const t0 = Date.now();
  const cfgPath = join(opts.bundle, "machinen-config.json");
  if (!statSync(cfgPath).isFile()) {
    throw new MkinitramfsError("MKINITRAMFS_BUNDLE_INVALID", `--bundle: missing ${cfgPath}`);
  }
  const initPath = opts.initPath ?? defaultInitPath();
  validateInitReadable(initPath);
  packMkinitramfsNative({
    mode: "tiny",
    out: opts.out,
    initPath,
    config: patchConfigEnv(readFileSync(cfgPath), opts.env).toString("utf8"),
    injectInit: true,
    allowMissingInit: allowMissingInitFixture(),
    mountGuest: opts.mountGuest,
  });
  debug("packTinyBundle done elapsed=%dms", Date.now() - t0);
}

export interface PackRootfsOptions {
  rootfs: string;
  out: string;
  config?: string;
  excludes?: string[];
  initPath?: string;
}

export function packRootfs(opts: PackRootfsOptions): void {
  const initPath = opts.initPath ?? defaultInitPath();
  validateInitReadable(initPath);
  packMkinitramfsNative({
    mode: "rootfs",
    rootfs: opts.rootfs,
    out: opts.out,
    excludes: opts.excludes ?? [],
    initPath,
    config: opts.config ? readFileSync(opts.config, "utf8") : undefined,
    injectInit: true,
    allowMissingInit: allowMissingInitFixture(),
  });
}

export interface PackMinimalOptions {
  out: string;
  initPath?: string;
  config?: string;
}

export function packMinimal(opts: PackMinimalOptions): void {
  const initPath = opts.initPath ?? defaultInitPath();
  validateInitReadable(initPath);
  packMkinitramfsNative({
    mode: "minimal",
    out: opts.out,
    initPath,
    config: opts.config ? readFileSync(opts.config, "utf8") : undefined,
    injectInit: true,
    allowMissingInit: allowMissingInitFixture(),
  });
}

export interface PackWorkspaceOptions {
  workspace: string;
  out: string;
  /** Directory name inside the cpio (default `workspace`). */
  mountpoint?: string;
  /** Basename-matched excludes. Default: DEFAULT_WORKSPACE_EXCLUDES. */
  excludes?: Iterable<string>;
  /** Max final size in MiB (default 500). Throws if exceeded. */
  maxMb?: number;
}

export function packWorkspace(opts: PackWorkspaceOptions): void {
  if (!statSync(opts.workspace).isDirectory()) {
    throw new MkinitramfsError(
      "MKINITRAMFS_WORKSPACE_INVALID",
      `--workspace: ${opts.workspace} is not a directory`,
    );
  }
  try {
    const result = packMkinitramfsNative({
      mode: "workspace",
      workspace: opts.workspace,
      out: opts.out,
      mountpoint: opts.mountpoint ?? "workspace",
      excludes: [...(opts.excludes ?? DEFAULT_WORKSPACE_EXCLUDES)],
      maxMb: opts.maxMb ?? 500,
    });
    process.stderr.write(`  workspace files: ${result.workspaceBytes} bytes\n`);
  } catch (err) {
    if (err instanceof MkinitramfsError && err.code === "MKINITRAMFS_WORKSPACE_TOO_LARGE") {
      throw new MkinitramfsError(
        "MKINITRAMFS_WORKSPACE_TOO_LARGE",
        `workspace exceeded cap ${opts.maxMb ?? 500} MB. ` +
          `Try --exclude <dir> for each big subdir, or --max-mb <N> to raise the cap.`,
        { cause: err },
      );
    }
    throw err;
  }
}

function validateInitReadable(initPath: string): void {
  if (allowMissingInitFixture()) {
    return;
  }
  try {
    readFileSync(initPath);
  } catch (err) {
    throw missingInitError(initPath, err);
  }
}

function allowMissingInitFixture(): boolean {
  return process.env.MACHINEN_REQUIRE_FIXTURES === "0";
}

function missingInitError(initPath: string, err: unknown): MkinitramfsError {
  return new MkinitramfsError(
    "MKINITRAMFS_INIT_MISSING",
    `mkinitramfs: /init binary not readable at ${initPath} (${mkinitramfsErrorMessage(err)}). ` +
      `Build it with scripts/build-base-assets.sh, or pass initPath to point at a custom one.`,
    { cause: err },
  );
}

function mkinitramfsErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface VmmGuestPaths {
  initPath: string;
  execAgentPath: string;
}

let cachedGuestPaths: VmmGuestPaths | null = null;

function resolveGuestPaths(): VmmGuestPaths {
  if (cachedGuestPaths) {
    return cachedGuestPaths;
  }
  const pkgName = `@machinen/native-${osArch()}-${osPlatform()}`;
  try {
    const mod = require_(pkgName) as Partial<VmmGuestPaths>;
    if (mod.initPath && mod.execAgentPath && existsSync(mod.initPath)) {
      cachedGuestPaths = {
        initPath: mod.initPath,
        execAgentPath: mod.execAgentPath,
      };
      return cachedGuestPaths;
    }
  } catch {
    // Fall through to the workspace layout below.
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const fixtures = join(here, "..", "..", "microvm", "test-fixtures");
  cachedGuestPaths = {
    initPath: join(fixtures, "init"),
    execAgentPath: join(fixtures, "exec-agent"),
  };
  return cachedGuestPaths;
}

function defaultInitPath(): string {
  return resolveGuestPaths().initPath;
}

function defaultExecAgentPath(): string {
  return resolveGuestPaths().execAgentPath;
}

/**
 * Invoked by the CLI shim at packages/microvm/test-fixtures/assets/mkinitramfs.ts.
 * Kept argv-compatible with the old Python script so shell fixtures
 * (smoke.sh, try.sh, handoff.sh) don't need deeper changes.
 */
export function cli(argv: string[]): void {
  if (argv[0] === "--workspace") {
    runWorkspaceCli(argv);
    return;
  }

  const flags = parseSharedCliFlags(argv);
  if (flags.args[0] === "--bundle") {
    runBundleCli(flags);
    return;
  }
  if (flags.args[0] === "--rootfs") {
    runRootfsCli(flags);
    return;
  }
  runMinimalCli(flags);
}

interface SharedCliFlags {
  args: string[];
  outOverride: string | undefined;
  configFlag: string | undefined;
  excludes: string[];
  baseFlag: string | undefined;
}

function runWorkspaceCli(argv: string[]): void {
  const opts = parseWorkspaceCli(argv);
  process.stderr.write(`packing workspace: ${opts.src} -> ${opts.out}\n`);
  const excludes = new Set<string>([...DEFAULT_WORKSPACE_EXCLUDES, ...opts.extraEx]);
  packWorkspace({ workspace: opts.src, out: opts.out, excludes, maxMb: opts.maxMb });
  reportWrote(opts.out, process.stderr);
}

function parseWorkspaceCli(argv: string[]): {
  src: string;
  out: string;
  extraEx: Set<string>;
  maxMb: number;
} {
  const src = argv[1];
  if (!src) {
    die("--workspace requires <dir>");
  }
  const opts = parseWorkspaceCliFlags(argv.slice(2));
  if (!opts.out) {
    die("--workspace requires --out <path>");
  }
  return { src, out: opts.out, extraEx: opts.extraEx, maxMb: opts.maxMb };
}

function parseWorkspaceCliFlags(args: string[]): {
  out: string | undefined;
  extraEx: Set<string>;
  maxMb: number;
} {
  let out: string | undefined;
  const extraEx = new Set<string>();
  let maxMb = 500;
  for (let i = 0; i < args.length; ) {
    const flag = args[i];
    if (flag === "--out") {
      out = args[i + 1];
      i += 2;
      continue;
    }
    if (flag === "--exclude") {
      extraEx.add(args[i + 1]!);
      i += 2;
      continue;
    }
    if (flag === "--max-mb") {
      maxMb = parseInt(args[i + 1]!, 10);
      i += 2;
      continue;
    }
    die(`unknown flag: ${flag}`);
  }
  return { out, extraEx, maxMb };
}

function parseSharedCliFlags(argv: string[]): SharedCliFlags {
  const args = [...argv];
  const outOverride = takeFlag(args, "--out");
  const configFlag = takeFlag(args, "--config");
  const excludeFromFlag = takeFlag(args, "--exclude-from");
  const baseFlag = takeFlag(args, "--base");
  return {
    args,
    outOverride,
    configFlag,
    excludes: excludeFromFlag ? loadExcludes(excludeFromFlag) : [],
    baseFlag,
  };
}

function runBundleCli(flags: SharedCliFlags): void {
  const bundle = flags.args[1];
  if (!bundle) {
    die("--bundle requires <dir>");
  }
  const out = flags.outOverride ?? defaultOut();
  process.stdout.write(`packing bundle: ${bundle}\n`);
  packBundle({ bundle, out, base: flags.baseFlag, excludes: flags.excludes });
  reportWrote(out, process.stdout);
}

function runRootfsCli(flags: SharedCliFlags): void {
  const rootfs = flags.args[1];
  if (!rootfs) {
    die("--rootfs requires <dir>");
  }
  const out = flags.outOverride ?? defaultOut();
  process.stdout.write(`packing rootfs: ${rootfs}\n`);
  packRootfs({ rootfs, out, config: flags.configFlag, excludes: flags.excludes });
  reportWrote(out, process.stdout);
}

function runMinimalCli(flags: SharedCliFlags): void {
  const out = flags.outOverride ?? defaultOut();
  packMinimal({ out, config: flags.configFlag });
  reportWrote(out, process.stdout);
}

function reportWrote(out: string, stream: NodeJS.WritableStream): void {
  const st = statSync(out);
  stream.write(`wrote ${out} (${st.size} bytes)\n`);
}

function takeFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) {
    return undefined;
  }
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}

function defaultOut(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "microvm", "test-fixtures", "initramfs.cpio");
}

function die(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(2);
}
