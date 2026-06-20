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

pub const HostMemory = struct {
    free_bytes: u64,
    total_bytes: u64,
};

pub const NestedVirtObservation = struct {
    platform: []const u8,
    arch: []const u8,
    linux_dev_kvm: ?bool = null,
    linux_kvm_nested: ?[]const u8 = null,
    linux_kvm_arm_nested: ?[]const u8 = null,
    darwin_hv_support: ?[]const u8 = null,
    darwin_product_version: ?[]const u8 = null,
    darwin_cpu_brand: ?[]const u8 = null,
};

pub const NestedVirtResult = struct {
    supported: bool,
    reason: ?[]u8 = null,

    pub fn deinit(self: NestedVirtResult, allocator: std.mem.Allocator) void {
        if (self.reason) |reason| allocator.free(reason);
    }
};

pub const BalloonStats = struct {
    bytes_reported: u64,
    bytes_inflated: u64,
    host_phys_footprint_bytes: u64,
};

pub const CleanupPathResult = struct {
    removed: bool,
    failed: bool,
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
const NESTED_UNSUPPORTED_MESSAGE = "nested virtualization needs Linux/arm64 KVM with EL2 support, or macOS 15+ on M3/M4-class Apple Silicon";
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

pub fn readHostMemory(allocator: std.mem.Allocator, io: std.Io) Error!HostMemory {
    return switch (builtin.os.tag) {
        .linux => readHostMemoryLinux(allocator, io),
        .macos => readHostMemoryDarwin(allocator, io),
        else => error.UnsupportedHostMemory,
    };
}

pub fn probeNestedVirtualization(allocator: std.mem.Allocator, io: std.Io, observed: ?NestedVirtObservation) Error!NestedVirtResult {
    const observation = observed orelse try observeNestedVirtualizationHost(allocator, io);
    defer if (observed == null) deinitObservedNestedVirtualizationHost(allocator, observation);
    return evaluateNestedVirtualization(allocator, observation);
}

pub fn applyCpuCgroup(allocator: std.mem.Allocator, io: std.Io, opts: CpuCgroupOptions) Error!CpuCgroupResult {
    if (builtin.os.tag != .linux) {
        return .{ .status = .unsupported, .reason = "hard CPU quota uses Linux cgroup v2" };
    }
    return applyCpuCgroupLinux(allocator, io, opts);
}

pub fn readBalloonStats(io: std.Io, path: []const u8) ?BalloonStats {
    var file = std.Io.Dir.cwd().openFile(io, path, .{ .allow_directory = false }) catch return null;
    defer file.close(io);
    var buf: [24]u8 = undefined;
    const n = file.readStreaming(io, &.{buf[0..]}) catch return null;
    if (n < buf.len) return null;
    return .{
        .bytes_reported = std.mem.readInt(u64, buf[0..8], .little),
        .bytes_inflated = std.mem.readInt(u64, buf[8..16], .little),
        .host_phys_footprint_bytes = std.mem.readInt(u64, buf[16..24], .little),
    };
}

pub fn cleanupPath(io: std.Io, path: []const u8, dry_run: bool) CleanupPathResult {
    const st = std.Io.Dir.cwd().statFile(io, path, .{ .follow_symlinks = false }) catch return .{ .removed = false, .failed = false };
    if (dry_run) return .{ .removed = true, .failed = false };
    if (st.kind == .directory) {
        if (std.mem.startsWith(u8, path, DEFAULT_CGROUP_PARENT ++ "/")) {
            std.Io.Dir.cwd().deleteDir(io, path) catch return .{ .removed = false, .failed = true };
        } else {
            std.Io.Dir.cwd().deleteTree(io, path) catch return .{ .removed = false, .failed = true };
        }
    } else {
        std.Io.Dir.cwd().deleteFile(io, path) catch return .{ .removed = false, .failed = true };
    }
    return .{ .removed = true, .failed = false };
}

fn observeNestedVirtualizationHost(allocator: std.mem.Allocator, io: std.Io) Error!NestedVirtObservation {
    var observation: NestedVirtObservation = .{
        .platform = actualPlatform(),
        .arch = actualArch(),
    };
    if (builtin.os.tag == .linux) {
        observation.linux_dev_kvm = existsPath(io, "/dev/kvm");
        observation.linux_kvm_nested = try readOptionalTextFile(allocator, io, "/sys/module/kvm/parameters/nested");
        observation.linux_kvm_arm_nested = try readOptionalTextFile(allocator, io, "/sys/module/kvm_arm/parameters/nested");
    } else if (builtin.os.tag == .macos) {
        observation.darwin_hv_support = try runTextCommand(allocator, io, &.{ "/usr/sbin/sysctl", "-n", "kern.hv_support" });
        observation.darwin_product_version = try runTextCommand(allocator, io, &.{ "/usr/bin/sw_vers", "-productVersion" });
        observation.darwin_cpu_brand = try runTextCommand(allocator, io, &.{ "/usr/sbin/sysctl", "-n", "machdep.cpu.brand_string" });
    }
    return observation;
}

fn deinitObservedNestedVirtualizationHost(allocator: std.mem.Allocator, observation: NestedVirtObservation) void {
    if (observation.linux_kvm_nested) |value| allocator.free(value);
    if (observation.linux_kvm_arm_nested) |value| allocator.free(value);
    if (observation.darwin_hv_support) |value| allocator.free(value);
    if (observation.darwin_product_version) |value| allocator.free(value);
    if (observation.darwin_cpu_brand) |value| allocator.free(value);
}

fn evaluateNestedVirtualization(allocator: std.mem.Allocator, observation: NestedVirtObservation) Error!NestedVirtResult {
    if (!std.mem.eql(u8, observation.arch, "arm64")) {
        return nestedUnsupported(allocator, "this host is not arm64", .{});
    }
    if (std.mem.eql(u8, observation.platform, "linux")) {
        return evaluateLinuxNestedVirtualization(allocator, observation);
    }
    if (std.mem.eql(u8, observation.platform, "darwin")) {
        return evaluateDarwinNestedVirtualization(allocator, observation);
    }
    return nestedUnsupported(allocator, "this host platform is not supported", .{});
}

fn evaluateLinuxNestedVirtualization(allocator: std.mem.Allocator, observation: NestedVirtObservation) Error!NestedVirtResult {
    if (observation.linux_dev_kvm != true) {
        return nestedUnsupported(allocator, "/dev/kvm is not present", .{});
    }
    if (firstDisabledLinuxNestedToggle(observation)) |path| {
        return nestedUnsupported(allocator, "{s} is disabled", .{path});
    }
    return .{ .supported = true };
}

fn firstDisabledLinuxNestedToggle(observation: NestedVirtObservation) ?[]const u8 {
    if (observation.linux_kvm_nested) |value| {
        if (isDisabledKernelToggle(value)) return "/sys/module/kvm/parameters/nested";
    }
    if (observation.linux_kvm_arm_nested) |value| {
        if (isDisabledKernelToggle(value)) return "/sys/module/kvm_arm/parameters/nested";
    }
    return null;
}

fn isDisabledKernelToggle(value: []const u8) bool {
    const trimmed = std.mem.trim(u8, value, " \t\r\n");
    return std.ascii.eqlIgnoreCase(trimmed, "0") or
        std.ascii.eqlIgnoreCase(trimmed, "n") or
        std.ascii.eqlIgnoreCase(trimmed, "no") or
        std.ascii.eqlIgnoreCase(trimmed, "false") or
        std.ascii.eqlIgnoreCase(trimmed, "off");
}

fn evaluateDarwinNestedVirtualization(allocator: std.mem.Allocator, observation: NestedVirtObservation) Error!NestedVirtResult {
    const hv = std.mem.trim(u8, observation.darwin_hv_support orelse "", " \t\r\n");
    if (!std.mem.eql(u8, hv, "1")) {
        return nestedUnsupported(allocator, "Hypervisor.framework support is not available", .{});
    }
    if (darwinMajor(observation.darwin_product_version)) |major| {
        if (major < 15) return nestedUnsupported(allocator, "macOS {d} is older than macOS 15", .{major});
    }
    if (appleSiliconGeneration(observation.darwin_cpu_brand)) |generation| {
        if (generation < 3) return nestedUnsupported(allocator, "Apple M{d} does not expose nested EL2", .{generation});
    }
    return .{ .supported = true };
}

fn darwinMajor(version: ?[]const u8) ?u32 {
    const raw = std.mem.trim(u8, version orelse return null, " \t\r\n");
    var it = std.mem.splitScalar(u8, raw, '.');
    const first = it.next() orelse return null;
    if (first.len == 0) return null;
    for (first) |c| if (!std.ascii.isDigit(c)) return null;
    return std.fmt.parseUnsigned(u32, first, 10) catch null;
}

fn appleSiliconGeneration(brand: ?[]const u8) ?u32 {
    const raw = brand orelse return null;
    const apple = std.mem.indexOf(u8, raw, "Apple M") orelse return null;
    const start = apple + "Apple M".len;
    if (start >= raw.len or !std.ascii.isDigit(raw[start])) return null;
    var end = start;
    while (end < raw.len and std.ascii.isDigit(raw[end])) : (end += 1) {}
    return std.fmt.parseUnsigned(u32, raw[start..end], 10) catch null;
}

fn nestedUnsupported(allocator: std.mem.Allocator, comptime fmt: []const u8, args: anytype) Error!NestedVirtResult {
    const detail = try std.fmt.allocPrint(allocator, fmt, args);
    defer allocator.free(detail);
    return .{
        .supported = false,
        .reason = try std.fmt.allocPrint(allocator, "{s}; {s}", .{ NESTED_UNSUPPORTED_MESSAGE, detail }),
    };
}

fn actualPlatform() []const u8 {
    return switch (builtin.os.tag) {
        .linux => "linux",
        .macos => "darwin",
        else => @tagName(builtin.os.tag),
    };
}

fn actualArch() []const u8 {
    return switch (builtin.cpu.arch) {
        .aarch64 => "arm64",
        .x86_64 => "x64",
        else => @tagName(builtin.cpu.arch),
    };
}

fn readOptionalTextFile(allocator: std.mem.Allocator, io: std.Io, path: []const u8) Error!?[]u8 {
    return readFileAlloc(allocator, io, path) catch |err| switch (err) {
        error.FileNotFound => null,
        else => null,
    };
}

fn runTextCommand(allocator: std.mem.Allocator, io: std.Io, argv: []const []const u8) Error!?[]u8 {
    const result = std.process.run(allocator, io, .{
        .argv = argv,
        .stdout_limit = .limited(16 * 1024),
        .stderr_limit = .limited(16 * 1024),
    }) catch return null;
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |code| if (code != 0) {
            allocator.free(result.stdout);
            return null;
        },
        else => {
            allocator.free(result.stdout);
            return null;
        },
    }
    return result.stdout;
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

fn readHostMemoryLinux(allocator: std.mem.Allocator, io: std.Io) Error!HostMemory {
    const data = try readFileAlloc(allocator, io, "/proc/meminfo");
    defer allocator.free(data);
    const total = parseMeminfoKb(data, "MemTotal") orelse return error.InvalidHostMemory;
    const free = parseMeminfoKb(data, "MemAvailable") orelse parseMeminfoKb(data, "MemFree") orelse return error.InvalidHostMemory;
    return .{ .free_bytes = free * 1024, .total_bytes = total * 1024 };
}

fn readHostMemoryDarwin(allocator: std.mem.Allocator, io: std.Io) Error!HostMemory {
    const total = try readDarwinTotalMemory(allocator, io);
    const vm_stat = std.process.run(allocator, io, .{
        .argv = &.{"/usr/bin/vm_stat"},
        .stdout_limit = .limited(64 * 1024),
        .stderr_limit = .limited(16 * 1024),
    }) catch return error.InvalidHostMemory;
    defer allocator.free(vm_stat.stdout);
    defer allocator.free(vm_stat.stderr);
    switch (vm_stat.term) {
        .exited => |code| if (code != 0) return error.InvalidHostMemory,
        else => return error.InvalidHostMemory,
    }
    const free = parseVmStatAvailableBytes(vm_stat.stdout) orelse return error.InvalidHostMemory;
    return .{ .free_bytes = free, .total_bytes = total };
}

fn readDarwinTotalMemory(allocator: std.mem.Allocator, io: std.Io) Error!u64 {
    const result = std.process.run(allocator, io, .{
        .argv = &.{ "/usr/sbin/sysctl", "-n", "hw.memsize" },
        .stdout_limit = .limited(16 * 1024),
        .stderr_limit = .limited(16 * 1024),
    }) catch return error.InvalidHostMemory;
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |code| if (code != 0) return error.InvalidHostMemory,
        else => return error.InvalidHostMemory,
    }
    const trimmed = std.mem.trim(u8, result.stdout, " \t\r\n");
    return std.fmt.parseUnsigned(u64, trimmed, 10) catch error.InvalidHostMemory;
}

