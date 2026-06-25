const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;

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
    assert(name.len > 0);

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
    try protocol.writeJson(allocator, io, .{
        .ok = true,
        .protocolVersion = @as(u8, protocol.version),
        .command = name,
        .data = .{ .status = status_text },
    });
    return .ok;
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
    try protocol.rejectUnknownFields(object, &.{ "pid", "expected" });
    const pid_value = object.get("pid") orelse return error.MissingPid;
    if (pid_value != .integer or pid_value.integer <= 0) return error.InvalidPid;
    if (pid_value.integer > std.math.maxInt(u32)) return error.InvalidPid;
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
    assert(@errorName(err).len > 0);
    if (try protocol.writeCommonRequestError(io, err)) return;
    try protocol.writeError(io, "INVALID_REQUEST", @errorName(err));
}
