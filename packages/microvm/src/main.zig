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
        @compileError("machinen-microvm only supports macOS (HVF) and Linux (KVM)");
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

    if (env_bool("MACHINEN_NESTED_PROBE")) {
        probe_nested_support();
    }

    const kernel_path = env_required("MACHINEN_KERNEL");
    const dtb_path = env_optional("MACHINEN_DTB");
    const initrd_path = env_required("MACHINEN_INITRD");
    // #263 phase A: optional ceiling override. Runtime auto-sizes and
    // forwards a value; direct invocations get the boot_*.zig default.
    const ram_size_override = env_memory_mib();
    // #271: explicit opt-in to expose EL2 / nested virtualization to
    // the guest. The runtime sets this from boot({ nested: true }).
    const nested = env_bool("MACHINEN_NESTED");

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
    const mountdisk_lower_fd = env_int("MACHINEN_MOUNTDISK_LOWER_FD");
    const mountdisk_upper_fd = env_int("MACHINEN_MOUNTDISK_UPPER_FD");

    // Snapshot/restore plumbing — host orchestrator drives via env.
    // MACHINEN_RESTORE_PATH: load .vmstate at boot before vcpu.run().
    // MACHINEN_SNAPSHOT_PATH: capture on SIGUSR1, write .vmstate, then resume after SIGUSR2.
    const restore_path = env_optional("MACHINEN_RESTORE_PATH");
    const snapshot_path = env_optional("MACHINEN_SNAPSHOT_PATH");

    if (builtin.os.tag == .macos) {
        const disk_path = env_optional("MACHINEN_DISK");
        const rootdisk_path = env_optional("MACHINEN_ROOTDISK");
        const hvf_dtb_path = dtb_path orelse env_required("MACHINEN_DTB");
        var cfg: microvm.boot_hvf.Config = .{
            .kernel_path = kernel_path,
            .dtb_path = hvf_dtb_path,
            .initrd_path = initrd_path,
            .rootdisk_path = rootdisk_path,
            .disk_path = disk_path,
            .mountdisk_lower_fd = mountdisk_lower_fd,
            .mountdisk_upper_fd = mountdisk_upper_fd,
            .unbounded_serial = true,
            .max_exits = std.math.maxInt(usize),
            .restore_path = restore_path,
            .snapshot_path = snapshot_path,
            .nested = nested,
        };
        if (ram_size_override) |bytes| cfg.ram_size = bytes;
        const result = try microvm.boot_hvf.boot(gpa, cfg);
        gpa.free(result.serial);
        // Exit 0 on snapshot too — orchestrator distinguishes via the
        // .vmstate file's existence.
        std.process.exit(if (result.saw_psci_shutdown or result.snapshotted) 0 else 1);
    } else {
        const disk_path = env_optional("MACHINEN_DISK");
        const rootdisk_path = env_optional("MACHINEN_ROOTDISK");
        if (builtin.cpu.arch == .x86_64) {
            if (nested) {
                std.debug.print("machinen-microvm: nested virtualization unsupported on x86_64 hosts\n", .{});
                std.process.exit(2);
            }
            var cfg: microvm.boot_kvm_x86_64.Config = .{
                .kernel_path = kernel_path,
                .initrd_path = initrd_path,
                .rootdisk_path = rootdisk_path,
                .disk_path = disk_path,
                .mountdisk_lower_fd = mountdisk_lower_fd,
                .mountdisk_upper_fd = mountdisk_upper_fd,
                .unbounded_serial = true,
                .max_exits = std.math.maxInt(usize),
                .restore_path = restore_path,
                .snapshot_path = snapshot_path,
            };
            if (ram_size_override) |bytes| cfg.ram_size = bytes;
            const result = try microvm.boot_kvm_x86_64.boot(gpa, cfg);
            gpa.free(result.serial);
            std.process.exit(if (result.saw_psci_shutdown or result.snapshotted) 0 else 1);
        } else {
            const arm_dtb_path = dtb_path orelse env_required("MACHINEN_DTB");
            var cfg: microvm.boot_kvm.Config = .{
                .kernel_path = kernel_path,
                .dtb_path = arm_dtb_path,
                .initrd_path = initrd_path,
                .rootdisk_path = rootdisk_path,
                .disk_path = disk_path,
                .mountdisk_lower_fd = mountdisk_lower_fd,
                .mountdisk_upper_fd = mountdisk_upper_fd,
                .unbounded_serial = true,
                .max_exits = std.math.maxInt(usize),
                .restore_path = restore_path,
                .snapshot_path = snapshot_path,
                .nested = nested,
            };
            if (ram_size_override) |bytes| cfg.ram_size = bytes;
            const result = try microvm.boot_kvm.boot(gpa, cfg);
            gpa.free(result.serial);
            std.process.exit(if (result.saw_psci_shutdown or result.snapshotted) 0 else 1);
        }
    }
}

