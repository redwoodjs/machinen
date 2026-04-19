const std = @import("std");
const vmm = @import("vmm");

pub fn main(init: std.process.Init) !void {
    _ = init;
    std.debug.print("machinen-vmm: scaffold\n", .{});
    std.debug.print("target: arm64 HVF + x86_64/arm64 KVM Linux-guest VMM\n", .{});
    std.debug.print("next: hv_vm_create — boot a Debian kernel (see redwoodjs/machinen#42)\n", .{});

    const backend = vmm.detectBackend();
    std.debug.print("detected backend: {s}\n", .{@tagName(backend)});
}

test "backend detection is non-null" {
    const backend = vmm.detectBackend();
    try std.testing.expect(backend != .none);
}
