const std = @import("std");
var g_io: std.Io = undefined;
pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const input = args.next() orelse "threads.txt";
    const output = args.next() orelse "thread-result.json";
    const bytes = read_file_streaming(allocator, input, 1024 * 1024) catch return try refuse(allocator, output, "node-proper-level5-native-thread-procfs-missing", 0);
    defer allocator.free(bytes);
    var count: usize = 0;
    var it = std.mem.splitScalar(u8, bytes, '\n');
    while (it.next()) |line| {
        if (line.len == 0) continue;
        count += 1;
        if (std.mem.indexOf(u8, line, "state=idle") == null) return try refuse(allocator, output, "node-proper-level5-native-thread-not-idle", count);
        if (std.mem.indexOf(u8, line, "wchan=ep_poll") == null and std.mem.indexOf(u8, line, "wchan=futex_wait") == null) return try refuse(allocator, output, "node-proper-level5-native-thread-wchan-unsupported", count);
    }
    if (count == 0) return try refuse(allocator, output, "node-proper-level5-native-thread-set-empty", 0);
    const result = try std.fmt.allocPrint(allocator, "{{\"accepted\":true,\"nativeThreadVerifierStarted\":true,\"targetStarted\":false,\"threadCount\":{},\"productSupportClaimed\":false,\"broadLevel5ImplementationClaimed\":false}}", .{count});
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = output, .data = result });
    return 0;
}
fn refuse(allocator: std.mem.Allocator, output: []const u8, code: []const u8, index: usize) !u8 {
    const result = try std.fmt.allocPrint(allocator, "{{\"accepted\":false,\"nativeThreadVerifierStarted\":true,\"targetStarted\":false,\"refusal\":{{\"code\":\"{s}\",\"threadIndex\":{}}},\"productSupportClaimed\":false,\"broadLevel5ImplementationClaimed\":false}}", .{ code, index });
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
