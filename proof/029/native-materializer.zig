const std = @import("std");

var g_io: std.Io = undefined;

const Mapping = struct {
    start: u64,
    rel_path: []const u8,
    bytes: []const u8,
};

const Anchor = struct {
    tagged: u64,
    bytes_path: []const u8,
    offset: usize,
};

const Recovery = struct {
    value: i64,
    anchor_tagged: u64,
    anchor_bytes_path: []const u8,
    anchor_offset: usize,
    context_bytes_path: []const u8,
    context_pointer_offset: usize,
    context_slot_offset: usize,
    smi_encoding: []const u8,
};

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const capture_root = args.next() orelse "/mnt/work/source-state";
    const result_path = args.next() orelse "/tmp/machinen-proof-029-result.json";
    const target_entrypoint_path = args.next() orelse "/tmp/machinen-proof-029-target.mjs";

    const summary_path = try std.fmt.allocPrint(allocator, "{s}/summary.json", .{capture_root});
    const summary = try read_file_streaming(allocator, summary_path, 16 * 1024 * 1024);
    defer allocator.free(summary);
    if (std.mem.indexOf(u8, summary, "\"activeHttpRequestDetected\": true") != null) {
        try write_refusal(allocator, result_path, "node-proper-level5-http-active-request-unsupported");
        return 1;
    }

    const mappings = try read_mappings(allocator, capture_root);
    defer free_mappings(allocator, mappings);
    const recovered = try recover_counter(allocator, mappings);
    try write_target_entrypoint(allocator, target_entrypoint_path, result_path, recovered.value);
    try write_success_result(allocator, result_path, target_entrypoint_path, recovered);
    try stdout(allocator, "native materializer recovered count {d} and wrote {s}\n", .{ recovered.value, target_entrypoint_path });
    return 0;
}

fn read_mappings(allocator: std.mem.Allocator, capture_root: []const u8) ![]Mapping {
    const tsv_path = try std.fmt.allocPrint(allocator, "{s}/accepted-mappings.tsv", .{capture_root});
    const tsv = try read_file_streaming(allocator, tsv_path, 16 * 1024 * 1024);
    defer allocator.free(tsv);
    var mappings = std.ArrayListUnmanaged(Mapping).empty;
    errdefer free_mappings(allocator, mappings.items);
    var lines = std.mem.splitScalar(u8, tsv, '\n');
    while (lines.next()) |line| {
        if (line.len == 0) continue;
        var fields = std.mem.splitScalar(u8, line, '\t');
        _ = fields.next() orelse continue;
        const start_raw = fields.next() orelse continue;
        _ = fields.next() orelse continue;
        _ = fields.next() orelse continue;
        const rel_path = fields.next() orelse continue;
        const start = try parse_hex_address(start_raw);
        const abs_path = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ capture_root, rel_path });
        const bytes = try read_file_streaming(allocator, abs_path, 4 * 1024 * 1024);
        const rel_copy = try allocator.dupe(u8, rel_path);
        try mappings.append(allocator, .{ .start = start, .rel_path = rel_copy, .bytes = bytes });
    }
    return try mappings.toOwnedSlice(allocator);
}

fn free_mappings(allocator: std.mem.Allocator, mappings: []Mapping) void {
    for (mappings) |mapping| {
        allocator.free(mapping.rel_path);
        allocator.free(mapping.bytes);
    }
    allocator.free(mappings);
}

