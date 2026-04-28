// FUSE kernel ABI codecs for `--mount-live` (#78).
//
// Wire format: the guest agent opens /dev/fuse, mounts it at the
// requested path, and shovels raw FUSE kernel messages in both
// directions over vsock. The host — this file's consumers — speaks
// the FUSE protocol directly. That keeps the guest daemon to a few
// hundred lines of byte-pump, at the cost of putting the FUSE state
// machine on the host. Worth it: the host is TypeScript where we
// have easy testing, the guest is Zig where new code is more
// expensive.
//
// Framing is implicit: every FUSE request and response begins with a
// 4-byte little-endian length covering the whole message (including
// the header itself). That's how /dev/fuse returns requests, and
// it's what the kernel expects on writes, so we don't add a second
// layer of framing on the vsock wire.
//
// Protocol version target: 7.31. The Debian cloud-arm64 6.1 kernel
// we ship supports up to 7.37, but 7.31 (Linux 5.10-era) is the
// mature baseline every field layout below was written against. We
// down-negotiate in FUSE_INIT if the kernel advertises something
// older.
//
// All ints are little-endian. Linux kernel structs are little-endian
// on x86_64 and arm64 — we don't support other host archs.

/** FUSE protocol version we implement. */
export const FUSE_KERNEL_VERSION = 7;
export const FUSE_KERNEL_MINOR_VERSION = 31;

/**
 * FUSE opcodes. Numeric values from Linux v6.1 uapi/linux/fuse.h.
 * Only the subset we handle is enumerated; anything else gets
 * ENOSYS.
 */
export const FUSE_OP = {
  LOOKUP: 1,
  FORGET: 2,
  GETATTR: 3,
  SETATTR: 4,
  READLINK: 5,
  SYMLINK: 6,
  MKDIR: 9,
  UNLINK: 10,
  RMDIR: 11,
  RENAME: 12,
  LINK: 13,
  OPEN: 14,
  READ: 15,
  WRITE: 16,
  STATFS: 17,
  RELEASE: 18,
  FSYNC: 20,
  FLUSH: 25,
  INIT: 26,
  OPENDIR: 27,
  READDIR: 28,
  RELEASEDIR: 29,
  ACCESS: 34,
  CREATE: 35,
  INTERRUPT: 36,
  DESTROY: 38,
  BATCH_FORGET: 42,
  READDIRPLUS: 44,
} as const;

/**
 * `fuse_setattr_in.valid` flags (uapi/linux/fuse.h FATTR_*).
 * Tells the server which fields of the struct are meaningful.
 */
export const FATTR = {
  MODE: 1 << 0,
  UID: 1 << 1,
  GID: 1 << 2,
  SIZE: 1 << 3,
  ATIME: 1 << 4,
  MTIME: 1 << 5,
  FH: 1 << 6,
  ATIME_NOW: 1 << 7,
  MTIME_NOW: 1 << 8,
  LOCKOWNER: 1 << 9,
  CTIME: 1 << 10,
} as const;

export type FuseOp = (typeof FUSE_OP)[keyof typeof FUSE_OP];

/**
 * FUSE_INIT capability flags (fuse_init_in.flags / fuse_init_out.flags).
 * We only honor flags we actively support — everything else we mask
 * out in the INIT reply so the kernel doesn't expect behavior we
 * haven't implemented.
 */
export const FUSE_CAP = {
  ASYNC_READ: 1 << 0,
  POSIX_LOCKS: 1 << 1,
  EXPORT_SUPPORT: 1 << 4,
  BIG_WRITES: 1 << 5,
  DONT_MASK: 1 << 6,
  SPLICE_WRITE: 1 << 7,
  SPLICE_MOVE: 1 << 8,
  SPLICE_READ: 1 << 9,
  FLOCK_LOCKS: 1 << 10,
  HAS_IOCTL_DIR: 1 << 11,
  AUTO_INVAL_DATA: 1 << 12,
  DO_READDIRPLUS: 1 << 13,
  READDIRPLUS_AUTO: 1 << 14,
  ASYNC_DIO: 1 << 15,
  WRITEBACK_CACHE: 1 << 16,
  NO_OPEN_SUPPORT: 1 << 17,
  PARALLEL_DIROPS: 1 << 18,
  HANDLE_KILLPRIV: 1 << 19,
  POSIX_ACL: 1 << 20,
  ABORT_ERROR: 1 << 21,
  MAX_PAGES: 1 << 22,
  CACHE_SYMLINKS: 1 << 23,
  NO_OPENDIR_SUPPORT: 1 << 24,
} as const;

