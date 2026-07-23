const std = @import("std");
const builtin = @import("builtin");
const session = @import("session");

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
    @cInclude("unistd.h");
    if (builtin.os.tag == .macos) {
        @cInclude("util.h");
    } else {
        @cInclude("pty.h");
    }
});

const max_clients = 8;
const max_frame_payload = 32 * 1024;
const socket_directory_prefix = "/tmp/machinen-session-";

const FrameType = enum(u8) {
    output = 'O',
    input = 'I',
    resize = 'R',
    history_complete = 'H',
    exit = 'X',
    failure = 'E',
    signal = 'S',
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
};

pub const Spawned = struct {
    worker_pid: c.pid_t,
};

const Client = struct {
    fd: c_int = -1,
};

var resize_pending: c.sig_atomic_t = 0;

pub fn validSessionId(id: []const u8) bool {
    if (id.len == 0 or id.len > 64) return false;
    for (id) |character| {
        if (!std.ascii.isAlphanumeric(character) and character != '-' and character != '_' and character != '.') {
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

pub fn sendInput(allocator: std.mem.Allocator, id: []const u8, input: []const u8) !void {
    if (input.len == 0) return error.EmptyInput;
    const fd = try connectForControl(allocator, id);
    defer _ = c.close(fd);
    var offset: usize = 0;
    while (offset < input.len) {
        const end = @min(offset + max_frame_payload, input.len);
        try writeFrame(fd, .input, input[offset..end]);
        offset = end;
    }
}

pub fn sendSignal(allocator: std.mem.Allocator, id: []const u8, signal: i32) !void {
    if (signal <= 0) return error.InvalidSignal;
    const fd = try connectForControl(allocator, id);
    defer _ = c.close(fd);
    var payload: [4]u8 = undefined;
    std.mem.writeInt(i32, &payload, signal, .big);
    try writeFrame(fd, .signal, &payload);
}

pub fn attach(allocator: std.mem.Allocator, id: []const u8) !u8 {
    const path = try socketPath(allocator, id);
    defer allocator.free(path);
    const fd = try connectSocket(allocator, path);
    defer _ = c.close(fd);

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

    if (interactive) {
        _ = c.signal(c.SIGWINCH, &handleResizeSignal);
        resize_pending = 1;
    }

    var stdin_open = true;
    while (true) {
        if (resize_pending != 0) {
            resize_pending = 0;
            try sendCurrentSize(fd);
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
                .history_complete => {},
                .exit => return decodeExit(frame.payload),
                .failure => {
                    try writeAll(c.STDERR_FILENO, frame.payload);
                    try writeAll(c.STDERR_FILENO, "\n");
                },
                else => return error.InvalidServerFrame,
            }
        }
        if (!received_server_frame and (poll_fds[0].revents & (c.POLLERR | c.POLLHUP | c.POLLNVAL)) != 0) return 0;
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
    if (config.rows == 0 or config.columns == 0) return error.InvalidTerminalSize;
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
    });
    errdefer store.deleteSession(config.id) catch {};

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
    defer for (&clients) |*client| closeClient(client);
    const exit_code = runEventLoop(allocator, &store, config.id, master_fd, listen_fd, child_pid, &clients);
    store.setExited(config.id, exit_code) catch {};
    var exit_payload: [4]u8 = undefined;
    std.mem.writeInt(i32, &exit_payload, exit_code, .big);
    broadcast(&clients, .exit, &exit_payload);
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
) i32 {
    while (true) {
        var poll_fds: [2 + max_clients]c.struct_pollfd = undefined;
        poll_fds[0] = .{ .fd = master_fd, .events = c.POLLIN, .revents = 0 };
        poll_fds[1] = .{ .fd = listen_fd, .events = c.POLLIN, .revents = 0 };
        for (clients, 0..) |client, index| {
            poll_fds[index + 2] = .{ .fd = client.fd, .events = if (client.fd >= 0) c.POLLIN else 0, .revents = 0 };
        }
        if (c.poll(&poll_fds, poll_fds.len, -1) < 0) continue;

        if ((poll_fds[1].revents & c.POLLIN) != 0) acceptClient(allocator, store, session_id, listen_fd, clients);
        if ((poll_fds[0].revents & c.POLLIN) != 0) {
            var output: [max_frame_payload]u8 = undefined;
            const count = readRetry(master_fd, &output);
            if (count <= 0) return waitExitCode(child_pid);
            const bytes = output[0..@intCast(count)];
            _ = store.appendOutput(session_id, bytes) catch 0;
            broadcast(clients, .output, bytes);
        }
        if ((poll_fds[0].revents & (c.POLLERR | c.POLLHUP | c.POLLNVAL)) != 0) {
            drainPty(store, session_id, master_fd, clients);
            return waitExitCode(child_pid);
        }
        for (clients, 0..) |*client, index| {
            if (client.fd < 0) continue;
            const events = poll_fds[index + 2].revents;
            if ((events & c.POLLIN) != 0) serviceClient(store, session_id, master_fd, child_pid, client);
            if ((events & (c.POLLERR | c.POLLHUP | c.POLLNVAL)) != 0) closeClient(client);
        }
    }
}

fn acceptClient(
    allocator: std.mem.Allocator,
    store: *session.Store,
    session_id: []const u8,
    listen_fd: c_int,
    clients: *[max_clients]Client,
) void {
    const fd = c.accept(listen_fd, null, null);
    if (fd < 0) return;
    const slot = for (clients) |*client| {
        if (client.fd < 0) break client;
    } else {
        writeFrame(fd, .failure, "too many attached clients") catch {};
        _ = c.close(fd);
        return;
    };

    const history = store.eventsAfter(allocator, session_id, 0) catch {
        writeFrame(fd, .failure, "could not load session history") catch {};
        _ = c.close(fd);
        return;
    };
    defer freeEvents(allocator, history);
    for (history) |event| {
        if (event.kind == .output) writeFrame(fd, .output, event.payload) catch {
            _ = c.close(fd);
            return;
        };
    }
    writeFrame(fd, .history_complete, "") catch {
        _ = c.close(fd);
        return;
    };
    slot.fd = fd;
}

fn serviceClient(
    store: *session.Store,
    session_id: []const u8,
    master_fd: c_int,
    child_pid: c.pid_t,
    client: *Client,
) void {
    var payload: [max_frame_payload]u8 = undefined;
    const frame = readFrame(client.fd, &payload) catch {
        closeClient(client);
        return;
    };
    switch (frame.kind) {
        .input => writeAll(master_fd, frame.payload) catch closeClient(client),
        .resize => {
            if (frame.payload.len != 4) return closeClient(client);
            const columns = std.mem.readInt(u16, frame.payload[0..2], .big);
            const rows = std.mem.readInt(u16, frame.payload[2..4], .big);
            if (columns == 0 or rows == 0) return closeClient(client);
            const window = c.struct_winsize{
                .ws_row = rows,
                .ws_col = columns,
                .ws_xpixel = 0,
                .ws_ypixel = 0,
            };
            _ = c.ioctl(master_fd, c.TIOCSWINSZ, &window);
            _ = store.recordResize(session_id, columns, rows) catch 0;
        },
        .signal => {
            if (frame.payload.len != 4) return closeClient(client);
            const signal = std.mem.readInt(i32, frame.payload[0..4], .big);
            if (signal <= 0 or c.kill(-child_pid, signal) != 0) return closeClient(client);
        },
        else => closeClient(client),
    }
}

fn drainPty(store: *session.Store, session_id: []const u8, master_fd: c_int, clients: *[max_clients]Client) void {
    while (true) {
        var output: [max_frame_payload]u8 = undefined;
        const count = readRetry(master_fd, &output);
        if (count <= 0) return;
        const bytes = output[0..@intCast(count)];
        _ = store.appendOutput(session_id, bytes) catch 0;
        broadcast(clients, .output, bytes);
    }
}

fn broadcast(clients: *[max_clients]Client, kind: FrameType, payload: []const u8) void {
    for (clients) |*client| {
        if (client.fd >= 0) writeFrame(client.fd, kind, payload) catch closeClient(client);
    }
}

fn closeClient(client: *Client) void {
    if (client.fd >= 0) _ = c.close(client.fd);
    client.fd = -1;
}

fn openListener(allocator: std.mem.Allocator, path: []const u8) !c_int {
    const directory = std.fs.path.dirname(path) orelse return error.InvalidSocketPath;
    const directory_z = try allocator.dupeZ(u8, directory);
    defer allocator.free(directory_z);
    if (c.mkdir(directory_z.ptr, 0o700) != 0 and errnoValue() != c.EEXIST) return error.CreateRuntimeDirectoryFailed;
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

fn connectForControl(allocator: std.mem.Allocator, id: []const u8) !c_int {
    const path = try socketPath(allocator, id);
    defer allocator.free(path);
    const fd = try connectSocket(allocator, path);
    errdefer _ = c.close(fd);
    var payload: [max_frame_payload]u8 = undefined;
    while (true) {
        const frame = try readFrame(fd, &payload);
        switch (frame.kind) {
            .output => {},
            .history_complete => return fd,
            .exit => return error.SessionExited,
            .failure => return error.SessionFailure,
            else => return error.InvalidServerFrame,
        }
    }
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
    if (c.connect(fd, @ptrCast(&address), @sizeOf(c.struct_sockaddr_un)) != 0) return error.ConnectFailed;
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

fn workerTestDatabasePath(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path, "worker.sqlite3" });
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
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(allocator);
    var payload: [max_frame_payload]u8 = undefined;
    var exit_code: ?u8 = null;
    while (exit_code == null) {
        const frame = try readFrame(fd, &payload);
        switch (frame.kind) {
            .output => try output.appendSlice(allocator, frame.payload),
            .history_complete => {},
            .exit => exit_code = decodeExit(frame.payload),
            else => return error.UnexpectedWorkerFrame,
        }
    }
    try std.testing.expectEqual(@as(u8, 0), exit_code.?);
    try std.testing.expectEqualStrings("first\r\nsecond\r\n", output.items);

    var worker_status: c_int = 0;
    try std.testing.expectEqual(spawned.worker_pid, c.waitpid(spawned.worker_pid, &worker_status, 0));
    var store = try session.Store.open(allocator, database_path);
    defer store.close();
    var record = (try store.getSession(id)).?;
    defer record.deinit(allocator);
    try std.testing.expectEqual(session.SessionState.exited, record.state);
    try std.testing.expectEqual(@as(?i64, null), record.worker_pid);
    try std.testing.expectEqual(@as(i32, 0), record.exit_code.?);
    try std.testing.expect(record.last_sequence >= 1);
}

fn readClientOutput(allocator: std.mem.Allocator, fd: c_int) !struct { bytes: []u8, exit_code: u8 } {
    var output: std.ArrayList(u8) = .empty;
    errdefer output.deinit(allocator);
    var payload: [max_frame_payload]u8 = undefined;
    while (true) {
        const frame = try readFrame(fd, &payload);
        switch (frame.kind) {
            .output => try output.appendSlice(allocator, frame.payload),
            .history_complete => {},
            .exit => return .{ .bytes = try output.toOwnedSlice(allocator), .exit_code = decodeExit(frame.payload) },
            else => return error.UnexpectedWorkerFrame,
        }
    }
}

test "multiple clients share input output and canonical resize" {
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
    var payload: [max_frame_payload]u8 = undefined;
    while ((try readFrame(first_fd, &payload)).kind != .history_complete) {}
    const second_fd = try connectSocket(allocator, path);
    defer _ = c.close(second_fd);
    while ((try readFrame(second_fd, &payload)).kind != .history_complete) {}

    var resize_payload: [4]u8 = undefined;
    std.mem.writeInt(u16, resize_payload[0..2], 101, .big);
    std.mem.writeInt(u16, resize_payload[2..4], 42, .big);
    try writeFrame(second_fd, .resize, &resize_payload);
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
    try std.testing.expectEqual(spawned.worker_pid, c.waitpid(spawned.worker_pid, &worker_status, 0));
    var store = try session.Store.open(allocator, database_path);
    defer store.close();
    var record = (try store.getSession(id)).?;
    defer record.deinit(allocator);
    try std.testing.expectEqual(@as(u32, 101), record.columns);
    try std.testing.expectEqual(@as(u32, 42), record.rows);
    try std.testing.expectEqual(@as(i32, 4), record.exit_code.?);
}
