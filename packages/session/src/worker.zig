const std = @import("std");
const builtin = @import("builtin");
const session = @import("session");
const vt = @import("vt");

const c = @cImport({
    @cInclude("errno.h");
    @cInclude("fcntl.h");
    @cInclude("poll.h");
    @cInclude("signal.h");
    @cInclude("stdlib.h");
    @cInclude("string.h");
    @cInclude("sys/ioctl.h");
    @cInclude("sys/socket.h");
    @cInclude("sys/stat.h");
    @cInclude("sys/time.h");
    @cInclude("sys/un.h");
    @cInclude("sys/wait.h");
    @cInclude("termios.h");
    @cInclude("time.h");
    @cInclude("unistd.h");
    if (builtin.os.tag == .macos) {
        @cInclude("util.h");
    } else {
        @cInclude("pty.h");
    }
});

const macos = struct {
    extern "c" fn proc_name(pid: c_int, buffer: *anyopaque, buffersize: u32) c_int;
};

pub const max_attached_clients = 8;
pub const max_client_id: u64 = 9_007_199_254_740_991;
const max_viewer_clients = max_attached_clients;
// Keep spare connection slots for short-lived presence, telemetry, and control
// queries even when every viewer slot is occupied.
const max_clients = max_viewer_clients + 4;
const max_frame_payload = 32 * 1024;
const output_batch_bytes = 256 * 1024;
const output_batch_delay_ms = 16;
const durable_checkpoint_interval_ms = 60_000;
const max_live_history_bytes = 16 * 1024 * 1024;
const socket_directory_prefix = "/tmp/machinen-session-";
const protocol_version: u32 = 2;
const attach_payload_length = 24;
const sequence_header_length = 8;
const checkpoint_header_length = 13;
const telemetry_header_length = 14;
const telemetry_name_capacity = 127;
const client_info_header_length = 8;
const client_name_capacity = 127;
const client_list_header_length = 1;
const client_list_item_header_length = 23;
const lease_duration_ms: i64 = 30_000;
const heartbeat_interval_ms: i64 = 10_000;
const control_io_timeout_ms: i64 = 1_000;
const worker_client_write_timeout_ms: i64 = 1_000;
const LeaseFlag = struct {
    const writer: u8 = 1 << 0;
    const resize: u8 = 1 << 1;
    const control: u8 = 1 << 2;
};

const Capability = struct {
    const client_presence: u32 = 1 << 0;
    const take_control: u32 = 1 << 1;
    const all: u32 = client_presence | take_control;
};

const RecoveryMode = enum(u8) {
    journal = 0,
    latest_screen = 1,
};

const FrameType = enum(u8) {
    attach_request = 'A',
    checkpoint = 'C',
    output = 'O',
    sequenced_output = 'Q',
    input = 'I',
    resize = 'R',
    history_complete = 'H',
    exit = 'X',
    failure = 'E',
    signal = 'S',
    lease = 'L',
    heartbeat = 'P',
    telemetry = 'T',
    capabilities = 'B',
    client_info = 'N',
    clients = 'V',
    take_control = 'K',
};

pub const default_checkpoint_bytes = vt.default_checkpoint_bytes;

pub const Config = struct {
    database_path: []const u8,
    id: []const u8,
    name: ?[]const u8,
    workspace_id: ?[]const u8 = null,
    working_directory: []const u8,
    argv_json: []const u8,
    command: []const []const u8,
    rows: u16,
    columns: u16,
    checkpoint_bytes: u32 = default_checkpoint_bytes,
};

const LiveOutput = struct {
    sequence: u64,
    payload: []u8,
};

const ByteBuffer = std.ArrayList(u8);

const LiveHistory = struct {
    events: std.ArrayList(LiveOutput) = .empty,
    payload_bytes: u32 = 0,
    base_sequence: u64 = 0,
    dirty_since_ms: i64 = 0,
    complete: bool = true,

    fn deinit(self: *LiveHistory, allocator: std.mem.Allocator) void {
        std.debug.assert(self.payload_bytes <= max_live_history_bytes);
        self.clearEvents(allocator);
        self.events.deinit(allocator);
        self.* = undefined;
    }

    fn append(
        self: *LiveHistory,
        allocator: std.mem.Allocator,
        sequence: u64,
        payload: []const u8,
        now_ms: i64,
    ) !void {
        std.debug.assert(payload.len > 0 and now_ms >= 0);
        if (self.dirty_since_ms == 0) self.dirty_since_ms = now_ms;
        if (!self.complete) return;
        const payload_size: u32 = @intCast(payload.len);
        if (self.payload_bytes + payload_size > max_live_history_bytes) {
            self.discard(allocator);
            return;
        }
        const copy = try allocator.dupe(u8, payload);
        errdefer allocator.free(copy);
        try self.events.append(allocator, .{ .sequence = sequence, .payload = copy });
        self.payload_bytes += payload_size;
    }

    fn reset(self: *LiveHistory, allocator: std.mem.Allocator, sequence: u64) void {
        std.debug.assert(self.payload_bytes <= max_live_history_bytes);
        self.clearEvents(allocator);
        self.base_sequence = sequence;
        self.dirty_since_ms = 0;
        self.complete = true;
    }

    fn shouldCheckpoint(self: *const LiveHistory, now_ms: i64) bool {
        std.debug.assert(now_ms >= 0 and self.dirty_since_ms >= 0);
        return self.dirty_since_ms != 0 and
            now_ms - self.dirty_since_ms >= durable_checkpoint_interval_ms;
    }

    fn discard(self: *LiveHistory, allocator: std.mem.Allocator) void {
        std.debug.assert(self.payload_bytes <= max_live_history_bytes);
        self.clearEvents(allocator);
        self.complete = false;
    }

    fn clearEvents(self: *LiveHistory, allocator: std.mem.Allocator) void {
        std.debug.assert(self.payload_bytes <= max_live_history_bytes);
        for (self.events.items) |event| allocator.free(event.payload);
        self.events.clearRetainingCapacity();
        self.payload_bytes = 0;
    }
};

const OutputBatch = struct {
    bytes: ByteBuffer = .empty,
    started_at_ms: i64 = 0,

    fn deinit(self: *OutputBatch, allocator: std.mem.Allocator) void {
        std.debug.assert(self.bytes.items.len == 0 or self.started_at_ms > 0);
        self.bytes.deinit(allocator);
        self.* = undefined;
    }

    fn append(
        self: *OutputBatch,
        allocator: std.mem.Allocator,
        output: []const u8,
        now_ms: i64,
    ) !void {
        std.debug.assert(output.len > 0 and now_ms > 0);
        if (self.bytes.items.len == 0) self.started_at_ms = now_ms;
        try self.bytes.appendSlice(allocator, output);
    }

    fn shouldFlush(self: *const OutputBatch, now_ms: i64) bool {
        std.debug.assert(self.bytes.items.len == 0 or now_ms >= self.started_at_ms);
        if (self.bytes.items.len == 0) return false;
        return self.bytes.items.len >= output_batch_bytes or
            now_ms - self.started_at_ms >= output_batch_delay_ms;
    }

    fn pollTimeout(self: *const OutputBatch, now_ms: i64) c_int {
        std.debug.assert(self.bytes.items.len == 0 or self.started_at_ms > 0);
        if (self.bytes.items.len == 0) return 1_000;
        const elapsed = @max(now_ms - self.started_at_ms, 0);
        const remaining = @max(output_batch_delay_ms - elapsed, 0);
        return @intCast(remaining);
    }

    fn clear(self: *OutputBatch) void {
        std.debug.assert(self.bytes.items.len > 0 and self.started_at_ms > 0);
        self.bytes.clearRetainingCapacity();
        self.started_at_ms = 0;
    }
};

pub const Spawned = struct {
    worker_pid: c.pid_t,
};

const Client = struct {
    fd: c_int = -1,
    ready: bool = false,
    requested_leases: u8 = 0,
    granted_leases: u8 = 0,
    control: bool = false,
    client_id: u64 = 0,
    client_pid: i32 = 0,
    client_name: [client_name_capacity]u8 = @splat(0),
    client_name_length: u8 = 0,
    connected_at_ms: i64 = 0,
    last_heartbeat_ms: i64 = 0,

    fn clientName(self: *const Client) []const u8 {
        std.debug.assert(self.client_name_length <= self.client_name.len);
        return self.client_name[0..self.client_name_length];
    }
};

const Leases = struct {
    writer_fd: c_int = -1,
    writer_expires_ms: i64 = 0,
    resize_fd: c_int = -1,
    resize_expires_ms: i64 = 0,
};

pub const AttachOptions = struct {
    protocol: u32,
    after_sequence: u64 = 0,
    read_only: bool = false,
    latest_screen: bool = false,
    client_id: ?u64 = null,
    client_name: ?[]const u8 = null,
};

pub const AttachedClient = struct {
    id: u64 = 0,
    name_buffer: [client_name_capacity]u8 = @splat(0),
    name_length: u8 = 0,
    pid: ?i32 = null,
    connectedAtMs: i64 = 0,
    writer: bool = false,
    resize: bool = false,
    readOnly: bool = false,

    pub fn name(self: *const AttachedClient) []const u8 {
        std.debug.assert(self.name_length <= self.name_buffer.len);
        return self.name_buffer[0..self.name_length];
    }
};

pub const AttachedClients = struct {
    items: [max_attached_clients]AttachedClient = @splat(.{}),
    count: u8 = 0,

    pub fn slice(self: *const AttachedClients) []const AttachedClient {
        std.debug.assert(self.count <= self.items.len);
        return self.items[0..self.count];
    }
};

pub const Activity = enum(u8) {
    unknown = 0,
    idle = 1,
    working = 2,
};

pub const Telemetry = struct {
    activity: Activity = .unknown,
    shell_pid: i32 = 0,
    process_pid: i32 = 0,
    shell_name: [telemetry_name_capacity]u8 = @splat(0),
    shell_name_length: u8 = 0,
    command: [telemetry_name_capacity]u8 = @splat(0),
    command_length: u8 = 0,

    pub fn shellName(self: *const Telemetry) []const u8 {
        std.debug.assert(self.shell_name_length <= self.shell_name.len);
        return self.shell_name[0..self.shell_name_length];
    }

    pub fn commandName(self: *const Telemetry) []const u8 {
        std.debug.assert(self.command_length <= self.command.len);
        return self.command[0..self.command_length];
    }
};

var resize_pending: c.sig_atomic_t = 0;

pub fn validSessionId(id: []const u8) bool {
    if (id.len == 0 or id.len > 64) return false;
    for (id) |character| {
        if (!std.ascii.isAlphanumeric(character) and
            character != '-' and character != '_' and character != '.')
        {
            return false;
        }
    }
    return true;
}

pub fn socketPath(allocator: std.mem.Allocator, id: []const u8) ![]u8 {
    if (!validSessionId(id)) return error.InvalidSessionId;
    return std.fmt.allocPrint(
        allocator,
        "{s}{d}/{s}.sock",
        .{ socket_directory_prefix, c.getuid(), id },
    );
}

pub fn spawnDetached(config: Config) !Spawned {
    try validateConfig(config);
    var ready_pipe: [2]c_int = undefined;
    if (c.pipe(&ready_pipe) != 0) return error.PipeFailed;
    setCloseOnExec(ready_pipe[0]);
    setCloseOnExec(ready_pipe[1]);
    errdefer {
        _ = c.close(ready_pipe[0]);
        _ = c.close(ready_pipe[1]);
    }

    const pid = c.fork();
    if (pid < 0) return error.ForkFailed;
    if (pid == 0) runDetachedChild(config, ready_pipe) else {
        _ = c.close(ready_pipe[1]);
        var status: [1]u8 = undefined;
        const count = readRetry(ready_pipe[0], &status);
        _ = c.close(ready_pipe[0]);
        if (count != 1 or status[0] != 1) {
            var child_status: c_int = 0;
            _ = c.waitpid(pid, &child_status, 0);
            return error.WorkerStartFailed;
        }
        return .{ .worker_pid = pid };
    }
}

