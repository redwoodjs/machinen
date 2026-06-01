const std = @import("std");

var g_io: std.Io = undefined;
const max_map_bytes: usize = 4 * 1024 * 1024;
const active_marker = "machinen-level5-active-http-request-live-v1";
const partial_socket_marker = "machinen-level5-partial-socket-live-v1";
const listener_marker = "machinen-level5-libuv-tcp-listener-v1";
const timer_marker = "machinen-level5-libuv-repeating-timer-v1";
const counter_anchor = "machinen-level5-v8-context-anchor-v1";

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const out_root = args.next() orelse "/mnt/work/machinen-proper-level5-source-state";
    const pid_arg = args.next();

    const pid = if (pid_arg) |raw| @as(std.posix.pid_t, @intCast(try std.fmt.parseInt(i32, raw, 10))) else try find_node_pid(allocator);
    try std.posix.kill(pid, std.posix.SIG.STOP);
    defer std.posix.kill(pid, std.posix.SIG.CONT) catch {};

    std.Io.Dir.cwd().deleteTree(g_io, out_root) catch {};
    try std.Io.Dir.cwd().createDirPath(g_io, try std.fmt.allocPrint(allocator, "{s}/memory", .{out_root}));

    const maps_path = try std.fmt.allocPrint(allocator, "/proc/{d}/maps", .{pid});
    const maps = try read_file_streaming(allocator, maps_path, 16 * 1024 * 1024);
    defer allocator.free(maps);
    try write_out(allocator, out_root, "maps.txt", maps);
    try copy_proc_file(allocator, out_root, pid, "status");
    try copy_proc_file(allocator, out_root, pid, "stat");
    try copy_proc_file(allocator, out_root, pid, "cmdline");
    try copy_proc_file(allocator, out_root, pid, "environ");
    try copy_proc_file(allocator, out_root, pid, "auxv");
    try copy_file_abs(allocator, out_root, "/proc/net/tcp", "proc-net-tcp.txt");
    try copy_file_abs(allocator, out_root, "/proc/net/tcp6", "proc-net-tcp6.txt");
    try write_fd_table(allocator, out_root, pid);

    const mem_path = try std.fmt.allocPrint(allocator, "/proc/{d}/mem", .{pid});
    var mem_file = try std.Io.Dir.cwd().openFile(g_io, mem_path, .{});
    defer mem_file.close(g_io);

    var accepted = std.ArrayListUnmanaged(u8).empty;
    defer accepted.deinit(allocator);
    var active_found = false;
    var counter_anchor_found = false;
    var partial_socket_found = false;
    var listener_found = false;
    var timer_found = false;
    var source_found = false;
    var accepted_count: usize = 0;

    var line_it = std.mem.splitScalar(u8, maps, '\n');
    var map_index: usize = 0;
    while (line_it.next()) |line| : (map_index += 1) {
        const parsed = parse_map_line(line) orelse continue;
        if (!accept_mapping(parsed)) continue;
        const size: usize = @intCast(parsed.end - parsed.start);
        const bytes = try allocator.alloc(u8, size);
        defer allocator.free(bytes);
        const read = mem_file.readPositional(g_io, &.{bytes}, parsed.start) catch continue;
        const got = bytes[0..read];
        const rel = try std.fmt.allocPrint(allocator, "memory/map-{d:0>4}-{x}-{x}.bin", .{ map_index, parsed.start, parsed.end });
        const abs = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ out_root, rel });
        var out = try std.Io.Dir.cwd().createFile(g_io, abs, .{ .read = true, .truncate = true });
        defer out.close(g_io);
        try out.writeStreamingAll(g_io, got);
        try append_line(allocator, &accepted, "{d}\t0x{x}\t0x{x}\t{d}\t{s}\t{s}\n", .{ map_index, parsed.start, parsed.end, read, rel, parsed.path });
        accepted_count += 1;
        active_found = active_found or std.mem.indexOf(u8, got, active_marker) != null;
        partial_socket_found = partial_socket_found or std.mem.indexOf(u8, got, partial_socket_marker) != null;
        listener_found = listener_found or std.mem.indexOf(u8, got, listener_marker) != null;
        timer_found = timer_found or std.mem.indexOf(u8, got, timer_marker) != null;
        counter_anchor_found = counter_anchor_found or std.mem.indexOf(u8, got, counter_anchor) != null;
        source_found = source_found or std.mem.indexOf(u8, got, "let count = 0;") != null;
    }
    try write_out(allocator, out_root, "accepted-mappings.tsv", accepted.items);

    const markers = try std.fmt.allocPrint(allocator,
        \\
        \\{{"pid":{d},"activeHttpRequestDetected":{},"partialSocketStateDetected":{},"listenerMarkerFound":{},"timerMarkerFound":{},"counterAnchorFound":{},"sourceCounterTextFound":{},"acceptedMappings":{d}}}
        \\
    , .{ pid, active_found, partial_socket_found, listener_found, timer_found, counter_anchor_found, source_found, accepted_count });
    try write_out(allocator, out_root, "capture-markers.json", markers);
    try stdout("ok\n");
    return 0;
}

