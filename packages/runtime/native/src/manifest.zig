const std = @import("std");

pub const Error = error{
    PathNotFound,
    PathNotDirectory,
    UnsupportedPath,
} || std.mem.Allocator.Error || std.Io.Dir.OpenError || std.Io.Dir.Iterator.Error || std.Io.Dir.StatFileError || std.Io.Dir.ReadLinkError || std.Io.File.OpenError || std.Io.File.ReadStreamingError || std.Io.File.SetTimestampsError || std.Io.Dir.SetFilePermissionsError || std.Io.Dir.CreateDirError || std.Io.Dir.WriteFileError || std.Io.Dir.SymLinkError;

pub fn treeManifestHash(allocator: std.mem.Allocator, io: std.Io, root: []const u8) Error![64]u8 {
    const root_stat = std.Io.Dir.cwd().statFile(io, root, .{ .follow_symlinks = false }) catch |err| switch (err) {
        error.FileNotFound => return error.PathNotFound,
        else => |e| return e,
    };
    if (root_stat.kind != .directory) return error.PathNotDirectory;

    var lines: std.ArrayList([]u8) = .empty;
    defer {
        for (lines.items) |line| allocator.free(line);
        lines.deinit(allocator);
    }

    try walk(allocator, io, root, "", &lines);
    std.mem.sort([]u8, lines.items, {}, lineLessThan);

    var sha = std.crypto.hash.sha2.Sha256.init(.{});
    for (lines.items) |line| {
        sha.update(line);
        sha.update("\n");
    }
    var digest: [32]u8 = undefined;
    sha.final(&digest);
    return hexDigest(digest);
}

fn walk(
    allocator: std.mem.Allocator,
    io: std.Io,
    root: []const u8,
    rel: []const u8,
    lines: *std.ArrayList([]u8),
) Error!void {
    const here = if (rel.len == 0) try allocator.dupe(u8, root) else try std.fs.path.join(allocator, &.{ root, rel });
    defer allocator.free(here);

    var dir = std.Io.Dir.cwd().openDir(io, here, .{ .iterate = true }) catch |err| switch (err) {
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
    std.mem.sort([]u8, names.items, {}, lineLessThan);

    for (names.items) |name| {
        try appendChild(allocator, io, root, rel, here, name, lines);
    }
}

fn appendChild(
    allocator: std.mem.Allocator,
    io: std.Io,
    root: []const u8,
    rel: []const u8,
    parent_abs: []const u8,
    name: []const u8,
    lines: *std.ArrayList([]u8),
) Error!void {
    const child_rel = if (rel.len == 0) try allocator.dupe(u8, name) else try std.fmt.allocPrint(allocator, "{s}/{s}", .{ rel, name });
    defer allocator.free(child_rel);
    const child_abs = try std.fs.path.join(allocator, &.{ parent_abs, name });
    defer allocator.free(child_abs);

    const st = std.Io.Dir.cwd().statFile(io, child_abs, .{ .follow_symlinks = false }) catch |err| switch (err) {
        error.FileNotFound => return,
        else => |e| return e,
    };
    const line = try manifestLineForStat(allocator, io, child_rel, child_abs, st);
    errdefer allocator.free(line);
    try lines.append(allocator, line);

    if (st.kind == .directory) {
        try walk(allocator, io, root, child_rel, lines);
    }
}

fn manifestLineForStat(
    allocator: std.mem.Allocator,
    io: std.Io,
    child_rel: []const u8,
    child_abs: []const u8,
    st: std.Io.File.Stat,
) Error![]u8 {
    const mode = modeBits(st);
    const mtime_ns = manifestMtimeNs(st);
    return switch (st.kind) {
        .sym_link => symlinkManifestLine(allocator, io, child_rel, child_abs, mode, mtime_ns),
        .directory => std.fmt.allocPrint(allocator, "{s}\x00D\x00{o}\x00\x00{d}\x00", .{ child_rel, mode, mtime_ns }),
        .file => fileManifestLine(allocator, io, child_rel, child_abs, mode, st.size, mtime_ns),
        else => std.fmt.allocPrint(allocator, "{s}\x00?\x00{o}\x00\x00{d}\x00", .{ child_rel, mode, mtime_ns }),
    };
}

fn symlinkManifestLine(
    allocator: std.mem.Allocator,
    io: std.Io,
    child_rel: []const u8,
    child_abs: []const u8,
    mode: u64,
    mtime_ns: i96,
) Error![]u8 {
    var buf: [std.Io.Dir.max_path_bytes]u8 = undefined;
    const n = try std.Io.Dir.cwd().readLink(io, child_abs, &buf);
    const target = buf[0..n];
    return std.fmt.allocPrint(allocator, "{s}\x00L\x00{o}\x00{d}\x00{d}\x00{s}", .{
        child_rel,
        mode,
        utf16CodeUnitCount(target),
        mtime_ns,
        target,
    });
}

fn fileManifestLine(
    allocator: std.mem.Allocator,
    io: std.Io,
    child_rel: []const u8,
    child_abs: []const u8,
    mode: u64,
    size: u64,
    mtime_ns: i96,
) Error![]u8 {
    const file_hash = try sha256FileHex(io, child_abs);
    return std.fmt.allocPrint(allocator, "{s}\x00F\x00{o}\x00{d}\x00{d}\x00{s}", .{
        child_rel,
        mode,
        size,
        mtime_ns,
        &file_hash,
    });
}

fn sha256FileHex(io: std.Io, path: []const u8) Error![64]u8 {
    var file = try std.Io.Dir.cwd().openFile(io, path, .{ .allow_directory = false });
    defer file.close(io);

    var sha = std.crypto.hash.sha2.Sha256.init(.{});
    var buf: [64 * 1024]u8 = undefined;
    while (true) {
        const n = file.readStreaming(io, &.{buf[0..]}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => |e| return e,
        };
        if (n == 0) break;
        sha.update(buf[0..n]);
    }
    var digest: [32]u8 = undefined;
    sha.final(&digest);
    return hexDigest(digest);
}

fn modeBits(st: std.Io.File.Stat) u64 {
    return @as(u64, @intCast(st.permissions.toMode() & 0o7777));
}

fn manifestMtimeNs(st: std.Io.File.Stat) i96 {
    return @divFloor(st.mtime.nanoseconds, 1_000_000) * 1_000_000;
}

fn utf16CodeUnitCount(bytes: []const u8) usize {
    var count: usize = 0;
    var i: usize = 0;
    while (i < bytes.len) {
        const first = bytes[i];
        const len: usize = if (first < 0x80) 1 else if ((first & 0xe0) == 0xc0) 2 else if ((first & 0xf0) == 0xe0) 3 else if ((first & 0xf8) == 0xf0) 4 else 1;
        if (i + len > bytes.len) {
            count += 1;
            break;
        }
        if (len == 4) {
            count += 2;
        } else {
            count += 1;
        }
        i += len;
    }
    return count;
}

fn hexDigest(digest: [32]u8) [64]u8 {
    var out: [64]u8 = undefined;
    const digits = "0123456789abcdef";
    for (digest, 0..) |byte, i| {
        out[i * 2] = digits[(byte >> 4) & 0xf];
        out[i * 2 + 1] = digits[byte & 0xf];
    }
    return out;
}

fn lineLessThan(_: void, a: []const u8, b: []const u8) bool {
    return std.mem.lessThan(u8, a, b);
}

fn tmpRootAbs(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

fn setFileMtime(dir: std.Io.Dir, sub_path: []const u8, ns: i96) !void {
    var file = try dir.openFile(std.testing.io, sub_path, .{ .allow_directory = true });
    defer file.close(std.testing.io);
    const ts = std.Io.Timestamp.fromNanoseconds(ns);
    try file.setTimestamps(std.testing.io, .{ .access_timestamp = .{ .new = ts }, .modify_timestamp = .{ .new = ts } });
}

test "treeManifestHash matches legacy deterministic regular-file hash" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    try tmp.dir.createDir(std.testing.io, "root", .default_dir);
    try tmp.dir.createDir(std.testing.io, "root/sub", .default_dir);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "root/alpha.txt", .data = "alpha" });
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "root/sub/beta.sh", .data = "beta" });
    try tmp.dir.setFilePermissions(std.testing.io, "root/sub/beta.sh", .fromMode(0o755), .{});
    try setFileMtime(tmp.dir, "root/alpha.txt", 1_000_000_000_000);
    try setFileMtime(tmp.dir, "root/sub/beta.sh", 1_000_000_000_000);
    try setFileMtime(tmp.dir, "root/sub", 1_000_000_000_000);

    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const target = try std.fs.path.join(allocator, &.{ root, "root" });
    defer allocator.free(target);

    const hash = try treeManifestHash(allocator, std.testing.io, target);
    try std.testing.expectEqualStrings("c1f475b2e3e6ad2d70b50312c2e898c26a2a4236ee0f0f0983b62fb848db19cd", &hash);
}

