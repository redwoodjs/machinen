// Build an initramfs cpio archive for the microvm boot path.
//
// Newc cpio format, written byte-for-byte so we can include device
// nodes that macOS's native cpio tooling can't produce.
//
// Four modes exposed as functions:
//
//   packTinyBundle({ bundle, out, ... }) — pack a minimal cpio for the
//     rootDisk boot path (#119): /init + /machinen-config.json +
//     /etc/machinen-boot-epoch + /dev/console. ~500 KB. The on-disk
//     rootfs is mounted from /dev/vda by /init; the kernel ships with
//     virtio_*, ext4, and vsock built in, so no /modules/*.ko or
//     finit_module pass is needed at boot.
//
//   packBundle({ bundle, base?, excludes?, out }) — pack a bundle's
//     rootfs/, optionally overlaying it on a base tarball. Includes the
//     bundle's machinen-config.json + a /dev/console node + a trailer.
//     ~50 MB. Used by provision() (which needs a Debian userland in the
//     cpio to run apt + tar against /dev/vda).
//
//   packRootfs({ rootfs, config?, excludes?, out }) — pack a rootfs
//     directory directly. Adds /dev/console + trailer.
//
//   packWorkspace({ workspace, mountpoint?, excludes?, out, maxMb? })
//     — pack everything under `workspace` rooted at /<mountpoint>.
//     No trailer — designed to be appended to a base archive via
//     the kernel's multi-cpio unpacker.
//
// This replaces the old test-fixtures/mkinitramfs.py and keeps the
// same on-wire cpio layout so existing bundles keep booting.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { arch as osArch, platform as osPlatform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import debugLib from "debug";
import { MkinitramfsError } from "./errors.ts";

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

// --- newc cpio encoder ---------------------------------------------

interface NewcOptions {
  uid?: number;
  gid?: number;
  nlink?: number;
  mtime?: number;
  rmajor?: number;
  rminor?: number;
  data?: Buffer;
}

interface NormalizedNewcOptions {
  uid: number;
  gid: number;
  nlink: number;
  mtime: number;
  rmajor: number;
  rminor: number;
  data: Buffer;
}

/** Emit one newc cpio entry as a Buffer. */
function newc(name: string, mode: number, opts: NewcOptions = {}): Buffer {
  const normalized = normalizeNewcOptions(opts);
  const nameBytes = newcNameBytes(name);
  const header = Buffer.from(newcHeader(mode, normalized, nameBytes.length), "ascii");
  return newcEntryBuffer(header, nameBytes, normalized.data);
}

function normalizeNewcOptions(opts: NewcOptions): NormalizedNewcOptions {
  return {
    uid: opts.uid ?? 0,
    gid: opts.gid ?? 0,
    nlink: opts.nlink ?? 1,
    mtime: opts.mtime ?? 0,
    rmajor: opts.rmajor ?? 0,
    rminor: opts.rminor ?? 0,
    data: opts.data ?? Buffer.alloc(0),
  };
}

function newcNameBytes(name: string): Buffer {
  return Buffer.concat([Buffer.from(name, "utf8"), Buffer.from([0])]);
}

function newcHeader(mode: number, opts: NormalizedNewcOptions, nameSize: number): string {
  return "070701" + newcFields(mode, opts, nameSize).map(newcHexField).join("");
}

function newcFields(mode: number, opts: NormalizedNewcOptions, nameSize: number): number[] {
  return [
    0,
    mode,
    opts.uid,
    opts.gid,
    opts.nlink,
    opts.mtime,
    opts.data.length,
    0, // devmajor
    0, // devminor
    opts.rmajor,
    opts.rminor,
    nameSize,
    0, // check
  ];
}

function newcHexField(value: number): string {
  return value.toString(16).padStart(8, "0");
}

function newcEntryBuffer(header: Buffer, nameBytes: Buffer, data: Buffer): Buffer {
  return Buffer.concat([
    padNewcPart(Buffer.concat([header, nameBytes])),
    data,
    newcPadding(data.length),
  ]);
}

function padNewcPart(buf: Buffer): Buffer {
  const padding = newcPadding(buf.length);
  return padding.length === 0 ? buf : Buffer.concat([buf, padding]);
}

function newcPadding(length: number): Buffer {
  return Buffer.alloc(newcPaddingLength(length));
}

function newcPaddingLength(length: number): number {
  return (4 - (length % 4)) % 4;
}

// --- excludes ------------------------------------------------------

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

