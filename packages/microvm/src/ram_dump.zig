//! RAM section codec for .vmstate (task #26).
//!
//! Guest RAM is sized at host/2 (autoSizeMemoryMib) — routinely 8–16
//! GiB — but an idle guest has only a few hundred MiB of non-zero
//! pages. The v1 codec stored RAM raw: it SHA256'd, memcpy'd, and
//! (via vmstate_zip) gzipped the *entire* multi-GiB image, zero pages
//! included. That ran ~70 s with the vCPU paused, long enough to trip
//! RCU stalls in the resumed guest.
//!
//! This codec is sparse: it scans RAM in 4 KiB pages and stores only
//! the non-zero ones, as a list of contiguous extents. Zero pages are
//! implicit — the loader zero-fills the destination first. A typical
//! snapshot shrinks from "all of RAM" to a few hundred MiB, which
//! cuts the paused-vCPU window by more than an order of magnitude.
//!
//! Payload layout (little-endian):
//!
//!   header (48 bytes, fixed)
//!     ram_base u64        — guest IPA of the first byte
//!     ram_size u64        — total guest RAM size in bytes
//!     sha256[32]          — SHA256 of the extent stream below
//!   extent stream (repeats to end of payload)
//!     offset u64          — byte offset into guest RAM
//!     length u64          — extent byte length
//!     bytes[length]       — the non-zero bytes at that offset
//!
//! The SHA256 covers the extent stream, not the reconstructed RAM:
//! zero pages carry no bytes worth integrity-checking, and hashing
//! only what we store keeps encode cost proportional to the snapshot,
//! not to the (mostly empty) address space.

const std = @import("std");

pub const HEADER_SIZE: usize = 48;

/// Zero-page scan granularity. 4 KiB is the finest guest page size on
/// arm64, so a guest free page is always caught regardless of whether
/// the guest kernel runs a 4 KiB or 16 KiB granule.
pub const PAGE: usize = 4096;

/// Per-extent prefix: offset u64 + length u64.
const EXTENT_HEADER_SIZE: usize = 16;

pub const RamHeader = extern struct {
    ram_base: u64,
    ram_size: u64,
    sha256: [32]u8,

    comptime {
        if (@sizeOf(RamHeader) != HEADER_SIZE) {
            @compileError("RamHeader must be exactly 48 bytes");
        }
    }
};

pub const DecodeError = error{
    Truncated,
    SizeMismatch,
    HashMismatch,
};

/// Delta RAM payload header. Same extent stream shape as the full
/// sparse codec, but the extent bytes are overlaid onto an existing
/// destination instead of zero-filling first. Dirty zero pages are
/// therefore stored explicitly as zero bytes so a child checkpoint can
/// clear data inherited from its parent.
pub const DELTA_HEADER_SIZE: usize = 64;

pub const RamDeltaHeader = extern struct {
    ram_base: u64,
    ram_size: u64,
    page_size: u32,
    reserved: u32 = 0,
    sha256: [32]u8,
    reserved2: [8]u8 = @splat(0),

    comptime {
        if (@sizeOf(RamDeltaHeader) != DELTA_HEADER_SIZE) {
            @compileError("RamDeltaHeader must be exactly 64 bytes");
        }
    }
};

/// True if every byte of `buf` is zero. Word-wise so the multi-GiB
/// scan stays a fraction of a second instead of a per-byte crawl.
fn isZero(buf: []const u8) bool {
    var i: usize = 0;
    while (i + 8 <= buf.len) : (i += 8) {
        if (std.mem.readInt(u64, buf[i..][0..8], .little) != 0) return false;
    }
    while (i < buf.len) : (i += 1) {
        if (buf[i] != 0) return false;
    }
    return true;
}

/// The next run of non-zero 4 KiB pages at or after `from`, or null
/// when the rest of `ram` is all zero. `end` is clamped to `ram.len`
/// so a non-page-aligned tail still encodes.
fn nextExtent(ram: []const u8, from: usize) ?struct { start: usize, end: usize } {
    std.debug.assert(from <= ram.len);
    var i = from;
    while (i < ram.len) {
        const pe = @min(i + PAGE, ram.len);
        if (!isZero(ram[i..pe])) break;
        i = pe;
    }
    if (i >= ram.len) return null;
    const start = i;
    while (i < ram.len) {
        const pe = @min(i + PAGE, ram.len);
        if (isZero(ram[i..pe])) break;
        i = pe;
    }
    // A returned extent is non-empty, stays within bounds, and never
    // starts behind the caller's cursor.
    std.debug.assert(start >= from and start < i and i <= ram.len);
    return .{ .start = start, .end = i };
}

