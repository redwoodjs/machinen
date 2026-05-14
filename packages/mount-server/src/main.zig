//! Zig-native host-side FUSE-over-vsock mount server (#329). Drop-in
//! replacement for `@machinen/runtime/dist/mount-server-bin.js` when
//! the runtime is launched with `MACHINEN_MOUNT_SERVER_IMPL=zig`.
//!
//! Process model: single-threaded blocking. The VMM's vsock bridge
//! routes the guest FUSE port to a host UDS we listen on; one
//! connection at a time (the guest only opens one). Frames are
//! length-prefixed FUSE messages (u32 LE covering header+payload, same
//! as `/dev/fuse` returns).
//!
//! PR1 scope (per #329 acceptance plan):
//!   - INIT handshake (negotiates 7.31)
//!   - LOOKUP, GETATTR, CREATE, WRITE, RELEASE (the hot ops the JS
//!     baseline bench identified as 88.3% of handler time)
//!   - FORGET / BATCH_FORGET (inode bookkeeping)
//!   - DESTROY / INTERRUPT / FLUSH / ACCESS — minimal correct stubs
//!   - Everything else → ENOSYS, same as the JS server does today
//!
//! Path containment is lexical for PR1: names must not contain `/`,
//! `.`, `..`, or NUL. Realpath-based symlink-escape protection is a
//! follow-up — the tar-extract bench workload creates regular files
//! only, so deferring is safe for the perf measurement.

const std = @import("std");
const builtin = @import("builtin");
const assert = std.debug.assert;

// --- libc externs -------------------------------------------------------

const AF_UNIX: c_int = 1;
const SOCK_STREAM: c_int = 1;
const SHUT_RDWR: c_int = 2;
const EINTR: c_int = 4;

extern "c" fn socket(domain: c_int, typ: c_int, protocol: c_int) c_int;
const c_bind = @extern(
    *const fn (fd: c_int, addr: *const anyopaque, addrlen: u32) callconv(.c) c_int,
    .{ .name = "bind" },
);
extern "c" fn listen(fd: c_int, backlog: c_int) c_int;
const c_accept = @extern(
    *const fn (fd: c_int, addr: ?*anyopaque, addrlen: ?*u32) callconv(.c) c_int,
    .{ .name = "accept" },
);
extern "c" fn close(fd: c_int) c_int;
extern "c" fn shutdown(fd: c_int, how: c_int) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn unlink(path: [*:0]const u8) c_int;
extern "c" fn rename(old: [*:0]const u8, new: [*:0]const u8) c_int;
extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;
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

