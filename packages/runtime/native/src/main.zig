const std = @import("std");
const protocol = @import("protocol.zig");
const mkinitramfs = @import("commands/mkinitramfs.zig");
const mountdisk_image = @import("commands/mountdisk_image.zig");
const mountdisk_upper = @import("commands/mountdisk_upper.zig");
const reflink_copy = @import("commands/reflink_copy.zig");
const rootfs_cache_key = @import("commands/rootfs_cache_key.zig");
const rootfs_materialize = @import("commands/rootfs_materialize.zig");
const tree_manifest_hash = @import("commands/tree_manifest_hash.zig");

var g_io: std.Io = undefined;

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    var it = init.minimal.args.iterate();
    _ = it.next(); // argv[0]

    const command = it.next() orelse {
        try protocol.writeError(g_io, "USAGE", "missing command");
        return @intFromEnum(protocol.Exit.usage);
    };

    if (std.mem.eql(u8, command, mkinitramfs.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "mkinitramfs reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try mkinitramfs.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, mountdisk_image.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "mountdisk-image reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try mountdisk_image.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, mountdisk_upper.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "mountdisk-upper reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try mountdisk_upper.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, reflink_copy.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "reflink-copy reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try reflink_copy.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, rootfs_cache_key.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "rootfs-cache-key reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try rootfs_cache_key.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, rootfs_materialize.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "rootfs-materialize reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try rootfs_materialize.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, tree_manifest_hash.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "tree-manifest-hash reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try tree_manifest_hash.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, "--help") or std.mem.eql(u8, command, "-h") or std.mem.eql(u8, command, "help")) {
        try protocol.stdout(g_io, "{\"ok\":true,\"protocolVersion\":1,\"commands\":[\"mkinitramfs\",\"mountdisk-image\",\"mountdisk-upper\",\"reflink-copy\",\"rootfs-cache-key\",\"rootfs-materialize\",\"tree-manifest-hash\"]}\n");
        return @intFromEnum(protocol.Exit.ok);
    }

    try protocol.writeError(g_io, "UNKNOWN_COMMAND", "unknown command");
    return @intFromEnum(protocol.Exit.usage);
}
