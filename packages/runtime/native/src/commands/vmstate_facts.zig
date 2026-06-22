const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

pub const name = "vmstate-facts";

const Request = struct {
    path: []const u8,
};

const RequestError = error{
    MissingPath,
    InvalidPath,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const facts = runtime_helper.vmstate.readFacts(arena, io, request.path) catch |err| {
        try writeReadError(io, err);
        return .fail;
    };

    try protocol.stdout(io, "{\"ok\":true,\"protocolVersion\":1,\"command\":\"vmstate-facts\",\"data\":{");
    try protocol.stdout(io, "\"arch\":");
    try protocol.writeJsonString(io, runtime_helper.vmstate.guestArchName(facts.arch));
    try protocol.stdout(io, ",\"topologyHash\":");
    try protocol.writeJsonString(io, facts.topology_hash);
    try protocol.stdout(io, ",\"sectionCount\":");
    try protocol.stdout(io, try std.fmt.allocPrint(arena, "{}", .{facts.section_count}));
    if (facts.guest_pauth_active) |active| {
        try protocol.stdout(io, ",\"guestPauthActive\":");
        try protocol.stdout(io, if (active) "true" else "false");
    }
    if (facts.sctlr_el1) |sctlr| {
        try protocol.stdout(io, ",\"sctlrEl1\":");
        try protocol.writeJsonString(io, sctlr);
    }
    try protocol.stdout(io, "}}\n");
    return .ok;
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
    try protocol.rejectUnknownFields(object, &.{"path"});
    const path_value = object.get("path") orelse return error.MissingPath;
    if (path_value != .string or path_value.string.len == 0) return error.InvalidPath;
    return .{ .path = path_value.string };
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
        error.MissingPath => try protocol.writeError(io, "INVALID_REQUEST", "path is required"),
        error.InvalidPath => try protocol.writeError(io, "INVALID_REQUEST", "path must be a non-empty string"),
        else => try protocol.writeError(io, "INVALID_REQUEST", @errorName(err)),
    }
}

fn writeReadError(io: std.Io, err: runtime_helper.vmstate.ReadFactsError) !void {
    switch (err) {
        error.FileNotFound => try protocol.writeError(io, "BOOT_SNAPSHOT_NOT_FOUND", "vmstate file not found"),
        error.TruncatedHeader => try protocol.writeError(io, "VMSTATE_INVALID", "vmstate: truncated header"),
        error.BadMagic => try protocol.writeError(io, "VMSTATE_INVALID", "vmstate: bad magic"),
        error.UnsupportedVersion => try protocol.writeError(io, "VMSTATE_INVALID", "vmstate: unsupported version"),
        error.UnsupportedArch => try protocol.writeError(io, "VMSTATE_INVALID", "vmstate: unsupported arch"),
        error.TruncatedSectionHeader => try protocol.writeError(io, "VMSTATE_INVALID", "vmstate: truncated section header"),
        error.SectionOverflowsFile => try protocol.writeError(io, "VMSTATE_INVALID", "vmstate: section overflows file"),
        error.SectionTooLarge => try protocol.writeError(io, "VMSTATE_INVALID", "vmstate: section too large"),
        error.TruncatedVcpuPayload => try protocol.writeError(io, "VMSTATE_INVALID", "vmstate: truncated vcpu payload"),
        error.TruncatedVcpuEntry => try protocol.writeError(io, "VMSTATE_INVALID", "vmstate: truncated vcpu entry"),
        error.TruncatedVcpuName => try protocol.writeError(io, "VMSTATE_INVALID", "vmstate: truncated vcpu name"),
        error.TruncatedVcpuValue => try protocol.writeError(io, "VMSTATE_INVALID", "vmstate: truncated vcpu value"),
        error.InvalidVcpuValueLength => try protocol.writeError(io, "VMSTATE_INVALID", "vmstate: SCTLR_EL1 has invalid byte length"),
        else => try protocol.writeError(io, "VMSTATE_READ_FAILED", @errorName(err)),
    }
}
