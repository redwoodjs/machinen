//! Guest-side shell-exec over vsock. Companion of VsockExec in
//! @machinen/runtime.
//!
//! Persistent AF_VSOCK listener on port 1978. Protocol:
//!
//!   client -> "EXEC <shell command>\n"            (single line, legacy)
//!         or "EXEC2 <byte-len>\n<shell command>"  (length-prefixed; #112)
//!   agent  -> framed output chunks until the command exits:
//!               "O <n>\n" + n bytes of stdout
//!               "E <n>\n" + n bytes of stderr
//!               "X <code>\n"   (terminator; agent closes the socket)
//!
//! EXEC2 lifts the no-newlines restriction baked into EXEC's framing
//! (line-terminated). Hosts pick EXEC for newline-free cmds so older
//! rootfs images keep working; multi-line cmds use EXEC2.
//!
//! One command per connection; the agent loops forever so the host
//! can run many commands back-to-back.
//!
//! Build (from packages/microvm):
//!   zig build-exe assets/exec-agent.zig \
//!     -target aarch64-linux-musl -O ReleaseSmall -lc \
//!     -femit-bin=test-fixtures/exec-agent
//!
//! Static aarch64-linux-musl so it doesn't depend on the guest's libc.

const std = @import("std");

// --- libc bindings. Same idiom as init.zig / src/blk.zig — we don't
//     use std.posix directly because its API is in flux in Zig 0.16.

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

const AF_VSOCK: c_int = 40;
const SOCK_STREAM: c_int = 1;
const SHUT_WR: c_int = 1;
const SIGPIPE: c_int = 13;
const SIG_IGN: usize = 1;
const O_CLOEXEC: c_int = 0o02000000;

// Linux's VSOCK sockaddr layout (linux/vm_sockets.h):
//   sa_family (u16) + reserved1 (u16) + port (u32) + cid (u32) + zero[4]
const SockaddrVm = extern struct {
    svm_family: u16,
    svm_reserved1: u16,
    svm_port: u32,
    svm_cid: u32,
    svm_zero: [4]u8,
};

const VMADDR_CID_ANY: u32 = 0xFFFF_FFFF;
const PORT: u32 = 1978;
const CHUNK = 32 * 1024;

fn logErr(s: []const u8) void {
    _ = write(2, s.ptr, s.len);
    _ = write(2, "\n", 1);
}

fn logLine(msg: []const u8) void {
    _ = write(1, msg.ptr, msg.len);
    _ = write(1, "\n", 1);
}

fn waitExitStatus(pid: pid_t) c_int {
    var status: c_int = 0;
    _ = waitpid(pid, &status, 0);
    // WIFEXITED / WEXITSTATUS.
    if ((status & 0x7f) == 0) {
        return (status >> 8) & 0xff;
    }
    // Signalled — encode as 128 + signal for readability.
    return 128 + (status & 0x7f);
}

fn writeAll(fd: c_int, buf: []const u8) bool {
    var off: usize = 0;
    while (off < buf.len) {
        const n = write(fd, buf.ptr + off, buf.len - off);
        if (n <= 0) return false;
        off += @intCast(n);
    }
    return true;
}

fn sendFrame(fd: c_int, tag: u8, payload: []const u8) bool {
    var hdr_buf: [32]u8 = undefined;
    const hdr = std.fmt.bufPrint(&hdr_buf, "{c} {d}\n", .{ tag, payload.len }) catch return false;
    if (!writeAll(fd, hdr)) return false;
    if (payload.len > 0 and !writeAll(fd, payload)) return false;
    return true;
}

fn pumpToFrame(client_fd: c_int, src_fd: c_int, tag: u8) void {
    var buf: [CHUNK]u8 = undefined;
    while (true) {
        const n = read(src_fd, &buf, buf.len);
        if (n <= 0) return;
        const chunk: []const u8 = buf[0..@intCast(n)];
        if (!sendFrame(client_fd, tag, chunk)) return;
    }
}

fn readLine(fd: c_int, out: []u8) ?usize {
    var i: usize = 0;
    while (i < out.len) {
        const n = read(fd, out.ptr + i, 1);
        if (n <= 0) return null;
        if (out[i] == '\n') return i;
        i += 1;
    }
    return null;
}

fn readExact(fd: c_int, out: []u8) bool {
    var off: usize = 0;
    while (off < out.len) {
        const n = read(fd, out.ptr + off, out.len - off);
        if (n <= 0) return false;
        off += @intCast(n);
    }
    return true;
}

// Cap on EXEC2 cmd payloads. 1 MiB is plenty for shell scripts and the
// base64-encoded contents `vm.writeFile()` ships through; binary blobs
// belong in the file/mount paths.
const MAX_EXEC2_CMD: usize = 1 * 1024 * 1024;

