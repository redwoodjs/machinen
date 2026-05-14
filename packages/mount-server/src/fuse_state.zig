//! Wire codec for a virtio-fs FUSE backend's host-side state.
//!
//! The vmstate whole-VM snapshot already round-trips a virtio-fs
//! device's *transport* state (virtqueues, features — see
//! `virtio_dump.zig`). But the restored guest kernel also holds an
//! established FUSE session: cached `nodeid`s from past LOOKUPs and
//! open file/dir handles. The host side of that — the `fuse.State`
//! maps — lives only in VMM memory and is gone after restore unless we
//! capture it. Without it the guest's first op on a cached nodeid hits
//! a fresh, empty backend and the mount wedges.
//!
//! This module is the pure byte-format half: it knows nothing about
//! `fuse.State`. `fuse.State.dumpState` walks the live maps into a
//! `Builder`; `fuse.State.applyState` decodes and rebuilds them
//! (reopening file descriptors by path against the current mount root).
//!
//! What is NOT captured here: the host file descriptors themselves
//! (reopened by path on restore — FUSE READ/WRITE are stateless
//! pread/pwrite, so the fd offset is irrelevant), `root_abs` (supplied
//! fresh at boot), and the profiling/stats fields (re-initialised at
//! boot). Only `nodeid → rel_path` and the open-handle table need to
//! survive, and both are host-independent (`rel_path` is relative; the
//! packed dir-entry buffers are guest-facing bytes).
//!
//! Layout (little-endian; all `extern struct` headers are size-pinned):
//!
//!   Header (32 bytes)
//!     magic u32        = 0x56465353
//!     mode_rw u8
//!     _pad[3]
//!     next_inode u64
//!     next_handle u64
//!     inode_count u32
//!     handle_count u32
//!
//!   inode_count × InodeRec
//!     InodeRecHeader (24 bytes): nodeid u64, nlookup u64, path_len u32, _pad u32
//!     path[path_len]
//!
//!   handle_count × HandleRec
//!     HandleRecHeader (32 bytes): handle_id u64, nodeid u64,
//!       open_flags u32, kind u8, _pad[3], entry_count u32, _pad2 u32
//!     entry_count × { len u32; bytes[len] }   (dir handles only)

const std = @import("std");
const assert = std.debug.assert;

pub const MAGIC: u32 = 0x56465353;
pub const HEADER_SIZE: usize = 32;
pub const INODE_REC_HEADER_SIZE: usize = 24;
pub const HANDLE_REC_HEADER_SIZE: usize = 32;

pub const Header = extern struct {
    magic: u32,
    mode_rw: u8,
    _pad: [3]u8 = .{ 0, 0, 0 },
    next_inode: u64,
    next_handle: u64,
    inode_count: u32,
    handle_count: u32,
};

pub const InodeRecHeader = extern struct {
    nodeid: u64,
    nlookup: u64,
    path_len: u32,
    _pad: u32 = 0,
};

pub const HandleRecHeader = extern struct {
    handle_id: u64,
    nodeid: u64,
    open_flags: u32,
    kind: u8,
    _pad: [3]u8 = .{ 0, 0, 0 },
    entry_count: u32,
    _pad2: u32 = 0,
};

comptime {
    assert(@sizeOf(Header) == HEADER_SIZE);
    assert(@sizeOf(InodeRecHeader) == INODE_REC_HEADER_SIZE);
    assert(@sizeOf(HandleRecHeader) == HANDLE_REC_HEADER_SIZE);
}

/// Open-handle kind, matching `fuse.OpenKind` one-for-one.
pub const Kind = enum(u8) { file = 0, dir = 1 };

pub const DecodeError = error{ Truncated, BadMagic, BadKind } || std.mem.Allocator.Error;

// --- encode -------------------------------------------------------------

