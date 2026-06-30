const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;

pub const name = "mountdisk-upper";

const Request = struct {
    tmp_dir: []const u8,
    size_bytes: u64,
    mke2fs: []const u8,
};

const RequestError = error{
    MissingTmpDir,
    InvalidTmpDir,
    MissingSizeBytes,
    InvalidSizeBytes,
    MissingMke2fs,
    InvalidMke2fs,
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

    const result = runtime_helper.mountdisk.ensureUpper(allocator, io, .{
        .tmp_dir = request.tmp_dir,
        .size_bytes = request.size_bytes,
        .mke2fs = request.mke2fs,
    }) catch |err| {
        try writeMountdiskError(io, err);
        return .fail;
    };
    defer allocator.free(result.upper_path);

    try writeSuccess(allocator, io, result);
    return .ok;
}

fn writeSuccess(
    allocator: std.mem.Allocator,
    io: std.Io,
    result: runtime_helper.mountdisk.UpperResult,
) !void {
    assert(result.upper_path.len > 0);

    try protocol.writeJson(allocator, io, .{
        .ok = true,
        .protocolVersion = @as(u8, protocol.version),
        .command = name,
        .data = .{
            .upperPath = result.upper_path,
            .sizeBytes = result.size_bytes,
        },
    });
}

fn writeMountdiskError(io: std.Io, err: runtime_helper.mountdisk.Error) !void {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.Mke2fsFailed => try protocol.writeError(
            io,
            "PROVISION_INSTALL_HOOK_FAILED",
            "ensureMountDiskUpper: mke2fs failed",
        ),
        else => try protocol.writeError(io, "PROVISION_INSTALL_HOOK_FAILED", @errorName(err)),
    }
}

fn parseRequest(allocator: std.mem.Allocator, io: std.Io) RequestError!Request {
    assert(protocol.version == 1);
    assert(protocol.max_request_bytes > 0);

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

    const protocol_version = envelope.get("protocolVersion") orelse
        return error.UnsupportedProtocolVersion;
    if (protocol_version != .integer) return error.UnsupportedProtocolVersion;
    if (protocol_version.integer != protocol.version) return error.UnsupportedProtocolVersion;

    const data_value = envelope.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    return parseRequestData(data_value.object);
}

fn parseRequestData(object: std.json.ObjectMap) RequestError!Request {
    assert(object.count() > 0);

    try protocol.rejectUnknownFields(object, &.{ "tmpDir", "sizeBytes", "mke2fs" });
    return .{
        .tmp_dir = try requiredString(
            object,
            "tmpDir",
            error.MissingTmpDir,
            error.InvalidTmpDir,
        ),
        .size_bytes = try requiredU64(
            object,
            "sizeBytes",
            error.MissingSizeBytes,
            error.InvalidSizeBytes,
        ),
        .mke2fs = try requiredString(
            object,
            "mke2fs",
            error.MissingMke2fs,
            error.InvalidMke2fs,
        ),
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

fn requiredU64(
    object: std.json.ObjectMap,
    field: []const u8,
    missing: RequestError,
    invalid: RequestError,
) RequestError!u64 {
    assert(field.len > 0);

    const value = object.get(field) orelse return missing;
    if (value != .integer or value.integer < 0) return invalid;
    return @intCast(value.integer);
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
