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

pub const PidStatus = enum {
    alive,
    dead,
    recycled,
};

pub const ProcessIdentity = struct {
    exe_base: []u8,
    started_at_ms: ?i64 = null,

    pub fn deinit(self: ProcessIdentity, allocator: std.mem.Allocator) void {
        allocator.free(self.exe_base);
    }
};

pub const PidExpected = struct {
    vmm_exe: ?[]const u8 = null,
    started_at_ms: ?i64 = null,
};

pub const CpuCgroupOptions = struct {
    pid: u32,
    weight: u32,
    quota_cpus: ?f64 = null,
    parent_dir: []const u8,
    id: []const u8,
};

pub const CpuCgroupStatus = enum {
    linux_cgroup_v2,
    unsupported,
};

pub const CpuCgroupResult = struct {
    status: CpuCgroupStatus,
    cgroup_path: ?[]u8 = null,
    reason: ?[]const u8 = null,
};

const CPU_PERIOD_US = 100_000;
const DEFAULT_CGROUP_PARENT = "/sys/fs/cgroup";
const STARTTIME_SKEW_MS = 5_000;

pub fn readProcessIdentity(allocator: std.mem.Allocator, io: std.Io, pid: u32) Error!?ProcessIdentity {
    return switch (builtin.os.tag) {
        .linux => readLinuxIdentity(allocator, io, pid),
        .macos => readPsIdentity(allocator, io, pid),
        else => readPsIdentity(allocator, io, pid),
    };
}

pub fn validatePid(allocator: std.mem.Allocator, io: std.Io, pid: u32, expected: PidExpected) Error!PidStatus {
    if (pid == 0) return .dead;
    if (!pidAlive(pid)) return .dead;
    if (expected.vmm_exe == null and expected.started_at_ms == null) return .alive;
    const observed = (try readProcessIdentity(allocator, io, pid)) orelse return .alive;
    defer observed.deinit(allocator);

    if (expected.vmm_exe) |vmm_exe| {
        const expected_base = std.fs.path.basename(vmm_exe);
        if (!std.mem.eql(u8, observed.exe_base, expected_base)) {
            if (builtin.os.tag != .linux or !std.mem.eql(u8, observed.exe_base, "pdeathsig") or !startTimesMatch(expected.started_at_ms, observed.started_at_ms)) {
                return .recycled;
            }
        }
    }
    if (!startTimesMatch(expected.started_at_ms, observed.started_at_ms)) return .recycled;
    return .alive;
}

pub fn applyCpuCgroup(allocator: std.mem.Allocator, io: std.Io, opts: CpuCgroupOptions) Error!CpuCgroupResult {
    if (builtin.os.tag != .linux) {
        return .{ .status = .unsupported, .reason = "hard CPU quota uses Linux cgroup v2" };
    }
    return applyCpuCgroupLinux(allocator, io, opts);
}

fn applyCpuCgroupLinux(allocator: std.mem.Allocator, io: std.Io, opts: CpuCgroupOptions) Error!CpuCgroupResult {
    if (!looksLikeCgroupV2(io, opts.parent_dir)) return error.CgroupUnsupported;
    try std.Io.Dir.cwd().createDirPath(io, opts.parent_dir);
    const safe_id = try sanitizeCgroupId(allocator, opts.id);
    defer allocator.free(safe_id);
    const suffix = randomHexSuffix();
    const cgroup_path = try std.fmt.allocPrint(allocator, "{s}/machinen-vm-{s}-{s}", .{ opts.parent_dir, safe_id, &suffix });
    errdefer allocator.free(cgroup_path);
    try std.Io.Dir.cwd().createDir(io, cgroup_path, .default_dir);
    errdefer removeCpuCgroup(io, cgroup_path);

    if (opts.quota_cpus) |quota_cpus| {
        const quota_us: u64 = @max(1, @as(u64, @intFromFloat(@round(quota_cpus * CPU_PERIOD_US))));
        const cpu_max = try std.fmt.allocPrint(allocator, "{d} {d}\n", .{ quota_us, CPU_PERIOD_US });
        defer allocator.free(cpu_max);
        const cpu_max_path = try joinCgroupFile(allocator, cgroup_path, "cpu.max");
        defer allocator.free(cpu_max_path);
        try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = cpu_max_path, .data = cpu_max });
    }
    const weight = try std.fmt.allocPrint(allocator, "{d}\n", .{opts.weight});
    defer allocator.free(weight);
    const weight_path = try joinCgroupFile(allocator, cgroup_path, "cpu.weight");
    defer allocator.free(weight_path);
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = weight_path, .data = weight });
    const procs = try std.fmt.allocPrint(allocator, "{d}\n", .{opts.pid});
    defer allocator.free(procs);
    const procs_path = try joinCgroupFile(allocator, cgroup_path, "cgroup.procs");
    defer allocator.free(procs_path);
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = procs_path, .data = procs });

    return .{ .status = .linux_cgroup_v2, .cgroup_path = cgroup_path };
}