// --- header constants ----------------------------------------------------

export const FUSE_IN_HEADER_SIZE = 40;
export const FUSE_OUT_HEADER_SIZE = 16;

// --- header codecs -------------------------------------------------------

export interface FuseInHeader {
  len: number;
  opcode: number;
  unique: bigint;
  nodeid: bigint;
  uid: number;
  gid: number;
  pid: number;
}

export function readInHeader(buf: Uint8Array, offset = 0): FuseInHeader {
  const dv = viewOf(buf, offset, FUSE_IN_HEADER_SIZE);
  return {
    len: dv.getUint32(0, true),
    opcode: dv.getUint32(4, true),
    unique: dv.getBigUint64(8, true),
    nodeid: dv.getBigUint64(16, true),
    uid: dv.getUint32(24, true),
    gid: dv.getUint32(28, true),
    pid: dv.getUint32(32, true),
    // padding at offset 36
  };
}

export function writeOutHeader(
  buf: Uint8Array,
  offset: number,
  payloadLen: number,
  error: number,
  unique: bigint,
): void {
  const dv = viewOf(buf, offset, FUSE_OUT_HEADER_SIZE);
  dv.setUint32(0, FUSE_OUT_HEADER_SIZE + payloadLen, true);
  dv.setInt32(4, error, true);
  dv.setBigUint64(8, unique, true);
}

/** Build a FUSE error response. `error` is a negative errno. */
export function buildErrorResponse(unique: bigint, error: number): Uint8Array {
  const buf = new Uint8Array(FUSE_OUT_HEADER_SIZE);
  writeOutHeader(buf, 0, 0, error, unique);
  return buf;
}

/** Build a FUSE response with a payload. */
export function buildResponse(unique: bigint, payload: Uint8Array): Uint8Array {
  const buf = new Uint8Array(FUSE_OUT_HEADER_SIZE + payload.length);
  writeOutHeader(buf, 0, payload.length, 0, unique);
  buf.set(payload, FUSE_OUT_HEADER_SIZE);
  return buf;
}

// --- fuse_attr -----------------------------------------------------------

export const FUSE_ATTR_SIZE = 88;

export interface FuseAttr {
  ino: bigint;
  size: bigint;
  blocks: bigint;
  atime: bigint;
  mtime: bigint;
  ctime: bigint;
  atimensec: number;
  mtimensec: number;
  ctimensec: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  blksize: number;
  flags: number;
}

export function writeAttr(buf: Uint8Array, offset: number, a: FuseAttr): void {
  const dv = viewOf(buf, offset, FUSE_ATTR_SIZE);
  dv.setBigUint64(0, a.ino, true);
  dv.setBigUint64(8, a.size, true);
  dv.setBigUint64(16, a.blocks, true);
  dv.setBigUint64(24, a.atime, true);
  dv.setBigUint64(32, a.mtime, true);
  dv.setBigUint64(40, a.ctime, true);
  dv.setUint32(48, a.atimensec, true);
  dv.setUint32(52, a.mtimensec, true);
  dv.setUint32(56, a.ctimensec, true);
  dv.setUint32(60, a.mode, true);
  dv.setUint32(64, a.nlink, true);
  dv.setUint32(68, a.uid, true);
  dv.setUint32(72, a.gid, true);
  dv.setUint32(76, a.rdev, true);
  dv.setUint32(80, a.blksize, true);
  dv.setUint32(84, a.flags, true);
}

