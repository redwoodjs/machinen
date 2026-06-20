const std = @import("std");
const runtime_helper = @import("runtime_helper");
const boot_plan = @import("../boot_plan.zig");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;

pub const name = "boot-plan";

const ParsedRequest = struct {
    memory_mib_text: ?[]const u8 = null,
    resources_memory: ?ParsedResourcesMemory = null,
    auto_memory_mib_text: ?[]const u8 = null,
    host_total_bytes_text: ?[]const u8 = null,
    vmm_memory_preset: bool = false,
    has_image: bool = false,
    has_cmd: bool = false,
    root_disk: boot_plan.RootDiskMode = .unset,
    guest_cwd: ?[]const u8 = null,
    mount_guest: ?[]const u8 = null,
    guest_env: std.json.ObjectMap = .{},
    name: ?[]const u8 = null,
    vsock_uds_path: ?[]const u8 = null,
    existing_vsock_spec: ?[]const u8 = null,
    auto_vsock_uds_path: ?[]const u8 = null,
    port_forward: []const boot_plan.PortForwardMapping = &.{},
    vmm_binary: ?[]const u8 = null,
    vmm_args: []const []const u8 = &.{},
    pdeathsig_path: ?[]const u8 = null,
    kernel_path: ?[]const u8 = null,
    dtb_path: ?[]const u8 = null,
    vmstate_path: ?[]const u8 = null,
    restore_path: ?[]const u8 = null,
    enable_vmstate_timing: bool = false,
    existing_vmstate_timing: ?[]const u8 = null,
    live_mounts: []const boot_plan.LiveMountInput = &.{},
    live_mounts_resolved: []const boot_plan.LiveMount = &.{},
    existing_stats_file: ?[]const u8 = null,
    stats_file_path: ?[]const u8 = null,
};

const ParsedResourcesMemory = struct {
    max_mib_text: []const u8,
    reclaim: ?[]const u8,
};