pub fn removeCpuCgroup(io: std.Io, cgroup_path: []const u8) void {
    std.Io.Dir.cwd().deleteDir(io, cgroup_path) catch {
        if (!std.mem.startsWith(u8, cgroup_path, DEFAULT_CGROUP_PARENT ++ "/")) {
            std.Io.Dir.cwd().deleteTree(io, cgroup_path) catch {};
        }
    };
}

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

fn pidAlive(pid: u32) bool {
    std.posix.kill(@intCast(pid), @enumFromInt(0)) catch return false;
    return true;
}

fn startTimesMatch(expected: ?i64, observed: ?i64) bool {
    const e = expected orelse return true;
    const o = observed orelse return true;
    return @abs(e - o) <= STARTTIME_SKEW_MS;
}

fn readLinuxIdentity(allocator: std.mem.Allocator, io: std.Io, pid: u32) Error!?ProcessIdentity {
    var link_buf: [4096]u8 = undefined;
    const exe_path = try std.fmt.allocPrint(allocator, "/proc/{d}/exe", .{pid});
    defer allocator.free(exe_path);
    const link_len = std.Io.Dir.readLinkAbsolute(io, exe_path, &link_buf) catch return null;
    const exe_base = try allocator.dupe(u8, std.fs.path.basename(link_buf[0..link_len]));
    errdefer allocator.free(exe_base);

    var started_at_ms: ?i64 = null;
    const stat_path = try std.fmt.allocPrint(allocator, "/proc/{d}/stat", .{pid});
    defer allocator.free(stat_path);
    if (readFileAlloc(allocator, io, stat_path) catch null) |stat_data| {
        defer allocator.free(stat_data);
        if (try readBootTimeSeconds(allocator, io)) |boot_time_seconds| {
            started_at_ms = parseLinuxStartTimeMs(stat_data, boot_time_seconds);
        }
    }

    return .{ .exe_base = exe_base, .started_at_ms = started_at_ms };
}

fn readBootTimeSeconds(allocator: std.mem.Allocator, io: std.Io) Error!?i64 {
    const data = readFileAlloc(allocator, io, "/proc/stat") catch return null;
    defer allocator.free(data);
    return parseBootTimeSeconds(data);
}

pub fn parseBootTimeSeconds(proc_stat: []const u8) ?i64 {
    var lines = std.mem.splitScalar(u8, proc_stat, '\n');
    while (lines.next()) |line| {
        if (!std.mem.startsWith(u8, line, "btime ")) continue;
        const raw = std.mem.trim(u8, line[6..], " \t");
        return std.fmt.parseInt(i64, raw, 10) catch null;
    }
    return null;
}

pub fn parseLinuxStartTimeMs(proc_pid_stat: []const u8, boot_time_seconds: i64) ?i64 {
    const last_paren = std.mem.lastIndexOfScalar(u8, proc_pid_stat, ')') orelse return null;
    if (last_paren + 2 > proc_pid_stat.len) return null;
    var fields = std.mem.tokenizeScalar(u8, proc_pid_stat[last_paren + 2 ..], ' ');
    var index: usize = 0;
    while (fields.next()) |field| : (index += 1) {
        if (index != 19) continue;
        const ticks = std.fmt.parseInt(i64, field, 10) catch return null;
        return boot_time_seconds * 1000 + ticks * 10;
    }
    return null;
}

