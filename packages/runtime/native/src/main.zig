const std = @import("std");
const protocol = @import("protocol.zig");
const mkinitramfs = @import("commands/mkinitramfs.zig");
const mountdisk_image = @import("commands/mountdisk_image.zig");
const mountdisk_upper = @import("commands/mountdisk_upper.zig");
const reflink_copy = @import("commands/reflink_copy.zig");
const rootfs_cache_key = @import("commands/rootfs_cache_key.zig");
const rootfs_materialize = @import("commands/rootfs_materialize.zig");
const tree_manifest_hash = @import("commands/tree_manifest_hash.zig");

const assert = std.debug.assert;

var g_io: std.Io = undefined;

pub fn main(init: std.process.Init) !u8 {
    assert(mkinitramfs.name.len > 0);
    assert(mountdisk_image.name.len > 0);
    assert(mountdisk_upper.name.len > 0);
    assert(reflink_copy.name.len > 0);
    assert(rootfs_cache_key.name.len > 0);
    assert(rootfs_materialize.name.len > 0);
    assert(tree_manifest_hash.name.len > 0);

    g_io = init.io;
    var it = init.minimal.args.iterate();
    _ = it.next(); // argv[0]

    const command = it.next() orelse {
        try protocol.writeError(g_io, "USAGE", "missing command");
        return @intFromEnum(protocol.Exit.usage);
    };
    assert(command.len > 0);

    if (try runKnownCommand(init.gpa, &it, command)) |exit| return exit;
    if (isHelp(command)) return try writeHelp(init.gpa, g_io);

    try protocol.writeError(g_io, "UNKNOWN_COMMAND", "unknown command");
    return @intFromEnum(protocol.Exit.usage);
}

fn runKnownCommand(
    allocator: std.mem.Allocator,
    it: anytype,
    command: []const u8,
) !?u8 {
    assert(command.len > 0);

    if (std.mem.eql(u8, command, mkinitramfs.name)) {
        if (try rejectExtraArgs(it, mkinitramfs.name)) return @intFromEnum(protocol.Exit.usage);
        return @intFromEnum(try mkinitramfs.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, mountdisk_image.name)) {
        if (try rejectExtraArgs(it, mountdisk_image.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try mountdisk_image.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, mountdisk_upper.name)) {
        if (try rejectExtraArgs(it, mountdisk_upper.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try mountdisk_upper.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, reflink_copy.name)) {
        if (try rejectExtraArgs(it, reflink_copy.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try reflink_copy.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, rootfs_cache_key.name)) {
        if (try rejectExtraArgs(it, rootfs_cache_key.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try rootfs_cache_key.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, rootfs_materialize.name)) {
        if (try rejectExtraArgs(it, rootfs_materialize.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try rootfs_materialize.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, tree_manifest_hash.name)) {
        if (try rejectExtraArgs(it, tree_manifest_hash.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try tree_manifest_hash.run(allocator, g_io));
    }
    return null;
}

fn rejectExtraArgs(it: anytype, command_name: []const u8) !bool {
    assert(command_name.len > 0);

    if (it.next() == null) return false;
    var message_buf: [128]u8 = undefined;
    const message = try std.fmt.bufPrint(
        &message_buf,
        "{s} reads its JSON request from stdin and accepts no positional arguments",
        .{command_name},
    );
    try protocol.writeError(g_io, "USAGE", message);
    return true;
}

fn isHelp(command: []const u8) bool {
    assert(command.len > 0);

    return std.mem.eql(u8, command, "--help") or
        std.mem.eql(u8, command, "-h") or
        std.mem.eql(u8, command, "help");
}

fn writeHelp(allocator: std.mem.Allocator, io: std.Io) !u8 {
    assert(mkinitramfs.name.len > 0);
    assert(mountdisk_image.name.len > 0);
    assert(mountdisk_upper.name.len > 0);
    assert(reflink_copy.name.len > 0);
    assert(rootfs_cache_key.name.len > 0);
    assert(rootfs_materialize.name.len > 0);
    assert(tree_manifest_hash.name.len > 0);

    try protocol.writeJson(allocator, io, .{
        .ok = true,
        .protocolVersion = @as(u8, protocol.version),
        .commands = .{
            mkinitramfs.name,
            mountdisk_image.name,
            mountdisk_upper.name,
            reflink_copy.name,
            rootfs_cache_key.name,
            rootfs_materialize.name,
            tree_manifest_hash.name,
        },
    });
    return @intFromEnum(protocol.Exit.ok);
}
