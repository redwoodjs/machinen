const std = @import("std");

pub const Error = error{
    PathNotFound,
} || std.mem.Allocator.Error || std.Io.File.OpenError || std.Io.File.ReadStreamingError;

pub const CacheKeySource = enum {
    sidecar,
    file,
};

pub const CacheKeyResult = struct {
    sha: [64]u8,
    source: CacheKeySource,
};

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