pub fn sendInput(
    allocator: std.mem.Allocator,
    id: []const u8,
    protocol: u32,
    last_sequence: u64,
    input: []const u8,
) !void {
    if (input.len == 0) return error.EmptyInput;
    const fd = try connectForControl(allocator, id, protocol, last_sequence);
    defer _ = c.close(fd);
    var offset: usize = 0;
    while (offset < input.len) {
        const end = @min(offset + max_frame_payload, input.len);
        try writeFrame(fd, .input, input[offset..end]);
        offset = end;
    }
}

pub fn sendSignal(
    allocator: std.mem.Allocator,
    id: []const u8,
    protocol: u32,
    last_sequence: u64,
    signal: i32,
) !void {
    if (signal <= 0) return error.InvalidSignal;
    const fd = try connectForControl(allocator, id, protocol, last_sequence);
    defer _ = c.close(fd);
    var payload: [4]u8 = undefined;
    std.mem.writeInt(i32, &payload, signal, .big);
    try writeFrame(fd, .signal, &payload);
}

pub fn queryTelemetry(
    allocator: std.mem.Allocator,
    id: []const u8,
    protocol: u32,
    last_sequence: u64,
) !Telemetry {
    if (protocol < protocol_version) return error.TelemetryUnsupported;
    std.debug.assert(protocol >= protocol_version);
    const fd = try connectForControl(allocator, id, protocol, last_sequence);
    defer closeDescriptor(fd);
    try writeFrame(fd, .telemetry, "");
    var payload: [max_frame_payload]u8 = undefined;
    // Intentional control loop, bounded by one telemetry response or socket closure.
    while (true) {
        const frame = readFrame(fd, &payload) catch return error.TelemetryUnsupported;
        switch (frame.kind) {
            .telemetry => return decodeTelemetry(frame.payload),
            .failure => return error.TelemetryUnavailable,
            .lease, .history_complete => {},
            else => return error.InvalidServerFrame,
        }
    }
}

pub fn queryAttachedClients(
    allocator: std.mem.Allocator,
    id: []const u8,
    protocol: u32,
    last_sequence: u64,
) !AttachedClients {
    if (protocol < protocol_version) return error.ClientPresenceUnsupported;
    std.debug.assert(id.len > 0 and protocol >= protocol_version);
    const fd = try connectForControl(allocator, id, protocol, last_sequence);
    defer closeDescriptor(fd);
    try writeFrame(fd, .clients, "");
    var payload: [max_frame_payload]u8 = undefined;
    // Intentional control loop, bounded by one client-list response or socket closure.
    while (true) {
        const frame = readFrame(fd, &payload) catch return error.ClientPresenceUnsupported;
        switch (frame.kind) {
            .clients => return decodeAttachedClients(frame.payload),
            .failure => return error.ClientPresenceUnavailable,
            .lease, .history_complete => {},
            else => return error.InvalidServerFrame,
        }
    }
}

pub fn takeControl(
    allocator: std.mem.Allocator,
    id: []const u8,
    protocol: u32,
    last_sequence: u64,
    client_id: u64,
) !void {
    if (protocol < protocol_version) return error.TakeControlUnsupported;
    if (client_id == 0 or client_id > max_client_id) return error.InvalidClientId;
    std.debug.assert(
        id.len > 0 and protocol >= protocol_version and
            client_id > 0 and client_id <= max_client_id,
    );
    const fd = try connectForControl(allocator, id, protocol, last_sequence);
    defer closeDescriptor(fd);
    var request: [8]u8 = undefined;
    std.mem.writeInt(u64, &request, client_id, .big);
    try writeFrame(fd, .take_control, &request);
    var payload: [max_frame_payload]u8 = undefined;
    // Intentional control loop, bounded by one takeover response or socket closure.
    while (true) {
        const frame = readFrame(fd, &payload) catch return error.TakeControlUnsupported;
        switch (frame.kind) {
            .take_control => {
                if (frame.payload.len != request.len or
                    std.mem.readInt(u64, frame.payload[0..8], .big) != client_id)
                {
                    return error.InvalidTakeControlResponse;
                }
                return;
            },
            .failure => return error.AttachedClientNotFound,
            .lease, .history_complete => {},
            else => return error.InvalidServerFrame,
        }
    }
}

pub fn attach(allocator: std.mem.Allocator, id: []const u8, options: AttachOptions) !u8 {
    const path = try socketPath(allocator, id);
    defer allocator.free(path);
    const capabilities = if (options.protocol >= protocol_version)
        queryCapabilities(allocator, id, options.protocol, options.after_sequence) catch 0
    else
        0;
    const supports_presence = capabilities & Capability.client_presence != 0;
    const fd = try connectSocket(allocator, path);
    defer _ = c.close(fd);
    const uses_leases = options.protocol >= protocol_version;
    if (uses_leases) {
        const flags: u8 = if (options.read_only) 0 else LeaseFlag.writer | LeaseFlag.resize;
        const client_id = options.client_id orelse generateClientId();
        try sendAttachRequestWithRecoveryAndId(
            fd,
            flags,
            options.after_sequence,
            if (options.latest_screen) .latest_screen else .journal,
            client_id,
        );
        if (supports_presence) {
            var default_name_buffer: [64]u8 = undefined;
            const client_name = options.client_name orelse std.fmt.bufPrint(
                &default_name_buffer,
                "machinen-session pid {d}",
                .{c.getpid()},
            ) catch "machinen-session";
            try sendClientInfo(fd, c.getpid(), client_name);
        }
    }

    var original_termios: c.struct_termios = undefined;
    const interactive = c.isatty(c.STDIN_FILENO) == 1;
    var raw_enabled = false;
    if (interactive and c.tcgetattr(c.STDIN_FILENO, &original_termios) == 0) {
        var raw = original_termios;
        c.cfmakeraw(&raw);
        if (c.tcsetattr(c.STDIN_FILENO, c.TCSADRAIN, &raw) == 0) raw_enabled = true;
    }
    defer {
        if (raw_enabled) _ = c.tcsetattr(c.STDIN_FILENO, c.TCSADRAIN, &original_termios);
    }

    if (interactive and !options.read_only) {
        _ = c.signal(c.SIGWINCH, &handleResizeSignal);
        resize_pending = 1;
    }

    var stdin_open = !options.read_only;
    var writer_granted = !uses_leases and !options.read_only;
    var resize_granted = !uses_leases and !options.read_only;
    var last_heartbeat = monotonicMilliseconds();
    // Intentional client loop, bounded by socket close or worker exit.
    while (true) {
        if (resize_pending != 0 and resize_granted) {
            resize_pending = 0;
            try sendCurrentSize(fd);
        }
        const now = monotonicMilliseconds();
        if (uses_leases and now - last_heartbeat >= heartbeat_interval_ms) {
            try writeFrame(fd, .heartbeat, "");
            last_heartbeat = now;
        }
        var poll_fds = [_]c.struct_pollfd{
            .{ .fd = fd, .events = c.POLLIN, .revents = 0 },
            .{ .fd = if (stdin_open) c.STDIN_FILENO else -1, .events = c.POLLIN, .revents = 0 },
        };
        const polled = c.poll(&poll_fds, poll_fds.len, 100);
        if (polled < 0) continue;
        const received_server_frame = (poll_fds[0].revents & c.POLLIN) != 0;
        if (received_server_frame) {
            var payload: [max_frame_payload]u8 = undefined;
            const frame = readFrame(fd, &payload) catch return 0;
            switch (frame.kind) {
                .output => try writeAll(c.STDOUT_FILENO, frame.payload),
                .sequenced_output => {
                    if (frame.payload.len < sequence_header_length) return error.InvalidServerFrame;
                    try writeAll(c.STDOUT_FILENO, frame.payload[sequence_header_length..]);
                },
                .checkpoint => {
                    if (frame.payload.len < checkpoint_header_length) {
                        return error.InvalidServerFrame;
                    }
                    try writeAll(c.STDOUT_FILENO, frame.payload[checkpoint_header_length..]);
                },
                .lease => {
                    if (frame.payload.len != 2) return error.InvalidServerFrame;
                    const previous_resize = resize_granted;
                    writer_granted = frame.payload[0] & LeaseFlag.writer != 0;
                    resize_granted = frame.payload[0] & LeaseFlag.resize != 0;
                    if (resize_granted and !previous_resize) resize_pending = 1;
                },
                .history_complete, .telemetry => {},
                .exit => return decodeExit(frame.payload),
                .failure => {
                    try writeAll(c.STDERR_FILENO, frame.payload);
                    try writeAll(c.STDERR_FILENO, "\n");
                },
                else => return error.InvalidServerFrame,
            }
        }
        if (!received_server_frame and
            (poll_fds[0].revents & (c.POLLERR | c.POLLHUP | c.POLLNVAL)) != 0)
        {
            return 0;
        }
        if (stdin_open and (poll_fds[1].revents & c.POLLIN) != 0) {
            var input: [max_frame_payload]u8 = undefined;
            const count = readRetry(c.STDIN_FILENO, &input);
            if (count <= 0) {
                stdin_open = false;
            } else {
                if (writer_granted) try writeFrame(fd, .input, input[0..@intCast(count)]);
            }
        }
        if (stdin_open and (poll_fds[1].revents & (c.POLLERR | c.POLLHUP | c.POLLNVAL)) != 0) {
            stdin_open = false;
        }
    }
}

fn validateConfig(config: Config) !void {
    if (!validSessionId(config.id)) return error.InvalidSessionId;
    if (config.database_path.len == 0) return error.EmptyDatabasePath;
    if (config.working_directory.len == 0) return error.EmptyWorkingDirectory;
    if (config.argv_json.len == 0 or config.command.len == 0) return error.EmptyCommand;
    if (config.rows == 0 or config.columns == 0 or
        config.rows > vt.max_dimension or config.columns > vt.max_dimension)
    {
        return error.InvalidTerminalSize;
    }
    if (config.checkpoint_bytes == 0 or config.checkpoint_bytes > 16 * 1024 * 1024) {
        return error.InvalidCheckpointInterval;
    }
    for (config.command) |argument| if (argument.len == 0) return error.EmptyCommandArgument;
}

fn runDetachedChild(config: Config, ready_pipe: [2]c_int) noreturn {
    _ = c.close(ready_pipe[0]);
    _ = c.setsid();
    _ = c.signal(c.SIGPIPE, &ignoreSignal);
    redirectStandardStreams();
    runWorker(std.heap.c_allocator, config, ready_pipe[1]) catch {
        _ = writeRetry(ready_pipe[1], &[_]u8{0});
        _ = c.close(ready_pipe[1]);
        c._exit(1);
    };
    c._exit(0);
}

fn redirectStandardStreams() void {
    const null_fd = c.open("/dev/null", c.O_RDWR);
    if (null_fd < 0) return;
    _ = c.dup2(null_fd, c.STDIN_FILENO);
    _ = c.dup2(null_fd, c.STDOUT_FILENO);
    _ = c.dup2(null_fd, c.STDERR_FILENO);
    if (null_fd > c.STDERR_FILENO) _ = c.close(null_fd);
}

