//! Transport wrapping for .vmstate files.
//!
//! The snapshot codec (snapshot.zig) stays oblivious to compression.
//! This module can gzip bytes for storage, and it can read both gzip
//! and plain .vmstate files. New snapshots default to plain bytes so
//! restore doesn't spend hundreds of milliseconds inflating the whole
//! container before the first vCPU run; set
//! `MACHINEN_VMSTATE_COMPRESSION=gzip` to opt back into the smaller
//! historical transport.
//!
//! Backward compatible: readers sniff the gzip magic and pass a plain
//! (already-uncompressed) .vmstate straight through, so old and new
//! files both load.

const std = @import("std");
const flate = std.compress.flate;

const assert = std.debug.assert;

const libc = struct {
    extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;
};

/// gzip magic — the first two bytes of every gzip member.
pub const gzip_magic = [2]u8{ 0x1f, 0x8b };

/// On-disk transport used for newly-written snapshots.
pub const Compression = enum { none, gzip };

pub fn write_compression() Compression {
    const raw = libc.getenv("MACHINEN_VMSTATE_COMPRESSION") orelse return .none;
    return parse_compression(std.mem.span(raw)) orelse .none;
}

pub fn parse_compression(raw: []const u8) ?Compression {
    const v = std.mem.trim(u8, raw, " \t\r\n");
    if (std.ascii.eqlIgnoreCase(v, "gzip") or
        std.ascii.eqlIgnoreCase(v, "gz") or
        std.ascii.eqlIgnoreCase(v, "true") or
        std.mem.eql(u8, v, "1")) return .gzip;
    if (std.ascii.eqlIgnoreCase(v, "none") or
        std.ascii.eqlIgnoreCase(v, "plain") or
        std.ascii.eqlIgnoreCase(v, "false") or
        std.mem.eql(u8, v, "0")) return .none;
    return null;
}

/// gzip-compress `input`. Caller owns the returned bytes.
pub fn compress(gpa: std.mem.Allocator, input: []const u8) ![]u8 {
    // The Allocating writer must start with a non-empty buffer —
    // Compress.init asserts `output.buffer.len > 8`.
    var aw: std.Io.Writer.Allocating = try .initCapacity(gpa, 64 * 1024);
    errdefer aw.deinit();

    // Deflate's sliding-window scratch; must be >= flate.max_window_len.
    const window = try gpa.alloc(u8, flate.max_window_len);
    defer gpa.free(window);

    // Level 1 (fastest), not the default level 6. The snapshot is
    // taken with the guest's vCPU paused, so compression time is dead
    // time the guest sees as a clock gap — at level 6, gzipping a
    // 512 MiB container ran tens of seconds and tripped RCU stalls in
    // the resumed guest. Guest RAM is mostly zero pages, which LZ77
    // collapses to almost nothing at any level, so level 1 keeps the
    // .vmstate nearly as small while cutting the pause dramatically.
    var comp = try flate.Compress.init(&aw.writer, window, .gzip, .level_1);
    try comp.writer.writeAll(input);
    try comp.finish();

    const out = try aw.toOwnedSlice();
    // gzip always emits at least a 10-byte header + 8-byte footer.
    assert(out.len >= 18);
    assert(out[0] == gzip_magic[0] and out[1] == gzip_magic[1]);
    return out;
}

/// Decompression result that may borrow the caller's input when the
/// file is already plain. Call `deinit` once done.
pub const Decompressed = struct {
    bytes: []const u8,
    owned: bool,

    pub fn deinit(self: Decompressed, gpa: std.mem.Allocator) void {
        if (self.owned) gpa.free(@constCast(self.bytes));
    }
};