/// Build a sparse RAM section payload from a host-side buffer. Caller
/// owns the returned bytes.
pub fn encode(allocator: std.mem.Allocator, ram_base: u64, ram: []const u8) ![]u8 {
    // Tiger-style preconditions: RAM is non-empty and base is page
    // aligned. Empty RAM dumps are a likely sign of caller error.
    std.debug.assert(ram.len > 0);
    std.debug.assert(ram_base % PAGE == 0);

    // Pass 1: measure the extent stream so we can allocate once.
    var body_len: usize = 0;
    {
        var cursor: usize = 0;
        while (nextExtent(ram, cursor)) |e| {
            body_len += EXTENT_HEADER_SIZE + (e.end - e.start);
            cursor = e.end;
        }
    }

    const out = try allocator.alloc(u8, HEADER_SIZE + body_len);
    errdefer allocator.free(out);

    // Pass 2: write each extent into the body.
    var w: usize = HEADER_SIZE;
    {
        var cursor: usize = 0;
        while (nextExtent(ram, cursor)) |e| {
            const ext_len = e.end - e.start;
            std.mem.writeInt(u64, out[w..][0..8], e.start, .little);
            w += 8;
            std.mem.writeInt(u64, out[w..][0..8], ext_len, .little);
            w += 8;
            @memcpy(out[w..][0..ext_len], ram[e.start..e.end]);
            w += ext_len;
            cursor = e.end;
        }
    }
    std.debug.assert(w == out.len);

    var sha = std.crypto.hash.sha2.Sha256.init(.{});
    sha.update(out[HEADER_SIZE..]);
    var digest: [32]u8 = undefined;
    sha.final(&digest);

    const hdr: RamHeader = .{
        .ram_base = ram_base,
        .ram_size = ram.len,
        .sha256 = digest,
    };
    @memcpy(out[0..HEADER_SIZE], std.mem.asBytes(&hdr));
    return out;
}

fn dirtyBitSet(bits: []const u64, page_idx: usize) bool {
    const word = page_idx / 64;
    if (word >= bits.len) return false;
    const bit: u6 = @intCast(page_idx % 64);
    return (bits[word] & (@as(u64, 1) << bit)) != 0;
}

fn nextDirtyExtent(ram_len: usize, dirty_bits: []const u64, from: usize) ?struct { start: usize, end: usize } {
    std.debug.assert(from <= ram_len);
    var page = from / PAGE;
    const page_count = if (ram_len == 0) 0 else 1 + ((ram_len - 1) / PAGE);
    while (page < page_count and !dirtyBitSet(dirty_bits, page)) : (page += 1) {}
    if (page >= page_count) return null;
    const start_page = page;
    while (page < page_count and dirtyBitSet(dirty_bits, page)) : (page += 1) {}
    const start = start_page * PAGE;
    const end = @min(page * PAGE, ram_len);
    std.debug.assert(start < end and end <= ram_len);
    return .{ .start = start, .end = end };
}

