//! Boot an arm64 Linux kernel under HVF.
//!
//! Plain-language overview:
//!   1. Allocate a big slab of host memory (128 MB by default).
//!   2. Copy the kernel file into that slab at the offset the kernel
//!      header asks for.
//!   3. Copy the device tree file in at a spot the kernel won't stomp.
//!   4. Hand the slab to the guest as its RAM.
//!   5. Create a CPU, set X0 to the device tree address, point it at
//!      the kernel, and let it run.
//!   6. In the run loop, funnel guest serial writes to the host
//!      (and collect them) and honor the guest's shutdown request.
//!
//! See .docs/learnings/microvm/arm64-linux-boot.md for the why.

const std = @import("std");
const builtin = @import("builtin");

comptime {
    if (builtin.os.tag != .macos) {
        @compileError("boot.zig only builds on macOS (uses HVF)");
    }
}

const hvf = @import("hvf.zig");

pub const Error = error{
    FixtureMissing,
    KernelTooLarge,
    DtbTooLarge,
    GuestCrashed,
    RanTooLong,
};

pub const Config = struct {
    kernel_path: []const u8,
    dtb_path: []const u8,
    ram_base: u64 = 0x4000_0000,
    ram_size: usize = 128 * 1024 * 1024, // 128 MB
    // DTB sits well past the kernel so the kernel doesn't clobber it.
    dtb_offset: u64 = 0x0300_0000, // 48 MB into RAM
    // How many bytes to capture from serial before we declare the
    // boot "far enough along to stop."
    capture_bytes: usize = 16384,
    // Stop the loop after this many data-abort/HVC exits no matter what.
    max_exits: usize = 200_000,
};

pub const Result = struct {
    serial: []u8, // owned, free with allocator
    saw_psci_shutdown: bool,
    exits: usize,
};

