const std = @import("std");

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

pub fn readStdinAll(allocator: std.mem.Allocator, io: std.Io, max_bytes: usize) RequestError![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);

    var buf: [4096]u8 = undefined;
    while (true) {
        const n = std.Io.File.stdin().readStreaming(io, &.{buf[0..]}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => |e| return e,
        };
        if (n == 0) break;
        if (out.items.len + n > max_bytes) return error.RequestTooLarge;
        try out.appendSlice(allocator, buf[0..n]);
    }
    return out.toOwnedSlice(allocator);
}

pub fn rejectUnknownFields(object: std.json.ObjectMap, allowed: []const []const u8) RequestError!void {
    var it = object.iterator();
    while (it.next()) |entry| {
        for (allowed) |field| {
            if (std.mem.eql(u8, entry.key_ptr.*, field)) break;
        } else {
            return error.UnknownField;
        }
    }
}

pub fn writeError(io: std.Io, code: []const u8, message: []const u8) !void {
    var buf: [1024]u8 = undefined;
    const payload = try std.fmt.bufPrint(
        &buf,
        "{{\"ok\":false,\"protocolVersion\":1,\"error\":{{\"code\":\"{s}\",\"message\":\"{s}\"}}}}\n",
        .{ code, message },
    );
    try stdout(io, payload);
}

pub fn stdout(io: std.Io, s: []const u8) !void {
    try std.Io.File.stdout().writeStreamingAll(io, s);
}
