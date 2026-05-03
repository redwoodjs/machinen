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
extern "c" fn signal(sig: c_int, handler: usize) usize;

// SIG_IGN is `(void (*)(int)) 1` on every Unix the VMM runs on.
const SIG_IGN: usize = 1;
const SIGPIPE: c_int = 13;

pub fn main(init: std.process.Init) !void {
    _ = init;

    // Survive a vanished console reader. The `--detached` boot path
    // (issue #150) intentionally lets the runtime parent exit while
    // the VMM keeps running — at that point the stderr pipe has no
    // reader, and the next PL011 DR-write echo (boot_hvf.zig:628 /
    // the KVM equivalent) would otherwise SIGPIPE-kill the VMM.
    // The console write call sites already discard the return value,
    // so silencing the signal is the only piece missing.
    _ = signal(SIGPIPE, SIG_IGN);

    const gpa = std.heap.page_allocator;

    const kernel_path = envRequired("MACHINEN_KERNEL");
    const dtb_path = envRequired("MACHINEN_DTB");
    const initrd_path = envRequired("MACHINEN_INITRD");

    // Guest console is live-echoed to stderr from inside the boot loop
    // (boot_hvf.zig's PL011 DR-write handler). The result.serial buffer is
    // the same bytes, captured for tests — don't re-emit here.
    // Production boots end on PSCI SYSTEM_OFF or a fatal exception, not
    // on a vCPU-exit counter. The 5_000_000 default in boot_{hvf,kvm}.zig
    // is a test-fixture safety valve — easy to hit during a long-running
    // interactive shell or a busy server, where it surfaces as a
    // mysterious `error.RanTooLong` and the VM dies mid-session. Lift
    // the cap here.
    if (builtin.os.tag == .macos) {
        const disk_path = envOptional("MACHINEN_DISK");
        const rootdisk_path = envOptional("MACHINEN_ROOTDISK");
        const result = try microvm.boot_hvf.boot(gpa, .{
            .kernel_path = kernel_path,
            .dtb_path = dtb_path,
            .initrd_path = initrd_path,
            .rootdisk_path = rootdisk_path,
            .disk_path = disk_path,
            .unbounded_serial = true,
            .max_exits = std.math.maxInt(usize),
        });
        gpa.free(result.serial);
        std.process.exit(if (result.saw_psci_shutdown) 0 else 1);
    } else {
        const disk_path = envOptional("MACHINEN_DISK");
        const rootdisk_path = envOptional("MACHINEN_ROOTDISK");
        const result = try microvm.boot_kvm.boot(gpa, .{
            .kernel_path = kernel_path,
            .dtb_path = dtb_path,
            .initrd_path = initrd_path,
            .rootdisk_path = rootdisk_path,
            .disk_path = disk_path,
            .unbounded_serial = true,
            .max_exits = std.math.maxInt(usize),
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
