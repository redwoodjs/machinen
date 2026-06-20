const std = @import("std");
const runtime_helper = @import("runtime_helper");
const boot_plan = @import("../boot_plan.zig");
const protocol = @import("../protocol.zig");

pub const name = "boot-plan";

const ParsedRequest = struct {
    memory_mib_text: ?[]const u8,
    resources_memory: ?ParsedResourcesMemory,
    auto_memory_mib_text: ?[]const u8,
    host_total_bytes_text: ?[]const u8,
    vmm_memory_preset: bool,
    has_image: bool,
    has_cmd: bool,
    root_disk: boot_plan.RootDiskMode,
    guest_cwd: ?[]const u8,
    mount_guest: ?[]const u8,
    guest_env: std.json.ObjectMap,
    name: ?[]const u8,
    vsock_uds_path: ?[]const u8,
    existing_vsock_spec: ?[]const u8,
    auto_vsock_uds_path: ?[]const u8,
    port_forward: []const boot_plan.PortForwardMapping,
    vmm_binary: ?[]const u8,
    vmm_args: []const []const u8,
    pdeathsig_path: ?[]const u8,
};

const ParsedResourcesMemory = struct {
    max_mib_text: []const u8,
    reclaim: ?[]const u8,
};

const RequestError = error{
    MissingMemoryMib,
    InvalidMemoryMib,
    MissingResourcesMemory,
    InvalidResourcesMemory,
    MissingResourcesMaxMib,
    InvalidResourcesMaxMib,
    InvalidResourcesReclaim,
    MissingAutoMemoryMib,
    InvalidAutoMemoryMib,
    MissingHostTotalBytes,
    InvalidHostTotalBytes,
    MissingVmmMemoryPreset,
    InvalidVmmMemoryPreset,
    MissingHasImage,
    InvalidHasImage,
    MissingHasCmd,
    InvalidHasCmd,
    MissingRootDisk,
    InvalidRootDisk,
    InvalidGuestCwd,
    InvalidMountGuest,
    InvalidGuestEnv,
    InvalidGuestEnvValue,
    InvalidName,
    InvalidVsockUdsPath,
    InvalidExistingVsockSpec,
    InvalidAutoVsockUdsPath,
    InvalidPortForward,
    InvalidHostPort,
    InvalidGuestPort,
    InvalidVmmBinary,
    InvalidVmmArgs,
    InvalidPdeathsigPath,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const parsed = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const input = makePlanInput(allocator, io, parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };

    const plan = boot_plan.planCore(input) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    switch (boot_plan.validatePortForward(parsed.port_forward)) {
        .ok => {},
        .invalid_host_port => |port| {
            try writePortForwardInvalid(io, "hostPort", port);
            return .fail;
        },
        .invalid_guest_port => |port| {
            try writePortForwardInvalid(io, "guestPort", port);
            return .fail;
        },
        .duplicate_host_port => |port| {
            try writeDuplicateHostPort(io, port);
            return .fail;
        },
    }
    const vsock_plan = try boot_plan.planVsock(arena, .{
        .existing_spec = parsed.existing_vsock_spec,
        .auto_uds_path = parsed.auto_vsock_uds_path,
    });
    const guest_env = makeGuestEnv(arena, parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const vmm_argv = try boot_plan.planVmmArgv(arena, .{
        .binary = parsed.vmm_binary,
        .args = parsed.vmm_args,
        .pdeathsig_path = parsed.pdeathsig_path,
    });

    try writePlan(io, plan, guest_env, vsock_plan, vmm_argv);
    return .ok;
}

fn writePlan(
    io: std.Io,
    plan: boot_plan.Plan,
    guest_env: []const boot_plan.EnvPair,
    vsock_plan: boot_plan.VsockPlan,
    vmm_argv: boot_plan.VmmArgvPlan,
) !void {
    try protocol.stdout(io, "{\"ok\":true,\"protocolVersion\":1,\"command\":\"boot-plan\",\"data\":{");
    try protocol.stdout(io, "\"memoryCeilingMib\":");
    if (plan.memory_ceiling_mib) |mib| {
        var buf: [32]u8 = undefined;
        try protocol.stdout(io, try std.fmt.bufPrint(&buf, "{d}", .{mib}));
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmMemory\":");
    if (plan.vmm_memory_mib) |mib| {
        var buf: [32]u8 = undefined;
        try protocol.writeJsonString(io, try std.fmt.bufPrint(&buf, "{d}", .{mib}));
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"wantsRootDisk\":");
    try protocol.stdout(io, if (plan.wants_root_disk) "true" else "false");
    try protocol.stdout(io, ",\"normalizedMountGuest\":");
    if (plan.normalized_mount_guest) |guest| {
        try protocol.writeJsonString(io, guest);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vsockUdsPath\":");
    if (vsock_plan.uds_path) |path| {
        try protocol.writeJsonString(io, path);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmVsock\":");
    if (vsock_plan.vmm_vsock) |spec| {
        try protocol.writeJsonString(io, spec);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmCommand\":");
    if (vmm_argv.command) |command| {
        try protocol.writeJsonString(io, command);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmArgs\":[");
    for (vmm_argv.args, 0..) |arg, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, arg);
    }
    try protocol.stdout(io, "]");
    try protocol.stdout(io, ",\"mergedGuestEnv\":{");
    for (guest_env, 0..) |pair, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, pair.key);
        try protocol.stdout(io, ":");
        try protocol.writeJsonString(io, pair.value);
    }
    try protocol.stdout(io, "}}}\n");
}

