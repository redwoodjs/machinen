// Live-share mount server for `--mount-live` (#78, #151).
//
// One instance per mount. Binds a Unix socket that the VMM's vsock
// bridge muxes to a fixed guest port (see MACHINEN_VSOCK spec). The
// guest's FUSE byte-pump daemon dials the port, mounts /dev/fuse, and
// shovels FUSE-framed bytes to and from the socket. This server is
// the other end of that pipe: it parses each FUSE kernel message,
// dispatches to a handler, and writes the FUSE response back.
//
// Mode is per-mount: `ro` (default) accepts only read-side ops and
// rejects mutations with EROFS; `rw` enables write-through so guest
// writes land on the host directory.
//
// Path containment routes through `resolveUnderRoot` — the load-
// bearing piece that keeps a crafted guest path from escaping the
// mount root. See mount-resolver.ts.

import { createServer, type Server, type Socket } from "node:net";
import {
  chmod,
  lchmod,
  lchown,
  link,
  lutimes,
  mkdir,
  open as fsOpen,
  lstat,
  readdir,
  readlink,
  realpath,
  rename,
  rmdir,
  statfs,
  symlink,
  truncate,
  unlink,
  utimes,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import type { Stats } from "node:fs";
import { join } from "node:path";
import debug from "debug";
import { MountError, isMachinenError } from "./errors.ts";
import { resolveUnderRoot } from "./mount-resolver.ts";
import {
  DT,
  FALLOC_FL,
  FATTR,
  FUSE_CAP,
  FUSE_IN_HEADER_SIZE,
  FUSE_KERNEL_MINOR_VERSION,
  FUSE_KERNEL_VERSION,
  FUSE_OP,
  FUSE_WRITE_IN_SIZE,
  SEEK,
  type FuseInHeader,
  buildAttrOut,
  buildCreateOut,
  buildDirent,
  buildEntryOut,
  buildErrorResponse,
  buildInitOut,
  buildKstatfs,
  buildLseekOut,
  buildOpenOut,
  buildResponse,
  buildWriteOut,
  payloadOf,
  readBatchForgetIn,
  readCopyFileRangeIn,
  readCreateIn,
  readFallocateIn,
  readForgetIn,
  readInHeader,
  readInitIn,
  readLinkIn,
  readLseekIn,
  readMkdirIn,
  readOpenIn,
  readReadIn,
  readReleaseIn,
  readRenameIn,
  readSetattrIn,
  readWriteIn,
} from "./mount-fuse-protocol.ts";

const log = debug("machinen:mount-server");

/** Linux errno values the kernel expects in FUSE error replies. */
const ERRNO = {
  EPERM: 1,
  ENOENT: 2,
  EIO: 5,
  ENXIO: 6,
  EBADF: 9,
  EACCES: 13,
  EBUSY: 16,
  EEXIST: 17,
  ENOTDIR: 20,
  EISDIR: 21,
  EINVAL: 22,
  EROFS: 30,
  ENOSYS: 38,
  ENOTEMPTY: 39,
  // ENOTSUP / EOPNOTSUPP share value 95 on Linux. Some macOS-host
  // ops (lchmod on filesystems without symlink-mode support, lutimes
  // on older APFS) throw ENOTSUP; pass it through verbatim so tar
  // and friends see a soft failure rather than the EIO catch-all.
  ENOTSUP: 95,
  ESTALE: 116,
} as const;

/**
 * One inode = one path relative to the mount root. Root is always
 * inode 1 with an empty relative path. Kernel-held references are
 * counted via `nlookup`; a FORGET decrements and we drop the entry
 * when it hits zero. The root is pinned (nlookup stays at Infinity).
 */
interface InodeEntry {
  relPath: string;
  nlookup: number;
}

/** Per-connection file-handle table. One entry per OPEN/OPENDIR. */
type OpenEntry =
  | { kind: "file"; fh: FileHandle; lazyPagesContrib: boolean }
  | { kind: "dir"; entries: Uint8Array[] };

interface LiveMountServerOptions {
  /** Absolute host path that bounds every op. */
  rootAbs: string;
  /**
   * `"rw"` (default) enables write-through: WRITE/CREATE/MKDIR/RMDIR/
   * UNLINK/RENAME/SETATTR/FSYNC land on the host filesystem, all gated
   * through `resolveUnderRoot`. `"ro"` rejects mutating ops with EROFS.
   */
  mode?: "ro" | "rw";
}

export interface LiveMountServerHandle {
  /** Close the socket, evict handles. Idempotent. */
  stop(): Promise<void>;
  /**
   * Bytes served from any `pages-*.img` file under this mount since
   * startup (#274). Used by `vm.memoryStats()` to approximate the
   * lazy-restore page-fault progress: each FUSE READ on `pages-*.img`
   * corresponds to (roughly) one CRIU UFFD fault being satisfied,
   * since the guest CRIU's lazy-pages daemon preads exactly the
   * faulted page into the registered VMA.
   *
   * Restricted to `pages-*.img` to avoid counting traffic from
   * unrelated live mounts the user happens to have configured —
   * that filename is uniquely owned by CRIU bundles. Returns 0 on
   * mounts that never see lazy-restore traffic.
   */
  bytesServedOnPagesImg(): number;
}

/**
 * Start a live-share mount server listening on `udsPath`. The VMM
 * should be configured (via MACHINEN_VSOCK) to route the guest's
 * FUSE vsock port to this UDS. Returns a handle whose `stop()`
 * tears down the server.
 */
export async function serveLiveMount(
  udsPath: string,
  opts: LiveMountServerOptions,
): Promise<LiveMountServerHandle> {
  const state = createState(opts.rootAbs, opts.mode ?? "rw");
  const server = createServer((sock) => void handleConnection(sock, state));
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(udsPath, () => {
      server.off("error", fail);
      done();
    });
  });
  log("listening udsPath=%s rootAbs=%s mode=%s", udsPath, opts.rootAbs, state.mode);
  return {
    stop: () => shutdown(server, state),
    bytesServedOnPagesImg: () => state.bytesServedOnPagesImg,
  };
}

interface ServerState {
  rootAbs: string;
  mode: "ro" | "rw";
  inodes: Map<bigint, InodeEntry>;
  nextInode: bigint;
  handles: Map<bigint, OpenEntry>;
  nextHandle: bigint;
  socket: Socket | null;
  /**
   * Running total of bytes served from `pages-*.img` files (#274). Set
   * on every successful FUSE READ whose open handle was flagged at
   * OPEN time as a lazy-pages contribution. Read by
   * `LiveMountServerHandle.bytesServedOnPagesImg()`; never decremented.
   */
  bytesServedOnPagesImg: number;
}

