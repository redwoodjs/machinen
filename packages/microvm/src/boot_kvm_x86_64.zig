//! Boot an x86_64 Linux bzImage under KVM (Linux host).
//!
//! This is the x86_64 sibling of boot_kvm.zig's arm64 path. It keeps the
//! same virtio-mmio layout and device models, but swaps the platform pieces:
//! Linux boot protocol zero-page instead of a DTB, KVM's in-kernel
//! PIC/IOAPIC/PIT instead of a GIC, and an 8250-compatible serial console
//! on ttyS0 instead of PL011/ttyAMA0.

const std = @import("std");
const builtin = @import("builtin");

const assert = std.debug.assert;

comptime {
    if (builtin.os.tag != .linux) {
        @compileError("boot_kvm_x86_64.zig only builds on Linux (uses /dev/kvm)");
    }
}

const kvm = @import("kvm.zig");
const uart8250_mod = @import("uart8250.zig");
const virtio = @import("virtio.zig");
const blk_mod = @import("blk.zig");
const vsock_mod = @import("vsock.zig");
const virtiofs_mod = @import("virtiofs.zig");
const net_mod = @import("net_socket.zig");
const balloon_mod = @import("balloon.zig");
const stats_mod = @import("stats.zig");
const vmstate_writer = @import("vmstate_writer.zig");

const virtio_net_base: u64 = 0x0A00_0000;
const virtio_net_size: u64 = 0x200;
const virtio_blk_base: u64 = 0x0A00_0200;
const virtio_blk_size: u64 = 0x200;
const virtio_vsock_base: u64 = 0x0A00_0400;
const virtio_vsock_size: u64 = 0x200;
const virtio_blk2_base: u64 = 0x0A00_0600;
const virtio_blk2_size: u64 = 0x200;
const virtio_balloon_base: u64 = 0x0A00_0800;
const virtio_balloon_size: u64 = 0x200;
const virtio_blk3_base: u64 = 0x0A00_0A00;
const virtio_blk3_size: u64 = 0x200;
const virtio_blk4_base: u64 = 0x0A00_0C00;
const virtio_blk4_size: u64 = 0x200;
const virtio_virtiofs_size: u64 = 0x200;
const virtio_mmio_hole_base: u64 = virtio_net_base;
const virtio_mmio_hole_size: u64 = 0x1_0000;
const virtio_mmio_hole_end: u64 = virtio_mmio_hole_base + virtio_mmio_hole_size;

const MAX_VIRTIOFS_SLOTS: usize = 5;
const virtio_virtiofs_bases: [MAX_VIRTIOFS_SLOTS]u64 = .{
    0x0A00_0E00,
    0x0A00_1000,
    0x0A00_1200,
    0x0A00_1400,
    0x0A00_1600,
};

const uart_base: u64 = 0x0900_0000;
const uart_io_base: u16 = 0x03F8;
const boot_params_addr: u64 = 0x0000_7000;
const gdt_addr: u64 = 0x0000_0500;
const boot_stack_addr: u64 = 0x0009_0000;
const cmdline_addr: u64 = 0x0002_0000;
const kernel_load_addr: u64 = 0x0100_0000;
const acpi_base: u64 = 0x000F_0000;
const pm1a_evt_port: u16 = 0x0600;
const pm1a_cnt_port: u16 = 0x0604;
const reset_port: u16 = 0x0CF9;

comptime {
    assert(virtio_net_size == 0x200);
    assert(virtio_blk_base == virtio_net_base + virtio_net_size);
    assert(virtio_vsock_base == virtio_blk_base + virtio_blk_size);
    assert(virtio_blk2_base == virtio_vsock_base + virtio_vsock_size);
    assert(virtio_balloon_base == virtio_blk2_base + virtio_blk2_size);
    assert(virtio_blk3_base == virtio_balloon_base + virtio_balloon_size);
    assert(virtio_blk4_base == virtio_blk3_base + virtio_blk3_size);
    assert(virtio_virtiofs_bases[0] == virtio_blk4_base + virtio_blk4_size);
    for (1..MAX_VIRTIOFS_SLOTS) |i| {
        assert(virtio_virtiofs_bases[i] == virtio_virtiofs_bases[i - 1] + virtio_virtiofs_size);
    }
}

pub const Error = error{
    FixtureMissing,
    KernelTooLarge,
    BootParamsTooLarge,
    InitrdTooLarge,
    GuestCrashed,
    RanTooLong,
} || kvm.KvmError;

pub const Config = struct {
    kernel_path: []const u8,
    initrd_path: ?[]const u8 = null,
    rootdisk_path: ?[]const u8 = null,
    disk_path: ?[]const u8 = null,
    mountdisk_lower_fd: ?c_int = null,
    mountdisk_upper_fd: ?c_int = null,
    ram_base: u64 = 0,
    ram_size: usize = 4 * 1024 * 1024 * 1024,
    initrd_offset: u64 = 0x1000_0000,
    capture_bytes: usize = 262144,
    unbounded_serial: bool = false,
    max_exits: usize = 5_000_000,
    restore_path: ?[]const u8 = null,
    snapshot_path: ?[]const u8 = null,
    cmdline: ?[]const u8 = null,
};

pub const Result = struct {
    serial: []u8,
    saw_psci_shutdown: bool,
    exits: usize,
    snapshotted: bool = false,
};

fn validate_config(cfg: Config) void {
    assert(cfg.kernel_path.len > 0);
    assert(cfg.ram_base == 0);
    assert(cfg.ram_size >= 512 * 1024 * 1024);
    assert(cfg.ram_size % 4096 == 0);
    assert(cfg.initrd_offset % 4096 == 0);
    assert(cfg.initrd_offset < cfg.ram_size);
    assert(cfg.max_exits > 0);
}

