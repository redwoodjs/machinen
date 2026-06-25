// Rootfs means "root filesystem".
//
// It is the filesystem mounted at `/` inside Linux. It contains the OS
// userspace that programs expect, for example:
//
// - `/bin`, `/usr/bin`: commands like `sh`, `ls`, and `cat`.
// - `/lib`, `/usr/lib`: shared libraries.
// - `/etc`: config files.
// - `/tmp`, `/var`, `/home`: writable/runtime locations.
// - Package manager files, CA certs, shells, tools, and similar OS pieces.
//
// The base image ships `fnm` so workloads can install/select Node, but `node`
// itself is not part of the guaranteed baked-in rootfs contents.
//
// In Machinen, the rootfs is the guest OS disk contents. The VM kernel boots,
// `/init` runs from the tiny initramfs, then Machinen mounts/pivots into this
// real root filesystem so the user command runs in a normal Linux environment.
//
// This file is the native machinery behind Machinen's rootfs image cache. It
// handles the heavy work for turning a shipped rootfs tarball/tree into an ext4
// disk image the VM can boot from.
//
// Main jobs:
//
// 1. Cache key
//    - Reads a `.sha256` sidecar next to the rootfs tarball when present.
//    - Otherwise hashes the tarball bytes.
//    - That SHA becomes the cache key: `<cacheDir>/<sha>.img`.
//
// 2. Materialize rootfs from tar
//    - Extracts the rootfs tarball into a staging tree.
//    - Estimates the needed ext4 image size.
//    - Creates a sparse image file.
//    - Runs `mke2fs -d <tree>` to build an ext4 filesystem image.
//    - Atomically renames it into the rootfs cache.
//
// 3. Use prebaked images
//    - Decompresses shipped `.img.gz` or `.img.zst` prebake files.
//    - Preserves large zero ranges as sparse holes.
//    - Computes the decompressed image SHA while streaming.
//
// 4. Prebake from an existing tree
//    - During provisioning/build flows, if Machinen already has an extracted
//      tree, it can build the cached ext4 image directly from that tree.
//    - This avoids paying tar-extract + mke2fs on the first boot.
//
// 5. Safety/cleanup
//    - Uses unique staging directories.
//    - Cleans staging dirs on failure.
//    - Returns timing phases so TS can report where time was spent.
//
// In short: rootfs.zig builds and caches the Linux filesystem that becomes `/`
// inside the VM, while rootfs-img.ts handles higher-level cache policy like
// clean markers, fsck, metadata, and per-boot copies.

const std = @import("std");

const assert = std.debug.assert;

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
    img_path: []const u8,
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

pub const PrebakeTreeOptions = struct {
    tar_path: []const u8,
    tree_dir: []const u8,
    cache_dir: []const u8,
    mke2fs: []const u8,
};

pub const PrebakeTreePhases = struct {
    sha256: i64 = 0,
    mke2fs: i64 = 0,
};

pub const PrebakeTreeResult = struct {
    ok: bool,
    skipped: bool = false,
    sha: ?[64]u8 = null,
    img_path: ?[]u8 = null,
    size_bytes: u64 = 0,
    phases: PrebakeTreePhases = .{},
};

