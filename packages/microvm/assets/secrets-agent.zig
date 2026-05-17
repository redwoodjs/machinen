//! Guest-side secrets agent (#48 M3).
//!
//! Binds AF_VSOCK on port 1975. Accepts one connection, reads
//! `KEY=VALUE\n` lines until EOF, writes them to /etc/machinen.env
//! with mode 0600, prints a marker, and exits.
//!
//! The goal is to keep long-lived credentials (ANTHROPIC_API_KEY and
//! friends) OUT of the initramfs + any snapshot. The host pushes them
//! in per-boot over the already-present vsock bridge.
//!
//! Build (from packages/microvm):
//!   zig build-exe assets/secrets-agent.zig \
//!     -target aarch64-linux-musl -O ReleaseSmall -lc \
//!     -femit-bin=test-fixtures/secrets-agent

const std = @import("std");

extern "c" fn socket(domain: c_int, sock_type: c_int, protocol: c_int) c_int;
extern "c" fn bind(fd: c_int, addr: *const anyopaque, addrlen: c_uint) c_int;
extern "c" fn listen(fd: c_int, backlog: c_int) c_int;
extern "c" fn accept(fd: c_int, addr: ?*anyopaque, addrlen: ?*c_uint) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
extern "c" fn fchmod(fd: c_int, mode: c_uint) c_int;
extern "c" fn mkdir(path: [*:0]const u8, mode: c_uint) c_int;

const AF_VSOCK: c_int = 40;
const SOCK_STREAM: c_int = 1;
const O_WRONLY: c_int = 1;
const O_CREAT: c_int = 0o100;
const O_TRUNC: c_int = 0o1000;

const SockaddrVm = extern struct {
    svm_family: u16,
    svm_reserved1: u16,
    svm_port: u32,
    svm_cid: u32,
    svm_zero: [4]u8,
};

const VMADDR_CID_ANY: u32 = 0xFFFF_FFFF;
const PORT: u32 = 1975;
const ENV_PATH = "/etc/machinen.env";

fn log_line(s: []const u8) void {
    _ = write(1, s.ptr, s.len);
    _ = write(1, "\n", 1);
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

fn is_identifier(s: []const u8) bool {
    if (s.len == 0) return false;
    const first = s[0];
    if (!(std.ascii.isAlphabetic(first) or first == '_')) return false;
    for (s[1..]) |c| {
        if (!(std.ascii.isAlphanumeric(c) or c == '_')) return false;
    }
    return true;
}

fn trim(s: []const u8) []const u8 {
    return std.mem.trim(u8, s, " \t\r\n");
}

pub fn main() !void {
    std.debug.assert(@sizeOf(SockaddrVm) == 16);
    std.debug.assert(PORT > 0);
    std.debug.assert(ENV_PATH.len > 0);

    const srv = socket(AF_VSOCK, SOCK_STREAM, 0);
    if (srv < 0) {
        log_line("secrets-agent: socket() failed");
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
        log_line("secrets-agent: bind() failed");
        return error.BindFailed;
    }
    if (listen(srv, 1) < 0) {
        log_line("secrets-agent: listen() failed");
        return error.ListenFailed;
    }
    log_line("secrets-agent: listening on vsock port 1975");

    const conn = accept(srv, null, null);
    if (conn < 0) {
        log_line("secrets-agent: accept() failed");
        return error.AcceptFailed;
    }
    std.debug.assert(conn >= 0);
    log_line("secrets-agent: accepted");

    const alloc = std.heap.c_allocator;
    var raw: std.ArrayList(u8) = .empty;
    defer raw.deinit(alloc);

    var buf: [4096]u8 = undefined;
    // EOF-bounded read: the host closes the one-shot secrets stream
    // after sending all KEY=VALUE lines.
    while (true) {
        const n = read(conn, &buf, buf.len);
        if (n <= 0) break;
        try raw.appendSlice(alloc, buf[0..@intCast(n)]);
    }
    _ = close(conn);
    _ = close(srv);

    var entries: std.ArrayList([]const u8) = .empty;
    defer {
        for (entries.items) |e| alloc.free(e);
        entries.deinit(alloc);
    }

    var it = std.mem.splitScalar(u8, raw.items, '\n');
    while (it.next()) |raw_line| {
        const line = trim(raw_line);
        if (line.len == 0) continue;
        const eq = std.mem.indexOfScalar(u8, line, '=') orelse continue;
        const key = trim(line[0..eq]);
        const val = trim(line[eq + 1 ..]);
        if (!is_identifier(key)) {
            var msg_buf: [256]u8 = undefined;
            const msg = std.fmt.bufPrint(&msg_buf, "secrets-agent: skip non-identifier key {s}", .{key}) catch "secrets-agent: skip non-identifier key";
            log_line(msg);
            continue;
        }
        const kv = try std.fmt.allocPrint(alloc, "{s}={s}", .{ key, val });
        try entries.append(alloc, kv);
    }

    // mkdir /etc (ignore existing)
    _ = mkdir("/etc", 0o755);

    const fd = open(ENV_PATH, O_WRONLY | O_CREAT | O_TRUNC, @as(c_uint, 0o600));
    if (fd < 0) {
        log_line("secrets-agent: open /etc/machinen.env failed");
        return error.OpenFailed;
    }
    std.debug.assert(fd >= 0);
    defer _ = close(fd);

    for (entries.items) |e| {
        if (!write_all(fd, e) or !write_all(fd, "\n")) {
            log_line("secrets-agent: write failed");
            return error.WriteFailed;
        }
    }
    _ = fchmod(fd, 0o600);

    var msg_buf: [128]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf, "secrets-agent: wrote {d} entries to {s}", .{ entries.items.len, ENV_PATH }) catch "secrets-agent: wrote entries";
    log_line(msg);
}