pub fn boot(gpa: std.mem.Allocator, cfg: Config) !Result {
    validate_config(cfg);
    if (cfg.snapshot_path != null) install_snapshot_signal();

    var fx = try load_fixtures(gpa, cfg);
    defer fx.deinit(gpa);

    const ram = try allocate_and_populate_ram(gpa, cfg, fx);
    assert(ram.len == cfg.ram_size);
    defer std.posix.munmap(ram);

    var k = try kvm.Kvm.open_();
    defer k.close_();

    var vm = try k.create_vm();
    defer vm.destroy();

    try vm.set_tss_addr(0xFFFBD000);
    try vm.create_irqchip();
    try vm.create_pit2();
    try map_guest_ram(&vm, cfg, ram);

    var vcpu = try init_vcpu(&vm, ram, cfg);
    defer vcpu.destroy();

    var uart = uart8250_mod.Uart8250.with_base(uart_base);
    uart.capture_enabled = !cfg.unbounded_serial;

    const irqs = IrqMap.init();

    const slot1_path: ?[]const u8 = cfg.rootdisk_path orelse cfg.disk_path;
    const slot3_path: ?[]const u8 = if (cfg.rootdisk_path != null) cfg.disk_path else null;

    var blk_backend_opt: ?blk_mod.Backend = open_blk_backend(slot1_path, "slot 1");
    defer if (blk_backend_opt) |*b| b.deinit();
    var blkdev_opt: ?virtio.Device = if (blk_backend_opt) |*b|
        make_blk_device(virtio_blk_base, virtio_blk_size, ram, cfg, b)
    else
        null;
    const blkdev_ptr: ?*virtio.Device = if (blkdev_opt) |_| &blkdev_opt.? else null;

    var blk2_backend_opt: ?blk_mod.Backend = open_blk_backend(slot3_path, "slot 3");
    defer if (blk2_backend_opt) |*b| b.deinit();
    var blk2dev_opt: ?virtio.Device = if (blk2_backend_opt) |*b|
        make_blk_device(virtio_blk2_base, virtio_blk2_size, ram, cfg, b)
    else
        null;
    const blk2dev_ptr: ?*virtio.Device = if (blk2dev_opt) |_| &blk2dev_opt.? else null;

    var blk3_backend_opt: ?blk_mod.Backend = open_blk_backend_from_fd(cfg.mountdisk_lower_fd, true, "slot 5 (mount lower)");
    defer if (blk3_backend_opt) |*b| b.deinit();
    var blk3dev_opt: ?virtio.Device = if (blk3_backend_opt) |*b|
        make_blk_device(virtio_blk3_base, virtio_blk3_size, ram, cfg, b)
    else
        null;
    const blk3dev_ptr: ?*virtio.Device = if (blk3dev_opt) |_| &blk3dev_opt.? else null;

    var blk4_backend_opt: ?blk_mod.Backend = open_blk_backend_from_fd(cfg.mountdisk_upper_fd, false, "slot 6 (mount upper)");
    defer if (blk4_backend_opt) |*b| b.deinit();
    var blk4dev_opt: ?virtio.Device = if (blk4_backend_opt) |*b|
        make_blk_device_with_discard(virtio_blk4_base, virtio_blk4_size, ram, cfg, b)
    else
        null;
    const blk4dev_ptr: ?*virtio.Device = if (blk4dev_opt) |_| &blk4dev_opt.? else null;

    const virtio_mac = [_]u8{ 0x02, 0xDE, 0xAD, 0xBE, 0xEF, 0x01 };
    var netdev = make_net_device(ram, cfg, &virtio_mac);
    const net_inst: ?*net_mod.NetSocket = connect_gvproxy(gpa, &netdev);
    defer if (net_inst) |n| n.destroy();
    var net_irq_ctx = NetIrqCtx{ .vm = &vm, .irq = irqs.net };
    if (net_inst) |n| {
        netdev.tx_handler = &on_net_tx;
        netdev.tx_ctx = @ptrCast(n);
        n.on_rx = &on_net_irq;
        n.on_rx_ctx = @ptrCast(&net_irq_ctx);
    }

    const vsock_cid_storage: u64 = vsock_mod.default_guest_cid;
    const vsock_ports = parse_vsock_env(gpa);
    var vsock_dev_opt: ?virtio.Device = if (vsock_ports.len > 0)
        make_vsock_device(ram, cfg, &vsock_cid_storage)
    else
        null;
    const vsock_dev_ptr: ?*virtio.Device = if (vsock_dev_opt) |_| &vsock_dev_opt.? else null;

    var vsock_irq_ctx = VsockIrqCtx{ .vm = &vm, .irq = irqs.vsock };
    var vsock_bridge_opt: ?*vsock_mod.Bridge = null;
    if (vsock_dev_ptr) |d| {
        vsock_bridge_opt = start_vsock_bridge(gpa, d, vsock_ports, &vsock_irq_ctx);
        if (vsock_bridge_opt == null) vsock_dev_opt = null;
    }
    defer if (vsock_bridge_opt) |b| b.destroy();
    const vsock_dev_ptr_run: ?*virtio.Device = if (vsock_dev_opt) |_| &vsock_dev_opt.? else null;

    var stats_inst = stats_mod.Stats.open_or_stub();
    defer stats_inst.deinit();
    stats_mod.start_phys_footprint_sampler(stats_inst.counters);
    var balloon_backend = balloon_mod.Backend.init_with_counters(stats_inst.counters);
    var balloon_dev = make_balloon_device(ram, cfg, &balloon_backend);
    const balloon_dev_ptr: ?*virtio.Device = &balloon_dev;

    var virtiofs_backends: [MAX_VIRTIOFS_SLOTS]?virtiofs_mod.Device = parse_virtiofs_env();
    defer for (&virtiofs_backends) |*b| {
        if (b.*) |*d| d.deinit();
    };
    var virtiofs_devs: [MAX_VIRTIOFS_SLOTS]?virtio.Device = undefined;
    for (0..MAX_VIRTIOFS_SLOTS) |i| {
        virtiofs_devs[i] = if (virtiofs_backends[i]) |*b|
            make_virtio_fs_device(virtio_virtiofs_bases[i], ram, cfg, b)
        else
            null;
    }
    var virtiofs_dev_ptrs: [MAX_VIRTIOFS_SLOTS]?*virtio.Device = undefined;
    for (0..MAX_VIRTIOFS_SLOTS) |i| {
        virtiofs_dev_ptrs[i] = if (virtiofs_devs[i]) |_| &virtiofs_devs[i].? else null;
    }

    const devs = Devices{
        .uart = &uart,
        .netdev = &netdev,
        .net_inst = net_inst,
        .blk_dev = blkdev_ptr,
        .blk2_dev = blk2dev_ptr,
        .blk3_dev = blk3dev_ptr,
        .blk4_dev = blk4dev_ptr,
        .vsock_dev = vsock_dev_ptr_run,
        .vsock_bridge = vsock_bridge_opt,
        .balloon_dev = balloon_dev_ptr,
        .virtiofs_devs = virtiofs_dev_ptrs,
    };

    if (cfg.restore_path) |path| {
        apply_restore_file(gpa, path, &vm, &vcpu, ram, cfg, &devs) catch |err| {
            std.debug.print("kvm-x86_64 boot: restore from {s} failed: {s}\n", .{ path, @errorName(err) });
            return err;
        };
        std.debug.print("kvm-x86_64 boot: restored from {s}\n", .{path});
    }

    return try run_loop(gpa, cfg, &vm, &vcpu, &devs, irqs, ram);
}

const LoadedFixtures = struct {
    kernel: []u8,
    img: BzImage,

    fn deinit(self: *LoadedFixtures, gpa: std.mem.Allocator) void {
        gpa.free(self.kernel);
    }
};

fn load_fixtures(gpa: std.mem.Allocator, cfg: Config) !LoadedFixtures {
    const kernel = read_all(gpa, cfg.kernel_path) catch |err| {
        if (err == error.FileNotFound) return error.FixtureMissing;
        return err;
    };
    errdefer gpa.free(kernel);
    const img = try BzImage.parse(kernel);
    if (kernel_load_addr + img.protected.len > cfg.ram_size) return error.KernelTooLarge;
    return .{ .kernel = kernel, .img = img };
}

const BzImage = struct {
    setup_size: usize,
    protected: []const u8,
    version: u16,

    const ParseError = error{ TooSmall, BadMagic, TruncatedSetup };

    pub fn parse(bytes: []const u8) ParseError!BzImage {
        if (bytes.len < 0x26C) return error.TooSmall;
        if (!std.mem.eql(u8, bytes[0x202..0x206], "HdrS")) return error.BadMagic;
        const setup_sects_raw = bytes[0x1F1];
        const setup_sects: usize = if (setup_sects_raw == 0) 4 else setup_sects_raw;
        const setup_size = (setup_sects + 1) * 512;
        if (setup_size >= bytes.len) return error.TruncatedSetup;
        return .{
            .setup_size = setup_size,
            .protected = bytes[setup_size..],
            .version = std.mem.readInt(u16, bytes[0x206..0x208], .little),
        };
    }
};

fn allocate_and_populate_ram(
    gpa: std.mem.Allocator,
    cfg: Config,
    fx: LoadedFixtures,
) ![]align(std.heap.page_size_min) u8 {
    const ram = std.posix.mmap(
        null,
        cfg.ram_size,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
        -1,
        0,
    ) catch return error.KvmSetMemoryFailed;
    errdefer std.posix.munmap(ram);
    assert(@intFromPtr(ram.ptr) % 4096 == 0);

    if (cfg.restore_path != null) {
        // Restore snapshots cover guest RAM themselves. Leave the fresh
        // anonymous mmap demand-zeroed so sparse RAM restore can write
        // only the non-zero extents.
        return ram;
    }

    @memcpy(guest_slice(ram, kernel_load_addr, fx.img.protected.len), fx.img.protected);

    const bp = guest_slice(ram, boot_params_addr, 4096);
    @memset(bp, 0);
    const setup_copy = @min(fx.img.setup_size, bp.len);
    @memcpy(bp[0..setup_copy], fx.kernel[0..setup_copy]);
    populate_boot_params(bp, cfg, fx.img);

    const cmdline = cfg.cmdline orelse default_cmdline();
    if (cmdline.len + 1 > 4096) return error.BootParamsTooLarge;
    const cmd = guest_slice(ram, cmdline_addr, cmdline.len + 1);
    @memcpy(cmd[0..cmdline.len], cmdline);
    cmd[cmdline.len] = 0;

    if (cfg.initrd_path) |initrd_path| {
        const initrd = read_all(gpa, initrd_path) catch |err| {
            if (err == error.OpenFailed or err == error.FileNotFound) return error.FixtureMissing;
            return err;
        };
        defer gpa.free(initrd);
        if (cfg.initrd_offset + initrd.len > cfg.ram_size) return error.InitrdTooLarge;
        @memcpy(guest_slice(ram, cfg.initrd_offset, initrd.len), initrd);
        write_int(bp, 0x218, u32, @intCast(cfg.initrd_offset));
        write_int(bp, 0x21C, u32, @intCast(initrd.len));
    }

    write_gdt(ram);
    write_acpi_tables(ram);
    return ram;
}

fn guest_slice(ram: []u8, phys: u64, len: usize) []u8 {
    assert(phys <= std.math.maxInt(usize));
    const off: usize = @intCast(phys);
    assert(off + len <= ram.len);
    return ram[off..][0..len];
}

