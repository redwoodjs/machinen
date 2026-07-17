//! Guest PID 1 for fresh and restored machinen workloads.
//!
//! The supervisor owns process groups, signal forwarding, child reaping,
//! final writable-live-mount sync, sidecar shutdown, and clean poweroff.
//! Restore-specific CRIU setup remains in machinen-restore.sh and runs as a
//! supervised worker.

const std = @import("std");

extern "c" fn access(path: [*:0]const u8, mode: c_int) c_int;
extern "c" fn chmod(path: [*:0]const u8, mode: c_uint) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn dup2(oldfd: c_int, newfd: c_int) c_int;
extern "c" fn execv(path: [*:0]const u8, argv: [*:null]const ?[*:0]const u8) c_int;
extern "c" fn fork() c_int;
extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;
extern "c" fn gethostname(name: [*]u8, len: c_ulong) c_int;
extern "c" fn getpid() c_int;
extern "c" fn ioctl(fd: c_int, request: c_ulong, arg: c_ulong) c_int;
extern "c" fn kill(pid: c_int, signal_number: c_int) c_int;
extern "c" fn lseek(fd: c_int, offset: i64, whence: c_int) i64;
extern "c" fn mkdir(path: [*:0]const u8, mode: c_uint) c_int;
extern "c" fn mount(
    source: [*:0]const u8,
    target: [*:0]const u8,
    filesystemtype: [*:0]const u8,
    mountflags: c_ulong,
    data: ?*const anyopaque,
) c_int;
extern "c" fn nanosleep(req: *const Timespec, rem: ?*Timespec) c_int;
extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, count: c_ulong) isize;
extern "c" fn reboot(command: c_int) c_int;
extern "c" fn sethostname(name: [*]const u8, len: c_ulong) c_int;
extern "c" fn setsid() c_int;
const SignalHandler = ?*const fn (c_int) callconv(.c) void;
extern "c" fn signal(signum: c_int, handler: SignalHandler) SignalHandler;
extern "c" fn sync() void;
extern "c" fn unlink(path: [*:0]const u8) c_int;
extern "c" fn waitpid(pid: c_int, status: ?*c_int, options: c_int) c_int;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: c_ulong) isize;
extern "c" fn _exit(status: c_int) noreturn;
extern "c" fn __errno_location() *c_int;

const Timespec = extern struct { tv_sec: i64, tv_nsec: i64 };

const O_RDONLY: c_int = 0;
const O_WRONLY: c_int = 1;
const O_RDWR: c_int = 2;
const O_CREAT: c_int = 0o100;
const O_TRUNC: c_int = 0o1000;
const SEEK_END: c_int = 2;
const F_OK: c_int = 0;
const X_OK: c_int = 1;
const EINTR: c_int = 4;
const SIGINT: c_int = 2;
const SIGKILL: c_int = 9;
const SIGTERM: c_int = 15;
const SIG_DFL: SignalHandler = null;
const TIOCSCTTY: c_ulong = 0x540E;
const LINUX_REBOOT_CMD_POWER_OFF: c_int = @bitCast(@as(u32, 0x4321fedc));

const NO_IOU = "/sbin/machinen-no-iou";
const RESTORE = "/sbin/machinen-restore";
const SYNC_SCRIPT = "/run/machinen-batch-sync.sh";
const STATUS_FILE = "/run/machinen-workload.status";
const READY_FILE = "/run/machinen-supervisor.ready";
const PID_FILE = "/run/machinen-workload.pid";

var workload_pid: c_int = 0;
var forward_to_group = true;
var pending_signal: c_int = 0;

fn errno_value() c_int {
    std.debug.assert(@sizeOf(c_int) >= 2);
    return __errno_location().*;
}

fn discard_result(value: anytype) void {
    std.debug.assert(@sizeOf(@TypeOf(value)) > 0);
    std.mem.doNotOptimizeAway(value);
}

fn write_all(fd: c_int, bytes: []const u8) void {
    std.debug.assert(fd >= 0);
    var remaining = bytes;
    while (remaining.len > 0) {
        const count = write(fd, remaining.ptr, @intCast(remaining.len));
        if (count <= 0) return;
        remaining = remaining[@intCast(count)..];
    }
}

fn log_line(message: []const u8) void {
    std.debug.assert(message.len <= 512);
    write_all(2, "machinen-supervisor: ");
    write_all(2, message);
    write_all(2, "\n");
}

fn log_status(comptime format: []const u8, args: anytype) void {
    std.debug.assert(format.len > 0);
    var buffer: [512]u8 = undefined;
    const message = std.fmt.bufPrint(&buffer, format, args) catch return;
    log_line(message);
}

