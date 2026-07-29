const std = @import("std");
const session = @import("session");
const worker = @import("worker");

const Exit = enum(u8) { ok = 0, failed = 1, usage = 2 };
const version = "0.5.1";

pub fn main(init: std.process.Init) !u8 {
    var args = init.minimal.args.iterate();
    _ = args.next();
    const command = args.next() orelse return writeUsage(init.io);
    if (isHelp(command)) return writeHelp(init.io);
    if (std.mem.eql(u8, command, "--version") or std.mem.eql(u8, command, "version")) {
        try std.Io.File.stdout().writeStreamingAll(init.io, version ++ "\n");
        return @intFromEnum(Exit.ok);
    }

    if (std.mem.eql(u8, command, "database")) return runDatabase(init, &args);
    if (std.mem.eql(u8, command, "new")) return runNew(init, &args);
    if (std.mem.eql(u8, command, "list")) return runList(init, &args);
    if (std.mem.eql(u8, command, "inspect")) return runInspect(init, &args);
    if (std.mem.eql(u8, command, "attach")) return runAttach(init, &args);
    if (std.mem.eql(u8, command, "send")) return runSend(init, &args);
    if (std.mem.eql(u8, command, "signal")) return runSignal(init, &args);
    if (std.mem.eql(u8, command, "stop")) return runStop(init, &args);
    if (std.mem.eql(u8, command, "delete")) return runDelete(init, &args);
    if (std.mem.eql(u8, command, "reconcile")) return runReconcile(init, &args);
    if (std.mem.eql(u8, command, "gc")) return runGc(init, &args);
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
    var checkpoint_bytes: u32 = 256 * 1024;
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
            rows = parseDimension(
                args.next() orelse return writeUsage(init.io),
            ) catch return writeUsage(init.io);
        } else if (std.mem.eql(u8, argument, "--columns")) {
            columns = parseDimension(
                args.next() orelse return writeUsage(init.io),
            ) catch return writeUsage(init.io);
        } else if (std.mem.eql(u8, argument, "--checkpoint-bytes")) {
            checkpoint_bytes = parseCheckpointBytes(
                args.next() orelse return writeUsage(init.io),
            ) catch return writeUsage(init.io);
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
        .checkpoint_bytes = checkpoint_bytes,
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
    protocolVersion: u32,
    createdAtMs: i64,
    updatedAtMs: i64,
};

fn runList(init: std.process.Init, args: anytype) !u8 {
    const database = requiredDatabase(args) catch return writeUsage(init.io);
    var store = session.Store.open(init.gpa, database) catch |err| return fail(init, err);
    defer store.close();
    _ = reconcileStore(init.gpa, &store) catch |err| return fail(init, err);
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
        .protocolVersion = record.protocol_version,
        .createdAtMs = record.created_at_ms,
        .updatedAtMs = record.updated_at_ms,
    });
    try writeJson(init.gpa, init.io, .{ .ok = true, .sessions = views.items });
    return @intFromEnum(Exit.ok);
}

const TelemetryView = struct {
    activity: []const u8,
    shellPid: ?i32,
    processPid: ?i32,
    shellName: ?[]const u8,
    command: ?[]const u8,
};

fn runInspect(init: std.process.Init, args: anytype) !u8 {
    const target = parseTarget(args) catch return writeUsage(init.io);
    var store = session.Store.open(init.gpa, target.database) catch |err| return fail(init, err);
    defer store.close();
    var record = (store.resolveSession(target.reference) catch |err| return fail(init, err)) orelse
        return fail(init, error.SessionNotFound);
    defer record.deinit(init.gpa);
    std.debug.assert(record.id.len > 0);
    const telemetry = if (record.state == .running or record.state == .created)
        worker.queryTelemetry(
            init.gpa,
            record.id,
            record.protocol_version,
            record.last_sequence,
        ) catch null
    else
        null;
    const view: TelemetryView = if (telemetry) |value| .{
        .activity = @tagName(value.activity),
        .shellPid = if (value.shell_pid > 0) value.shell_pid else null,
        .processPid = if (value.process_pid > 0) value.process_pid else null,
        .shellName = if (value.shell_name_length > 0) value.shellName() else null,
        .command = if (value.command_length > 0) value.commandName() else null,
    } else .{
        .activity = "unknown",
        .shellPid = null,
        .processPid = null,
        .shellName = null,
        .command = null,
    };
    try writeJson(init.gpa, init.io, .{ .ok = true, .telemetry = view });
    return @intFromEnum(Exit.ok);
}