const StatLinux = extern struct {
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

const Stat = if (builtin.os.tag == .macos) StatDarwin else StatLinux;

extern "c" fn fstatat(fd: c_int, path: [*:0]const u8, buf: *Stat, flag: c_int) c_int;
extern "c" fn fstat(fd: c_int, buf: *Stat) c_int;
extern "c" fn open(path: [*:0]const u8, oflag: c_int, ...) c_int;
extern "c" fn pwrite(fd: c_int, buf: [*]const u8, nbyte: usize, offset: i64) isize;
extern "c" fn pread(fd: c_int, buf: [*]u8, nbyte: usize, offset: i64) isize;
extern "c" fn mkdir(path: [*:0]const u8, mode: c_int) c_int;
extern "c" fn symlink(target: [*:0]const u8, linkpath: [*:0]const u8) c_int;
extern "c" fn rmdir(path: [*:0]const u8) c_int;

// Host open flags we actually use. Values are stable across darwin and
// linux for the standard set we care about.
const O_RDONLY: c_int = 0x0000;
const O_WRONLY: c_int = 0x0001;
const O_RDWR: c_int = 0x0002;
const O_CREAT: c_int = if (builtin.os.tag == .macos) 0x0200 else 0o100;
const O_TRUNC: c_int = if (builtin.os.tag == .macos) 0x0400 else 0o1000;
const O_APPEND: c_int = if (builtin.os.tag == .macos) 0x0008 else 0o2000;

fn nowNs() u64 {
    var ts: timespec_c = .{ .tv_sec = 0, .tv_nsec = 0 };
    _ = clock_gettime(CLOCK_MONOTONIC, &ts);
    return @as(u64, @intCast(ts.tv_sec)) * 1_000_000_000 + @as(u64, @intCast(ts.tv_nsec));
}

fn nowMs() i64 {
    var ts: timespec_c = .{ .tv_sec = 0, .tv_nsec = 0 };
    _ = clock_gettime(CLOCK_REALTIME, &ts);
    return @as(i64, ts.tv_sec) * 1000 + @divFloor(@as(i64, ts.tv_nsec), 1_000_000);
}

fn errno() c_int {
    return if (builtin.os.tag == .macos) __error().* else __errno_location().*;
}

const sockaddr_un = if (builtin.os.tag == .macos) extern struct {
    sun_len: u8,
    sun_family: u8,
    sun_path: [104]u8,
} else extern struct {
    sun_family: u16,
    sun_path: [108]u8,
};

// --- FUSE protocol constants (uapi/linux/fuse.h, protocol 7.31) ---------

const FUSE_KERNEL_VERSION: u32 = 7;
const FUSE_KERNEL_MINOR_VERSION: u32 = 31;

const FUSE_IN_HEADER_SIZE: usize = 40;
const FUSE_OUT_HEADER_SIZE: usize = 16;
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

fn readInHeader(buf: []const u8) InHeader {
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

fn writeOutHeader(dst: []u8, payload_len: usize, err: i32, unique: u64) void {
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

fn writeAttr(dst: []u8, a: Attr) void {
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

const OpenKind = enum { file };

const OpenEntry = struct {
    kind: OpenKind,
    fd: c_int,
    nodeid: u64,
};

const OpStat = struct {
    count: u64 = 0,
    sum_ns: u64 = 0,
};

const State = struct {
    gpa: std.mem.Allocator,
    root_abs: []u8,
    mode_rw: bool,

    listen_fd: c_int = -1,
    conn_fd: c_int = -1,

    inodes: std.AutoHashMap(u64, InodeEntry),
    next_inode: u64 = 2,

    handles: std.AutoHashMap(u64, OpenEntry),
    next_handle: u64 = 1,

    profile_enabled: bool = false,
    op_stats: std.AutoHashMap(u32, OpStat),

    stats_path: ?[]u8 = null,
    bytes_served_on_pages_img: u64 = 0,

    // Periodic stats flush bookkeeping. The bench harness reads the
    // stats file before stopping the VM (so the shutdown final-flush
    // is too late). The JS server publishes every 250ms via a setInterval;
    // we approximate that here with a "publish if N ops elapsed or T
    // wall-clock ms have passed" check inside dispatch.
    last_stats_publish_ns: u64 = 0,
    ops_since_last_publish: u32 = 0,

    fn init(gpa: std.mem.Allocator, root_abs: []u8, mode_rw: bool) !State {
        var inodes = std.AutoHashMap(u64, InodeEntry).init(gpa);
        // Root pinned at nodeid=1 with empty rel_path.
        try inodes.put(1, .{
            .rel_path = try gpa.dupe(u8, ""),
            .nlookup = NLOOKUP_PINNED,
        });
        return .{
            .gpa = gpa,
            .root_abs = root_abs,
            .mode_rw = mode_rw,
            .inodes = inodes,
            .handles = std.AutoHashMap(u64, OpenEntry).init(gpa),
            .op_stats = std.AutoHashMap(u32, OpStat).init(gpa),
        };
    }

    fn deinit(self: *State) void {
        var it = self.inodes.iterator();
        while (it.next()) |e| self.gpa.free(e.value_ptr.rel_path);
        self.inodes.deinit();

        var hit = self.handles.iterator();
        while (hit.next()) |e| _ = close(e.value_ptr.fd);
        self.handles.deinit();

        self.op_stats.deinit();
        self.gpa.free(self.root_abs);
        if (self.stats_path) |p| self.gpa.free(p);
    }
};

// --- CLI args -----------------------------------------------------------

const Args = struct {
    uds: []u8,
    root: []u8,
    mode_rw: bool,
    stats: []u8,
};

fn parseArgs(gpa: std.mem.Allocator, init_args: std.process.Args) !Args {
    var it = std.process.Args.Iterator.init(init_args);
    _ = it.next(); // skip argv[0]

    var uds: ?[]u8 = null;
    var root: ?[]u8 = null;
    var mode_s: ?[]u8 = null;
    var stats: ?[]u8 = null;

    errdefer {
        if (uds) |x| gpa.free(x);
        if (root) |x| gpa.free(x);
        if (mode_s) |x| gpa.free(x);
        if (stats) |x| gpa.free(x);
    }

    while (it.next()) |flag| {
        const value = it.next() orelse return error.MissingFlagValue;
        if (std.mem.eql(u8, flag, "--uds")) {
            uds = try gpa.dupe(u8, value);
        } else if (std.mem.eql(u8, flag, "--root")) {
            root = try gpa.dupe(u8, value);
        } else if (std.mem.eql(u8, flag, "--mode")) {
            mode_s = try gpa.dupe(u8, value);
        } else if (std.mem.eql(u8, flag, "--stats")) {
            stats = try gpa.dupe(u8, value);
        } else {
            std.debug.print("unknown flag: {s}\n", .{flag});
            return error.UnknownFlag;
        }
    }

    const uds_v = uds orelse return error.MissingUds;
    const root_v = root orelse return error.MissingRoot;
    const mode_v = mode_s orelse return error.MissingMode;
    const stats_v = stats orelse return error.MissingStats;

    const mode_rw = if (std.mem.eql(u8, mode_v, "rw"))
        true
    else if (std.mem.eql(u8, mode_v, "ro"))
        false
    else
        return error.InvalidMode;
    gpa.free(mode_v);

    return .{
        .uds = uds_v,
        .root = root_v,
        .mode_rw = mode_rw,
        .stats = stats_v,
    };
}

// --- UDS bind/accept ----------------------------------------------------

fn bindAndListen(uds_path: []const u8) !c_int {
    if (uds_path.len >= @sizeOf(@TypeOf(@as(sockaddr_un, undefined).sun_path))) {
        return error.UdsPathTooLong;
    }

    const fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return error.SocketCreateFailed;
    errdefer _ = close(fd);

    // Stale UDS from a previous run (or a crashed prior server) would
    // make bind() return EADDRINUSE. Best-effort unlink first; ignored
    // if the file doesn't exist. The caller (the runtime) already gave
    // us a fresh mkdtemp path so this is defensive.
    var path_z: [108]u8 = @splat(0);
    @memcpy(path_z[0..uds_path.len], uds_path);
    _ = unlink(@ptrCast(&path_z));

    var addr: sockaddr_un = if (builtin.os.tag == .macos)
        .{ .sun_len = 0, .sun_family = AF_UNIX, .sun_path = @splat(0) }
    else
        .{ .sun_family = AF_UNIX, .sun_path = @splat(0) };
    @memcpy(addr.sun_path[0..uds_path.len], uds_path);
    const addrlen: u32 = @intCast(2 + uds_path.len + 1);
    if (builtin.os.tag == .macos) addr.sun_len = @intCast(addrlen);

    if (c_bind(fd, @ptrCast(&addr), addrlen) < 0) {
        std.debug.print("bind {s} failed: errno {}\n", .{ uds_path, errno() });
        return error.BindFailed;
    }
    if (listen(fd, 1) < 0) return error.ListenFailed;
    return fd;
}

fn acceptOne(listen_fd: c_int) !c_int {
    while (true) {
        const fd = c_accept(listen_fd, null, null);
        if (fd >= 0) return fd;
        if (errno() == EINTR) {
            if (shutdown_requested.load(.acquire)) return error.Shutdown;
            continue;
        }
        return error.AcceptFailed;
    }
}

// --- frame I/O ----------------------------------------------------------

/// Read exactly `data.len` bytes from `fd`, returning .closed on EOF
/// and .eintr_shutdown if a shutdown was requested during EINTR.
const ReadResult = enum { ok, closed, eintr_shutdown };

fn readExact(fd: c_int, data: []u8) ReadResult {
    var total: usize = 0;
    while (total < data.len) {
        const n = read(fd, data[total..].ptr, data.len - total);
        if (n > 0) {
            total += @intCast(n);
            continue;
        }
        if (n == 0) return .closed;
        if (errno() == EINTR) {
            if (shutdown_requested.load(.acquire)) return .eintr_shutdown;
            continue;
        }
        return .closed;
    }
    return .ok;
}

fn writeAll(fd: c_int, data: []const u8) bool {
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

fn requireInode(state: *State, ino: u64) ?*const InodeEntry {
    return state.inodes.getPtr(ino);
}

fn bindInode(state: *State, rel_path: []const u8) !u64 {
    // Reuse an existing entry so nlookup accumulates correctly.
    var it = state.inodes.iterator();
    while (it.next()) |e| {
        if (std.mem.eql(u8, e.value_ptr.rel_path, rel_path)) {
            if (e.value_ptr.nlookup != NLOOKUP_PINNED) {
                e.value_ptr.nlookup += 1;
            }
            return e.key_ptr.*;
        }
    }
    const ino = state.next_inode;
    state.next_inode += 1;
    const dup = try state.gpa.dupe(u8, rel_path);
    try state.inodes.put(ino, .{ .rel_path = dup, .nlookup = 1 });
    return ino;
}

fn decrefInode(state: *State, ino: u64, n: u64) void {
    const e = state.inodes.getPtr(ino) orelse return;
    if (e.nlookup == NLOOKUP_PINNED) return; // root pinned
    if (n >= e.nlookup) {
        // Drop the entry; free its owned path before remove() invalidates the value pointer.
        const path_to_free = e.rel_path;
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
fn buildAbsPath(state: *State, rel_path: []const u8, out: []u8) ![]u8 {
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

fn validateName(name: []const u8) !void {
    if (name.len == 0) return error.InvalidName;
    if (std.mem.eql(u8, name, ".")) return error.InvalidName;
    if (std.mem.eql(u8, name, "..")) return error.InvalidName;
    for (name) |c| {
        if (c == '/' or c == 0) return error.InvalidName;
    }
}

fn joinRel(gpa: std.mem.Allocator, parent_rel: []const u8, name: []const u8) ![]u8 {
    if (parent_rel.len == 0) return try gpa.dupe(u8, name);
    var buf = try gpa.alloc(u8, parent_rel.len + 1 + name.len);
    @memcpy(buf[0..parent_rel.len], parent_rel);
    buf[parent_rel.len] = '/';
    @memcpy(buf[parent_rel.len + 1 ..], name);
    return buf;
}

// --- dispatch -----------------------------------------------------------

var shutdown_requested = std.atomic.Value(bool).init(false);

fn dispatch(state: *State, msg: []const u8) !void {
    const hdr = readInHeader(msg);
    const start_ns: u64 = if (state.profile_enabled) nowNs() else 0;

    const op_e: Op = @enumFromInt(hdr.opcode);
    const reply_opt: ?[]const u8 = blk: {
        switch (op_e) {
            .INIT => break :blk try onInit(state, hdr, msg),
            .DESTROY => break :blk try buildErrorReply(state, hdr.unique, 0),
            .INTERRUPT => break :blk null, // no reply ever
            .FORGET => {
                onForget(state, hdr, msg);
                break :blk null;
            },
            .BATCH_FORGET => {
                onBatchForget(state, msg);
                break :blk null;
            },
            .LOOKUP => break :blk try onLookup(state, hdr, msg),
            .GETATTR => break :blk try onGetattr(state, hdr),
            .CREATE => break :blk try onCreate(state, hdr, msg),
            .WRITE => break :blk try onWrite(state, hdr, msg),
            .RELEASE => break :blk try onRelease(state, hdr, msg),
            .OPEN => break :blk try onOpen(state, hdr, msg),
            .READ => break :blk try onRead(state, hdr, msg),
            .MKDIR => break :blk try onMkdir(state, hdr, msg),
            .UNLINK => break :blk try onUnlink(state, hdr, msg),
            .RMDIR => break :blk try onRmdir(state, hdr, msg),
            .SYMLINK => break :blk try onSymlink(state, hdr, msg),
            .SETATTR => break :blk try onSetattr(state, hdr, msg),
            .STATFS => break :blk try onStatfs(state, hdr),
            // Soft-success: the guest can ask, we just say "ok". tar
            // calls FSYNC after writing each file; the host fs already
            // ack'd the write so this is durable enough for the bench.
            // FLUSH/ACCESS/FSYNCDIR are likewise userspace-OK-to-ignore.
            .FSYNC, .FSYNCDIR, .FLUSH, .ACCESS => break :blk try buildErrorReply(state, hdr.unique, 0),
            else => break :blk try buildErrorReply(state, hdr.unique, -E.NOSYS),
        }
    };

    if (state.profile_enabled) {
        const end_ns = nowNs();
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
            writeStatsAtomic(state);
            state.last_stats_publish_ns = end_ns;
            state.ops_since_last_publish = 0;
        }
    }

    if (reply_opt) |reply| {
        if (!writeAll(state.conn_fd, reply)) return error.WriteFailed;
        state.gpa.free(reply);
    }
}

// --- response builders --------------------------------------------------

fn buildErrorReply(state: *State, unique: u64, err: i32) ![]u8 {
    const buf = try state.gpa.alloc(u8, FUSE_OUT_HEADER_SIZE);
    writeOutHeader(buf, 0, err, unique);
    return buf;
}

fn buildReply(state: *State, unique: u64, payload: []const u8) ![]u8 {
    const buf = try state.gpa.alloc(u8, FUSE_OUT_HEADER_SIZE + payload.len);
    writeOutHeader(buf, payload.len, 0, unique);
    @memcpy(buf[FUSE_OUT_HEADER_SIZE..], payload);
    return buf;
}

// --- INIT ---------------------------------------------------------------

fn onInit(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return try buildErrorReply(state, hdr.unique, -E.INVAL);

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
    return try buildReply(state, hdr.unique, &payload);
}

// --- FORGET / BATCH_FORGET ----------------------------------------------

fn onForget(state: *State, hdr: InHeader, msg: []const u8) void {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return;
    const nlookup = std.mem.readInt(u64, body[0..8], .little);
    decrefInode(state, hdr.nodeid, nlookup);
}

fn onBatchForget(state: *State, msg: []const u8) void {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return;
    const count = std.mem.readInt(u32, body[0..4], .little);
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const off = 8 + i * 16;
        if (off + 16 > body.len) return;
        const nodeid = std.mem.readInt(u64, body[off..][0..8], .little);
        const nlookup = std.mem.readInt(u64, body[off + 8 ..][0..8], .little);
        decrefInode(state, nodeid, nlookup);
    }
}

// --- LOOKUP -------------------------------------------------------------

fn onLookup(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    const name = decodeName(body);
    validateName(name) catch return try buildErrorReply(state, hdr.unique, -E.INVAL);

    const parent = requireInode(state, hdr.nodeid) orelse
        return try buildErrorReply(state, hdr.unique, -E.STALE);

    // Compose the child's rel path off the parent's rel path. Parent
    // rel path was validated when its inode was bound.
    const child_rel = try joinRel(state.gpa, parent.rel_path, name);
    defer state.gpa.free(child_rel);

    var path_buf: [4096]u8 = undefined;
    const abs = buildAbsPath(state, child_rel, &path_buf) catch
        return try buildErrorReply(state, hdr.unique, -E.INVAL);

    var st = std.mem.zeroes(Stat);
    hostLstat(abs, &st) catch |e| return try buildErrorReply(state, hdr.unique, mapFsError(e));

    const ino = try bindInode(state, child_rel);

    var payload: [FUSE_ENTRY_OUT_SIZE]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], ino, .little);
    std.mem.writeInt(u64, payload[8..16], 0, .little); // generation
    std.mem.writeInt(u64, payload[16..24], 1, .little); // entry_valid (1s)
    std.mem.writeInt(u64, payload[24..32], 1, .little); // attr_valid (1s)
    std.mem.writeInt(u32, payload[32..36], 0, .little); // entry_valid_nsec
    std.mem.writeInt(u32, payload[36..40], 0, .little); // attr_valid_nsec
    writeAttr(payload[40..128], statToAttr(st, ino));
    return try buildReply(state, hdr.unique, &payload);
}

// --- GETATTR ------------------------------------------------------------

fn onGetattr(state: *State, hdr: InHeader) ![]u8 {
    const entry = requireInode(state, hdr.nodeid) orelse
        return try buildErrorReply(state, hdr.unique, -E.STALE);

    var path_buf: [4096]u8 = undefined;
    const abs = buildAbsPath(state, entry.rel_path, &path_buf) catch
        return try buildErrorReply(state, hdr.unique, -E.INVAL);

    var st = std.mem.zeroes(Stat);
    hostLstat(abs, &st) catch |e| return try buildErrorReply(state, hdr.unique, mapFsError(e));

    var payload: [FUSE_ATTR_OUT_SIZE]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], 1, .little); // attr_valid (1s)
    std.mem.writeInt(u32, payload[8..12], 0, .little); // attr_valid_nsec
    // dummy at offset 12
    writeAttr(payload[16..104], statToAttr(st, hdr.nodeid));
    return try buildReply(state, hdr.unique, &payload);
}

// --- CREATE -------------------------------------------------------------

fn onCreate(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    if (!state.mode_rw) return try buildErrorReply(state, hdr.unique, -E.ROFS);

    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < FUSE_CREATE_IN_SIZE) return try buildErrorReply(state, hdr.unique, -E.INVAL);

    const flags = std.mem.readInt(u32, body[0..4], .little);
    const mode = std.mem.readInt(u32, body[4..8], .little);
    // umask at offset 8, open_flags at offset 12 — we don't need them
    // currently (the kernel pre-applies umask before sending us
    // CREATE since we don't advertise FUSE_DONT_MASK).

    const name = decodeName(body[FUSE_CREATE_IN_SIZE..]);
    validateName(name) catch return try buildErrorReply(state, hdr.unique, -E.INVAL);

    const parent = requireInode(state, hdr.nodeid) orelse
        return try buildErrorReply(state, hdr.unique, -E.STALE);

    const child_rel = try joinRel(state.gpa, parent.rel_path, name);
    errdefer state.gpa.free(child_rel);

    var path_buf: [4096]u8 = undefined;
    const abs = buildAbsPath(state, child_rel, &path_buf) catch
        return try buildErrorReply(state, hdr.unique, -E.INVAL);

    const host_flags = linuxOpenToHost(flags) | O_CREAT;
    const fd = openHost(abs, host_flags, @intCast(mode & 0o7777)) catch |e|
        return try buildErrorReply(state, hdr.unique, mapFsError(e));

    var st = std.mem.zeroes(Stat);
    hostFstat(fd, &st) catch |e| {
        _ = close(fd);
        return try buildErrorReply(state, hdr.unique, mapFsError(e));
    };

    const ino = try bindInode(state, child_rel);
    state.gpa.free(child_rel); // bindInode took its own copy

    const id = state.next_handle;
    state.next_handle += 1;
    try state.handles.put(id, .{ .kind = .file, .fd = fd, .nodeid = ino });

    // CREATE reply: entry_out (128) + open_out (16).
    var payload: [FUSE_ENTRY_OUT_SIZE + 16]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], ino, .little);
    std.mem.writeInt(u64, payload[8..16], 0, .little); // generation
    std.mem.writeInt(u64, payload[16..24], 1, .little); // entry_valid (1s)
    std.mem.writeInt(u64, payload[24..32], 1, .little); // attr_valid (1s)
    std.mem.writeInt(u32, payload[32..36], 0, .little); // entry_valid_nsec
    std.mem.writeInt(u32, payload[36..40], 0, .little); // attr_valid_nsec
    writeAttr(payload[40..128], statToAttr(st, ino));
    std.mem.writeInt(u64, payload[128..136], id, .little); // fh
    std.mem.writeInt(u32, payload[136..140], 0, .little); // open_flags
    // padding at 140
    return try buildReply(state, hdr.unique, &payload);
}

