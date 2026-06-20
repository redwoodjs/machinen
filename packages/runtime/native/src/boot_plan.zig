const std = @import("std");

const memory_floor_mib: u64 = 512;
const memory_default_ceiling_mib: u64 = 4096;

pub const RootDiskMode = enum {
    unset,
    false_value,
    path,
    true_value,
};

pub const ResourcesMemory = struct {
    max_mib: u64,
    reclaim: ?[]const u8,
};

pub const EnvPair = struct {
    key: []const u8,
    value: []const u8,
};

pub const GuestEnvInput = struct {
    env: []const EnvPair,
    name: ?[]const u8 = null,
    vsock_uds_path: ?[]const u8 = null,
};

pub const VsockPlanInput = struct {
    existing_spec: ?[]const u8 = null,
    auto_uds_path: ?[]const u8 = null,
};

pub const VsockPlan = struct {
    uds_path: ?[]const u8,
    vmm_vsock: ?[]const u8,
};

pub const PortForwardMapping = struct {
    host_port: i64,
    guest_port: i64,
};

pub const PortForwardValidation = union(enum) {
    ok,
    invalid_host_port: i64,
    invalid_guest_port: i64,
    duplicate_host_port: u16,
};

pub const Input = struct {
    memory_mib: ?u64 = null,
    resources_memory: ?ResourcesMemory = null,
    auto_memory_mib: ?u64 = null,
    host_total_bytes: ?u64 = null,
    vmm_memory_preset: bool = false,
    has_image: bool = false,
    has_cmd: bool = false,
    root_disk: RootDiskMode = .unset,
    guest_cwd: ?[]const u8 = null,
    mount_guest: ?[]const u8 = null,
};

pub const Plan = struct {
    memory_ceiling_mib: ?u64,
    vmm_memory_mib: ?u64,
    wants_root_disk: bool,
    normalized_mount_guest: ?[]const u8,
};

pub const PlanError = error{
    InvalidMemory,
    ConflictingMemory,
    InvalidReclaim,
    CmdWithoutImage,
    RootDiskWithoutImage,
    MissingAutoMemory,
    InvalidGuestCwdAbsolute,
    InvalidGuestCwdNul,
    InvalidMountGuestAbsolute,
    InvalidMountGuestRoot,
};

pub fn planGuestEnv(allocator: std.mem.Allocator, input: GuestEnvInput) ![]EnvPair {
    var out: std.ArrayList(EnvPair) = .empty;
    errdefer out.deinit(allocator);
    var has_name = false;
    var has_hostname_wait = false;
    for (input.env) |pair| {
        try out.append(allocator, pair);
        if (std.mem.eql(u8, pair.key, "MACHINEN_VM_NAME")) has_name = true;
        if (std.mem.eql(u8, pair.key, "MACHINEN_VM_HOSTNAME_WAIT")) has_hostname_wait = true;
    }
    if (input.name) |name| {
        if (!has_name) try out.append(allocator, .{ .key = "MACHINEN_VM_NAME", .value = name });
    }
    if (input.vsock_uds_path != null and !has_hostname_wait) {
        try out.append(allocator, .{ .key = "MACHINEN_VM_HOSTNAME_WAIT", .value = "1" });
    }
    return out.toOwnedSlice(allocator);
}

pub fn planVsock(allocator: std.mem.Allocator, input: VsockPlanInput) !VsockPlan {
    if (input.existing_spec) |spec| {
        return .{ .uds_path = parseVsockUdsPath(spec), .vmm_vsock = null };
    }
    if (input.auto_uds_path) |uds| {
        return .{
            .uds_path = uds,
            .vmm_vsock = try std.fmt.allocPrint(allocator, "in:1978:{s}", .{uds}),
        };
    }
    return .{ .uds_path = null, .vmm_vsock = null };
}