fn makeGuestEnv(allocator: std.mem.Allocator, parsed: ParsedRequest) ![]boot_plan.EnvPair {
    var pairs: std.ArrayList(boot_plan.EnvPair) = .empty;
    errdefer pairs.deinit(allocator);
    var it = parsed.guest_env.iterator();
    while (it.next()) |entry| {
        if (entry.value_ptr.* != .string) return error.InvalidGuestEnvValue;
        try pairs.append(allocator, .{ .key = entry.key_ptr.*, .value = entry.value_ptr.string });
    }
    const env_pairs = try pairs.toOwnedSlice(allocator);
    return boot_plan.planGuestEnv(allocator, .{
        .env = env_pairs,
        .name = parsed.name,
        .vsock_uds_path = parsed.vsock_uds_path,
    });
}

fn makePlanInput(allocator: std.mem.Allocator, io: std.Io, parsed: ParsedRequest) anyerror!boot_plan.Input {
    const explicit_memory = if (parsed.memory_mib_text) |text| try parseMib(text) else null;
    const resources_memory = if (parsed.resources_memory) |memory| boot_plan.ResourcesMemory{
        .max_mib = try parseMib(memory.max_mib_text),
        .reclaim = memory.reclaim,
    } else null;
    const auto_memory = if (parsed.auto_memory_mib_text) |text| try parseMib(text) else null;
    const host_total_bytes = if (parsed.host_total_bytes_text) |text|
        parseUnsigned(text) catch return error.InvalidMemory
    else if (explicit_memory == null and resources_memory == null and auto_memory == null and !parsed.vmm_memory_preset)
        (try runtime_helper.host.readHostMemory(allocator, io)).total_bytes
    else
        null;
    return .{
        .memory_mib = explicit_memory,
        .resources_memory = resources_memory,
        .auto_memory_mib = auto_memory,
        .host_total_bytes = host_total_bytes,
        .vmm_memory_preset = parsed.vmm_memory_preset,
        .has_image = parsed.has_image,
        .has_cmd = parsed.has_cmd,
        .root_disk = parsed.root_disk,
        .guest_cwd = parsed.guest_cwd,
        .mount_guest = parsed.mount_guest,
    };
}

