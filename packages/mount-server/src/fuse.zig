//! Transport-agnostic FUSE protocol handlers for machinen live mounts.
//!
//! Extracted from the #329 mount server (#332) so the opcode handlers
//! are framing-independent. The sole consumer is
//! `packages/microvm/src/virtiofs.zig` — the in-VMM virtio-fs device,
//! which speaks a FUSE-derived protocol over a virtqueue. (#338
//! removed the standalone vsock/UDS `mount-server` process that was
//! the other consumer.)
//!
//! Everything here is framing-independent. `dispatch()` takes one
//! decoded FUSE request frame (in-header + payload, contiguous) and
//! returns one reply frame (out-header + payload) or null for the
//! no-reply ops (FORGET, INTERRUPT). The caller owns frame I/O —
//! reading requests off its transport, writing replies back, and
//! freeing the returned buffer with `state.gpa`.
//!
//! Handler scope (per #329 acceptance plan):
//!   - INIT handshake (negotiates 7.31)
//!   - LOOKUP, GETATTR, CREATE, WRITE, RELEASE (the hot ops the JS
//!     baseline bench identified as 88.3% of handler time)
//!   - FORGET / BATCH_FORGET (inode bookkeeping)
//!   - DESTROY / INTERRUPT / FLUSH / ACCESS — minimal correct stubs
//!   - OPEN/READ, OPENDIR/READDIR/RELEASEDIR, MKDIR, UNLINK, RMDIR,
//!     RENAME, LINK, SYMLINK, READLINK, SETATTR, STATFS
//!   - Everything else → ENOSYS, same as the JS server does today
//!
//! Path containment is lexical: names must not contain `/`, `.`, `..`,
//! or NUL. Realpath-based symlink-escape protection is a follow-up —
//! the tar-extract bench workload creates regular files only, so
//! deferring is safe for the perf measurement.

const std = @import("std");
const builtin = @import("builtin");
const assert = std.debug.assert;
const fuse_state = @import("fuse_state.zig");

test {
    // Pull `fuse_state.zig`'s tests into `zig build test` — it's only
    // referenced through `State.dumpState` / `applyState`, which the
    // test runner wouldn't otherwise walk into.
    _ = fuse_state;
}

// --- libc externs -------------------------------------------------------

// EINTR — retried by pwriteAll / the stats-file write on a short host write.
const EINTR: c_int = 4;
// Host errno values that differ across the two platforms we ship on.
// FUSE replies must still use Linux errno numbers on the wire.
const HOST_ENOTEMPTY: c_int = if (builtin.os.tag == .macos) 66 else 39;

extern "c" fn close(fd: c_int) c_int;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn unlink(path: [*:0]const u8) c_int;
extern "c" fn link(old: [*:0]const u8, new: [*:0]const u8) c_int;
extern "c" fn rename(old: [*:0]const u8, new: [*:0]const u8) c_int;
extern "c" fn readlink(path: [*:0]const u8, buf: [*]u8, bufsiz: usize) isize;
extern "c" fn chmod(path: [*:0]const u8, mode: c_int) c_int;
extern "c" fn fchmod(fd: c_int, mode: c_int) c_int;
extern "c" fn ftruncate(fd: c_int, length: i64) c_int;
extern "c" fn truncate(path: [*:0]const u8, length: i64) c_int;
extern "c" fn __error() *c_int;
extern "c" fn __errno_location() *c_int;

const CLOCK_REALTIME: c_int = 0;
const CLOCK_MONOTONIC: c_int = if (builtin.os.tag == .macos) 6 else 1;

const timespec_c = extern struct {
    tv_sec: isize,
    tv_nsec: isize,
};

extern "c" fn clock_gettime(clk_id: c_int, ts: *timespec_c) c_int;

// Posix file ops. We declare these ourselves to keep the call sites
// independent of std.posix / std.c's typed O wrapper (the wrapper turned
// into a packed-struct in Zig 0.16, awkward to thread through a
// Linux-flag-translation layer where we already have the raw bits).
//
// macOS uses 32-bit stat layout via the legacy stat$INODE64 ABI; we use
// fstatat with AT_FDCWD + AT_SYMLINK_NOFOLLOW to get lstat semantics
// without needing a separate `lstat` symbol. Linux exposes fstatat
// natively. Both targets define AT_FDCWD = -100 and AT_SYMLINK_NOFOLLOW = 0x100.
const AT_FDCWD: c_int = -100;
const AT_SYMLINK_NOFOLLOW: c_int = if (builtin.os.tag == .macos) 0x0020 else 0x100;

// `stat` struct layout. Two flavors — Linux and darwin — covering the
// only host archs this binary ships for. fields are in wire order.
const StatDarwin = extern struct {
    dev: i32,
    mode: u16,
    nlink: u16,
    ino: u64,
    uid: u32,
    gid: u32,
    rdev: i32,
    atimespec: timespec_c,
    mtimespec: timespec_c,
    ctimespec: timespec_c,
    birthtimespec: timespec_c,
    size: i64,
    blocks: i64,
    blksize: i32,
    flags: u32,
    gen: u32,
    lspare: i32,
    qspare: [2]i64,
};

const StatLinuxX64 = extern struct {
    dev: u64,
    ino: u64,
    nlink: u64,
    mode: u32,
    uid: u32,
    gid: u32,
    _pad0: u32,
    rdev: u64,
    size: i64,
    blksize: i64,
    blocks: i64,
    atim: timespec_c,
    mtim: timespec_c,
    ctim: timespec_c,
    _spare: [3]i64,
};

// glibc's aarch64 `struct stat` is not the same as x86_64's: `mode`
// and 32-bit `nlink` precede uid/gid, with padding around rdev/blksize.
// The VMM's linux package ships for arm64, so using the x86_64 layout
// here corrupts attrs and can panic on GETATTR under KVM.
const StatLinuxAarch64 = extern struct {
    dev: u64,
    ino: u64,
    mode: u32,
    nlink: u32,
    uid: u32,
    gid: u32,
    rdev: u64,
    _pad1: u64,
    size: i64,
    blksize: i32,
    _pad2: i32,
    blocks: i64,
    atim: timespec_c,
    mtim: timespec_c,
    ctim: timespec_c,
    _spare: [2]u32,
};

const StatLinux = switch (builtin.cpu.arch) {
    .aarch64 => StatLinuxAarch64,
    else => StatLinuxX64,
};

const Stat = if (builtin.os.tag == .macos) StatDarwin else StatLinux;

extern "c" fn fstatat(fd: c_int, path: [*:0]const u8, buf: *Stat, flag: c_int) c_int;
extern "c" fn fstat(fd: c_int, buf: *Stat) c_int;
extern "c" fn open(path: [*:0]const u8, oflag: c_int, ...) c_int;
extern "c" fn pwrite(fd: c_int, buf: [*]const u8, nbyte: usize, offset: i64) isize;
extern "c" fn pread(fd: c_int, buf: [*]u8, nbyte: usize, offset: i64) isize;
extern "c" fn mkdir(path: [*:0]const u8, mode: c_int) c_int;
extern "c" fn symlink(target: [*:0]const u8, linkpath: [*:0]const u8) c_int;
extern "c" fn rmdir(path: [*:0]const u8) c_int;
const DirPtr = *opaque {};
extern "c" fn opendir(path: [*:0]const u8) ?DirPtr;
extern "c" fn closedir(dir: DirPtr) c_int;

// `readdir` returns a libc-owned `struct dirent` pointer or null at
// end-of-stream. The struct layout differs between darwin and linux,
// but for our purposes we only need the type byte and the NUL-
// terminated name. Both platforms place `d_type` (u8) somewhere in
// the front and `d_name` starts at a known offset — darwin has a
// `__darwin_ino64_t` (u64) ino, u64 seekoff, u16 reclen, u16 namlen,
// u8 type, then char d_name[1024]; linux has u64 ino, i64 off, u16
// reclen, u8 type, then char d_name[256]. We crawl just the `type`
// (offset 20 darwin, 18 linux) and `name` (offset 21 darwin, 19
// linux). The crawl is read-only on libc-owned memory.
const DirentDarwin = extern struct {
    d_ino: u64,
    d_seekoff: u64,
    d_reclen: u16,
    d_namlen: u16,
    d_type: u8,
    d_name: [1024]u8,
};
const DirentLinux = extern struct {
    d_ino: u64,
    d_off: i64,
    d_reclen: u16,
    d_type: u8,
    d_name: [256]u8,
};
const Dirent = if (builtin.os.tag == .macos) DirentDarwin else DirentLinux;
extern "c" fn readdir(dir: DirPtr) ?*Dirent;

// Host open flags we actually use. Values are stable across darwin and
// linux for the standard set we care about.
const O_RDONLY: c_int = 0x0000;
const O_WRONLY: c_int = 0x0001;
const O_RDWR: c_int = 0x0002;
const O_CREAT: c_int = if (builtin.os.tag == .macos) 0x0200 else 0o100;
const O_TRUNC: c_int = if (builtin.os.tag == .macos) 0x0400 else 0o1000;
const O_APPEND: c_int = if (builtin.os.tag == .macos) 0x0008 else 0o2000;

fn now_ns() u64 {
    var ts: timespec_c = .{ .tv_sec = 0, .tv_nsec = 0 };
    _ = clock_gettime(CLOCK_MONOTONIC, &ts);
    return @as(u64, @intCast(ts.tv_sec)) * 1_000_000_000 + @as(u64, @intCast(ts.tv_nsec));
}

fn now_ms() i64 {
    var ts: timespec_c = .{ .tv_sec = 0, .tv_nsec = 0 };
    _ = clock_gettime(CLOCK_REALTIME, &ts);
    return @as(i64, ts.tv_sec) * 1000 + @divFloor(@as(i64, ts.tv_nsec), 1_000_000);
}

pub fn profile_now_ns() u64 {
    const ns = now_ns();
    assert(ns > 0);
    return ns;
}

pub fn record_virtqueue_profile(
    state: *State,
    gather_ns: u64,
    dispatch_ns: u64,
    scatter_ns: u64,
    request_bytes: u64,
    reply_bytes: u32,
) void {
    assert(state.root_abs.len > 0);
    if (!state.profile_enabled) return;
    state.virtqueue_request_count += 1;
    state.virtqueue_gather_ns += gather_ns;
    state.virtqueue_dispatch_ns += dispatch_ns;
    state.virtqueue_scatter_ns += scatter_ns;
    state.virtqueue_request_bytes += request_bytes;
    state.virtqueue_reply_bytes += reply_bytes;
}

fn errno() c_int {
    return if (builtin.os.tag == .macos) __error().* else __errno_location().*;
}

// --- FUSE protocol constants (uapi/linux/fuse.h, protocol 7.31) ---------

const FUSE_KERNEL_VERSION: u32 = 7;
const FUSE_KERNEL_MINOR_VERSION: u32 = 31;

pub const FUSE_IN_HEADER_SIZE: usize = 40;
pub const FUSE_OUT_HEADER_SIZE: usize = 16;
const FUSE_ATTR_SIZE: usize = 88;
const FUSE_ENTRY_OUT_SIZE: usize = 40 + FUSE_ATTR_SIZE; // 128
const FUSE_ATTR_OUT_SIZE: usize = 16 + FUSE_ATTR_SIZE; // 104
const FUSE_INIT_OUT_SIZE: usize = 64;
const FUSE_WRITE_IN_SIZE: usize = 40;
const FUSE_CREATE_IN_SIZE: usize = 16;
const FUSE_RELEASE_IN_SIZE: usize = 24;

const Op = enum(u32) {
    LOOKUP = 1,
    FORGET = 2,
    GETATTR = 3,
    SETATTR = 4,
    READLINK = 5,
    SYMLINK = 6,
    MKDIR = 9,
    UNLINK = 10,
    RMDIR = 11,
    RENAME = 12,
    LINK = 13,
    OPEN = 14,
    READ = 15,
    WRITE = 16,
    STATFS = 17,
    RELEASE = 18,
    FSYNC = 20,
    SETXATTR = 21,
    GETXATTR = 22,
    LISTXATTR = 23,
    REMOVEXATTR = 24,
    FLUSH = 25,
    INIT = 26,
    OPENDIR = 27,
    READDIR = 28,
    RELEASEDIR = 29,
    FSYNCDIR = 30,
    GETLK = 31,
    SETLK = 32,
    SETLKW = 33,
    ACCESS = 34,
    CREATE = 35,
    INTERRUPT = 36,
    DESTROY = 38,
    BATCH_FORGET = 42,
    _,
};

// FUSE_INIT capability flags we propagate back to the kernel.
const FUSE_CAP_ASYNC_READ: u32 = 1 << 0;
const FUSE_CAP_BIG_WRITES: u32 = 1 << 5;
const FUSE_CAP_EXPORT_SUPPORT: u32 = 1 << 4;
const FUSE_CAP_MAX_PAGES: u32 = 1 << 22;
const FUSE_CAP_PARALLEL_DIROPS: u32 = 1 << 18;
// WRITEBACK_CACHE: the kernel buffers writes in its own page cache
// and flushes them to us in max_write-sized chunks instead of issuing
// one FUSE WRITE per `write(2)` syscall the guest made. For the tar
// bench (#329) this collapses ~40k 1.3 KiB WRITEs into ~1k 128 KiB
// WRITEs — most of the remaining wall-clock gap vs docker.
//
// Correctness contract: the kernel's view of file size and modified
// times can lag the host. For our use case (`--mount-live` of a host
// directory the guest writes to) the host isn't expected to also be
// writing concurrently, so the staleness window is benign. truncate
// and fsync still flush correctly because the kernel sends a SETATTR
// (with FATTR.SIZE) / FSYNC after draining its dirty pages — both of
// which we honor.
//
// The JS server explicitly masks this off; PR1 enables it because the
// measurement showed wire-write count dominating handler-time fraction.
const FUSE_CAP_WRITEBACK_CACHE: u32 = 1 << 16;

// Linux errnos the kernel expects in FUSE error replies (negative on
// the wire). Values cribbed from uapi.
const E = struct {
    const PERM: i32 = 1;
    const NOENT: i32 = 2;
    const IO: i32 = 5;
    const BADF: i32 = 9;
    const ACCES: i32 = 13;
    const BUSY: i32 = 16;
    const EXIST: i32 = 17;
    const NOTDIR: i32 = 20;
    const ISDIR: i32 = 21;
    const INVAL: i32 = 22;
    const NOSPC: i32 = 28;
    const ROFS: i32 = 30;
    const NOSYS: i32 = 38;
    const NOTEMPTY: i32 = 39;
    const STALE: i32 = 116;
};

// Linux fcntl open flags as the guest kernel sends them. Need
// translation to host (darwin/linux) values; the numeric encodings
// differ.
const LINUX_O_RDONLY: u32 = 0;
const LINUX_O_WRONLY: u32 = 1;
const LINUX_O_RDWR: u32 = 2;
const LINUX_O_TRUNC: u32 = 0o1000;
const LINUX_O_APPEND: u32 = 0o2000;

// fuse_setattr_in.valid bits (uapi/linux/fuse.h). Only SIZE/FH need
// dedicated handling today: the guest uses them for `: > file` and
// O_TRUNC/writeback-cache flushes. The ro gate below still treats the
// mode/owner/time bits as mutating even while we leave them unchanged.
const FATTR_MODE: u32 = 1 << 0;
const FATTR_UID: u32 = 1 << 1;
const FATTR_GID: u32 = 1 << 2;
const FATTR_SIZE: u32 = 1 << 3;
const FATTR_ATIME: u32 = 1 << 4;
const FATTR_MTIME: u32 = 1 << 5;
const FATTR_FH: u32 = 1 << 6;
const FATTR_ATIME_NOW: u32 = 1 << 7;
const FATTR_MTIME_NOW: u32 = 1 << 8;

pub const CacheMode = enum { cached, fast };

const CachePolicy = struct {
    entry_valid_sec: u64,
    entry_valid_nsec: u32,
    attr_valid_sec: u64,
    attr_valid_nsec: u32,
};

fn cache_policy(mode: CacheMode) CachePolicy {
    assert(@sizeOf(CacheMode) > 0);
    return switch (mode) {
        .cached => .{
            .entry_valid_sec = 1,
            .entry_valid_nsec = 0,
            .attr_valid_sec = 0,
            .attr_valid_nsec = 100_000_000,
        },
        .fast => .{
            .entry_valid_sec = 5,
            .entry_valid_nsec = 0,
            .attr_valid_sec = 1,
            .attr_valid_nsec = 0,
        },
    };
}