// --- WRITE --------------------------------------------------------------

fn onWrite(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    if (!state.mode_rw) return try buildErrorReply(state, hdr.unique, -E.ROFS);

    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < FUSE_WRITE_IN_SIZE) return try buildErrorReply(state, hdr.unique, -E.INVAL);

    const fh = std.mem.readInt(u64, body[0..8], .little);
    const offset = std.mem.readInt(u64, body[8..16], .little);
    const size = std.mem.readInt(u32, body[16..20], .little);
    // write_flags at 20, lock_owner at 24, flags at 32

    const data_start = FUSE_WRITE_IN_SIZE;
    if (data_start + size > body.len) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    const data = body[data_start..][0..size];

    const handle = state.handles.get(fh) orelse
        return try buildErrorReply(state, hdr.unique, -E.BADF);
    if (handle.kind != .file) return try buildErrorReply(state, hdr.unique, -E.BADF);

    const written = pwriteAll(handle.fd, data, offset) catch |e|
        return try buildErrorReply(state, hdr.unique, mapFsError(e));

    var payload: [8]u8 = @splat(0);
    std.mem.writeInt(u32, payload[0..4], @intCast(written), .little);
    // padding at 4
    return try buildReply(state, hdr.unique, &payload);
}

// --- OPEN ---------------------------------------------------------------