const boot_plan_fields = [_][]const u8{
    "memoryMib",
    "resourcesMemory",
    "autoMemoryMib",
    "hostTotalBytes",
    "vmmMemoryPreset",
    "hasImage",
    "hasCmd",
    "rootDisk",
    "guestCwd",
    "mountGuest",
    "guestEnv",
    "name",
    "vsockUdsPath",
    "existingVsockSpec",
    "autoVsockUdsPath",
    "portForward",
    "vmmBinary",
    "vmmArgs",
    "pdeathsigPath",
    "kernelPath",
    "dtbPath",
    "vmstatePath",
    "restorePath",
    "enableVmstateTiming",
    "existingVmstateTiming",
    "liveMounts",
    "liveMountsResolved",
    "existingStatsFile",
    "statsFilePath",
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
    InvalidKernelPath,
    InvalidDtbPath,
    InvalidVmstatePath,
    InvalidRestorePath,
    InvalidEnableVmstateTiming,
    InvalidExistingVmstateTiming,
    InvalidLiveMounts,
    InvalidLiveMountGuest,
    InvalidLiveMountsResolved,
    InvalidLiveMountHost,
    InvalidLiveMountMode,
    InvalidLiveMountTag,
    InvalidExistingStatsFile,
    InvalidStatsFilePath,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    assert(name.len > 0);

    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const parsed = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const plan = makeCorePlan(allocator, io, parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    if (try writePortForwardFailure(io, parsed.port_forward)) return .fail;

    const parts = makePlanParts(arena, parsed, plan) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    try writePlan(io, parts);
    return .ok;
}

const PlanParts = struct {
    plan: boot_plan.Plan,
    guest_env: []const boot_plan.EnvPair,
    vsock_plan: boot_plan.VsockPlan,
    vmm_argv: boot_plan.VmmArgvPlan,
    kernel_dtb: boot_plan.KernelDtbPlan,
    vmstate_env: boot_plan.VmstateEnvPlan,
    virtiofs_env: []const boot_plan.EnvPair,
    stats_file: boot_plan.StatsFilePlan,
    planned_live_mounts: []const boot_plan.LiveMount,
};

fn makeCorePlan(
    helper_allocator: std.mem.Allocator,
    io: std.Io,
    parsed: ParsedRequest,
) !boot_plan.Plan {
    assert(@sizeOf(boot_plan.Plan) > 0);

    const input = try makePlanInput(helper_allocator, io, parsed);
    return boot_plan.planCore(input);
}

fn makePlanParts(
    arena: std.mem.Allocator,
    parsed: ParsedRequest,
    plan: boot_plan.Plan,
) !PlanParts {
    assert(@sizeOf(PlanParts) > 0);

    const vsock_plan = try boot_plan.planVsock(arena, .{
        .existing_spec = parsed.existing_vsock_spec,
        .auto_uds_path = parsed.auto_vsock_uds_path,
    });
    const guest_env = try makeGuestEnv(arena, parsed);
    const vmm_argv = try boot_plan.planVmmArgv(arena, .{
        .binary = parsed.vmm_binary,
        .args = parsed.vmm_args,
        .pdeathsig_path = parsed.pdeathsig_path,
    });
    const kernel_dtb = boot_plan.planKernelDtb(.{
        .kernel_path = parsed.kernel_path,
        .dtb_path = parsed.dtb_path,
    });
    const vmstate_env = boot_plan.planVmstateEnv(.{
        .state_path = parsed.vmstate_path,
        .restore_path = parsed.restore_path,
        .enable_timing = parsed.enable_vmstate_timing,
        .existing_timing = parsed.existing_vmstate_timing,
    });
    const planned_live_mounts = try boot_plan.planLiveMounts(arena, parsed.live_mounts);
    const virtiofs_env = try boot_plan.planVirtiofsEnv(arena, parsed.live_mounts_resolved);
    const stats_file = boot_plan.planStatsFile(.{
        .existing_path = parsed.existing_stats_file,
        .planned_path = parsed.stats_file_path,
    });
    return .{
        .plan = plan,
        .guest_env = guest_env,
        .vsock_plan = vsock_plan,
        .vmm_argv = vmm_argv,
        .kernel_dtb = kernel_dtb,
        .vmstate_env = vmstate_env,
        .virtiofs_env = virtiofs_env,
        .stats_file = stats_file,
        .planned_live_mounts = planned_live_mounts,
    };
}

fn writePortForwardFailure(
    io: std.Io,
    mappings: []const boot_plan.PortForwardMapping,
) !bool {
    assert(@sizeOf(boot_plan.PortForwardMapping) > 0);

    switch (boot_plan.validatePortForward(mappings)) {
        .ok => return false,
        .invalid_host_port => |port| try writePortForwardInvalid(io, "hostPort", port),
        .invalid_guest_port => |port| try writePortForwardInvalid(io, "guestPort", port),
        .duplicate_host_port => |port| try writeDuplicateHostPort(io, port),
    }
    return true;
}

fn writePlan(io: std.Io, parts: PlanParts) !void {
    assert(@sizeOf(PlanParts) > 0);

    try protocol.stdout(io, "{\"ok\":true,\"protocolVersion\":1,");
    try protocol.stdout(io, "\"command\":\"boot-plan\",\"data\":{");
    try writeCoreFields(io, parts.plan);
    try writeVsockKernelFields(io, parts.vsock_plan, parts.kernel_dtb);
    try writeVmstateStatsFields(io, parts.vmstate_env, parts.stats_file);
    try writeLiveMountsArrayField(io, "plannedLiveMounts", parts.planned_live_mounts, true);
    try writeEnvObjectField(io, "virtiofsEnv", parts.virtiofs_env, true);
    try writeNullableStringField(io, "vmmCommand", parts.vmm_argv.command, true);
    try writeStringArrayField(io, "vmmArgs", parts.vmm_argv.args, true);
    try writeEnvObjectField(io, "mergedGuestEnv", parts.guest_env, true);
    try protocol.stdout(io, "}}\n");
}

fn writeCoreFields(io: std.Io, plan: boot_plan.Plan) !void {
    assert(@sizeOf(boot_plan.Plan) > 0);

    try writeNullableU64Field(io, "memoryCeilingMib", plan.memory_ceiling_mib, false);
    try writeNullableU64StringField(io, "vmmMemory", plan.vmm_memory_mib, true);
    try writeBoolField(io, "wantsRootDisk", plan.wants_root_disk, true);
    try writeNullableStringField(
        io,
        "normalizedMountGuest",
        plan.normalized_mount_guest,
        true,
    );
}

fn writeVsockKernelFields(
    io: std.Io,
    vsock_plan: boot_plan.VsockPlan,
    kernel_dtb: boot_plan.KernelDtbPlan,
) !void {
    assert(@sizeOf(boot_plan.VsockPlan) > 0);

    try writeNullableStringField(io, "vsockUdsPath", vsock_plan.uds_path, true);
    try writeNullableStringField(io, "vmmVsock", vsock_plan.vmm_vsock, true);
    try writeNullableStringField(io, "vmmKernel", kernel_dtb.vmm_kernel, true);
    try writeNullableStringField(io, "vmmDtb", kernel_dtb.vmm_dtb, true);
}

fn writeVmstateStatsFields(
    io: std.Io,
    vmstate_env: boot_plan.VmstateEnvPlan,
    stats_file: boot_plan.StatsFilePlan,
) !void {
    assert(@sizeOf(boot_plan.VmstateEnvPlan) > 0);

    try writeNullableStringField(io, "vmmSnapshotPath", vmstate_env.snapshot_path, true);
    try writeNullableStringField(io, "vmmRestorePath", vmstate_env.restore_path, true);
    try writeNullableStringField(io, "vmmVmstateTiming", vmstate_env.vmstate_timing, true);
    try writeNullableStringField(io, "statsFilePath", stats_file.stats_file_path, true);
    try writeNullableStringField(io, "vmmStatsFile", stats_file.vmm_stats_file, true);
}

fn writeFieldName(io: std.Io, comptime field: []const u8, comma: bool) !void {
    assert(field.len > 0);

    if (comma) try protocol.stdout(io, ",");
    try protocol.writeJsonString(io, field);
    try protocol.stdout(io, ":");
}

fn writeNullableU64Field(
    io: std.Io,
    comptime field: []const u8,
    value: ?u64,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (value) |number| {
        var buf: [32]u8 = undefined;
        try protocol.stdout(io, try std.fmt.bufPrint(&buf, "{d}", .{number}));
    } else {
        try protocol.stdout(io, "null");
    }
}

fn writeNullableU64StringField(
    io: std.Io,
    comptime field: []const u8,
    value: ?u64,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (value) |number| {
        var buf: [32]u8 = undefined;
        try protocol.writeJsonString(io, try std.fmt.bufPrint(&buf, "{d}", .{number}));
    } else {
        try protocol.stdout(io, "null");
    }
}

fn writeNullableStringField(
    io: std.Io,
    comptime field: []const u8,
    value: ?[]const u8,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (value) |text| {
        try protocol.writeJsonString(io, text);
    } else {
        try protocol.stdout(io, "null");
    }
}

fn writeBoolField(
    io: std.Io,
    comptime field: []const u8,
    value: bool,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, if (value) "true" else "false");
}