/// Accumulates inode + handle records, then emits the framed payload.
/// Inode and handle bodies are buffered separately so the caller can
/// add them in any order — `finish` lays them out header / inodes /
/// handles regardless.
pub const Builder = struct {
    gpa: std.mem.Allocator,
    mode_rw: bool,
    next_inode: u64,
    next_handle: u64,
    inode_count: u32 = 0,
    handle_count: u32 = 0,
    inode_body: std.ArrayList(u8) = .empty,
    handle_body: std.ArrayList(u8) = .empty,

    pub fn init(
        gpa: std.mem.Allocator,
        mode_rw: bool,
        next_inode: u64,
        next_handle: u64,
    ) Builder {
        return .{
            .gpa = gpa,
            .mode_rw = mode_rw,
            .next_inode = next_inode,
            .next_handle = next_handle,
        };
    }

    /// Free the intermediate buffers. Safe to call after `finish` (it
    /// leaves them empty); required on the error path before `finish`.
    pub fn deinit(self: *Builder) void {
        self.inode_body.deinit(self.gpa);
        self.handle_body.deinit(self.gpa);
    }

    pub fn addInode(self: *Builder, nodeid: u64, nlookup: u64, rel_path: []const u8) !void {
        assert(rel_path.len <= std.math.maxInt(u32));
        const hdr: InodeRecHeader = .{
            .nodeid = nodeid,
            .nlookup = nlookup,
            .path_len = @intCast(rel_path.len),
        };
        try self.inode_body.appendSlice(self.gpa, std.mem.asBytes(&hdr));
        try self.inode_body.appendSlice(self.gpa, rel_path);
        self.inode_count += 1;
    }

    pub fn addFileHandle(self: *Builder, handle_id: u64, nodeid: u64, open_flags: u32) !void {
        const hdr: HandleRecHeader = .{
            .handle_id = handle_id,
            .nodeid = nodeid,
            .open_flags = open_flags,
            .kind = @intFromEnum(Kind.file),
            .entry_count = 0,
        };
        try self.handle_body.appendSlice(self.gpa, std.mem.asBytes(&hdr));
        self.handle_count += 1;
    }

    pub fn addDirHandle(
        self: *Builder,
        handle_id: u64,
        nodeid: u64,
        dir_entries: []const []const u8,
    ) !void {
        assert(dir_entries.len <= std.math.maxInt(u32));
        const hdr: HandleRecHeader = .{
            .handle_id = handle_id,
            .nodeid = nodeid,
            .open_flags = 0,
            .kind = @intFromEnum(Kind.dir),
            .entry_count = @intCast(dir_entries.len),
        };
        try self.handle_body.appendSlice(self.gpa, std.mem.asBytes(&hdr));
        for (dir_entries) |e| {
            assert(e.len <= std.math.maxInt(u32));
            var len_buf: [4]u8 = undefined;
            std.mem.writeInt(u32, &len_buf, @intCast(e.len), .little);
            try self.handle_body.appendSlice(self.gpa, &len_buf);
            try self.handle_body.appendSlice(self.gpa, e);
        }
        self.handle_count += 1;
    }

    /// Emit the framed payload. Caller owns the returned bytes.
    pub fn finish(self: *Builder) ![]u8 {
        const total = HEADER_SIZE + self.inode_body.items.len + self.handle_body.items.len;
        const out = try self.gpa.alloc(u8, total);
        errdefer self.gpa.free(out);

        const hdr: Header = .{
            .magic = MAGIC,
            .mode_rw = @intFromBool(self.mode_rw),
            .next_inode = self.next_inode,
            .next_handle = self.next_handle,
            .inode_count = self.inode_count,
            .handle_count = self.handle_count,
        };
        @memcpy(out[0..HEADER_SIZE], std.mem.asBytes(&hdr));
        @memcpy(out[HEADER_SIZE..][0..self.inode_body.items.len], self.inode_body.items);
        @memcpy(
            out[HEADER_SIZE + self.inode_body.items.len ..][0..self.handle_body.items.len],
            self.handle_body.items,
        );
        // Postcondition: every byte of the output is written.
        assert(HEADER_SIZE + self.inode_body.items.len + self.handle_body.items.len == total);
        return out;
    }
};

// --- decode -------------------------------------------------------------

pub const InodeRec = struct {
    nodeid: u64,
    nlookup: u64,
    path: []const u8,
};