function createState(rootAbs: string, mode: "ro" | "rw"): ServerState {
  const inodes = new Map<bigint, InodeEntry>();
  // Root is pinned. nlookup=Infinity sentinel means "never evict".
  inodes.set(1n, { relPath: "", nlookup: Number.POSITIVE_INFINITY });
  return {
    rootAbs,
    mode,
    inodes,
    nextInode: 2n,
    handles: new Map(),
    nextHandle: 1n,
    socket: null,
    bytesServedOnPagesImg: 0,
  };
}

const PAGES_IMG_RE = /(?:^|\/)pages-\d+\.img$/;

function isPagesImgPath(relPath: string): boolean {
  return PAGES_IMG_RE.test(relPath);
}

async function shutdown(server: Server, state: ServerState): Promise<void> {
  state.socket?.destroy();
  state.socket = null;
  for (const [, entry] of state.handles) {
    if (entry.kind === "file") {
      await entry.fh.close().catch(() => {});
    }
  }
  state.handles.clear();
  await new Promise<void>((done) => server.close(() => done()));
}

async function handleConnection(sock: Socket, state: ServerState): Promise<void> {
  if (state.socket) {
    // Only one connection per mount — close the duplicate.
    sock.destroy();
    return;
  }
  state.socket = sock;
  sock.on("close", () => {
    state.socket = null;
  });
  sock.on("error", (err) => log("socket error: %s", err.message));
  try {
    for await (const msg of readFrames(sock)) {
      // Dispatch concurrently — the kernel multiplexes responses by
      // the `unique` field, so out-of-order writes are fine provided
      // each response is a single atomic socket write.
      void dispatch(msg, state, sock);
    }
  } catch (err) {
    log("frame read error: %s", (err as Error).message);
    sock.destroy();
  }
}

/**
 * Yield complete FUSE kernel messages from a socket. Framing is the
 * 4-byte little-endian length prefix every FUSE request carries; we
 * don't add a second framing layer.
 */
async function* readFrames(sock: AsyncIterable<Buffer>): AsyncGenerator<Uint8Array> {
  let pending: Buffer = Buffer.alloc(0);
  for await (const chunk of sock) {
    pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const len = pending.readUInt32LE(0);
      if (len < FUSE_IN_HEADER_SIZE) {
        throw new Error(`FUSE framing: len ${len} below header size ${FUSE_IN_HEADER_SIZE}`);
      }
      if (pending.length < len) {
        break;
      }
      yield new Uint8Array(pending.buffer, pending.byteOffset, len).slice();
      pending = pending.subarray(len);
    }
  }
  if (pending.length > 0) {
    throw new Error(`FUSE framing: ${pending.length} trailing bytes after EOF`);
  }
}

async function dispatch(msg: Uint8Array, state: ServerState, sock: Socket): Promise<void> {
  const hdr = readInHeader(msg);
  log("op=%d nodeid=%s unique=%s len=%d", hdr.opcode, hdr.nodeid, hdr.unique, hdr.len);
  let reply: Uint8Array | null;
  try {
    reply = await handle(hdr, msg, state);
  } catch (err) {
    const errno = mapErrorToErrno(err);
    log("op=%d → errno %d (%s)", hdr.opcode, errno, (err as Error).message);
    reply = buildErrorResponse(hdr.unique, errno);
  }
  if (reply && !sock.destroyed) {
    sock.write(reply);
  }
}

