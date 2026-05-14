const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // The transport-agnostic FUSE handlers (#332), exported as a
    // module so `@machinen/microvm`'s in-VMM virtio-fs device can
    // reuse the #329 opcode handlers verbatim — same dispatch, same
    // `:ro` gate, same path-containment rules, just a different wire.
    // libc for the bare-extern fs syscalls the handlers issue.
    //
    // #338 removed the FUSE-over-vsock transport — the standalone
    // `machinen-mount-server` executable and its `src/main.zig` shim
    // are gone. Only the `fuse` module remains, consumed by the in-VMM
    // virtio-fs device. This package builds and tests just that module.
    const fuse_mod = b.addModule("fuse", .{
        .root_source_file = b.path("src/fuse.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });

    // The "fuse" module is a separate compilation unit; test it
    // directly as a module — which is also exactly how
    // `@machinen/microvm` consumes it.
    const fuse_tests = b.addTest(.{
        .root_module = fuse_mod,
    });
    const run_fuse_tests = b.addRunArtifact(fuse_tests);
    run_fuse_tests.setCwd(b.path("."));

    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_fuse_tests.step);
}