fn writeLiveMountsArrayField(
    io: std.Io,
    comptime field: []const u8,
    mounts: []const boot_plan.LiveMount,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "[");
    for (mounts, 0..) |mount, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.stdout(io, "{\"host\":");
        try protocol.writeJsonString(io, mount.host);
        try protocol.stdout(io, ",\"guest\":");
        try protocol.writeJsonString(io, mount.guest);
        try protocol.stdout(io, ",\"mode\":");
        try protocol.writeJsonString(io, mount.mode);
        try protocol.stdout(io, ",\"tag\":");
        try protocol.writeJsonString(io, mount.tag);
        try protocol.stdout(io, "}");
    }
    try protocol.stdout(io, "]");
}

fn writeEnvObjectField(
    io: std.Io,
    comptime field: []const u8,
    pairs: []const boot_plan.EnvPair,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    for (pairs, 0..) |pair, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, pair.key);
        try protocol.stdout(io, ":");
        try protocol.writeJsonString(io, pair.value);
    }
    try protocol.stdout(io, "}");
}

fn writeStringArrayField(
    io: std.Io,
    comptime field: []const u8,
    values: []const []const u8,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "[");
    for (values, 0..) |value, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, value);
    }
    try protocol.stdout(io, "]");
}

fn makeGuestEnv(allocator: std.mem.Allocator, parsed: ParsedRequest) ![]boot_plan.EnvPair {
    assert(@sizeOf(ParsedRequest) > 0);

    var pairs: std.array_list.Aligned(boot_plan.EnvPair, null) = .empty;
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

fn makePlanInput(
    allocator: std.mem.Allocator,
    io: std.Io,
    parsed: ParsedRequest,
) anyerror!boot_plan.Input {
    assert(@sizeOf(boot_plan.Input) > 0);

    const explicit_memory = if (parsed.memory_mib_text) |text| try parseMib(text) else null;
    const resources_memory = if (parsed.resources_memory) |memory| boot_plan.ResourcesMemory{
        .max_mib = try parseMib(memory.max_mib_text),
        .reclaim = memory.reclaim,
    } else null;
    const auto_memory = if (parsed.auto_memory_mib_text) |text| try parseMib(text) else null;
    const should_probe_host = explicit_memory == null and
        resources_memory == null and
        auto_memory == null and
        !parsed.vmm_memory_preset;
    const probed_host_bytes = if (should_probe_host)
        (try runtime_helper.host.readHostMemory(allocator, io)).total_bytes
    else
        null;
    const host_total_bytes = if (parsed.host_total_bytes_text) |text|
        parseUnsigned(text) catch return error.InvalidMemory
    else
        probed_host_bytes;
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
    assert(@sizeOf(u64) > 0);

    const value = parseUnsigned(text) catch return error.InvalidMemory;
    return boot_plan.validateMemoryMib(value);
}

fn parseUnsigned(text: []const u8) !u64 {
    assert(@sizeOf(u64) > 0);

    if (text.len == 0) return error.Invalid;
    for (text) |c| {
        if (c < '0' or c > '9') return error.Invalid;
    }
    return std.fmt.parseUnsigned(u64, text, 10);
}

fn parseRequest(allocator: std.mem.Allocator, io: std.Io) RequestError!ParsedRequest {
    assert(protocol.version == 1);

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
    try protocol.requireProtocolVersion(envelope);
    const data_value = envelope.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    return parseRequestObject(allocator, data_value.object);
}

fn parseRequestObject(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
) RequestError!ParsedRequest {
    assert(boot_plan_fields.len > 0);

    try protocol.rejectUnknownFields(object, &boot_plan_fields);
    var request: ParsedRequest = .{};
    try parseMemoryFields(object, &request);
    try parseBootShapeFields(object, &request);
    try parseTransportFields(allocator, object, &request);
    try parseKernelVmstateFields(allocator, object, &request);
    return request;
}

fn parseMemoryFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.memory_mib_text = try optionalString(
        object,
        "memoryMib",
        error.MissingMemoryMib,
        error.InvalidMemoryMib,
    );
    request.resources_memory = try optionalResourcesMemory(object);
    request.auto_memory_mib_text = try optionalString(
        object,
        "autoMemoryMib",
        error.MissingAutoMemoryMib,
        error.InvalidAutoMemoryMib,
    );
    request.host_total_bytes_text = try optionalString(
        object,
        "hostTotalBytes",
        error.MissingHostTotalBytes,
        error.InvalidHostTotalBytes,
    );
    request.vmm_memory_preset = try requiredBool(
        object,
        "vmmMemoryPreset",
        error.MissingVmmMemoryPreset,
        error.InvalidVmmMemoryPreset,
    );
}

