const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const sqlite = b.dependency("sqlite", .{});
    const session = b.addModule("session", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    session.addIncludePath(sqlite.path("."));
    session.addCSourceFile(.{
        .file = sqlite.path("sqlite3.c"),
        .flags = &.{
            "-std=c99",
            "-DSQLITE_THREADSAFE=1",
            "-DSQLITE_DEFAULT_FOREIGN_KEYS=1",
            "-DSQLITE_DEFAULT_WAL_SYNCHRONOUS=1",
            "-DSQLITE_DQS=0",
            "-DSQLITE_OMIT_DEPRECATED",
            "-DSQLITE_OMIT_LOAD_EXTENSION",
        },
    });

    const vt = b.createModule(.{
        .root_source_file = b.path("src/vt.zig"),
        .target = target,
        .optimize = optimize,
    });

    const worker = b.createModule(.{
        .root_source_file = b.path("src/worker.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .imports = &.{
            .{ .name = "session", .module = session },
            .{ .name = "vt", .module = vt },
        },
    });

    const exe = b.addExecutable(.{
        .name = "machinen-session",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "session", .module = session },
                .{ .name = "worker", .module = worker },
            },
        }),
    });
    b.installArtifact(exe);

    const module_tests = b.addTest(.{ .root_module = session });
    const run_module_tests = b.addRunArtifact(module_tests);
    run_module_tests.setCwd(b.path("."));

    const vt_tests = b.addTest(.{ .root_module = vt });
    const run_vt_tests = b.addRunArtifact(vt_tests);
    run_vt_tests.setCwd(b.path("."));

    const worker_tests = b.addTest(.{ .root_module = worker });
    const run_worker_tests = b.addRunArtifact(worker_tests);
    run_worker_tests.setCwd(b.path("."));

    const cli_tests = b.addTest(.{ .root_module = exe.root_module });
    const run_cli_tests = b.addRunArtifact(cli_tests);
    run_cli_tests.setCwd(b.path("."));

    const test_step = b.step("test", "Run session persistence and worker tests");
    test_step.dependOn(&run_module_tests.step);
    test_step.dependOn(&run_vt_tests.step);
    test_step.dependOn(&run_worker_tests.step);
    test_step.dependOn(&run_cli_tests.step);
}