/** fnmatch-case port — handles `*`, `?`, `[abc]`, `[!abc]`. */
function fnmatchCase(name: string, pat: string): boolean {
  return fnmatchRegex(pat).test(name);
}

interface FnmatchToken {
  source: string;
  nextIndex: number;
}

const SIMPLE_FNMATCH_TOKENS: Record<string, string> = {
  "*": ".*",
  "?": ".",
};

function fnmatchRegex(pat: string): RegExp {
  let re = "^";
  for (let i = 0; i < pat.length; i++) {
    const token = translateFnmatchToken(pat, i);
    re += token.source;
    i = token.nextIndex;
  }
  return new RegExp(re + "$");
}

function translateFnmatchToken(pat: string, index: number): FnmatchToken {
  const c = pat[index]!;
  const simple = SIMPLE_FNMATCH_TOKENS[c];
  if (simple !== undefined) {
    return { source: simple, nextIndex: index };
  }
  if (c === "[") {
    return translateFnmatchClass(pat, index);
  }
  return { source: regexLiteral(c), nextIndex: index };
}

function translateFnmatchClass(pat: string, index: number): FnmatchToken {
  const end = findFnmatchClassEnd(pat, index);
  if (end === -1) {
    return { source: "\\[", nextIndex: index };
  }
  return { source: normalizeFnmatchClass(pat.slice(index, end + 1)), nextIndex: end };
}

function findFnmatchClassEnd(pat: string, index: number): number {
  let j = fnmatchClassBodyStart(pat, index);
  while (j < pat.length && pat[j] !== "]") {
    j++;
  }
  return j >= pat.length ? -1 : j;
}

function fnmatchClassBodyStart(pat: string, index: number): number {
  let j = index + 1;
  if (pat[j] === "!") {
    j++;
  }
  if (pat[j] === "]") {
    j++;
  }
  return j;
}

function normalizeFnmatchClass(cls: string): string {
  return cls.startsWith("[!") ? "[^" + cls.slice(2) : cls;
}

function regexLiteral(c: string): string {
  return REGEX_SPECIAL_CHARS.test(c) ? "\\" + c : c;
}

const REGEX_SPECIAL_CHARS = /[\\^$.+()|{}]/;

// --- filesystem walk ----------------------------------------------

interface WalkCounts {
  files: number;
  bytes: number;
}

/**
 * Walk `root`, yielding cpio entries for every file/dir/symlink.
 *
 * Symlinks are never followed — whether they target a file or a
 * directory, they're emitted as symlink entries. This preserves the
 * /bin → /usr/bin style aliases on modern Debian.
 *
 * `excludes` are fnmatch patterns matched against each entry's
 * rootfs-relative path. A match prunes the entry and (for directories)
 * its subtree.
 */
function* entriesFromRootfs(
  root: string,
  excludes: string[],
  counts: WalkCounts,
): Generator<Buffer> {
  yield newc(".", 0o40755);
  yield* walkRootfs(root, "", excludes, counts);
}

type FsStats = import("node:fs").Stats;

function* walkRootfs(
  root: string,
  rel: string,
  excludes: string[],
  counts: WalkCounts,
): Generator<Buffer> {
  const full = rel ? join(root, rel) : root;
  const entries = readSortedDir(full);
  if (!entries) {
    return;
  }

  for (const name of entries) {
    yield* walkRootfsChild(root, rel, full, name, excludes, counts);
  }
}

function* walkRootfsChild(
  root: string,
  rel: string,
  parentFull: string,
  name: string,
  excludes: string[],
  counts: WalkCounts,
): Generator<Buffer> {
  const childRel = rel ? join(rel, name) : name;
  const childFull = join(parentFull, name);
  if (isExcludedRootfsEntry(childRel, childFull, excludes, counts)) {
    return;
  }
  const st = tryLstat(childFull);
  if (!st) {
    return;
  }
  yield* rootfsEntryFromStats(root, childRel, childFull, st, excludes, counts);
}

function isExcludedRootfsEntry(
  childRel: string,
  childFull: string,
  excludes: string[],
  counts: WalkCounts,
): boolean {
  if (!excludes.some((pat) => fnmatchCase(childRel, pat))) {
    return false;
  }
  countExcludedRootfsFile(childFull, counts);
  return true;
}

function countExcludedRootfsFile(childFull: string, counts: WalkCounts): void {
  const st = tryLstat(childFull);
  if (st?.isFile()) {
    counts.files += 1;
    counts.bytes += st.size;
  }
}