fn runWorker(allocator: std.mem.Allocator, config: Config, ready_fd: c_int) !void {
    var store = try session.Store.open(allocator, config.database_path);
    defer store.close();
    try store.createSession(.{
        .id = config.id,
        .name = config.name,
        .workspace_id = config.workspace_id,
        .working_directory = config.working_directory,
        .argv_json = config.argv_json,
        .rows = config.rows,
        .columns = config.columns,
        .protocol_version = protocol_version,
    });
    errdefer store.deleteSession(config.id) catch |err| switch (err) {
        else => {},
    };
    const path = try socketPath(allocator, config.id);
    defer allocator.free(path);
    const listen_fd = try openListener(allocator, path);
    defer {
        _ = c.close(listen_fd);
        const path_z = allocator.dupeZ(u8, path) catch null;
        if (path_z) |value| {
            _ = c.unlink(value.ptr);
            allocator.free(value);
        }
    }
    var master_fd: c_int = -1;
    const child_pid = try spawnPtyChild(allocator, config, &master_fd);
    defer _ = c.close(master_fd);
    try store.setRunning(config.id, c.getpid());
    if (writeRetry(ready_fd, &[_]u8{1}) != 1) return error.ReadyPipeFailed;
    _ = c.close(ready_fd);

    var clients = [_]Client{.{}} ** max_clients;
    var leases: Leases = .{};
    defer for (&clients) |*client| closeClient(client, &leases);
    var checkpoint_builder = try vt.Builder.init(allocator, config.rows, config.columns);
    defer checkpoint_builder.deinit();
    var live_history: LiveHistory = .{};
    defer live_history.deinit(allocator);
    var current_sequence: u64 = 0;
    const exit_code = runEventLoop(
        allocator,
        &store,
        config.id,
        master_fd,
        listen_fd,
        child_pid,
        &clients,
        &leases,
        &checkpoint_builder,
        config.checkpoint_bytes,
        &live_history,
        &current_sequence,
    );
    if (saveCheckpoint(
        &store,
        config.id,
        &checkpoint_builder,
        &live_history,
        current_sequence,
    )) std.debug.assert(live_history.dirty_since_ms == 0);
    store.setExited(config.id, exit_code) catch |err| switch (err) {
        else => {},
    };
    var exit_payload: [4]u8 = undefined;
    std.mem.writeInt(i32, &exit_payload, exit_code, .big);
    broadcast(&clients, &leases, .exit, &exit_payload);
}

fn spawnPtyChild(allocator: std.mem.Allocator, config: Config, master_fd: *c_int) !c.pid_t {
    var window = c.struct_winsize{
        .ws_row = config.rows,
        .ws_col = config.columns,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };
    const pid = c.forkpty(master_fd, null, null, &window);
    if (pid < 0) return error.ForkPtyFailed;
    if (pid != 0) return pid;

    const working_directory = allocator.dupeZ(u8, config.working_directory) catch c._exit(126);
    if (c.chdir(working_directory.ptr) != 0) c._exit(126);
    _ = c.setenv("TERM", "xterm-256color", 0);
    const argv = allocator.alloc(?[*:0]const u8, config.command.len + 1) catch c._exit(126);
    for (config.command, 0..) |argument, index| {
        argv[index] = (allocator.dupeZ(u8, argument) catch c._exit(126)).ptr;
    }
    argv[config.command.len] = null;
    _ = c.execvp(argv[0].?, @ptrCast(argv.ptr));
    c._exit(127);
}

fn runEventLoop(
    allocator: std.mem.Allocator,
    store: *session.Store,
    session_id: []const u8,
    master_fd: c_int,
    listen_fd: c_int,
    child_pid: c.pid_t,
    clients: *[max_clients]Client,
    leases: *Leases,
    checkpoint_builder: *vt.Builder,
    checkpoint_bytes: u32,
    live_history: *LiveHistory,
    current_sequence: *u64,
) i32 {
    var pending_output: OutputBatch = .{};
    defer pending_output.deinit(allocator);
    defer flushOutput(
        store,
        session_id,
        clients,
        leases,
        checkpoint_builder,
        checkpoint_bytes,
        live_history,
        current_sequence,
        &pending_output,
    );

    // Intentional worker loop, bounded by PTY exit.
    while (true) {
        var poll_fds: [2 + max_clients]c.struct_pollfd = undefined;
        poll_fds[0] = .{ .fd = master_fd, .events = c.POLLIN, .revents = 0 };
        poll_fds[1] = .{ .fd = listen_fd, .events = c.POLLIN, .revents = 0 };
        for (clients, 0..) |client, index| {
            poll_fds[index + 2] = .{
                .fd = client.fd,
                .events = if (client.fd >= 0) c.POLLIN else 0,
                .revents = 0,
            };
        }
        const timeout = pending_output.pollTimeout(monotonicMilliseconds());
        if (c.poll(&poll_fds, poll_fds.len, timeout) < 0) continue;
        refreshLeases(clients, leases);

        if ((poll_fds[1].revents & c.POLLIN) != 0) acceptClient(listen_fd, clients);
        if ((poll_fds[0].revents & c.POLLIN) != 0) {
            var output: [max_frame_payload]u8 = undefined;
            const count = readRetry(master_fd, &output);
            if (count <= 0) return waitExitCode(child_pid);
            bufferOutput(
                allocator,
                store,
                session_id,
                clients,
                leases,
                checkpoint_builder,
                checkpoint_bytes,
                live_history,
                current_sequence,
                &pending_output,
                output[0..@intCast(count)],
            );
        }
        if ((poll_fds[0].revents & (c.POLLERR | c.POLLHUP | c.POLLNVAL)) != 0) {
            drainPty(
                allocator,
                store,
                session_id,
                master_fd,
                clients,
                leases,
                checkpoint_builder,
                checkpoint_bytes,
                live_history,
                current_sequence,
                &pending_output,
            );
            return waitExitCode(child_pid);
        }
        for (clients, 0..) |*client, index| {
            if (client.fd < 0) continue;
            const events = poll_fds[index + 2].revents;
            if ((events & c.POLLIN) != 0) {
                // Sequence earlier PTY output before an attach or input can
                // observe the worker's in-memory recovery state.
                flushOutput(
                    store,
                    session_id,
                    clients,
                    leases,
                    checkpoint_builder,
                    checkpoint_bytes,
                    live_history,
                    current_sequence,
                    &pending_output,
                );
                serviceClient(
                    allocator,
                    master_fd,
                    child_pid,
                    client,
                    clients,
                    leases,
                    checkpoint_builder,
                    live_history,
                    current_sequence.*,
                );
            }
            if ((events & (c.POLLERR | c.POLLHUP | c.POLLNVAL)) != 0) closeClient(client, leases);
        }
        const now_ms = monotonicMilliseconds();
        if (pending_output.shouldFlush(now_ms)) flushOutput(
            store,
            session_id,
            clients,
            leases,
            checkpoint_builder,
            checkpoint_bytes,
            live_history,
            current_sequence,
            &pending_output,
        );
        if (live_history.shouldCheckpoint(now_ms)) {
            flushOutput(
                store,
                session_id,
                clients,
                leases,
                checkpoint_builder,
                checkpoint_bytes,
                live_history,
                current_sequence,
                &pending_output,
            );
            if (live_history.shouldCheckpoint(now_ms) and saveCheckpoint(
                store,
                session_id,
                checkpoint_builder,
                live_history,
                current_sequence.*,
            )) std.debug.assert(live_history.dirty_since_ms == 0);
        }
    }
}

fn acceptClient(listen_fd: c_int, clients: *[max_clients]Client) void {
    const fd = c.accept(listen_fd, null, null);
    if (fd < 0) return;
    if (!setSocketTimeout(fd, c.SO_SNDTIMEO, worker_client_write_timeout_ms)) {
        closeDescriptor(fd);
        return;
    }
    const slot = for (clients) |*client| {
        if (client.fd < 0) break client;
    } else {
        writeFrame(fd, .failure, "too many attached clients") catch |err| switch (err) {
            else => {},
        };
        _ = c.close(fd);
        return;
    };
    slot.* = .{
        .fd = fd,
        .connected_at_ms = realMilliseconds(),
        .last_heartbeat_ms = monotonicMilliseconds(),
    };
}

fn serviceClient(
    allocator: std.mem.Allocator,
    master_fd: c_int,
    child_pid: c.pid_t,
    client: *Client,
    clients: *[max_clients]Client,
    leases: *Leases,
    checkpoint_builder: *vt.Builder,
    live_history: *const LiveHistory,
    current_sequence: u64,
) void {
    std.debug.assert(client.fd >= 0);
    var payload: [max_frame_payload]u8 = undefined;
    const frame = readFrame(client.fd, &payload) catch {
        closeClient(client, leases);
        return;
    };
    if (!client.ready) {
        if (frame.kind != .attach_request or
            beginClient(
                allocator,
                client,
                clients,
                leases,
                checkpoint_builder,
                live_history,
                current_sequence,
                frame.payload,
            ) catch false == false)
        {
            closeClient(client, leases);
        }
        return;
    }
    serviceReadyClient(
        master_fd,
        child_pid,
        client,
        clients,
        leases,
        checkpoint_builder,
        frame,
    );
}

fn serviceReadyClient(
    master_fd: c_int,
    child_pid: c.pid_t,
    client: *Client,
    clients: *[max_clients]Client,
    leases: *Leases,
    checkpoint_builder: *vt.Builder,
    frame: Frame,
) void {
    std.debug.assert(client.ready and client.fd >= 0);
    switch (frame.kind) {
        .heartbeat => {
            client.last_heartbeat_ms = monotonicMilliseconds();
            refreshLeases(clients, leases);
        },
        .input => {
            client.last_heartbeat_ms = monotonicMilliseconds();
            refreshLeases(clients, leases);
            if (!client.control and client.granted_leases & LeaseFlag.writer == 0) return;
            writeAll(master_fd, frame.payload) catch closeClient(client, leases);
        },
        .resize => serviceClientResize(
            master_fd,
            client,
            clients,
            leases,
            checkpoint_builder,
            frame.payload,
        ),
        .signal => {
            if (!client.control and client.granted_leases & LeaseFlag.writer == 0) {
                return writeFrame(client.fd, .failure, "writer lease required for signals") catch
                    closeClient(client, leases);
            }
            if (frame.payload.len != 4) return closeClient(client, leases);
            const signal = std.mem.readInt(i32, frame.payload[0..4], .big);
            if (signal <= 0 or c.kill(-child_pid, signal) != 0) return closeClient(client, leases);
        },
        .telemetry => {
            if (frame.payload.len != 0) return closeClient(client, leases);
            sendTelemetry(client.fd, master_fd, child_pid) catch closeClient(client, leases);
        },
        .capabilities, .client_info, .clients, .take_control => serviceSessionControlFrame(
            client,
            clients,
            leases,
            frame,
        ),
        else => closeClient(client, leases),
    }
}

fn serviceSessionControlFrame(
    client: *Client,
    clients: *[max_clients]Client,
    leases: *Leases,
    frame: Frame,
) void {
    std.debug.assert(client.ready and client.fd >= 0);
    switch (frame.kind) {
        .capabilities => {
            if (!client.control or frame.payload.len != 0) return closeClient(client, leases);
            sendCapabilities(client.fd) catch closeClient(client, leases);
        },
        .client_info => {
            const applied = applyClientInfo(client, frame.payload) catch false;
            if (client.control or !applied) return closeClient(client, leases);
        },
        .clients => {
            if (!client.control or frame.payload.len != 0) return closeClient(client, leases);
            sendAttachedClients(client.fd, clients) catch closeClient(client, leases);
        },
        .take_control => {
            if (!client.control or frame.payload.len != 8) return closeClient(client, leases);
            const target_id = std.mem.readInt(u64, frame.payload[0..8], .big);
            if (!transferControl(clients, leases, target_id)) {
                writeFrame(client.fd, .failure, "attached client not found") catch
                    closeClient(client, leases);
                return;
            }
            writeFrame(client.fd, .take_control, frame.payload) catch closeClient(client, leases);
        },
        else => unreachable,
    }
}

fn serviceClientResize(
    master_fd: c_int,
    client: *Client,
    clients: *[max_clients]Client,
    leases: *Leases,
    checkpoint_builder: *vt.Builder,
    payload: []const u8,
) void {
    std.debug.assert(client.ready and client.fd >= 0);
    client.last_heartbeat_ms = monotonicMilliseconds();
    refreshLeases(clients, leases);
    if (!client.control and client.granted_leases & LeaseFlag.resize == 0) return;
    if (payload.len != 4) return closeClient(client, leases);
    const columns = std.mem.readInt(u16, payload[0..2], .big);
    const rows = std.mem.readInt(u16, payload[2..4], .big);
    if (columns == 0 or rows == 0 or
        columns > vt.max_dimension or rows > vt.max_dimension)
    {
        return closeClient(client, leases);
    }
    const window = c.struct_winsize{
        .ws_row = rows,
        .ws_col = columns,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };
    _ = c.ioctl(master_fd, c.TIOCSWINSZ, &window);
    checkpoint_builder.resize(rows, columns) catch return closeClient(client, leases);
}

