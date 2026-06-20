// Mountdisk is the native machinery behind Machinen's `--mount`.
//
// It turns a host directory into VM disk images:
//
// 1. Lower image
//    - Reads the host directory.
//    - Builds a deterministic SquashFS image from it.
//    - Caches it by content hash.
//    - The guest sees this as the read-only base contents.
//
// 2. Upper image
//    - Creates a fresh sparse ext4 image.
//    - Guest writes go here.
//
// Inside the VM, `/init` mounts both and combines them with overlayfs, so the
// guest sees one writable directory at the requested path, like `/mnt/data`.
//
// Example:
//
//   machinen boot --mount ./my-dir:/mnt/data -- ls /mnt/data
//
// Mountdisk packages `./my-dir` as a disk-backed mount instead of stuffing it
// into the initramfs. This keeps boot archives small and lets writes stay
// isolated in the per-VM upper image.

const std = @import("std");
const manifest = @import("manifest.zig");

const assert = std.debug.assert;

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

pub fn ensureLower(
    allocator: std.mem.Allocator,
    io: std.Io,
    opts: LowerOptions,
) Error!LowerResult {
    assert(opts.host.len > 0);
    assert(opts.cache_dir.len > 0);

    const host_stat = std.Io.Dir.cwd().statFile(
        io,
        opts.host,
        .{ .follow_symlinks = true },
    ) catch |err| switch (err) {
        error.FileNotFound => return error.HostNotFound,
        else => |e| return e,
    };
    if (host_stat.kind != .directory) return error.HostNotDirectory;

    const hash_start = nowMs(io);
    const key = try manifest.treeManifestHash(allocator, io, opts.host);
    const manifest_hash_ms = nowMs(io) - hash_start;

    const img_path = try fmtOwned(allocator, "{s}/{s}.sqfs", .{ opts.cache_dir, &key });
    errdefer allocator.free(img_path);
    const ok_path = try fmtOwned(allocator, "{s}.ok", .{img_path});
    defer allocator.free(ok_path);

    if (try maybeCachedLower(io, opts.force, img_path, ok_path, key, manifest_hash_ms)) |hit| {
        return hit;
    }

    const lower = try buildLower(allocator, io, opts, img_path, key, manifest_hash_ms);
    return lower;
}

fn maybeCachedLower(
    io: std.Io,
    force: bool,
    img_path: []u8,
    ok_path: []const u8,
    key: [64]u8,
    manifest_hash_ms: i64,
) Error!?LowerResult {
    assert(img_path.len > 0);
    assert(ok_path.len > 0);

    if (force or !fileExists(io, img_path)) return null;
    if (!fileExists(io, ok_path)) return null;
    std.Io.Dir.cwd().deleteFile(io, ok_path) catch |err| ignoreCleanupError(err);
    return .{
        .lower_path = img_path,
        .key = key,
        .cache_hit = true,
        .manifest_hash_ms = manifest_hash_ms,
        .mksquashfs_ms = 0,
        .staging_rename_ms = 0,
    };
}