fn parseBootShapeFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.has_image = try requiredBool(
        object,
        "hasImage",
        error.MissingHasImage,
        error.InvalidHasImage,
    );
    request.has_cmd = try requiredBool(object, "hasCmd", error.MissingHasCmd, error.InvalidHasCmd);
    request.root_disk = try requiredRootDisk(object);
    request.guest_cwd = try optionalStringDefaultNull(
        object,
        "guestCwd",
        error.InvalidGuestCwd,
    );
    request.mount_guest = try optionalStringDefaultNull(
        object,
        "mountGuest",
        error.InvalidMountGuest,
    );
    request.guest_env = try optionalObjectDefaultEmpty(object, "guestEnv", error.InvalidGuestEnv);
    request.name = try optionalStringDefaultNull(object, "name", error.InvalidName);
}

fn parseTransportFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.vsock_uds_path = try optionalStringDefaultNull(
        object,
        "vsockUdsPath",
        error.InvalidVsockUdsPath,
    );
    request.existing_vsock_spec = try optionalStringDefaultNull(
        object,
        "existingVsockSpec",
        error.InvalidExistingVsockSpec,
    );
    request.auto_vsock_uds_path = try optionalStringDefaultNull(
        object,
        "autoVsockUdsPath",
        error.InvalidAutoVsockUdsPath,
    );
    request.port_forward = try optionalPortForward(allocator, object);
    request.vmm_binary = try optionalStringDefaultNull(object, "vmmBinary", error.InvalidVmmBinary);
    request.vmm_args = try optionalStringArrayDefaultEmpty(
        allocator,
        object,
        "vmmArgs",
        error.InvalidVmmArgs,
    );
    request.pdeathsig_path = try optionalStringDefaultNull(
        object,
        "pdeathsigPath",
        error.InvalidPdeathsigPath,
    );
}

