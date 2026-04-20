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
pub const virtio = @import("virtio.zig"); // pure Zig, builds everywhere
pub const blk = @import("blk.zig"); // pure Zig virtio-blk backend

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

test "detectBackend matches build target" {
    const b = detectBackend();
    switch (builtin.os.tag) {
        .macos => try std.testing.expectEqual(Backend.hvf, b),
        .linux => try std.testing.expectEqual(Backend.kvm, b),
        else => try std.testing.expectEqual(Backend.none, b),
    }
}

// Pull in backend-specific test blocks so `zig build test` discovers them.
test {
    if (builtin.os.tag == .macos) {
        _ = @import("hvf.zig");
        _ = @import("boot.zig");
    }
    _ = @import("virtio.zig");
}
