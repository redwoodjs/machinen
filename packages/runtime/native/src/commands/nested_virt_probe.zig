const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

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
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const result = runtime_helper.host.probeNestedVirtualization(allocator, io, request.observed) catch |err| {
        try protocol.writeError(io, "BOOT_NESTED_VIRT_UNSUPPORTED", @errorName(err));
        return .fail;
    };
    defer result.deinit(allocator);

    const out = if (result.reason) |reason|
        try std.fmt.allocPrint(
            allocator,
            "{{\"ok\":true,\"protocolVersion\":1,\"command\":\"nested-virt-probe\",\"data\":{{\"supported\":{},\"reason\":\"{s}\"}}}}\n",
            .{ result.supported, reason },
        )
    else
        try std.fmt.allocPrint(
            allocator,
            "{{\"ok\":true,\"protocolVersion\":1,\"command\":\"nested-virt-probe\",\"data\":{{\"supported\":{}}}}}\n",
            .{result.supported},
        );
    defer allocator.free(out);
    try protocol.stdout(io, out);
    return .ok;
}

fn parseRequest(allocator: std.mem.Allocator, io: std.Io) RequestError!Request {
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
    try protocol.rejectUnknownFields(object, &.{"observed"});
    var request: Request = .{};
    if (object.get("observed")) |observed_value| {
        if (observed_value != .object) return error.InvalidObserved;
        request.observed = try parseObserved(observed_value.object);
    }
    return request;
}

fn parseObserved(object: std.json.ObjectMap) RequestError!runtime_helper.host.NestedVirtObservation {
    try protocol.rejectUnknownFields(object, &.{ "platform", "arch", "linuxDevKvm", "linuxKvmNested", "linuxKvmArmNested", "darwinHvSupport", "darwinProductVersion", "darwinCpuBrand" });
    const platform = object.get("platform") orelse return error.InvalidPlatform;
    if (platform != .string) return error.InvalidPlatform;
    const arch = object.get("arch") orelse return error.InvalidArch;
    if (arch != .string) return error.InvalidArch;
    return .{
        .platform = platform.string,
        .arch = arch.string,
        .linux_dev_kvm = try optionalBool(object, "linuxDevKvm", error.InvalidLinuxDevKvm),
        .linux_kvm_nested = try optionalString(object, "linuxKvmNested", error.InvalidLinuxKvmNested),
        .linux_kvm_arm_nested = try optionalString(object, "linuxKvmArmNested", error.InvalidLinuxKvmArmNested),
        .darwin_hv_support = try optionalString(object, "darwinHvSupport", error.InvalidDarwinHvSupport),
        .darwin_product_version = try optionalString(object, "darwinProductVersion", error.InvalidDarwinProductVersion),
        .darwin_cpu_brand = try optionalString(object, "darwinCpuBrand", error.InvalidDarwinCpuBrand),
    };
}

fn optionalBool(object: std.json.ObjectMap, name_text: []const u8, invalid: RequestError) RequestError!?bool {
    const value = object.get(name_text) orelse return null;
    if (value != .bool) return invalid;
    return value.bool;
}

fn optionalString(object: std.json.ObjectMap, name_text: []const u8, invalid: RequestError) RequestError!?[]const u8 {
    const value = object.get(name_text) orelse return null;
    if (value == .null) return null;
    if (value != .string) return invalid;
    return value.string;
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
        else => try protocol.writeError(io, "INVALID_REQUEST", @errorName(err)),
    }
}
