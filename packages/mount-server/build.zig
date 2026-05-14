const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // The transport-agnostic FUSE handlers (#332), exported as a
    // module so `@machinen/microvm`'s in-VMM virtio-fs device can
    // reuse the #329 opcode handlers verbatim — same dispatch, same
    // `:ro` gate, same path-containment rules, just a different wire.
    // libc for the bare-extern fs syscalls the handlers issue.
    const fuse_mod = b.addModule("fuse", .{
        .root_source_file = b.path("src/fuse.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });

    const exe = b.addExecutable(.{
        .name = "machinen-mount-server",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            // libc for malloc/free (c_allocator) and the bare-extern
            // socket/fs syscalls — both darwin and linux targets need
            // this. Without it, cross-compiles to aarch64-linux-gnu
            // fail with "dependency on libc must be explicitly specified".
            .link_libc = true,
            .imports = &.{
                .{ .name = "fuse", .module = fuse_mod },
            },
        }),
    });
    b.installArtifact(exe);

    const exe_tests = b.addTest(.{
        .root_module = exe.root_module,
    });
    const run_exe_tests = b.addRunArtifact(exe_tests);
    run_exe_tests.setCwd(b.path("."));

    // The "fuse" module is a separate compilation unit, so the exe's
    // test binary doesn't pick up its `test` blocks — test it directly
    // as a module, which is also exactly how `@machinen/microvm`
    // consumes it.
    const fuse_tests = b.addTest(.{
        .root_module = fuse_mod,
    });
    const run_fuse_tests = b.addRunArtifact(fuse_tests);
    run_fuse_tests.setCwd(b.path("."));

    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_exe_tests.step);
    test_step.dependOn(&run_fuse_tests.step);
}