pub fn parseMeminfoKb(meminfo: []const u8, field: []const u8) ?u64 {
    var lines = std.mem.splitScalar(u8, meminfo, '\n');
    while (lines.next()) |line| {
        if (!std.mem.startsWith(u8, line, field) or line.len <= field.len or line[field.len] != ':') continue;
        var it = std.mem.tokenizeAny(u8, line[field.len + 1 ..], " \t");
        const number_text = it.next() orelse return null;
        const unit_text = it.next() orelse return null;
        if (!std.mem.eql(u8, unit_text, "kB")) return null;
        return std.fmt.parseUnsigned(u64, number_text, 10) catch null;
    }
    return null;
}

pub fn parseVmStatAvailableBytes(vm_stat: []const u8) ?u64 {
    const page_size = parseVmStatPageSize(vm_stat) orelse 4096;
    const free = parseVmStatPages(vm_stat, "Pages free") orelse 0;
    const speculative = parseVmStatPages(vm_stat, "Pages speculative") orelse 0;
    const purgeable = parseVmStatPages(vm_stat, "Pages purgeable") orelse 0;
    return (free + speculative + purgeable) * page_size;
}

fn parseVmStatPageSize(vm_stat: []const u8) ?u64 {
    const marker = "page size of ";
    const start = std.mem.indexOf(u8, vm_stat, marker) orelse return null;
    const after = vm_stat[start + marker.len ..];
    var it = std.mem.tokenizeAny(u8, after, " \t\r\n");
    const raw = it.next() orelse return null;
    return std.fmt.parseUnsigned(u64, raw, 10) catch null;
}

