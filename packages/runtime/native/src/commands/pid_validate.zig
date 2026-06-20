const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

pub const name = "pid-validate";

const Request = struct {
    pid: u32,
    vmm_exe: ?[]const u8 = null,
    started_at_ms: ?i64 = null,
};

const RequestError = error{
    MissingPid,
    InvalidPid,
    InvalidExpected,
    InvalidVmmExe,
    InvalidStartedAt,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const status = runtime_helper.host.validatePid(allocator, io, request.pid, .{
        .vmm_exe = request.vmm_exe,
        .started_at_ms = request.started_at_ms,
    }) catch |err| {
        try protocol.writeError(io, "REGISTRY_VM_NOT_FOUND", @errorName(err));
        return .fail;
    };

    const status_text = switch (status) {
        .alive => "alive",
        .dead => "dead",
        .recycled => "recycled",
    };
    const out = try std.fmt.allocPrint(
        allocator,
        "{{\"ok\":true,\"protocolVersion\":1,\"command\":\"pid-validate\",\"data\":{{\"status\":\"{s}\"}}}}\n",
        .{status_text},
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
    try protocol.rejectUnknownFields(object, &.{ "pid", "expected" });
    const pid_value = object.get("pid") orelse return error.MissingPid;
    if (pid_value != .integer or pid_value.integer <= 0 or pid_value.integer > std.math.maxInt(u32)) return error.InvalidPid;
    var request: Request = .{ .pid = @intCast(pid_value.integer) };
    if (object.get("expected")) |expected_value| {
        if (expected_value != .object) return error.InvalidExpected;
        const expected = expected_value.object;
        try protocol.rejectUnknownFields(expected, &.{ "vmmExe", "startedAt" });
        if (expected.get("vmmExe")) |vmm_exe| {
            if (vmm_exe != .string) return error.InvalidVmmExe;
            request.vmm_exe = vmm_exe.string;
        }
        if (expected.get("startedAt")) |started_at| {
            if (started_at != .integer) return error.InvalidStartedAt;
            request.started_at_ms = @intCast(started_at.integer);
        }
    }
    return request;
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