fn parseKernelVmstateFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.kernel_path = try optionalStringDefaultNull(
        object,
        "kernelPath",
        error.InvalidKernelPath,
    );
    request.dtb_path = try optionalStringDefaultNull(object, "dtbPath", error.InvalidDtbPath);
    request.vmstate_path = try optionalStringDefaultNull(
        object,
        "vmstatePath",
        error.InvalidVmstatePath,
    );
    request.restore_path = try optionalStringDefaultNull(
        object,
        "restorePath",
        error.InvalidRestorePath,
    );
    request.enable_vmstate_timing = try optionalBoolDefaultFalse(
        object,
        "enableVmstateTiming",
        error.InvalidEnableVmstateTiming,
    );
    request.existing_vmstate_timing = try optionalStringDefaultNull(
        object,
        "existingVmstateTiming",
        error.InvalidExistingVmstateTiming,
    );
    request.live_mounts = try optionalLiveMounts(allocator, object);
    request.live_mounts_resolved = try optionalLiveMountsResolved(allocator, object);
    request.existing_stats_file = try optionalStringDefaultNull(
        object,
        "existingStatsFile",
        error.InvalidExistingStatsFile,
    );
    request.stats_file_path = try optionalStringDefaultNull(
        object,
        "statsFilePath",
        error.InvalidStatsFilePath,
    );
}

fn optionalLiveMounts(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
) RequestError![]const boot_plan.LiveMountInput {
    assert(@sizeOf(boot_plan.LiveMountInput) > 0);

    const value = object.get("liveMounts") orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return error.InvalidLiveMounts;
    var mounts: std.array_list.Aligned(boot_plan.LiveMountInput, null) = .empty;
    errdefer mounts.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .object) return error.InvalidLiveMounts;
        try protocol.rejectUnknownFields(item.object, &.{ "host", "guest", "mode" });
        const host = item.object.get("host") orelse return error.InvalidLiveMountHost;
        const guest = item.object.get("guest") orelse return error.InvalidLiveMountGuest;
        const mode = item.object.get("mode") orelse .null;
        if (host != .string) return error.InvalidLiveMountHost;
        if (guest != .string) return error.InvalidLiveMountGuest;
        if (mode != .null and mode != .string) return error.InvalidLiveMountMode;
        try mounts.append(allocator, .{
            .host = host.string,
            .guest = guest.string,
            .mode = if (mode == .string) mode.string else null,
        });
    }
    return mounts.toOwnedSlice(allocator);
}

