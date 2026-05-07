//! Shared host↔VMM stats area for #274 observability. The VMM opens
//! the file at the path supplied in `MACHINEN_STATS_FILE`, ftruncates
//! it to `@sizeOf(Counters)`, and mmaps it `MAP_SHARED`. The balloon
//! backend then `@atomicRmw`s its counters directly in the mapped
//! region, and the host TS runtime reads the same bytes via plain
//! `readFileSync` — the OS's page cache keeps the two views coherent
//! without any explicit syncing.
//!
//! Wire layout (must stay in lockstep with
//! `packages/runtime/src/balloon-stats.ts`):
//!
//!   offset  0:  u64 LE  bytes_reported   (total bytes the balloon
//!                                          device has reclaimed via
//!                                          free-page reporting)
//!   offset  8:  u64 LE  bytes_inflated   (total bytes seen on the
//!                                          inflate queue; usually 0
//!                                          since we don't drive
//!                                          inflate)
//!
//! Bumping the layout requires updating both files together — there's
//! a comptime size assert here and a `STATS_FILE_SIZE` constant on the
//! TS side that should also bump.
//!
//! The mmap is process-private to the VMM in the sense that the host
//! never writes; we use atomics on the VMM side anyway so a host read
//! can never observe a torn value mid-update.
//!
//! Best-effort: a missing `MACHINEN_STATS_FILE`, a permission error,
//! or any other I/O quirk falls back to a process-static stub
//! `Counters`. Observability is not a correctness invariant — the
//! VMM must boot regardless.

const std = @import("std");
const builtin = @import("builtin");
const assert = std.debug.assert;

pub const Counters = extern struct {
    bytes_reported: u64 align(8) = 0,
    bytes_inflated: u64 align(8) = 0,
};

comptime {
    assert(@sizeOf(Counters) == 16);
    assert(@offsetOf(Counters, "bytes_reported") == 0);
    assert(@offsetOf(Counters, "bytes_inflated") == 8);
}

// File-scope stub backing `Stats.openOrStub` when MACHINEN_STATS_FILE
// isn't set or the open path fails. Lives for the lifetime of the
// process, so a `*Counters` pointing here stays valid.
var stub_storage: Counters = .{};

/// Pointer to the process-static stub. Useful for tests that want a
/// deterministic, isolated counter to read after a fake balloon op.
pub fn stubCounters() *Counters {
    return &stub_storage;
}

pub const Stats = struct {
    counters: *Counters,
    region: ?[]align(@alignOf(Counters)) u8 = null,
    fd: c_int = -1,

    /// Open `path` (creating it if absent), ensure it's at least
    /// `@sizeOf(Counters)` bytes, and mmap it MAP_SHARED so writes
    /// from the balloon backend become visible to the host. The
    /// returned struct's `counters` points into the shared region.
    pub fn open(path: [*:0]const u8) !Stats {
        const fd = libc.open(path, O_RDWR | O_CREAT, @as(c_uint, 0o644));
        if (fd < 0) return error.OpenFailed;
        errdefer _ = libc.close(fd);
        if (libc.ftruncate(fd, @sizeOf(Counters)) != 0) return error.TruncateFailed;
        const raw = libc.mmap(
            null,
            @sizeOf(Counters),
            PROT_READ | PROT_WRITE,
            MAP_SHARED,
            fd,
            0,
        );
        // mmap returns (void*) -1 on failure on every Unix.
        if (@intFromPtr(raw) == ~@as(usize, 0)) return error.MmapFailed;
        const region_ptr: [*]align(@alignOf(Counters)) u8 = @ptrCast(@alignCast(raw));
        const region = region_ptr[0..@sizeOf(Counters)];
        return .{
            .counters = @ptrCast(@alignCast(region.ptr)),
            .region = region,
            .fd = fd,
        };
    }

    /// Stats backed by the file pointed at by `MACHINEN_STATS_FILE`,
    /// or by the process-static stub when the env var is missing or
    /// the open fails. Never throws — the VMM must boot regardless.
    pub fn openOrStub() Stats {
        const env_ptr = libc.getenv("MACHINEN_STATS_FILE") orelse return stubInstance();
        return open(env_ptr) catch |err| {
            if (debugEnabled()) {
                std.debug.print("stats: open '{s}' failed ({s}); using stub\n", .{
                    std.mem.span(env_ptr),
                    @errorName(err),
                });
            }
            return stubInstance();
        };
    }

    fn stubInstance() Stats {
        return .{ .counters = &stub_storage };
    }

    pub fn deinit(self: *Stats) void {
        if (self.region) |r| {
            _ = libc.munmap(r.ptr, r.len);
            self.region = null;
        }
        if (self.fd >= 0) {
            _ = libc.close(self.fd);
            self.fd = -1;
        }
    }
};

