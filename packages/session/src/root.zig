const std = @import("std");
const sqlite = @cImport({
    @cInclude("sqlite3.h");
    @cInclude("sys/stat.h");
});

const schema_version: c_int = 2;
const application_id: c_int = 1_297_302_867; // "MSES"

pub const SessionState = enum(c_int) {
    created = 0,
    running = 1,
    exited = 2,
    stopped = 3,
    orphaned = 4,
};

pub const EventKind = enum(c_int) {
    output = 1,
    resize = 2,
    marker = 3,
};

pub const CreateSession = struct {
    id: []const u8,
    name: ?[]const u8 = null,
    working_directory: []const u8,
    argv_json: []const u8,
    rows: u32,
    columns: u32,
};

pub const Session = struct {
    id: []u8,
    name: ?[]u8,
    working_directory: []u8,
    argv_json: []u8,
    state: SessionState,
    rows: u32,
    columns: u32,
    last_sequence: u64,
    worker_pid: ?i64,
    exit_code: ?i32,

    pub fn deinit(self: *Session, allocator: std.mem.Allocator) void {
        allocator.free(self.id);
        if (self.name) |name| allocator.free(name);
        allocator.free(self.working_directory);
        allocator.free(self.argv_json);
        self.* = undefined;
    }
};

pub const Event = struct {
    sequence: u64,
    kind: EventKind,
    payload: []u8,

    pub fn deinit(self: *Event, allocator: std.mem.Allocator) void {
        allocator.free(self.payload);
        self.* = undefined;
    }

    pub fn resize(self: Event) !struct { columns: u32, rows: u32 } {
        if (self.kind != .resize or self.payload.len != 8) return error.InvalidResizeEvent;
        return .{
            .columns = std.mem.readInt(u32, self.payload[0..4], .little),
            .rows = std.mem.readInt(u32, self.payload[4..8], .little),
        };
    }
};

pub const Checkpoint = struct {
    sequence: u64,
    format_version: u32,
    payload: []u8,

    pub fn deinit(self: *Checkpoint, allocator: std.mem.Allocator) void {
        allocator.free(self.payload);
        self.* = undefined;
    }
};

pub const DatabaseInfo = struct {
    schema_version: u32,
    session_count: u64,
    event_count: u64,
    checkpoint_count: u64,
};

