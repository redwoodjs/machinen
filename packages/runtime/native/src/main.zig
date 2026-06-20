const std = @import("std");
const protocol = @import("protocol.zig");
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

    if (std.mem.eql(u8, command, tree_manifest_hash.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "tree-manifest-hash reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try tree_manifest_hash.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, "--help") or std.mem.eql(u8, command, "-h") or std.mem.eql(u8, command, "help")) {
        try protocol.stdout(g_io, "{\"ok\":true,\"protocolVersion\":1,\"commands\":[\"tree-manifest-hash\"]}\n");
        return @intFromEnum(protocol.Exit.ok);
    }

    try protocol.writeError(g_io, "UNKNOWN_COMMAND", "unknown command");
    return @intFromEnum(protocol.Exit.usage);
}