const MapLine = struct { start: u64, end: u64, perms: []const u8, path: []const u8 };

fn parse_map_line(line: []const u8) ?MapLine {
    var it = std.mem.tokenizeAny(u8, line, " ");
    const range = it.next() orelse return null;
    const perms = it.next() orelse return null;
    _ = it.next();
    _ = it.next();
    _ = it.next();
    const path = it.next() orelse "";
    const dash = std.mem.indexOfScalar(u8, range, '-') orelse return null;
    const start = std.fmt.parseInt(u64, range[0..dash], 16) catch return null;
    const end = std.fmt.parseInt(u64, range[dash + 1 ..], 16) catch return null;
    return .{ .start = start, .end = end, .perms = perms, .path = path };
}

fn accept_mapping(m: MapLine) bool {
    const size = m.end - m.start;
    return std.mem.indexOfScalar(u8, m.perms, 'r') != null and
        std.mem.indexOfScalar(u8, m.perms, 'w') != null and
        std.mem.indexOfScalar(u8, m.perms, 'p') != null and
        size <= max_map_bytes and
        (m.path.len == 0 or std.mem.eql(u8, m.path, "[heap]") or std.mem.eql(u8, m.path, "[stack]"));
}

fn find_node_pid(allocator: std.mem.Allocator) !std.posix.pid_t {
    var proc = try std.Io.Dir.cwd().openDir(g_io, "/proc", .{ .iterate = true });
    defer proc.close(g_io);
    var it = proc.iterate();
    while (try it.next(g_io)) |entry| {
        if (!all_digits(entry.name)) continue;
        const cmd_path = try std.fmt.allocPrint(allocator, "/proc/{s}/cmdline", .{entry.name});
        const cmd = read_file_streaming(allocator, cmd_path, 8192) catch continue;
        defer allocator.free(cmd);
        if (std.mem.indexOf(u8, cmd, "native-libuv-resource-counter.mjs") != null) {
            const raw = try std.fmt.parseInt(i32, entry.name, 10);
            return @intCast(raw);
        }
    }
    return error.MissingNodePid;
}

fn write_fd_table(allocator: std.mem.Allocator, out_root: []const u8, pid: std.posix.pid_t) !void {
    const fd_dir_path = try std.fmt.allocPrint(allocator, "/proc/{d}/fd", .{pid});
    var dir = try std.Io.Dir.cwd().openDir(g_io, fd_dir_path, .{ .iterate = true });
    defer dir.close(g_io);
    var rows = std.ArrayListUnmanaged(u8).empty;
    defer rows.deinit(allocator);
    var it = dir.iterate();
    while (try it.next(g_io)) |entry| {
        var target_buf: [1024]u8 = undefined;
        const link_path = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ fd_dir_path, entry.name });
        const n = std.Io.Dir.cwd().readLink(g_io, link_path, &target_buf) catch 0;
        try append_line(allocator, &rows, "{s}\t{s}\n", .{ entry.name, target_buf[0..n] });
    }
    try write_out(allocator, out_root, "fd-table.tsv", rows.items);
}

fn copy_proc_file(allocator: std.mem.Allocator, out_root: []const u8, pid: std.posix.pid_t, name: []const u8) !void {
    const src = try std.fmt.allocPrint(allocator, "/proc/{d}/{s}", .{ pid, name });
    try copy_file_abs(allocator, out_root, src, try std.fmt.allocPrint(allocator, "proc-{s}", .{name}));
}

fn copy_file_abs(allocator: std.mem.Allocator, out_root: []const u8, src: []const u8, dst_name: []const u8) !void {
    const data = read_file_streaming(allocator, src, 16 * 1024 * 1024) catch return;
    defer allocator.free(data);
    try write_out(allocator, out_root, dst_name, data);
}

fn read_file_streaming(allocator: std.mem.Allocator, path: []const u8, limit: usize) ![]u8 {
    var file = try std.Io.Dir.cwd().openFile(g_io, path, .{});
    defer file.close(g_io);
    var out = std.ArrayListUnmanaged(u8).empty;
    errdefer out.deinit(allocator);
    var buf: [8192]u8 = undefined;
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

fn write_out(allocator: std.mem.Allocator, out_root: []const u8, name: []const u8, data: []const u8) !void {
    const out = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ out_root, name });
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = out, .data = data });
}

fn append_line(allocator: std.mem.Allocator, list: *std.ArrayListUnmanaged(u8), comptime fmt: []const u8, args: anytype) !void {
    const line = try std.fmt.allocPrint(allocator, fmt, args);
    defer allocator.free(line);
    try list.appendSlice(allocator, line);
}

fn all_digits(s: []const u8) bool {
    if (s.len == 0) return false;
    for (s) |c| if (c < '0' or c > '9') return false;
    return true;
}

fn stdout(s: []const u8) !void {
    try std.Io.File.stdout().writeStreamingAll(g_io, s);
}
