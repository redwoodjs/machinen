//! virtio-blk backend — exposes a host file as a block device to the
//! guest, so the guest can mount it as `/dev/vda` and treat it as a
//! normal disk. For #47 M1.
//!
//! Shape:
//!   * `Backend.init(path)` opens the host file read-write and holds
//!     onto the fd for the VM's lifetime.
//!   * `Backend.handleRequest(dev, q_idx, head)` is the callback you
//!     plug into `virtio.Device.request_handler`. It walks the
//!     descriptor chain, reads the virtio-blk outhdr, and either
//!     reads from or writes to the host file.
//!
//! The virtio-blk protocol is small: every request is a descriptor
//! chain of three parts:
//!
//!   1. a 16-byte `virtio_blk_outhdr` {type, reserved, sector} (RO)
//!   2. one or more data descriptors (RW depending on request type)
//!   3. a 1-byte status (WO, device writes 0/1/2 here)

const std = @import("std");
const virtio = @import("virtio.zig");

pub const BlkType = enum(u32) {
    in = 0, // read sectors into guest memory
    out = 1, // write guest memory into sectors
    flush = 4,
    get_id = 8,
    _,
};

pub const BlkOutHdr = extern struct {
    type: u32,
    reserved: u32,
    sector: u64,
};

pub const VIRTIO_BLK_S_OK: u8 = 0;
pub const VIRTIO_BLK_S_IOERR: u8 = 1;
pub const VIRTIO_BLK_S_UNSUPP: u8 = 2;

// virtio-blk-specific feature bits worth knowing.
pub const VIRTIO_BLK_F_SIZE_MAX: u6 = 1;
pub const VIRTIO_BLK_F_SEG_MAX: u6 = 2;
pub const VIRTIO_BLK_F_BLK_SIZE: u6 = 6;

/// Config space at virtio MMIO offset 0x100. The `capacity` field is
/// the one virtio-blk drivers always check; it's in 512-byte sectors.
pub const BlkConfig = extern struct {
    capacity: u64, // in 512-byte sectors
    size_max: u32 = 0,
    seg_max: u32 = 0,
    geometry: extern struct { cylinders: u16, heads: u8, sectors: u8 } = .{ .cylinders = 0, .heads = 0, .sectors = 0 },
    blk_size: u32 = 512,
    _rest: [64]u8 = @splat(0), // headroom for topology / writeback / etc.
};

