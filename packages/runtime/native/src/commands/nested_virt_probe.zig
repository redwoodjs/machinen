const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;

pub const name = "nested-virt-probe";

const Request = struct {
    observed: ?runtime_helper.host.NestedVirtObservation = null,
};

const RequestError = error{
    InvalidObserved,
    InvalidPlatform,
    InvalidArch,
    InvalidLinuxDevKvm,
    InvalidLinuxKvmNested,
    InvalidLinuxKvmArmNested,
    InvalidDarwinHvSupport,
    InvalidDarwinProductVersion,
    InvalidDarwinCpuBrand,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    assert(name.len > 0);

    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const result = runtime_helper.host.probeNestedVirtualization(
        allocator,
        io,
        request.observed,
    ) catch |err| {
        try protocol.writeError(io, "BOOT_NESTED_VIRT_UNSUPPORTED", @errorName(err));
        return .fail;
    };
    defer result.deinit(allocator);

    try writeResponse(allocator, io, result);
    return .ok;
}

fn writeResponse(
    allocator: std.mem.Allocator,
    io: std.Io,
    result: runtime_helper.host.NestedVirtResult,
) !void {
    assert(name.len > 0);

    if (result.reason) |reason| {
        try protocol.writeJson(allocator, io, .{
            .ok = true,
            .protocolVersion = @as(u8, protocol.version),
            .command = name,
            .data = .{ .supported = result.supported, .reason = reason },
        });
        return;
    }
    try protocol.writeJson(allocator, io, .{
        .ok = true,
        .protocolVersion = @as(u8, protocol.version),
        .command = name,
        .data = .{ .supported = result.supported },
    });
}

fn parseRequest(allocator: std.mem.Allocator, io: std.Io) RequestError!Request {
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
    const object = data_value.object;
    try protocol.rejectUnknownFields(object, &.{"observed"});
    var request: Request = .{};
    if (object.get("observed")) |observed_value| {
        if (observed_value != .object) return error.InvalidObserved;
        request.observed = try parseObserved(observed_value.object);
    }
    return request;
}

fn parseObserved(
    object: std.json.ObjectMap,
) RequestError!runtime_helper.host.NestedVirtObservation {
    assert(@sizeOf(runtime_helper.host.NestedVirtObservation) > 0);

    try protocol.rejectUnknownFields(object, &.{
        "platform",
        "arch",
        "linuxDevKvm",
        "linuxKvmNested",
        "linuxKvmArmNested",
        "darwinHvSupport",
        "darwinProductVersion",
        "darwinCpuBrand",
    });
    const platform = object.get("platform") orelse return error.InvalidPlatform;
    if (platform != .string) return error.InvalidPlatform;
    const arch = object.get("arch") orelse return error.InvalidArch;
    if (arch != .string) return error.InvalidArch;
    return .{
        .platform = platform.string,
        .arch = arch.string,
        .linux_dev_kvm = try optionalBool(object, "linuxDevKvm", error.InvalidLinuxDevKvm),
        .linux_kvm_nested = try optionalString(
            object,
            "linuxKvmNested",
            error.InvalidLinuxKvmNested,
        ),
        .linux_kvm_arm_nested = try optionalString(
            object,
            "linuxKvmArmNested",
            error.InvalidLinuxKvmArmNested,
        ),
        .darwin_hv_support = try optionalString(
            object,
            "darwinHvSupport",
            error.InvalidDarwinHvSupport,
        ),
        .darwin_product_version = try optionalString(
            object,
            "darwinProductVersion",
            error.InvalidDarwinProductVersion,
        ),
        .darwin_cpu_brand = try optionalString(
            object,
            "darwinCpuBrand",
            error.InvalidDarwinCpuBrand,
        ),
    };
}

fn optionalBool(
    object: std.json.ObjectMap,
    name_text: []const u8,
    invalid: RequestError,
) RequestError!?bool {
    assert(name_text.len > 0);

    const value = object.get(name_text) orelse return null;
    if (value != .bool) return invalid;
    return value.bool;
}

fn optionalString(
    object: std.json.ObjectMap,
    name_text: []const u8,
    invalid: RequestError,
) RequestError!?[]const u8 {
    assert(name_text.len > 0);

    const value = object.get(name_text) orelse return null;
    if (value == .null) return null;
    if (value != .string) return invalid;
    return value.string;
}

fn writeRequestError(io: std.Io, err: RequestError) !void {
    assert(@errorName(err).len > 0);
    if (try protocol.writeCommonRequestError(io, err)) return;
    try protocol.writeError(io, "INVALID_REQUEST", @errorName(err));
}