function* rootfsEntryFromStats(
  root: string,
  childRel: string,
  childFull: string,
  st: FsStats,
  excludes: string[],
  counts: WalkCounts,
): Generator<Buffer> {
  const mode = st.mode & 0o7777;
  if (st.isSymbolicLink()) {
    yield newc(childRel, 0o120000 | mode, { data: Buffer.from(readlinkSync(childFull), "utf8") });
    return;
  }
  if (st.isDirectory()) {
    yield newc(childRel, 0o40000 | mode);
    yield* walkRootfs(root, childRel, excludes, counts);
    return;
  }
  if (st.isFile()) {
    yield newc(childRel, 0o100000 | mode, { data: readFileSync(childFull) });
  }
  // Device/fifo/socket nodes are skipped — added by hand below.
}

function* workspaceEntries(
  src: string,
  mountpoint: string,
  excludes: Set<string>,
  counts: WalkCounts,
): Generator<Buffer> {
  yield newc(mountpoint, 0o40755);
  yield* walkWorkspace(src, "", mountpoint, excludes, counts);
}

function* walkWorkspace(
  root: string,
  rel: string,
  mountpoint: string,
  excludes: Set<string>,
  counts: WalkCounts,
): Generator<Buffer> {
  const full = rel ? join(root, rel) : root;
  const entries = readSortedDir(full);
  if (!entries) {
    return;
  }

  for (const name of entries) {
    yield* walkWorkspaceChild(root, rel, full, name, mountpoint, excludes, counts);
  }
}

function* walkWorkspaceChild(
  root: string,
  rel: string,
  parentFull: string,
  name: string,
  mountpoint: string,
  excludes: Set<string>,
  counts: WalkCounts,
): Generator<Buffer> {
  if (excludes.has(name)) {
    return;
  }
  const childRel = rel ? join(rel, name) : name;
  const childFull = join(parentFull, name);
  const st = tryLstat(childFull);
  if (!st) {
    return;
  }
  yield* workspaceEntryFromStats(root, childRel, childFull, mountpoint, st, excludes, counts);
}

function* workspaceEntryFromStats(
  root: string,
  childRel: string,
  childFull: string,
  mountpoint: string,
  st: FsStats,
  excludes: Set<string>,
  counts: WalkCounts,
): Generator<Buffer> {
  const arcName = `${mountpoint}/${childRel}`;
  const mode = st.mode & 0o7777;
  if (st.isSymbolicLink()) {
    yield newc(arcName, 0o120000 | mode, { data: Buffer.from(readlinkSync(childFull), "utf8") });
    return;
  }
  if (st.isDirectory()) {
    yield newc(arcName, 0o40000 | mode);
    yield* walkWorkspace(root, childRel, mountpoint, excludes, counts);
    return;
  }
  if (st.isFile()) {
    yield* workspaceFileEntry(arcName, childFull, mode, counts);
  }
}

function* workspaceFileEntry(
  arcName: string,
  childFull: string,
  mode: number,
  counts: WalkCounts,
): Generator<Buffer> {
  const data = readFileSync(childFull);
  counts.bytes += data.length;
  yield newc(arcName, 0o100000 | mode, { data });
}

function readSortedDir(full: string): string[] | undefined {
  try {
    return readdirSync(full).sort();
  } catch {
    return undefined;
  }
}

function tryLstat(path: string): FsStats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

// --- public API ----------------------------------------------------

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
    writePackedBundle(opts, paths.cfgPath, source.packSrc, t0);
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
  debugPackBundleStart(opts, needsMerge);
  if (!needsMerge) {
    return { packSrc: rootfsDir };
  }
  return prepareMergedPackSource(opts, rootfsDir);
}

function debugPackBundleStart(opts: PackBundleOptions, needsMerge: boolean): void {
  debug(
    "packBundle bundle=%s out=%s base=%s mount=%s needsMerge=%s",
    opts.bundle,
    opts.out,
    opts.base ?? "<none>",
    opts.mount ? `${opts.mount.host}->${opts.mount.guest}` : "<none>",
    needsMerge,
  );
}

