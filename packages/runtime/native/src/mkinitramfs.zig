const std = @import("std");

pub const Error = error{
    PathNotFound,
    PathNotDirectory,
    InitMissing,
    WorkspaceTooLarge,
} || std.mem.Allocator.Error || std.Io.Dir.OpenError || std.Io.Dir.Iterator.Error || std.Io.Dir.StatFileError || std.Io.Dir.ReadLinkError || std.Io.File.OpenError || std.Io.File.ReadStreamingError || std.Io.Writer.Error;

pub const Result = struct {
    bytes: usize,
    workspace_bytes: usize = 0,
};

pub const FinalOptions = struct {
    init_path: ?[]const u8 = null,
    config: ?[]const u8 = null,
    inject_init: bool = true,
    allow_missing_init: bool = false,
    exec_agent_path: ?[]const u8 = null,
    mount_guest: ?[]const u8 = null,
};

pub const RootfsOptions = struct {
    rootfs: []const u8,
    out: []const u8,
    excludes: []const []const u8 = &.{},
    final: FinalOptions,
};

pub const TinyOptions = struct {
    out: []const u8,
    final: FinalOptions,
};

pub const WorkspaceOptions = struct {
    workspace: []const u8,
    out: []const u8,
    mountpoint: []const u8 = "workspace",
    excludes: []const []const u8 = &.{},
    max_mb: usize = 500,
};

pub const MinimalOptions = struct {
    out: []const u8,
    final: FinalOptions,
};

const Counts = struct {
    files: usize = 0,
    bytes: usize = 0,
};

pub fn packRootfs(allocator: std.mem.Allocator, io: std.Io, opts: RootfsOptions) Error!Result {
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(allocator);
    var counts: Counts = .{};
    try appendRootfsEntries(allocator, io, &out, opts.rootfs, opts.excludes, &counts);
    try appendFinalEntries(allocator, io, &out, opts.final);
    try writeOutput(io, opts.out, out.items);
    return .{ .bytes = out.items.len };
}

pub fn packTiny(allocator: std.mem.Allocator, io: std.Io, opts: TinyOptions) Error!Result {
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(allocator);
    try appendNewc(allocator, &out, ".", 0o40755, .{});
    try appendFinalEntries(allocator, io, &out, opts.final);
    try writeOutput(io, opts.out, out.items);
    return .{ .bytes = out.items.len };
}

pub fn packWorkspace(allocator: std.mem.Allocator, io: std.Io, opts: WorkspaceOptions) Error!Result {
    const st = std.Io.Dir.cwd().statFile(io, opts.workspace, .{ .follow_symlinks = false }) catch |err| switch (err) {
        error.FileNotFound => return error.PathNotFound,
        else => |e| return e,
    };
    if (st.kind != .directory) return error.PathNotDirectory;

    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(allocator);
    var counts: Counts = .{};
    try appendNewc(allocator, &out, opts.mountpoint, 0o40755, .{});
    try walkWorkspace(allocator, io, &out, opts.workspace, "", opts.mountpoint, opts.excludes, &counts);
    if (out.items.len > opts.max_mb * 1024 * 1024) return error.WorkspaceTooLarge;
    try appendNewc(allocator, &out, "TRAILER!!!", 0, .{});
    try writeOutput(io, opts.out, out.items);
    return .{ .bytes = out.items.len, .workspace_bytes = counts.bytes };
}

pub fn packMinimal(allocator: std.mem.Allocator, io: std.Io, opts: MinimalOptions) Error!Result {
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(allocator);
    try appendNewc(allocator, &out, ".", 0o40755, .{});
    try appendNewc(allocator, &out, "dev", 0o40755, .{});
    if (opts.final.init_path) |init_path| {
        const init = readFileAlloc(allocator, io, init_path) catch |err| switch (err) {
            error.FileNotFound => if (opts.final.allow_missing_init) null else return error.InitMissing,
            else => |e| return e,
        };
        if (init) |bytes| {
            defer allocator.free(bytes);
            try appendNewc(allocator, &out, "init", 0o100755, .{ .data = bytes });
        }
    }
    try appendFinalEntries(allocator, io, &out, opts.final);
    try writeOutput(io, opts.out, out.items);
    return .{ .bytes = out.items.len };
}