export function readAttr(buf: Uint8Array, offset = 0): FuseAttr {
  const dv = viewOf(buf, offset, FUSE_ATTR_SIZE);
  return {
    ino: dv.getBigUint64(0, true),
    size: dv.getBigUint64(8, true),
    blocks: dv.getBigUint64(16, true),
    atime: dv.getBigUint64(24, true),
    mtime: dv.getBigUint64(32, true),
    ctime: dv.getBigUint64(40, true),
    atimensec: dv.getUint32(48, true),
    mtimensec: dv.getUint32(52, true),
    ctimensec: dv.getUint32(56, true),
    mode: dv.getUint32(60, true),
    nlink: dv.getUint32(64, true),
    uid: dv.getUint32(68, true),
    gid: dv.getUint32(72, true),
    rdev: dv.getUint32(76, true),
    blksize: dv.getUint32(80, true),
    flags: dv.getUint32(84, true),
  };
}

// --- fuse_entry_out (LOOKUP reply) ---------------------------------------

export const FUSE_ENTRY_OUT_SIZE = 40 + FUSE_ATTR_SIZE; // 128

export interface FuseEntryOut {
  nodeid: bigint;
  generation: bigint;
  entry_valid: bigint;
  attr_valid: bigint;
  entry_valid_nsec: number;
  attr_valid_nsec: number;
  attr: FuseAttr;
}

export function buildEntryOut(e: FuseEntryOut): Uint8Array {
  const buf = new Uint8Array(FUSE_ENTRY_OUT_SIZE);
  const dv = viewOf(buf, 0, 40);
  dv.setBigUint64(0, e.nodeid, true);
  dv.setBigUint64(8, e.generation, true);
  dv.setBigUint64(16, e.entry_valid, true);
  dv.setBigUint64(24, e.attr_valid, true);
  dv.setUint32(32, e.entry_valid_nsec, true);
  dv.setUint32(36, e.attr_valid_nsec, true);
  writeAttr(buf, 40, e.attr);
  return buf;
}

// --- fuse_attr_out (GETATTR reply) ---------------------------------------

export const FUSE_ATTR_OUT_SIZE = 16 + FUSE_ATTR_SIZE; // 104

export interface FuseAttrOut {
  attr_valid: bigint;
  attr_valid_nsec: number;
  attr: FuseAttr;
}

export function buildAttrOut(a: FuseAttrOut): Uint8Array {
  const buf = new Uint8Array(FUSE_ATTR_OUT_SIZE);
  const dv = viewOf(buf, 0, 16);
  dv.setBigUint64(0, a.attr_valid, true);
  dv.setUint32(8, a.attr_valid_nsec, true);
  // dummy at offset 12
  writeAttr(buf, 16, a.attr);
  return buf;
}

// --- fuse_kstatfs (STATFS reply) -----------------------------------------

export const FUSE_KSTATFS_SIZE = 80;

export interface FuseKstatfs {
  blocks: bigint;
  bfree: bigint;
  bavail: bigint;
  files: bigint;
  ffree: bigint;
  bsize: number;
  namelen: number;
  frsize: number;
}

export function buildKstatfs(s: FuseKstatfs): Uint8Array {
  const buf = new Uint8Array(FUSE_KSTATFS_SIZE);
  const dv = viewOf(buf, 0, FUSE_KSTATFS_SIZE);
  dv.setBigUint64(0, s.blocks, true);
  dv.setBigUint64(8, s.bfree, true);
  dv.setBigUint64(16, s.bavail, true);
  dv.setBigUint64(24, s.files, true);
  dv.setBigUint64(32, s.ffree, true);
  dv.setUint32(40, s.bsize, true);
  dv.setUint32(44, s.namelen, true);
  dv.setUint32(48, s.frsize, true);
  // padding at 52, spare[6] zeroes at 56..79
  return buf;
}

// --- fuse_init_in / fuse_init_out ----------------------------------------

export const FUSE_INIT_IN_MIN_SIZE = 8; // pre-7.23 kernels send only major/minor
export const FUSE_INIT_OUT_SIZE = 64;

export interface FuseInitIn {
  major: number;
  minor: number;
  max_readahead: number;
  flags: number;
  flags2: number;
}

export function readInitIn(buf: Uint8Array, offset = 0): FuseInitIn {
  const dv = viewOf(buf, offset, Math.min(buf.length - offset, 24));
  const major = dv.getUint32(0, true);
  const minor = dv.getUint32(4, true);
  // Older kernels send a smaller struct. Guard the extended fields.
  const hasExtended = buf.length - offset >= 20;
  return {
    major,
    minor,
    max_readahead: hasExtended ? dv.getUint32(8, true) : 0,
    flags: hasExtended ? dv.getUint32(12, true) : 0,
    flags2: hasExtended && dv.byteLength >= 20 ? dv.getUint32(16, true) : 0,
  };
}