fn parseMib(text: []const u8) boot_plan.PlanError!u64 {
    const value = parseUnsigned(text) catch return error.InvalidMemory;
    return boot_plan.validateMemoryMib(value);
}

fn parseUnsigned(text: []const u8) !u64 {
    if (text.len == 0) return error.Invalid;
    for (text) |c| {
        if (c < '0' or c > '9') return error.Invalid;
    }
    return std.fmt.parseUnsigned(u64, text, 10);
}

fn parseRequest(allocator: std.mem.Allocator, io: std.Io) RequestError!ParsedRequest {
    const data = try protocol.readStdinAll(allocator, io, protocol.max_request_bytes);
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, data, .{
        .duplicate_field_behavior = .@"error",
        .ignore_unknown_fields = false,
        .max_value_len = data.len,
        .allocate = .alloc_if_needed,
        .parse_numbers = true,
    }) catch return error.InvalidJson;
    const request_value = parsed.value;
    if (request_value != .object) return error.InvalidShape;
    const envelope = request_value.object;
    try protocol.rejectUnknownFields(envelope, &.{ "protocolVersion", "data" });
    const protocol_version = envelope.get("protocolVersion") orelse return error.UnsupportedProtocolVersion;
    if (protocol_version != .integer or protocol_version.integer != protocol.version) return error.UnsupportedProtocolVersion;
    const data_value = envelope.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    const object = data_value.object;
    try protocol.rejectUnknownFields(object, &.{ "memoryMib", "resourcesMemory", "autoMemoryMib", "hostTotalBytes", "vmmMemoryPreset", "hasImage", "hasCmd", "rootDisk", "guestCwd", "mountGuest", "guestEnv", "name", "vsockUdsPath", "existingVsockSpec", "autoVsockUdsPath", "portForward", "vmmBinary", "vmmArgs", "pdeathsigPath" });
    return .{
        .memory_mib_text = try optionalString(object, "memoryMib", error.MissingMemoryMib, error.InvalidMemoryMib),
        .resources_memory = try optionalResourcesMemory(object),
        .auto_memory_mib_text = try optionalString(object, "autoMemoryMib", error.MissingAutoMemoryMib, error.InvalidAutoMemoryMib),
        .host_total_bytes_text = try optionalString(object, "hostTotalBytes", error.MissingHostTotalBytes, error.InvalidHostTotalBytes),
        .vmm_memory_preset = try requiredBool(object, "vmmMemoryPreset", error.MissingVmmMemoryPreset, error.InvalidVmmMemoryPreset),
        .has_image = try requiredBool(object, "hasImage", error.MissingHasImage, error.InvalidHasImage),
        .has_cmd = try requiredBool(object, "hasCmd", error.MissingHasCmd, error.InvalidHasCmd),
        .root_disk = try requiredRootDisk(object),
        .guest_cwd = try optionalStringDefaultNull(object, "guestCwd", error.InvalidGuestCwd),
        .mount_guest = try optionalStringDefaultNull(object, "mountGuest", error.InvalidMountGuest),
        .guest_env = try optionalObjectDefaultEmpty(object, "guestEnv", error.InvalidGuestEnv),
        .name = try optionalStringDefaultNull(object, "name", error.InvalidName),
        .vsock_uds_path = try optionalStringDefaultNull(object, "vsockUdsPath", error.InvalidVsockUdsPath),
        .existing_vsock_spec = try optionalStringDefaultNull(object, "existingVsockSpec", error.InvalidExistingVsockSpec),
        .auto_vsock_uds_path = try optionalStringDefaultNull(object, "autoVsockUdsPath", error.InvalidAutoVsockUdsPath),
        .port_forward = try optionalPortForward(allocator, object),
        .vmm_binary = try optionalStringDefaultNull(object, "vmmBinary", error.InvalidVmmBinary),
        .vmm_args = try optionalStringArrayDefaultEmpty(allocator, object, "vmmArgs", error.InvalidVmmArgs),
        .pdeathsig_path = try optionalStringDefaultNull(object, "pdeathsigPath", error.InvalidPdeathsigPath),
    };
}

