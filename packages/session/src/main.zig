const std = @import("std");
const session = @import("session");
const worker = @import("worker");

const Exit = enum(u8) { ok = 0, failed = 1, usage = 2 };

pub fn main(init: std.process.Init) !u8 {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const command = args.next() orelse return writeUsage(init.io);
    if (isHelp(command)) return writeHelp(init.io);

    if (std.mem.eql(u8, command, "database")) return runDatabase(init, &args);
    if (std.mem.eql(u8, command, "new")) return runNew(init, &args);
    if (std.mem.eql(u8, command, "list")) return runList(init, &args);
    if (std.mem.eql(u8, command, "attach")) return runAttach(init, &args);
    return writeUsage(init.io);
}

fn runDatabase(init: std.process.Init, args: anytype) !u8 {
    const operation = args.next() orelse return writeUsage(init.io);
    const path = args.next() orelse return writeUsage(init.io);
    if (args.next() != null) return writeUsage(init.io);
    if (!std.mem.eql(u8, operation, "init") and !std.mem.eql(u8, operation, "status")) {
        return writeUsage(init.io);
    }

    var store = session.Store.open(init.gpa, path) catch |err| return fail(init, err);
    defer store.close();
    const info = store.info() catch |err| return fail(init, err);
    try writeJson(init.gpa, init.io, .{
        .ok = true,
        .database = path,
        .schemaVersion = info.schema_version,
        .sessions = info.session_count,
        .events = info.event_count,
        .checkpoints = info.checkpoint_count,
    });
    return @intFromEnum(Exit.ok);
}

fn runNew(init: std.process.Init, args: anytype) !u8 {
    var database: ?[]const u8 = null;
    var id: ?[]const u8 = null;
    var name: ?[]const u8 = null;
    var working_directory: ?[]const u8 = null;
    var rows: u16 = 24;
    var columns: u16 = 80;
    var command: std.ArrayList([]const u8) = .empty;
    defer command.deinit(init.gpa);

    while (args.next()) |argument| {
        if (std.mem.eql(u8, argument, "--")) {
            while (args.next()) |item| try command.append(init.gpa, item);
            break;
        }
        if (std.mem.eql(u8, argument, "--database")) {
            database = args.next() orelse return writeUsage(init.io);
        } else if (std.mem.eql(u8, argument, "--id")) {
            id = args.next() orelse return writeUsage(init.io);
        } else if (std.mem.eql(u8, argument, "--name")) {
            name = args.next() orelse return writeUsage(init.io);
        } else if (std.mem.eql(u8, argument, "--cwd")) {
            working_directory = args.next() orelse return writeUsage(init.io);
        } else if (std.mem.eql(u8, argument, "--rows")) {
            rows = parseDimension(args.next() orelse return writeUsage(init.io)) catch return writeUsage(init.io);
        } else if (std.mem.eql(u8, argument, "--columns")) {
            columns = parseDimension(args.next() orelse return writeUsage(init.io)) catch return writeUsage(init.io);
        } else {
            return writeUsage(init.io);
        }
    }
    if (database == null or id == null or working_directory == null or command.items.len == 0) {
        return writeUsage(init.io);
    }

    const argv_json = try std.json.Stringify.valueAlloc(init.gpa, command.items, .{});
    defer init.gpa.free(argv_json);
    const spawned = worker.spawnDetached(.{
        .database_path = database.?,
        .id = id.?,
        .name = name,
        .working_directory = working_directory.?,
        .argv_json = argv_json,
        .command = command.items,
        .rows = rows,
        .columns = columns,
    }) catch |err| return fail(init, err);
    try writeJson(init.gpa, init.io, .{
        .ok = true,
        .id = id.?,
        .name = name,
        .workerPid = spawned.worker_pid,
    });
    return @intFromEnum(Exit.ok);
}

const SessionView = struct {
    id: []const u8,
    name: ?[]const u8,
    state: []const u8,
    workingDirectory: []const u8,
    rows: u32,
    columns: u32,
    lastSequence: u64,
    workerPid: ?i64,
    exitCode: ?i32,
};

fn runList(init: std.process.Init, args: anytype) !u8 {
    const database = requiredDatabase(args) catch return writeUsage(init.io);
    var store = session.Store.open(init.gpa, database) catch |err| return fail(init, err);
    defer store.close();
    const records = store.listSessions(init.gpa) catch |err| return fail(init, err);
    defer freeSessions(init.gpa, records);
    var views: std.ArrayList(SessionView) = .empty;
    defer views.deinit(init.gpa);
    for (records) |record| try views.append(init.gpa, .{
        .id = record.id,
        .name = record.name,
        .state = @tagName(record.state),
        .workingDirectory = record.working_directory,
        .rows = record.rows,
        .columns = record.columns,
        .lastSequence = record.last_sequence,
        .workerPid = record.worker_pid,
        .exitCode = record.exit_code,
    });
    try writeJson(init.gpa, init.io, .{ .ok = true, .sessions = views.items });
    return @intFromEnum(Exit.ok);
}