fn optionalLiveMountsResolved(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
) RequestError![]const boot_plan.LiveMount {
    assert(@sizeOf(boot_plan.LiveMount) > 0);

    const value = object.get("liveMountsResolved") orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return error.InvalidLiveMountsResolved;
    var mounts: std.array_list.Aligned(boot_plan.LiveMount, null) = .empty;
    errdefer mounts.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .object) return error.InvalidLiveMountsResolved;
        try protocol.rejectUnknownFields(item.object, &.{ "host", "guest", "mode", "tag" });
        const host = item.object.get("host") orelse return error.InvalidLiveMountHost;
        const guest = item.object.get("guest") orelse return error.InvalidLiveMountGuest;
        const mode = item.object.get("mode") orelse return error.InvalidLiveMountMode;
        const tag = item.object.get("tag") orelse return error.InvalidLiveMountTag;
        if (host != .string) return error.InvalidLiveMountHost;
        if (guest != .string) return error.InvalidLiveMountGuest;
        if (mode != .string) return error.InvalidLiveMountMode;
        if (!std.mem.eql(u8, mode.string, "ro") and
            !std.mem.eql(u8, mode.string, "rw"))
        {
            return error.InvalidLiveMountMode;
        }
        if (tag != .string) return error.InvalidLiveMountTag;
        try mounts.append(allocator, .{
            .host = host.string,
            .guest = guest.string,
            .mode = mode.string,
            .tag = tag.string,
        });
    }
    return mounts.toOwnedSlice(allocator);
}

fn optionalBoolDefaultFalse(
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!bool {
    assert(field.len > 0);

    const value = object.get(field) orelse return false;
    return switch (value) {
        .bool => |b| b,
        else => invalid,
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
    assert(field.len > 0);

    var out: std.array_list.Aligned([]const u8, null) = .empty;
    errdefer out.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .string) return invalid;
        try out.append(allocator, item.string);
    }
    return out.toOwnedSlice(allocator);
}