test "treeManifestHash changes for content, symlink target, and mode" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.createDir(std.testing.io, "root", .default_dir);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "root/file.txt", .data = "one" });
    try tmp.dir.symLink(std.testing.io, "target-a", "root/link", .{});

    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const target = try std.fs.path.join(allocator, &.{ root, "root" });
    defer allocator.free(target);

    const a = try treeManifestHash(allocator, std.testing.io, target);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "root/file.txt", .data = "two" });
    const b = try treeManifestHash(allocator, std.testing.io, target);
    try std.testing.expect(!std.mem.eql(u8, &a, &b));

    try tmp.dir.deleteFile(std.testing.io, "root/link");
    try tmp.dir.symLink(std.testing.io, "target-b", "root/link", .{});
    const c = try treeManifestHash(allocator, std.testing.io, target);
    try std.testing.expect(!std.mem.eql(u8, &b, &c));

    try tmp.dir.setFilePermissions(std.testing.io, "root/file.txt", .fromMode(0o755), .{});
    const d = try treeManifestHash(allocator, std.testing.io, target);
    try std.testing.expect(!std.mem.eql(u8, &c, &d));
}

test "treeManifestHash refuses missing and non-directory roots" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "file.txt", .data = "data" });

    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const missing = try std.fs.path.join(allocator, &.{ root, "missing" });
    defer allocator.free(missing);
    const file = try std.fs.path.join(allocator, &.{ root, "file.txt" });
    defer allocator.free(file);

    try std.testing.expectError(error.PathNotFound, treeManifestHash(allocator, std.testing.io, missing));
    try std.testing.expectError(error.PathNotDirectory, treeManifestHash(allocator, std.testing.io, file));
}