// Hard upper bound on entries snapshotted per OPENDIR. Tiger Style:
// every loop gets a static ceiling — the readdir() loop would
// otherwise grow `dir_entries` without limit on a pathological
// directory. 64 Ki entries × (24-byte header + padded name) is a few
// MiB worst case; no real workload (a node tarball, a git tree) puts
// that many children in one directory. A directory that exceeds the
// cap yields a truncated listing — bounded memory beats a correct
// listing that can OOM the host.
const MAX_DIRENTS: usize = 64 * 1024;

// Largest FUSE message a transport hands us in one frame: the 40-byte
// in-header + a 128 KiB max_write payload + the create_in struct +
// a name, rounded up. Each transport's read buffer is sized to this
// and rejects any framed length above it.
pub const MAX_FUSE_MESSAGE: usize = 256 * 1024;

// --- wire codecs --------------------------------------------------------

const InHeader = struct {
    len: u32,
    opcode: u32,
    unique: u64,
    nodeid: u64,
    uid: u32,
    gid: u32,
    pid: u32,
};

fn read_in_header(buf: []const u8) InHeader {
    assert(buf.len >= FUSE_IN_HEADER_SIZE);
    return .{
        .len = std.mem.readInt(u32, buf[0..4], .little),
        .opcode = std.mem.readInt(u32, buf[4..8], .little),
        .unique = std.mem.readInt(u64, buf[8..16], .little),
        .nodeid = std.mem.readInt(u64, buf[16..24], .little),
        .uid = std.mem.readInt(u32, buf[24..28], .little),
        .gid = std.mem.readInt(u32, buf[28..32], .little),
        .pid = std.mem.readInt(u32, buf[32..36], .little),
        // padding at 36
    };
}

fn write_out_header(dst: []u8, payload_len: usize, err: i32, unique: u64) void {
    assert(dst.len >= FUSE_OUT_HEADER_SIZE);
    const total: u32 = @intCast(FUSE_OUT_HEADER_SIZE + payload_len);
    std.mem.writeInt(u32, dst[0..4], total, .little);
    std.mem.writeInt(i32, dst[4..8], err, .little);
    std.mem.writeInt(u64, dst[8..16], unique, .little);
}

const Attr = struct {
    ino: u64,
    size: u64,
    blocks: u64,
    atime: u64,
    mtime: u64,
    ctime: u64,
    atimensec: u32,
    mtimensec: u32,
    ctimensec: u32,
    mode: u32,
    nlink: u32,
    uid: u32,
    gid: u32,
    rdev: u32,
    blksize: u32,
    flags: u32,
};

fn write_attr(dst: []u8, a: Attr) void {
    assert(dst.len >= FUSE_ATTR_SIZE);
    std.mem.writeInt(u64, dst[0..8], a.ino, .little);
    std.mem.writeInt(u64, dst[8..16], a.size, .little);
    std.mem.writeInt(u64, dst[16..24], a.blocks, .little);
    std.mem.writeInt(u64, dst[24..32], a.atime, .little);
    std.mem.writeInt(u64, dst[32..40], a.mtime, .little);
    std.mem.writeInt(u64, dst[40..48], a.ctime, .little);
    std.mem.writeInt(u32, dst[48..52], a.atimensec, .little);
    std.mem.writeInt(u32, dst[52..56], a.mtimensec, .little);
    std.mem.writeInt(u32, dst[56..60], a.ctimensec, .little);
    std.mem.writeInt(u32, dst[60..64], a.mode, .little);
    std.mem.writeInt(u32, dst[64..68], a.nlink, .little);
    std.mem.writeInt(u32, dst[68..72], a.uid, .little);
    std.mem.writeInt(u32, dst[72..76], a.gid, .little);
    std.mem.writeInt(u32, dst[76..80], a.rdev, .little);
    std.mem.writeInt(u32, dst[80..84], a.blksize, .little);
    std.mem.writeInt(u32, dst[84..88], a.flags, .little);
}

// --- state --------------------------------------------------------------

const InodeEntry = struct {
    rel_path: []u8,
    nlookup: u64, // u64 max == pinned (root)
};

const NLOOKUP_PINNED: u64 = std.math.maxInt(u64);

const OpenKind = enum { file, dir };

// One open file handle (OPEN/CREATE) or open directory (OPENDIR). A
// `file` entry holds a host fd; a `dir` entry holds the directory's
// children pre-packed as individual `fuse_dirent` buffers, snapshotted
// at OPENDIR time (the JS server did the same — a guest that adds a
// file mid-listing won't see it until it re-opens the dir, which
// matches kernel readdir semantics closely enough).
const OpenEntry = struct {
    kind: OpenKind,
    fd: c_int = -1,
    nodeid: u64 = 0,
    /// Linux open flags the guest passed to OPEN/CREATE, kept so a
    /// snapshot restore can reopen the host fd with the same access
    /// mode (see `State.applyState`). 0 for `dir` handles.
    open_flags: u32 = 0,
    /// Owned by `gpa`; freed on RELEASEDIR and in State.deinit. Each
    /// element is one packed `fuse_dirent` (24-byte header + padded
    /// name). `dir` kind only; null for `file`.
    dir_entries: ?[][]u8 = null,
};

const OpStat = struct {
    count: u64 = 0,
    sum_ns: u64 = 0,
};

/// All handler state for one live mount. Transport-agnostic: it knows
/// nothing about the socket / virtqueue the request frames arrive on.
/// The owning transport (`main.zig`, `virtiofs.zig`) constructs it,
/// pumps frames through `dispatch`, and tears it down.
pub const State = struct {
    gpa: std.mem.Allocator,
    root_abs: []u8,
    mode_rw: bool,
    cache_policy: CachePolicy,

    inodes: std.AutoHashMap(u64, InodeEntry),
    path_index: std.StringHashMap(u64),
    next_inode: u64 = 2,

    handles: std.AutoHashMap(u64, OpenEntry),
    next_handle: u64 = 1,

    profile_enabled: bool = false,
    op_stats: std.AutoHashMap(u32, OpStat),

    stats_path: ?[]const u8 = null,
    bytes_served_on_pages_img: u64 = 0,

    virtqueue_request_count: u64 = 0,
    virtqueue_gather_ns: u64 = 0,
    virtqueue_dispatch_ns: u64 = 0,
    virtqueue_scatter_ns: u64 = 0,
    virtqueue_request_bytes: u64 = 0,
    virtqueue_reply_bytes: u64 = 0,

    // Periodic stats flush bookkeeping. The bench harness reads the
    // stats file before stopping the VM (so the shutdown final-flush
    // is too late). The JS server publishes every 250ms via a setInterval;
    // we approximate that here with a "publish if N ops elapsed or T
    // wall-clock ms have passed" check inside dispatch.
    last_stats_publish_ns: u64 = 0,
    ops_since_last_publish: u32 = 0,

    pub fn init(gpa: std.mem.Allocator, root_abs: []u8, mode_rw: bool) !State {
        assert(root_abs.len > 0);
        return init_with_cache(gpa, root_abs, mode_rw, .cached);
    }

    pub fn init_with_cache(
        gpa: std.mem.Allocator,
        root_abs: []u8,
        mode_rw: bool,
        cache_mode: CacheMode,
    ) !State {
        assert(root_abs.len > 0);
        var inodes = std.AutoHashMap(u64, InodeEntry).init(gpa);
        errdefer inodes.deinit();
        var path_index = std.StringHashMap(u64).init(gpa);
        errdefer path_index.deinit();

        const root_rel = try gpa.dupe(u8, "");
        errdefer gpa.free(root_rel);
        // Root pinned at nodeid=1 with empty rel_path.
        try inodes.put(1, .{
            .rel_path = root_rel,
            .nlookup = NLOOKUP_PINNED,
        });
        try path_index.put(root_rel, 1);
        return .{
            .gpa = gpa,
            .root_abs = root_abs,
            .mode_rw = mode_rw,
            .cache_policy = cache_policy(cache_mode),
            .inodes = inodes,
            .path_index = path_index,
            .handles = std.AutoHashMap(u64, OpenEntry).init(gpa),
            .op_stats = std.AutoHashMap(u32, OpStat).init(gpa),
        };
    }

    pub fn set_cache_mode(self: *State, cache_mode: CacheMode) void {
        assert(self.root_abs.len > 0);
        self.cache_policy = cache_policy(cache_mode);
    }

    pub fn cache_mode_for_test(mode: CacheMode) CachePolicy {
        assert(@sizeOf(CacheMode) > 0);
        return cache_policy(mode);
    }

    pub fn deinit(self: *State) void {
        var it = self.inodes.iterator();
        while (it.next()) |e| self.gpa.free(e.value_ptr.rel_path);
        self.inodes.deinit();
        self.path_index.deinit();

        var hit = self.handles.iterator();
        while (hit.next()) |e| free_handle(self, e.value_ptr);
        self.handles.deinit();

        self.op_stats.deinit();
        self.gpa.free(self.root_abs);
    }

    /// Serialise the host-side FUSE state — the nodeid→path map and the
    /// open file/dir handle table — into a `fuse_state` payload for the
    /// vmstate snapshot. `applyState` is the inverse. Deliberately *not*
    /// captured: `root_abs` (supplied fresh at boot), the host fds
    /// (reopened by path on restore — READ/WRITE are stateless
    /// pread/pwrite, so the fd offset doesn't matter), and the
    /// profiling/stats fields (re-initialised at boot).
    pub fn dump_state(self: *State, gpa: std.mem.Allocator) ![]u8 {
        var b = fuse_state.Builder.init(gpa, self.mode_rw, self.next_inode, self.next_handle);
        errdefer b.deinit();

        var it = self.inodes.iterator();
        while (it.next()) |e| {
            try b.add_inode(e.key_ptr.*, e.value_ptr.nlookup, e.value_ptr.rel_path);
        }
        var hit = self.handles.iterator();
        while (hit.next()) |e| {
            const h = e.value_ptr;
            switch (h.kind) {
                .file => try b.add_file_handle(e.key_ptr.*, h.nodeid, h.open_flags),
                .dir => try b.add_dir_handle(e.key_ptr.*, h.nodeid, h.dir_entries orelse &.{}),
            }
        }
        assert(b.inode_count == self.inodes.count());
        assert(b.handle_count == self.handles.count());

        const out = try b.finish();
        b.deinit();
        return out;
    }

    /// Restore host-side FUSE state captured by `dumpState`, replacing
    /// the fresh-boot maps in place. A malformed payload is rejected by
    /// `fuse_state.decode` *before* any live state is touched. File
    /// handles are reopened by resolving nodeid → rel_path against the
    /// current mount root; a reopen that fails (file removed on the
    /// host since the snapshot) degrades to fd = -1, so the next op on
    /// that handle returns EBADF — fail-soft, never a wedge.
    pub fn apply_state(self: *State, payload: []const u8) !void {
        assert(self.root_abs.len > 0);

        var d = try fuse_state.decode(self.gpa, payload);
        defer d.deinit();

        // The fresh boot pre-seeded nodeid=1; drop every seeded entry
        // before laying the snapshot down, or the restored root record
        // double-allocates and the seed leaks.
        var it = self.inodes.iterator();
        while (it.next()) |e| self.gpa.free(e.value_ptr.rel_path);
        self.inodes.clearRetainingCapacity();
        self.path_index.clearRetainingCapacity();

        var hit = self.handles.iterator();
        while (hit.next()) |e| free_handle(self, e.value_ptr);
        self.handles.clearRetainingCapacity();

        self.mode_rw = d.mode_rw;
        self.next_inode = d.next_inode;
        self.next_handle = d.next_handle;

        for (d.inodes) |rec| {
            const dup = try self.gpa.dupe(u8, rec.path);
            try self.inodes.put(rec.nodeid, .{ .rel_path = dup, .nlookup = rec.nlookup });
            try self.path_index.put(dup, rec.nodeid);
        }
        for (d.handles) |rec| {
            switch (rec.kind) {
                .file => try self.handles.put(rec.handle_id, .{
                    .kind = .file,
                    .fd = self.reopen_handle(rec.nodeid, rec.open_flags),
                    .nodeid = rec.nodeid,
                    .open_flags = rec.open_flags,
                }),
                .dir => {
                    const owned = try self.gpa.alloc([]u8, rec.dir_entries.len);
                    for (owned, rec.dir_entries) |*dst, src| dst.* = try self.gpa.dupe(u8, src);
                    try self.handles.put(rec.handle_id, .{
                        .kind = .dir,
                        .fd = -1,
                        .nodeid = rec.nodeid,
                        .dir_entries = owned,
                    });
                },
            }
        }
    }

    /// Reopen a host fd for a restored file handle. Resolves the
    /// handle's nodeid back to a path under the *current* mount root.
    /// O_TRUNC is masked off (it would wipe the file we're restoring),
    /// and a `:ro` mount is forced down to O_RDONLY. A missing nodeid,
    /// an unresolvable path, or a failed open all yield -1.
    fn reopen_handle(self: *State, nodeid: u64, open_flags: u32) c_int {
        const entry = self.inodes.getPtr(nodeid) orelse return -1;
        var path_buf: [4096]u8 = undefined;
        const abs = build_abs_path(self, entry.rel_path, &path_buf) catch return -1;
        var flags = open_flags & ~LINUX_O_TRUNC;
        if (!self.mode_rw) flags &= ~@as(u32, 0o3); // force O_RDONLY
        return open_host(abs, linux_open_to_host(flags), 0) catch -1;
    }
};

/// Release a handle's owned resources — close the fd for a `file`,
/// free the packed-dirent slices for a `dir`. Idempotent enough: a
/// double-free can't happen because callers `remove()` from the map
/// right after.
fn free_handle(state: *State, e: *OpenEntry) void {
    switch (e.kind) {
        .file => {
            // A `.file` handle never carries dir entries — the two
            // kinds are mutually exclusive by construction (onOpen /
            // onCreate set fd, onOpendir sets dir_entries).
            assert(e.dir_entries == null);
            if (e.fd >= 0) _ = close(e.fd);
        },
        .dir => {
            assert(e.fd == -1);
            if (e.dir_entries) |entries| {
                for (entries) |buf| state.gpa.free(buf);
                state.gpa.free(entries);
            }
        },
    }
}

// --- stats-file I/O -----------------------------------------------------

/// Write exactly `data.len` bytes to `fd`. Used only by
/// `writeStatsAtomic` for the small stats JSON — the request/reply
/// frame I/O lives in the owning transport, not here.
fn write_file_all(fd: c_int, data: []const u8) bool {
    var total: usize = 0;
    while (total < data.len) {
        const n = write(fd, data[total..].ptr, data.len - total);
        if (n > 0) {
            total += @intCast(n);
            continue;
        }
        if (n < 0 and errno() == EINTR) continue;
        return false;
    }
    return true;
}

// --- inode bookkeeping --------------------------------------------------

fn require_inode(state: *State, ino: u64) ?*const InodeEntry {
    return state.inodes.getPtr(ino);
}

fn bind_inode(state: *State, rel_path: []const u8) !u64 {
    // Reuse an existing entry so nlookup accumulates correctly. The
    // path index keeps tar-style create storms off the old O(n) scan.
    if (state.path_index.get(rel_path)) |ino| {
        if (state.inodes.getPtr(ino)) |entry| {
            if (entry.nlookup != NLOOKUP_PINNED) {
                entry.nlookup += 1;
            }
            return ino;
        }
        _ = state.path_index.remove(rel_path);
    }

    const ino = state.next_inode;
    state.next_inode += 1;
    const dup = try state.gpa.dupe(u8, rel_path);
    errdefer state.gpa.free(dup);
    try state.inodes.put(ino, .{ .rel_path = dup, .nlookup = 1 });
    errdefer _ = state.inodes.remove(ino);
    try state.path_index.put(dup, ino);
    return ino;
}

fn decref_inode(state: *State, ino: u64, n: u64) void {
    const e = state.inodes.getPtr(ino) orelse return;
    if (e.nlookup == NLOOKUP_PINNED) return; // root pinned
    if (n >= e.nlookup) {
        // Drop the entry; free its owned path before remove() invalidates the value pointer.
        const path_to_free = e.rel_path;
        _ = state.path_index.remove(path_to_free);
        _ = state.inodes.remove(ino);
        state.gpa.free(path_to_free);
    } else {
        e.nlookup -= n;
    }
}

// --- path resolution (lexical containment) -----------------------------

