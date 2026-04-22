//! Brings up the loopback interface.
//!
//! CRIU's kerndat_tcp_repair probe creates a TCP socket and calls
//! connect(), which fails with ENETUNREACH when `lo` is still DOWN —
//! and CRIU treats that as a fatal init error. Any snapshot/restore
//! flow needs loopback up first; this is the minimum ioctl that
//! accomplishes it, without dragging iproute2 into the base rootfs.
//!
//! Build (from packages/microvm):
//!   zig build-exe assets/lo-up.zig \
//!     -target aarch64-linux-musl -static -O ReleaseSmall \
//!     -lc -femit-bin=<out>/machinen-lo-up

const std = @import("std");

const AF_INET: c_int = 2;
const SOCK_DGRAM: c_int = 2;
const IFNAMSIZ: usize = 16;
const SIOCGIFFLAGS: c_ulong = 0x8913;
const SIOCSIFFLAGS: c_ulong = 0x8914;
const IFF_UP: c_short = 0x1;
const IFF_RUNNING: c_short = 0x40;

const ifmap = extern struct {
    mem_start: c_ulong,
    mem_end: c_ulong,
    base_addr: c_ushort,
    irq: u8,
    dma: u8,
    port: u8,
};

const ifreq = extern struct {
    ifr_name: [IFNAMSIZ]u8,
    ifru: extern union {
        flags: c_short,
        ivalue: c_int,
        mtu: c_int,
        map: ifmap,
        slave: [IFNAMSIZ]u8,
        newname: [IFNAMSIZ]u8,
        data: ?*anyopaque,
        // pad to the largest union member on any reasonable libc; we
        // only touch flags, but the kernel copies the full struct.
        _pad: [24]u8,
    },
};

extern "c" fn socket(domain: c_int, socktype: c_int, protocol: c_int) c_int;
extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
extern "c" fn close(fd: c_int) c_int;

pub fn main() u8 {
    const fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) return 1;
    defer _ = close(fd);

    var req: ifreq = std.mem.zeroes(ifreq);
    req.ifr_name[0] = 'l';
    req.ifr_name[1] = 'o';
    req.ifr_name[2] = 0;

    if (ioctl(fd, SIOCGIFFLAGS, &req) < 0) return 2;
    req.ifru.flags |= IFF_UP | IFF_RUNNING;
    if (ioctl(fd, SIOCSIFFLAGS, &req) < 0) return 3;
    return 0;
}