fn parseVmStatPages(vm_stat: []const u8, label: []const u8) ?u64 {
    var lines = std.mem.splitScalar(u8, vm_stat, '\n');
    while (lines.next()) |line| {
        const trimmed = std.mem.trim(u8, line, " \t\r");
        if (!std.mem.startsWith(u8, trimmed, label) or trimmed.len <= label.len or trimmed[label.len] != ':') continue;
        const rest = std.mem.trim(u8, trimmed[label.len + 1 ..], " \t.");
        return std.fmt.parseUnsigned(u64, rest, 10) catch null;
    }
    return null;
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

test "evaluateNestedVirtualization accepts Linux arm64 KVM when toggles are enabled" {
    const result = try evaluateNestedVirtualization(std.testing.allocator, .{
        .platform = "linux",
        .arch = "arm64",
        .linux_dev_kvm = true,
        .linux_kvm_nested = "Y\n",
    });
    defer result.deinit(std.testing.allocator);
    try std.testing.expect(result.supported);
    try std.testing.expect(result.reason == null);
}

test "evaluateNestedVirtualization rejects disabled Linux nested toggles" {
    const result = try evaluateNestedVirtualization(std.testing.allocator, .{
        .platform = "linux",
        .arch = "arm64",
        .linux_dev_kvm = true,
        .linux_kvm_nested = "N\n",
    });
    defer result.deinit(std.testing.allocator);
    try std.testing.expect(!result.supported);
    try std.testing.expect(result.reason != null);
    try std.testing.expect(std.mem.indexOf(u8, result.reason.?, "/sys/module/kvm/parameters/nested") != null);
}

test "evaluateNestedVirtualization rejects macOS M1 and M2" {
    const result = try evaluateNestedVirtualization(std.testing.allocator, .{
        .platform = "darwin",
        .arch = "arm64",
        .darwin_hv_support = "1\n",
        .darwin_product_version = "15.0\n",
        .darwin_cpu_brand = "Apple M2 Max\n",
    });
    defer result.deinit(std.testing.allocator);
    try std.testing.expect(!result.supported);
    try std.testing.expect(result.reason != null);
    try std.testing.expect(std.mem.indexOf(u8, result.reason.?, "Apple M2") != null);
}

test "evaluateNestedVirtualization rejects non-arm64 hosts explicitly" {
    const result = try evaluateNestedVirtualization(std.testing.allocator, .{
        .platform = "linux",
        .arch = "x64",
        .linux_dev_kvm = true,
    });
    defer result.deinit(std.testing.allocator);
    try std.testing.expect(!result.supported);
    try std.testing.expect(result.reason != null);
    try std.testing.expect(std.mem.indexOf(u8, result.reason.?, "not arm64") != null);
}

fn tmpRootAbs(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

test "readBalloonStats decodes 24-byte little-endian counters" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    var buf: [24]u8 = undefined;
    std.mem.writeInt(u64, buf[0..8], 0x1122_3344_5566_7788, .little);
    std.mem.writeInt(u64, buf[8..16], 0x99aa_bbcc_ddee_ff00, .little);
    std.mem.writeInt(u64, buf[16..24], 0x0011_2233_4455_6677, .little);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "stats.bin", .data = &buf });
    const root = try tmpRootAbs(std.testing.allocator, &tmp);
    defer std.testing.allocator.free(root);
    const path = try std.fs.path.join(std.testing.allocator, &.{ root, "stats.bin" });
    defer std.testing.allocator.free(path);

    const stats = readBalloonStats(std.testing.io, path).?;
    try std.testing.expectEqual(@as(u64, 0x1122_3344_5566_7788), stats.bytes_reported);
    try std.testing.expectEqual(@as(u64, 0x99aa_bbcc_ddee_ff00), stats.bytes_inflated);
    try std.testing.expectEqual(@as(u64, 0x0011_2233_4455_6677), stats.host_phys_footprint_bytes);
}

