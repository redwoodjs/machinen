const std = @import("std");
const session = @import("session");

const Exit = enum(u8) { ok = 0, failed = 1, usage = 2 };

pub fn main(init: std.process.Init) !u8 {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const command = args.next() orelse return writeUsage(init.io);
    if (isHelp(command)) return writeHelp(init.io);
    if (!std.mem.eql(u8, command, "database")) return writeUsage(init.io);

    const operation = args.next() orelse return writeUsage(init.io);
    const path = args.next() orelse return writeUsage(init.io);
    if (args.next() != null) return writeUsage(init.io);

    if (!std.mem.eql(u8, operation, "init") and !std.mem.eql(u8, operation, "status")) {
        return writeUsage(init.io);
    }

    var store = session.Store.open(init.gpa, path) catch |err| {
        try writeError(init.gpa, init.io, err);
        return @intFromEnum(Exit.failed);
    };
    defer store.close();
    const info = store.info() catch |err| {
        try writeError(init.gpa, init.io, err);
        return @intFromEnum(Exit.failed);
    };
    const output = try std.fmt.allocPrint(
        init.gpa,
        "{{\"ok\":true,\"database\":\"{f}\",\"schemaVersion\":{d},\"sessions\":{d},\"events\":{d},\"checkpoints\":{d}}}\n",
        .{ std.zig.fmtString(path), info.schema_version, info.session_count, info.event_count, info.checkpoint_count },
    );
    defer init.gpa.free(output);
    try std.Io.File.stdout().writeStreamingAll(init.io, output);
    return @intFromEnum(Exit.ok);
}

fn writeError(allocator: std.mem.Allocator, io: std.Io, err: anyerror) !void {
    const output = try std.fmt.allocPrint(
        allocator,
        "{{\"ok\":false,\"error\":\"{f}\"}}\n",
        .{std.zig.fmtString(@errorName(err))},
    );
    defer allocator.free(output);
    try std.Io.File.stderr().writeStreamingAll(io, output);
}

fn writeUsage(io: std.Io) !u8 {
    try std.Io.File.stderr().writeStreamingAll(
        io,
        "usage: machinen-session database <init|status> <path>\n",
    );
    return @intFromEnum(Exit.usage);
}

fn writeHelp(io: std.Io) !u8 {
    try std.Io.File.stdout().writeStreamingAll(io,
        \\machinen-session — portable terminal session core
        \\
        \\Usage:
        \\  machinen-session database init <path>
        \\  machinen-session database status <path>
        \\
        \\This first slice initializes and inspects the durable SQLite store.
        \\PTY ownership and attach commands will be added on top of this store.
        \\
    );
    return @intFromEnum(Exit.ok);
}

fn isHelp(value: []const u8) bool {
    return std.mem.eql(u8, value, "help") or
        std.mem.eql(u8, value, "--help") or
        std.mem.eql(u8, value, "-h");
}

test "help aliases remain stable" {
    try std.testing.expect(isHelp("help"));
    try std.testing.expect(isHelp("--help"));
    try std.testing.expect(!isHelp("database"));
}
