//! .vmstate file format — versioned, self-describing snapshot container.
//!
//! Layout (little-endian everywhere):
//!
//!   Header (64 bytes, fixed)
//!     magic[8]            = "VMSTATE\0"
//!     version u32          = 1
//!     arch u32             = 1 (aarch64) or 2 (x86_64)
//!     section_count u32
//!     reserved u32         = 0
//!     topology_hash[32]    = SHA256 of the guest IPA layout
//!     reserved2[8]         = 0
//!
//!   Section[section_count]
//!     tag u32              = SectionTag enum
//!     id u32               = subtype (e.g., virtio device index; 0 if N/A)
//!     length u64           = payload byte length
//!     payload[length]
//!
//! Sub-schemas of section payloads (VCPU only in #16; others land with
//! their respective tasks):
//!
//!   VCPU payload — name-tagged register dump
//!     entry_count u32
//!     entry_count × {
//!       name_len u8
//!       name[name_len]     (ASCII; e.g. "X0", "PMCR_EL0")
//!       value_len u32
//!       value[value_len]
//!     }
//!
//! The format is intentionally simple: enough structure for the diff
//! tool to do field-level masking on VCPU sections, opaque bytes
//! everywhere else. Later tasks (#22+ for GIC, #28+ for virtio) layer
//! their own sub-schemas inside their section payloads.

const std = @import("std");

pub const MAGIC: [8]u8 = .{ 'V', 'M', 'S', 'T', 'A', 'T', 'E', 0 };
pub const VERSION: u32 = 1;
pub const ARCH_AARCH64: u32 = 1;
pub const ARCH_X86_64: u32 = 2;
pub const HEADER_SIZE: usize = 64;

pub const SectionTag = enum(u32) {
    ram = 1,
    vcpu = 2,
    gic_dist = 3,
    gic_redist = 4,
    virtio = 5,
    /// Per-vCPU GIC CPU interface (ICC_* system registers). Payload
    /// is a name-tagged register dump (encodeVcpuPayload), keeping it
    /// portable across backends the same way the VCPU section is.
    gic_cpuif = 6,
    /// Host-side FUSE backend state for one virtio-fs `--mount-live`
    /// device — the nodeid→path map and open file/dir handles. The
    /// section `id` is the virtio-fs device's MMIO base (same keying
    /// as `.virtio`). Payload schema: fuse_state.zig.
    virtiofs_state = 7,
    /// Incremental RAM overlay against this checkpoint's parent.
    /// Payload schema: ram_dump.encodeDelta.
    ram_delta = 8,
    /// Incremental rootdisk overlay against this checkpoint's parent.
    /// Payload schema: rootdisk_delta.zig.
    rootdisk_delta = 9,
    /// x86 in-kernel interrupt-controller state. Section `id` is the
    /// KVM irqchip id: 0=master PIC, 1=slave PIC, 2=IOAPIC.
    x86_irqchip = 10,
    /// x86 in-kernel PIT state (`struct kvm_pit_state2`).
    x86_pit = 11,
    _,
};

pub const Header = extern struct {
    magic: [8]u8,
    version: u32,
    arch: u32,
    section_count: u32,
    reserved: u32 = 0,
    topology_hash: [32]u8,
    reserved2: [8]u8 = @splat(0),

    comptime {
        if (@sizeOf(Header) != HEADER_SIZE) {
            @compileError("Header must be exactly 64 bytes");
        }
    }
};

pub const Section = struct {
    tag: SectionTag,
    id: u32,
    payload: []const u8,
};

pub const ParseError = error{
    BadMagic,
    UnsupportedVersion,
    UnsupportedArch,
    Truncated,
    SectionOverflow,
    OutOfMemory,
};

pub const TopologyMismatch = error{TopologyMismatch};

pub const Vmstate = struct {
    header: Header,
    sections: []Section,
    arena: std.heap.ArenaAllocator,

    pub fn deinit(self: *Vmstate) void {
        self.arena.deinit();
    }
};