/// Build a RAM-delta payload from a bitmap of dirty 4 KiB pages. The
/// destination restore buffer is expected to already contain the
/// parent checkpoint's RAM; decodeDeltaInto overlays these extents.
/// Unlike the full sparse encoder, dirty zero pages are stored too.
pub fn encodeDelta(allocator: std.mem.Allocator, ram_base: u64, ram: []const u8, dirty_bits: []const u64) ![]u8 {
    std.debug.assert(ram.len > 0);
    std.debug.assert(ram_base % PAGE == 0);

    var body_len: usize = 0;
    {
        var cursor: usize = 0;
        while (nextDirtyExtent(ram.len, dirty_bits, cursor)) |e| {
            body_len += EXTENT_HEADER_SIZE + (e.end - e.start);
            cursor = e.end;
        }
    }

    const out = try allocator.alloc(u8, DELTA_HEADER_SIZE + body_len);
    errdefer allocator.free(out);

    var w: usize = DELTA_HEADER_SIZE;
    {
        var cursor: usize = 0;
        while (nextDirtyExtent(ram.len, dirty_bits, cursor)) |e| {
            const ext_len = e.end - e.start;
            std.mem.writeInt(u64, out[w..][0..8], e.start, .little);
            w += 8;
            std.mem.writeInt(u64, out[w..][0..8], ext_len, .little);
            w += 8;
            @memcpy(out[w..][0..ext_len], ram[e.start..e.end]);
            w += ext_len;
            cursor = e.end;
        }
    }
    std.debug.assert(w == out.len);

    var sha = std.crypto.hash.sha2.Sha256.init(.{});
    sha.update(out[DELTA_HEADER_SIZE..]);
    var digest: [32]u8 = undefined;
    sha.final(&digest);

    const hdr: RamDeltaHeader = .{
        .ram_base = ram_base,
        .ram_size = ram.len,
        .page_size = PAGE,
        .sha256 = digest,
    };
    @memcpy(out[0..DELTA_HEADER_SIZE], std.mem.asBytes(&hdr));
    return out;
}

/// Metadata recovered from a payload — the bytes themselves are
/// reconstructed straight into the caller's destination buffer.
pub const DecodedMeta = struct {
    ram_base: u64,
    ram_size: u64,
};

/// Parse + verify a sparse RAM payload and reconstruct it into `dest`.
/// `dest` must be at least `ram_size` bytes; the leading `ram_size`
/// bytes are zero-filled and then the stored extents are laid down on
/// top. The SHA256 over the extent stream is checked first — a flipped
/// bit fails loudly here instead of scrambling the restored guest.
pub fn decodeInto(payload: []const u8, dest: []u8) DecodeError!DecodedMeta {
    return decodeIntoMode(payload, dest, .zero_dest_first);
}

/// Same sparse-RAM decoder, but assumes the leading `ram_size` bytes of
/// `dest` are already zero. This is for the VMM restore path: guest RAM
/// is a fresh anonymous mmap, so the kernel provides zero pages lazily.
/// Avoiding an eager `@memset` keeps restore proportional to the saved
/// extents instead of the configured guest RAM ceiling.
pub fn decodeIntoZeroed(payload: []const u8, dest: []u8) DecodeError!DecodedMeta {
    return decodeIntoMode(payload, dest, .dest_already_zero);
}

const DecodeMode = enum { zero_dest_first, dest_already_zero };

fn decodeIntoMode(payload: []const u8, dest: []u8, mode: DecodeMode) DecodeError!DecodedMeta {
    if (payload.len < HEADER_SIZE) return error.Truncated;
    var hdr: RamHeader = undefined;
    @memcpy(std.mem.asBytes(&hdr), payload[0..HEADER_SIZE]);

    const body = payload[HEADER_SIZE..];

    var sha = std.crypto.hash.sha2.Sha256.init(.{});
    sha.update(body);
    var digest: [32]u8 = undefined;
    sha.final(&digest);
    if (!std.mem.eql(u8, &digest, &hdr.sha256)) return error.HashMismatch;

    const ram_size = std.math.cast(usize, hdr.ram_size) orelse return error.SizeMismatch;
    if (ram_size > dest.len) return error.SizeMismatch;

    if (mode == .zero_dest_first) {
        @memset(dest[0..ram_size], 0);
    }

    var c: usize = 0;
    while (c < body.len) {
        // Loop invariant: the cursor only ever advances and never
        // runs past the body it is parsing.
        std.debug.assert(c <= body.len);
        if (body.len - c < EXTENT_HEADER_SIZE) return error.Truncated;
        const off64 = std.mem.readInt(u64, body[c..][0..8], .little);
        const len64 = std.mem.readInt(u64, body[c..][8..16], .little);
        c += EXTENT_HEADER_SIZE;

        const off = std.math.cast(usize, off64) orelse return error.SizeMismatch;
        const len = std.math.cast(usize, len64) orelse return error.SizeMismatch;
        if (len > body.len - c) return error.Truncated;
        // Every extent must land inside the declared RAM size.
        if (off > ram_size or len > ram_size - off) return error.SizeMismatch;
        // The bounds checks above establish this; assert it so the
        // memcpy can never be the thing that corrupts guest RAM.
        std.debug.assert(off + len <= ram_size and ram_size <= dest.len);

        @memcpy(dest[off..][0..len], body[c..][0..len]);
        c += len;
    }
    // A well-formed payload is consumed exactly — no trailing bytes.
    std.debug.assert(c == body.len);

    return .{ .ram_base = hdr.ram_base, .ram_size = hdr.ram_size };
}

