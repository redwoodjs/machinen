const std = @import("std");
const protocol = @import("protocol.zig");
const balloon_stats = @import("commands/balloon_stats.zig");
const boot_plan = @import("commands/boot_plan.zig");
const cleanup_path = @import("commands/cleanup_path.zig");
const cpu_cgroup_apply = @import("commands/cpu_cgroup_apply.zig");
const cpu_cgroup_remove = @import("commands/cpu_cgroup_remove.zig");
const host_memory = @import("commands/host_memory.zig");
const host_rss = @import("commands/host_rss.zig");
const mkinitramfs = @import("commands/mkinitramfs.zig");
const mountdisk_image = @import("commands/mountdisk_image.zig");
const mountdisk_upper = @import("commands/mountdisk_upper.zig");
const native_code_map = @import("commands/native_code_map.zig");
const nested_virt_probe = @import("commands/nested_virt_probe.zig");
const pid_validate = @import("commands/pid_validate.zig");
const process_identity = @import("commands/process_identity.zig");
const process_signal = @import("commands/process_signal.zig");
const reflink_copy = @import("commands/reflink_copy.zig");
const rootfs_cache_key = @import("commands/rootfs_cache_key.zig");
const rootfs_materialize = @import("commands/rootfs_materialize.zig");
const rootfs_prebake_decompress = @import("commands/rootfs_prebake_decompress.zig");
const rootfs_prebake_tree = @import("commands/rootfs_prebake_tree.zig");
const tree_manifest_hash = @import("commands/tree_manifest_hash.zig");
const vmstate_facts = @import("commands/vmstate_facts.zig");

var g_io: std.Io = undefined;

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    var it = init.minimal.args.iterate();
    _ = it.next(); // argv[0]

    const command = it.next() orelse {
        try protocol.writeError(g_io, "USAGE", "missing command");
        return @intFromEnum(protocol.Exit.usage);
    };

    if (std.mem.eql(u8, command, balloon_stats.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "balloon-stats reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try balloon_stats.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, boot_plan.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "boot-plan reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try boot_plan.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, cleanup_path.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "cleanup-path reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try cleanup_path.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, cpu_cgroup_apply.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "cpu-cgroup-apply reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try cpu_cgroup_apply.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, cpu_cgroup_remove.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "cpu-cgroup-remove reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try cpu_cgroup_remove.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, host_memory.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "host-memory reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try host_memory.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, host_rss.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "host-rss reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try host_rss.run(init.gpa, g_io));
    }

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

    if (std.mem.eql(u8, command, native_code_map.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "native-code-map reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try native_code_map.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, nested_virt_probe.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "nested-virt-probe reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try nested_virt_probe.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, pid_validate.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "pid-validate reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try pid_validate.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, process_identity.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "process-identity reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try process_identity.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, process_signal.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "process-signal reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try process_signal.run(init.gpa, g_io));
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

    if (std.mem.eql(u8, command, rootfs_prebake_decompress.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "rootfs-prebake-decompress reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try rootfs_prebake_decompress.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, rootfs_prebake_tree.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "rootfs-prebake-tree reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try rootfs_prebake_tree.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, vmstate_facts.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "vmstate-facts reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try vmstate_facts.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, tree_manifest_hash.name)) {
        if (it.next() != null) {
            try protocol.writeError(g_io, "USAGE", "tree-manifest-hash reads its JSON request from stdin and accepts no positional arguments");
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try tree_manifest_hash.run(init.gpa, g_io));
    }

    if (std.mem.eql(u8, command, "--help") or std.mem.eql(u8, command, "-h") or std.mem.eql(u8, command, "help")) {
        try protocol.stdout(g_io, "{\"ok\":true,\"protocolVersion\":1,\"commands\":[\"balloon-stats\",\"boot-plan\",\"cleanup-path\",\"cpu-cgroup-apply\",\"cpu-cgroup-remove\",\"host-memory\",\"host-rss\",\"mkinitramfs\",\"mountdisk-image\",\"mountdisk-upper\",\"native-code-map\",\"nested-virt-probe\",\"pid-validate\",\"process-identity\",\"process-signal\",\"reflink-copy\",\"rootfs-cache-key\",\"rootfs-materialize\",\"rootfs-prebake-decompress\",\"rootfs-prebake-tree\",\"tree-manifest-hash\",\"vmstate-facts\"]}\n");
        return @intFromEnum(protocol.Exit.ok);
    }

    try protocol.writeError(g_io, "UNKNOWN_COMMAND", "unknown command");
    return @intFromEnum(protocol.Exit.usage);
}