fn map_guest_ram(vm: *kvm.Vm, cfg: Config, ram: []u8) !void {
    assert(cfg.ram_base == 0);
    assert(cfg.ram_size == ram.len);
    assert(cfg.ram_size > virtio_mmio_hole_end);
    const low_len: usize = @intCast(virtio_mmio_hole_base);
    const high_off: usize = @intCast(virtio_mmio_hole_end);
    try vm.map_memory(0, 0, ram[0..low_len]);
    try vm.map_memory(1, virtio_mmio_hole_end, ram[high_off..]);
}

fn write_int(buf: []u8, off: usize, comptime T: type, value: T) void {
    std.mem.writeInt(T, buf[off..][0..@sizeOf(T)], value, .little);
}

fn populate_boot_params(bp: []u8, cfg: Config, img: BzImage) void {
    assert(bp.len >= 4096);
    _ = img;
    bp[0x210] = 0xFF; // type_of_loader: unknown bootloader
    bp[0x211] |= 0x81; // LOADED_HIGH | CAN_USE_HEAP
    write_int(bp, 0x214, u32, @intCast(kernel_load_addr));
    write_int(bp, 0x224, u16, 0xFE00); // heap_end_ptr
    write_int(bp, 0x228, u32, @intCast(cmdline_addr));
    write_int(bp, 0x238, u32, 4096); // cmdline_size
    write_int(bp, 0x1E8, u8, 6); // e820_entries

    // Keep the arm64 virtio-mmio layout (0x0a00_0000...), but on x86
    // guest RAM starts at GPA 0. Carve a page-aligned hole out of both
    // KVM's RAM slots (see mapGuestRam) and Linux's e820 map so the
    // virtio-mmio resources are neither System RAM nor backed by RAM.
    write_e820(bp, 0, 0x0000_0000, 0x0009_FC00, 1);
    write_e820(bp, 1, 0x0009_FC00, 0x0005_0400, 2);
    write_e820(bp, 2, acpi_base, 0x0001_0000, 3);
    write_e820(bp, 3, 0x0010_0000, virtio_mmio_hole_base - 0x0010_0000, 1);
    write_e820(bp, 4, virtio_mmio_hole_base, virtio_mmio_hole_size, 2);
    write_e820(bp, 5, virtio_mmio_hole_end, cfg.ram_size - virtio_mmio_hole_end, 1);
}

fn write_e820(bp: []u8, idx: usize, addr: u64, size: u64, typ: u32) void {
    const off = 0x2D0 + idx * 20;
    write_int(bp, off + 0, u64, addr);
    write_int(bp, off + 8, u64, size);
    write_int(bp, off + 16, u32, typ);
}

fn default_cmdline() []const u8 {
    return "earlycon=uart8250,io,0x3f8,115200n8 console=ttyS0 panic=1 loglevel=3 quiet reboot=k acpi=force pci=off " ++
        "virtio_mmio.device=512@0x0a000000:5 " ++
        "virtio_mmio.device=512@0x0a000200:6 " ++
        "virtio_mmio.device=512@0x0a000400:7 " ++
        "virtio_mmio.device=512@0x0a000600:8 " ++
        "virtio_mmio.device=512@0x0a000800:9 " ++
        "virtio_mmio.device=512@0x0a000a00:10 " ++
        "virtio_mmio.device=512@0x0a000c00:11 " ++
        "virtio_mmio.device=512@0x0a000e00:12 " ++
        "virtio_mmio.device=512@0x0a001000:13 " ++
        "virtio_mmio.device=512@0x0a001200:14 " ++
        "virtio_mmio.device=512@0x0a001400:15 " ++
        "virtio_mmio.device=512@0x0a001600:16";
}

fn write_gdt(ram: []u8) void {
    const gdt = guest_slice(ram, gdt_addr, 32);
    write_int(gdt, 0, u64, 0);
    write_int(gdt, 8, u64, 0);
    write_int(gdt, 16, u64, 0x00CF_9B00_0000_FFFF);
    write_int(gdt, 24, u64, 0x00CF_9300_0000_FFFF);
}

fn init_vcpu(vm: *kvm.Vm, ram: []u8, cfg: Config) !kvm.Vcpu {
    _ = ram;
    _ = cfg;
    var vcpu = try vm.create_vcpu(0);
    errdefer vcpu.destroy();

    const cpuid = try vm.parent.supported_cpuid();
    try vcpu.set_cpuid2(&cpuid);

    var sregs = try vcpu.get_sregs_x86();
    sregs.gdt.base = gdt_addr;
    sregs.gdt.limit = 32 - 1;
    sregs.cs = flat_segment(2, true);
    sregs.ds = flat_segment(3, false);
    sregs.es = flat_segment(3, false);
    sregs.fs = flat_segment(3, false);
    sregs.gs = flat_segment(3, false);
    sregs.ss = flat_segment(3, false);
    sregs.cr0 |= 1; // protected mode
    try vcpu.set_sregs_x86(sregs);

    var regs = try vcpu.get_regs_x86();
    regs.rip = kernel_load_addr;
    regs.rsi = boot_params_addr;
    regs.rsp = boot_stack_addr;
    regs.rbp = boot_stack_addr;
    regs.rflags = 0x2;
    try vcpu.set_regs_x86(regs);
    return vcpu;
}

fn flat_segment(index: u16, code: bool) kvm.X86Segment {
    return .{
        .base = 0,
        .limit = 0xFFFF_FFFF,
        .selector = index << 3,
        .seg_type = if (code) 0xB else 0x3,
        .present = 1,
        .dpl = 0,
        .db = 1,
        .s = 1,
        .l = 0,
        .g = 1,
        .avl = 0,
        .unusable = 0,
        .padding = 0,
    };
}

fn write_acpi_tables(ram: []u8) void {
    const rsdp_addr = acpi_base;
    const rsdt_addr = acpi_base + 0x0100;
    const xsdt_addr = acpi_base + 0x0180;
    const madt_addr = acpi_base + 0x0200;
    const fadt_addr = acpi_base + 0x0300;
    const dsdt_addr = acpi_base + 0x0500;

    write_madt(guest_slice(ram, madt_addr, 74));
    write_dsdt(guest_slice(ram, dsdt_addr, 128));
    write_fadt(guest_slice(ram, fadt_addr, 244), dsdt_addr);
    write_rsdt(guest_slice(ram, rsdt_addr, 44), madt_addr, fadt_addr);
    write_xsdt(guest_slice(ram, xsdt_addr, 52), madt_addr, fadt_addr);
    write_rsdp(guest_slice(ram, rsdp_addr, 36), rsdt_addr, xsdt_addr);
}

fn write_acpi_header(table: []u8, sig: *const [4]u8, revision: u8, table_id: *const [8]u8) void {
    @memcpy(table[0..4], sig);
    write_int(table, 4, u32, @intCast(table.len));
    table[8] = revision;
    table[9] = 0;
    @memcpy(table[10..16], "MCHNEN");
    @memcpy(table[16..24], table_id);
    write_int(table, 24, u32, 1);
    @memcpy(table[28..32], "MCHN");
    write_int(table, 32, u32, 1);
}

fn finish_checksum(table: []u8, off: usize) void {
    table[off] = 0;
    var sum: u8 = 0;
    for (table) |b| sum +%= b;
    table[off] = 0 -% sum;
}

fn write_rsdp(rsdp: []u8, rsdt_addr: u64, xsdt_addr: u64) void {
    @memset(rsdp, 0);
    @memcpy(rsdp[0..8], "RSD PTR ");
    @memcpy(rsdp[9..15], "MCHNEN");
    rsdp[15] = 2;
    write_int(rsdp, 16, u32, @intCast(rsdt_addr));
    write_int(rsdp, 20, u32, 36);
    write_int(rsdp, 24, u64, xsdt_addr);
    finish_checksum(rsdp[0..20], 8);
    finish_checksum(rsdp, 32);
}

fn write_rsdt(rsdt: []u8, madt_addr: u64, fadt_addr: u64) void {
    @memset(rsdt, 0);
    write_acpi_header(rsdt, "RSDT", 1, "MACHRSDT");
    write_int(rsdt, 36, u32, @intCast(madt_addr));
    write_int(rsdt, 40, u32, @intCast(fadt_addr));
    finish_checksum(rsdt, 9);
}

fn write_xsdt(xsdt: []u8, madt_addr: u64, fadt_addr: u64) void {
    @memset(xsdt, 0);
    write_acpi_header(xsdt, "XSDT", 1, "MACHXSDT");
    write_int(xsdt, 36, u64, madt_addr);
    write_int(xsdt, 44, u64, fadt_addr);
    finish_checksum(xsdt, 9);
}