pub const HandleRec = struct {
    handle_id: u64,
    nodeid: u64,
    open_flags: u32,
    kind: Kind,
    /// Packed `fuse_dirent` buffers; empty for `file` handles.
    dir_entries: []const []const u8,
};

/// Decoded payload. Paths and dir-entry buffers are copied into `arena`
/// so the caller can drop the source bytes immediately; `deinit` frees
/// everything in one shot.
pub const Decoded = struct {
    mode_rw: bool,
    next_inode: u64,
    next_handle: u64,
    inodes: []InodeRec,
    handles: []HandleRec,
    arena: std.heap.ArenaAllocator,

    pub fn deinit(self: *Decoded) void {
        self.arena.deinit();
    }
};

pub fn decode(gpa: std.mem.Allocator, payload: []const u8) DecodeError!Decoded {
    if (payload.len < HEADER_SIZE) return error.Truncated;
    var hdr: Header = undefined;
    @memcpy(std.mem.asBytes(&hdr), payload[0..HEADER_SIZE]);
    if (hdr.magic != MAGIC) return error.BadMagic;

    // Cheap pre-check before allocating off the header's counts: even
    // with zero-length paths and zero dir entries the body can't be
    // smaller than count × min-record-size. A malformed header that
    // claims a huge count is rejected here, not after a huge alloc.
    const min_body: u64 = @as(u64, hdr.inode_count) * INODE_REC_HEADER_SIZE +
        @as(u64, hdr.handle_count) * HANDLE_REC_HEADER_SIZE;
    if (@as(u64, HEADER_SIZE) + min_body > payload.len) return error.Truncated;

    var arena = std.heap.ArenaAllocator.init(gpa);
    errdefer arena.deinit();
    const a = arena.allocator();

    const inodes = try a.alloc(InodeRec, hdr.inode_count);
    const handles = try a.alloc(HandleRec, hdr.handle_count);

    var off: usize = HEADER_SIZE;
    for (inodes) |*rec| {
        // Invariant: prior iterations never advanced past the buffer.
        assert(off <= payload.len);
        if (off + INODE_REC_HEADER_SIZE > payload.len) return error.Truncated;
        var ih: InodeRecHeader = undefined;
        @memcpy(std.mem.asBytes(&ih), payload[off..][0..INODE_REC_HEADER_SIZE]);
        off += INODE_REC_HEADER_SIZE;
        if (off + ih.path_len > payload.len) return error.Truncated;
        const path = try a.dupe(u8, payload[off..][0..ih.path_len]);
        off += ih.path_len;
        rec.* = .{ .nodeid = ih.nodeid, .nlookup = ih.nlookup, .path = path };
    }
    for (handles) |*rec| {
        assert(off <= payload.len);
        if (off + HANDLE_REC_HEADER_SIZE > payload.len) return error.Truncated;
        var hh: HandleRecHeader = undefined;
        @memcpy(std.mem.asBytes(&hh), payload[off..][0..HANDLE_REC_HEADER_SIZE]);
        off += HANDLE_REC_HEADER_SIZE;
        if (hh.kind > @intFromEnum(Kind.dir)) return error.BadKind;
        // Each dir entry is at least its 4-byte length prefix — bound
        // the spine alloc before committing to it.
        if (off + @as(u64, hh.entry_count) * 4 > payload.len) return error.Truncated;
        const entries = try a.alloc([]const u8, hh.entry_count);
        for (entries) |*e| {
            assert(off <= payload.len);
            if (off + 4 > payload.len) return error.Truncated;
            const len = std.mem.readInt(u32, payload[off..][0..4], .little);
            off += 4;
            if (off + len > payload.len) return error.Truncated;
            e.* = try a.dupe(u8, payload[off..][0..len]);
            off += len;
        }
        rec.* = .{
            .handle_id = hh.handle_id,
            .nodeid = hh.nodeid,
            .open_flags = hh.open_flags,
            .kind = @enumFromInt(hh.kind),
            .dir_entries = entries,
        };
    }
    // Postcondition: parsing never read past the input buffer.
    assert(off <= payload.len);

    return .{
        .mode_rw = hdr.mode_rw != 0,
        .next_inode = hdr.next_inode,
        .next_handle = hdr.next_handle,
        .inodes = inodes,
        .handles = handles,
        .arena = arena,
    };
}

