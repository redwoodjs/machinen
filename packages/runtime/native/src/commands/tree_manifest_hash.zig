const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;

pub const name = "tree-manifest-hash";

const Request = struct {
    root: []const u8,
};

const RequestError = error{
    MissingRoot,
    InvalidRoot,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    assert(name.len > 0);

    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeParseError(io, err);
        return .fail;
    };

    const hash = runtime_helper.manifest.treeManifestHash(allocator, io, request.root) catch |err| {
        try writeManifestError(io, err);
        return .fail;
    };

    try protocol.writeJson(allocator, io, .{
        .ok = true,
        .protocolVersion = @as(u8, protocol.version),
        .command = name,
        .data = .{ .hash = hash[0..] },
    });
    return .ok;
}

fn writeParseError(io: std.Io, err: RequestError) !void {
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
        error.MissingRoot => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "tree-manifest-hash request data must include " ++
                "a string root field",
        ),
        error.InvalidRoot => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "tree-manifest-hash root field must be a string",
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
        else => try protocol.writeError(io, "REQUEST_READ_FAILED", @errorName(err)),
    }
}

fn writeManifestError(io: std.Io, err: runtime_helper.manifest.Error) !void {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.PathNotFound => try protocol.writeError(
            io,
            "PATH_NOT_FOUND",
            "root path does not exist",
        ),
        error.PathNotDirectory => try protocol.writeError(
            io,
            "PATH_NOT_DIRECTORY",
            "root path is not a directory",
        ),
        else => try protocol.writeError(io, "TREE_MANIFEST_HASH_FAILED", @errorName(err)),
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
    const request = request_value.object;
    try protocol.rejectUnknownFields(request, &.{ "protocolVersion", "data" });

    const protocol_version = request.get("protocolVersion") orelse
        return error.UnsupportedProtocolVersion;
    if (protocol_version != .integer) return error.UnsupportedProtocolVersion;
    if (protocol_version.integer != protocol.version) {
        return error.UnsupportedProtocolVersion;
    }

    const data_value = request.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    try protocol.rejectUnknownFields(data_value.object, &.{"root"});
    const root_field = data_value.object.get("root") orelse return error.MissingRoot;
    if (root_field != .string) return error.InvalidRoot;
    return .{ .root = root_field.string };
}
