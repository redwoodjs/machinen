const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

pub const name = "mountdisk-image";

const Request = struct {
    host: []const u8,
    cache_dir: []const u8,
    force: bool = false,
    mksquashfs_candidates: []const []const u8 = &.{},
    mksquashfs_env_override: ?[]const u8 = null,
};

const RequestError = error{
    MissingHost,
    InvalidHost,
    MissingCacheDir,
    InvalidCacheDir,
    InvalidForce,
    InvalidMksquashfsCandidates,
    InvalidMksquashfsEnvOverride,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const result = runtime_helper.mountdisk.ensureLower(allocator, io, .{
        .host = request.host,
        .cache_dir = request.cache_dir,
        .force = request.force,
        .mksquashfs_candidates = request.mksquashfs_candidates,
        .mksquashfs_env_override = request.mksquashfs_env_override,
    }) catch |err| {
        switch (err) {
            error.HostNotFound => try protocol.writeError(io, "BOOT_MOUNT_HOST_NOT_FOUND", "ensureMountDiskImage: host directory not found"),
            error.HostNotDirectory => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "ensureMountDiskImage: host path must be a directory"),
            error.MksquashfsEnvMissing => try protocol.writeError(io, "BOOT_MOUNTDISK_TOOL_MISSING", "MACHINEN_MKSQUASHFS is set but that file does not exist"),
            error.MksquashfsMissing => try protocol.writeError(io, "BOOT_MOUNTDISK_TOOL_MISSING", "ensureMountDiskImage: no mksquashfs binary found"),
            error.MksquashfsFailed => try protocol.writeError(io, "PROVISION_INSTALL_HOOK_FAILED", "ensureMountDiskImage: mksquashfs failed"),
            else => try protocol.writeError(io, "PROVISION_INSTALL_HOOK_FAILED", @errorName(err)),
        }
        return .fail;
    };
    defer allocator.free(result.lower_path);

    const out = try std.fmt.allocPrint(
        allocator,
        "{{\"ok\":true,\"protocolVersion\":1,\"command\":\"mountdisk-image\",\"data\":{{\"lowerPath\":\"{s}\",\"key\":\"{s}\",\"cacheHit\":{},\"phases\":{{\"manifestHash\":{d},\"mksquashfs\":{d},\"stagingRename\":{d}}}}}}}\n",
        .{ result.lower_path, &result.key, result.cache_hit, result.manifest_hash_ms, result.mksquashfs_ms, result.staging_rename_ms },
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
    try protocol.rejectUnknownFields(object, &.{ "host", "cacheDir", "force", "mksquashfsCandidates", "mksquashfsEnvOverride" });
    return .{
        .host = try requiredString(object, "host", error.MissingHost, error.InvalidHost),
        .cache_dir = try requiredString(object, "cacheDir", error.MissingCacheDir, error.InvalidCacheDir),
        .force = try optionalBool(object, "force", error.InvalidForce) orelse false,
        .mksquashfs_candidates = try optionalStringArray(allocator, object, "mksquashfsCandidates", error.InvalidMksquashfsCandidates),
        .mksquashfs_env_override = try optionalString(object, "mksquashfsEnvOverride", error.InvalidMksquashfsEnvOverride),
    };
}

fn requiredString(object: std.json.ObjectMap, field: []const u8, missing: RequestError, invalid: RequestError) RequestError![]const u8 {
    const value = object.get(field) orelse return missing;
    if (value != .string) return invalid;
    return value.string;
}

fn optionalString(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!?[]const u8 {
    const value = object.get(field) orelse return null;
    if (value == .null) return null;
    if (value != .string) return invalid;
    return value.string;
}

fn optionalBool(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!?bool {
    const value = object.get(field) orelse return null;
    if (value == .null) return null;
    if (value != .bool) return invalid;
    return value.bool;
}

fn optionalStringArray(allocator: std.mem.Allocator, object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError![]const []const u8 {
    const value = object.get(field) orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return invalid;
    var out: std.ArrayList([]const u8) = .empty;
    for (value.array.items) |item| {
        if (item != .string) return invalid;
        try out.append(allocator, item.string);
    }
    return out.toOwnedSlice(allocator);
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
