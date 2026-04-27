//! Guest-side FUSE byte-pump for --mount-live (#78).
//!
//! This agent is intentionally dumb. It opens /dev/fuse, issues the
//! `mount(2)` syscall so the configured guest path becomes a FUSE
//! filesystem, and then shovels raw bytes in both directions between
//! /dev/fuse and an AF_VSOCK stream:
//!
//!   /dev/fuse -> vsock   (one thread, pure copy: each /dev/fuse read
//!                         is already a complete FUSE request)
//!   vsock -> /dev/fuse   (one thread, length-framed: accumulates
//!                         bytes until the leading 4-byte `len` says a
//!                         whole response is present, writes it as a
//!                         single syscall — partial writes to
//!                         /dev/fuse confuse the kernel)
//!
//! The host end speaks the FUSE ABI directly
//! (packages/runtime/src/mount-server.ts). Every bit of state — inode
//! tables, path resolution, mount-root containment — lives there.
//!
//! Invocation:
//!
//!   fuse-agent <vsock-port> <mount-path>
//!
//! The agent dials cid=2 (host) at the given port; the host-side VMM
//! routes that REQUEST to the configured UDS where the mount-server is
//! listening (MACHINEN_VSOCK="out:<port>:<uds>"). Listening on the
//! guest side would also work, but only if some host-side actor dialed
//! the VMM's UDS to trigger the bridge — and the mount-server is itself
//! a UDS server, so there's no such actor. Guest-initiates is the path
//! that closes the loop without a third process in the middle.
//!
//! The mount-path is created if missing. Mount flags are kept tight:
//! MS_NOSUID | MS_NODEV, plus `default_permissions` so the guest
//! kernel does its own permission check on the attrs we hand back.
//! No `allow_other` — the guest user that ran the mount (root, via
//! init) is the only one that needs to see it, and user processes
//! under that uid see the mount because init runs as uid=0.
//!
//! Build (from packages/microvm):
//!   zig build-exe assets/fuse-agent.zig \
//!     -target aarch64-linux-musl -O ReleaseSmall -lc \
//!     -femit-bin=test-fixtures/fuse-agent

const std = @import("std");

// --- libc bindings -------------------------------------------------------

extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn socket(domain: c_int, sock_type: c_int, protocol: c_int) c_int;
extern "c" fn connect(fd: c_int, addr: *const anyopaque, addrlen: c_uint) c_int;
extern "c" fn mount(
    src: [*:0]const u8,
    dst: [*:0]const u8,
    fstype: [*:0]const u8,
    flags: c_ulong,
    data: ?*const anyopaque,
) c_int;
extern "c" fn umount2(target: [*:0]const u8, flags: c_int) c_int;
extern "c" fn mkdir(path: [*:0]const u8, mode: c_uint) c_int;
extern "c" fn signal(signum: c_int, handler: usize) usize;

// --- constants -----------------------------------------------------------

const AF_VSOCK: c_int = 40;
const SOCK_STREAM: c_int = 1;
const O_RDWR: c_int = 2;
const O_CLOEXEC: c_int = 0o02000000;
const MS_NOSUID: c_ulong = 2;
const MS_NODEV: c_ulong = 4;
const MNT_DETACH: c_int = 2;
const SIGPIPE: c_int = 13;
const SIG_IGN: usize = 1;
// host_cid=2 is the well-known CID for "this hypervisor" in AF_VSOCK,
// matching the host_cid constant in packages/microvm/src/vsock.zig.
const VMADDR_CID_HOST: u32 = 2;

// /proc/sys/fs/fuse/conn/*/max_read — kernel's read buffer. 128KiB is
// the common ceiling matching max_write negotiated in FUSE_INIT.
const BUF_SIZE: usize = 128 * 1024;
// Upper bound for a single FUSE response body the host might send.
// The kernel's max reply is max_write + headers; 256KiB is generous.
const INBOUND_CAP: usize = 256 * 1024;

const SockaddrVm = extern struct {
    svm_family: u16,
    svm_reserved1: u16,
    svm_port: u32,
    svm_cid: u32,
    svm_zero: [4]u8,
};

// --- helpers -------------------------------------------------------------

fn logLine(msg: []const u8) void {
    _ = write(2, msg.ptr, msg.len);
    _ = write(2, "\n", 1);
}

fn logErr(prefix: []const u8, rc: isize) void {
    var buf: [128]u8 = undefined;
    const msg = std.fmt.bufPrint(&buf, "{s} rc={d}", .{ prefix, rc }) catch prefix;
    logLine(msg);
}

