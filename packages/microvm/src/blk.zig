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
const builtin = @import("builtin");
const virtio = @import("virtio.zig");
const assert = std.debug.assert;

comptime {
    // virtio-blk wire format: outhdr is exactly 16 bytes (type:u32, reserved:u32, sector:u64).
    // The driver writes this layout into guest memory; mismatched size means we'd memcpy
    // garbage into out_hdr and dispatch on uninitialized bytes.
    assert(@sizeOf(BlkOutHdr) == 16);
    assert(@offsetOf(BlkOutHdr, "type") == 0);
    assert(@offsetOf(BlkOutHdr, "sector") == 8);
}

pub const BlkType = enum(u32) {
    in = 0, // read sectors into guest memory
    out = 1, // write guest memory into sectors
    flush = 4,
    get_id = 8,
    discard = 11, // VIRTIO_BLK_T_DISCARD — host fallocate(PUNCH_HOLE)
    _,
};

pub const BlkOutHdr = extern struct {
    type: u32,
    reserved: u32,
    sector: u64,
};

/// Per-segment discard descriptor sent in the data descriptor of a
/// VIRTIO_BLK_T_DISCARD request. The kernel can pack many of these
/// into one chain — we walk and `fallocate(PUNCH_HOLE)` each in order.
pub const BlkDiscardSeg = extern struct {
    sector: u64,
    num_sectors: u32,
    flags: u32, // bit 0 = unmap; we treat all discards as punch-hole anyway
};

pub const VIRTIO_BLK_S_OK: u8 = 0;
pub const VIRTIO_BLK_S_IOERR: u8 = 1;
pub const VIRTIO_BLK_S_UNSUPP: u8 = 2;

// virtio-blk-specific feature bits worth knowing.
pub const VIRTIO_BLK_F_SIZE_MAX: u6 = 1;
pub const VIRTIO_BLK_F_SEG_MAX: u6 = 2;
pub const VIRTIO_BLK_F_BLK_SIZE: u6 = 6;
// VIRTIO_BLK_F_DISCARD (#272) — when negotiated the guest kernel
// issues VIRTIO_BLK_T_DISCARD requests for ext4's `discard` mount
// option. The host translates each segment to fallocate(PUNCH_HOLE)
// so deleted bytes inside the upper image release host disk space.
pub const VIRTIO_BLK_F_DISCARD: u6 = 13;

/// Config space at virtio MMIO offset 0x100. The `capacity` field is
/// the one virtio-blk drivers always check; it's in 512-byte sectors.
///
/// `max_discard_sectors`, `max_discard_seg`, and
/// `discard_sector_alignment` follow the legacy layout when
/// VIRTIO_BLK_F_DISCARD is negotiated. We always populate them with
/// sensible defaults — guests that don't negotiate the feature bit
/// simply ignore those bytes.
pub const BlkConfig = extern struct {
    capacity: u64, // in 512-byte sectors
    size_max: u32 = 0,
    seg_max: u32 = 0,
    geometry: extern struct { cylinders: u16, heads: u8, sectors: u8 } = .{ .cylinders = 0, .heads = 0, .sectors = 0 },
    blk_size: u32 = 512,
    // Legacy topology block (8 bytes) — physical_block_exp, alignment_offset,
    // min_io_size, opt_io_size — left zero. The kernel tolerates zeros here.
    _topology: [8]u8 = @splat(0),
    writeback: u8 = 0,
    _pad0: [3]u8 = @splat(0),
    num_queues: u16 = 1,
    _pad1: [2]u8 = @splat(0),
    // Discard / write-zeroes block. Populated for every backend; only
    // observed when the guest negotiates VIRTIO_BLK_F_DISCARD.
    max_discard_sectors: u32 = 0x1_0000, // 32 MiB max per request — generous
    max_discard_seg: u32 = 64, // up to 64 segments per chain
    discard_sector_alignment: u32 = 1, // sector-granular discard
    max_write_zeroes_sectors: u32 = 0,
    max_write_zeroes_seg: u32 = 0,
    write_zeroes_may_unmap: u8 = 0,
    _pad2: [3]u8 = @splat(0),
    // Headroom for forward-compat fields the spec may add later.
    _rest: [32]u8 = @splat(0),
};

