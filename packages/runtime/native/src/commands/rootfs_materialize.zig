const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

pub const name = "rootfs-materialize";

const Request = struct {
    tar_abs: []const u8,
    cache_dir: []const u8,
    sha: []const u8,
    img_path: []const u8,
    mke2fs: []const u8,
    size_multiplier: f64 = 2.5,
    min_size_bytes: u64 = 2 * 1024 * 1024 * 1024,
    size_bytes: ?u64 = null,
};

const RequestError = error{
    MissingTarAbs,
    InvalidTarAbs,
    MissingCacheDir,
    InvalidCacheDir,
    MissingSha,
    InvalidSha,
    MissingImgPath,
    InvalidImgPath,
    MissingMke2fs,
    InvalidMke2fs,
    InvalidSizeMultiplier,
    InvalidMinSizeBytes,
    InvalidSizeBytes,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const result = runtime_helper.rootfs.materializeFromTar(allocator, io, .{
        .tar_abs = request.tar_abs,
        .cache_dir = request.cache_dir,
        .sha = request.sha,
        .img_path = request.img_path,
        .mke2fs = request.mke2fs,
        .size_multiplier = request.size_multiplier,
        .min_size_bytes = request.min_size_bytes,
        .size_bytes = request.size_bytes,
    }) catch |err| {
        switch (err) {
            error.TarExtractFailed => try protocol.writeError(io, "PROVISION_INSTALL_HOOK_FAILED", "ensureRootfsImage: tar -xpf failed"),
            error.Mke2fsFailed => try protocol.writeError(io, "PROVISION_INSTALL_HOOK_FAILED", "ensureRootfsImage: mke2fs failed"),
            else => try protocol.writeError(io, "PROVISION_INSTALL_HOOK_FAILED", @errorName(err)),
        }
        return .fail;
    };
    defer allocator.free(result.img_path);

    const out = try std.fmt.allocPrint(
        allocator,
        "{{\"ok\":true,\"protocolVersion\":1,\"command\":\"rootfs-materialize\",\"data\":{{\"imgPath\":\"{s}\",\"sizeBytes\":{d},\"phases\":{{\"stagingCreate\":{d},\"tarExtract\":{d},\"size\":{d},\"sparseAllocate\":{d},\"mke2fs\":{d},\"rename\":{d},\"stagingCleanup\":{d}}}}}}}\n",
        .{ result.img_path, result.size_bytes, result.phases.staging_create, result.phases.tar_extract, result.phases.size, result.phases.sparse_allocate, result.phases.mke2fs, result.phases.rename, result.phases.staging_cleanup },
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
    try protocol.rejectUnknownFields(object, &.{ "tarAbs", "cacheDir", "sha", "imgPath", "mke2fs", "sizeMultiplier", "minSizeBytes", "sizeBytes" });
    return .{
        .tar_abs = try requiredString(object, "tarAbs", error.MissingTarAbs, error.InvalidTarAbs),
        .cache_dir = try requiredString(object, "cacheDir", error.MissingCacheDir, error.InvalidCacheDir),
        .sha = try requiredString(object, "sha", error.MissingSha, error.InvalidSha),
        .img_path = try requiredString(object, "imgPath", error.MissingImgPath, error.InvalidImgPath),
        .mke2fs = try requiredString(object, "mke2fs", error.MissingMke2fs, error.InvalidMke2fs),
        .size_multiplier = try optionalFloat(object, "sizeMultiplier", error.InvalidSizeMultiplier) orelse 2.5,
        .min_size_bytes = try optionalU64(object, "minSizeBytes", error.InvalidMinSizeBytes) orelse 2 * 1024 * 1024 * 1024,
        .size_bytes = try optionalU64(object, "sizeBytes", error.InvalidSizeBytes),
    };
}

fn requiredString(object: std.json.ObjectMap, field: []const u8, missing: RequestError, invalid: RequestError) RequestError![]const u8 {
    const value = object.get(field) orelse return missing;
    if (value != .string) return invalid;
    return value.string;
}

fn optionalU64(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!?u64 {
    const value = object.get(field) orelse return null;
    if (value == .null) return null;
    if (value != .integer or value.integer < 0) return invalid;
    return @intCast(value.integer);
}

fn optionalFloat(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!?f64 {
    const value = object.get(field) orelse return null;
    if (value == .null) return null;
    return switch (value) {
        .float => |f| f,
        .integer => |i| @floatFromInt(i),
        else => invalid,
    };
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
