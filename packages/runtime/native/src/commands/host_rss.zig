const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;

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
    assert(name.len > 0);

    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const readings = runtime_helper.host.readHostRss(
        allocator,
        io,
        request.targets,
    ) catch |err| {
        try protocol.writeError(io, "BOOT_PACK_FAILED", @errorName(err));
        return .fail;
    };
    defer allocator.free(readings);

    try writeResponse(allocator, io, readings);
    return .ok;
}

fn writeResponse(
    allocator: std.mem.Allocator,
    io: std.Io,
    readings: []const runtime_helper.host.RssReading,
) !void {
    assert(name.len > 0);
    try protocol.writeJson(allocator, io, .{
        .ok = true,
        .protocolVersion = @as(u8, protocol.version),
        .command = name,
        .data = .{ .readings = readings },
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
    try protocol.requireProtocolVersion(envelope);
    const data_value = envelope.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    const object = data_value.object;
    try protocol.rejectUnknownFields(object, &.{"targets"});
    const targets_value = object.get("targets") orelse return error.MissingTargets;
    if (targets_value != .array) return error.InvalidTargets;
    var targets: std.array_list.Aligned(runtime_helper.host.RssTarget, null) = .empty;
    for (targets_value.array.items) |target_value| {
        try targets.append(allocator, try parseTarget(target_value));
    }
    return .{ .targets = try targets.toOwnedSlice(allocator) };
}

fn parseTarget(value: std.json.Value) RequestError!runtime_helper.host.RssTarget {
    assert(@sizeOf(runtime_helper.host.RssTarget) > 0);

    if (value != .object) return error.InvalidTarget;
    const object = value.object;
    try protocol.rejectUnknownFields(object, &.{ "pid", "statsPath" });
    const pid_value = object.get("pid") orelse return error.MissingPid;
    if (pid_value != .integer or pid_value.integer <= 0) return error.InvalidPid;
    if (pid_value.integer > std.math.maxInt(u32)) return error.InvalidPid;
    const stats_path_value = object.get("statsPath");
    const stats_path = if (stats_path_value) |stats_path| blk: {
        if (stats_path == .null) break :blk null;
        if (stats_path != .string) return error.InvalidStatsPath;
        break :blk stats_path.string;
    } else null;
    return .{ .pid = @intCast(pid_value.integer), .stats_path = stats_path };
}

fn writeRequestError(io: std.Io, err: RequestError) !void {
    assert(@errorName(err).len > 0);
    if (try protocol.writeCommonRequestError(io, err)) return;
    try protocol.writeError(io, "INVALID_REQUEST", @errorName(err));
}