fn write_madt(madt: []u8) void {
    @memset(madt, 0);
    write_acpi_header(madt, "APIC", 1, "MACHAPIC");
    write_int(madt, 36, u32, 0xFEE0_0000);
    write_int(madt, 40, u32, 1); // PC/AT dual-8259 present
    var off: usize = 44;
    madt[off + 0] = 0; // processor local APIC
    madt[off + 1] = 8;
    madt[off + 2] = 0;
    madt[off + 3] = 0;
    write_int(madt, off + 4, u32, 1);
    off += 8;
    madt[off + 0] = 1; // IOAPIC
    madt[off + 1] = 12;
    madt[off + 2] = 0;
    madt[off + 3] = 0;
    write_int(madt, off + 4, u32, 0xFEC0_0000);
    write_int(madt, off + 8, u32, 0);
    off += 12;
    madt[off + 0] = 2; // IRQ0 -> GSI2 override, standard PC routing
    madt[off + 1] = 10;
    madt[off + 2] = 0;
    madt[off + 3] = 0;
    write_int(madt, off + 4, u32, 2);
    write_int(madt, off + 8, u16, 0);
    finish_checksum(madt, 9);
}

fn write_gas(buf: []u8, off: usize, space: u8, width: u8, access_size: u8, addr: u64) void {
    buf[off + 0] = space;
    buf[off + 1] = width;
    buf[off + 2] = 0;
    buf[off + 3] = access_size;
    write_int(buf, off + 4, u64, addr);
}

fn write_fadt(fadt: []u8, dsdt_addr: u64) void {
    @memset(fadt, 0);
    write_acpi_header(fadt, "FACP", 3, "MACHFADT");
    write_int(fadt, 40, u32, @intCast(dsdt_addr));
    write_int(fadt, 46, u16, 9); // SCI IRQ
    write_int(fadt, 56, u32, pm1a_evt_port);
    write_int(fadt, 64, u32, pm1a_cnt_port);
    fadt[88] = 4;
    fadt[89] = 2;
    write_int(fadt, 113, u32, @as(u32, 1) << 10); // RESET_REG_SUP
    write_gas(fadt, 117, 1, 8, 1, reset_port);
    fadt[129] = 0x06;
    write_int(fadt, 140, u64, dsdt_addr);
    write_gas(fadt, 148, 1, 32, 3, pm1a_evt_port);
    write_gas(fadt, 172, 1, 16, 2, pm1a_cnt_port);
    finish_checksum(fadt, 9);
}

fn write_dsdt(dsdt_buf: []u8) void {
    // iasl-compiled from:
    //   Name (_S5, Package (4) { 5, 5, 0, 0 })
    //   Device (COM1) { _HID PNP0501; _UID 1; _CRS IO 0x3f8 len 8, IRQ 4 }
    // The COM1 PNP node makes Linux bind a real 8250 ttyS0, so userspace
    // writes to /dev/ttyS0 reach the VMM instead of disappearing after
    // earlycon hands off.
    const dsdt = [_]u8{
        0x44, 0x53, 0x44, 0x54, 0x5f, 0x00, 0x00, 0x00, 0x02, 0x02, 0x4d, 0x43, 0x48, 0x4e, 0x45, 0x4e,
        0x4d, 0x41, 0x43, 0x48, 0x44, 0x53, 0x44, 0x54, 0x01, 0x00, 0x00, 0x00, 0x49, 0x4e, 0x54, 0x4c,
        0x28, 0x06, 0x23, 0x20, 0x08, 0x5f, 0x53, 0x35, 0x5f, 0x12, 0x08, 0x04, 0x0a, 0x05, 0x0a, 0x05,
        0x00, 0x00, 0x5b, 0x82, 0x2b, 0x43, 0x4f, 0x4d, 0x31, 0x08, 0x5f, 0x48, 0x49, 0x44, 0x0c, 0x41,
        0xd0, 0x05, 0x01, 0x08, 0x5f, 0x55, 0x49, 0x44, 0x01, 0x08, 0x5f, 0x43, 0x52, 0x53, 0x11, 0x10,
        0x0a, 0x0d, 0x47, 0x01, 0xf8, 0x03, 0xf8, 0x03, 0x01, 0x08, 0x22, 0x10, 0x00, 0x79, 0x00,
    };
    assert(dsdt_buf.len >= dsdt.len);
    @memset(dsdt_buf, 0);
    @memcpy(dsdt_buf[0..dsdt.len], &dsdt);
}

fn run_loop(
    gpa: std.mem.Allocator,
    cfg: Config,
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    devs: *const Devices,
    irqs: IrqMap,
    ram: []u8,
) !Result {
    assert(cfg.max_exits > 0);
    assert(ram.len == cfg.ram_size);

    var exits: usize = 0;
    var saw_off = false;
    var snapshotted = false;
    var snapshot_writer_state: vmstate_writer.Writer = .{};
    defer snapshot_writer_state.wait();
    while (exits < cfg.max_exits) : (exits += 1) {
        const reason = try vcpu.run();
        switch (reason) {
            .mmio => {
                const ev = vcpu.mmio_exit();
                try route_mmio(vm, vcpu, devs, irqs, ev);
            },
            .io => {
                const ev = vcpu.io_exit();
                if (route_io(vcpu, devs, ev)) {
                    saw_off = true;
                    break;
                }
            },
            .shutdown => {
                saw_off = true;
                break;
            },
            .system_event => {
                saw_off = true;
                break;
            },
            .hlt, .intr, .debug => {},
            else => {
                std.debug.print("kvm-x86_64: unhandled exit reason {d}\n", .{@intFromEnum(reason)});
                return error.GuestCrashed;
            },
        }
        if (!cfg.unbounded_serial and devs.uart.captured_len >= cfg.capture_bytes) break;
        if (snapshot_requested.load(.seq_cst)) {
            if (cfg.snapshot_path) |path| {
                if (queue_snapshot_write(&snapshot_writer_state, gpa, path, vm, vcpu, ram, cfg, devs)) {
                    snapshotted = true;
                }
                snapshot_requested.store(false, .seq_cst);
            }
        }
    }

    if (exits >= cfg.max_exits) {
        std.debug.print(
            "kvm-x86_64 boot: RanTooLong after {d} exits. Captured serial ({d} bytes):\n{s}\n",
            .{ exits, devs.uart.captured_len, devs.uart.captured_bytes() },
        );
        return error.RanTooLong;
    }

    const serial = try gpa.dupe(u8, devs.uart.captured_bytes());
    return .{ .serial = serial, .saw_psci_shutdown = saw_off, .exits = exits, .snapshotted = snapshotted };
}

fn queue_snapshot_write(
    writer: *vmstate_writer.Writer,
    gpa: std.mem.Allocator,
    path: []const u8,
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    ram: []const u8,
    cfg: Config,
    devs: *const Devices,
) bool {
    if (writer.busy()) {
        std.debug.print("kvm-x86_64: snapshot requested while previous write is still in flight\n", .{});
        return false;
    }

    std.debug.print("kvm-x86_64: writing snapshot to {s}\n", .{path});
    const job = capture_snapshot_job(gpa, path, vm, vcpu, ram, cfg, devs) catch |err| {
        std.debug.print("kvm-x86_64 boot: snapshot capture failed: {s}\n", .{@errorName(err)});
        return false;
    };
    writer.start(job) catch |err| {
        std.debug.print(
            "kvm-x86_64: snapshot async writer spawn failed: {s}; writing synchronously\n",
            .{@errorName(err)},
        );
        vmstate_writer.write_and_destroy(job) catch |write_err| {
            std.debug.print("kvm-x86_64 boot: snapshot write failed: {s}\n", .{@errorName(write_err)});
            return false;
        };
        return true;
    };
    std.debug.print("kvm-x86_64: snapshot capture done; async write started\n", .{});
    return true;
}

const snap_c = struct {
    extern "c" fn open(path: [*:0]const u8, flags: c_int, mode: c_int) c_int;
    extern "c" fn close(fd: c_int) c_int;
    extern "c" fn read(fd: c_int, buf: *anyopaque, count: usize) isize;
    extern "c" fn lseek(fd: c_int, offset: i64, whence: c_int) i64;
};

const O_RDONLY: c_int = 0;
const SEEK_END: c_int = 2;
const SEEK_SET: c_int = 0;

fn x86_topology(cfg: Config) @import("topology.zig").Topology {
    const topology = @import("topology.zig");
    return .{
        .arch = topology.ARCH_X86_64,
        .ram_base = cfg.ram_base,
        .ram_size = cfg.ram_size,
        .gic_dist_base = 0,
        .gic_redist_base = 0,
        .virtio_mmio_count = 7 + MAX_VIRTIOFS_SLOTS,
    };
}