fn sleep_ms(milliseconds: i64) void {
    std.debug.assert(milliseconds >= 0);
    var duration = Timespec{
        .tv_sec = @divTrunc(milliseconds, 1000),
        .tv_nsec = @mod(milliseconds, 1000) * 1_000_000,
    };
    discard_result(nanosleep(&duration, null));
}

fn mkdir_ignore(path: [*:0]const u8, mode: c_uint) void {
    std.debug.assert(mode <= 0o7777);
    discard_result(mkdir(path, mode));
}

fn write_file(path: [*:0]const u8, contents: []const u8) bool {
    std.debug.assert(contents.len <= 4096);
    const fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, @as(c_uint, 0o644));
    if (fd < 0) return false;
    defer discard_result(close(fd));
    write_all(fd, contents);
    return true;
}

fn prepare_guest() void {
    std.debug.assert(getpid() == 1);
    mkdir_ignore("/run", 0o755);
    mkdir_ignore("/tmp", 0o1777);
    mkdir_ignore("/var/tmp", 0o1777);
    mkdir_ignore("/dev", 0o755);
    discard_result(chmod("/tmp", 0o1777));
    discard_result(chmod("/var/tmp", 0o1777));
    if (access("/dev/kmsg", F_OK) != 0) {
        discard_result(mount("devtmpfs", "/dev", "devtmpfs", 0, null));
    }
    discard_result(write_file(READY_FILE, "ready\n"));
}

fn prepare_hostname() void {
    std.debug.assert(getpid() == 1);
    if (getenv("MACHINEN_VM_NAME")) |name_z| {
        const name = std.mem.span(name_z);
        discard_result(sethostname(name.ptr, @intCast(name.len)));
    }
    const wait_value = getenv("MACHINEN_VM_HOSTNAME_WAIT") orelse return;
    if (!std.mem.eql(u8, std.mem.span(wait_value), "1")) return;

    var attempts: u8 = 0;
    while (attempts < 100) : (attempts += 1) {
        var buffer: [256]u8 = @splat(0);
        if (gethostname(&buffer, @intCast(buffer.len)) == 0) {
            const end = std.mem.indexOfScalar(u8, &buffer, 0) orelse buffer.len;
            if (std.mem.indexOf(u8, buffer[0..end], "-pid-") != null) return;
        }
        sleep_ms(50);
    }
}

fn active_tty() [*:0]const u8 {
    std.debug.assert(getpid() == 1);
    var buffer: [128]u8 = undefined;
    const fd = open("/sys/class/tty/console/active", O_RDONLY);
    if (fd >= 0) {
        defer discard_result(close(fd));
        const count = read(fd, &buffer, @intCast(buffer.len));
        if (count > 0 and std.mem.indexOf(u8, buffer[0..@intCast(count)], "ttyAMA0") != null and
            access("/dev/ttyAMA0", F_OK) == 0)
        {
            return "/dev/ttyAMA0";
        }
    }
    return "/dev/console";
}

fn reset_child_signals() void {
    std.debug.assert(SIGTERM != SIGINT);
    discard_result(signal(SIGTERM, SIG_DFL));
    discard_result(signal(SIGINT, SIG_DFL));
}

fn redirect_fresh_stdio(tty: [*:0]const u8) void {
    std.debug.assert(std.mem.span(tty).len > 0);
    if (std.mem.eql(u8, std.mem.span(tty), "/dev/console")) {
        const input = open("/dev/null", O_RDONLY);
        const output = open("/dev/console", O_WRONLY);
        if (input >= 0) discard_result(dup2(input, 0));
        if (output >= 0) {
            discard_result(dup2(output, 1));
            discard_result(dup2(output, 2));
        }
        if (input > 2) discard_result(close(input));
        if (output > 2) discard_result(close(output));
        return;
    }

    const fd = open(tty, O_RDWR);
    if (fd < 0) return;
    discard_result(ioctl(fd, TIOCSCTTY, 0));
    discard_result(dup2(fd, 0));
    discard_result(dup2(fd, 1));
    discard_result(dup2(fd, 2));
    if (fd > 2) discard_result(close(fd));
}

fn write_workload_pid() void {
    std.debug.assert(getpid() > 0);
    var buffer: [32]u8 = undefined;
    const text = std.fmt.bufPrint(&buffer, "{d}", .{workload_pid_value()}) catch return;
    discard_result(write_file(PID_FILE, text));
}

fn workload_pid_value() c_int {
    const pid = getpid();
    std.debug.assert(pid > 0);
    return pid;
}

