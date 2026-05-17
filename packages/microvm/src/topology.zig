//! Topology fingerprint — SHA256 of the guest IPA layout.
//!
//! Both HVF and KVM boot paths compute the same hash from the same
//! fields. The hash lives in the .vmstate header (task #16) and is
//! re-validated on load: if the live guest's topology hash doesn't
//! match the snapshot's, restore fails before touching any state.
//!
//! Hashed fields, in order, little-endian:
//!   - arch (u32; 1 = aarch64, 2 = x86_64)
//!   - ram_base (u64)
//!   - ram_size (u64)
//!   - gic_dist_base (u64)
//!   - gic_redist_base (u64)
//!   - uart_base (u64)
//!   - virtio_mmio_base (u64)
//!   - virtio_mmio_stride (u64)
//!   - virtio_mmio_count (u32)
//!
//! Order matters; bumping the format requires re-hashing existing
//! .vmstate files. Add fields at the *end* if you must.

const std = @import("std");

pub const ARCH_AARCH64: u32 = 1;
pub const ARCH_X86_64: u32 = 2;

/// Fixed by virt.dts. Update if/when the device tree moves.
pub const UART_BASE: u64 = 0x0900_0000;
pub const VIRTIO_MMIO_BASE: u64 = 0x0a00_0000;
pub const VIRTIO_MMIO_STRIDE: u64 = 0x0000_0200;
pub const VIRTIO_MMIO_COUNT: u32 = 7;

pub const Topology = struct {
    arch: u32 = ARCH_AARCH64,
    ram_base: u64,
    ram_size: u64,
    gic_dist_base: u64,
    gic_redist_base: u64,
    uart_base: u64 = UART_BASE,
    virtio_mmio_base: u64 = VIRTIO_MMIO_BASE,
    virtio_mmio_stride: u64 = VIRTIO_MMIO_STRIDE,
    virtio_mmio_count: u32 = VIRTIO_MMIO_COUNT,

    pub fn hash(self: Topology) [32]u8 {
        // Tiger-style preconditions on layout invariants. Page
        // alignment + non-zero RAM are necessary for the boot path
        // to map the region cleanly.
        std.debug.assert(self.arch == ARCH_AARCH64 or self.arch == ARCH_X86_64);
        std.debug.assert(self.ram_size > 0);
        std.debug.assert(self.ram_base % 4096 == 0);
        std.debug.assert(self.ram_size % 4096 == 0);
        if (self.arch == ARCH_AARCH64) {
            std.debug.assert(self.gic_dist_base != self.gic_redist_base);
        }
        std.debug.assert(self.virtio_mmio_count > 0);

        var h = std.crypto.hash.sha2.Sha256.init(.{});
        var b: [8]u8 = undefined;

        std.mem.writeInt(u32, b[0..4], self.arch, .little);
        h.update(b[0..4]);
        std.mem.writeInt(u64, &b, self.ram_base, .little);
        h.update(&b);
        std.mem.writeInt(u64, &b, self.ram_size, .little);
        h.update(&b);
        std.mem.writeInt(u64, &b, self.gic_dist_base, .little);
        h.update(&b);
        std.mem.writeInt(u64, &b, self.gic_redist_base, .little);
        h.update(&b);
        std.mem.writeInt(u64, &b, self.uart_base, .little);
        h.update(&b);
        std.mem.writeInt(u64, &b, self.virtio_mmio_base, .little);
        h.update(&b);
        std.mem.writeInt(u64, &b, self.virtio_mmio_stride, .little);
        h.update(&b);
        std.mem.writeInt(u32, b[0..4], self.virtio_mmio_count, .little);
        h.update(b[0..4]);

        var out: [32]u8 = undefined;
        h.final(&out);
        return out;
    }

    pub fn hash_hex(self: Topology) [64]u8 {
        const bytes = self.hash();
        var hex: [64]u8 = undefined;
        const digits = "0123456789abcdef";
        for (bytes, 0..) |byte, i| {
            hex[i * 2] = digits[(byte >> 4) & 0xf];
            hex[i * 2 + 1] = digits[byte & 0xf];
        }
        return hex;
    }
};

