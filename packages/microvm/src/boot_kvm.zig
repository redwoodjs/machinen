//! Boot an arm64 Linux kernel under KVM (Linux host).
//!
//! Shape mirrors boot_hvf.zig (HVF path) so the two backends pass the
//! same kernel + dtb + initramfs through the same boot protocol.
//! Differences, all local to this file:
//!
//!   * Memory: KVM_SET_USER_MEMORY_REGION instead of hv_vm_map.
//!   * vGIC: an in-kernel vgic-v3 via KVM_CREATE_DEVICE. KVM handles
//!     all GIC MMIO + redistributor state itself; we only need to
//!     place the distributor + redistributor windows and call
//!     KVM_IRQ_LINE when we want to raise an SPI.
//!   * PSCI: enabled via VCPU_INIT feature bit (KVM_ARM_VCPU_PSCI_0_2)
//!     so the kernel's HVC #0 calls get handled in-kernel. The guest
//!     exits with KVM_EXIT_SYSTEM_EVENT on SYSTEM_OFF / RESET.
//!   * Timer: the arm virtual timer is built into KVM's arm64 vcpu
//!     model; no host-side plumbing.
//!   * PL011: same byte-for-byte model as HVF (shared via pl011.zig),
//!     driven by KVM_EXIT_MMIO events.
//!   * Virtio-blk: slots 1 and 3 are wired the same way HVF does it
//!     (#114).
//!   * Virtio-vsock: slot 2 wires up the same Bridge HVF uses (#44),
//!     opt-in via `MACHINEN_VSOCK`. Slot 0 (net) is not yet wired —
//!     reads/writes to that window still return 0 / are ignored.

const std = @import("std");
const builtin = @import("builtin");

comptime {
    if (builtin.os.tag != .linux) {
        @compileError("boot_kvm.zig only builds on Linux (uses /dev/kvm)");
    }
}

const kvm = @import("kvm.zig");
const pl011_mod = @import("pl011.zig");
const virtio = @import("virtio.zig");
const blk_mod = @import("blk.zig");
const vsock_mod = @import("vsock.zig");

// Guest-physical bases. Same MMIO layout as HVF (see boot_hvf.zig
// for the slot layout doc) so the shared `virt.dts` works for both
// backends.
const virtio_blk_base: u64 = 0x0A00_0200;
const virtio_blk_size: u64 = 0x200;
const virtio_vsock_base: u64 = 0x0A00_0400;
const virtio_vsock_size: u64 = 0x200;
const virtio_blk2_base: u64 = 0x0A00_0600;
const virtio_blk2_size: u64 = 0x200;

pub const Error = error{
    FixtureMissing,
    KernelTooLarge,
    DtbTooLarge,
    GuestCrashed,
    RanTooLong,
} || kvm.KvmError;

pub const Config = struct {
    kernel_path: []const u8,
    dtb_path: []const u8,
    initrd_path: ?[]const u8 = null,
    /// Optional path to a host file backing the rootdisk. When set,
    /// it lands on slot 1 (DTS `virtio_mmio@a000200`) and the kernel
    /// sees it as `/dev/vda`. Mirrors boot_hvf.zig's field. See #114.
    rootdisk_path: ?[]const u8 = null,
    /// Optional path to a host file backing the scratch disk. With
    /// rootdisk_path also set, this lands on slot 3 and the kernel
    /// names it `/dev/vdb`. With no rootdisk it lands on slot 1 and
    /// the kernel names it `/dev/vda` (legacy, pre-#114 layout).
    disk_path: ?[]const u8 = null,
    ram_base: u64 = 0x4000_0000,
    ram_size: usize = 4 * 1024 * 1024 * 1024,
    dtb_offset: u64 = 0x0300_0000,
    initrd_offset: u64 = 0x0400_0000,
    capture_bytes: usize = 262144,
    // Mirrors boot_hvf.zig's flag. When false (default), the loop exits
    // after `capture_bytes` bytes of serial — a test-oriented safety
    // valve. When true, the loop runs until PSCI SYSTEM_OFF or
    // `max_exits`. main.zig sets this for production boots.
    unbounded_serial: bool = false,
    max_exits: usize = 5_000_000,
    // GIC v3 placement. Matches our virt.dts: distributor at
    // 0x08000000 (64 KiB window) and redistributor starting at
    // 0x10000000 (128 KiB × nr_vcpus — just one for us).
    gic_dist_addr: u64 = 0x0800_0000,
    gic_redist_addr: u64 = 0x1000_0000,
};