pub fn parseVsockUdsPath(spec: []const u8) ?[]const u8 {
    var entries = std.mem.splitScalar(u8, spec, ',');
    while (entries.next()) |entry| {
        const first_colon = std.mem.indexOfScalar(u8, entry, ':') orelse continue;
        const rest = entry[first_colon + 1 ..];
        const second_rel = std.mem.indexOfScalar(u8, rest, ':') orelse continue;
        const port = rest[0..second_rel];
        if (port.len == 0) continue;
        if (!isDecimal(port)) continue;
        const path = rest[second_rel + 1 ..];
        if (path.len > 0) return path;
    }
    return null;
}

pub fn validatePortForward(mappings: []const PortForwardMapping) PortForwardValidation {
    var seen = std.StaticBitSet(65536).initEmpty();
    for (mappings) |mapping| {
        const host_port = validateTcpPort(mapping.host_port) orelse return .{ .invalid_host_port = mapping.host_port };
        _ = validateTcpPort(mapping.guest_port) orelse return .{ .invalid_guest_port = mapping.guest_port };
        if (seen.isSet(host_port)) return .{ .duplicate_host_port = @intCast(host_port) };
        seen.set(host_port);
    }
    return .ok;
}

fn validateTcpPort(port: i64) ?usize {
    if (port < 1 or port > 65535) return null;
    return @intCast(port);
}

pub fn autoSizeMemoryMib(host_total_bytes: u64) u64 {
    const host_mib = host_total_bytes / (1024 * 1024);
    const host_aware_ceiling = host_mib / 2;
    return @max(memory_floor_mib, @min(host_aware_ceiling, memory_default_ceiling_mib));
}

pub fn validateMemoryMib(mib: u64) PlanError!u64 {
    if (mib < memory_floor_mib) return error.InvalidMemory;
    return mib;
}

pub fn planCore(input: Input) PlanError!Plan {
    if (input.has_cmd and !input.has_image) return error.CmdWithoutImage;

    const wants_root_disk = input.root_disk != .false_value and
        (input.root_disk == .path or input.root_disk == .true_value or input.has_image);
    if (wants_root_disk and input.root_disk != .path and !input.has_image) {
        return error.RootDiskWithoutImage;
    }
    if (input.guest_cwd) |cwd| try validateGuestCwd(cwd);
    const normalized_mount_guest = if (input.mount_guest) |guest| try normalizeMountGuest(guest) else null;

    const explicit = try resolveExplicitMemory(input);
    if (input.vmm_memory_preset) {
        return .{
            .memory_ceiling_mib = null,
            .vmm_memory_mib = null,
            .wants_root_disk = wants_root_disk,
            .normalized_mount_guest = normalized_mount_guest,
        };
    }

    const ceiling = explicit orelse input.auto_memory_mib orelse if (input.host_total_bytes) |bytes|
        autoSizeMemoryMib(bytes)
    else
        return error.MissingAutoMemory;
    return .{
        .memory_ceiling_mib = ceiling,
        .vmm_memory_mib = ceiling,
        .wants_root_disk = wants_root_disk,
        .normalized_mount_guest = normalized_mount_guest,
    };
}

pub fn validateGuestCwd(cwd: []const u8) PlanError!void {
    if (cwd.len == 0 or cwd[0] != '/') return error.InvalidGuestCwdAbsolute;
    if (std.mem.indexOfScalar(u8, cwd, 0) != null) return error.InvalidGuestCwdNul;
}

pub fn normalizeMountGuest(guest: []const u8) PlanError![]const u8 {
    if (guest.len == 0 or guest[0] != '/') return error.InvalidMountGuestAbsolute;
    var end = guest.len;
    while (end > 0 and guest[end - 1] == '/') : (end -= 1) {}
    const trimmed = guest[0..end];
    if (!std.mem.startsWith(u8, trimmed, "/mnt/") or std.mem.eql(u8, trimmed, "/mnt")) {
        return error.InvalidMountGuestRoot;
    }
    return trimmed;
}