function prepareMergedPackSource(opts: PackBundleOptions, rootfsDir: string): PackBundleSource {
  const mergeTmp = mkdtempSync(join(tmpdir(), "machinen-mkinitramfs-"));
  try {
    extractBaseIfPresent(opts, mergeTmp);
    overlayMountIfPresent(opts, mergeTmp);
    copyBundleRootfs(rootfsDir, mergeTmp);
    return { packSrc: mergeTmp, mergeTmp };
  } catch (err) {
    cleanupMergedPackSource(mergeTmp);
    throw err;
  }
}

function extractBaseIfPresent(opts: PackBundleOptions, mergeTmp: string): void {
  if (opts.base) {
    extractBaseRootfs(opts.base, mergeTmp);
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

function overlayMountIfPresent(opts: PackBundleOptions, mergeTmp: string): void {
  if (opts.mount) {
    overlayMount(mergeTmp, opts.mount.host, opts.mount.guest);
  }
}

function copyBundleRootfs(rootfsDir: string, mergeTmp: string): void {
  cpSync(rootfsDir, mergeTmp, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  });
}

function writePackedBundle(
  opts: PackBundleOptions,
  cfgPath: string,
  packSrc: string,
  t0: number,
): void {
  const counts: WalkCounts = { files: 0, bytes: 0 };
  const parts: Buffer[] = [];
  for (const e of entriesFromRootfs(packSrc, opts.excludes ?? [], counts)) {
    parts.push(e);
  }
  appendFinalEntries(parts, {
    initPath: opts.initPath ?? defaultInitPath(),
    config: patchConfigEnv(readFileSync(cfgPath), opts.env),
    injectInit: true,
    execAgentPath: opts.execAgentPath ?? defaultExecAgentPath(),
  });
  writeFileSync(opts.out, Buffer.concat(parts));
  debug(
    "packBundle done files=%d bytes=%d elapsed=%dms",
    counts.files,
    counts.bytes,
    Date.now() - t0,
  );
}

function cleanupMergedPackSource(mergeTmp: string | undefined): void {
  if (mergeTmp) {
    rmSync(mergeTmp, { recursive: true, force: true });
  }
}

/**
 * Merge runtime-injected env into the bundle's machinen-config.json
 * `env` object. Bundle keys win on collision: the on-disk config is the
 * source of truth, and runtime injection fills in anything it hasn't
 * already declared. Bundles without an `env` field get one created.
 *
 * Returns the original buffer unchanged when there's nothing to inject,
 * so unrelated callers don't pay a parse/stringify round-trip.
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

/**
 * Copy a host directory into the merged rootfs at `guest`. Creates
 * parent directories as needed. Merges into any existing tree at the
 * destination (later layers overwrite per-file).
 */
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

  const parts: Buffer[] = [];
  parts.push(newc(".", 0o40755));

  appendFinalEntries(parts, {
    initPath: opts.initPath ?? defaultInitPath(),
    config: patchConfigEnv(readFileSync(cfgPath), opts.env),
    injectInit: true,
    mountGuest: opts.mountGuest,
  });
  writeFileSync(opts.out, Buffer.concat(parts));
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
  const counts: WalkCounts = { files: 0, bytes: 0 };
  const parts: Buffer[] = [];
  for (const e of entriesFromRootfs(opts.rootfs, opts.excludes ?? [], counts)) {
    parts.push(e);
  }
  appendFinalEntries(parts, {
    initPath: opts.initPath ?? defaultInitPath(),
    config: opts.config ? readFileSync(opts.config) : undefined,
    injectInit: true,
  });
  writeFileSync(opts.out, Buffer.concat(parts));
}

export interface PackMinimalOptions {
  out: string;
  initPath?: string;
  config?: string;
}

export function packMinimal(opts: PackMinimalOptions): void {
  const initPath = opts.initPath ?? defaultInitPath();
  const parts: Buffer[] = [
    newc(".", 0o40755),
    newc("dev", 0o40755),
    newc("init", 0o100755, { data: readFileSync(initPath) }),
  ];
  appendFinalEntries(parts, {
    initPath,
    config: opts.config ? readFileSync(opts.config) : undefined,
    injectInit: true,
  });
  writeFileSync(opts.out, Buffer.concat(parts));
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
  const excludes = new Set<string>(opts.excludes ?? DEFAULT_WORKSPACE_EXCLUDES);
  const mountpoint = opts.mountpoint ?? "workspace";
  const maxMb = opts.maxMb ?? 500;

  if (!statSync(opts.workspace).isDirectory()) {
    throw new MkinitramfsError(
      "MKINITRAMFS_WORKSPACE_INVALID",
      `--workspace: ${opts.workspace} is not a directory`,
    );
  }

  const counts: WalkCounts = { files: 0, bytes: 0 };
  const parts: Buffer[] = [];
  for (const e of workspaceEntries(opts.workspace, mountpoint, excludes, counts)) {
    parts.push(e);
  }
  const total = parts.reduce((n, b) => n + b.length, 0);
  if (total > maxMb * 1024 * 1024) {
    throw new MkinitramfsError(
      "MKINITRAMFS_WORKSPACE_TOO_LARGE",
      `workspace is ${(total / 1024 / 1024).toFixed(0)} MB (cap ${maxMb} MB). ` +
        `Try --exclude <dir> for each big subdir, or --max-mb <N> to raise the cap.`,
    );
  }
  parts.push(newc("TRAILER!!!", 0));
  writeFileSync(opts.out, Buffer.concat(parts));
  process.stderr.write(`  workspace files: ${counts.bytes} bytes\n`);
}