fn runAttach(init: std.process.Init, args: anytype) !u8 {
    var database: ?[]const u8 = null;
    var reference: ?[]const u8 = null;
    while (args.next()) |argument| {
        if (std.mem.eql(u8, argument, "--database")) {
            database = args.next() orelse return writeUsage(init.io);
        } else if (reference == null) {
            reference = argument;
        } else return writeUsage(init.io);
    }
    if (database == null or reference == null) return writeUsage(init.io);

    var store = session.Store.open(init.gpa, database.?) catch |err| return fail(init, err);
    defer store.close();
    var record = (store.resolveSession(reference.?) catch |err| return fail(init, err)) orelse
        return fail(init, error.SessionNotFound);
    defer record.deinit(init.gpa);
    if (record.state == .exited) {
        const events = store.eventsAfter(init.gpa, record.id, 0) catch |err| return fail(init, err);
        defer freeEvents(init.gpa, events);
        for (events) |event| {
            if (event.kind == .output) try std.Io.File.stdout().writeStreamingAll(init.io, event.payload);
        }
        const code = record.exit_code orelse 0;
        if (code < 0) return @intFromEnum(Exit.failed);
        return @intCast(@min(code, 255));
    }
    return worker.attach(init.gpa, record.id) catch |err| return fail(init, err);
}

fn requiredDatabase(args: anytype) ![]const u8 {
    const flag = args.next() orelse return error.MissingDatabase;
    if (!std.mem.eql(u8, flag, "--database")) return error.MissingDatabase;
    const database = args.next() orelse return error.MissingDatabase;
    if (args.next() != null) return error.UnexpectedArgument;
    return database;
}

fn parseDimension(value: []const u8) !u16 {
    const parsed = try std.fmt.parseInt(u16, value, 10);
    if (parsed == 0) return error.InvalidDimension;
    return parsed;
}

fn fail(init: std.process.Init, err: anyerror) !u8 {
    try writeJsonTo(init.gpa, init.io, std.Io.File.stderr(), .{
        .ok = false,
        .@"error" = @errorName(err),
    });
    return @intFromEnum(Exit.failed);
}

fn writeJson(allocator: std.mem.Allocator, io: std.Io, value: anytype) !void {
    try writeJsonTo(allocator, io, std.Io.File.stdout(), value);
}

fn writeJsonTo(allocator: std.mem.Allocator, io: std.Io, file: std.Io.File, value: anytype) !void {
    const output = try std.json.Stringify.valueAlloc(allocator, value, .{});
    defer allocator.free(output);
    try file.writeStreamingAll(io, output);
    try file.writeStreamingAll(io, "\n");
}

fn freeSessions(allocator: std.mem.Allocator, records: []session.Session) void {
    for (records) |*record| record.deinit(allocator);
    allocator.free(records);
}

fn freeEvents(allocator: std.mem.Allocator, events: []session.Event) void {
    for (events) |*event| event.deinit(allocator);
    allocator.free(events);
}

fn writeUsage(io: std.Io) !u8 {
    try std.Io.File.stderr().writeStreamingAll(
        io,
        "usage: machinen-session <new|list|attach|database|help> ...\n",
    );
    return @intFromEnum(Exit.usage);
}

fn writeHelp(io: std.Io) !u8 {
    try std.Io.File.stdout().writeStreamingAll(io,
        \\machinen-session — portable terminal session multiplexer
        \\
        \\Usage:
        \\  machinen-session database init <path>
        \\  machinen-session database status <path>
        \\  machinen-session new --database <path> --id <id> [--name <name>]
        \\      --cwd <path> [--rows <n>] [--columns <n>] -- <command> [args...]
        \\  machinen-session list --database <path>
        \\  machinen-session attach --database <path> <id-or-name>
        \\
        \\A detached worker owns each PTY. Closing an attach client does not stop
        \\the command. A new client receives SQLite-backed output history before
        \\joining the live stream.
        \\
    );
    return @intFromEnum(Exit.ok);
}

fn isHelp(value: []const u8) bool {
    return std.mem.eql(u8, value, "help") or
        std.mem.eql(u8, value, "--help") or
        std.mem.eql(u8, value, "-h");
}

test "help aliases and dimensions remain stable" {
    try std.testing.expect(isHelp("help"));
    try std.testing.expect(isHelp("--help"));
    try std.testing.expect(!isHelp("database"));
    try std.testing.expectEqual(@as(u16, 120), try parseDimension("120"));
    try std.testing.expectError(error.InvalidDimension, parseDimension("0"));
}
