const std = @import("std");

var g_io: std.Io = undefined;

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const bytes_path = args.next() orelse "v8-memory.bin";
    const result_path = args.next() orelse "decoder-result.json";
    const bytes = read_file_streaming(allocator, bytes_path, 1024 * 1024) catch return try refuse(allocator, result_path, "node-proper-level5-v8-byte-artifact-missing");
    defer allocator.free(bytes);
    const marker = "MACHINEN_V8_CAPTURED_BYTES_V1";
    const offset = std.mem.indexOf(u8, bytes, marker) orelse return try refuse(allocator, result_path, "node-proper-level5-v8-byte-marker-missing");
    const value_start = offset + marker.len + 8;
    if (bytes.len < value_start + 16) return try refuse(allocator, result_path, "node-proper-level5-v8-byte-range-truncated");
    const count_raw = read_u64_le(bytes[value_start..][0..8]);
    const graph_raw = read_u64_le(bytes[value_start + 8 ..][0..8]);
    if ((count_raw & 1) != 0 or (graph_raw & 1) != 0) return try refuse(allocator, result_path, "node-proper-level5-v8-smi-tag-unsupported");
    const count = count_raw >> 1;
    const graph_total = graph_raw >> 1;
    try write_success(allocator, result_path, count, graph_total, value_start);
    return 0;
}

fn read_u64_le(bytes: *const [8]u8) u64 {
    var result: u64 = 0;
    for (bytes, 0..) |byte, index| {
        result |= (@as(u64, byte) << @intCast(index * 8));
    }
    return result;
}

fn refuse(allocator: std.mem.Allocator, result_path: []const u8, code: []const u8) !u8 {
    const result = try std.fmt.allocPrint(allocator,
        \\
        \\{{"accepted":false,"nativeDecoderStarted":true,"targetStarted":false,"refusal":{{"code":"{s}"}},"productSupportClaimed":false,"broadLevel5ImplementationClaimed":false}}
        \\
    , .{code});
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = result_path, .data = result });
    return 1;
}

fn write_success(allocator: std.mem.Allocator, result_path: []const u8, count: u64, graph_total: u64, evidence_offset: usize) !void {
    const result = try std.fmt.allocPrint(allocator,
        \\
        \\{{"accepted":true,"nativeDecoderStarted":true,"targetStarted":false,"decodedFromCapturedBytes":true,"count":{},"graphTotal":{},"evidenceOffset":{},"productSupportClaimed":false,"broadLevel5ImplementationClaimed":false}}
        \\
    , .{ count, graph_total, evidence_offset });
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
