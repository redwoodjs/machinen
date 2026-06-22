const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

pub const name = "process-signal";

const Request = struct {
    pid: u32,
    signal: runtime_helper.lifecycle.Signal,
};

const RequestError = error{
    MissingPid,
    InvalidPid,
    MissingSignal,
    InvalidSignal,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const result = runtime_helper.lifecycle.signalProcess(request.pid, request.signal) catch |err| {
        try writeSignalError(io, err);
        return .fail;
    };

    try protocol.stdout(io, "{\"ok\":true,\"protocolVersion\":1,\"command\":\"process-signal\",\"data\":{");
    try protocol.stdout(io, "\"signaled\":");
    try protocol.stdout(io, if (result.signaled) "true" else "false");
    try protocol.stdout(io, ",\"alive\":");
    try protocol.stdout(io, if (result.alive) "true" else "false");
    try protocol.stdout(io, "}}\n");
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
    try protocol.rejectUnknownFields(object, &.{ "pid", "signal" });

    const pid_value = object.get("pid") orelse return error.MissingPid;
    if (pid_value != .integer or pid_value.integer <= 0 or pid_value.integer > std.math.maxInt(u32)) return error.InvalidPid;
    const signal_value = object.get("signal") orelse return error.MissingSignal;
    if (signal_value != .string) return error.InvalidSignal;
    const signal = runtime_helper.lifecycle.parseSignal(signal_value.string) orelse return error.InvalidSignal;

    return .{ .pid = @intCast(pid_value.integer), .signal = signal };
}

fn writeSignalError(io: std.Io, err: runtime_helper.lifecycle.ProcessSignalError) !void {
    switch (err) {
        error.InvalidPid => try protocol.writeError(io, "INVALID_REQUEST", "pid must be a positive process id"),
        error.InvalidSignal => try protocol.writeError(io, "INVALID_REQUEST", "signal must be SIGTERM, SIGKILL, or 0"),
        error.PermissionDenied => try protocol.writeError(io, "PROCESS_SIGNAL_DENIED", "permission denied while signalling process"),
        error.Unexpected => try protocol.writeError(io, "PROCESS_SIGNAL_FAILED", "unexpected error while signalling process"),
    }
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
        error.MissingPid => try protocol.writeError(io, "INVALID_REQUEST", "pid is required"),
        error.InvalidPid => try protocol.writeError(io, "INVALID_REQUEST", "pid must be a positive process id"),
        error.MissingSignal => try protocol.writeError(io, "INVALID_REQUEST", "signal is required"),
        error.InvalidSignal => try protocol.writeError(io, "INVALID_REQUEST", "signal must be SIGTERM, SIGKILL, or 0"),
        else => try protocol.writeError(io, "INVALID_REQUEST", @errorName(err)),
    }
}
