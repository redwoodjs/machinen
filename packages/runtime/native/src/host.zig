const std = @import("std");
const builtin = @import("builtin");

pub const Error = anyerror;

pub const RssTarget = struct {
    pid: u32,
    stats_path: ?[]const u8 = null,
};

pub const RssReading = struct {
    pid: u32,
    rss_bytes: u64,
};

pub fn readHostRss(allocator: std.mem.Allocator, io: std.Io, targets: []const RssTarget) Error![]RssReading {
    var readings: std.ArrayList(RssReading) = .empty;
    errdefer readings.deinit(allocator);

    switch (builtin.os.tag) {
        .linux => {
            for (targets) |target| {
                if (try readVmRssLinux(allocator, io, target.pid)) |rss| {
                    try readings.append(allocator, .{ .pid = target.pid, .rss_bytes = rss });
                }
            }
        },
        .macos => {
            for (targets) |target| {
                if (readPhysFootprintFromStats(io, target.stats_path)) |rss| {
                    try readings.append(allocator, .{ .pid = target.pid, .rss_bytes = rss });
                    continue;
                }
                if (try readPsRssDarwin(allocator, io, target.pid)) |rss| {
                    try readings.append(allocator, .{ .pid = target.pid, .rss_bytes = rss });
                }
            }
        },
        else => {},
    }

    return readings.toOwnedSlice(allocator);
}

fn readVmRssLinux(allocator: std.mem.Allocator, io: std.Io, pid: u32) Error!?u64 {
    const path = try std.fmt.allocPrint(allocator, "/proc/{d}/status", .{pid});
    defer allocator.free(path);
    const data = readFileAlloc(allocator, io, path) catch |err| switch (err) {
        error.FileNotFound => return null,
        else => return null,
    };
    defer allocator.free(data);
    return parseVmRssStatus(data);
}

pub fn parseVmRssStatus(status: []const u8) ?u64 {
    var lines = std.mem.splitScalar(u8, status, '\n');
    while (lines.next()) |line| {
        if (!std.mem.startsWith(u8, line, "VmRSS:")) continue;
        var it = std.mem.tokenizeAny(u8, line[6..], " \t");
        const number_text = it.next() orelse return null;
        const unit_text = it.next() orelse return null;
        if (!std.mem.eql(u8, unit_text, "kB")) return null;
        const kib = std.fmt.parseUnsigned(u64, number_text, 10) catch return null;
        return kib * 1024;
    }
    return null;
}

fn readPhysFootprintFromStats(io: std.Io, stats_path: ?[]const u8) ?u64 {
    const path = stats_path orelse return null;
    var file = std.Io.Dir.cwd().openFile(io, path, .{ .allow_directory = false }) catch return null;
    defer file.close(io);
    var buf: [24]u8 = undefined;
    const n = file.readStreaming(io, &.{buf[0..]}) catch return null;
    if (n < 24) return null;
    const value = std.mem.readInt(u64, buf[16..24], .little);
    return if (value == 0) null else value;
}

fn readPsRssDarwin(allocator: std.mem.Allocator, io: std.Io, pid: u32) Error!?u64 {
    const pid_text = try std.fmt.allocPrint(allocator, "{d}", .{pid});
    defer allocator.free(pid_text);
    const result = std.process.run(allocator, io, .{
        .argv = &.{ "/bin/ps", "-o", "rss=", "-p", pid_text },
        .stdout_limit = .limited(16 * 1024),
        .stderr_limit = .limited(16 * 1024),
    }) catch return null;
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |code| if (code != 0) return null,
        else => return null,
    }
    const trimmed = std.mem.trim(u8, result.stdout, " \t\r\n");
    if (trimmed.len == 0) return null;
    const rss_kib = std.fmt.parseUnsigned(u64, trimmed, 10) catch return null;
    return if (rss_kib == 0) null else rss_kib * 1024;
}

fn readFileAlloc(allocator: std.mem.Allocator, io: std.Io, path: []const u8) Error![]u8 {
    var file = try std.Io.Dir.cwd().openFile(io, path, .{ .allow_directory = false });
    defer file.close(io);
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    var buf: [4096]u8 = undefined;
    while (true) {
        const n = file.readStreaming(io, &.{buf[0..]}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => |e| return e,
        };
        if (n == 0) break;
        try out.appendSlice(allocator, buf[0..n]);
    }
    return out.toOwnedSlice(allocator);
}

test "parseVmRssStatus reads VmRSS in bytes" {
    try std.testing.expectEqual(@as(?u64, 12_345 * 1024), parseVmRssStatus(
        \\Name:\tnode
        \\VmSize:\t1 kB
        \\VmRSS:\t   12345 kB
        \\Threads:\t1
        \\
    ));
}

test "parseVmRssStatus returns null when VmRSS is absent" {
    try std.testing.expectEqual(@as(?u64, null), parseVmRssStatus("Name:\tnode\n"));
}

test "readHostRss reports current process on supported platforms" {
    switch (builtin.os.tag) {
        .linux, .macos => {
            const pid: u32 = @intCast(std.c.getpid());
            const readings = try readHostRss(std.testing.allocator, std.testing.io, &.{.{ .pid = pid }});
            defer std.testing.allocator.free(readings);
            try std.testing.expect(readings.len == 1);
            try std.testing.expect(readings[0].rss_bytes > 0);
        },
        else => {},
    }
}
