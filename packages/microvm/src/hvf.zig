//! Hypervisor.framework bindings. See .docs/learnings/microvm/hvf.md.
//!
//! macOS-only. Importing on other OSes produces a compile error.

const std = @import("std");
const builtin = @import("builtin");

comptime {
    if (builtin.os.tag != .macos) {
        @compileError("hvf.zig only builds on macOS");
    }
}

// Cherry-pick headers — the umbrella Hypervisor.h pulls in
// hv_vcpu_config.h, which has a `uint64_t values[_Nonnull 8]`
// declaration that Zig's translate-c can't parse. We only need VM
// lifecycle for the smoke test; vCPU config comes in a later pass
// with manual extern declarations.
pub const c = @cImport({
    @cInclude("Hypervisor/hv_error.h");
    @cInclude("Hypervisor/hv_vm.h");
});

pub const Error = error{
    Denied, // missing com.apple.security.hypervisor entitlement
    Busy,
    BadArgument,
    IllegalGuestState,
    NoResources,
    NoDevice,
    Unsupported,
    Unknown,
};

fn check(ret: c.hv_return_t) Error!void {
    if (ret == c.HV_SUCCESS) return;
    return switch (ret) {
        c.HV_ERROR => error.Unknown,
        c.HV_BUSY => error.Busy,
        c.HV_BAD_ARGUMENT => error.BadArgument,
        c.HV_ILLEGAL_GUEST_STATE => error.IllegalGuestState,
        c.HV_NO_RESOURCES => error.NoResources,
        c.HV_NO_DEVICE => error.NoDevice,
        c.HV_DENIED => error.Denied,
        c.HV_UNSUPPORTED => error.Unsupported,
        else => error.Unknown,
    };
}

/// Process-wide VM context. HVF currently supports one VM per process.
pub const Vm = struct {
    pub fn create() Error!Vm {
        try check(c.hv_vm_create(null));
        return .{};
    }

    pub fn destroy(_: Vm) void {
        _ = c.hv_vm_destroy();
    }
};

test "hv_vm_create and destroy" {
    // This test is an integration smoke check: proof that the HVF
    // bindings compile, link, and make a real syscall. Either HV_SUCCESS
    // (binary is signed with com.apple.security.hypervisor) or HV_DENIED
    // (unsigned) counts as a pass — both mean the call reached HVF.
    // Anything else is a genuine failure.
    const vm = Vm.create() catch |err| switch (err) {
        error.Denied => {
            std.debug.print(
                "hv_vm_create: HV_DENIED — expected without entitlement\n",
                .{},
            );
            return;
        },
        else => return err,
    };
    defer vm.destroy();
    std.debug.print("hv_vm_create: HV_SUCCESS (entitled)\n", .{});
}
