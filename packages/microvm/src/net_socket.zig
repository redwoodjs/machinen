//! gvproxy (containers/gvisor-tap-vsock) client over the qemu-netdev
//! Unix stream socket. Each virtio-net ethernet frame is prefixed with
//! a 4-byte big-endian length — the same wire format QEMU speaks with
//! `-netdev socket,fd=N`. gvproxy terminates the guest's TCP/IP stack
//! in its own user-space netstack, so we're just a frame pipe.
//!
//! gvproxy's netstack is thread-safe, runs as an unprivileged
//! subprocess, and the wire protocol is trivial enough that we
//! don't link anything — we just read/write bytes on a socket.
//!
//! Shape:
//!   1. `NetSocket.connect(path)` dials the gvproxy qemu-netdev UDS
//!      and spawns an RX thread that reads length-prefixed frames,
//!      hands each one to `virtio.Device.injectRx`, then fires
//!      `on_rx` so the run loop can raise the virtio SPI.
//!   2. `NetSocket.input(frame)` writes a length-prefixed frame back
//!      to gvproxy. Serialized by a mutex so concurrent senders can
//!      never interleave a prefix with another frame's bytes.
//!   3. `destroy()` half-shuts the socket so the blocking read in the
//!      RX thread returns EOF, joins the thread, closes the fd.
//!
//! macOS-only for now. Boot backend is HVF; the KVM path has its own
//! network wiring to land later.

const std = @import("std");
const builtin = @import("builtin");
const virtio = @import("virtio.zig");
const pl011 = @import("pl011.zig"); // for the shared PthreadMutex shim

comptime {
    if (builtin.os.tag != .macos) {
        @compileError("net_socket.zig targets macOS (matches boot_hvf.zig)");
    }
}

// ---- libc + sockaddr_un (macOS layout: u8 sun_len, u8 sun_family,
// char[104] sun_path). sa_family_t on macOS is u8. ------------------

const AF_UNIX: c_int = 1;
const SOCK_STREAM: c_int = 1;
const SHUT_RDWR: c_int = 2;
const EINTR: c_int = 4;

const sockaddr_un = extern struct {
    sun_len: u8,
    sun_family: u8,
    sun_path: [104]u8,
};

extern "c" fn socket(domain: c_int, typ: c_int, protocol: c_int) c_int;
// Renamed to avoid colliding with `NetSocket.connect`. The `@extern`
// builtin lets us bind a Zig-friendly symbol name to the libc `connect`.
const c_connect = @extern(
    *const fn (fd: c_int, addr: *const anyopaque, addrlen: u32) callconv(.c) c_int,
    .{ .name = "connect" },
);
extern "c" fn close(fd: c_int) c_int;
extern "c" fn shutdown(fd: c_int, how: c_int) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;

// macOS errno is a thread-local reached via __error().
extern "c" fn __error() *c_int;
fn errno() c_int {
    return __error().*;
}

// ---- public API ----------------------------------------------------

pub const Config = struct {
    /// Absolute filesystem path to gvproxy's qemu-netdev UDS — the one
    /// it was started with: `gvproxy -listen-qemu unix:///path/to/sock`.
    /// Must already exist and be a stream socket.
    socket_path: []const u8,
};