pub fn materializeFromTar(
    allocator: std.mem.Allocator,
    io: std.Io,
    opts: MaterializeOptions,
) Error!MaterializeResult {
    assertMaterializeOptions(opts);
    assert(opts.sha.len > 0);

    var phases: MaterializePhases = .{};

    const staging_start = nowMs(io);
    const staging_dir = try createUniqueStagingDir(
        allocator,
        io,
        opts.cache_dir,
        opts.sha[0..@min(opts.sha.len, 12)],
        "staging",
    );
    defer allocator.free(staging_dir);
    errdefer std.Io.Dir.cwd().deleteTree(io, staging_dir) catch |err| {
        ignoreCleanupError(err);
    };
    const staging_tree = try std.fs.path.join(allocator, &.{ staging_dir, "tree" });
    defer allocator.free(staging_tree);
    try std.Io.Dir.cwd().createDir(io, staging_tree, .default_dir);
    const staging_img = try std.fs.path.join(allocator, &.{ staging_dir, "rootfs.img" });
    defer allocator.free(staging_img);
    phases.staging_create = nowMs(io) - staging_start;

    const extract_start = nowMs(io);
    try runTarExtract(allocator, io, opts.tar_abs, staging_tree);
    phases.tar_extract = nowMs(io) - extract_start;

    const size_start = nowMs(io);
    const tree_bytes = try duBytes(allocator, io, staging_tree);
    const computed_size = imageSize(
        tree_bytes,
        opts.size_multiplier,
        opts.min_size_bytes,
        opts.size_bytes,
    );
    phases.size = nowMs(io) - size_start;

    const alloc_start = nowMs(io);
    try allocateSparseFile(io, staging_img, computed_size);
    phases.sparse_allocate = nowMs(io) - alloc_start;

    const mke_start = nowMs(io);
    try runMke2fs(
        allocator,
        io,
        opts.mke2fs,
        staging_tree,
        staging_img,
        @divFloor(computed_size, 4096),
    );
    phases.mke2fs = nowMs(io) - mke_start;

    const rename_start = nowMs(io);
    try std.Io.Dir.renameAbsolute(staging_img, opts.img_path, io);
    phases.rename = nowMs(io) - rename_start;

    const cleanup_start = nowMs(io);
    std.Io.Dir.cwd().deleteTree(io, staging_dir) catch |err| {
        ignoreCleanupError(err);
    };
    phases.staging_cleanup = nowMs(io) - cleanup_start;

    return .{ .img_path = opts.img_path, .size_bytes = computed_size, .phases = phases };
}

fn assertMaterializeOptions(opts: MaterializeOptions) void {
    assert(opts.tar_abs.len > 0);
    assert(opts.cache_dir.len > 0);
    assert(opts.sha.len > 0);
    assert(opts.img_path.len > 0);
    assert(opts.mke2fs.len > 0);
    assert(opts.size_multiplier > 0);
    assert(opts.min_size_bytes > 0);
}

pub fn prebakeFromTree(
    allocator: std.mem.Allocator,
    io: std.Io,
    opts: PrebakeTreeOptions,
) Error!PrebakeTreeResult {
    assert(opts.tar_path.len > 0);
    assert(opts.tree_dir.len > 0);
    assert(opts.cache_dir.len > 0);
    assert(opts.mke2fs.len > 0);

    var phases: PrebakeTreePhases = .{};

    try std.Io.Dir.cwd().createDirPath(io, opts.cache_dir);
    const sha_start = nowMs(io);
    const sha = try sha256FileHex(io, opts.tar_path);
    phases.sha256 = nowMs(io) - sha_start;

    var img_name_buf: [80]u8 = undefined;
    const img_name = try std.fmt.bufPrint(&img_name_buf, "{s}.img", .{&sha});
    const img_path = try std.fs.path.join(allocator, &.{ opts.cache_dir, img_name });
    errdefer allocator.free(img_path);
    if (existsFile(io, img_path)) {
        return .{ .ok = true, .skipped = true, .sha = sha, .img_path = img_path, .phases = phases };
    }

    const staging_dir = try createUniqueStagingDir(
        allocator,
        io,
        opts.cache_dir,
        sha[0..12],
        "prebake-tree",
    );
    defer allocator.free(staging_dir);
    defer std.Io.Dir.cwd().deleteTree(io, staging_dir) catch |err| {
        ignoreCleanupError(err);
    };
    const staging_img = try std.fs.path.join(allocator, &.{ staging_dir, "rootfs.img" });
    defer allocator.free(staging_img);

    const tree_bytes = try duBytes(allocator, io, opts.tree_dir);
    const size_bytes = imageSize(tree_bytes, 2.5, 2 * 1024 * 1024 * 1024, null);
    try allocateSparseFile(io, staging_img, size_bytes);

    const mke_start = nowMs(io);
    runMke2fs(
        allocator,
        io,
        opts.mke2fs,
        opts.tree_dir,
        staging_img,
        @divFloor(size_bytes, 4096),
    ) catch |err| {
        phases.mke2fs = nowMs(io) - mke_start;
        switch (err) {
            error.Mke2fsFailed => return .{ .ok = false, .sha = sha, .phases = phases },
            else => |e| return e,
        }
    };
    phases.mke2fs = nowMs(io) - mke_start;

    try std.Io.Dir.renameAbsolute(staging_img, img_path, io);
    return .{
        .ok = true,
        .sha = sha,
        .img_path = img_path,
        .size_bytes = size_bytes,
        .phases = phases,
    };
}

