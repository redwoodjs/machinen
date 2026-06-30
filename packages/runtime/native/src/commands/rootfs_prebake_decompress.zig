const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;

pub const name = "rootfs-prebake-decompress";

const Request = struct {
    path: []const u8,
    dst: []const u8,
    format: runtime_helper.rootfs.PrebakeFormat,
};

const RequestError = error{
    MissingPath,
    InvalidPath,
    MissingDst,
    InvalidDst,
    MissingFormat,
    InvalidFormat,
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

    const result = runtime_helper.rootfs.decompressPrebake(allocator, io, .{
        .path = request.path,
        .dst = request.dst,
        .format = request.format,
    }) catch |err| {
        try protocol.writeError(io, "PROVISION_INSTALL_HOOK_FAILED", @errorName(err));
        return .fail;
    };

    if (result.ok and result.sha256 != null) {
        try protocol.writeJson(allocator, io, .{
            .ok = true,
            .protocolVersion = @as(u8, protocol.version),
            .command = name,
            .data = .{ .ok = true, .sha256 = result.sha256.?[0..] },
        });
    } else {
        try protocol.writeJson(allocator, io, .{
            .ok = true,
            .protocolVersion = @as(u8, protocol.version),
            .command = name,
            .data = .{ .ok = false },
        });
    }
    return .ok;
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
    const protocol_version =
        envelope.get("protocolVersion") orelse return error.UnsupportedProtocolVersion;
    if (protocol_version != .integer or protocol_version.integer != protocol.version) {
        return error.UnsupportedProtocolVersion;
    }
    const data_value = envelope.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    const object = data_value.object;
    try protocol.rejectUnknownFields(object, &.{ "path", "dst", "format" });
    return .{
        .path = try requiredString(object, "path", error.MissingPath, error.InvalidPath),
        .dst = try requiredString(object, "dst", error.MissingDst, error.InvalidDst),
        .format = try requiredFormat(object),
    };
}

fn requiredString(
    object: std.json.ObjectMap,
    field: []const u8,
    missing: RequestError,
    invalid: RequestError,
) RequestError![]const u8 {
    assert(field.len > 0);

    const value = object.get(field) orelse return missing;
    if (value != .string) return invalid;
    return value.string;
}

fn requiredFormat(object: std.json.ObjectMap) RequestError!runtime_helper.rootfs.PrebakeFormat {
    assert(name.len > 0);

    const value = object.get("format") orelse return error.MissingFormat;
    if (value != .string) return error.InvalidFormat;
    if (std.mem.eql(u8, value.string, "gz")) return .gz;
    if (std.mem.eql(u8, value.string, "zst")) return .zst;
    return error.InvalidFormat;
}

fn writeRequestError(io: std.Io, err: RequestError) !void {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.RequestTooLarge => try protocol.writeError(
            io,
            "REQUEST_TOO_LARGE",
            "request JSON exceeds the maximum size",
        ),
        error.UnknownField => try protocol.writeError(
            io,
            "UNKNOWN_FIELD",
            "request contains an unknown field",
        ),
        error.UnsupportedProtocolVersion => try protocol.writeError(
            io,
            "UNSUPPORTED_PROTOCOL_VERSION",
            "request protocolVersion must be 1",
        ),
        error.MissingData => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "request must include a data object",
        ),
        error.InvalidData => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "request data field must be an object",
        ),
        error.InvalidJson => try protocol.writeError(
            io,
            "INVALID_JSON",
            "request body is not valid JSON",
        ),
        error.InvalidShape => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "request body must be a JSON object",
        ),
        else => try protocol.writeError(io, "INVALID_REQUEST", @errorName(err)),
    }
}