pub const Result = struct {
    serial: []u8,
    saw_psci_shutdown: bool,
    exits: usize,
};

pub fn boot(gpa: std.mem.Allocator, cfg: Config) !Result {
    // --- load fixture files --------------------------------------
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

    const img = try KernelImage.parse(kernel);
    if (img.text_offset + kernel.len > cfg.ram_size) return error.KernelTooLarge;
    if (cfg.dtb_offset + dtb.len > cfg.ram_size) return error.DtbTooLarge;

    // --- allocate + map guest RAM --------------------------------
    const ram_ptr = std.posix.mmap(
        null,
        cfg.ram_size,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
        -1,
        0,
    ) catch return error.KvmSetMemoryFailed;
    defer std.posix.munmap(ram_ptr);
    const ram: []u8 = ram_ptr;

    @memcpy(ram[img.text_offset..][0..kernel.len], kernel);
    @memcpy(ram[cfg.dtb_offset..][0..dtb.len], dtb);

    if (cfg.initrd_path) |initrd_path| {
        const initrd = readAll(gpa, initrd_path) catch |err| {
            if (err == error.OpenFailed) return error.FixtureMissing;
            return err;
        };
        defer gpa.free(initrd);
        if (cfg.initrd_offset + initrd.len > cfg.ram_size) return error.DtbTooLarge;
        @memcpy(ram[cfg.initrd_offset..][0..initrd.len], initrd);
    }

    // --- KVM bring-up --------------------------------------------
    var k = try kvm.Kvm.open_();
    defer k.close_();

    var vm = try k.createVm();
    defer vm.destroy();

    try vm.mapMemory(0, cfg.ram_base, ram);

    // vGIC BEFORE vCPU creation (KVM requires it).
    var gic = try vm.createGicV3(cfg.gic_dist_addr, cfg.gic_redist_addr);
    defer gic.destroy();

    var vcpu = try vm.createVcpu(0);
    defer vcpu.destroy();

    // PSCI_0_2 lets KVM handle HVC-based shutdown / cpu-on / etc.
    // inside the kernel — the guest calls `SYSTEM_OFF` and KVM
    // reports it to us as KVM_EXIT_SYSTEM_EVENT instead of raw HVC.
    var init = try vm.preferredTarget();
    init.features[0] |= (@as(u32, 1) << @as(u5, @intCast(kvm.KVM_ARM_VCPU_PSCI_0_2)));
    try vcpu.init(init);

    // vGIC finalize happens AFTER vcpus exist.
    try gic.finalize();

    // arm64 boot protocol: X0 = dtb phys addr, PC = kernel entry.
    const dtb_phys = cfg.ram_base + cfg.dtb_offset;
    try vcpu.setReg(kvm.REG_X0, dtb_phys);
    try vcpu.setReg(kvm.REG_X1, 0);
    try vcpu.setReg(kvm.REG_X2, 0);
    try vcpu.setReg(kvm.REG_X3, 0);
    try vcpu.setReg(kvm.REG_PC, cfg.ram_base + img.text_offset);

    // --- run loop -------------------------------------------------
    var uart = pl011_mod.Pl011.init;
    defer uart.deinit(gpa);

    // PL011 SPI per DTS (interrupts = <0 1 4>). GIC SPI N maps to
    // KVM irq number 32 + N. For our PL011 that's 33.
    const pl011_irq: u32 = 32 + 1;

    // virtio-blk (#114). Two slots, mirroring boot_hvf.zig:
    //   slot 1 → SPI #17 → /dev/vda — rootdisk preferred, else disk.
    //   slot 3 → SPI #19 → /dev/vdb — scratch when both are present.
    // Linux probes virtio-mmio buses in DTB order, so DTB slot order
    // determines /dev/vd* naming. With only one slot populated the
    // lone device is always /dev/vda regardless of which slot.
    const virtio_blk_irq: u32 = 32 + 17;
    const virtio_blk2_irq: u32 = 32 + 19;
    const slot1_path: ?[]const u8 = cfg.rootdisk_path orelse cfg.disk_path;
    const slot3_path: ?[]const u8 = if (cfg.rootdisk_path != null) cfg.disk_path else null;

    var blk_backend_opt: ?blk_mod.Backend = null;
    defer if (blk_backend_opt) |*b| b.deinit();
    var blkdev_opt: ?virtio.Device = null;
    if (slot1_path) |path| {
        if (blk_mod.openFile(path)) |backend| {
            blk_backend_opt = backend;
            blkdev_opt = virtio.Device{
                .base = virtio_blk_base,
                .size = virtio_blk_size,
                .id = .block,
                .features = (1 << 32), // VIRTIO_F_VERSION_1
                .config = std.mem.asBytes(&blk_backend_opt.?.config),
                .ram = ram,
                .ram_base = cfg.ram_base,
                .request_handler = &blk_mod.Backend.handleRequest,
                .request_ctx = @ptrCast(&blk_backend_opt.?),
            };
        } else |err| {
            std.debug.print("virtio-blk slot 1 disabled: {s} ({s})\n", .{ @errorName(err), path });
        }
    }
    const blkdev_ptr: ?*virtio.Device = if (blkdev_opt) |_| &blkdev_opt.? else null;

    var blk2_backend_opt: ?blk_mod.Backend = null;
    defer if (blk2_backend_opt) |*b| b.deinit();
    var blk2dev_opt: ?virtio.Device = null;
    if (slot3_path) |path| {
        if (blk_mod.openFile(path)) |backend| {
            blk2_backend_opt = backend;
            blk2dev_opt = virtio.Device{
                .base = virtio_blk2_base,
                .size = virtio_blk2_size,
                .id = .block,
                .features = (1 << 32),
                .config = std.mem.asBytes(&blk2_backend_opt.?.config),
                .ram = ram,
                .ram_base = cfg.ram_base,
                .request_handler = &blk_mod.Backend.handleRequest,
                .request_ctx = @ptrCast(&blk2_backend_opt.?),
            };
        } else |err| {
            std.debug.print("virtio-blk slot 3 disabled: {s} ({s})\n", .{ @errorName(err), path });
        }
    }
    const blk2dev_ptr: ?*virtio.Device = if (blk2dev_opt) |_| &blk2dev_opt.? else null;

    // virtio-vsock (#44). Off by default; the runtime sets MACHINEN_VSOCK
    // when it wants the guest exec/fuse agents to be reachable. Same
    // env grammar as HVF (see boot_hvf.zig for the syntax doc) — parsed
    // ports are gpa-allocated and leak for the VMM's life.
    const virtio_vsock_irq: u32 = 32 + 18;
    var vsock_cid_storage: u64 = vsock_mod.default_guest_cid;
    var vsock_ports: []vsock_mod.PortMap = &.{};
    if (getenv("MACHINEN_VSOCK")) |raw| {
        const s = std.mem.span(raw);
        if (s.len > 0) {
            vsock_ports = vsock_mod.parseEnv(gpa, s) catch |err| blk: {
                std.debug.print("vsock: MACHINEN_VSOCK parse failed ({s}); ignoring\n", .{@errorName(err)});
                break :blk &.{};
            };
        }
    }
    var vsock_dev_opt: ?virtio.Device = null;
    var vsock_bridge_opt: ?*vsock_mod.Bridge = null;
    if (vsock_ports.len > 0) {
        vsock_dev_opt = virtio.Device{
            .base = virtio_vsock_base,
            .size = virtio_vsock_size,
            .id = .vsock,
            .features = (1 << 32), // VIRTIO_F_VERSION_1
            .config = std.mem.asBytes(&vsock_cid_storage),
            .ram = ram,
            .ram_base = cfg.ram_base,
            .request_handler = &vsock_mod.Bridge.handleTxChain,
            .request_ctx = null,
            // Queues 0 (RX) and 2 (event) are driver-posts-empty-buffers
            // queues — host fills them on demand, not on every kick.
            .skip_notify_queues = (1 << 0) | (1 << 2),
        };
    }
    const vsock_dev_ptr: ?*virtio.Device = if (vsock_dev_opt) |_| &vsock_dev_opt.? else null;

    var vsock_irq_ctx = VsockIrqCtx{ .vm = &vm, .irq = virtio_vsock_irq };
    if (vsock_dev_ptr) |d| {
        vsock_bridge_opt = vsock_mod.Bridge.create(gpa, d, .{
            .ports = vsock_ports,
            .raise_irq = &onVsockIrq,
            .raise_irq_ctx = @ptrCast(&vsock_irq_ctx),
        }) catch |err| blk: {
            std.debug.print("vsock: bridge create failed: {s}\n", .{@errorName(err)});
            break :blk null;
        };
        if (vsock_bridge_opt) |b| {
            d.request_ctx = @ptrCast(b);
            b.start() catch |err| {
                std.debug.print("vsock: bridge start failed: {s}\n", .{@errorName(err)});
                b.destroy();
                vsock_bridge_opt = null;
                vsock_dev_opt = null;
            };
            if (vsock_bridge_opt != null) {
                for (vsock_ports) |pm| {
                    const tag: []const u8 = switch (pm.direction) {
                        .inbound => "in",
                        .outbound => "out",
                    };
                    std.debug.print("vsock: {s} {d} <-> {s}\n", .{ tag, pm.guest_port, pm.uds_path });
                }
            }
        }
    }
    defer if (vsock_bridge_opt) |b| b.destroy();
    // The vsock_dev pointer might have been cleared above on bridge
    // start failure; re-resolve so the run loop dispatch matches.
    const vsock_dev_ptr_run: ?*virtio.Device = if (vsock_dev_opt) |_| &vsock_dev_opt.? else null;

    var exits: usize = 0;
    var saw_off = false;

    while (exits < cfg.max_exits) : (exits += 1) {
        const reason = try vcpu.run();
        switch (reason) {
            .mmio => {
                const ev = vcpu.mmioExit();
                try handleMmio(gpa, &vm, &vcpu, &uart, ev, pl011_irq, blkdev_ptr, virtio_blk_irq, blk2dev_ptr, virtio_blk2_irq, vsock_dev_ptr_run, virtio_vsock_irq);
            },
            .system_event => {
                const ev = vcpu.systemEventExit();
                const typ: kvm.SystemEventType = @enumFromInt(ev.type);
                if (typ == .shutdown or typ == .reset) {
                    saw_off = true;
                    break;
                }
            },
            .intr, .debug => {
                // Signal interruption (SIGALRM etc.) or debug exit —
                // just re-enter.
            },
            else => {
                // Everything else is a guest-state problem. Bail.
                std.debug.print("kvm: unhandled exit reason {d}\n", .{@intFromEnum(reason)});
                return error.GuestCrashed;
            },
        }
        if (!cfg.unbounded_serial and uart.captured.items.len >= cfg.capture_bytes) break;
    }

    if (exits >= cfg.max_exits) {
        std.debug.print(
            "kvm boot: RanTooLong after {d} exits. Captured serial ({d} bytes):\n{s}\n",
            .{ exits, uart.captured.items.len, uart.captured.items },
        );
        return error.RanTooLong;
    }

    const serial = try gpa.dupe(u8, uart.captured.items);
    return .{ .serial = serial, .saw_psci_shutdown = saw_off, .exits = exits };
}

