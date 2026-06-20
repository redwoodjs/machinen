const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

pub const name = "cpu-cgroup-apply";

const Request = struct {
    pid: u32,
    weight: u32,
    quota_cpus: ?f64,
    parent_dir: []const u8,
    id: []const u8,
};

const RequestError = error{
    MissingPid,
    InvalidPid,
    MissingWeight,
    InvalidWeight,
    InvalidQuotaCpus,
    MissingParentDir,
    InvalidParentDir,
    MissingId,
    InvalidId,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const result = runtime_helper.host.applyCpuCgroup(allocator, io, .{
        .pid = request.pid,
        .weight = request.weight,
        .quota_cpus = request.quota_cpus,
        .parent_dir = request.parent_dir,
        .id = request.id,
    }) catch |err| {
        switch (err) {
            error.CgroupUnsupported => try protocol.writeError(io, "BOOT_CPU_UNSUPPORTED", "boot: resources.cpu requires Linux cgroup v2 CPU controls, but the cgroup parent is not usable."),
            else => try protocol.writeError(io, "BOOT_CPU_UNSUPPORTED", @errorName(err)),
        }
        return .fail;
    };
    defer if (result.cgroup_path) |path| allocator.free(path);

    const out = try formatResponse(allocator, result);
    defer allocator.free(out);
    try protocol.stdout(io, out);
    return .ok;
}

fn formatResponse(allocator: std.mem.Allocator, result: runtime_helper.host.CpuCgroupResult) ![]u8 {
    switch (result.status) {
        .unsupported => return std.fmt.allocPrint(
            allocator,
            "{{\"ok\":true,\"protocolVersion\":1,\"command\":\"cpu-cgroup-apply\",\"data\":{{\"status\":\"unsupported\",\"reason\":\"{s}\"}}}}\n",
            .{result.reason orelse "unsupported"},
        ),
        .linux_cgroup_v2 => return std.fmt.allocPrint(
            allocator,
            "{{\"ok\":true,\"protocolVersion\":1,\"command\":\"cpu-cgroup-apply\",\"data\":{{\"status\":\"linux-cgroup-v2\",\"cgroupPath\":\"{s}\"}}}}\n",
            .{result.cgroup_path.?},
        ),
    }
}

fn parseRequest(allocator: std.mem.Allocator, io: std.Io) RequestError!Request {
    const data = try protocol.readStdinAll(allocator, io, protocol.max_request_bytes);
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, data, .{
        .duplicate_field_behavior = .@"error",
        .ignore_unknown_fields = false,
        .max_value_len = data.len,
        .allocate = .alloc_if_needed,
        .parse_numbers = true,
    }) catch return error.InvalidJson;
    const request_value = parsed.value;
    if (request_value != .object) return error.InvalidShape;
    const envelope = request_value.object;
    try protocol.rejectUnknownFields(envelope, &.{ "protocolVersion", "data" });
    const protocol_version = envelope.get("protocolVersion") orelse return error.UnsupportedProtocolVersion;
    if (protocol_version != .integer or protocol_version.integer != protocol.version) return error.UnsupportedProtocolVersion;
    const data_value = envelope.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    const object = data_value.object;
    try protocol.rejectUnknownFields(object, &.{ "pid", "weight", "quotaCpus", "parentDir", "id" });
    return .{
        .pid = try requiredU32(object, "pid", error.MissingPid, error.InvalidPid),
        .weight = try requiredU32(object, "weight", error.MissingWeight, error.InvalidWeight),
        .quota_cpus = try optionalFloat(object, "quotaCpus", error.InvalidQuotaCpus),
        .parent_dir = try requiredString(object, "parentDir", error.MissingParentDir, error.InvalidParentDir),
        .id = try requiredString(object, "id", error.MissingId, error.InvalidId),
    };
}

fn requiredString(object: std.json.ObjectMap, field: []const u8, missing: RequestError, invalid: RequestError) RequestError![]const u8 {
    const value = object.get(field) orelse return missing;
    if (value != .string) return invalid;
    return value.string;
}

fn requiredU32(object: std.json.ObjectMap, field: []const u8, missing: RequestError, invalid: RequestError) RequestError!u32 {
    const value = object.get(field) orelse return missing;
    if (value != .integer or value.integer <= 0 or value.integer > std.math.maxInt(u32)) return invalid;
    return @intCast(value.integer);
}

fn optionalFloat(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!?f64 {
    const value = object.get(field) orelse return null;
    if (value == .null) return null;
    return switch (value) {
        .float => |f| f,
        .integer => |i| @floatFromInt(i),
        else => invalid,
    };
}

fn writeRequestError(io: std.Io, err: RequestError) !void {
    switch (err) {
        error.RequestTooLarge => try protocol.writeError(io, "REQUEST_TOO_LARGE", "request JSON exceeds the maximum size"),
        error.UnknownField => try protocol.writeError(io, "UNKNOWN_FIELD", "request contains an unknown field"),
        error.UnsupportedProtocolVersion => try protocol.writeError(io, "UNSUPPORTED_PROTOCOL_VERSION", "request protocolVersion must be 1"),
        error.MissingData => try protocol.writeError(io, "INVALID_REQUEST", "request must include a data object"),
        error.InvalidData => try protocol.writeError(io, "INVALID_REQUEST", "request data field must be an object"),
        error.InvalidJson => try protocol.writeError(io, "INVALID_JSON", "request body is not valid JSON"),
        error.InvalidShape => try protocol.writeError(io, "INVALID_REQUEST", "request body must be a JSON object"),
        else => try protocol.writeError(io, "INVALID_REQUEST", @errorName(err)),
    }
}
