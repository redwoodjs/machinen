const std = @import("std");

pub const Error = anyerror;

pub const CacheKeySource = enum {
    sidecar,
    file,
};

pub const CacheKeyResult = struct {
    sha: [64]u8,
    source: CacheKeySource,
};

pub const MaterializeOptions = struct {
    tar_abs: []const u8,
    cache_dir: []const u8,
    sha: []const u8,
    img_path: []const u8,
    mke2fs: []const u8,
    size_multiplier: f64 = 2.5,
    min_size_bytes: u64 = 2 * 1024 * 1024 * 1024,
    size_bytes: ?u64 = null,
};

pub const MaterializePhases = struct {
    staging_create: i64 = 0,
    tar_extract: i64 = 0,
    size: i64 = 0,
    sparse_allocate: i64 = 0,
    mke2fs: i64 = 0,
    rename: i64 = 0,
    staging_cleanup: i64 = 0,
};

pub const MaterializeResult = struct {
    img_path: []u8,
    size_bytes: u64,
    phases: MaterializePhases,
};

pub const PrebakeFormat = enum {
    gz,
    zst,
};

pub const PrebakeDecompressOptions = struct {
    path: []const u8,
    dst: []const u8,
    format: PrebakeFormat,
};

pub const PrebakeDecompressResult = struct {
    ok: bool,
    sha256: ?[64]u8 = null,
};

pub fn materializeFromTar(allocator: std.mem.Allocator, io: std.Io, opts: MaterializeOptions) Error!MaterializeResult {
    var phases: MaterializePhases = .{};

    const staging_start = nowMs(io);
    const staging_dir = try std.fmt.allocPrint(allocator, "{s}/{s}-staging-{d}", .{ opts.cache_dir, opts.sha[0..@min(opts.sha.len, 12)], nowNs(io) });
    defer allocator.free(staging_dir);
    try std.Io.Dir.cwd().createDir(io, staging_dir, .default_dir);
    errdefer std.Io.Dir.cwd().deleteTree(io, staging_dir) catch {};
    const staging_tree = try std.fmt.allocPrint(allocator, "{s}/tree", .{staging_dir});
    defer allocator.free(staging_tree);
    try std.Io.Dir.cwd().createDir(io, staging_tree, .default_dir);
    const staging_img = try std.fmt.allocPrint(allocator, "{s}/rootfs.img", .{staging_dir});
    defer allocator.free(staging_img);
    phases.staging_create = nowMs(io) - staging_start;

    const extract_start = nowMs(io);
    try runTarExtract(allocator, io, opts.tar_abs, staging_tree);
    phases.tar_extract = nowMs(io) - extract_start;

    const size_start = nowMs(io);
    const tree_bytes = try duBytes(allocator, io, staging_tree);
    const computed_size = opts.size_bytes orelse @max(opts.min_size_bytes, @as(u64, @intFromFloat(@ceil(@as(f64, @floatFromInt(tree_bytes)) * opts.size_multiplier))));
    phases.size = nowMs(io) - size_start;

    const alloc_start = nowMs(io);
    try allocateSparseFile(io, staging_img, computed_size);
    phases.sparse_allocate = nowMs(io) - alloc_start;

    const mke_start = nowMs(io);
    try runMke2fs(allocator, io, opts.mke2fs, staging_tree, staging_img, computed_size / 4096);
    phases.mke2fs = nowMs(io) - mke_start;

    const rename_start = nowMs(io);
    try std.Io.Dir.renameAbsolute(staging_img, opts.img_path, io);
    phases.rename = nowMs(io) - rename_start;

    const cleanup_start = nowMs(io);
    std.Io.Dir.cwd().deleteTree(io, staging_dir) catch {};
    phases.staging_cleanup = nowMs(io) - cleanup_start;

    return .{ .img_path = try allocator.dupe(u8, opts.img_path), .size_bytes = computed_size, .phases = phases };
}

pub fn decompressPrebake(allocator: std.mem.Allocator, io: std.Io, opts: PrebakeDecompressOptions) Error!PrebakeDecompressResult {
    const argv: []const []const u8 = switch (opts.format) {
        .gz => &.{ "gunzip", "-c", opts.path },
        .zst => &.{ "zstd", "-dc", opts.path },
    };
    return sparseDecompressCommand(allocator, io, argv, opts.dst) catch |err| switch (err) {
        error.FileNotFound, error.DecompressFailed => return .{ .ok = false },
        else => |e| return e,
    };
}