/// Build the absolute host path for `rel_path` under `state.root_abs`,
/// writing into `out`. Returns the slice into `out` on success.
/// Containment is lexical: `rel_path` is trusted to be a "/"-separated
/// POSIX path with no `..`, `.`, leading `/`, or NUL bytes — every
/// site that puts a path into the inode table goes through
/// `validateName` first.
fn build_abs_path(state: *State, rel_path: []const u8, out: []u8) ![]u8 {
    if (rel_path.len == 0) {
        if (state.root_abs.len > out.len) return error.PathTooLong;
        @memcpy(out[0..state.root_abs.len], state.root_abs);
        return out[0..state.root_abs.len];
    }
    const need = state.root_abs.len + 1 + rel_path.len;
    if (need > out.len) return error.PathTooLong;
    @memcpy(out[0..state.root_abs.len], state.root_abs);
    out[state.root_abs.len] = '/';
    @memcpy(out[state.root_abs.len + 1 ..][0..rel_path.len], rel_path);
    return out[0..need];
}

fn validate_name(name: []const u8) !void {
    if (name.len == 0) return error.InvalidName;
    if (std.mem.eql(u8, name, ".")) return error.InvalidName;
    if (std.mem.eql(u8, name, "..")) return error.InvalidName;
    for (name) |c| {
        if (c == '/' or c == 0) return error.InvalidName;
    }
}

fn join_rel(gpa: std.mem.Allocator, parent_rel: []const u8, name: []const u8) ![]u8 {
    if (parent_rel.len == 0) return try gpa.dupe(u8, name);
    var buf = try gpa.alloc(u8, parent_rel.len + 1 + name.len);
    @memcpy(buf[0..parent_rel.len], parent_rel);
    buf[parent_rel.len] = '/';
    @memcpy(buf[parent_rel.len + 1 ..], name);
    return buf;
}

// --- dispatch -----------------------------------------------------------

/// Handle one decoded FUSE request frame and return its reply frame.
///
/// `msg` is the contiguous request — in-header + payload — exactly as
/// the transport read it. The returned slice is the reply — out-header
/// + payload — allocated with `state.gpa`; the caller writes it to its
/// transport and frees it. `null` means "no reply" (FORGET, INTERRUPT):
/// the FUSE protocol forbids a reply for those opcodes.
///
/// Precondition: `msg.len >= FUSE_IN_HEADER_SIZE`. Every transport
/// rejects a short frame before calling here, so each handler can
/// slice `msg[FUSE_IN_HEADER_SIZE..]` freely.
pub fn dispatch(state: *State, msg: []const u8) !?[]const u8 {
    assert(msg.len >= FUSE_IN_HEADER_SIZE);

    const hdr = read_in_header(msg);
    const start_ns: u64 = if (state.profile_enabled) now_ns() else 0;

    const op_e: Op = @enumFromInt(hdr.opcode);
    const reply_opt: ?[]const u8 = blk: {
        switch (op_e) {
            .INIT => break :blk try on_init(state, hdr, msg),
            .DESTROY => break :blk try build_error_reply(state, hdr.unique, 0),
            .INTERRUPT => break :blk null, // no reply ever
            .FORGET => {
                on_forget(state, hdr, msg);
                break :blk null;
            },
            .BATCH_FORGET => {
                on_batch_forget(state, msg);
                break :blk null;
            },
            .LOOKUP => break :blk try on_lookup(state, hdr, msg),
            .GETATTR => break :blk try on_getattr(state, hdr),
            .READLINK => break :blk try on_readlink(state, hdr),
            .CREATE => break :blk try on_create(state, hdr, msg),
            .WRITE => break :blk try on_write(state, hdr, msg),
            .RELEASE => break :blk try on_release(state, hdr, msg),
            .OPEN => break :blk try on_open(state, hdr, msg),
            .READ => break :blk try on_read(state, hdr, msg),
            .OPENDIR => break :blk try on_opendir(state, hdr),
            .READDIR => break :blk try on_readdir(state, hdr, msg),
            .RELEASEDIR => break :blk try on_releasedir(state, hdr, msg),
            .MKDIR => break :blk try on_mkdir(state, hdr, msg),
            .UNLINK => break :blk try on_unlink(state, hdr, msg),
            .RMDIR => break :blk try on_rmdir(state, hdr, msg),
            .RENAME => break :blk try on_rename(state, hdr, msg),
            .LINK => break :blk try on_link(state, hdr, msg),
            .SYMLINK => break :blk try on_symlink(state, hdr, msg),
            .SETATTR => break :blk try on_setattr(state, hdr, msg),
            .STATFS => break :blk try on_statfs(state, hdr),
            // Soft-success: the guest can ask, we just say "ok". tar
            // calls FSYNC after writing each file; the host fs already
            // ack'd the write so this is durable enough for the bench.
            // FLUSH/ACCESS/FSYNCDIR are likewise userspace-OK-to-ignore.
            .FSYNC, .FSYNCDIR, .FLUSH, .ACCESS => break :blk try build_error_reply(state, hdr.unique, 0),
            else => break :blk try build_error_reply(state, hdr.unique, -E.NOSYS),
        }
    };

    if (state.profile_enabled) {
        const end_ns = now_ns();
        const gop = try state.op_stats.getOrPut(hdr.opcode);
        if (!gop.found_existing) gop.value_ptr.* = .{};
        gop.value_ptr.count += 1;
        gop.value_ptr.sum_ns += end_ns - start_ns;

        state.ops_since_last_publish += 1;
        // Publish on a quasi-250ms cadence — checked every 256 ops to
        // bound the clock_gettime overhead at <1% of dispatch cost.
        // 250ms matches the JS server's setInterval rhythm and is what
        // the bench reads against. Inline; single-threaded so safe.
        if (state.ops_since_last_publish >= 256 and
            end_ns -% state.last_stats_publish_ns > 250 * std.time.ns_per_ms)
        {
            write_stats_atomic(state);
            state.last_stats_publish_ns = end_ns;
            state.ops_since_last_publish = 0;
        }
    }

    return reply_opt;
}

// --- response builders --------------------------------------------------

// Runtime allocation policy: each FUSE handler returns one owned reply
// frame and the virtio-fs transport frees it after writing the used
// descriptor. Reply sizes depend on guest-provided names, directory
// listings, and read lengths, so per-reply allocation is intentional;
// the TigerStyle guardrail tracks this debt so it cannot grow quietly.
fn build_error_reply(state: *State, unique: u64, err: i32) ![]u8 {
    // FUSE convention: a negative errno, or 0 for a success-with-no-
    // payload ack. A positive errno would corrupt the kernel's view.
    assert(err <= 0);
    const buf = try state.gpa.alloc(u8, FUSE_OUT_HEADER_SIZE);
    write_out_header(buf, 0, err, unique);
    return buf;
}

fn build_reply(state: *State, unique: u64, payload: []const u8) ![]u8 {
    // The whole reply (header + payload) rides one FUSE frame whose
    // length is a u32; in practice nothing we build approaches that,
    // but assert it so a future op that returns a huge payload trips
    // here instead of silently truncating in writeOutHeader's @intCast.
    assert(FUSE_OUT_HEADER_SIZE + payload.len <= std.math.maxInt(u32));
    const buf = try state.gpa.alloc(u8, FUSE_OUT_HEADER_SIZE + payload.len);
    write_out_header(buf, payload.len, 0, unique);
    @memcpy(buf[FUSE_OUT_HEADER_SIZE..], payload);
    return buf;
}

// --- INIT ---------------------------------------------------------------

fn on_init(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return try build_error_reply(state, hdr.unique, -E.INVAL);

    const major = std.mem.readInt(u32, body[0..4], .little);
    const minor = std.mem.readInt(u32, body[4..8], .little);
    const max_readahead: u32 = if (body.len >= 16) std.mem.readInt(u32, body[8..12], .little) else 0;
    const flags_in: u32 = if (body.len >= 16) std.mem.readInt(u32, body[12..16], .little) else 0;

    _ = major;
    const supported_flags = FUSE_CAP_ASYNC_READ |
        FUSE_CAP_BIG_WRITES |
        FUSE_CAP_EXPORT_SUPPORT |
        FUSE_CAP_MAX_PAGES |
        FUSE_CAP_PARALLEL_DIROPS |
        FUSE_CAP_WRITEBACK_CACHE;
    const flags_out = flags_in & supported_flags;
    const out_minor: u32 = @min(minor, FUSE_KERNEL_MINOR_VERSION);

    var payload: [FUSE_INIT_OUT_SIZE]u8 = @splat(0);
    std.mem.writeInt(u32, payload[0..4], FUSE_KERNEL_VERSION, .little);
    std.mem.writeInt(u32, payload[4..8], out_minor, .little);
    std.mem.writeInt(u32, payload[8..12], max_readahead, .little);
    std.mem.writeInt(u32, payload[12..16], flags_out, .little);
    std.mem.writeInt(u16, payload[16..18], 16, .little); // max_background
    std.mem.writeInt(u16, payload[18..20], 12, .little); // congestion_threshold
    std.mem.writeInt(u32, payload[20..24], 131072, .little); // max_write
    std.mem.writeInt(u32, payload[24..28], 1, .little); // time_gran
    std.mem.writeInt(u16, payload[28..30], 32, .little); // max_pages
    std.mem.writeInt(u16, payload[30..32], 0, .little); // map_alignment
    std.mem.writeInt(u32, payload[32..36], 0, .little); // flags2
    // unused[7] already zero
    return try build_reply(state, hdr.unique, &payload);
}

// --- FORGET / BATCH_FORGET ----------------------------------------------

fn on_forget(state: *State, hdr: InHeader, msg: []const u8) void {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return;
    const nlookup = std.mem.readInt(u64, body[0..8], .little);
    decref_inode(state, hdr.nodeid, nlookup);
}

fn on_batch_forget(state: *State, msg: []const u8) void {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return;
    const count = std.mem.readInt(u32, body[0..4], .little);
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const off = 8 + i * 16;
        if (off + 16 > body.len) return;
        const nodeid = std.mem.readInt(u64, body[off..][0..8], .little);
        const nlookup = std.mem.readInt(u64, body[off + 8 ..][0..8], .little);
        decref_inode(state, nodeid, nlookup);
    }
}

// --- LOOKUP -------------------------------------------------------------

fn on_lookup(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    const name = decode_name(body);
    validate_name(name) catch return try build_error_reply(state, hdr.unique, -E.INVAL);

    const parent = require_inode(state, hdr.nodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);

    // Compose the child's rel path off the parent's rel path. Parent
    // rel path was validated when its inode was bound.
    const child_rel = try join_rel(state.gpa, parent.rel_path, name);
    defer state.gpa.free(child_rel);

    var path_buf: [4096]u8 = undefined;
    const abs = build_abs_path(state, child_rel, &path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);

    var st = std.mem.zeroes(Stat);
    host_lstat(abs, &st) catch |e| return try build_error_reply(state, hdr.unique, map_fs_error(e));

    const ino = try bind_inode(state, child_rel);

    var payload: [FUSE_ENTRY_OUT_SIZE]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], ino, .little);
    std.mem.writeInt(u64, payload[8..16], 0, .little); // generation
    std.mem.writeInt(u64, payload[16..24], state.cache_policy.entry_valid_sec, .little);
    std.mem.writeInt(u64, payload[24..32], state.cache_policy.attr_valid_sec, .little);
    std.mem.writeInt(u32, payload[32..36], state.cache_policy.entry_valid_nsec, .little);
    std.mem.writeInt(u32, payload[36..40], state.cache_policy.attr_valid_nsec, .little);
    write_attr(payload[40..128], stat_to_attr(st, ino));
    return try build_reply(state, hdr.unique, &payload);
}

// --- GETATTR / READLINK -------------------------------------------------

fn on_getattr(state: *State, hdr: InHeader) ![]u8 {
    const entry = require_inode(state, hdr.nodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);

    var path_buf: [4096]u8 = undefined;
    const abs = build_abs_path(state, entry.rel_path, &path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);

    var st = std.mem.zeroes(Stat);
    host_lstat(abs, &st) catch |e| return try build_error_reply(state, hdr.unique, map_fs_error(e));

    var payload: [FUSE_ATTR_OUT_SIZE]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], state.cache_policy.attr_valid_sec, .little);
    std.mem.writeInt(u32, payload[8..12], state.cache_policy.attr_valid_nsec, .little);
    // dummy at offset 12
    write_attr(payload[16..104], stat_to_attr(st, hdr.nodeid));
    return try build_reply(state, hdr.unique, &payload);
}

fn on_readlink(state: *State, hdr: InHeader) ![]u8 {
    const entry = require_inode(state, hdr.nodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);

    var path_buf: [4096]u8 = undefined;
    const abs = build_abs_path(state, entry.rel_path, &path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);

    var path_z: [4097]u8 = undefined;
    if (abs.len >= path_z.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
    @memcpy(path_z[0..abs.len], abs);
    path_z[abs.len] = 0;

    var target: [4096]u8 = undefined;
    const n = readlink(@ptrCast(&path_z), target[0..].ptr, target.len);
    if (n < 0) {
        return try build_error_reply(state, hdr.unique, map_fs_error(errno_to_zig_error(errno())));
    }
    return try build_reply(state, hdr.unique, target[0..@intCast(n)]);
}

// --- CREATE -------------------------------------------------------------

fn on_create(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    assert(hdr.opcode == @intFromEnum(Op.CREATE));
    assert(msg.len >= FUSE_IN_HEADER_SIZE);

    if (!state.mode_rw) return try build_error_reply(state, hdr.unique, -E.ROFS);

    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < FUSE_CREATE_IN_SIZE) return try build_error_reply(state, hdr.unique, -E.INVAL);

    const flags = std.mem.readInt(u32, body[0..4], .little);
    const mode = std.mem.readInt(u32, body[4..8], .little);
    // umask at offset 8, open_flags at offset 12 — we don't need them
    // currently (the kernel pre-applies umask before sending us
    // CREATE since we don't advertise FUSE_DONT_MASK).

    const name = decode_name(body[FUSE_CREATE_IN_SIZE..]);
    validate_name(name) catch return try build_error_reply(state, hdr.unique, -E.INVAL);

    const parent = require_inode(state, hdr.nodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);

    const child_rel = try join_rel(state.gpa, parent.rel_path, name);
    errdefer state.gpa.free(child_rel);

    var path_buf: [4096]u8 = undefined;
    const abs = build_abs_path(state, child_rel, &path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);

    const host_flags = linux_open_to_host(flags) | O_CREAT;
    const fd = open_host(abs, host_flags, @intCast(mode & 0o7777)) catch |e|
        return try build_error_reply(state, hdr.unique, map_fs_error(e));

    var st = std.mem.zeroes(Stat);
    host_fstat(fd, &st) catch |e| {
        _ = close(fd);
        return try build_error_reply(state, hdr.unique, map_fs_error(e));
    };

    const ino = try bind_inode(state, child_rel);
    state.gpa.free(child_rel); // bindInode took its own copy

    const id = state.next_handle;
    state.next_handle += 1;
    try state.handles.put(id, .{ .kind = .file, .fd = fd, .nodeid = ino, .open_flags = flags });

    // CREATE reply: entry_out (128) + open_out (16).
    var payload: [FUSE_ENTRY_OUT_SIZE + 16]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], ino, .little);
    std.mem.writeInt(u64, payload[8..16], 0, .little); // generation
    std.mem.writeInt(u64, payload[16..24], state.cache_policy.entry_valid_sec, .little);
    std.mem.writeInt(u64, payload[24..32], state.cache_policy.attr_valid_sec, .little);
    std.mem.writeInt(u32, payload[32..36], state.cache_policy.entry_valid_nsec, .little);
    std.mem.writeInt(u32, payload[36..40], state.cache_policy.attr_valid_nsec, .little);
    write_attr(payload[40..128], stat_to_attr(st, ino));
    std.mem.writeInt(u64, payload[128..136], id, .little); // fh
    std.mem.writeInt(u32, payload[136..140], 0, .little); // open_flags
    // padding at 140
    return try build_reply(state, hdr.unique, &payload);
}

// --- WRITE --------------------------------------------------------------

fn on_write(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    if (!state.mode_rw) return try build_error_reply(state, hdr.unique, -E.ROFS);

    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < FUSE_WRITE_IN_SIZE) return try build_error_reply(state, hdr.unique, -E.INVAL);

    const fh = std.mem.readInt(u64, body[0..8], .little);
    const offset = std.mem.readInt(u64, body[8..16], .little);
    const size = std.mem.readInt(u32, body[16..20], .little);
    // write_flags at 20, lock_owner at 24, flags at 32

    const data_start = FUSE_WRITE_IN_SIZE;
    if (data_start + size > body.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
    const data = body[data_start..][0..size];

    const handle = state.handles.get(fh) orelse
        return try build_error_reply(state, hdr.unique, -E.BADF);
    if (handle.kind != .file) return try build_error_reply(state, hdr.unique, -E.BADF);
    // fd < 0 means a snapshot restore couldn't reopen this handle's
    // backing file (it was removed on the host since the snapshot).
    // An invalid descriptor is EBADF — fail-soft, never a wedge.
    if (handle.fd < 0) return try build_error_reply(state, hdr.unique, -E.BADF);

    const written = pwrite_all(handle.fd, data, offset) catch |e|
        return try build_error_reply(state, hdr.unique, map_fs_error(e));

    var payload: [8]u8 = @splat(0);
    std.mem.writeInt(u32, payload[0..4], @intCast(written), .little);
    // padding at 4
    return try build_reply(state, hdr.unique, &payload);
}

