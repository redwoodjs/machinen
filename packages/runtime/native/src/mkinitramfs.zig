// Mkinitramfs means "make initramfs".
//
// An initramfs is the small archive Linux loads into memory at boot. It becomes
// the first temporary root filesystem and usually contains:
//
// - `/init`: the first userspace program the kernel runs.
// - `machinen-config.json`: the boot command/env/cwd config.
// - basic device nodes like `/dev/console`.
// - small marker files consumed by Machinen's init.
//
// In Machinen, this archive is intentionally tiny. Larger payloads, like the
// root filesystem or `--mount` contents, ride on block devices instead of being
// stuffed into the initramfs. The guest runs `/init` from this archive, then
// `/init` mounts/pivots into the real root disk.

const std = @import("std");

const assert = std.debug.assert;
const ByteList = std.array_list.Aligned(u8, null);
const NameList = std.array_list.Aligned([]u8, null);
const Index = @TypeOf(@as([]const u8, &.{}).len);
const Count = Index;

pub const Error = error{
    PathNotFound,
    PathNotDirectory,
    InitMissing,
    WorkspaceTooLarge,
} || std.mem.Allocator.Error ||
    std.Io.Dir.OpenError ||
    std.Io.Dir.Iterator.Error ||
    std.Io.Dir.StatFileError ||
    std.Io.Dir.ReadLinkError ||
    std.Io.File.OpenError ||
    std.Io.File.ReadStreamingError ||
    std.Io.Writer.Error;

pub const Result = struct {
    bytes: Count,
    workspace_bytes: Count = 0,
};

pub const FinalOptions = struct {
    init_path: ?[]const u8 = null,
    config: ?[]const u8 = null,
    config_path: ?[]const u8 = null,
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
    max_mb: Count = 500,
};

pub const MinimalOptions = struct {
    out: []const u8,
    final: FinalOptions,
};

const Counts = struct {
    files: Count = 0,
    bytes: Count = 0,
};

pub fn packRootfs(allocator: std.mem.Allocator, io: std.Io, opts: RootfsOptions) Error!Result {
    assert(opts.rootfs.len > 0);
    assert(opts.out.len > 0);

    var out: ByteList = .empty;
    defer out.deinit(allocator);
    var counts: Counts = .{};
    try appendRootfsEntries(allocator, io, &out, opts.rootfs, opts.excludes, &counts);
    try appendFinalEntries(allocator, io, &out, opts.final);
    try writeOutput(io, opts.out, out.items);
    return .{ .bytes = out.items.len };
}

pub fn packTiny(allocator: std.mem.Allocator, io: std.Io, opts: TinyOptions) Error!Result {
    assert(opts.out.len > 0);

    var out: ByteList = .empty;
    defer out.deinit(allocator);
    try appendNewc(allocator, &out, ".", 0o40755, .{});
    try appendFinalEntries(allocator, io, &out, opts.final);
    try writeOutput(io, opts.out, out.items);
    return .{ .bytes = out.items.len };
}

pub fn packWorkspace(
    allocator: std.mem.Allocator,
    io: std.Io,
    opts: WorkspaceOptions,
) Error!Result {
    assert(opts.workspace.len > 0);
    assert(opts.out.len > 0);
    assert(opts.mountpoint.len > 0);

    const st = std.Io.Dir.cwd().statFile(
        io,
        opts.workspace,
        .{ .follow_symlinks = true },
    ) catch |err| switch (err) {
        error.FileNotFound => return error.PathNotFound,
        else => |e| return e,
    };
    if (st.kind != .directory) return error.PathNotDirectory;

    var out: ByteList = .empty;
    defer out.deinit(allocator);
    var counts: Counts = .{};
    try appendNewc(allocator, &out, opts.mountpoint, 0o40755, .{});
    try walkWorkspace(
        allocator,
        io,
        &out,
        opts.workspace,
        "",
        opts.mountpoint,
        opts.excludes,
        &counts,
    );
    if (out.items.len > opts.max_mb * 1024 * 1024) return error.WorkspaceTooLarge;
    try appendNewc(allocator, &out, "TRAILER!!!", 0, .{});
    try writeOutput(io, opts.out, out.items);
    return .{ .bytes = out.items.len, .workspace_bytes = counts.bytes };
}