fn append_bytes_section(
    a: std.mem.Allocator,
    sections: *std.ArrayList(@import("snapshot.zig").Section),
    tag: @import("snapshot.zig").SectionTag,
    id: u32,
    bytes: []const u8,
) !void {
    const payload = try a.dupe(u8, bytes);
    try sections.append(a, .{ .tag = tag, .id = id, .payload = payload });
}

fn capture_snapshot_job(
    gpa: std.mem.Allocator,
    path: []const u8,
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    ram: []const u8,
    cfg: Config,
    devs: *const Devices,
) !*vmstate_writer.Job {
    assert(path.len > 0);
    assert(ram.len == cfg.ram_size);

    const snapshot = @import("snapshot.zig");
    const vcpu_dump = @import("vcpu_dump.zig");
    const ram_dump = @import("ram_dump.zig");
    const virtio_dump = @import("virtio_dump.zig");

    const topo = x86_topology(cfg);
    const job = try vmstate_writer.Job.create_with_arch(gpa, "kvm-x86_64", path, snapshot.ARCH_X86_64, topo.hash());
    errdefer job.destroy();
    const a = job.arena_allocator();

    const vcpu_payload = try vcpu_dump.dump_kvm_x86(a, vcpu.fd);
    const ram_payload = try ram_dump.encode(a, cfg.ram_base, ram);

    var sections = std.ArrayList(snapshot.Section).empty;
    try sections.append(a, .{ .tag = .vcpu, .id = 0, .payload = vcpu_payload });
    try sections.append(a, .{ .tag = .ram, .id = 0, .payload = ram_payload });

    const irqchip_ids = [_]u32{ kvm.KVM_IRQCHIP_PIC_MASTER, kvm.KVM_IRQCHIP_PIC_SLAVE, kvm.KVM_IRQCHIP_IOAPIC };
    for (irqchip_ids) |chip_id| {
        var chip = try vm.get_irqchip(chip_id);
        try append_bytes_section(a, &sections, .x86_irqchip, chip_id, std.mem.asBytes(&chip));
    }
    var pit = try vm.get_pit2();
    try append_bytes_section(a, &sections, .x86_pit, 0, std.mem.asBytes(&pit));

    var vbufs: [Devices.virtio_max]*virtio.Device = undefined;
    const vdevs = devs.virtio_devices(&vbufs);
    for (vdevs) |d| {
        const vp = try virtio_dump.dump_device(a, d);
        try sections.append(a, .{ .tag = .virtio, .id = @truncate(d.base), .payload = vp });
    }
    for (vdevs) |d| {
        if (d.id != .virtio_fs) continue;
        const backend: *virtiofs_mod.Device = @ptrCast(@alignCast(d.request_ctx.?));
        const fp = try backend.state.dump_state(a);
        try sections.append(a, .{ .tag = .virtiofs_state, .id = @truncate(d.base), .payload = fp });
    }

    job.sections = try sections.toOwnedSlice(a);
    return job;
}

fn bytes_to_struct(comptime T: type, bytes: []const u8) !T {
    if (bytes.len != @sizeOf(T)) return error.BadSnapshotSection;
    var out: T = undefined;
    @memcpy(std.mem.asBytes(&out), bytes);
    return out;
}

fn apply_restore_file(
    gpa: std.mem.Allocator,
    path: []const u8,
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    ram: []u8,
    cfg: Config,
    devs: *const Devices,
) !void {
    assert(path.len > 0);
    assert(ram.len == cfg.ram_size);

    const snapshot = @import("snapshot.zig");
    const vcpu_dump = @import("vcpu_dump.zig");
    const ram_dump = @import("ram_dump.zig");
    const virtio_dump = @import("virtio_dump.zig");
    const vmstate_timing = @import("vmstate_timing.zig");

    const path_z = try gpa.dupeZ(u8, path);
    defer gpa.free(path_z);
    const fd = snap_c.open(path_z, O_RDONLY, 0);
    if (fd < 0) return error.OpenFailed;
    defer _ = snap_c.close(fd);

    const size = snap_c.lseek(fd, 0, SEEK_END);
    if (size <= 0) return error.EmptyFile;
    _ = snap_c.lseek(fd, 0, SEEK_SET);

    const raw = try gpa.alloc(u8, @intCast(size));
    defer gpa.free(raw);
    var timing = vmstate_timing.RestoreTimer.start("kvm-x86_64", raw.len, ram.len);

    var off: usize = 0;
    while (off < raw.len) {
        const rc = snap_c.read(fd, raw.ptr + off, raw.len - off);
        if (rc <= 0) return error.ReadFailed;
        off += @intCast(rc);
    }
    timing.mark("read-file");

    const decoded = try @import("vmstate_zip.zig").decompress_maybe_owned(gpa, raw);
    defer decoded.deinit(gpa);
    timing.mark("decompress");

    var snap = try snapshot.decode(gpa, decoded.bytes);
    defer snap.deinit();
    timing.mark("container-decode");

    const topo = x86_topology(cfg);
    if (!std.mem.eql(u8, &topo.hash(), &snap.header.topology_hash)) {
        return error.TopologyMismatch;
    }
    timing.mark("topology-check");

    var vbufs: [Devices.virtio_max]*virtio.Device = undefined;
    const vdevs = devs.virtio_devices(&vbufs);
    for (snap.sections) |s| {
        const section_t0 = timing.section_start();
        switch (s.tag) {
            .vcpu => try vcpu_dump.load_kvm_x86(gpa, vcpu.fd, s.payload),
            .ram => {
                _ = try ram_dump.decode_into_zeroed(s.payload, ram);
            },
            .x86_irqchip => {
                const chip = try bytes_to_struct(kvm.Irqchip, s.payload);
                try vm.set_irqchip(chip);
            },
            .x86_pit => {
                const pit = try bytes_to_struct(kvm.PitState2, s.payload);
                try vm.set_pit2(pit);
            },
            .virtio => {
                for (vdevs) |d| {
                    if (@as(u32, @truncate(d.base)) == s.id) {
                        virtio_dump.apply_device(gpa, d, s.payload) catch |err| {
                            std.debug.print(
                                "kvm-x86_64 boot: virtio restore for base 0x{x} failed: {s}\n",
                                .{ d.base, @errorName(err) },
                            );
                        };
                        break;
                    }
                }
            },
            .virtiofs_state => {
                for (vdevs) |d| {
                    if (d.id != .virtio_fs) continue;
                    if (@as(u32, @truncate(d.base)) != s.id) continue;
                    const backend: *virtiofs_mod.Device = @ptrCast(@alignCast(d.request_ctx.?));
                    backend.state.apply_state(s.payload) catch |err| {
                        std.debug.print(
                            "kvm-x86_64 boot: virtio-fs state restore for base 0x{x} failed: {s}\n",
                            .{ d.base, @errorName(err) },
                        );
                    };
                    break;
                }
            },
            else => {},
        }
        timing.section(s.tag, s.id, s.payload.len, section_t0);
    }
    timing.mark("apply-sections");
    timing.done();
}

fn route_io(vcpu: *kvm.Vcpu, devs: *const Devices, ev: kvm.IoExit) bool {
    const dir: kvm.IoDirection = @enumFromInt(ev.direction);
    if (ev.port >= uart_io_base and ev.port < uart_io_base + 8) {
        const addr = devs.uart.base + (ev.port - uart_io_base);
        if (dir == .out) {
            const value = vcpu.io_data_value(ev);
            devs.uart.write(addr, value);
            if (ev.port == uart_io_base and ev.size > 0) {
                const byte: [1]u8 = .{@truncate(value)};
                _ = host_write(2, &byte, 1);
            }
        } else {
            vcpu.write_io_read_data(ev, @truncate(devs.uart.read(addr)));
        }
        return false;
    }
    if (dir == .out) {
        const value = vcpu.io_data_value(ev);
        if (ev.port == pm1a_cnt_port and (value & (1 << 13)) != 0) return true;
        if (ev.port == reset_port and (value & 0x06) != 0) return true;
        if (ev.port == 0x64 and value == 0xFE) return true;
        return false;
    }
    vcpu.write_io_read_data(ev, 0);
    return false;
}

fn make_net_device(ram: []u8, cfg: Config, mac: *const [6]u8) virtio.Device {
    return .{
        .base = virtio_net_base,
        .size = virtio_net_size,
        .id = .net,
        // VIRTIO_F_VERSION_1 (bit 32) | VIRTIO_NET_F_MAC (bit 5).
        .features = (1 << 32) | (1 << 5),
        .config = mac,
        .ram = ram,
        .ram_base = cfg.ram_base,
    };
}

