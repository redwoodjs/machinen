const std = @import("std");

var g_io: std.Io = undefined;

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const result_path = args.next() orelse "/tmp/machinen-proof-029-result.json";

    const result =
        \\
        \\{
        \\  "kind": "machinen.node-proper-level5-native-materializer-scaffold",
        \\  "targetNativeMaterializerStarted": true,
        \\  "controlledJsLoaderUsed": false,
        \\  "accepted": false,
        \\  "refusal": {
        \\    "code": "node-proper-level5-native-materializer-not-implemented",
        \\    "message": "native V8/libuv materialization boundary is scaffolded but not implemented"
        \\  },
        \\  "selectedStateCounterDescriptorUsed": false,
        \\  "appExportImportUsed": false,
        \\  "sourceIsaEmulationUsed": false,
        \\  "sidecarOutputUsed": false,
        \\  "metadataOnlySuccess": false
        \\}
        \\
    ;

    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = result_path, .data = result });
    try stdout(allocator, "native materializer scaffold wrote {s}\n", .{result_path});
    return 0;
}

fn stdout(allocator: std.mem.Allocator, comptime fmt: []const u8, args: anytype) !void {
    const text = try std.fmt.allocPrint(allocator, fmt, args);
    defer allocator.free(text);
    try std.Io.File.stdout().writeStreamingAll(g_io, text);
}