pub const Backend = struct {
    fd: c_int,
    capacity_sectors: u64,
    /// The backing config space. Keep it here so the virtio.Device
    /// can hand out a stable slice reference.
    config: BlkConfig,

    pub fn initFromFd(fd: c_int, size_bytes: u64) Backend {
        const sectors = size_bytes / 512;
        return .{
            .fd = fd,
            .capacity_sectors = sectors,
            .config = .{ .capacity = sectors },
        };
    }

    pub fn deinit(self: *Backend) void {
        _ = close(self.fd);
    }

    /// The request-handler callback to feed `virtio.Device.request_handler`.
    pub fn handleRequest(ctx: ?*anyopaque, dev: *virtio.Device, q_idx: u32, head: u16) void {
        _ = q_idx; // virtio-blk has just one queue (0)
        const self: *Backend = @ptrCast(@alignCast(ctx.?));

        // Walk the chain, categorise each descriptor into (hdr, data, status).
        var hdr: ?virtio.VringDesc = null;
        var data: [8]virtio.VringDesc = undefined;
        var data_count: usize = 0;
        var status_desc: ?virtio.VringDesc = null;

        var idx: u16 = head;
        var steps: u32 = 0;
        while (steps < 32) : (steps += 1) {
            const d = dev.queueDescriptor(0, idx) orelse break;
            if (hdr == null) {
                hdr = d;
            } else if ((d.flags & virtio.VringDesc.F_NEXT) == 0 and d.len == 1) {
                // A 1-byte writable tail is the status descriptor.
                status_desc = d;
            } else {
                if (data_count < data.len) {
                    data[data_count] = d;
                    data_count += 1;
                }
            }
            if ((d.flags & virtio.VringDesc.F_NEXT) == 0) break;
            idx = d.next;
        }

        // Parse outhdr.
        var status: u8 = VIRTIO_BLK_S_OK;
        var written: u32 = 0;

        if (hdr == null or status_desc == null) {
            // Malformed; nothing to write back. Still ack the chain.
            dev.queuePushUsed(0, head, 0);
            return;
        }
        const hdr_bytes = dev.guestBytes(hdr.?.addr, @sizeOf(BlkOutHdr)) orelse {
            dev.queuePushUsed(0, head, 0);
            return;
        };
        var out_hdr: BlkOutHdr = undefined;
        @memcpy(std.mem.asBytes(&out_hdr), hdr_bytes);

        switch (@as(BlkType, @enumFromInt(out_hdr.type))) {
            .in => {
                var sector = out_hdr.sector;
                for (data[0..data_count]) |d| {
                    const dst = dev.guestBytes(d.addr, d.len) orelse {
                        status = VIRTIO_BLK_S_IOERR;
                        break;
                    };
                    const n = pread(self.fd, dst.ptr, dst.len, @as(i64, @intCast(sector)) * 512);
                    if (n < 0) {
                        status = VIRTIO_BLK_S_IOERR;
                        break;
                    }
                    written += @intCast(n);
                    sector += dst.len / 512;
                }
                traceBlk("read", out_hdr.sector, data_count, written);
            },
            .out => {
                var total: u32 = 0;
                var sector = out_hdr.sector;
                for (data[0..data_count]) |d| {
                    const src = dev.guestBytes(d.addr, d.len) orelse {
                        status = VIRTIO_BLK_S_IOERR;
                        break;
                    };
                    const n = pwrite(self.fd, src.ptr, src.len, @as(i64, @intCast(sector)) * 512);
                    if (n < 0) {
                        status = VIRTIO_BLK_S_IOERR;
                        break;
                    }
                    total += @intCast(n);
                    sector += src.len / 512;
                }
                traceBlk("write", out_hdr.sector, data_count, total);
            },
            .flush => {
                _ = fsync(self.fd);
            },
            .get_id => {
                // Fill the first data descriptor with a 20-byte device id.
                if (data_count >= 1) {
                    const id_str: []const u8 = "machinen-vda" ++ ("\x00" ** 8);
                    const dst = dev.guestBytes(data[0].addr, @min(data[0].len, 20)) orelse {
                        status = VIRTIO_BLK_S_IOERR;
                        return;
                    };
                    @memset(dst, 0);
                    @memcpy(dst[0..@min(dst.len, id_str.len)], id_str[0..@min(dst.len, id_str.len)]);
                    written = @intCast(dst.len);
                }
            },
            else => status = VIRTIO_BLK_S_UNSUPP,
        }

        // Write the status byte the device owes the guest.
        if (dev.guestBytes(status_desc.?.addr, 1)) |st| {
            st[0] = status;
        }

        // virtio-blk reports used `len` as the number of bytes the
        // DEVICE wrote into the chain (read data + the status byte).
        dev.queuePushUsed(0, head, written + 1);
    }
};

fn traceBlk(kind: []const u8, sector: u64, segs: usize, bytes: u32) void {
    // Per-request tracing is great for bring-up but useless at volume
    // (mkfs.ext4 alone is thousands of requests). Disabled by default;
    // flip to `true` when debugging a specific virtio-blk issue.
    const enabled = false;
    if (!enabled) return;
    var buf: [96]u8 = undefined;
    const msg = std.fmt.bufPrint(
        &buf,
        "[blk] {s} sector={d} segs={d} bytes={d}\n",
        .{ kind, sector, segs, bytes },
    ) catch return;
    _ = write(2, msg.ptr, msg.len);
}

// libc bindings: direct syscalls so this file doesn't depend on
// std.posix / std.Io, both of which are in flux in Zig 0.16.
extern "c" fn pread(fd: c_int, buf: [*]u8, count: usize, offset: i64) isize;
extern "c" fn pwrite(fd: c_int, buf: [*]const u8, count: usize, offset: i64) isize;
extern "c" fn fsync(fd: c_int) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
extern "c" fn lseek(fd: c_int, offset: i64, whence: c_int) i64;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;

pub const O_RDWR: c_int = 2;
pub const SEEK_END: c_int = 2;

/// Convenience: open a host file read-write and wrap it as a Backend.
/// Returns `FileNotFound` / `IoError` on obvious failures.
pub fn openFile(path: []const u8) !Backend {
    var buf: [4096]u8 = undefined;
    if (path.len >= buf.len) return error.NameTooLong;
    @memcpy(buf[0..path.len], path);
    buf[path.len] = 0;
    const fd = open(@ptrCast(&buf), O_RDWR);
    if (fd < 0) return error.FileNotFound;
    const size = lseek(fd, 0, SEEK_END);
    if (size < 0) {
        _ = close(fd);
        return error.IoError;
    }
    return Backend.initFromFd(fd, @intCast(size));
}
