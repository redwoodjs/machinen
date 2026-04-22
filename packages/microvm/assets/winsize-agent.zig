//! Tiny guest-side TIOCSWINSZ agent (#51 M1.5 follow-up).
//!
//! Binds AF_VSOCK on port 1974 (guests have this once
//! `vmw_vsock_virtio_transport` is loaded), accepts one client at a
//! time, reads `cols rows\n` lines, and shoves the new size into every
//! tty we can find — specifically /dev/console, /dev/ttyAMA0, and any
//! /proc/<pid>/fd/0 that's a tty owned by a shell-ish process.
//!
//! On each successful ioctl we print `applied: <cols> <rows> -> <path>`
//! to stdout so the smoke harness can grep it back out of the guest
//! console log.
//!
//! Build (from packages/microvm):
//!   zig build-exe assets/winsize-agent.zig \
//!     -target aarch64-linux-musl -O ReleaseSmall -lc \
//!     -femit-bin=test-fixtures/winsize-agent

const std = @import("std");

extern "c" fn socket(domain: c_int, sock_type: c_int, protocol: c_int) c_int;
extern "c" fn bind(fd: c_int, addr: *const anyopaque, addrlen: c_uint) c_int;
extern "c" fn listen(fd: c_int, backlog: c_int) c_int;
extern "c" fn accept(fd: c_int, addr: ?*anyopaque, addrlen: ?*c_uint) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
extern "c" fn ioctl(fd: c_int, req: c_ulong, ...) c_int;
extern "c" fn nanosleep(req: *const timespec, rem: ?*timespec) c_int;
extern "c" fn readlink(path: [*:0]const u8, buf: [*]u8, bufsize: usize) isize;
extern "c" fn opendir(path: [*:0]const u8) ?*anyopaque;
extern "c" fn closedir(dirp: *anyopaque) c_int;
extern "c" fn readdir(dirp: *anyopaque) ?*Dirent;

const timespec = extern struct { tv_sec: i64, tv_nsec: i64 };

// musl dirent layout. d_name is the only field we touch.
const Dirent = extern struct {
    d_ino: u64,
    d_off: i64,
    d_reclen: u16,
    d_type: u8,
    d_name: [256]u8,
};

const AF_VSOCK: c_int = 40;
const SOCK_STREAM: c_int = 1;
const O_RDWR: c_int = 2;
const O_NOCTTY: c_int = 0o400;

// struct winsize { unsigned short ws_row, ws_col, ws_xpixel, ws_ypixel; }
const Winsize = extern struct {
    ws_row: u16,
    ws_col: u16,
    ws_xpixel: u16,
    ws_ypixel: u16,
};
const TIOCSWINSZ: c_ulong = 0x5414;

const SockaddrVm = extern struct {
    svm_family: u16,
    svm_reserved1: u16,
    svm_port: u32,
    svm_cid: u32,
    svm_zero: [4]u8,
};

const VMADDR_CID_ANY: u32 = 0xFFFF_FFFF;
const PORT: u32 = 1974;

fn logLine(msg: []const u8) void {
    _ = write(1, msg.ptr, msg.len);
    _ = write(1, "\n", 1);
}