async function handle(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array | null> {
  switch (hdr.opcode) {
    case FUSE_OP.INIT:
      return onInit(hdr, msg);
    case FUSE_OP.DESTROY:
      return buildErrorResponse(hdr.unique, 0);
    case FUSE_OP.INTERRUPT:
      return null; // no reply ever
    case FUSE_OP.FORGET:
      onForget(hdr, msg, state);
      return null;
    case FUSE_OP.BATCH_FORGET:
      onBatchForget(msg, state);
      return null;
    case FUSE_OP.LOOKUP:
      return await onLookup(hdr, msg, state);
    case FUSE_OP.GETATTR:
      return await onGetattr(hdr, state);
    case FUSE_OP.READLINK:
      return await onReadlink(hdr, state);
    case FUSE_OP.SYMLINK:
      return await onSymlink(hdr, msg, state);
    case FUSE_OP.LINK:
      return await onLink(hdr, msg, state);
    case FUSE_OP.SETATTR:
      return await onSetattr(hdr, msg, state);
    case FUSE_OP.STATFS:
      return await onStatfs(hdr, state);
    case FUSE_OP.OPEN:
      return await onOpen(hdr, msg, state);
    case FUSE_OP.READ:
      return await onRead(hdr, msg, state);
    case FUSE_OP.WRITE:
      return await onWrite(hdr, msg, state);
    case FUSE_OP.CREATE:
      return await onCreate(hdr, msg, state);
    case FUSE_OP.MKDIR:
      return await onMkdir(hdr, msg, state);
    case FUSE_OP.RMDIR:
      return await onRmdir(hdr, msg, state);
    case FUSE_OP.UNLINK:
      return await onUnlink(hdr, msg, state);
    case FUSE_OP.RENAME:
      return await onRename(hdr, msg, state);
    case FUSE_OP.RELEASE:
      return await onRelease(hdr, msg, state);
    case FUSE_OP.OPENDIR:
      return await onOpendir(hdr, state);
    case FUSE_OP.READDIR:
      return await onReaddir(hdr, msg, state);
    case FUSE_OP.RELEASEDIR:
      return onReleasedir(hdr, msg, state);
    case FUSE_OP.FSYNC:
      return await onFsync(hdr, msg, state);
    case FUSE_OP.FSYNCDIR:
      return await onFsyncdir(hdr, msg, state);
    case FUSE_OP.FALLOCATE:
      return await onFallocate(hdr, msg, state);
    case FUSE_OP.LSEEK:
      return await onLseek(hdr, msg, state);
    case FUSE_OP.COPY_FILE_RANGE:
      return await onCopyFileRange(hdr, msg, state);
    case FUSE_OP.FLUSH:
    case FUSE_OP.ACCESS:
      // Userspace ok-to-ignore ops: reply success with no payload.
      return buildErrorResponse(hdr.unique, 0);
    default:
      return buildErrorResponse(hdr.unique, -ERRNO.ENOSYS);
  }
}

// --- handlers ------------------------------------------------------------

function onInit(hdr: FuseInHeader, msg: Uint8Array): Uint8Array {
  const init = readInitIn(payloadOf(msg));
  // Minor version: advertise min(kernel, us). Major must match exactly
  // or the kernel re-INITs with its own major.
  const minor = Math.min(init.minor, FUSE_KERNEL_MINOR_VERSION);
  // Only propagate flags we actively support back to the kernel.
  const supported =
    FUSE_CAP.ASYNC_READ |
    FUSE_CAP.BIG_WRITES |
    FUSE_CAP.EXPORT_SUPPORT |
    FUSE_CAP.MAX_PAGES |
    FUSE_CAP.PARALLEL_DIROPS;
  const flags = init.flags & supported;
  const out = buildInitOut({
    major: FUSE_KERNEL_VERSION,
    minor,
    max_readahead: init.max_readahead,
    flags,
    max_background: 16,
    congestion_threshold: 12,
    max_write: 131072,
    time_gran: 1,
    max_pages: 32, // 128 KiB / 4 KiB page
    map_alignment: 0,
    flags2: 0,
  });
  return buildResponse(hdr.unique, out);
}

function onForget(hdr: FuseInHeader, msg: Uint8Array, state: ServerState): void {
  const { nlookup } = readForgetIn(payloadOf(msg));
  decrefInode(state, hdr.nodeid, Number(nlookup));
}

function onBatchForget(msg: Uint8Array, state: ServerState): void {
  const { entries } = readBatchForgetIn(payloadOf(msg));
  for (const e of entries) {
    decrefInode(state, e.nodeid, Number(e.nlookup));
  }
}

async function onLookup(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  const body = payloadOf(msg);
  const name = decodeName(body);
  validateName(name);
  const parent = requireInode(state, hdr.nodeid);
  // Resolve the parent (follows any intermediate symlinks; the resolver
  // rejects any that escape), then attach the basename without following
  // its final component. A symlink basename pointing outside root is
  // visible as a link but un-traversable — the kernel will READLINK and
  // re-LOOKUP each target component, which the resolver catches.
  const parentAbs = await absPathForTraversal(state, parent);
  const childAbs = join(parentAbs, name);
  const childRel = joinRel(parent.relPath, name);
  const st = await lstat(childAbs);
  const ino = bindInode(state, childRel);
  return buildResponse(
    hdr.unique,
    buildEntryOut({
      nodeid: ino,
      generation: 0n,
      entry_valid: 1n,
      attr_valid: 1n,
      entry_valid_nsec: 0,
      attr_valid_nsec: 0,
      attr: statToAttr(st, ino),
    }),
  );
}

async function onGetattr(hdr: FuseInHeader, state: ServerState): Promise<Uint8Array> {
  const entry = requireInode(state, hdr.nodeid);
  // lstat, not stat — a symlink inode should report S_IFLNK, not the
  // target's type.
  const abs = await absPathForLstat(state, entry);
  const st = await lstat(abs);
  return buildResponse(
    hdr.unique,
    buildAttrOut({
      attr_valid: 1n,
      attr_valid_nsec: 0,
      attr: statToAttr(st, hdr.nodeid),
    }),
  );
}

async function onReadlink(hdr: FuseInHeader, state: ServerState): Promise<Uint8Array> {
  const entry = requireInode(state, hdr.nodeid);
  // Don't follow the final component — the inode IS the symlink. We
  // still gate the parent through the resolver so a symlink basename
  // pointing outside root is opaque to the guest (the kernel will
  // re-LOOKUP each component of the target through us, and the
  // resolver catches escapes there).
  const abs = await absPathForLstat(state, entry);
  const target = await readlink(abs);
  // FUSE READLINK reply is the raw target bytes — no NUL terminator.
  return buildResponse(hdr.unique, new TextEncoder().encode(target));
}

async function onStatfs(hdr: FuseInHeader, state: ServerState): Promise<Uint8Array> {
  // Node exposes statfs on Linux but not reliably on macOS. Try real,
  // fall back to plausible defaults. Values are hints for the kernel
  // and `df`; exactness isn't required for correctness.
  try {
    const s = await statfs(state.rootAbs);
    return buildResponse(
      hdr.unique,
      buildKstatfs({
        blocks: BigInt(s.blocks),
        bfree: BigInt(s.bfree),
        bavail: BigInt(s.bavail),
        files: BigInt(s.files),
        ffree: BigInt(s.ffree),
        bsize: s.bsize,
        namelen: 255,
        frsize: s.bsize,
      }),
    );
  } catch {
    return buildResponse(
      hdr.unique,
      buildKstatfs({
        blocks: 1_000_000n,
        bfree: 500_000n,
        bavail: 500_000n,
        files: 100_000n,
        ffree: 99_000n,
        bsize: 4096,
        namelen: 255,
        frsize: 4096,
      }),
    );
  }
}

async function onOpen(hdr: FuseInHeader, msg: Uint8Array, state: ServerState): Promise<Uint8Array> {
  const req = readOpenIn(payloadOf(msg));
  const accessMode = req.flags & 0o3; // O_RDONLY=0, O_WRONLY=1, O_RDWR=2
  if (accessMode !== 0 && state.mode === "ro") {
    return buildErrorResponse(hdr.unique, -ERRNO.EROFS);
  }
  const entry = requireInode(state, hdr.nodeid);
  // OPEN always targets a real regular file (LOOKUP returned S_IFREG),
  // so following any residual intermediate symlinks is fine.
  const abs = await absPathForTraversal(state, entry);
  const fh = await fsOpen(abs, linuxOpenFlagsToNode(req.flags));
  const id = state.nextHandle++;
  state.handles.set(id, {
    kind: "file",
    fh,
    lazyPagesContrib: isPagesImgPath(entry.relPath),
  });
  return buildResponse(hdr.unique, buildOpenOut({ fh: id, open_flags: 0 }));
}

async function onRead(hdr: FuseInHeader, msg: Uint8Array, state: ServerState): Promise<Uint8Array> {
  const req = readReadIn(payloadOf(msg));
  const handle = state.handles.get(req.fh);
  if (!handle || handle.kind !== "file") {
    return buildErrorResponse(hdr.unique, -ERRNO.EBADF);
  }
  const buf = Buffer.alloc(req.size);
  const { bytesRead } = await handle.fh.read(buf, 0, req.size, Number(req.offset));
  if (handle.lazyPagesContrib && bytesRead > 0) {
    state.bytesServedOnPagesImg += bytesRead;
  }
  return buildResponse(hdr.unique, new Uint8Array(buf.buffer, buf.byteOffset, bytesRead));
}

async function onRelease(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  const { fh } = readReleaseIn(payloadOf(msg));
  const entry = state.handles.get(fh);
  if (entry && entry.kind === "file") {
    state.handles.delete(fh);
    await entry.fh.close().catch(() => {});
  }
  return buildErrorResponse(hdr.unique, 0);
}

async function onOpendir(hdr: FuseInHeader, state: ServerState): Promise<Uint8Array> {
  const entry = requireInode(state, hdr.nodeid);
  // OPENDIR always targets a real directory (LOOKUP returned S_IFDIR).
  const abs = await absPathForTraversal(state, entry);
  const names = await readdir(abs);
  // Pack one fuse_dirent per child. Use plain `lstat` on the joined
  // path — we don't want to follow into escaping symlinks here; the
  // guest should still see that a broken-looking link exists in the
  // listing, it just won't be able to traverse through it.
  const packed: Uint8Array[] = [];
  for (const name of names) {
    try {
      const st = await lstat(join(abs, name));
      packed.push(
        buildDirent({
          // ino in READDIR is informational. We use the host ino so
          // the kernel can short-circuit LOOKUPs; if the guest does
          // LOOKUP anyway we'll allocate our own then.
          ino: BigInt(st.ino),
          off: BigInt(packed.length + 1),
          type: modeToDT(st.mode),
          name,
        }),
      );
    } catch (err) {
      log("opendir: skip %s: %s", name, (err as Error).message);
    }
  }
  const id = state.nextHandle++;
  state.handles.set(id, { kind: "dir", entries: packed });
  return buildResponse(hdr.unique, buildOpenOut({ fh: id, open_flags: 0 }));
}

async function onReaddir(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  const req = readReadIn(payloadOf(msg));
  const entry = state.handles.get(req.fh);
  if (!entry || entry.kind !== "dir") {
    return buildErrorResponse(hdr.unique, -ERRNO.EBADF);
  }
  const startIdx = Number(req.offset);
  let total = 0;
  const picked: Uint8Array[] = [];
  for (let i = startIdx; i < entry.entries.length; i++) {
    const e = entry.entries[i]!;
    if (total + e.length > req.size) {
      break;
    }
    picked.push(e);
    total += e.length;
  }
  const payload = concatBuffers(picked, total);
  return buildResponse(hdr.unique, payload);
}

function onReleasedir(hdr: FuseInHeader, msg: Uint8Array, state: ServerState): Uint8Array {
  const { fh } = readReleaseIn(payloadOf(msg));
  state.handles.delete(fh);
  return buildErrorResponse(hdr.unique, 0);
}

// --- write-through handlers (only reachable in :rw mode) ----------------

async function onWrite(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  if (state.mode === "ro") {
    return buildErrorResponse(hdr.unique, -ERRNO.EROFS);
  }
  const body = payloadOf(msg);
  const req = readWriteIn(body);
  const data = body.subarray(FUSE_WRITE_IN_SIZE, FUSE_WRITE_IN_SIZE + req.size);
  const handle = state.handles.get(req.fh);
  if (!handle || handle.kind !== "file") {
    return buildErrorResponse(hdr.unique, -ERRNO.EBADF);
  }
  const buf = Buffer.from(data.buffer, data.byteOffset, data.length);
  const { bytesWritten } = await handle.fh.write(buf, 0, data.length, Number(req.offset));
  return buildResponse(hdr.unique, buildWriteOut({ size: bytesWritten }));
}

async function onCreate(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  if (state.mode === "ro") {
    return buildErrorResponse(hdr.unique, -ERRNO.EROFS);
  }
  const body = payloadOf(msg);
  const req = readCreateIn(body);
  const name = decodeName(body.subarray(16));
  validateName(name);
  const parent = requireInode(state, hdr.nodeid);
  const parentAbs = await absPathForTraversal(state, parent);
  const childAbs = join(parentAbs, name);
  const childRel = joinRel(parent.relPath, name);
  // Honour the kernel's flags + the request's mode verbatim. The
  // kernel has already applied the guest's umask before sending us
  // CREATE (we don't advertise FUSE_DONT_MASK).
  const nodeFlags = linuxOpenFlagsToNode(req.flags) | fsConstants.O_CREAT;
  const fh = await fsOpen(childAbs, nodeFlags, req.mode);
  const st = await fh.stat();
  const ino = bindInode(state, childRel);
  const id = state.nextHandle++;
  state.handles.set(id, {
    kind: "file",
    fh,
    lazyPagesContrib: isPagesImgPath(childRel),
  });
  return buildResponse(
    hdr.unique,
    buildCreateOut(
      {
        nodeid: ino,
        generation: 0n,
        entry_valid: 1n,
        attr_valid: 1n,
        entry_valid_nsec: 0,
        attr_valid_nsec: 0,
        attr: statToAttr(st, ino),
      },
      { fh: id, open_flags: 0 },
    ),
  );
}

async function onSymlink(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  if (state.mode === "ro") {
    return buildErrorResponse(hdr.unique, -ERRNO.EROFS);
  }
  // Wire format: two NUL-terminated strings, name then target. No
  // fixed-size struct prefix.
  const body = payloadOf(msg);
  const firstNul = body.indexOf(0);
  if (firstNul < 0) {
    return buildErrorResponse(hdr.unique, -ERRNO.EINVAL);
  }
  const name = decodeName(body.subarray(0, firstNul));
  validateName(name);
  // Target is a raw byte string stored verbatim on the host. It can
  // be relative ("../foo") or absolute, can contain "..", can point
  // outside the mount root — that's POSIX-compliant. The guest can't
  // *traverse* through an out-of-root target because every subsequent
  // LOOKUP through it gets gated by the resolver.
  const targetEnd = body.indexOf(0, firstNul + 1);
  const target = decodeName(body.subarray(firstNul + 1, targetEnd < 0 ? body.length : targetEnd));
  if (target === "" || target.includes("\0")) {
    return buildErrorResponse(hdr.unique, -ERRNO.EINVAL);
  }
  const parent = requireInode(state, hdr.nodeid);
  const parentAbs = await absPathForTraversal(state, parent);
  const childAbs = join(parentAbs, name);
  const childRel = joinRel(parent.relPath, name);
  await symlink(target, childAbs);
  const st = await lstat(childAbs);
  const ino = bindInode(state, childRel);
  return buildResponse(
    hdr.unique,
    buildEntryOut({
      nodeid: ino,
      generation: 0n,
      entry_valid: 1n,
      attr_valid: 1n,
      entry_valid_nsec: 0,
      attr_valid_nsec: 0,
      attr: statToAttr(st, ino),
    }),
  );
}

async function onLink(hdr: FuseInHeader, msg: Uint8Array, state: ServerState): Promise<Uint8Array> {
  if (state.mode === "ro") {
    return buildErrorResponse(hdr.unique, -ERRNO.EROFS);
  }
  const body = payloadOf(msg);
  const req = readLinkIn(body);
  const name = decodeName(body.subarray(8));
  validateName(name);
  const oldEntry = requireInode(state, req.oldnodeid);
  const parent = requireInode(state, hdr.nodeid);
  // For the source, use lstat-style resolution: link() should target
  // the inode itself, not what a final-component symlink points at.
  // (POSIX link(2) does not follow a trailing symlink.)
  const oldAbs = await absPathForLstat(state, oldEntry);
  const parentAbs = await absPathForTraversal(state, parent);
  const childAbs = join(parentAbs, name);
  const childRel = joinRel(parent.relPath, name);
  await link(oldAbs, childAbs);
  const st = await lstat(childAbs);
  const ino = bindInode(state, childRel);
  return buildResponse(
    hdr.unique,
    buildEntryOut({
      nodeid: ino,
      generation: 0n,
      entry_valid: 1n,
      attr_valid: 1n,
      entry_valid_nsec: 0,
      attr_valid_nsec: 0,
      attr: statToAttr(st, ino),
    }),
  );
}

async function onMkdir(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  if (state.mode === "ro") {
    return buildErrorResponse(hdr.unique, -ERRNO.EROFS);
  }
  const body = payloadOf(msg);
  const req = readMkdirIn(body);
  const name = decodeName(body.subarray(8));
  validateName(name);
  const parent = requireInode(state, hdr.nodeid);
  const parentAbs = await absPathForTraversal(state, parent);
  const childAbs = join(parentAbs, name);
  const childRel = joinRel(parent.relPath, name);
  // mode includes type bits in CREATE/MKNOD; for MKDIR the kernel
  // already strips them. Mask to perm bits to be defensive.
  await mkdir(childAbs, { mode: req.mode & 0o7777 });
  const st = await lstat(childAbs);
  const ino = bindInode(state, childRel);
  return buildResponse(
    hdr.unique,
    buildEntryOut({
      nodeid: ino,
      generation: 0n,
      entry_valid: 1n,
      attr_valid: 1n,
      entry_valid_nsec: 0,
      attr_valid_nsec: 0,
      attr: statToAttr(st, ino),
    }),
  );
}

async function onRmdir(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  if (state.mode === "ro") {
    return buildErrorResponse(hdr.unique, -ERRNO.EROFS);
  }
  const name = decodeName(payloadOf(msg));
  validateName(name);
  const parent = requireInode(state, hdr.nodeid);
  const parentAbs = await absPathForTraversal(state, parent);
  await rmdir(join(parentAbs, name));
  forgetByRelPath(state, joinRel(parent.relPath, name));
  return buildErrorResponse(hdr.unique, 0);
}

async function onUnlink(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  if (state.mode === "ro") {
    return buildErrorResponse(hdr.unique, -ERRNO.EROFS);
  }
  const name = decodeName(payloadOf(msg));
  validateName(name);
  const parent = requireInode(state, hdr.nodeid);
  const parentAbs = await absPathForTraversal(state, parent);
  await unlink(join(parentAbs, name));
  forgetByRelPath(state, joinRel(parent.relPath, name));
  return buildErrorResponse(hdr.unique, 0);
}

async function onRename(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  if (state.mode === "ro") {
    return buildErrorResponse(hdr.unique, -ERRNO.EROFS);
  }
  const body = payloadOf(msg);
  const req = readRenameIn(body);
  // Two NUL-terminated names back-to-back after the struct.
  const after = body.subarray(8);
  const firstNul = after.indexOf(0);
  if (firstNul < 0) {
    return buildErrorResponse(hdr.unique, -ERRNO.EINVAL);
  }
  const oldName = decodeName(after.subarray(0, firstNul));
  const newName = decodeName(after.subarray(firstNul + 1));
  validateName(oldName);
  validateName(newName);
  const oldParent = requireInode(state, hdr.nodeid);
  const newParent = requireInode(state, req.newdir);
  // Resolve both parent dirs through the containment gate. The
  // basename joins are then on canonical paths, so a symlink in either
  // basename can't redirect outside root (the resolver realpath'd the
  // parent, and join doesn't follow links).
  const oldParentAbs = await absPathForTraversal(state, oldParent);
  const newParentAbs = await absPathForTraversal(state, newParent);
  await rename(join(oldParentAbs, oldName), join(newParentAbs, newName));
  forgetByRelPath(state, joinRel(oldParent.relPath, oldName));
  // The new name might shadow an existing inode entry; drop it so the
  // next LOOKUP rebinds.
  forgetByRelPath(state, joinRel(newParent.relPath, newName));
  return buildErrorResponse(hdr.unique, 0);
}

async function onSetattr(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  const req = readSetattrIn(payloadOf(msg));
  // Pure attr-fetch SETATTR (valid==0) is meaningless; treat as a
  // no-op GETATTR-style reply. Otherwise mutating, so RO mounts
  // refuse.
  const isMutating =
    (req.valid &
      (FATTR.MODE |
        FATTR.SIZE |
        FATTR.ATIME |
        FATTR.MTIME |
        FATTR.CTIME |
        FATTR.ATIME_NOW |
        FATTR.MTIME_NOW |
        FATTR.UID |
        FATTR.GID)) !==
    0;
  if (isMutating && state.mode === "ro") {
    return buildErrorResponse(hdr.unique, -ERRNO.EROFS);
  }
  const entry = requireInode(state, hdr.nodeid);
  // Resolve with absPathForLstat — SETATTR (lutimensat / lchown /
  // lchmod) targets the inode itself, never a final-component
  // symlink's target. If we realpath'd the basename here, a dangling
  // symlink would ENOENT before we even saw the request, which is
  // how #317 manifests during `tar -x` (symlinks land before their
  // targets do).
  const abs = await absPathForLstat(state, entry);
  const st0 = await lstat(abs);
  const isSymlink = (st0.mode & 0o170000) === 0o120000;
  if (req.valid & FATTR.SIZE) {
    if (isSymlink) {
      // Truncating a symlink is meaningless and POSIX doesn't define
      // it; Linux returns EINVAL when something asks. Don't silently
      // chase the link's target.
      return buildErrorResponse(hdr.unique, -ERRNO.EINVAL);
    }
    if (req.valid & FATTR.FH) {
      const handle = state.handles.get(req.fh);
      if (!handle || handle.kind !== "file") {
        return buildErrorResponse(hdr.unique, -ERRNO.EBADF);
      }
      await handle.fh.truncate(Number(req.size));
    } else {
      await truncate(abs, Number(req.size));
    }
  }
  if (req.valid & FATTR.MODE) {
    const mode = req.mode & 0o7777;
    if (isSymlink) {
      // Linux ignores symlink permission bits entirely (the perms on
      // the link inode are never consulted), but lchmod is a no-op
      // there rather than an error. macOS supports lchmod on APFS.
      // Either way we don't want chmod() to follow the link.
      try {
        await lchmod(abs, mode);
      } catch (err) {
        // Filesystems without symlink-mode support throw ENOTSUP /
        // EOPNOTSUPP. Swallow — the guest cares about lchown / lutimes
        // not failing; lchmod-on-symlink is best-effort.
        if (!isUnsupportedFsErr(err)) {
          throw err;
        }
      }
    } else {
      await chmod(abs, mode);
    }
  }
  if (req.valid & (FATTR.ATIME | FATTR.MTIME | FATTR.ATIME_NOW | FATTR.MTIME_NOW)) {
    // utimes wants seconds-since-epoch as numbers. Use current values
    // for any axis the kernel didn't ask us to change, plus _NOW
    // overrides.
    const now = Date.now() / 1000;
    const a =
      req.valid & FATTR.ATIME_NOW
        ? now
        : req.valid & FATTR.ATIME
          ? Number(req.atime) + req.atimensec / 1e9
          : st0.atimeMs / 1000;
    const m =
      req.valid & FATTR.MTIME_NOW
        ? now
        : req.valid & FATTR.MTIME
          ? Number(req.mtime) + req.mtimensec / 1e9
          : st0.mtimeMs / 1000;
    if (isSymlink) {
      // lutimes operates on the link itself (AT_SYMLINK_NOFOLLOW
      // semantics). Without this, utimes() follows and may EIO /
      // ENOENT on a dangling-target symlink mid-tar-extraction (#317).
      await lutimes(abs, a, m);
    } else {
      await utimes(abs, a, m);
    }
  }
  if (req.valid & (FATTR.UID | FATTR.GID)) {
    // The host process is typically unprivileged, so a real chown
    // would EPERM. We don't enforce ownership inside the mount —
    // the guest sees its own (uid=0) view. But for symlinks we
    // explicitly call lchown to avoid an unhandled error path; for
    // regular files we stay silent (current behaviour). Either way,
    // failures are swallowed: tar treats a non-zero chown as a
    // warning only when the errno is "soft" (EPERM / ENOSYS /
    // ENOTSUP), so map anything unexpected to ENOSYS.
    if (isSymlink) {
      try {
        await lchown(abs, req.uid, req.gid);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "ENOSYS" && !isUnsupportedFsErr(err)) {
          throw err;
        }
      }
    }
  }
  const st = await lstat(abs);
  return buildResponse(
    hdr.unique,
    buildAttrOut({
      attr_valid: 1n,
      attr_valid_nsec: 0,
      attr: statToAttr(st, hdr.nodeid),
    }),
  );
}

