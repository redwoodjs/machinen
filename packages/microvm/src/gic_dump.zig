//! GICv3 distributor + redistributor + LR/AP state codec (tasks
//! #22, #23). Same shape as ram_dump.zig: small header + opaque
//! payload bytes. The byte layout follows the GICv3 spec (D17
//! "Generic Interrupt Controller, version 3"), which both KVM
//! (`KVM_DEV_ARM_VGIC_GRP_DIST_REGS` / `_REDIST_REGS` /
//! `_CPU_SYSREGS`) and HVF (`hv_gic_get_distributor_reg` etc.)
//! agree on at the wire level.
//!
//! The bridge between the two backends' opaque-byte dumps is a
//! field-by-field translator (#24) that walks the spec-defined
//! offsets; v1 of this codec only handles the container.
//!
//! Section payload layout:
//!   header (16 bytes)
//!     kind u32 — 1=distributor, 2=redistributor, 3=cpu-sysregs
//!     id u32   — per-vCPU index for redistributor/cpu-sysregs (0 for distributor)
//!     length u32 — payload byte count
//!     reserved u32
//!   payload[length] — backend-specific spec-byte dump

const std = @import("std");

pub const KIND_DIST: u32 = 1;
pub const KIND_REDIST: u32 = 2;
pub const KIND_CPU_SYSREGS: u32 = 3;

pub const HEADER_SIZE: usize = 16;

pub const Header = extern struct {
    kind: u32,
    id: u32,
    length: u32,
    _reserved: u32 = 0,
};

pub const DecodeError = error{ Truncated, BadKind, BadLength };

pub fn encode(allocator: std.mem.Allocator, kind: u32, id: u32, payload: []const u8) ![]u8 {
    // Tiger-style preconditions.
    std.debug.assert(kind == KIND_DIST or kind == KIND_REDIST or kind == KIND_CPU_SYSREGS);
    std.debug.assert(payload.len <= std.math.maxInt(u32));
    // distributor section uses id = 0; redist/cpu use vcpu index.
    std.debug.assert(kind != KIND_DIST or id == 0);

    const out = try allocator.alloc(u8, HEADER_SIZE + payload.len);
    const hdr: Header = .{ .kind = kind, .id = id, .length = @intCast(payload.len) };
    @memcpy(out[0..HEADER_SIZE], std.mem.asBytes(&hdr));
    @memcpy(out[HEADER_SIZE..], payload);
    return out;
}

pub const Decoded = struct {
    kind: u32,
    id: u32,
    payload: []const u8,
};

pub fn decode(bytes: []const u8) DecodeError!Decoded {
    if (bytes.len < HEADER_SIZE) return error.Truncated;
    var hdr: Header = undefined;
    @memcpy(std.mem.asBytes(&hdr), bytes[0..HEADER_SIZE]);
    if (hdr.kind != KIND_DIST and hdr.kind != KIND_REDIST and hdr.kind != KIND_CPU_SYSREGS) {
        return error.BadKind;
    }
    if (hdr.length != bytes.len - HEADER_SIZE) return error.BadLength;
    return .{
        .kind = hdr.kind,
        .id = hdr.id,
        .payload = bytes[HEADER_SIZE..],
    };
}

// --- tests ---

test "encode/decode round-trip on distributor payload" {
    const a = std.testing.allocator;
    const payload = "fake-distributor-bytes" ** 8;
    const out = try encode(a, KIND_DIST, 0, payload);
    defer a.free(out);
    const d = try decode(out);
    try std.testing.expectEqual(KIND_DIST, d.kind);
    try std.testing.expectEqual(@as(u32, 0), d.id);
    try std.testing.expectEqualSlices(u8, payload, d.payload);
}

test "encode/decode round-trip on redistributor payload (vcpu id)" {
    const a = std.testing.allocator;
    const payload: [128]u8 = @splat(0x42);
    const out = try encode(a, KIND_REDIST, 7, &payload);
    defer a.free(out);
    const d = try decode(out);
    try std.testing.expectEqual(KIND_REDIST, d.kind);
    try std.testing.expectEqual(@as(u32, 7), d.id);
    try std.testing.expectEqualSlices(u8, &payload, d.payload);
}

test "decode rejects truncated" {
    try std.testing.expectError(error.Truncated, decode("x"));
}

test "decode rejects bad kind" {
    var buf: [HEADER_SIZE]u8 = @splat(0);
    std.mem.writeInt(u32, buf[0..4], 99, .little);
    try std.testing.expectError(error.BadKind, decode(&buf));
}

test "decode rejects length mismatch" {
    const a = std.testing.allocator;
    const out = try encode(a, KIND_DIST, 0, "hello");
    defer a.free(out);
    try std.testing.expectError(error.BadLength, decode(out[0 .. out.len - 1]));
}
