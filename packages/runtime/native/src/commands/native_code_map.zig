const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

pub const name = "native-code-map";

const Envelope = struct {
    protocolVersion: u32,
    data: runtime_helper.native_code_map.Request,
};

const RequestError = protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };
    const result = runtime_helper.native_code_map.build(arena, request) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };

    try writeResult(io, result);
    return .ok;
}

fn parseRequest(allocator: std.mem.Allocator, io: std.Io) RequestError!runtime_helper.native_code_map.Request {
    const data = try protocol.readStdinAll(allocator, io, protocol.max_request_bytes);
    const parsed = std.json.parseFromSlice(Envelope, allocator, data, .{
        .duplicate_field_behavior = .@"error",
        .ignore_unknown_fields = false,
        .max_value_len = data.len,
        .allocate = .alloc_if_needed,
        .parse_numbers = true,
    }) catch return error.InvalidJson;
    if (parsed.value.protocolVersion != protocol.version) return error.UnsupportedProtocolVersion;
    return parsed.value.data;
}

fn writeResult(io: std.Io, result: runtime_helper.native_code_map.Result) !void {
    try protocol.stdout(io, "{\"ok\":true,\"protocolVersion\":1,\"command\":\"native-code-map\",\"data\":{");
    try protocol.stdout(io, "\"codeLocations\":[");
    for (result.codeLocations, 0..) |location, i| {
        if (i > 0) try protocol.stdout(io, ",");
        try writeLocation(io, location);
    }
    try protocol.stdout(io, "],\"refusals\":[");
    if (result.buildRefusal) |refusal| {
        try writeRefusal(io, refusal);
    } else {
        var wrote = false;
        for (result.codeLocations) |location| {
            if (location.refusal) |refusal| {
                if (wrote) try protocol.stdout(io, ",");
                try writeRefusal(io, refusal);
                wrote = true;
            }
        }
    }
    try protocol.stdout(io, "]}}\n");
}

fn writeLocation(io: std.Io, location: runtime_helper.native_code_map.CodeLocation) !void {
    try protocol.stdout(io, "{");
    try protocol.stdout(io, "\"id\":");
    try protocol.writeJsonString(io, location.id);
    try protocol.stdout(io, ",\"sourceMapping\":");
    try protocol.writeJsonString(io, location.sourceMapping);
    try protocol.stdout(io, ",\"sourceAddress\":");
    try protocol.writeJsonString(io, location.sourceAddress);
    if (location.targetAddress) |address| {
        try protocol.stdout(io, ",\"targetAddress\":");
        try protocol.writeJsonString(io, address);
    }
    try protocol.stdout(io, ",\"state\":");
    try protocol.writeJsonString(io, switch (location.state) {
        .mapped => "mapped",
        .refused => "refused",
    });
    if (location.refusal) |refusal| {
        try protocol.stdout(io, ",\"refusal\":");
        try writeRefusal(io, refusal);
    }
    try protocol.stdout(io, "}");
}

fn writeRefusal(io: std.Io, refusal: runtime_helper.native_code_map.Refusal) !void {
    try protocol.stdout(io, "{\"code\":");
    try protocol.writeJsonString(io, refusal.code);
    try protocol.stdout(io, ",\"message\":");
    try protocol.writeJsonString(io, refusal.message);
    if (refusal.detail) |detail| {
        try protocol.stdout(io, ",\"detail\":");
        try writeDetail(io, detail);
    }
    try protocol.stdout(io, "}");
}

fn writeDetail(io: std.Io, detail: runtime_helper.native_code_map.Detail) !void {
    switch (detail) {
        .target_build => |value| {
            try protocol.stdout(io, "{\"targetBuildId\":");
            try protocol.writeJsonString(io, value.targetBuildId);
            try protocol.stdout(io, ",\"expectedTargetBuildId\":");
            try protocol.writeJsonString(io, value.expectedTargetBuildId);
            try protocol.stdout(io, "}");
        },
        .target_module_build => |value| {
            try protocol.stdout(io, "{\"symbol\":");
            try protocol.writeJsonString(io, value.symbol);
            try protocol.stdout(io, ",\"targetModule\":");
            try protocol.writeJsonString(io, value.targetModule);
            try protocol.stdout(io, ",\"targetBuildId\":");
            try protocol.writeJsonString(io, value.targetBuildId);
            try protocol.stdout(io, ",\"expectedTargetBuildId\":");
            try protocol.writeJsonString(io, value.expectedTargetBuildId);
            try protocol.stdout(io, "}");
        },
    }
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

fn writePlanError(io: std.Io, err: runtime_helper.native_code_map.PlanError) !void {
    switch (err) {
        error.OutOfMemory => try protocol.writeError(io, "NATIVE_CODE_MAP_FAILED", "out of memory while building native code map"),
        error.InvalidInteger => try protocol.writeError(io, "INVALID_REQUEST", "native code map address fields must be decimal or 0x-prefixed integers"),
    }
}