/// Apply a RAM-delta payload onto an existing destination buffer.
/// Unlike decodeInto(), this does not zero-fill first: the caller must
/// have already reconstructed the parent checkpoint's RAM.
pub fn decodeDeltaInto(payload: []const u8, dest: []u8) DecodeError!DecodedMeta {
    if (payload.len < DELTA_HEADER_SIZE) return error.Truncated;
    var hdr: RamDeltaHeader = undefined;
    @memcpy(std.mem.asBytes(&hdr), payload[0..DELTA_HEADER_SIZE]);
    if (hdr.page_size != PAGE) return error.SizeMismatch;

    const body = payload[DELTA_HEADER_SIZE..];
    var sha = std.crypto.hash.sha2.Sha256.init(.{});
    sha.update(body);
    var digest: [32]u8 = undefined;
    sha.final(&digest);
    if (!std.mem.eql(u8, &digest, &hdr.sha256)) return error.HashMismatch;

    const ram_size = std.math.cast(usize, hdr.ram_size) orelse return error.SizeMismatch;
    if (ram_size > dest.len) return error.SizeMismatch;

    var c: usize = 0;
    while (c < body.len) {
        std.debug.assert(c <= body.len);
        if (body.len - c < EXTENT_HEADER_SIZE) return error.Truncated;
        const off64 = std.mem.readInt(u64, body[c..][0..8], .little);
        const len64 = std.mem.readInt(u64, body[c..][8..16], .little);
        c += EXTENT_HEADER_SIZE;

        const off = std.math.cast(usize, off64) orelse return error.SizeMismatch;
        const len = std.math.cast(usize, len64) orelse return error.SizeMismatch;
        if (len > body.len - c) return error.Truncated;
        if (off > ram_size or len > ram_size - off) return error.SizeMismatch;
        std.debug.assert(off + len <= ram_size and ram_size <= dest.len);

        @memcpy(dest[off..][0..len], body[c..][0..len]);
        c += len;
    }
    std.debug.assert(c == body.len);
    return .{ .ram_base = hdr.ram_base, .ram_size = hdr.ram_size };
}

// --- tests ---

test "encode/decode round-trip reconstructs a sparse buffer" {
    const a = std.testing.allocator;
    const ram = try a.alloc(u8, 4 * PAGE);
    defer a.free(ram);
    @memset(ram, 0);
    // Two non-zero regions separated by a zero page.
    @memset(ram[0..PAGE], 0xAB);
    ram[PAGE * 3 + 7] = 0x42;

    const payload = try encode(a, 0x4000_0000, ram);
    defer a.free(payload);
    // Only the two non-zero pages plus their extent headers are stored.
    try std.testing.expect(payload.len < HEADER_SIZE + 3 * PAGE);

    const dest = try a.alloc(u8, 4 * PAGE);
    defer a.free(dest);
    @memset(dest, 0xFF); // poison — decodeInto must zero-fill first.

    const meta = try decodeInto(payload, dest);
    try std.testing.expectEqual(@as(u64, 0x4000_0000), meta.ram_base);
    try std.testing.expectEqual(@as(u64, 4 * PAGE), meta.ram_size);
    try std.testing.expectEqualSlices(u8, ram, dest);
}

test "encode/decode round-trip on an all-zero buffer" {
    const a = std.testing.allocator;
    const ram = try a.alloc(u8, 8 * PAGE);
    defer a.free(ram);
    @memset(ram, 0);

    const payload = try encode(a, 0, ram);
    defer a.free(payload);
    // Nothing to store — payload is the bare header.
    try std.testing.expectEqual(HEADER_SIZE, payload.len);

    const dest = try a.alloc(u8, 8 * PAGE);
    defer a.free(dest);
    @memset(dest, 0xFF);
    _ = try decodeInto(payload, dest);
    try std.testing.expectEqualSlices(u8, ram, dest);
}