fn appendRootfsEntries(
    allocator: std.mem.Allocator,
    io: std.Io,
    out: *std.ArrayList(u8),
    root: []const u8,
    excludes: []const []const u8,
    counts: *Counts,
) Error!void {
    const st = std.Io.Dir.cwd().statFile(io, root, .{ .follow_symlinks = false }) catch |err| switch (err) {
        error.FileNotFound => return error.PathNotFound,
        else => |e| return e,
    };
    if (st.kind != .directory) return error.PathNotDirectory;
    try appendNewc(allocator, out, ".", 0o40755, .{});
    try walkRootfs(allocator, io, out, root, "", excludes, counts);
}

fn walkRootfs(
    allocator: std.mem.Allocator,
    io: std.Io,
    out: *std.ArrayList(u8),
    root: []const u8,
    rel: []const u8,
    excludes: []const []const u8,
    counts: *Counts,
) Error!void {
    const full = if (rel.len == 0) try allocator.dupe(u8, root) else try std.fs.path.join(allocator, &.{ root, rel });
    defer allocator.free(full);

    var dir = std.Io.Dir.cwd().openDir(io, full, .{ .iterate = true }) catch |err| switch (err) {
        error.FileNotFound => return,
        else => |e| return e,
    };
    defer dir.close(io);

    var names: std.ArrayList([]u8) = .empty;
    defer {
        for (names.items) |name| allocator.free(name);
        names.deinit(allocator);
    }
    var it = dir.iterateAssumeFirstIteration();
    while (try it.next(io)) |entry| {
        try names.append(allocator, try allocator.dupe(u8, entry.name));
    }
    std.mem.sort([]u8, names.items, {}, stringLessThan);

    for (names.items) |name| {
        const child_rel = if (rel.len == 0) try allocator.dupe(u8, name) else try std.fmt.allocPrint(allocator, "{s}/{s}", .{ rel, name });
        defer allocator.free(child_rel);
        const child_full = try std.fs.path.join(allocator, &.{ full, name });
        defer allocator.free(child_full);
        if (isExcluded(child_rel, excludes)) {
            countExcludedFile(io, child_full, counts);
            continue;
        }
        const st = std.Io.Dir.cwd().statFile(io, child_full, .{ .follow_symlinks = false }) catch |err| switch (err) {
            error.FileNotFound => continue,
            else => |e| return e,
        };
        try appendRootfsEntry(allocator, io, out, root, child_rel, child_full, st, excludes, counts);
    }
}

fn appendRootfsEntry(
    allocator: std.mem.Allocator,
    io: std.Io,
    out: *std.ArrayList(u8),
    root: []const u8,
    child_rel: []const u8,
    child_full: []const u8,
    st: std.Io.File.Stat,
    excludes: []const []const u8,
    counts: *Counts,
) Error!void {
    const mode = modeBits(st);
    switch (st.kind) {
        .sym_link => {
            var buf: [std.Io.Dir.max_path_bytes]u8 = undefined;
            const n = try std.Io.Dir.cwd().readLink(io, child_full, &buf);
            try appendNewc(allocator, out, child_rel, 0o120000 | mode, .{ .data = buf[0..n] });
        },
        .directory => {
            try appendNewc(allocator, out, child_rel, 0o40000 | mode, .{});
            try walkRootfs(allocator, io, out, root, child_rel, excludes, counts);
        },
        .file => {
            const data = try readFileAlloc(allocator, io, child_full);
            defer allocator.free(data);
            try appendNewc(allocator, out, child_rel, 0o100000 | mode, .{ .data = data });
        },
        else => {},
    }
}

