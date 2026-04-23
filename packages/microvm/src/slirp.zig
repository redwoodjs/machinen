//! libslirp bindings — a user-mode TCP/IP stack that replies to the
//! guest's packets without needing a real network interface on the
//! host. For #46 M3.
//!
//! Shape:
//!   1. `Slirp.init` creates a libslirp instance with QEMU-ish defaults
//!      (guest net 10.0.2.0/24, gateway 10.0.2.2, DHCP range from
//!      10.0.2.15) and hooks a `virtio.Device` so slirp's outbound
//!      frames land on the RX queue.
//!   2. `slirp.input(frame)` hands a guest-emitted ethernet frame to
//!      libslirp. libslirp may synchronously invoke our `sendCb` to
//!      deliver a reply (DHCP OFFER, ARP REPLY, etc.), which calls
//!      `Device.injectRx`.
//!   3. `slirp.pump()` runs libslirp's poll cycle with a short timeout
//!      so it can observe host-side socket activity (TCP ACKs, real
//!      DNS replies). Called periodically from a background thread.
//!
//! macOS-only for now. `brew install libslirp`.

const std = @import("std");
const builtin = @import("builtin");
const virtio = @import("virtio.zig");

comptime {
    if (builtin.os.tag != .macos) {
        @compileError("slirp.zig only builds on macOS (uses libslirp via Homebrew)");
    }
}

// -------------------------------------------------------------------
// Minimal libslirp C surface. The full header has a lot we don't
// need. Declared by hand so we don't depend on Zig's translate-c
// succeeding against every BSD socket macro on macOS.

/// Opaque Slirp* — treated as *anyopaque from Zig.
const SlirpHandle = *anyopaque;

const SlirpPollIn: c_int = 1 << 0;
const SlirpPollOut: c_int = 1 << 1;
const SlirpPollPri: c_int = 1 << 2;
const SlirpPollErr: c_int = 1 << 3;
const SlirpPollHup: c_int = 1 << 4;

const SlirpWriteCb = *const fn (buf: ?*const anyopaque, len: usize, opaque_: ?*anyopaque) callconv(.c) isize;
const SlirpTimerCb = *const fn (cb_opaque: ?*anyopaque) callconv(.c) void;
const SlirpAddPollSocketCb = *const fn (fd: c_int, events: c_int, opaque_: ?*anyopaque) callconv(.c) c_int;
const SlirpGetREventsCb = *const fn (idx: c_int, opaque_: ?*anyopaque) callconv(.c) c_int;

// v4-style callbacks struct (only the fields we populate — the rest
// of SlirpConfig v6 is zeroed out).
const SlirpCb = extern struct {
    send_packet: SlirpWriteCb,
    guest_error: *const fn (msg: [*:0]const u8, opaque_: ?*anyopaque) callconv(.c) void,
    clock_get_ns: *const fn (opaque_: ?*anyopaque) callconv(.c) i64,
    timer_new: *const fn (cb: SlirpTimerCb, cb_opaque: ?*anyopaque, opaque_: ?*anyopaque) callconv(.c) ?*anyopaque,
    timer_free: *const fn (timer: ?*anyopaque, opaque_: ?*anyopaque) callconv(.c) void,
    timer_mod: *const fn (timer: ?*anyopaque, expire_ms: i64, opaque_: ?*anyopaque) callconv(.c) void,
    // Deprecated register_poll_fd / unregister_poll_fd — keep the
    // slots but point them at stubs.
    register_poll_fd: *const fn (fd: c_int, opaque_: ?*anyopaque) callconv(.c) void,
    unregister_poll_fd: *const fn (fd: c_int, opaque_: ?*anyopaque) callconv(.c) void,
    notify: *const fn (opaque_: ?*anyopaque) callconv(.c) void,
    // v4+
    init_completed: ?*const fn (slirp: SlirpHandle, opaque_: ?*anyopaque) callconv(.c) void,
    timer_new_opaque: ?*const fn (id: c_int, cb_opaque: ?*anyopaque, opaque_: ?*anyopaque) callconv(.c) ?*anyopaque,
    // v6
    register_poll_socket: ?*const fn (sock: c_int, opaque_: ?*anyopaque) callconv(.c) void,
    unregister_poll_socket: ?*const fn (sock: c_int, opaque_: ?*anyopaque) callconv(.c) void,
};

// libslirp's config struct, version 1 fields only (enough for bring-up).
// We keep it at version 1 so the "newer fields" after it can stay
// zeroed without risking misalignment surprises.
const InAddr = extern struct { s_addr: u32 };
const In6Addr = extern struct { bytes: [16]u8 };
const Sockaddr_in = extern struct { dummy: [32]u8 };
const Sockaddr_in6 = extern struct { dummy: [32]u8 };

