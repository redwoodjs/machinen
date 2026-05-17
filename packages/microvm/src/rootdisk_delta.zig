//! Rootdisk delta payload for incremental vmstate checkpoints.
//!
//! The live virtio-blk backend tracks 4 KiB blocks written since the
//! previous checkpoint. While the vCPU is stopped for a vmstate capture
//! we copy those dirty blocks into this payload, then clear the dirty
//! map before the guest resumes. Restore starts from the nearest parent
//! checkpoint that carries a full `rootdisk.img` and overlays these
//! extents in chain order to materialize a normal raw rootdisk image.

const std = @import("std");

pub const BLOCK: usize = 4096;
pub const HEADER_SIZE: usize = 56;
const EXTENT_HEADER_SIZE: usize = 16;

pub const Header = extern struct {
    disk_size: u64,
    block_size: u32,
    reserved: u32 = 0,
    sha256: [32]u8,
    reserved2: [8]u8 = @splat(0),

    comptime {
        if (@sizeOf(Header) != HEADER_SIZE) {
            @compileError("rootdisk_delta.Header must be exactly 56 bytes");
        }
    }
};

fn bit_set(bits: []const u64, block_idx: usize) bool {
    const word = block_idx / 64;
    if (word >= bits.len) return false;
    const bit: u6 = @intCast(block_idx % 64);
    return (bits[word] & (@as(u64, 1) << bit)) != 0;
}

fn next_dirty_extent(disk_size: u64, bits: []const u64, from: u64) ?struct { start: u64, end: u64 } {
    std.debug.assert(from <= disk_size);
    const block_count = if (disk_size == 0) 0 else 1 + ((disk_size - 1) / BLOCK);
    var block = from / BLOCK;
    while (block < block_count and !bit_set(bits, @intCast(block))) : (block += 1) {}
    if (block >= block_count) return null;
    const start_block = block;
    while (block < block_count and bit_set(bits, @intCast(block))) : (block += 1) {}
    const start = start_block * BLOCK;
    const end = @min(block * BLOCK, disk_size);
    std.debug.assert(start < end and end <= disk_size);
    return .{ .start = start, .end = end };
}

pub fn encode_from_fd(
    allocator: std.mem.Allocator,
    fd: c_int,
    disk_size: u64,
    dirty_bits: []const u64,
) ![]u8 {
    std.debug.assert(fd >= 0);
    std.debug.assert(disk_size > 0);

    var body_len: usize = 0;
    {
        var cursor: u64 = 0;
        while (next_dirty_extent(disk_size, dirty_bits, cursor)) |e| {
            body_len += EXTENT_HEADER_SIZE + @as(usize, @intCast(e.end - e.start));
            cursor = e.end;
        }
    }

    const out = try allocator.alloc(u8, HEADER_SIZE + body_len);
    errdefer allocator.free(out);

    var w: usize = HEADER_SIZE;
    {
        var cursor: u64 = 0;
        while (next_dirty_extent(disk_size, dirty_bits, cursor)) |e| {
            const len: usize = @intCast(e.end - e.start);
            std.mem.writeInt(u64, out[w..][0..8], e.start, .little);
            w += 8;
            std.mem.writeInt(u64, out[w..][0..8], len, .little);
            w += 8;
            try pread_all(fd, out[w..][0..len], e.start);
            w += len;
            cursor = e.end;
        }
    }
    std.debug.assert(w == out.len);

    var sha = std.crypto.hash.sha2.Sha256.init(.{});
    sha.update(out[HEADER_SIZE..]);
    var digest: [32]u8 = undefined;
    sha.final(&digest);

    const hdr: Header = .{ .disk_size = disk_size, .block_size = BLOCK, .sha256 = digest };
    @memcpy(out[0..HEADER_SIZE], std.mem.asBytes(&hdr));
    return out;
}

fn pread_all(fd: c_int, dst: []u8, offset: u64) !void {
    var done: usize = 0;
    while (done < dst.len) {
        const rc = pread(fd, dst[done..].ptr, dst.len - done, @as(i64, @intCast(offset + done)));
        if (rc <= 0) return error.ReadFailed;
        done += @intCast(rc);
    }
}

extern "c" fn pread(fd: c_int, buf: [*]u8, count: usize, offset: i64) isize;

test "encodeFromFd stores contiguous dirty block extents" {
    const a = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const file = try tmp.dir.createFile(std.testing.io, "disk.img", .{ .read = true });
    defer file.close(std.testing.io);
    var block: [BLOCK]u8 = undefined;
    for (0..4) |i| {
        @memset(&block, @intCast(0x10 + i));
        try file.writeStreamingAll(std.testing.io, &block);
    }

    var bits = [_]u64{0};
    bits[0] |= (@as(u64, 1) << 1) | (@as(u64, 1) << 2);
    const payload = try encode_from_fd(a, file.handle, 4 * BLOCK, &bits);
    defer a.free(payload);

    try std.testing.expectEqual(HEADER_SIZE + EXTENT_HEADER_SIZE + 2 * BLOCK, payload.len);
    try std.testing.expectEqual(@as(u64, BLOCK), std.mem.readInt(u64, payload[HEADER_SIZE..][0..8], .little));
    try std.testing.expectEqual(@as(u64, 2 * BLOCK), std.mem.readInt(u64, payload[HEADER_SIZE + 8 ..][0..8], .little));
    try std.testing.expectEqual(@as(u8, 0x11), payload[HEADER_SIZE + EXTENT_HEADER_SIZE]);
    try std.testing.expectEqual(@as(u8, 0x12), payload[HEADER_SIZE + EXTENT_HEADER_SIZE + BLOCK]);
}
