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
const assert = std.debug.assert;

comptime {
    // sockaddr_un layout the kernel expects:
    //   macOS: { u8 sun_len; u8 sun_family; char[104] sun_path; } (106B)
    //   Linux: { u16 sun_family; char[108] sun_path; }            (110B)
    // A mismatch would silently truncate the path during connect()
    // and the socket dial would land somewhere else (or fail).
    if (builtin.os.tag == .macos) {
        assert(@sizeOf(sockaddr_un) == 106);
        assert(@offsetOf(sockaddr_un, "sun_len") == 0);
        assert(@offsetOf(sockaddr_un, "sun_family") == 1);
        assert(@offsetOf(sockaddr_un, "sun_path") == 2);
    } else {
        assert(@sizeOf(sockaddr_un) == 110);
        assert(@offsetOf(sockaddr_un, "sun_family") == 0);
        assert(@offsetOf(sockaddr_un, "sun_path") == 2);
    }
    // The qemu-netdev wire format prefixes every frame with a 4-byte
    // big-endian length; both writeInt sites below depend on this.
    assert(AF_UNIX == 1);
    assert(SHUT_RDWR == 2);
}

// ---- libc + sockaddr_un. Layouts differ between platforms:
//   macOS: { u8 sun_len; u8 sun_family; char[104] sun_path; }
//          (sa_family_t == u8; address length is wire-encoded)
//   Linux: { u16 sun_family; char[108] sun_path; }
//          (no sun_len; sa_family_t == u16)
// AF_UNIX is 1 on both. SOCK_STREAM is 1 on both. EINTR is 4 on
// both. SHUT_RDWR is 2 on both. ------------------------------------

const AF_UNIX: c_int = 1;
const SOCK_STREAM: c_int = 1;
const SHUT_RDWR: c_int = 2;
const EINTR: c_int = 4;

/// Per call to writeAll/readAll, cap the number of consecutive EINTR
/// retries so a signal storm can't pin the thread. A healthy socket
/// either makes byte-progress or closes; EINTR is transient. 64 is
/// generous (NASA Power-of-Ten Rule 2 / #238).
const max_eintr_retries: u32 = 64;