/**
 * True if `err` is a Node fs error whose code is the "this filesystem
 * doesn't support that op" family — i.e. something the FUSE caller
 * should treat as a soft failure, not a real I/O problem.
 */
function isUnsupportedFsErr(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOTSUP" || code === "EOPNOTSUPP" || code === "ENOSYS";
}

async function onFsync(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  // fuse_fsync_in: { fh: u64, fsync_flags: u32, padding: u32 }
  const body = payloadOf(msg);
  if (body.length < 8) {
    return buildErrorResponse(hdr.unique, -ERRNO.EINVAL);
  }
  const dv = new DataView(body.buffer, body.byteOffset, body.length);
  const fh = dv.getBigUint64(0, true);
  const handle = state.handles.get(fh);
  if (!handle || handle.kind !== "file") {
    return buildErrorResponse(hdr.unique, -ERRNO.EBADF);
  }
  // `:ro` mounts have no dirty data — sync is still legal (it's a
  // read-side guarantee), so honour without a mode check. fsync is a
  // no-op on a clean fd.
  await handle.fh.sync();
  return buildErrorResponse(hdr.unique, 0);
}

async function onFsyncdir(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  // fuse_fsync_in (shared with FSYNC): { fh: u64, fsync_flags: u32,
  // padding: u32 }. The fh is one we minted in OPENDIR — that handle
  // doesn't hold a host fd (we snapshot the entry list at opendir
  // time), so we re-open the dir by nodeid and fsync it. fsync on a
  // dir is a real syscall on Linux/darwin; it forces directory-entry
  // metadata to durable storage. Like FSYNC, legal on :ro mounts.
  const body = payloadOf(msg);
  if (body.length < 8) {
    return buildErrorResponse(hdr.unique, -ERRNO.EINVAL);
  }
  const dv = new DataView(body.buffer, body.byteOffset, body.length);
  const fh = dv.getBigUint64(0, true);
  const handle = state.handles.get(fh);
  if (!handle || handle.kind !== "dir") {
    return buildErrorResponse(hdr.unique, -ERRNO.EBADF);
  }
  const entry = requireInode(state, hdr.nodeid);
  const abs = await absPathForTraversal(state, entry);
  // O_RDONLY | O_DIRECTORY isn't portable through Node's fs API, but
  // opening a dir with plain O_RDONLY works on both Linux and darwin
  // for fsync purposes (the open succeeds; only read/write would fail).
  const dirFh = await fsOpen(abs, fsConstants.O_RDONLY);
  try {
    await dirFh.sync();
  } finally {
    await dirFh.close().catch(() => {});
  }
  return buildErrorResponse(hdr.unique, 0);
}