/// Open a host file as a virtio-blk backend. Returns null when the
/// caller didn't ask for this slot, or when the file open failed.
fn open_blk_backend(path: ?[]const u8, label: []const u8) ?blk_mod.Backend {
    const p = path orelse return null;
    return blk_mod.open_file(p) catch |err| {
        std.debug.print("virtio-blk {s} disabled: {s} ({s})\n", .{ label, @errorName(err), p });
        return null;
    };
}

/// Wrap a runtime-passed fd as a virtio-blk backend (#272). Mirror
/// of boot_hvf.zig's matching helper — see that file for the design.
fn open_blk_backend_from_fd(fd: ?c_int, read_only: bool, label: []const u8) ?blk_mod.Backend {
    const f = fd orelse return null;
    if (f < 0) return null;
    const size_bytes = lseek(f, 0, 2);
    if (size_bytes <= 0) {
        std.debug.print("virtio-blk {s} disabled: lseek(fd={d}) returned {d}\n", .{ label, f, size_bytes });
        return null;
    }
    if (@rem(size_bytes, 512) != 0) {
        std.debug.print(
            "virtio-blk {s} disabled: size {d} is not a multiple of 512 (fd={d})\n",
            .{ label, size_bytes, f },
        );
        return null;
    }
    return blk_mod.Backend.init_from_fd_with_mode(f, @intCast(size_bytes), read_only);
}

/// Wrap a `blk_mod.Backend` as a virtio-mmio device. `backend` must
/// outlive the returned device — the device's `config` and
/// `request_ctx` are pointers into it.
fn make_blk_device(base: u64, size: u64, ram: []u8, cfg: Config, backend: *blk_mod.Backend) virtio.Device {
    return .{
        .base = base,
        .size = size,
        .id = .block,
        .features = (1 << 32), // VIRTIO_F_VERSION_1
        .config = std.mem.asBytes(&backend.config),
        .ram = ram,
        .ram_base = cfg.ram_base,
        .request_handler = &blk_mod.Backend.handle_request,
        .request_ctx = @ptrCast(backend),
    };
}

/// Variant of `makeBlkDevice` that advertises VIRTIO_BLK_F_DISCARD
/// in the feature bits (#272). Mirror of boot_hvf.zig's helper.
fn make_blk_device_with_discard(base: u64, size: u64, ram: []u8, cfg: Config, backend: *blk_mod.Backend) virtio.Device {
    return .{
        .base = base,
        .size = size,
        .id = .block,
        .features = (1 << 32) | (@as(u64, 1) << blk_mod.VIRTIO_BLK_F_DISCARD),
        .config = std.mem.asBytes(&backend.config),
        .ram = ram,
        .ram_base = cfg.ram_base,
        .request_handler = &blk_mod.Backend.handle_request,
        .request_ctx = @ptrCast(backend),
    };
}

/// Parse `MACHINEN_VSOCK` into a port-map list. Empty/missing returns
/// an empty slice; parse errors log and return empty so a typo in the
/// env doesn't prevent boot. Returned slice + path strings allocated
/// from `gpa`.
fn parse_vsock_env(gpa: std.mem.Allocator) []vsock_mod.PortMap {
    const raw = getenv("MACHINEN_VSOCK") orelse return &.{};
    const s = std.mem.span(raw);
    if (s.len == 0) return &.{};
    return vsock_mod.parse_env(gpa, s) catch |err| {
        std.debug.print("vsock: MACHINEN_VSOCK parse failed ({s}); ignoring\n", .{@errorName(err)});
        return &.{};
    };
}

/// Build the virtio-vsock device. `cid_ptr` must outlive the device —
/// the config field is a pointer into it.
fn make_vsock_device(ram: []u8, cfg: Config, cid_ptr: *const u64) virtio.Device {
    return .{
        .base = virtio_vsock_base,
        .size = virtio_vsock_size,
        .id = .vsock,
        .features = (1 << 32), // VIRTIO_F_VERSION_1
        .config = std.mem.asBytes(cid_ptr),
        .ram = ram,
        .ram_base = cfg.ram_base,
        .request_handler = &vsock_mod.Bridge.handle_tx_chain,
        .request_ctx = null,
        // Queues 0 (RX) and 2 (event) are driver-posts-empty-buffers
        // queues — host fills them on demand, not on every kick.
        .skip_notify_queues = (1 << 0) | (1 << 2),
    };
}

/// Parse `MACHINEN_VIRTIOFS_0..N` into per-slot virtio-fs backends
/// (#332, #338). Mirror of boot_hvf.zig's parser — see there for the
/// `<tag>:<mode>:<host_path>` grammar, the numbered-env rationale, and
/// the c_allocator rationale. A missing slot is null; a malformed value
/// is left null (warn-and-continue).
fn parse_virtiofs_env() [MAX_VIRTIOFS_SLOTS]?virtiofs_mod.Device {
    var out: [MAX_VIRTIOFS_SLOTS]?virtiofs_mod.Device = @splat(null);
    for (0..MAX_VIRTIOFS_SLOTS) |i| {
        var name_buf: [32]u8 = undefined;
        const name = std.fmt.bufPrintZ(&name_buf, "MACHINEN_VIRTIOFS_{d}", .{i}) catch continue;
        out[i] = parse_one_virtiofs_env(name);
    }
    return out;
}

/// Parse a single `MACHINEN_VIRTIOFS_<i>` env var into a backend, or
/// null if unset / malformed. See `parseVirtiofsEnv`.
fn parse_one_virtiofs_env(name: [*:0]const u8) ?virtiofs_mod.Device {
    const raw = getenv(name) orelse return null;
    const s = std.mem.span(raw);
    if (s.len == 0) return null;

    const c1 = std.mem.indexOfScalar(u8, s, ':') orelse {
        std.debug.print("virtio-fs: {s} missing ':<mode>:<path>'; ignoring\n", .{name});
        return null;
    };
    const tag = s[0..c1];
    const rest = s[c1 + 1 ..];
    const c2 = std.mem.indexOfScalar(u8, rest, ':') orelse {
        std.debug.print("virtio-fs: {s} missing ':<path>'; ignoring\n", .{name});
        return null;
    };
    const mode = rest[0..c2];
    const host_path = rest[c2 + 1 ..];

    if (tag.len == 0 or tag.len > 36) {
        std.debug.print("virtio-fs: tag must be 1..36 bytes; ignoring\n", .{});
        return null;
    }
    if (host_path.len == 0 or host_path[0] != '/') {
        std.debug.print("virtio-fs: host path must be absolute; ignoring\n", .{});
        return null;
    }
    const mode_rw = if (std.mem.eql(u8, mode, "rw"))
        true
    else if (std.mem.eql(u8, mode, "ro"))
        false
    else {
        std.debug.print("virtio-fs: mode must be 'ro' or 'rw'; ignoring\n", .{});
        return null;
    };

    const gpa = std.heap.c_allocator;
    const root_abs = gpa.dupe(u8, host_path) catch return null;
    const dev = virtiofs_mod.Device.init(gpa, tag, root_abs, mode_rw) catch |err| {
        gpa.free(root_abs);
        std.debug.print("virtio-fs: backend init failed: {s}\n", .{@errorName(err)});
        return null;
    };
    std.debug.print("virtio-fs: {s} {s} <- {s}\n", .{ tag, mode, host_path });
    return dev;
}

/// Wrap a `virtiofs.Device` backend as a virtio-mmio device on the
/// given slot `base`. `backend` must outlive the returned device.
fn make_virtio_fs_device(base: u64, ram: []u8, cfg: Config, backend: *virtiofs_mod.Device) virtio.Device {
    return .{
        .base = base,
        .size = virtio_virtiofs_size,
        .id = .virtio_fs,
        .features = (1 << 32), // VIRTIO_F_VERSION_1
        .config = backend.config_bytes(),
        .ram = ram,
        .ram_base = cfg.ram_base,
        .request_handler = &virtiofs_mod.Device.handle_request,
        .request_ctx = @ptrCast(backend),
    };
}

/// Build the virtio-balloon device. `backend` must outlive the
/// returned Device — config + request_ctx are pointers into it.
/// #263 phase B: continuous free-page reporting.
fn make_balloon_device(ram: []u8, cfg: Config, backend: *balloon_mod.Backend) virtio.Device {
    return .{
        .base = virtio_balloon_base,
        .size = virtio_balloon_size,
        .id = .balloon,
        .features = balloon_mod.Backend.features(),
        .config = backend.config_bytes(),
        .ram = ram,
        .ram_base = cfg.ram_base,
        .request_handler = &balloon_mod.Backend.handle_request,
        .request_ctx = @ptrCast(backend),
    };
}

