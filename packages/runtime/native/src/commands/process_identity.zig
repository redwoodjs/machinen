const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

pub const name = "process-identity";

const Request = struct {
    pid: u32,
};

const RequestError = error{
    MissingPid,
    InvalidPid,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const identity = runtime_helper.host.readProcessIdentity(allocator, io, request.pid) catch |err| {
        try protocol.writeError(io, "REGISTRY_VM_NOT_FOUND", @errorName(err));
        return .fail;
    };
    defer if (identity) |observed| observed.deinit(allocator);

    const out = try formatResponse(allocator, identity);
    defer allocator.free(out);
    try protocol.stdout(io, out);
    return .ok;
}

fn formatResponse(allocator: std.mem.Allocator, identity: ?runtime_helper.host.ProcessIdentity) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    try out.appendSlice(allocator, "{\"ok\":true,\"protocolVersion\":1,\"command\":\"process-identity\",\"data\":{");
    if (identity) |observed| {
        try out.appendSlice(allocator, "\"identity\":{\"exeBase\":");
        try appendJsonString(allocator, &out, observed.exe_base);
        if (observed.started_at_ms) |started_at_ms| {
            const part = try std.fmt.allocPrint(allocator, ",\"startedAtMs\":{d}", .{started_at_ms});
            defer allocator.free(part);
            try out.appendSlice(allocator, part);
        }
        try out.append(allocator, '}');
    } else {
        try out.appendSlice(allocator, "\"identity\":null");
    }
    try out.appendSlice(allocator, "}}\n");
    return out.toOwnedSlice(allocator);
}

fn appendJsonString(allocator: std.mem.Allocator, out: *std.ArrayList(u8), value: []const u8) !void {
    try out.append(allocator, '"');
    for (value) |c| {
        switch (c) {
            '"' => try out.appendSlice(allocator, "\\\""),
            '\\' => try out.appendSlice(allocator, "\\\\"),
            '\n' => try out.appendSlice(allocator, "\\n"),
            '\r' => try out.appendSlice(allocator, "\\r"),
            '\t' => try out.appendSlice(allocator, "\\t"),
            else => if (c < 0x20) {
                const escaped = try std.fmt.allocPrint(allocator, "\\u{x:0>4}", .{c});
                defer allocator.free(escaped);
                try out.appendSlice(allocator, escaped);
            } else {
                try out.append(allocator, c);
            },
        }
    }
    try out.append(allocator, '"');
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
    try protocol.rejectUnknownFields(object, &.{"pid"});
    const pid_value = object.get("pid") orelse return error.MissingPid;
    if (pid_value != .integer or pid_value.integer <= 0 or pid_value.integer > std.math.maxInt(u32)) return error.InvalidPid;
    return .{ .pid = @intCast(pid_value.integer) };
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