fn beginClient(
    allocator: std.mem.Allocator,
    client: *Client,
    clients: *[max_clients]Client,
    leases: *Leases,
    checkpoint_builder: *vt.Builder,
    live_history: *const LiveHistory,
    current_sequence: u64,
    payload: []const u8,
) !bool {
    if (payload.len != attach_payload_length) return false;
    if (std.mem.readInt(u32, payload[0..4], .big) != protocol_version) return false;
    const flags = payload[4];
    if (flags & ~(LeaseFlag.writer | LeaseFlag.resize | LeaseFlag.control) != 0) return false;
    const recovery = std.enums.fromInt(RecoveryMode, payload[5]) orelse return false;
    const after_sequence = std.mem.readInt(u64, payload[8..16], .big);
    client.client_id = std.mem.readInt(u64, payload[16..24], .big);
    if (client.client_id == 0 or client.client_id > max_client_id) return false;
    client.control = flags & LeaseFlag.control != 0;
    client.requested_leases = flags & (LeaseFlag.writer | LeaseFlag.resize);
    if (!client.control) {
        var viewer_count: u8 = 0;
        for (clients) |other| {
            if (other.fd >= 0 and other.ready and !other.control) viewer_count += 1;
        }
        if (viewer_count >= max_viewer_clients) return false;
    }
    client.ready = true;
    client.last_heartbeat_ms = monotonicMilliseconds();
    refreshLeases(clients, leases);
    if (client.control) {
        try sendHistoryComplete(client.fd, current_sequence);
    } else {
        try replayClient(
            allocator,
            client.fd,
            after_sequence,
            checkpoint_builder,
            live_history,
            current_sequence,
            recovery,
        );
    }
    return true;
}

fn replayClient(
    allocator: std.mem.Allocator,
    fd: c_int,
    requested_after: u64,
    checkpoint_builder: *vt.Builder,
    live_history: *const LiveHistory,
    current_sequence: u64,
    recovery: RecoveryMode,
) !void {
    if (recovery == .latest_screen or
        !live_history.complete or requested_after < live_history.base_sequence)
    {
        var checkpoint = session.Checkpoint{
            .sequence = current_sequence,
            .format_version = vt.format_version,
            .payload = try checkpoint_builder.checkpoint(),
        };
        defer checkpoint.deinit(allocator);
        try sendCheckpoint(fd, checkpoint);
        try sendHistoryComplete(fd, current_sequence);
        return;
    }

    for (live_history.events.items) |event| {
        if (event.sequence > requested_after) {
            try sendSequencedOutput(fd, event.sequence, event.payload);
        }
    }
    try sendHistoryComplete(fd, current_sequence);
}

fn sendHistoryComplete(fd: c_int, sequence: u64) !void {
    std.debug.assert(fd >= 0);
    var payload: [8]u8 = undefined;
    std.mem.writeInt(u64, &payload, sequence, .big);
    try writeFrame(fd, .history_complete, &payload);
}

fn sendCheckpoint(fd: c_int, checkpoint: session.Checkpoint) !void {
    const chunk_size = max_frame_payload - checkpoint_header_length;
    var offset: usize = 0;
    while (offset < checkpoint.payload.len) {
        const end = @min(offset + chunk_size, checkpoint.payload.len);
        var payload: [max_frame_payload]u8 = undefined;
        std.mem.writeInt(u64, payload[0..8], checkpoint.sequence, .big);
        std.mem.writeInt(u32, payload[8..12], checkpoint.format_version, .big);
        payload[12] = (if (offset == 0) @as(u8, 1) else 0) |
            (if (end == checkpoint.payload.len) @as(u8, 2) else 0);
        @memcpy(
            payload[checkpoint_header_length .. checkpoint_header_length + end - offset],
            checkpoint.payload[offset..end],
        );
        try writeFrame(fd, .checkpoint, payload[0 .. checkpoint_header_length + end - offset]);
        offset = end;
    }
}

fn sendSequencedOutput(fd: c_int, sequence: u64, output: []const u8) !void {
    const chunk_size = max_frame_payload - sequence_header_length;
    var offset: usize = 0;
    while (offset < output.len) {
        const end = @min(offset + chunk_size, output.len);
        var payload: [max_frame_payload]u8 = undefined;
        std.mem.writeInt(u64, payload[0..8], sequence, .big);
        @memcpy(
            payload[sequence_header_length .. sequence_header_length + end - offset],
            output[offset..end],
        );
        try writeFrame(fd, .sequenced_output, payload[0 .. sequence_header_length + end - offset]);
        offset = end;
    }
}

fn sendCapabilities(fd: c_int) !void {
    std.debug.assert(fd >= 0);
    var payload: [4]u8 = undefined;
    std.mem.writeInt(u32, &payload, Capability.all, .big);
    try writeFrame(fd, .capabilities, &payload);
}

fn applyClientInfo(client: *Client, payload: []const u8) !bool {
    std.debug.assert(client.fd >= 0 and client.ready);
    if (payload.len < client_info_header_length) return false;
    const name_length = payload[4];
    if (name_length > client_name_capacity or
        payload.len != client_info_header_length + name_length)
    {
        return false;
    }
    const name = payload[client_info_header_length..];
    if (!std.unicode.utf8ValidateSlice(name)) return false;
    for (name) |byte| if (byte < 0x20 or byte == 0x7f) return false;
    client.client_pid = std.mem.readInt(i32, payload[0..4], .big);
    client.client_name_length = @intCast(name_length);
    @memset(&client.client_name, 0);
    @memcpy(client.client_name[0..name_length], name);
    return true;
}

fn sendAttachedClients(fd: c_int, clients: *const [max_clients]Client) !void {
    std.debug.assert(fd >= 0);
    var payload: [max_frame_payload]u8 = undefined;
    var offset: u16 = client_list_header_length;
    var count: u8 = 0;
    for (clients) |*client| {
        if (client.fd < 0 or !client.ready or client.control) continue;
        const name = client.clientName();
        const item_length: u16 = client_list_item_header_length + client.client_name_length;
        if (offset + item_length > max_frame_payload) return error.ClientListTooLarge;
        std.mem.writeInt(u64, payload[offset..][0..8], client.client_id, .big);
        std.mem.writeInt(i32, payload[offset + 8 ..][0..4], client.client_pid, .big);
        std.mem.writeInt(i64, payload[offset + 12 ..][0..8], client.connected_at_ms, .big);
        payload[offset + 20] = client.requested_leases;
        payload[offset + 21] = client.granted_leases;
        payload[offset + 22] = client.client_name_length;
        @memcpy(payload[offset + client_list_item_header_length .. offset + item_length], name);
        offset += item_length;
        count += 1;
    }
    payload[0] = count;
    try writeFrame(fd, .clients, payload[0..offset]);
}

fn transferControl(
    clients: *[max_clients]Client,
    leases: *Leases,
    target_id: u64,
) bool {
    if (target_id == 0 or target_id > max_client_id) return false;
    std.debug.assert(target_id > 0 and target_id <= max_client_id);
    const target = for (clients) |*candidate| {
        if (candidate.fd >= 0 and candidate.ready and !candidate.control and
            candidate.client_id == target_id and
            candidate.requested_leases & (LeaseFlag.writer | LeaseFlag.resize) ==
                LeaseFlag.writer | LeaseFlag.resize)
        {
            break candidate;
        }
    } else return false;
    const now = monotonicMilliseconds();
    target.last_heartbeat_ms = now;
    leases.writer_fd = target.fd;
    leases.writer_expires_ms = now + lease_duration_ms;
    leases.resize_fd = target.fd;
    leases.resize_expires_ms = now + lease_duration_ms;
    refreshLeases(clients, leases);
    return target.granted_leases & (LeaseFlag.writer | LeaseFlag.resize) ==
        LeaseFlag.writer | LeaseFlag.resize;
}

fn sendTelemetry(fd: c_int, master_fd: c_int, child_pid: c.pid_t) !void {
    std.debug.assert(fd >= 0 and master_fd >= 0 and child_pid > 0);
    const telemetry = collectTelemetry(master_fd, child_pid);
    var payload: [telemetry_header_length + telemetry_name_capacity * 2]u8 = undefined;
    const length = encodeTelemetry(telemetry, &payload);
    try writeFrame(fd, .telemetry, payload[0..length]);
}

fn collectTelemetry(master_fd: c_int, child_pid: c.pid_t) Telemetry {
    std.debug.assert(master_fd >= 0 and child_pid > 0);
    var result: Telemetry = .{ .shell_pid = @intCast(child_pid) };
    result.shell_name_length = copyProcessName(child_pid, &result.shell_name);

    const foreground_pid = c.tcgetpgrp(master_fd);
    if (foreground_pid <= 0) return result;
    result.process_pid = @intCast(foreground_pid);
    result.command_length = copyProcessName(foreground_pid, &result.command);
    if (result.command_length == 0 and foreground_pid == child_pid) {
        result.command_length = result.shell_name_length;
        @memcpy(
            result.command[0..result.command_length],
            result.shell_name[0..result.shell_name_length],
        );
    }
    result.activity = if (isShellName(result.commandName())) .idle else .working;
    return result;
}

fn copyProcessName(pid: c.pid_t, output: *[telemetry_name_capacity]u8) u8 {
    std.debug.assert(pid > 0 and output.len <= std.math.maxInt(u8));
    const count: u8 = if (builtin.os.tag == .macos) macos: {
        const value = macos.proc_name(pid, output, output.len);
        break :macos if (value > 0)
            @intCast(@min(value, @as(@TypeOf(value), output.len)))
        else
            0;
    } else linux: {
        var path: [64]u8 = undefined;
        const path_z = std.fmt.bufPrintZ(&path, "/proc/{d}/comm", .{pid}) catch break :linux 0;
        const fd = c.open(path_z.ptr, c.O_RDONLY);
        if (fd < 0) break :linux 0;
        defer closeDescriptor(fd);
        const value = c.read(fd, output, output.len);
        break :linux if (value > 0)
            @intCast(@min(value, @as(@TypeOf(value), output.len)))
        else
            0;
    };
    var length = @min(count, output.len);
    while (length > 0 and (output[length - 1] == 0 or output[length - 1] == '\n' or
        output[length - 1] == '\r'))
    {
        length -= 1;
    }
    return @intCast(length);
}