fn runCommand(client_fd: c_int, cmd: []const u8, alloc: std.mem.Allocator) !void {
    // Make a NUL-terminated copy for the shell.
    const cmd_z = try alloc.dupeZ(u8, cmd);
    defer alloc.free(cmd_z);

    var out_pipe: [2]c_int = .{ 0, 0 };
    var err_pipe: [2]c_int = .{ 0, 0 };
    if (pipe2(&out_pipe, O_CLOEXEC) < 0) return error.PipeFailed;
    if (pipe2(&err_pipe, O_CLOEXEC) < 0) return error.PipeFailed;

    const pid = fork();
    if (pid < 0) return error.ForkFailed;
    if (pid == 0) {
        // Child: wire pipes onto stdout/stderr, drop read ends, exec.
        _ = dup2(out_pipe[1], 1);
        _ = dup2(err_pipe[1], 2);
        _ = close(out_pipe[0]);
        _ = close(out_pipe[1]);
        _ = close(err_pipe[0]);
        _ = close(err_pipe[1]);
        const argv = &[_:null]?[*:0]const u8{ "sh", "-c", cmd_z.ptr, null };
        const envp = &[_:null]?[*:0]const u8{ "PATH=/usr/local/bin:/usr/bin:/bin:/sbin", null };
        _ = execve("/bin/sh", argv, envp);
        _exit(127);
    }
    // Parent: close write ends (child has them), pump reads.
    _ = close(out_pipe[1]);
    _ = close(err_pipe[1]);

    // Multiplex two pipes onto the client socket via a trivial
    // poll-like loop: drain stdout fully, then stderr. Not truly
    // interleaved, but correct — each frame carries a source tag so
    // the host can re-separate them.
    //
    // A more faithful implementation would use poll(2) across both
    // fds; this is fine for install commands where interleaving
    // cadence doesn't matter much.
    pumpToFrame(client_fd, out_pipe[0], 'O');
    pumpToFrame(client_fd, err_pipe[0], 'E');
    _ = close(out_pipe[0]);
    _ = close(err_pipe[0]);

    const code = waitExitStatus(pid);
    var tail_buf: [32]u8 = undefined;
    const tail = std.fmt.bufPrint(&tail_buf, "X {d}\n", .{code}) catch "X 1\n";
    _ = writeAll(client_fd, tail);
    _ = shutdown(client_fd, SHUT_WR);
}

fn handleConnection(client_fd: c_int, alloc: std.mem.Allocator) void {
    defer _ = close(client_fd);
    var line_buf: [4096]u8 = undefined;
    const len = readLine(client_fd, &line_buf) orelse {
        logErr("exec-agent: bad header");
        return;
    };
    const line = line_buf[0..len];

    // EXEC2 <bytes>\n<cmd-bytes> — length-prefixed, supports newlines (#112).
    if (std.mem.startsWith(u8, line, "EXEC2 ")) {
        const len_str = line[6..];
        const cmd_len = std.fmt.parseInt(usize, len_str, 10) catch {
            logErr("exec-agent: EXEC2 bad length");
            return;
        };
        if (cmd_len > MAX_EXEC2_CMD) {
            logErr("exec-agent: EXEC2 cmd too large");
            return;
        }
        const cmd_buf = alloc.alloc(u8, cmd_len) catch {
            logErr("exec-agent: EXEC2 alloc failed");
            return;
        };
        defer alloc.free(cmd_buf);
        if (cmd_len > 0 and !readExact(client_fd, cmd_buf)) {
            logErr("exec-agent: EXEC2 short read");
            return;
        }
        runCommand(client_fd, cmd_buf, alloc) catch |err| {
            var msg_buf: [128]u8 = undefined;
            const msg = std.fmt.bufPrint(&msg_buf, "exec-agent: run error: {s}", .{@errorName(err)}) catch "exec-agent: run error";
            logErr(msg);
        };
        return;
    }

    // EXEC <cmd>\n — legacy single-line opcode.
    if (line.len < 5 or !std.mem.startsWith(u8, line, "EXEC ")) {
        logErr("exec-agent: unknown op");
        return;
    }
    const cmd = line[5..];
    runCommand(client_fd, cmd, alloc) catch |err| {
        var msg_buf: [128]u8 = undefined;
        const msg = std.fmt.bufPrint(&msg_buf, "exec-agent: run error: {s}", .{@errorName(err)}) catch "exec-agent: run error";
        logErr(msg);
    };
}

pub fn main() !void {
    // Ignore SIGPIPE — we detect write failures from errno/rc.
    _ = signal(SIGPIPE, SIG_IGN);

    // Heap allocator for small per-connection strings. In 0.16 we
    // use std.heap.c_allocator since we already link libc.
    const alloc = std.heap.c_allocator;

    const srv = socket(AF_VSOCK, SOCK_STREAM, 0);
    if (srv < 0) {
        logErr("exec-agent: socket() failed");
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
        logErr("exec-agent: bind() failed");
        return error.BindFailed;
    }
    if (listen(srv, 4) < 0) {
        logErr("exec-agent: listen() failed");
        return error.ListenFailed;
    }
    logLine("exec-agent: listening on vsock port 1978");

    while (true) {
        const client = accept(srv, null, null);
        if (client < 0) {
            logErr("exec-agent: accept() failed; continuing");
            continue;
        }
        handleConnection(client, alloc);
    }
}
