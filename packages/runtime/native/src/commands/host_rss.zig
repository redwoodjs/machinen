const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

pub const name = "host-rss";

const Request = struct {
    targets: []runtime_helper.host.RssTarget,
};

const RequestError = error{
    MissingTargets,
    InvalidTargets,
    InvalidTarget,
    MissingPid,
    InvalidPid,
    InvalidStatsPath,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const readings = runtime_helper.host.readHostRss(allocator, io, request.targets) catch |err| {
        try protocol.writeError(io, "BOOT_PACK_FAILED", @errorName(err));
        return .fail;
    };
    defer allocator.free(readings);

    const out = try formatResponse(allocator, readings);
    defer allocator.free(out);
    try protocol.stdout(io, out);
    return .ok;
}

fn formatResponse(allocator: std.mem.Allocator, readings: []const runtime_helper.host.RssReading) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    try out.appendSlice(allocator, "{\"ok\":true,\"protocolVersion\":1,\"command\":\"host-rss\",\"data\":{\"readings\":[");
    for (readings, 0..) |reading, i| {
        if (i != 0) try out.append(allocator, ',');
        const item = try std.fmt.allocPrint(allocator, "{{\"pid\":{d},\"rssBytes\":{d}}}", .{ reading.pid, reading.rss_bytes });
        defer allocator.free(item);
        try out.appendSlice(allocator, item);
    }
    try out.appendSlice(allocator, "]}}\n");
    return out.toOwnedSlice(allocator);
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
    try protocol.rejectUnknownFields(object, &.{"targets"});
    const targets_value = object.get("targets") orelse return error.MissingTargets;
    if (targets_value != .array) return error.InvalidTargets;
    const targets = try allocator.alloc(runtime_helper.host.RssTarget, targets_value.array.items.len);
    for (targets_value.array.items, 0..) |target_value, i| {
        targets[i] = try parseTarget(target_value);
    }
    return .{ .targets = targets };
}

fn parseTarget(value: std.json.Value) RequestError!runtime_helper.host.RssTarget {
    if (value != .object) return error.InvalidTarget;
    const object = value.object;
    try protocol.rejectUnknownFields(object, &.{ "pid", "statsPath" });
    const pid_value = object.get("pid") orelse return error.MissingPid;
    if (pid_value != .integer or pid_value.integer <= 0 or pid_value.integer > std.math.maxInt(u32)) return error.InvalidPid;
    const stats_path_value = object.get("statsPath");
    const stats_path = if (stats_path_value) |stats_path| blk: {
        if (stats_path == .null) break :blk null;
        if (stats_path != .string) return error.InvalidStatsPath;
        break :blk stats_path.string;
    } else null;
    return .{ .pid = @intCast(pid_value.integer), .stats_path = stats_path };
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