/// Dial gvproxy if `MACHINEN_NET_SOCKET` is set; null on missing env
/// or any connect failure (the rest of the VMM still runs without
/// network).
fn connect_gvproxy(gpa: std.mem.Allocator, netdev: *virtio.Device) ?*net_mod.NetSocket {
    const env = getenv("MACHINEN_NET_SOCKET") orelse return null;
    const path = std.mem.span(env);
    if (path.len == 0) return null;
    return net_mod.NetSocket.connect(gpa, netdev, .{ .socket_path = path }) catch |err| {
        std.debug.print("net: connect to {s} failed: {s} — continuing without network\n", .{ path, @errorName(err) });
        return null;
    };
}

/// Bring up the vsock bridge: create it, wire its request_ctx into the
/// device, start the poll thread, and log the active port mappings.
/// Returns null on any failure (and clears `dev` so callers know the
/// device is no longer live).
fn start_vsock_bridge(
    gpa: std.mem.Allocator,
    dev: *virtio.Device,
    ports: []const vsock_mod.PortMap,
    irq_ctx: *VsockIrqCtx,
) ?*vsock_mod.Bridge {
    const bridge = vsock_mod.Bridge.create(gpa, dev, .{
        .ports = ports,
        .raise_irq = &on_vsock_irq,
        .raise_irq_ctx = @ptrCast(irq_ctx),
    }) catch |err| {
        std.debug.print("vsock: bridge create failed: {s}\n", .{@errorName(err)});
        return null;
    };
    dev.request_ctx = @ptrCast(bridge);
    bridge.start() catch |err| {
        std.debug.print("vsock: bridge start failed: {s}\n", .{@errorName(err)});
        bridge.destroy();
        return null;
    };
    for (ports) |pm| {
        const tag: []const u8 = switch (pm.direction) {
            .inbound => "in",
            .outbound => "out",
        };
        std.debug.print("vsock: {s} {d} <-> {s}\n", .{ tag, pm.guest_port, pm.uds_path });
    }
    return bridge;
}

/// SIGUSR1 atomic — set by the signal handler, polled by the run
/// loop after every vCPU exit. File-static because signal handlers
/// can't take closures; one VMM per process means there's at most
/// one boot loop reading this.
var snapshot_requested: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);

fn sigusr1_handler(sig: c_int) callconv(.c) void {
    _ = sig;
    snapshot_requested.store(true, .seq_cst);
}

fn install_snapshot_signal() void {
    const c = struct {
        extern "c" fn signal(sig: c_int, handler: usize) usize;
    };
    const SIGUSR1: c_int = 10;
    _ = c.signal(SIGUSR1, @intFromPtr(&sigusr1_handler));
}

/// Drive the vCPU until PSCI SYSTEM_OFF, an unhandled exit, the
/// configured serial-capture threshold, `max_exits`, or a
/// Raw x86 GSI numbers used with KVM_IRQ_LINE. Linux learns these from
/// the virtio_mmio.device=... kernel command-line entries.
const IrqMap = struct {
    uart: u32,
    net: u32,
    blk: u32,
    blk2: u32,
    vsock: u32,
    balloon: u32,
    blk3: u32,
    blk4: u32,
    virtiofs: [MAX_VIRTIOFS_SLOTS]u32,

    fn init() IrqMap {
        return .{
            .uart = 4,
            .net = 5,
            .blk = 6,
            .vsock = 7,
            .blk2 = 8,
            .balloon = 9,
            .blk3 = 10,
            .blk4 = 11,
            .virtiofs = .{ 12, 13, 14, 15, 16 },
        };
    }
};

/// Owning handles for everything the run loop needs to dispatch MMIO
/// against. `net_inst` is included separately from `netdev` so the
/// MMIO path can take its `irq_mu` even when the device is wired but
/// no gvproxy backend connected.
const Devices = struct {
    uart: *uart8250_mod.Uart8250,
    netdev: *virtio.Device,
    net_inst: ?*net_mod.NetSocket,
    blk_dev: ?*virtio.Device,
    blk2_dev: ?*virtio.Device,
    blk3_dev: ?*virtio.Device,
    blk4_dev: ?*virtio.Device,
    vsock_dev: ?*virtio.Device,
    vsock_bridge: ?*vsock_mod.Bridge,
    balloon_dev: ?*virtio.Device,

    /// One entry per virtio-fs slot (7..10); null when that slot's
    /// `--mount-live` wasn't requested.
    virtiofs_devs: [MAX_VIRTIOFS_SLOTS]?*virtio.Device,

    /// Upper bound on virtio devices: net + 4 blk slots + vsock +
    /// balloon + every virtio-fs `--mount-live` slot.
    pub const virtio_max = 7 + MAX_VIRTIOFS_SLOTS;

    /// Collect every present virtio device into `buf`, returning the
    /// populated prefix. Used by snapshot/restore to dump/apply each
    /// device's transport state — virtio-fs slots included, so a
    /// `--mount-live` VM's queue state round-trips through vmstate.
    pub fn virtio_devices(self: *const Devices, buf: *[virtio_max]*virtio.Device) []*virtio.Device {
        var n: usize = 0;
        buf[n] = self.netdev;
        n += 1;
        for ([_]?*virtio.Device{
            self.blk_dev,   self.blk2_dev,    self.blk3_dev, self.blk4_dev,
            self.vsock_dev, self.balloon_dev,
        }) |maybe| {
            if (maybe) |d| {
                buf[n] = d;
                n += 1;
            }
        }
        for (self.virtiofs_devs) |maybe| {
            if (maybe) |d| {
                buf[n] = d;
                n += 1;
            }
        }
        assert(n <= virtio_max);
        return buf[0..n];
    }
};

/// A virtio-fs slot whose MMIO window owns a phys addr, paired with IRQ.
const VirtiofsMatch = struct { dev: *virtio.Device, irq: u32 };

/// Find the virtio-fs slot (if any) whose MMIO window owns `phys_addr`.
fn virtiofs_match(devs: *const Devices, irqs: IrqMap, phys_addr: u64) ?VirtiofsMatch {
    for (devs.virtiofs_devs, irqs.virtiofs) |dev_opt, irq| {
        if (dev_opt) |d| {
            if (d.handles(phys_addr)) return .{ .dev = d, .irq = irq };
        }
    }
    return null;
}

/// 8250 MMIO. Console-byte writes echo to host stderr; every access
/// resyncs the SPI line based on `irqAsserted()`.
fn handle_pl011_mmio(
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    uart: *uart8250_mod.Uart8250,
    ev: kvm.MmioExit,
    irq: u32,
) !void {
    assert(uart.handles(ev.phys_addr));
    if (ev.is_write != 0) {
        const val = mmio_read_value(ev);
        uart.write(ev.phys_addr, val);
        if ((ev.phys_addr - uart.base) == 0 and ev.len > 0) {
            const byte: [1]u8 = .{ev.data[0]};
            _ = host_write(2, &byte, 1);
        }
    } else {
        vcpu.write_mmio_read_data(uart.read(ev.phys_addr), ev.len);
    }
    vm.set_irq(irq, if (uart.irq_asserted()) 1 else 0) catch {};
}

/// virtio-MMIO read/write + raise/lower the SPI based on the device's
/// post-access interrupt_status. Shared shape across net / blk / blk2 /
/// vsock; the callers that need cross-thread serialisation take the
/// appropriate mutex around this call.
fn handle_virtio_mmio(
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    dev: *virtio.Device,
    irq: u32,
    ev: kvm.MmioExit,
) !void {
    assert(dev.handles(ev.phys_addr));
    if (ev.is_write != 0) {
        dev.write(ev.phys_addr, mmio_read_value(ev));
    } else {
        vcpu.write_mmio_read_data(dev.read(ev.phys_addr), ev.len);
    }
    vm.set_irq(irq, if (@atomicLoad(u32, &dev.interrupt_status, .acquire) != 0) 1 else 0) catch {};
}

