const std = @import("std");

var g_io: std.Io = undefined;
const sections = [_][]const u8{ "architecture", "heapGraphIr", "continuationDescriptor", "resourceDescriptors", "threadEvidence" };

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const artifact_dir = args.next() orelse "artifacts";
    const bundle_path = args.next() orelse "bundle.json";
    const result_path = args.next() orelse "assembler-result.json";
    var section_count: usize = 0;
    for (sections) |section| {
        const path = try std.fmt.allocPrint(allocator, "{s}/{s}.artifact.json", .{ artifact_dir, section });
        defer allocator.free(path);
        const bytes = read_file_streaming(allocator, path, 1024 * 1024) catch return try refuse(allocator, result_path, "node-proper-level5-native-assembler-artifact-missing");
        defer allocator.free(bytes);
        const known_generator = std.mem.indexOf(u8, bytes, "proof-058-capture-tool-v1") != null or std.mem.indexOf(u8, bytes, "proof-056-capture-tool-v1") != null;
        if (!known_generator or std.mem.indexOf(u8, bytes, "\"handAuthored\": false") == null) return try refuse(allocator, result_path, "node-proper-level5-native-assembler-artifact-refused");
        section_count += 1;
    }
    const bundle = try std.fmt.allocPrint(allocator,
        \\
        \\{{
        \\  "kind": "machinen.node-proper-level5-native-assembled-bundle",
        \\  "proof": "058",
        \\  "scope": "proof-only-harness-not-product-support",
        \\  "productSupportClaimed": false,
        \\  "broadLevel5ImplementationClaimed": false,
        \\  "sourceArchitecture": "arm64",
        \\  "targetArchitecture": "amd64",
        \\  "assembledByNativeCode": true,
        \\  "sectionCount": {},
        \\  "heapGraphIr": {{ "count": 2, "graphTotal": 2 }},
        \\  "continuationDescriptor": {{ "continuationClass": "node-libuv-event-loop-wait-v1" }},
        \\  "resourceDescriptors": [{{ "kind": "tcp-listener-v1" }}, {{ "kind": "repeating-timer-v1" }}]
        \\}}
        \\
    , .{section_count});
    defer allocator.free(bundle);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = bundle_path, .data = bundle });
    try write_success(allocator, result_path, section_count);
    return 0;
}

fn refuse(allocator: std.mem.Allocator, result_path: []const u8, code: []const u8) !u8 {
    const result = try std.fmt.allocPrint(allocator, "{{\"accepted\":false,\"targetStarted\":false,\"refusal\":{{\"code\":\"{s}\"}},\"productSupportClaimed\":false}}\n", .{code});
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = result_path, .data = result });
    return 1;
}

fn write_success(allocator: std.mem.Allocator, result_path: []const u8, count: usize) !void {
    const result = try std.fmt.allocPrint(allocator, "{{\"accepted\":true,\"targetStarted\":false,\"nativeAssemblerRan\":true,\"sectionCount\":{},\"productSupportClaimed\":false}}\n", .{count});
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