pub const NetSocket = struct {
    fd: c_int,
    netdev: *virtio.Device,
    gpa: std.mem.Allocator,

    /// Fired after each RX frame is injected into the guest's RX queue
    /// so the run loop can raise the virtio SPI. Kept as a pointer-pair
    /// (not a closure) to mirror the old slirp.zig shape; boot_hvf owns
    /// the context.
    on_rx: ?*const fn (ctx: ?*anyopaque) void = null,
    on_rx_ctx: ?*anyopaque = null,

    rx_thread: ?std.Thread = null,
    stop: std.atomic.Value(bool) = .init(false),
    /// Serializes writes so a concurrent caller can never interleave
    /// its length prefix with someone else's payload bytes. pthread
    /// shim because std.Thread.Mutex moved under std.Io in Zig 0.16.
    tx_mutex: pl011.PthreadMutex = .{},

    /// Dial gvproxy and spawn the RX thread. Heap-allocated because
    /// the RX thread and `on_rx_ctx` callers keep a stable pointer.
    pub fn connect(gpa: std.mem.Allocator, netdev: *virtio.Device, cfg: Config) !*NetSocket {
        if (cfg.socket_path.len >= @sizeOf(@TypeOf(@as(sockaddr_un, undefined).sun_path))) {
            return error.SocketPathTooLong;
        }

        const fd = socket(AF_UNIX, SOCK_STREAM, 0);
        if (fd < 0) return error.SocketCreateFailed;
        errdefer _ = close(fd);

        var addr: sockaddr_un = .{ .sun_len = 0, .sun_family = AF_UNIX, .sun_path = @splat(0) };
        @memcpy(addr.sun_path[0..cfg.socket_path.len], cfg.socket_path);
        // Total address length: 2 bytes (sun_len + sun_family) + path + NUL.
        const addrlen: u32 = @intCast(2 + cfg.socket_path.len + 1);
        addr.sun_len = @intCast(addrlen);

        if (c_connect(fd, @ptrCast(&addr), addrlen) < 0) return error.ConnectFailed;

        const self = try gpa.create(NetSocket);
        self.* = .{ .fd = fd, .netdev = netdev, .gpa = gpa };
        self.rx_thread = try std.Thread.spawn(.{}, rxLoop, .{self});
        return self;
    }

    pub fn destroy(self: *NetSocket) void {
        self.stop.store(true, .release);
        // Wake the RX thread if it's parked in read().
        _ = shutdown(self.fd, SHUT_RDWR);
        if (self.rx_thread) |t| t.join();
        _ = close(self.fd);
        self.gpa.destroy(self);
    }

    /// Hand a guest-emitted ethernet frame to gvproxy. Blocking write —
    /// the kernel buffers the stream so this is effectively non-blocking
    /// under normal load.
    pub fn input(self: *NetSocket, frame: []const u8) void {
        if (frame.len == 0 or frame.len > std.math.maxInt(u32)) return;
        var prefix: [4]u8 = undefined;
        std.mem.writeInt(u32, &prefix, @intCast(frame.len), .big);

        self.tx_mutex.lock();
        defer self.tx_mutex.unlock();
        // Guard against a partial write sliced across two frames: if
        // the prefix fails, skip the payload; the stream is now broken
        // but serialized senders won't interleave mid-frame.

        if (writeAll(self.fd, &prefix) != 0) return;
        _ = writeAll(self.fd, frame);
    }

    fn rxLoop(self: *NetSocket) void {
        // One buffer for the whole thread. MTU is 1500 on the gvproxy
        // tap; 16 KiB is plenty of headroom for a future jumbo config.
        var buf: [16 * 1024]u8 = undefined;

        while (!self.stop.load(.acquire)) {
            var prefix: [4]u8 = undefined;
            if (readAll(self.fd, &prefix) != 0) return;
            const len = std.mem.readInt(u32, &prefix, .big);
            if (len == 0 or len > buf.len) return;

            if (readAll(self.fd, buf[0..len]) != 0) return;

            _ = self.netdev.injectRx(buf[0..len]);
            if (self.on_rx) |cb| cb(self.on_rx_ctx);
        }
    }
};

// ---- helpers -------------------------------------------------------

fn writeAll(fd: c_int, data: []const u8) c_int {
    var remaining = data;
    while (remaining.len > 0) {
        const n = write(fd, remaining.ptr, remaining.len);
        if (n > 0) {
            remaining = remaining[@intCast(n)..];
            continue;
        }
        if (n < 0 and errno() == EINTR) continue;
        return -1;
    }
    return 0;
}

fn readAll(fd: c_int, into: []u8) c_int {
    var remaining = into;
    while (remaining.len > 0) {
        const n = read(fd, remaining.ptr, remaining.len);
        if (n > 0) {
            remaining = remaining[@intCast(n)..];
            continue;
        }
        if (n == 0) return -1; // peer closed
        if (errno() == EINTR) continue;
        return -1;
    }
    return 0;
}