export interface FuseInitOut {
  major: number;
  minor: number;
  max_readahead: number;
  flags: number;
  max_background: number;
  congestion_threshold: number;
  max_write: number;
  time_gran: number;
  max_pages: number;
  map_alignment: number;
  flags2: number;
}

export function buildInitOut(o: FuseInitOut): Uint8Array {
  const buf = new Uint8Array(FUSE_INIT_OUT_SIZE);
  const dv = viewOf(buf, 0, FUSE_INIT_OUT_SIZE);
  dv.setUint32(0, o.major, true);
  dv.setUint32(4, o.minor, true);
  dv.setUint32(8, o.max_readahead, true);
  dv.setUint32(12, o.flags, true);
  dv.setUint16(16, o.max_background, true);
  dv.setUint16(18, o.congestion_threshold, true);
  dv.setUint32(20, o.max_write, true);
  dv.setUint32(24, o.time_gran, true);
  dv.setUint16(28, o.max_pages, true);
  dv.setUint16(30, o.map_alignment, true);
  dv.setUint32(32, o.flags2, true);
  // unused[7] already zero
  return buf;
}

// --- fuse_getattr_in -----------------------------------------------------

export interface FuseGetattrIn {
  getattr_flags: number;
  fh: bigint;
}

export function readGetattrIn(buf: Uint8Array, offset = 0): FuseGetattrIn {
  const dv = viewOf(buf, offset, 16);
  return {
    getattr_flags: dv.getUint32(0, true),
    // dummy at offset 4
    fh: dv.getBigUint64(8, true),
  };
}

// --- fuse_forget_in / fuse_batch_forget_in -------------------------------

export interface FuseForgetIn {
  nlookup: bigint;
}

export function readForgetIn(buf: Uint8Array, offset = 0): FuseForgetIn {
  const dv = viewOf(buf, offset, 8);
  return { nlookup: dv.getBigUint64(0, true) };
}

export interface FuseForgetOne {
  nodeid: bigint;
  nlookup: bigint;
}

export function readBatchForgetIn(
  buf: Uint8Array,
  offset = 0,
): { count: number; entries: FuseForgetOne[] } {
  const dv = viewOf(buf, offset, 8);
  const count = dv.getUint32(0, true);
  // dummy at offset 4
  const entries: FuseForgetOne[] = [];
  for (let i = 0; i < count; i++) {
    const entryOffset = offset + 8 + i * 16;
    const entryDv = viewOf(buf, entryOffset, 16);
    entries.push({
      nodeid: entryDv.getBigUint64(0, true),
      nlookup: entryDv.getBigUint64(8, true),
    });
  }
  return { count, entries };
}

// --- fuse_open_in / fuse_open_out ----------------------------------------

export interface FuseOpenIn {
  flags: number;
  open_flags: number;
}

export function readOpenIn(buf: Uint8Array, offset = 0): FuseOpenIn {
  const dv = viewOf(buf, offset, 8);
  return {
    flags: dv.getUint32(0, true),
    open_flags: dv.getUint32(4, true),
  };
}

export interface FuseOpenOut {
  fh: bigint;
  open_flags: number;
}

export function buildOpenOut(o: FuseOpenOut): Uint8Array {
  const buf = new Uint8Array(16);
  const dv = viewOf(buf, 0, 16);
  dv.setBigUint64(0, o.fh, true);
  dv.setUint32(8, o.open_flags, true);
  // padding at 12
  return buf;
}

// --- fuse_read_in --------------------------------------------------------

export interface FuseReadIn {
  fh: bigint;
  offset: bigint;
  size: number;
  read_flags: number;
  lock_owner: bigint;
  flags: number;
}

export function readReadIn(buf: Uint8Array, off = 0): FuseReadIn {
  const dv = viewOf(buf, off, 40);
  return {
    fh: dv.getBigUint64(0, true),
    offset: dv.getBigUint64(8, true),
    size: dv.getUint32(16, true),
    read_flags: dv.getUint32(20, true),
    lock_owner: dv.getBigUint64(24, true),
    flags: dv.getUint32(32, true),
    // padding at 36
  };
}