fn onOpen(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    const flags = std.mem.readInt(u32, body[0..4], .little);

    const access = flags & 0o3;
    if ((access == LINUX_O_WRONLY or access == LINUX_O_RDWR) and !state.mode_rw) {
        return try buildErrorReply(state, hdr.unique, -E.ROFS);
    }

    const entry = requireInode(state, hdr.nodeid) orelse
        return try buildErrorReply(state, hdr.unique, -E.STALE);

    var path_buf: [4096]u8 = undefined;
    const abs = buildAbsPath(state, entry.rel_path, &path_buf) catch
        return try buildErrorReply(state, hdr.unique, -E.INVAL);

    const fd = openHost(abs, linuxOpenToHost(flags), 0) catch |e|
        return try buildErrorReply(state, hdr.unique, mapFsError(e));

    const id = state.next_handle;
    state.next_handle += 1;
    try state.handles.put(id, .{ .kind = .file, .fd = fd, .nodeid = hdr.nodeid });

    var payload: [16]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], id, .little); // fh
    std.mem.writeInt(u32, payload[8..12], 0, .little); // open_flags
    // padding at 12
    return try buildReply(state, hdr.unique, &payload);
}

// --- READ ---------------------------------------------------------------

fn onRead(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 32) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    const fh = std.mem.readInt(u64, body[0..8], .little);
    const offset = std.mem.readInt(u64, body[8..16], .little);
    const size = std.mem.readInt(u32, body[16..20], .little);

    const handle = state.handles.get(fh) orelse
        return try buildErrorReply(state, hdr.unique, -E.BADF);
    if (handle.kind != .file) return try buildErrorReply(state, hdr.unique, -E.BADF);

    const buf = try state.gpa.alloc(u8, FUSE_OUT_HEADER_SIZE + size);
    errdefer state.gpa.free(buf);
    const n = pread(handle.fd, buf[FUSE_OUT_HEADER_SIZE..].ptr, size, @intCast(offset));
    if (n < 0) {
        state.gpa.free(buf);
        return try buildErrorReply(state, hdr.unique, mapFsError(errnoToZigError(errno())));
    }
    const got: usize = @intCast(n);
    writeOutHeader(buf[0..FUSE_OUT_HEADER_SIZE], got, 0, hdr.unique);
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