/// Encode header + sections into a contiguous buffer the caller owns.
///
/// Bounds: section_count must fit in u32, individual payloads in u64.
/// Total file size is implicitly bounded by the allocator.
pub fn encode(
    allocator: std.mem.Allocator,
    topology_hash: [32]u8,
    sections: []const Section,
) ![]u8 {
    return encode_with_arch(allocator, ARCH_AARCH64, topology_hash, sections);
}

pub fn encode_with_arch(
    allocator: std.mem.Allocator,
    arch: u32,
    topology_hash: [32]u8,
    sections: []const Section,
) ![]u8 {
    // Tiger-style preconditions.
    std.debug.assert(arch == ARCH_AARCH64 or arch == ARCH_X86_64);
    std.debug.assert(sections.len <= std.math.maxInt(u32));

    var total: usize = HEADER_SIZE;
    for (sections) |s| {
        std.debug.assert(s.payload.len <= std.math.maxInt(u64));
        total += 16 + s.payload.len; // tag(4)+id(4)+length(8)
    }

    const buf = try allocator.alloc(u8, total);
    errdefer allocator.free(buf);

    const hdr: Header = .{
        .magic = MAGIC,
        .version = VERSION,
        .arch = arch,
        .section_count = @intCast(sections.len),
        .topology_hash = topology_hash,
    };
    @memcpy(buf[0..HEADER_SIZE], std.mem.asBytes(&hdr));

    var off: usize = HEADER_SIZE;
    for (sections) |s| {
        std.mem.writeInt(u32, buf[off..][0..4], @intFromEnum(s.tag), .little);
        std.mem.writeInt(u32, buf[off + 4 ..][0..4], s.id, .little);
        std.mem.writeInt(u64, buf[off + 8 ..][0..8], s.payload.len, .little);
        @memcpy(buf[off + 16 ..][0..s.payload.len], s.payload);
        off += 16 + s.payload.len;
    }
    // Postcondition: every byte of the output is written.
    std.debug.assert(off == total);
    return buf;
}

/// Parse a .vmstate buffer. Allocates section metadata + payload copies
/// in an arena owned by the returned struct.
pub fn decode(allocator: std.mem.Allocator, bytes: []const u8) ParseError!Vmstate {
    if (bytes.len < HEADER_SIZE) return error.Truncated;

    var hdr: Header = undefined;
    @memcpy(std.mem.asBytes(&hdr), bytes[0..HEADER_SIZE]);

    if (!std.mem.eql(u8, &hdr.magic, &MAGIC)) return error.BadMagic;
    if (hdr.version != VERSION) return error.UnsupportedVersion;
    if (hdr.arch != ARCH_AARCH64 and hdr.arch != ARCH_X86_64) return error.UnsupportedArch;

    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();
    const arena_alloc = arena.allocator();

    const sections = try arena_alloc.alloc(Section, hdr.section_count);

    var off: usize = HEADER_SIZE;
    for (sections) |*s| {
        // Invariant: prior iterations never advanced past the buffer.
        std.debug.assert(off <= bytes.len);
        if (off + 16 > bytes.len) return error.Truncated;
        const tag_raw = std.mem.readInt(u32, bytes[off..][0..4], .little);
        const id = std.mem.readInt(u32, bytes[off + 4 ..][0..4], .little);
        const len = std.mem.readInt(u64, bytes[off + 8 ..][0..8], .little);
        off += 16;
        if (len > bytes.len or off + len > bytes.len) return error.SectionOverflow;
        const payload = try arena_alloc.dupe(u8, bytes[off..][0..len]);
        off += len;
        s.* = .{ .tag = @enumFromInt(tag_raw), .id = id, .payload = payload };
    }
    // Postcondition: parsing never read past the input buffer.
    std.debug.assert(off <= bytes.len);

    return .{ .header = hdr, .sections = sections, .arena = arena };
}

/// One {name, value} entry inside a VCPU section payload.
pub const VcpuEntry = struct {
    name: []const u8,
    value: []const u8,
};

pub const VcpuParseError = error{Truncated} || std.mem.Allocator.Error;

