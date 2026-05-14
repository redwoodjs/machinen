const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

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
        }),
    });
    b.installArtifact(exe);

    const exe_tests = b.addTest(.{
        .root_module = exe.root_module,
    });
    const run_exe_tests = b.addRunArtifact(exe_tests);
    run_exe_tests.setCwd(b.path("."));

    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_exe_tests.step);
}