fn buildLower(
    allocator: std.mem.Allocator,
    io: std.Io,
    opts: LowerOptions,
    img_path: []u8,
    key: [64]u8,
    manifest_hash_ms: i64,
) Error!LowerResult {
    assert(img_path.len > 0);

    const mksquashfs = try selectMksquashfs(io, opts);
    const staging_dir = try createUniqueStagingDir(allocator, io, opts.cache_dir, &key);
    defer allocator.free(staging_dir);
    defer std.Io.Dir.cwd().deleteTree(io, staging_dir) catch |err| ignoreCleanupError(err);
    const staging_img = try fmtOwned(allocator, "{s}/lower.sqfs", .{staging_dir});
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

pub fn ensureUpper(
    allocator: std.mem.Allocator,
    io: std.Io,
    opts: UpperOptions,
) Error!UpperResult {
    assert(opts.tmp_dir.len > 0);
    assert(opts.size_bytes > 0);
    assert(opts.mke2fs.len > 0);

    const upper_path = try allocateUniqueSparseFile(allocator, io, opts.tmp_dir, opts.size_bytes);
    errdefer allocator.free(upper_path);
    errdefer std.Io.Dir.cwd().deleteFile(io, upper_path) catch |err| {
        ignoreCleanupError(err);
    };
    const blocks = @divFloor(opts.size_bytes, 4096);
    try runMke2fs(allocator, io, opts.mke2fs, upper_path, blocks);
    return .{ .upper_path = upper_path, .size_bytes = opts.size_bytes };
}

fn selectMksquashfs(io: std.Io, opts: LowerOptions) Error![]const u8 {
    assert(opts.host.len > 0);
    assert(opts.cache_dir.len > 0);

    if (opts.mksquashfs_env_override) |env_override| {
        if (env_override.len > 0) {
            if (!fileExists(io, env_override)) return error.MksquashfsEnvMissing;
            return env_override;
        }
    }
    for (opts.mksquashfs_candidates) |candidate| {
        if (fileExists(io, candidate)) return candidate;
    }
    return error.MksquashfsMissing;
}

fn runMksquashfs(
    allocator: std.mem.Allocator,
    io: std.Io,
    mksquashfs: []const u8,
    host: []const u8,
    out: []const u8,
) Error!void {
    assert(mksquashfs.len > 0);
    assert(host.len > 0);
    assert(out.len > 0);

    const result = try std.process.run(allocator, io, .{
        .argv = &.{
            mksquashfs,
            host,
            out,
            "-mkfs-time",
            "0",
            "-all-time",
            "0",
            "-no-progress",
            "-no-recovery",
            "-comp",
            "zstd",
            "-no-xattrs",
        },
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

fn runMke2fs(
    allocator: std.mem.Allocator,
    io: std.Io,
    mke2fs: []const u8,
    path: []const u8,
    blocks: u64,
) Error!void {
    assert(mke2fs.len > 0);
    assert(path.len > 0);
    assert(blocks > 0);

    const blocks_text = try fmtOwned(allocator, "{d}", .{blocks});
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

fn allocateUniqueSparseFile(
    allocator: std.mem.Allocator,
    io: std.Io,
    tmp_dir: []const u8,
    size_bytes: u64,
) Error![]u8 {
    assert(tmp_dir.len > 0);
    assert(size_bytes > 0);

    var attempt: u8 = 0;
    while (attempt < 64) : (attempt += 1) {
        const path = try upperPath(allocator, io, tmp_dir, attempt);
        createSparseFileExclusive(io, path, size_bytes) catch |err| {
            allocator.free(path);
            switch (err) {
                error.PathAlreadyExists => continue,
                else => |e| return e,
            }
        };
        return path;
    }
    return error.UniquePathExhausted;
}

fn createSparseFileExclusive(io: std.Io, path: []const u8, size_bytes: u64) Error!void {
    assert(path.len > 0);
    assert(size_bytes > 0);

    var file = try std.Io.Dir.cwd().createFile(io, path, .{
        .truncate = false,
        .exclusive = true,
    });
    errdefer std.Io.Dir.cwd().deleteFile(io, path) catch |err| ignoreCleanupError(err);
    defer file.close(io);
    const zero = [_]u8{0};
    try file.writePositionalAll(io, &zero, size_bytes - 1);
}

fn padTo512Boundary(io: std.Io, path: []const u8) Error!void {
    assert(path.len > 0);

    const st = try std.Io.Dir.cwd().statFile(io, path, .{ .follow_symlinks = false });
    const remainder = st.size % 512;
    if (remainder == 0) return;
    const padded = st.size + (512 - remainder);
    var file = try std.Io.Dir.cwd().openFile(io, path, .{
        .mode = .write_only,
        .allow_directory = false,
    });
    defer file.close(io);
    const zero = [_]u8{0};
    try file.writePositionalAll(io, &zero, padded - 1);
}

fn createUniqueStagingDir(
    allocator: std.mem.Allocator,
    io: std.Io,
    cache_dir: []const u8,
    key: *const [64]u8,
) Error![]u8 {
    assert(cache_dir.len > 0);
    assert(key.len == 64);

    var attempt: u8 = 0;
    while (attempt < 64) : (attempt += 1) {
        const path = try stagingDirPath(allocator, io, cache_dir, key, attempt);
        std.Io.Dir.cwd().createDir(io, path, .default_dir) catch |err| {
            allocator.free(path);
            switch (err) {
                error.PathAlreadyExists => continue,
                else => |e| return e,
            }
        };
        return path;
    }
    return error.UniquePathExhausted;
}

fn stagingDirPath(
    allocator: std.mem.Allocator,
    io: std.Io,
    cache_dir: []const u8,
    key: *const [64]u8,
    attempt: u8,
) Error![]u8 {
    assert(cache_dir.len > 0);
    assert(key.len == 64);

    return fmtOwned(allocator, "{s}/{s}-staging-{d}-{d}", .{
        cache_dir,
        key[0..12],
        nowNs(io),
        attempt,
    });
}

fn upperPath(
    allocator: std.mem.Allocator,
    io: std.Io,
    tmp_dir: []const u8,
    attempt: u8,
) Error![]u8 {
    assert(tmp_dir.len > 0);

    return fmtOwned(allocator, "{s}/machinen-mountdisk-upper-{d}-{d}.img", .{
        tmp_dir,
        nowNs(io),
        attempt,
    });
}

fn fileExists(io: std.Io, path: []const u8) bool {
    assert(path.len > 0);

    const st = std.Io.Dir.cwd().statFile(io, path, .{ .follow_symlinks = false }) catch return false;
    return switch (st.kind) {
        else => true,
    };
}

fn nowMs(io: std.Io) i64 {
    const ms = @as(i64, @intCast(@divFloor(nowNs(io), std.time.ns_per_ms)));
    assert(ms >= 0);
    return ms;
}

fn nowNs(io: std.Io) i96 {
    const ns = std.Io.Clock.awake.now(io).nanoseconds;
    assert(ns >= 0);
    return ns;
}

fn ignoreCleanupError(err: anyerror) void {
    assert(@errorName(err).len > 0);
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
    return std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

test "selectMksquashfs treats an empty env override as absent" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "mksquashfs", .data = "fake" });

    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const fake = try std.fs.path.join(allocator, &.{ root, "mksquashfs" });
    defer allocator.free(fake);
    const candidates = [_][]const u8{fake};

    const selected = try selectMksquashfs(std.testing.io, .{
        .host = root,
        .cache_dir = root,
        .mksquashfs_candidates = &candidates,
        .mksquashfs_env_override = "",
    });
    try std.testing.expectEqualStrings(fake, selected);
}

test "createSparseFileExclusive refuses to truncate an existing path" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "upper.img", .data = "keep" });

    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const path = try std.fs.path.join(allocator, &.{ root, "upper.img" });
    defer allocator.free(path);

    try std.testing.expectError(
        error.PathAlreadyExists,
        createSparseFileExclusive(std.testing.io, path, 4096),
    );
    const st = try std.Io.Dir.cwd().statFile(std.testing.io, path, .{});
    try std.testing.expectEqual(@as(u64, 4), st.size);
}