const SlirpConfig = extern struct {
    version: u32,
    // v1 fields
    restricted: c_int = 0,
    in_enabled: bool = true,
    vnetwork: InAddr = .{ .s_addr = 0 },
    vnetmask: InAddr = .{ .s_addr = 0 },
    vhost: InAddr = .{ .s_addr = 0 },
    in6_enabled: bool = false,
    vprefix_addr6: In6Addr = .{ .bytes = @splat(0) },
    vprefix_len: u8 = 0,
    vhost6: In6Addr = .{ .bytes = @splat(0) },
    vhostname: ?[*:0]const u8 = null,
    tftp_server_name: ?[*:0]const u8 = null,
    tftp_path: ?[*:0]const u8 = null,
    bootfile: ?[*:0]const u8 = null,
    vdhcp_start: InAddr = .{ .s_addr = 0 },
    vnameserver: InAddr = .{ .s_addr = 0 },
    vnameserver6: In6Addr = .{ .bytes = @splat(0) },
    vdnssearch: ?[*]const ?[*:0]const u8 = null,
    vdomainname: ?[*:0]const u8 = null,
    if_mtu: usize = 0,
    if_mru: usize = 0,
    disable_host_loopback: bool = false,
    enable_emu: bool = false,
    // v2+ fields — leave zeroed; we only advertise v1.
    _pad: [256]u8 = @splat(0),
};

extern "c" fn slirp_new(cfg: *const SlirpConfig, callbacks: *const SlirpCb, opaque_: ?*anyopaque) ?SlirpHandle;
extern "c" fn slirp_cleanup(s: SlirpHandle) void;
extern "c" fn slirp_input(s: SlirpHandle, buf: [*]const u8, len: c_int) void;
extern "c" fn slirp_pollfds_fill_socket(s: SlirpHandle, timeout_ms: *u32, add: SlirpAddPollSocketCb, opaque_: ?*anyopaque) void;
extern "c" fn slirp_pollfds_poll(s: SlirpHandle, error_: c_int, get_revents: SlirpGetREventsCb, opaque_: ?*anyopaque) void;

// host poll(2) — use direct libc fn so we can build a poll set.
const PollFd = extern struct {
    fd: c_int,
    events: i16,
    revents: i16,
};
extern "c" fn poll(fds: [*]PollFd, nfds: c_ulong, timeout_ms: c_int) c_int;
const POLLIN: i16 = 0x0001;
const POLLOUT: i16 = 0x0004;
const POLLERR: i16 = 0x0008;
const POLLHUP: i16 = 0x0010;
const POLLPRI: i16 = 0x0002;

// libc time helpers (std.time moved in Zig 0.16; direct bindings keep
// us insulated from stdlib churn).
const CTimespec = extern struct { tv_sec: i64, tv_nsec: c_long };
extern "c" fn nanosleep(req: *const CTimespec, rem: ?*CTimespec) c_int;
extern "c" fn clock_gettime(clk_id: c_int, tp: *CTimespec) c_int;
const CLOCK_MONOTONIC: c_int = 6; // macOS

// pthread mutex via extern bindings — std.Thread.Mutex was moved to
// std.Io.Mutex in Zig 0.16 (requires an io context we don't carry).
// Darwin's pthread_mutex_t is 64 bytes; the spec lets PTHREAD_MUTEX_INITIALIZER
// be all-zeros for the default mutex type, so we just zero-init.
const PthreadMutex = extern struct { opaque_bytes: [64]u8 = @splat(0) };
extern "c" fn pthread_mutex_lock(m: *PthreadMutex) c_int;
extern "c" fn pthread_mutex_unlock(m: *PthreadMutex) c_int;
fn sleepMs(ms: u64) void {
    const ts = CTimespec{ .tv_sec = @intCast(ms / 1000), .tv_nsec = @intCast((ms % 1000) * 1_000_000) };
    _ = nanosleep(&ts, null);
}

// -------------------------------------------------------------------
// Public Slirp wrapper

pub const Config = struct {
    /// Guest-side hostname reported via DHCP.
    vhostname: [*:0]const u8 = "machinen",
    /// Disable DHCP if you'd rather configure the guest manually.
    disable_dhcp: bool = false,
};

