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
// PTY plumbing for the PTY opcode (#133).
//   forkpty(3) — musl ships it in the main libc (no -lutil needed).
//     Allocates a /dev/ptmx + /dev/pts/N pair, forks, dups the slave
//     onto the child's stdio, sets it as the child's controlling tty,
//     and returns the master fd to the parent. Saves us the
//     posix_openpt/grantpt/unlockpt/ptsname/setsid/TIOCSCTTY dance.
//   ioctl(2) — used here only for TIOCSWINSZ on resize. Variadic in C
//     but every call site below passes exactly one trailing arg, so a
//     fixed three-arg signature is fine for Zig's purposes.
//   poll(2) — multiplex master fd ↔ vsock client_fd in the parent.
const winsize = extern struct {
    ws_row: u16,
    ws_col: u16,
    ws_xpixel: u16,
    ws_ypixel: u16,
};
extern "c" fn forkpty(
    amaster: *c_int,
    name: ?[*]u8,
    termp: ?*const anyopaque,
    winp: ?*const winsize,
) pid_t;
extern "c" fn ioctl(fd: c_int, req: c_ulong, arg: *const anyopaque) c_int;
const pollfd = extern struct {
    fd: c_int,
    events: i16,
    revents: i16,
};
extern "c" fn poll(fds: [*]pollfd, nfds: c_uint, timeout: c_int) c_int;

const AF_VSOCK: c_int = 40;
const SOCK_STREAM: c_int = 1;
const SHUT_WR: c_int = 1;
const SIGPIPE: c_int = 13;
const SIG_IGN: usize = 1;
const O_CLOEXEC: c_int = 0o02000000;
// arm64 Linux constants. TIOCSWINSZ is the same on every Linux arch
// (asm-generic/ioctls.h: 0x5414); poll event bits are too.
const TIOCSWINSZ: c_ulong = 0x5414;
const POLLIN: i16 = 0x0001;
const POLLERR: i16 = 0x0008;
const POLLHUP: i16 = 0x0010;
const POLLNVAL: i16 = 0x0020;

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

fn log_err(s: []const u8) void {
    _ = write(2, s.ptr, s.len);
    _ = write(2, "\n", 1);
}

fn log_line(msg: []const u8) void {
    _ = write(1, msg.ptr, msg.len);
    _ = write(1, "\n", 1);
}

fn wait_exit_status(pid: pid_t) c_int {
    var status: c_int = 0;
    _ = waitpid(pid, &status, 0);
    // WIFEXITED / WEXITSTATUS.
    if ((status & 0x7f) == 0) {
        return (status >> 8) & 0xff;
    }
    // Signalled — encode as 128 + signal for readability.
    return 128 + (status & 0x7f);
}

fn write_all(fd: c_int, buf: []const u8) bool {
    var off: usize = 0;
    while (off < buf.len) {
        const n = write(fd, buf.ptr + off, buf.len - off);
        if (n <= 0) return false;
        off += @intCast(n);
    }
    return true;
}

fn send_frame(fd: c_int, tag: u8, payload: []const u8) bool {
    var hdr_buf: [32]u8 = undefined;
    const hdr = std.fmt.bufPrint(&hdr_buf, "{c} {d}\n", .{ tag, payload.len }) catch return false;
    if (!write_all(fd, hdr)) return false;
    if (payload.len > 0 and !write_all(fd, payload)) return false;
    return true;
}