fn optionalStringArrayDefaultEmpty(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError![]const []const u8 {
    const value = object.get(field) orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return invalid;
    var out: std.ArrayList([]const u8) = .empty;
    errdefer out.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .string) return invalid;
        try out.append(allocator, item.string);
    }
    return out.toOwnedSlice(allocator);
}

fn optionalPortForward(allocator: std.mem.Allocator, object: std.json.ObjectMap) RequestError![]const boot_plan.PortForwardMapping {
    const value = object.get("portForward") orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return error.InvalidPortForward;
    var mappings: std.ArrayList(boot_plan.PortForwardMapping) = .empty;
    errdefer mappings.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .object) return error.InvalidPortForward;
        try protocol.rejectUnknownFields(item.object, &.{ "hostPort", "guestPort", "hostAddr" });
        const host_port = try requiredPort(item.object, "hostPort", error.InvalidHostPort);
        const guest_port = try requiredPort(item.object, "guestPort", error.InvalidGuestPort);
        const host_addr = item.object.get("hostAddr") orelse .null;
        if (host_addr != .null and host_addr != .string) return error.InvalidPortForward;
        try mappings.append(allocator, .{ .host_port = host_port, .guest_port = guest_port });
    }
    return mappings.toOwnedSlice(allocator);
}