fn isShellName(name: []const u8) bool {
    std.debug.assert(name.len <= telemetry_name_capacity);
    const shells = [_][]const u8{ "sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "csh", "nu" };
    for (shells) |shell| if (std.mem.eql(u8, name, shell)) return true;
    return false;
}

fn encodeTelemetry(
    telemetry: Telemetry,
    output: *[telemetry_header_length + telemetry_name_capacity * 2]u8,
) u16 {
    std.debug.assert(telemetry.shell_name_length <= telemetry_name_capacity);
    std.debug.assert(telemetry.command_length <= telemetry_name_capacity);
    output[0] = @intFromEnum(telemetry.activity);
    @memset(output[1..4], 0);
    std.mem.writeInt(i32, output[4..8], telemetry.shell_pid, .big);
    std.mem.writeInt(i32, output[8..12], telemetry.process_pid, .big);
    output[12] = telemetry.shell_name_length;
    output[13] = telemetry.command_length;
    const shell_end: u16 = telemetry_header_length + telemetry.shell_name_length;
    const command_end: u16 = shell_end + telemetry.command_length;
    @memcpy(output[telemetry_header_length..shell_end], telemetry.shellName());
    @memcpy(output[shell_end..command_end], telemetry.commandName());
    return command_end;
}

fn decodeTelemetry(payload: []const u8) !Telemetry {
    std.debug.assert(telemetry_name_capacity <= std.math.maxInt(u8));
    if (payload.len < telemetry_header_length) return error.InvalidTelemetry;
    const activity = std.enums.fromInt(Activity, payload[0]) orelse return error.InvalidTelemetry;
    const shell_length = payload[12];
    const command_length = payload[13];
    const shell_end: u16 = telemetry_header_length + shell_length;
    const command_end: u16 = shell_end + command_length;
    if (command_end != payload.len) return error.InvalidTelemetry;
    var result: Telemetry = .{
        .activity = activity,
        .shell_pid = std.mem.readInt(i32, payload[4..8], .big),
        .process_pid = std.mem.readInt(i32, payload[8..12], .big),
        .shell_name_length = shell_length,
        .command_length = command_length,
    };
    @memcpy(result.shell_name[0..shell_length], payload[telemetry_header_length..shell_end]);
    @memcpy(result.command[0..command_length], payload[shell_end..command_end]);
    return result;
}

fn bufferOutput(
    allocator: std.mem.Allocator,
    store: *session.Store,
    session_id: []const u8,
    clients: *[max_clients]Client,
    leases: *Leases,
    checkpoint_builder: *vt.Builder,
    checkpoint_bytes: u32,
    live_history: *LiveHistory,
    current_sequence: *u64,
    pending: *OutputBatch,
    output: []const u8,
) void {
    std.debug.assert(output.len > 0 and session_id.len > 0);
    pending.append(allocator, output, monotonicMilliseconds()) catch {
        flushOutput(
            store,
            session_id,
            clients,
            leases,
            checkpoint_builder,
            checkpoint_bytes,
            live_history,
            current_sequence,
            pending,
        );
        checkpoint_builder.feed(output);
        publishOutput(
            store,
            session_id,
            clients,
            leases,
            checkpoint_builder,
            checkpoint_bytes,
            live_history,
            current_sequence,
            output,
        );
        return;
    };
    checkpoint_builder.feed(output);
    if (pending.bytes.items.len >= output_batch_bytes) flushOutput(
        store,
        session_id,
        clients,
        leases,
        checkpoint_builder,
        checkpoint_bytes,
        live_history,
        current_sequence,
        pending,
    );
}

fn flushOutput(
    store: *session.Store,
    session_id: []const u8,
    clients: *[max_clients]Client,
    leases: *Leases,
    checkpoint_builder: *vt.Builder,
    checkpoint_bytes: u32,
    live_history: *LiveHistory,
    current_sequence: *u64,
    pending: *OutputBatch,
) void {
    if (pending.bytes.items.len == 0) return;
    std.debug.assert(pending.started_at_ms > 0 and session_id.len > 0);
    publishOutput(
        store,
        session_id,
        clients,
        leases,
        checkpoint_builder,
        checkpoint_bytes,
        live_history,
        current_sequence,
        pending.bytes.items,
    );
    pending.clear();
}

fn publishOutput(
    store: *session.Store,
    session_id: []const u8,
    clients: *[max_clients]Client,
    leases: *Leases,
    checkpoint_builder: *vt.Builder,
    checkpoint_bytes: u32,
    live_history: *LiveHistory,
    current_sequence: *u64,
    output: []const u8,
) void {
    std.debug.assert(output.len > 0 and session_id.len > 0);
    current_sequence.* += 1;
    live_history.append(
        checkpoint_builder.allocator,
        current_sequence.*,
        output,
        monotonicMilliseconds(),
    ) catch {
        live_history.discard(checkpoint_builder.allocator);
    };
    broadcastOutput(clients, leases, current_sequence.*, output);
    if (checkpoint_builder.shouldCheckpoint(checkpoint_bytes) and saveCheckpoint(
        store,
        session_id,
        checkpoint_builder,
        live_history,
        current_sequence.*,
    )) std.debug.assert(live_history.dirty_since_ms == 0);
}

fn drainPty(
    allocator: std.mem.Allocator,
    store: *session.Store,
    session_id: []const u8,
    master_fd: c_int,
    clients: *[max_clients]Client,
    leases: *Leases,
    checkpoint_builder: *vt.Builder,
    checkpoint_bytes: u32,
    live_history: *LiveHistory,
    current_sequence: *u64,
    pending: *OutputBatch,
) void {
    // EOF-bounded PTY drain.
    while (true) {
        var output: [max_frame_payload]u8 = undefined;
        const count = readRetry(master_fd, &output);
        if (count <= 0) return;
        bufferOutput(
            allocator,
            store,
            session_id,
            clients,
            leases,
            checkpoint_builder,
            checkpoint_bytes,
            live_history,
            current_sequence,
            pending,
            output[0..@intCast(count)],
        );
    }
}

fn saveCheckpoint(
    store: *session.Store,
    session_id: []const u8,
    builder: *vt.Builder,
    live_history: *LiveHistory,
    sequence: u64,
) bool {
    const payload = builder.checkpoint() catch return false;
    defer builder.allocator.free(payload);
    const persisted_sequence = store.replaceRecoveryCheckpoint(
        session_id,
        sequence,
        vt.format_version,
        payload,
        builder.columns,
        builder.rows,
    ) catch return false;
    if (persisted_sequence != sequence) return false;
    builder.didCheckpoint();
    live_history.reset(builder.allocator, sequence);
    return true;
}

fn broadcastOutput(
    clients: *[max_clients]Client,
    leases: *Leases,
    sequence: u64,
    payload: []const u8,
) void {
    for (clients) |*client| {
        if (client.fd >= 0 and client.ready and !client.control) {
            sendSequencedOutput(client.fd, sequence, payload) catch closeClient(client, leases);
        }
    }
}

fn broadcast(
    clients: *[max_clients]Client,
    leases: *Leases,
    kind: FrameType,
    payload: []const u8,
) void {
    for (clients) |*client| {
        if (client.fd >= 0 and client.ready) writeFrame(client.fd, kind, payload) catch
            closeClient(client, leases);
    }
}

fn refreshLeases(clients: *[max_clients]Client, leases: *Leases) void {
    const now = monotonicMilliseconds();
    if (leases.writer_fd >= 0 and now >= leases.writer_expires_ms) leases.writer_fd = -1;
    if (leases.resize_fd >= 0 and now >= leases.resize_expires_ms) leases.resize_fd = -1;
    for (clients) |*client| {
        const previous = client.granted_leases;
        client.granted_leases = 0;
        if (client.fd >= 0 and client.ready and !client.control and
            now - client.last_heartbeat_ms < lease_duration_ms)
        {
            if (client.requested_leases & LeaseFlag.writer != 0 and
                (leases.writer_fd < 0 or leases.writer_fd == client.fd))
            {
                leases.writer_fd = client.fd;
                leases.writer_expires_ms = client.last_heartbeat_ms + lease_duration_ms;
                client.granted_leases |= LeaseFlag.writer;
            }
            if (client.requested_leases & LeaseFlag.resize != 0 and
                (leases.resize_fd < 0 or leases.resize_fd == client.fd))
            {
                leases.resize_fd = client.fd;
                leases.resize_expires_ms = client.last_heartbeat_ms + lease_duration_ms;
                client.granted_leases |= LeaseFlag.resize;
            }
        }
        if (client.fd >= 0 and client.ready and previous != client.granted_leases) {
            const status = [_]u8{ client.granted_leases, client.requested_leases };
            writeFrame(client.fd, .lease, &status) catch closeClient(client, leases);
        }
    }
}

fn closeClient(client: *Client, leases: *Leases) void {
    if (leases.writer_fd == client.fd) leases.writer_fd = -1;
    if (leases.resize_fd == client.fd) leases.resize_fd = -1;
    if (client.fd >= 0) _ = c.close(client.fd);
    client.* = .{};
}

fn openListener(allocator: std.mem.Allocator, path: []const u8) !c_int {
    const directory = std.fs.path.dirname(path) orelse return error.InvalidSocketPath;
    const directory_z = try allocator.dupeZ(u8, directory);
    defer allocator.free(directory_z);
    if (c.mkdir(directory_z.ptr, 0o700) != 0 and errnoValue() != c.EEXIST) {
        return error.CreateRuntimeDirectoryFailed;
    }
    if (c.chmod(directory_z.ptr, 0o700) != 0) return error.RuntimeDirectoryPermissionsFailed;

    const path_z = try allocator.dupeZ(u8, path);
    defer allocator.free(path_z);
    _ = c.unlink(path_z.ptr);
    const fd = c.socket(c.AF_UNIX, c.SOCK_STREAM, 0);
    if (fd < 0) return error.SocketFailed;
    errdefer _ = c.close(fd);
    setCloseOnExec(fd);
    var address: c.struct_sockaddr_un = std.mem.zeroes(c.struct_sockaddr_un);
    if (path.len >= address.sun_path.len) return error.SocketPathTooLong;
    address.sun_family = c.AF_UNIX;
    @memcpy(address.sun_path[0..path.len], path);
    if (c.bind(fd, @ptrCast(&address), @sizeOf(c.struct_sockaddr_un)) != 0) return error.BindFailed;
    if (c.chmod(path_z.ptr, 0o600) != 0) return error.SocketPermissionsFailed;
    if (c.listen(fd, max_clients) != 0) return error.ListenFailed;
    return fd;
}

fn connectForControl(
    allocator: std.mem.Allocator,
    id: []const u8,
    protocol: u32,
    last_sequence: u64,
) !c_int {
    const path = try socketPath(allocator, id);
    defer allocator.free(path);
    const fd = try connectSocketWithTimeout(allocator, path, control_io_timeout_ms);
    errdefer _ = c.close(fd);
    if (protocol >= protocol_version) try sendAttachRequest(fd, LeaseFlag.control, last_sequence);
    var payload: [max_frame_payload]u8 = undefined;
    // Intentional handshake loop, bounded by history completion or socket close.
    while (true) {
        const frame = try readFrame(fd, &payload);
        switch (frame.kind) {
            .output, .sequenced_output, .checkpoint, .lease => {},
            .history_complete => return fd,
            .exit => return error.SessionExited,
            .failure => return error.SessionFailure,
            else => return error.InvalidServerFrame,
        }
    }
}

fn queryCapabilities(
    allocator: std.mem.Allocator,
    id: []const u8,
    protocol: u32,
    last_sequence: u64,
) !u32 {
    std.debug.assert(id.len > 0 and protocol >= protocol_version);
    const fd = try connectForControl(allocator, id, protocol, last_sequence);
    defer closeDescriptor(fd);
    try writeFrame(fd, .capabilities, "");
    var payload: [max_frame_payload]u8 = undefined;
    // Intentional control loop, bounded by one capabilities response or socket closure.
    while (true) {
        const frame = try readFrame(fd, &payload);
        switch (frame.kind) {
            .capabilities => {
                if (frame.payload.len != 4) return error.InvalidCapabilities;
                return std.mem.readInt(u32, frame.payload[0..4], .big);
            },
            .failure => return error.CapabilitiesUnavailable,
            .lease, .history_complete => {},
            else => return error.InvalidServerFrame,
        }
    }
}

fn sendClientInfo(fd: c_int, pid: c.pid_t, name: []const u8) !void {
    std.debug.assert(fd >= 0 and pid > 0);
    if (name.len > client_name_capacity or !std.unicode.utf8ValidateSlice(name)) {
        return error.InvalidClientName;
    }
    for (name) |byte| if (byte < 0x20 or byte == 0x7f) return error.InvalidClientName;
    var payload: [client_info_header_length + client_name_capacity]u8 = @splat(0);
    std.mem.writeInt(i32, payload[0..4], @intCast(pid), .big);
    payload[4] = @intCast(name.len);
    @memcpy(payload[client_info_header_length .. client_info_header_length + name.len], name);
    try writeFrame(fd, .client_info, payload[0 .. client_info_header_length + name.len]);
}

fn decodeAttachedClients(payload: []const u8) !AttachedClients {
    if (payload.len < client_list_header_length) return error.InvalidClientList;
    const expected_count = payload[0];
    if (expected_count > max_viewer_clients) return error.InvalidClientList;
    std.debug.assert(expected_count <= max_attached_clients);
    var result: AttachedClients = .{};
    const payload_length: u16 = @intCast(payload.len);
    var offset: u16 = client_list_header_length;
    for (0..expected_count) |_| {
        if (payload_length - offset < client_list_item_header_length) {
            return error.InvalidClientList;
        }
        const name_length = payload[offset + 22];
        const item_end: u16 = offset + client_list_item_header_length + name_length;
        if (name_length > client_name_capacity or item_end > payload_length) {
            return error.InvalidClientList;
        }
        const id = std.mem.readInt(u64, payload[offset..][0..8], .big);
        const pid = std.mem.readInt(i32, payload[offset + 8 ..][0..4], .big);
        const requested = payload[offset + 20];
        const granted = payload[offset + 21];
        const encoded_name = payload[offset + client_list_item_header_length .. item_end];
        if (!std.unicode.utf8ValidateSlice(encoded_name)) return error.InvalidClientList;
        const client = &result.items[result.count];
        client.* = .{
            .id = id,
            .pid = if (pid > 0) pid else null,
            .connectedAtMs = std.mem.readInt(
                i64,
                payload[offset + 12 ..][0..8],
                .big,
            ),
            .writer = granted & LeaseFlag.writer != 0,
            .resize = granted & LeaseFlag.resize != 0,
            .readOnly = requested & (LeaseFlag.writer | LeaseFlag.resize) == 0,
        };
        const name = if (encoded_name.len > 0)
            encoded_name
        else
            std.fmt.bufPrint(&client.name_buffer, "client {d}", .{id}) catch
                return error.InvalidClientList;
        if (encoded_name.len > 0) @memcpy(client.name_buffer[0..name.len], name);
        client.name_length = @intCast(name.len);
        result.count += 1;
        offset = item_end;
    }
    if (offset != payload_length) return error.InvalidClientList;
    return result;
}

fn generateClientId() u64 {
    const raw = (@as(u64, @intCast(c.getpid())) << 32) ^
        @as(u64, @bitCast(monotonicMilliseconds()));
    const id = raw % max_client_id + 1;
    std.debug.assert(id > 0 and id <= max_client_id);
    return id;
}

fn sendAttachRequest(fd: c_int, flags: u8, after_sequence: u64) !void {
    try sendAttachRequestWithRecovery(fd, flags, after_sequence, .journal);
}

fn sendAttachRequestWithRecovery(
    fd: c_int,
    flags: u8,
    after_sequence: u64,
    recovery: RecoveryMode,
) !void {
    try sendAttachRequestWithRecoveryAndId(
        fd,
        flags,
        after_sequence,
        recovery,
        generateClientId(),
    );
}

fn sendAttachRequestWithRecoveryAndId(
    fd: c_int,
    flags: u8,
    after_sequence: u64,
    recovery: RecoveryMode,
    client_id: u64,
) !void {
    std.debug.assert(fd >= 0);
    std.debug.assert(flags & ~(LeaseFlag.writer | LeaseFlag.resize | LeaseFlag.control) == 0);
    var payload: [attach_payload_length]u8 = @splat(0);
    std.mem.writeInt(u32, payload[0..4], protocol_version, .big);
    payload[4] = flags;
    payload[5] = @intFromEnum(recovery);
    std.mem.writeInt(u64, payload[8..16], after_sequence, .big);
    std.mem.writeInt(u64, payload[16..24], client_id, .big);
    try writeFrame(fd, .attach_request, &payload);
}

pub fn workerReachable(allocator: std.mem.Allocator, id: []const u8) bool {
    const path = socketPath(allocator, id) catch return false;
    defer allocator.free(path);
    const fd = connectSocketWithTimeout(allocator, path, control_io_timeout_ms) catch return false;
    _ = c.close(fd);
    return true;
}

pub fn removeStaleSocket(allocator: std.mem.Allocator, id: []const u8) void {
    const path = socketPath(allocator, id) catch return;
    defer allocator.free(path);
    const path_z = allocator.dupeZ(u8, path) catch return;
    defer allocator.free(path_z);
    _ = c.unlink(path_z.ptr);
}

fn connectSocket(allocator: std.mem.Allocator, path: []const u8) !c_int {
    return connectSocketWithTimeout(allocator, path, null);
}

fn connectSocketWithTimeout(
    allocator: std.mem.Allocator,
    path: []const u8,
    timeout_ms: ?i64,
) !c_int {
    _ = allocator;
    const fd = c.socket(c.AF_UNIX, c.SOCK_STREAM, 0);
    if (fd < 0) return error.SocketFailed;
    errdefer _ = c.close(fd);
    if (timeout_ms) |value| {
        if (!setSocketTimeout(fd, c.SO_RCVTIMEO, value) or
            !setSocketTimeout(fd, c.SO_SNDTIMEO, value))
        {
            return error.ConfigureSocketTimeoutFailed;
        }
    }
    var address: c.struct_sockaddr_un = std.mem.zeroes(c.struct_sockaddr_un);
    if (path.len >= address.sun_path.len) return error.SocketPathTooLong;
    address.sun_family = c.AF_UNIX;
    @memcpy(address.sun_path[0..path.len], path);
    if (c.connect(fd, @ptrCast(&address), @sizeOf(c.struct_sockaddr_un)) != 0) {
        return error.ConnectFailed;
    }
    return fd;
}

const Frame = struct {
    kind: FrameType,
    payload: []const u8,
};

fn writeFrame(fd: c_int, kind: FrameType, payload: []const u8) !void {
    if (payload.len > max_frame_payload) return error.FrameTooLarge;
    var header: [5]u8 = undefined;
    header[0] = @intFromEnum(kind);
    std.mem.writeInt(u32, header[1..5], @intCast(payload.len), .big);
    try writeAll(fd, &header);
    if (payload.len > 0) try writeAll(fd, payload);
}

fn readFrame(fd: c_int, payload: *[max_frame_payload]u8) !Frame {
    var header: [5]u8 = undefined;
    try readExact(fd, &header);
    const kind = std.enums.fromInt(FrameType, header[0]) orelse return error.UnknownFrame;
    const length: usize = std.mem.readInt(u32, header[1..5], .big);
    if (length > payload.len) return error.FrameTooLarge;
    if (length > 0) try readExact(fd, payload[0..length]);
    return .{ .kind = kind, .payload = payload[0..length] };
}

fn readExact(fd: c_int, output: []u8) !void {
    var offset: usize = 0;
    while (offset < output.len) {
        const count = readRetry(fd, output[offset..]);
        if (count <= 0) return error.EndOfStream;
        offset += @intCast(count);
    }
}

fn readRetry(fd: c_int, output: []u8) isize {
    // Intentional retry loop, bounded by a non-EINTR read result.
    while (true) {
        const count = c.read(fd, output.ptr, output.len);
        if (count < 0 and errnoValue() == c.EINTR) continue;
        return count;
    }
}

fn writeAll(fd: c_int, input: []const u8) !void {
    var offset: usize = 0;
    while (offset < input.len) {
        const count = writeRetry(fd, input[offset..]);
        if (count <= 0) return error.WriteFailed;
        offset += @intCast(count);
    }
}

fn writeRetry(fd: c_int, input: []const u8) isize {
    // Intentional retry loop, bounded by a non-EINTR write result.
    while (true) {
        const count = c.write(fd, input.ptr, input.len);
        if (count < 0 and errnoValue() == c.EINTR) continue;
        return count;
    }
}

fn sendCurrentSize(fd: c_int) !void {
    var window: c.struct_winsize = std.mem.zeroes(c.struct_winsize);
    if (c.ioctl(c.STDIN_FILENO, c.TIOCGWINSZ, &window) != 0) return;
    if (window.ws_col == 0 or window.ws_row == 0) return;
    var payload: [4]u8 = undefined;
    std.mem.writeInt(u16, payload[0..2], window.ws_col, .big);
    std.mem.writeInt(u16, payload[2..4], window.ws_row, .big);
    try writeFrame(fd, .resize, &payload);
}

fn handleResizeSignal(_: c_int) callconv(.c) void {
    resize_pending = 1;
}

fn ignoreSignal(_: c_int) callconv(.c) void {}

fn closeDescriptor(fd: c_int) void {
    std.debug.assert(fd >= 0);
    if (c.close(fd) == 0) return;
}

fn signalProcess(pid: c.pid_t, signal: c_int) void {
    std.debug.assert(pid > 0 and signal > 0);
    if (c.kill(pid, signal) == 0) return;
}

fn waitExitCode(child_pid: c.pid_t) i32 {
    var status: c_int = 0;
    while (c.waitpid(child_pid, &status, 0) < 0) {
        if (errnoValue() != c.EINTR) return 1;
    }
    if (c.WIFEXITED(status)) return c.WEXITSTATUS(status);
    if (c.WIFSIGNALED(status)) return 128 + c.WTERMSIG(status);
    return 1;
}

fn decodeExit(payload: []const u8) u8 {
    if (payload.len != 4) return 1;
    const value = std.mem.readInt(i32, payload[0..4], .big);
    if (value < 0) return 1;
    return @intCast(@min(value, 255));
}

fn setCloseOnExec(fd: c_int) void {
    const flags = c.fcntl(fd, c.F_GETFD);
    if (flags >= 0) _ = c.fcntl(fd, c.F_SETFD, flags | c.FD_CLOEXEC);
}

fn setSocketTimeout(fd: c_int, option: c_int, timeout_ms: i64) bool {
    if (fd < 0 or timeout_ms <= 0) return false;
    var timeout = c.struct_timeval{
        .tv_sec = @intCast(@divFloor(timeout_ms, 1_000)),
        .tv_usec = @intCast(@mod(timeout_ms, 1_000) * 1_000),
    };
    return c.setsockopt(
        fd,
        c.SOL_SOCKET,
        option,
        &timeout,
        @intCast(@sizeOf(c.struct_timeval)),
    ) == 0;
}

fn monotonicMilliseconds() i64 {
    var value: std.c.timespec = undefined;
    if (std.c.clock_gettime(.MONOTONIC, &value) != 0) return 0;
    return @as(i64, @intCast(value.sec)) * 1_000 +
        @divFloor(@as(i64, @intCast(value.nsec)), std.time.ns_per_ms);
}

fn realMilliseconds() i64 {
    var value: std.c.timespec = undefined;
    if (std.c.clock_gettime(.REALTIME, &value) != 0) return 0;
    std.debug.assert(value.nsec >= 0 and value.nsec < std.time.ns_per_s);
    return @as(i64, @intCast(value.sec)) * 1_000 +
        @divFloor(@as(i64, @intCast(value.nsec)), std.time.ns_per_ms);
}

fn errnoValue() c_int {
    return if (builtin.os.tag == .macos) c.__error().* else c.__errno_location().*;
}

fn freeEvents(allocator: std.mem.Allocator, events: []session.Event) void {
    for (events) |*event| event.deinit(allocator);
    allocator.free(events);
}

test "socket receive deadlines bound stalled control peers" {
    var pair: [2]c_int = undefined;
    try std.testing.expectEqual(@as(c_int, 0), c.socketpair(c.AF_UNIX, c.SOCK_STREAM, 0, &pair));
    defer closeDescriptor(pair[0]);
    defer closeDescriptor(pair[1]);
    try std.testing.expect(setSocketTimeout(pair[0], c.SO_RCVTIMEO, 20));

    var byte: [1]u8 = undefined;
    const started = monotonicMilliseconds();
    try std.testing.expectError(error.EndOfStream, readExact(pair[0], &byte));
    const elapsed = monotonicMilliseconds() - started;
    try std.testing.expect(elapsed >= 0 and elapsed < 1_000);
}

test "session IDs are safe for portable Unix socket paths" {
    try std.testing.expect(validSessionId("term_api-1.shell"));
    try std.testing.expect(!validSessionId(""));
    try std.testing.expect(!validSessionId("../escape"));
    try std.testing.expect(!validSessionId("contains space"));
}

test "output batches flush at their byte or latency bound" {
    const allocator = std.testing.allocator;
    var batch: OutputBatch = .{};
    defer batch.deinit(allocator);
    try batch.append(allocator, "first", 100);
    try batch.append(allocator, "second", 105);
    try std.testing.expect(!batch.shouldFlush(115));
    try std.testing.expectEqual(@as(c_int, 1), batch.pollTimeout(115));
    try std.testing.expect(batch.shouldFlush(116));
    try std.testing.expectEqual(@as(c_int, 0), batch.pollTimeout(116));
    batch.clear();
    try std.testing.expectEqual(@as(c_int, 1_000), batch.pollTimeout(200));
}

test "dirty live history receives a periodic durable checkpoint deadline" {
    const allocator = std.testing.allocator;
    var history: LiveHistory = .{};
    defer history.deinit(allocator);
    try history.append(allocator, 1, "output", 100);
    try std.testing.expect(!history.shouldCheckpoint(60_099));
    try std.testing.expect(history.shouldCheckpoint(60_100));
    history.reset(allocator, 1);
    try std.testing.expect(!history.shouldCheckpoint(120_000));
}

test "framing preserves terminal bytes" {
    var sockets: [2]c_int = undefined;
    try std.testing.expectEqual(@as(c_int, 0), c.socketpair(c.AF_UNIX, c.SOCK_STREAM, 0, &sockets));
    defer _ = c.close(sockets[0]);
    defer _ = c.close(sockets[1]);
    try writeFrame(sockets[0], .output, "one\x00two");
    var payload: [max_frame_payload]u8 = undefined;
    const frame = try readFrame(sockets[1], &payload);
    try std.testing.expectEqual(FrameType.output, frame.kind);
    try std.testing.expectEqualSlices(u8, "one\x00two", frame.payload);
}

test "attach request encodes latest-screen recovery in the reserved-compatible byte" {
    var sockets: [2]c_int = undefined;
    try std.testing.expectEqual(@as(c_int, 0), c.socketpair(c.AF_UNIX, c.SOCK_STREAM, 0, &sockets));
    defer closeDescriptor(sockets[0]);
    defer closeDescriptor(sockets[1]);
    try sendAttachRequestWithRecovery(
        sockets[0],
        LeaseFlag.writer | LeaseFlag.resize,
        0,
        .latest_screen,
    );
    var payload: [max_frame_payload]u8 = undefined;
    const frame = try readFrame(sockets[1], &payload);
    try std.testing.expectEqual(FrameType.attach_request, frame.kind);
    try std.testing.expectEqual(attach_payload_length, frame.payload.len);
    try std.testing.expectEqual(@intFromEnum(RecoveryMode.latest_screen), frame.payload[5]);
}

test "telemetry framing preserves activity and process metadata" {
    var telemetry: Telemetry = .{
        .activity = .working,
        .shell_pid = 42,
        .process_pid = 84,
        .shell_name_length = 3,
        .command_length = 4,
    };
    @memcpy(telemetry.shell_name[0..3], "zsh");
    @memcpy(telemetry.command[0..4], "node");
    var payload: [telemetry_header_length + telemetry_name_capacity * 2]u8 = undefined;
    const length = encodeTelemetry(telemetry, &payload);
    const decoded = try decodeTelemetry(payload[0..length]);
    try std.testing.expectEqual(Activity.working, decoded.activity);
    try std.testing.expectEqual(@as(i32, 42), decoded.shell_pid);
    try std.testing.expectEqual(@as(i32, 84), decoded.process_pid);
    try std.testing.expectEqualStrings("zsh", decoded.shellName());
    try std.testing.expectEqualStrings("node", decoded.commandName());
}

test "explicit takeover transfers writer and resize while keeping both viewers attached" {
    var first_pair: [2]c_int = undefined;
    var second_pair: [2]c_int = undefined;
    try std.testing.expectEqual(
        @as(c_int, 0),
        c.socketpair(c.AF_UNIX, c.SOCK_STREAM, 0, &first_pair),
    );
    try std.testing.expectEqual(
        @as(c_int, 0),
        c.socketpair(c.AF_UNIX, c.SOCK_STREAM, 0, &second_pair),
    );
    defer closeDescriptor(first_pair[1]);
    defer closeDescriptor(second_pair[1]);
    const now = monotonicMilliseconds();
    var clients = [_]Client{.{}} ** max_clients;
    clients[0] = .{
        .fd = first_pair[0],
        .ready = true,
        .requested_leases = LeaseFlag.writer | LeaseFlag.resize,
        .client_id = 11,
        .last_heartbeat_ms = now,
    };
    clients[1] = .{
        .fd = second_pair[0],
        .ready = true,
        .requested_leases = LeaseFlag.writer | LeaseFlag.resize,
        .client_id = 22,
        .last_heartbeat_ms = now,
    };
    var leases: Leases = .{};
    refreshLeases(&clients, &leases);
    try std.testing.expectEqual(
        LeaseFlag.writer | LeaseFlag.resize,
        clients[0].granted_leases,
    );
    try std.testing.expectEqual(@as(u8, 0), clients[1].granted_leases);

    try std.testing.expect(transferControl(&clients, &leases, 22));
    try std.testing.expectEqual(@as(u8, 0), clients[0].granted_leases);
    try std.testing.expectEqual(
        LeaseFlag.writer | LeaseFlag.resize,
        clients[1].granted_leases,
    );
    try std.testing.expect(clients[0].fd >= 0 and clients[1].fd >= 0);
    clients[0].requested_leases = 0;
    try std.testing.expect(!transferControl(&clients, &leases, 11));
    try std.testing.expect(!transferControl(&clients, &leases, 33));
    closeClient(&clients[0], &leases);
    closeClient(&clients[1], &leases);
}

test "attached client snapshots include identity and control ownership" {
    var pair: [2]c_int = undefined;
    try std.testing.expectEqual(@as(c_int, 0), c.socketpair(c.AF_UNIX, c.SOCK_STREAM, 0, &pair));
    defer closeDescriptor(pair[0]);
    defer closeDescriptor(pair[1]);
    var clients = [_]Client{.{}} ** max_clients;
    clients[0] = .{
        .fd = 42,
        .ready = true,
        .requested_leases = LeaseFlag.writer | LeaseFlag.resize,
        .granted_leases = LeaseFlag.writer | LeaseFlag.resize,
        .client_id = 123,
        .client_pid = 456,
        .client_name_length = 7,
        .connected_at_ms = 789,
    };
    @memcpy(clients[0].client_name[0..7], "desktop");
    try sendAttachedClients(pair[0], &clients);
    var payload: [max_frame_payload]u8 = undefined;
    const frame = try readFrame(pair[1], &payload);
    try std.testing.expectEqual(FrameType.clients, frame.kind);
    const decoded = try decodeAttachedClients(frame.payload);
    const attached = decoded.slice();
    try std.testing.expect(attached.len == 1);
    try std.testing.expectEqual(@as(u64, 123), attached[0].id);
    try std.testing.expectEqualStrings("desktop", attached[0].name());
    try std.testing.expectEqual(@as(i32, 456), attached[0].pid.?);
    try std.testing.expectEqual(@as(i64, 789), attached[0].connectedAtMs);
    try std.testing.expect(attached[0].writer and attached[0].resize and !attached[0].readOnly);
}

test "writer and resize leases transfer when the owning client disconnects" {
    var first_pair: [2]c_int = undefined;
    var second_pair: [2]c_int = undefined;
    try std.testing.expectEqual(
        @as(c_int, 0),
        c.socketpair(c.AF_UNIX, c.SOCK_STREAM, 0, &first_pair),
    );
    try std.testing.expectEqual(
        @as(c_int, 0),
        c.socketpair(c.AF_UNIX, c.SOCK_STREAM, 0, &second_pair),
    );
    defer _ = c.close(first_pair[1]);
    defer _ = c.close(second_pair[1]);
    const now = monotonicMilliseconds();
    var clients = [_]Client{.{}} ** max_clients;
    clients[0] = .{
        .fd = first_pair[0],
        .ready = true,
        .requested_leases = LeaseFlag.writer | LeaseFlag.resize,
        .last_heartbeat_ms = now,
    };
    clients[1] = .{
        .fd = second_pair[0],
        .ready = true,
        .requested_leases = LeaseFlag.writer | LeaseFlag.resize,
        .last_heartbeat_ms = now,
    };
    var leases: Leases = .{};
    refreshLeases(&clients, &leases);
    try std.testing.expectEqual(LeaseFlag.writer | LeaseFlag.resize, clients[0].granted_leases);
    try std.testing.expectEqual(@as(u8, 0), clients[1].granted_leases);
    closeClient(&clients[0], &leases);
    refreshLeases(&clients, &leases);
    try std.testing.expectEqual(LeaseFlag.writer | LeaseFlag.resize, clients[1].granted_leases);
    closeClient(&clients[1], &leases);
}

fn workerTestDatabasePath(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return std.fs.path.join(
        allocator,
        &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path, "worker.sqlite3" },
    );
}