async function onFallocate(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  // fuse_fallocate_in: { fh, offset, length, mode, padding }
  if (state.mode === "ro") {
    return buildErrorResponse(hdr.unique, -ERRNO.EROFS);
  }
  const req = readFallocateIn(payloadOf(msg));
  const handle = state.handles.get(req.fh);
  if (!handle || handle.kind !== "file") {
    return buildErrorResponse(hdr.unique, -ERRNO.EBADF);
  }
  // We can satisfy mode=0 (preallocate-or-extend) and KEEP_SIZE
  // (best-effort no-op — the data area reads as zero anyway). Real
  // posix_fallocate isn't exposed by Node, and the hole-punch /
  // range-collapse / zero-range / insert-range modes need ext4-class
  // syscalls we'd have to FFI to. ENOSYS for those tells the guest
  // to fall back to a userspace write loop.
  const unsupported =
    FALLOC_FL.PUNCH_HOLE | FALLOC_FL.COLLAPSE_RANGE | FALLOC_FL.ZERO_RANGE | FALLOC_FL.INSERT_RANGE;
  if (req.mode & unsupported) {
    return buildErrorResponse(hdr.unique, -ERRNO.ENOSYS);
  }
  if (!(req.mode & FALLOC_FL.KEEP_SIZE)) {
    // Default mode: ensure the file is at least offset+length bytes.
    // truncate-up is the portable approximation; on Linux ext4/xfs it
    // does extend the i_size and reserve no blocks (sparse), which is
    // the documented POSIX behaviour anyway. Callers that need true
    // physical allocation get the same as posix_fallocate sees on a
    // filesystem without fallocate support — a zero-filled write
    // would be the only way, and it's prohibitively expensive.
    const target = Number(req.offset + req.length);
    const st = await handle.fh.stat();
    if (target > st.size) {
      await handle.fh.truncate(target);
    }
  }
  // KEEP_SIZE-with-mode=KEEP_SIZE is a hint; no-op success is correct.
  return buildErrorResponse(hdr.unique, 0);
}

