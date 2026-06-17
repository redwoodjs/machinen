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
extern "c" fn connect(fd: c_int, addr: *const anyopaque, addrlen: c_uint) c_int;
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
extern "c" fn kill(pid: pid_t, sig: c_int) c_int;
extern "c" fn unlink(path: [*:0]const u8) c_int;
extern "c" fn usleep(usec: c_uint) c_int;
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

const AF_UNIX: c_int = 1;
const AF_VSOCK: c_int = 40;
const SOCK_STREAM: c_int = 1;
const SHUT_WR: c_int = 1;
const SIGPIPE: c_int = 13;
const SIGTERM: c_int = 15;
const SIG_IGN: usize = 1;
const O_CLOEXEC: c_int = 0o02000000;
const WNOHANG: c_int = 1;
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

const SockaddrUn = extern struct {
    sun_family: u16,
    sun_path: [108]u8,
};

const VMADDR_CID_ANY: u32 = 0xFFFF_FFFF;
const PORT: u32 = 1978;
const CHUNK = 32 * 1024;
const MAX_SESSIONS = 16;
const MAX_SESSION_NAME = 64;
const MAX_UNIX_PATH = 107;
const SESSION_SOCK_PREFIX = "/tmp/machinen-pty-";

fn ignore_int(value: c_int) void {
    std.debug.assert(value >= -1 or value < -1);
}

fn ignore_bool(value: bool) void {
    std.debug.assert(value or !value);
}

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
const MAX_RESEED_HEX: usize = 128;
const VMSTATE_RESEED_HELPER = "/sbin/machinen-vmstate-reseed";

// Cap on a single PTY `I <n>\n` input frame. Real keystroke bursts are
// well under 1 KiB; this is a defensive ceiling so a malicious / buggy
// client can't make us alloc unbounded.
const MAX_PTY_INPUT: usize = 64 * 1024;

const SessionEntry = struct {
    used: bool = false,
    name: [MAX_SESSION_NAME]u8 = [_]u8{0} ** MAX_SESSION_NAME,
    name_len: u8 = 0,
    sock_path: [MAX_UNIX_PATH]u8 = [_]u8{0} ** MAX_UNIX_PATH,
    sock_len: u8 = 0,
    broker_pid: pid_t = 0,
};

var sessions: [MAX_SESSIONS]SessionEntry = [_]SessionEntry{.{}} ** MAX_SESSIONS;

fn run_vmstate_reseed(client_fd: c_int, seed_hex: []const u8) void {
    std.debug.assert(client_fd >= 0);
    if (seed_hex.len == 0 or seed_hex.len > MAX_RESEED_HEX) {
        return send_exit(client_fd, 2);
    }
    var seed_buf: [MAX_RESEED_HEX + 1]u8 = undefined;
    @memcpy(seed_buf[0..seed_hex.len], seed_hex);
    seed_buf[seed_hex.len] = 0;

    const pid = fork();
    if (pid < 0) return send_exit(client_fd, 1);
    if (pid == 0) {
        const argv = &[_:null]?[*:0]const u8{
            VMSTATE_RESEED_HELPER,
            @ptrCast(&seed_buf),
            null,
        };
        const envp = &[_:null]?[*:0]const u8{
            "PATH=/usr/local/bin:/usr/bin:/bin:/sbin",
            null,
        };
        _ = execve(VMSTATE_RESEED_HELPER, argv, envp);
        _exit(127);
    }
    send_exit(client_fd, wait_exit_status(pid));
}

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
        ignore_int(execve("/bin/sh", argv, envp));
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
    ignore_bool(write_all(client_fd, tail));
    ignore_int(shutdown(client_fd, SHUT_WR));
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
        ignore_int(execve("/bin/sh", argv, envp));
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
                ignore_int(ioctl(master_fd, TIOCSWINSZ, &new_ws));
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
    ignore_bool(write_all(client_fd, tail));
    ignore_int(shutdown(client_fd, SHUT_WR));
}

fn valid_session_name(name: []const u8) bool {
    std.debug.assert(MAX_SESSION_NAME > 0);
    if (name.len == 0 or name.len > MAX_SESSION_NAME) return false;
    for (name) |ch| {
        const ok = (ch >= 'A' and ch <= 'Z') or
            (ch >= 'a' and ch <= 'z') or
            (ch >= '0' and ch <= '9') or
            ch == '.' or ch == '_' or ch == '-';
        if (!ok) return false;
    }
    return true;
}

