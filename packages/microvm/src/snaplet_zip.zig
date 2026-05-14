//! gzip transport wrapping for .snaplet files.
//!
//! The snapshot codec (snapshot.zig) stays oblivious to compression —
//! this module just shrinks the bytes on the way to disk and restores
//! them on the way back. A guest's RAM section is mostly zero pages,
//! so gzip routinely takes a ~540 MiB .snaplet down by an order of
//! magnitude.
//!
//! Backward compatible: `decompress` sniffs the gzip magic and passes
//! a plain (already-uncompressed) .snaplet straight through, so files
//! written before compression landed still load.

const std = @import("std");
const flate = std.compress.flate;

const assert = std.debug.assert;

/// gzip magic — the first two bytes of every gzip member.
pub const gzip_magic = [2]u8{ 0x1f, 0x8b };

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
    // .snaplet nearly as small while cutting the pause dramatically.
    var comp = try flate.Compress.init(&aw.writer, window, .gzip, .level_1);
    try comp.writer.writeAll(input);
    try comp.finish();

    const out = try aw.toOwnedSlice();
    // gzip always emits at least a 10-byte header + 8-byte footer.
    assert(out.len >= 18);
    assert(out[0] == gzip_magic[0] and out[1] == gzip_magic[1]);
    return out;
}

/// Inverse of `compress`. A buffer that doesn't start with the gzip
/// magic is assumed to be a plain .snaplet and returned as an owned
/// copy unchanged. Caller owns the returned bytes either way.
pub fn decompress(gpa: std.mem.Allocator, input: []const u8) ![]u8 {
    if (input.len < 2 or !std.mem.eql(u8, input[0..2], &gzip_magic)) {
        return gpa.dupe(u8, input);
    }
    var in: std.Io.Reader = .fixed(input);
    var aw: std.Io.Writer.Allocating = .init(gpa);
    errdefer aw.deinit();

    var dc: flate.Decompress = .init(&in, .gzip, &.{});
    _ = try dc.reader.streamRemaining(&aw.writer);
    return aw.toOwnedSlice();
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
    const plain = "SNAPLET\x00 not actually compressed";
    const back = try decompress(a, plain);
    defer a.free(back);
    try std.testing.expectEqualSlices(u8, plain, back);
}

test "decompress handles an empty/short buffer as plain" {
    const a = std.testing.allocator;
    const back = try decompress(a, "");
    defer a.free(back);
    try std.testing.expectEqual(@as(usize, 0), back.len);
}
