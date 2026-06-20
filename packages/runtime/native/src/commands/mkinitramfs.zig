const std = @import("std");
const runtime_helper = @import("runtime_helper");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;
const Count = @TypeOf(@as([]const u8, &.{}).len);

pub const name = "mkinitramfs";

const Request = struct {
    mode: []const u8,
    out: []const u8,
    rootfs: ?[]const u8 = null,
    workspace: ?[]const u8 = null,
    mountpoint: ?[]const u8 = null,
    excludes: []const []const u8 = &.{},
    max_mb: ?Count = null,
    init_path: ?[]const u8 = null,
    config: ?[]const u8 = null,
    config_path: ?[]const u8 = null,
    inject_init: bool = true,
    allow_missing_init: bool = false,
    exec_agent_path: ?[]const u8 = null,
    mount_guest: ?[]const u8 = null,
};

const RequestError = error{
    MissingMode,
    InvalidMode,
    MissingOut,
    InvalidOut,
    InvalidRootfs,
    MissingRootfs,
    InvalidWorkspace,
    MissingWorkspace,
    InvalidMountpoint,
    InvalidExcludes,
    InvalidMaxMb,
    InvalidInitPath,
    InvalidConfig,
    InvalidConfigPath,
    InvalidInjectInit,
    InvalidAllowMissingInit,
    InvalidExecAgentPath,
    InvalidMountGuest,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    assert(name.len > 0);

    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const request = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const result = runRequest(allocator, io, request) catch |err| {
        try writePackError(io, err);
        return .fail;
    };

    try protocol.writeJson(allocator, io, .{
        .ok = true,
        .protocolVersion = @as(u8, protocol.version),
        .command = name,
        .data = .{
            .out = request.out,
            .bytes = result.bytes,
            .workspaceBytes = result.workspace_bytes,
        },
    });
    return .ok;
}

fn writePackError(io: std.Io, err: runtime_helper.mkinitramfs.Error) !void {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.PathNotFound => try protocol.writeError(
            io,
            "MKINITRAMFS_INPUT_NOT_FOUND",
            "mkinitramfs input path does not exist",
        ),
        error.PathNotDirectory => try protocol.writeError(
            io,
            "MKINITRAMFS_INPUT_INVALID",
            "mkinitramfs input path is not a directory",
        ),
        error.InitMissing => try protocol.writeError(
            io,
            "MKINITRAMFS_INIT_MISSING",
            "mkinitramfs: /init binary not readable",
        ),
        error.WorkspaceTooLarge => try protocol.writeError(
            io,
            "MKINITRAMFS_WORKSPACE_TOO_LARGE",
            "workspace exceeds the configured maxMb",
        ),
        else => try protocol.writeError(io, "MKINITRAMFS_FAILED", @errorName(err)),
    }
}

fn runRequest(
    allocator: std.mem.Allocator,
    io: std.Io,
    request: Request,
) runtime_helper.mkinitramfs.Error!runtime_helper.mkinitramfs.Result {
    assert(request.mode.len > 0);
    assert(request.out.len > 0);

    const final: runtime_helper.mkinitramfs.FinalOptions = .{
        .init_path = request.init_path,
        .config = request.config,
        .config_path = request.config_path,
        .inject_init = request.inject_init,
        .allow_missing_init = request.allow_missing_init,
        .exec_agent_path = request.exec_agent_path,
        .mount_guest = request.mount_guest,
    };
    if (std.mem.eql(u8, request.mode, "tiny")) {
        return runtime_helper.mkinitramfs.packTiny(allocator, io, .{
            .out = request.out,
            .final = final,
        });
    }
    if (std.mem.eql(u8, request.mode, "rootfs")) {
        return runtime_helper.mkinitramfs.packRootfs(allocator, io, .{
            .rootfs = request.rootfs orelse return error.PathNotFound,
            .out = request.out,
            .excludes = request.excludes,
            .final = final,
        });
    }
    if (std.mem.eql(u8, request.mode, "workspace")) {
        return runtime_helper.mkinitramfs.packWorkspace(allocator, io, .{
            .workspace = request.workspace orelse return error.PathNotFound,
            .out = request.out,
            .mountpoint = request.mountpoint orelse "workspace",
            .excludes = request.excludes,
            .max_mb = request.max_mb orelse 500,
        });
    }
    if (std.mem.eql(u8, request.mode, "minimal")) {
        return runtime_helper.mkinitramfs.packMinimal(allocator, io, .{
            .out = request.out,
            .final = final,
        });
    }
    unreachable;
}

fn parseRequest(allocator: std.mem.Allocator, io: std.Io) RequestError!Request {
    assert(protocol.version == 1);
    assert(protocol.max_request_bytes > 0);

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

    const protocol_version = envelope.get("protocolVersion") orelse
        return error.UnsupportedProtocolVersion;
    if (protocol_version != .integer) return error.UnsupportedProtocolVersion;
    if (protocol_version.integer != protocol.version) return error.UnsupportedProtocolVersion;

    const data_value = envelope.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    return parseRequestData(allocator, data_value.object);
}