fn writeAll(fd: c_int, data: []const u8) bool {
    var off: usize = 0;
    while (off < data.len) {
        const n = write(fd, data.ptr + off, data.len - off);
        if (n <= 0) return false;
        off += @intCast(n);
    }
    return true;
}

/// Read at least enough bytes off `fd` to satisfy the caller's advance
/// target. Returns false on EOF/error.
fn readInto(fd: c_int, buf: []u8, accum: *usize, minimum: usize) bool {
    while (accum.* < minimum) {
        const free = buf.len - accum.*;
        if (free == 0) return false;
        const n = read(fd, buf.ptr + accum.*, free);
        if (n <= 0) return false;
        accum.* += @intCast(n);
    }
    return true;
}

// --- forwarding threads --------------------------------------------------

const Pipe = struct {
    dev_fd: c_int,
    sock_fd: c_int,
};

/// /dev/fuse → vsock. Each `read` returns exactly one complete FUSE
/// request, so we forward it as a single atomic write and rely on the
/// host's readFrames() to reassemble framing from the 4-byte length
/// prefix.
fn devToSockThread(pipe: *Pipe) void {
    var buf: [BUF_SIZE]u8 = undefined;
    while (true) {
        const n = read(pipe.dev_fd, &buf, buf.len);
        if (n <= 0) {
            logErr("fuse-agent: /dev/fuse read ended", n);
            return;
        }
        const slice = buf[0..@intCast(n)];
        if (!writeAll(pipe.sock_fd, slice)) {
            logLine("fuse-agent: sock write failed; tearing down");
            return;
        }
    }
}

/// vsock → /dev/fuse. Each write to /dev/fuse must be a single
/// complete response or the kernel rejects it with EINVAL. Parse the
/// 4-byte length prefix, wait for that many bytes, then issue one
/// syscall.
fn sockToDevLoop(pipe: *Pipe, alloc: std.mem.Allocator) !void {
    const buf = try alloc.alloc(u8, INBOUND_CAP);
    defer alloc.free(buf);
    var accum: usize = 0;

    while (true) {
        // Ensure we have the 4-byte header.
        if (!readInto(pipe.sock_fd, buf, &accum, 4)) {
            logLine("fuse-agent: vsock EOF before header; exiting");
            return;
        }
        const msg_len = std.mem.readInt(u32, buf[0..4], .little);
        if (msg_len < 16 or msg_len > buf.len) {
            var b: [128]u8 = undefined;
            const m = std.fmt.bufPrint(&b, "fuse-agent: bad reply len {d}", .{msg_len}) catch "fuse-agent: bad reply len";
            logLine(m);
            return;
        }
        if (!readInto(pipe.sock_fd, buf, &accum, msg_len)) {
            logLine("fuse-agent: vsock EOF mid-body; exiting");
            return;
        }
        if (!writeAll(pipe.dev_fd, buf[0..msg_len])) {
            logLine("fuse-agent: /dev/fuse write failed");
            return;
        }
        // Shift any tail down. Typically zero bytes but the host is
        // allowed to coalesce sends.
        const tail = accum - msg_len;
        if (tail > 0) std.mem.copyForwards(u8, buf[0..tail], buf[msg_len .. msg_len + tail]);
        accum = tail;
    }
}

// --- mount setup ---------------------------------------------------------

/// Ensure a path exists as a directory. Walks segments and mkdir()s
/// each intermediate. Path bytes get scribbled on and restored.
fn mkdirP(path: []u8) void {
    if (path.len == 0) return;
    var i: usize = 1;
    while (i <= path.len) : (i += 1) {
        if (i < path.len and path[i] != '/') continue;
        if (i == path.len and path[path.len - 1] == '/') break;
        const saved: u8 = if (i < path.len) path[i] else 0;
        if (i < path.len) path[i] = 0;
        _ = mkdir(@ptrCast(path.ptr), 0o755);
        if (i < path.len) path[i] = saved;
    }
}

/// Mount the FUSE filesystem at `target` backed by `dev_fd`. Builds
/// the options string the kernel expects — `fd=...,rootmode=040755,
/// user_id=0,group_id=0,default_permissions`.
fn mountFuse(dev_fd: c_int, target_z: [*:0]const u8) !void {
    var opts_buf: [256]u8 = undefined;
    const opts = try std.fmt.bufPrintZ(
        &opts_buf,
        "fd={d},rootmode=040755,user_id=0,group_id=0,default_permissions",
        .{dev_fd},
    );
    const rc = mount(
        "fuse",
        target_z,
        "fuse",
        MS_NOSUID | MS_NODEV,
        @ptrCast(opts.ptr),
    );
    if (rc < 0) {
        logLine("fuse-agent: mount() failed");
        return error.MountFailed;
    }
}