async function onLseek(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  // fuse_lseek_in: { fh, offset, whence, padding } → fuse_lseek_out:
  // { offset }. FUSE READ/WRITE are pread/pwrite, so we never keep
  // per-fd file position state — SEEK_CUR resolves to 0. SEEK_SET
  // and SEEK_END are trivial; SEEK_HOLE/SEEK_DATA need
  // filesystem-specific sparse-aware lookups we can't reach from Node.
  const req = readLseekIn(payloadOf(msg));
  const handle = state.handles.get(req.fh);
  if (!handle || handle.kind !== "file") {
    return buildErrorResponse(hdr.unique, -ERRNO.EBADF);
  }
  let resolved: bigint;
  switch (req.whence) {
    case SEEK.SET:
      resolved = req.offset;
      break;
    case SEEK.CUR:
      // No tracked position — kernel callers using SEEK_CUR through
      // FUSE are exotic; returning the offset they passed in keeps
      // POSIX semantics consistent enough for the common case of
      // SEEK_CUR with offset 0 (== "where am I?").
      resolved = req.offset;
      break;
    case SEEK.END: {
      const st = await handle.fh.stat();
      resolved = BigInt(st.size) + req.offset;
      break;
    }
    case SEEK.HOLE:
    case SEEK.DATA:
      // Linux-only and filesystem-specific. Tell the guest we don't
      // know — they fall back to treating the whole file as data,
      // which is always correct (just not sparse-optimal).
      return buildErrorResponse(hdr.unique, -ERRNO.ENOSYS);
    default:
      return buildErrorResponse(hdr.unique, -ERRNO.EINVAL);
  }
  if (resolved < 0n) {
    return buildErrorResponse(hdr.unique, -ERRNO.EINVAL);
  }
  return buildResponse(hdr.unique, buildLseekOut({ offset: resolved }));
}