// --- OPEN ---------------------------------------------------------------

fn on_open(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return try build_error_reply(state, hdr.unique, -E.INVAL);
    const flags = std.mem.readInt(u32, body[0..4], .little);

    const access = flags & 0o3;
    if ((access == LINUX_O_WRONLY or access == LINUX_O_RDWR) and !state.mode_rw) {
        return try build_error_reply(state, hdr.unique, -E.ROFS);
    }

    const entry = require_inode(state, hdr.nodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);

    var path_buf: [4096]u8 = undefined;
    const abs = build_abs_path(state, entry.rel_path, &path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);

    const fd = open_host(abs, linux_open_to_host(flags), 0) catch |e|
        return try build_error_reply(state, hdr.unique, map_fs_error(e));

    const id = state.next_handle;
    state.next_handle += 1;
    try state.handles.put(id, .{ .kind = .file, .fd = fd, .nodeid = hdr.nodeid, .open_flags = flags });

    var payload: [16]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], id, .little); // fh
    std.mem.writeInt(u32, payload[8..12], 0, .little); // open_flags
    // padding at 12
    return try build_reply(state, hdr.unique, &payload);
}

// --- READ ---------------------------------------------------------------

fn on_read(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 32) return try build_error_reply(state, hdr.unique, -E.INVAL);
    const fh = std.mem.readInt(u64, body[0..8], .little);
    const offset = std.mem.readInt(u64, body[8..16], .little);
    const size = std.mem.readInt(u32, body[16..20], .little);

    const handle = state.handles.get(fh) orelse
        return try build_error_reply(state, hdr.unique, -E.BADF);
    if (handle.kind != .file) return try build_error_reply(state, hdr.unique, -E.BADF);
    // fd < 0 means a snapshot restore couldn't reopen this handle's
    // backing file (it was removed on the host since the snapshot).
    // An invalid descriptor is EBADF — fail-soft, never a wedge.
    if (handle.fd < 0) return try build_error_reply(state, hdr.unique, -E.BADF);

    const buf = try state.gpa.alloc(u8, FUSE_OUT_HEADER_SIZE + size);
    errdefer state.gpa.free(buf);
    const n = pread(handle.fd, buf[FUSE_OUT_HEADER_SIZE..].ptr, size, @intCast(offset));
    if (n < 0) {
        state.gpa.free(buf);
        return try build_error_reply(state, hdr.unique, map_fs_error(errno_to_zig_error(errno())));
    }
    const got: usize = @intCast(n);
    write_out_header(buf[0..FUSE_OUT_HEADER_SIZE], got, 0, hdr.unique);
    // Resize the over-allocated buffer down to (header + got). Use a
    // shrinkAndFree so a partial read doesn't ship trailing garbage.
    return state.gpa.realloc(buf, FUSE_OUT_HEADER_SIZE + got) catch {
        // realloc failure is fine — keep the original buffer and just
        // truncate the visible length via writeOutHeader's len field.
        const slice = buf[0 .. FUSE_OUT_HEADER_SIZE + got];
        return slice;
    };
}

// --- MKDIR --------------------------------------------------------------

fn on_mkdir(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    assert(hdr.opcode == @intFromEnum(Op.MKDIR));
    assert(msg.len >= FUSE_IN_HEADER_SIZE);

    if (!state.mode_rw) return try build_error_reply(state, hdr.unique, -E.ROFS);

    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return try build_error_reply(state, hdr.unique, -E.INVAL);
    const mode = std.mem.readInt(u32, body[0..4], .little);
    // umask at offset 4

    const name = decode_name(body[8..]);
    validate_name(name) catch return try build_error_reply(state, hdr.unique, -E.INVAL);

    const parent = require_inode(state, hdr.nodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);

    const child_rel = try join_rel(state.gpa, parent.rel_path, name);
    errdefer state.gpa.free(child_rel);

    var path_buf: [4096]u8 = undefined;
    const abs = build_abs_path(state, child_rel, &path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);

    var path_z: [4097]u8 = undefined;
    if (abs.len >= path_z.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
    @memcpy(path_z[0..abs.len], abs);
    path_z[abs.len] = 0;
    if (mkdir(@ptrCast(&path_z), @intCast(mode & 0o7777)) != 0) {
        return try build_error_reply(state, hdr.unique, map_fs_error(errno_to_zig_error(errno())));
    }

    var st = std.mem.zeroes(Stat);
    host_lstat(abs, &st) catch |e| return try build_error_reply(state, hdr.unique, map_fs_error(e));

    const ino = try bind_inode(state, child_rel);
    state.gpa.free(child_rel);

    var payload: [FUSE_ENTRY_OUT_SIZE]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], ino, .little);
    std.mem.writeInt(u64, payload[8..16], 0, .little);
    std.mem.writeInt(u64, payload[16..24], state.cache_policy.entry_valid_sec, .little);
    std.mem.writeInt(u64, payload[24..32], state.cache_policy.attr_valid_sec, .little);
    std.mem.writeInt(u32, payload[32..36], state.cache_policy.entry_valid_nsec, .little);
    std.mem.writeInt(u32, payload[36..40], state.cache_policy.attr_valid_nsec, .little);
    write_attr(payload[40..128], stat_to_attr(st, ino));
    return try build_reply(state, hdr.unique, &payload);
}

// --- UNLINK / RMDIR / LINK / RENAME / SYMLINK ---------------------------

fn unlink_or_rmdir(
    state: *State,
    hdr: InHeader,
    msg: []const u8,
    is_rmdir: bool,
) ![]u8 {
    if (!state.mode_rw) return try build_error_reply(state, hdr.unique, -E.ROFS);
    const body = msg[FUSE_IN_HEADER_SIZE..];
    const name = decode_name(body);
    validate_name(name) catch return try build_error_reply(state, hdr.unique, -E.INVAL);

    const parent = require_inode(state, hdr.nodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);

    const child_rel = try join_rel(state.gpa, parent.rel_path, name);
    defer state.gpa.free(child_rel);

    var path_buf: [4096]u8 = undefined;
    const abs = build_abs_path(state, child_rel, &path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);

    var path_z: [4097]u8 = undefined;
    if (abs.len >= path_z.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
    @memcpy(path_z[0..abs.len], abs);
    path_z[abs.len] = 0;

    const rc = if (is_rmdir) rmdir(@ptrCast(&path_z)) else unlink(@ptrCast(&path_z));
    if (rc != 0) {
        return try build_error_reply(state, hdr.unique, map_fs_error(errno_to_zig_error(errno())));
    }
    return try build_error_reply(state, hdr.unique, 0);
}

fn on_unlink(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    return unlink_or_rmdir(state, hdr, msg, false);
}

fn on_rmdir(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    return unlink_or_rmdir(state, hdr, msg, true);
}

fn on_link(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    assert(hdr.opcode == @intFromEnum(Op.LINK));
    assert(msg.len >= FUSE_IN_HEADER_SIZE);

    if (!state.mode_rw) return try build_error_reply(state, hdr.unique, -E.ROFS);

    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return try build_error_reply(state, hdr.unique, -E.INVAL);
    const oldnodeid = std.mem.readInt(u64, body[0..8], .little);
    const name = decode_name(body[8..]);
    validate_name(name) catch return try build_error_reply(state, hdr.unique, -E.INVAL);

    const old_entry = require_inode(state, oldnodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);
    const new_parent = require_inode(state, hdr.nodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);

    const new_rel = try join_rel(state.gpa, new_parent.rel_path, name);
    defer state.gpa.free(new_rel);

    var old_path_buf: [4096]u8 = undefined;
    const old_abs = build_abs_path(state, old_entry.rel_path, &old_path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);
    var new_path_buf: [4096]u8 = undefined;
    const new_abs = build_abs_path(state, new_rel, &new_path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);

    var old_z: [4097]u8 = undefined;
    if (old_abs.len >= old_z.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
    @memcpy(old_z[0..old_abs.len], old_abs);
    old_z[old_abs.len] = 0;
    var new_z: [4097]u8 = undefined;
    if (new_abs.len >= new_z.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
    @memcpy(new_z[0..new_abs.len], new_abs);
    new_z[new_abs.len] = 0;

    if (link(@ptrCast(&old_z), @ptrCast(&new_z)) != 0) {
        return try build_error_reply(state, hdr.unique, map_fs_error(errno_to_zig_error(errno())));
    }

    var st = std.mem.zeroes(Stat);
    host_lstat(new_abs, &st) catch |e| return try build_error_reply(state, hdr.unique, map_fs_error(e));

    // FUSE hardlinks must point at the same nodeid so the guest sees
    // shared size/nlink updates through either path. Our inode table is
    // path-bound, so keep that shared nodeid usable after the original
    // name is unlinked by retargeting it to the newest linked path.
    // (A future alias table can model both names at once; this covers
    // the common pnpm/workspace case and unlink-one-keeps-other.)
    const replacement = try state.gpa.dupe(u8, new_rel);
    if (state.inodes.getPtr(oldnodeid)) |entry| {
        state.gpa.free(entry.rel_path);
        entry.rel_path = replacement;
        if (entry.nlookup != NLOOKUP_PINNED) entry.nlookup += 1;
    } else {
        state.gpa.free(replacement);
        return try build_error_reply(state, hdr.unique, -E.STALE);
    }
    const ino = oldnodeid;

    var payload: [FUSE_ENTRY_OUT_SIZE]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], ino, .little);
    std.mem.writeInt(u64, payload[8..16], 0, .little);
    std.mem.writeInt(u64, payload[16..24], state.cache_policy.entry_valid_sec, .little);
    std.mem.writeInt(u64, payload[24..32], state.cache_policy.attr_valid_sec, .little);
    std.mem.writeInt(u32, payload[32..36], state.cache_policy.entry_valid_nsec, .little);
    std.mem.writeInt(u32, payload[36..40], state.cache_policy.attr_valid_nsec, .little);
    write_attr(payload[40..128], stat_to_attr(st, ino));
    return try build_reply(state, hdr.unique, &payload);
}

fn on_rename(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    assert(hdr.opcode == @intFromEnum(Op.RENAME));
    assert(msg.len >= FUSE_IN_HEADER_SIZE);

    if (!state.mode_rw) return try build_error_reply(state, hdr.unique, -E.ROFS);

    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return try build_error_reply(state, hdr.unique, -E.INVAL);
    const newdir = std.mem.readInt(u64, body[0..8], .little);
    const names = body[8..];
    const old_nul = std.mem.indexOfScalar(u8, names, 0) orelse
        return try build_error_reply(state, hdr.unique, -E.INVAL);
    const old_name = names[0..old_nul];
    validate_name(old_name) catch return try build_error_reply(state, hdr.unique, -E.INVAL);

    const rest = names[old_nul + 1 ..];
    const new_nul = std.mem.indexOfScalar(u8, rest, 0) orelse rest.len;
    const new_name = rest[0..new_nul];
    validate_name(new_name) catch return try build_error_reply(state, hdr.unique, -E.INVAL);

    const old_parent = require_inode(state, hdr.nodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);
    const new_parent = require_inode(state, newdir) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);

    const old_rel = try join_rel(state.gpa, old_parent.rel_path, old_name);
    defer state.gpa.free(old_rel);
    const new_rel = try join_rel(state.gpa, new_parent.rel_path, new_name);
    defer state.gpa.free(new_rel);

    var old_path_buf: [4096]u8 = undefined;
    const old_abs = build_abs_path(state, old_rel, &old_path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);
    var new_path_buf: [4096]u8 = undefined;
    const new_abs = build_abs_path(state, new_rel, &new_path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);

    var old_z: [4097]u8 = undefined;
    if (old_abs.len >= old_z.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
    @memcpy(old_z[0..old_abs.len], old_abs);
    old_z[old_abs.len] = 0;
    var new_z: [4097]u8 = undefined;
    if (new_abs.len >= new_z.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
    @memcpy(new_z[0..new_abs.len], new_abs);
    new_z[new_abs.len] = 0;

    if (rename(@ptrCast(&old_z), @ptrCast(&new_z)) != 0) {
        return try build_error_reply(state, hdr.unique, map_fs_error(errno_to_zig_error(errno())));
    }

    // Keep any already-bound source inode usable after a successful
    // rename. Destination dentries are left path-bound; if the guest
    // had looked one up before replacement, that nodeid still resolves
    // the destination path, which now contains the renamed bytes.
    // Descendant rewrites are only needed for directory renames; file
    // renames are the hot metadata-microbench path and can avoid a
    // full inode-table scan.
    var renamed_st = std.mem.zeroes(Stat);
    const renamed_is_dir = if (host_lstat(new_abs, &renamed_st))
        (renamed_st.mode & 0o170000) == 0o040000
    else |_|
        true;
    update_bound_inodes_after_rename(state, old_rel, new_rel, renamed_is_dir) catch
        return try build_error_reply(state, hdr.unique, -E.IO);
    return try build_error_reply(state, hdr.unique, 0);
}

fn on_symlink(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    assert(hdr.opcode == @intFromEnum(Op.SYMLINK));
    assert(msg.len >= FUSE_IN_HEADER_SIZE);

    if (!state.mode_rw) return try build_error_reply(state, hdr.unique, -E.ROFS);

    // Wire format: two NUL-terminated strings, name then target. No
    // fixed-size struct prefix.
    const body = msg[FUSE_IN_HEADER_SIZE..];
    const first_nul = std.mem.indexOfScalar(u8, body, 0) orelse
        return try build_error_reply(state, hdr.unique, -E.INVAL);
    const name = body[0..first_nul];
    validate_name(name) catch return try build_error_reply(state, hdr.unique, -E.INVAL);

    const rest = body[first_nul + 1 ..];
    const target_end = std.mem.indexOfScalar(u8, rest, 0) orelse rest.len;
    const target = rest[0..target_end];
    if (target.len == 0) return try build_error_reply(state, hdr.unique, -E.INVAL);

    const parent = require_inode(state, hdr.nodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);

    const child_rel = try join_rel(state.gpa, parent.rel_path, name);
    errdefer state.gpa.free(child_rel);

    var path_buf: [4096]u8 = undefined;
    const abs = build_abs_path(state, child_rel, &path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);

    var link_z: [4097]u8 = undefined;
    if (abs.len >= link_z.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
    @memcpy(link_z[0..abs.len], abs);
    link_z[abs.len] = 0;

    var tgt_z: [4097]u8 = undefined;
    if (target.len >= tgt_z.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
    @memcpy(tgt_z[0..target.len], target);
    tgt_z[target.len] = 0;

    if (symlink(@ptrCast(&tgt_z), @ptrCast(&link_z)) != 0) {
        return try build_error_reply(state, hdr.unique, map_fs_error(errno_to_zig_error(errno())));
    }

    var st = std.mem.zeroes(Stat);
    host_lstat(abs, &st) catch |e| return try build_error_reply(state, hdr.unique, map_fs_error(e));

    const ino = try bind_inode(state, child_rel);
    state.gpa.free(child_rel);

    var payload: [FUSE_ENTRY_OUT_SIZE]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], ino, .little);
    std.mem.writeInt(u64, payload[8..16], 0, .little);
    std.mem.writeInt(u64, payload[16..24], state.cache_policy.entry_valid_sec, .little);
    std.mem.writeInt(u64, payload[24..32], state.cache_policy.attr_valid_sec, .little);
    std.mem.writeInt(u32, payload[32..36], state.cache_policy.entry_valid_nsec, .little);
    std.mem.writeInt(u32, payload[36..40], state.cache_policy.attr_valid_nsec, .little);
    write_attr(payload[40..128], stat_to_attr(st, ino));
    return try build_reply(state, hdr.unique, &payload);
}

// --- SETATTR ------------------------------------------------------------

// Minimal SETATTR: apply the attributes that common live-mount
// workflows depend on. Size changes cover `: > file`, O_TRUNC, and
// writeback-cache dirty-page flushes. Mode changes cover chmod +x
// followed by execve from the mounted tree. Owner/time changes are
// still acknowledged without a host syscall; the guest kernel caches
// them well enough for today's workloads, and we can harden them when
// a real caller needs host-visible persistence.
fn on_setattr(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    assert(hdr.opcode == @intFromEnum(Op.SETATTR));
    assert(msg.len >= FUSE_IN_HEADER_SIZE);

    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return try build_error_reply(state, hdr.unique, -E.INVAL);
    const valid = std.mem.readInt(u32, body[0..4], .little);

    // FATTR bits 0..8 (MODE / UID / GID / SIZE / ATIME / MTIME / FH /
    // ATIME_NOW / MTIME_NOW) — anything in there is "mutating" for
    // EROFS purposes. FATTR_FH alone is not mutating; it just says the
    // request carries a file handle.
    const mutating_mask: u32 = FATTR_MODE | FATTR_UID | FATTR_GID | FATTR_SIZE |
        FATTR_ATIME | FATTR_MTIME | FATTR_ATIME_NOW | FATTR_MTIME_NOW;
    if (!state.mode_rw and (valid & mutating_mask) != 0) {
        return try build_error_reply(state, hdr.unique, -E.ROFS);
    }

    const entry = require_inode(state, hdr.nodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);

    var path_buf: [4096]u8 = undefined;
    const abs = build_abs_path(state, entry.rel_path, &path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);

    if ((valid & FATTR_SIZE) != 0) {
        if (body.len < 24) return try build_error_reply(state, hdr.unique, -E.INVAL);
        const size = std.mem.readInt(u64, body[16..24], .little);
        if (size > @as(u64, @intCast(std.math.maxInt(i64)))) {
            return try build_error_reply(state, hdr.unique, -E.INVAL);
        }

        var truncated = false;
        if ((valid & FATTR_FH) != 0) {
            const fh = std.mem.readInt(u64, body[8..16], .little);
            if (state.handles.get(fh)) |handle| {
                if (handle.kind != .file or handle.fd < 0) return try build_error_reply(state, hdr.unique, -E.BADF);
                if (ftruncate(handle.fd, @intCast(size)) != 0) {
                    return try build_error_reply(state, hdr.unique, map_fs_error(errno_to_zig_error(errno())));
                }
                truncated = true;
            } else {
                return try build_error_reply(state, hdr.unique, -E.BADF);
            }
        }
        if (!truncated) {
            var path_z: [4097]u8 = undefined;
            if (abs.len >= path_z.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
            @memcpy(path_z[0..abs.len], abs);
            path_z[abs.len] = 0;
            if (truncate(@ptrCast(&path_z), @intCast(size)) != 0) {
                return try build_error_reply(state, hdr.unique, map_fs_error(errno_to_zig_error(errno())));
            }
        }
    }

    if ((valid & FATTR_MODE) != 0) {
        // fuse_setattr_in.mode sits at byte 68. Only permission/sticky
        // bits are accepted by chmod/fchmod; the file-type bits come
        // back from the host lstat below.
        if (body.len < 72) return try build_error_reply(state, hdr.unique, -E.INVAL);
        const mode = std.mem.readInt(u32, body[68..72], .little) & 0o7777;

        var chmodded = false;
        if ((valid & FATTR_FH) != 0) {
            const fh = std.mem.readInt(u64, body[8..16], .little);
            if (state.handles.get(fh)) |handle| {
                if (handle.kind != .file or handle.fd < 0) return try build_error_reply(state, hdr.unique, -E.BADF);
                if (fchmod(handle.fd, @intCast(mode)) != 0) {
                    return try build_error_reply(state, hdr.unique, map_fs_error(errno_to_zig_error(errno())));
                }
                chmodded = true;
            } else {
                return try build_error_reply(state, hdr.unique, -E.BADF);
            }
        }
        if (!chmodded) {
            var path_z: [4097]u8 = undefined;
            if (abs.len >= path_z.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
            @memcpy(path_z[0..abs.len], abs);
            path_z[abs.len] = 0;
            if (chmod(@ptrCast(&path_z), @intCast(mode)) != 0) {
                return try build_error_reply(state, hdr.unique, map_fs_error(errno_to_zig_error(errno())));
            }
        }
    }

    var st = std.mem.zeroes(Stat);
    host_lstat(abs, &st) catch |e| return try build_error_reply(state, hdr.unique, map_fs_error(e));

    var payload: [FUSE_ATTR_OUT_SIZE]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], state.cache_policy.attr_valid_sec, .little);
    std.mem.writeInt(u32, payload[8..12], state.cache_policy.attr_valid_nsec, .little);
    write_attr(payload[16..104], stat_to_attr(st, hdr.nodeid));
    return try build_reply(state, hdr.unique, &payload);
}

// --- STATFS -------------------------------------------------------------

fn on_statfs(state: *State, hdr: InHeader) ![]u8 {
    // Plausible defaults — exactness isn't required for correctness;
    // tar / df / etc. just want non-zero free space.
    var payload: [80]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], 1_000_000, .little); // blocks
    std.mem.writeInt(u64, payload[8..16], 500_000, .little); // bfree
    std.mem.writeInt(u64, payload[16..24], 500_000, .little); // bavail
    std.mem.writeInt(u64, payload[24..32], 100_000, .little); // files
    std.mem.writeInt(u64, payload[32..40], 99_000, .little); // ffree
    std.mem.writeInt(u32, payload[40..44], 4096, .little); // bsize
    std.mem.writeInt(u32, payload[44..48], 255, .little); // namelen
    std.mem.writeInt(u32, payload[48..52], 4096, .little); // frsize
    return try build_reply(state, hdr.unique, &payload);
}