pub const Backend = struct {
    fd: c_int,
    capacity_sectors: u64,
    /// When true, guest writes are rejected with VIRTIO_BLK_S_IOERR.
    /// Used by the squashfs lower for `--mount` (#272) so a buggy
    /// driver can't corrupt the content-addressed cache file the
    /// runtime hands us read-only.
    read_only: bool = false,
    /// The backing config space. Keep it here so the virtio.Device
    /// can hand out a stable slice reference.
    config: BlkConfig,

    pub fn initFromFd(fd: c_int, size_bytes: u64) Backend {
        return initFromFdWithMode(fd, size_bytes, false);
    }

    /// Same as `initFromFd` but lets callers pin the backend as
    /// read-only — used for the squashfs lower in #272 where the
    /// host opens the cache file `O_RDONLY` and must reject any
    /// guest write rather than letting `pwrite` ENOSPC the host.
    pub fn initFromFdWithMode(fd: c_int, size_bytes: u64, read_only: bool) Backend {
        assert(fd >= 0);
        assert(size_bytes > 0);
        // virtio-blk capacity is in 512-byte sectors; a non-multiple
        // would silently truncate. squashfs is built in 4 KiB blocks
        // (mksquashfs default block size is 128 KiB but the file
        // length is rounded to 4 KiB) and ext4 images use a 4 KiB
        // block size — both cleanly divisible by 512.
        assert(size_bytes % 512 == 0);
        const sectors = size_bytes / 512;
        assert(sectors * 512 == size_bytes);
        assert(sectors > 0);
        return .{
            .fd = fd,
            .capacity_sectors = sectors,
            .read_only = read_only,
            .config = .{ .capacity = sectors },
        };
    }

    pub fn deinit(self: *Backend) void {
        assert(self.fd >= 0);
        _ = close(self.fd);
    }

    /// The request-handler callback to feed `virtio.Device.request_handler`.
    pub fn handleRequest(ctx: ?*anyopaque, dev: *virtio.Device, q_idx: u32, head: u16) void {
        assert(ctx != null);
        _ = q_idx; // virtio-blk has just one queue (0)
        const self: *Backend = @ptrCast(@alignCast(ctx.?));
        assert(self.fd >= 0);
        assert(self.capacity_sectors > 0);

        // Walk the chain, categorise each descriptor into (hdr, data, status).
        var hdr: ?virtio.VringDesc = null;
        var data: [8]virtio.VringDesc = undefined;
        var data_count: usize = 0;
        var status_desc: ?virtio.VringDesc = null;

        var idx: u16 = head;
        var steps: u32 = 0;
        // 32 is a guest-input bound, not a programmer invariant; an evil/buggy guest can ring
        // a longer chain and we silently break, which is the right policy here.
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
        assert(data_count <= data.len);
        assert(steps <= 32);
        if (status_desc) |s| assert(s.len == 1);

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
        // Pair with the comptime layout assertion: every byte we copy lines up with a field.
        assert(hdr_bytes.len == @sizeOf(BlkOutHdr));
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
                if (self.read_only) {
                    // Belt + braces: drivers shouldn't write to a
                    // device that announced no writeback queue, but
                    // a misbehaving one would silently get its bytes
                    // discarded by us — surface the error instead.
                    status = VIRTIO_BLK_S_IOERR;
                    traceBlk("write-rejected-ro", out_hdr.sector, data_count, 0);
                } else {
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
                }
            },
            .flush => {
                _ = fsync(self.fd);
            },
            .discard => {
                if (self.read_only) {
                    status = VIRTIO_BLK_S_IOERR;
                } else {
                    // Walk every segment in the data descriptor and
                    // PUNCH_HOLE each. Linux's virtio_blk_discard_or_zeroes
                    // path packs the whole list in one descriptor, so
                    // data_count is typically 1. fallocate failures are
                    // non-fatal here (older filesystems on the host may
                    // not support PUNCH_HOLE on regular files) — discard
                    // is an optimisation, not a correctness primitive.
                    for (data[0..data_count]) |d| {
                        const seg_count: usize = d.len / @sizeOf(BlkDiscardSeg);
                        if (seg_count == 0) continue;
                        const bytes = dev.guestBytes(d.addr, seg_count * @sizeOf(BlkDiscardSeg)) orelse {
                            status = VIRTIO_BLK_S_IOERR;
                            break;
                        };
                        var off: usize = 0;
                        while (off < bytes.len) : (off += @sizeOf(BlkDiscardSeg)) {
                            var seg: BlkDiscardSeg = undefined;
                            @memcpy(std.mem.asBytes(&seg), bytes[off..][0..@sizeOf(BlkDiscardSeg)]);
                            const offset_bytes: i64 = @as(i64, @intCast(seg.sector)) * 512;
                            const len_bytes: i64 = @as(i64, @intCast(seg.num_sectors)) * 512;
                            if (len_bytes <= 0) continue;
                            const rc = punchHole(self.fd, offset_bytes, len_bytes);
                            if (rc != 0) {
                                // EOPNOTSUPP / EINVAL on hosts that
                                // don't support hole-punching — log
                                // once at debug level so it's diagnosable.
                                traceBlk("discard-fallback", seg.sector, seg.num_sectors, 0);
                            }
                        }
                    }
                    traceBlk("discard", out_hdr.sector, data_count, 0);
                }
            },
            .get_id => {
                // Fill the first data descriptor with a 20-byte device id.
                if (data_count >= 1) {
                    const id_str: []const u8 = "machinen-vda" ++ ("\x00" ** 8);
                    assert(id_str.len == 20);
                    const dst = dev.guestBytes(data[0].addr, @min(data[0].len, 20)) orelse {
                        status = VIRTIO_BLK_S_IOERR;
                        return;
                    };
                    assert(dst.len <= 20);
                    @memset(dst, 0);
                    @memcpy(dst[0..@min(dst.len, id_str.len)], id_str[0..@min(dst.len, id_str.len)]);
                    written = @intCast(dst.len);
                }
            },
            else => status = VIRTIO_BLK_S_UNSUPP,
        }

        assert(status == VIRTIO_BLK_S_OK or
            status == VIRTIO_BLK_S_IOERR or
            status == VIRTIO_BLK_S_UNSUPP);

        // Write the status byte the device owes the guest.
        if (dev.guestBytes(status_desc.?.addr, 1)) |st| {
            assert(st.len == 1);
            st[0] = status;
        }

        // virtio-blk reports used `len` as the number of bytes the
        // DEVICE wrote into the chain (read data + the status byte).
        dev.queuePushUsed(0, head, written + 1);
    }
};