test "RAM delta overlays dirty pages including zeroed pages" {
    const a = std.testing.allocator;
    const parent = try a.alloc(u8, 4 * PAGE);
    defer a.free(parent);
    @memset(parent, 0x11);

    const child = try a.dupe(u8, parent);
    defer a.free(child);
    @memset(child[PAGE..][0..PAGE], 0); // dirty-to-zero must be explicit
    @memset(child[3 * PAGE ..][0..PAGE], 0x33);

    var bits = [_]u64{0};
    bits[0] |= (@as(u64, 1) << 1) | (@as(u64, 1) << 3);
    const payload = try encodeDelta(a, 0x4000_0000, child, &bits);
    defer a.free(payload);

    const dest = try a.dupe(u8, parent);
    defer a.free(dest);
    const meta = try decodeDeltaInto(payload, dest);
    try std.testing.expectEqual(@as(u64, 0x4000_0000), meta.ram_base);
    try std.testing.expectEqual(@as(u64, 4 * PAGE), meta.ram_size);
    try std.testing.expectEqualSlices(u8, child, dest);
}

test "decodeIntoZeroed reconstructs without clearing implicit zero pages" {
    const a = std.testing.allocator;
    const ram = try a.alloc(u8, 4 * PAGE);
    defer a.free(ram);
    @memset(ram, 0);
    @memset(ram[PAGE..][0..PAGE], 0x7E);

    const payload = try encode(a, 0, ram);
    defer a.free(payload);

    const zeroed = try a.alloc(u8, 4 * PAGE);
    defer a.free(zeroed);
    @memset(zeroed, 0);
    _ = try decodeIntoZeroed(payload, zeroed);
    try std.testing.expectEqualSlices(u8, ram, zeroed);

    const poisoned = try a.alloc(u8, 4 * PAGE);
    defer a.free(poisoned);
    @memset(poisoned, 0xA5);
    _ = try decodeIntoZeroed(payload, poisoned);
    try std.testing.expectEqualSlices(u8, ram[PAGE..][0..PAGE], poisoned[PAGE..][0..PAGE]);
    // Precondition is real: omitted pages are not cleared by this fast path.
    try std.testing.expectEqual(@as(u8, 0xA5), poisoned[0]);
}

test "encode/decode handles a non-page-aligned tail" {
    const a = std.testing.allocator;
    const ram = try a.alloc(u8, PAGE + 100);
    defer a.free(ram);
    @memset(ram, 0);
    ram[PAGE + 50] = 0x99; // non-zero byte in the short tail

    const payload = try encode(a, 0, ram);
    defer a.free(payload);

    const dest = try a.alloc(u8, PAGE + 100);
    defer a.free(dest);
    _ = try decodeInto(payload, dest);
    try std.testing.expectEqualSlices(u8, ram, dest);
}

test "decodeInto rejects a truncated header" {
    var dest: [PAGE]u8 = undefined;
    try std.testing.expectError(error.Truncated, decodeInto("short", &dest));
}

test "decodeInto rejects a dest smaller than ram_size" {
    const a = std.testing.allocator;
    const ram = try a.alloc(u8, 4 * PAGE);
    defer a.free(ram);
    @memset(ram, 0);
    @memset(ram[0..PAGE], 1);

    const payload = try encode(a, 0, ram);
    defer a.free(payload);

    var dest: [2 * PAGE]u8 = undefined;
    try std.testing.expectError(error.SizeMismatch, decodeInto(payload, &dest));
}

test "decodeInto rejects a flipped bit in an extent" {
    const a = std.testing.allocator;
    const ram = try a.alloc(u8, 2 * PAGE);
    defer a.free(ram);
    @memset(ram, 0);
    @memset(ram[0..PAGE], 0x5A);

    const payload = try encode(a, 0, ram);
    defer a.free(payload);
    const mut = try a.dupe(u8, payload);
    defer a.free(mut);
    // Flip a byte inside the stored extent (past header + extent prefix).
    mut[HEADER_SIZE + EXTENT_HEADER_SIZE + 3] ^= 0x01;

    var dest: [2 * PAGE]u8 = undefined;
    try std.testing.expectError(error.HashMismatch, decodeInto(mut, &dest));
}