fn runAttach(init: std.process.Init, args: anytype) !u8 {
    var database: ?[]const u8 = null;
    var reference: ?[]const u8 = null;
    var after_sequence: u64 = 0;
    var read_only = false;
    var latest_screen = false;
    while (args.next()) |argument| {
        if (std.mem.eql(u8, argument, "--latest-screen")) {
            latest_screen = true;
            continue;
        }
        if (std.mem.eql(u8, argument, "--database")) {
            database = args.next() orelse return writeUsage(init.io);
        } else if (std.mem.eql(u8, argument, "--after")) {
            after_sequence = std.fmt.parseInt(
                u64,
                args.next() orelse return writeUsage(init.io),
                10,
            ) catch return writeUsage(init.io);
        } else if (std.mem.eql(u8, argument, "--read-only")) {
            read_only = true;
        } else if (reference == null) {
            reference = argument;
        } else return writeUsage(init.io);
    }
    if (database == null or reference == null) return writeUsage(init.io);

    var store = session.Store.open(init.gpa, database.?) catch |err| return fail(init, err);
    defer store.close();
    var record = (store.resolveSession(reference.?) catch |err| return fail(init, err)) orelse
        return fail(init, error.SessionNotFound);
    if ((record.state == .running or record.state == .created) and
        !worker.workerReachable(init.gpa, record.id))
    {
        store.markOrphaned(record.id) catch |err| {
            record.deinit(init.gpa);
            return fail(init, err);
        };
        record.state = .orphaned;
    }
    defer record.deinit(init.gpa);
    if (record.state != .running and record.state != .created) {
        replayStored(init, &store, record.id, after_sequence) catch |err| return fail(init, err);
        if (record.state == .exited) {
            const code = record.exit_code orelse 0;
            if (code < 0) return @intFromEnum(Exit.failed);
            return @intCast(@min(code, 255));
        }
        return fail(init, error.SessionNotLive);
    }
    return worker.attach(init.gpa, record.id, .{
        .protocol = record.protocol_version,
        .after_sequence = after_sequence,
        .read_only = read_only,
        .latest_screen = latest_screen,
    }) catch |err| return fail(init, err);
}

fn replayStored(
    init: std.process.Init,
    store: *session.Store,
    session_id: []const u8,
    requested_after: u64,
) !void {
    var after_sequence = requested_after;
    if (try store.latestCheckpoint(init.gpa, session_id)) |checkpoint_value| {
        var checkpoint = checkpoint_value;
        defer checkpoint.deinit(init.gpa);
        if (after_sequence < checkpoint.sequence) {
            try std.Io.File.stdout().writeStreamingAll(init.io, checkpoint.payload);
            after_sequence = checkpoint.sequence;
        }
    }
    const events = try store.eventsAfter(init.gpa, session_id, after_sequence);
    defer freeEvents(init.gpa, events);
    for (events) |event| {
        if (event.kind == .output) {
            try std.Io.File.stdout().writeStreamingAll(init.io, event.payload);
        }
    }
}

fn runSend(init: std.process.Init, args: anytype) !u8 {
    const target = parseTarget(args) catch return writeUsage(init.io);
    const input = readStdinAll(init.gpa, init.io, 1024 * 1024) catch |err| return fail(init, err);
    defer init.gpa.free(input);
    var store = session.Store.open(init.gpa, target.database) catch |err| return fail(init, err);
    defer store.close();
    var record = (store.resolveSession(target.reference) catch |err| return fail(init, err)) orelse
        return fail(init, error.SessionNotFound);
    defer record.deinit(init.gpa);
    worker.sendInput(
        init.gpa,
        record.id,
        record.protocol_version,
        record.last_sequence,
        input,
    ) catch |err| return fail(init, err);
    return @intFromEnum(Exit.ok);
}

fn runSignal(init: std.process.Init, args: anytype) !u8 {
    const target = parseTargetWithValue(args) catch return writeUsage(init.io);
    const signal: i32 = if (std.mem.eql(u8, target.value, "interrupt"))
        2
    else if (std.mem.eql(u8, target.value, "hangup"))
        1
    else if (std.mem.eql(u8, target.value, "terminate"))
        15
    else if (std.mem.eql(u8, target.value, "kill"))
        9
    else
        return writeUsage(init.io);
    return sendSignal(init, target.database, target.reference, signal);
}

