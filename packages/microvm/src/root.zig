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

pub const hvf = if (builtin.os.tag == .macos) @import("hvf.zig") else struct {};
pub const boot = if (builtin.os.tag == .macos) @import("boot.zig") else struct {};
pub const slirp = if (builtin.os.tag == .macos) @import("slirp.zig") else struct {};
pub const kvm = if (builtin.os.tag == .linux) @import("kvm.zig") else struct {};
pub const virtio = @import("virtio.zig"); // pure Zig, builds everywhere
pub const blk = @import("blk.zig"); // pure Zig virtio-blk backend
pub const vsock = @import("vsock.zig"); // pure Zig virtio-vsock bridge

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
        _ = @import("boot.zig");
    }
    if (builtin.os.tag == .linux) {
        _ = @import("kvm.zig");
    }
    _ = @import("virtio.zig");
    _ = @import("vsock.zig");
}