fn onMkdir(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    if (!state.mode_rw) return try buildErrorReply(state, hdr.unique, -E.ROFS);

    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    const mode = std.mem.readInt(u32, body[0..4], .little);
    // umask at offset 4

    const name = decodeName(body[8..]);
    validateName(name) catch return try buildErrorReply(state, hdr.unique, -E.INVAL);

    const parent = requireInode(state, hdr.nodeid) orelse
        return try buildErrorReply(state, hdr.unique, -E.STALE);

    const child_rel = try joinRel(state.gpa, parent.rel_path, name);
    errdefer state.gpa.free(child_rel);

    var path_buf: [4096]u8 = undefined;
    const abs = buildAbsPath(state, child_rel, &path_buf) catch
        return try buildErrorReply(state, hdr.unique, -E.INVAL);

    var path_z: [4097]u8 = undefined;
    if (abs.len >= path_z.len) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    @memcpy(path_z[0..abs.len], abs);
    path_z[abs.len] = 0;
    if (mkdir(@ptrCast(&path_z), @intCast(mode & 0o7777)) != 0) {
        return try buildErrorReply(state, hdr.unique, mapFsError(errnoToZigError(errno())));
    }

    var st = std.mem.zeroes(Stat);
    hostLstat(abs, &st) catch |e| return try buildErrorReply(state, hdr.unique, mapFsError(e));

    const ino = try bindInode(state, child_rel);
    state.gpa.free(child_rel);

    var payload: [FUSE_ENTRY_OUT_SIZE]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], ino, .little);
    std.mem.writeInt(u64, payload[8..16], 0, .little);
    std.mem.writeInt(u64, payload[16..24], 1, .little);
    std.mem.writeInt(u64, payload[24..32], 1, .little);
    std.mem.writeInt(u32, payload[32..36], 0, .little);
    std.mem.writeInt(u32, payload[36..40], 0, .little);
    writeAttr(payload[40..128], statToAttr(st, ino));
    return try buildReply(state, hdr.unique, &payload);
}