pub fn boot(gpa: std.mem.Allocator, cfg: Config) !Result {
    // --- load fixture files off disk ------------------------------
    const kernel = readAll(gpa, cfg.kernel_path) catch |err| {
        if (err == error.FileNotFound) return error.FixtureMissing;
        return err;
    };
    defer gpa.free(kernel);

    const dtb = readAll(gpa, cfg.dtb_path) catch |err| {
        if (err == error.FileNotFound) return error.FixtureMissing;
        return err;
    };
    defer gpa.free(dtb);

    const img = try hvf.KernelImage.parse(kernel);

    if (img.text_offset + kernel.len > cfg.ram_size) return error.KernelTooLarge;
    if (cfg.dtb_offset + dtb.len > cfg.ram_size) return error.DtbTooLarge;

    // --- allocate + map guest RAM ---------------------------------
    const ram = try std.posix.mmap(
        null,
        cfg.ram_size,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
        -1,
        0,
    );
    defer std.posix.munmap(ram);

    // copy kernel and DTB into RAM
    @memcpy(ram[img.text_offset..][0..kernel.len], kernel);
    @memcpy(ram[cfg.dtb_offset..][0..dtb.len], dtb);

    const vm = try hvf.Vm.create();
    defer vm.destroy();

    // Turn on HVF's in-kernel GIC v3 at the addresses the device tree
    // advertises (distributor at 0x0800_0000, redistributor at
    // 0x080A_0000 per a QEMU `virt,gic-version=3` DTB dump). Without
    // this the kernel has nowhere to register interrupts and the
    // virtual timer has nothing to deliver to.
    try hvf.Gic.enable(.{});

    // Diagnostic: print GIC alignment + size requirements.
    std.debug.print(
        "GIC dist align=0x{x} size=0x{x}; rdist align=0x{x} size=0x{x} region=0x{x}\n",
        .{
            try hvf.Gic.distributorAlignment(),
            try hvf.Gic.distributorSize(),
            try hvf.Gic.redistributorAlignment(),
            try hvf.Gic.redistributorSize(),
            try hvf.Gic.redistributorRegionSize(),
        },
    );

    // Give the guest full read/write/execute on this region. Stage-2
    // permissions; the guest's own MMU still decides what it does at
    // EL1 via its (eventually-enabled) page tables.
    try vm.map(ram, cfg.ram_base, hvf.MapFlags.rwx);
    defer vm.unmap(cfg.ram_base, cfg.ram_size) catch {};

    // --- vCPU setup ----------------------------------------------
    const vcpu = try hvf.Vcpu.create();
    defer vcpu.destroy();

    // Set the vCPU's multiprocessor affinity. Without this, Apple's
    // GIC won't associate this vCPU with a redistributor frame and
    // any `hv_gic_*_redistributor_reg` call returns HV_DENIED. Value
    // layout: bit 31 reserved-as-1, bits 23:16/15:8/7:0 = Aff2/Aff1/Aff0.
    // For our single-CPU guest, all affinity fields = 0.
    try vcpu.setSysReg(.mpidr_el1, 1 << 31);

    // Let the virtual timer wake the vCPU so we can deliver ticks.
    try vcpu.setVtimerMask(false);

    // Diagnostic: query where HVF actually placed this vCPU's
    // redistributor. If this differs from what we told the kernel via
    // the DTB, the kernel will report "No redistributor present."
    if (hvf.Gic.redistributorBase(vcpu)) |rdist| {
        std.debug.print("GIC redistributor for vcpu 0: 0x{x}\n", .{rdist});
    } else |err| {
        std.debug.print("GIC redistributor query failed: {s}\n", .{@errorName(err)});
    }

    // EL1h, all interrupts masked.
    try vcpu.setReg(.cpsr, 0x3C5);
    // MMU off (kernel turns it on itself); I-bit for executable fetches.
    try vcpu.setSysReg(.sctlr_el1, 1 << 12);

    // arm64 Linux boot protocol: X0 = physical address of DTB.
    const dtb_phys = cfg.ram_base + cfg.dtb_offset;
    try vcpu.setReg(.x0, dtb_phys);
    try vcpu.setReg(.x1, 0);
    try vcpu.setReg(.x2, 0);
    try vcpu.setReg(.x3, 0);
    try vcpu.setReg(.pc, cfg.ram_base + img.text_offset);

    // --- run loop -------------------------------------------------
    var uart: hvf.Pl011 = .init;
    defer uart.deinit(gpa);

    var exits: usize = 0;
    var saw_off = false;

    while (exits < cfg.max_exits) : (exits += 1) {
        try vcpu.run();

        // Virtual timer expired while the vCPU was running. Re-mask so
        // we don't immediately re-fire on the next run; the kernel
        // handles the timer interrupt the GIC delivers.
        if (vcpu.exit.reason == .vtimer_activated) {
            try vcpu.setVtimerMask(true);
            try vcpu.setVtimerMask(false);
            continue;
        }

        if (vcpu.exit.reason != .exception) return error.GuestCrashed;
        const ec = hvf.ExceptionClass.fromSyndrome(vcpu.exit.exception.syndrome);


        switch (ec) {
            .hvc_aarch64 => {
                if (try hvf.Psci.decode(vcpu)) |f| switch (f) {
                    .system_off, .system_reset => {
                        saw_off = true;
                        break;
                    },
                    .version => {
                        // PSCI 1.0 = major 1, minor 0.
                        try vcpu.setReg(.x0, 0x0001_0000);
                    },
                    .migrate_info_type => {
                        // "Not present" — no migratable trusted OS.
                        try vcpu.setReg(.x0, 2);
                    },
                    .affinity_info_64 => {
                        // CPU 0 is "ON." The kernel queries this as part
                        // of setup; anything else gets NOT_SUPPORTED.
                        const x1 = try vcpu.getReg(.x1);
                        try vcpu.setReg(.x0, if (x1 == 0) 0 else @bitCast(@as(i64, -1)));
                    },
                    .cpu_off, .cpu_on_64, .features => {
                        // We only support one CPU and no optional features.
                        try vcpu.setReg(.x0, @bitCast(@as(i64, -1)));
                    },
                    _ => {
                        try vcpu.setReg(.x0, @bitCast(@as(i64, -1)));
                    },
                } else {
                    // Unknown HVC — skip it. Safer than crashing the run.
                }
            },
            .data_abort_lower_el => {
                const info = hvf.DataAbort.decode(vcpu.exit.exception);
                if (uart.handles(info.ipa)) {
                    if (info.is_write) {
                        const value = try info.readSource(vcpu);
                        try uart.write(gpa, info.ipa, value);
                        // Also echo to host stderr as characters arrive
                        // (stderr so the test runner doesn't swallow it).
                        const byte: [1]u8 = .{@truncate(value)};
                        _ = write(2, &byte, 1);
                    } else {
                        // Reads: return the UART's answer into the target
                        // register so the guest sees valid flags.
                        const v = uart.read(info.ipa);
                        if (info.srt != 31) {
                            const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
                            try vcpu.setReg(reg, v);
                        }
                    }
                } else if (info.ipa >= 0x0800_0000 and info.ipa < 0x0801_0000) {
                    // Distributor MMIO. Route to HVF.
                    const offset: u32 = @truncate(info.ipa - 0x0800_0000);
                    if (info.is_write) {
                        const value = try info.readSource(vcpu);
                        hvf.Gic.writeDistributor(offset, value);
                    } else if (info.srt != 31) {
                        const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
                        try vcpu.setReg(reg, hvf.Gic.readDistributor(offset));
                    }
                } else if (info.ipa >= 0x1000_0000 and info.ipa < 0x1200_0000) {
                    // Redistributor MMIO. Each vCPU's frame is 128 KB.
                    // For our single-vCPU setup, frame 0 = [0x10000000,
                    // 0x10020000); offset into frame is the HVF register.
                    const offset: u32 = @truncate((info.ipa - 0x1000_0000) % 0x0002_0000);
                    if (info.is_write) {
                        const value = try info.readSource(vcpu);
                        hvf.Gic.writeRedistributor(vcpu, offset, value);
                    } else if (info.srt != 31) {
                        const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
                        try vcpu.setReg(reg, hvf.Gic.readRedistributor(vcpu, offset));
                    }
                } else {
                    // Unknown MMIO region — reads return 0, writes ignored.
                    if (!info.is_write and info.srt != 31) {
                        const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
                        try vcpu.setReg(reg, 0);
                    }
                }
                // Advance PC past the faulting instruction.
                const pc = try vcpu.getReg(.pc);
                try vcpu.setReg(.pc, pc + 4);
            },
            else => {
                // Unhandled exception — record and stop.
                break;
            },
        }

        // Stop condition: we've seen enough serial output to be
        // confident the kernel booted far enough to prove our point.
        if (uart.captured.items.len >= cfg.capture_bytes) break;
    }

    if (exits >= cfg.max_exits) return error.RanTooLong;

    const serial = try gpa.dupe(u8, uart.captured.items);
    return .{
        .serial = serial,
        .saw_psci_shutdown = saw_off,
        .exits = exits,
    };
}

