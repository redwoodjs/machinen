//! Guest-side probe for the #82 net-bench smoke.
//!
//! Opens a TCP connection to a host echo server reachable through
//! gvproxy's built-in host mapping (`host.containers.internal` →
//! 192.168.127.254; gvproxy proxies that to the host), does N
//! sequential 1-byte sends + 1-byte receives, and reports total
//! wall time and μs per round trip.
//!
//! Prints a machine-parseable line the harness greps for:
//!
//!   net-bench: pings=<N> total_ms=<int> us_per_ping=<int>
//!
//! On connect/io failure, prints `net-bench: error=... msg=...` and
//! exits 0 — bench failures should be informational in the smoke
//! output, not abort the run.
//!
//! /init has already run /sbin/machinen-netup, so eth0 is up with
//! 192.168.127.2/24 and a default route through 192.168.127.1.
//!
//! Build (from packages/microvm):
//!   zig build-exe assets/net-bench-probe.zig \
//!     -target aarch64-linux-musl -static -O ReleaseSmall \
//!     -lc -femit-bin=<out>/machinen-net-bench-probe

const std = @import("std");

const default_host = "192.168.127.254";
const default_port: u16 = 38080;
const default_pings: u32 = 100;

// Socket constants (Linux / musl).
const AF_INET: c_int = 2;
const SOCK_STREAM: c_int = 1;
const IPPROTO_TCP: c_int = 6;
const TCP_NODELAY: c_int = 1;
const SOL_TCP: c_int = 6;

// clock_gettime clock id.
const CLOCK_MONOTONIC: c_int = 1;

const in_addr = extern struct {
    s_addr: u32,
};

const sockaddr_in = extern struct {
    sin_family: u16,
    sin_port: u16, // big-endian
    sin_addr: in_addr,
    sin_zero: [8]u8 = @splat(0),
};

const timespec = extern struct {
    tv_sec: i64,
    tv_nsec: i64,
};

extern "c" fn socket(domain: c_int, socktype: c_int, protocol: c_int) c_int;
extern "c" fn connect(fd: c_int, addr: *const anyopaque, addrlen: u32) c_int;
extern "c" fn setsockopt(fd: c_int, level: c_int, optname: c_int, optval: *const anyopaque, optlen: u32) c_int;
extern "c" fn write(fd: c_int, buf: *const anyopaque, count: usize) isize;
extern "c" fn read(fd: c_int, buf: *anyopaque, count: usize) isize;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn inet_pton(af: c_int, src: [*:0]const u8, dst: *anyopaque) c_int;
extern "c" fn clock_gettime(clk_id: c_int, tp: *timespec) c_int;
extern "c" fn htons(host: u16) u16;

fn print_err(comptime tag: []const u8, rc: c_int) void {
    std.debug.print("net-bench: error={s} rc={d}\n", .{ tag, rc });
}

pub fn main(init: std.process.Init.Minimal) u8 {
    std.debug.assert(@sizeOf(sockaddr_in) == 16);
    std.debug.assert(default_port > 0);
    std.debug.assert(default_pings > 0);

    var it = init.args.iterate();
    _ = it.next(); // argv[0]

    const host: [*:0]const u8 = if (it.next()) |s| s.ptr else default_host;
    const host_slice: []const u8 = std.mem.span(host);
    const port: u16 = if (it.next()) |s|
        (std.fmt.parseInt(u16, s, 10) catch default_port)
    else
        default_port;
    const pings: u32 = if (it.next()) |s|
        (std.fmt.parseInt(u32, s, 10) catch default_pings)
    else
        default_pings;

    if (pings == 0) return 0;

    std.debug.print("=== net-bench: tcp://{s}:{d} ({d} pings) ===\n", .{ host_slice, port, pings });

    var addr: sockaddr_in = .{
        .sin_family = AF_INET,
        .sin_port = htons(port),
        .sin_addr = .{ .s_addr = 0 },
    };
    if (inet_pton(AF_INET, host, &addr.sin_addr) != 1) {
        std.debug.print("net-bench: error=parse_ip host={s}\n", .{host_slice});
        return 0;
    }

    const fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) {
        print_err("socket", fd);
        return 0;
    }
    defer _ = close(fd);

    // TCP_NODELAY: we're measuring round-trip latency on 1-byte sends,
    // so any Nagle batching would inflate the numbers.
    const one: c_int = 1;
    if (setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, @sizeOf(c_int)) < 0) {
        print_err("setsockopt_nodelay", -1);
        return 0;
    }

    if (connect(fd, &addr, @sizeOf(sockaddr_in)) < 0) {
        print_err("connect", -1);
        return 0;
    }

    var ts_start: timespec = undefined;
    _ = clock_gettime(CLOCK_MONOTONIC, &ts_start);

    var i: u32 = 0;
    while (i < pings) : (i += 1) {
        const snt = write(fd, "x", 1);
        if (snt != 1) {
            print_err("write", @intCast(snt));
            return 0;
        }
        var buf: [1]u8 = undefined;
        const rcvd = read(fd, &buf, 1);
        if (rcvd <= 0) {
            std.debug.print("net-bench: error=eof_at_iter={d} rc={d}\n", .{ i, rcvd });
            return 0;
        }
    }

    var ts_end: timespec = undefined;
    _ = clock_gettime(CLOCK_MONOTONIC, &ts_end);

    const sec_ns: i64 = (ts_end.tv_sec - ts_start.tv_sec) * std.time.ns_per_s;
    const nsec_delta: i64 = ts_end.tv_nsec - ts_start.tv_nsec;
    const elapsed_ns: u64 = @intCast(sec_ns + nsec_delta);
    const total_ms = @divFloor(elapsed_ns, std.time.ns_per_ms);
    const us_per_ping = @divFloor(@divFloor(elapsed_ns, std.time.ns_per_us), pings);

    std.debug.print(
        "net-bench: pings={d} total_ms={d} us_per_ping={d}\n",
        .{ pings, total_ms, us_per_ping },
    );
    return 0;
}
