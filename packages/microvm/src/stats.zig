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
//!   offset  0:  u64 LE  bytes_reported       (total bytes the
//!                                              balloon device has
//!                                              reclaimed via free-
//!                                              page reporting)
//!   offset  8:  u64 LE  bytes_inflated       (total bytes seen on
//!                                              the inflate queue;
//!                                              usually 0 since we
//!                                              don't drive inflate)
//!   offset 16:  u64 LE  host_phys_footprint  (this VMM's
//!                                              `phys_footprint` on
//!                                              Darwin — last sample
//!                                              taken by the periodic
//!                                              sampler thread; 0 on
//!                                              Linux, where the
//!                                              runtime reads
//!                                              `/proc/<pid>/status`
//!                                              instead)
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
    /// Last `phys_footprint` sample for this VMM (Darwin only). Zero
    /// on Linux and on Darwin until the sampler has taken its first
    /// reading. The host runtime prefers this over `ps -o rss=` so
    /// `vm.memoryStats().hostRssBytes` reflects balloon reclaim
    /// (`MADV_FREE_REUSABLE` pages are excluded from `phys_footprint`
    /// immediately, but stay counted in `task_basic_info.resident_size`
    /// until the kernel actually reclaims them).
    host_phys_footprint: u64 align(8) = 0,
};

comptime {
    assert(@sizeOf(Counters) == 24);
    assert(@offsetOf(Counters, "bytes_reported") == 0);
    assert(@offsetOf(Counters, "bytes_inflated") == 8);
    assert(@offsetOf(Counters, "host_phys_footprint") == 16);
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
    extern "c" fn getpid() c_int;
    extern "c" fn nanosleep(req: *const timespec, rem: ?*timespec) c_int;
    // Test-only.
    extern "c" fn mkstemp(template: [*]u8) c_int;
    extern "c" fn unlink(path: [*:0]const u8) c_int;
    extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
    // Darwin: `proc_pid_rusage(pid, flavor, buffer)` from libproc.
    // `buffer` is `rusage_info_t`, an opaque pointer at the C level —
    // we pass a fixed-size byte buffer sized for `rusage_info_v4`.
    extern "c" fn proc_pid_rusage(pid: c_int, flavor: c_int, buffer: *anyopaque) c_int;

    // POSIX `struct timespec` — same layout on Darwin and Linux on
    // arm64: two 64-bit values (seconds + nanoseconds).
    pub const timespec = extern struct {
        tv_sec: c_long,
        tv_nsec: c_long,
    };
};

const O_RDWR: c_int = 0x2;
const O_CREAT: c_int = if (builtin.os.tag == .macos) 0x200 else 0o100;
const PROT_READ: c_int = 0x1;
const PROT_WRITE: c_int = 0x2;
const MAP_SHARED: c_int = 0x1;

// `proc_pid_rusage` flavor + struct size for `rusage_info_v4` from
// the Darwin SDK's `<sys/resource.h>`. The kernel writes the full
// 296-byte v4 struct; we only read `ri_phys_footprint` at byte
// offset 72 (16-byte UUID + 7 leading u64 fields).
const RUSAGE_INFO_V4: c_int = 4;
const RUSAGE_INFO_V4_SIZE: usize = 296;
const RUSAGE_PHYS_FOOTPRINT_OFFSET: usize = 72;

/// Spawn a detached background thread that polls this process's
/// `phys_footprint` every ~500 ms and atomically stores it into
/// `counters.host_phys_footprint`. macOS-only — Linux callers read
/// `/proc/<pid>/status:VmRSS`, which is exact, cheap, and reflects
/// `MADV_DONTNEED` reclaim immediately.
///
/// Why this exists: after the balloon's `MADV_FREE_REUSABLE` reclaim
/// on Darwin, `task_basic_info.resident_size` (what `ps -o rss=`
/// reads) does *not* drop until the kernel actually reclaims the
/// pages under memory pressure. `phys_footprint` (the metric ledger
/// behind Activity Monitor's "Memory" column) excludes reusable
/// pages and *does* drop immediately. Sampling our own
/// phys_footprint lets the host runtime show a number that tracks
/// reclaim regardless of host memory pressure.
///
/// Thread runs for the process's lifetime and is intentionally not
/// joinable — the VMM exits via `std.process.exit` once boot
/// returns, so there's no cleanup window where the sampler could
/// race with `Stats.deinit()`.
pub fn startPhysFootprintSampler(counters: *Counters) void {
    if (builtin.os.tag != .macos) return;
    const handle = std.Thread.spawn(
        .{},
        samplerLoop,
        .{counters},
    ) catch |err| {
        if (debugEnabled()) {
            std.debug.print("stats: sampler spawn failed: {s}\n", .{@errorName(err)});
        }
        return;
    };
    handle.detach();
}

fn samplerLoop(counters: *Counters) void {
    const half_second = libc.timespec{ .tv_sec = 0, .tv_nsec = 500 * 1_000_000 };
    while (true) {
        if (samplePhysFootprint()) |bytes| {
            @atomicStore(u64, &counters.host_phys_footprint, bytes, .monotonic);
        }
        // libc nanosleep — std.Thread.sleep was removed in Zig 0.16
        // and the new std.Io.sleep needs an Io capability we don't
        // wire through here. Plain nanosleep is fine: signals don't
        // interrupt the loop in any way we'd need to react to.
        _ = libc.nanosleep(&half_second, null);
    }
}

/// One synchronous sample. Returns null on non-Darwin or on syscall
/// failure (pid gone, kernel out of memory, etc.). Exposed for
/// tests; the production caller is `samplerLoop` above.
pub fn samplePhysFootprint() ?u64 {
    if (builtin.os.tag != .macos) return null;
    var buf: [RUSAGE_INFO_V4_SIZE]u8 align(8) = std.mem.zeroes([RUSAGE_INFO_V4_SIZE]u8);
    const rc = libc.proc_pid_rusage(libc.getpid(), RUSAGE_INFO_V4, &buf);
    if (rc != 0) return null;
    return std.mem.readInt(
        u64,
        buf[RUSAGE_PHYS_FOOTPRINT_OFFSET..][0..8],
        .little,
    );
}

// --- tests ---

test "Counters layout matches the host wire format" {
    var c: Counters = .{};
    c.bytes_reported = 0x1122_3344_5566_7788;
    c.bytes_inflated = 0x99aa_bbcc_ddee_ff00;
    c.host_phys_footprint = 0x0011_2233_4455_6677;
    const bytes = std.mem.asBytes(&c);
    try std.testing.expectEqual(@as(usize, 24), bytes.len);
    // Little-endian on every arch we ship; the first byte is the
    // low byte of bytes_reported.
    try std.testing.expectEqual(@as(u8, 0x88), bytes[0]);
    try std.testing.expectEqual(@as(u8, 0x77), bytes[1]);
    try std.testing.expectEqual(@as(u8, 0x00), bytes[8]);
    try std.testing.expectEqual(@as(u8, 0xff), bytes[9]);
    try std.testing.expectEqual(@as(u8, 0x77), bytes[16]);
    try std.testing.expectEqual(@as(u8, 0x66), bytes[17]);
}

test "samplePhysFootprint returns a positive value on Darwin" {
    if (builtin.os.tag != .macos) return error.SkipZigTest;
    const v = samplePhysFootprint() orelse return error.UnexpectedNull;
    try std.testing.expect(v > 0);
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