fn pump_to_frame(client_fd: c_int, src_fd: c_int, tag: u8) void {
    var buf: [CHUNK]u8 = undefined;
    // EOF-bounded pump: the child pipe closes when the command exits;
    // read errors also stop the best-effort frame stream.
    while (true) {
        const n = read(src_fd, &buf, buf.len);
        if (n <= 0) return;
        const chunk: []const u8 = buf[0..@intCast(n)];
        if (!send_frame(client_fd, tag, chunk)) return;
    }
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

fn read_exact(fd: c_int, out: []u8) bool {
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

// Cap on a single PTY `I <n>\n` input frame. Real keystroke bursts are
// well under 1 KiB; this is a defensive ceiling so a malicious / buggy
// client can't make us alloc unbounded.
const MAX_PTY_INPUT: usize = 64 * 1024;

fn run_command(client_fd: c_int, cmd: []const u8, alloc: std.mem.Allocator) !void {
    std.debug.assert(client_fd >= 0);
    std.debug.assert(cmd.len <= MAX_EXEC2_CMD);

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
        // HOME is the second-most-likely-to-bite missing env after
        // PATH: git refuses without it ("fatal: $HOME not set"),
        // ssh-keygen / npm / many install hooks read it, and shells
        // expand `~` against it. Default to /root since the agent
        // runs as PID 1's child and there's no real login session
        // here. Callers who want a different home can override via
        // the cmd itself (`HOME=/foo bash -c ...`).
        const envp = &[_:null]?[*:0]const u8{
            "PATH=/usr/local/bin:/usr/bin:/bin:/sbin",
            "HOME=/root",
            null,
        };
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
    pump_to_frame(client_fd, out_pipe[0], 'O');
    pump_to_frame(client_fd, err_pipe[0], 'E');
    _ = close(out_pipe[0]);
    _ = close(err_pipe[0]);

    const code = wait_exit_status(pid);
    var tail_buf: [32]u8 = undefined;
    const tail = std.fmt.bufPrint(&tail_buf, "X {d}\n", .{code}) catch "X 1\n";
    _ = write_all(client_fd, tail);
    _ = shutdown(client_fd, SHUT_WR);
}

// PTY mode (#133). The host opens a session with the workload through
// a pseudoterminal pair: workload's stdio is the slave, agent owns the
// master. Bytes flow both ways via I/O frames; window-size updates
// arrive as R frames. Ctrl-C / Ctrl-Z / EOF go through the PTY line
// discipline naturally — the kernel translates them to signals on the
// foreground process group and we don't need a separate signal channel
// for the MVP.
//
// Closing the master fd at the end sends SIGHUP to the workload's
// session leader, so the child terminates cleanly even when the host
// disconnects mid-session.
fn run_pty_command(
    client_fd: c_int,
    cmd: []const u8,
    cols: u16,
    rows: u16,
    alloc: std.mem.Allocator,
) !void {
    std.debug.assert(client_fd >= 0);
    std.debug.assert(cmd.len <= MAX_EXEC2_CMD);

    const cmd_z = try alloc.dupeZ(u8, cmd);
    defer alloc.free(cmd_z);

    const ws = winsize{
        .ws_row = rows,
        .ws_col = cols,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };

    var master_fd: c_int = -1;
    const pid = forkpty(&master_fd, null, null, &ws);
    if (pid < 0) return error.ForkPtyFailed;
    if (pid == 0) {
        // Child: forkpty has already wired the slave onto fd 0/1/2 and
        // promoted us to session leader with the slave as ctty. Just
        // exec — no signals to clear, no fds to close.
        const argv = &[_:null]?[*:0]const u8{ "sh", "-c", cmd_z.ptr, null };
        const envp = &[_:null]?[*:0]const u8{
            "PATH=/usr/local/bin:/usr/bin:/bin:/sbin",
            // See the matching comment in runCommand — same rationale
            // for HOME (git/npm/ssh-keygen/shells need it).
            "HOME=/root",
            // Default to a sane TERM so curses-based TUIs work
            // out of the box. The host can override via env in cmd
            // (e.g. `TERM=xterm-kitty bash -i`) if it knows better.
            "TERM=xterm-256color",
            null,
        };
        _ = execve("/bin/sh", argv, envp);
        _exit(127);
    }

    // Parent. Multiplex master_fd ↔ client_fd via poll. The client
    // direction reads frames synchronously after poll signals POLLIN —
    // a partial header would block the master pump until the rest of
    // the header arrives, which in practice never happens because the
    // host writes whole frames in one syscall and TCP-over-vsock
    // doesn't fragment them. If that assumption ever breaks we'd need
    // a buffered non-blocking parser; for now keep it simple.
    var fds = [_]pollfd{
        .{ .fd = master_fd, .events = POLLIN, .revents = 0 },
        .{ .fd = client_fd, .events = POLLIN, .revents = 0 },
    };
    var saw_master_eof = false;
    pump: while (!saw_master_eof) {
        fds[0].revents = 0;
        fds[1].revents = 0;
        const n = poll(&fds, 2, -1);
        if (n < 0) {
            // EINTR is the expected interruption (SIGCHLD, etc.). Loop.
            continue;
        }

        if ((fds[0].revents & POLLIN) != 0) {
            var out_buf: [CHUNK]u8 = undefined;
            const r = read(master_fd, &out_buf, out_buf.len);
            if (r > 0) {
                if (!send_frame(client_fd, 'O', out_buf[0..@intCast(r)])) break :pump;
            } else {
                // EOF on master = the slave was fully closed by the
                // child (and any descendants that inherited it).
                // Workload has exited or is about to.
                saw_master_eof = true;
            }
        }
        if ((fds[0].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) {
            saw_master_eof = true;
        }

        if ((fds[1].revents & POLLIN) != 0) {
            var header: [256]u8 = undefined;
            const hlen = read_line(client_fd, &header) orelse break :pump;
            const line = header[0..hlen];
            if (line.len >= 2 and std.mem.startsWith(u8, line, "I ")) {
                const ilen = std.fmt.parseInt(usize, line[2..], 10) catch break :pump;
                if (ilen > MAX_PTY_INPUT) {
                    log_err("exec-agent: PTY I frame too large");
                    break :pump;
                }
                if (ilen > 0) {
                    var ibuf: [MAX_PTY_INPUT]u8 = undefined;
                    if (!read_exact(client_fd, ibuf[0..ilen])) break :pump;
                    if (!write_all(master_fd, ibuf[0..ilen])) break :pump;
                }
            } else if (line.len >= 2 and std.mem.startsWith(u8, line, "R ")) {
                var it = std.mem.tokenizeScalar(u8, line[2..], ' ');
                const c_str = it.next() orelse break :pump;
                const r_str = it.next() orelse break :pump;
                const new_cols = std.fmt.parseInt(u16, c_str, 10) catch continue :pump;
                const new_rows = std.fmt.parseInt(u16, r_str, 10) catch continue :pump;
                const new_ws = winsize{
                    .ws_row = new_rows,
                    .ws_col = new_cols,
                    .ws_xpixel = 0,
                    .ws_ypixel = 0,
                };
                _ = ioctl(master_fd, TIOCSWINSZ, &new_ws);
            } else {
                // Unknown frame on a PTY connection — bail rather than
                // get out of sync.
                log_err("exec-agent: PTY unknown frame");
                break :pump;
            }
        }
        if ((fds[1].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) {
            // Host disconnected. Closing master_fd below sends SIGHUP
            // to the workload's session, so the child exits cleanly.
            break :pump;
        }
    }

    _ = close(master_fd);
    const code = wait_exit_status(pid);
    var tail_buf: [32]u8 = undefined;
    const tail = std.fmt.bufPrint(&tail_buf, "X {d}\n", .{code}) catch "X 1\n";
    _ = write_all(client_fd, tail);
    _ = shutdown(client_fd, SHUT_WR);
}

fn handle_connection(client_fd: c_int, alloc: std.mem.Allocator) void {
    std.debug.assert(client_fd >= 0);

    defer _ = close(client_fd);
    var line_buf: [4096]u8 = undefined;
    const len = read_line(client_fd, &line_buf) orelse {
        log_err("exec-agent: bad header");
        return;
    };
    const line = line_buf[0..len];

    // PTY <cols> <rows> <cmd-bytes>\n<cmd-bytes> — interactive
    // session with a pseudoterminal pair. Length-prefixed cmd like
    // EXEC2 so binary content (escape sequences in TUI scripts) and
    // newlines pass through unchanged. See #133.
    if (std.mem.startsWith(u8, line, "PTY ")) {
        var it = std.mem.tokenizeScalar(u8, line[4..], ' ');
        const cols_str = it.next() orelse {
            log_err("exec-agent: PTY missing cols");
            return;
        };
        const rows_str = it.next() orelse {
            log_err("exec-agent: PTY missing rows");
            return;
        };
        const len_str = it.next() orelse {
            log_err("exec-agent: PTY missing cmd-bytes");
            return;
        };
        const cols = std.fmt.parseInt(u16, cols_str, 10) catch {
            log_err("exec-agent: PTY bad cols");
            return;
        };
        const rows = std.fmt.parseInt(u16, rows_str, 10) catch {
            log_err("exec-agent: PTY bad rows");
            return;
        };
        const cmd_len = std.fmt.parseInt(usize, len_str, 10) catch {
            log_err("exec-agent: PTY bad length");
            return;
        };
        if (cmd_len > MAX_EXEC2_CMD) {
            log_err("exec-agent: PTY cmd too large");
            return;
        }
        const cmd_buf = alloc.alloc(u8, cmd_len) catch {
            log_err("exec-agent: PTY alloc failed");
            return;
        };
        defer alloc.free(cmd_buf);
        if (cmd_len > 0 and !read_exact(client_fd, cmd_buf)) {
            log_err("exec-agent: PTY short read");
            return;
        }
        run_pty_command(client_fd, cmd_buf, cols, rows, alloc) catch |err| {
            var msg_buf: [128]u8 = undefined;
            const msg = std.fmt.bufPrint(&msg_buf, "exec-agent: pty error: {s}", .{@errorName(err)}) catch "exec-agent: pty error";
            log_err(msg);
        };
        return;
    }

    // EXEC2 <bytes>\n<cmd-bytes> — length-prefixed, supports newlines (#112).
    if (std.mem.startsWith(u8, line, "EXEC2 ")) {
        const len_str = line[6..];
        const cmd_len = std.fmt.parseInt(usize, len_str, 10) catch {
            log_err("exec-agent: EXEC2 bad length");
            return;
        };
        if (cmd_len > MAX_EXEC2_CMD) {
            log_err("exec-agent: EXEC2 cmd too large");
            return;
        }
        const cmd_buf = alloc.alloc(u8, cmd_len) catch {
            log_err("exec-agent: EXEC2 alloc failed");
            return;
        };
        defer alloc.free(cmd_buf);
        if (cmd_len > 0 and !read_exact(client_fd, cmd_buf)) {
            log_err("exec-agent: EXEC2 short read");
            return;
        }
        run_command(client_fd, cmd_buf, alloc) catch |err| {
            var msg_buf: [128]u8 = undefined;
            const msg = std.fmt.bufPrint(&msg_buf, "exec-agent: run error: {s}", .{@errorName(err)}) catch "exec-agent: run error";
            log_err(msg);
        };
        return;
    }

    // EXEC <cmd>\n — legacy single-line opcode.
    if (line.len < 5 or !std.mem.startsWith(u8, line, "EXEC ")) {
        log_err("exec-agent: unknown op");
        return;
    }
    const cmd = line[5..];
    run_command(client_fd, cmd, alloc) catch |err| {
        var msg_buf: [128]u8 = undefined;
        const msg = std.fmt.bufPrint(&msg_buf, "exec-agent: run error: {s}", .{@errorName(err)}) catch "exec-agent: run error";
        log_err(msg);
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
        log_err("exec-agent: socket() failed");
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
        log_err("exec-agent: bind() failed");
        return error.BindFailed;
    }
    if (listen(srv, 4) < 0) {
        log_err("exec-agent: listen() failed");
        return error.ListenFailed;
    }
    log_line("exec-agent: listening on vsock port 1978");

    // Intentional daemon loop. `accept` blocks between connections;
    // the VMM tears the agent down with the guest.
    while (true) {
        const client = accept(srv, null, null);
        if (client < 0) {
            log_err("exec-agent: accept() failed; continuing");
            continue;
        }
        handle_connection(client, alloc);
    }
}