fn isDecimal(text: []const u8) bool {
    if (text.len == 0) return false;
    for (text) |c| {
        if (c < '0' or c > '9') return false;
    }
    return true;
}

fn resolveExplicitMemory(input: Input) PlanError!?u64 {
    const alias_ceiling = if (input.memory_mib) |mib| try validateMemoryMib(mib) else null;
    const resource_ceiling = if (input.resources_memory) |memory| blk: {
        if (memory.reclaim) |reclaim| {
            if (!std.mem.eql(u8, reclaim, "auto")) return error.InvalidReclaim;
        }
        break :blk try validateMemoryMib(memory.max_mib);
    } else null;
    if (alias_ceiling != null and resource_ceiling != null and alias_ceiling.? != resource_ceiling.?) {
        return error.ConflictingMemory;
    }
    return resource_ceiling orelse alias_ceiling;
}

test "autoSizeMemoryMib applies floor, half-host, and default ceiling" {
    try std.testing.expectEqual(@as(u64, 4096), autoSizeMemoryMib(32 * 1024 * 1024 * 1024));
    try std.testing.expectEqual(@as(u64, 3072), autoSizeMemoryMib(6 * 1024 * 1024 * 1024));
    try std.testing.expectEqual(@as(u64, 512), autoSizeMemoryMib(256 * 1024 * 1024));
}

