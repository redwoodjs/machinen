// Reflink is the native helper behind Machinen's fast root disk copying.
//
// It copies a big disk image from `src` to `dst`, preferring copy-on-write /
// reflink when the host filesystem supports it.
//
// Why this exists:
//
// - Machinen keeps cached rootfs images as templates.
// - Each boot needs its own writable copy so guest writes do not corrupt or
//   persist into the shared cache.
// - A normal byte copy of a 2 GiB image is slow.
// - A reflink/CoW copy is almost instant because the filesystem shares blocks
//   until one copy is written.
//
// What it does:
//
// 1. On macOS:
//    - Tries `/bin/cp -c src dst`, which uses clonefile-style CoW copying.
//    - If that fails, falls back to a regular byte copy.
//
// 2. On Linux:
//    - Tries `cp --reflink=always src dst`.
//    - If that fails, tries sparse copy: `cp --sparse=always --reflink=never`.
//    - If that fails too, falls back to a native byte copy.
//
// 3. Returns structured info:
//    - `mode`: `cow` or `copy`.
//    - `primitive`: which method was used.
//    - `fallbackReason`: why it had to fall back, if applicable.
//
// In short: it makes per-boot rootdisk copies fast when possible and safe when
// not.

const std = @import("std");
const builtin = @import("builtin");

const assert = std.debug.assert;

pub const Error = anyerror;

pub const CopyMode = enum {
    cow,
    copy,
};

pub const CopyPrimitive = enum {
    darwin_cp_c,
    node_ficlone_force,
    linux_cp_sparse,
    node_copy,
};

pub const FallbackReason = struct {
    prefix: []const u8,
    status: ?u8 = null,
    signal: ?u32 = null,
};

pub const CopyResult = struct {
    mode: CopyMode,
    primitive: CopyPrimitive,
    fallback_reason: ?FallbackReason = null,
};

pub fn reflinkCopy(
    allocator: std.mem.Allocator,
    io: std.Io,
    src: []const u8,
    dst: []const u8,
) Error!CopyResult {
    assert(src.len > 0);
    assert(dst.len > 0);

    switch (builtin.os.tag) {
        .macos => return reflinkCopyDarwin(allocator, io, src, dst),
        .linux => return reflinkCopyLinux(allocator, io, src, dst),
        else => {
            try byteCopy(io, src, dst);
            return .{ .mode = .copy, .primitive = .node_copy };
        },
    }
}

fn reflinkCopyDarwin(
    allocator: std.mem.Allocator,
    io: std.Io,
    src: []const u8,
    dst: []const u8,
) Error!CopyResult {
    assert(src.len > 0);
    assert(dst.len > 0);

    const clone = try runProcess(allocator, io, &.{ "/bin/cp", "-c", src, dst });
    if (clone.ok) {
        return .{ .mode = .cow, .primitive = .darwin_cp_c };
    }
    const reason = fallbackReason("cp-c", clone);
    try byteCopy(io, src, dst);
    return .{ .mode = .copy, .primitive = .node_copy, .fallback_reason = reason };
}

fn reflinkCopyLinux(
    allocator: std.mem.Allocator,
    io: std.Io,
    src: []const u8,
    dst: []const u8,
) Error!CopyResult {
    assert(src.len > 0);
    assert(dst.len > 0);

    const clone = try runProcess(allocator, io, &.{ "cp", "--reflink=always", src, dst });
    if (clone.ok) {
        return .{ .mode = .cow, .primitive = .node_ficlone_force };
    }
    const reason = fallbackReason("cp-reflink", clone);
    deleteIfExists(io, dst);

    const sparse = try runProcess(
        allocator,
        io,
        &.{ "cp", "--sparse=always", "--reflink=never", src, dst },
    );
    if (sparse.ok) {
        return .{ .mode = .copy, .primitive = .linux_cp_sparse, .fallback_reason = reason };
    }
    deleteIfExists(io, dst);
    try byteCopy(io, src, dst);
    return .{ .mode = .copy, .primitive = .node_copy, .fallback_reason = reason };
}

const ProcessResult = struct {
    ok: bool,
    status: ?u8 = null,
    signal: ?u32 = null,
};

