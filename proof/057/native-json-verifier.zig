const std = @import("std");

var g_io: std.Io = undefined;

const Architecture = struct { source: []const u8, target: []const u8 };
const HeapGraph = struct { count: i64, graphTotal: i64 };
const Continuation = struct { continuationClass: []const u8 };
const Resource = struct { kind: []const u8 };
const RefusalPolicy = struct { refusedRows: []const []const u8 };
const Bundle = struct {
    schemaVersion: i64,
    productSupportClaimed: bool,
    broadLevel5ImplementationClaimed: bool,
    architecture: Architecture,
    heapGraphIr: HeapGraph,
    continuationDescriptor: Continuation,
    resourceDescriptors: []const Resource,
    refusalPolicy: RefusalPolicy,
    canonicalSectionDigestsOk: bool,
    bundleDigestOk: bool,
    runtimeProfileRouteUsed: bool,
    rawSourceRegistersCopiedToTarget: bool,
    rawSourcePcCopiedToTarget: bool,
    rawSourceStackCopiedToTarget: bool,
    sourceKernelFdReusedOnTarget: bool,
    sourceIsaEmulationUsed: bool,
    sidecarReplayUsed: bool,
    metadataOnlySuccess: bool,
    appExportImportUsed: bool,
};

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;
    var args = init.minimal.args.iterate();
    _ = args.next();
    const bundle_path = args.next() orelse "bundle.json";
    const result_path = args.next() orelse "proof-result.json";
    const bytes = try read_file_streaming(allocator, bundle_path, 16 * 1024 * 1024);
    defer allocator.free(bytes);
    var parsed = std.json.parseFromSlice(Bundle, allocator, bytes, .{ .ignore_unknown_fields = true }) catch {
        return try refuse(allocator, result_path, "node-proper-level5-structured-json-schema-refused");
    };
    defer parsed.deinit();
    const bundle = parsed.value;
    if (bundle.schemaVersion != 1) return try refuse(allocator, result_path, "node-proper-level5-structured-json-schema-version-refused");
    if (!std.mem.eql(u8, bundle.architecture.source, "arm64") or !std.mem.eql(u8, bundle.architecture.target, "amd64")) return try refuse(allocator, result_path, "node-proper-level5-structured-json-architecture-refused");
    if (!std.mem.eql(u8, bundle.continuationDescriptor.continuationClass, "node-libuv-event-loop-wait-v1")) return try refuse(allocator, result_path, "node-proper-level5-structured-json-continuation-refused");
    if (bundle.resourceDescriptors.len < 2 or bundle.refusalPolicy.refusedRows.len == 0) return try refuse(allocator, result_path, "node-proper-level5-structured-json-required-array-refused");
    if (!bundle.canonicalSectionDigestsOk or !bundle.bundleDigestOk) return try refuse(allocator, result_path, "node-proper-level5-structured-json-digest-refused");
    if (bundle.productSupportClaimed or bundle.broadLevel5ImplementationClaimed) return try refuse(allocator, result_path, "node-proper-level5-structured-json-product-claim-refused");
    if (bundle.runtimeProfileRouteUsed or bundle.rawSourceRegistersCopiedToTarget or bundle.rawSourcePcCopiedToTarget or bundle.rawSourceStackCopiedToTarget or bundle.sourceKernelFdReusedOnTarget or bundle.sourceIsaEmulationUsed or bundle.sidecarReplayUsed or bundle.metadataOnlySuccess or bundle.appExportImportUsed) return try refuse(allocator, result_path, "node-proper-level5-structured-json-shortcut-refused");
    try write_success(allocator, result_path, bundle.heapGraphIr.count, bundle.heapGraphIr.graphTotal);
    return 0;
}

fn refuse(allocator: std.mem.Allocator, result_path: []const u8, code: []const u8) !u8 {
    const result = try std.fmt.allocPrint(allocator,
        \\
        \\{{"accepted":false,"structuredJsonParsed":true,"targetStarted":false,"refusal":{{"code":"{s}"}},"productSupportClaimed":false,"broadLevel5ImplementationClaimed":false}}
        \\
    , .{code});
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = result_path, .data = result });
    return 1;
}

fn write_success(allocator: std.mem.Allocator, result_path: []const u8, count: i64, graph_total: i64) !void {
    const result = try std.fmt.allocPrint(allocator,
        \\
        \\{{"accepted":true,"structuredJsonParsed":true,"targetStarted":false,"sourceArchitecture":"arm64","targetArchitecture":"amd64","count":{},"graphTotal":{},"productSupportClaimed":false,"broadLevel5ImplementationClaimed":false}}
        \\
    , .{ count, graph_total });
    defer allocator.free(result);
    try std.Io.Dir.cwd().writeFile(g_io, .{ .sub_path = result_path, .data = result });
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