test "planCore resolves explicit memory aliases" {
    try std.testing.expectEqual(@as(?u64, 2048), (try planCore(.{
        .memory_mib = 2048,
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    })).memory_ceiling_mib);
    try std.testing.expectEqual(@as(?u64, 4096), (try planCore(.{
        .resources_memory = .{ .max_mib = 4096, .reclaim = "auto" },
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    })).memory_ceiling_mib);
    try std.testing.expectError(error.ConflictingMemory, planCore(.{
        .memory_mib = 1024,
        .resources_memory = .{ .max_mib = 2048, .reclaim = "auto" },
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    try std.testing.expectError(error.InvalidReclaim, planCore(.{
        .resources_memory = .{ .max_mib = 2048, .reclaim = "manual" },
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
}

test "planCore validates command and rootdisk image requirements" {
    try std.testing.expectError(error.CmdWithoutImage, planCore(.{
        .has_cmd = true,
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    try std.testing.expectError(error.RootDiskWithoutImage, planCore(.{
        .root_disk = .true_value,
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    try std.testing.expect((try planCore(.{
        .has_image = true,
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    })).wants_root_disk);
    try std.testing.expect(!(try planCore(.{
        .has_image = true,
        .root_disk = .false_value,
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    })).wants_root_disk);
}

test "planCore validates guest cwd and normalizes mount guest paths" {
    try std.testing.expectError(error.InvalidGuestCwdAbsolute, planCore(.{
        .guest_cwd = "relative/dir",
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    try std.testing.expectError(error.InvalidGuestCwdNul, planCore(.{
        .guest_cwd = "/mnt/work\x00space",
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    try std.testing.expectError(error.InvalidMountGuestAbsolute, planCore(.{
        .mount_guest = "mnt/app",
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    try std.testing.expectError(error.InvalidMountGuestRoot, planCore(.{
        .mount_guest = "/srv/app",
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    const plan = try planCore(.{
        .mount_guest = "/mnt/app///",
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    });
    try std.testing.expectEqualStrings("/mnt/app", plan.normalized_mount_guest.?);
}

test "validatePortForward rejects invalid and duplicate ports" {
    try std.testing.expectEqual(PortForwardValidation.ok, validatePortForward(&.{
        .{ .host_port = 8080, .guest_port = 3000 },
        .{ .host_port = 8081, .guest_port = 3001 },
    }));
    try std.testing.expectEqual(
        PortForwardValidation{ .invalid_host_port = 0 },
        validatePortForward(&.{.{ .host_port = 0, .guest_port = 3000 }}),
    );
    try std.testing.expectEqual(
        PortForwardValidation{ .invalid_guest_port = 70000 },
        validatePortForward(&.{.{ .host_port = 8080, .guest_port = 70000 }}),
    );
    try std.testing.expectEqual(
        PortForwardValidation{ .duplicate_host_port = 8080 },
        validatePortForward(&.{
            .{ .host_port = 8080, .guest_port = 3000 },
            .{ .host_port = 8080, .guest_port = 3001 },
        }),
    );
}

test "planVsock parses existing specs and formats auto specs" {
    try std.testing.expectEqualStrings(
        "/tmp/exec.sock",
        parseVsockUdsPath("in:1978:/tmp/exec.sock").?,
    );
    try std.testing.expectEqualStrings(
        "/tmp/first.sock",
        parseVsockUdsPath("out:1970:/tmp/first.sock,in:1978:/tmp/second.sock").?,
    );
    try std.testing.expectEqual(@as(?[]const u8, null), parseVsockUdsPath("in:not-a-port:/tmp/nope"));

    const existing = try planVsock(std.testing.allocator, .{ .existing_spec = "in:1978:/tmp/caller.sock" });
    try std.testing.expectEqualStrings("/tmp/caller.sock", existing.uds_path.?);
    try std.testing.expectEqual(@as(?[]const u8, null), existing.vmm_vsock);

    const auto = try planVsock(std.testing.allocator, .{ .auto_uds_path = "/tmp/auto.sock" });
    defer std.testing.allocator.free(auto.vmm_vsock.?);
    try std.testing.expectEqualStrings("/tmp/auto.sock", auto.uds_path.?);
    try std.testing.expectEqualStrings("in:1978:/tmp/auto.sock", auto.vmm_vsock.?);
}

test "planGuestEnv applies name and hostname wait defaults without overriding caller env" {
    const env = [_]EnvPair{.{ .key = "FOO", .value = "bar" }};
    const planned = try planGuestEnv(std.testing.allocator, .{
        .env = &env,
        .name = "worker",
        .vsock_uds_path = "/tmp/exec.sock",
    });
    defer std.testing.allocator.free(planned);
    try std.testing.expectEqual(@as(usize, 3), planned.len);
    try std.testing.expectEqualStrings("FOO", planned[0].key);
    try std.testing.expectEqualStrings("MACHINEN_VM_NAME", planned[1].key);
    try std.testing.expectEqualStrings("worker", planned[1].value);
    try std.testing.expectEqualStrings("MACHINEN_VM_HOSTNAME_WAIT", planned[2].key);
    try std.testing.expectEqualStrings("1", planned[2].value);

    const caller_env = [_]EnvPair{
        .{ .key = "MACHINEN_VM_NAME", .value = "caller" },
        .{ .key = "MACHINEN_VM_HOSTNAME_WAIT", .value = "0" },
    };
    const preserved = try planGuestEnv(std.testing.allocator, .{
        .env = &caller_env,
        .name = "worker",
        .vsock_uds_path = "/tmp/exec.sock",
    });
    defer std.testing.allocator.free(preserved);
    try std.testing.expectEqual(@as(usize, 2), preserved.len);
    try std.testing.expectEqualStrings("caller", preserved[0].value);
    try std.testing.expectEqualStrings("0", preserved[1].value);
}

test "planCore honors preset VMM memory after validating public input" {
    const plan = try planCore(.{
        .memory_mib = 1024,
        .vmm_memory_preset = true,
    });
    try std.testing.expectEqual(@as(?u64, null), plan.memory_ceiling_mib);
    try std.testing.expectEqual(@as(?u64, null), plan.vmm_memory_mib);
    try std.testing.expectError(error.InvalidMemory, planCore(.{
        .memory_mib = 64,
        .vmm_memory_preset = true,
    }));
}