// --- entry point ---------------------------------------------------------

pub fn main(init: std.process.Init.Minimal) !void {
    _ = signal(SIGPIPE, SIG_IGN);
    const alloc = std.heap.c_allocator;

    // Zig 0.16 threads argv through std.process.Init.Minimal rather
    // than a global std.os.argv; take the iterator and read two args.
    var args_it = std.process.Args.Iterator.init(init.args);
    _ = args_it.next(); // argv[0]
    const port_str = args_it.next() orelse {
        logLine("fuse-agent: usage: fuse-agent <vsock-port> <mount-path>");
        return error.MissingArgs;
    };
    const mount_path = args_it.next() orelse {
        logLine("fuse-agent: usage: fuse-agent <vsock-port> <mount-path>");
        return error.MissingArgs;
    };
    const port = std.fmt.parseInt(u32, port_str, 10) catch {
        logLine("fuse-agent: port not an integer");
        return error.BadPort;
    };

    // Make sure the mount point exists.
    const path_mut = try alloc.dupe(u8, mount_path);
    defer alloc.free(path_mut);
    mkdirP(path_mut);

    const target_z = try alloc.dupeZ(u8, mount_path);
    defer alloc.free(target_z);

    // Open /dev/fuse and mount.
    const dev_fd = open("/dev/fuse", O_RDWR | O_CLOEXEC);
    if (dev_fd < 0) {
        logLine("fuse-agent: open /dev/fuse failed (is the module loaded?)");
        return error.OpenDevFuseFailed;
    }
    try mountFuse(dev_fd, target_z.ptr);

    var log_buf: [256]u8 = undefined;
    const log_msg = std.fmt.bufPrint(
        &log_buf,
        "fuse-agent: mounted {s} (dev_fd={d}); dialing host on vsock port {d}",
        .{ mount_path, dev_fd, port },
    ) catch "fuse-agent: mounted; dialing";
    logLine(log_msg);

    // Dial the host. The VMM's vsock bridge sees the REQUEST for
    // (cid=2, port) and connects the configured UDS where the
    // mount-server is listening; a successful return here means the
    // bridge is fully wired and we can start forwarding bytes.
    const sock_fd = socket(AF_VSOCK, SOCK_STREAM, 0);
    if (sock_fd < 0) {
        _ = umount2(target_z.ptr, MNT_DETACH);
        logLine("fuse-agent: vsock socket() failed");
        return error.VsockSocketFailed;
    }
    var addr: SockaddrVm = .{
        .svm_family = @intCast(AF_VSOCK),
        .svm_reserved1 = 0,
        .svm_port = port,
        .svm_cid = VMADDR_CID_HOST,
        .svm_zero = .{ 0, 0, 0, 0 },
    };
    if (connect(sock_fd, @ptrCast(&addr), @sizeOf(SockaddrVm)) < 0) {
        _ = close(sock_fd);
        _ = umount2(target_z.ptr, MNT_DETACH);
        logLine("fuse-agent: vsock connect() to host failed");
        return error.VsockConnectFailed;
    }
    logLine("fuse-agent: connected to host; forwarding");

    var pipe = Pipe{ .dev_fd = dev_fd, .sock_fd = sock_fd };

    // Dev→sock gets its own thread so a slow host response doesn't
    // block the kernel's request queue. Sock→dev runs on the main
    // thread; when it returns (normal close or error), we unmount and
    // exit, which makes the reader thread observe an EBADF on its
    // next syscall and return too.
    const reader = try std.Thread.spawn(.{}, devToSockThread, .{&pipe});
    reader.detach();

    sockToDevLoop(&pipe, alloc) catch |err| {
        var b: [128]u8 = undefined;
        const m = std.fmt.bufPrint(&b, "fuse-agent: sock→dev err {s}", .{@errorName(err)}) catch "fuse-agent: sock→dev error";
        logLine(m);
    };

    _ = close(sock_fd);
    _ = umount2(target_z.ptr, MNT_DETACH);
    _ = close(dev_fd);
    logLine("fuse-agent: exiting");
}