fn spawn_fresh(command: []const [*:0]const u8) c_int {
    std.debug.assert(command.len > 0);
    const pid = fork();
    if (pid != 0) return pid;

    reset_child_signals();
    if (setsid() < 0) _exit(126);
    redirect_fresh_stdio(active_tty());
    write_workload_pid();

    var child_argv: [258]?[*:0]const u8 = undefined;
    if (command.len + 2 > child_argv.len) _exit(2);
    child_argv[0] = NO_IOU;
    for (command, 0..) |argument, index| child_argv[index + 1] = argument;
    child_argv[command.len + 1] = null;
    discard_result(execv(NO_IOU, @ptrCast(&child_argv)));
    _exit(127);
}

fn spawn_restore() c_int {
    std.debug.assert(getpid() > 0);
    const pid = fork();
    if (pid != 0) return pid;

    reset_child_signals();
    if (setsid() < 0) _exit(126);
    var child_argv = [_]?[*:0]const u8{ RESTORE, "--worker", null };
    discard_result(execv(RESTORE, @ptrCast(&child_argv)));
    _exit(127);
}

fn spawn_quiet(path: [*:0]const u8) c_int {
    std.debug.assert(std.mem.span(path).len > 0);
    const pid = fork();
    if (pid != 0) return pid;

    reset_child_signals();
    const null_fd = open("/dev/null", O_RDWR);
    if (null_fd >= 0) {
        discard_result(dup2(null_fd, 0));
        discard_result(dup2(null_fd, 1));
        discard_result(dup2(null_fd, 2));
        if (null_fd > 2) discard_result(close(null_fd));
    }
    var child_argv = [_]?[*:0]const u8{ path, null };
    discard_result(execv(path, @ptrCast(&child_argv)));
    _exit(127);
}

fn forward_signal(signal_number: c_int) void {
    std.debug.assert(signal_number > 0);
    const pid = workload_pid;
    if (pid <= 0) return;
    if (forward_to_group) {
        if (kill(-pid, signal_number) == 0) return;
    }
    discard_result(kill(pid, signal_number));
}

fn handle_signal(signal_number: c_int) callconv(.c) void {
    std.debug.assert(signal_number > 0);
    pending_signal = signal_number;
    forward_signal(signal_number);
}

fn install_signal_handlers() void {
    std.debug.assert(getpid() == 1);
    discard_result(signal(SIGTERM, &handle_signal));
    discard_result(signal(SIGINT, &handle_signal));
}

fn wait_status_code(status: c_int) u8 {
    std.debug.assert(status >= 0);
    if ((status & 0x7f) == 0) return @intCast((status >> 8) & 0xff);
    return @intCast(128 + (status & 0x7f));
}

fn wait_for_workload(pid: c_int) u8 {
    std.debug.assert(pid > 0);
    // Intentional: PID 1 must reap unrelated adopted descendants too.
    while (true) {
        var status: c_int = 0;
        const reaped = waitpid(-1, &status, 0);
        if (reaped == pid) return wait_status_code(status);
        if (reaped > 0) continue;
        if (errno_value() == EINTR) continue;
        log_status("waitpid failed errno={d}", .{errno_value()});
        return 1;
    }
}

fn wait_for_child(pid: c_int) u8 {
    std.debug.assert(pid > 0);
    // Intentional: signals may interrupt waiting for cleanup helpers.
    while (true) {
        var status: c_int = 0;
        const reaped = waitpid(pid, &status, 0);
        if (reaped == pid) return wait_status_code(status);
        if (reaped < 0 and errno_value() == EINTR) continue;
        return 1;
    }
}

fn run_command(path: [*:0]const u8, arguments: []const [*:0]const u8) u8 {
    std.debug.assert(std.mem.span(path).len > 0);
    std.debug.assert(arguments.len <= 14);
    const pid = fork();
    if (pid < 0) return 1;
    if (pid == 0) {
        reset_child_signals();
        var child_argv: [16]?[*:0]const u8 = undefined;
        if (arguments.len + 2 > child_argv.len) _exit(2);
        child_argv[0] = path;
        for (arguments, 0..) |argument, index| child_argv[index + 1] = argument;
        child_argv[arguments.len + 1] = null;
        discard_result(execv(path, @ptrCast(&child_argv)));
        _exit(127);
    }
    return wait_for_child(pid);
}

fn sync_writable_live_mounts() u8 {
    std.debug.assert(getpid() == 1);
    const fd = open(SYNC_SCRIPT, O_RDONLY);
    if (fd < 0) return 0;
    const size = lseek(fd, 0, SEEK_END);
    discard_result(close(fd));
    if (size <= 0) return 0;

    const status = run_command("/bin/sh", &.{SYNC_SCRIPT});
    if (status != 0) {
        log_status(
            "writable live-mount sync failed (status={d}); fallback retained at {s}",
            .{ status, SYNC_SCRIPT },
        );
        return status;
    }
    if (unlink(SYNC_SCRIPT) != 0) {
        log_status(
            "writable live-mount sync succeeded but fallback removal failed: {s}",
            .{SYNC_SCRIPT},
        );
        return 1;
    }
    return 0;
}

