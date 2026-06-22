const std = @import("std");

pub const GuestArch = enum {
    arm64,
    amd64,
    unknown,
};

pub const Facts = struct {
    arch: GuestArch,
    topology_hash: []u8,
    section_count: u32,
    guest_pauth_active: ?bool = null,
    sctlr_el1: ?[]u8 = null,

    pub fn deinit(self: Facts, allocator: std.mem.Allocator) void {
        allocator.free(self.topology_hash);
        if (self.sctlr_el1) |value| allocator.free(value);
    }
};

pub const ReadFactsError = std.Io.File.OpenError || std.Io.File.ReadPositionalError || std.Io.File.StatError || std.mem.Allocator.Error || error{
    TruncatedHeader,
    BadMagic,
    UnsupportedVersion,
    UnsupportedArch,
    TruncatedSectionHeader,
    SectionOverflowsFile,
    SectionTooLarge,
    TruncatedVcpuPayload,
    TruncatedVcpuEntry,
    TruncatedVcpuName,
    TruncatedVcpuValue,
    InvalidVcpuValueLength,
};

const magic = "VMSTATE\x00";
const header_size = 64;
const section_header_size = 16;
const section_tag_vcpu = 2;
const arch_aarch64 = 1;
const arch_x86_64 = 2;
const max_vcpu_payload_bytes = 16 * 1024 * 1024;

const sctlr_enia: u64 = @as(u64, 1) << 31;
const sctlr_enib: u64 = @as(u64, 1) << 30;
const sctlr_enda: u64 = @as(u64, 1) << 27;
const sctlr_endb: u64 = @as(u64, 1) << 13;
const sctlr_pauth_mask = sctlr_enia | sctlr_enib | sctlr_enda | sctlr_endb;

pub fn readFacts(allocator: std.mem.Allocator, io: std.Io, path: []const u8) ReadFactsError!Facts {
    var file = try std.Io.Dir.cwd().openFile(io, path, .{ .allow_directory = false });
    defer file.close(io);

    const st = try file.stat(io);
    var header: [header_size]u8 = undefined;
    if (try file.readPositionalAll(io, &header, 0) < header.len) return error.TruncatedHeader;
    if (!std.mem.eql(u8, header[0..magic.len], magic)) return error.BadMagic;

    const version = std.mem.readInt(u32, header[8..12], .little);
    if (version != 1) return error.UnsupportedVersion;
    const arch_id = std.mem.readInt(u32, header[12..16], .little);
    const arch = vmstateArchName(arch_id) orelse return error.UnsupportedArch;
    const section_count = std.mem.readInt(u32, header[16..20], .little);
    const topology_bytes: [32]u8 = header[24..56].*;
    const topology_hex = std.fmt.bytesToHex(topology_bytes, .lower);
    const topology_hash = try allocator.dupe(u8, &topology_hex);
    errdefer allocator.free(topology_hash);

    var off: u64 = header_size;
    var sctlr_el1: ?[]u8 = null;
    errdefer if (sctlr_el1) |value| allocator.free(value);
    var guest_pauth_active: ?bool = null;

    for (0..section_count) |_| {
        var section_header: [section_header_size]u8 = undefined;
        if (off > st.size or st.size - off < section_header.len) return error.TruncatedSectionHeader;
        if (try file.readPositionalAll(io, &section_header, off) < section_header.len) return error.TruncatedSectionHeader;
        const tag = std.mem.readInt(u32, section_header[0..4], .little);
        const len = std.mem.readInt(u64, section_header[8..16], .little);
        off += section_header_size;
        if (len > st.size - off) return error.SectionOverflowsFile;
        if (tag == section_tag_vcpu and sctlr_el1 == null) {
            if (len > max_vcpu_payload_bytes or len > std.math.maxInt(usize)) return error.SectionTooLarge;
            const payload = try allocator.alloc(u8, @intCast(len));
            defer allocator.free(payload);
            if (try file.readPositionalAll(io, payload, off) < payload.len) return error.SectionOverflowsFile;
            if (try readVcpuU64(payload, "SCTLR_EL1")) |sctlr| {
                sctlr_el1 = try std.fmt.allocPrint(allocator, "0x{x}", .{sctlr});
                guest_pauth_active = (sctlr & sctlr_pauth_mask) != 0;
            }
        }
        off += len;
    }

    return .{
        .arch = arch,
        .topology_hash = topology_hash,
        .section_count = section_count,
        .guest_pauth_active = guest_pauth_active,
        .sctlr_el1 = sctlr_el1,
    };
}

fn vmstateArchName(arch: u32) ?GuestArch {
    return switch (arch) {
        arch_aarch64 => .arm64,
        arch_x86_64 => .amd64,
        else => null,
    };
}