fn optionalPortForward(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
) RequestError![]const boot_plan.PortForwardMapping {
    assert(@sizeOf(boot_plan.PortForwardMapping) > 0);

    const value = object.get("portForward") orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return error.InvalidPortForward;
    var mappings: std.array_list.Aligned(boot_plan.PortForwardMapping, null) = .empty;
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

fn requiredPort(
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!i64 {
    assert(field.len > 0);

    const value = object.get(field) orelse return invalid;
    return switch (value) {
        .integer => |i| i,
        else => invalid,
    };
}

fn optionalString(
    object: std.json.ObjectMap,
    field: []const u8,
    missing: RequestError,
    invalid: RequestError,
) RequestError!?[]const u8 {
    assert(field.len > 0);

    const value = object.get(field) orelse return missing;
    return switch (value) {
        .null => null,
        .string => |s| s,
        else => invalid,
    };
}

fn optionalObjectDefaultEmpty(
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!std.json.ObjectMap {
    assert(field.len > 0);

    const value = object.get(field) orelse return .{};
    return switch (value) {
        .object => |o| o,
        else => invalid,
    };
}

fn optionalStringDefaultNull(
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!?[]const u8 {
    assert(field.len > 0);

    const value = object.get(field) orelse return null;
    return switch (value) {
        .null => null,
        .string => |s| s,
        else => invalid,
    };
}

fn requiredBool(
    object: std.json.ObjectMap,
    field: []const u8,
    missing: RequestError,
    invalid: RequestError,
) RequestError!bool {
    assert(field.len > 0);

    const value = object.get(field) orelse return missing;
    return switch (value) {
        .bool => |b| b,
        else => invalid,
    };
}

fn optionalResourcesMemory(object: std.json.ObjectMap) RequestError!?ParsedResourcesMemory {
    assert(@sizeOf(ParsedResourcesMemory) > 0);

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
    assert(@sizeOf(boot_plan.RootDiskMode) > 0);

    const value = object.get("rootDisk") orelse return error.MissingRootDisk;
    if (value != .string) return error.InvalidRootDisk;
    if (std.mem.eql(u8, value.string, "unset")) return .unset;
    if (std.mem.eql(u8, value.string, "false")) return .false_value;
    if (std.mem.eql(u8, value.string, "path")) return .path;
    if (std.mem.eql(u8, value.string, "true")) return .true_value;
    return error.InvalidRootDisk;
}

fn writePortForwardInvalid(io: std.Io, label: []const u8, port: i64) !void {
    assert(label.len > 0);

    var buf: [256]u8 = undefined;
    try protocol.writeError(
        io,
        "BOOT_PORT_FORWARD_INVALID",
        try std.fmt.bufPrint(
            &buf,
            "portForward: {s} must be an integer in 1..65535 (got {d})",
            .{ label, port },
        ),
    );
}

fn writeDuplicateHostPort(io: std.Io, port: u16) !void {
    assert(port > 0);

    var buf: [128]u8 = undefined;
    try protocol.writeError(
        io,
        "BOOT_PORT_FORWARD_CONFLICT",
        try std.fmt.bufPrint(&buf, "portForward: duplicate hostPort {d}", .{port}),
    );
}

fn writePlanError(io: std.Io, err: anyerror) !void {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.InvalidMemory => try writeBootError(
            io,
            "BOOT_MEMORY_INVALID",
            "boot: memory must be a positive integer at least 512 MiB",
        ),
        error.ConflictingMemory => try writeBootError(
            io,
            "BOOT_MEMORY_INVALID",
            "boot: memory conflicts with resources.memory.maxMib. Use one value.",
        ),
        error.InvalidReclaim => try writeBootError(
            io,
            "BOOT_MEMORY_INVALID",
            "boot: resources.memory.reclaim must be \"auto\" when set.",
        ),
        error.CmdWithoutImage => try writeBootError(
            io,
            "BOOT_CMD_WITHOUT_IMAGE",
            "boot: `image` is required when `cmd` is set.",
        ),
        error.RootDiskWithoutImage => try writeBootError(
            io,
            "BOOT_CMD_WITHOUT_IMAGE",
            "boot: rootDisk: true requires an `image` (the .tar.gz to materialize).",
        ),
        error.MissingAutoMemory => try writeBootError(
            io,
            "BOOT_MEMORY_INVALID",
            "boot: memory auto-size input is missing",
        ),
        error.InvalidGuestCwdAbsolute => try writeBootError(
            io,
            "BOOT_CWD_INVALID",
            "guestCwd must be an absolute path",
        ),
        error.InvalidGuestCwdNul => try writeBootError(
            io,
            "BOOT_CWD_INVALID",
            "guestCwd must not contain NUL bytes",
        ),
        error.InvalidMountGuestAbsolute => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "mount guest path must be absolute",
        ),
        error.InvalidMountGuestRoot => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "mount guest path must live under /mnt/",
        ),
        error.TooManyLiveMounts => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "liveMounts: at most 5 live mounts are supported per VM",
        ),
        error.InvalidLiveMountMode => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "liveMounts: mode must be ro or rw",
        ),
        error.UnsupportedHostMemory => try writeBootError(
            io,
            "BOOT_MEMORY_INVALID",
            "boot: host memory probing is unsupported on this platform",
        ),
        error.InvalidGuestEnvValue => try writeBootError(
            io,
            "INVALID_REQUEST",
            "boot-plan guestEnv values must be strings",
        ),
        else => try writeBootError(io, "BOOT_MEMORY_INVALID", @errorName(err)),
    }
}

fn writeBootError(io: std.Io, code: []const u8, message: []const u8) !void {
    assert(code.len > 0);
    assert(message.len > 0);

    try protocol.writeError(io, code, message);
}

fn writeRequestError(io: std.Io, err: RequestError) !void {
    assert(@errorName(err).len > 0);
    if (try protocol.writeCommonRequestError(io, err)) return;

    switch (err) {
        error.InvalidPortForward,
        error.InvalidHostPort,
        error.InvalidGuestPort,
        => try protocol.writeError(
            io,
            "BOOT_PORT_FORWARD_INVALID",
            "portForward: hostPort and guestPort must be integers in 1..65535",
        ),
        error.InvalidLiveMounts,
        error.InvalidLiveMountGuest,
        => try protocol.writeError(
            io,
            "BOOT_MOUNT_INVALID",
            "liveMounts: entries must include host and guest paths",
        ),
        error.InvalidLiveMountsResolved,
        error.InvalidLiveMountHost,
        error.InvalidLiveMountMode,
        error.InvalidLiveMountTag,
        => try protocol.writeError(
            io,
            "BOOT_MOUNT_INVALID",
            "liveMounts: resolved entries must include host, guest, tag, and mode ro/rw",
        ),
        else => try protocol.writeError(io, "INVALID_REQUEST", @errorName(err)),
    }
}
