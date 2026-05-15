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
//!     SYMLINK, SETATTR, STATFS
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

extern "c" fn close(fd: c_int) c_int;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn unlink(path: [*:0]const u8) c_int;
extern "c" fn rename(old: [*:0]const u8, new: [*:0]const u8) c_int;
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

    pub fn init(gpa: std.mem.Allocator, root_abs: []u8, mode_rw: bool) !State {
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

    pub fn deinit(self: *State) void {
        var it = self.inodes.iterator();
        while (it.next()) |e| self.gpa.free(e.value_ptr.rel_path);
        self.inodes.deinit();

        var hit = self.handles.iterator();
        while (hit.next()) |e| freeHandle(self, e.value_ptr);
        self.handles.deinit();

        self.op_stats.deinit();
        self.gpa.free(self.root_abs);
        if (self.stats_path) |p| self.gpa.free(p);
    }

    /// Serialise the host-side FUSE state — the nodeid→path map and the
    /// open file/dir handle table — into a `fuse_state` payload for the
    /// vmstate snapshot. `applyState` is the inverse. Deliberately *not*
    /// captured: `root_abs` (supplied fresh at boot), the host fds
    /// (reopened by path on restore — READ/WRITE are stateless
    /// pread/pwrite, so the fd offset doesn't matter), and the
    /// profiling/stats fields (re-initialised at boot).
    pub fn dumpState(self: *State, gpa: std.mem.Allocator) ![]u8 {
        var b = fuse_state.Builder.init(gpa, self.mode_rw, self.next_inode, self.next_handle);
        errdefer b.deinit();

        var it = self.inodes.iterator();
        while (it.next()) |e| {
            try b.addInode(e.key_ptr.*, e.value_ptr.nlookup, e.value_ptr.rel_path);
        }
        var hit = self.handles.iterator();
        while (hit.next()) |e| {
            const h = e.value_ptr;
            switch (h.kind) {
                .file => try b.addFileHandle(e.key_ptr.*, h.nodeid, h.open_flags),
                .dir => try b.addDirHandle(e.key_ptr.*, h.nodeid, h.dir_entries orelse &.{}),
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
    pub fn applyState(self: *State, payload: []const u8) !void {
        var d = try fuse_state.decode(self.gpa, payload);
        defer d.deinit();

        // The fresh boot pre-seeded nodeid=1; drop every seeded entry
        // before laying the snapshot down, or the restored root record
        // double-allocates and the seed leaks.
        var it = self.inodes.iterator();
        while (it.next()) |e| self.gpa.free(e.value_ptr.rel_path);
        self.inodes.clearRetainingCapacity();

        var hit = self.handles.iterator();
        while (hit.next()) |e| freeHandle(self, e.value_ptr);
        self.handles.clearRetainingCapacity();

        self.mode_rw = d.mode_rw;
        self.next_inode = d.next_inode;
        self.next_handle = d.next_handle;

        for (d.inodes) |rec| {
            const dup = try self.gpa.dupe(u8, rec.path);
            try self.inodes.put(rec.nodeid, .{ .rel_path = dup, .nlookup = rec.nlookup });
        }
        for (d.handles) |rec| {
            switch (rec.kind) {
                .file => try self.handles.put(rec.handle_id, .{
                    .kind = .file,
                    .fd = self.reopenHandle(rec.nodeid, rec.open_flags),
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
    fn reopenHandle(self: *State, nodeid: u64, open_flags: u32) c_int {
        const entry = self.inodes.getPtr(nodeid) orelse return -1;
        var path_buf: [4096]u8 = undefined;
        const abs = buildAbsPath(self, entry.rel_path, &path_buf) catch return -1;
        var flags = open_flags & ~LINUX_O_TRUNC;
        if (!self.mode_rw) flags &= ~@as(u32, 0o3); // force O_RDONLY
        return openHost(abs, linuxOpenToHost(flags), 0) catch -1;
    }
};

/// Release a handle's owned resources — close the fd for a `file`,
/// free the packed-dirent slices for a `dir`. Idempotent enough: a
/// double-free can't happen because callers `remove()` from the map
/// right after.
fn freeHandle(state: *State, e: *OpenEntry) void {
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
fn writeFileAll(fd: c_int, data: []const u8) bool {
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
            .OPENDIR => break :blk try onOpendir(state, hdr),
            .READDIR => break :blk try onReaddir(state, hdr, msg),
            .RELEASEDIR => break :blk try onReleasedir(state, hdr, msg),
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

    return reply_opt;
}

// --- response builders --------------------------------------------------

fn buildErrorReply(state: *State, unique: u64, err: i32) ![]u8 {
    // FUSE convention: a negative errno, or 0 for a success-with-no-
    // payload ack. A positive errno would corrupt the kernel's view.
    assert(err <= 0);
    const buf = try state.gpa.alloc(u8, FUSE_OUT_HEADER_SIZE);
    writeOutHeader(buf, 0, err, unique);
    return buf;
}

fn buildReply(state: *State, unique: u64, payload: []const u8) ![]u8 {
    // The whole reply (header + payload) rides one FUSE frame whose
    // length is a u32; in practice nothing we build approaches that,
    // but assert it so a future op that returns a huge payload trips
    // here instead of silently truncating in writeOutHeader's @intCast.
    assert(FUSE_OUT_HEADER_SIZE + payload.len <= std.math.maxInt(u32));
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
    try state.handles.put(id, .{ .kind = .file, .fd = fd, .nodeid = ino, .open_flags = flags });

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
    // fd < 0 means a snapshot restore couldn't reopen this handle's
    // backing file (it was removed on the host since the snapshot).
    // An invalid descriptor is EBADF — fail-soft, never a wedge.
    if (handle.fd < 0) return try buildErrorReply(state, hdr.unique, -E.BADF);

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
    try state.handles.put(id, .{ .kind = .file, .fd = fd, .nodeid = hdr.nodeid, .open_flags = flags });

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
    // fd < 0 means a snapshot restore couldn't reopen this handle's
    // backing file (it was removed on the host since the snapshot).
    // An invalid descriptor is EBADF — fail-soft, never a wedge.
    if (handle.fd < 0) return try buildErrorReply(state, hdr.unique, -E.BADF);

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

// --- RELEASE / RELEASEDIR -----------------------------------------------

fn onRelease(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < FUSE_RELEASE_IN_SIZE) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    const fh = std.mem.readInt(u64, body[0..8], .little);
    if (state.handles.getPtr(fh)) |handle| {
        freeHandle(state, handle);
        _ = state.handles.remove(fh);
    }
    return try buildErrorReply(state, hdr.unique, 0);
}

// fuse_release_in is the same wire shape RELEASEDIR uses — fh is the
// first u64. Free the snapshotted dirent buffers.
fn onReleasedir(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 8) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    const fh = std.mem.readInt(u64, body[0..8], .little);
    if (state.handles.getPtr(fh)) |handle| {
        freeHandle(state, handle);
        _ = state.handles.remove(fh);
    }
    return try buildErrorReply(state, hdr.unique, 0);
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
fn modeToDT(mode: u32) u32 {
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
fn buildDirent(gpa: std.mem.Allocator, ino: u64, off: u64, dtype: u32, name: []const u8) ![]u8 {
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

fn onOpendir(state: *State, hdr: InHeader) ![]u8 {
    const entry = requireInode(state, hdr.nodeid) orelse
        return try buildErrorReply(state, hdr.unique, -E.STALE);

    var path_buf: [4096]u8 = undefined;
    const abs = buildAbsPath(state, entry.rel_path, &path_buf) catch
        return try buildErrorReply(state, hdr.unique, -E.INVAL);

    var abs_z: [4097]u8 = undefined;
    if (abs.len >= abs_z.len) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    @memcpy(abs_z[0..abs.len], abs);
    abs_z[abs.len] = 0;

    const dir = opendir(@ptrCast(&abs_z)) orelse
        return try buildErrorReply(state, hdr.unique, mapFsError(errnoToZigError(errno())));
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
            const child_rel = joinRel(state.gpa, entry.rel_path, name) catch continue;
            defer state.gpa.free(child_rel);
            const child_abs = buildAbsPath(state, child_rel, &child_buf) catch continue;
            var st = std.mem.zeroes(Stat);
            if (hostLstat(child_abs, &st)) |_| {
                dtype = modeToDT(st.mode);
            } else |_| {}
        }
        const packed_de = try buildDirent(state.gpa, off, off, dtype, name);
        try entries.append(state.gpa, packed_de);
    }

    const owned = try entries.toOwnedSlice(state.gpa);
    const id = state.next_handle;
    state.next_handle += 1;
    try state.handles.put(id, .{ .kind = .dir, .dir_entries = owned });

    var payload: [16]u8 = @splat(0);
    std.mem.writeInt(u64, payload[0..8], id, .little); // fh
    std.mem.writeInt(u32, payload[8..12], 0, .little); // open_flags
    return try buildReply(state, hdr.unique, &payload);
}

fn onReaddir(state: *State, hdr: InHeader, msg: []const u8) ![]u8 {
    const body = msg[FUSE_IN_HEADER_SIZE..];
    if (body.len < 32) return try buildErrorReply(state, hdr.unique, -E.INVAL);
    const fh = std.mem.readInt(u64, body[0..8], .little);
    const offset = std.mem.readInt(u64, body[8..16], .little);
    const size = std.mem.readInt(u32, body[16..20], .little);

    const handle = state.handles.get(fh) orelse
        return try buildErrorReply(state, hdr.unique, -E.BADF);
    if (handle.kind != .dir) return try buildErrorReply(state, hdr.unique, -E.BADF);
    const entries = handle.dir_entries orelse
        return try buildErrorReply(state, hdr.unique, -E.BADF);

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
    writeOutHeader(reply[0..FUSE_OUT_HEADER_SIZE], total, 0, hdr.unique);
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

// --- stats file ---------------------------------------------------------

pub fn writeStatsAtomic(state: *State) void {
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
    _ = writeFileAll(fd, body_items);
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
fn testBuildFrame(
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
fn testState(gpa: std.mem.Allocator, mode_rw: bool) !State {
    return State.init(gpa, try gpa.dupe(u8, "/nonexistent-machinen-test-root"), mode_rw);
}

test "dispatch: INIT negotiates protocol 7.31" {
    const gpa = testing.allocator;
    var state = try testState(gpa, true);
    defer state.deinit();

    var body: [16]u8 = @splat(0);
    std.mem.writeInt(u32, body[0..4], 7, .little); // major
    std.mem.writeInt(u32, body[4..8], 36, .little); // minor — guest offers newer
    const frame = try testBuildFrame(gpa, @intFromEnum(Op.INIT), 42, 0, &body);
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
    var state = try testState(gpa, true);
    defer state.deinit();

    const frame = try testBuildFrame(gpa, 9999, 7, 1, &.{});
    defer gpa.free(frame);

    const reply = (try dispatch(&state, frame)) orelse return error.ExpectedReply;
    defer gpa.free(reply);

    try testing.expectEqual(@as(usize, FUSE_OUT_HEADER_SIZE), reply.len);
    try testing.expectEqual(@as(i32, -E.NOSYS), std.mem.readInt(i32, reply[4..8], .little));
}

test "dispatch: CREATE on a :ro mount returns EROFS" {
    const gpa = testing.allocator;
    var state = try testState(gpa, false); // read-only
    defer state.deinit();

    const frame = try testBuildFrame(gpa, @intFromEnum(Op.CREATE), 9, 1, &.{});
    defer gpa.free(frame);

    const reply = (try dispatch(&state, frame)) orelse return error.ExpectedReply;
    defer gpa.free(reply);

    try testing.expectEqual(@as(i32, -E.ROFS), std.mem.readInt(i32, reply[4..8], .little));
}

test "dispatch: FORGET and INTERRUPT produce no reply" {
    const gpa = testing.allocator;
    var state = try testState(gpa, true);
    defer state.deinit();

    const forget_body: [8]u8 = @splat(0);
    const forget = try testBuildFrame(gpa, @intFromEnum(Op.FORGET), 1, 1, &forget_body);
    defer gpa.free(forget);
    try testing.expect((try dispatch(&state, forget)) == null);

    const interrupt = try testBuildFrame(gpa, @intFromEnum(Op.INTERRUPT), 2, 0, &.{});
    defer gpa.free(interrupt);
    try testing.expect((try dispatch(&state, interrupt)) == null);
}

test "validateName rejects path-escape and empty names" {
    try testing.expectError(error.InvalidName, validateName(""));
    try testing.expectError(error.InvalidName, validateName("."));
    try testing.expectError(error.InvalidName, validateName(".."));
    try testing.expectError(error.InvalidName, validateName("a/b"));
    try testing.expectError(error.InvalidName, validateName("a\x00b"));
    try validateName("normal-file.txt");
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
fn testTmpRootAbs(gpa: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, gpa);
    defer gpa.free(cwd);
    return std.fs.path.join(gpa, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

/// CREATE `name` under the root inode; returns its (nodeid, fh).
fn testCreate(state: *State, name: []const u8) !struct { nodeid: u64, fh: u64 } {
    var body: [16 + 96]u8 = @splat(0);
    std.mem.writeInt(u32, body[0..4], LINUX_O_RDWR, .little);
    std.mem.writeInt(u32, body[4..8], 0o644, .little);
    @memcpy(body[16..][0..name.len], name);
    const frame = try testBuildFrame(state.gpa, @intFromEnum(Op.CREATE), 1, 1, body[0 .. 16 + name.len]);
    defer state.gpa.free(frame);
    const r = (try dispatch(state, frame)) orelse return error.ExpectedReply;
    defer state.gpa.free(r);
    if (std.mem.readInt(i32, r[4..8], .little) != 0) return error.CreateFailed;
    return .{
        .nodeid = std.mem.readInt(u64, r[FUSE_OUT_HEADER_SIZE..][0..8], .little),
        .fh = std.mem.readInt(u64, r[FUSE_OUT_HEADER_SIZE + 128 ..][0..8], .little),
    };
}

test "dumpState/applyState: a file handle survives a snapshot round-trip" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    var src = try State.init(gpa, try testTmpRootAbs(gpa, &tmp), true);
    defer src.deinit();
    const h = try testCreate(&src, "doc.txt");

    // WRITE "snapshot-me" through the handle, onto the real host file.
    {
        var body: [FUSE_WRITE_IN_SIZE + 11]u8 = @splat(0);
        std.mem.writeInt(u64, body[0..8], h.fh, .little);
        std.mem.writeInt(u32, body[16..20], 11, .little);
        @memcpy(body[FUSE_WRITE_IN_SIZE..], "snapshot-me");
        const frame = try testBuildFrame(gpa, @intFromEnum(Op.WRITE), 2, h.nodeid, &body);
        defer gpa.free(frame);
        const r = (try dispatch(&src, frame)) orelse return error.ExpectedReply;
        defer gpa.free(r);
        try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, r[4..8], .little));
    }

    const payload = try src.dumpState(gpa);
    defer gpa.free(payload);

    // A fresh State over the SAME root — a vmstate restore.
    var dst = try State.init(gpa, try testTmpRootAbs(gpa, &tmp), true);
    defer dst.deinit();
    try dst.applyState(payload);
    try testing.expectEqual(src.next_inode, dst.next_inode);
    try testing.expectEqual(src.next_handle, dst.next_handle);

    // READ through the restored handle — its fd was reopened from
    // scratch by path, but the bytes written before the snapshot are
    // still served.
    var rbody: [32]u8 = @splat(0);
    std.mem.writeInt(u64, rbody[0..8], h.fh, .little);
    std.mem.writeInt(u32, rbody[16..20], 64, .little);
    const frame = try testBuildFrame(gpa, @intFromEnum(Op.READ), 3, h.nodeid, &rbody);
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

    var src = try State.init(gpa, try testTmpRootAbs(gpa, &tmp), true);
    defer src.deinit();
    const h = try testCreate(&src, "gone.txt");
    const payload = try src.dumpState(gpa);
    defer gpa.free(payload);

    // The file vanishes on the host before the restore.
    try tmp.dir.deleteFile(std.testing.io, "gone.txt");

    var dst = try State.init(gpa, try testTmpRootAbs(gpa, &tmp), true);
    defer dst.deinit();
    try dst.applyState(payload); // must not error — the reopen fails soft

    // The handle still exists, but its fd is -1; READ returns EBADF
    // instead of wedging.
    var rbody: [32]u8 = @splat(0);
    std.mem.writeInt(u64, rbody[0..8], h.fh, .little);
    std.mem.writeInt(u32, rbody[16..20], 16, .little);
    const frame = try testBuildFrame(gpa, @intFromEnum(Op.READ), 1, h.nodeid, &rbody);
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
        var rw = try State.init(gpa, try testTmpRootAbs(gpa, &tmp), true);
        defer rw.deinit();
        const h = try testCreate(&rw, "data.txt");
        var wbody: [FUSE_WRITE_IN_SIZE + 4]u8 = @splat(0);
        std.mem.writeInt(u64, wbody[0..8], h.fh, .little);
        std.mem.writeInt(u32, wbody[16..20], 4, .little);
        @memcpy(wbody[FUSE_WRITE_IN_SIZE..], "ABCD");
        const wf = try testBuildFrame(gpa, @intFromEnum(Op.WRITE), 1, h.nodeid, &wbody);
        defer gpa.free(wf);
        gpa.free((try dispatch(&rw, wf)).?);
    }

    // A :ro mount LOOKUPs + OPENs it read-only.
    var src = try State.init(gpa, try testTmpRootAbs(gpa, &tmp), false);
    defer src.deinit();
    {
        const lf = try testBuildFrame(gpa, @intFromEnum(Op.LOOKUP), 1, 1, "data.txt\x00");
        defer gpa.free(lf);
        gpa.free((try dispatch(&src, lf)).?);
    }
    var obody: [8]u8 = @splat(0);
    std.mem.writeInt(u32, obody[0..4], LINUX_O_RDONLY, .little);
    const of = try testBuildFrame(gpa, @intFromEnum(Op.OPEN), 2, 2, &obody); // nodeid 2 = data.txt
    defer gpa.free(of);
    const orep = (try dispatch(&src, of)) orelse return error.ExpectedReply;
    const fh = std.mem.readInt(u64, orep[FUSE_OUT_HEADER_SIZE..][0..8], .little);
    gpa.free(orep);

    const payload = try src.dumpState(gpa);
    defer gpa.free(payload);

    // Restore onto a State the boot path created as rw — `applyState`
    // must override `mode_rw` with the snapshot's `:ro`.
    var dst = try State.init(gpa, try testTmpRootAbs(gpa, &tmp), true);
    defer dst.deinit();
    try dst.applyState(payload);
    try testing.expectEqual(false, dst.mode_rw);

    // READ through the restored handle works — the fd was reopened
    // O_RDONLY.
    var rbody: [32]u8 = @splat(0);
    std.mem.writeInt(u64, rbody[0..8], fh, .little);
    std.mem.writeInt(u32, rbody[16..20], 8, .little);
    const rf = try testBuildFrame(gpa, @intFromEnum(Op.READ), 3, 2, &rbody);
    defer gpa.free(rf);
    const rr = (try dispatch(&dst, rf)) orelse return error.ExpectedReply;
    defer gpa.free(rr);
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, rr[4..8], .little));
    try testing.expectEqualStrings("ABCD", rr[FUSE_OUT_HEADER_SIZE..]);

    // WRITE is still rejected — the `:ro` gate fires on `mode_rw`.
    var wbody: [FUSE_WRITE_IN_SIZE + 1]u8 = @splat(0);
    std.mem.writeInt(u64, wbody[0..8], fh, .little);
    std.mem.writeInt(u32, wbody[16..20], 1, .little);
    const wf = try testBuildFrame(gpa, @intFromEnum(Op.WRITE), 4, 2, &wbody);
    defer gpa.free(wf);
    const wr = (try dispatch(&dst, wf)) orelse return error.ExpectedReply;
    defer gpa.free(wr);
    try testing.expectEqual(@as(i32, -E.ROFS), std.mem.readInt(i32, wr[4..8], .little));
}

test "applyState: a malformed payload is rejected, leaving the State usable" {
    const gpa = testing.allocator;
    var state = try testState(gpa, true);
    defer state.deinit();

    // Truncated and bad-magic payloads must come back as errors — and
    // `applyState` returns before touching the live maps, so a wedged
    // VMM thread is impossible.
    try testing.expectError(error.Truncated, state.applyState("xx"));
    var bad: [fuse_state.HEADER_SIZE]u8 = @splat(0);
    try testing.expectError(error.BadMagic, state.applyState(&bad));

    // The State is still intact afterwards: dumpState still succeeds
    // and the root inode is still seeded.
    const ok = try state.dumpState(gpa);
    defer gpa.free(ok);
    var d = try fuse_state.decode(gpa, ok);
    defer d.deinit();
    try testing.expectEqual(@as(usize, 1), d.inodes.len);
}
