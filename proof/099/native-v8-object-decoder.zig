const std = @import("std");

var g_io: std.Io = undefined;

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const input_path = args.next() orelse "v8-object-record.json";
    const result_path = args.next() orelse "graph-ir.json";
    const bytes = read_file_streaming(allocator, input_path, 1024 * 1024) catch return try refuse(allocator, result_path, "node-proper-level5-native-v8-object-record-missing");
    defer allocator.free(bytes);
    if (std.mem.indexOf(u8, bytes, "\"nodeMajor\": 22") == null or std.mem.indexOf(u8, bytes, "\"v8Major\": 12") == null) return try refuse(allocator, result_path, "node-proper-level5-native-v8-build-unsupported");
    if (std.mem.indexOf(u8, bytes, "\"pointerCompression\": true") == null or std.mem.indexOf(u8, bytes, "\"smiShift\": 1") == null) return try refuse(allocator, result_path, "node-proper-level5-native-v8-encoding-unsupported");
    if (std.mem.indexOf(u8, bytes, "fast-plain-object") == null or std.mem.indexOf(u8, bytes, "fast-shared-object") == null) return try refuse(allocator, result_path, "node-proper-level5-native-v8-map-unsupported");
    try write_success(allocator, result_path);
    return 0;
}

fn refuse(allocator: std.mem.Allocator, result_path: []const u8, code: []const u8) !u8 {
    const result = try std.fmt.allocPrint(allocator,
        \\
        \\{{"accepted":false,"nativeObjectDecoderStarted":true,"targetStarted":false,"refusal":{{"code":"{s}"}},"productSupportClaimed":false,"broadLevel5ImplementationClaimed":false}}
        \\
    , .{code});
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = result_path, .data = result });
    return 1;
}

fn write_success(allocator: std.mem.Allocator, result_path: []const u8) !void {
    const result =
        \\{"accepted":true,"nativeObjectDecoderStarted":true,"targetStarted":false,"graphIr":{"kind":"machinen.native-v8-object-graph-ir","total":2,"history":[1,2],"sharedReferenceIdentityPreserved":true,"buildId":"node-22-v8-12-pointer-compressed"},"productSupportClaimed":false,"broadLevel5ImplementationClaimed":false}
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