// --- RELEASE / RELEASEDIR -----------------------------------------------

fn on_release(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < FUSE_RELEASE_IN_SIZE) return try build_error_reply(state, hdr.unique, -E.INVAL);
    const fh = std.mem.readInt(u64, body[0..8], .little);
    if (state.handles.getPtr(fh)) |handle| {
        free_handle(state, handle);
        _ = state.handles.remove(fh);
    }
    return try build_error_reply(state, hdr.unique, 0);
}

// fuse_release_in is the same wire shape RELEASEDIR uses — fh is the
// first u64. Free the snapshotted dirent buffers.
fn on_releasedir(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return try build_error_reply(state, hdr.unique, -E.INVAL);
    const fh = std.mem.readInt(u64, body[0..8], .little);
    if (state.handles.getPtr(fh)) |handle| {
        free_handle(state, handle);
        _ = state.handles.remove(fh);
    }
    return try build_error_reply(state, hdr.unique, 0);
}

// --- OPENDIR / READDIR --------------------------------------------------

// DT_* dirent type bytes (POSIX dirent.h; identical on darwin + linux
// for the values we emit).
const DT_UNKNOWN: u32 = 0;
const DT_FIFO: u32 = 1;
const DT_CHR: u32 = 2;
const DT_DIR: u32 = 4;
const DT_BLK: u32 = 6;
const DT_REG: u32 = 8;
const DT_LNK: u32 = 10;
const DT_SOCK: u32 = 12;

// S_IFMT type bits → DT_* dirent type.
fn mode_to_dt(mode: u32) u32 {
    return switch (mode & 0o170000) {
        0o040000 => DT_DIR,
        0o100000 => DT_REG,
        0o120000 => DT_LNK,
        0o020000 => DT_CHR,
        0o060000 => DT_BLK,
        0o010000 => DT_FIFO,
        0o140000 => DT_SOCK,
        else => DT_UNKNOWN,
    };
}

// Pack one `fuse_dirent`: 24-byte header (ino, off, namelen, type) +
// the name, zero-padded to an 8-byte boundary. Caller owns the result.
fn build_dirent(gpa: std.mem.Allocator, ino: u64, off: u64, dtype: u32, name: []const u8) ![]u8 {
    const padded_name = (name.len + 7) & ~@as(usize, 7);
    const buf = try gpa.alloc(u8, 24 + padded_name);
    @memset(buf, 0);
    std.mem.writeInt(u64, buf[0..8], ino, .little);
    std.mem.writeInt(u64, buf[8..16], off, .little);
    std.mem.writeInt(u32, buf[16..20], @intCast(name.len), .little);
    std.mem.writeInt(u32, buf[20..24], dtype, .little);
    @memcpy(buf[24 .. 24 + name.len], name);
    return buf;
}

fn on_opendir(state: *State, hdr: InHeader) ![]u8 {
    const entry = require_inode(state, hdr.nodeid) orelse
        return try build_error_reply(state, hdr.unique, -E.STALE);

    var path_buf: [4096]u8 = undefined;
    const abs = build_abs_path(state, entry.rel_path, &path_buf) catch
        return try build_error_reply(state, hdr.unique, -E.INVAL);

    var abs_z: [4097]u8 = undefined;
    if (abs.len >= abs_z.len) return try build_error_reply(state, hdr.unique, -E.INVAL);
    @memcpy(abs_z[0..abs.len], abs);
    abs_z[abs.len] = 0;

    const dir = opendir(@ptrCast(&abs_z)) orelse
        return try build_error_reply(state, hdr.unique, map_fs_error(errno_to_zig_error(errno())));
    defer _ = closedir(dir);

    // Pack every child into its own fuse_dirent buffer. An ArrayList
    // keeps the common case (a few hundred entries) cheap; the
    // MAX_DIRENTS ceiling below bounds the pathological case.
    var entries: std.ArrayList([]u8) = .empty;
    errdefer {
        for (entries.items) |b| state.gpa.free(b);
        entries.deinit(state.gpa);
    }

    // Bounded loop: at most MAX_DIRENTS iterations append an entry.
    // `readdir` returning null (end of stream) is the usual exit; the
    // cap is the safety valve for a pathologically large directory.
    while (readdir(dir)) |de| {
        assert(entries.items.len <= MAX_DIRENTS);
        if (entries.items.len == MAX_DIRENTS) break;

        const name = std.mem.sliceTo(&de.d_name, 0);
        // `.` and `..` aren't sent over FUSE readdir — the kernel
        // synthesizes them. Skip to match kernel behavior.
        if (std.mem.eql(u8, name, ".") or std.mem.eql(u8, name, "..")) continue;
        assert(name.len > 0);

        // `off` is 1-based index of the *next* entry — the kernel
        // passes it back as READ offset to resume mid-listing.
        const off: u64 = entries.items.len + 1;
        // d_type is usually populated; when the fs returns DT_UNKNOWN,
        // lstat the child to get a real type. Cheap — only on the
        // unknown path, and most fs's fill d_type.
        var dtype: u32 = de.d_type;
        if (dtype == DT_UNKNOWN) {
            var child_buf: [4096]u8 = undefined;
            const child_rel = join_rel(state.gpa, entry.rel_path, name) catch continue;
            defer state.gpa.free(child_rel);
            const child_abs = build_abs_path(state, child_rel, &child_buf) catch continue;
            var st = std.mem.zeroes(Stat);
            if (host_lstat(child_abs, &st)) |_| {
                dtype = mode_to_dt(st.mode);
            } else |_| {}
        }
        const packed_de = try build_dirent(state.gpa, off, off, dtype, name);
        try entries.append(state.gpa, packed_de);
    }

    const owned = try entries.toOwnedSlice(state.gpa);
    const id = state.next_handle;
    state.next_handle += 1;
    try state.handles.put(id, .{ .kind = .dir, .dir_entries = owned });

    var payload: [16]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], id, .little); // fh
    std.mem.writeInt(u32, payload[8..12], 0, .little); // open_flags
    return try build_reply(state, hdr.unique, &payload);
}

fn on_readdir(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 32) return try build_error_reply(state, hdr.unique, -E.INVAL);
    const fh = std.mem.readInt(u64, body[0..8], .little);
    const offset = std.mem.readInt(u64, body[8..16], .little);
    const size = std.mem.readInt(u32, body[16..20], .little);

    const handle = state.handles.get(fh) orelse
        return try build_error_reply(state, hdr.unique, -E.BADF);
    if (handle.kind != .dir) return try build_error_reply(state, hdr.unique, -E.BADF);
    const entries = handle.dir_entries orelse
        return try build_error_reply(state, hdr.unique, -E.BADF);

    // Fill the reply with as many whole dirents as fit in `size`,
    // starting at `offset` (1-based "off" the kernel echoed back from
    // a prior READDIR). offset 0 means "from the top".
    const start: usize = @intCast(offset);
    var total: usize = 0;
    var i: usize = start;
    while (i < entries.len) : (i += 1) {
        if (total + entries[i].len > size) break;
        total += entries[i].len;
    }
    const reply = try state.gpa.alloc(u8, FUSE_OUT_HEADER_SIZE + total);
    write_out_header(reply[0..FUSE_OUT_HEADER_SIZE], total, 0, hdr.unique);
    var cursor: usize = FUSE_OUT_HEADER_SIZE;
    var j: usize = start;
    while (j < i) : (j += 1) {
        @memcpy(reply[cursor..][0..entries[j].len], entries[j]);
        cursor += entries[j].len;
    }
    // Postcondition: the two passes agree — the bytes packed here
    // exactly fill the buffer the first pass sized. A mismatch means
    // a dirent length changed between passes (impossible here, the
    // slice is immutable) or an off-by-one in either loop.
    assert(cursor == reply.len);
    return reply;
}

// --- host fs ops --------------------------------------------------------

fn host_lstat(path: []const u8, out: *Stat) !void {
    var path_z: [4097]u8 = undefined;
    if (path.len >= path_z.len) return error.PathTooLong;
    @memcpy(path_z[0..path.len], path);
    path_z[path.len] = 0;
    if (fstatat(AT_FDCWD, @ptrCast(&path_z), out, AT_SYMLINK_NOFOLLOW) != 0) {
        return errno_to_zig_error(errno());
    }
}

fn host_fstat(fd: c_int, out: *Stat) !void {
    if (fstat(fd, out) != 0) return errno_to_zig_error(errno());
}

fn open_host(path: []const u8, flags: c_int, mode: c_int) !c_int {
    var path_z: [4097]u8 = undefined;
    if (path.len >= path_z.len) return error.PathTooLong;
    @memcpy(path_z[0..path.len], path);
    path_z[path.len] = 0;
    const fd = open(@ptrCast(&path_z), flags, mode);
    if (fd < 0) return errno_to_zig_error(errno());
    return fd;
}

fn pwrite_all(fd: c_int, data: []const u8, offset: u64) !usize {
    var total: usize = 0;
    while (total < data.len) {
        const n = pwrite(fd, data[total..].ptr, data.len - total, @intCast(offset + total));
        if (n > 0) {
            total += @intCast(n);
            continue;
        }
        if (n == 0) break;
        if (errno() == EINTR) continue;
        return errno_to_zig_error(errno());
    }
    return total;
}

fn errno_to_zig_error(e: c_int) anyerror {
    return switch (e) {
        2 => error.FileNotFound,
        13 => error.AccessDenied,
        16 => error.Busy,
        17 => error.PathAlreadyExists,
        21 => error.IsDir,
        20 => error.NotDir,
        22 => error.InvalidArg,
        28 => error.NoSpaceLeft,
        1 => error.PermissionDenied,
        HOST_ENOTEMPTY => error.DirNotEmpty,
        else => error.Unexpected,
    };
}

fn map_fs_error(e: anyerror) i32 {
    return switch (e) {
        error.FileNotFound => -E.NOENT,
        error.AccessDenied => -E.ACCES,
        error.Busy => -E.BUSY,
        error.PathAlreadyExists => -E.EXIST,
        error.IsDir => -E.ISDIR,
        error.NotDir => -E.NOTDIR,
        error.InvalidArg => -E.INVAL,
        error.NoSpaceLeft => -E.NOSPC,
        error.PermissionDenied => -E.PERM,
        error.DirNotEmpty => -E.NOTEMPTY,
        error.PathTooLong => -E.INVAL,
        else => -E.IO,
    };
}

fn linux_open_to_host(linux_flags: u32) c_int {
    const access = linux_flags & 0o3;
    // With FUSE_CAP_WRITEBACK_CACHE the guest kernel may issue READs on
    // a handle the process opened O_WRONLY, to fill a page before a
    // partial overwrite. Back host writable handles with O_RDWR so those
    // cache-fill READs don't bounce EBADF up to userspace as EIO.
    var host: c_int = if (access == LINUX_O_WRONLY or access == LINUX_O_RDWR)
        O_RDWR
    else
        O_RDONLY;
    if (linux_flags & LINUX_O_TRUNC != 0) host |= O_TRUNC;
    // Do not mirror O_APPEND to the host fd. FUSE WRITE requests carry
    // explicit offsets, and with WRITEBACK_CACHE the guest may send a
    // whole rewritten page at offset 0 for `>> file`. Linux makes
    // pwrite(2) append anyway on an O_APPEND fd, which duplicates the
    // old bytes. Honor the guest-supplied offset instead.
    return host;
}