pub fn rootfsCacheKey(allocator: std.mem.Allocator, io: std.Io, tar_path: []const u8) Error!CacheKeyResult {
    if (try readSha256Sidecar(allocator, io, tar_path)) |sha| {
        return .{ .sha = sha, .source = .sidecar };
    }
    const sha = sha256FileHex(io, tar_path) catch |err| switch (err) {
        error.FileNotFound => return error.PathNotFound,
        else => |e| return e,
    };
    return .{ .sha = sha, .source = .file };
}

fn readSha256Sidecar(allocator: std.mem.Allocator, io: std.Io, tar_path: []const u8) Error!?[64]u8 {
    const sidecar = try std.fmt.allocPrint(allocator, "{s}.sha256", .{tar_path});
    defer allocator.free(sidecar);
    const data = readFileAlloc(allocator, io, sidecar) catch |err| switch (err) {
        error.FileNotFound => return null,
        else => return null,
    };
    defer allocator.free(data);
    const token = firstWhitespaceToken(data) orelse return null;
    if (token.len != 64) return null;
    var out: [64]u8 = undefined;
    for (token, 0..) |c, i| {
        out[i] = std.ascii.toLower(c);
        if (!std.ascii.isHex(out[i])) return null;
    }
    return out;
}

fn firstWhitespaceToken(data: []const u8) ?[]const u8 {
    const trimmed = std.mem.trim(u8, data, " \t\r\n");
    if (trimmed.len == 0) return null;
    var it = std.mem.tokenizeAny(u8, trimmed, " \t\r\n");
    return it.next();
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

fn sparseDecompressCommand(_: std.mem.Allocator, io: std.Io, argv: []const []const u8, dst: []const u8) Error!PrebakeDecompressResult {
    var child = try std.process.spawn(io, .{
        .argv = argv,
        .stdin = .ignore,
        .stdout = .pipe,
        .stderr = .ignore,
    });
    var stdout = child.stdout.?;
    child.stdout = null;
    defer stdout.close(io);

    var out_file = try std.Io.Dir.cwd().createFile(io, dst, .{ .truncate = true });
    defer out_file.close(io);

    var sha = std.crypto.hash.sha2.Sha256.init(.{});
    var offset: u64 = 0;
    var buf: [128 * 1024]u8 = undefined;
    while (true) {
        const n = stdout.readStreaming(io, &.{buf[0..]}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => |e| return e,
        };
        if (n == 0) break;
        sha.update(buf[0..n]);
        if (!isAllZero(buf[0..n])) {
            try out_file.writePositionalAll(io, buf[0..n], offset);
        }
        offset += n;
    }
    if (std.c.ftruncate(out_file.handle, @intCast(offset)) != 0) return error.TruncateFailed;

    const term = try child.wait(io);
    switch (term) {
        .exited => |code| if (code != 0) return error.DecompressFailed,
        else => return error.DecompressFailed,
    }

    var digest: [32]u8 = undefined;
    sha.final(&digest);
    return .{ .ok = true, .sha256 = hexDigest(digest) };
}

fn isAllZero(bytes: []const u8) bool {
    for (bytes) |b| {
        if (b != 0) return false;
    }
    return true;
}

fn runTarExtract(allocator: std.mem.Allocator, io: std.Io, tar_abs: []const u8, dest: []const u8) Error!void {
    const result = try std.process.run(allocator, io, .{
        .argv = &.{ "tar", "-xpf", tar_abs, "-C", dest },
        .stdout_limit = .limited(1024 * 1024),
        .stderr_limit = .limited(1024 * 1024),
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |code| if (code == 0) return else return error.TarExtractFailed,
        else => return error.TarExtractFailed,
    }
}

fn runMke2fs(allocator: std.mem.Allocator, io: std.Io, mke2fs: []const u8, staging_tree: []const u8, staging_img: []const u8, blocks: u64) Error!void {
    const blocks_text = try std.fmt.allocPrint(allocator, "{d}", .{blocks});
    defer allocator.free(blocks_text);
    const result = try std.process.run(allocator, io, .{
        .argv = &.{ mke2fs, "-d", staging_tree, "-t", "ext4", "-F", "-q", "-b", "4096", staging_img, blocks_text },
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

fn duBytes(allocator: std.mem.Allocator, io: std.Io, root: []const u8) Error!u64 {
    const st = try std.Io.Dir.cwd().statFile(io, root, .{ .follow_symlinks = false });
    switch (st.kind) {
        .directory => {
            var total: u64 = 4096;
            var dir = try std.Io.Dir.cwd().openDir(io, root, .{ .iterate = true });
            defer dir.close(io);
            var it = dir.iterateAssumeFirstIteration();
            while (try it.next(io)) |entry| {
                const child = try std.fs.path.join(allocator, &.{ root, entry.name });
                defer allocator.free(child);
                total += try duBytes(allocator, io, child);
            }
            return total;
        },
        .file => return @intCast(st.size),
        .sym_link => return @max(1, @as(u64, @intCast(st.size))),
        else => return 0,
    }
}

fn nowMs(io: std.Io) i64 {
    return @intCast(@divFloor(nowNs(io), std.time.ns_per_ms));
}

fn nowNs(io: std.Io) i96 {
    return std.Io.Clock.awake.now(io).nanoseconds;
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

fn tmpRootAbs(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

test "decompressPrebake gunzip writes bytes and sha256" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const raw = "\x53\xef" ++ ("\x00" ** 4096) ++ "payload";
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "rootfs.img", .data = raw });
    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const img = try std.fs.path.join(allocator, &.{ root, "rootfs.img" });
    defer allocator.free(img);
    const gz = try std.fs.path.join(allocator, &.{ root, "rootfs.img.gz" });
    defer allocator.free(gz);
    const out = try std.fs.path.join(allocator, &.{ root, "out.img" });
    defer allocator.free(out);

    const gzip_result = try std.process.run(allocator, std.testing.io, .{
        .argv = &.{ "gzip", "-c", img },
        .stdout_limit = .limited(1024 * 1024),
        .stderr_limit = .limited(1024 * 1024),
    });
    defer allocator.free(gzip_result.stdout);
    defer allocator.free(gzip_result.stderr);
    switch (gzip_result.term) {
        .exited => |code| try std.testing.expectEqual(@as(u8, 0), code),
        else => return error.TestUnexpectedResult,
    }
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "rootfs.img.gz", .data = gzip_result.stdout });

    const result = try decompressPrebake(allocator, std.testing.io, .{ .path = gz, .dst = out, .format = .gz });
    try std.testing.expect(result.ok);
    try std.testing.expect(result.sha256 != null);
    const bytes = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, allocator, out, 1024 * 1024);
    defer allocator.free(bytes);
    try std.testing.expectEqualStrings(raw, bytes);
    try std.testing.expectEqualStrings("90990ba2fa6430a8f8d65a2a445c1c53a19e01e9561e6d0c6057c4608bc39762", &result.sha256.?);
}

test "rootfsCacheKey hashes file when sidecar is absent" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "rootfs.tar.gz", .data = "hello" });
    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const tar = try std.fs.path.join(allocator, &.{ root, "rootfs.tar.gz" });
    defer allocator.free(tar);
    const result = try rootfsCacheKey(allocator, std.testing.io, tar);
    try std.testing.expectEqual(.file, result.source);
    try std.testing.expectEqualStrings("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", &result.sha);
}

test "rootfsCacheKey prefers valid sha256 sidecar" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "rootfs.tar.gz", .data = "hello" });
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "rootfs.tar.gz.sha256", .data = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA  rootfs.tar.gz\n" });
    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const tar = try std.fs.path.join(allocator, &.{ root, "rootfs.tar.gz" });
    defer allocator.free(tar);
    const result = try rootfsCacheKey(allocator, std.testing.io, tar);
    try std.testing.expectEqual(.sidecar, result.source);
    try std.testing.expectEqualStrings("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", &result.sha);
}

test "rootfsCacheKey ignores invalid sidecar" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "rootfs.tar.gz", .data = "hello" });
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "rootfs.tar.gz.sha256", .data = "not-a-sha\n" });
    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const tar = try std.fs.path.join(allocator, &.{ root, "rootfs.tar.gz" });
    defer allocator.free(tar);
    const result = try rootfsCacheKey(allocator, std.testing.io, tar);
    try std.testing.expectEqual(.file, result.source);
    try std.testing.expectEqualStrings("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", &result.sha);
}
