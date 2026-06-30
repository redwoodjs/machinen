const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;

pub const name = "reflink-copy";

const Request = struct {
    src: []const u8,
    dst: []const u8,
};

const RequestError = error{
    MissingSrc,
    InvalidSrc,
    MissingDst,
    InvalidDst,
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

    const result = runtime_helper.reflink.reflinkCopy(
        allocator,
        io,
        request.src,
        request.dst,
    ) catch |err| {
        try protocol.writeError(io, "BOOT_PACK_FAILED", @errorName(err));
        return .fail;
    };

    const mode = switch (result.mode) {
        .cow => "cow",
        .copy => "copy",
    };
    const primitive = switch (result.primitive) {
        .darwin_cp_c => "darwin-cp-c",
        .node_ficlone_force => "node-ficlone-force",
        .linux_cp_sparse => "linux-cp-sparse",
        .node_copy => "node-copy",
    };
    if (result.fallback_reason) |fallback_reason| {
        var reason_buf: [64]u8 = undefined;
        const reason = try runtime_helper.reflink.fallbackReasonText(
            &reason_buf,
            fallback_reason,
        );
        try protocol.writeJson(allocator, io, .{
            .ok = true,
            .protocolVersion = @as(u8, protocol.version),
            .command = name,
            .data = .{
                .mode = mode,
                .primitive = primitive,
                .fallbackReason = reason,
            },
        });
    } else {
        try protocol.writeJson(allocator, io, .{
            .ok = true,
            .protocolVersion = @as(u8, protocol.version),
            .command = name,
            .data = .{ .mode = mode, .primitive = primitive },
        });
    }
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
    const protocol_version =
        envelope.get("protocolVersion") orelse return error.UnsupportedProtocolVersion;
    if (protocol_version != .integer or protocol_version.integer != protocol.version) {
        return error.UnsupportedProtocolVersion;
    }
    const data_value = envelope.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    const object = data_value.object;
    try protocol.rejectUnknownFields(object, &.{ "src", "dst" });
    const src = object.get("src") orelse return error.MissingSrc;
    if (src != .string) return error.InvalidSrc;
    const dst = object.get("dst") orelse return error.MissingDst;
    if (dst != .string) return error.InvalidDst;
    return .{ .src = src.string, .dst = dst.string };
}

fn writeRequestError(io: std.Io, err: RequestError) !void {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.RequestTooLarge => try protocol.writeError(
            io,
            "REQUEST_TOO_LARGE",
            "request JSON exceeds the maximum size",
        ),
        error.UnknownField => try protocol.writeError(
            io,
            "UNKNOWN_FIELD",
            "request contains an unknown field",
        ),
        error.UnsupportedProtocolVersion => try protocol.writeError(
            io,
            "UNSUPPORTED_PROTOCOL_VERSION",
            "request protocolVersion must be 1",
        ),
        error.MissingData => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "request must include a data object",
        ),
        error.InvalidData => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "request data field must be an object",
        ),
        error.InvalidJson => try protocol.writeError(
            io,
            "INVALID_JSON",
            "request body is not valid JSON",
        ),
        error.InvalidShape => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "request body must be a JSON object",
        ),
        error.MissingSrc => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "reflink-copy request data must include a string src field",
        ),
        error.InvalidSrc => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "reflink-copy src field must be a string",
        ),
        error.MissingDst => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "reflink-copy request data must include a string dst field",
        ),
        error.InvalidDst => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "reflink-copy dst field must be a string",
        ),
        else => try protocol.writeError(io, "INVALID_REQUEST", @errorName(err)),
    }
}