pub fn decompressPrebake(
    allocator: std.mem.Allocator,
    io: std.Io,
    opts: PrebakeDecompressOptions,
) Error!PrebakeDecompressResult {
    assert(opts.path.len > 0);
    assert(opts.dst.len > 0);

    const argv: []const []const u8 = switch (opts.format) {
        .gz => &.{ "gunzip", "-c", opts.path },
        .zst => &.{ "zstd", "-dc", opts.path },
    };
    return sparseDecompressCommand(allocator, io, argv, opts.dst) catch |err| switch (err) {
        error.FileNotFound, error.DecompressFailed => return .{ .ok = false },
        else => |e| return e,
    };
}

pub fn rootfsCacheKey(
    allocator: std.mem.Allocator,
    io: std.Io,
    tar_path: []const u8,
) Error!CacheKeyResult {
    assert(tar_path.len > 0);

    if (try readSha256Sidecar(allocator, io, tar_path)) |sha| {
        return .{ .sha = sha, .source = .sidecar };
    }
    const sha = sha256FileHex(io, tar_path) catch |err| switch (err) {
        error.FileNotFound => return error.PathNotFound,
        else => |e| return e,
    };
    return .{ .sha = sha, .source = .file };
}

fn readSha256Sidecar(
    allocator: std.mem.Allocator,
    io: std.Io,
    tar_path: []const u8,
) Error!?[64]u8 {
    assert(tar_path.len > 0);

    var sidecar_buf: [std.fs.max_path_bytes]u8 = undefined;
    const sidecar = try std.fmt.bufPrint(&sidecar_buf, "{s}.sha256", .{tar_path});
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
    const whitespace = " \t\r\n";
    assert(whitespace.len > 0);

    const trimmed = std.mem.trim(u8, data, whitespace);
    if (trimmed.len == 0) return null;
    var it = std.mem.tokenizeAny(u8, trimmed, whitespace);
    return it.next();
}

fn sha256FileHex(io: std.Io, path: []const u8) Error![64]u8 {
    assert(path.len > 0);

    var file = try std.Io.Dir.cwd().openFile(io, path, .{ .allow_directory = false });
    defer file.close(io);

    var sha = std.crypto.hash.sha2.Sha256.init(.{});
    var buf: [64 * 1024]u8 = undefined;
    // EOF-bounded stream hash; readStreaming returns EndOfStream.
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
    assert(path.len > 0);

    return std.Io.Dir.cwd().readFileAlloc(io, path, allocator, .limited(4096));
}

fn sparseDecompressCommand(
    _: std.mem.Allocator,
    io: std.Io,
    argv: []const []const u8,
    dst: []const u8,
) Error!PrebakeDecompressResult {
    assert(argv.len > 0);
    assert(dst.len > 0);

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
    var trailing_zero_chunk = false;
    var buf: [128 * 1024]u8 = undefined;
    // EOF-bounded decompression stream; readStreaming returns EndOfStream.
    while (true) {
        const n = stdout.readStreaming(io, &.{buf[0..]}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => |e| return e,
        };
        if (n == 0) break;
        sha.update(buf[0..n]);
        trailing_zero_chunk = isAllZero(buf[0..n]);
        if (!trailing_zero_chunk) {
            try out_file.writePositionalAll(io, buf[0..n], offset);
        }
        offset += n;
    }
    if (offset > 0 and trailing_zero_chunk) {
        const zero = [_]u8{0};
        try out_file.writePositionalAll(io, &zero, offset - 1);
    }

    const term = try child.wait(io);
    switch (term) {
        .exited => |code| if (code != 0) return error.DecompressFailed,
        else => return error.DecompressFailed,
    }

    var digest: [32]u8 = undefined;
    sha.final(&digest);
    return .{ .ok = true, .sha256 = hexDigest(digest) };
}