// ----- tests -----

test "hash is deterministic for the same input" {
    const t1: Topology = .{
        .ram_base = 0x4000_0000,
        .ram_size = 4 * 1024 * 1024 * 1024,
        .gic_dist_base = 0x0800_0000,
        .gic_redist_base = 0x1000_0000,
    };
    const t2 = t1;
    try std.testing.expectEqual(t1.hash(), t2.hash());
}

test "hash supports x86_64 topology" {
    const t: Topology = .{
        .arch = ARCH_X86_64,
        .ram_base = 0,
        .ram_size = 4 * 1024 * 1024 * 1024,
        .gic_dist_base = 0,
        .gic_redist_base = 0,
        .virtio_mmio_count = 12,
    };
    const h = t.hash();
    try std.testing.expect(!std.mem.allEqual(u8, &h, 0));
}

test "hash diverges when ram_size changes" {
    const t1: Topology = .{
        .ram_base = 0x4000_0000,
        .ram_size = 4 * 1024 * 1024 * 1024,
        .gic_dist_base = 0x0800_0000,
        .gic_redist_base = 0x1000_0000,
    };
    var t2 = t1;
    t2.ram_size = 8 * 1024 * 1024 * 1024;
    try std.testing.expect(!std.mem.eql(u8, &t1.hash(), &t2.hash()));
}

test "hash diverges when gic_dist_base moves" {
    const t1: Topology = .{
        .ram_base = 0x4000_0000,
        .ram_size = 4 * 1024 * 1024 * 1024,
        .gic_dist_base = 0x0800_0000,
        .gic_redist_base = 0x1000_0000,
    };
    var t2 = t1;
    t2.gic_dist_base = 0x0900_0000;
    try std.testing.expect(!std.mem.eql(u8, &t1.hash(), &t2.hash()));
}

test "hashHex round-trips through parseHex32" {
    const t: Topology = .{
        .ram_base = 0x4000_0000,
        .ram_size = 4 * 1024 * 1024 * 1024,
        .gic_dist_base = 0x0800_0000,
        .gic_redist_base = 0x1000_0000,
    };
    const hex = t.hash_hex();
    const bytes = t.hash();
    var parsed: [32]u8 = undefined;
    for (0..32) |i| {
        const hi = try std.fmt.charToDigit(hex[i * 2], 16);
        const lo = try std.fmt.charToDigit(hex[i * 2 + 1], 16);
        parsed[i] = (hi << 4) | lo;
    }
    try std.testing.expectEqualSlices(u8, &bytes, &parsed);
}

test "all five smoke-test machine configs produce distinct hashes" {
    // Five configs that should yield five different hashes — each one
    // changes exactly one field from the default.
    const default: Topology = .{
        .ram_base = 0x4000_0000,
        .ram_size = 4 * 1024 * 1024 * 1024,
        .gic_dist_base = 0x0800_0000,
        .gic_redist_base = 0x1000_0000,
    };
    var ram_2x = default;
    ram_2x.ram_size *= 2;
    var ram_base_moved = default;
    ram_base_moved.ram_base = 0x8000_0000;
    var gic_dist_moved = default;
    gic_dist_moved.gic_dist_base = 0x0c00_0000;
    var gic_redist_moved = default;
    gic_redist_moved.gic_redist_base = 0x2000_0000;

    const configs = [_]Topology{ default, ram_2x, ram_base_moved, gic_dist_moved, gic_redist_moved };
    const hashes = blk: {
        var hs: [configs.len][32]u8 = undefined;
        for (configs, 0..) |c, i| hs[i] = c.hash();
        break :blk hs;
    };
    // Pairwise distinct.
    for (0..configs.len) |i| {
        for (i + 1..configs.len) |j| {
            try std.testing.expect(!std.mem.eql(u8, &hashes[i], &hashes[j]));
        }
    }
}