// --- tests --------------------------------------------------------------

const testing = std.testing;

test "encode/decode round-trip preserves inodes, handles, dir entries" {
    const gpa = testing.allocator;
    var b = Builder.init(gpa, true, 17, 5);
    defer b.deinit();
    try b.addInode(1, std.math.maxInt(u64), ""); // root, pinned
    try b.addInode(2, 3, "src");
    try b.addInode(7, 1, "src/main.zig");
    try b.addFileHandle(1, 7, 2); // O_RDWR
    try b.addDirHandle(2, 2, &.{ "dirent-a", "dirent-bb" });

    const payload = try b.finish();
    defer gpa.free(payload);

    var d = try decode(gpa, payload);
    defer d.deinit();

    try testing.expectEqual(true, d.mode_rw);
    try testing.expectEqual(@as(u64, 17), d.next_inode);
    try testing.expectEqual(@as(u64, 5), d.next_handle);
    try testing.expectEqual(@as(usize, 3), d.inodes.len);
    try testing.expectEqual(@as(u64, 7), d.inodes[2].nodeid);
    try testing.expectEqual(@as(u64, 1), d.inodes[2].nlookup);
    try testing.expectEqualStrings("src/main.zig", d.inodes[2].path);
    try testing.expectEqualStrings("", d.inodes[0].path);

    try testing.expectEqual(@as(usize, 2), d.handles.len);
    try testing.expectEqual(Kind.file, d.handles[0].kind);
    try testing.expectEqual(@as(u32, 2), d.handles[0].open_flags);
    try testing.expectEqual(@as(usize, 0), d.handles[0].dir_entries.len);
    try testing.expectEqual(Kind.dir, d.handles[1].kind);
    try testing.expectEqual(@as(usize, 2), d.handles[1].dir_entries.len);
    try testing.expectEqualStrings("dirent-bb", d.handles[1].dir_entries[1]);
}

test "decode rejects bad magic" {
    const gpa = testing.allocator;
    var b = Builder.init(gpa, false, 2, 1);
    defer b.deinit();
    const payload = try b.finish();
    defer gpa.free(payload);
    payload[0] ^= 0xff;
    try testing.expectError(error.BadMagic, decode(gpa, payload));
}

test "decode rejects truncated payload" {
    const gpa = testing.allocator;
    try testing.expectError(error.Truncated, decode(gpa, "short"));

    var b = Builder.init(gpa, true, 9, 4);
    defer b.deinit();
    try b.addInode(2, 1, "a-long-enough-path");
    const payload = try b.finish();
    defer gpa.free(payload);
    // Lop the tail off the path — the inode header still claims it.
    try testing.expectError(error.Truncated, decode(gpa, payload[0 .. payload.len - 4]));
}

test "decode rejects an inflated count without a huge allocation" {
    const gpa = testing.allocator;
    var b = Builder.init(gpa, true, 2, 1);
    defer b.deinit();
    const payload = try b.finish();
    defer gpa.free(payload);
    // Header claims a billion inodes; the body is empty. The pre-check
    // rejects it before `alloc` is ever reached.
    std.mem.writeInt(u32, payload[24..28], 1_000_000_000, .little);
    try testing.expectError(error.Truncated, decode(gpa, payload));
}

test "decode rejects an unknown handle kind" {
    const gpa = testing.allocator;
    var b = Builder.init(gpa, true, 2, 2);
    defer b.deinit();
    try b.addFileHandle(1, 1, 0);
    const payload = try b.finish();
    defer gpa.free(payload);
    // The handle record's `kind` byte sits right after its 16-byte
    // id/nodeid pair and 4-byte open_flags — offset HEADER + 20.
    payload[HEADER_SIZE + 20] = 99;
    try testing.expectError(error.BadKind, decode(gpa, payload));
}