test "readBalloonStats returns null for missing or short files" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "short.bin", .data = "too short" });
    const root = try tmpRootAbs(std.testing.allocator, &tmp);
    defer std.testing.allocator.free(root);
    const short_path = try std.fs.path.join(std.testing.allocator, &.{ root, "short.bin" });
    defer std.testing.allocator.free(short_path);
    const missing_path = try std.fs.path.join(std.testing.allocator, &.{ root, "missing.bin" });
    defer std.testing.allocator.free(missing_path);

    try std.testing.expect(readBalloonStats(std.testing.io, short_path) == null);
    try std.testing.expect(readBalloonStats(std.testing.io, missing_path) == null);
}

test "cleanupPath removes files and directories" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "file.txt", .data = "x" });
    try tmp.dir.createDir(std.testing.io, "dir", .default_dir);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "dir/nested.txt", .data = "y" });
    const root = try tmpRootAbs(std.testing.allocator, &tmp);
    defer std.testing.allocator.free(root);
    const file_path = try std.fs.path.join(std.testing.allocator, &.{ root, "file.txt" });
    defer std.testing.allocator.free(file_path);
    const dir_path = try std.fs.path.join(std.testing.allocator, &.{ root, "dir" });
    defer std.testing.allocator.free(dir_path);

    try std.testing.expectEqual(CleanupPathResult{ .removed = true, .failed = false }, cleanupPath(std.testing.io, file_path, false));
    try std.testing.expectEqual(CleanupPathResult{ .removed = true, .failed = false }, cleanupPath(std.testing.io, dir_path, false));
    try std.testing.expect(!existsPath(std.testing.io, file_path));
    try std.testing.expect(!existsPath(std.testing.io, dir_path));
}