test "buffered PTY fragments use one in-memory event and no raw SQLite output" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const database_path = try workerTestDatabasePath(allocator, &tmp);
    defer allocator.free(database_path);
    const id = "worker_output_batch_proof";
    var store = try session.Store.open(allocator, database_path);
    defer store.close();
    try store.createSession(.{
        .id = id,
        .working_directory = "/tmp",
        .argv_json = "[\"/bin/sh\"]",
        .rows = 2,
        .columns = 12,
        .protocol_version = protocol_version,
    });
    var clients = [_]Client{.{}} ** max_clients;
    var leases: Leases = .{};
    var builder = try vt.Builder.init(allocator, 2, 12);
    defer builder.deinit();
    var pending: OutputBatch = .{};
    defer pending.deinit(allocator);
    var live_history: LiveHistory = .{};
    defer live_history.deinit(allocator);
    var current_sequence: u64 = 0;

    bufferOutput(
        allocator,
        &store,
        id,
        &clients,
        &leases,
        &builder,
        16 * 1024 * 1024,
        &live_history,
        &current_sequence,
        &pending,
        "one",
    );
    bufferOutput(
        allocator,
        &store,
        id,
        &clients,
        &leases,
        &builder,
        16 * 1024 * 1024,
        &live_history,
        &current_sequence,
        &pending,
        "-two",
    );
    flushOutput(
        &store,
        id,
        &clients,
        &leases,
        &builder,
        16 * 1024 * 1024,
        &live_history,
        &current_sequence,
        &pending,
    );

    try std.testing.expectEqual(@as(u64, 1), current_sequence);
    try std.testing.expect(live_history.events.items.len == 1);
    try std.testing.expectEqualStrings("one-two", live_history.events.items[0].payload);
    const info = try store.info();
    try std.testing.expectEqual(@as(u64, 0), info.event_count);
    try std.testing.expectEqual(@as(u64, 0), info.checkpoint_count);
}

