const std = @import("std");
const manifest = @import("manifest.zig");

pub const Error = anyerror;

pub const LowerOptions = struct {
    host: []const u8,
    cache_dir: []const u8,
    force: bool = false,
    mksquashfs_candidates: []const []const u8 = &.{},
    mksquashfs_env_override: ?[]const u8 = null,
};

pub const LowerResult = struct {
    lower_path: []u8,
    key: [64]u8,
    cache_hit: bool,
    manifest_hash_ms: i64,
    mksquashfs_ms: i64,
    staging_rename_ms: i64,
};

pub const UpperOptions = struct {
    tmp_dir: []const u8,
    size_bytes: u64,
    mke2fs: []const u8,
};

pub const UpperResult = struct {
    upper_path: []u8,
    size_bytes: u64,
};

pub fn ensureLower(allocator: std.mem.Allocator, io: std.Io, opts: LowerOptions) Error!LowerResult {
    const host_stat = std.Io.Dir.cwd().statFile(io, opts.host, .{ .follow_symlinks = false }) catch |err| switch (err) {
        error.FileNotFound => return error.HostNotFound,
        else => |e| return e,
    };
    if (host_stat.kind != .directory) return error.HostNotDirectory;

    const hash_start = nowMs(io);
    const key = try manifest.treeManifestHash(allocator, io, opts.host);
    const manifest_hash_ms = nowMs(io) - hash_start;

    const img_path = try std.fmt.allocPrint(allocator, "{s}/{s}.sqfs", .{ opts.cache_dir, &key });
    errdefer allocator.free(img_path);
    const ok_path = try std.fmt.allocPrint(allocator, "{s}.ok", .{img_path});
    defer allocator.free(ok_path);

    if (!opts.force and fileExists(io, img_path)) {
        if (fileExists(io, ok_path)) {
            std.Io.Dir.cwd().deleteFile(io, ok_path) catch {};
            return .{
                .lower_path = img_path,
                .key = key,
                .cache_hit = true,
                .manifest_hash_ms = manifest_hash_ms,
                .mksquashfs_ms = 0,
                .staging_rename_ms = 0,
            };
        }
    }

    const mksquashfs = try selectMksquashfs(io, opts);
    const staging_dir = try stagingDirPath(allocator, io, opts.cache_dir, &key);
    defer allocator.free(staging_dir);
    defer std.Io.Dir.cwd().deleteTree(io, staging_dir) catch {};
    try std.Io.Dir.cwd().createDir(io, staging_dir, .default_dir);
    const staging_img = try std.fmt.allocPrint(allocator, "{s}/lower.sqfs", .{staging_dir});
    defer allocator.free(staging_img);

    const mk_start = nowMs(io);
    try runMksquashfs(allocator, io, mksquashfs, opts.host, staging_img);
    const mksquashfs_ms = nowMs(io) - mk_start;

    const rename_start = nowMs(io);
    try padTo512Boundary(io, staging_img);
    try std.Io.Dir.renameAbsolute(staging_img, img_path, io);
    const staging_rename_ms = nowMs(io) - rename_start;

    return .{
        .lower_path = img_path,
        .key = key,
        .cache_hit = false,
        .manifest_hash_ms = manifest_hash_ms,
        .mksquashfs_ms = mksquashfs_ms,
        .staging_rename_ms = staging_rename_ms,
    };
}

pub fn ensureUpper(allocator: std.mem.Allocator, io: std.Io, opts: UpperOptions) Error!UpperResult {
    const upper_path = try upperPath(allocator, io, opts.tmp_dir);
    errdefer allocator.free(upper_path);
    errdefer std.Io.Dir.cwd().deleteFile(io, upper_path) catch {};
    try allocateSparseFile(io, upper_path, opts.size_bytes);
    const blocks = opts.size_bytes / 4096;
    try runMke2fs(allocator, io, opts.mke2fs, upper_path, blocks);
    return .{ .upper_path = upper_path, .size_bytes = opts.size_bytes };
}

fn selectMksquashfs(io: std.Io, opts: LowerOptions) Error![]const u8 {
    if (opts.mksquashfs_env_override) |env_override| {
        if (!fileExists(io, env_override)) return error.MksquashfsEnvMissing;
        return env_override;
    }
    for (opts.mksquashfs_candidates) |candidate| {
        if (fileExists(io, candidate)) return candidate;
    }
    return error.MksquashfsMissing;
}

