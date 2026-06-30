const std = @import("std");
const builtin = @import("builtin");

pub fn build(b: *std.Build) void {
    std.debug.assert(builtin.zig_version.major > 0 or builtin.zig_version.minor >= 16);

    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const mod = b.addModule("runtime_helper", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });

    const exe = b.addExecutable(.{
        .name = "machinen-runtime-helper",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "runtime_helper", .module = mod },
            },
        }),
    });
    b.installArtifact(exe);

    const pdeathsig_mod = b.createModule(.{
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    pdeathsig_mod.addCSourceFile(.{
        .file = b.path("src/pdeathsig.c"),
        .flags = &.{ "-O2", "-Wall", "-Wextra" },
    });
    const pdeathsig = b.addExecutable(.{
        .name = "machinen-pdeathsig",
        .root_module = pdeathsig_mod,
    });
    b.installArtifact(pdeathsig);

    const run_step = b.step("run", "Run machinen-runtime-helper");
    const run_cmd = b.addRunArtifact(exe);
    run_step.dependOn(&run_cmd.step);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }

    const mod_tests = b.addTest(.{
        .root_module = mod,
    });
    const run_mod_tests = b.addRunArtifact(mod_tests);
    run_mod_tests.setCwd(b.path("."));

    const exe_tests = b.addTest(.{
        .root_module = exe.root_module,
    });
    const run_exe_tests = b.addRunArtifact(exe_tests);
    run_exe_tests.setCwd(b.path("."));

    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&run_mod_tests.step);
    test_step.dependOn(&run_exe_tests.step);
}