test "high-volume redraws persist a bounded screen instead of a disk transcript" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const database_path = try workerTestDatabasePath(allocator, &tmp);
    defer allocator.free(database_path);
    const id = "worker_bounded_disk_proof";
    var store = try session.Store.open(allocator, database_path);
    defer store.close();
    try store.createSession(.{
        .id = id,
        .working_directory = "/tmp",
        .argv_json = "[\"/bin/sh\"]",
        .rows = 24,
        .columns = 80,
        .protocol_version = protocol_version,
    });
    var clients = [_]Client{.{}} ** max_clients;
    var leases: Leases = .{};
    var builder = try vt.Builder.init(allocator, 24, 80);
    defer builder.deinit();
    var live_history: LiveHistory = .{};
    defer live_history.deinit(allocator);
    var current_sequence: u64 = 0;
    const redraw: [32 * 1024]u8 = @splat('x');

    for (0..256) |_| {
        builder.feed(&redraw);
        publishOutput(
            &store,
            id,
            &clients,
            &leases,
            &builder,
            1024 * 1024,
            &live_history,
            &current_sequence,
            &redraw,
        );
    }

    const info = try store.info();
    try std.testing.expectEqual(@as(u64, 0), info.event_count);
    try std.testing.expectEqual(@as(u64, 1), info.checkpoint_count);
    const storage = try store.storageInfo();
    try std.testing.expect(storage.page_size * storage.page_count < 512 * 1024);
    var record = (try store.getSession(id)).?;
    defer record.deinit(allocator);
    try std.testing.expectEqual(current_sequence, record.last_sequence);
}