fn handleMmio(
    gpa: std.mem.Allocator,
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    uart: *pl011_mod.Pl011,
    ev: kvm.MmioExit,
    pl011_irq: u32,
    blkdev: ?*virtio.Device,
    virtio_blk_irq: u32,
    blk2dev: ?*virtio.Device,
    virtio_blk2_irq: u32,
    vsockdev: ?*virtio.Device,
    virtio_vsock_irq: u32,
) !void {
    if (uart.handles(ev.phys_addr)) {
        if (ev.is_write != 0) {
            const val = mmioReadValue(ev);
            try uart.write(gpa, ev.phys_addr, val);
            // Echo console bytes to host stderr.
            if ((ev.phys_addr - uart.base) == 0 and ev.len > 0) {
                const byte: [1]u8 = .{ev.data[0]};
                _ = hostWrite(2, &byte, 1);
            }
        } else {
            const val = uart.read(ev.phys_addr);
            vcpu.writeMmioReadData(val, ev.len);
        }
        vm.setIrq(pl011_irq, if (uart.irqAsserted()) 1 else 0) catch {};
        return;
    }
    if (blkdev) |d| {
        if (d.handles(ev.phys_addr)) {
            if (ev.is_write != 0) {
                d.write(ev.phys_addr, mmioReadValue(ev));
            } else {
                vcpu.writeMmioReadData(d.read(ev.phys_addr), ev.len);
            }
            vm.setIrq(virtio_blk_irq, if (d.interrupt_status != 0) 1 else 0) catch {};
            return;
        }
    }
    if (blk2dev) |d| {
        if (d.handles(ev.phys_addr)) {
            if (ev.is_write != 0) {
                d.write(ev.phys_addr, mmioReadValue(ev));
            } else {
                vcpu.writeMmioReadData(d.read(ev.phys_addr), ev.len);
            }
            vm.setIrq(virtio_blk2_irq, if (d.interrupt_status != 0) 1 else 0) catch {};
            return;
        }
    }
    if (vsockdev) |d| {
        if (d.handles(ev.phys_addr)) {
            if (ev.is_write != 0) {
                // TX notify runs on the vCPU thread and shares the
                // bridge's connection table with the bridge poll
                // thread; the handler takes the mutex.
                d.write(ev.phys_addr, mmioReadValue(ev));
            } else {
                vcpu.writeMmioReadData(d.read(ev.phys_addr), ev.len);
            }
            vm.setIrq(virtio_vsock_irq, if (d.interrupt_status != 0) 1 else 0) catch {};
            return;
        }
    }
    // Other MMIO (virtio-mmio net window, etc.) — for reads, hand
    // back zeros (the writeMmioReadData default on untouched kvm_run
    // bytes is already zero, but be explicit so a future non-zero
    // lingerer doesn't bite).
    if (ev.is_write == 0) vcpu.writeMmioReadData(0, ev.len);
}