/// Encode a VCPU payload from a list of named register entries.
///
/// Bounds: entries.len fits in u32; each name fits in u8 (255 chars);
/// each value fits in u32 (4 GiB).
pub fn encode_vcpu_payload(allocator: std.mem.Allocator, entries: []const VcpuEntry) ![]u8 {
    std.debug.assert(entries.len <= std.math.maxInt(u32));

    var total: usize = 4; // entry_count
    for (entries) |e| {
        std.debug.assert(e.name.len <= 255);
        std.debug.assert(e.value.len <= std.math.maxInt(u32));
        total += 1 + e.name.len + 4 + e.value.len;
    }

    const buf = try allocator.alloc(u8, total);
    errdefer allocator.free(buf);
    std.mem.writeInt(u32, buf[0..4], @intCast(entries.len), .little);

    var off: usize = 4;
    for (entries) |e| {
        buf[off] = @intCast(e.name.len);
        off += 1;
        @memcpy(buf[off..][0..e.name.len], e.name);
        off += e.name.len;
        std.mem.writeInt(u32, buf[off..][0..4], @intCast(e.value.len), .little);
        off += 4;
        @memcpy(buf[off..][0..e.value.len], e.value);
        off += e.value.len;
    }
    std.debug.assert(off == total);
    return buf;
}

/// Decode a VCPU payload. Slices point into the input buffer (caller
/// keeps it alive). No copies.
pub fn decode_vcpu_payload(allocator: std.mem.Allocator, payload: []const u8) VcpuParseError![]VcpuEntry {
    if (payload.len < 4) return error.Truncated;
    const n = std.mem.readInt(u32, payload[0..4], .little);
    const entries = try allocator.alloc(VcpuEntry, n);
    errdefer allocator.free(entries);

    var off: usize = 4;
    for (entries) |*e| {
        // Invariant: prior iterations never advanced past the buffer.
        std.debug.assert(off <= payload.len);
        if (off + 1 > payload.len) return error.Truncated;
        const name_len = payload[off];
        off += 1;
        if (off + name_len + 4 > payload.len) return error.Truncated;
        const name = payload[off..][0..name_len];
        off += name_len;
        const value_len = std.mem.readInt(u32, payload[off..][0..4], .little);
        off += 4;
        if (off + value_len > payload.len) return error.Truncated;
        const value = payload[off..][0..value_len];
        off += value_len;
        e.* = .{ .name = name, .value = value };
    }
    // Postcondition: parsing never read past the input buffer.
    std.debug.assert(off <= payload.len);
    return entries;
}

// ---------------------------------------------------------------------
// Tests

test "header is exactly 64 bytes" {
    try std.testing.expectEqual(@as(usize, 64), @sizeOf(Header));
}

test "encode/decode round-trip with no sections" {
    const allocator = std.testing.allocator;
    const topo: [32]u8 = @splat(0xab);

    const bytes = try encode(allocator, topo, &.{});
    defer allocator.free(bytes);

    var snap = try decode(allocator, bytes);
    defer snap.deinit();

    try std.testing.expectEqualSlices(u8, &MAGIC, &snap.header.magic);
    try std.testing.expectEqual(VERSION, snap.header.version);
    try std.testing.expectEqual(ARCH_AARCH64, snap.header.arch);
    try std.testing.expectEqualSlices(u8, &topo, &snap.header.topology_hash);
    try std.testing.expectEqual(@as(usize, 0), snap.sections.len);
}

test "encode/decode round-trip with x86_64 arch" {
    const allocator = std.testing.allocator;
    const topo: [32]u8 = @splat(0xcd);

    const bytes = try encode_with_arch(allocator, ARCH_X86_64, topo, &.{});
    defer allocator.free(bytes);

    var snap = try decode(allocator, bytes);
    defer snap.deinit();
    try std.testing.expectEqual(ARCH_X86_64, snap.header.arch);
    try std.testing.expectEqualSlices(u8, &topo, &snap.header.topology_hash);
}