fn readPsIdentity(allocator: std.mem.Allocator, io: std.Io, pid: u32) Error!?ProcessIdentity {
    const pid_text = try std.fmt.allocPrint(allocator, "{d}", .{pid});
    defer allocator.free(pid_text);
    const result = std.process.run(allocator, io, .{
        .argv = &.{ "/bin/ps", "-o", "lstart=,command=", "-p", pid_text },
        .stdout_limit = .limited(16 * 1024),
        .stderr_limit = .limited(16 * 1024),
    }) catch return null;
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |code| if (code != 0) return null,
        else => return null,
    }
    const parsed = try parsePsLstartLine(allocator, result.stdout);
    const parts = parsed orelse return null;
    defer allocator.free(parts.lstart);
    defer allocator.free(parts.command);
    return try identityFromPsParts(allocator, parts.command, try parseDarwinLstartMs(allocator, io, parts.lstart));
}

const PsLstartParts = struct {
    lstart: []u8,
    command: []u8,
};

pub fn parsePsLstartLine(allocator: std.mem.Allocator, output: []const u8) Error!?PsLstartParts {
    const trimmed = std.mem.trim(u8, output, " \t\r\n");
    if (trimmed.len < 24) return null;
    const lstart = std.mem.trim(u8, trimmed[0..24], " \t");
    const rest = std.mem.trim(u8, trimmed[24..], " \t");
    var command_it = std.mem.tokenizeAny(u8, rest, " \t\r\n");
    const command = command_it.next() orelse return null;
    return .{
        .lstart = try allocator.dupe(u8, lstart),
        .command = try allocator.dupe(u8, command),
    };
}

fn identityFromPsParts(allocator: std.mem.Allocator, command: []const u8, started_at_ms: ?i64) Error!ProcessIdentity {
    return .{
        .exe_base = try allocator.dupe(u8, std.fs.path.basename(command)),
        .started_at_ms = started_at_ms,
    };
}

