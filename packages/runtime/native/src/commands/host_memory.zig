const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;

pub const name = "host-memory";

const RequestError = protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    assert(name.len > 0);

    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const memory = runtime_helper.host.readHostMemory(allocator, io) catch |err| {
        switch (err) {
            error.UnsupportedHostMemory => try protocol.writeError(
                io,
                "FORK_MEMORY_BACKPRESSURE",
                "host memory probing is unsupported on this platform",
            ),
            else => try protocol.writeError(io, "FORK_MEMORY_BACKPRESSURE", @errorName(err)),
        }
        return .fail;
    };

    try protocol.writeJson(allocator, io, .{
        .ok = true,
        .protocolVersion = @as(u8, protocol.version),
        .command = name,
        .data = .{
            .freeBytes = memory.free_bytes,
            .totalBytes = memory.total_bytes,
        },
    });
    return .ok;
}

fn parseRequest(allocator: std.mem.Allocator, io: std.Io) RequestError!void {
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
    try protocol.rejectUnknownFields(data_value.object, &.{});
}

fn writeRequestError(io: std.Io, err: RequestError) !void {
    assert(@errorName(err).len > 0);
    if (try protocol.writeCommonRequestError(io, err)) return;
    try protocol.writeError(io, "INVALID_REQUEST", @errorName(err));
}