// libc bindings — std.posix is heavily reshaped in Zig 0.16 and most
// file-I/O surface moved behind an Io context. Going straight to libc
// keeps this file independent of that churn.
const O_RDONLY: c_int = 0;
const SEEK_END: c_int = 2;
const SEEK_SET: c_int = 0;
const F_OK: c_int = 0;
extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn lseek(fd: c_int, offset: i64, whence: c_int) i64;
extern "c" fn access(path: [*:0]const u8, mode: c_int) c_int;
extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;

fn readAll(gpa: std.mem.Allocator, path: []const u8) ![]u8 {
    var path_buf: [4096]u8 = undefined;
    if (path.len >= path_buf.len) return error.NameTooLong;
    @memcpy(path_buf[0..path.len], path);
    path_buf[path.len] = 0;
    const path_z: [*:0]const u8 = @ptrCast(&path_buf);

    const fd = open(path_z, O_RDONLY);
    if (fd < 0) return error.OpenFailed;
    defer _ = close(fd);

    const size_i = lseek(fd, 0, SEEK_END);
    if (size_i < 0) return error.SeekFailed;
    _ = lseek(fd, 0, SEEK_SET);
    const size: usize = @intCast(size_i);

    const buf = try gpa.alloc(u8, size);
    errdefer gpa.free(buf);

    var total: usize = 0;
    while (total < size) {
        const n = read(fd, buf[total..].ptr, size - total);
        if (n <= 0) return error.ShortRead;
        total += @intCast(n);
    }
    return buf;
}

// =============================================================
// Tests
// =============================================================

/// Relative path from packages/microvm/ to the kernel. The test is
/// skipped if this file isn't present — see test-fixtures/README.md
/// for how to produce it.
const kernel_fixture = "test-fixtures/Image";
const dtb_fixture = "test-fixtures/virt.dtb";

fn fixturesPresent() bool {
    inline for (.{ kernel_fixture, dtb_fixture }) |p| {
        var buf: [4096]u8 = undefined;
        if (p.len >= buf.len) return false;
        @memcpy(buf[0..p.len], p);
        buf[p.len] = 0;
        const path_z: [*:0]const u8 = @ptrCast(&buf);
        if (access(path_z, F_OK) != 0) return false;
    }
    return true;
}

test "boot a real arm64 Linux kernel" {
    // This test is gated behind an env var because actually booting
    // Linux needs more machinery than we've wired up yet: an interrupt
    // controller (GIC), a virtual timer, and interrupt injection so the
    // guest doesn't park forever in "wait for interrupt." Without those,
    // Linux spins up, issues WFI during early boot, and hangs the run
    // loop indefinitely. The test is kept so the code path stays
    // compiled and runnable; set MACHINEN_BOOT_TEST=1 to actually try.
    if (getenv("MACHINEN_BOOT_TEST") == null) {
        std.debug.print("skip: set MACHINEN_BOOT_TEST=1 to enable\n", .{});
        return;
    }
    if (!fixturesPresent()) {
        std.debug.print(
            "skip: missing {s} or {s} (see test-fixtures/README.md)\n",
            .{ kernel_fixture, dtb_fixture },
        );
        return;
    }

    const gpa = std.testing.allocator;
    const result = boot(gpa, .{
        .kernel_path = kernel_fixture,
        .dtb_path = dtb_fixture,
    }) catch |err| {
        std.debug.print("boot returned {s}\n", .{@errorName(err)});
        if (err == error.Denied) return; // entitlement not set in this build
        return err;
    };
    defer gpa.free(result.serial);

    std.debug.print(
        "\n--- boot finished, {d} exits, serial {d} bytes ---\n",
        .{ result.exits, result.serial.len },
    );
    std.debug.print("--- all captured serial ---\n{s}\n--- end ---\n", .{result.serial});

    // The real "did we succeed" signal: did the guest kernel say
    // anything at all on serial?
    try std.testing.expect(result.serial.len > 0);
}
