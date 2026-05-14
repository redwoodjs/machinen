//! FUSE-over-vsock transport for the machinen mount server (#329).
//!
//! Drop-in replacement for `@machinen/runtime/dist/mount-server-bin.js`
//! when the runtime is launched with `MACHINEN_MOUNT_SERVER_IMPL=zig`.
//!
//! This file is *only* the transport. It binds a host UDS the VMM's
//! vsock bridge routes the guest FUSE port to, reads length-prefixed
//! FUSE frames (u32 LE covering header+payload, same as `/dev/fuse`
//! returns), hands each frame to `fuse.dispatch`, and writes the reply
//! back. The protocol handlers themselves live in `fuse.zig`, shared
//! verbatim with the in-VMM virtio-fs transport (#332).
//!
//! Process model: single-threaded blocking, one connection at a time
//! (the guest only opens one).

const std = @import("std");
const builtin = @import("builtin");
const assert = std.debug.assert;
// The shared FUSE handler module — `src/fuse.zig`, exported by
// `build.zig` as the "fuse" module so the microvm's virtio-fs device
// can reuse the same handlers (#332).
const fuse = @import("fuse");

// Pull the shared handler module's tests into this compilation: the
// build only points `addTest` at this root source file, so importing
// `fuse` compiles it but skips its `test` blocks without this.
test {
    _ = fuse;
}

// --- libc externs -------------------------------------------------------

const AF_UNIX: c_int = 1;
const SOCK_STREAM: c_int = 1;
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
extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn unlink(path: [*:0]const u8) c_int;
extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;
extern "c" fn __error() *c_int;
extern "c" fn __errno_location() *c_int;

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

// --- frame loop ---------------------------------------------------------

var shutdown_requested = std.atomic.Value(bool).init(false);

fn serveConnection(state: *fuse.State, conn_fd: c_int) !void {
    assert(conn_fd >= 0);
    // One fixed-size read buffer per connection — no per-message
    // allocation on the read path. MAX_FUSE_MESSAGE covers the
    // negotiated 128 KiB max_write plus header + struct + name.
    var buf: [fuse.MAX_FUSE_MESSAGE]u8 = undefined;

    // Termination bound: `shutdown_requested` (set by the signal
    // handler) or a closed/EOF socket. Per-iteration work is bounded —
    // one frame, ≤ buf.len bytes, two readExact calls each capped on
    // EINTR, one dispatch.
    while (!shutdown_requested.load(.acquire)) {
        var len_bytes: [4]u8 = undefined;
        switch (readExact(conn_fd, &len_bytes)) {
            .ok => {},
            .closed => return,
            .eintr_shutdown => return,
        }
        const len = std.mem.readInt(u32, &len_bytes, .little);
        if (len < fuse.FUSE_IN_HEADER_SIZE) return error.MalformedFrame;
        if (len > buf.len) return error.FrameTooLarge;
        // Established by the two guards above — every dispatch sees a
        // frame that's at least a header and at most the read buffer.
        assert(len >= fuse.FUSE_IN_HEADER_SIZE and len <= buf.len);
        @memcpy(buf[0..4], &len_bytes);
        switch (readExact(conn_fd, buf[4..len])) {
            .ok => {},
            .closed => return,
            .eintr_shutdown => return,
        }
        // `dispatch` owns request decoding and reply construction; the
        // returned buffer (or null for no-reply ops) is ours to write
        // and free.
        const reply = try fuse.dispatch(state, buf[0..len]);
        if (reply) |r| {
            defer state.gpa.free(r);
            if (!writeAll(conn_fd, r)) return error.WriteFailed;
        }
    }
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

    var state = try fuse.State.init(gpa, args.root, args.mode_rw);
    defer state.deinit();
    state.stats_path = args.stats;
    state.profile_enabled = isProfileEnabled();

    const uds_path_owned = args.uds;
    defer gpa.free(uds_path_owned);

    const listen_fd = try bindAndListen(uds_path_owned);
    defer {
        _ = close(listen_fd);
        var uds_z: [108]u8 = @splat(0);
        if (uds_path_owned.len < uds_z.len) {
            @memcpy(uds_z[0..uds_path_owned.len], uds_path_owned);
            _ = unlink(@ptrCast(&uds_z));
        }
    }

    // Publish an initial stats file so a reader landing before the
    // first FUSE op sees valid JSON.
    fuse.writeStatsAtomic(&state);

    // Accept one connection. Loop is defensive: if the connection
    // drops mid-bench we'll accept the next one rather than exit.
    while (!shutdown_requested.load(.acquire)) {
        const conn = acceptOne(listen_fd) catch |e| switch (e) {
            error.Shutdown => break,
            else => return e,
        };
        serveConnection(&state, conn) catch |e| {
            std.debug.print("connection error: {}\n", .{e});
        };
        _ = close(conn);
    }

    // One final flush before exit so the bench picks up the closing
    // counters.
    fuse.writeStatsAtomic(&state);

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