pub fn packMinimal(allocator: std.mem.Allocator, io: std.Io, opts: MinimalOptions) Error!Result {
    assert(opts.out.len > 0);

    var out: ByteList = .empty;
    defer out.deinit(allocator);
    try appendNewc(allocator, &out, ".", 0o40755, .{});
    try appendNewc(allocator, &out, "dev", 0o40755, .{});
    if (opts.final.init_path) |init_path| {
        const init = readFileAlloc(allocator, io, init_path) catch |err| switch (err) {
            error.FileNotFound => if (opts.final.allow_missing_init)
                null
            else
                return error.InitMissing,
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
    out: *ByteList,
    root: []const u8,
    excludes: []const []const u8,
    counts: *Counts,
) Error!void {
    assert(root.len > 0);

    const st = std.Io.Dir.cwd().statFile(
        io,
        root,
        .{ .follow_symlinks = true },
    ) catch |err| switch (err) {
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
    out: *ByteList,
    root: []const u8,
    rel: []const u8,
    excludes: []const []const u8,
    counts: *Counts,
) Error!void {
    assert(root.len > 0);

    const full = if (rel.len == 0)
        try ownedPath(allocator, &.{root})
    else
        try ownedPath(allocator, &.{ root, rel });
    defer allocator.free(full);

    var dir = std.Io.Dir.cwd().openDir(io, full, .{ .iterate = true }) catch |err| switch (err) {
        error.FileNotFound => return,
        else => |e| return e,
    };
    defer dir.close(io);

    var names: NameList = .empty;
    defer {
        for (names.items) |name| allocator.free(name);
        names.deinit(allocator);
    }
    var it = dir.iterateAssumeFirstIteration();
    while (try it.next(io)) |entry| {
        try names.append(allocator, try ownedPath(allocator, &.{entry.name}));
    }
    std.mem.sort([]u8, names.items, {}, stringLessThan);

    for (names.items) |name| {
        const child_rel = try makeChildRel(allocator, rel, name);
        defer allocator.free(child_rel);
        const child_full = try ownedPath(allocator, &.{ full, name });
        defer allocator.free(child_full);
        if (isExcluded(child_rel, excludes)) {
            countExcludedFile(io, child_full, counts);
            continue;
        }
        const st = std.Io.Dir.cwd().statFile(
            io,
            child_full,
            .{ .follow_symlinks = false },
        ) catch |err| switch (err) {
            error.FileNotFound => continue,
            else => |e| return e,
        };
        try appendRootfsEntry(
            allocator,
            io,
            out,
            root,
            child_rel,
            child_full,
            st,
            excludes,
            counts,
        );
    }
}

fn appendRootfsEntry(
    allocator: std.mem.Allocator,
    io: std.Io,
    out: *ByteList,
    root: []const u8,
    child_rel: []const u8,
    child_full: []const u8,
    st: std.Io.File.Stat,
    excludes: []const []const u8,
    counts: *Counts,
) Error!void {
    assert(child_rel.len > 0);
    assert(child_full.len > 0);

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
    out: *ByteList,
    root: []const u8,
    rel: []const u8,
    mountpoint: []const u8,
    excludes: []const []const u8,
    counts: *Counts,
) Error!void {
    assert(root.len > 0);

    const full = if (rel.len == 0)
        try ownedPath(allocator, &.{root})
    else
        try ownedPath(allocator, &.{ root, rel });
    defer allocator.free(full);

    var dir = std.Io.Dir.cwd().openDir(io, full, .{ .iterate = true }) catch |err| switch (err) {
        error.FileNotFound => return,
        else => |e| return e,
    };
    defer dir.close(io);

    var names: NameList = .empty;
    defer {
        for (names.items) |name| allocator.free(name);
        names.deinit(allocator);
    }
    var it = dir.iterateAssumeFirstIteration();
    while (try it.next(io)) |entry| {
        try names.append(allocator, try ownedPath(allocator, &.{entry.name}));
    }
    std.mem.sort([]u8, names.items, {}, stringLessThan);

    for (names.items) |name| {
        if (hasExactExclude(name, excludes)) continue;
        const child_rel = try makeChildRel(allocator, rel, name);
        defer allocator.free(child_rel);
        const child_full = try ownedPath(allocator, &.{ full, name });
        defer allocator.free(child_full);
        const st = std.Io.Dir.cwd().statFile(
            io,
            child_full,
            .{ .follow_symlinks = false },
        ) catch |err| switch (err) {
            error.FileNotFound => continue,
            else => |e| return e,
        };
        try appendWorkspaceEntry(
            allocator,
            io,
            out,
            root,
            child_rel,
            child_full,
            mountpoint,
            st,
            excludes,
            counts,
        );
    }
}

fn appendWorkspaceEntry(
    allocator: std.mem.Allocator,
    io: std.Io,
    out: *ByteList,
    root: []const u8,
    child_rel: []const u8,
    child_full: []const u8,
    mountpoint: []const u8,
    st: std.Io.File.Stat,
    excludes: []const []const u8,
    counts: *Counts,
) Error!void {
    assert(root.len > 0);
    assert(child_rel.len > 0);
    assert(child_full.len > 0);
    assert(mountpoint.len > 0);

    const arc_name = try fmtOwned(allocator, "{s}/{s}", .{ mountpoint, child_rel });
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

fn appendFinalEntries(
    allocator: std.mem.Allocator,
    io: std.Io,
    out: *ByteList,
    opts: FinalOptions,
) Error!void {
    assert(out.items.len > 0 or opts.inject_init);
    if (opts.inject_init) {
        if (opts.init_path) |init_path| {
            const init = readFileAlloc(allocator, io, init_path) catch |err| switch (err) {
                error.FileNotFound => if (opts.allow_missing_init)
                    null
                else
                    return error.InitMissing,
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
    } else {
        if (opts.config_path) |config_path| {
            const config = try readFileAlloc(allocator, io, config_path);
            defer allocator.free(config);
            try appendNewc(allocator, out, "machinen-config.json", 0o100644, .{
                .data = config,
            });
        }
    }
    try appendBootEpoch(allocator, io, out);
    if (opts.mount_guest) |mount_guest| {
        const data = try fmtOwned(allocator, "{s}\n", .{mount_guest});
        defer allocator.free(data);
        try appendNewc(allocator, out, "etc/machinen-mountdisk-guest", 0o100644, .{ .data = data });
    }
    try appendNewc(allocator, out, "dev", 0o40755, .{});
    try appendNewc(allocator, out, "dev/console", 0o20600, .{ .rmajor = 5, .rminor = 1 });
    try appendNewc(allocator, out, "tmp", 0o41777, .{});
    try appendNewc(allocator, out, "TRAILER!!!", 0, .{});
}

fn appendBootEpoch(allocator: std.mem.Allocator, io: std.Io, out: *ByteList) Error!void {
    assert(out.items.len > 0);
    const now = @divFloor(std.Io.Clock.real.now(io).nanoseconds, std.time.ns_per_s);
    const data = try fmtOwned(allocator, "{d}", .{now});
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

fn appendNewc(
    allocator: std.mem.Allocator,
    out: *ByteList,
    name: []const u8,
    mode: u64,
    opts: NewcOptions,
) Error!void {
    assert(name.len > 0);
    var header: [110]u8 = undefined;
    const name_size = name.len + 1;
    const header_fmt = "070701" ++
        "{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}" ++
        "{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}{x:0>8}";
    const header_text = try std.fmt.bufPrint(&header, header_fmt, .{
        0,
        mode,
        opts.uid,
        opts.gid,
        opts.nlink,
        opts.mtime,
        opts.data.len,
        0,
        0,
        opts.rmajor,
        opts.rminor,
        name_size,
        0,
    });
    try out.appendSlice(allocator, header_text);
    try out.appendSlice(allocator, name);
    try out.append(allocator, 0);
    try appendPadding(allocator, out, header_text.len + name_size);
    try out.appendSlice(allocator, opts.data);
    try appendPadding(allocator, out, opts.data.len);
}

fn appendPadding(allocator: std.mem.Allocator, out: *ByteList, len: Count) Error!void {
    assert(out.capacity >= out.items.len);

    const padding = (4 - (len % 4)) % 4;
    try out.appendNTimes(allocator, 0, padding);
}

fn readFileAlloc(allocator: std.mem.Allocator, io: std.Io, path: []const u8) Error![]u8 {
    assert(path.len > 0);

    var file = try std.Io.Dir.cwd().openFile(io, path, .{ .allow_directory = false });
    defer file.close(io);
    var out: ByteList = .empty;
    errdefer out.deinit(allocator);
    var buf: [64 * 1024]u8 = undefined;
    // EOF-bounded: file readStreaming reports EndOfStream after the final byte.
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
    assert(path.len > 0);

    var file = try std.Io.Dir.cwd().createFile(io, path, .{ .truncate = true });
    defer file.close(io);
    file.writeStreamingAll(io, bytes) catch return error.WriteFailed;
}

fn countExcludedFile(io: std.Io, path: []const u8, counts: *Counts) void {
    assert(path.len > 0);

    const st = std.Io.Dir.cwd().statFile(io, path, .{ .follow_symlinks = false }) catch return;
    if (st.kind == .file) {
        counts.files += 1;
        counts.bytes += @intCast(st.size);
    }
}

fn modeBits(st: std.Io.File.Stat) u64 {
    const mode = @as(u64, @intCast(st.permissions.toMode() & 0o7777));
    assert(mode <= 0o7777);
    return mode;
}

fn stringLessThan(_: void, a: []const u8, b: []const u8) bool {
    assert(a.len > 0);
    assert(b.len > 0);
    return std.mem.lessThan(u8, a, b);
}

fn hasExactExclude(name: []const u8, excludes: []const []const u8) bool {
    assert(name.len > 0);

    for (excludes) |exclude| {
        if (std.mem.eql(u8, name, exclude)) return true;
    }
    return false;
}

fn isExcluded(path: []const u8, excludes: []const []const u8) bool {
    assert(path.len > 0);

    for (excludes) |pattern| {
        if (fnmatch(path, pattern)) return true;
    }
    return false;
}

fn fnmatch(name: []const u8, pattern: []const u8) bool {
    assert(pattern.len > 0);
    return fnmatchAt(name, 0, pattern, 0);
}

fn fnmatchAt(name: []const u8, ni: Index, pattern: []const u8, pi: Index) bool {
    assert(ni <= name.len);
    assert(pi <= pattern.len);
    return fnmatchStep(name, ni, pattern, pi);
}

fn fnmatchStep(name: []const u8, ni: Index, pattern: []const u8, pi: Index) bool {
    assert(ni <= name.len);
    assert(pi <= pattern.len);

    if (pi == pattern.len) return ni == name.len;
    if (pattern[pi] == '*') {
        var i = ni;
        // Intentional: tries each suffix once and stops at name.len.
        while (true) : (i += 1) {
            if (fnmatchAt(name, i, pattern, pi + 1)) return true;
            if (i == name.len) break;
        }
        return false;
    }
    if (ni == name.len) return false;
    if (pattern[pi] == '?') return fnmatchAt(name, ni + 1, pattern, pi + 1);
    if (pattern[pi] == '[') {
        const class_end = classEnd(pattern, pi) orelse
            return name[ni] == '[' and fnmatchAt(name, ni + 1, pattern, pi + 1);
        if (!classMatches(name[ni], pattern[pi + 1 .. class_end])) return false;
        return fnmatchAt(name, ni + 1, pattern, class_end + 1);
    }
    return name[ni] == pattern[pi] and fnmatchAt(name, ni + 1, pattern, pi + 1);
}

fn classEnd(pattern: []const u8, start: Index) ?Index {
    assert(start < pattern.len);

    var i = start + 1;
    if (i < pattern.len and pattern[i] == '!') i += 1;
    if (i < pattern.len and pattern[i] == ']') i += 1;
    while (i < pattern.len) : (i += 1) {
        if (pattern[i] == ']') return i;
    }
    return null;
}

fn classMatches(c: u8, body: []const u8) bool {
    assert(body.len > 0);

    var negated = false;
    var start: Index = 0;
    if (body.len > 0 and body[0] == '!') {
        negated = true;
        start = 1;
    }
    var matched = false;
    var i = start;
    while (i < body.len) : (i += 1) {
        if (i + 2 < body.len and body[i + 1] == '-') {
            if (body[i] <= c and c <= body[i + 2]) matched = true;
            i += 2;
        } else if (body[i] == c) {
            matched = true;
        }
    }
    return if (negated) !matched else matched;
}

fn makeChildRel(
    allocator: std.mem.Allocator,
    rel: []const u8,
    name: []const u8,
) std.mem.Allocator.Error![]u8 {
    assert(name.len > 0);
    return if (rel.len == 0)
        ownedPath(allocator, &.{name})
    else
        fmtOwned(allocator, "{s}/{s}", .{ rel, name });
}

fn ownedPath(
    allocator: std.mem.Allocator,
    parts: []const []const u8,
) std.mem.Allocator.Error![]u8 {
    assert(parts.len > 0);
    return std.fs.path.join(allocator, parts);
}

fn fmtOwned(
    allocator: std.mem.Allocator,
    comptime fmt: []const u8,
    args: anytype,
) std.mem.Allocator.Error![]u8 {
    assert(fmt.len > 0);

    var writer = std.Io.Writer.Allocating.init(allocator);
    errdefer writer.deinit();
    writer.writer.print(fmt, args) catch return error.OutOfMemory;
    return writer.toOwnedSlice();
}

fn tmpRootAbs(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    assert(tmp.sub_path.len > 0);

    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return ownedPath(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

fn parseCpioHasEntry(buf: []const u8, wanted: []const u8) bool {
    assert(wanted.len > 0);

    var offset: Index = 0;
    while (offset + 110 <= buf.len) {
        if (!std.mem.eql(u8, buf[offset .. offset + 6], "070701")) return false;
        const filesize = std.fmt.parseInt(
            Index,
            buf[offset + 54 .. offset + 62],
            16,
        ) catch return false;
        const namesize = std.fmt.parseInt(
            Index,
            buf[offset + 94 .. offset + 102],
            16,
        ) catch return false;
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
    const init_path = try ownedPath(allocator, &.{ root, "init" });
    defer allocator.free(init_path);
    const out_path = try ownedPath(allocator, &.{ root, "out.cpio" });
    defer allocator.free(out_path);

    const tiny_result = try packTiny(allocator, std.testing.io, .{
        .out = out_path,
        .final = .{
            .init_path = init_path,
            .config = "{}",
            .mount_guest = "/mnt/app",
        },
    });
    try std.testing.expect(tiny_result.bytes > 0);
    const data = try readFileAlloc(allocator, std.testing.io, out_path);
    defer allocator.free(data);
    try std.testing.expect(parseCpioHasEntry(data, "init"));
    try std.testing.expect(parseCpioHasEntry(data, "machinen-config.json"));
    try std.testing.expect(parseCpioHasEntry(data, "etc/machinen-mountdisk-guest"));
    try std.testing.expect(parseCpioHasEntry(data, "dev/console"));
}

test "packRootfs accepts a symlink root that points at a directory" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.createDir(std.testing.io, "root", .default_dir);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "root/file.txt", .data = "one" });
    try tmp.dir.symLink(std.testing.io, "root", "link-root", .{});

    const tmp_root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(tmp_root);
    const link_root = try ownedPath(allocator, &.{ tmp_root, "link-root" });
    defer allocator.free(link_root);
    const out_path = try ownedPath(allocator, &.{ tmp_root, "rootfs.cpio" });
    defer allocator.free(out_path);

    const result = try packRootfs(allocator, std.testing.io, .{
        .rootfs = link_root,
        .out = out_path,
        .final = .{},
    });
    try std.testing.expect(result.bytes > 0);
    const data = try readFileAlloc(allocator, std.testing.io, out_path);
    defer allocator.free(data);
    try std.testing.expect(parseCpioHasEntry(data, "file.txt"));
}

test "fnmatch supports bracket ranges" {
    try std.testing.expect(fnmatch("b", "[a-c]"));
    try std.testing.expect(!fnmatch("d", "[a-c]"));
    try std.testing.expect(fnmatch("d", "[!a-c]"));
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
    const ws_path = try ownedPath(allocator, &.{ root, "ws" });
    defer allocator.free(ws_path);
    const out_path = try ownedPath(allocator, &.{ root, "workspace.cpio" });
    defer allocator.free(out_path);
    const excludes = [_][]const u8{"skip.txt"};

    const workspace_result = try packWorkspace(allocator, std.testing.io, .{
        .workspace = ws_path,
        .out = out_path,
        .excludes = &excludes,
    });
    try std.testing.expect(workspace_result.bytes > 0);
    const data = try readFileAlloc(allocator, std.testing.io, out_path);
    defer allocator.free(data);
    try std.testing.expect(parseCpioHasEntry(data, "workspace/keep.txt"));
    try std.testing.expect(!parseCpioHasEntry(data, "workspace/skip.txt"));
}