/// Inverse of `compress`, optimized for restore: gzip input is inflated
/// into an owned buffer; plain input is returned as a borrowed slice so
/// restore avoids an extra full-container copy.
pub fn decompress_maybe_owned(gpa: std.mem.Allocator, input: []const u8) !Decompressed {
    if (input.len < 2 or !std.mem.eql(u8, input[0..2], &gzip_magic)) {
        return .{ .bytes = input, .owned = false };
    }
    var in: std.Io.Reader = .fixed(input);
    var aw: std.Io.Writer.Allocating = .init(gpa);
    errdefer aw.deinit();

    var dc: flate.Decompress = .init(&in, .gzip, &.{});
    _ = try dc.reader.streamRemaining(&aw.writer);
    return .{ .bytes = try aw.toOwnedSlice(), .owned = true };
}

/// Inverse of `compress`. A buffer that doesn't start with the gzip
/// magic is assumed to be a plain .vmstate and returned as an owned
/// copy unchanged. Caller owns the returned bytes either way.
pub fn decompress(gpa: std.mem.Allocator, input: []const u8) ![]u8 {
    const decoded = try decompress_maybe_owned(gpa, input);
    if (decoded.owned) return @constCast(decoded.bytes);
    return gpa.dupe(u8, decoded.bytes);
}

// -- tests --------------------------------------------------------

test "compress/decompress round-trips arbitrary bytes" {
    const a = std.testing.allocator;
    var payload: [50_000]u8 = undefined;
    var prng = std.Random.DefaultPrng.init(0x5eed);
    prng.random().bytes(&payload);

    const zipped = try compress(a, &payload);
    defer a.free(zipped);
    const back = try decompress(a, zipped);
    defer a.free(back);

    try std.testing.expectEqualSlices(u8, &payload, back);
}

test "compress shrinks a mostly-zero buffer hard" {
    const a = std.testing.allocator;
    // Stand-in for a guest RAM section: almost all zero pages.
    const buf = try a.alloc(u8, 4 * 1024 * 1024);
    defer a.free(buf);
    @memset(buf, 0);
    for (0..64) |i| buf[i * 65536] = @intCast(i);

    const zipped = try compress(a, buf);
    defer a.free(zipped);
    try std.testing.expect(zipped.len < buf.len / 20);

    const back = try decompress(a, zipped);
    defer a.free(back);
    try std.testing.expectEqualSlices(u8, buf, back);
}

test "decompress passes a non-gzip buffer through unchanged" {
    const a = std.testing.allocator;
    const plain = "VMSTATE\x00 not actually compressed";
    const back = try decompress(a, plain);
    defer a.free(back);
    try std.testing.expectEqualSlices(u8, plain, back);
}

test "decompressMaybeOwned borrows plain buffers and owns gzip buffers" {
    const a = std.testing.allocator;
    var plain = [_]u8{ 'V', 'M', 'S', 'T', 'A', 'T', 'E', 0 };
    const plain_back = try decompress_maybe_owned(a, &plain);
    defer plain_back.deinit(a);
    try std.testing.expect(!plain_back.owned);
    try std.testing.expectEqual(@intFromPtr(plain[0..].ptr), @intFromPtr(plain_back.bytes.ptr));

    const zipped = try compress(a, &plain);
    defer a.free(zipped);
    const zipped_back = try decompress_maybe_owned(a, zipped);
    defer zipped_back.deinit(a);
    try std.testing.expect(zipped_back.owned);
    try std.testing.expectEqualSlices(u8, &plain, zipped_back.bytes);
}

test "parseCompression accepts documented values" {
    try std.testing.expectEqual(Compression.none, parse_compression("none").?);
    try std.testing.expectEqual(Compression.none, parse_compression("plain").?);
    try std.testing.expectEqual(Compression.none, parse_compression("0").?);
    try std.testing.expectEqual(Compression.gzip, parse_compression("gzip").?);
    try std.testing.expectEqual(Compression.gzip, parse_compression("GZ").?);
    try std.testing.expectEqual(Compression.gzip, parse_compression("1").?);
    try std.testing.expect(parse_compression("surprise") == null);
}

test "decompress handles an empty/short buffer as plain" {
    const a = std.testing.allocator;
    const back = try decompress(a, "");
    defer a.free(back);
    try std.testing.expectEqual(@as(usize, 0), back.len);
}
