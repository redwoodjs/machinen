const std = @import("std");
var g_io: std.Io = undefined;
pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const input = args.next() orelse "resources.txt";
    const output = args.next() orelse "resource-result.json";
    const bytes = read_file_streaming(allocator, input, 1024 * 1024) catch return try refuse(allocator, output, "node-proper-level5-native-kernel-resource-record-missing", "missing");
    defer allocator.free(bytes);
    var count: usize = 0;
    var it = std.mem.splitScalar(u8, bytes, '\n');
    while (it.next()) |line| {
        if (line.len == 0) continue;
        count += 1;
        if (std.mem.indexOf(u8, line, "sourceCopied=false") == null) return try refuse(allocator, output, "node-proper-level5-native-kernel-source-handle-copy-refused", line);
        if (std.mem.indexOf(u8, line, "safe=true") == null) return try refuse(allocator, output, "node-proper-level5-native-kernel-resource-unsafe", line);
        if (std.mem.indexOf(u8, line, "kind=tcp-listener") == null and std.mem.indexOf(u8, line, "kind=timerfd") == null and std.mem.indexOf(u8, line, "kind=pipe") == null and std.mem.indexOf(u8, line, "kind=file-ro") == null) return try refuse(allocator, output, "node-proper-level5-native-kernel-resource-kind-unsupported", line);
    }
    if (count == 0) return try refuse(allocator, output, "node-proper-level5-native-kernel-resource-set-empty", "empty");
    const result = try std.fmt.allocPrint(allocator, "{{\"accepted\":true,\"nativeKernelResourceVerifierStarted\":true,\"targetStarted\":false,\"resourceCount\":{},\"productSupportClaimed\":false,\"broadLevel5ImplementationClaimed\":false}}", .{count});
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = output, .data = result });
    return 0;
}
fn refuse(allocator: std.mem.Allocator, output: []const u8, code: []const u8, record: []const u8) !u8 {
    const result = try std.fmt.allocPrint(allocator, "{{\"accepted\":false,\"nativeKernelResourceVerifierStarted\":true,\"targetStarted\":false,\"refusal\":{{\"code\":\"{s}\",\"record\":\"{s}\"}},\"productSupportClaimed\":false,\"broadLevel5ImplementationClaimed\":false}}", .{ code, record });
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = output, .data = result });
    return 1;
}
fn read_file_streaming(allocator: std.mem.Allocator, path: []const u8, limit: usize) ![]u8 {
    var file = try std.Io.Dir.cwd().openFile(g_io, path, .{});
    defer file.close(g_io);
    var out = std.ArrayListUnmanaged(u8).empty;
    errdefer out.deinit(allocator);
    var buf: [4096]u8 = undefined;
    while (out.items.len < limit) {
        const n = file.readStreaming(g_io, &.{&buf}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => return err,
        };
        if (n == 0) break;
        try out.appendSlice(allocator, buf[0..@min(n, limit - out.items.len)]);
    }
    return try out.toOwnedSlice(allocator);
}