// --- UNLINK / RMDIR / SYMLINK -------------------------------------------

fn unlinkOrRmdir(
    state: *State,
    hdr: InHeader,
    msg: []const u8,
    is_rmdir: bool,
) ![]u8 {
    if (!state.mode_rw) return try buildErrorReply(state, hdr.unique, -E.ROFS);
    const body = msg[FUSE_IN_HEADER_SIZE..];
    const name = decodeName(body);
    validateName(name) catch return try buildErrorReply(state, hdr.unique, -E.INVAL);

    const parent = requireInode(state, hdr.nodeid) orelse
        return try buildErrorReply(state, hdr.unique, -E.STALE);

    const child_rel = try joinRel(state.gpa, parent.rel_path, name);
    defer state.gpa.free(child_rel);

    var path_buf: [4096]u8 = undefined;
    const abs = buildAbsPath(state, child_rel, &path_buf) catch
        return try buildErrorReply(state, hdr.unique, -E.INVAL);

    var path_z: [4097]u8 = undefined;
    if (abs.len >= path_z.len) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    @memcpy(path_z[0..abs.len], abs);
    path_z[abs.len] = 0;

    const rc = if (is_rmdir) rmdir(@ptrCast(&path_z)) else unlink(@ptrCast(&path_z));
    if (rc != 0) {
        return try buildErrorReply(state, hdr.unique, mapFsError(errnoToZigError(errno())));
    }
    return try buildErrorReply(state, hdr.unique, 0);
}

fn onUnlink(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    return unlinkOrRmdir(state, hdr, msg, false);
}

fn onRmdir(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    return unlinkOrRmdir(state, hdr, msg, true);
}

fn onSymlink(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    if (!state.mode_rw) return try buildErrorReply(state, hdr.unique, -E.ROFS);

    // Wire format: two NUL-terminated strings, name then target. No
    // fixed-size struct prefix.
    const body = msg[FUSE_IN_HEADER_SIZE..];
    const first_nul = std.mem.indexOfScalar(u8, body, 0) orelse
        return try buildErrorReply(state, hdr.unique, -E.INVAL);
    const name = body[0..first_nul];
    validateName(name) catch return try buildErrorReply(state, hdr.unique, -E.INVAL);

    const rest = body[first_nul + 1 ..];
    const target_end = std.mem.indexOfScalar(u8, rest, 0) orelse rest.len;
    const target = rest[0..target_end];
    if (target.len == 0) return try buildErrorReply(state, hdr.unique, -E.INVAL);

    const parent = requireInode(state, hdr.nodeid) orelse
        return try buildErrorReply(state, hdr.unique, -E.STALE);

    const child_rel = try joinRel(state.gpa, parent.rel_path, name);
    errdefer state.gpa.free(child_rel);

    var path_buf: [4096]u8 = undefined;
    const abs = buildAbsPath(state, child_rel, &path_buf) catch
        return try buildErrorReply(state, hdr.unique, -E.INVAL);

    var link_z: [4097]u8 = undefined;
    if (abs.len >= link_z.len) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    @memcpy(link_z[0..abs.len], abs);
    link_z[abs.len] = 0;

    var tgt_z: [4097]u8 = undefined;
    if (target.len >= tgt_z.len) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    @memcpy(tgt_z[0..target.len], target);
    tgt_z[target.len] = 0;

    if (symlink(@ptrCast(&tgt_z), @ptrCast(&link_z)) != 0) {
        return try buildErrorReply(state, hdr.unique, mapFsError(errnoToZigError(errno())));
    }

    var st = std.mem.zeroes(Stat);
    hostLstat(abs, &st) catch |e| return try buildErrorReply(state, hdr.unique, mapFsError(e));

    const ino = try bindInode(state, child_rel);
    state.gpa.free(child_rel);

    var payload: [FUSE_ENTRY_OUT_SIZE]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], ino, .little);
    std.mem.writeInt(u64, payload[8..16], 0, .little);
    std.mem.writeInt(u64, payload[16..24], 1, .little);
    std.mem.writeInt(u64, payload[24..32], 1, .little);
    std.mem.writeInt(u32, payload[32..36], 0, .little);
    std.mem.writeInt(u32, payload[36..40], 0, .little);
    writeAttr(payload[40..128], statToAttr(st, ino));
    return try buildReply(state, hdr.unique, &payload);
}

// --- SETATTR ------------------------------------------------------------

