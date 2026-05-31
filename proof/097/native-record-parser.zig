const std = @import("std");

var g_io: std.Io = undefined;
const records = [_][]const u8{ "process.json", "maps.json", "fd-table.json", "threads.json", "tcp.json" };

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const dir = args.next() orelse "capture";
    const result_path = args.next() orelse "parser-result.json";
    var count: usize = 0;
    for (records) |record| {
        const path = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ dir, record });
        defer allocator.free(path);
        const bytes = read_file_streaming(allocator, path, 1024 * 1024) catch return try refuse(allocator, result_path, "node-proper-level5-native-record-parser-record-missing", record);
        defer allocator.free(bytes);
        if (std.mem.indexOf(u8, bytes, "machinen.real-guest-capture-record-v1") == null) return try refuse(allocator, result_path, "node-proper-level5-native-record-parser-kind-refused", record);
        if (std.mem.indexOf(u8, bytes, "proof-096-guest-capture-records-zig") == null) return try refuse(allocator, result_path, "node-proper-level5-native-record-parser-tool-refused", record);
        if (std.mem.indexOf(u8, bytes, "\"handAuthored\": false") == null) return try refuse(allocator, result_path, "node-proper-level5-native-record-parser-hand-authored-refused", record);
        count += 1;
    }
    try write_success(allocator, result_path, count);
    return 0;
}

fn refuse(allocator: std.mem.Allocator, result_path: []const u8, code: []const u8, record: []const u8) !u8 {
    const result = try std.fmt.allocPrint(allocator,
        \\
        \\{{"accepted":false,"nativeParserStarted":true,"targetStarted":false,"refusal":{{"code":"{s}","record":"{s}"}},"productSupportClaimed":false,"broadLevel5ImplementationClaimed":false}}
        \\
    , .{ code, record });
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = result_path, .data = result });
    return 1;
}

fn write_success(allocator: std.mem.Allocator, result_path: []const u8, count: usize) !void {
    const result = try std.fmt.allocPrint(allocator,
        \\
        \\{{"accepted":true,"nativeParserStarted":true,"targetStarted":false,"recordsParsed":{},"schema":"machinen.real-guest-capture-record-v1","productSupportClaimed":false,"broadLevel5ImplementationClaimed":false}}
        \\
    , .{count});
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = result_path, .data = result });
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
