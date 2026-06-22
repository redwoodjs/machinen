const std = @import("std");

pub const Signal = enum {
    check,
    term,
    kill,
};

pub const ProcessSignalResult = struct {
    signaled: bool,
    alive: bool,
};

pub const ProcessSignalError = error{
    InvalidPid,
    InvalidSignal,
    PermissionDenied,
    Unexpected,
};

pub fn parseSignal(text: []const u8) ?Signal {
    if (std.mem.eql(u8, text, "0") or std.mem.eql(u8, text, "CHECK")) return .check;
    if (std.mem.eql(u8, text, "SIGTERM") or std.mem.eql(u8, text, "TERM")) return .term;
    if (std.mem.eql(u8, text, "SIGKILL") or std.mem.eql(u8, text, "KILL")) return .kill;
    return null;
}

pub fn signalProcess(pid: u32, signal: Signal) ProcessSignalError!ProcessSignalResult {
    if (pid == 0) return error.InvalidPid;
    if (!pidAlive(pid)) return .{ .signaled = false, .alive = false };
    if (signal != .check) {
        const host_pid = hostPid(pid) orelse return .{ .signaled = false, .alive = false };
        std.posix.kill(host_pid, signalNumber(signal)) catch |err| switch (err) {
            error.ProcessNotFound => return .{ .signaled = false, .alive = false },
            error.PermissionDenied => return .{ .signaled = false, .alive = true },
            else => return error.Unexpected,
        };
    }
    return .{ .signaled = signal != .check, .alive = pidAlive(pid) };
}

fn signalNumber(signal: Signal) std.posix.SIG {
    return switch (signal) {
        .check => @enumFromInt(0),
        .term => @enumFromInt(15),
        .kill => @enumFromInt(9),
    };
}

pub fn pidAlive(pid: u32) bool {
    const host_pid = hostPid(pid) orelse return false;
    std.posix.kill(host_pid, signalNumber(.check)) catch return false;
    return true;
}

fn hostPid(pid: u32) ?std.posix.pid_t {
    const max_pid: u64 = @intCast(std.math.maxInt(std.posix.pid_t));
    if (@as(u64, pid) > max_pid) return null;
    return @intCast(pid);
}

test "parseSignal accepts lifecycle signal names" {
    try std.testing.expectEqual(Signal.check, parseSignal("0").?);
    try std.testing.expectEqual(Signal.check, parseSignal("CHECK").?);
    try std.testing.expectEqual(Signal.term, parseSignal("SIGTERM").?);
    try std.testing.expectEqual(Signal.term, parseSignal("TERM").?);
    try std.testing.expectEqual(Signal.kill, parseSignal("SIGKILL").?);
    try std.testing.expectEqual(Signal.kill, parseSignal("KILL").?);
    try std.testing.expect(parseSignal("SIGUSR1") == null);
}

test "signalProcess treats implausible pids as already dead" {
    const result = try signalProcess(std.math.maxInt(u32), .kill);
    try std.testing.expect(!result.signaled);
    try std.testing.expect(!result.alive);
}