/// Pack the up-to-8 little-endian bytes KVM hands us in `mmio.data`
/// into a u64 the device handlers expect.
fn mmioReadValue(ev: kvm.MmioExit) u64 {
    var val: u64 = 0;
    const n = @min(@as(usize, ev.len), 8);
    for (0..n) |i| {
        val |= @as(u64, ev.data[i]) << @as(u6, @intCast(i * 8));
    }
    return val;
}

fn readAll(gpa: std.mem.Allocator, path: []const u8) ![]u8 {
    var path_buf: [4096]u8 = undefined;
    if (path.len >= path_buf.len) return error.NameTooLong;
    @memcpy(path_buf[0..path.len], path);
    path_buf[path.len] = 0;
    const path_z: [*:0]const u8 = @ptrCast(&path_buf);

    const fd = hostOpen(path_z, 0, 0);
    if (fd < 0) return error.OpenFailed;
    defer _ = hostClose(fd);

    const size_i = hostLseek(fd, 0, 2);
    if (size_i < 0) return error.SeekFailed;
    _ = hostLseek(fd, 0, 0);
    const size: usize = @intCast(size_i);

    const buf = try gpa.alloc(u8, size);
    errdefer gpa.free(buf);
    var total: usize = 0;
    while (total < size) {
        const n = hostRead(fd, buf[total..].ptr, size - total);
        if (n <= 0) return error.ShortRead;
        total += @intCast(n);
    }
    return buf;
}

extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn lseek(fd: c_int, offset: i64, whence: c_int) i64;
extern "c" fn access(path: [*:0]const u8, mode: c_int) c_int;
extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;

// Rename'd because `read`/`write` collide with std method names in
// some generic contexts; kept the extern shims unchanged.
fn hostOpen(path: [*:0]const u8, flags: c_int, mode: c_int) c_int {
    return open(path, flags, mode);
}
fn hostClose(fd: c_int) c_int {
    return close(fd);
}
fn hostRead(fd: c_int, buf: [*]u8, count: usize) isize {
    return read(fd, buf, count);
}
fn hostWrite(fd: c_int, buf: [*]const u8, count: usize) isize {
    return write(fd, buf, count);
}
fn hostLseek(fd: c_int, offset: i64, whence: c_int) i64 {
    return lseek(fd, offset, whence);
}

/// Carried as the bridge's raise_irq context. The Bridge poll thread
/// calls onVsockIrq(ctx) when it has injected RX/event traffic; we
/// pulse the SPI line via KVM_IRQ_LINE on whichever VM the boot loop
/// owns.
pub const VsockIrqCtx = struct {
    vm: *kvm.Vm,
    irq: u32,
};

fn onVsockIrq(ctx: ?*anyopaque) void {
    const c: *VsockIrqCtx = @ptrCast(@alignCast(ctx.?));
    c.vm.setIrq(c.irq, 1) catch {};
}

