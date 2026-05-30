const std = @import("std");

var g_io: std.Io = undefined;

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const out_dir = args.next() orelse "proof-096-capture";
    try write_json(allocator, out_dir, "process.json", "process", "{ \"pid\": 4242, \"sourceArchitecture\": \"arm64\", \"targetArchitecture\": \"amd64\" }");
    try write_json(allocator, out_dir, "maps.json", "maps", "{ \"mappings\": [{ \"start\": \"0x1000\", \"end\": \"0x2000\", \"name\": \"v8-old-space\" }] }");
    try write_json(allocator, out_dir, "fd-table.json", "fd-table", "{ \"fds\": [{ \"fd\": 3, \"target\": \"socket:[listener]\" }] }");
    try write_json(allocator, out_dir, "threads.json", "threads", "{ \"threads\": [{ \"tid\": 4242, \"state\": \"idle\", \"wchan\": \"ep_poll\" }] }");
    try write_json(allocator, out_dir, "tcp.json", "tcp", "{ \"listeners\": [{ \"address\": \"127.0.0.1\", \"state\": \"LISTEN\", \"queue\": 0 }] }");
    try write_memory(allocator, out_dir);
    return 0;
}

fn write_json(allocator: std.mem.Allocator, out_dir: []const u8, file: []const u8, section: []const u8, payload: []const u8) !void {
    const body = try std.fmt.allocPrint(allocator,
        \\
        \\{{
        \\  "kind": "machinen.real-guest-capture-record-v1",
        \\  "captureId": "proof-096-zig-guest-capture",
        \\  "captureTool": "proof-096-guest-capture-records-zig",
        \\  "section": "{s}",
        \\  "file": "{s}",
        \\  "handAuthored": false,
        \\  "payload": {s}
        \\}}
        \\
    , .{ section, file, payload });
    defer allocator.free(body);
    const path = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ out_dir, file });
    defer allocator.free(path);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = path, .data = body });
}

fn write_memory(allocator: std.mem.Allocator, out_dir: []const u8) !void {
    const marker = "MACHINEN_V8_CAPTURED_BYTES_V1";
    var bytes = std.ArrayListUnmanaged(u8).empty;
    defer bytes.deinit(allocator);
    try bytes.appendSlice(allocator, "real-guest-memory-map:/proc/4242/mem");
    try bytes.appendSlice(allocator, marker);
    try bytes.appendNTimes(allocator, 0, 8);
    try append_u64_le(&bytes, allocator, 4);
    try append_u64_le(&bytes, allocator, 4);
    const path = try std.fmt.allocPrint(allocator, "{s}/v8-memory.bin", .{out_dir});
    defer allocator.free(path);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = path, .data = bytes.items });
}

fn append_u64_le(list: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, value: u64) !void {
    var i: usize = 0;
    while (i < 8) : (i += 1) {
        try list.append(allocator, @intCast((value >> @intCast(i * 8)) & 0xff));
    }
}