fn probe_nested_support() noreturn {
    if (builtin.os.tag == .macos) {
        if (microvm.hvf.nested_supported()) {
            std.debug.print("machinen-microvm: nested virtualization supported\n", .{});
            std.process.exit(0);
        }
        std.debug.print("machinen-microvm: nested virtualization unsupported: Hypervisor.framework EL2 support is unavailable\n", .{});
        std.process.exit(2);
    } else {
        if (builtin.cpu.arch == .x86_64) {
            std.debug.print("machinen-microvm: nested virtualization unsupported: x86_64 hosts are not supported\n", .{});
            std.process.exit(2);
        }
        var k = microvm.kvm.Kvm.open_() catch |err| {
            std.debug.print("machinen-microvm: nested virtualization unsupported: /dev/kvm probe failed: {s}\n", .{@errorName(err)});
            std.process.exit(2);
        };
        defer k.close_();
        if (k.arm_el2_supported()) {
            std.debug.print("machinen-microvm: nested virtualization supported\n", .{});
            std.process.exit(0);
        }
        std.debug.print("machinen-microvm: nested virtualization unsupported: KVM_CAP_ARM_EL2 is unavailable\n", .{});
        std.process.exit(2);
    }
}

fn env_bool(comptime name: [:0]const u8) bool {
    comptime assert(name.len > 0);
    const raw = getenv(name.ptr) orelse return false;
    const s = std.mem.span(raw);
    if (s.len == 0) return false;
    if (std.ascii.eqlIgnoreCase(s, "1") or
        std.ascii.eqlIgnoreCase(s, "true") or
        std.ascii.eqlIgnoreCase(s, "yes") or
        std.ascii.eqlIgnoreCase(s, "on")) return true;
    if (std.ascii.eqlIgnoreCase(s, "0") or
        std.ascii.eqlIgnoreCase(s, "false") or
        std.ascii.eqlIgnoreCase(s, "no") or
        std.ascii.eqlIgnoreCase(s, "off")) return false;
    std.debug.print(
        "machinen-microvm: {s}={s} is invalid: expected 1/true/yes/on or 0/false/no/off.\n",
        .{ name, s },
    );
    std.process.exit(2);
}

/// Read an integer from the env. Returns null when the var is unset
/// or empty; rejects non-numeric values with a die() rather than
/// silently treating them as 0 (a fd of 0 is stdin and would mask a
/// configuration mistake).
fn env_int(comptime name: [:0]const u8) ?c_int {
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
    assert(parsed >= 0);
    return parsed;
}

/// Read MACHINEN_MEMORY (decimal MiB, no unit suffix). Returns the
/// value in bytes, or null if the var is unset / empty. Refuses
/// anything we can't safely turn into a `usize` byte count: bad
/// digits, zero, or values that would overflow.
fn env_memory_mib() ?usize {
    const raw = getenv("MACHINEN_MEMORY") orelse return null;
    const s = std.mem.span(raw);
    if (s.len == 0) return null;
    assert(s.len > 0);
    const mib = std.fmt.parseInt(u64, s, 10) catch die_memory(s, "must be a decimal integer");
    if (mib == 0) die_memory(s, "must be > 0");
    assert(mib > 0);
    const bytes = std.math.mul(u64, mib, 1024 * 1024) catch die_memory(s, "value overflows usize");
    if (bytes > std.math.maxInt(usize)) die_memory(s, "value overflows usize");
    assert(bytes > 0);
    assert(bytes <= std.math.maxInt(usize));
    return @intCast(bytes);
}

fn die_memory(value: []const u8, why: []const u8) noreturn {
    assert(value.len > 0);
    assert(why.len > 0);
    std.debug.print(
        "machinen-microvm: MACHINEN_MEMORY={s} is invalid: {s} (MiB, no unit suffix).\n",
        .{ value, why },
    );
    std.process.exit(2);
}

fn env_required(comptime name: [:0]const u8) []const u8 {
    comptime assert(name.len > 0);
    const raw = getenv(name.ptr) orelse die_usage(name);
    const s = std.mem.span(raw);
    if (s.len == 0) die_usage(name);
    assert(s.len > 0);
    return s;
}

fn env_optional(comptime name: [:0]const u8) ?[]const u8 {
    comptime assert(name.len > 0);
    const raw = getenv(name.ptr) orelse return null;
    const s = std.mem.span(raw);
    return if (s.len == 0) null else s;
}

fn die_usage(missing: []const u8) noreturn {
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
    const backend = microvm.detect_backend();
    try std.testing.expect(backend != .none);
}