fn runMksquashfs(allocator: std.mem.Allocator, io: std.Io, mksquashfs: []const u8, host: []const u8, out: []const u8) Error!void {
    const result = try std.process.run(allocator, io, .{
        .argv = &.{ mksquashfs, host, out, "-mkfs-time", "0", "-all-time", "0", "-no-progress", "-no-recovery", "-comp", "zstd", "-no-xattrs" },
        .stdout_limit = .limited(1024 * 1024),
        .stderr_limit = .limited(1024 * 1024),
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |code| if (code == 0) return else return error.MksquashfsFailed,
        else => return error.MksquashfsFailed,
    }
}

fn runMke2fs(allocator: std.mem.Allocator, io: std.Io, mke2fs: []const u8, path: []const u8, blocks: u64) Error!void {
    const blocks_text = try std.fmt.allocPrint(allocator, "{d}", .{blocks});
    defer allocator.free(blocks_text);
    const result = try std.process.run(allocator, io, .{
        .argv = &.{ mke2fs, "-t", "ext4", "-F", "-q", "-b", "4096", path, blocks_text },
        .stdout_limit = .limited(1024 * 1024),
        .stderr_limit = .limited(1024 * 1024),
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |code| if (code == 0) return else return error.Mke2fsFailed,
        else => return error.Mke2fsFailed,
    }
}

fn allocateSparseFile(io: std.Io, path: []const u8, size_bytes: u64) Error!void {
    var file = try std.Io.Dir.cwd().createFile(io, path, .{ .truncate = true });
    defer file.close(io);
    const zero = [_]u8{0};
    try file.writePositionalAll(io, &zero, size_bytes - 1);
}

fn padTo512Boundary(io: std.Io, path: []const u8) Error!void {
    const st = try std.Io.Dir.cwd().statFile(io, path, .{ .follow_symlinks = false });
    const remainder = st.size % 512;
    if (remainder == 0) return;
    const padded = st.size + (512 - remainder);
    var file = try std.Io.Dir.cwd().openFile(io, path, .{ .mode = .write_only, .allow_directory = false });
    defer file.close(io);
    const zero = [_]u8{0};
    try file.writePositionalAll(io, &zero, padded - 1);
}

fn stagingDirPath(allocator: std.mem.Allocator, io: std.Io, cache_dir: []const u8, key: *const [64]u8) Error![]u8 {
    return std.fmt.allocPrint(allocator, "{s}/{s}-staging-{d}", .{ cache_dir, key[0..12], nowNs(io) });
}

fn upperPath(allocator: std.mem.Allocator, io: std.Io, tmp_dir: []const u8) Error![]u8 {
    return std.fmt.allocPrint(allocator, "{s}/machinen-mountdisk-upper-{d}.img", .{ tmp_dir, nowNs(io) });
}

fn fileExists(io: std.Io, path: []const u8) bool {
    _ = std.Io.Dir.cwd().statFile(io, path, .{ .follow_symlinks = false }) catch return false;
    return true;
}

fn nowMs(io: std.Io) i64 {
    return @intCast(@divFloor(nowNs(io), std.time.ns_per_ms));
}

fn nowNs(io: std.Io) i96 {
    return std.Io.Clock.awake.now(io).nanoseconds;
}

fn tmpRootAbs(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

test "ensureLower returns host errors before tool lookup" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "file.txt", .data = "x" });
    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const missing = try std.fs.path.join(allocator, &.{ root, "missing" });
    defer allocator.free(missing);
    const file = try std.fs.path.join(allocator, &.{ root, "file.txt" });
    defer allocator.free(file);
    try std.testing.expectError(error.HostNotFound, ensureLower(allocator, std.testing.io, .{ .host = missing, .cache_dir = root }));
    try std.testing.expectError(error.HostNotDirectory, ensureLower(allocator, std.testing.io, .{ .host = file, .cache_dir = root }));
}

test "ensureLower returns clean cache hit without mksquashfs" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.createDir(std.testing.io, "host", .default_dir);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "host/hello.txt", .data = "world" });
    try tmp.dir.createDir(std.testing.io, "cache", .default_dir);
    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const host = try std.fs.path.join(allocator, &.{ root, "host" });
    defer allocator.free(host);
    const cache = try std.fs.path.join(allocator, &.{ root, "cache" });
    defer allocator.free(cache);
    const key = try manifest.treeManifestHash(allocator, std.testing.io, host);
    const img = try std.fmt.allocPrint(allocator, "{s}/{s}.sqfs", .{ cache, &key });
    defer allocator.free(img);
    const ok = try std.fmt.allocPrint(allocator, "{s}.ok", .{img});
    defer allocator.free(ok);
    const img_sub_path = try std.fmt.allocPrint(allocator, "cache/{s}.sqfs", .{&key});
    defer allocator.free(img_sub_path);
    const ok_sub_path = try std.fmt.allocPrint(allocator, "cache/{s}.sqfs.ok", .{&key});
    defer allocator.free(ok_sub_path);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = img_sub_path, .data = "cached" });
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = ok_sub_path, .data = "" });
    const result = try ensureLower(allocator, std.testing.io, .{ .host = host, .cache_dir = cache });
    defer allocator.free(result.lower_path);
    try std.testing.expect(result.cache_hit);
    try std.testing.expectEqualStrings(img, result.lower_path);
    try std.testing.expect(!fileExists(std.testing.io, ok));
}