// --- fuse_release_in -----------------------------------------------------

export interface FuseReleaseIn {
  fh: bigint;
  flags: number;
  release_flags: number;
  lock_owner: bigint;
}

export function readReleaseIn(buf: Uint8Array, offset = 0): FuseReleaseIn {
  const dv = viewOf(buf, offset, 24);
  return {
    fh: dv.getBigUint64(0, true),
    flags: dv.getUint32(8, true),
    release_flags: dv.getUint32(12, true),
    lock_owner: dv.getBigUint64(16, true),
  };
}

// --- fuse_dirent ---------------------------------------------------------

/**
 * Pack a readdir entry. Layout is `fuse_dirent` (24 bytes) + name,
 * padded to an 8-byte boundary. Returns the full entry bytes.
 */
export function buildDirent(params: {
  ino: bigint;
  off: bigint;
  type: number;
  name: string;
}): Uint8Array {
  const nameBytes = new TextEncoder().encode(params.name);
  const paddedNameLen = (nameBytes.length + 7) & ~7;
  const buf = new Uint8Array(24 + paddedNameLen);
  const dv = viewOf(buf, 0, 24);
  dv.setBigUint64(0, params.ino, true);
  dv.setBigUint64(8, params.off, true);
  dv.setUint32(16, nameBytes.length, true);
  dv.setUint32(20, params.type, true);
  buf.set(nameBytes, 24);
  return buf;
}

/** DT_* constants for fuse_dirent.type (match POSIX dirent.h). */
export const DT = {
  UNKNOWN: 0,
  FIFO: 1,
  CHR: 2,
  DIR: 4,
  BLK: 6,
  REG: 8,
  LNK: 10,
  SOCK: 12,
} as const;

// --- fuse_write_in / fuse_write_out -------------------------------------

/**
 * fuse_write_in is 40 bytes on protocol >=7.9 (which we require for
 * INIT). Older kernels send a 24-byte prefix; we don't support those.
 */
export const FUSE_WRITE_IN_SIZE = 40;

export interface FuseWriteIn {
  fh: bigint;
  offset: bigint;
  size: number;
  write_flags: number;
  lock_owner: bigint;
  flags: number;
}

export function readWriteIn(buf: Uint8Array, off = 0): FuseWriteIn {
  const dv = viewOf(buf, off, FUSE_WRITE_IN_SIZE);
  return {
    fh: dv.getBigUint64(0, true),
    offset: dv.getBigUint64(8, true),
    size: dv.getUint32(16, true),
    write_flags: dv.getUint32(20, true),
    lock_owner: dv.getBigUint64(24, true),
    flags: dv.getUint32(32, true),
    // padding at 36
  };
}

export interface FuseWriteOut {
  size: number;
}

export function buildWriteOut(o: FuseWriteOut): Uint8Array {
  const buf = new Uint8Array(8);
  const dv = viewOf(buf, 0, 8);
  dv.setUint32(0, o.size, true);
  // padding at 4
  return buf;
}

// --- fuse_create_in (CREATE = open + create in one round-trip) ----------

/**
 * fuse_create_in is 16 bytes on protocol >=7.12 (mode + flags + umask
 * + open_flags). Followed by NUL-terminated name. We negotiate 7.31,
 * so the wider layout is always present.
 */
export const FUSE_CREATE_IN_SIZE = 16;

export interface FuseCreateIn {
  flags: number;
  mode: number;
  umask: number;
  open_flags: number;
}

export function readCreateIn(buf: Uint8Array, off = 0): FuseCreateIn {
  const dv = viewOf(buf, off, FUSE_CREATE_IN_SIZE);
  return {
    flags: dv.getUint32(0, true),
    mode: dv.getUint32(4, true),
    umask: dv.getUint32(8, true),
    open_flags: dv.getUint32(12, true),
  };
}

/**
 * CREATE response is fuse_entry_out (128) immediately followed by
 * fuse_open_out (16) — the kernel reads both back-to-back.
 */