// arm64 Linux kernel Image header — same parser as hvf.zig has;
// duplicated because that module is macOS-only. Tiny enough that
// sharing via a third module wasn't worth the indirection yet.
pub const KernelImage = struct {
    text_offset: u64,
    image_size: u64,
    bytes: []const u8,

    pub const magic: u32 = 0x644D5241; // "ARM\x64"
    pub const Error = error{ TooSmall, BadMagic };

    pub fn parse(bytes: []const u8) KernelImage.Error!KernelImage {
        if (bytes.len < 64) return error.TooSmall;
        const got_magic = std.mem.readInt(u32, bytes[0x38..0x3C], .little);
        if (got_magic != magic) return error.BadMagic;
        return .{
            .text_offset = std.mem.readInt(u64, bytes[0x08..0x10], .little),
            .image_size = std.mem.readInt(u64, bytes[0x10..0x18], .little),
            .bytes = bytes,
        };
    }
};

// =============================================================
// Test — gated on MACHINEN_BOOT_TEST like the HVF twin. Needs
// /dev/kvm readable + the fixtures present. Skips gracefully.
// =============================================================

const F_OK: c_int = 0;
const kernel_fixture = "test-fixtures/Image";
const dtb_fixture = "test-fixtures/virt.dtb";
const initrd_fixture = "test-fixtures/initramfs.cpio";

fn fixturesPresent() bool {
    inline for (.{ kernel_fixture, dtb_fixture, initrd_fixture }) |p| {
        var buf: [4096]u8 = undefined;
        if (p.len >= buf.len) return false;
        @memcpy(buf[0..p.len], p);
        buf[p.len] = 0;
        const path_z: [*:0]const u8 = @ptrCast(&buf);
        if (access(path_z, F_OK) != 0) return false;
    }
    return true;
}

test "KVM: boot a real arm64 Linux kernel" {
    if (builtin.cpu.arch != .aarch64) {
        // KVM on x86_64 can't host an arm64 guest.
        std.debug.print("skip: KVM boot requires an arm64 Linux host\n", .{});
        return;
    }
    if (getenv("MACHINEN_BOOT_TEST") == null) {
        std.debug.print("skip: set MACHINEN_BOOT_TEST=1 to enable\n", .{});
        return;
    }
    if (access("/dev/kvm\x00", F_OK) != 0) {
        std.debug.print("skip: /dev/kvm not readable\n", .{});
        return;
    }
    if (!fixturesPresent()) {
        std.debug.print(
            "skip: missing {s} or {s} (run scripts/build-base-assets.sh)\n",
            .{ kernel_fixture, dtb_fixture },
        );
        return;
    }

    const gpa = std.testing.allocator;
    const result = boot(gpa, .{
        .kernel_path = kernel_fixture,
        .dtb_path = dtb_fixture,
        .initrd_path = initrd_fixture,
        // The fixture init drops into an interactive shell that waits
        // on stdin (which we don't feed), so KVM_RUN will block forever
        // once it's idle. Break as soon as we've seen enough serial to
        // prove the kernel banner printed; the sanity check below
        // verifies it's actually a Linux banner.
        .capture_bytes = 512,
    }) catch |err| {
        std.debug.print("kvm boot returned {s}\n", .{@errorName(err)});
        return err;
    };
    defer gpa.free(result.serial);
    try std.testing.expect(result.serial.len > 0);
    // Sanity: the Linux banner should land within the first few KB.
    try std.testing.expect(std.mem.indexOf(u8, result.serial, "Linux") != null);
}