fn walkWorkspace(
    allocator: std.mem.Allocator,
    io: std.Io,
    out: *std.ArrayList(u8),
    root: []const u8,
    rel: []const u8,
    mountpoint: []const u8,
    excludes: []const []const u8,
    counts: *Counts,
) Error!void {
    const full = if (rel.len == 0) try allocator.dupe(u8, root) else try std.fs.path.join(allocator, &.{ root, rel });
    defer allocator.free(full);

    var dir = std.Io.Dir.cwd().openDir(io, full, .{ .iterate = true }) catch |err| switch (err) {
        error.FileNotFound => return,
        else => |e| return e,
    };
    defer dir.close(io);

    var names: std.ArrayList([]u8) = .empty;
    defer {
        for (names.items) |name| allocator.free(name);
        names.deinit(allocator);
    }
    var it = dir.iterateAssumeFirstIteration();
    while (try it.next(io)) |entry| {
        try names.append(allocator, try allocator.dupe(u8, entry.name));
    }
    std.mem.sort([]u8, names.items, {}, stringLessThan);

    for (names.items) |name| {
        if (hasExactExclude(name, excludes)) continue;
        const child_rel = if (rel.len == 0) try allocator.dupe(u8, name) else try std.fmt.allocPrint(allocator, "{s}/{s}", .{ rel, name });
        defer allocator.free(child_rel);
        const child_full = try std.fs.path.join(allocator, &.{ full, name });
        defer allocator.free(child_full);
        const st = std.Io.Dir.cwd().statFile(io, child_full, .{ .follow_symlinks = false }) catch |err| switch (err) {
            error.FileNotFound => continue,
            else => |e| return e,
        };
        try appendWorkspaceEntry(allocator, io, out, root, child_rel, child_full, mountpoint, st, excludes, counts);
    }
}

fn appendWorkspaceEntry(
    allocator: std.mem.Allocator,
    io: std.Io,
    out: *std.ArrayList(u8),
    root: []const u8,
    child_rel: []const u8,
    child_full: []const u8,
    mountpoint: []const u8,
    st: std.Io.File.Stat,
    excludes: []const []const u8,
    counts: *Counts,
) Error!void {
    _ = root;
    const arc_name = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ mountpoint, child_rel });
    defer allocator.free(arc_name);
    const mode = modeBits(st);
    switch (st.kind) {
        .sym_link => {
            var buf: [std.Io.Dir.max_path_bytes]u8 = undefined;
            const n = try std.Io.Dir.cwd().readLink(io, child_full, &buf);
            try appendNewc(allocator, out, arc_name, 0o120000 | mode, .{ .data = buf[0..n] });
        },
        .directory => {
            try appendNewc(allocator, out, arc_name, 0o40000 | mode, .{});
            try walkWorkspace(allocator, io, out, child_full, "", arc_name, excludes, counts);
        },
        .file => {
            const data = try readFileAlloc(allocator, io, child_full);
            defer allocator.free(data);
            counts.bytes += data.len;
            try appendNewc(allocator, out, arc_name, 0o100000 | mode, .{ .data = data });
        },
        else => {},
    }
}

fn appendFinalEntries(allocator: std.mem.Allocator, io: std.Io, out: *std.ArrayList(u8), opts: FinalOptions) Error!void {
    if (opts.inject_init) {
        if (opts.init_path) |init_path| {
            const init = readFileAlloc(allocator, io, init_path) catch |err| switch (err) {
                error.FileNotFound => if (opts.allow_missing_init) null else return error.InitMissing,
                else => |e| return e,
            };
            if (init) |bytes| {
                defer allocator.free(bytes);
                try appendNewc(allocator, out, "init", 0o100755, .{ .data = bytes });
            }
        }
    }
    if (opts.exec_agent_path) |exec_agent_path| {
        const bytes = readFileAlloc(allocator, io, exec_agent_path) catch null;
        if (bytes) |data| {
            defer allocator.free(data);
            try appendNewc(allocator, out, "exec-agent", 0o100755, .{ .data = data });
        }
    }
    if (opts.config) |config| {
        try appendNewc(allocator, out, "machinen-config.json", 0o100644, .{ .data = config });
    }
    try appendBootEpoch(allocator, io, out);
    if (opts.mount_guest) |mount_guest| {
        const data = try std.fmt.allocPrint(allocator, "{s}\n", .{mount_guest});
        defer allocator.free(data);
        try appendNewc(allocator, out, "etc/machinen-mountdisk-guest", 0o100644, .{ .data = data });
    }
    try appendNewc(allocator, out, "dev", 0o40755, .{});
    try appendNewc(allocator, out, "dev/console", 0o20600, .{ .rmajor = 5, .rminor = 1 });
    try appendNewc(allocator, out, "tmp", 0o41777, .{});
    try appendNewc(allocator, out, "TRAILER!!!", 0, .{});
}