fn traceBlk(kind: []const u8, sector: u64, segs: usize, bytes: u32) void {
    assert(kind.len > 0);
    assert(kind.len < 16);
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
// fallocate(2) — used by the .discard path to release host disk
// space when the guest issues VIRTIO_BLK_T_DISCARD. Linux-only;
// darwin has no equivalent (F_PUNCHHOLE is restricted to a few fs
// types and not exposed via libc), so the discard handler on darwin
// silently does nothing — discard is a perf optimisation, not
// correctness, and HVF is dev-only anyway.
const has_fallocate = builtin.os.tag == .linux;
extern "c" fn fallocate(fd: c_int, mode: c_int, offset: i64, len: i64) c_int;
fn punchHole(fd: c_int, offset: i64, len: i64) c_int {
    if (!has_fallocate) return -1;
    return fallocate(fd, FALLOC_FL_PUNCH_HOLE | FALLOC_FL_KEEP_SIZE, offset, len);
}

pub const O_RDWR: c_int = 2;
pub const O_RDONLY: c_int = 0;
pub const SEEK_END: c_int = 2;
// fallocate(2) flags — `man 2 fallocate`. PUNCH_HOLE deallocates the
// byte range; KEEP_SIZE keeps the file's i_size unchanged, which is
// what we want for a sparse virtio-blk backing image (the guest's
// view of capacity stays the same).
pub const FALLOC_FL_KEEP_SIZE: c_int = 0x01;
pub const FALLOC_FL_PUNCH_HOLE: c_int = 0x02;

/// Convenience: open a host file read-write and wrap it as a Backend.
/// Returns `FileNotFound` / `IoError` on obvious failures.
pub fn openFile(path: []const u8) !Backend {
    return openFileWithMode(path, false);
}

/// Same as `openFile` but lets callers pin the host fd (and the
/// resulting Backend) to read-only — used for paths backing the
/// squashfs lower in #272 where guest writes would corrupt the
/// content-addressed cache file.
pub fn openFileWithMode(path: []const u8, read_only: bool) !Backend {
    assert(path.len > 0);
    var buf: [4096]u8 = undefined;
    if (path.len >= buf.len) return error.NameTooLong;
    assert(path.len < buf.len);
    @memcpy(buf[0..path.len], path);
    buf[path.len] = 0;
    const flags: c_int = if (read_only) O_RDONLY else O_RDWR;
    const fd = open(@ptrCast(&buf), flags);
    if (fd < 0) return error.FileNotFound;
    assert(fd >= 0);
    const size = lseek(fd, 0, SEEK_END);
    if (size < 0) {
        _ = close(fd);
        return error.IoError;
    }
    assert(size > 0);
    return Backend.initFromFdWithMode(fd, @intCast(size), read_only);
}