interface FinalOptions {
  initPath: string;
  config?: Buffer;
  /**
   * When true (legacy --rootfs mode), inject the compiled /init on top of
   * the walked rootfs. When false (--bundle mode), the base rootfs tarball
   * already carries its own /init and overriding it would shadow build-time
   * updates.
   */
  injectInit: boolean;
  /**
   * Optional path to /exec-agent. When set, the binary is appended to
   * the cpio after the rootfs walk so that any stale /exec-agent
   * captured in the base tarball gets overwritten by Linux's
   * initramfs unpacker (last entry wins). Same trick as `injectInit`.
   * Used by the provision flow where the base is the previous run's
   * frozen rootfs.
   */
  execAgentPath?: string;
  /**
   * #272: when set, write the absolute guest mountpoint into the cpio
   * at `/etc/machinen-mountdisk-guest`. /init reads this file on boot
   * and uses it as the target for the squashfs+ext4 overlay.
   */
  mountGuest?: string;
}

function appendFinalEntries(parts: Buffer[], opts: FinalOptions): void {
  appendInitIfRequested(parts, opts);
  appendExecAgentIfPresent(parts, opts.execAgentPath);
  appendConfigIfPresent(parts, opts.config);
  appendBootEpoch(parts);
  appendMountGuestIfPresent(parts, opts.mountGuest);
  appendFixedDeviceEntries(parts);
  parts.push(newc("TRAILER!!!", 0));
}

function appendInitIfRequested(parts: Buffer[], opts: FinalOptions): void {
  if (!opts.injectInit) {
    return;
  }
  const initBytes = readInitBytes(opts.initPath);
  if (initBytes) {
    parts.push(newc("init", 0o100755, { data: initBytes }));
  }
}

function readInitBytes(initPath: string): Buffer | undefined {
  try {
    return readFileSync(initPath);
  } catch (err) {
    if (process.env.MACHINEN_REQUIRE_FIXTURES === "0") {
      return undefined;
    }
    throw missingInitError(initPath, err);
  }
}

function missingInitError(initPath: string, err: unknown): MkinitramfsError {
  // packTinyBundle / packBundle both rely on /init mounting /dev/vda —
  // without it the kernel falls through to prepare_namespace() with no
  // `root=` and panics with "Can't open blockdev". A silent skip here
  // turned a missing fixture into an opaque kernel panic, so fail loudly.
  //
  // Tests that don't actually boot a real VMM (binary: "/bin/sh" and
  // friends) opt out via MACHINEN_REQUIRE_FIXTURES=0 — the same flag the
  // integration suites use to skip when fixtures are absent. Hosted CI
  // sets it; local dev with `pretest` doesn't, so this still fires for
  // anyone whose worktree is missing the build-base-assets.sh artifacts.
  return new MkinitramfsError(
    "MKINITRAMFS_INIT_MISSING",
    `mkinitramfs: /init binary not readable at ${initPath} (${mkinitramfsErrorMessage(err)}). ` +
      `Build it with scripts/build-base-assets.sh, or pass initPath to point at a custom one.`,
    { cause: err },
  );
}

function appendExecAgentIfPresent(parts: Buffer[], execAgentPath: string | undefined): void {
  if (!execAgentPath) {
    return;
  }
  try {
    const bytes = readFileSync(execAgentPath);
    parts.push(newc("exec-agent", 0o100755, { data: bytes }));
  } catch {
    // Optional — if the build hasn't produced one yet (fresh checkout,
    // first run before build-base-assets.sh), boots that didn't need
    // exec-agent (no vm.exec, no provision) keep working. The provision
    // flow itself depends on it and will fail downstream with a clearer
    // error if it's truly absent.
  }
}