pub const Slirp = struct {
    handle: SlirpHandle,
    netdev: *virtio.Device,
    poll_fds: std.ArrayList(PollFd) = .empty,
    gpa: std.mem.Allocator,
    /// Callback fired once per pump iteration if at least one inbound
    /// frame was injected, so the run loop can raise the IRQ line in
    /// a single hypervisor call instead of one per packet.
    on_rx: ?*const fn (ctx: ?*anyopaque) void = null,
    on_rx_ctx: ?*anyopaque = null,
    /// Set by sendCb on every frame; cleared by pump() after it raises
    /// the IRQ line. pump thread is the only reader/writer, so no sync.
    rx_pending: bool = false,
    /// libslirp is not thread-safe. It was designed for QEMU's single-
    /// threaded main loop and has no internal locking. We call it from
    /// two threads: the pump thread (slirp_pollfds_poll) and the vCPU
    /// thread (slirp_input, via Slirp.input). Under concurrent traffic
    /// the races manifest as internal asserts ("sbcopy: ptr_diff !=
    /// sb->sb_cc") or crashes in _if_output / _tcp_output. Every
    /// public libslirp entry point has to happen under this mutex.
    lock: PthreadMutex = .{},

    /// Create a libslirp instance + bridge to the given virtio-net
    /// Device. Returns a heap-allocated Slirp* because libslirp stores
    /// the opaque pointer we pass it; the value itself must not move.
    pub fn create(gpa: std.mem.Allocator, netdev: *virtio.Device, cfg: Config) !*Slirp {
        var c: SlirpConfig = .{ .version = 1 };
        c.in_enabled = true;
        c.vnetwork = .{ .s_addr = ip4Be(10, 0, 2, 0) };
        c.vnetmask = .{ .s_addr = ip4Be(255, 255, 255, 0) };
        c.vhost = .{ .s_addr = ip4Be(10, 0, 2, 2) };
        c.vdhcp_start = .{ .s_addr = ip4Be(10, 0, 2, 15) };
        c.vnameserver = .{ .s_addr = ip4Be(10, 0, 2, 3) };
        c.vhostname = cfg.vhostname;
        c.if_mtu = 1500;
        c.if_mru = 1500;

        const callbacks = SlirpCb{
            .send_packet = sendCb,
            .guest_error = guestErrorCb,
            .clock_get_ns = clockGetNsCb,
            .timer_new = timerNewCb,
            .timer_free = timerFreeCb,
            .timer_mod = timerModCb,
            .register_poll_fd = registerPollFdCb,
            .unregister_poll_fd = unregisterPollFdCb,
            .notify = notifyCb,
            .init_completed = null,
            .timer_new_opaque = null,
            .register_poll_socket = null,
            .unregister_poll_socket = null,
        };

        const self = try gpa.create(Slirp);
        self.* = .{
            .handle = undefined,
            .netdev = netdev,
            .gpa = gpa,
        };
        const h = slirp_new(&c, &callbacks, @ptrCast(self)) orelse {
            gpa.destroy(self);
            return error.SlirpInitFailed;
        };
        self.handle = h;
        return self;
    }

    pub fn destroy(self: *Slirp) void {
        slirp_cleanup(self.handle);
        self.poll_fds.deinit(self.gpa);
        self.gpa.destroy(self);
    }

    /// Feed an ethernet frame the guest just emitted.
    pub fn input(self: *Slirp, frame: []const u8) void {
        _ = pthread_mutex_lock(&self.lock);
        defer _ = pthread_mutex_unlock(&self.lock);
        slirp_input(self.handle, frame.ptr, @intCast(frame.len));
    }

    /// One tick of the libslirp event loop. Caller should invoke
    /// periodically (every ~10 ms) from a helper thread.
    pub fn pump(self: *Slirp, default_timeout_ms: u32) void {
        // Hold the lock across both fill_socket and pollfds_poll.
        // poll() itself releases the lock — it can block for up to
        // 20ms and the vCPU thread needs to call slirp.input during
        // that window or we starve TX.
        _ = pthread_mutex_lock(&self.lock);
        self.poll_fds.clearRetainingCapacity();
        var timeout: u32 = default_timeout_ms;
        slirp_pollfds_fill_socket(self.handle, &timeout, addPollCb, @ptrCast(self));
        _ = pthread_mutex_unlock(&self.lock);

        const n = self.poll_fds.items.len;
        if (n > 0) {
            _ = poll(self.poll_fds.items.ptr, @intCast(n), @intCast(@min(timeout, 20)));
        } else if (timeout < std.math.maxInt(c_int)) {
            // No fds to poll; sleep briefly so we don't busy-loop.
            sleepMs(@min(timeout, 5));
        }

        _ = pthread_mutex_lock(&self.lock);
        slirp_pollfds_poll(self.handle, 0, getRevents, @ptrCast(self));
        const had_rx = self.rx_pending;
        self.rx_pending = false;
        _ = pthread_mutex_unlock(&self.lock);

        // Raise the virtio-net IRQ once per pump iteration rather than
        // once per sendCb — libslirp dispatches many frames per call
        // into the guest's RX ring under bulk traffic, and the guest's
        // NAPI loop drains them all on the first interrupt anyway.
        if (had_rx) {
            if (self.on_rx) |cb| cb(self.on_rx_ctx);
        }
    }
};