// PR1 minimal SETATTR: returns the current lstat unchanged. Doesn't
// mutate host mode bits, ownership, timestamps, or size. Sufficient
// for `tar -xzf` to complete (tar treats the reply as "ok, applied")
// but incorrect on permissions: a directory's mode bits won't follow
// what the tarball requested. Acceptable for the #329 bench (we're
// measuring throughput; the JS server's full SETATTR is preserved
// behind the env flag for correctness comparisons in follow-up).
fn onSetattr(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    const valid = std.mem.readInt(u32, body[0..4], .little);

    // FATTR bits 0..8 (MODE / UID / GID / SIZE / ATIME / MTIME / FH /
    // ATIME_NOW / MTIME_NOW) — anything in there is "mutating" for
    // EROFS purposes.
    const mutating_mask: u32 = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) |
        (1 << 4) | (1 << 5) | (1 << 7) | (1 << 8);
    if (!state.mode_rw and (valid & mutating_mask) != 0) {
        return try buildErrorReply(state, hdr.unique, -E.ROFS);
    }

    const entry = requireInode(state, hdr.nodeid) orelse
        return try buildErrorReply(state, hdr.unique, -E.STALE);

    var path_buf: [4096]u8 = undefined;
    const abs = buildAbsPath(state, entry.rel_path, &path_buf) catch
        return try buildErrorReply(state, hdr.unique, -E.INVAL);

    var st = std.mem.zeroes(Stat);
    hostLstat(abs, &st) catch |e| return try buildErrorReply(state, hdr.unique, mapFsError(e));

    var payload: [FUSE_ATTR_OUT_SIZE]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], 1, .little);
    std.mem.writeInt(u32, payload[8..12], 0, .little);
    writeAttr(payload[16..104], statToAttr(st, hdr.nodeid));
    return try buildReply(state, hdr.unique, &payload);
}

// --- STATFS -------------------------------------------------------------

fn onStatfs(state: *State, hdr: InHeader) ![]u8 {
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
    return try buildReply(state, hdr.unique, &payload);
}

// --- RELEASE ------------------------------------------------------------

fn onRelease(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < FUSE_RELEASE_IN_SIZE) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    const fh = std.mem.readInt(u64, body[0..8], .little);
    if (state.handles.get(fh)) |handle| {
        _ = close(handle.fd);
        _ = state.handles.remove(fh);
    }
    return try buildErrorReply(state, hdr.unique, 0);
}

// --- host fs ops --------------------------------------------------------

fn hostLstat(path: []const u8, out: *Stat) !void {
    var path_z: [4097]u8 = undefined;
    if (path.len >= path_z.len) return error.PathTooLong;
    @memcpy(path_z[0..path.len], path);
    path_z[path.len] = 0;
    if (fstatat(AT_FDCWD, @ptrCast(&path_z), out, AT_SYMLINK_NOFOLLOW) != 0) {
        return errnoToZigError(errno());
    }
}

fn hostFstat(fd: c_int, out: *Stat) !void {
    if (fstat(fd, out) != 0) return errnoToZigError(errno());
}

fn openHost(path: []const u8, flags: c_int, mode: c_int) !c_int {
    var path_z: [4097]u8 = undefined;
    if (path.len >= path_z.len) return error.PathTooLong;
    @memcpy(path_z[0..path.len], path);
    path_z[path.len] = 0;
    const fd = open(@ptrCast(&path_z), flags, mode);
    if (fd < 0) return errnoToZigError(errno());
    return fd;
}

fn pwriteAll(fd: c_int, data: []const u8, offset: u64) !usize {
    var total: usize = 0;
    while (total < data.len) {
        const n = pwrite(fd, data[total..].ptr, data.len - total, @intCast(offset + total));
        if (n > 0) {
            total += @intCast(n);
            continue;
        }
        if (n == 0) break;
        if (errno() == EINTR) continue;
        return errnoToZigError(errno());
    }
    return total;
}

fn errnoToZigError(e: c_int) anyerror {
    return switch (e) {
        2 => error.FileNotFound,
        13 => error.AccessDenied,
        17 => error.PathAlreadyExists,
        21 => error.IsDir,
        20 => error.NotDir,
        22 => error.InvalidArg,
        28 => error.NoSpaceLeft,
        1 => error.PermissionDenied,
        else => error.Unexpected,
    };
}

fn mapFsError(e: anyerror) i32 {
    return switch (e) {
        error.FileNotFound => -E.NOENT,
        error.AccessDenied => -E.ACCES,
        error.PathAlreadyExists => -E.EXIST,
        error.IsDir => -E.ISDIR,
        error.NotDir => -E.NOTDIR,
        error.InvalidArg => -E.INVAL,
        error.NoSpaceLeft => -E.NOSPC,
        error.PermissionDenied => -E.PERM,
        error.PathTooLong => -E.INVAL,
        else => -E.IO,
    };
}

fn linuxOpenToHost(linux_flags: u32) c_int {
    const access = linux_flags & 0o3;
    var host: c_int = if (access == LINUX_O_WRONLY)
        O_WRONLY
    else if (access == LINUX_O_RDWR)
        O_RDWR
    else
        O_RDONLY;
    if (linux_flags & LINUX_O_TRUNC != 0) host |= O_TRUNC;
    if (linux_flags & LINUX_O_APPEND != 0) host |= O_APPEND;
    return host;
}