fn stop_sidecar(pid: c_int) u8 {
    std.debug.assert(pid >= 0);
    if (pid <= 0) return 0;
    if (kill(pid, SIGTERM) == 0) return 0;
    if (kill(pid, 0) == 0) {
        log_status("failed to stop sidecar {d}", .{pid});
        return 1;
    }
    return 0;
}

fn choose_retained_status(workload_status: u8, cleanup_status: u8) u8 {
    const retained = if (workload_status != 0) workload_status else cleanup_status;
    std.debug.assert(workload_status == 0 or retained == workload_status);
    return retained;
}

fn finish_cleanup(workload_status: u8, sidecars: []const c_int) u8 {
    std.debug.assert(sidecars.len <= 2);
    var cleanup_status = sync_writable_live_mounts();
    for (sidecars) |pid| {
        const sidecar_status = stop_sidecar(pid);
        if (cleanup_status == 0 and sidecar_status != 0) cleanup_status = sidecar_status;
    }

    const retained_status = choose_retained_status(workload_status, cleanup_status);
    if (cleanup_status != 0 and workload_status != 0) {
        log_status(
            "preserving workload status {d} after cleanup failed with status {d}",
            .{ workload_status, cleanup_status },
        );
    }
    if (workload_status != 0) {
        log_status("workload exited with status {d}", .{workload_status});
    }

    var buffer: [16]u8 = undefined;
    const text = std.fmt.bufPrint(
        &buffer,
        "{d}\n",
        .{retained_status},
    ) catch return retained_status;
    discard_result(write_file(STATUS_FILE, text));
    return retained_status;
}

fn power_off(retained_status: u8) noreturn {
    std.debug.assert(getpid() == 1);
    if (retained_status != 0) {
        log_status("powering off after retained status {d}", .{retained_status});
    }
    var poweroff_argv = [_]?[*:0]const u8{ "/sbin/machinen-poweroff", null };
    discard_result(execv("/sbin/machinen-poweroff", @ptrCast(&poweroff_argv)));

    log_line("machinen-poweroff exec failed");
    sync();
    discard_result(reboot(LINUX_REBOOT_CMD_POWER_OFF));
    // Park forever if reboot unexpectedly returns.
    while (true) sleep_ms(60_000);
}

fn fatal(message: []const u8) noreturn {
    std.debug.assert(message.len > 0);
    log_line(message);
    power_off(1);
}

pub fn main(init: std.process.Init.Minimal) u8 {
    const arguments = init.args.vector;
    std.debug.assert(arguments.len > 0);
    if (arguments.len < 2) fatal("missing workload command");

    prepare_guest();
    install_signal_handlers();

    const agent_pid = spawn_quiet("/exec-agent");
    const winsize_pid = if (access("/sbin/machinen-winsize-agent", X_OK) == 0)
        spawn_quiet("/sbin/machinen-winsize-agent")
    else
        0;
    prepare_hostname();

    var restore_mode = false;
    var command_start: u32 = 1;
    if (std.mem.eql(u8, std.mem.span(arguments[1]), "--restore")) {
        restore_mode = true;
    }
    if (!restore_mode and std.mem.eql(u8, std.mem.span(arguments[1]), "--session")) {
        command_start += 1;
    }
    if (!restore_mode and command_start >= arguments.len) fatal("missing workload command");

    const child_pid = if (restore_mode)
        spawn_restore()
    else
        spawn_fresh(arguments[command_start..]);
    if (child_pid < 0) fatal("failed to fork workload");

    workload_pid = child_pid;
    forward_to_group = !restore_mode;
    if (pending_signal != 0) forward_signal(pending_signal);

    const workload_status = wait_for_workload(child_pid);
    discard_result(kill(-child_pid, SIGKILL));
    workload_pid = 0;

    const retained_status = finish_cleanup(workload_status, &.{ winsize_pid, agent_pid });
    power_off(retained_status);
}

test "wait status retains exit and signal codes" {
    try std.testing.expectEqual(@as(u8, 42), wait_status_code(42 << 8));
    try std.testing.expectEqual(@as(u8, 143), wait_status_code(SIGTERM));
}

test "workload failure wins over cleanup failure" {
    try std.testing.expectEqual(@as(u8, 42), choose_retained_status(42, 23));
    try std.testing.expectEqual(@as(u8, 23), choose_retained_status(0, 23));
    try std.testing.expectEqual(@as(u8, 0), choose_retained_status(0, 0));
}