fn debugEnabled() bool {
    return libc.getenv("MACHINEN_DEBUG") != null;
}

// libc bindings. Grouped under a namespace so the linker symbols are
// the canonical names (open/close/mmap/...) without polluting this
// module's identifier space at the call sites. open() is variadic in
// C (mode is read only when O_CREAT is set) — match the signature.
const libc = struct {
    extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
    extern "c" fn close(fd: c_int) c_int;
    extern "c" fn ftruncate(fd: c_int, length: c_long) c_int;
    extern "c" fn mmap(
        addr: ?*anyopaque,
        len: usize,
        prot: c_int,
        flags: c_int,
        fd: c_int,
        offset: c_long,
    ) *anyopaque;
    extern "c" fn munmap(addr: *anyopaque, len: usize) c_int;
    extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;
    // Test-only.
    extern "c" fn mkstemp(template: [*]u8) c_int;
    extern "c" fn unlink(path: [*:0]const u8) c_int;
    extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
};

const O_RDWR: c_int = 0x2;
const O_CREAT: c_int = if (builtin.os.tag == .macos) 0x200 else 0o100;
const PROT_READ: c_int = 0x1;
const PROT_WRITE: c_int = 0x2;
const MAP_SHARED: c_int = 0x1;

// --- tests ---

test "Counters layout matches the host wire format" {
    var c: Counters = .{};
    c.bytes_reported = 0x1122_3344_5566_7788;
    c.bytes_inflated = 0x99aa_bbcc_ddee_ff00;
    const bytes = std.mem.asBytes(&c);
    try std.testing.expectEqual(@as(usize, 16), bytes.len);
    // Little-endian on every arch we ship; the first byte is the
    // low byte of bytes_reported.
    try std.testing.expectEqual(@as(u8, 0x88), bytes[0]);
    try std.testing.expectEqual(@as(u8, 0x77), bytes[1]);
    try std.testing.expectEqual(@as(u8, 0x00), bytes[8]);
    try std.testing.expectEqual(@as(u8, 0xff), bytes[9]);
}

test "stubCounters returns the same address every call" {
    const a = stubCounters();
    const b = stubCounters();
    try std.testing.expectEqual(a, b);
}

test "atomic add into a Counters bumps the field" {
    var local: Counters = .{};
    _ = @atomicRmw(u64, &local.bytes_reported, .Add, 4096, .monotonic);
    _ = @atomicRmw(u64, &local.bytes_reported, .Add, 4096, .monotonic);
    _ = @atomicRmw(u64, &local.bytes_inflated, .Add, 1024, .monotonic);
    try std.testing.expectEqual(
        @as(u64, 8192),
        @atomicLoad(u64, &local.bytes_reported, .monotonic),
    );
    try std.testing.expectEqual(
        @as(u64, 1024),
        @atomicLoad(u64, &local.bytes_inflated, .monotonic),
    );
}

test "Stats.open mmaps a file the host can read" {
    // Use mkstemp to produce a unique file in /tmp; tmpDir's path
    // accessor moved between Zig releases, but mkstemp(3) is stable.
    const template = "/tmp/machinen-stats-test-XXXXXX";
    var path_buf: [template.len + 1]u8 = undefined;
    @memcpy(path_buf[0..template.len], template);
    path_buf[template.len] = 0;
    const fd = libc.mkstemp(@ptrCast(&path_buf));
    if (fd < 0) return error.MkstempFailed;
    _ = libc.close(fd);
    defer _ = libc.unlink(@ptrCast(&path_buf));

    var s = try Stats.open(@ptrCast(&path_buf));
    defer s.deinit();
    _ = @atomicRmw(u64, &s.counters.bytes_reported, .Add, 8192, .monotonic);

    // Read the file as bytes via libc and verify the counter is
    // visible through the page cache, just like the host TS reader
    // does. (Avoiding std.fs to stay portable across Zig releases.)
    const read_fd = libc.open(@ptrCast(&path_buf), O_RDWR, @as(c_uint, 0));
    if (read_fd < 0) return error.OpenFailed;
    defer _ = libc.close(read_fd);
    var buf: [16]u8 = undefined;
    const n = libc.read(read_fd, &buf, buf.len);
    try std.testing.expectEqual(@as(isize, 16), n);
    const reported = std.mem.readInt(u64, buf[0..8], .little);
    try std.testing.expectEqual(@as(u64, 8192), reported);
}
