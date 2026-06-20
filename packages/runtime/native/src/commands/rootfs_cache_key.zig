const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

pub const name = "rootfs-cache-key";

const Request = struct {
    tar: []const u8,
};

const RequestError = error{
    MissingTar,
    InvalidTar,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const result = runtime_helper.rootfs.rootfsCacheKey(allocator, io, request.tar) catch |err| {
        switch (err) {
            error.PathNotFound => try protocol.writeError(io, "PROVISION_BASE_NOT_FOUND", "ensureRootfsImage: tarball not found"),
            else => try protocol.writeError(io, "PROVISION_INSTALL_HOOK_FAILED", @errorName(err)),
        }
        return .fail;
    };

    const source = switch (result.source) {
        .sidecar => "sidecar",
        .file => "file",
    };
    const out = try std.fmt.allocPrint(
        allocator,
        "{{\"ok\":true,\"protocolVersion\":1,\"command\":\"rootfs-cache-key\",\"data\":{{\"sha\":\"{s}\",\"source\":\"{s}\"}}}}\n",
        .{ &result.sha, source },
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
    try protocol.rejectUnknownFields(object, &.{"tar"});
    const tar = object.get("tar") orelse return error.MissingTar;
    if (tar != .string) return error.InvalidTar;
    return .{ .tar = tar.string };
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
        error.MissingTar => try protocol.writeError(io, "INVALID_REQUEST", "rootfs-cache-key request data must include a string tar field"),
        error.InvalidTar => try protocol.writeError(io, "INVALID_REQUEST", "rootfs-cache-key tar field must be a string"),
        else => try protocol.writeError(io, "INVALID_REQUEST", @errorName(err)),
    }
}
