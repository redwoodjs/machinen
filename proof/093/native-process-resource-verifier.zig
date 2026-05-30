const std = @import("std");

var g_io: std.Io = undefined;

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const evidence_path = args.next() orelse "process-resource-evidence.json";
    const result_path = args.next() orelse "verifier-result.json";
    const evidence = read_file_streaming(allocator, evidence_path, 1024 * 1024) catch return try refuse(allocator, result_path, "node-proper-level5-native-process-evidence-missing", "evidence", "path");
    defer allocator.free(evidence);
    if (std.mem.indexOf(u8, evidence, "\"allThreadsSafe\": true") == null) return try refuse(allocator, result_path, "node-proper-level5-native-thread-set-unsafe", "threads", "allThreadsSafe");
    if (std.mem.indexOf(u8, evidence, "\"resourcesSafe\": true") == null) return try refuse(allocator, result_path, "node-proper-level5-native-resource-set-unsafe", "resources", "resourcesSafe");
    if (std.mem.indexOf(u8, evidence, "\"sourceHandleCopied\": true") != null) return try refuse(allocator, result_path, "node-proper-level5-native-source-handle-copy-refused", "resources", "sourceHandleCopied");
    if (std.mem.indexOf(u8, evidence, "node-libuv-event-loop-wait-v1") == null) return try refuse(allocator, result_path, "node-proper-level5-native-continuation-descriptor-missing", "threads", "continuationDescriptor");
    try write_success(allocator, result_path);
    return 0;
}

fn refuse(allocator: std.mem.Allocator, result_path: []const u8, code: []const u8, section: []const u8, field: []const u8) !u8 {
    const result = try std.fmt.allocPrint(allocator,
        \\
        \\{{"accepted":false,"nativeVerifierStarted":true,"targetStarted":false,"refusal":{{"code":"{s}","section":"{s}","field":"{s}","evidencePath":"process-resource-evidence.json"}},"productSupportClaimed":false,"broadLevel5ImplementationClaimed":false}}
        \\
    , .{ code, section, field });
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = result_path, .data = result });
    return 1;
}

fn write_success(allocator: std.mem.Allocator, result_path: []const u8) !void {
    const result =
        \\{"accepted":true,"nativeVerifierStarted":true,"targetStarted":false,"allThreadsSafe":true,"resourcesSafe":true,"sourceHandleCopied":false,"productSupportClaimed":false,"broadLevel5ImplementationClaimed":false}
        \\
    ;
    _ = allocator;
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