test "allocateUniqueSparseFile returns distinct exclusive files" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const first = try allocateUniqueSparseFile(allocator, std.testing.io, root, 4096);
    defer allocator.free(first);
    defer std.Io.Dir.cwd().deleteFile(std.testing.io, first) catch |err| ignoreCleanupError(err);
    const second = try allocateUniqueSparseFile(allocator, std.testing.io, root, 4096);
    defer allocator.free(second);
    defer std.Io.Dir.cwd().deleteFile(std.testing.io, second) catch |err| ignoreCleanupError(err);

    try std.testing.expect(!std.mem.eql(u8, first, second));
    const first_st = try std.Io.Dir.cwd().statFile(std.testing.io, first, .{});
    const second_st = try std.Io.Dir.cwd().statFile(std.testing.io, second, .{});
    try std.testing.expectEqual(@as(u64, 4096), first_st.size);
    try std.testing.expectEqual(@as(u64, 4096), second_st.size);
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
    try std.testing.expectError(error.HostNotFound, ensureLower(allocator, std.testing.io, .{
        .host = missing,
        .cache_dir = root,
    }));
    try std.testing.expectError(error.HostNotDirectory, ensureLower(allocator, std.testing.io, .{
        .host = file,
        .cache_dir = root,
    }));
}

test "ensureLower accepts a symlink host root that points at a directory" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.createDir(std.testing.io, "host", .default_dir);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "host/file.txt", .data = "x" });
    try tmp.dir.createDir(std.testing.io, "cache", .default_dir);
    try tmp.dir.symLink(std.testing.io, "host", "host-link", .{});

    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const host = try std.fs.path.join(allocator, &.{ root, "host-link" });
    defer allocator.free(host);
    const cache = try std.fs.path.join(allocator, &.{ root, "cache" });
    defer allocator.free(cache);

    try std.testing.expectError(error.MksquashfsMissing, ensureLower(
        allocator,
        std.testing.io,
        .{ .host = host, .cache_dir = cache },
    ));
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
    const img = try fmtOwned(allocator, "{s}/{s}.sqfs", .{ cache, &key });
    defer allocator.free(img);
    const ok = try fmtOwned(allocator, "{s}.ok", .{img});
    defer allocator.free(ok);
    const img_sub_path = try fmtOwned(allocator, "cache/{s}.sqfs", .{&key});
    defer allocator.free(img_sub_path);
    const ok_sub_path = try fmtOwned(allocator, "cache/{s}.sqfs.ok", .{&key});
    defer allocator.free(ok_sub_path);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = img_sub_path, .data = "cached" });
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = ok_sub_path, .data = "" });

    const result = try ensureLower(allocator, std.testing.io, .{
        .host = host,
        .cache_dir = cache,
    });
    defer allocator.free(result.lower_path);
    try std.testing.expect(result.cache_hit);
    try std.testing.expectEqualStrings(img, result.lower_path);
    try std.testing.expect(!fileExists(std.testing.io, ok));
}