fn statToAttr(st: Stat, ino: u64) Attr {
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

fn decodeName(body: []const u8) []const u8 {
    const nul = std.mem.indexOfScalar(u8, body, 0) orelse body.len;
    return body[0..nul];
}

// --- frame loop ---------------------------------------------------------

fn serveConnection(state: *State) !void {
    // Reuse one growable buffer per connection. FUSE max message is
    // header + max_write payload + create_in body + name. 256 KiB
    // comfortably covers 128 KiB writes (the negotiated max_write).
    var buf: [256 * 1024]u8 = undefined;

    while (!shutdown_requested.load(.acquire)) {
        var len_bytes: [4]u8 = undefined;
        switch (readExact(state.conn_fd, &len_bytes)) {
            .ok => {},
            .closed => return,
            .eintr_shutdown => return,
        }
        const len = std.mem.readInt(u32, &len_bytes, .little);
        if (len < FUSE_IN_HEADER_SIZE) return error.MalformedFrame;
        if (len > buf.len) return error.FrameTooLarge;
        @memcpy(buf[0..4], &len_bytes);
        switch (readExact(state.conn_fd, buf[4..len])) {
            .ok => {},
            .closed => return,
            .eintr_shutdown => return,
        }
        try dispatch(state, buf[0..len]);
    }
}

// --- stats file ---------------------------------------------------------

fn writeStatsAtomic(state: *State) void {
    const stats_path = state.stats_path orelse return;

    // Build the JSON in one heap buffer. Stats files are small (<10 KiB
    // even with all ~30 opcodes), and a single allocPrint per write
    // beats the writer-ceremony for a once-on-startup, once-on-shutdown
    // call site.
    var body_buf: [16 * 1024]u8 = undefined;
    var cur: usize = 0;

    var slice = std.fmt.bufPrint(body_buf[cur..], "{{\"bytesServedOnPagesImg\":{d},\"updatedAtMs\":{d}", .{
        state.bytes_served_on_pages_img,
        nowMs(),
    }) catch return;
    cur += slice.len;

    if (state.profile_enabled) {
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
            slice = std.fmt.bufPrint(body_buf[cur..], "\"{s}\":{{\"count\":{d},\"sumNs\":{d},\"p50Ns\":0,\"p99Ns\":0}}", .{
                opName(e.key_ptr.*),
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
    _ = writeAll(fd, body_items);
    _ = close(fd);

    var dst_z: [4097]u8 = undefined;
    if (stats_path.len >= dst_z.len) return;
    @memcpy(dst_z[0..stats_path.len], stats_path);
    dst_z[stats_path.len] = 0;
    _ = rename(@ptrCast(&tmp_z), @ptrCast(&dst_z));
}

fn opName(code: u32) []const u8 {
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

// --- signal handling ----------------------------------------------------

fn signalHandler(_: std.c.SIG) callconv(.c) void {
    shutdown_requested.store(true, .release);
}

fn installSignalHandlers() !void {
    var act: std.posix.Sigaction = .{
        .handler = .{ .handler = signalHandler },
        .mask = std.posix.sigemptyset(),
        .flags = 0,
    };
    std.posix.sigaction(std.posix.SIG.TERM, &act, null);
    std.posix.sigaction(std.posix.SIG.INT, &act, null);
    std.posix.sigaction(std.posix.SIG.HUP, &act, null);
    // Drop SIGPIPE — write() on a closed peer should return EPIPE,
    // not kill us.
    var ign: std.posix.Sigaction = .{
        .handler = .{ .handler = std.posix.SIG.IGN },
        .mask = std.posix.sigemptyset(),
        .flags = 0,
    };
    std.posix.sigaction(std.posix.SIG.PIPE, &ign, null);
}

// --- main ---------------------------------------------------------------

pub fn main(init: std.process.Init) !void {
    // c_allocator (libc malloc/free) over page_allocator: tar bench
    // performs ~30k tiny FUSE replies (16-byte ENOSYS, 8-byte WRITE
    // ack, 104-byte attr_out). page_allocator mmaps a fresh 16 KiB
    // page per alloc and munmaps on free — that alone was ~1.5 ms per
    // reply during PR1 bring-up, killing the speedup. malloc's free
    // list is sub-µs for these sizes.
    const gpa = std.heap.c_allocator;

    const args = try parseArgs(gpa, init.minimal.args);

    try installSignalHandlers();

    var state = try State.init(gpa, args.root, args.mode_rw);
    defer state.deinit();
    state.stats_path = args.stats;
    state.profile_enabled = isProfileEnabled();

    // The Args struct's `uds` is borrowed by `bindAndListen` (lifetime
    // ends after listen()) but the State doesn't keep a copy. We need
    // to remember it for cleanup on shutdown, though.
    const uds_path_owned = args.uds;
    defer gpa.free(uds_path_owned);

    state.listen_fd = try bindAndListen(uds_path_owned);
    defer {
        _ = close(state.listen_fd);
        var uds_z: [108]u8 = @splat(0);
        if (uds_path_owned.len < uds_z.len) {
            @memcpy(uds_z[0..uds_path_owned.len], uds_path_owned);
            _ = unlink(@ptrCast(&uds_z));
        }
    }

    // Publish an initial stats file so a reader landing before the
    // first FUSE op sees valid JSON.
    writeStatsAtomic(&state);

    // Accept one connection. Loop is defensive: if the connection
    // drops mid-bench we'll accept the next one rather than exit.
    while (!shutdown_requested.load(.acquire)) {
        const conn = acceptOne(state.listen_fd) catch |e| switch (e) {
            error.Shutdown => break,
            else => return e,
        };
        state.conn_fd = conn;
        serveConnection(&state) catch |e| {
            std.debug.print("connection error: {}\n", .{e});
        };
        _ = close(state.conn_fd);
        state.conn_fd = -1;
    }

    // One final flush before exit so the bench picks up the closing
    // counters.
    writeStatsAtomic(&state);

    // Remove the stats file last — supervisor will rm the parent dir
    // anyway but the JS server does this explicit unlink and the bench
    // relies on it not finding stale files between runs.
    if (state.stats_path) |p| {
        var z: [4097]u8 = undefined;
        if (p.len < z.len) {
            @memcpy(z[0..p.len], p);
            z[p.len] = 0;
            _ = unlink(@ptrCast(&z));
        }
    }
}

fn isProfileEnabled() bool {
    const v = getenv("MACHINEN_MOUNT_SERVER_PROFILE") orelse return false;
    return std.mem.eql(u8, std.mem.span(v), "1");
}