fn createUniqueStagingDir(
    allocator: std.mem.Allocator,
    io: std.Io,
    cache_dir: []const u8,
    prefix: []const u8,
    label: []const u8,
) Error![]u8 {
    assert(cache_dir.len > 0);
    assert(prefix.len > 0);
    assert(label.len > 0);

    var attempt: u8 = 0;
    while (attempt < 64) : (attempt += 1) {
        var name_buf: [128]u8 = undefined;
        const name = try std.fmt.bufPrint(&name_buf, "{s}-{s}-{d}-{d}", .{
            prefix,
            label,
            nowNs(io),
            attempt,
        });
        const path = try std.fs.path.join(allocator, &.{ cache_dir, name });
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

fn existsFile(io: std.Io, path: []const u8) bool {
    assert(path.len > 0);

    const st = std.Io.Dir.cwd().statFile(io, path, .{
        .follow_symlinks = false,
    }) catch return false;
    return st.kind == .file;
}

fn isAllZero(bytes: []const u8) bool {
    assert(bytes.len > 0);

    for (bytes) |b| {
        if (b != 0) return false;
    }
    return true;
}

fn ignoreCleanupError(err: anyerror) void {
    assert(@errorName(err).len > 0);
}

fn imageSize(
    tree_bytes: u64,
    multiplier: f64,
    min_size_bytes: u64,
    explicit_size_bytes: ?u64,
) u64 {
    assert(multiplier > 0);
    assert(min_size_bytes > 0);

    if (explicit_size_bytes) |size| return size;
    const scaled = @as(
        u64,
        @intFromFloat(@ceil(@as(f64, @floatFromInt(tree_bytes)) * multiplier)),
    );
    return @max(min_size_bytes, scaled);
}

fn runTarExtract(
    allocator: std.mem.Allocator,
    io: std.Io,
    tar_abs: []const u8,
    dest: []const u8,
) Error!void {
    assert(tar_abs.len > 0);
    assert(dest.len > 0);

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

fn runMke2fs(
    allocator: std.mem.Allocator,
    io: std.Io,
    mke2fs: []const u8,
    staging_tree: []const u8,
    staging_img: []const u8,
    blocks: u64,
) Error!void {
    assert(mke2fs.len > 0);
    assert(staging_tree.len > 0);
    assert(staging_img.len > 0);
    assert(blocks > 0);

    var blocks_buf: [32]u8 = undefined;
    const blocks_text = try std.fmt.bufPrint(&blocks_buf, "{d}", .{blocks});
    const result = try std.process.run(allocator, io, .{
        .argv = &.{
            mke2fs,
            "-d",
            staging_tree,
            "-t",
            "ext4",
            "-F",
            "-q",
            "-b",
            "4096",
            staging_img,
            blocks_text,
        },
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
    assert(path.len > 0);
    assert(size_bytes > 0);

    var file = try std.Io.Dir.cwd().createFile(io, path, .{ .truncate = true });
    defer file.close(io);
    const zero = [_]u8{0};
    try file.writePositionalAll(io, &zero, size_bytes - 1);
}

fn duBytes(allocator: std.mem.Allocator, io: std.Io, root: []const u8) Error!u64 {
    assert(root.len > 0);

    const result = std.process.run(allocator, io, .{
        .argv = &.{ "du", "-sk", root },
        .stdout_limit = .limited(16 * 1024),
        .stderr_limit = .limited(16 * 1024),
    }) catch return fallbackDuBytes(io, root);
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);

    switch (result.term) {
        .exited => |code| if (code != 0) return fallbackDuBytes(io, root),
        else => return fallbackDuBytes(io, root),
    }
    const token = firstWhitespaceToken(result.stdout) orelse return fallbackDuBytes(io, root);
    const kib = std.fmt.parseInt(u64, token, 10) catch return fallbackDuBytes(io, root);
    if (kib == 0) return fallbackDuBytes(io, root);
    return try std.math.mul(u64, kib, 1024);
}

fn fallbackDuBytes(io: std.Io, root: []const u8) Error!u64 {
    assert(root.len > 0);

    const st = try std.Io.Dir.cwd().statFile(io, root, .{ .follow_symlinks = false });
    return @max(1, @as(u64, @intCast(st.size)));
}

fn nowMs(io: std.Io) i64 {
    assert(std.time.ns_per_ms > 0);

    return @intCast(@divFloor(nowNs(io), std.time.ns_per_ms));
}

fn nowNs(io: std.Io) i96 {
    return std.Io.Clock.awake.now(io).nanoseconds;
}

fn hexDigest(digest: [32]u8) [64]u8 {
    assert(digest.len == 32);

    var out: [64]u8 = undefined;
    const digits = "0123456789abcdef";
    for (digest, 0..) |byte, i| {
        out[i * 2] = digits[(byte >> 4) & 0xf];
        out[i * 2 + 1] = digits[byte & 0xf];
    }
    return out;
}

fn tmpRootAbs(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    assert(tmp.sub_path.len > 0);

    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

test "prebakeFromTree builds cache image and skips existing image" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "rootfs.tar.gz", .data = "tarball" });
    try tmp.dir.createDir(std.testing.io, "tree", .default_dir);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "tree/file.txt", .data = "hello" });
    try tmp.dir.createDir(std.testing.io, "cache", .default_dir);
    var fake = try tmp.dir.createFile(
        std.testing.io,
        "mke2fs",
        .{ .permissions = .executable_file },
    );
    try fake.writeStreamingAll(std.testing.io,
        \\#!/bin/sh
        \\img="$9"
        \\: > "$img"
        \\dd if=/dev/zero of="$img" bs=1 count=0 seek=2048 2>/dev/null
        \\printf '\123\357' | dd of="$img" bs=1 seek=1080 conv=notrunc 2>/dev/null
        \\exit 0
        \\
    );
    fake.close(std.testing.io);

    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const tar = try std.fs.path.join(allocator, &.{ root, "rootfs.tar.gz" });
    defer allocator.free(tar);
    const tree = try std.fs.path.join(allocator, &.{ root, "tree" });
    defer allocator.free(tree);
    const cache = try std.fs.path.join(allocator, &.{ root, "cache" });
    defer allocator.free(cache);
    const mke2fs = try std.fs.path.join(allocator, &.{ root, "mke2fs" });
    defer allocator.free(mke2fs);

    const result = try prebakeFromTree(allocator, std.testing.io, .{
        .tar_path = tar,
        .tree_dir = tree,
        .cache_dir = cache,
        .mke2fs = mke2fs,
    });
    defer if (result.img_path) |img_path| allocator.free(img_path);
    try std.testing.expect(result.ok);
    try std.testing.expect(!result.skipped);
    const prebake_sha =
        "db4b4d0d1cb480bf9aeea253771c00febe627f236765fa37d6a5614f079a3aa0";
    try std.testing.expectEqualStrings(prebake_sha, &result.sha.?);
    try std.testing.expect(result.img_path != null);
    const st = try std.Io.Dir.cwd().statFile(std.testing.io, result.img_path.?, .{});
    try std.testing.expect(st.size >= 2048);

    const skipped = try prebakeFromTree(allocator, std.testing.io, .{
        .tar_path = tar,
        .tree_dir = tree,
        .cache_dir = cache,
        .mke2fs = mke2fs,
    });
    defer if (skipped.img_path) |img_path| allocator.free(img_path);
    try std.testing.expect(skipped.ok);
    try std.testing.expect(skipped.skipped);
}

