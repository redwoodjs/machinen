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

const assert = std.debug.assert;

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
    // #263 phase A: optional ceiling override. Runtime auto-sizes and
    // forwards a value; direct invocations get the boot_*.zig default.
    const ram_size_override = envMemoryMib();

    // Guest console is live-echoed to stderr from inside the boot loop
    // (boot_hvf.zig's PL011 DR-write handler). The result.serial buffer is
    // the same bytes, captured for tests — don't re-emit here.
    // Production boots end on PSCI SYSTEM_OFF or a fatal exception, not
    // on a vCPU-exit counter. The 5_000_000 default in boot_{hvf,kvm}.zig
    // is a test-fixture safety valve — easy to hit during a long-running
    // interactive shell or a busy server, where it surfaces as a
    // mysterious `error.RanTooLong` and the VM dies mid-session. Lift
    // the cap here.
    // #272: optional fds for the mount-overlay slots. The runtime
    // opens both files (squashfs lower, ext4 upper) before posix_spawn
    // and passes the inherited fd numbers in the env. The VMM then
    // wraps them as virtio-blk backends without ever consulting the
    // host source dir.
    const mountdisk_lower_fd = envInt("MACHINEN_MOUNTDISK_LOWER_FD");
    const mountdisk_upper_fd = envInt("MACHINEN_MOUNTDISK_UPPER_FD");

    if (builtin.os.tag == .macos) {
        const disk_path = envOptional("MACHINEN_DISK");
        const rootdisk_path = envOptional("MACHINEN_ROOTDISK");
        var cfg: microvm.boot_hvf.Config = .{
            .kernel_path = kernel_path,
            .dtb_path = dtb_path,
            .initrd_path = initrd_path,
            .rootdisk_path = rootdisk_path,
            .disk_path = disk_path,
            .mountdisk_lower_fd = mountdisk_lower_fd,
            .mountdisk_upper_fd = mountdisk_upper_fd,
            .unbounded_serial = true,
            .max_exits = std.math.maxInt(usize),
        };
        if (ram_size_override) |bytes| cfg.ram_size = bytes;
        const result = try microvm.boot_hvf.boot(gpa, cfg);
        gpa.free(result.serial);
        std.process.exit(if (result.saw_psci_shutdown) 0 else 1);
    } else {
        const disk_path = envOptional("MACHINEN_DISK");
        const rootdisk_path = envOptional("MACHINEN_ROOTDISK");
        var cfg: microvm.boot_kvm.Config = .{
            .kernel_path = kernel_path,
            .dtb_path = dtb_path,
            .initrd_path = initrd_path,
            .rootdisk_path = rootdisk_path,
            .disk_path = disk_path,
            .mountdisk_lower_fd = mountdisk_lower_fd,
            .mountdisk_upper_fd = mountdisk_upper_fd,
            .unbounded_serial = true,
            .max_exits = std.math.maxInt(usize),
        };
        if (ram_size_override) |bytes| cfg.ram_size = bytes;
        const result = try microvm.boot_kvm.boot(gpa, cfg);
        gpa.free(result.serial);
        std.process.exit(if (result.saw_psci_shutdown) 0 else 1);
    }
}

/// Read an integer from the env. Returns null when the var is unset
/// or empty; rejects non-numeric values with a die() rather than
/// silently treating them as 0 (a fd of 0 is stdin and would mask a
/// configuration mistake).
fn envInt(comptime name: [:0]const u8) ?c_int {
    comptime assert(name.len > 0);
    const raw = getenv(name.ptr) orelse return null;
    const s = std.mem.span(raw);
    if (s.len == 0) return null;
    const parsed = std.fmt.parseInt(c_int, s, 10) catch {
        std.debug.print(
            "machinen-microvm: {s}={s} is invalid: must be a decimal integer fd.\n",
            .{ name, s },
        );
        std.process.exit(2);
    };
    if (parsed < 0) {
        std.debug.print(
            "machinen-microvm: {s}={d} is invalid: fd must be non-negative.\n",
            .{ name, parsed },
        );
        std.process.exit(2);
    }
    return parsed;
}

/// Read MACHINEN_MEMORY (decimal MiB, no unit suffix). Returns the
/// value in bytes, or null if the var is unset / empty. Refuses
/// anything we can't safely turn into a `usize` byte count: bad
/// digits, zero, or values that would overflow.
fn envMemoryMib() ?usize {
    const raw = getenv("MACHINEN_MEMORY") orelse return null;
    const s = std.mem.span(raw);
    if (s.len == 0) return null;
    const mib = std.fmt.parseInt(u64, s, 10) catch dieMemory(s, "must be a decimal integer");
    if (mib == 0) dieMemory(s, "must be > 0");
    const bytes = std.math.mul(u64, mib, 1024 * 1024) catch dieMemory(s, "value overflows usize");
    if (bytes > std.math.maxInt(usize)) dieMemory(s, "value overflows usize");
    return @intCast(bytes);
}

fn dieMemory(value: []const u8, why: []const u8) noreturn {
    std.debug.print(
        "machinen-microvm: MACHINEN_MEMORY={s} is invalid: {s} (MiB, no unit suffix).\n",
        .{ value, why },
    );
    std.process.exit(2);
}

fn envRequired(comptime name: [:0]const u8) []const u8 {
    comptime assert(name.len > 0);
    const raw = getenv(name.ptr) orelse dieUsage(name);
    const s = std.mem.span(raw);
    if (s.len == 0) dieUsage(name);
    assert(s.len > 0);
    return s;
}

fn envOptional(comptime name: [:0]const u8) ?[]const u8 {
    comptime assert(name.len > 0);
    const raw = getenv(name.ptr) orelse return null;
    const s = std.mem.span(raw);
    return if (s.len == 0) null else s;
}

fn dieUsage(missing: []const u8) noreturn {
    assert(missing.len > 0);
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