fn sleepMs(ms: i64) void {
    var ts: timespec = .{
        .tv_sec = @divTrunc(ms, 1000),
        .tv_nsec = @mod(ms, 1000) * 1_000_000,
    };
    _ = nanosleep(&ts, null);
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

fn setWinsize(fd: c_int, cols: u16, rows: u16) bool {
    const ws: Winsize = .{
        .ws_row = rows,
        .ws_col = cols,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };
    return ioctl(fd, TIOCSWINSZ, &ws) == 0;
}

fn applyTo(path_z: [*:0]const u8, cols: u16, rows: u16) bool {
    const fd = open(path_z, O_RDWR | O_NOCTTY);
    if (fd < 0) return false;
    defer _ = close(fd);
    return setWinsize(fd, cols, rows);
}

fn apply(cols: u16, rows: u16) void {
    var applied_any = false;
    for ([_][*:0]const u8{ "/dev/console", "/dev/ttyAMA0", "/dev/tty0" }) |path| {
        if (applyTo(path, cols, rows)) {
            var msg_buf: [128]u8 = undefined;
            const msg = std.fmt.bufPrint(&msg_buf, "applied: {d} {d} -> {s}", .{ cols, rows, path }) catch continue;
            logLine(msg);
            applied_any = true;
        }
    }

    // Walk /proc/<pid>/fd/{0,1,2} for any tty.
    const dir = opendir("/proc") orelse {
        if (!applied_any) {
            var msg_buf: [64]u8 = undefined;
            const msg = std.fmt.bufPrint(&msg_buf, "applied: {d} {d} -> (no ttys)", .{ cols, rows }) catch "applied: (no ttys)";
            logLine(msg);
        }
        return;
    };
    defer _ = closedir(dir);

    while (readdir(dir)) |ent| {
        // First byte of d_name; find its length.
        const name_ptr: [*:0]const u8 = @ptrCast(&ent.d_name);
        const name = std.mem.span(name_ptr);
        if (name.len == 0) continue;
        // Only digit-only names (pids).
        var all_digits = true;
        for (name) |c| {
            if (!std.ascii.isDigit(c)) {
                all_digits = false;
                break;
            }
        }
        if (!all_digits) continue;

        for ([_]u8{ '0', '1', '2' }) |fd_idx| {
            var link_buf: [256]u8 = undefined;
            const link = std.fmt.bufPrintZ(&link_buf, "/proc/{s}/fd/{c}", .{ name, fd_idx }) catch continue;

            // readlink to check it targets /dev/*
            var target_buf: [256]u8 = undefined;
            const tlen = readlink(link.ptr, &target_buf, target_buf.len);
            if (tlen <= 0) continue;
            const target = target_buf[0..@intCast(tlen)];
            if (!std.mem.startsWith(u8, target, "/dev/")) continue;

            const fd = open(link.ptr, O_RDWR | O_NOCTTY);
            if (fd < 0) continue;
            const ok = setWinsize(fd, cols, rows);
            _ = close(fd);
            if (ok) {
                var msg_buf: [512]u8 = undefined;
                const msg = std.fmt.bufPrint(&msg_buf, "applied: {d} {d} -> {s}->{s}", .{ cols, rows, link, target }) catch continue;
                logLine(msg);
                applied_any = true;
            }
        }
    }

    if (!applied_any) {
        var msg_buf: [64]u8 = undefined;
        const msg = std.fmt.bufPrint(&msg_buf, "applied: {d} {d} -> (no ttys)", .{ cols, rows }) catch "applied: (no ttys)";
        logLine(msg);
    }
}

fn bindWithRetry() c_int {
    var attempt: u32 = 0;
    while (attempt < 10) : (attempt += 1) {
        const srv = socket(AF_VSOCK, SOCK_STREAM, 0);
        if (srv < 0) {
            sleepMs(500);
            continue;
        }
        var addr: SockaddrVm = .{
            .svm_family = @intCast(AF_VSOCK),
            .svm_reserved1 = 0,
            .svm_port = PORT,
            .svm_cid = VMADDR_CID_ANY,
            .svm_zero = .{ 0, 0, 0, 0 },
        };
        if (bind(srv, @ptrCast(&addr), @sizeOf(SockaddrVm)) == 0) {
            return srv;
        }
        _ = close(srv);
        var msg_buf: [64]u8 = undefined;
        const msg = std.fmt.bufPrint(&msg_buf, "winsize-agent: bind retry ({d})", .{attempt + 1}) catch "winsize-agent: bind retry";
        logLine(msg);
        sleepMs(500);
    }
    return -1;
}

pub fn main() !void {
    const srv = bindWithRetry();
    if (srv < 0) {
        logLine("winsize-agent: could not bind AF_VSOCK, giving up");
        return error.BindFailed;
    }
    if (listen(srv, 1) < 0) {
        logLine("winsize-agent: listen() failed");
        return error.ListenFailed;
    }
    logLine("winsize-agent: listening on vsock port 1974");

    var buf: [4096]u8 = undefined;
    while (true) {
        const conn = accept(srv, null, null);
        if (conn < 0) {
            logLine("winsize-agent: accept failed");
            sleepMs(200);
            continue;
        }
        logLine("winsize-agent: accepted");

        var line_buf: [256]u8 = undefined;
        var line_len: usize = 0;
        while (true) {
            const n = read(conn, &buf, buf.len);
            if (n <= 0) break;
            const chunk: []const u8 = buf[0..@intCast(n)];
            for (chunk) |c| {
                if (c == '\n') {
                    const line = line_buf[0..line_len];
                    line_len = 0;
                    // Parse "cols rows".
                    const sp = std.mem.indexOfScalar(u8, line, ' ') orelse {
                        var msg_buf: [128]u8 = undefined;
                        const msg = std.fmt.bufPrint(&msg_buf, "winsize-agent: bad line {s}", .{line}) catch "winsize-agent: bad line";
                        logLine(msg);
                        continue;
                    };
                    const cols = std.fmt.parseInt(u16, line[0..sp], 10) catch {
                        logLine("winsize-agent: bad cols");
                        continue;
                    };
                    const rows = std.fmt.parseInt(u16, line[sp + 1 ..], 10) catch {
                        logLine("winsize-agent: bad rows");
                        continue;
                    };
                    apply(cols, rows);
                    var ack_buf: [64]u8 = undefined;
                    const ack = std.fmt.bufPrint(&ack_buf, "ok {d} {d}\n", .{ cols, rows }) catch "ok\n";
                    _ = writeAll(conn, ack);
                } else if (line_len < line_buf.len) {
                    line_buf[line_len] = c;
                    line_len += 1;
                }
            }
        }
        _ = close(conn);
        logLine("winsize-agent: conn closed");
    }
}
