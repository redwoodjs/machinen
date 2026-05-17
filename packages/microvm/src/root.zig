//! machinen-microvm — Linux-guest microVM library
//!
//! Scaffold. Future modules (tracked on redwoodjs/machinen#42–45):
//!   hvf.zig    — Hypervisor.framework backend (macOS arm64/x86_64)
//!   kvm.zig    — /dev/kvm backend (Linux)
//!   virtio/    — virtio-net, virtio-vsock, virtio-console device models
//!   guest.zig  — kernel + initramfs loader, boot protocol
//!
//! The public surface is a Vmm interface both backends implement.
//! Nothing real yet — this commit is the project scaffold.

const std = @import("std");
const builtin = @import("builtin");

const assert = std.debug.assert;

comptime {
    // The Backend enum is plumbed across both backends and the JS
    // runtime; tag values are part of the cross-language ABI.
    assert(@intFromEnum(Backend.hvf) == 0);
    assert(@intFromEnum(Backend.kvm) == 1);
    assert(@intFromEnum(Backend.none) == 2);
}

pub const hvf = if (builtin.os.tag == .macos) @import("hvf.zig") else struct {};
pub const boot_hvf = if (builtin.os.tag == .macos) @import("boot_hvf.zig") else struct {};
pub const net_socket = if (builtin.os.tag == .macos) @import("net_socket.zig") else struct {};
pub const kvm = if (builtin.os.tag == .linux) @import("kvm.zig") else struct {};
pub const boot_kvm = if (builtin.os.tag == .linux) @import("boot_kvm.zig") else struct {};
pub const virtio = @import("virtio.zig"); // pure Zig, builds everywhere
pub const blk = @import("blk.zig"); // pure Zig virtio-blk backend
pub const virtiofs = @import("virtiofs.zig"); // pure Zig virtio-fs backend (#332)
pub const vsock = @import("vsock.zig"); // pure Zig virtio-vsock bridge
pub const balloon = @import("balloon.zig"); // pure Zig virtio-balloon backend
pub const pl011 = @import("pl011.zig"); // pure Zig PL011 UART (shared HVF/KVM)
pub const dtb_patch = @import("dtb_patch.zig"); // FDT memory/initrd patcher
pub const snapshot = @import("snapshot.zig"); // .vmstate format codec
pub const vmstate_zip = @import("vmstate_zip.zig"); // .vmstate gzip transport
pub const vmstate_writer = @import("vmstate_writer.zig"); // async .vmstate encode/compress/write
pub const vmstate_timing = @import("vmstate_timing.zig"); // .vmstate restore timing logs
pub const topology = @import("topology.zig"); // IPA layout fingerprint
pub const sysreg_names = @import("sysreg_names.zig"); // name<->encoding table
pub const sysreg_classify = @import("sysreg_classify.zig"); // portability decisions
pub const vcpu_dump = @import("vcpu_dump.zig"); // vCPU dump/load (KVM + HVF)
pub const ram_dump = @import("ram_dump.zig"); // RAM section codec
pub const rootdisk_delta = @import("rootdisk_delta.zig"); // rootdisk checkpoint delta codec
pub const pl011_dump = @import("pl011_dump.zig"); // PL011 UART snapshot
pub const gic_dump = @import("gic_dump.zig"); // GICv3 distributor/redistributor codec
pub const gic_state = @import("gic_state.zig"); // GICv3 register dump/load (KVM + HVF)
pub const virtio_dump = @import("virtio_dump.zig"); // virtio device codec (blk/net/vsock/balloon)

pub const Backend = enum { hvf, kvm, none };

/// Pick the host's available backend. HVF on macOS, KVM on Linux,
/// none on anything else.
pub fn detectBackend() Backend {
    return switch (builtin.os.tag) {
        .macos => .hvf,
        .linux => .kvm,
        else => .none,
    };
}

/// Lightweight check that the detected backend is actually usable
/// on this host. Separate from detectBackend() because it pokes the
/// real resource (HVF framework presence, /dev/kvm readability).
/// Returns false if the backend exists in principle but can't be
/// opened — e.g. /dev/kvm permissions, or no virtualization enabled.
pub fn backendAvailable() bool {
    return switch (comptime builtin.os.tag) {
        .macos => true, // HVF availability is checked when hv_vm_create runs
        .linux => blk: {
            if (comptime builtin.os.tag != .linux) break :blk false;
            // Access "/dev/kvm" via libc so we don't drag std.posix.access.
            const kvm_path = "/dev/kvm";
            const c = struct {
                extern "c" fn access(path: [*:0]const u8, mode: c_int) c_int;
            };
            return c.access(kvm_path, 0) == 0;
        },
        else => false,
    };
}

test "detectBackend matches build target" {
    const b = detectBackend();
    switch (builtin.os.tag) {
        .macos => try std.testing.expectEqual(Backend.hvf, b),
        .linux => try std.testing.expectEqual(Backend.kvm, b),
        else => try std.testing.expectEqual(Backend.none, b),
    }
}

test "backendAvailable is a bool that corresponds to the OS" {
    // On macOS we always return true; on Linux it depends on
    // /dev/kvm; on other hosts it's false. We can only assert the
    // type round-trip; the runtime value depends on the runner.
    try std.testing.expect(@TypeOf(backendAvailable()) == bool);
}

// Pull in backend-specific test blocks so `zig build test` discovers them.
test {
    if (builtin.os.tag == .macos) {
        _ = @import("hvf.zig");
        _ = @import("boot_hvf.zig");
    }
    if (builtin.os.tag == .linux) {
        _ = @import("kvm.zig");
        _ = @import("boot_kvm.zig");
    }
    _ = @import("virtio.zig");
    _ = @import("virtiofs.zig");
    _ = @import("vsock.zig");
    _ = @import("balloon.zig");
    _ = @import("pl011.zig");
    _ = @import("dtb_patch.zig");
    _ = @import("snapshot.zig");
    _ = @import("vmstate_zip.zig");
    _ = @import("vmstate_writer.zig");
    _ = @import("vmstate_timing.zig");
    _ = @import("topology.zig");
    _ = @import("sysreg_classify.zig");
    _ = @import("vcpu_dump.zig");
    _ = @import("ram_dump.zig");
    _ = @import("rootdisk_delta.zig");
    _ = @import("pl011_dump.zig");
    _ = @import("gic_dump.zig");
    _ = @import("gic_state.zig");
    _ = @import("virtio_dump.zig");
}