fn appendBootEpoch(allocator: std.mem.Allocator, io: std.Io, out: *std.ArrayList(u8)) Error!void {
    const now = @divFloor(std.Io.Clock.real.now(io).nanoseconds, std.time.ns_per_s);
    const data = try std.fmt.allocPrint(allocator, "{d}", .{now});
    defer allocator.free(data);
    try appendNewc(allocator, out, "etc", 0o40755, .{});
    try appendNewc(allocator, out, "etc/machinen-boot-epoch", 0o100644, .{ .data = data });
}

const NewcOptions = struct {
    uid: u32 = 0,
    gid: u32 = 0,
    nlink: u32 = 1,
    mtime: u32 = 0,
    rmajor: u32 = 0,
    rminor: u32 = 0,
    data: []const u8 = "",
};

fn appendNewc(allocator: std.mem.Allocator, out: *std.ArrayList(u8), name: []const u8, mode: u64, opts: NewcOptions) Error!void {
    var header: [110]u8 = undefined;
    const name_size = name.len + 1;
    const header_text = try std.fmt.bufPrint(
        &header,
        "070701{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}",
        .{ 0, mode, opts.uid, opts.gid, opts.nlink, opts.mtime, opts.data.len, 0, 0, opts.rmajor, opts.rminor, name_size, 0 },
    );
    try out.appendSlice(allocator, header_text);
    try out.appendSlice(allocator, name);
    try out.append(allocator, 0);
    try appendPadding(allocator, out, header_text.len + name_size);
    try out.appendSlice(allocator, opts.data);
    try appendPadding(allocator, out, opts.data.len);
}

fn appendPadding(allocator: std.mem.Allocator, out: *std.ArrayList(u8), len: usize) Error!void {
    const padding = (4 - (len % 4)) % 4;
    try out.appendNTimes(allocator, 0, padding);
}