fn session_name_eq(entry: *const SessionEntry, name: []const u8) bool {
    std.debug.assert(entry.name_len <= MAX_SESSION_NAME);
    return entry.used and entry.name_len == name.len and std.mem.eql(u8, entry.name[0..entry.name_len], name);
}

fn reap_session(entry: *SessionEntry) void {
    std.debug.assert(MAX_SESSIONS > 0);
    if (!entry.used) return;
    var status: c_int = 0;
    const r = waitpid(entry.broker_pid, &status, WNOHANG);
    if (r == entry.broker_pid or r < 0) {
        entry.used = false;
    }
}

fn reap_child_zombies() void {
    std.debug.assert(MAX_SESSIONS > 0);
    for (&sessions) |*entry| reap_session(entry);
    var status: c_int = 0;
    while (waitpid(-1, &status, WNOHANG) > 0) {}
}

fn find_session(name: []const u8) ?u8 {
    std.debug.assert(name.len <= MAX_SESSION_NAME);
    for (&sessions, 0..) |*entry, i| {
        reap_session(entry);
        if (session_name_eq(entry, name)) return @intCast(i);
    }
    return null;
}

fn alloc_session_slot() ?u8 {
    std.debug.assert(MAX_SESSIONS <= 255);
    for (&sessions, 0..) |*entry, i| {
        reap_session(entry);
        if (!entry.used) return @intCast(i);
    }
    return null;
}

fn make_session_sock_path(out: []u8, name: []const u8) ?[]const u8 {
    std.debug.assert(out.len >= MAX_UNIX_PATH);
    if (SESSION_SOCK_PREFIX.len + name.len >= out.len) return null;
    @memcpy(out[0..SESSION_SOCK_PREFIX.len], SESSION_SOCK_PREFIX);
    @memcpy(out[SESSION_SOCK_PREFIX.len .. SESSION_SOCK_PREFIX.len + name.len], name);
    return out[0 .. SESSION_SOCK_PREFIX.len + name.len];
}

fn fill_un_addr(path: []const u8) ?SockaddrUn {
    std.debug.assert(MAX_UNIX_PATH < 108);
    if (path.len == 0 or path.len > MAX_UNIX_PATH) return null;
    var addr = SockaddrUn{ .sun_family = @intCast(AF_UNIX), .sun_path = [_]u8{0} ** 108 };
    @memcpy(addr.sun_path[0..path.len], path);
    return addr;
}

fn copy_path_z(path: []const u8, out: *[108]u8) ?[*:0]const u8 {
    std.debug.assert(path.len <= MAX_UNIX_PATH);
    if (path.len >= out.len) return null;
    @memset(out, 0);
    @memcpy(out[0..path.len], path);
    return @ptrCast(out.ptr);
}

fn connect_unix(path: []const u8) c_int {
    std.debug.assert(path.len > 0);
    const fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    const addr = fill_un_addr(path) orelse {
        ignore_int(close(fd));
        return -1;
    };
    if (connect(fd, @ptrCast(&addr), @sizeOf(SockaddrUn)) < 0) {
        ignore_int(close(fd));
        return -1;
    }
    return fd;
}

fn connect_unix_retry(path: []const u8) c_int {
    std.debug.assert(path.len > 0);
    var i: u8 = 0;
    while (i < 100) : (i += 1) {
        const fd = connect_unix(path);
        if (fd >= 0) return fd;
        ignore_int(usleep(10 * 1000));
    }
    return -1;
}

fn send_exit(client_fd: c_int, code: c_int) void {
    std.debug.assert(client_fd >= 0);
    var tail_buf: [32]u8 = undefined;
    const tail = std.fmt.bufPrint(&tail_buf, "X {d}\n", .{code}) catch "X 1\n";
    ignore_bool(write_all(client_fd, tail));
    ignore_int(shutdown(client_fd, SHUT_WR));
}