fn parseRequestData(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
) RequestError!Request {
    assert(object.count() > 0);

    try protocol.rejectUnknownFields(object, &.{
        "mode",
        "out",
        "rootfs",
        "workspace",
        "mountpoint",
        "excludes",
        "maxMb",
        "initPath",
        "config",
        "configPath",
        "injectInit",
        "allowMissingInit",
        "execAgentPath",
        "mountGuest",
    });

    const mode = try requiredString(object, "mode", error.MissingMode, error.InvalidMode);
    if (!isValidMode(mode)) return error.InvalidMode;
    var request: Request = .{
        .mode = mode,
        .out = try requiredString(object, "out", error.MissingOut, error.InvalidOut),
    };
    request.rootfs = try optionalString(object, "rootfs", error.InvalidRootfs);
    request.workspace = try optionalString(object, "workspace", error.InvalidWorkspace);
    request.mountpoint = try optionalString(object, "mountpoint", error.InvalidMountpoint);
    request.init_path = try optionalString(object, "initPath", error.InvalidInitPath);
    request.config = try optionalString(object, "config", error.InvalidConfig);
    request.config_path = try optionalString(
        object,
        "configPath",
        error.InvalidConfigPath,
    );
    request.exec_agent_path = try optionalString(
        object,
        "execAgentPath",
        error.InvalidExecAgentPath,
    );
    request.mount_guest = try optionalString(object, "mountGuest", error.InvalidMountGuest);
    request.excludes = try optionalStringArray(
        allocator,
        object,
        "excludes",
        error.InvalidExcludes,
    );
    request.max_mb = try optionalUsize(object, "maxMb", error.InvalidMaxMb);
    request.inject_init = try optionalBool(
        object,
        "injectInit",
        error.InvalidInjectInit,
    ) orelse true;
    request.allow_missing_init = try optionalBool(
        object,
        "allowMissingInit",
        error.InvalidAllowMissingInit,
    ) orelse false;

    if (std.mem.eql(u8, mode, "rootfs") and request.rootfs == null) return error.MissingRootfs;
    if (std.mem.eql(u8, mode, "workspace") and request.workspace == null) {
        return error.MissingWorkspace;
    }
    return request;
}

fn isValidMode(mode: []const u8) bool {
    assert(mode.len > 0);
    return std.mem.eql(u8, mode, "tiny") or
        std.mem.eql(u8, mode, "rootfs") or
        std.mem.eql(u8, mode, "workspace") or
        std.mem.eql(u8, mode, "minimal");
}

fn requiredString(
    object: std.json.ObjectMap,
    field: []const u8,
    missing: RequestError,
    invalid: RequestError,
) RequestError![]const u8 {
    assert(field.len > 0);

    const value = object.get(field) orelse return missing;
    if (value != .string) return invalid;
    return value.string;
}

fn optionalString(
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!?[]const u8 {
    assert(field.len > 0);

    const value = object.get(field) orelse return null;
    if (value == .null) return null;
    if (value != .string) return invalid;
    return value.string;
}

fn optionalBool(
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!?bool {
    assert(field.len > 0);

    const value = object.get(field) orelse return null;
    if (value == .null) return null;
    if (value != .bool) return invalid;
    return value.bool;
}

fn optionalUsize(
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!?Count {
    assert(field.len > 0);

    const value = object.get(field) orelse return null;
    if (value == .null) return null;
    if (value != .integer or value.integer < 0) return invalid;
    return @intCast(value.integer);
}

fn optionalStringArray(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError![]const []const u8 {
    assert(field.len > 0);

    const value = object.get(field) orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return invalid;
    var out: std.array_list.Aligned([]const u8, null) = .empty;
    for (value.array.items) |item| {
        if (item != .string) return invalid;
        try out.append(allocator, item.string);
    }
    return out.toOwnedSlice(allocator);
}

fn writeRequestError(io: std.Io, err: RequestError) !void {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.RequestTooLarge => try protocol.writeError(
            io,
            "REQUEST_TOO_LARGE",
            "request JSON exceeds the maximum size",
        ),
        error.UnknownField => try protocol.writeError(
            io,
            "UNKNOWN_FIELD",
            "request contains an unknown field",
        ),
        error.UnsupportedProtocolVersion => try protocol.writeError(
            io,
            "UNSUPPORTED_PROTOCOL_VERSION",
            "request protocolVersion must be 1",
        ),
        error.MissingData => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "request must include a data object",
        ),
        error.InvalidData => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "request data field must be an object",
        ),
        error.InvalidJson => try protocol.writeError(
            io,
            "INVALID_JSON",
            "request body is not valid JSON",
        ),
        error.InvalidShape => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "request body must be a JSON object",
        ),
        error.MissingMode => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "mkinitramfs request data must include a string mode field",
        ),
        error.InvalidMode => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "mkinitramfs mode must be one of tiny, rootfs, workspace, or minimal",
        ),
        error.MissingOut => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "mkinitramfs request data must include a string out field",
        ),
        error.MissingRootfs => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "mkinitramfs rootfs mode requires a rootfs field",
        ),
        error.MissingWorkspace => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "mkinitramfs workspace mode requires a workspace field",
        ),
        else => try protocol.writeError(io, "INVALID_REQUEST", @errorName(err)),
    }
}
