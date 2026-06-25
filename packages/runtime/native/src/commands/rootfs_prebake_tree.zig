const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;

pub const name = "rootfs-prebake-tree";

const Request = struct {
    tar_path: []const u8,
    tree_dir: []const u8,
    cache_dir: []const u8,
    mke2fs: []const u8,
};

const RequestError = error{
    MissingTarPath,
    InvalidTarPath,
    MissingTreeDir,
    InvalidTreeDir,
    MissingCacheDir,
    InvalidCacheDir,
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

    const result = runtime_helper.rootfs.prebakeFromTree(allocator, io, .{
        .tar_path = request.tar_path,
        .tree_dir = request.tree_dir,
        .cache_dir = request.cache_dir,
        .mke2fs = request.mke2fs,
    }) catch |err| {
        try protocol.writeError(io, "PROVISION_INSTALL_HOOK_FAILED", @errorName(err));
        return .fail;
    };
    defer if (result.img_path) |img_path| allocator.free(img_path);

    try writeResponse(allocator, io, result);
    return .ok;
}

fn writeResponse(
    allocator: std.mem.Allocator,
    io: std.Io,
    result: runtime_helper.rootfs.PrebakeTreeResult,
) !void {
    assert(name.len > 0);

    if (!result.ok) {
        if (result.sha) |sha| {
            try protocol.writeJson(allocator, io, .{
                .ok = true,
                .protocolVersion = @as(u8, protocol.version),
                .command = name,
                .data = .{
                    .ok = false,
                    .sha = sha[0..],
                    .phases = .{
                        .sha256 = result.phases.sha256,
                        .mke2fs = result.phases.mke2fs,
                    },
                },
            });
        } else {
            try protocol.writeJson(allocator, io, .{
                .ok = true,
                .protocolVersion = @as(u8, protocol.version),
                .command = name,
                .data = .{
                    .ok = false,
                    .phases = .{
                        .sha256 = result.phases.sha256,
                        .mke2fs = result.phases.mke2fs,
                    },
                },
            });
        }
        return;
    }

    try protocol.writeJson(allocator, io, .{
        .ok = true,
        .protocolVersion = @as(u8, protocol.version),
        .command = name,
        .data = .{
            .ok = true,
            .skipped = result.skipped,
            .sha = result.sha.?[0..],
            .imgPath = result.img_path.?,
            .sizeBytes = result.size_bytes,
            .phases = .{
                .sha256 = result.phases.sha256,
                .mke2fs = result.phases.mke2fs,
            },
        },
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
    const protocol_version =
        envelope.get("protocolVersion") orelse return error.UnsupportedProtocolVersion;
    if (protocol_version != .integer or protocol_version.integer != protocol.version) {
        return error.UnsupportedProtocolVersion;
    }
    const data_value = envelope.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    const object = data_value.object;
    try protocol.rejectUnknownFields(object, &.{
        "tarPath",
        "treeDir",
        "cacheDir",
        "mke2fs",
    });
    return .{
        .tar_path = try requiredString(
            object,
            "tarPath",
            error.MissingTarPath,
            error.InvalidTarPath,
        ),
        .tree_dir = try requiredString(
            object,
            "treeDir",
            error.MissingTreeDir,
            error.InvalidTreeDir,
        ),
        .cache_dir = try requiredString(
            object,
            "cacheDir",
            error.MissingCacheDir,
            error.InvalidCacheDir,
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
