//! Guest-side file push/pull over vsock (#57).
//!
//! Persistent AF_VSOCK listener on port 1976. Protocol is deliberately
//! boring: the client sends one ASCII line then a stream.
//!
//!   client -> "PUSH <abs-path>\n" then tar bytes until close
//!   agent  -> reads tar bytes and untars at <abs-path>
//!
//!   client -> "PULL <abs-path>\n" then reads
//!   agent  -> streams a tar of <abs-path> then closes
//!
//! One transfer per connection. The agent loops forever so you can
//! push/pull repeatedly during a session.
//!
//! `tar` is already present in the Debian cloud rootfs, so we shell out
//! rather than hand-roll tar encode/decode.
//!
//! Build (from packages/microvm):
//!   zig build-exe assets/file-agent.zig \
//!     -target aarch64-linux-musl -O ReleaseSmall -lc \
//!     -femit-bin=test-fixtures/file-agent

const std = @import("std");

const pid_t = i32;

extern "c" fn socket(domain: c_int, sock_type: c_int, protocol: c_int) c_int;
extern "c" fn bind(fd: c_int, addr: *const anyopaque, addrlen: c_uint) c_int;
extern "c" fn listen(fd: c_int, backlog: c_int) c_int;
extern "c" fn accept(fd: c_int, addr: ?*anyopaque, addrlen: ?*c_uint) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn pipe2(pipefd: *[2]c_int, flags: c_int) c_int;
extern "c" fn fork() pid_t;
extern "c" fn dup2(oldfd: c_int, newfd: c_int) c_int;
extern "c" fn execve(
    path: [*:0]const u8,
    argv: [*:null]const ?[*:0]const u8,
    envp: [*:null]const ?[*:0]const u8,
) c_int;
extern "c" fn _exit(status: c_int) noreturn;
extern "c" fn waitpid(pid: pid_t, status: ?*c_int, options: c_int) pid_t;
extern "c" fn shutdown(fd: c_int, how: c_int) c_int;
extern "c" fn signal(signum: c_int, handler: usize) usize;
extern "c" fn mkdir(path: [*:0]const u8, mode: c_uint) c_int;
extern "c" fn stat(path: [*:0]const u8, buf: *anyopaque) c_int;

const AF_VSOCK: c_int = 40;
const SOCK_STREAM: c_int = 1;
const SHUT_WR: c_int = 1;
const SIGPIPE: c_int = 13;
const SIG_IGN: usize = 1;
const O_CLOEXEC: c_int = 0o02000000;

const SockaddrVm = extern struct {
    svm_family: u16,
    svm_reserved1: u16,
    svm_port: u32,
    svm_cid: u32,
    svm_zero: [4]u8,
};

const VMADDR_CID_ANY: u32 = 0xFFFF_FFFF;
const PORT: u32 = 1976;
const CHUNK = 64 * 1024;

fn log_line(msg: []const u8) void {
    _ = write(1, msg.ptr, msg.len);
    _ = write(1, "\n", 1);
}

fn wait_exit_status(pid: pid_t) c_int {
    var status: c_int = 0;
    _ = waitpid(pid, &status, 0);
    if ((status & 0x7f) == 0) return (status >> 8) & 0xff;
    return 128 + (status & 0x7f);
}

fn read_line(fd: c_int, out: []u8) ?usize {
    var i: usize = 0;
    while (i < out.len) {
        const n = read(fd, out.ptr + i, 1);
        if (n <= 0) return null;
        if (out[i] == '\n') return i;
        i += 1;
    }
    return null;
}

// Recursive mkdir — mimics Python's os.makedirs(..., exist_ok=True). Caller
// passes a mutable path buffer that we scribble over; original bytes are
// restored after each intermediate mkdir.
fn mkdir_p(path: []u8) void {
    if (path.len == 0) return;
    var i: usize = 1;
    while (i <= path.len) : (i += 1) {
        if (i < path.len and path[i] != '/') continue;
        if (i == path.len and path[path.len - 1] == '/') break;
        const saved = if (i < path.len) path[i] else 0;
        if (i < path.len) path[i] = 0;
        _ = mkdir(@ptrCast(path.ptr), 0o755);
        if (i < path.len) path[i] = saved;
    }
}

// Fork+exec with pipe for either stdin (is_writer=true) or stdout
// (is_writer=false). Returns (pid, pipe_fd) where pipe_fd is the
// parent's end of the pipe.
fn spawn_tar(
    is_writer: bool,
    path_z: [*:0]const u8,
) struct { pid: pid_t, fd: c_int } {
    var pipefd: [2]c_int = .{ 0, 0 };
    _ = pipe2(&pipefd, O_CLOEXEC);
    const pid = fork();
    if (pid == 0) {
        if (is_writer) {
            _ = dup2(pipefd[0], 0);
        } else {
            _ = dup2(pipefd[1], 1);
        }
        _ = close(pipefd[0]);
        _ = close(pipefd[1]);
        var argv_buf: [6]?[*:0]const u8 = undefined;
        if (is_writer) {
            // tar -xmf - -C <path>
            argv_buf = .{ "tar", "-xmf", "-", "-C", path_z, null };
        } else {
            // tar -cf - -C <path> .
            argv_buf = .{ "tar", "-cf", "-", "-C", path_z, null };
        }
        // For PULL we need an extra arg ("."). Handled by a second argv below.
        var argv_pull: [7]?[*:0]const u8 = .{ "tar", "-cf", "-", "-C", path_z, ".", null };
        const envp = &[_:null]?[*:0]const u8{ "PATH=/usr/local/bin:/usr/bin:/bin:/sbin", null };
        if (is_writer) {
            const argv: [*:null]const ?[*:0]const u8 = @ptrCast(&argv_buf);
            _ = execve("/bin/tar", argv, envp);
            _ = execve("/usr/bin/tar", argv, envp);
        } else {
            const argv: [*:null]const ?[*:0]const u8 = @ptrCast(&argv_pull);
            _ = execve("/bin/tar", argv, envp);
            _ = execve("/usr/bin/tar", argv, envp);
        }
        _exit(127);
    }
    const parent_fd: c_int = if (is_writer) pipefd[1] else pipefd[0];
    const child_fd: c_int = if (is_writer) pipefd[0] else pipefd[1];
    _ = close(child_fd);
    return .{ .pid = pid, .fd = parent_fd };
}