test "prebakeFromTree removes staging directory when mke2fs fails" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "rootfs.tar.gz", .data = "tarball" });
    try tmp.dir.createDir(std.testing.io, "tree", .default_dir);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "tree/file.txt", .data = "hello" });
    try tmp.dir.createDir(std.testing.io, "cache", .default_dir);
    var fake = try tmp.dir.createFile(
        std.testing.io,
        "mke2fs",
        .{ .permissions = .executable_file },
    );
    try fake.writeStreamingAll(std.testing.io,
        \\#!/bin/sh
        \\exit 1
        \\
    );
    fake.close(std.testing.io);

    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const tar = try std.fs.path.join(allocator, &.{ root, "rootfs.tar.gz" });
    defer allocator.free(tar);
    const tree = try std.fs.path.join(allocator, &.{ root, "tree" });
    defer allocator.free(tree);
    const cache = try std.fs.path.join(allocator, &.{ root, "cache" });
    defer allocator.free(cache);
    const mke2fs = try std.fs.path.join(allocator, &.{ root, "mke2fs" });
    defer allocator.free(mke2fs);

    const result = try prebakeFromTree(
        allocator,
        std.testing.io,
        .{ .tar_path = tar, .tree_dir = tree, .cache_dir = cache, .mke2fs = mke2fs },
    );
    try std.testing.expect(!result.ok);
    try std.testing.expect(result.sha != null);

    var cache_dir = try std.Io.Dir.cwd().openDir(std.testing.io, cache, .{ .iterate = true });
    defer cache_dir.close(std.testing.io);
    var it = cache_dir.iterateAssumeFirstIteration();
    while (try it.next(std.testing.io)) |entry| {
        if (std.mem.indexOf(u8, entry.name, "prebake-tree") != null) {
            return error.StagingDirectoryLeaked;
        }
    }
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
    try tmp.dir.writeFile(std.testing.io, .{
        .sub_path = "rootfs.img.gz",
        .data = gzip_result.stdout,
    });

    const result = try decompressPrebake(allocator, std.testing.io, .{
        .path = gz,
        .dst = out,
        .format = .gz,
    });
    try std.testing.expect(result.ok);
    try std.testing.expect(result.sha256 != null);
    const bytes = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, allocator, out, 1024 * 1024);
    defer allocator.free(bytes);
    try std.testing.expectEqualStrings(raw, bytes);
    const decompressed_sha =
        "90990ba2fa6430a8f8d65a2a445c1c53a19e01e9561e6d0c6057c4608bc39762";
    try std.testing.expectEqualStrings(decompressed_sha, &result.sha256.?);
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
    const hello_sha = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    try std.testing.expectEqualStrings(hello_sha, &result.sha);
}