test "encode/decode round-trip with multiple sections" {
    const allocator = std.testing.allocator;
    const topo: [32]u8 = @splat(0x42);

    const ram_payload = "hello-ram-payload";
    const gic_payload = "gic-distributor-bytes";

    const sections = [_]Section{
        .{ .tag = .ram, .id = 0, .payload = ram_payload },
        .{ .tag = .gic_dist, .id = 0, .payload = gic_payload },
    };

    const bytes = try encode(allocator, topo, &sections);
    defer allocator.free(bytes);

    var snap = try decode(allocator, bytes);
    defer snap.deinit();

    try std.testing.expectEqual(@as(usize, 2), snap.sections.len);
    try std.testing.expectEqual(SectionTag.ram, snap.sections[0].tag);
    try std.testing.expectEqualSlices(u8, ram_payload, snap.sections[0].payload);
    try std.testing.expectEqual(SectionTag.gic_dist, snap.sections[1].tag);
    try std.testing.expectEqualSlices(u8, gic_payload, snap.sections[1].payload);
}

test "encode is byte-stable across two encodes of same input" {
    const allocator = std.testing.allocator;
    const topo: [32]u8 = @splat(0x77);
    const sections = [_]Section{
        .{ .tag = .vcpu, .id = 0, .payload = "abcdef" },
    };

    const a = try encode(allocator, topo, &sections);
    defer allocator.free(a);
    const b = try encode(allocator, topo, &sections);
    defer allocator.free(b);

    try std.testing.expectEqualSlices(u8, a, b);
}

test "decode rejects bad magic" {
    const allocator = std.testing.allocator;
    const topo: [32]u8 = @splat(0);
    const bytes = try encode(allocator, topo, &.{});
    defer allocator.free(bytes);
    bytes[0] = 'X';
    try std.testing.expectError(error.BadMagic, decode(allocator, bytes));
}

test "decode rejects unsupported version" {
    const allocator = std.testing.allocator;
    const topo: [32]u8 = @splat(0);
    const bytes = try encode(allocator, topo, &.{});
    defer allocator.free(bytes);
    // version is at byte 8, little-endian u32
    bytes[8] = 99;
    try std.testing.expectError(error.UnsupportedVersion, decode(allocator, bytes));
}

test "decode rejects truncated buffer" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.Truncated, decode(allocator, "short"));
}

test "decode rejects section overflow" {
    const allocator = std.testing.allocator;
    const topo: [32]u8 = @splat(0);
    // Build a valid 1-section file then truncate the payload.
    const sections = [_]Section{
        .{ .tag = .ram, .id = 0, .payload = "abcdefghij" },
    };
    const bytes = try encode(allocator, topo, &sections);
    defer allocator.free(bytes);
    // Slice off the last 5 payload bytes — section header still claims 10.
    try std.testing.expectError(error.SectionOverflow, decode(allocator, bytes[0 .. bytes.len - 5]));
}

test "vcpu payload round-trip" {
    const allocator = std.testing.allocator;
    const entries = [_]VcpuEntry{
        .{ .name = "X0", .value = &[_]u8{ 0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 0 } },
        .{ .name = "PMCR_EL0", .value = &[_]u8{ 0x41, 0, 0, 0, 0, 0, 0, 0 } },
        .{ .name = "CNTVOFF_EL2", .value = &[_]u8{ 0x10, 0x20, 0, 0, 0, 0, 0, 0 } },
    };

    const payload = try encode_vcpu_payload(allocator, &entries);
    defer allocator.free(payload);

    const decoded = try decode_vcpu_payload(allocator, payload);
    defer allocator.free(decoded);

    try std.testing.expectEqual(@as(usize, 3), decoded.len);
    try std.testing.expectEqualStrings("X0", decoded[0].name);
    try std.testing.expectEqualSlices(u8, entries[0].value, decoded[0].value);
    try std.testing.expectEqualStrings("PMCR_EL0", decoded[1].name);
    try std.testing.expectEqualSlices(u8, entries[1].value, decoded[1].value);
    try std.testing.expectEqualStrings("CNTVOFF_EL2", decoded[2].name);
    try std.testing.expectEqualSlices(u8, entries[2].value, decoded[2].value);
}

test "vcpu payload rejects truncated" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.Truncated, decode_vcpu_payload(allocator, &[_]u8{ 1, 0, 0 }));
}
