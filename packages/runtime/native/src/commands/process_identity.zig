const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;

pub const name = "process-identity";

const Request = struct {
    pid: u32,
};

const RequestError = error{
    MissingPid,
    InvalidPid,
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

    const identity = runtime_helper.host.readProcessIdentity(
        allocator,
        io,
        request.pid,
    ) catch |err| {
        try protocol.writeError(io, "REGISTRY_VM_NOT_FOUND", @errorName(err));
        return .fail;
    };
    defer if (identity) |observed| observed.deinit(allocator);

    try writeResponse(allocator, io, identity);
    return .ok;
}

const ResponseIdentity = struct {
    exeBase: []const u8,
    startedAtMs: ?i64 = null,
};

fn writeResponse(
    allocator: std.mem.Allocator,
    io: std.Io,
    identity: ?runtime_helper.host.ProcessIdentity,
) !void {
    assert(name.len > 0);

    const response_identity: ?ResponseIdentity = if (identity) |observed| .{
        .exeBase = observed.exe_base,
        .startedAtMs = observed.started_at_ms,
    } else null;
    try protocol.writeJson(allocator, io, .{
        .ok = true,
        .protocolVersion = @as(u8, protocol.version),
        .command = name,
        .data = .{ .identity = response_identity },
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
    try protocol.rejectUnknownFields(object, &.{"pid"});
    const pid_value = object.get("pid") orelse return error.MissingPid;
    if (pid_value != .integer or pid_value.integer <= 0) return error.InvalidPid;
    if (pid_value.integer > std.math.maxInt(u32)) return error.InvalidPid;
    return .{ .pid = @intCast(pid_value.integer) };
}

fn writeRequestError(io: std.Io, err: RequestError) !void {
    assert(@errorName(err).len > 0);
    if (try protocol.writeCommonRequestError(io, err)) return;
    try protocol.writeError(io, "INVALID_REQUEST", @errorName(err));
}