fn parseDarwinLstartMs(allocator: std.mem.Allocator, io: std.Io, lstart: []const u8) Error!?i64 {
    const result = std.process.run(allocator, io, .{
        .argv = &.{ "/bin/date", "-j", "-f", "%a %e %b %T %Y", lstart, "+%s" },
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
    const seconds = std.fmt.parseInt(i64, trimmed, 10) catch return null;
    return seconds * 1000;
}

fn looksLikeCgroupV2(io: std.Io, parent_dir: []const u8) bool {
    if (std.mem.eql(u8, parent_dir, DEFAULT_CGROUP_PARENT)) {
        return existsFile(io, DEFAULT_CGROUP_PARENT ++ "/cgroup.controllers");
    }
    return existsPath(io, parent_dir);
}

fn existsPath(io: std.Io, path: []const u8) bool {
    _ = std.Io.Dir.cwd().statFile(io, path, .{ .follow_symlinks = false }) catch return false;
    return true;
}

fn existsFile(io: std.Io, path: []const u8) bool {
    const st = std.Io.Dir.cwd().statFile(io, path, .{ .follow_symlinks = false }) catch return false;
    return st.kind == .file;
}

fn sanitizeCgroupId(allocator: std.mem.Allocator, id: []const u8) Error![]u8 {
    const out = try allocator.alloc(u8, id.len);
    for (id, 0..) |c, i| {
        out[i] = if (std.ascii.isAlphanumeric(c) or c == '_' or c == '.' or c == '-') c else '-';
    }
    return out;
}

fn randomHexSuffix() [8]u8 {
    var bytes: [4]u8 = undefined;
    std.crypto.random.bytes(&bytes);
    const digits = "0123456789abcdef";
    var out: [8]u8 = undefined;
    for (bytes, 0..) |byte, i| {
        out[i * 2] = digits[(byte >> 4) & 0xf];
        out[i * 2 + 1] = digits[byte & 0xf];
    }
    return out;
}

fn joinCgroupFile(allocator: std.mem.Allocator, cgroup_path: []const u8, name: []const u8) Error![]u8 {
    return std.fmt.allocPrint(allocator, "{s}/{s}", .{ cgroup_path, name });
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

fn tmpRootAbs(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

test "applyCpuCgroup returns explicit unsupported outside Linux" {
    if (builtin.os.tag == .linux) return;
    const result = try applyCpuCgroup(std.testing.allocator, std.testing.io, .{
        .pid = 4321,
        .weight = 250,
        .quota_cpus = 0.5,
        .parent_dir = "/tmp/machinen-cgroup-test",
        .id = "unit",
    });
    try std.testing.expectEqual(.unsupported, result.status);
    try std.testing.expect(result.reason != null);
}

test "applyCpuCgroupLinux writes cgroup v2 files" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.createDir(std.testing.io, "parent", .default_dir);
    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const parent = try std.fs.path.join(allocator, &.{ root, "parent" });
    defer allocator.free(parent);

    const result = try applyCpuCgroupLinux(allocator, std.testing.io, .{
        .pid = 4321,
        .weight = 250,
        .quota_cpus = 0.5,
        .parent_dir = parent,
        .id = "unit/unsafe",
    });
    defer if (result.cgroup_path) |path| allocator.free(path);
    try std.testing.expectEqual(.linux_cgroup_v2, result.status);
    try std.testing.expect(result.cgroup_path != null);
    try std.testing.expect(std.mem.indexOf(u8, result.cgroup_path.?, "machinen-vm-unit-unsafe-") != null);

    const cpu_max_path = try joinCgroupFile(allocator, result.cgroup_path.?, "cpu.max");
    defer allocator.free(cpu_max_path);
    const cpu_max = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, allocator, cpu_max_path, 1024);
    defer allocator.free(cpu_max);
    try std.testing.expectEqualStrings("50000 100000\n", cpu_max);

    const weight_path = try joinCgroupFile(allocator, result.cgroup_path.?, "cpu.weight");
    defer allocator.free(weight_path);
    const weight = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, allocator, weight_path, 1024);
    defer allocator.free(weight);
    try std.testing.expectEqualStrings("250\n", weight);

    const procs_path = try joinCgroupFile(allocator, result.cgroup_path.?, "cgroup.procs");
    defer allocator.free(procs_path);
    const procs = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, allocator, procs_path, 1024);
    defer allocator.free(procs);
    try std.testing.expectEqualStrings("4321\n", procs);

    removeCpuCgroup(std.testing.io, result.cgroup_path.?);
    try std.testing.expect(!existsPath(std.testing.io, result.cgroup_path.?));
}

test "parseBootTimeSeconds reads Linux btime" {
    try std.testing.expectEqual(@as(?i64, 1_700_000_000), parseBootTimeSeconds("cpu 0 0 0\nbtime 1700000000\n"));
    try std.testing.expectEqual(@as(?i64, null), parseBootTimeSeconds("cpu 0 0 0\n"));
}

test "parseLinuxStartTimeMs reads field 22 after process name" {
    const stat = "1234 (name with spaces) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 250 21";
    try std.testing.expectEqual(@as(?i64, 1_700_000_002_500), parseLinuxStartTimeMs(stat, 1_700_000_000));
}

test "parsePsLstartLine reads lstart and command basename" {
    const parts = (try parsePsLstartLine(std.testing.allocator, "Sat 20 Jun 16:59:31 2026     /tmp/machinen-vm --flag\n")).?;
    defer std.testing.allocator.free(parts.lstart);
    defer std.testing.allocator.free(parts.command);
    try std.testing.expectEqualStrings("Sat 20 Jun 16:59:31 2026", parts.lstart);
    const identity = try identityFromPsParts(std.testing.allocator, parts.command, 1_700_000_058_000);
    defer identity.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings("machinen-vm", identity.exe_base);
    try std.testing.expectEqual(@as(?i64, 1_700_000_058_000), identity.started_at_ms);
}

test "validatePid returns alive for this process without expectations" {
    const pid: u32 = @intCast(std.c.getpid());
    try std.testing.expectEqual(.alive, try validatePid(std.testing.allocator, std.testing.io, pid, .{}));
}

test "validatePid returns dead for an invalid pid" {
    try std.testing.expectEqual(.dead, try validatePid(std.testing.allocator, std.testing.io, 0, .{}));
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