fn update_bound_inodes_after_rename(
    state: *State,
    old_rel: []const u8,
    new_rel: []const u8,
    renamed_is_dir: bool,
) !void {
    assert(old_rel.len > 0);
    assert(new_rel.len > 0);
    if (state.path_index.get(old_rel)) |nodeid| {
        const replacement = try state.gpa.dupe(u8, new_rel);
        try replace_inode_rel_path(state, nodeid, replacement);
    }

    if (!renamed_is_dir) return;

    var it = state.inodes.iterator();
    while (it.next()) |e| {
        const rel = e.value_ptr.rel_path;
        if (rel.len > old_rel.len and
            std.mem.startsWith(u8, rel, old_rel) and
            rel[old_rel.len] == '/')
        {
            const suffix = rel[old_rel.len..];
            const replacement = try std.mem.concat(state.gpa, u8, &.{ new_rel, suffix });
            try replace_inode_rel_path(state, e.key_ptr.*, replacement);
        }
    }
}

fn replace_inode_rel_path(state: *State, nodeid: u64, replacement: []u8) !void {
    assert(replacement.len > 0);
    const entry = state.inodes.getPtr(nodeid) orelse {
        state.gpa.free(replacement);
        return error.StalePathIndex;
    };
    _ = state.path_index.remove(entry.rel_path);
    state.gpa.free(entry.rel_path);
    entry.rel_path = replacement;
    try state.path_index.put(replacement, nodeid);
}

fn stat_to_attr(st: Stat, ino: u64) Attr {
    const atime_ts = if (builtin.os.tag == .macos) st.atimespec else st.atim;
    const mtime_ts = if (builtin.os.tag == .macos) st.mtimespec else st.mtim;
    const ctime_ts = if (builtin.os.tag == .macos) st.ctimespec else st.ctim;
    return .{
        .ino = ino,
        .size = @intCast(st.size),
        .blocks = @intCast(st.blocks),
        .atime = @intCast(atime_ts.tv_sec),
        .mtime = @intCast(mtime_ts.tv_sec),
        .ctime = @intCast(ctime_ts.tv_sec),
        .atimensec = @intCast(atime_ts.tv_nsec),
        .mtimensec = @intCast(mtime_ts.tv_nsec),
        .ctimensec = @intCast(ctime_ts.tv_nsec),
        .mode = st.mode,
        .nlink = @intCast(st.nlink),
        .uid = st.uid,
        .gid = st.gid,
        .rdev = @intCast(st.rdev),
        .blksize = @intCast(st.blksize),
        .flags = 0,
    };
}

// --- name decoding ------------------------------------------------------

fn decode_name(body: []const u8) []const u8 {
    const nul = std.mem.indexOfScalar(u8, body, 0) orelse body.len;
    return body[0..nul];
}

// --- stats file ---------------------------------------------------------

pub fn write_stats_atomic(state: *State) void {
    const stats_path = state.stats_path orelse return;
    assert(stats_path.len > 0);
    assert(state.root_abs.len > 0);

    // Build the JSON in one heap buffer. Stats files are small (<10 KiB
    // even with all ~30 opcodes), and a single allocPrint per write
    // beats the writer-ceremony for a once-on-startup, once-on-shutdown
    // call site.
    var body_buf: [16 * 1024]u8 = undefined;
    var cur: usize = 0;

    const header_fmt =
        "{{\"bytesServedOnPagesImg\":{d}," ++
        "\"updatedAtMs\":{d}";
    var slice = std.fmt.bufPrint(body_buf[cur..], header_fmt, .{
        state.bytes_served_on_pages_img,
        now_ms(),
    }) catch return;
    cur += slice.len;

    if (state.profile_enabled) {
        const transport_fmt =
            ",\"transport\":{{\"requestCount\":{d}," ++
            "\"virtqueueGatherNs\":{d},\"fuseDispatchNs\":{d}," ++
            "\"virtqueueScatterNs\":{d},\"requestBytes\":{d}," ++
            "\"replyBytes\":{d}}}";
        slice = std.fmt.bufPrint(body_buf[cur..], transport_fmt, .{
            state.virtqueue_request_count,
            state.virtqueue_gather_ns,
            state.virtqueue_dispatch_ns,
            state.virtqueue_scatter_ns,
            state.virtqueue_request_bytes,
            state.virtqueue_reply_bytes,
        }) catch return;
        cur += slice.len;

        slice = std.fmt.bufPrint(body_buf[cur..], ",\"ops\":{{", .{}) catch return;
        cur += slice.len;
        var first = true;
        var it = state.op_stats.iterator();
        while (it.next()) |e| {
            if (!first) {
                slice = std.fmt.bufPrint(body_buf[cur..], ",", .{}) catch return;
                cur += slice.len;
            }
            first = false;
            const op_fmt =
                "\"{s}\":{{\"count\":{d},\"sumNs\":{d}," ++
                "\"p50Ns\":0,\"p99Ns\":0}}";
            slice = std.fmt.bufPrint(body_buf[cur..], op_fmt, .{
                op_name(e.key_ptr.*),
                e.value_ptr.count,
                e.value_ptr.sum_ns,
            }) catch return;
            cur += slice.len;
        }
        slice = std.fmt.bufPrint(body_buf[cur..], "}}", .{}) catch return;
        cur += slice.len;
    }
    slice = std.fmt.bufPrint(body_buf[cur..], "}}", .{}) catch return;
    cur += slice.len;
    const body_items = body_buf[0..cur];

    // Atomic via tmp + rename. tmp suffix includes pid so concurrent
    // servers (shouldn't happen, but harmless) don't collide.
    var tmp_path: [4096]u8 = undefined;
    const pid = std.c.getpid();
    const tmp = std.fmt.bufPrint(&tmp_path, "{s}.tmp.{d}", .{ stats_path, pid }) catch return;
    var tmp_z: [4097]u8 = undefined;
    if (tmp.len >= tmp_z.len) return;
    @memcpy(tmp_z[0..tmp.len], tmp);
    tmp_z[tmp.len] = 0;

    const fd = open(@ptrCast(&tmp_z), O_WRONLY | O_CREAT | O_TRUNC, @as(c_int, 0o644));
    if (fd < 0) return;
    _ = write_file_all(fd, body_items);
    _ = close(fd);

    var dst_z: [4097]u8 = undefined;
    if (stats_path.len >= dst_z.len) return;
    @memcpy(dst_z[0..stats_path.len], stats_path);
    dst_z[stats_path.len] = 0;
    _ = rename(@ptrCast(&tmp_z), @ptrCast(&dst_z));
}

fn op_name(code: u32) []const u8 {
    return switch (@as(Op, @enumFromInt(code))) {
        .LOOKUP => "LOOKUP",
        .FORGET => "FORGET",
        .GETATTR => "GETATTR",
        .SETATTR => "SETATTR",
        .READLINK => "READLINK",
        .SYMLINK => "SYMLINK",
        .MKDIR => "MKDIR",
        .UNLINK => "UNLINK",
        .RMDIR => "RMDIR",
        .RENAME => "RENAME",
        .LINK => "LINK",
        .OPEN => "OPEN",
        .READ => "READ",
        .WRITE => "WRITE",
        .STATFS => "STATFS",
        .RELEASE => "RELEASE",
        .FSYNC => "FSYNC",
        .SETXATTR => "SETXATTR",
        .GETXATTR => "GETXATTR",
        .LISTXATTR => "LISTXATTR",
        .REMOVEXATTR => "REMOVEXATTR",
        .FLUSH => "FLUSH",
        .INIT => "INIT",
        .OPENDIR => "OPENDIR",
        .READDIR => "READDIR",
        .RELEASEDIR => "RELEASEDIR",
        .FSYNCDIR => "FSYNCDIR",
        .GETLK => "GETLK",
        .SETLK => "SETLK",
        .SETLKW => "SETLKW",
        .ACCESS => "ACCESS",
        .CREATE => "CREATE",
        .INTERRUPT => "INTERRUPT",
        .DESTROY => "DESTROY",
        .BATCH_FORGET => "BATCH_FORGET",
        else => "UNKNOWN",
    };
}

// --- tests --------------------------------------------------------------
//
// Transport-agnostic handler tests. They drive `dispatch` directly with
// hand-built request frames — no socket, no virtqueue — which is the
// whole point of the #332 extraction: the same assertions cover both
// the vsock `main.zig` and the in-VMM `virtiofs.zig` transports.

const testing = std.testing;

/// Build a contiguous FUSE request frame — 40-byte in-header + body —
/// exactly as a transport would hand it to `dispatch`. Caller owns the
/// returned slice.
fn test_build_frame(
    gpa: std.mem.Allocator,
    opcode: u32,
    unique: u64,
    nodeid: u64,
    body: []const u8,
) ![]u8 {
    const frame = try gpa.alloc(u8, FUSE_IN_HEADER_SIZE + body.len);
    @memset(frame, 0);
    std.mem.writeInt(u32, frame[0..4], @intCast(frame.len), .little);
    std.mem.writeInt(u32, frame[4..8], opcode, .little);
    std.mem.writeInt(u64, frame[8..16], unique, .little);
    std.mem.writeInt(u64, frame[16..24], nodeid, .little);
    @memcpy(frame[FUSE_IN_HEADER_SIZE..], body);
    return frame;
}

/// A `State` over a root path that never gets touched — every test
/// here exercises a control-flow branch (negotiation, ENOSYS, the
/// `:ro` gate, no-reply ops) that returns before any host fs syscall.
fn test_state(gpa: std.mem.Allocator, mode_rw: bool) !State {
    return State.init(gpa, try gpa.dupe(u8, "/nonexistent-machinen-test-root"), mode_rw);
}

test "dispatch: INIT negotiates protocol 7.31" {
    const gpa = testing.allocator;
    var state = try test_state(gpa, true);
    defer state.deinit();

    var body: [16]u8 = @splat(0);
    std.mem.writeInt(u32, body[0..4], 7, .little); // major
    std.mem.writeInt(u32, body[4..8], 36, .little); // minor — guest offers newer
    const frame = try test_build_frame(gpa, @intFromEnum(Op.INIT), 42, 0, &body);
    defer gpa.free(frame);

    const reply = (try dispatch(&state, frame)) orelse return error.ExpectedReply;
    defer gpa.free(reply);

    try testing.expectEqual(FUSE_OUT_HEADER_SIZE + FUSE_INIT_OUT_SIZE, reply.len);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, reply[4..8], .little));
    try testing.expectEqual(@as(u64, 42), std.mem.readInt(u64, reply[8..16], .little));
    const out = reply[FUSE_OUT_HEADER_SIZE..];
    try testing.expectEqual(FUSE_KERNEL_VERSION, std.mem.readInt(u32, out[0..4], .little));
    // out_minor clamps to min(guest 36, ours 31).
    try testing.expectEqual(FUSE_KERNEL_MINOR_VERSION, std.mem.readInt(u32, out[4..8], .little));
}

test "dispatch: unknown opcode returns ENOSYS" {
    const gpa = testing.allocator;
    var state = try test_state(gpa, true);
    defer state.deinit();

    const frame = try test_build_frame(gpa, 9999, 7, 1, &.{});
    defer gpa.free(frame);

    const reply = (try dispatch(&state, frame)) orelse return error.ExpectedReply;
    defer gpa.free(reply);

    try testing.expectEqual(@as(usize, FUSE_OUT_HEADER_SIZE), reply.len);
    try testing.expectEqual(@as(i32, -E.NOSYS), std.mem.readInt(i32, reply[4..8], .little));
}

test "dispatch: CREATE on a :ro mount returns EROFS" {
    const gpa = testing.allocator;
    var state = try test_state(gpa, false); // read-only
    defer state.deinit();

    const frame = try test_build_frame(gpa, @intFromEnum(Op.CREATE), 9, 1, &.{});
    defer gpa.free(frame);

    const reply = (try dispatch(&state, frame)) orelse return error.ExpectedReply;
    defer gpa.free(reply);

    try testing.expectEqual(@as(i32, -E.ROFS), std.mem.readInt(i32, reply[4..8], .little));
}

test "dispatch: FORGET and INTERRUPT produce no reply" {
    const gpa = testing.allocator;
    var state = try test_state(gpa, true);
    defer state.deinit();

    const forget_body: [8]u8 = @splat(0);
    const forget = try test_build_frame(gpa, @intFromEnum(Op.FORGET), 1, 1, &forget_body);
    defer gpa.free(forget);
    try testing.expect((try dispatch(&state, forget)) == null);

    const interrupt = try test_build_frame(gpa, @intFromEnum(Op.INTERRUPT), 2, 0, &.{});
    defer gpa.free(interrupt);
    try testing.expect((try dispatch(&state, interrupt)) == null);
}

test "validateName rejects path-escape and empty names" {
    try testing.expectError(error.InvalidName, validate_name(""));
    try testing.expectError(error.InvalidName, validate_name("."));
    try testing.expectError(error.InvalidName, validate_name(".."));
    try testing.expectError(error.InvalidName, validate_name("a/b"));
    try testing.expectError(error.InvalidName, validate_name("a\x00b"));
    try validate_name("normal-file.txt");
}

test "path index reuses and removes bound inodes" {
    const gpa = testing.allocator;
    var state = try test_state(gpa, true);
    defer state.deinit();

    const first = try bind_inode(&state, "dir/file");
    const second = try bind_inode(&state, "dir/file");
    try testing.expectEqual(first, second);
    try testing.expectEqual(first, state.path_index.get("dir/file").?);
    try testing.expectEqual(@as(u64, 2), state.inodes.get(first).?.nlookup);

    decref_inode(&state, first, 2);
    try testing.expect(state.path_index.get("dir/file") == null);
    try testing.expect(state.inodes.get(first) == null);
}

test "path index survives dump/apply and rename rebuilds it" {
    const gpa = testing.allocator;
    var state = try test_state(gpa, true);
    defer state.deinit();

    const dir = try bind_inode(&state, "old");
    const child = try bind_inode(&state, "old/file");
    try update_bound_inodes_after_rename(&state, "old", "new", true);
    try testing.expect(state.path_index.get("old") == null);
    try testing.expect(state.path_index.get("old/file") == null);
    try testing.expectEqual(dir, state.path_index.get("new").?);
    try testing.expectEqual(child, state.path_index.get("new/file").?);

    const payload = try state.dump_state(gpa);
    defer gpa.free(payload);

    var restored = try test_state(gpa, true);
    defer restored.deinit();
    try restored.apply_state(payload);
    try testing.expectEqual(dir, restored.path_index.get("new").?);
    try testing.expectEqual(child, restored.path_index.get("new/file").?);
}

test "path index rename skips descendant scan for file renames" {
    const gpa = testing.allocator;
    var state = try test_state(gpa, true);
    defer state.deinit();

    const file = try bind_inode(&state, "old");
    const impossible_child = try bind_inode(&state, "old/file");
    try update_bound_inodes_after_rename(&state, "old", "new", false);

    try testing.expect(state.path_index.get("old") == null);
    try testing.expectEqual(file, state.path_index.get("new").?);
    try testing.expectEqual(impossible_child, state.path_index.get("old/file").?);
    try testing.expect(state.path_index.get("new/file") == null);
}

// --- snapshot (dumpState / applyState) tests ---------------------------
//
// The vmstate whole-VM snapshot captures a virtio-fs device's host-side
// FUSE state through `State.dumpState` / `applyState`. Per the FUSE-ops
// rule in CLAUDE.md these cover: the happy path (a handle survives a
// snapshot round-trip and still does real I/O), the error path (a file
// removed since the snapshot restores fail-soft), the `:ro` gate, and
// the wedge guard (a malformed payload is rejected, not panicked on).