pub fn guestArchName(arch: GuestArch) []const u8 {
    return switch (arch) {
        .arm64 => "arm64",
        .amd64 => "amd64",
        .unknown => "unknown",
    };
}

fn readVcpuU64(payload: []const u8, needle: []const u8) ReadFactsError!?u64 {
    if (payload.len < 4) return error.TruncatedVcpuPayload;
    const count = std.mem.readInt(u32, payload[0..4], .little);
    var off: usize = 4;
    for (0..count) |_| {
        if (off + 1 > payload.len) return error.TruncatedVcpuEntry;
        const name_len: usize = payload[off];
        off += 1;
        if (off + name_len + 4 > payload.len) return error.TruncatedVcpuName;
        const name = payload[off .. off + name_len];
        off += name_len;
        const value_len = std.mem.readInt(u32, payload[off..][0..4], .little);
        off += 4;
        if (value_len > std.math.maxInt(usize)) return error.TruncatedVcpuValue;
        const value_len_usize: usize = @intCast(value_len);
        if (value_len_usize > payload.len - off) return error.TruncatedVcpuValue;
        if (std.mem.eql(u8, name, needle)) {
            if (value_len != 8) return error.InvalidVcpuValueLength;
            return std.mem.readInt(u64, payload[off..][0..8], .little);
        }
        off += value_len_usize;
    }
    return null;
}

test "readFacts decodes vmstate header and PAuth SCTLR" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = "state.vmstate";
    const bytes = try fixtureVmstate(std.testing.allocator, sctlr_enia);
    defer std.testing.allocator.free(bytes);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = path, .data = bytes });
    const root = try tmpRootAbs(std.testing.allocator, &tmp);
    defer std.testing.allocator.free(root);
    const abs_path = try std.fs.path.join(std.testing.allocator, &.{ root, path });
    defer std.testing.allocator.free(abs_path);

    var facts = try readFacts(std.testing.allocator, std.testing.io, abs_path);
    defer facts.deinit(std.testing.allocator);
    try std.testing.expectEqual(GuestArch.arm64, facts.arch);
    try std.testing.expectEqual(@as(u32, 1), facts.section_count);
    try std.testing.expectEqualStrings("a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5", facts.topology_hash);
    try std.testing.expectEqual(true, facts.guest_pauth_active.?);
    try std.testing.expectEqualStrings("0x80000000", facts.sctlr_el1.?);
}

test "readFacts rejects malformed vmstate magic" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "bad.vmstate", .data = "not a vmstate" });
    const root = try tmpRootAbs(std.testing.allocator, &tmp);
    defer std.testing.allocator.free(root);
    const path = try std.fs.path.join(std.testing.allocator, &.{ root, "bad.vmstate" });
    defer std.testing.allocator.free(path);
    try std.testing.expectError(error.TruncatedHeader, readFacts(std.testing.allocator, std.testing.io, path));
}

fn tmpRootAbs(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

fn fixtureVmstate(allocator: std.mem.Allocator, sctlr: u64) ![]u8 {
    const vcpu = try fixtureVcpuPayload(allocator, sctlr);
    defer allocator.free(vcpu);
    const total = header_size + section_header_size + vcpu.len;
    const out = try allocator.alloc(u8, total);
    @memset(out, 0);
    @memcpy(out[0..magic.len], magic);
    std.mem.writeInt(u32, out[8..12], 1, .little);
    std.mem.writeInt(u32, out[12..16], arch_aarch64, .little);
    std.mem.writeInt(u32, out[16..20], 1, .little);
    @memset(out[24..56], 0xa5);
    var section = out[header_size .. header_size + section_header_size];
    std.mem.writeInt(u32, section[0..4], section_tag_vcpu, .little);
    std.mem.writeInt(u64, section[8..16], vcpu.len, .little);
    @memcpy(out[header_size + section_header_size ..], vcpu);
    return out;
}

fn fixtureVcpuPayload(allocator: std.mem.Allocator, sctlr: u64) ![]u8 {
    const name = "SCTLR_EL1";
    const total = 4 + 1 + name.len + 4 + 8;
    const out = try allocator.alloc(u8, total);
    std.mem.writeInt(u32, out[0..4], 1, .little);
    out[4] = name.len;
    @memcpy(out[5 .. 5 + name.len], name);
    const value_len_off = 5 + name.len;
    std.mem.writeInt(u32, out[value_len_off .. value_len_off + 4], 8, .little);
    std.mem.writeInt(u64, out[value_len_off + 4 .. value_len_off + 12], sctlr, .little);
    return out;
}