fn do_push(client_fd: c_int, path_z: [*:0]const u8) void {
    const spawned = spawn_tar(true, path_z);
    var total: usize = 0;
    var buf: [CHUNK]u8 = undefined;
    while (true) {
        const n = read(client_fd, &buf, buf.len);
        if (n <= 0) break;
        const slice: []const u8 = buf[0..@intCast(n)];
        var off: usize = 0;
        while (off < slice.len) {
            const w = write(spawned.fd, slice.ptr + off, slice.len - off);
            if (w <= 0) break;
            off += @intCast(w);
        }
        total += slice.len;
    }
    _ = close(spawned.fd);
    const rc = wait_exit_status(spawned.pid);
    var msg_buf: [256]u8 = undefined;
    if (rc == 0) {
        const msg = std.fmt.bufPrint(&msg_buf, "file-agent: PUSH -> {s} OK ({d} bytes)", .{ path_z, total }) catch "file-agent: PUSH OK";
        log_line(msg);
    } else {
        const msg = std.fmt.bufPrint(&msg_buf, "file-agent: PUSH -> {s} tar failed rc={d}", .{ path_z, rc }) catch "file-agent: PUSH failed";
        log_line(msg);
    }
}

fn do_pull(client_fd: c_int, path_z: [*:0]const u8) void {
    // Python does `os.path.exists` first; we skip that and let tar fail with
    // its own stderr — same observable outcome.
    const spawned = spawn_tar(false, path_z);
    var buf: [CHUNK]u8 = undefined;
    while (true) {
        const n = read(spawned.fd, &buf, buf.len);
        if (n <= 0) break;
        const slice: []const u8 = buf[0..@intCast(n)];
        var off: usize = 0;
        while (off < slice.len) {
            const w = write(client_fd, slice.ptr + off, slice.len - off);
            if (w <= 0) break;
            off += @intCast(w);
        }
    }
    _ = close(spawned.fd);
    const rc = wait_exit_status(spawned.pid);
    _ = shutdown(client_fd, SHUT_WR);
    var msg_buf: [256]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf, "file-agent: PULL <- {s} rc={d}", .{ path_z, rc }) catch "file-agent: PULL done";
    log_line(msg);
}

fn handle_connection(client_fd: c_int, alloc: std.mem.Allocator) void {
    defer _ = close(client_fd);
    var line_buf: [4096]u8 = undefined;
    const len = read_line(client_fd, &line_buf) orelse {
        log_line("file-agent: bad header, dropping");
        return;
    };
    const line = line_buf[0..len];
    const sp = std.mem.indexOfScalar(u8, line, ' ') orelse {
        log_line("file-agent: malformed command");
        return;
    };
    const op = line[0..sp];
    const path = line[sp + 1 ..];
    const path_z = alloc.dupeZ(u8, path) catch {
        log_line("file-agent: alloc failed");
        return;
    };
    defer alloc.free(path_z);

    if (std.mem.eql(u8, op, "PUSH")) {
        // Ensure dest dir exists.
        const path_mut = alloc.dupe(u8, path) catch {
            log_line("file-agent: alloc failed");
            return;
        };
        defer alloc.free(path_mut);
        mkdir_p(path_mut);
        do_push(client_fd, path_z.ptr);
    } else if (std.mem.eql(u8, op, "PULL")) {
        do_pull(client_fd, path_z.ptr);
    } else {
        var msg_buf: [128]u8 = undefined;
        const msg = std.fmt.bufPrint(&msg_buf, "file-agent: unknown op {s}", .{op}) catch "file-agent: unknown op";
        log_line(msg);
    }
}

pub fn main() !void {
    _ = signal(SIGPIPE, SIG_IGN);
    const alloc = std.heap.c_allocator;

    const srv = socket(AF_VSOCK, SOCK_STREAM, 0);
    if (srv < 0) {
        log_line("file-agent: socket() failed");
        return error.SocketFailed;
    }
    var addr: SockaddrVm = .{
        .svm_family = @intCast(AF_VSOCK),
        .svm_reserved1 = 0,
        .svm_port = PORT,
        .svm_cid = VMADDR_CID_ANY,
        .svm_zero = .{ 0, 0, 0, 0 },
    };
    if (bind(srv, @ptrCast(&addr), @sizeOf(SockaddrVm)) < 0) {
        log_line("file-agent: bind() failed");
        return error.BindFailed;
    }
    if (listen(srv, 4) < 0) {
        log_line("file-agent: listen() failed");
        return error.ListenFailed;
    }
    log_line("file-agent: listening on vsock port 1976");

    while (true) {
        const client = accept(srv, null, null);
        if (client < 0) {
            log_line("file-agent: accept error");
            continue;
        }
        log_line("file-agent: accepted");
        handle_connection(client, alloc);
    }
}