fn runProcess(
    allocator: std.mem.Allocator,
    io: std.Io,
    argv: []const []const u8,
) Error!ProcessResult {
    assert(argv.len > 0);

    const result = std.process.run(allocator, io, .{
        .argv = argv,
        .stdout_limit = .limited(16 * 1024),
        .stderr_limit = .limited(16 * 1024),
    }) catch |err| switch (err) {
        error.FileNotFound => return .{ .ok = false, .status = null },
        else => |e| return e,
    };
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    return switch (result.term) {
        .exited => |code| .{ .ok = code == 0, .status = code },
        .signal => |signal| .{ .ok = false, .signal = @intFromEnum(signal) },
        else => .{ .ok = false },
    };
}

fn fallbackReason(prefix: []const u8, result: ProcessResult) FallbackReason {
    assert(prefix.len > 0);
    assert(!result.ok);

    return .{
        .prefix = prefix,
        .status = result.status,
        .signal = result.signal,
    };
}

pub fn fallbackReasonText(buf: []u8, reason: FallbackReason) ![]const u8 {
    assert(buf.len > 0);
    assert(reason.prefix.len > 0);

    if (reason.status) |status| {
        return std.fmt.bufPrint(buf, "{s}-status-{d}", .{ reason.prefix, status });
    }
    if (reason.signal) |signal| {
        return std.fmt.bufPrint(buf, "{s}-signal-{d}", .{ reason.prefix, signal });
    }
    return std.fmt.bufPrint(buf, "{s}-error", .{reason.prefix});
}

fn byteCopy(io: std.Io, src: []const u8, dst: []const u8) Error!void {
    assert(src.len > 0);
    assert(dst.len > 0);

    var in_file = try std.Io.Dir.cwd().openFile(io, src, .{ .allow_directory = false });
    defer in_file.close(io);
    var out_file = try std.Io.Dir.cwd().createFile(io, dst, .{ .truncate = true });
    defer out_file.close(io);

    var buf: [128 * 1024]u8 = undefined;
    // EOF-bounded file copy; readStreaming returns EndOfStream.
    while (true) {
        const n = in_file.readStreaming(io, &.{buf[0..]}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => |e| return e,
        };
        if (n == 0) break;
        try out_file.writeStreamingAll(io, buf[0..n]);
    }
}

fn deleteIfExists(io: std.Io, path: []const u8) void {
    assert(path.len > 0);

    std.Io.Dir.cwd().deleteFile(io, path) catch |err| {
        ignoreDeleteError(err);
    };
}

fn ignoreDeleteError(err: anyerror) void {
    assert(@errorName(err).len > 0);
}

fn tmpRootAbs(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    assert(tmp.sub_path.len > 0);

    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    return std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

test "reflinkCopy copies bytes to a fresh destination" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "src.bin", .data = "hello reflink" });
    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const src = try std.fs.path.join(allocator, &.{ root, "src.bin" });
    defer allocator.free(src);
    const dst = try std.fs.path.join(allocator, &.{ root, "dst.bin" });
    defer allocator.free(dst);

    const result = try reflinkCopy(allocator, std.testing.io, src, dst);
    try std.testing.expect(result.mode == .cow or result.mode == .copy);

    const bytes = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, allocator, dst, 1024);
    defer allocator.free(bytes);
    try std.testing.expectEqualStrings("hello reflink", bytes);
}

test "reflinkCopy destination is independent of later source writes" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "src.bin", .data = "original" });
    const root = try tmpRootAbs(allocator, &tmp);
    defer allocator.free(root);
    const src = try std.fs.path.join(allocator, &.{ root, "src.bin" });
    defer allocator.free(src);
    const dst = try std.fs.path.join(allocator, &.{ root, "dst.bin" });
    defer allocator.free(dst);

    const result = try reflinkCopy(allocator, std.testing.io, src, dst);
    try std.testing.expect(result.mode == .cow or result.mode == .copy);
    try std.Io.Dir.cwd().writeFile(std.testing.io, .{
        .sub_path = src,
        .data = "modified-after-clone",
    });

    const bytes = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, allocator, dst, 1024);
    defer allocator.free(bytes);
    try std.testing.expectEqualStrings("original", bytes);
}
