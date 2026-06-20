const std = @import("std");
const builtin = @import("builtin");

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

pub const CopyResult = struct {
    mode: CopyMode,
    primitive: CopyPrimitive,
    fallback_reason: ?[]u8 = null,
};

pub fn reflinkCopy(allocator: std.mem.Allocator, io: std.Io, src: []const u8, dst: []const u8) Error!CopyResult {
    switch (builtin.os.tag) {
        .macos => return reflinkCopyDarwin(allocator, io, src, dst),
        .linux => return reflinkCopyLinux(allocator, io, src, dst),
        else => {
            try byteCopy(io, src, dst);
            return .{ .mode = .copy, .primitive = .node_copy };
        },
    }
}

fn reflinkCopyDarwin(allocator: std.mem.Allocator, io: std.Io, src: []const u8, dst: []const u8) Error!CopyResult {
    const clone = try runProcess(allocator, io, &.{ "/bin/cp", "-c", src, dst });
    if (clone.ok) {
        return .{ .mode = .cow, .primitive = .darwin_cp_c };
    }
    const reason = try fallbackReason(allocator, "cp-c", clone);
    try byteCopy(io, src, dst);
    return .{ .mode = .copy, .primitive = .node_copy, .fallback_reason = reason };
}

fn reflinkCopyLinux(allocator: std.mem.Allocator, io: std.Io, src: []const u8, dst: []const u8) Error!CopyResult {
    const clone = try runProcess(allocator, io, &.{ "cp", "--reflink=always", src, dst });
    if (clone.ok) {
        return .{ .mode = .cow, .primitive = .node_ficlone_force };
    }
    const reason = try fallbackReason(allocator, "cp-reflink", clone);
    deleteIfExists(io, dst);

    const sparse = try runProcess(allocator, io, &.{ "cp", "--sparse=always", "--reflink=never", src, dst });
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

fn runProcess(allocator: std.mem.Allocator, io: std.Io, argv: []const []const u8) Error!ProcessResult {
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

fn fallbackReason(allocator: std.mem.Allocator, prefix: []const u8, result: ProcessResult) Error![]u8 {
    if (result.status) |status| {
        return std.fmt.allocPrint(allocator, "{s}-status-{d}", .{ prefix, status });
    }
    if (result.signal) |signal| {
        return std.fmt.allocPrint(allocator, "{s}-signal-{d}", .{ prefix, signal });
    }
    return std.fmt.allocPrint(allocator, "{s}-error", .{prefix});
}

fn byteCopy(io: std.Io, src: []const u8, dst: []const u8) Error!void {
    var in_file = try std.Io.Dir.cwd().openFile(io, src, .{ .allow_directory = false });
    defer in_file.close(io);
    var out_file = try std.Io.Dir.cwd().createFile(io, dst, .{ .truncate = true });
    defer out_file.close(io);

    var buf: [128 * 1024]u8 = undefined;
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
    std.Io.Dir.cwd().deleteFile(io, path) catch {};
}

fn tmpRootAbs(allocator: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
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
    defer if (result.fallback_reason) |reason| allocator.free(reason);

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
    defer if (result.fallback_reason) |reason| allocator.free(reason);
    try std.Io.Dir.cwd().writeFile(std.testing.io, .{ .sub_path = src, .data = "modified-after-clone" });

    const bytes = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, allocator, dst, 1024);
    defer allocator.free(bytes);
    try std.testing.expectEqualStrings("original", bytes);
}
