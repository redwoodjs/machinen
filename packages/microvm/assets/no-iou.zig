//! Runs a child with io_uring_setup / _enter / _register blocked via seccomp.
//!
//! CRIU can't dump a process that holds an io_uring fd. Node.js's libuv
//! opens rings unconditionally on newer kernels even when UV_USE_IO_URING=0
//! (the env var is a no-op in some builds), so we seccomp-block the syscalls
//! and let libuv fall back to epoll silently. To CRIU the process then looks
//! like any other epoll-based one.
//!
//! Usage: machinen-no-iou CMD [ARGS...]
//!
//! Build (from packages/microvm):
//!   zig build-exe assets/no-iou.zig \
//!     -target aarch64-linux-musl -static -O ReleaseSmall \
//!     -lc -femit-bin=<out>/machinen-no-iou

// Syscall numbers — same on all architectures for io_uring since it's
// in the generic syscall table.
const NR_io_uring_setup: u32 = 425;
const NR_io_uring_enter: u32 = 426;
const NR_io_uring_register: u32 = 427;

const PR_SET_NO_NEW_PRIVS: c_int = 38;
const PR_SET_SECCOMP: c_int = 22;
const SECCOMP_MODE_FILTER: c_ulong = 2;

// BPF instruction classes and fields — stable ABI from <linux/bpf_common.h>
// and <linux/filter.h>.
const BPF_LD: u16 = 0x00;
const BPF_JMP: u16 = 0x05;
const BPF_RET: u16 = 0x06;
const BPF_W: u16 = 0x00;
const BPF_ABS: u16 = 0x20;
const BPF_JEQ: u16 = 0x10;
const BPF_K: u16 = 0x00;

const ENOSYS: u32 = 38;
const SECCOMP_RET_ALLOW: u32 = 0x7fff_0000;
const SECCOMP_RET_ERRNO: u32 = 0x0005_0000;
const SECCOMP_RET_DATA: u32 = 0x0000_ffff;

const sock_filter = extern struct {
    code: u16,
    jt: u8,
    jf: u8,
    k: u32,
};

const sock_fprog = extern struct {
    len: c_ushort,
    filter: [*]sock_filter,
};

// Offset of `nr` in `struct seccomp_data`. First field, so 0.
const SECCOMP_DATA_NR_OFFSET: u32 = 0;

const std = @import("std");

extern "c" fn prctl(option: c_int, arg2: c_ulong, arg3: c_ulong, arg4: c_ulong, arg5: c_ulong) c_int;
extern "c" fn execvp(file: [*:0]const u8, argv: [*:null]const ?[*:0]const u8) c_int;
extern "c" fn perror(s: [*:0]const u8) void;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;

fn write_str(fd: c_int, s: []const u8) void {
    _ = write(fd, s.ptr, s.len);
}

pub fn main(init: std.process.Init.Minimal) u8 {
    // On linux-with-libc, args.vector is `[]const [*:0]const u8` — pointers
    // into the stack-allocated argv the kernel handed us. Stable for process
    // lifetime, which is all execvp needs.
    const argv = init.args.vector;
    if (argv.len < 2) {
        write_str(2, "usage: machinen-no-iou CMD [ARGS...]\n");
        return 2;
    }

    var filter = [_]sock_filter{
        // Load seccomp_data.nr into accumulator.
        .{ .code = BPF_LD | BPF_W | BPF_ABS, .jt = 0, .jf = 0, .k = SECCOMP_DATA_NR_OFFSET },
        // If nr == io_uring_setup, jump 3 ahead (to ENOSYS return).
        .{ .code = BPF_JMP | BPF_JEQ | BPF_K, .jt = 3, .jf = 0, .k = NR_io_uring_setup },
        // If nr == io_uring_enter, jump 2 ahead.
        .{ .code = BPF_JMP | BPF_JEQ | BPF_K, .jt = 2, .jf = 0, .k = NR_io_uring_enter },
        // If nr == io_uring_register, jump 1 ahead.
        .{ .code = BPF_JMP | BPF_JEQ | BPF_K, .jt = 1, .jf = 0, .k = NR_io_uring_register },
        // Fallthrough: allow.
        .{ .code = BPF_RET | BPF_K, .jt = 0, .jf = 0, .k = SECCOMP_RET_ALLOW },
        // Matched io_uring_*: return ENOSYS so libuv sees "not supported"
        // and falls back cleanly instead of seeing the syscall killed.
        .{ .code = BPF_RET | BPF_K, .jt = 0, .jf = 0, .k = SECCOMP_RET_ERRNO | (ENOSYS & SECCOMP_RET_DATA) },
    };

    const prog = sock_fprog{ .len = filter.len, .filter = &filter };

    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0) {
        perror("PR_SET_NO_NEW_PRIVS");
        return 3;
    }
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, @intFromPtr(&prog), 0, 0) < 0) {
        perror("PR_SET_SECCOMP");
        return 4;
    }

    // Build a sentinel-terminated argv for execvp. std.process's slice isn't
    // null-terminated, but the raw memory it points at IS (the C ABI
    // guarantees argv[argc] == NULL), so a small stack array is enough.
    var child_argv: [256]?[*:0]const u8 = undefined;
    if (argv.len > child_argv.len) {
        write_str(2, "machinen-no-iou: argv too long\n");
        return 6;
    }
    for (argv[1..], 0..) |a, i| child_argv[i] = a;
    child_argv[argv.len - 1] = null;

    _ = execvp(argv[1], @ptrCast(&child_argv));
    perror("execvp");
    return 5;
}