/// Absolute path of a `std.testing.tmpDir` — the dumpState/applyState
/// tests need a real root the reopened fds can resolve against. Heap-
/// allocated; the caller hands it to `State.init`, which takes ownership.
fn test_tmp_root_abs(gpa: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, gpa);
    defer gpa.free(cwd);
    return std.fs.path.join(gpa, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

fn expect_attr_ttl(payload: []const u8, sec: u64, nsec: u32) !void {
    assert(payload.len >= 12);
    try testing.expectEqual(sec, std.mem.readInt(u64, payload[0..8], .little));
    try testing.expectEqual(nsec, std.mem.readInt(u32, payload[8..12], .little));
}

fn expect_entry_ttl(payload: []const u8, policy: CachePolicy) !void {
    assert(payload.len >= 40);
    try testing.expectEqual(policy.entry_valid_sec, std.mem.readInt(u64, payload[16..24], .little));
    try testing.expectEqual(policy.attr_valid_sec, std.mem.readInt(u64, payload[24..32], .little));
    try testing.expectEqual(policy.entry_valid_nsec, std.mem.readInt(u32, payload[32..36], .little));
    try testing.expectEqual(policy.attr_valid_nsec, std.mem.readInt(u32, payload[36..40], .little));
}

test "dispatch: GETATTR returns sane attrs for the host stat layout" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    var state = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer state.deinit();

    const frame = try test_build_frame(gpa, @intFromEnum(Op.GETATTR), 9, 1, &.{});
    defer gpa.free(frame);
    const r = (try dispatch(&state, frame)) orelse return error.ExpectedReply;
    defer gpa.free(r);

    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, r[4..8], .little));
    try testing.expectEqual(@as(usize, FUSE_OUT_HEADER_SIZE + FUSE_ATTR_OUT_SIZE), r.len);
    const attr_out = r[FUSE_OUT_HEADER_SIZE..];
    const cached_policy = State.cache_mode_for_test(.cached);
    try expect_attr_ttl(attr_out, cached_policy.attr_valid_sec, cached_policy.attr_valid_nsec);

    const attr = r[FUSE_OUT_HEADER_SIZE + 16 ..];
    const mode = std.mem.readInt(u32, attr[60..64], .little);
    const nlink = std.mem.readInt(u32, attr[64..68], .little);
    const blksize = std.mem.readInt(u32, attr[80..84], .little);
    try testing.expectEqual(@as(u32, 0o040000), mode & 0o170000);
    try testing.expect(nlink > 0);
    try testing.expect(blksize > 0);
}

test "dispatch: cache modes control LOOKUP and GETATTR TTL" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "cache.txt", .data = "x" });

    var cached = try State.init_with_cache(gpa, try test_tmp_root_abs(gpa, &tmp), true, .cached);
    defer cached.deinit();
    var fast = try State.init_with_cache(gpa, try test_tmp_root_abs(gpa, &tmp), true, .fast);
    defer fast.deinit();

    const cached_frame = try test_build_frame(gpa, @intFromEnum(Op.GETATTR), 11, 1, &.{});
    defer gpa.free(cached_frame);
    const cached_reply = (try dispatch(&cached, cached_frame)) orelse return error.ExpectedReply;
    defer gpa.free(cached_reply);
    const cached_attr_out = cached_reply[FUSE_OUT_HEADER_SIZE..];
    const cached_policy = State.cache_mode_for_test(.cached);
    try expect_attr_ttl(cached_attr_out, cached_policy.attr_valid_sec, cached_policy.attr_valid_nsec);

    const fast_frame = try test_build_frame(gpa, @intFromEnum(Op.GETATTR), 12, 1, &.{});
    defer gpa.free(fast_frame);
    const fast_reply = (try dispatch(&fast, fast_frame)) orelse return error.ExpectedReply;
    defer gpa.free(fast_reply);
    const fast_attr_out = fast_reply[FUSE_OUT_HEADER_SIZE..];
    const fast_policy = State.cache_mode_for_test(.fast);
    try expect_attr_ttl(fast_attr_out, fast_policy.attr_valid_sec, fast_policy.attr_valid_nsec);

    const cached_lookup_frame = try test_build_frame(
        gpa,
        @intFromEnum(Op.LOOKUP),
        13,
        1,
        "cache.txt\x00",
    );
    defer gpa.free(cached_lookup_frame);
    const cached_lookup_reply = (try dispatch(&cached, cached_lookup_frame)) orelse
        return error.ExpectedReply;
    defer gpa.free(cached_lookup_reply);
    const cached_entry_out = cached_lookup_reply[FUSE_OUT_HEADER_SIZE..];
    try expect_entry_ttl(cached_entry_out, cached_policy);

    var setattr_body: [24]u8 = @splat(0);
    std.mem.writeInt(u32, setattr_body[0..4], FATTR_SIZE, .little);
    std.mem.writeInt(u64, setattr_body[16..24], 1, .little);
    const cached_nodeid = std.mem.readInt(u64, cached_entry_out[0..8], .little);
    const cached_setattr_frame = try test_build_frame(
        gpa,
        @intFromEnum(Op.SETATTR),
        15,
        cached_nodeid,
        &setattr_body,
    );
    defer gpa.free(cached_setattr_frame);
    const cached_setattr_reply = (try dispatch(&cached, cached_setattr_frame)) orelse
        return error.ExpectedReply;
    defer gpa.free(cached_setattr_reply);
    const cached_setattr_out = cached_setattr_reply[FUSE_OUT_HEADER_SIZE..];
    try expect_attr_ttl(cached_setattr_out, cached_policy.attr_valid_sec, cached_policy.attr_valid_nsec);

    const fast_lookup_frame = try test_build_frame(
        gpa,
        @intFromEnum(Op.LOOKUP),
        14,
        1,
        "cache.txt\x00",
    );
    defer gpa.free(fast_lookup_frame);
    const fast_lookup_reply = (try dispatch(&fast, fast_lookup_frame)) orelse
        return error.ExpectedReply;
    defer gpa.free(fast_lookup_reply);
    const fast_entry_out = fast_lookup_reply[FUSE_OUT_HEADER_SIZE..];
    try expect_entry_ttl(fast_entry_out, fast_policy);
}

/// CREATE `name` under the root inode; returns its (nodeid, fh).
fn test_create(state: *State, name: []const u8) !struct { nodeid: u64, fh: u64 } {
    var body: [16 + 96]u8 = @splat(0);
    std.mem.writeInt(u32, body[0..4], LINUX_O_RDWR, .little);
    std.mem.writeInt(u32, body[4..8], 0o644, .little);
    @memcpy(body[16..][0..name.len], name);
    const frame = try test_build_frame(state.gpa, @intFromEnum(Op.CREATE), 1, 1, body[0 .. 16 + name.len]);
    defer state.gpa.free(frame);
    const r = (try dispatch(state, frame)) orelse return error.ExpectedReply;
    defer state.gpa.free(r);
    if (std.mem.readInt(i32, r[4..8], .little) != 0) return error.CreateFailed;
    return .{
        .nodeid = std.mem.readInt(u64, r[FUSE_OUT_HEADER_SIZE..][0..8], .little),
        .fh = std.mem.readInt(u64, r[FUSE_OUT_HEADER_SIZE + 128 ..][0..8], .little),
    };
}

fn test_lookup(state: *State, name: []const u8) !u64 {
    var body: [128]u8 = @splat(0);
    @memcpy(body[0..name.len], name);
    const frame = try test_build_frame(state.gpa, @intFromEnum(Op.LOOKUP), 1, 1, body[0 .. name.len + 1]);
    defer state.gpa.free(frame);
    const r = (try dispatch(state, frame)) orelse return error.ExpectedReply;
    defer state.gpa.free(r);
    if (std.mem.readInt(i32, r[4..8], .little) != 0) return error.LookupFailed;
    return std.mem.readInt(u64, r[FUSE_OUT_HEADER_SIZE..][0..8], .little);
}

fn test_open(state: *State, nodeid: u64, flags: u32) !u64 {
    var body: [8]u8 = @splat(0);
    std.mem.writeInt(u32, body[0..4], flags, .little);
    const frame = try test_build_frame(state.gpa, @intFromEnum(Op.OPEN), 1, nodeid, &body);
    defer state.gpa.free(frame);
    const r = (try dispatch(state, frame)) orelse return error.ExpectedReply;
    defer state.gpa.free(r);
    if (std.mem.readInt(i32, r[4..8], .little) != 0) return error.OpenFailed;
    return std.mem.readInt(u64, r[FUSE_OUT_HEADER_SIZE..][0..8], .little);
}

test "dispatch: OPEN O_WRONLY handles writeback-cache read fill then WRITE existing file" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "existing.txt", .data = "old-data" });

    var state = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer state.deinit();
    const nodeid = try test_lookup(&state, "existing.txt");
    const fh = try test_open(&state, nodeid, LINUX_O_WRONLY | LINUX_O_TRUNC);

    // The guest kernel may issue this READ on an O_WRONLY handle when
    // WRITEBACK_CACHE is negotiated. It must not turn into EBADF/EIO.
    var rbody: [32]u8 = @splat(0);
    std.mem.writeInt(u64, rbody[0..8], fh, .little);
    std.mem.writeInt(u32, rbody[16..20], 16, .little);
    const rf = try test_build_frame(gpa, @intFromEnum(Op.READ), 2, nodeid, &rbody);
    defer gpa.free(rf);
    const rr = (try dispatch(&state, rf)) orelse return error.ExpectedReply;
    defer gpa.free(rr);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, rr[4..8], .little));

    var wbody: [FUSE_WRITE_IN_SIZE + 3]u8 = @splat(0);
    std.mem.writeInt(u64, wbody[0..8], fh, .little);
    std.mem.writeInt(u32, wbody[16..20], 3, .little);
    @memcpy(wbody[FUSE_WRITE_IN_SIZE..], "new");
    const wf = try test_build_frame(gpa, @intFromEnum(Op.WRITE), 3, nodeid, &wbody);
    defer gpa.free(wf);
    const wr = (try dispatch(&state, wf)) orelse return error.ExpectedReply;
    defer gpa.free(wr);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, wr[4..8], .little));

    const got = try tmp.dir.readFileAlloc(std.testing.io, "existing.txt", gpa, .limited(1024));
    defer gpa.free(got);
    try testing.expectEqualStrings("new", got);
}

test "dispatch: O_APPEND writes honor guest offsets, not host append mode" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "append.txt", .data = "append-base\n" });

    var state = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer state.deinit();
    const nodeid = try test_lookup(&state, "append.txt");
    const fh = try test_open(&state, nodeid, LINUX_O_WRONLY | LINUX_O_APPEND);

    // With WRITEBACK_CACHE, the guest can satisfy `echo x >> file` by
    // sending the rewritten page at offset 0. If the host fd also has
    // O_APPEND, Linux pwrite(2) appends this whole page and duplicates
    // the old bytes. The FUSE offset is authoritative.
    const data = "append-base\nappended\n";
    var wbody: [FUSE_WRITE_IN_SIZE + data.len]u8 = @splat(0);
    std.mem.writeInt(u64, wbody[0..8], fh, .little);
    std.mem.writeInt(u64, wbody[8..16], 0, .little);
    std.mem.writeInt(u32, wbody[16..20], data.len, .little);
    @memcpy(wbody[FUSE_WRITE_IN_SIZE..], data);
    const wf = try test_build_frame(gpa, @intFromEnum(Op.WRITE), 3, nodeid, &wbody);
    defer gpa.free(wf);
    const wr = (try dispatch(&state, wf)) orelse return error.ExpectedReply;
    defer gpa.free(wr);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, wr[4..8], .little));

    const got = try tmp.dir.readFileAlloc(std.testing.io, "append.txt", gpa, .limited(1024));
    defer gpa.free(got);
    try testing.expectEqualStrings(data, got);
}

test "dispatch: SETATTR FATTR_SIZE truncates an existing file and honors :ro" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "truncate.txt", .data = "abcdef" });

    var rw = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer rw.deinit();
    const nodeid = try test_lookup(&rw, "truncate.txt");
    var body: [24]u8 = @splat(0);
    std.mem.writeInt(u32, body[0..4], FATTR_SIZE, .little);
    std.mem.writeInt(u64, body[16..24], 2, .little);
    const sf = try test_build_frame(gpa, @intFromEnum(Op.SETATTR), 1, nodeid, &body);
    defer gpa.free(sf);
    const sr = (try dispatch(&rw, sf)) orelse return error.ExpectedReply;
    defer gpa.free(sr);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, sr[4..8], .little));
    const attr_out = sr[FUSE_OUT_HEADER_SIZE..];
    const cached_policy = State.cache_mode_for_test(.cached);
    try expect_attr_ttl(attr_out, cached_policy.attr_valid_sec, cached_policy.attr_valid_nsec);

    const got = try tmp.dir.readFileAlloc(std.testing.io, "truncate.txt", gpa, .limited(1024));
    defer gpa.free(got);
    try testing.expectEqualStrings("ab", got);

    var ro = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), false);
    defer ro.deinit();
    const ro_nodeid = try test_lookup(&ro, "truncate.txt");
    std.mem.writeInt(u64, body[16..24], 1, .little);
    const rof = try test_build_frame(gpa, @intFromEnum(Op.SETATTR), 2, ro_nodeid, &body);
    defer gpa.free(rof);
    const ror = (try dispatch(&ro, rof)) orelse return error.ExpectedReply;
    defer gpa.free(ror);
    try testing.expectEqual(@as(i32, -E.ROFS), std.mem.readInt(i32, ror[4..8], .little));

    const still = try tmp.dir.readFileAlloc(std.testing.io, "truncate.txt", gpa, .limited(1024));
    defer gpa.free(still);
    try testing.expectEqualStrings("ab", still);
}

test "dispatch: READLINK returns symlink targets and reports errors" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "target.txt", .data = "target-data" });
    try tmp.dir.symLink(std.testing.io, "target.txt", "link.txt", .{});

    var state = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer state.deinit();

    const link_nodeid = try test_lookup(&state, "link.txt");
    const rf = try test_build_frame(gpa, @intFromEnum(Op.READLINK), 1, link_nodeid, &.{});
    defer gpa.free(rf);
    const rr = (try dispatch(&state, rf)) orelse return error.ExpectedReply;
    defer gpa.free(rr);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, rr[4..8], .little));
    try testing.expectEqualStrings("target.txt", rr[FUSE_OUT_HEADER_SIZE..]);

    const regular_nodeid = try test_lookup(&state, "target.txt");
    const nonlink = try test_build_frame(gpa, @intFromEnum(Op.READLINK), 2, regular_nodeid, &.{});
    defer gpa.free(nonlink);
    const nr = (try dispatch(&state, nonlink)) orelse return error.ExpectedReply;
    defer gpa.free(nr);
    try testing.expectEqual(@as(i32, -E.INVAL), std.mem.readInt(i32, nr[4..8], .little));

    const stale = try test_build_frame(gpa, @intFromEnum(Op.READLINK), 3, 9999, &.{});
    defer gpa.free(stale);
    const sr = (try dispatch(&state, stale)) orelse return error.ExpectedReply;
    defer gpa.free(sr);
    try testing.expectEqual(@as(i32, -E.STALE), std.mem.readInt(i32, sr[4..8], .little));
}

test "dispatch: LINK creates hardlinks, reports errors, and respects :ro" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "a.txt", .data = "hard" });

    var state = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer state.deinit();
    const oldnodeid = try test_lookup(&state, "a.txt");

    var body: [8 + 6]u8 = @splat(0);
    std.mem.writeInt(u64, body[0..8], oldnodeid, .little);
    @memcpy(body[8..][0.."b.txt".len], "b.txt");
    const lf = try test_build_frame(gpa, @intFromEnum(Op.LINK), 1, 1, body[0 .. 8 + "b.txt".len + 1]);
    defer gpa.free(lf);
    const lr = (try dispatch(&state, lf)) orelse return error.ExpectedReply;
    defer gpa.free(lr);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, lr[4..8], .little));
    try testing.expectEqual(oldnodeid, std.mem.readInt(u64, lr[FUSE_OUT_HEADER_SIZE..][0..8], .little));

    var st = std.mem.zeroes(Stat);
    var a_path_buf: [4096]u8 = undefined;
    try host_lstat(try build_abs_path(&state, "a.txt", &a_path_buf), &st);
    try testing.expect(st.nlink >= 2);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "a.txt", .data = "updated" });
    const got = try tmp.dir.readFileAlloc(std.testing.io, "b.txt", gpa, .limited(1024));
    defer gpa.free(got);
    try testing.expectEqualStrings("updated", got);
    try tmp.dir.deleteFile(std.testing.io, "a.txt");
    const after_unlink = try tmp.dir.readFileAlloc(std.testing.io, "b.txt", gpa, .limited(1024));
    defer gpa.free(after_unlink);
    try testing.expectEqualStrings("updated", after_unlink);

    // Reusing the same destination name reports EEXIST and leaves it alone.
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "a.txt", .data = "again" });
    const new_oldnodeid = try test_lookup(&state, "a.txt");
    std.mem.writeInt(u64, body[0..8], new_oldnodeid, .little);
    const exists = try test_build_frame(gpa, @intFromEnum(Op.LINK), 2, 1, body[0 .. 8 + "b.txt".len + 1]);
    defer gpa.free(exists);
    const er = (try dispatch(&state, exists)) orelse return error.ExpectedReply;
    defer gpa.free(er);
    try testing.expectEqual(@as(i32, -E.EXIST), std.mem.readInt(i32, er[4..8], .little));

    var ro = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), false);
    defer ro.deinit();
    const ro_oldnodeid = try test_lookup(&ro, "a.txt");
    var ro_body: [8 + 9]u8 = @splat(0);
    std.mem.writeInt(u64, ro_body[0..8], ro_oldnodeid, .little);
    @memcpy(ro_body[8..][0.."ro-b.txt".len], "ro-b.txt");
    const rof = try test_build_frame(gpa, @intFromEnum(Op.LINK), 3, 1, ro_body[0 .. 8 + "ro-b.txt".len + 1]);
    defer gpa.free(rof);
    const ror = (try dispatch(&ro, rof)) orelse return error.ExpectedReply;
    defer gpa.free(ror);
    try testing.expectEqual(@as(i32, -E.ROFS), std.mem.readInt(i32, ror[4..8], .little));
    try testing.expectError(error.FileNotFound, tmp.dir.access(std.testing.io, "ro-b.txt", .{}));

    const bad = try test_build_frame(gpa, @intFromEnum(Op.LINK), 4, 1, "short");
    defer gpa.free(bad);
    const br = (try dispatch(&state, bad)) orelse return error.ExpectedReply;
    defer gpa.free(br);
    try testing.expectEqual(@as(i32, -E.INVAL), std.mem.readInt(i32, br[4..8], .little));
}

