const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

pub const name = "tree-manifest-hash";

const Request = struct {
    root: []const u8,
};

const RequestError = error{
    MissingRoot,
    InvalidRoot,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        switch (err) {
            error.RequestTooLarge => try protocol.writeError(io, "REQUEST_TOO_LARGE", "request JSON exceeds the maximum size"),
            error.UnknownField => try protocol.writeError(io, "UNKNOWN_FIELD", "request contains an unknown field"),
            error.UnsupportedProtocolVersion => try protocol.writeError(io, "UNSUPPORTED_PROTOCOL_VERSION", "request protocolVersion must be 1"),
            error.MissingData => try protocol.writeError(io, "INVALID_REQUEST", "request must include a data object"),
            error.InvalidData => try protocol.writeError(io, "INVALID_REQUEST", "request data field must be an object"),
            error.MissingRoot => try protocol.writeError(io, "INVALID_REQUEST", "tree-manifest-hash request data must include a string root field"),
            error.InvalidRoot => try protocol.writeError(io, "INVALID_REQUEST", "tree-manifest-hash root field must be a string"),
            error.InvalidJson => try protocol.writeError(io, "INVALID_JSON", "request body is not valid JSON"),
            error.InvalidShape => try protocol.writeError(io, "INVALID_REQUEST", "request body must be a JSON object"),
            else => try protocol.writeError(io, "REQUEST_READ_FAILED", @errorName(err)),
        }
        return .fail;
    };

    const hash = runtime_helper.manifest.treeManifestHash(allocator, io, request.root) catch |err| {
        switch (err) {
            error.PathNotFound => try protocol.writeError(io, "PATH_NOT_FOUND", "root path does not exist"),
            error.PathNotDirectory => try protocol.writeError(io, "PATH_NOT_DIRECTORY", "root path is not a directory"),
            else => try protocol.writeError(io, "TREE_MANIFEST_HASH_FAILED", @errorName(err)),
        }
        return .fail;
    };

    const out = try std.fmt.allocPrint(
        allocator,
        "{{\"ok\":true,\"protocolVersion\":1,\"command\":\"tree-manifest-hash\",\"data\":{{\"hash\":\"{s}\"}}}}\n",
        .{&hash},
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
    const request = request_value.object;
    try protocol.rejectUnknownFields(request, &.{ "protocolVersion", "data" });

    const protocol_version = request.get("protocolVersion") orelse return error.UnsupportedProtocolVersion;
    if (protocol_version != .integer or protocol_version.integer != protocol.version) return error.UnsupportedProtocolVersion;

    const data_value = request.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    try protocol.rejectUnknownFields(data_value.object, &.{"root"});
    const root_field = data_value.object.get("root") orelse return error.MissingRoot;
    if (root_field != .string) return error.InvalidRoot;
    return .{ .root = root_field.string };
}