test "cleanupPath dry-run and missing paths do not touch disk" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "file.txt", .data = "x" });
    const root = try tmpRootAbs(std.testing.allocator, &tmp);
    defer std.testing.allocator.free(root);
    const file_path = try std.fs.path.join(std.testing.allocator, &.{ root, "file.txt" });
    defer std.testing.allocator.free(file_path);
    const missing_path = try std.fs.path.join(std.testing.allocator, &.{ root, "missing.txt" });
    defer std.testing.allocator.free(missing_path);

    try std.testing.expectEqual(CleanupPathResult{ .removed = true, .failed = false }, cleanupPath(std.testing.io, file_path, true));
    try std.testing.expect(existsPath(std.testing.io, file_path));
    try std.testing.expectEqual(CleanupPathResult{ .removed = false, .failed = false }, cleanupPath(std.testing.io, missing_path, false));
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

test "parseMeminfoKb reads Linux memory fields" {
    const meminfo = "MemTotal:       8388608 kB\nMemFree:        1000000 kB\nMemAvailable:   2000000 kB\n";
    try std.testing.expectEqual(@as(?u64, 8_388_608), parseMeminfoKb(meminfo, "MemTotal"));
    try std.testing.expectEqual(@as(?u64, 2_000_000), parseMeminfoKb(meminfo, "MemAvailable"));
    try std.testing.expectEqual(@as(?u64, null), parseMeminfoKb(meminfo, "SwapTotal"));
}

test "parseVmStatAvailableBytes sums Darwin free speculative purgeable pages" {
    const vm_stat =
        \\Mach Virtual Memory Statistics: (page size of 16384 bytes)
        \\Pages free:                               10.
        \\Pages active:                             99.
        \\Pages speculative:                         5.
        \\Pages purgeable:                           2.
    ;
    try std.testing.expectEqual(@as(?u64, 17 * 16_384), parseVmStatAvailableBytes(vm_stat));
}

test "readHostMemory returns positive values on supported platforms" {
    if (builtin.os.tag != .linux and builtin.os.tag != .macos) return;
    const memory = try readHostMemory(std.testing.allocator, std.testing.io);
    try std.testing.expect(memory.free_bytes > 0);
    try std.testing.expect(memory.total_bytes >= memory.free_bytes);
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