export function buildCreateOut(entry: FuseEntryOut, open: FuseOpenOut): Uint8Array {
  const entryBuf = buildEntryOut(entry);
  const openBuf = buildOpenOut(open);
  const out = new Uint8Array(entryBuf.length + openBuf.length);
  out.set(entryBuf, 0);
  out.set(openBuf, entryBuf.length);
  return out;
}

// --- fuse_setattr_in -----------------------------------------------------

export const FUSE_SETATTR_IN_SIZE = 88;

export interface FuseSetattrIn {
  valid: number;
  fh: bigint;
  size: bigint;
  lock_owner: bigint;
  atime: bigint;
  mtime: bigint;
  ctime: bigint;
  atimensec: number;
  mtimensec: number;
  ctimensec: number;
  mode: number;
  uid: number;
  gid: number;
}

export function readSetattrIn(buf: Uint8Array, off = 0): FuseSetattrIn {
  const dv = viewOf(buf, off, FUSE_SETATTR_IN_SIZE);
  return {
    valid: dv.getUint32(0, true),
    // padding at 4
    fh: dv.getBigUint64(8, true),
    size: dv.getBigUint64(16, true),
    lock_owner: dv.getBigUint64(24, true),
    atime: dv.getBigUint64(32, true),
    mtime: dv.getBigUint64(40, true),
    ctime: dv.getBigUint64(48, true),
    atimensec: dv.getUint32(56, true),
    mtimensec: dv.getUint32(60, true),
    ctimensec: dv.getUint32(64, true),
    mode: dv.getUint32(68, true),
    // unused4 at 72
    uid: dv.getUint32(76, true),
    gid: dv.getUint32(80, true),
    // unused5 at 84
  };
}

// --- fuse_mkdir_in ------------------------------------------------------

export const FUSE_MKDIR_IN_SIZE = 8;

export interface FuseMkdirIn {
  mode: number;
  umask: number;
}

export function readMkdirIn(buf: Uint8Array, off = 0): FuseMkdirIn {
  const dv = viewOf(buf, off, FUSE_MKDIR_IN_SIZE);
  return {
    mode: dv.getUint32(0, true),
    umask: dv.getUint32(4, true),
  };
}

// --- fuse_link_in -------------------------------------------------------

/**
 * fuse_link_in: u64 oldnodeid. The new name follows as a NUL-
 * terminated string after the struct.
 */
export const FUSE_LINK_IN_SIZE = 8;

export interface FuseLinkIn {
  oldnodeid: bigint;
}

export function readLinkIn(buf: Uint8Array, off = 0): FuseLinkIn {
  const dv = viewOf(buf, off, FUSE_LINK_IN_SIZE);
  return {
    oldnodeid: dv.getBigUint64(0, true),
  };
}

// --- fuse_rename_in -----------------------------------------------------

export const FUSE_RENAME_IN_SIZE = 8;

export interface FuseRenameIn {
  newdir: bigint;
}

export function readRenameIn(buf: Uint8Array, off = 0): FuseRenameIn {
  const dv = viewOf(buf, off, FUSE_RENAME_IN_SIZE);
  return {
    newdir: dv.getBigUint64(0, true),
  };
}

// --- helpers -------------------------------------------------------------

/**
 * Build a DataView clamped to exactly `len` bytes of `buf` at
 * `offset`. Throws if the slice is out of range — catches short
 * reads / truncated messages early.
 */
function viewOf(buf: Uint8Array, offset: number, len: number): DataView {
  if (offset < 0 || len < 0 || offset + len > buf.length) {
    throw new Error(
      `FUSE buffer underflow: need ${len} bytes at offset ${offset}, have ${buf.length}`,
    );
  }
  return new DataView(buf.buffer, buf.byteOffset + offset, len);
}

/**
 * Pull the payload out of an incoming message. Callers pass the
 * full message (header + body) and the handler-specific body
 * size; this returns a view over just the body. Mostly a
 * correctness guard: if the framing length doesn't match what the
 * handler expects, we catch it before decoding a garbage struct.
 */
export function payloadOf(message: Uint8Array): Uint8Array {
  if (message.length < FUSE_IN_HEADER_SIZE) {
    throw new Error(`FUSE message too short: ${message.length} < header ${FUSE_IN_HEADER_SIZE}`);
  }
  return message.subarray(FUSE_IN_HEADER_SIZE);
}
