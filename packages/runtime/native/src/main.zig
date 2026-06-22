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

const assert = std.debug.assert;

var g_io: std.Io = undefined;

pub fn main(init: std.process.Init) !u8 {
    assert(balloon_stats.name.len > 0);
    assert(boot_plan.name.len > 0);
    assert(cleanup_path.name.len > 0);
    assert(cpu_cgroup_apply.name.len > 0);
    assert(cpu_cgroup_remove.name.len > 0);
    assert(host_memory.name.len > 0);
    assert(host_rss.name.len > 0);
    assert(mkinitramfs.name.len > 0);
    assert(mountdisk_image.name.len > 0);
    assert(mountdisk_upper.name.len > 0);
    assert(native_code_map.name.len > 0);
    assert(nested_virt_probe.name.len > 0);
    assert(pid_validate.name.len > 0);
    assert(process_identity.name.len > 0);
    assert(process_signal.name.len > 0);
    assert(reflink_copy.name.len > 0);
    assert(rootfs_cache_key.name.len > 0);
    assert(rootfs_materialize.name.len > 0);
    assert(rootfs_prebake_decompress.name.len > 0);
    assert(rootfs_prebake_tree.name.len > 0);
    assert(tree_manifest_hash.name.len > 0);
    assert(vmstate_facts.name.len > 0);

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

    if (try runHostCommand(allocator, it, command)) |exit| return exit;
    if (try runFilesystemCommand(allocator, it, command)) |exit| return exit;
    return null;
}

fn runHostCommand(
    allocator: std.mem.Allocator,
    it: anytype,
    command: []const u8,
) !?u8 {
    assert(command.len > 0);

    if (std.mem.eql(u8, command, balloon_stats.name)) {
        if (try rejectExtraArgs(it, balloon_stats.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try balloon_stats.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, boot_plan.name)) {
        if (try rejectExtraArgs(it, boot_plan.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try boot_plan.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, cpu_cgroup_apply.name)) {
        if (try rejectExtraArgs(it, cpu_cgroup_apply.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try cpu_cgroup_apply.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, cpu_cgroup_remove.name)) {
        if (try rejectExtraArgs(it, cpu_cgroup_remove.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try cpu_cgroup_remove.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, host_memory.name)) {
        if (try rejectExtraArgs(it, host_memory.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try host_memory.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, host_rss.name)) {
        if (try rejectExtraArgs(it, host_rss.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try host_rss.run(allocator, g_io));
    }

    if (std.mem.eql(u8, command, native_code_map.name)) {
        if (try rejectExtraArgs(it, native_code_map.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try native_code_map.run(allocator, g_io));
    }

    if (std.mem.eql(u8, command, nested_virt_probe.name)) {
        if (try rejectExtraArgs(it, nested_virt_probe.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try nested_virt_probe.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, pid_validate.name)) {
        if (try rejectExtraArgs(it, pid_validate.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try pid_validate.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, process_identity.name)) {
        if (try rejectExtraArgs(it, process_identity.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try process_identity.run(allocator, g_io));
    }
    return null;
}

fn runFilesystemCommand(
    allocator: std.mem.Allocator,
    it: anytype,
    command: []const u8,
) !?u8 {
    assert(command.len > 0);

    if (std.mem.eql(u8, command, cleanup_path.name)) {
        if (try rejectExtraArgs(it, cleanup_path.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try cleanup_path.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, mkinitramfs.name)) {
        if (try rejectExtraArgs(it, mkinitramfs.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
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

    if (std.mem.eql(u8, command, process_signal.name)) {
        if (try rejectExtraArgs(it, process_signal.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try process_signal.run(allocator, g_io));
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
    if (std.mem.eql(u8, command, rootfs_prebake_decompress.name)) {
        if (try rejectExtraArgs(it, rootfs_prebake_decompress.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try rootfs_prebake_decompress.run(allocator, g_io));
    }
    if (std.mem.eql(u8, command, rootfs_prebake_tree.name)) {
        if (try rejectExtraArgs(it, rootfs_prebake_tree.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try rootfs_prebake_tree.run(allocator, g_io));
    }

    if (std.mem.eql(u8, command, vmstate_facts.name)) {
        if (try rejectExtraArgs(it, vmstate_facts.name)) {
            return @intFromEnum(protocol.Exit.usage);
        }
        return @intFromEnum(try vmstate_facts.run(allocator, g_io));
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
    assert(balloon_stats.name.len > 0);
    assert(boot_plan.name.len > 0);
    assert(cleanup_path.name.len > 0);
    assert(cpu_cgroup_apply.name.len > 0);
    assert(cpu_cgroup_remove.name.len > 0);
    assert(host_memory.name.len > 0);
    assert(host_rss.name.len > 0);
    assert(mkinitramfs.name.len > 0);
    assert(mountdisk_image.name.len > 0);
    assert(mountdisk_upper.name.len > 0);
    assert(native_code_map.name.len > 0);
    assert(nested_virt_probe.name.len > 0);
    assert(pid_validate.name.len > 0);
    assert(process_identity.name.len > 0);
    assert(process_signal.name.len > 0);
    assert(reflink_copy.name.len > 0);
    assert(rootfs_cache_key.name.len > 0);
    assert(rootfs_materialize.name.len > 0);
    assert(rootfs_prebake_decompress.name.len > 0);
    assert(rootfs_prebake_tree.name.len > 0);
    assert(tree_manifest_hash.name.len > 0);
    assert(vmstate_facts.name.len > 0);

    try protocol.writeJson(allocator, io, .{
        .ok = true,
        .protocolVersion = @as(u8, protocol.version),
        .commands = .{
            balloon_stats.name,
            boot_plan.name,
            cleanup_path.name,
            cpu_cgroup_apply.name,
            cpu_cgroup_remove.name,
            host_memory.name,
            host_rss.name,
            mkinitramfs.name,
            mountdisk_image.name,
            mountdisk_upper.name,
            native_code_map.name,
            nested_virt_probe.name,
            pid_validate.name,
            process_identity.name,
            process_signal.name,
            reflink_copy.name,
            rootfs_cache_key.name,
            rootfs_materialize.name,
            rootfs_prebake_decompress.name,
            rootfs_prebake_tree.name,
            tree_manifest_hash.name,
            vmstate_facts.name,
        },
    });
    return @intFromEnum(protocol.Exit.ok);
}