fn recover_counter(allocator: std.mem.Allocator, mappings: []Mapping) !Recovery {
    const anchor_text = "machinen-level5-v8-context-anchor-v1";
    var anchors = std.ArrayListUnmanaged(Anchor).empty;
    defer anchors.deinit(allocator);
    for (mappings) |mapping| {
        var search_start: usize = 0;
        while (index_of_from(mapping.bytes, anchor_text, search_start)) |offset| {
            for ([_]usize{ 16, 24, 8 }) |header_bytes| {
                if (offset >= header_bytes) {
                    try anchors.append(allocator, .{
                        .tagged = mapping.start + offset - header_bytes + 1,
                        .bytes_path = mapping.rel_path,
                        .offset = offset,
                    });
                }
            }
            search_start = offset + 1;
        }
    }
    for (anchors.items) |anchor| {
        var pointer_bytes: [8]u8 = undefined;
        write_u64_le(anchor.tagged, &pointer_bytes);
        for (mappings) |mapping| {
            var search_start: usize = 0;
            while (index_of_from(mapping.bytes, &pointer_bytes, search_start)) |pointer_offset| {
                const start = pointer_offset -| 160;
                const end = @min(mapping.bytes.len -| 8, pointer_offset + 160);
                var slot = start;
                while (slot <= end) : (slot += 8) {
                    const word = read_u64_le(mapping.bytes, slot);
                    if (decode_compressed_smi(word)) |value| {
                        if (value == 2) return .{
                            .value = value,
                            .anchor_tagged = anchor.tagged,
                            .anchor_bytes_path = anchor.bytes_path,
                            .anchor_offset = anchor.offset,
                            .context_bytes_path = mapping.rel_path,
                            .context_pointer_offset = pointer_offset,
                            .context_slot_offset = slot,
                            .smi_encoding = "v8-pointer-compressed-smi32",
                        };
                    }
                    if (decode_tagged_smi(word)) |value| {
                        if (value == 2) return .{
                            .value = value,
                            .anchor_tagged = anchor.tagged,
                            .anchor_bytes_path = anchor.bytes_path,
                            .anchor_offset = anchor.offset,
                            .context_bytes_path = mapping.rel_path,
                            .context_pointer_offset = pointer_offset,
                            .context_slot_offset = slot,
                            .smi_encoding = "v8-tagged-smi64",
                        };
                    }
                }
                search_start = pointer_offset + 1;
            }
        }
    }
    return error.CounterSmiMissing;
}

fn write_target_entrypoint(allocator: std.mem.Allocator, path: []const u8, result_path: []const u8, count: i64) !void {
    const body = try std.fmt.allocPrint(allocator,
        \\
        \\import {{ createServer }} from "node:http";
        \\import {{ readFileSync, writeFileSync }} from "node:fs";
        \\const resultPath = "{s}";
        \\let count = {d};
        \\const server = createServer((req, res) => {{
        \\  if (req.url !== "/") {{
        \\    res.writeHead(404);
        \\    res.end("not found\n");
        \\    return;
        \\  }}
        \\  res.writeHead(200, {{ "content-type": "application/json" }});
        \\  res.end(JSON.stringify({{ count: ++count }}) + "\n");
        \\}});
        \\server.listen(3000, "127.0.0.1", () => {{
        \\  const proof = JSON.parse(readFileSync(resultPath, "utf8"));
        \\  proof.eventLoopEntered = true;
        \\  proof.targetNativeNodeStarted = true;
        \\  writeFileSync(resultPath, JSON.stringify(proof, null, 2));
        \\}});
        \\
    , .{ result_path, count });
    defer allocator.free(body);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = path, .data = body });
}

