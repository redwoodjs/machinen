// Build an initramfs cpio archive for the microvm boot path.
//
// Newc cpio format, written byte-for-byte so we can include device
// nodes that macOS's native cpio tooling can't produce.
//
// Four modes exposed as functions:
//
//   packTinyBundle({ bundle, modulesTar, out, ... }) — pack a minimal
//     cpio for the rootDisk boot path (#119): /init + /modules/*.ko +
//     /machinen-config.json + /etc/machinen-boot-epoch + /dev/console.
//     ~1 MB. The on-disk rootfs is mounted from /dev/vda by /init
//     after finit_module loads the boot-path drivers.
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
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import debugLib from "debug";
import { MkinitramfsError } from "./errors.ts";

const debug = debugLib("machinen:mkinitramfs");

/**
 * Default excludes applied to --workspace packs. Skip the usual dev
 * droppings that nobody wants dragged into a tmpfs at boot.
 */
export const DEFAULT_WORKSPACE_EXCLUDES = new Set<string>([
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

/** Emit one newc cpio entry as a Buffer. */
function newc(
  name: string,
  mode: number,
  opts: {
    uid?: number;
    gid?: number;
    nlink?: number;
    mtime?: number;
    rmajor?: number;
    rminor?: number;
    data?: Buffer;
  } = {},
): Buffer {
  const uid = opts.uid ?? 0;
  const gid = opts.gid ?? 0;
  const nlink = opts.nlink ?? 1;
  const mtime = opts.mtime ?? 0;
  const rmajor = opts.rmajor ?? 0;
  const rminor = opts.rminor ?? 0;
  const data = opts.data ?? Buffer.alloc(0);

  const nameBytes = Buffer.concat([Buffer.from(name, "utf8"), Buffer.from([0])]);
  const fields = [
    0,
    mode,
    uid,
    gid,
    nlink,
    mtime,
    data.length,
    0, // devmajor
    0, // devminor
    rmajor,
    rminor,
    nameBytes.length,
    0, // check
  ];
  let hdr = "070701";
  for (const v of fields) {
    hdr += v.toString(16).padStart(8, "0");
  }

  let out = Buffer.concat([Buffer.from(hdr, "ascii"), nameBytes]);
  while (out.length % 4 !== 0) {
    out = Buffer.concat([out, Buffer.from([0])]);
  }
  out = Buffer.concat([out, data]);
  while (out.length % 4 !== 0) {
    out = Buffer.concat([out, Buffer.from([0])]);
  }
  return out;
}

// --- excludes ------------------------------------------------------

/** Parse an excludes file (one fnmatch-style pattern per line, `#` comments). */
export function loadExcludes(path: string): string[] {
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

function fnmatchRegex(pat: string): RegExp {
  let re = "^";
  let i = 0;
  while (i < pat.length) {
    const c = pat[i]!;
    if (c === "*") {
      re += ".*";
    } else if (c === "?") {
      re += ".";
    } else if (c === "[") {
      let j = i + 1;
      if (pat[j] === "!") {
        j++;
      }
      if (pat[j] === "]") {
        j++;
      }
      while (j < pat.length && pat[j] !== "]") {
        j++;
      }
      if (j >= pat.length) {
        re += "\\[";
      } else {
        let cls = pat.slice(i, j + 1);
        if (cls.startsWith("[!")) {
          cls = "[^" + cls.slice(2);
        }
        re += cls;
        i = j;
      }
    } else if (/[\\^$.+()|{}]/.test(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
    i++;
  }
  re += "$";
  return new RegExp(re);
}

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

function* walkRootfs(
  root: string,
  rel: string,
  excludes: string[],
  counts: WalkCounts,
): Generator<Buffer> {
  const full = rel ? join(root, rel) : root;
  let entries: string[];
  try {
    entries = readdirSync(full).sort();
  } catch {
    return;
  }

  for (const name of entries) {
    const childRel = rel ? join(rel, name) : name;
    const childFull = join(full, name);

    if (excludes.some((pat) => fnmatchCase(childRel, pat))) {
      try {
        const st = lstatSync(childFull);
        if (st.isFile()) {
          counts.files += 1;
          counts.bytes += st.size;
        }
      } catch {}
      continue;
    }

    let st;
    try {
      st = lstatSync(childFull);
    } catch {
      continue;
    }
    const m = st.mode;

    if (st.isSymbolicLink()) {
      const target = readlinkSync(childFull);
      yield newc(childRel, 0o120000 | (m & 0o7777), { data: Buffer.from(target, "utf8") });
    } else if (st.isDirectory()) {
      yield newc(childRel, 0o40000 | (m & 0o7777));
      yield* walkRootfs(root, childRel, excludes, counts);
    } else if (st.isFile()) {
      yield newc(childRel, 0o100000 | (m & 0o7777), { data: readFileSync(childFull) });
    }
    // Device/fifo/socket nodes are skipped — added by hand below.
  }
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
  let entries: string[];
  try {
    entries = readdirSync(full).sort();
  } catch {
    return;
  }

  for (const name of entries) {
    if (excludes.has(name)) {
      continue;
    }
    const childRel = rel ? join(rel, name) : name;
    const childFull = join(full, name);
    const arcName = `${mountpoint}/${childRel}`;

    let st;
    try {
      st = lstatSync(childFull);
    } catch {
      continue;
    }
    const m = st.mode;

    if (st.isSymbolicLink()) {
      const target = readlinkSync(childFull);
      yield newc(arcName, 0o120000 | (m & 0o7777), { data: Buffer.from(target, "utf8") });
    } else if (st.isDirectory()) {
      yield newc(arcName, 0o40000 | (m & 0o7777));
      yield* walkWorkspace(root, childRel, mountpoint, excludes, counts);
    } else if (st.isFile()) {
      const data = readFileSync(childFull);
      counts.bytes += data.length;
      yield newc(arcName, 0o100000 | (m & 0o7777), { data });
    }
  }
}

// --- public API ----------------------------------------------------

export interface PackBundleOptions {
  /** Bundle directory with rootfs/ + machinen-config.json. */
  bundle: string;
  /** Path to the initramfs cpio to write. */
  out: string;
  /** Optional base rootfs tarball (rootfs-debian-arm64.tar.gz). */
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
   * Optional host path to the compiled fuse-agent binary. When set,
   * the binary is injected at `/fuse-agent` (mode 0755) inside the
   * initramfs so /init can fork it per live-share mount. See #78.
   */
  fuseAgentPath?: string;
}

export function packBundle(opts: PackBundleOptions): void {
  const t0 = Date.now();
  const rootfsDir = join(opts.bundle, "rootfs");
  const cfgPath = join(opts.bundle, "machinen-config.json");
  if (!statSync(rootfsDir).isDirectory()) {
    throw new MkinitramfsError("MKINITRAMFS_BUNDLE_INVALID", `--bundle: missing ${rootfsDir}`);
  }
  if (!statSync(cfgPath).isFile()) {
    throw new MkinitramfsError("MKINITRAMFS_BUNDLE_INVALID", `--bundle: missing ${cfgPath}`);
  }

  const needsMerge = Boolean(opts.base) || Boolean(opts.mount);
  debug(
    "packBundle bundle=%s out=%s base=%s mount=%s needsMerge=%s",
    opts.bundle,
    opts.out,
    opts.base ?? "<none>",
    opts.mount ? `${opts.mount.host}->${opts.mount.guest}` : "<none>",
    needsMerge,
  );

  let packSrc = rootfsDir;
  let mergeTmp: string | undefined;
  if (needsMerge) {
    mergeTmp = mkdtempSync(join(tmpdir(), "machinen-mkinitramfs-"));
    if (opts.base) {
      const extractT0 = Date.now();
      const res = spawnSync("tar", ["-xzf", opts.base, "-C", mergeTmp]);
      if (res.status !== 0) {
        rmSync(mergeTmp, { recursive: true, force: true });
        throw new MkinitramfsError(
          "MKINITRAMFS_BASE_EXTRACT_FAILED",
          `tar -xzf ${opts.base} failed: ${res.stderr?.toString() ?? ""}`,
        );
      }
      debug("base extracted elapsed=%dms", Date.now() - extractT0);
    }
    if (opts.mount) {
      overlayMount(mergeTmp, opts.mount.host, opts.mount.guest);
    }
    // Overlay the bundle's rootfs/ on top. Node's cp with recursive
    // preserves symlinks via `verbatimSymlinks`; `force: true` mirrors
    // shutil.copytree's dirs_exist_ok + overwrite semantics.
    cpSync(rootfsDir, mergeTmp, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
    packSrc = mergeTmp;
  }

  try {
    const counts: WalkCounts = { files: 0, bytes: 0 };
    const parts: Buffer[] = [];
    for (const e of entriesFromRootfs(packSrc, opts.excludes ?? [], counts)) {
      parts.push(e);
    }
    appendFinalEntries(parts, {
      initPath: opts.initPath ?? defaultInitPath(),
      config: patchConfigEnv(readFileSync(cfgPath), opts.env),
      fuseAgentPath: opts.fuseAgentPath,
      injectInit: false,
    });
    writeFileSync(opts.out, Buffer.concat(parts));
    debug(
      "packBundle done files=%d bytes=%d elapsed=%dms",
      counts.files,
      counts.bytes,
      Date.now() - t0,
    );
  } finally {
    if (mergeTmp) {
      rmSync(mergeTmp, { recursive: true, force: true });
    }
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
  /**
   * Path to modules-arm64.tar.gz (the flat /modules/*.ko archive
   * built by scripts/build-base-assets.sh). Extracted at pack time
   * and emitted as /modules/*.ko entries inside the cpio so /init
   * can finit_module(2) them directly without a kmod / modprobe path.
   */
  modulesTar: string;
  /** Extra env merged into the bundle's machinen-config.json. Bundle keys win on collision. */
  env?: Record<string, string>;
  /**
   * Optional host directory copied into the cpio at `/<guest>/`. Same
   * semantics as packBundle.mount — guest must live under /mnt/.
   * /init carries it across the rootdisk pivot.
   */
  mount?: { host: string; guest: string };
  /** Optional override for the compiled /init. Default: ../microvm/test-fixtures/init relative to this file. */
  initPath?: string;
  /** Optional path to the compiled fuse-agent; staged at /fuse-agent when set. */
  fuseAgentPath?: string;
}

/**
 * Build the tiny initramfs used by every user-facing boot() (#119).
 *
 * Layout:
 *   /init                        compiled Zig init
 *   /modules/<name>.ko           boot-path drivers /init finit_module(2)s
 *   /machinen-config.json        cmd/env/cwd/liveMounts for /init
 *   /etc/machinen-boot-epoch     wall clock seed for the guest
 *   /dev/console                 char node 5,1 — kernel needs it before
 *                                /init re-opens the console
 *   /fuse-agent                  optional, only when liveMounts
 *   /mnt/<guest>/                optional, when caller passed `mount`
 *   /tmp                         sticky 1777
 *
 * No /lib/modules tree, no kmod, no Debian userland. /init pivots into
 * /dev/vda (a virtio-blk-attached ext4 image) for the actual rootfs.
 */
export function packTinyBundle(opts: PackTinyBundleOptions): void {
  const t0 = Date.now();
  const cfgPath = join(opts.bundle, "machinen-config.json");
  if (!statSync(cfgPath).isFile()) {
    throw new MkinitramfsError("MKINITRAMFS_BUNDLE_INVALID", `--bundle: missing ${cfgPath}`);
  }
  if (!statSync(opts.modulesTar).isFile()) {
    throw new MkinitramfsError(
      "MKINITRAMFS_MODULES_NOT_FOUND",
      `tiny bundle: modules tarball not found: ${opts.modulesTar}`,
    );
  }

  const modulesTmp = mkdtempSync(join(tmpdir(), "machinen-mkinitramfs-mods-"));
  try {
    const res = spawnSync("tar", ["-xzf", opts.modulesTar, "-C", modulesTmp]);
    if (res.status !== 0) {
      throw new MkinitramfsError(
        "MKINITRAMFS_MODULES_EXTRACT_FAILED",
        `tar -xzf ${opts.modulesTar} failed: ${res.stderr?.toString() ?? ""}`,
      );
    }

    const parts: Buffer[] = [];
    parts.push(newc(".", 0o40755));
    // /init is optional at pack time — matches packBundle's posture so
    // tests that exercise env passthrough without a built /init keep
    // working. A real boot without /init won't get past the kernel,
    // but that failure surfaces clearly at the VMM layer.
    try {
      const initBytes = readFileSync(opts.initPath ?? defaultInitPath());
      parts.push(newc("init", 0o100755, { data: initBytes }));
    } catch {}

    parts.push(newc("modules", 0o40755));
    const modEntries = readdirSync(modulesTmp).sort();
    let modCount = 0;
    let modBytes = 0;
    for (const name of modEntries) {
      if (!name.endsWith(".ko")) {
        continue;
      }
      const data = readFileSync(join(modulesTmp, name));
      parts.push(newc(`modules/${name}`, 0o100644, { data }));
      modCount += 1;
      modBytes += data.length;
    }

    if (opts.mount) {
      const rel = opts.mount.guest.replace(/^\/+/, "");
      // Emit each path component as a directory entry, then walk the
      // host tree under it. Same semantics as packBundle's
      // overlayMount + walk, just without the merge-onto-base step.
      const segments = rel.split("/").filter(Boolean);
      let acc = "";
      for (const seg of segments) {
        acc = acc ? `${acc}/${seg}` : seg;
        parts.push(newc(acc, 0o40755));
      }
      const counts: WalkCounts = { files: 0, bytes: 0 };
      for (const e of mountOverlayEntries(opts.mount.host, rel, counts)) {
        parts.push(e);
      }
    }

    appendFinalEntries(parts, {
      initPath: opts.initPath ?? defaultInitPath(),
      config: patchConfigEnv(readFileSync(cfgPath), opts.env),
      fuseAgentPath: opts.fuseAgentPath,
      // We already emitted /init above, before the .ko files, so the
      // final entries pass should not duplicate it.
      injectInit: false,
    });
    writeFileSync(opts.out, Buffer.concat(parts));
    debug(
      "packTinyBundle done modules=%d module_bytes=%d elapsed=%dms",
      modCount,
      modBytes,
      Date.now() - t0,
    );
  } finally {
    rmSync(modulesTmp, { recursive: true, force: true });
  }
}

function* mountOverlayEntries(
  hostAbs: string,
  guestRel: string,
  counts: WalkCounts,
): Generator<Buffer> {
  yield* walkMount(hostAbs, "", guestRel, counts);
}

function* walkMount(
  root: string,
  rel: string,
  mountpoint: string,
  counts: WalkCounts,
): Generator<Buffer> {
  const full = rel ? join(root, rel) : root;
  let entries: string[];
  try {
    entries = readdirSync(full).sort();
  } catch {
    return;
  }
  for (const name of entries) {
    const childRel = rel ? join(rel, name) : name;
    const childFull = join(full, name);
    const arcName = `${mountpoint}/${childRel}`;
    let st;
    try {
      st = lstatSync(childFull);
    } catch {
      continue;
    }
    const m = st.mode;
    if (st.isSymbolicLink()) {
      const target = readlinkSync(childFull);
      yield newc(arcName, 0o120000 | (m & 0o7777), { data: Buffer.from(target, "utf8") });
    } else if (st.isDirectory()) {
      yield newc(arcName, 0o40000 | (m & 0o7777));
      yield* walkMount(root, childRel, mountpoint, counts);
    } else if (st.isFile()) {
      const data = readFileSync(childFull);
      counts.files += 1;
      counts.bytes += data.length;
      yield newc(arcName, 0o100000 | (m & 0o7777), { data });
    }
  }
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
  /** Optional path to fuse-agent; staged at /fuse-agent when provided. */
  fuseAgentPath?: string;
}

function appendFinalEntries(parts: Buffer[], opts: FinalOptions): void {
  if (opts.injectInit) {
    try {
      const initBytes = readFileSync(opts.initPath);
      parts.push(newc("init", 0o100755, { data: initBytes }));
    } catch {
      // init is optional — matches the Python code's `if INIT.exists():` guard.
    }
  }
  if (opts.fuseAgentPath) {
    // Bake the agent at /fuse-agent so /init can fork it per
    // liveMount entry. We don't gate on liveMounts being set — paying
    // ~200KB when unused is cheaper than threading the option all the
    // way through; the init only spawns it when configured.
    try {
      const bytes = readFileSync(opts.fuseAgentPath);
      parts.push(newc("fuse-agent", 0o100755, { data: bytes }));
    } catch {
      // Optional — if missing, liveMount boot will fail later with a
      // clear error, but non-liveMount paths keep working.
    }
  }
  if (opts.config) {
    parts.push(newc("machinen-config.json", 0o100644, { data: opts.config }));
  }
  // Bake the host's current epoch so /init can set the guest clock.
  // Without this the guest boots at 1970-01-01 and TLS + apt Release
  // date validation break.
  parts.push(newc("etc", 0o40755));
  parts.push(
    newc("etc/machinen-boot-epoch", 0o100644, {
      data: Buffer.from(String(Math.floor(Date.now() / 1000)), "ascii"),
    }),
  );
  parts.push(newc("dev", 0o40755));
  parts.push(newc("dev/console", 0o20600, { rmajor: 5, rminor: 1 }));
  // Force /tmp to the canonical sticky-world-writable (1777). The base
  // tarball ships /tmp that way but darwin tar strips the sticky bit
  // when extracting as non-root, so apt (which drops privs to _apt for
  // downloads) fails with "Couldn't create temporary file".
  parts.push(newc("tmp", 0o41777));
  parts.push(newc("TRAILER!!!", 0));
}

function defaultInitPath(): string {
  // From packages/runtime/src/ → packages/microvm/test-fixtures/init.
  // Resolve via import.meta.url so it works under both ESM and tsx-CJS loaders.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "microvm", "test-fixtures", "init");
}

/**
 * Default path to the compiled fuse-agent binary. Sibling of the
 * default /init under packages/microvm/test-fixtures/. Callers can
 * override via `PackBundleOptions.fuseAgentPath`.
 */
export function defaultFuseAgentPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "microvm", "test-fixtures", "fuse-agent");
}

// --- CLI entrypoint -----------------------------------------------

/**
 * Invoked by the CLI shim at packages/microvm/test-fixtures/assets/mkinitramfs.ts.
 * Kept argv-compatible with the old Python script so shell fixtures
 * (smoke.sh, try.sh, handoff.sh) don't need deeper changes.
 */
export function cli(argv: string[]): void {
  if (argv[0] === "--workspace") {
    const src = argv[1];
    if (!src) {
      die("--workspace requires <dir>");
    }
    let out: string | undefined;
    const extraEx = new Set<string>();
    let maxMb = 500;
    let i = 2;
    while (i < argv.length) {
      const flag = argv[i];
      if (flag === "--out") {
        out = argv[i + 1];
        i += 2;
      } else if (flag === "--exclude") {
        extraEx.add(argv[i + 1]!);
        i += 2;
      } else if (flag === "--max-mb") {
        maxMb = parseInt(argv[i + 1]!, 10);
        i += 2;
      } else {
        die(`unknown flag: ${flag}`);
      }
    }
    if (!out) {
      die("--workspace requires --out <path>");
    }
    process.stderr.write(`packing workspace: ${src} -> ${out}\n`);
    const excludes = new Set<string>([...DEFAULT_WORKSPACE_EXCLUDES, ...extraEx]);
    packWorkspace({ workspace: src!, out: out!, excludes, maxMb });
    const st = statSync(out!);
    process.stderr.write(`wrote ${out} (${st.size} bytes)\n`);
    return;
  }

  // Parse shared flags.
  const args = [...argv];
  const outOverride = takeFlag(args, "--out");
  const configFlag = takeFlag(args, "--config");
  const excludeFromFlag = takeFlag(args, "--exclude-from");
  const baseFlag = takeFlag(args, "--base");

  const excludes = excludeFromFlag ? loadExcludes(excludeFromFlag) : [];

  if (args[0] === "--bundle") {
    const bundle = args[1];
    if (!bundle) {
      die("--bundle requires <dir>");
    }
    const out = outOverride ?? defaultOut();
    process.stdout.write(`packing bundle: ${bundle}\n`);
    packBundle({ bundle: bundle!, out, base: baseFlag, excludes });
    const st = statSync(out);
    process.stdout.write(`wrote ${out} (${st.size} bytes)\n`);
    return;
  }

  if (args[0] === "--rootfs") {
    const rootfs = args[1];
    if (!rootfs) {
      die("--rootfs requires <dir>");
    }
    const out = outOverride ?? defaultOut();
    process.stdout.write(`packing rootfs: ${rootfs}\n`);
    packRootfs({
      rootfs: rootfs!,
      out,
      config: configFlag,
      excludes,
    });
    const st = statSync(out);
    process.stdout.write(`wrote ${out} (${st.size} bytes)\n`);
    return;
  }

  // Minimal mode.
  const out = outOverride ?? defaultOut();
  packMinimal({ out, config: configFlag });
  const st = statSync(out);
  process.stdout.write(`wrote ${out} (${st.size} bytes)\n`);
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

// Re-exported for tests + callers that don't want to go through the CLI.
export { newc, entriesFromRootfs };