test "dispatch: SETATTR FATTR_MODE applies chmod and honors :ro" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "script.sh", .data = "#!/bin/sh\necho hi\n" });

    var rw = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer rw.deinit();
    const nodeid = try test_lookup(&rw, "script.sh");
    var body: [88]u8 = @splat(0);
    std.mem.writeInt(u32, body[0..4], FATTR_MODE, .little);
    std.mem.writeInt(u32, body[68..72], 0o755, .little);
    const sf = try test_build_frame(gpa, @intFromEnum(Op.SETATTR), 1, nodeid, &body);
    defer gpa.free(sf);
    const sr = (try dispatch(&rw, sf)) orelse return error.ExpectedReply;
    defer gpa.free(sr);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, sr[4..8], .little));
    try testing.expectEqual(@as(u32, 0o755), std.mem.readInt(u32, sr[FUSE_OUT_HEADER_SIZE + 16 + 60 ..][0..4], .little) & 0o777);

    var st = std.mem.zeroes(Stat);
    var script_path_buf: [4096]u8 = undefined;
    try host_lstat(try build_abs_path(&rw, "script.sh", &script_path_buf), &st);
    try testing.expectEqual(@as(u32, 0o755), st.mode & 0o777);

    var ro = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), false);
    defer ro.deinit();
    const ro_nodeid = try test_lookup(&ro, "script.sh");
    std.mem.writeInt(u32, body[68..72], 0o600, .little);
    const rof = try test_build_frame(gpa, @intFromEnum(Op.SETATTR), 2, ro_nodeid, &body);
    defer gpa.free(rof);
    const ror = (try dispatch(&ro, rof)) orelse return error.ExpectedReply;
    defer gpa.free(ror);
    try testing.expectEqual(@as(i32, -E.ROFS), std.mem.readInt(i32, ror[4..8], .little));

    var still = std.mem.zeroes(Stat);
    var still_path_buf: [4096]u8 = undefined;
    try host_lstat(try build_abs_path(&rw, "script.sh", &still_path_buf), &still);
    try testing.expectEqual(@as(u32, 0o755), still.mode & 0o777);

    var short_body: [8]u8 = @splat(0);
    std.mem.writeInt(u32, short_body[0..4], FATTR_MODE, .little);
    const bad = try test_build_frame(gpa, @intFromEnum(Op.SETATTR), 3, nodeid, &short_body);
    defer gpa.free(bad);
    const br = (try dispatch(&rw, bad)) orelse return error.ExpectedReply;
    defer gpa.free(br);
    try testing.expectEqual(@as(i32, -E.INVAL), std.mem.readInt(i32, br[4..8], .little));
}

test "dispatch: RMDIR removes empty dirs, maps ENOTEMPTY, and respects :ro" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.createDir(std.testing.io, "empty", .default_dir);
    try tmp.dir.createDir(std.testing.io, "nonempty", .default_dir);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "nonempty/child.txt", .data = "x" });
    try tmp.dir.createDir(std.testing.io, "blocked", .default_dir);

    var state = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer state.deinit();

    const ok = try test_build_frame(gpa, @intFromEnum(Op.RMDIR), 1, 1, "empty\x00");
    defer gpa.free(ok);
    const okr = (try dispatch(&state, ok)) orelse return error.ExpectedReply;
    defer gpa.free(okr);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, okr[4..8], .little));
    try testing.expectError(error.FileNotFound, tmp.dir.access(std.testing.io, "empty", .{}));

    const nonempty = try test_build_frame(gpa, @intFromEnum(Op.RMDIR), 2, 1, "nonempty\x00");
    defer gpa.free(nonempty);
    const ner = (try dispatch(&state, nonempty)) orelse return error.ExpectedReply;
    defer gpa.free(ner);
    try testing.expectEqual(@as(i32, -E.NOTEMPTY), std.mem.readInt(i32, ner[4..8], .little));
    try tmp.dir.access(std.testing.io, "nonempty/child.txt", .{});

    const missing = try test_build_frame(gpa, @intFromEnum(Op.RMDIR), 3, 1, "missing\x00");
    defer gpa.free(missing);
    const mr = (try dispatch(&state, missing)) orelse return error.ExpectedReply;
    defer gpa.free(mr);
    try testing.expectEqual(@as(i32, -E.NOENT), std.mem.readInt(i32, mr[4..8], .little));

    var ro = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), false);
    defer ro.deinit();
    const rof = try test_build_frame(gpa, @intFromEnum(Op.RMDIR), 4, 1, "blocked\x00");
    defer gpa.free(rof);
    const ror = (try dispatch(&ro, rof)) orelse return error.ExpectedReply;
    defer gpa.free(ror);
    try testing.expectEqual(@as(i32, -E.ROFS), std.mem.readInt(i32, ror[4..8], .little));
    try tmp.dir.access(std.testing.io, "blocked", .{});

    const bad = try test_build_frame(gpa, @intFromEnum(Op.RMDIR), 5, 1, "bad/name\x00");
    defer gpa.free(bad);
    const br = (try dispatch(&state, bad)) orelse return error.ExpectedReply;
    defer gpa.free(br);
    try testing.expectEqual(@as(i32, -E.INVAL), std.mem.readInt(i32, br[4..8], .little));
}

test "dispatch: RENAME replaces an existing file, reports errors, and respects :ro" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "src.txt", .data = "source" });
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "dst.txt", .data = "dest" });

    var state = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer state.deinit();
    var body: [8 + 8 + 8]u8 = @splat(0);
    std.mem.writeInt(u64, body[0..8], 1, .little); // newdir = root
    @memcpy(body[8..][0.."src.txt".len], "src.txt");
    @memcpy(body[8 + "src.txt".len + 1 ..][0.."dst.txt".len], "dst.txt");
    const rf = try test_build_frame(gpa, @intFromEnum(Op.RENAME), 1, 1, body[0 .. 8 + "src.txt".len + 1 + "dst.txt".len + 1]);
    defer gpa.free(rf);
    const rr = (try dispatch(&state, rf)) orelse return error.ExpectedReply;
    defer gpa.free(rr);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, rr[4..8], .little));
    try testing.expectError(error.FileNotFound, tmp.dir.access(std.testing.io, "src.txt", .{}));
    const got = try tmp.dir.readFileAlloc(std.testing.io, "dst.txt", gpa, .limited(1024));
    defer gpa.free(got);
    try testing.expectEqualStrings("source", got);

    var missing_body: [8 + 16]u8 = @splat(0);
    std.mem.writeInt(u64, missing_body[0..8], 1, .little);
    @memcpy(missing_body[8..][0.."missing".len], "missing");
    @memcpy(missing_body[8 + "missing".len + 1 ..][0.."other".len], "other");
    const mf = try test_build_frame(gpa, @intFromEnum(Op.RENAME), 2, 1, missing_body[0 .. 8 + "missing".len + 1 + "other".len + 1]);
    defer gpa.free(mf);
    const mr = (try dispatch(&state, mf)) orelse return error.ExpectedReply;
    defer gpa.free(mr);
    try testing.expectEqual(@as(i32, -E.NOENT), std.mem.readInt(i32, mr[4..8], .little));

    var ro = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), false);
    defer ro.deinit();
    const rof = try test_build_frame(gpa, @intFromEnum(Op.RENAME), 3, 1, body[0 .. 8 + "src.txt".len + 1 + "dst.txt".len + 1]);
    defer gpa.free(rof);
    const ror = (try dispatch(&ro, rof)) orelse return error.ExpectedReply;
    defer gpa.free(ror);
    try testing.expectEqual(@as(i32, -E.ROFS), std.mem.readInt(i32, ror[4..8], .little));

    const bad = try test_build_frame(gpa, @intFromEnum(Op.RENAME), 4, 1, "short");
    defer gpa.free(bad);
    const br = (try dispatch(&state, bad)) orelse return error.ExpectedReply;
    defer gpa.free(br);
    try testing.expectEqual(@as(i32, -E.INVAL), std.mem.readInt(i32, br[4..8], .little));
}

test "dumpState/applyState: a file handle survives a snapshot round-trip" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    var src = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer src.deinit();
    const h = try test_create(&src, "doc.txt");

    // WRITE "snapshot-me" through the handle, onto the real host file.
    {
        var body: [FUSE_WRITE_IN_SIZE + 11]u8 = @splat(0);
        std.mem.writeInt(u64, body[0..8], h.fh, .little);
        std.mem.writeInt(u32, body[16..20], 11, .little);
        @memcpy(body[FUSE_WRITE_IN_SIZE..], "snapshot-me");
        const frame = try test_build_frame(gpa, @intFromEnum(Op.WRITE), 2, h.nodeid, &body);
        defer gpa.free(frame);
        const r = (try dispatch(&src, frame)) orelse return error.ExpectedReply;
        defer gpa.free(r);
        try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, r[4..8], .little));
    }

    const payload = try src.dump_state(gpa);
    defer gpa.free(payload);

    // A fresh State over the SAME root — a vmstate restore.
    var dst = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer dst.deinit();
    try dst.apply_state(payload);
    try testing.expectEqual(src.next_inode, dst.next_inode);
    try testing.expectEqual(src.next_handle, dst.next_handle);

    // READ through the restored handle — its fd was reopened from
    // scratch by path, but the bytes written before the snapshot are
    // still served.
    var rbody: [32]u8 = @splat(0);
    std.mem.writeInt(u64, rbody[0..8], h.fh, .little);
    std.mem.writeInt(u32, rbody[16..20], 64, .little);
    const frame = try test_build_frame(gpa, @intFromEnum(Op.READ), 3, h.nodeid, &rbody);
    defer gpa.free(frame);
    const r = (try dispatch(&dst, frame)) orelse return error.ExpectedReply;
    defer gpa.free(r);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, r[4..8], .little));
    try testing.expectEqualStrings("snapshot-me", r[FUSE_OUT_HEADER_SIZE..]);
}

test "applyState: a file removed since the snapshot restores fail-soft to EBADF" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    var src = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer src.deinit();
    const h = try test_create(&src, "gone.txt");
    const payload = try src.dump_state(gpa);
    defer gpa.free(payload);

    // The file vanishes on the host before the restore.
    try tmp.dir.deleteFile(std.testing.io, "gone.txt");

    var dst = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer dst.deinit();
    try dst.apply_state(payload); // must not error — the reopen fails soft

    // The handle still exists, but its fd is -1; READ returns EBADF
    // instead of wedging.
    var rbody: [32]u8 = @splat(0);
    std.mem.writeInt(u64, rbody[0..8], h.fh, .little);
    std.mem.writeInt(u32, rbody[16..20], 16, .little);
    const frame = try test_build_frame(gpa, @intFromEnum(Op.READ), 1, h.nodeid, &rbody);
    defer gpa.free(frame);
    const r = (try dispatch(&dst, frame)) orelse return error.ExpectedReply;
    defer gpa.free(r);
    try testing.expectEqual(@as(i32, -E.BADF), std.mem.readInt(i32, r[4..8], .little));
}

test "dumpState/applyState: a :ro mount round-trips and stays read-only" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    // Seed "data.txt" on the host via a throwaway rw state.
    {
        var rw = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
        defer rw.deinit();
        const h = try test_create(&rw, "data.txt");
        var wbody: [FUSE_WRITE_IN_SIZE + 4]u8 = @splat(0);
        std.mem.writeInt(u64, wbody[0..8], h.fh, .little);
        std.mem.writeInt(u32, wbody[16..20], 4, .little);
        @memcpy(wbody[FUSE_WRITE_IN_SIZE..], "ABCD");
        const wf = try test_build_frame(gpa, @intFromEnum(Op.WRITE), 1, h.nodeid, &wbody);
        defer gpa.free(wf);
        gpa.free((try dispatch(&rw, wf)).?);
    }

    // A :ro mount LOOKUPs + OPENs it read-only.
    var src = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), false);
    defer src.deinit();
    {
        const lf = try test_build_frame(gpa, @intFromEnum(Op.LOOKUP), 1, 1, "data.txt\x00");
        defer gpa.free(lf);
        gpa.free((try dispatch(&src, lf)).?);
    }
    var obody: [8]u8 = @splat(0);
    std.mem.writeInt(u32, obody[0..4], LINUX_O_RDONLY, .little);
    const of = try test_build_frame(gpa, @intFromEnum(Op.OPEN), 2, 2, &obody); // nodeid 2 = data.txt
    defer gpa.free(of);
    const orep = (try dispatch(&src, of)) orelse return error.ExpectedReply;
    const fh = std.mem.readInt(u64, orep[FUSE_OUT_HEADER_SIZE..][0..8], .little);
    gpa.free(orep);

    const payload = try src.dump_state(gpa);
    defer gpa.free(payload);

    // Restore onto a State the boot path created as rw — `applyState`
    // must override `mode_rw` with the snapshot's `:ro`.
    var dst = try State.init(gpa, try test_tmp_root_abs(gpa, &tmp), true);
    defer dst.deinit();
    try dst.apply_state(payload);
    try testing.expectEqual(false, dst.mode_rw);

    // READ through the restored handle works — the fd was reopened
    // O_RDONLY.
    var rbody: [32]u8 = @splat(0);
    std.mem.writeInt(u64, rbody[0..8], fh, .little);
    std.mem.writeInt(u32, rbody[16..20], 8, .little);
    const rf = try test_build_frame(gpa, @intFromEnum(Op.READ), 3, 2, &rbody);
    defer gpa.free(rf);
    const rr = (try dispatch(&dst, rf)) orelse return error.ExpectedReply;
    defer gpa.free(rr);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, rr[4..8], .little));
    try testing.expectEqualStrings("ABCD", rr[FUSE_OUT_HEADER_SIZE..]);

    // WRITE is still rejected — the `:ro` gate fires on `mode_rw`.
    var wbody: [FUSE_WRITE_IN_SIZE + 1]u8 = @splat(0);
    std.mem.writeInt(u64, wbody[0..8], fh, .little);
    std.mem.writeInt(u32, wbody[16..20], 1, .little);
    const wf = try test_build_frame(gpa, @intFromEnum(Op.WRITE), 4, 2, &wbody);
    defer gpa.free(wf);
    const wr = (try dispatch(&dst, wf)) orelse return error.ExpectedReply;
    defer gpa.free(wr);
    try testing.expectEqual(@as(i32, -E.ROFS), std.mem.readInt(i32, wr[4..8], .little));
}

test "applyState: a malformed payload is rejected, leaving the State usable" {
    const gpa = testing.allocator;
    var state = try test_state(gpa, true);
    defer state.deinit();

    // Truncated and bad-magic payloads must come back as errors — and
    // `applyState` returns before touching the live maps, so a wedged
    // VMM thread is impossible.
    try testing.expectError(error.Truncated, state.apply_state("xx"));
    var bad: [fuse_state.HEADER_SIZE]u8 = @splat(0);
    try testing.expectError(error.BadMagic, state.apply_state(&bad));

    // The State is still intact afterwards: dumpState still succeeds
    // and the root inode is still seeded.
    const ok = try state.dump_state(gpa);
    defer gpa.free(ok);
    var d = try fuse_state.decode(gpa, ok);
    defer d.deinit();
    try testing.expectEqual(@as(usize, 1), d.inodes.len);
}