test "rootfsCacheKey prefers valid sha256 sidecar" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "rootfs.tar.gz", .data = "hello" });
    try tmp.dir.writeFile(std.testing.io, .{
        .sub_path = "rootfs.tar.gz.sha256",
        .data = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA  rootfs.tar.gz\n",
    });
    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const tar = try std.fs.path.join(allocator, &.{ root, "rootfs.tar.gz" });
    defer allocator.free(tar);
    const result = try rootfsCacheKey(allocator, std.testing.io, tar);
    try std.testing.expectEqual(.sidecar, result.source);
    const sidecar_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    try std.testing.expectEqualStrings(sidecar_sha, &result.sha);
}

test "rootfsCacheKey ignores invalid sidecar" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "rootfs.tar.gz", .data = "hello" });
    try tmp.dir.writeFile(std.testing.io, .{
        .sub_path = "rootfs.tar.gz.sha256",
        .data = "not-a-sha\n",
    });
    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const tar = try std.fs.path.join(allocator, &.{ root, "rootfs.tar.gz" });
    defer allocator.free(tar);
    const result = try rootfsCacheKey(allocator, std.testing.io, tar);
    try std.testing.expectEqual(.file, result.source);
    const hello_sha = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    try std.testing.expectEqualStrings(hello_sha, &result.sha);
}