fn runStop(init: std.process.Init, args: anytype) !u8 {
    const target = parseTarget(args) catch return writeUsage(init.io);
    // Interactive shells commonly ignore SIGTERM. A terminal stop is a
    // controlling-terminal hangup, matching what happens when a PTY master is
    // intentionally closed.
    return sendSignal(init, target.database, target.reference, 1);
}

fn sendSignal(
    init: std.process.Init,
    database: []const u8,
    reference: []const u8,
    signal: i32,
) !u8 {
    var store = session.Store.open(init.gpa, database) catch |err| return fail(init, err);
    defer store.close();
    var record = (store.resolveSession(reference) catch |err| return fail(init, err)) orelse
        return fail(init, error.SessionNotFound);
    defer record.deinit(init.gpa);
    worker.sendSignal(
        init.gpa,
        record.id,
        record.protocol_version,
        record.last_sequence,
        signal,
    ) catch |err| return fail(init, err);
    return @intFromEnum(Exit.ok);
}

fn runDelete(init: std.process.Init, args: anytype) !u8 {
    const target = parseTarget(args) catch return writeUsage(init.io);
    var store = session.Store.open(init.gpa, target.database) catch |err| return fail(init, err);
    defer store.close();
    var record = (store.resolveSession(target.reference) catch |err| return fail(init, err)) orelse
        return fail(init, error.SessionNotFound);
    defer record.deinit(init.gpa);
    if (record.state == .running or record.state == .created) {
        return fail(init, error.SessionStillRunning);
    }
    store.deleteSession(record.id) catch |err| return fail(init, err);
    return @intFromEnum(Exit.ok);
}

fn runReconcile(init: std.process.Init, args: anytype) !u8 {
    const database = requiredDatabase(args) catch return writeUsage(init.io);
    var store = session.Store.open(init.gpa, database) catch |err| return fail(init, err);
    defer store.close();
    const orphaned = reconcileStore(init.gpa, &store) catch |err| return fail(init, err);
    try writeJson(init.gpa, init.io, .{ .ok = true, .orphaned = orphaned });
    return @intFromEnum(Exit.ok);
}

fn reconcileStore(allocator: std.mem.Allocator, store: *session.Store) !u64 {
    const records = try store.listSessions(allocator);
    defer freeSessions(allocator, records);
    var orphaned: u64 = 0;
    for (records) |record| {
        if ((record.state == .running or record.state == .created) and
            !worker.workerReachable(allocator, record.id))
        {
            try store.markOrphaned(record.id);
            worker.removeStaleSocket(allocator, record.id);
            orphaned += 1;
        }
    }
    return orphaned;
}

fn runGc(init: std.process.Init, args: anytype) !u8 {
    var database: ?[]const u8 = null;
    var older_than_seconds: u64 = 7 * 24 * 60 * 60;
    var dry_run = false;
    while (args.next()) |argument| {
        if (std.mem.eql(u8, argument, "--database")) {
            database = args.next() orelse return writeUsage(init.io);
        } else if (std.mem.eql(u8, argument, "--older-than")) {
            older_than_seconds = std.fmt.parseInt(
                u64,
                args.next() orelse return writeUsage(init.io),
                10,
            ) catch return writeUsage(init.io);
            if (older_than_seconds > 10 * 365 * 24 * 60 * 60) return writeUsage(init.io);
        } else if (std.mem.eql(u8, argument, "--dry-run")) {
            dry_run = true;
        } else return writeUsage(init.io);
    }
    if (database == null) return writeUsage(init.io);
    var store = session.Store.open(init.gpa, database.?) catch |err| return fail(init, err);
    defer store.close();
    const orphaned = if (dry_run)
        0
    else
        reconcileStore(init.gpa, &store) catch |err| return fail(init, err);
    const records = store.listSessions(init.gpa) catch |err| return fail(init, err);
    defer freeSessions(init.gpa, records);
    const age_ms = older_than_seconds * 1_000;
    const now_ms = realMilliseconds(init.io);
    const cutoff: i64 = if (age_ms > @as(u64, @intCast(@max(now_ms, 0))))
        0
    else
        now_ms - @as(i64, @intCast(age_ms));
    var removed: std.ArrayList([]const u8) = .empty;
    defer removed.deinit(init.gpa);
    for (records) |record| {
        if ((record.state == .exited or record.state == .stopped or record.state == .orphaned) and
            record.updated_at_ms <= cutoff)
        {
            try removed.append(init.gpa, record.id);
            if (!dry_run) store.deleteSession(record.id) catch |err| return fail(init, err);
        }
    }
    try writeJson(init.gpa, init.io, .{
        .ok = true,
        .dryRun = dry_run,
        .orphaned = orphaned,
        .removed = removed.items,
    });
    return @intFromEnum(Exit.ok);
}