test "latest-screen recovery sends the in-memory head without replaying the journal" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const database_path = try workerTestDatabasePath(allocator, &tmp);
    defer allocator.free(database_path);
    const id = "worker_latest_screen_proof";
    var store = try session.Store.open(allocator, database_path);
    defer store.close();
    try store.createSession(.{
        .id = id,
        .working_directory = "/tmp",
        .argv_json = "[\"/bin/sh\"]",
        .rows = 2,
        .columns = 12,
        .protocol_version = protocol_version,
    });

    var builder = try vt.Builder.init(allocator, 2, 12);
    defer builder.deinit();
    const old_output = "old\r\n";
    const current_output = "new\r\nlatest";
    builder.feed(old_output);
    builder.feed(current_output);
    const current_sequence: u64 = 2;
    var live_history: LiveHistory = .{};
    defer live_history.deinit(allocator);

    var pair: [2]c_int = undefined;
    try std.testing.expectEqual(@as(c_int, 0), c.socketpair(c.AF_UNIX, c.SOCK_STREAM, 0, &pair));
    defer closeDescriptor(pair[0]);
    defer closeDescriptor(pair[1]);
    try replayClient(
        allocator,
        pair[0],
        0,
        &builder,
        &live_history,
        current_sequence,
        .latest_screen,
    );

    var payload: [max_frame_payload]u8 = undefined;
    var checkpoint_sequence: ?u64 = null;
    var completed_sequence: ?u64 = null;
    var checkpoint_count: u8 = 0;
    var saw_new = false;
    var saw_latest = false;
    var saw_old = false;
    while (completed_sequence == null) {
        const frame = try readFrame(pair[1], &payload);
        switch (frame.kind) {
            .checkpoint => {
                try std.testing.expect(frame.payload.len >= checkpoint_header_length);
                checkpoint_sequence = std.mem.readInt(u64, frame.payload[0..8], .big);
                checkpoint_count += 1;
                const checkpoint_payload = frame.payload[checkpoint_header_length..];
                saw_new = saw_new or std.mem.indexOf(u8, checkpoint_payload, "new") != null;
                saw_latest = saw_latest or
                    std.mem.indexOf(u8, checkpoint_payload, "latest") != null;
                saw_old = saw_old or std.mem.indexOf(u8, checkpoint_payload, "old") != null;
            },
            .history_complete => {
                try std.testing.expectEqual(8, frame.payload.len);
                completed_sequence = std.mem.readInt(u64, frame.payload[0..8], .big);
            },
            .sequenced_output => return error.LatestScreenReplayedJournal,
            else => return error.UnexpectedWorkerFrame,
        }
    }

    try std.testing.expectEqual(1, checkpoint_count);
    try std.testing.expectEqual(current_sequence, checkpoint_sequence.?);
    try std.testing.expectEqual(current_sequence, completed_sequence.?);
    try std.testing.expect(saw_new);
    try std.testing.expect(saw_latest);
    try std.testing.expect(!saw_old);
}

test "detached worker streams live output and saves only its final screen" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const database_path = try workerTestDatabasePath(allocator, &tmp);
    defer allocator.free(database_path);
    const id = "worker_replay_proof";
    const command = [_][]const u8{
        "/bin/sh",
        "-c",
        "printf 'first\\n'; sleep 0.05; printf 'second\\n'",
    };
    const spawned = try spawnDetached(.{
        .database_path = database_path,
        .id = id,
        .name = "proof",
        .working_directory = "/tmp",
        .argv_json = "[\"/bin/sh\",\"-c\",\"proof\"]",
        .command = &command,
        .rows = 24,
        .columns = 80,
    });

    const path = try socketPath(allocator, id);
    defer allocator.free(path);
    const fd = try connectSocket(allocator, path);
    defer _ = c.close(fd);
    try sendAttachRequest(fd, LeaseFlag.writer | LeaseFlag.resize, 0);
    var output: ByteBuffer = .empty;
    defer output.deinit(allocator);
    var payload: [max_frame_payload]u8 = undefined;
    var exit_code: ?u8 = null;
    while (exit_code == null) {
        const frame = try readFrame(fd, &payload);
        switch (frame.kind) {
            .output => try output.appendSlice(allocator, frame.payload),
            .sequenced_output => try output.appendSlice(
                allocator,
                frame.payload[sequence_header_length..],
            ),
            .checkpoint => try output.appendSlice(
                allocator,
                frame.payload[checkpoint_header_length..],
            ),
            .history_complete, .lease => {},
            .exit => exit_code = decodeExit(frame.payload),
            else => return error.UnexpectedWorkerFrame,
        }
    }
    try std.testing.expectEqual(@as(u8, 0), exit_code.?);
    try std.testing.expectEqualStrings("first\r\nsecond\r\n", output.items);

    var worker_status: c_int = 0;
    try std.testing.expectEqual(
        spawned.worker_pid,
        c.waitpid(spawned.worker_pid, &worker_status, 0),
    );
    var store = try session.Store.open(allocator, database_path);
    defer store.close();
    var record = (try store.getSession(id)).?;
    defer record.deinit(allocator);
    try std.testing.expectEqual(session.SessionState.exited, record.state);
    try std.testing.expectEqual(@as(?i64, null), record.worker_pid);
    try std.testing.expectEqual(@as(i32, 0), record.exit_code.?);
    try std.testing.expect(record.last_sequence >= 1);
    const info = try store.info();
    try std.testing.expectEqual(@as(u64, 0), info.event_count);
    try std.testing.expectEqual(@as(u64, 1), info.checkpoint_count);
}

fn readClientOutput(
    allocator: std.mem.Allocator,
    fd: c_int,
) !struct { bytes: []u8, exit_code: u8 } {
    var output: ByteBuffer = .empty;
    errdefer output.deinit(allocator);
    var payload: [max_frame_payload]u8 = undefined;
    // Intentional test loop, bounded by the worker exit frame.
    while (true) {
        const frame = try readFrame(fd, &payload);
        switch (frame.kind) {
            .output => try output.appendSlice(allocator, frame.payload),
            .sequenced_output => try output.appendSlice(
                allocator,
                frame.payload[sequence_header_length..],
            ),
            .checkpoint => try output.appendSlice(
                allocator,
                frame.payload[checkpoint_header_length..],
            ),
            .history_complete, .lease => {},
            .exit => return .{
                .bytes = try output.toOwnedSlice(allocator),
                .exit_code = decodeExit(frame.payload),
            },
            else => return error.UnexpectedWorkerFrame,
        }
    }
}

test "worker reports idle shell and foreground command telemetry" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const database_path = try workerTestDatabasePath(allocator, &tmp);
    defer allocator.free(database_path);
    const id = "worker_telemetry_proof";
    const command = [_][]const u8{"/bin/sh"};
    const spawned = try spawnDetached(.{
        .database_path = database_path,
        .id = id,
        .name = null,
        .working_directory = "/tmp",
        .argv_json = "[\"/bin/sh\"]",
        .command = &command,
        .rows = 24,
        .columns = 80,
    });
    errdefer signalProcess(spawned.worker_pid, c.SIGKILL);

    const idle = try queryTelemetry(allocator, id, protocol_version, 0);
    try std.testing.expectEqual(Activity.idle, idle.activity);
    try std.testing.expectEqual(idle.shell_pid, idle.process_pid);
    try std.testing.expectEqualStrings("sh", idle.shellName());

    try sendInput(allocator, id, protocol_version, 0, "sh\n");
    try std.testing.expectEqual(@as(c_int, 0), c.usleep(200_000));
    const nested_shell = try queryTelemetry(allocator, id, protocol_version, 0);
    try std.testing.expectEqual(Activity.idle, nested_shell.activity);
    try std.testing.expect(nested_shell.process_pid != nested_shell.shell_pid);
    try std.testing.expect(isShellName(nested_shell.commandName()));

    try sendInput(allocator, id, protocol_version, 0, "sleep 2\n");
    try std.testing.expectEqual(@as(c_int, 0), c.usleep(200_000));
    const working = try queryTelemetry(allocator, id, protocol_version, 0);
    try std.testing.expectEqual(Activity.working, working.activity);
    try std.testing.expect(working.process_pid != working.shell_pid);
    try std.testing.expectEqualStrings("sleep", working.commandName());

    try sendSignal(allocator, id, protocol_version, 0, c.SIGHUP);
    var worker_status: c_int = 0;
    try std.testing.expectEqual(
        spawned.worker_pid,
        c.waitpid(spawned.worker_pid, &worker_status, 0),
    );
}

test "takeover changes the active writer while both viewers keep receiving output" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const database_path = try workerTestDatabasePath(allocator, &tmp);
    defer allocator.free(database_path);
    const id = "worker_multi_client_proof";
    const command = [_][]const u8{
        "/bin/sh",
        "-c",
        "read line; stty size; printf 'broadcast:%s\\n' \"$line\"; exit 4",
    };
    const spawned = try spawnDetached(.{
        .database_path = database_path,
        .id = id,
        .name = null,
        .working_directory = "/tmp",
        .argv_json = "[\"/bin/sh\",\"-c\",\"multi\"]",
        .command = &command,
        .rows = 24,
        .columns = 80,
    });

    const path = try socketPath(allocator, id);
    defer allocator.free(path);
    const first_fd = try connectSocket(allocator, path);
    defer _ = c.close(first_fd);
    try sendAttachRequestWithRecoveryAndId(
        first_fd,
        LeaseFlag.writer | LeaseFlag.resize,
        0,
        .journal,
        101,
    );
    var payload: [max_frame_payload]u8 = undefined;
    while ((try readFrame(first_fd, &payload)).kind != .history_complete) {}
    const second_fd = try connectSocket(allocator, path);
    defer _ = c.close(second_fd);
    try sendAttachRequestWithRecoveryAndId(
        second_fd,
        LeaseFlag.writer | LeaseFlag.resize,
        0,
        .journal,
        202,
    );
    while ((try readFrame(second_fd, &payload)).kind != .history_complete) {}

    var resize_payload: [4]u8 = undefined;
    std.mem.writeInt(u16, resize_payload[0..2], 101, .big);
    std.mem.writeInt(u16, resize_payload[2..4], 42, .big);
    try writeFrame(first_fd, .resize, &resize_payload);
    try takeControl(allocator, id, protocol_version, 0, 202);
    try writeFrame(first_fd, .input, "ignored\n");
    try writeFrame(second_fd, .input, "hello\n");

    const first = try readClientOutput(allocator, first_fd);
    defer allocator.free(first.bytes);
    const second = try readClientOutput(allocator, second_fd);
    defer allocator.free(second.bytes);
    try std.testing.expectEqual(@as(u8, 4), first.exit_code);
    try std.testing.expectEqual(@as(u8, 4), second.exit_code);
    try std.testing.expect(std.mem.indexOf(u8, first.bytes, "42 101") != null);
    try std.testing.expect(std.mem.indexOf(u8, second.bytes, "broadcast:hello") != null);

    var worker_status: c_int = 0;
    try std.testing.expectEqual(
        spawned.worker_pid,
        c.waitpid(spawned.worker_pid, &worker_status, 0),
    );
    var store = try session.Store.open(allocator, database_path);
    defer store.close();
    var record = (try store.getSession(id)).?;
    defer record.deinit(allocator);
    try std.testing.expectEqual(@as(u32, 101), record.columns);
    try std.testing.expectEqual(@as(u32, 42), record.rows);
    try std.testing.expectEqual(@as(i32, 4), record.exit_code.?);
}