fn readFileAlloc(allocator: std.mem.Allocator, io: std.Io, path: []const u8) Error![]u8 {
    var file = try std.Io.Dir.cwd().openFile(io, path, .{ .allow_directory = false });
    defer file.close(io);
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    var buf: [64 * 1024]u8 = undefined;
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

fn writeOutput(io: std.Io, path: []const u8, bytes: []const u8) Error!void {
    var file = try std.Io.Dir.cwd().createFile(io, path, .{ .truncate = true });
    defer file.close(io);
    file.writeStreamingAll(io, bytes) catch return error.WriteFailed;
}

fn countExcludedFile(io: std.Io, path: []const u8, counts: *Counts) void {
    const st = std.Io.Dir.cwd().statFile(io, path, .{ .follow_symlinks = false }) catch return;
    if (st.kind == .file) {
        counts.files += 1;
        counts.bytes += @intCast(st.size);
    }
}

fn modeBits(st: std.Io.File.Stat) u64 {
    return @as(u64, @intCast(st.permissions.toMode() & 0o7777));
}

fn stringLessThan(_: void, a: []const u8, b: []const u8) bool {
    return std.mem.lessThan(u8, a, b);
}

fn hasExactExclude(name: []const u8, excludes: []const []const u8) bool {
    for (excludes) |exclude| {
        if (std.mem.eql(u8, name, exclude)) return true;
    }
    return false;
}

fn isExcluded(path: []const u8, excludes: []const []const u8) bool {
    for (excludes) |pattern| {
        if (fnmatch(path, pattern)) return true;
    }
    return false;
}

fn fnmatch(name: []const u8, pattern: []const u8) bool {
    return fnmatchAt(name, 0, pattern, 0);
}

fn fnmatchAt(name: []const u8, ni: usize, pattern: []const u8, pi: usize) bool {
    if (pi == pattern.len) return ni == name.len;
    if (pattern[pi] == '*') {
        var i = ni;
        while (true) : (i += 1) {
            if (fnmatchAt(name, i, pattern, pi + 1)) return true;
            if (i == name.len) break;
        }
        return false;
    }
    if (ni == name.len) return false;
    if (pattern[pi] == '?') return fnmatchAt(name, ni + 1, pattern, pi + 1);
    if (pattern[pi] == '[') {
        const class_end = classEnd(pattern, pi) orelse return name[ni] == '[' and fnmatchAt(name, ni + 1, pattern, pi + 1);
        if (!classMatches(name[ni], pattern[pi + 1 .. class_end])) return false;
        return fnmatchAt(name, ni + 1, pattern, class_end + 1);
    }
    return name[ni] == pattern[pi] and fnmatchAt(name, ni + 1, pattern, pi + 1);
}

fn classEnd(pattern: []const u8, start: usize) ?usize {
    var i = start + 1;
    if (i < pattern.len and pattern[i] == '!') i += 1;
    if (i < pattern.len and pattern[i] == ']') i += 1;
    while (i < pattern.len) : (i += 1) {
        if (pattern[i] == ']') return i;
    }
    return null;
}

fn classMatches(c: u8, body: []const u8) bool {
    var negated = false;
    var start: usize = 0;
    if (body.len > 0 and body[0] == '!') {
        negated = true;
        start = 1;
    }
    var matched = false;
    for (body[start..]) |candidate| {
        if (candidate == c) matched = true;
    }
    return if (negated) !matched else matched;
}

fn tmpRootAbs(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

fn parseCpioHasEntry(buf: []const u8, wanted: []const u8) bool {
    var offset: usize = 0;
    while (offset + 110 <= buf.len) {
        if (!std.mem.eql(u8, buf[offset .. offset + 6], "070701")) return false;
        const filesize = std.fmt.parseInt(usize, buf[offset + 54 .. offset + 62], 16) catch return false;
        const namesize = std.fmt.parseInt(usize, buf[offset + 94 .. offset + 102], 16) catch return false;
        const name_start = offset + 110;
        const name = buf[name_start .. name_start + namesize - 1];
        var cursor = name_start + namesize;
        while ((cursor - offset) % 4 != 0) cursor += 1;
        cursor += filesize;
        while ((cursor - offset) % 4 != 0) cursor += 1;
        offset = cursor;
        if (std.mem.eql(u8, name, "TRAILER!!!")) return false;
        if (std.mem.eql(u8, name, wanted)) return true;
    }
    return false;
}

test "packTiny writes expected cpio entries" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "init", .data = "stub" });

    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const init_path = try std.fs.path.join(allocator, &.{ root, "init" });
    defer allocator.free(init_path);
    const out_path = try std.fs.path.join(allocator, &.{ root, "out.cpio" });
    defer allocator.free(out_path);

    _ = try packTiny(allocator, std.testing.io, .{ .out = out_path, .final = .{ .init_path = init_path, .config = "{}", .mount_guest = "/mnt/app" } });
    const data = try readFileAlloc(allocator, std.testing.io, out_path);
    defer allocator.free(data);
    try std.testing.expect(parseCpioHasEntry(data, "init"));
    try std.testing.expect(parseCpioHasEntry(data, "machinen-config.json"));
    try std.testing.expect(parseCpioHasEntry(data, "etc/machinen-mountdisk-guest"));
    try std.testing.expect(parseCpioHasEntry(data, "dev/console"));
}

test "packWorkspace excludes basename entries" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.createDir(std.testing.io, "ws", .default_dir);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "ws/keep.txt", .data = "keep" });
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "ws/skip.txt", .data = "skip" });

    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const ws_path = try std.fs.path.join(allocator, &.{ root, "ws" });
    defer allocator.free(ws_path);
    const out_path = try std.fs.path.join(allocator, &.{ root, "workspace.cpio" });
    defer allocator.free(out_path);
    const excludes = [_][]const u8{"skip.txt"};

    _ = try packWorkspace(allocator, std.testing.io, .{ .workspace = ws_path, .out = out_path, .excludes = &excludes });
    const data = try readFileAlloc(allocator, std.testing.io, out_path);
    defer allocator.free(data);
    try std.testing.expect(parseCpioHasEntry(data, "workspace/keep.txt"));
    try std.testing.expect(!parseCpioHasEntry(data, "workspace/skip.txt"));
}