fn realMilliseconds(io: std.Io) i64 {
    return @intCast(@divFloor(std.Io.Clock.real.now(io).nanoseconds, std.time.ns_per_ms));
}

const Target = struct { database: []const u8, reference: []const u8 };
const TargetWithValue = struct { database: []const u8, reference: []const u8, value: []const u8 };

fn parseTarget(args: anytype) !Target {
    const flag = args.next() orelse return error.MissingDatabase;
    if (!std.mem.eql(u8, flag, "--database")) return error.MissingDatabase;
    const database = args.next() orelse return error.MissingDatabase;
    const reference = args.next() orelse return error.MissingTarget;
    if (args.next() != null) return error.UnexpectedArgument;
    return .{ .database = database, .reference = reference };
}

fn parseTargetWithValue(args: anytype) !TargetWithValue {
    const target = try parseTargetPrefix(args);
    const value = args.next() orelse return error.MissingValue;
    if (args.next() != null) return error.UnexpectedArgument;
    return .{ .database = target.database, .reference = target.reference, .value = value };
}

fn parseTargetPrefix(args: anytype) !Target {
    const flag = args.next() orelse return error.MissingDatabase;
    if (!std.mem.eql(u8, flag, "--database")) return error.MissingDatabase;
    const database = args.next() orelse return error.MissingDatabase;
    const reference = args.next() orelse return error.MissingTarget;
    return .{ .database = database, .reference = reference };
}

fn readStdinAll(allocator: std.mem.Allocator, io: std.Io, max_bytes: usize) ![]u8 {
    var output: std.ArrayList(u8) = .empty;
    errdefer output.deinit(allocator);
    var buffer: [4096]u8 = undefined;
    // EOF-bounded stdin stream.
    while (true) {
        const count = std.Io.File.stdin().readStreaming(
            io,
            &.{buffer[0..]},
        ) catch |err| switch (err) {
            error.EndOfStream => break,
            else => |other| return other,
        };
        if (count == 0) break;
        if (output.items.len + count > max_bytes) return error.InputTooLarge;
        try output.appendSlice(allocator, buffer[0..count]);
    }
    if (output.items.len == 0) return error.EmptyInput;
    return output.toOwnedSlice(allocator);
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
    if (parsed == 0 or parsed > 1_000) return error.InvalidDimension;
    return parsed;
}

fn parseCheckpointBytes(value: []const u8) !u32 {
    const parsed = try std.fmt.parseInt(u32, value, 10);
    if (parsed < 32 * 1024 or parsed > 16 * 1024 * 1024) return error.InvalidCheckpointInterval;
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
        "usage: machinen-session " ++
            "<new|list|inspect|attach|send|signal|stop|delete|reconcile|gc|database|help> ...\n",
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
        \\      --cwd <path> [--rows <n>] [--columns <n>] [--checkpoint-bytes <n>]
        \\      -- <command> [args...]
        \\  machinen-session list --database <path>
        \\  machinen-session inspect --database <path> <id-or-name>
        \\  machinen-session attach --database <path> [--after <sequence>] [--read-only]
        \\      [--latest-screen] <id-or-name>
        \\  machinen-session send --database <path> <id-or-name> < input
        \\  machinen-session signal --database <path> <id-or-name> <interrupt|hangup|terminate|kill>
        \\  machinen-session stop --database <path> <id-or-name>
        \\  machinen-session delete --database <path> <id-or-name>
        \\  machinen-session reconcile --database <path>
        \\  machinen-session gc --database <path> [--older-than <seconds>] [--dry-run]
        \\
        \\A detached worker owns each PTY. Reattach by the stable ID or unique name
        \\shown by `list`. Attach clients can resume after a known event sequence;
        \\fresh clients receive a portable VT checkpoint plus retained output.
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
    try std.testing.expectEqual(@as(u32, 262_144), try parseCheckpointBytes("262144"));
}