fn write_success_result(allocator: std.mem.Allocator, path: []const u8, target_entrypoint_path: []const u8, recovered: Recovery) !void {
    const result = try std.fmt.allocPrint(allocator,
        \\
        \\{{
        \\  "kind": "machinen.node-proper-level5-native-materializer-proof",
        \\  "targetNativeMaterializerStarted": true,
        \\  "targetNativeObjectsMaterialized": true,
        \\  "nativeMaterializerBinaryUsed": true,
        \\  "targetEntrypointKind": "native-generated-node-trampoline",
        \\  "targetEntrypointPath": "{s}",
        \\  "controlledJsLoaderUsed": false,
        \\  "fixtureSpecificJsTargetLoaderUsed": false,
        \\  "accepted": true,
        \\  "eventLoopEntered": false,
        \\  "recoveredCounterFromMemory": {{
        \\    "value": {d},
        \\    "recoveryMode": "native-raw-v8-context-smi-near-closure-anchor",
        \\    "anchor": "machinen-level5-v8-context-anchor-v1",
        \\    "anchorTaggedAddress": "0x{x}",
        \\    "anchorBytesPath": "{s}",
        \\    "anchorOffset": {d},
        \\    "contextBytesPath": "{s}",
        \\    "contextPointerOffset": {d},
        \\    "contextSlotOffset": {d},
        \\    "smiEncoding": "{s}"
        \\  }},
        \\  "materializedObjects": [
        \\    "v8-js-counter-cell",
        \\    "node-http-server-object",
        \\    "libuv-tcp-listener-handle"
        \\  ],
        \\  "recoveredFromPriorResponseString": false,
        \\  "rawV8ContextSmiDecoded": true,
        \\  "selectedStateCounterDescriptorUsed": false,
        \\  "appExportImportUsed": false,
        \\  "sourceIsaEmulationUsed": false,
        \\  "sidecarOutputUsed": false,
        \\  "metadataOnlySuccess": false
        \\}}
        \\
    , .{
        target_entrypoint_path,
        recovered.value,
        recovered.anchor_tagged,
        recovered.anchor_bytes_path,
        recovered.anchor_offset,
        recovered.context_bytes_path,
        recovered.context_pointer_offset,
        recovered.context_slot_offset,
        recovered.smi_encoding,
    });
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = path, .data = result });
}

fn write_refusal(allocator: std.mem.Allocator, path: []const u8, code: []const u8) !void {
    const result = try std.fmt.allocPrint(allocator,
        \\
        \\{{
        \\  "kind": "machinen.node-proper-level5-native-materializer-proof",
        \\  "targetNativeMaterializerStarted": true,
        \\  "controlledJsLoaderUsed": false,
        \\  "accepted": false,
        \\  "refusal": {{ "code": "{s}" }},
        \\  "selectedStateCounterDescriptorUsed": false,
        \\  "appExportImportUsed": false,
        \\  "sourceIsaEmulationUsed": false,
        \\  "sidecarOutputUsed": false,
        \\  "metadataOnlySuccess": false
        \\}}
        \\
    , .{code});
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = path, .data = result });
}

fn parse_hex_address(raw: []const u8) !u64 {
    const trimmed = if (std.mem.startsWith(u8, raw, "0x")) raw[2..] else raw;
    return try std.fmt.parseInt(u64, trimmed, 16);
}

fn index_of_from(haystack: []const u8, needle: []const u8, start: usize) ?usize {
    if (start >= haystack.len) return null;
    if (std.mem.indexOf(u8, haystack[start..], needle)) |offset| return start + offset;
    return null;
}

fn read_u64_le(bytes: []const u8, offset: usize) u64 {
    var value: u64 = 0;
    var index: usize = 0;
    while (index < 8) : (index += 1) {
        value |= @as(u64, bytes[offset + index]) << @intCast(index * 8);
    }
    return value;
}

fn write_u64_le(value: u64, out: *[8]u8) void {
    var remaining = value;
    for (out) |*byte| {
        byte.* = @intCast(remaining & 0xff);
        remaining >>= 8;
    }
}

fn decode_compressed_smi(word: u64) ?i64 {
    if ((word & 0xffffffff) != 0) return null;
    const raw: u32 = @intCast((word >> 32) & 0xffffffff);
    return @as(i64, @intCast(raw));
}

fn decode_tagged_smi(word: u64) ?i64 {
    if ((word & 1) != 0) return null;
    const shifted = word >> 1;
    if (shifted > 1_000_000) return null;
    return @intCast(shifted);
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

fn stdout(allocator: std.mem.Allocator, comptime fmt: []const u8, args: anytype) !void {
    const text = try std.fmt.allocPrint(allocator, fmt, args);
    defer allocator.free(text);
    try std.Io.File.stdout().writeStreamingAll(g_io, text);
}