/// Route an MMIO exit to the device that owns the IPA. Each cross-
/// thread arm wraps `handleVirtioMmio` in the appropriate mutex.
fn route_mmio(
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    devs: *const Devices,
    irqs: IrqMap,
    ev: kvm.MmioExit,
) !void {
    // KVM never emits an MMIO exit with len outside [1,8]; values
    // outside that mean we read the wrong kvm_run union slot.
    assert(ev.len >= 1 and ev.len <= 8);
    assert(ev.is_write <= 1);

    if (devs.uart.handles(ev.phys_addr)) {
        try handle_pl011_mmio(vm, vcpu, devs.uart, ev, irqs.uart);
        return;
    }
    if (devs.netdev.handles(ev.phys_addr)) {
        try dispatch_net_mmio(vm, vcpu, devs, irqs, ev);
        return;
    }
    if (devs.blk_dev) |d| if (d.handles(ev.phys_addr)) {
        try handle_virtio_mmio(vm, vcpu, d, irqs.blk, ev);
        return;
    };
    if (devs.blk2_dev) |d| if (d.handles(ev.phys_addr)) {
        try handle_virtio_mmio(vm, vcpu, d, irqs.blk2, ev);
        return;
    };
    if (devs.blk3_dev) |d| if (d.handles(ev.phys_addr)) {
        try handle_virtio_mmio(vm, vcpu, d, irqs.blk3, ev);
        return;
    };
    if (devs.blk4_dev) |d| if (d.handles(ev.phys_addr)) {
        try handle_virtio_mmio(vm, vcpu, d, irqs.blk4, ev);
        return;
    };
    if (devs.vsock_dev) |d| if (d.handles(ev.phys_addr)) {
        try dispatch_vsock_mmio(vm, vcpu, devs, d, irqs.vsock, ev);
        return;
    };
    if (devs.balloon_dev) |d| if (d.handles(ev.phys_addr)) {
        try handle_virtio_mmio(vm, vcpu, d, irqs.balloon, ev);
        return;
    };
    if (virtiofs_match(devs, irqs, ev.phys_addr)) |m| {
        // virtio-fs request handling is synchronous on the vCPU thread
        // (`handleVirtioMmio` → `dev.write` → `notify` drains the chain
        // inline through `virtiofs.Device.handleRequest`). No second
        // thread, so no mutex to take — unlike net / vsock.
        try handle_virtio_mmio(vm, vcpu, m.dev, m.irq, ev);
        return;
    }
    // Other MMIO (DTB-described regions we haven't hooked up) — for
    // reads, hand back zeros (the writeMmioReadData default on
    // untouched kvm_run bytes is already zero, but be explicit so a
    // future non-zero lingerer doesn't bite).
    if (ev.is_write == 0) vcpu.write_mmio_read_data(0, ev.len);
}

/// Run a virtio-net MMIO event under `net_inst.irq_mu`. The RX thread
/// inside NetSocket sets interrupt_status and asserts the SPI line
/// under `irq_mu`; we take the same mutex so our snapshot-based setIrq
/// can't override the bridge's. No-op when `net_inst` is null (no
/// gvproxy backend) — there is no second thread to race against, and
/// the kernel still sees a valid virtio-net device with link-down.
fn dispatch_net_mmio(
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    devs: *const Devices,
    irqs: IrqMap,
    ev: kvm.MmioExit,
) !void {
    if (devs.net_inst) |n| n.lock_irq();
    defer if (devs.net_inst) |n| n.unlock_irq();
    try handle_virtio_mmio(vm, vcpu, devs.netdev, irqs.net, ev);
}

/// Run a virtio-vsock MMIO event under `vsock_bridge.mu`. The vCPU
/// side of (RMW interrupt_status + setIrq) must serialise against the
/// bridge poll thread's same pair. Without this, the bridge's
/// setIrq(1) — issued the moment it injects an RX packet — can be
/// overridden by a stale setIrq(0) we computed before the bridge's
/// RMW and only got around to syscalling now. Symptom: guest never
/// sees the CONNECT RESPONSE, the vsock exec channel wedges, N2/S*
/// all fail deterministically on KVM. Apple's `hv_gic_set_spi`
/// happens to absorb this race; `KVM_IRQ_LINE` doesn't, which is why
/// HVF passes smoke and KVM doesn't until this lock lands.
/// `handleTxChain` assumes the caller holds `bridge.mu` — see its
/// docstring.
fn dispatch_vsock_mmio(
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    devs: *const Devices,
    dev: *virtio.Device,
    irq: u32,
    ev: kvm.MmioExit,
) !void {
    if (devs.vsock_bridge) |b| b.mu.lock();
    defer if (devs.vsock_bridge) |b| b.mu.unlock();
    try handle_virtio_mmio(vm, vcpu, dev, irq, ev);
}

/// Pack the up-to-8 little-endian bytes KVM hands us in `mmio.data`
/// into a u64 the device handlers expect.
fn mmio_read_value(ev: kvm.MmioExit) u64 {
    assert(ev.len >= 1 and ev.len <= 8);
    var val: u64 = 0;
    const n = @min(@as(usize, ev.len), 8);
    assert(n >= 1 and n <= 8);
    for (0..n) |i| {
        val |= @as(u64, ev.data[i]) << @as(u6, @intCast(i * 8));
    }
    return val;
}

fn read_all(gpa: std.mem.Allocator, path: []const u8) ![]u8 {
    assert(path.len > 0);
    var path_buf: [4096]u8 = undefined;
    if (path.len >= path_buf.len) return error.NameTooLong;
    @memcpy(path_buf[0..path.len], path);
    path_buf[path.len] = 0;
    const path_z: [*:0]const u8 = @ptrCast(&path_buf);

    const fd = host_open(path_z, 0, 0);
    if (fd < 0) return error.OpenFailed;
    assert(fd >= 0);
    defer _ = host_close(fd);

    const size_signed = host_lseek(fd, 0, 2);
    if (size_signed < 0) return error.SeekFailed;
    _ = host_lseek(fd, 0, 0);
    const size_bytes: usize = @intCast(size_signed);
    assert(size_bytes > 0);

    const buf = try gpa.alloc(u8, size_bytes);
    errdefer gpa.free(buf);
    var total_bytes: usize = 0;
    while (total_bytes < size_bytes) {
        const n_bytes = host_read(fd, buf[total_bytes..].ptr, size_bytes - total_bytes);
        if (n_bytes <= 0) return error.ShortRead;
        total_bytes += @intCast(n_bytes);
    }
    assert(total_bytes == size_bytes);
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
fn host_open(path: [*:0]const u8, flags: c_int, mode: c_int) c_int {
    return open(path, flags, mode);
}
fn host_close(fd: c_int) c_int {
    return close(fd);
}
fn host_read(fd: c_int, buf: [*]u8, count: usize) isize {
    return read(fd, buf, count);
}
fn host_write(fd: c_int, buf: [*]const u8, count: usize) isize {
    return write(fd, buf, count);
}
fn host_lseek(fd: c_int, offset: i64, whence: c_int) i64 {
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

fn on_vsock_irq(ctx: ?*anyopaque) void {
    assert(ctx != null);
    const c: *VsockIrqCtx = @ptrCast(@alignCast(ctx.?));
    c.vm.set_irq(c.irq, 1) catch {};
}

/// Same shape as VsockIrqCtx, but for the virtio-net SPI. NetSocket's
/// rxLoop calls `onNetIrq` after each frame it injects, with
/// `n.irq_mu` already held — we just pulse the line.
pub const NetIrqCtx = struct {
    vm: *kvm.Vm,
    irq: u32,
};

fn on_net_irq(ctx: ?*anyopaque) void {
    assert(ctx != null);
    const c: *NetIrqCtx = @ptrCast(@alignCast(ctx.?));
    c.vm.set_irq(c.irq, 1) catch {};
}

/// Pump a guest-emitted ethernet frame through to gvproxy. Called
/// from `virtio.Device.notify()` on the vCPU thread when the kernel
/// kicks the TX queue. The 12-byte virtio-net header has already
/// been stripped by `walkAndEmit`, so we just hand the bare ethernet
/// frame to NetSocket.input which prepends the 4-byte length prefix
/// and writes to the gvproxy UDS.
fn on_net_tx(ctx: ?*anyopaque, frame: []const u8) void {
    assert(ctx != null);
    assert(frame.len > 0);
    const n: *net_mod.NetSocket = @ptrCast(@alignCast(ctx.?));
    n.input(frame);
}

// arm64 Linux kernel Image header — same parser as hvf.zig has;
// duplicated because that module is macOS-only. Tiny enough that
// sharing via a third module wasn't worth the indirection yet.

test "x86 bzImage parser rejects non-bzImage" {
    var bytes: [0x800]u8 = @splat(0);
    try std.testing.expectError(error.BadMagic, BzImage.parse(&bytes));
    @memcpy(bytes[0x202..0x206], "HdrS");
    bytes[0x1F1] = 1;
    try std.testing.expectError(error.TruncatedSetup, BzImage.parse(bytes[0..1024]));
}

test "x86 cmdline advertises ttyS0 and virtio-mmio" {
    const cmd = default_cmdline();
    try std.testing.expect(std.mem.indexOf(u8, cmd, "console=ttyS0") != null);
    try std.testing.expect(std.mem.indexOf(u8, cmd, "virtio_mmio.device=512@0x0a000200:6") != null);
}