fn proxy_session(client_fd: c_int, broker_fd: c_int, cols: u16, rows: u16) void {
    std.debug.assert(client_fd >= 0);
    std.debug.assert(broker_fd >= 0);
    defer ignore_int(close(broker_fd));
    var attach_buf: [64]u8 = undefined;
    const attach = std.fmt.bufPrint(&attach_buf, "A {d} {d}\n", .{ cols, rows }) catch return;
    if (!write_all(broker_fd, attach)) return;

    var fds = [_]pollfd{
        .{ .fd = client_fd, .events = POLLIN, .revents = 0 },
        .{ .fd = broker_fd, .events = POLLIN, .revents = 0 },
    };
    var buf: [CHUNK]u8 = undefined;
    // Intentional attach proxy loop; exits when either side disconnects.
    while (true) {
        fds[0].revents = 0;
        fds[1].revents = 0;
        const n = poll(&fds, 2, -1);
        if (n < 0) continue;
        if ((fds[0].revents & POLLIN) != 0) {
            const r = read(client_fd, &buf, buf.len);
            if (r <= 0) break;
            if (!write_all(broker_fd, buf[0..@intCast(r)])) break;
        }
        if ((fds[1].revents & POLLIN) != 0) {
            const r = read(broker_fd, &buf, buf.len);
            if (r <= 0) break;
            if (!write_all(client_fd, buf[0..@intCast(r)])) break;
        }
        if ((fds[0].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) break;
        if ((fds[1].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) break;
    }
}

fn proxy_session_child(client_fd: c_int, broker_fd: c_int, cols: u16, rows: u16) void {
    std.debug.assert(client_fd >= 0);
    std.debug.assert(broker_fd >= 0);
    const pid = fork();
    if (pid < 0) {
        send_exit(client_fd, 1);
        ignore_int(close(broker_fd));
        return;
    }
    if (pid == 0) {
        proxy_session(client_fd, broker_fd, cols, rows);
        _exit(0);
    }
    ignore_int(close(broker_fd));
}

fn create_session(name: []const u8, cmd: []const u8, cols: u16, rows: u16) ?u8 {
    std.debug.assert(valid_session_name(name));
    const slot = alloc_session_slot() orelse return null;
    var path_buf: [MAX_UNIX_PATH]u8 = undefined;
    const path = make_session_sock_path(&path_buf, name) orelse return null;
    const pid = fork();
    if (pid < 0) return null;
    if (pid == 0) {
        run_session_broker(path, cmd, cols, rows) catch |err| {
            var msg_buf: [128]u8 = undefined;
            const msg = std.fmt.bufPrint(
                &msg_buf,
                "exec-agent: session broker error: {s}",
                .{@errorName(err)},
            ) catch "exec-agent: session broker error";
            log_err(msg);
        };
        _exit(0);
    }
    var entry = &sessions[slot];
    entry.* = .{};
    entry.used = true;
    entry.name_len = @intCast(name.len);
    @memcpy(entry.name[0..name.len], name);
    entry.sock_len = @intCast(path.len);
    @memcpy(entry.sock_path[0..path.len], path);
    entry.broker_pid = pid;
    return slot;
}

fn write_session_list(client_fd: c_int) void {
    std.debug.assert(client_fd >= 0);
    for (&sessions) |*entry| {
        reap_session(entry);
        if (!entry.used) continue;
        var line_buf: [160]u8 = undefined;
        const line = std.fmt.bufPrint(
            &line_buf,
            "{s}\t{d}\n",
            .{ entry.name[0..entry.name_len], entry.broker_pid },
        ) catch continue;
        if (!send_frame(client_fd, 'O', line)) return;
    }
    send_exit(client_fd, 0);
}

fn kill_session_by_name(client_fd: c_int, name: []const u8) void {
    std.debug.assert(client_fd >= 0);
    const idx = find_session(name) orelse {
        send_exit(client_fd, 1);
        return;
    };
    const entry = &sessions[idx];
    ignore_int(kill(entry.broker_pid, SIGTERM));
    var path_z: [108]u8 = undefined;
    if (copy_path_z(entry.sock_path[0..entry.sock_len], &path_z)) |p| {
        ignore_int(unlink(p));
    }
    entry.used = false;
    send_exit(client_fd, 0);
}

fn handle_persistent_pty(
    client_fd: c_int,
    name: []const u8,
    cmd: []const u8,
    cols: u16,
    rows: u16,
) void {
    std.debug.assert(client_fd >= 0);
    if (!valid_session_name(name)) {
        send_exit(client_fd, 1);
        return;
    }
    const idx = find_session(name) orelse (create_session(name, cmd, cols, rows) orelse {
        send_exit(client_fd, 1);
        return;
    });
    const entry = &sessions[idx];
    const broker_fd = connect_unix_retry(entry.sock_path[0..entry.sock_len]);
    if (broker_fd < 0) {
        entry.used = false;
        send_exit(client_fd, 1);
        return;
    }
    proxy_session_child(client_fd, broker_fd, cols, rows);
}

fn cmd_z_ptr(cmd: []const u8, out: *[MAX_EXEC2_CMD + 1]u8) [*:0]const u8 {
    std.debug.assert(cmd.len <= MAX_EXEC2_CMD);
    @memcpy(out[0..cmd.len], cmd);
    out[cmd.len] = 0;
    return @ptrCast(out.ptr);
}

fn spawn_session_child(cmd: []const u8, cols: u16, rows: u16, master_fd: *c_int) !pid_t {
    std.debug.assert(cmd.len <= MAX_EXEC2_CMD);
    var cmd_buf: [MAX_EXEC2_CMD + 1]u8 = undefined;
    const cmd_z = cmd_z_ptr(cmd, &cmd_buf);
    const ws = winsize{ .ws_row = rows, .ws_col = cols, .ws_xpixel = 0, .ws_ypixel = 0 };
    const child_pid = forkpty(master_fd, null, null, &ws);
    if (child_pid < 0) return error.ForkPtyFailed;
    if (child_pid == 0) {
        const argv = &[_:null]?[*:0]const u8{ "sh", "-c", cmd_z, null };
        const envp = &[_:null]?[*:0]const u8{
            "PATH=/usr/local/bin:/usr/bin:/bin:/sbin",
            "HOME=/root",
            "TERM=xterm-256color",
            null,
        };
        ignore_int(execve("/bin/sh", argv, envp));
        _exit(127);
    }
    return child_pid;
}

fn open_session_listener(path: []const u8, path_z: *[108]u8) !c_int {
    std.debug.assert(path.len > 0);
    const unlink_path = copy_path_z(path, path_z) orelse return error.BadSessionPath;
    ignore_int(unlink(unlink_path));
    const listen_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (listen_fd < 0) return error.SocketFailed;
    const addr = fill_un_addr(path) orelse return error.BadSessionPath;
    if (bind(listen_fd, @ptrCast(&addr), @sizeOf(SockaddrUn)) < 0) return error.BindFailed;
    if (listen(listen_fd, 1) < 0) return error.ListenFailed;
    return listen_fd;
}

fn run_session_broker(path: []const u8, cmd: []const u8, cols: u16, rows: u16) !void {
    std.debug.assert(path.len > 0);
    var path_z: [108]u8 = undefined;
    const listen_fd = try open_session_listener(path, &path_z);
    defer ignore_int(close(listen_fd));
    defer if (copy_path_z(path, &path_z)) |p| {
        ignore_int(unlink(p));
    };
    const client_fd = accept(listen_fd, null, null);
    if (client_fd < 0) return error.AcceptFailed;
    consume_initial_attach(client_fd);
    var master_fd: c_int = -1;
    const child_pid = try spawn_session_child(cmd, cols, rows, &master_fd);
    const exit_code = broker_event_loop(master_fd, listen_fd, child_pid, client_fd);
    ignore_int(exit_code);
}

fn consume_initial_attach(client_fd: c_int) void {
    std.debug.assert(client_fd >= 0);
    var header: [64]u8 = undefined;
    if (read_line(client_fd, &header) == null) return;
}

fn broker_event_loop(
    master_fd: c_int,
    listen_fd: c_int,
    child_pid: pid_t,
    initial_client_fd: c_int,
) c_int {
    std.debug.assert(master_fd >= 0);
    var client_fd: c_int = initial_client_fd;
    defer close_if_open(client_fd);
    defer ignore_int(close(master_fd));
    // Intentional session broker loop: it drains PTY output even while detached.
    while (true) {
        var fds = broker_pollfds(master_fd, listen_fd, client_fd);
        const nfds: c_uint = if (client_fd >= 0) 3 else 2;
        const n = poll(&fds, nfds, -1);
        if (n < 0) continue;
        if (master_exited(fds[0].revents)) return finish_broker_session(child_pid, client_fd);
        if ((fds[1].revents & POLLIN) != 0) accept_broker_client(listen_fd, &client_fd, master_fd);
        if (!drain_master_to_client(master_fd, &client_fd, fds[0].revents)) {
            return finish_broker_session(child_pid, client_fd);
        }
        if (client_fd >= 0) service_broker_client(&client_fd, master_fd, fds[2].revents);
    }
}

fn finish_broker_session(child_pid: pid_t, client_fd: c_int) c_int {
    std.debug.assert(child_pid > 0);
    std.debug.assert(client_fd >= -1);
    const code = wait_exit_status(child_pid);
    if (client_fd >= 0) send_exit(client_fd, code);
    return code;
}

fn broker_pollfds(master_fd: c_int, listen_fd: c_int, client_fd: c_int) [3]pollfd {
    std.debug.assert(master_fd >= 0);
    return .{
        .{ .fd = master_fd, .events = POLLIN, .revents = 0 },
        .{ .fd = listen_fd, .events = POLLIN, .revents = 0 },
        .{ .fd = client_fd, .events = if (client_fd >= 0) POLLIN else 0, .revents = 0 },
    };
}

fn master_exited(revents: i16) bool {
    std.debug.assert(POLLERR != 0);
    return (revents & (POLLERR | POLLHUP | POLLNVAL)) != 0;
}

fn close_if_open(fd: c_int) void {
    std.debug.assert(fd >= -1);
    if (fd >= 0) ignore_int(close(fd));
}

fn detach_client(client_fd: *c_int) void {
    std.debug.assert(client_fd.* >= -1);
    close_if_open(client_fd.*);
    client_fd.* = -1;
}

fn drain_master_to_client(master_fd: c_int, client_fd: *c_int, revents: i16) bool {
    std.debug.assert(master_fd >= 0);
    if ((revents & POLLIN) == 0) return true;
    var out_buf: [CHUNK]u8 = undefined;
    const r = read(master_fd, &out_buf, out_buf.len);
    if (r <= 0) return false;
    if (client_fd.* >= 0 and !send_frame(client_fd.*, 'O', out_buf[0..@intCast(r)])) {
        detach_client(client_fd);
    }
    return true;
}

fn accept_broker_client(listen_fd: c_int, client_fd: *c_int, master_fd: c_int) void {
    std.debug.assert(listen_fd >= 0);
    const next = accept(listen_fd, null, null);
    if (next < 0) return;
    detach_client(client_fd);
    client_fd.* = next;
    apply_attach_header(client_fd, master_fd);
}

fn apply_attach_header(client_fd: *c_int, master_fd: c_int) void {
    std.debug.assert(master_fd >= 0);
    var header: [64]u8 = undefined;
    const hlen = read_line(client_fd.*, &header) orelse {
        detach_client(client_fd);
        return;
    };
    const line = header[0..hlen];
    if (!std.mem.startsWith(u8, line, "A ")) return;
    var it = std.mem.tokenizeScalar(u8, line[2..], ' ');
    const c_str = it.next() orelse "80";
    const r_str = it.next() orelse "24";
    const new_cols = std.fmt.parseInt(u16, c_str, 10) catch 80;
    const new_rows = std.fmt.parseInt(u16, r_str, 10) catch 24;
    resize_master(master_fd, new_cols, new_rows);
}

fn resize_master(master_fd: c_int, cols: u16, rows: u16) void {
    std.debug.assert(master_fd >= 0);
    const new_ws = winsize{ .ws_row = rows, .ws_col = cols, .ws_xpixel = 0, .ws_ypixel = 0 };
    ignore_int(ioctl(master_fd, TIOCSWINSZ, &new_ws));
}

fn service_broker_client(client_fd: *c_int, master_fd: c_int, revents: i16) void {
    std.debug.assert(master_fd >= 0);
    if ((revents & POLLIN) != 0 and !handle_broker_client_frame(client_fd.*, master_fd)) {
        detach_client(client_fd);
        return;
    }
    if ((revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) detach_client(client_fd);
}

fn handle_broker_client_frame(client_fd: c_int, master_fd: c_int) bool {
    std.debug.assert(client_fd >= 0);
    var header: [256]u8 = undefined;
    const hlen = read_line(client_fd, &header) orelse return false;
    const line = header[0..hlen];
    if (line.len >= 2 and std.mem.startsWith(u8, line, "I ")) {
        return handle_broker_input_frame(client_fd, master_fd, line[2..]);
    }
    if (line.len >= 2 and std.mem.startsWith(u8, line, "R ")) {
        return handle_broker_resize_frame(master_fd, line[2..]);
    }
    return false;
}

fn handle_broker_input_frame(client_fd: c_int, master_fd: c_int, len_text: []const u8) bool {
    std.debug.assert(client_fd >= 0);
    std.debug.assert(master_fd >= 0);
    const ilen = std.fmt.parseInt(u32, len_text, 10) catch return false;
    if (ilen > MAX_PTY_INPUT) return false;
    if (ilen == 0) return true;
    var ibuf: [MAX_PTY_INPUT]u8 = undefined;
    if (!read_exact(client_fd, ibuf[0..ilen])) return false;
    return write_all(master_fd, ibuf[0..ilen]);
}

fn handle_broker_resize_frame(master_fd: c_int, body: []const u8) bool {
    std.debug.assert(master_fd >= 0);
    var it = std.mem.tokenizeScalar(u8, body, ' ');
    const c_str = it.next() orelse return false;
    const r_str = it.next() orelse return false;
    const new_cols = std.fmt.parseInt(u16, c_str, 10) catch return true;
    const new_rows = std.fmt.parseInt(u16, r_str, 10) catch return true;
    resize_master(master_fd, new_cols, new_rows);
    return true;
}

fn handle_connection(client_fd: c_int, alloc: std.mem.Allocator) void {
    std.debug.assert(client_fd >= 0);
    defer ignore_int(close(client_fd));
    var line_buf: [4096]u8 = undefined;
    const len = read_line(client_fd, &line_buf) orelse {
        log_err("exec-agent: bad header");
        return;
    };
    const line = line_buf[0..len];
    if (std.mem.eql(u8, line, "PTYLIST")) return write_session_list(client_fd);
    if (std.mem.startsWith(u8, line, "PTYKILL ")) return handle_ptykill(client_fd, line);
    if (std.mem.startsWith(u8, line, "PTYSESSION ")) {
        return handle_ptysession(client_fd, line);
    }
    if (std.mem.startsWith(u8, line, "PTY ")) return handle_pty(client_fd, line, alloc);
    if (std.mem.startsWith(u8, line, "RESEED ")) return handle_reseed(client_fd, line);
    if (std.mem.startsWith(u8, line, "EXEC2 ")) return handle_exec2(client_fd, line, alloc);
    if (line.len < 5 or !std.mem.startsWith(u8, line, "EXEC ")) {
        log_err("exec-agent: unknown op");
        return;
    }
    run_command(client_fd, line[5..], alloc) catch |err| log_run_error("run", err);
}

fn handle_ptykill(client_fd: c_int, line: []const u8) void {
    std.debug.assert(std.mem.startsWith(u8, line, "PTYKILL "));
    std.debug.assert(client_fd >= 0);
    const name_len = std.fmt.parseInt(u32, line[8..], 10) catch {
        log_err("exec-agent: PTYKILL bad name length");
        return send_exit(client_fd, 1);
    };
    if (name_len > MAX_SESSION_NAME) {
        log_err("exec-agent: PTYKILL name too large");
        return send_exit(client_fd, 1);
    }
    var name_buf: [MAX_SESSION_NAME]u8 = undefined;
    if (name_len > 0 and !read_exact(client_fd, name_buf[0..name_len])) {
        log_err("exec-agent: PTYKILL short read");
        return send_exit(client_fd, 1);
    }
    kill_session_by_name(client_fd, name_buf[0..name_len]);
}

const PtySessionHeader = struct {
    cols: u16,
    rows: u16,
    name_len: u32,
    cmd_len: u32,
};

fn parse_ptysession_header(line: []const u8) ?PtySessionHeader {
    std.debug.assert(std.mem.startsWith(u8, line, "PTYSESSION "));
    var it = std.mem.tokenizeScalar(u8, line[11..], ' ');
    const cols_str = it.next() orelse return null;
    const rows_str = it.next() orelse return null;
    const name_len_str = it.next() orelse return null;
    const cmd_len_str = it.next() orelse return null;
    const cols = std.fmt.parseInt(u16, cols_str, 10) catch return null;
    const rows = std.fmt.parseInt(u16, rows_str, 10) catch return null;
    const name_len = std.fmt.parseInt(u32, name_len_str, 10) catch return null;
    const cmd_len = std.fmt.parseInt(u32, cmd_len_str, 10) catch return null;
    if (name_len > MAX_SESSION_NAME or cmd_len > MAX_EXEC2_CMD) return null;
    return .{ .cols = cols, .rows = rows, .name_len = name_len, .cmd_len = cmd_len };
}

fn handle_ptysession(client_fd: c_int, line: []const u8) void {
    std.debug.assert(client_fd >= 0);
    const h = parse_ptysession_header(line) orelse {
        log_err("exec-agent: PTYSESSION bad header");
        return send_exit(client_fd, 1);
    };
    var name_buf: [MAX_SESSION_NAME]u8 = undefined;
    if (h.name_len > 0 and !read_exact(client_fd, name_buf[0..h.name_len])) {
        log_err("exec-agent: PTYSESSION short name read");
        return send_exit(client_fd, 1);
    }
    var cmd_buf: [MAX_EXEC2_CMD]u8 = undefined;
    if (h.cmd_len > 0 and !read_exact(client_fd, cmd_buf[0..h.cmd_len])) {
        log_err("exec-agent: PTYSESSION short cmd read");
        return send_exit(client_fd, 1);
    }
    handle_persistent_pty(
        client_fd,
        name_buf[0..h.name_len],
        cmd_buf[0..h.cmd_len],
        h.cols,
        h.rows,
    );
}

const PtyHeader = struct { cols: u16, rows: u16, cmd_len: u32 };

fn parse_pty_header(line: []const u8) ?PtyHeader {
    std.debug.assert(std.mem.startsWith(u8, line, "PTY "));
    var it = std.mem.tokenizeScalar(u8, line[4..], ' ');
    const cols_str = it.next() orelse return null;
    const rows_str = it.next() orelse return null;
    const len_str = it.next() orelse return null;
    const cols = std.fmt.parseInt(u16, cols_str, 10) catch return null;
    const rows = std.fmt.parseInt(u16, rows_str, 10) catch return null;
    const cmd_len = std.fmt.parseInt(u32, len_str, 10) catch return null;
    if (cmd_len > MAX_EXEC2_CMD) return null;
    return .{ .cols = cols, .rows = rows, .cmd_len = cmd_len };
}

fn handle_pty(client_fd: c_int, line: []const u8, alloc: std.mem.Allocator) void {
    std.debug.assert(client_fd >= 0);
    const h = parse_pty_header(line) orelse {
        log_err("exec-agent: PTY bad header");
        return;
    };
    const cmd_buf = alloc.alloc(u8, h.cmd_len) catch {
        log_err("exec-agent: PTY alloc failed");
        return;
    };
    defer alloc.free(cmd_buf);
    if (h.cmd_len > 0 and !read_exact(client_fd, cmd_buf)) {
        log_err("exec-agent: PTY short read");
        return;
    }
    run_pty_command(client_fd, cmd_buf, h.cols, h.rows, alloc) catch |err| {
        log_run_error("pty", err);
    };
}

fn handle_reseed(client_fd: c_int, line: []const u8) void {
    std.debug.assert(client_fd >= 0);
    const seed_len = std.fmt.parseInt(u32, line[7..], 10) catch {
        log_err("exec-agent: RESEED bad length");
        return send_exit(client_fd, 2);
    };
    if (seed_len == 0 or seed_len > MAX_RESEED_HEX) {
        log_err("exec-agent: RESEED seed too large");
        return send_exit(client_fd, 2);
    }
    var seed_buf: [MAX_RESEED_HEX]u8 = undefined;
    if (!read_exact(client_fd, seed_buf[0..seed_len])) {
        log_err("exec-agent: RESEED short read");
        return send_exit(client_fd, 2);
    }
    run_vmstate_reseed(client_fd, seed_buf[0..seed_len]);
}

fn handle_exec2(client_fd: c_int, line: []const u8, alloc: std.mem.Allocator) void {
    std.debug.assert(client_fd >= 0);
    const cmd_len = std.fmt.parseInt(u32, line[6..], 10) catch {
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
    run_command(client_fd, cmd_buf, alloc) catch |err| log_run_error("run", err);
}

fn log_run_error(kind: []const u8, err: anyerror) void {
    std.debug.assert(kind.len > 0);
    var msg_buf: [128]u8 = undefined;
    const msg = std.fmt.bufPrint(
        &msg_buf,
        "exec-agent: {s} error: {s}",
        .{ kind, @errorName(err) },
    ) catch "exec-agent: command error";
    log_err(msg);
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
        reap_child_zombies();
        const client = accept(srv, null, null);
        if (client < 0) {
            log_err("exec-agent: accept() failed; continuing");
            continue;
        }
        handle_connection(client, alloc);
    }
}
