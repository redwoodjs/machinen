//! RAM section codec for .snaplet (task #26).
//!
//! Payload layout (little-endian):
//!
//!   header (48 bytes, fixed)
//!     ram_base u64        — guest IPA of the first byte
//!     ram_size u64        — bytes (must match the header length)
//!     sha256[32]          — SHA256 of the *raw* RAM bytes
//!   ram_bytes[ram_size]   — raw, page-aligned. Compression is a
//!                            future extension; for v1 we store raw.
//!
//! Loader recomputes the SHA256 over the trailing bytes and refuses
//! if they don't match. RAM is the bulk of the snapshot; a silent
//! flip here would scramble the restore.

const std = @import("std");

pub const HEADER_SIZE: usize = 48;

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

/// Build a RAM section payload from a host-side buffer. Caller owns
/// the returned bytes.
pub fn encode(allocator: std.mem.Allocator, ram_base: u64, ram: []const u8) ![]u8 {
    // Tiger-style preconditions: RAM is non-empty and base is page
    // aligned. Empty RAM dumps are a likely sign of caller error.
    std.debug.assert(ram.len > 0);
    std.debug.assert(ram_base % 4096 == 0);

    var sha = std.crypto.hash.sha2.Sha256.init(.{});
    sha.update(ram);
    var digest: [32]u8 = undefined;
    sha.final(&digest);

    const out = try allocator.alloc(u8, HEADER_SIZE + ram.len);
    const hdr: RamHeader = .{
        .ram_base = ram_base,
        .ram_size = ram.len,
        .sha256 = digest,
    };
    @memcpy(out[0..HEADER_SIZE], std.mem.asBytes(&hdr));
    @memcpy(out[HEADER_SIZE..], ram);
    return out;
}

/// Parse + verify a RAM payload. Returns slices into `payload`.
/// Caller keeps `payload` alive.
pub const Decoded = struct {
    ram_base: u64,
    ram: []const u8,
    sha256: [32]u8,
};

pub fn decode(payload: []const u8) DecodeError!Decoded {
    if (payload.len < HEADER_SIZE) return error.Truncated;
    var hdr: RamHeader = undefined;
    @memcpy(std.mem.asBytes(&hdr), payload[0..HEADER_SIZE]);

    if (hdr.ram_size != payload.len - HEADER_SIZE) return error.SizeMismatch;
    const ram = payload[HEADER_SIZE..];

    var sha = std.crypto.hash.sha2.Sha256.init(.{});
    sha.update(ram);
    var digest: [32]u8 = undefined;
    sha.final(&digest);
    if (!std.mem.eql(u8, &digest, &hdr.sha256)) return error.HashMismatch;

    return .{
        .ram_base = hdr.ram_base,
        .ram = ram,
        .sha256 = hdr.sha256,
    };
}

// --- tests ---

test "encode/decode round-trip on small RAM" {
    const a = std.testing.allocator;
    const ram = "hello world, this is some RAM bytes" ** 16;
    const payload = try encode(a, 0x4000_0000, ram);
    defer a.free(payload);

    const dec = try decode(payload);
    try std.testing.expectEqual(@as(u64, 0x4000_0000), dec.ram_base);
    try std.testing.expectEqualSlices(u8, ram, dec.ram);
}

test "decode rejects truncated buffer" {
    try std.testing.expectError(error.Truncated, decode("short"));
}

test "decode rejects size mismatch" {
    const a = std.testing.allocator;
    const ram = "hello";
    const payload = try encode(a, 0, ram);
    defer a.free(payload);
    // Truncate one byte; size in header still claims 5.
    try std.testing.expectError(error.SizeMismatch, decode(payload[0 .. payload.len - 1]));
}

test "decode rejects flipped bit in RAM" {
    const a = std.testing.allocator;
    const ram = "the answer is forty two";
    const payload = try encode(a, 0, ram);
    defer a.free(payload);
    // Mutate one byte in the RAM region — must NOT use a const
    // pointer.
    const mut = try a.dupe(u8, payload);
    defer a.free(mut);
    mut[HEADER_SIZE + 4] ^= 0x01;
    try std.testing.expectError(error.HashMismatch, decode(mut));
}

test "encode produces a fixed header size regardless of RAM length" {
    const a = std.testing.allocator;
    const small = try encode(a, 0, "x");
    defer a.free(small);
    const large = try encode(a, 0, "x" ** 1024);
    defer a.free(large);
    try std.testing.expectEqual(@as(usize, HEADER_SIZE + 1), small.len);
    try std.testing.expectEqual(@as(usize, HEADER_SIZE + 1024), large.len);
}
