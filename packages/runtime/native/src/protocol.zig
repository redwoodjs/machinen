// JSON protocol shared by TypeScript and the native runtime helper.
//
// The TS side starts `machinen-runtime-helper <command>`, writes one JSON
// request to stdin, and reads one JSON response from stdout.
//
// Request shape:
//
//   { "protocolVersion": 1, "data": { ... } }
//
// Success response shape:
//
//   { "ok": true, "protocolVersion": 1, "command": "...", "data": { ... } }
//
// Error response shape:
//
//   { "ok": false, "protocolVersion": 1, "error": { "code": "...", "message": "..." } }
//
// Keep command implementations small: parse/validate the request, call the
// native implementation, and use `writeJson` / `writeError` for responses.

const std = @import("std");

const assert = std.debug.assert;

pub const version = 1;
pub const max_request_bytes = 1024 * 1024;

pub const Exit = enum(u8) { ok = 0, fail = 1, usage = 2 };

pub const RequestError = error{
    RequestTooLarge,
    InvalidJson,
    InvalidShape,
    UnknownField,
    UnsupportedProtocolVersion,
    MissingData,
    InvalidData,
} || std.mem.Allocator.Error || std.Io.File.ReadStreamingError;

pub fn readStdinAll(
    allocator: std.mem.Allocator,
    io: std.Io,
    max_bytes: u64,
) RequestError![]u8 {
    assert(max_bytes > 0);

    var out: std.array_list.Aligned(u8, null) = .empty;
    errdefer out.deinit(allocator);

    var buf: [4096]u8 = undefined;
    // EOF-bounded: stdin readStreaming reports EndOfStream when input is done.
    while (true) {
        const n = std.Io.File.stdin().readStreaming(io, &.{buf[0..]}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => |e| return e,
        };
        if (n == 0) break;
        const next_len = out.items.len + n;
        if (@as(u64, @intCast(next_len)) > max_bytes) return error.RequestTooLarge;
        try out.appendSlice(allocator, buf[0..n]);
        assert(@as(u64, @intCast(out.items.len)) <= max_bytes);
    }
    return out.toOwnedSlice(allocator);
}

pub fn rejectUnknownFields(
    object: std.json.ObjectMap,
    allowed: []const []const u8,
) RequestError!void {
    assert(version == 1);

    var it = object.iterator();
    while (it.next()) |entry| {
        for (allowed) |field| {
            if (std.mem.eql(u8, entry.key_ptr.*, field)) break;
        } else {
            return error.UnknownField;
        }
    }
}

pub fn requireProtocolVersion(envelope: std.json.ObjectMap) RequestError!void {
    assert(version == 1);

    const protocol_version = envelope.get("protocolVersion") orelse
        return error.UnsupportedProtocolVersion;
    if (protocol_version != .integer) return error.UnsupportedProtocolVersion;
    if (protocol_version.integer != version) return error.UnsupportedProtocolVersion;
}

pub fn writeCommonRequestError(io: std.Io, err: anyerror) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.RequestTooLarge => try writeError(
            io,
            "REQUEST_TOO_LARGE",
            "request JSON exceeds the maximum size",
        ),
        error.UnknownField => try writeError(
            io,
            "UNKNOWN_FIELD",
            "request contains an unknown field",
        ),
        error.UnsupportedProtocolVersion => try writeError(
            io,
            "UNSUPPORTED_PROTOCOL_VERSION",
            "request protocolVersion must be 1",
        ),
        error.MissingData => try writeError(
            io,
            "INVALID_REQUEST",
            "request must include a data object",
        ),
        error.InvalidData => try writeError(
            io,
            "INVALID_REQUEST",
            "request data field must be an object",
        ),
        error.InvalidJson => try writeError(
            io,
            "INVALID_JSON",
            "request body is not valid JSON",
        ),
        error.InvalidShape => try writeError(
            io,
            "INVALID_REQUEST",
            "request body must be a JSON object",
        ),
        else => return false,
    }
    return true;
}

pub fn writeError(io: std.Io, code: []const u8, message: []const u8) !void {
    assert(code.len > 0);
    assert(message.len > 0);

    try stdout(io, "{\"ok\":false,\"protocolVersion\":1,\"error\":{\"code\":");
    try writeJsonString(io, code);
    try stdout(io, ",\"message\":");
    try writeJsonString(io, message);
    try stdout(io, "}}\n");
}

pub fn writeJsonString(io: std.Io, s: []const u8) !void {
    assert(s.len > 0);

    try stdout(io, "\"");
    var start: @TypeOf(s.len) = 0;
    for (s, 0..) |c, i| {
        const replacement: ?[]const u8 = switch (c) {
            '"' => "\\\"",
            '\\' => "\\\\",
            '\n' => "\\n",
            '\r' => "\\r",
            '\t' => "\\t",
            else => if (c < 0x20) "" else null,
        };
        if (replacement) |r| {
            if (i > start) try stdout(io, s[start..i]);
            if (r.len == 0) {
                var buf: [6]u8 = undefined;
                const escaped = try std.fmt.bufPrint(&buf, "\\u00{x:0>2}", .{c});
                try stdout(io, escaped);
            } else {
                try stdout(io, r);
            }
            start = i + 1;
        }
    }
    if (start < s.len) try stdout(io, s[start..]);
    try stdout(io, "\"");
}

pub fn writeJson(allocator: std.mem.Allocator, io: std.Io, value: anytype) !void {
    assert(version == 1);

    const payload = try std.json.Stringify.valueAlloc(allocator, value, .{});
    defer allocator.free(payload);
    try stdout(io, payload);
    try stdout(io, "\n");
}

pub fn stdout(io: std.Io, s: []const u8) !void {
    assert(s.len > 0);
    try std.Io.File.stdout().writeStreamingAll(io, s);
}
