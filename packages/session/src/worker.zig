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

const max_clients = 8;
const max_frame_payload = 32 * 1024;
const socket_directory_prefix = "/tmp/machinen-session-";
const protocol_version: u32 = 2;
const attach_payload_length = 24;
const sequence_header_length = 8;
const checkpoint_header_length = 13;
const telemetry_header_length = 14;
const telemetry_name_capacity = 127;
const lease_duration_ms: i64 = 30_000;
const heartbeat_interval_ms: i64 = 10_000;
const LeaseFlag = struct {
    const writer: u8 = 1 << 0;
    const resize: u8 = 1 << 1;
    const control: u8 = 1 << 2;
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
};

pub const Config = struct {
    database_path: []const u8,
    id: []const u8,
    name: ?[]const u8,
    working_directory: []const u8,
    argv_json: []const u8,
    command: []const []const u8,
    rows: u16,
    columns: u16,
    checkpoint_bytes: u32 = vt.default_checkpoint_bytes,
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
    last_heartbeat_ms: i64 = 0,
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

pub fn attach(allocator: std.mem.Allocator, id: []const u8, options: AttachOptions) !u8 {
    const path = try socketPath(allocator, id);
    defer allocator.free(path);
    const fd = try connectSocket(allocator, path);
    defer _ = c.close(fd);
    if (options.protocol >= protocol_version) {
        const flags: u8 = if (options.read_only) 0 else LeaseFlag.writer | LeaseFlag.resize;
        try sendAttachRequestWithRecovery(
            fd,
            flags,
            options.after_sequence,
            if (options.latest_screen) .latest_screen else .journal,
        );
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
    var last_heartbeat = monotonicMilliseconds();
    // Intentional client loop, bounded by socket close or worker exit.
    while (true) {
        if (resize_pending != 0) {
            resize_pending = 0;
            try sendCurrentSize(fd);
        }
        const now = monotonicMilliseconds();
        if (options.protocol >= protocol_version and
            now - last_heartbeat >= heartbeat_interval_ms)
        {
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
                .history_complete, .lease, .telemetry => {},
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
                try writeFrame(fd, .input, input[0..@intCast(count)]);
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
    );
    saveCheckpoint(&store, config.id, &checkpoint_builder);
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
) i32 {
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
        if (c.poll(&poll_fds, poll_fds.len, 1_000) < 0) continue;
        refreshLeases(clients, leases);

        if ((poll_fds[1].revents & c.POLLIN) != 0) acceptClient(listen_fd, clients);
        if ((poll_fds[0].revents & c.POLLIN) != 0) {
            var output: [max_frame_payload]u8 = undefined;
            const count = readRetry(master_fd, &output);
            if (count <= 0) return waitExitCode(child_pid);
            const bytes = output[0..@intCast(count)];
            checkpoint_builder.feed(bytes);
            const sequence = store.appendOutput(session_id, bytes) catch 0;
            broadcastOutput(clients, leases, sequence, bytes);
            if (checkpoint_builder.shouldCheckpoint(checkpoint_bytes)) {
                saveCheckpoint(store, session_id, checkpoint_builder);
            }
        }
        if ((poll_fds[0].revents & (c.POLLERR | c.POLLHUP | c.POLLNVAL)) != 0) {
            drainPty(store, session_id, master_fd, clients, leases, checkpoint_builder);
            return waitExitCode(child_pid);
        }
        for (clients, 0..) |*client, index| {
            if (client.fd < 0) continue;
            const events = poll_fds[index + 2].revents;
            if ((events & c.POLLIN) != 0) serviceClient(
                allocator,
                store,
                session_id,
                master_fd,
                child_pid,
                client,
                clients,
                leases,
                checkpoint_builder,
            );
            if ((events & (c.POLLERR | c.POLLHUP | c.POLLNVAL)) != 0) closeClient(client, leases);
        }
    }
}

fn acceptClient(listen_fd: c_int, clients: *[max_clients]Client) void {
    const fd = c.accept(listen_fd, null, null);
    if (fd < 0) return;
    const slot = for (clients) |*client| {
        if (client.fd < 0) break client;
    } else {
        writeFrame(fd, .failure, "too many attached clients") catch |err| switch (err) {
            else => {},
        };
        _ = c.close(fd);
        return;
    };
    slot.* = .{ .fd = fd, .last_heartbeat_ms = monotonicMilliseconds() };
}

fn serviceClient(
    allocator: std.mem.Allocator,
    store: *session.Store,
    session_id: []const u8,
    master_fd: c_int,
    child_pid: c.pid_t,
    client: *Client,
    clients: *[max_clients]Client,
    leases: *Leases,
    checkpoint_builder: *vt.Builder,
) void {
    var payload: [max_frame_payload]u8 = undefined;
    const frame = readFrame(client.fd, &payload) catch {
        closeClient(client, leases);
        return;
    };
    if (!client.ready) {
        if (frame.kind != .attach_request or
            beginClient(
                allocator,
                store,
                session_id,
                client,
                clients,
                leases,
                checkpoint_builder,
                frame.payload,
            ) catch false == false)
        {
            closeClient(client, leases);
        }
        return;
    }
    switch (frame.kind) {
        .heartbeat => {
            client.last_heartbeat_ms = monotonicMilliseconds();
            refreshLeases(clients, leases);
        },
        .input => {
            client.last_heartbeat_ms = monotonicMilliseconds();
            refreshLeases(clients, leases);
            if (!client.control and client.granted_leases & LeaseFlag.writer == 0) {
                writeFrame(client.fd, .failure, "writer lease held by another client") catch
                    closeClient(client, leases);
                return;
            }
            writeAll(master_fd, frame.payload) catch closeClient(client, leases);
        },
        .resize => {
            client.last_heartbeat_ms = monotonicMilliseconds();
            refreshLeases(clients, leases);
            if (!client.control and client.granted_leases & LeaseFlag.resize == 0) {
                writeFrame(client.fd, .failure, "resize lease held by another client") catch
                    closeClient(client, leases);
                return;
            }
            if (frame.payload.len != 4) return closeClient(client, leases);
            const columns = std.mem.readInt(u16, frame.payload[0..2], .big);
            const rows = std.mem.readInt(u16, frame.payload[2..4], .big);
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
            _ = store.recordResize(session_id, columns, rows) catch 0;
        },
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
        else => closeClient(client, leases),
    }
}

fn beginClient(
    allocator: std.mem.Allocator,
    store: *session.Store,
    session_id: []const u8,
    client: *Client,
    clients: *[max_clients]Client,
    leases: *Leases,
    checkpoint_builder: *vt.Builder,
    payload: []const u8,
) !bool {
    if (payload.len != attach_payload_length) return false;
    if (std.mem.readInt(u32, payload[0..4], .big) != protocol_version) return false;
    const flags = payload[4];
    if (flags & ~(LeaseFlag.writer | LeaseFlag.resize | LeaseFlag.control) != 0) return false;
    const recovery = std.enums.fromInt(RecoveryMode, payload[5]) orelse return false;
    const after_sequence = std.mem.readInt(u64, payload[8..16], .big);
    client.client_id = std.mem.readInt(u64, payload[16..24], .big);
    client.control = flags & LeaseFlag.control != 0;
    client.requested_leases = flags & (LeaseFlag.writer | LeaseFlag.resize);
    client.ready = true;
    client.last_heartbeat_ms = monotonicMilliseconds();
    refreshLeases(clients, leases);
    try replayClient(
        allocator,
        store,
        session_id,
        client.fd,
        after_sequence,
        checkpoint_builder,
        recovery,
    );
    return true;
}

fn replayClient(
    allocator: std.mem.Allocator,
    store: *session.Store,
    session_id: []const u8,
    fd: c_int,
    requested_after: u64,
    checkpoint_builder: *vt.Builder,
    recovery: RecoveryMode,
) !void {
    if (recovery == .latest_screen) {
        var record = (try store.getSession(session_id)) orelse return error.SessionNotFound;
        defer record.deinit(allocator);
        var checkpoint = session.Checkpoint{
            .sequence = record.last_sequence,
            .format_version = vt.format_version,
            .payload = try checkpoint_builder.checkpoint(),
        };
        defer checkpoint.deinit(allocator);
        try sendCheckpoint(fd, checkpoint);
        try sendHistoryComplete(fd, record.last_sequence);
        return;
    }

    var after_sequence = requested_after;
    if (try store.latestCheckpoint(allocator, session_id)) |checkpoint_value| {
        var checkpoint = checkpoint_value;
        defer checkpoint.deinit(allocator);
        if (after_sequence < checkpoint.sequence) {
            try sendCheckpoint(fd, checkpoint);
            after_sequence = checkpoint.sequence;
        }
    }
    const history = try store.eventsAfter(allocator, session_id, after_sequence);
    defer freeEvents(allocator, history);
    for (history) |event| {
        if (event.kind == .output) try sendSequencedOutput(fd, event.sequence, event.payload);
    }
    var record = (try store.getSession(session_id)) orelse return error.SessionNotFound;
    defer record.deinit(allocator);
    try sendHistoryComplete(fd, record.last_sequence);
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

fn drainPty(
    store: *session.Store,
    session_id: []const u8,
    master_fd: c_int,
    clients: *[max_clients]Client,
    leases: *Leases,
    checkpoint_builder: *vt.Builder,
) void {
    // EOF-bounded PTY drain.
    while (true) {
        var output: [max_frame_payload]u8 = undefined;
        const count = readRetry(master_fd, &output);
        if (count <= 0) return;
        const bytes = output[0..@intCast(count)];
        checkpoint_builder.feed(bytes);
        const sequence = store.appendOutput(session_id, bytes) catch 0;
        broadcastOutput(clients, leases, sequence, bytes);
    }
}

fn saveCheckpoint(store: *session.Store, session_id: []const u8, builder: *vt.Builder) void {
    const payload = builder.checkpoint() catch return;
    defer builder.allocator.free(payload);
    _ = store.checkpointAndCompact(session_id, vt.format_version, payload) catch return;
    builder.didCheckpoint();
}

fn broadcastOutput(
    clients: *[max_clients]Client,
    leases: *Leases,
    sequence: u64,
    payload: []const u8,
) void {
    for (clients) |*client| {
        if (client.fd >= 0 and client.ready) {
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
    const fd = try connectSocket(allocator, path);
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

fn sendAttachRequest(fd: c_int, flags: u8, after_sequence: u64) !void {
    try sendAttachRequestWithRecovery(fd, flags, after_sequence, .journal);
}

fn sendAttachRequestWithRecovery(
    fd: c_int,
    flags: u8,
    after_sequence: u64,
    recovery: RecoveryMode,
) !void {
    std.debug.assert(fd >= 0);
    std.debug.assert(flags & ~(LeaseFlag.writer | LeaseFlag.resize | LeaseFlag.control) == 0);
    var payload: [attach_payload_length]u8 = @splat(0);
    std.mem.writeInt(u32, payload[0..4], protocol_version, .big);
    payload[4] = flags;
    payload[5] = @intFromEnum(recovery);
    std.mem.writeInt(u64, payload[8..16], after_sequence, .big);
    const client_id = (@as(u64, @intCast(c.getpid())) << 32) ^
        @as(u64, @bitCast(monotonicMilliseconds()));
    std.mem.writeInt(u64, payload[16..24], client_id, .big);
    try writeFrame(fd, .attach_request, &payload);
}

pub fn workerReachable(allocator: std.mem.Allocator, id: []const u8) bool {
    const path = socketPath(allocator, id) catch return false;
    defer allocator.free(path);
    const fd = connectSocket(allocator, path) catch return false;
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
    _ = allocator;
    const fd = c.socket(c.AF_UNIX, c.SOCK_STREAM, 0);
    if (fd < 0) return error.SocketFailed;
    errdefer _ = c.close(fd);
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

fn monotonicMilliseconds() i64 {
    var value: std.c.timespec = undefined;
    if (std.c.clock_gettime(.MONOTONIC, &value) != 0) return 0;
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

test "session IDs are safe for portable Unix socket paths" {
    try std.testing.expect(validSessionId("term_api-1.shell"));
    try std.testing.expect(!validSessionId(""));
    try std.testing.expect(!validSessionId("../escape"));
    try std.testing.expect(!validSessionId("contains space"));
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
    const old_sequence = try store.appendOutput(id, old_output);
    builder.feed(current_output);
    const current_sequence = try store.appendOutput(id, current_output);
    try std.testing.expect(old_sequence < current_sequence);

    var pair: [2]c_int = undefined;
    try std.testing.expectEqual(@as(c_int, 0), c.socketpair(c.AF_UNIX, c.SOCK_STREAM, 0, &pair));
    defer closeDescriptor(pair[0]);
    defer closeDescriptor(pair[1]);
    try replayClient(
        allocator,
        &store,
        id,
        pair[0],
        0,
        &builder,
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

test "detached worker runs independently and replays journaled PTY output" {
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
    var output: std.ArrayList(u8) = .empty;
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
}

fn readClientOutput(
    allocator: std.mem.Allocator,
    fd: c_int,
) !struct { bytes: []u8, exit_code: u8 } {
    var output: std.ArrayList(u8) = .empty;
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

test "leased writer and read-only watcher share output and canonical resize" {
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
    try sendAttachRequest(first_fd, LeaseFlag.writer | LeaseFlag.resize, 0);
    var payload: [max_frame_payload]u8 = undefined;
    while ((try readFrame(first_fd, &payload)).kind != .history_complete) {}
    const second_fd = try connectSocket(allocator, path);
    defer _ = c.close(second_fd);
    try sendAttachRequest(second_fd, 0, 0);
    while ((try readFrame(second_fd, &payload)).kind != .history_complete) {}

    var resize_payload: [4]u8 = undefined;
    std.mem.writeInt(u16, resize_payload[0..2], 101, .big);
    std.mem.writeInt(u16, resize_payload[2..4], 42, .big);
    try writeFrame(first_fd, .resize, &resize_payload);
    try writeFrame(first_fd, .input, "hello\n");

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