pub const Store = struct {
    allocator: std.mem.Allocator,
    db: *sqlite.sqlite3,

    pub fn open(allocator: std.mem.Allocator, path: []const u8) !Store {
        if (path.len == 0) return error.EmptyDatabasePath;
        const path_z = try allocator.dupeZ(u8, path);
        defer allocator.free(path_z);

        var raw: ?*sqlite.sqlite3 = null;
        const flags = sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_FULLMUTEX;
        if (sqlite.sqlite3_open_v2(path_z.ptr, &raw, flags, null) != sqlite.SQLITE_OK) {
            if (raw) |db| _ = sqlite.sqlite3_close_v2(db);
            return error.OpenDatabaseFailed;
        }
        var self = Store{ .allocator = allocator, .db = raw.? };
        errdefer self.close();
        if (sqlite.chmod(path_z.ptr, 0o600) != 0) return error.DatabasePermissionsFailed;

        _ = sqlite.sqlite3_busy_timeout(self.db, 5_000);
        try self.exec("PRAGMA foreign_keys=ON;");
        try self.exec("PRAGMA journal_mode=WAL;");
        try self.exec("PRAGMA synchronous=NORMAL;");
        try self.ensureSchema();
        return self;
    }

    pub fn close(self: *Store) void {
        _ = sqlite.sqlite3_close_v2(self.db);
        self.* = undefined;
    }

    pub fn info(self: *Store) !DatabaseInfo {
        return .{
            .schema_version = @intCast(try self.pragmaInt("PRAGMA user_version;")),
            .session_count = @intCast(try self.scalarInt("SELECT count(*) FROM sessions;")),
            .event_count = @intCast(try self.scalarInt("SELECT count(*) FROM events;")),
            .checkpoint_count = @intCast(try self.scalarInt("SELECT count(*) FROM checkpoints;")),
        };
    }

    pub fn createSession(self: *Store, input: CreateSession) !void {
        if (input.id.len == 0) return error.EmptySessionId;
        if (input.working_directory.len == 0) return error.EmptyWorkingDirectory;
        if (input.argv_json.len == 0) return error.EmptyArgv;
        if (input.rows == 0 or input.columns == 0) return error.InvalidTerminalSize;

        const statement = try self.prepare(
            \\INSERT INTO sessions (
            \\  id, name, working_directory, argv_json, state, rows, columns
            \\) VALUES (?, ?, ?, ?, ?, ?, ?);
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindText(statement, 1, input.id);
        if (input.name) |name| {
            if (name.len == 0) return error.EmptySessionName;
            try bindText(statement, 2, name);
        } else try bindNull(statement, 2);
        try bindText(statement, 3, input.working_directory);
        try bindBlob(statement, 4, input.argv_json);
        try bindInt(statement, 5, @intFromEnum(SessionState.created));
        try bindInt64(statement, 6, input.rows);
        try bindInt64(statement, 7, input.columns);
        try self.stepDone(statement);
    }

    pub fn deleteSession(self: *Store, session_id: []const u8) !void {
        const statement = try self.prepare("DELETE FROM sessions WHERE id=?;");
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindText(statement, 1, session_id);
        try self.stepDone(statement);
        if (sqlite.sqlite3_changes(self.db) == 0) return error.SessionNotFound;
    }

    pub fn setRunning(self: *Store, session_id: []const u8, worker_pid: i64) !void {
        if (worker_pid <= 0) return error.InvalidWorkerPid;
        const statement = try self.prepare(
            \\UPDATE sessions SET state=?, worker_pid=?, exit_code=NULL,
            \\updated_at_ms=unixepoch('subsec')*1000 WHERE id=?;
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindInt(statement, 1, @intFromEnum(SessionState.running));
        try bindInt64(statement, 2, worker_pid);
        try bindText(statement, 3, session_id);
        try self.stepDone(statement);
        if (sqlite.sqlite3_changes(self.db) == 0) return error.SessionNotFound;
    }

    pub fn setExited(self: *Store, session_id: []const u8, exit_code: i32) !void {
        const statement = try self.prepare(
            \\UPDATE sessions SET state=?, worker_pid=NULL, exit_code=?,
            \\updated_at_ms=unixepoch('subsec')*1000 WHERE id=?;
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindInt(statement, 1, @intFromEnum(SessionState.exited));
        try bindInt64(statement, 2, exit_code);
        try bindText(statement, 3, session_id);
        try self.stepDone(statement);
        if (sqlite.sqlite3_changes(self.db) == 0) return error.SessionNotFound;
    }

    pub fn setState(self: *Store, session_id: []const u8, state: SessionState) !void {
        const statement = try self.prepare(
            "UPDATE sessions SET state=?, updated_at_ms=unixepoch('subsec')*1000 WHERE id=?;",
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindInt(statement, 1, @intFromEnum(state));
        try bindText(statement, 2, session_id);
        try self.stepDone(statement);
        if (sqlite.sqlite3_changes(self.db) == 0) return error.SessionNotFound;
    }

    pub fn getSession(self: *Store, session_id: []const u8) !?Session {
        const statement = try self.prepare(
            \\SELECT id, name, working_directory, argv_json, state, rows, columns, last_sequence,
            \\worker_pid, exit_code FROM sessions WHERE id=?;
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindText(statement, 1, session_id);
        return switch (try self.step(statement)) {
            .done => null,
            .row => try readSession(self.allocator, statement),
        };
    }

    pub fn resolveSession(self: *Store, reference: []const u8) !?Session {
        const statement = try self.prepare(
            \\SELECT id, name, working_directory, argv_json, state, rows, columns, last_sequence,
            \\worker_pid, exit_code FROM sessions WHERE id=? OR name=?
            \\ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1;
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindText(statement, 1, reference);
        try bindText(statement, 2, reference);
        try bindText(statement, 3, reference);
        return switch (try self.step(statement)) {
            .done => null,
            .row => try readSession(self.allocator, statement),
        };
    }

    pub fn listSessions(self: *Store, allocator: std.mem.Allocator) ![]Session {
        const statement = try self.prepare(
            \\SELECT id, name, working_directory, argv_json, state, rows, columns, last_sequence,
            \\worker_pid, exit_code FROM sessions ORDER BY created_at_ms, id;
        );
        defer _ = sqlite.sqlite3_finalize(statement);

        var sessions: std.ArrayList(Session) = .empty;
        errdefer {
            for (sessions.items) |*item| item.deinit(allocator);
            sessions.deinit(allocator);
        }
        while (true) switch (try self.step(statement)) {
            .done => return sessions.toOwnedSlice(allocator),
            .row => try sessions.append(allocator, try readSession(allocator, statement)),
        };
    }

    pub fn appendOutput(self: *Store, session_id: []const u8, output: []const u8) !u64 {
        if (output.len == 0) return error.EmptyOutput;
        return self.appendEvent(session_id, .output, output);
    }

    pub fn appendMarker(self: *Store, session_id: []const u8, marker: []const u8) !u64 {
        if (marker.len == 0) return error.EmptyMarker;
        return self.appendEvent(session_id, .marker, marker);
    }

    pub fn recordResize(self: *Store, session_id: []const u8, columns: u32, rows: u32) !u64 {
        if (columns == 0 or rows == 0) return error.InvalidTerminalSize;
        var payload: [8]u8 = undefined;
        std.mem.writeInt(u32, payload[0..4], columns, .little);
        std.mem.writeInt(u32, payload[4..8], rows, .little);

        try self.begin();
        errdefer self.rollback();
        const sequence = try self.nextSequence(session_id);
        try self.insertEvent(session_id, sequence, .resize, &payload);

        const statement = try self.prepare(
            "UPDATE sessions SET columns=?, rows=?, updated_at_ms=unixepoch('subsec')*1000 WHERE id=?;",
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindInt64(statement, 1, columns);
        try bindInt64(statement, 2, rows);
        try bindText(statement, 3, session_id);
        try self.stepDone(statement);
        try self.commit();
        return sequence;
    }

    pub fn eventsAfter(
        self: *Store,
        allocator: std.mem.Allocator,
        session_id: []const u8,
        after_sequence: u64,
    ) ![]Event {
        const statement = try self.prepare(
            \\SELECT sequence, kind, payload FROM events
            \\WHERE session_id=? AND sequence>? ORDER BY sequence;
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindText(statement, 1, session_id);
        try bindInt64(statement, 2, after_sequence);

        var events: std.ArrayList(Event) = .empty;
        errdefer {
            for (events.items) |*event| event.deinit(allocator);
            events.deinit(allocator);
        }
        while (true) switch (try self.step(statement)) {
            .done => return events.toOwnedSlice(allocator),
            .row => {
                const raw_kind = sqlite.sqlite3_column_int(statement, 1);
                const kind = std.enums.fromInt(EventKind, raw_kind) orelse return error.InvalidEventKind;
                try events.append(allocator, .{
                    .sequence = @intCast(sqlite.sqlite3_column_int64(statement, 0)),
                    .kind = kind,
                    .payload = try columnBlob(allocator, statement, 2),
                });
            },
        };
    }

    pub fn saveCheckpoint(
        self: *Store,
        session_id: []const u8,
        format_version: u32,
        payload: []const u8,
    ) !u64 {
        if (format_version == 0) return error.InvalidCheckpointVersion;
        if (payload.len == 0) return error.EmptyCheckpoint;

        try self.begin();
        errdefer self.rollback();
        const sequence = try self.currentSequence(session_id);
        const statement = try self.prepare(
            \\INSERT INTO checkpoints (session_id, sequence, format_version, payload)
            \\VALUES (?, ?, ?, ?)
            \\ON CONFLICT(session_id, sequence) DO UPDATE SET
            \\  format_version=excluded.format_version,
            \\  payload=excluded.payload,
            \\  created_at_ms=unixepoch('subsec')*1000;
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindText(statement, 1, session_id);
        try bindInt64(statement, 2, sequence);
        try bindInt64(statement, 3, format_version);
        try bindBlob(statement, 4, payload);
        try self.stepDone(statement);
        try self.commit();
        return sequence;
    }

    pub fn latestCheckpoint(
        self: *Store,
        allocator: std.mem.Allocator,
        session_id: []const u8,
    ) !?Checkpoint {
        const statement = try self.prepare(
            \\SELECT sequence, format_version, payload FROM checkpoints
            \\WHERE session_id=? ORDER BY sequence DESC LIMIT 1;
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindText(statement, 1, session_id);
        return switch (try self.step(statement)) {
            .done => null,
            .row => .{
                .sequence = @intCast(sqlite.sqlite3_column_int64(statement, 0)),
                .format_version = @intCast(sqlite.sqlite3_column_int64(statement, 1)),
                .payload = try columnBlob(allocator, statement, 2),
            },
        };
    }

    pub fn compactThroughCheckpoint(self: *Store, session_id: []const u8, sequence: u64) !u64 {
        try self.begin();
        errdefer self.rollback();

        const verify = try self.prepare(
            "SELECT 1 FROM checkpoints WHERE session_id=? AND sequence=?;",
        );
        defer _ = sqlite.sqlite3_finalize(verify);
        try bindText(verify, 1, session_id);
        try bindInt64(verify, 2, sequence);
        if (try self.step(verify) == .done) return error.CheckpointNotFound;

        const statement = try self.prepare(
            "DELETE FROM events WHERE session_id=? AND sequence<=?;",
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindText(statement, 1, session_id);
        try bindInt64(statement, 2, sequence);
        try self.stepDone(statement);
        const removed: u64 = @intCast(sqlite.sqlite3_changes(self.db));
        try self.commit();
        return removed;
    }

    fn appendEvent(
        self: *Store,
        session_id: []const u8,
        kind: EventKind,
        payload: []const u8,
    ) !u64 {
        try self.begin();
        errdefer self.rollback();
        const sequence = try self.nextSequence(session_id);
        try self.insertEvent(session_id, sequence, kind, payload);
        try self.commit();
        return sequence;
    }

    fn insertEvent(
        self: *Store,
        session_id: []const u8,
        sequence: u64,
        kind: EventKind,
        payload: []const u8,
    ) !void {
        const statement = try self.prepare(
            "INSERT INTO events (session_id, sequence, kind, payload) VALUES (?, ?, ?, ?);",
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindText(statement, 1, session_id);
        try bindInt64(statement, 2, sequence);
        try bindInt(statement, 3, @intFromEnum(kind));
        try bindBlob(statement, 4, payload);
        try self.stepDone(statement);
    }

    fn nextSequence(self: *Store, session_id: []const u8) !u64 {
        const statement = try self.prepare(
            \\UPDATE sessions SET
            \\  last_sequence=last_sequence+1,
            \\  updated_at_ms=unixepoch('subsec')*1000
            \\WHERE id=?;
        );
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindText(statement, 1, session_id);
        try self.stepDone(statement);
        if (sqlite.sqlite3_changes(self.db) == 0) return error.SessionNotFound;
        return self.currentSequence(session_id);
    }

    fn currentSequence(self: *Store, session_id: []const u8) !u64 {
        const statement = try self.prepare("SELECT last_sequence FROM sessions WHERE id=?;");
        defer _ = sqlite.sqlite3_finalize(statement);
        try bindText(statement, 1, session_id);
        if (try self.step(statement) == .done) return error.SessionNotFound;
        return @intCast(sqlite.sqlite3_column_int64(statement, 0));
    }

    fn ensureSchema(self: *Store) !void {
        const found_application_id = try self.pragmaInt("PRAGMA application_id;");
        if (found_application_id != 0 and found_application_id != application_id) {
            return error.NotMachinenSessionDatabase;
        }
        const found_version = try self.pragmaInt("PRAGMA user_version;");
        if (found_version > schema_version) return error.UnsupportedSchemaVersion;
        if (found_version == schema_version) {
            if (found_application_id == 0) return error.NotMachinenSessionDatabase;
            return;
        }
        if (found_version == 1) {
            if (found_application_id != application_id) return error.NotMachinenSessionDatabase;
            try self.begin();
            errdefer self.rollback();
            try self.exec("ALTER TABLE sessions ADD COLUMN worker_pid INTEGER;");
            try self.exec("ALTER TABLE sessions ADD COLUMN exit_code INTEGER;");
            try self.exec("PRAGMA user_version=2;");
            try self.commit();
            return;
        }
        if (found_version != 0) return error.UnsupportedSchemaVersion;

        try self.begin();
        errdefer self.rollback();
        try self.exec(
            \\CREATE TABLE sessions (
            \\  id TEXT PRIMARY KEY NOT NULL,
            \\  name TEXT UNIQUE,
            \\  working_directory TEXT NOT NULL,
            \\  argv_json BLOB NOT NULL,
            \\  state INTEGER NOT NULL CHECK (state BETWEEN 0 AND 4),
            \\  rows INTEGER NOT NULL CHECK (rows > 0),
            \\  columns INTEGER NOT NULL CHECK (columns > 0),
            \\  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
            \\  worker_pid INTEGER,
            \\  exit_code INTEGER,
            \\  created_at_ms INTEGER NOT NULL DEFAULT (unixepoch('subsec')*1000),
            \\  updated_at_ms INTEGER NOT NULL DEFAULT (unixepoch('subsec')*1000)
            \\);
            \\
            \\CREATE TABLE events (
            \\  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            \\  sequence INTEGER NOT NULL CHECK (sequence > 0),
            \\  kind INTEGER NOT NULL CHECK (kind BETWEEN 1 AND 3),
            \\  payload BLOB NOT NULL,
            \\  created_at_ms INTEGER NOT NULL DEFAULT (unixepoch('subsec')*1000),
            \\  PRIMARY KEY (session_id, sequence)
            \\) WITHOUT ROWID;
            \\
            \\CREATE TABLE checkpoints (
            \\  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            \\  sequence INTEGER NOT NULL CHECK (sequence >= 0),
            \\  format_version INTEGER NOT NULL CHECK (format_version > 0),
            \\  payload BLOB NOT NULL,
            \\  created_at_ms INTEGER NOT NULL DEFAULT (unixepoch('subsec')*1000),
            \\  PRIMARY KEY (session_id, sequence)
            \\) WITHOUT ROWID;
            \\
            \\CREATE INDEX checkpoints_latest
            \\ON checkpoints(session_id, sequence DESC);
        );
        try self.exec("PRAGMA application_id=1297302867;");
        try self.exec("PRAGMA user_version=2;");
        try self.commit();
    }

    fn begin(self: *Store) !void {
        try self.exec("BEGIN IMMEDIATE;");
    }

    fn commit(self: *Store) !void {
        try self.exec("COMMIT;");
    }

    fn rollback(self: *Store) void {
        self.exec("ROLLBACK;") catch {};
    }

    fn exec(self: *Store, sql: [:0]const u8) !void {
        var message: [*c]u8 = null;
        const rc = sqlite.sqlite3_exec(self.db, sql.ptr, null, null, &message);
        if (message != null) sqlite.sqlite3_free(message);
        if (rc != sqlite.SQLITE_OK) return sqliteError(rc);
    }

    fn prepare(self: *Store, sql: []const u8) !*sqlite.sqlite3_stmt {
        var statement: ?*sqlite.sqlite3_stmt = null;
        const rc = sqlite.sqlite3_prepare_v2(
            self.db,
            sql.ptr,
            @intCast(sql.len),
            &statement,
            null,
        );
        if (rc != sqlite.SQLITE_OK) return sqliteError(rc);
        return statement orelse error.SqlitePrepareFailed;
    }

    const Step = enum { row, done };

    fn step(self: *Store, statement: *sqlite.sqlite3_stmt) !Step {
        _ = self;
        const rc = sqlite.sqlite3_step(statement);
        return switch (rc) {
            sqlite.SQLITE_ROW => .row,
            sqlite.SQLITE_DONE => .done,
            else => sqliteError(rc),
        };
    }

    fn stepDone(self: *Store, statement: *sqlite.sqlite3_stmt) !void {
        if (try self.step(statement) != .done) return error.UnexpectedSqliteRow;
    }

    fn pragmaInt(self: *Store, sql: []const u8) !c_int {
        const statement = try self.prepare(sql);
        defer _ = sqlite.sqlite3_finalize(statement);
        if (try self.step(statement) != .row) return error.MissingPragmaValue;
        return sqlite.sqlite3_column_int(statement, 0);
    }

    fn scalarInt(self: *Store, sql: []const u8) !sqlite.sqlite3_int64 {
        const statement = try self.prepare(sql);
        defer _ = sqlite.sqlite3_finalize(statement);
        if (try self.step(statement) != .row) return error.MissingScalarValue;
        return sqlite.sqlite3_column_int64(statement, 0);
    }
};

fn sqliteError(rc: c_int) anyerror {
    return switch (rc) {
        sqlite.SQLITE_BUSY, sqlite.SQLITE_LOCKED => error.DatabaseBusy,
        sqlite.SQLITE_CONSTRAINT => error.ConstraintViolation,
        sqlite.SQLITE_CORRUPT, sqlite.SQLITE_NOTADB => error.InvalidDatabase,
        else => error.SqliteFailure,
    };
}

fn bindNull(statement: *sqlite.sqlite3_stmt, index: c_int) !void {
    const rc = sqlite.sqlite3_bind_null(statement, index);
    if (rc != sqlite.SQLITE_OK) return sqliteError(rc);
}

fn bindText(statement: *sqlite.sqlite3_stmt, index: c_int, value: []const u8) !void {
    const rc = sqlite.sqlite3_bind_text(statement, index, value.ptr, @intCast(value.len), null);
    if (rc != sqlite.SQLITE_OK) return sqliteError(rc);
}

fn bindBlob(statement: *sqlite.sqlite3_stmt, index: c_int, value: []const u8) !void {
    const rc = sqlite.sqlite3_bind_blob(statement, index, value.ptr, @intCast(value.len), null);
    if (rc != sqlite.SQLITE_OK) return sqliteError(rc);
}

fn bindInt(statement: *sqlite.sqlite3_stmt, index: c_int, value: c_int) !void {
    const rc = sqlite.sqlite3_bind_int(statement, index, value);
    if (rc != sqlite.SQLITE_OK) return sqliteError(rc);
}

fn bindInt64(statement: *sqlite.sqlite3_stmt, index: c_int, value: anytype) !void {
    const rc = sqlite.sqlite3_bind_int64(statement, index, @intCast(value));
    if (rc != sqlite.SQLITE_OK) return sqliteError(rc);
}

fn readSession(allocator: std.mem.Allocator, statement: *sqlite.sqlite3_stmt) !Session {
    const raw_state = sqlite.sqlite3_column_int(statement, 4);
    return .{
        .id = try columnText(allocator, statement, 0),
        .name = if (sqlite.sqlite3_column_type(statement, 1) == sqlite.SQLITE_NULL)
            null
        else
            try columnText(allocator, statement, 1),
        .working_directory = try columnText(allocator, statement, 2),
        .argv_json = try columnBlob(allocator, statement, 3),
        .state = std.enums.fromInt(SessionState, raw_state) orelse return error.InvalidSessionState,
        .rows = @intCast(sqlite.sqlite3_column_int64(statement, 5)),
        .columns = @intCast(sqlite.sqlite3_column_int64(statement, 6)),
        .last_sequence = @intCast(sqlite.sqlite3_column_int64(statement, 7)),
        .worker_pid = if (sqlite.sqlite3_column_type(statement, 8) == sqlite.SQLITE_NULL)
            null
        else
            sqlite.sqlite3_column_int64(statement, 8),
        .exit_code = if (sqlite.sqlite3_column_type(statement, 9) == sqlite.SQLITE_NULL)
            null
        else
            @intCast(sqlite.sqlite3_column_int64(statement, 9)),
    };
}

fn columnText(
    allocator: std.mem.Allocator,
    statement: *sqlite.sqlite3_stmt,
    column: c_int,
) ![]u8 {
    const length: usize = @intCast(sqlite.sqlite3_column_bytes(statement, column));
    const value = sqlite.sqlite3_column_text(statement, column) orelse {
        if (length == 0) return allocator.alloc(u8, 0);
        return error.UnexpectedNull;
    };
    return allocator.dupe(u8, value[0..length]);
}

fn columnBlob(
    allocator: std.mem.Allocator,
    statement: *sqlite.sqlite3_stmt,
    column: c_int,
) ![]u8 {
    const length: usize = @intCast(sqlite.sqlite3_column_bytes(statement, column));
    if (length == 0) return allocator.alloc(u8, 0);
    const value = sqlite.sqlite3_column_blob(statement, column) orelse return error.UnexpectedNull;
    const bytes: [*]const u8 = @ptrCast(value);
    return allocator.dupe(u8, bytes[0..length]);
}

fn freeSessions(allocator: std.mem.Allocator, sessions: []Session) void {
    for (sessions) |*item| item.deinit(allocator);
    allocator.free(sessions);
}

fn freeEvents(allocator: std.mem.Allocator, events: []Event) void {
    for (events) |*event| event.deinit(allocator);
    allocator.free(events);
}

fn testDatabasePath(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path, "sessions.sqlite3" });
}

test "store migrates a new database and persists session metadata" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try testDatabasePath(allocator, &tmp);
    defer allocator.free(path);

    {
        var store = try Store.open(allocator, path);
        defer store.close();
        try store.createSession(.{
            .id = "term_api",
            .name = "api",
            .working_directory = "/srv/api",
            .argv_json = "[\"pnpm\",\"dev\"]",
            .rows = 40,
            .columns = 120,
        });
        try store.setRunning("term_api", 4_242);
        const info = try store.info();
        try std.testing.expectEqual(@as(u32, 2), info.schema_version);
        try std.testing.expectEqual(@as(u64, 1), info.session_count);
    }

    const database_stat = try tmp.dir.statFile(std.testing.io, "sessions.sqlite3", .{});
    try std.testing.expectEqual(
        @as(u32, 0o600),
        @as(u32, @intCast(@intFromEnum(database_stat.permissions))) & 0o777,
    );

    var reopened = try Store.open(allocator, path);
    defer reopened.close();
    var session = (try reopened.getSession("term_api")).?;
    defer session.deinit(allocator);
    try std.testing.expectEqualStrings("api", session.name.?);
    try std.testing.expectEqualStrings("/srv/api", session.working_directory);
    try std.testing.expectEqualStrings("[\"pnpm\",\"dev\"]", session.argv_json);
    try std.testing.expectEqual(SessionState.running, session.state);
    try std.testing.expectEqual(@as(i64, 4_242), session.worker_pid.?);
    try std.testing.expectEqual(@as(?i32, null), session.exit_code);
    try std.testing.expectEqual(@as(u32, 120), session.columns);
    try std.testing.expectEqual(@as(u32, 40), session.rows);

    var resolved = (try reopened.resolveSession("api")).?;
    defer resolved.deinit(allocator);
    try std.testing.expectEqualStrings("term_api", resolved.id);
}

test "events retain byte-exact output and ordered resize information" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try testDatabasePath(allocator, &tmp);
    defer allocator.free(path);
    var store = try Store.open(allocator, path);
    defer store.close();
    try store.createSession(.{
        .id = "term_build",
        .working_directory = "/tmp/build",
        .argv_json = "[\"make\"]",
        .rows = 24,
        .columns = 80,
    });

    try std.testing.expectEqual(@as(u64, 1), try store.appendOutput("term_build", "one\x00two"));
    try std.testing.expectEqual(@as(u64, 2), try store.recordResize("term_build", 132, 50));
    try std.testing.expectEqual(@as(u64, 3), try store.appendOutput("term_build", "three"));

    const all_events = try store.eventsAfter(allocator, "term_build", 0);
    defer freeEvents(allocator, all_events);
    try std.testing.expectEqual(@as(usize, 3), all_events.len);
    try std.testing.expectEqualSlices(u8, "one\x00two", all_events[0].payload);

    const events = try store.eventsAfter(allocator, "term_build", 1);
    defer freeEvents(allocator, events);
    try std.testing.expectEqual(@as(usize, 2), events.len);
    try std.testing.expectEqual(@as(u64, 2), events[0].sequence);
    try std.testing.expectEqual(EventKind.resize, events[0].kind);
    const size = try events[0].resize();
    try std.testing.expectEqual(@as(u32, 132), size.columns);
    try std.testing.expectEqual(@as(u32, 50), size.rows);
    try std.testing.expectEqualStrings("three", events[1].payload);

    var session = (try store.getSession("term_build")).?;
    defer session.deinit(allocator);
    try std.testing.expectEqual(@as(u64, 3), session.last_sequence);
    try std.testing.expectEqual(@as(u32, 132), session.columns);
    try std.testing.expectEqual(@as(u32, 50), session.rows);
}

test "checkpoint compaction is atomic and preserves replay after its sequence" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try testDatabasePath(allocator, &tmp);
    defer allocator.free(path);
    var store = try Store.open(allocator, path);
    defer store.close();
    try store.createSession(.{
        .id = "term_long",
        .working_directory = "/tmp",
        .argv_json = "[\"sh\"]",
        .rows = 24,
        .columns = 80,
    });
    _ = try store.appendOutput("term_long", "before");
    const checkpoint_sequence = try store.saveCheckpoint("term_long", 1, "portable-vt-checkpoint");
    try std.testing.expectEqual(@as(u64, 1), checkpoint_sequence);
    _ = try store.appendOutput("term_long", "after");

    var checkpoint = (try store.latestCheckpoint(allocator, "term_long")).?;
    defer checkpoint.deinit(allocator);
    try std.testing.expectEqualStrings("portable-vt-checkpoint", checkpoint.payload);
    try std.testing.expectEqual(@as(u64, 1), try store.compactThroughCheckpoint("term_long", checkpoint.sequence));

    const remaining = try store.eventsAfter(allocator, "term_long", checkpoint.sequence);
    defer freeEvents(allocator, remaining);
    try std.testing.expectEqual(@as(usize, 1), remaining.len);
    try std.testing.expectEqualStrings("after", remaining[0].payload);
    const info = try store.info();
    try std.testing.expectEqual(@as(u64, 1), info.event_count);
    try std.testing.expectEqual(@as(u64, 1), info.checkpoint_count);

    try store.deleteSession("term_long");
    const after_delete = try store.info();
    try std.testing.expectEqual(@as(u64, 0), after_delete.session_count);
    try std.testing.expectEqual(@as(u64, 0), after_delete.event_count);
    try std.testing.expectEqual(@as(u64, 0), after_delete.checkpoint_count);
}

test "version one databases migrate worker recovery fields in place" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try testDatabasePath(allocator, &tmp);
    defer allocator.free(path);
    const path_z = try allocator.dupeZ(u8, path);
    defer allocator.free(path_z);

    var raw: ?*sqlite.sqlite3 = null;
    try std.testing.expectEqual(@as(c_int, sqlite.SQLITE_OK), sqlite.sqlite3_open(path_z.ptr, &raw));
    const legacy_sql =
        \\CREATE TABLE sessions (
        \\ id TEXT PRIMARY KEY, name TEXT UNIQUE, working_directory TEXT NOT NULL,
        \\ argv_json BLOB NOT NULL, state INTEGER NOT NULL, rows INTEGER NOT NULL,
        \\ columns INTEGER NOT NULL, last_sequence INTEGER NOT NULL DEFAULT 0,
        \\ created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
        \\);
        \\CREATE TABLE events (
        \\ session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        \\ sequence INTEGER NOT NULL, kind INTEGER NOT NULL, payload BLOB NOT NULL,
        \\ created_at_ms INTEGER NOT NULL, PRIMARY KEY(session_id, sequence)
        \\) WITHOUT ROWID;
        \\CREATE TABLE checkpoints (
        \\ session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        \\ sequence INTEGER NOT NULL, format_version INTEGER NOT NULL, payload BLOB NOT NULL,
        \\ created_at_ms INTEGER NOT NULL, PRIMARY KEY(session_id, sequence)
        \\) WITHOUT ROWID;
        \\INSERT INTO sessions VALUES ('legacy', 'old', '/tmp', '["sh"]', 1, 24, 80, 0, 1, 1);
        \\PRAGMA application_id=1297302867;
        \\PRAGMA user_version=1;
    ;
    try std.testing.expectEqual(
        @as(c_int, sqlite.SQLITE_OK),
        sqlite.sqlite3_exec(raw, legacy_sql, null, null, null),
    );
    try std.testing.expectEqual(@as(c_int, sqlite.SQLITE_OK), sqlite.sqlite3_close(raw));

    var store = try Store.open(allocator, path);
    defer store.close();
    const info = try store.info();
    try std.testing.expectEqual(@as(u32, 2), info.schema_version);
    var legacy = (try store.getSession("legacy")).?;
    defer legacy.deinit(allocator);
    try std.testing.expectEqual(@as(?i64, null), legacy.worker_pid);
    try std.testing.expectEqual(@as(?i32, null), legacy.exit_code);
    try store.setExited("legacy", 9);
}

test "constraints reject duplicate names and missing sessions without advancing sequences" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try testDatabasePath(allocator, &tmp);
    defer allocator.free(path);
    var store = try Store.open(allocator, path);
    defer store.close();
    try store.createSession(.{
        .id = "term_one",
        .name = "shared",
        .working_directory = "/tmp",
        .argv_json = "[\"sh\"]",
        .rows = 24,
        .columns = 80,
    });
    try std.testing.expectError(error.ConstraintViolation, store.createSession(.{
        .id = "term_two",
        .name = "shared",
        .working_directory = "/tmp",
        .argv_json = "[\"sh\"]",
        .rows = 24,
        .columns = 80,
    }));
    try std.testing.expectError(error.SessionNotFound, store.appendOutput("missing", "output"));

    const sessions = try store.listSessions(allocator);
    defer freeSessions(allocator, sessions);
    try std.testing.expectEqual(@as(usize, 1), sessions.len);
    try std.testing.expectEqual(@as(u64, 0), sessions[0].last_sequence);
}