fn requiredPort(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!i64 {
    const value = object.get(field) orelse return invalid;
    return switch (value) {
        .integer => |i| i,
        else => invalid,
    };
}

fn optionalString(object: std.json.ObjectMap, field: []const u8, missing: RequestError, invalid: RequestError) RequestError!?[]const u8 {
    const value = object.get(field) orelse return missing;
    return switch (value) {
        .null => null,
        .string => |s| s,
        else => invalid,
    };
}

fn optionalObjectDefaultEmpty(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!std.json.ObjectMap {
    const value = object.get(field) orelse return .{};
    return switch (value) {
        .object => |o| o,
        else => invalid,
    };
}

fn optionalStringDefaultNull(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!?[]const u8 {
    const value = object.get(field) orelse return null;
    return switch (value) {
        .null => null,
        .string => |s| s,
        else => invalid,
    };
}

fn requiredBool(object: std.json.ObjectMap, field: []const u8, missing: RequestError, invalid: RequestError) RequestError!bool {
    const value = object.get(field) orelse return missing;
    return switch (value) {
        .bool => |b| b,
        else => invalid,
    };
}

fn optionalResourcesMemory(object: std.json.ObjectMap) RequestError!?ParsedResourcesMemory {
    const value = object.get("resourcesMemory") orelse return error.MissingResourcesMemory;
    if (value == .null) return null;
    if (value != .object) return error.InvalidResourcesMemory;
    try protocol.rejectUnknownFields(value.object, &.{ "maxMib", "reclaim" });
    const max_mib = value.object.get("maxMib") orelse return error.MissingResourcesMaxMib;
    if (max_mib != .string) return error.InvalidResourcesMaxMib;
    const reclaim = value.object.get("reclaim") orelse .null;
    if (reclaim != .null and reclaim != .string) return error.InvalidResourcesReclaim;
    return .{
        .max_mib_text = max_mib.string,
        .reclaim = if (reclaim == .string) reclaim.string else null,
    };
}

fn requiredRootDisk(object: std.json.ObjectMap) RequestError!boot_plan.RootDiskMode {
    const value = object.get("rootDisk") orelse return error.MissingRootDisk;
    if (value != .string) return error.InvalidRootDisk;
    if (std.mem.eql(u8, value.string, "unset")) return .unset;
    if (std.mem.eql(u8, value.string, "false")) return .false_value;
    if (std.mem.eql(u8, value.string, "path")) return .path;
    if (std.mem.eql(u8, value.string, "true")) return .true_value;
    return error.InvalidRootDisk;
}

fn writePortForwardInvalid(io: std.Io, label: []const u8, port: i64) !void {
    var buf: [256]u8 = undefined;
    try protocol.writeError(
        io,
        "BOOT_PORT_FORWARD_INVALID",
        try std.fmt.bufPrint(&buf, "portForward: {s} must be an integer in 1..65535 (got {d})", .{ label, port }),
    );
}

fn writeDuplicateHostPort(io: std.Io, port: u16) !void {
    var buf: [128]u8 = undefined;
    try protocol.writeError(
        io,
        "BOOT_PORT_FORWARD_CONFLICT",
        try std.fmt.bufPrint(&buf, "portForward: duplicate hostPort {d}", .{port}),
    );
}

fn writePlanError(io: std.Io, err: anyerror) !void {
    switch (err) {
        error.InvalidMemory => try protocol.writeError(io, "BOOT_MEMORY_INVALID", "boot: memory must be a positive integer at least 512 MiB"),
        error.ConflictingMemory => try protocol.writeError(io, "BOOT_MEMORY_INVALID", "boot: memory conflicts with resources.memory.maxMib. Use one value."),
        error.InvalidReclaim => try protocol.writeError(io, "BOOT_MEMORY_INVALID", "boot: resources.memory.reclaim must be \"auto\" when set."),
        error.CmdWithoutImage => try protocol.writeError(io, "BOOT_CMD_WITHOUT_IMAGE", "boot: `image` is required when `cmd` is set."),
        error.RootDiskWithoutImage => try protocol.writeError(io, "BOOT_CMD_WITHOUT_IMAGE", "boot: rootDisk: true requires an `image` (the .tar.gz to materialize)."),
        error.MissingAutoMemory => try protocol.writeError(io, "BOOT_MEMORY_INVALID", "boot: memory auto-size input is missing"),
        error.InvalidGuestCwdAbsolute => try protocol.writeError(io, "BOOT_CWD_INVALID", "guestCwd must be an absolute path"),
        error.InvalidGuestCwdNul => try protocol.writeError(io, "BOOT_CWD_INVALID", "guestCwd must not contain NUL bytes"),
        error.InvalidMountGuestAbsolute => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "mount guest path must be absolute"),
        error.InvalidMountGuestRoot => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "mount guest path must live under /mnt/"),
        error.UnsupportedHostMemory => try protocol.writeError(io, "BOOT_MEMORY_INVALID", "boot: host memory probing is unsupported on this platform"),
        error.InvalidGuestEnvValue => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan guestEnv values must be strings"),
        else => try protocol.writeError(io, "BOOT_MEMORY_INVALID", @errorName(err)),
    }
}

fn writeRequestError(io: std.Io, err: RequestError) !void {
    switch (err) {
        error.RequestTooLarge => try protocol.writeError(io, "REQUEST_TOO_LARGE", "request JSON exceeds the maximum size"),
        error.UnknownField => try protocol.writeError(io, "UNKNOWN_FIELD", "request contains an unknown field"),
        error.UnsupportedProtocolVersion => try protocol.writeError(io, "UNSUPPORTED_PROTOCOL_VERSION", "request protocolVersion must be 1"),
        error.MissingData => try protocol.writeError(io, "INVALID_REQUEST", "request must include a data object"),
        error.InvalidData => try protocol.writeError(io, "INVALID_REQUEST", "request data field must be an object"),
        error.InvalidJson => try protocol.writeError(io, "INVALID_JSON", "request body is not valid JSON"),
        error.InvalidShape => try protocol.writeError(io, "INVALID_REQUEST", "request body must be a JSON object"),
        error.InvalidPortForward, error.InvalidHostPort, error.InvalidGuestPort => try protocol.writeError(io, "BOOT_PORT_FORWARD_INVALID", "portForward: hostPort and guestPort must be integers in 1..65535"),
        else => try protocol.writeError(io, "INVALID_REQUEST", @errorName(err)),
    }
}
