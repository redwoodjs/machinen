// machinen-microvm entrypoint. Reads the asset paths the runtime hands
// down in env vars, dispatches on the host's available backend, and
// invokes the real boot path. The VMM is a dumb engine here: no cache
// discovery, no tag awareness — that's the CLI's job.
//
// Invoked by @machinen/runtime's boot(). Direct invocation requires
// setting the MACHINEN_* env vars by hand; the usage error below points
// at `machinen boot`.

const std = @import("std");
const builtin = @import("builtin");
const microvm = @import("microvm");

comptime {
    if (builtin.os.tag != .macos and builtin.os.tag != .linux) {
        @compileError("machinen-microvm only supports macOS (HVF) and arm64 Linux (KVM)");
    }
}

extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;

pub fn main(init: std.process.Init) !void {
    _ = init;

    const gpa = std.heap.page_allocator;

    const kernel_path = envRequired("MACHINEN_KERNEL");
    const dtb_path = envRequired("MACHINEN_DTB");
    const initrd_path = envRequired("MACHINEN_INITRD");

    // Guest console is live-echoed to stderr from inside the boot loop
    // (boot_hvf.zig's PL011 DR-write handler). The result.serial buffer is
    // the same bytes, captured for tests — don't re-emit here.
    if (builtin.os.tag == .macos) {
        const disk_path = envOptional("MACHINEN_DISK");
        const result = try microvm.boot_hvf.boot(gpa, .{
            .kernel_path = kernel_path,
            .dtb_path = dtb_path,
            .initrd_path = initrd_path,
            .disk_path = disk_path,
            .unbounded_serial = true,
        });
        gpa.free(result.serial);
        std.process.exit(if (result.saw_psci_shutdown) 0 else 1);
    } else {
        // KVM's Config doesn't carry disk_path yet — follow-up to #68.
        // The boot-to-shell goal doesn't need virtio-blk.
        const result = try microvm.boot_kvm.boot(gpa, .{
            .kernel_path = kernel_path,
            .dtb_path = dtb_path,
            .initrd_path = initrd_path,
            .unbounded_serial = true,
        });
        gpa.free(result.serial);
        std.process.exit(if (result.saw_psci_shutdown) 0 else 1);
    }
}

fn envRequired(comptime name: [:0]const u8) []const u8 {
    const raw = getenv(name.ptr) orelse dieUsage(name);
    const s = std.mem.span(raw);
    if (s.len == 0) dieUsage(name);
    return s;
}

fn envOptional(comptime name: [:0]const u8) ?[]const u8 {
    const raw = getenv(name.ptr) orelse return null;
    const s = std.mem.span(raw);
    return if (s.len == 0) null else s;
}

fn dieUsage(missing: []const u8) noreturn {
    std.debug.print(
        "machinen-microvm: {s} is unset.\n" ++
            "  This binary is invoked by @machinen/runtime, not directly.\n" ++
            "  Use `machinen boot` instead.\n",
        .{missing},
    );
    std.process.exit(2);
}

test "backend detection is non-null" {
    const backend = microvm.detectBackend();
    try std.testing.expect(backend != .none);
}