function appendConfigIfPresent(parts: Buffer[], config: Buffer | undefined): void {
  if (config) {
    parts.push(newc("machinen-config.json", 0o100644, { data: config }));
  }
}

function appendBootEpoch(parts: Buffer[]): void {
  // Bake the host's current epoch so /init can set the guest clock.
  // Without this the guest boots at 1970-01-01 and TLS + apt Release
  // date validation break.
  parts.push(newc("etc", 0o40755));
  parts.push(
    newc("etc/machinen-boot-epoch", 0o100644, {
      data: Buffer.from(String(Math.floor(Date.now() / 1000)), "ascii"),
    }),
  );
}

function appendMountGuestIfPresent(parts: Buffer[], mountGuest: string | undefined): void {
  if (!mountGuest) {
    return;
  }
  // #272: tell /init which guest path to mount the `--mount` overlay
  // at. The actual squashfs+ext4 payload rides on virtio-blk slots 5
  // and 6 — only the target path lives in the cpio.
  parts.push(
    newc("etc/machinen-mountdisk-guest", 0o100644, {
      data: Buffer.from(mountGuest + "\n", "ascii"),
    }),
  );
}

function appendFixedDeviceEntries(parts: Buffer[]): void {
  parts.push(newc("dev", 0o40755));
  parts.push(newc("dev/console", 0o20600, { rmajor: 5, rminor: 1 }));
  // Force /tmp to the canonical sticky-world-writable (1777). The base
  // tarball ships /tmp that way but darwin tar strips the sticky bit
  // when extracting as non-root, so apt (which drops privs to _apt for
  // downloads) fails with "Couldn't create temporary file".
  parts.push(newc("tmp", 0o41777));
}

function mkinitramfsErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface VmmGuestPaths {
  initPath: string;
  execAgentPath: string;
}

let cachedGuestPaths: VmmGuestPaths | null = null;

/**
 * Resolve the guest binaries (init / exec-agent) that ride in the
 * host-arch-gated @machinen/native-<arch>-<os> package alongside the
 * host VMM. These ELFs match the guest CPU for that host package
 * (arm64 guests in native-arm64-*, amd64 guests in native-x64-linux);
 * the host runtime reads them as bytes to pack into the initramfs cpio.
 *
 * Falls back to the in-tree microvm/test-fixtures/ layout when the
 * native package can't be resolved OR its guest/ dir is empty —
 * workspace dev runs the latter shape (the native-* package is
 * symlinked but its vmm/guest/ is empty; build-base-assets.sh
 * populates microvm/test-fixtures/), so this fallback keeps
 * `pnpm test` / local boot() working unchanged.
 */
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
  // Workspace fallback: packages/runtime/src/ → packages/microvm/test-fixtures/.
  // Resolves via import.meta.url so it works under both ESM and the tsx-CJS loader.
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

/**
 * Default path to the compiled /exec-agent binary. Used by the
 * provision flow's cpio injection to override whatever stale
 * /exec-agent the user's base tarball may have captured from a
 * previous run.
 */
function defaultExecAgentPath(): string {
  return resolveGuestPaths().execAgentPath;
}

// --- CLI entrypoint -----------------------------------------------

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
    const parsed = parseWorkspaceCliFlag(args, i, { out, extraEx, maxMb });
    out = parsed.out;
    maxMb = parsed.maxMb;
    i = parsed.next;
  }
  return { out, extraEx, maxMb };
}

function parseWorkspaceCliFlag(
  args: string[],
  i: number,
  state: { out: string | undefined; extraEx: Set<string>; maxMb: number },
): { out: string | undefined; extraEx: Set<string>; maxMb: number; next: number } {
  const flag = args[i];
  if (flag === "--out") {
    return { ...state, out: args[i + 1], next: i + 2 };
  }
  if (flag === "--exclude") {
    state.extraEx.add(args[i + 1]!);
    return { ...state, next: i + 2 };
  }
  if (flag === "--max-mb") {
    return { ...state, maxMb: parseInt(args[i + 1]!, 10), next: i + 2 };
  }
  die(`unknown flag: ${flag}`);
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
  // Matches the Python default: write alongside the old script in test-fixtures/.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "microvm", "test-fixtures", "initramfs.cpio");
}

function die(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(2);
}