// -------------------------------------------------------------------
// C callbacks — the `opaque_` pointer in each is the *Slirp we stored.

fn selfFrom(opaque_: ?*anyopaque) *Slirp {
    return @ptrCast(@alignCast(opaque_.?));
}

fn sendCb(buf: ?*const anyopaque, len: usize, opaque_: ?*anyopaque) callconv(.c) isize {
    const self = selfFrom(opaque_);
    const bytes: [*]const u8 = @ptrCast(buf.?);
    if (self.netdev.injectRx(bytes[0..len])) self.rx_pending = true;
    return @intCast(len);
}

fn guestErrorCb(msg: [*:0]const u8, _: ?*anyopaque) callconv(.c) void {
    const s = std.mem.span(msg);
    var buf: [256]u8 = undefined;
    const line = std.fmt.bufPrint(&buf, "[slirp guest_error] {s}\n", .{s}) catch return;
    _ = std.c.write(2, line.ptr, line.len);
}

fn clockGetNsCb(_: ?*anyopaque) callconv(.c) i64 {
    var ts: CTimespec = undefined;
    _ = clock_gettime(CLOCK_MONOTONIC, &ts);
    return @as(i64, ts.tv_sec) * std.time.ns_per_s + @as(i64, ts.tv_nsec);
}

// Minimal timer shim: libslirp mainly uses this for IPv6 RA. For
// M3 bring-up we accept a new timer, ignore modifications, and free
// the placeholder on request. IPv6 RA doesn't matter since we
// advertise IPv4-only via the config.
const TimerShim = struct { dead: bool = false };

fn timerNewCb(_: SlirpTimerCb, _: ?*anyopaque, opaque_: ?*anyopaque) callconv(.c) ?*anyopaque {
    const self = selfFrom(opaque_);
    const t = self.gpa.create(TimerShim) catch return null;
    t.* = .{};
    return @ptrCast(t);
}
fn timerFreeCb(timer: ?*anyopaque, opaque_: ?*anyopaque) callconv(.c) void {
    if (timer == null) return;
    const self = selfFrom(opaque_);
    const t: *TimerShim = @ptrCast(@alignCast(timer.?));
    self.gpa.destroy(t);
}
fn timerModCb(_: ?*anyopaque, _: i64, _: ?*anyopaque) callconv(.c) void {
    // No-op: we don't fire timers yet.
}

fn registerPollFdCb(_: c_int, _: ?*anyopaque) callconv(.c) void {}
fn unregisterPollFdCb(_: c_int, _: ?*anyopaque) callconv(.c) void {}
fn notifyCb(_: ?*anyopaque) callconv(.c) void {}

fn addPollCb(fd: c_int, events: c_int, opaque_: ?*anyopaque) callconv(.c) c_int {
    const self = selfFrom(opaque_);
    var ev: i16 = 0;
    if ((events & SlirpPollIn) != 0) ev |= POLLIN;
    if ((events & SlirpPollOut) != 0) ev |= POLLOUT;
    if ((events & SlirpPollPri) != 0) ev |= POLLPRI;
    self.poll_fds.append(self.gpa, .{ .fd = fd, .events = ev, .revents = 0 }) catch return -1;
    return @intCast(self.poll_fds.items.len - 1);
}

fn getRevents(idx: c_int, opaque_: ?*anyopaque) callconv(.c) c_int {
    const self = selfFrom(opaque_);
    const i: usize = @intCast(idx);
    if (i >= self.poll_fds.items.len) return 0;
    const rev = self.poll_fds.items[i].revents;
    var out: c_int = 0;
    if ((rev & POLLIN) != 0) out |= SlirpPollIn;
    if ((rev & POLLOUT) != 0) out |= SlirpPollOut;
    if ((rev & POLLPRI) != 0) out |= SlirpPollPri;
    if ((rev & POLLERR) != 0) out |= SlirpPollErr;
    if ((rev & POLLHUP) != 0) out |= SlirpPollHup;
    return out;
}

fn ip4Be(a: u8, b: u8, c_: u8, d: u8) u32 {
    // in_addr.s_addr is network-byte-order (big-endian). On macOS
    // little-endian hosts we have to byte-swap before assigning.
    const host: u32 = (@as(u32, a) << 24) | (@as(u32, b) << 16) | (@as(u32, c_) << 8) | @as(u32, d);
    return std.mem.nativeToBig(u32, host);
}