const COPY_FILE_RANGE_CHUNK = 1 << 20; // 1 MiB

async function onCopyFileRange(
  hdr: FuseInHeader,
  msg: Uint8Array,
  state: ServerState,
): Promise<Uint8Array> {
  // fuse_copy_file_range_in: { fh_in, off_in, nodeid_out, fh_out,
  // off_out, len, flags }. Userspace loop because Node has no
  // copy_file_range(2) binding — fine, the kernel-side fast path is
  // only an optimisation, not a correctness requirement.
  if (state.mode === "ro") {
    return buildErrorResponse(hdr.unique, -ERRNO.EROFS);
  }
  const req = readCopyFileRangeIn(payloadOf(msg));
  if (req.flags !== 0n) {
    // The Linux man page reserves the flags field for future use;
    // any non-zero value today is undefined. Be conservative.
    return buildErrorResponse(hdr.unique, -ERRNO.EINVAL);
  }
  const src = state.handles.get(req.fh_in);
  const dst = state.handles.get(req.fh_out);
  if (!src || src.kind !== "file" || !dst || dst.kind !== "file") {
    return buildErrorResponse(hdr.unique, -ERRNO.EBADF);
  }
  let copied = 0;
  let srcOff = Number(req.off_in);
  let dstOff = Number(req.off_out);
  const total = Number(req.len);
  const buf = Buffer.allocUnsafe(Math.min(total, COPY_FILE_RANGE_CHUNK));
  while (copied < total) {
    const want = Math.min(total - copied, buf.length);
    const { bytesRead } = await src.fh.read(buf, 0, want, srcOff);
    if (bytesRead === 0) {
      break; // EOF on src — short copy, return what we got
    }
    const { bytesWritten } = await dst.fh.write(buf, 0, bytesRead, dstOff);
    copied += bytesWritten;
    srcOff += bytesRead;
    dstOff += bytesWritten;
    if (bytesWritten < bytesRead) {
      // Disk full or similar partial write — stop here; the caller
      // will see the short count and decide.
      break;
    }
  }
  return buildResponse(hdr.unique, buildWriteOut({ size: copied }));
}

// --- internal helpers ----------------------------------------------------

function decodeName(body: Uint8Array): string {
  // Name is NUL-terminated; anything after the first NUL is padding.
  const nulAt = body.indexOf(0);
  const end = nulAt >= 0 ? nulAt : body.length;
  return new TextDecoder("utf-8", { fatal: false }).decode(body.subarray(0, end));
}

/**
 * Defensive name sanity check. The Linux VFS handles "." and ".." at
 * a higher layer and never ships them to FUSE as LOOKUP names, but a
 * malicious userspace could forge requests; we're the only check.
 */
function validateName(name: string): void {
  if (name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
    const err: NodeJS.ErrnoException = new Error(`invalid FUSE name: ${JSON.stringify(name)}`);
    err.code = "EINVAL";
    throw err;
  }
}

function joinRel(parentRel: string, name: string): string {
  if (parentRel === "") {
    return name;
  }
  return `${parentRel}/${name}`;
}

function requireInode(state: ServerState, ino: bigint): InodeEntry {
  const e = state.inodes.get(ino);
  if (!e) {
    // Kernel referenced an inode we've forgotten. Return an error that
    // tells the kernel to re-LOOKUP (ESTALE).
    const err: NodeJS.ErrnoException = new Error(`stale inode ${ino}`);
    err.code = "ESTALE";
    throw err;
  }
  return e;
}

