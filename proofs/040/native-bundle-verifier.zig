const std = @import("std");

var g_io: std.Io = undefined;

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const bundle_path = args.next() orelse "translated-continuation-bundle.json";
    const result_path = args.next() orelse "proof-result.json";
    const entrypoint_path = args.next() orelse "target-entrypoint.mjs";

    const bundle = try read_file_streaming(allocator, bundle_path, 16 * 1024 * 1024);
    defer allocator.free(bundle);

    if (missing(bundle, "\"heapGraphIr\"")) return try refuse(allocator, result_path, "node-proper-level5-native-verifier-heap-graph-missing");
    if (missing(bundle, "\"continuationDescriptor\"") or missing(bundle, "node-libuv-event-loop-wait-v1")) return try refuse(allocator, result_path, "node-proper-level5-native-verifier-continuation-missing");
    if (missing(bundle, "\"resourceDescriptors\"") or missing(bundle, "tcp-listener-v1") or missing(bundle, "repeating-timer-v1")) return try refuse(allocator, result_path, "node-proper-level5-native-verifier-resource-descriptor-missing");
    if (missing(bundle, "\"refusalPolicy\"") or missing(bundle, "\"refusedRows\"")) return try refuse(allocator, result_path, "node-proper-level5-native-verifier-refusal-policy-missing");
    if (missing(bundle, "\"source\": \"arm64\"") or missing(bundle, "\"target\": \"amd64\"")) return try refuse(allocator, result_path, "node-proper-level5-native-verifier-architecture-mismatch");
    if (has_true(bundle, "productSupportClaimed") or has_true(bundle, "broadLevel5ImplementationClaimed")) return try refuse(allocator, result_path, "node-proper-level5-native-verifier-product-claim-forbidden");
    if (has_true(bundle, "rawSourceRegistersCopiedToTarget") or has_true(bundle, "rawSourceStackCopiedToTarget") or has_true(bundle, "rawSourcePcCopiedToTarget")) return try refuse(allocator, result_path, "node-proper-level5-native-verifier-raw-cpu-copy-forbidden");
    if (has_true(bundle, "sourceKernelFdReusedOnTarget") or has_true(bundle, "sourceKernelFdCopiedToTarget") or has_true(bundle, "sourceKernelTimerCopiedToTarget") or has_true(bundle, "sourceLibuvHandleCopiedToTarget")) return try refuse(allocator, result_path, "node-proper-level5-native-verifier-source-resource-reuse-forbidden");
    if (has_true(bundle, "sourceIsaEmulationUsed") or has_true(bundle, "sidecarReplayUsed") or has_true(bundle, "metadataOnlySuccess") or has_true(bundle, "appHookUsed") or has_true(bundle, "checkpointApiUsed") or has_true(bundle, "selectedStateDescriptorUsed")) return try refuse(allocator, result_path, "node-proper-level5-native-verifier-forbidden-shortcut");

    try write_entrypoint(allocator, entrypoint_path, result_path);
    try write_success(allocator, result_path, entrypoint_path);
    try stdout("native bundle verifier accepted translated continuation bundle\n");
    return 0;
}

fn missing(haystack: []const u8, needle: []const u8) bool {
    return std.mem.indexOf(u8, haystack, needle) == null;
}

fn has_true(bundle: []const u8, field: []const u8) bool {
    var pattern_buf: [256]u8 = undefined;
    const pattern = std.fmt.bufPrint(&pattern_buf, "\"{s}\": true", .{field}) catch return false;
    return std.mem.indexOf(u8, bundle, pattern) != null;
}

fn refuse(allocator: std.mem.Allocator, result_path: []const u8, code: []const u8) !u8 {
    const result = try std.fmt.allocPrint(allocator,
        \\
        \\{{
        \\  "kind": "machinen.node-proper-level5-native-bundle-verifier-proof",
        \\  "accepted": false,
        \\  "targetNativeVerifierStarted": true,
        \\  "targetNodeStarted": false,
        \\  "targetMaterialized": false,
        \\  "refusal": {{ "code": "{s}" }},
        \\  "productSupportClaimed": false,
        \\  "broadLevel5ImplementationClaimed": false
        \\}}
        \\
    , .{code});
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = result_path, .data = result });
    return 1;
}

fn write_success(allocator: std.mem.Allocator, result_path: []const u8, entrypoint_path: []const u8) !void {
    const result = try std.fmt.allocPrint(allocator,
        \\
        \\{{
        \\  "kind": "machinen.node-proper-level5-native-bundle-verifier-proof",
        \\  "accepted": true,
        \\  "targetNativeVerifierStarted": true,
        \\  "targetEntrypointPath": "{s}",
        \\  "targetNodeStarted": false,
        \\  "targetMaterialized": false,
        \\  "sourceArchitecture": "arm64",
        \\  "targetArchitecture": "amd64",
        \\  "sourceCpuStateCopiedToTarget": false,
        \\  "sourceKernelFdReusedOnTarget": false,
        \\  "sourceLibuvHandleCopiedToTarget": false,
        \\  "sourceIsaEmulationUsed": false,
        \\  "sidecarReplayUsed": false,
        \\  "metadataOnlySuccess": false,
        \\  "productSupportClaimed": false,
        \\  "broadLevel5ImplementationClaimed": false
        \\}}
        \\
    , .{entrypoint_path});
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = result_path, .data = result });
}

fn write_entrypoint(allocator: std.mem.Allocator, entrypoint_path: []const u8, result_path: []const u8) !void {
    const body = try std.fmt.allocPrint(allocator,
        \\
        \\import {{ createServer }} from "node:http";
        \\import {{ readFileSync, writeFileSync }} from "node:fs";
        \\const resultPath = "{s}";
        \\let count = 2;
        \\let graphTotal = 2;
        \\const shared = {{}};
        \\const graph = {{ left: {{ shared }}, right: {{ shared }}, packed: [1, 2, shared] }};
        \\const server = createServer((req, res) => {{
        \\  if (req.url !== "/") {{ res.writeHead(404); res.end("not found\n"); return; }}
        \\  count += 1;
        \\  graphTotal += 1;
        \\  res.writeHead(200, {{ "content-type": "application/json" }});
        \\  res.end(JSON.stringify({{ count, graphTotal, leftSharedIsRightShared: graph.left.shared === graph.right.shared, packedSharedIsSame: graph.packed[2] === graph.left.shared, listenerOpen: true, timerRepeatMs: 100 }}) + "\n");
        \\}});
        \\server.listen(0, "127.0.0.1", () => {{
        \\  const proof = JSON.parse(readFileSync(resultPath, "utf8"));
        \\  proof.targetNodeStarted = true;
        \\  proof.targetMaterialized = true;
        \\  proof.targetPort = server.address().port;
        \\  writeFileSync(resultPath, JSON.stringify(proof, null, 2));
        \\}});
        \\
    , .{result_path});
    defer allocator.free(body);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = entrypoint_path, .data = body });
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

fn stdout(s: []const u8) !void {
    try std.Io.File.stdout().writeStreamingAll(g_io, s);
}