const sockaddr_un = if (builtin.os.tag == .macos) extern struct {
    sun_len: u8,
    sun_family: u8,
    sun_path: [104]u8,
} else extern struct {
    sun_family: u16,
    sun_path: [108]u8,
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

// errno: macOS uses __error(), glibc uses __errno_location().
extern "c" fn __error() *c_int;
extern "c" fn __errno_location() *c_int;
fn errno() c_int {
    return if (builtin.os.tag == .macos) __error().* else __errno_location().*;
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
    /// Serialises the (RMW interrupt_status + setIrq) pair so the
    /// RX thread's "I just injected, raise the line" can't be
    /// overridden by the vCPU thread's "post-MMIO snapshot says
    /// line=0". Taken inside `rxLoop` around `injectRx + on_rx`,
    /// and by the vCPU's net-MMIO handler around its read/write +
    /// setIrq via `lockIrq` / `unlockIrq` below. Same shape as the
    /// vsock Bridge mutex; without it, KVM_IRQ_LINE delivery loses
    /// the rising edge for RX frames whenever the vCPU is mid-MMIO
    /// at the moment the bridge thread injects. See #231 / #234 /
    /// the vsock-IRQ commit (PR #235) for the analogous race.
    irq_mu: pl011.PthreadMutex = .{},

    /// Dial gvproxy and spawn the RX thread. Heap-allocated because
    /// the RX thread and `on_rx_ctx` callers keep a stable pointer.
    pub fn connect(gpa: std.mem.Allocator, netdev: *virtio.Device, cfg: Config) !*NetSocket {
        assert(cfg.socket_path.len > 0);
        assert(netdev.size > 0);
        if (cfg.socket_path.len >= @sizeOf(@TypeOf(@as(sockaddr_un, undefined).sun_path))) {
            return error.SocketPathTooLong;
        }

        const fd = socket(AF_UNIX, SOCK_STREAM, 0);
        if (fd < 0) return error.SocketCreateFailed;
        assert(fd >= 0);
        errdefer _ = close(fd);

        // macOS: 1-byte sun_len + 1-byte sun_family before sun_path
        //        (header is 2 bytes). Address length is wire-encoded
        //        in sun_len.
        // Linux: 2-byte sun_family before sun_path (header is 2 bytes).
        //        sun_len doesn't exist; addrlen is what the kernel uses.
        // The total header size happens to be 2 bytes on both, so the
        // addrlen formula is the same — only the per-field assignments
        // differ.
        var addr: sockaddr_un = if (builtin.os.tag == .macos)
            .{ .sun_len = 0, .sun_family = AF_UNIX, .sun_path = @splat(0) }
        else
            .{ .sun_family = AF_UNIX, .sun_path = @splat(0) };
        @memcpy(addr.sun_path[0..cfg.socket_path.len], cfg.socket_path);
        const addrlen: u32 = @intCast(2 + cfg.socket_path.len + 1);
        assert(addrlen <= @sizeOf(sockaddr_un));
        if (builtin.os.tag == .macos) addr.sun_len = @intCast(addrlen);

        if (c_connect(fd, @ptrCast(&addr), addrlen) < 0) return error.ConnectFailed;

        const self = try gpa.create(NetSocket);
        self.* = .{ .fd = fd, .netdev = netdev, .gpa = gpa };
        self.rx_thread = try std.Thread.spawn(.{}, rx_loop, .{self});
        return self;
    }

    pub fn destroy(self: *NetSocket) void {
        assert(self.fd >= 0);
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
        assert(self.fd >= 0);
        if (frame.len == 0 or frame.len > std.math.maxInt(u32)) return;
        var prefix: [4]u8 = undefined;
        assert(prefix.len == 4);
        std.mem.writeInt(u32, &prefix, @intCast(frame.len), .big);

        self.tx_mutex.lock();
        defer self.tx_mutex.unlock();
        // Guard against a partial write sliced across two frames: if
        // the prefix fails, skip the payload; the stream is now broken
        // but serialized senders won't interleave mid-frame.

        if (write_all(self.fd, &prefix) != 0) return;
        _ = write_all(self.fd, frame);
    }

    fn rx_loop(self: *NetSocket) void {
        assert(self.fd >= 0);
        // One buffer for the whole thread. MTU is 1500 on the gvproxy
        // tap; 16 KiB is plenty of headroom for a future jumbo config.
        var buf: [16 * 1024]u8 = undefined;
        assert(buf.len >= 1500);

        // Service loop: termination bound is `self.stop` (set by
        // destroy() before shutdown()). Per-iteration work is bounded
        // statically — exactly one frame, ≤ buf.len bytes, plus two
        // readAll() calls each capped on EINTR by max_eintr_retries.
        // No frames-per-wake throttle: incoming frames are real work
        // and the kernel buffer keeps them ordered while we drain.
        while (!self.stop.load(.acquire)) {
            var prefix: [4]u8 = undefined;
            if (read_all(self.fd, &prefix) != 0) return;
            const frame_len_bytes = std.mem.readInt(u32, &prefix, .big);
            if (frame_len_bytes == 0 or frame_len_bytes > buf.len) return;
            assert(frame_len_bytes > 0 and frame_len_bytes <= buf.len);

            if (read_all(self.fd, buf[0..frame_len_bytes]) != 0) return;

            self.irq_mu.lock();
            _ = self.netdev.inject_rx(buf[0..frame_len_bytes]);
            if (self.on_rx) |cb| cb(self.on_rx_ctx);
            self.irq_mu.unlock();
        }
    }

    /// Take/release `irq_mu` for the vCPU's net-MMIO handler. See
    /// the field doc above for why.
    pub fn lock_irq(self: *NetSocket) void {
        self.irq_mu.lock();
    }
    pub fn unlock_irq(self: *NetSocket) void {
        self.irq_mu.unlock();
    }
};

// ---- helpers -------------------------------------------------------

fn write_all(fd: c_int, data: []const u8) c_int {
    assert(fd >= 0);
    assert(data.len > 0);
    var remaining = data;
    var eintr: u32 = 0;
    // remaining strictly shrinks on every n>0; eintr counts the
    // signal-retry path independently and is bounded by
    // max_eintr_retries (#238).
    while (remaining.len > 0) {
        const n = write(fd, remaining.ptr, remaining.len);
        if (n > 0) {
            remaining = remaining[@intCast(n)..];
            eintr = 0;
            continue;
        }
        if (n < 0 and errno() == EINTR) {
            eintr += 1;
            if (eintr > max_eintr_retries) return -1;
            continue;
        }
        return -1;
    }
    return 0;
}

fn read_all(fd: c_int, into: []u8) c_int {
    assert(fd >= 0);
    assert(into.len > 0);
    var remaining = into;
    var eintr: u32 = 0;
    while (remaining.len > 0) {
        const n = read(fd, remaining.ptr, remaining.len);
        if (n > 0) {
            remaining = remaining[@intCast(n)..];
            eintr = 0;
            continue;
        }
        if (n == 0) return -1; // peer closed
        if (errno() == EINTR) {
            eintr += 1;
            if (eintr > max_eintr_retries) return -1;
            continue;
        }
        return -1;
    }
    return 0;
}