/**
 * Resolve an inode's path for ops that traverse through to the target
 * (OPEN/OPENDIR/STATFS). Follows intermediate symlinks via realpath;
 * the resolver rejects any that escape the mount root.
 */
async function absPathForTraversal(state: ServerState, entry: InodeEntry): Promise<string> {
  if (entry.relPath === "") {
    return await realpath(state.rootAbs);
  }
  return await resolveUnderRoot(state.rootAbs, entry.relPath);
}

/**
 * Resolve an inode's path for ops that want the node itself without
 * following the final component (GETATTR, and LOOKUP target). Parent
 * is realpath'd (same containment gate); basename is joined raw so a
 * symlink basename stays a symlink.
 */
async function absPathForLstat(state: ServerState, entry: InodeEntry): Promise<string> {
  if (entry.relPath === "") {
    return await realpath(state.rootAbs);
  }
  const slashAt = entry.relPath.lastIndexOf("/");
  const parentRel = slashAt < 0 ? "" : entry.relPath.slice(0, slashAt);
  const baseName = slashAt < 0 ? entry.relPath : entry.relPath.slice(slashAt + 1);
  const parentAbs =
    parentRel === ""
      ? await realpath(state.rootAbs)
      : await resolveUnderRoot(state.rootAbs, parentRel);
  return join(parentAbs, baseName);
}

function bindInode(state: ServerState, relPath: string): bigint {
  // Reuse existing entry so nlookup accumulates correctly on repeated
  // LOOKUPs of the same name.
  for (const [ino, e] of state.inodes) {
    if (e.relPath === relPath) {
      if (e.nlookup !== Number.POSITIVE_INFINITY) {
        e.nlookup++;
      }
      return ino;
    }
  }
  const ino = state.nextInode++;
  state.inodes.set(ino, { relPath, nlookup: 1 });
  return ino;
}

function decrefInode(state: ServerState, ino: bigint, n: number): void {
  const e = state.inodes.get(ino);
  if (!e) {
    return;
  }
  if (e.nlookup === Number.POSITIVE_INFINITY) {
    return;
  } // root is pinned
  e.nlookup -= n;
  if (e.nlookup <= 0) {
    state.inodes.delete(ino);
  }
}

/**
 * Drop any inode entry pointing at `relPath`. Called after RMDIR /
 * UNLINK / RENAME so a subsequent LOOKUP at the same path mints a
 * fresh inode rather than reusing one whose underlying file is gone.
 * The kernel still holds nlookup refs to the old inode and will
 * FORGET it later — that's fine, decrefInode tolerates a missing
 * entry.
 */
function forgetByRelPath(state: ServerState, relPath: string): void {
  for (const [ino, e] of state.inodes) {
    if (e.relPath === relPath) {
      state.inodes.delete(ino);
      return;
    }
  }
}

/**
 * Translate Linux fcntl open flags (as the guest kernel sends them)
 * into Node's portable `fs.constants` flags. The numeric values
 * differ between Linux and macOS, so we can't pass the wire flags
 * straight to `fs.open` on a macOS host.
 *
 * O_CREAT is intentionally not honoured here — plain OPEN never
 * creates; CREATE is a separate FUSE op. Same for O_EXCL.
 */
function linuxOpenFlagsToNode(flags: number): number {
  // Linux fcntl values, stable on x86_64 / arm64. RDONLY=0 is the
  // default branch.
  const LINUX_O_WRONLY = 1;
  const LINUX_O_RDWR = 2;
  const LINUX_O_TRUNC = 0o1000;
  const LINUX_O_APPEND = 0o2000;
  const accessMode = flags & 0o3;
  let out: number;
  if (accessMode === LINUX_O_WRONLY) {
    out = fsConstants.O_WRONLY;
  } else if (accessMode === LINUX_O_RDWR) {
    out = fsConstants.O_RDWR;
  } else {
    out = fsConstants.O_RDONLY;
  }
  if (flags & LINUX_O_TRUNC) {
    out |= fsConstants.O_TRUNC;
  }
  if (flags & LINUX_O_APPEND) {
    out |= fsConstants.O_APPEND;
  }
  return out;
}

function statToAttr(st: Stats, ino: bigint) {
  const atime = BigInt(Math.floor(st.atimeMs / 1000));
  const mtime = BigInt(Math.floor(st.mtimeMs / 1000));
  const ctime = BigInt(Math.floor(st.ctimeMs / 1000));
  return {
    ino,
    size: BigInt(st.size),
    blocks: BigInt(st.blocks ?? 0),
    atime,
    mtime,
    ctime,
    atimensec: Math.floor((st.atimeMs % 1000) * 1e6),
    mtimensec: Math.floor((st.mtimeMs % 1000) * 1e6),
    ctimensec: Math.floor((st.ctimeMs % 1000) * 1e6),
    mode: st.mode,
    nlink: st.nlink,
    uid: st.uid,
    gid: st.gid,
    rdev: st.rdev,
    blksize: st.blksize,
    flags: 0,
  };
}

function modeToDT(mode: number): number {
  const type = mode & 0o170000;
  switch (type) {
    case 0o040000:
      return DT.DIR;
    case 0o100000:
      return DT.REG;
    case 0o120000:
      return DT.LNK;
    case 0o020000:
      return DT.CHR;
    case 0o060000:
      return DT.BLK;
    case 0o010000:
      return DT.FIFO;
    case 0o140000:
      return DT.SOCK;
    default:
      return DT.UNKNOWN;
  }
}

function concatBuffers(parts: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}

/**
 * Translate a thrown error to a negative errno. Any `MountError`
 * (containment failure) becomes ENOENT on the wire — never distinguish
 * "it's there but you can't reach it" from "not there". Real errno
 * errors from Node's fs are mapped verbatim; anything else becomes EIO.
 */
function mapErrorToErrno(err: unknown): number {
  if (isMachinenError(err) && err instanceof MountError) {
    return -ERRNO.ENOENT;
  }
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (!code) {
    return -ERRNO.EIO;
  }
  // libuv sometimes surfaces EOPNOTSUPP; Linux defines it as a synonym
  // of ENOTSUP. Normalise so callers don't need to care.
  if (code === "EOPNOTSUPP") {
    return -ERRNO.ENOTSUP;
  }
  const key = code as keyof typeof ERRNO;
  if (key in ERRNO) {
    return -ERRNO[key];
  }
  return -ERRNO.EIO;
}
