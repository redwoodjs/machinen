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

const assert = std.debug.assert;

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
const virtiofs_mod = @import("virtiofs.zig");
const net_mod = @import("net_socket.zig");
const dtb_patch = @import("dtb_patch.zig");
const balloon_mod = @import("balloon.zig");
const stats_mod = @import("stats.zig");

// Guest-physical bases. Same MMIO layout as HVF (see boot_hvf.zig
// for the slot layout doc) so the shared `virt.dts` works for both
// backends.
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

// #338: up to five virtio-fs devices, one per `--mount-live` (one is
// consumed internally by a lazy restore). Slots 7..11, contiguous
// after blk4. Mirrors boot_hvf.zig.
const MAX_VIRTIOFS_SLOTS: usize = 5;
const virtio_virtiofs_bases: [MAX_VIRTIOFS_SLOTS]u64 = .{
    0x0A00_0E00,
    0x0A00_1000,
    0x0A00_1200,
    0x0A00_1400,
    0x0A00_1600,
};

comptime {
    // virtio-mmio slot layout — must stay byte-identical to virt.dts.
    // Drift here means the kernel probes the wrong window and devices
    // never bind, with no clear runtime signal.
    assert(virtio_net_size == 0x200);
    assert(virtio_blk_size == 0x200);
    assert(virtio_vsock_size == 0x200);
    assert(virtio_blk2_size == 0x200);
    assert(virtio_balloon_size == 0x200);
    assert(virtio_blk_base == virtio_net_base + virtio_net_size);
    assert(virtio_vsock_base == virtio_blk_base + virtio_blk_size);
    assert(virtio_blk2_base == virtio_vsock_base + virtio_vsock_size);
    assert(virtio_balloon_base == virtio_blk2_base + virtio_blk2_size);
    assert(virtio_blk3_size == 0x200);
    assert(virtio_blk4_size == 0x200);
    assert(virtio_blk3_base == virtio_balloon_base + virtio_balloon_size);
    assert(virtio_blk4_base == virtio_blk3_base + virtio_blk3_size);
    assert(virtio_virtiofs_size == 0x200);
    assert(virtio_virtiofs_bases[0] == virtio_blk4_base + virtio_blk4_size);
    for (1..MAX_VIRTIOFS_SLOTS) |i| {
        assert(virtio_virtiofs_bases[i] == virtio_virtiofs_bases[i - 1] + virtio_virtiofs_size);
    }
}

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
    /// #272: pre-opened fd backing the squashfs RO lower for the
    /// `--mount` payload. Mirror of boot_hvf.zig's matching field;
    /// see that file for the full design.
    mountdisk_lower_fd: ?c_int = null,
    /// #272: pre-opened fd backing the ext4 RW upper for the
    /// `--mount` overlay. Mirror of boot_hvf.zig's matching field.
    mountdisk_upper_fd: ?c_int = null,
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
    /// Snapshot integration (tasks #32+). On boot, if `restore_path`
    /// is set, the .snaplet at that path is loaded and applied to the
    /// vCPU + RAM before the run loop starts. While running, SIGUSR1
    /// flips an atomic flag that the run loop checks after each exit;
    /// when raised, the vCPU + RAM are dumped to `snapshot_path` and
    /// the loop exits cleanly with `Result.snapshotted = true`.
    restore_path: ?[]const u8 = null,
    snapshot_path: ?[]const u8 = null,
};

pub const Result = struct {
    serial: []u8,
    saw_psci_shutdown: bool,
    exits: usize,
    /// True iff the run loop exited via SIGUSR1-triggered snapshot
    /// (state has been written to cfg.snapshot_path).
    snapshotted: bool = false,
};

/// Caller-supplied layout must satisfy the basic geometry the boot
/// protocol depends on. These are programmer errors at the call site,
/// not anything the guest can influence — assert hard.
fn validateConfig(cfg: Config) void {
    assert(cfg.kernel_path.len > 0);
    assert(cfg.dtb_path.len > 0);
    assert(cfg.ram_size >= 16 * 1024 * 1024);
    assert(cfg.ram_size % 4096 == 0);
    assert(cfg.ram_base % 4096 == 0);
    assert(cfg.dtb_offset % 4096 == 0);
    assert(cfg.initrd_offset % 4096 == 0);
    assert(cfg.dtb_offset < cfg.ram_size);
    assert(cfg.initrd_offset < cfg.ram_size);
    assert(cfg.gic_dist_addr != cfg.gic_redist_addr);
    assert(cfg.max_exits > 0);
}

pub fn boot(gpa: std.mem.Allocator, cfg: Config) !Result {
    validateConfig(cfg);

    // Topology fingerprint — printed on stderr so snapshot tooling can
    // capture the live guest's IPA layout. Tests assert this matches
    // across HVF/KVM boots of the same config (task #25).
    const topo: @import("topology.zig").Topology = .{
        .ram_base = cfg.ram_base,
        .ram_size = cfg.ram_size,
        .gic_dist_base = cfg.gic_dist_addr,
        .gic_redist_base = cfg.gic_redist_addr,
    };
    const topo_hex = topo.hashHex();
    std.debug.print("topology: {s}\n", .{topo_hex});

    // Install SIGUSR1 handler so the host can request a mid-flight
    // snapshot. Idempotent (signal() is fine to call before boot).
    if (cfg.snapshot_path != null) installSnapshotSignal();

    var fx = try loadFixtures(gpa, cfg);
    defer fx.deinit(gpa);

    const ram = try allocateAndPopulateRam(gpa, cfg, fx);
    defer std.posix.munmap(ram);

    // --- KVM bring-up --------------------------------------------
    var k = try kvm.Kvm.open_();
    defer k.close_();

    var vm = try k.createVm();
    defer vm.destroy();

    try vm.mapMemory(0, cfg.ram_base, ram);

    // vGIC BEFORE vCPU creation (KVM requires it).
    var gic = try vm.createGicV3(cfg.gic_dist_addr, cfg.gic_redist_addr);
    defer gic.destroy();

    var vcpu = try initVcpu(&vm, fx.img, cfg);
    defer vcpu.destroy();

    // vGIC finalize happens AFTER vcpus exist.
    try gic.finalize();

    // --- run loop -------------------------------------------------
    var uart = pl011_mod.Pl011.init;
    // Production boots discard Result.serial unread (main.zig); skip
    // the per-byte capture writes in that mode. See
    // .docs/learnings/microvm/allocations.md (#240).
    uart.capture_enabled = !cfg.unbounded_serial;

    const irqs = IrqMap.init();

    // virtio-blk (#114). Two slots, mirroring boot_hvf.zig:
    //   slot 1 → SPI #17 → /dev/vda — rootdisk preferred, else disk.
    //   slot 3 → SPI #19 → /dev/vdb — scratch when both are present.
    // Linux probes virtio-mmio buses in DTB order, so DTB slot order
    // determines /dev/vd* naming. With only one slot populated the
    // lone device is always /dev/vda regardless of which slot.
    const slot1_path: ?[]const u8 = cfg.rootdisk_path orelse cfg.disk_path;
    const slot3_path: ?[]const u8 = if (cfg.rootdisk_path != null) cfg.disk_path else null;

    var blk_backend_opt: ?blk_mod.Backend = openBlkBackend(slot1_path, "slot 1");
    defer if (blk_backend_opt) |*b| b.deinit();
    var blkdev_opt: ?virtio.Device = if (blk_backend_opt) |*b|
        makeBlkDevice(virtio_blk_base, virtio_blk_size, ram, cfg, b)
    else
        null;
    const blkdev_ptr: ?*virtio.Device = if (blkdev_opt) |_| &blkdev_opt.? else null;

    var blk2_backend_opt: ?blk_mod.Backend = openBlkBackend(slot3_path, "slot 3");
    defer if (blk2_backend_opt) |*b| b.deinit();
    var blk2dev_opt: ?virtio.Device = if (blk2_backend_opt) |*b|
        makeBlkDevice(virtio_blk2_base, virtio_blk2_size, ram, cfg, b)
    else
        null;
    const blk2dev_ptr: ?*virtio.Device = if (blk2dev_opt) |_| &blk2dev_opt.? else null;

    // virtio-blk slot 5 — squashfs RO lower for `--mount` (#272).
    var blk3_backend_opt: ?blk_mod.Backend = openBlkBackendFromFd(cfg.mountdisk_lower_fd, true, "slot 5 (mount lower)");
    defer if (blk3_backend_opt) |*b| b.deinit();
    var blk3dev_opt: ?virtio.Device = if (blk3_backend_opt) |*b|
        makeBlkDevice(virtio_blk3_base, virtio_blk3_size, ram, cfg, b)
    else
        null;
    const blk3dev_ptr: ?*virtio.Device = if (blk3dev_opt) |_| &blk3dev_opt.? else null;

    // virtio-blk slot 6 — ext4 RW upper for `--mount` overlay (#272).
    var blk4_backend_opt: ?blk_mod.Backend = openBlkBackendFromFd(cfg.mountdisk_upper_fd, false, "slot 6 (mount upper)");
    defer if (blk4_backend_opt) |*b| b.deinit();
    var blk4dev_opt: ?virtio.Device = if (blk4_backend_opt) |*b|
        makeBlkDeviceWithDiscard(virtio_blk4_base, virtio_blk4_size, ram, cfg, b)
    else
        null;
    const blk4dev_ptr: ?*virtio.Device = if (blk4dev_opt) |_| &blk4dev_opt.? else null;

    // virtio-net (#197). Slot 0; gvproxy backs RX/TX over a UDS
    // pointed at by `MACHINEN_NET_SOCKET`. Without that env (or
    // with a connect failure), the device still exists in the MMIO
    // window — the kernel binds a virtio-net driver to it — but
    // RX/TX go nowhere, so eth0 stays link-down. That matches the
    // pre-#197 behaviour where the slot returned zeros.
    const virtio_mac = [_]u8{ 0x02, 0xDE, 0xAD, 0xBE, 0xEF, 0x01 };
    var netdev = makeNetDevice(ram, cfg, &virtio_mac);
    const net_inst: ?*net_mod.NetSocket = connectGvproxy(gpa, &netdev);
    defer if (net_inst) |n| n.destroy();
    var net_irq_ctx = NetIrqCtx{ .vm = &vm, .irq = irqs.net };
    if (net_inst) |n| {
        // TX: every guest-emitted frame goes through NetSocket.input
        // → gvproxy. The kernel's notify() drains the TX avail queue
        // and calls tx_handler per frame (with the 12-byte virtio-net
        // header already stripped by virtio.zig::walkAndEmit).
        netdev.tx_handler = &onNetTx;
        netdev.tx_ctx = @ptrCast(n);
        // RX: NetSocket's rxLoop calls on_rx after each injectRx,
        // both under `n.irq_mu`. routeMmio takes the same mutex
        // around the net arm, so the (RMW + setIrq) pairs serialise
        // across the two threads — without this, the RX thread's
        // setIrq(1) can be overridden by a stale vCPU setIrq(0).
        n.on_rx = &onNetIrq;
        n.on_rx_ctx = @ptrCast(&net_irq_ctx);
    }

    // virtio-vsock (#44). Off by default; the runtime sets MACHINEN_VSOCK
    // when it wants the guest exec/fuse agents to be reachable. Same
    // env grammar as HVF (see boot_hvf.zig for the syntax doc) — parsed
    // ports are gpa-allocated and leak for the VMM's life.
    const vsock_cid_storage: u64 = vsock_mod.default_guest_cid;
    const vsock_ports = parseVsockEnv(gpa);
    var vsock_dev_opt: ?virtio.Device = if (vsock_ports.len > 0)
        makeVsockDevice(ram, cfg, &vsock_cid_storage)
    else
        null;
    const vsock_dev_ptr: ?*virtio.Device = if (vsock_dev_opt) |_| &vsock_dev_opt.? else null;

    var vsock_irq_ctx = VsockIrqCtx{ .vm = &vm, .irq = irqs.vsock };
    var vsock_bridge_opt: ?*vsock_mod.Bridge = null;
    if (vsock_dev_ptr) |d| {
        vsock_bridge_opt = startVsockBridge(gpa, d, vsock_ports, &vsock_irq_ctx);
        if (vsock_bridge_opt == null) vsock_dev_opt = null;
    }
    defer if (vsock_bridge_opt) |b| b.destroy();
    // The vsock_dev pointer may have been cleared above on bridge
    // start failure; re-resolve so the run loop dispatch matches.
    const vsock_dev_ptr_run: ?*virtio.Device = if (vsock_dev_opt) |_| &vsock_dev_opt.? else null;

    // virtio-balloon (#263 phase B). Same as HVF — always present;
    // the guest's free-page-reporting kernel thread feeds the
    // reporting queue continuously, and our backend madvises each
    // reported run out of host RSS.
    //
    // #274: redirect accounting into the shared stats file pointed
    // at by MACHINEN_STATS_FILE; falls back to a process-static stub
    // when missing.
    var stats_inst = stats_mod.Stats.openOrStub();
    defer stats_inst.deinit();
    // No-op on Linux — runtime reads `/proc/<pid>/status:VmRSS`,
    // which is exact and reflects `MADV_DONTNEED` reclaim. See
    // `stats.zig` for the Darwin rationale.
    stats_mod.startPhysFootprintSampler(stats_inst.counters);
    var balloon_backend = balloon_mod.Backend.initWithCounters(stats_inst.counters);
    var balloon_dev = makeBalloonDevice(ram, cfg, &balloon_backend);
    const balloon_dev_ptr: ?*virtio.Device = &balloon_dev;

    // virtio-fs slots 7..10 (#332, #338). Off by default; set
    // MACHINEN_VIRTIOFS_0..3 to serve up to four `--mount-live` shares
    // over the in-VMM virtio-fs transport. The FUSE opcode handlers are
    // the shared #329 handlers — request handling runs synchronously on
    // the vCPU thread (the device drains on each guest kick), so unlike
    // vsock no host poll thread is needed. Same env grammar as HVF (see
    // boot_hvf.zig's parser).
    var virtiofs_backends: [MAX_VIRTIOFS_SLOTS]?virtiofs_mod.Device = parseVirtiofsEnv();
    defer for (&virtiofs_backends) |*b| {
        if (b.*) |*d| d.deinit();
    };
    var virtiofs_devs: [MAX_VIRTIOFS_SLOTS]?virtio.Device = undefined;
    for (0..MAX_VIRTIOFS_SLOTS) |i| {
        virtiofs_devs[i] = if (virtiofs_backends[i]) |*b|
            makeVirtioFsDevice(virtio_virtiofs_bases[i], ram, cfg, b)
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
    // If asked to restore, apply vCPU + RAM from .snaplet before the
    // first vcpu.run(). Topology hash mismatch is a hard error: the
    // wrong layout would scramble guest memory.
    if (cfg.restore_path) |path| {
        applyRestoreFile(gpa, path, &vcpu, ram, cfg, gic.fd, &devs) catch |err| {
            std.debug.print("kvm boot: restore from {s} failed: {s}\n", .{ path, @errorName(err) });
            return err;
        };
        std.debug.print("kvm boot: restored from {s}\n", .{path});
    }
    return try runLoop(gpa, cfg, &vm, &vcpu, &devs, irqs, ram, gic.fd);
}

/// Kernel + DTB bytes loaded off disk plus the parsed kernel header.
/// Owns the two byte buffers; caller invokes `deinit` once boot is
/// done with them (the @memcpy into guest RAM doesn't keep them live).
const LoadedFixtures = struct {
    kernel: []u8,
    dtb: []u8,
    img: KernelImage,

    fn deinit(self: *LoadedFixtures, gpa: std.mem.Allocator) void {
        gpa.free(self.kernel);
        gpa.free(self.dtb);
    }
};

/// Read kernel + DTB off disk, parse the kernel header, and validate
/// they fit in the configured guest RAM. `error.FixtureMissing` is
/// surfaced so callers can `expectError` it cleanly.
fn loadFixtures(gpa: std.mem.Allocator, cfg: Config) !LoadedFixtures {
    const kernel = readAll(gpa, cfg.kernel_path) catch |err| {
        if (err == error.FileNotFound) return error.FixtureMissing;
        return err;
    };
    errdefer gpa.free(kernel);
    assert(kernel.len > 0);

    const dtb = readAll(gpa, cfg.dtb_path) catch |err| {
        if (err == error.FileNotFound) return error.FixtureMissing;
        return err;
    };
    errdefer gpa.free(dtb);
    assert(dtb.len > 0);

    const img = try KernelImage.parse(kernel);
    if (img.text_offset + kernel.len > cfg.ram_size) return error.KernelTooLarge;
    if (cfg.dtb_offset + dtb.len > cfg.ram_size) return error.DtbTooLarge;

    return .{ .kernel = kernel, .dtb = dtb, .img = img };
}

/// Allocate the host-backed slab the guest sees as its RAM, then copy
/// kernel + DTB + (optional) initramfs into it. Returns the mapped
/// slice; caller owns the munmap.
fn allocateAndPopulateRam(
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
    assert(ram.len == cfg.ram_size);
    assert(@intFromPtr(ram.ptr) % 4096 == 0);

    @memcpy(ram[fx.img.text_offset..][0..fx.kernel.len], fx.kernel);
    @memcpy(ram[cfg.dtb_offset..][0..fx.dtb.len], fx.dtb);

    // #263 phase A: rewrite the DTB's `memory@<base>` reg-size cells
    // to match cfg.ram_size. Without this the shipped DTB caps the
    // guest at the DTS-declared 4 GiB regardless of cfg.ram_size.
    dtb_patch.patchMemorySize(ram[cfg.dtb_offset..][0..fx.dtb.len], cfg.ram_size) catch |err| {
        std.debug.print(
            "warn: patchMemorySize failed ({s}); guest will see the DTB-declared ceiling, not cfg.ram_size={d}\n",
            .{ @errorName(err), cfg.ram_size },
        );
    };

    if (cfg.initrd_path) |initrd_path| {
        const initrd = readAll(gpa, initrd_path) catch |err| {
            if (err == error.OpenFailed) return error.FixtureMissing;
            return err;
        };
        defer gpa.free(initrd);
        if (cfg.initrd_offset + initrd.len > cfg.ram_size) return error.DtbTooLarge;
        @memcpy(ram[cfg.initrd_offset..][0..initrd.len], initrd);
        // Mirror boot_hvf.zig: cap the kernel's initramfs scan window
        // to the actual cpio length so we don't burn boot time
        // walking dead tail. Failures here only cost startup latency,
        // so log only with MACHINEN_DEBUG set (the kernel still boots).
        const initrd_end_abs: u32 = @intCast(cfg.ram_base + cfg.initrd_offset + initrd.len);
        dtb_patch.patchInitrdEnd(ram[cfg.dtb_offset..][0..fx.dtb.len], initrd_end_abs) catch {};
    }
    return ram;
}

/// Bring up the vCPU: enable PSCI 0.2 in the init features (so KVM
/// handles HVC #0 in-kernel and surfaces SYSTEM_OFF as
/// KVM_EXIT_SYSTEM_EVENT), then point X0 at the DTB and PC at the
/// kernel entry per the arm64 Linux boot protocol. Caller owns the
/// destroy.
fn initVcpu(vm: *kvm.Vm, img: KernelImage, cfg: Config) !kvm.Vcpu {
    var vcpu = try vm.createVcpu(0);
    errdefer vcpu.destroy();

    var init = try vm.preferredTarget();
    init.features[0] |= (@as(u32, 1) << @as(u5, @intCast(kvm.KVM_ARM_VCPU_PSCI_0_2)));
    // Pointer-auth is enabled on the KVM vCPU ONLY when this boot is a
    // restore. The reasoning is asymmetric:
    //
    //  * Restoring a HVF-sourced snapshot: HVF gave that guest active
    //    FEAT_PAuth (its kernel set SCTLR.EnIA), so RAM holds signed
    //    return addresses. The KVM vCPU must also implement FEAT_PAuth
    //    (with the snapshot's APIAKEY*/APDAKEY*/APGAKEY* restored) or
    //    AUTIASP runs as a NOP, never strips the PAC bits, and the
    //    first `ret` jumps into a mangled address.
    //
    //  * A fresh boot that may later be *snapshotted* (KVM as source):
    //    we deliberately leave FEAT_PAuth off so the guest kernel
    //    never signs pointers. That keeps the resulting .snaplet
    //    portable — a HVF restore can't reconstruct KVM's PAC, and PAC
    //    algorithms aren't compatible across the two hosts.
    //
    // The residual cross-VMM hazard (authenticating a foreign-signed
    // pointer, FPAC) is sidestepped by never programming the GIC CPU
    // interface on a cross-VMM restore: with no delivered interrupts
    // the guest never context-switches, so __switch_to — the kernel's
    // PAC-auth hot spot — never runs.
    if (cfg.restore_path != null) {
        // PTRAUTH_ADDRESS and PTRAUTH_GENERIC must be requested as a
        // pair; if the host KVM lacks the capability VCPU_INIT fails
        // and we fall back to a plain init.
        var init_pac = init;
        init_pac.features[0] |= (@as(u32, 1) << @as(u5, @intCast(kvm.KVM_ARM_VCPU_PTRAUTH_ADDRESS)));
        init_pac.features[0] |= (@as(u32, 1) << @as(u5, @intCast(kvm.KVM_ARM_VCPU_PTRAUTH_GENERIC)));
        vcpu.init(init_pac) catch {
            std.debug.print("kvm boot: pointer-auth unavailable; init without it\n", .{});
            try vcpu.init(init);
        };
    } else {
        try vcpu.init(init);
    }

    const dtb_phys = cfg.ram_base + cfg.dtb_offset;
    const entry_phys = cfg.ram_base + img.text_offset;
    assert(dtb_phys >= cfg.ram_base);
    assert(entry_phys >= cfg.ram_base);
    assert(entry_phys < cfg.ram_base + cfg.ram_size);
    try vcpu.setReg(kvm.REG_X0, dtb_phys);
    try vcpu.setReg(kvm.REG_X1, 0);
    try vcpu.setReg(kvm.REG_X2, 0);
    try vcpu.setReg(kvm.REG_X3, 0);
    try vcpu.setReg(kvm.REG_PC, entry_phys);

    return vcpu;
}

/// Build the virtio-net device. virtio-net sits in slot 0 with a
/// stable MAC the runtime hands the gvproxy DHCP server. tx_handler /
/// tx_ctx are wired later, after the gvproxy connect.
fn makeNetDevice(ram: []u8, cfg: Config, mac: *const [6]u8) virtio.Device {
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
fn openBlkBackend(path: ?[]const u8, label: []const u8) ?blk_mod.Backend {
    const p = path orelse return null;
    return blk_mod.openFile(p) catch |err| {
        std.debug.print("virtio-blk {s} disabled: {s} ({s})\n", .{ label, @errorName(err), p });
        return null;
    };
}

/// Wrap a runtime-passed fd as a virtio-blk backend (#272). Mirror
/// of boot_hvf.zig's matching helper — see that file for the design.
fn openBlkBackendFromFd(fd: ?c_int, read_only: bool, label: []const u8) ?blk_mod.Backend {
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
    return blk_mod.Backend.initFromFdWithMode(f, @intCast(size_bytes), read_only);
}

/// Wrap a `blk_mod.Backend` as a virtio-mmio device. `backend` must
/// outlive the returned device — the device's `config` and
/// `request_ctx` are pointers into it.
fn makeBlkDevice(base: u64, size: u64, ram: []u8, cfg: Config, backend: *blk_mod.Backend) virtio.Device {
    return .{
        .base = base,
        .size = size,
        .id = .block,
        .features = (1 << 32), // VIRTIO_F_VERSION_1
        .config = std.mem.asBytes(&backend.config),
        .ram = ram,
        .ram_base = cfg.ram_base,
        .request_handler = &blk_mod.Backend.handleRequest,
        .request_ctx = @ptrCast(backend),
    };
}

/// Variant of `makeBlkDevice` that advertises VIRTIO_BLK_F_DISCARD
/// in the feature bits (#272). Mirror of boot_hvf.zig's helper.
fn makeBlkDeviceWithDiscard(base: u64, size: u64, ram: []u8, cfg: Config, backend: *blk_mod.Backend) virtio.Device {
    return .{
        .base = base,
        .size = size,
        .id = .block,
        .features = (1 << 32) | (@as(u64, 1) << blk_mod.VIRTIO_BLK_F_DISCARD),
        .config = std.mem.asBytes(&backend.config),
        .ram = ram,
        .ram_base = cfg.ram_base,
        .request_handler = &blk_mod.Backend.handleRequest,
        .request_ctx = @ptrCast(backend),
    };
}

/// Parse `MACHINEN_VSOCK` into a port-map list. Empty/missing returns
/// an empty slice; parse errors log and return empty so a typo in the
/// env doesn't prevent boot. Returned slice + path strings allocated
/// from `gpa`.
fn parseVsockEnv(gpa: std.mem.Allocator) []vsock_mod.PortMap {
    const raw = getenv("MACHINEN_VSOCK") orelse return &.{};
    const s = std.mem.span(raw);
    if (s.len == 0) return &.{};
    return vsock_mod.parseEnv(gpa, s) catch |err| {
        std.debug.print("vsock: MACHINEN_VSOCK parse failed ({s}); ignoring\n", .{@errorName(err)});
        return &.{};
    };
}

/// Build the virtio-vsock device. `cid_ptr` must outlive the device —
/// the config field is a pointer into it.
fn makeVsockDevice(ram: []u8, cfg: Config, cid_ptr: *const u64) virtio.Device {
    return .{
        .base = virtio_vsock_base,
        .size = virtio_vsock_size,
        .id = .vsock,
        .features = (1 << 32), // VIRTIO_F_VERSION_1
        .config = std.mem.asBytes(cid_ptr),
        .ram = ram,
        .ram_base = cfg.ram_base,
        .request_handler = &vsock_mod.Bridge.handleTxChain,
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
fn parseVirtiofsEnv() [MAX_VIRTIOFS_SLOTS]?virtiofs_mod.Device {
    var out: [MAX_VIRTIOFS_SLOTS]?virtiofs_mod.Device = @splat(null);
    for (0..MAX_VIRTIOFS_SLOTS) |i| {
        var name_buf: [32]u8 = undefined;
        const name = std.fmt.bufPrintZ(&name_buf, "MACHINEN_VIRTIOFS_{d}", .{i}) catch continue;
        out[i] = parseOneVirtiofsEnv(name);
    }
    return out;
}

/// Parse a single `MACHINEN_VIRTIOFS_<i>` env var into a backend, or
/// null if unset / malformed. See `parseVirtiofsEnv`.
fn parseOneVirtiofsEnv(name: [*:0]const u8) ?virtiofs_mod.Device {
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
fn makeVirtioFsDevice(base: u64, ram: []u8, cfg: Config, backend: *virtiofs_mod.Device) virtio.Device {
    return .{
        .base = base,
        .size = virtio_virtiofs_size,
        .id = .virtio_fs,
        .features = (1 << 32), // VIRTIO_F_VERSION_1
        .config = backend.configBytes(),
        .ram = ram,
        .ram_base = cfg.ram_base,
        .request_handler = &virtiofs_mod.Device.handleRequest,
        .request_ctx = @ptrCast(backend),
    };
}

/// Build the virtio-balloon device. `backend` must outlive the
/// returned Device — config + request_ctx are pointers into it.
/// #263 phase B: continuous free-page reporting.
fn makeBalloonDevice(ram: []u8, cfg: Config, backend: *balloon_mod.Backend) virtio.Device {
    return .{
        .base = virtio_balloon_base,
        .size = virtio_balloon_size,
        .id = .balloon,
        .features = balloon_mod.Backend.features(),
        .config = backend.configBytes(),
        .ram = ram,
        .ram_base = cfg.ram_base,
        .request_handler = &balloon_mod.Backend.handleRequest,
        .request_ctx = @ptrCast(backend),
    };
}

/// Dial gvproxy if `MACHINEN_NET_SOCKET` is set; null on missing env
/// or any connect failure (the rest of the VMM still runs without
/// network).
fn connectGvproxy(gpa: std.mem.Allocator, netdev: *virtio.Device) ?*net_mod.NetSocket {
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
fn startVsockBridge(
    gpa: std.mem.Allocator,
    dev: *virtio.Device,
    ports: []const vsock_mod.PortMap,
    irq_ctx: *VsockIrqCtx,
) ?*vsock_mod.Bridge {
    const bridge = vsock_mod.Bridge.create(gpa, dev, .{
        .ports = ports,
        .raise_irq = &onVsockIrq,
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

fn sigusr1Handler(sig: c_int) callconv(.c) void {
    _ = sig;
    snapshot_requested.store(true, .seq_cst);
}

fn installSnapshotSignal() void {
    const c = struct {
        extern "c" fn signal(sig: c_int, handler: usize) usize;
    };
    const SIGUSR1: c_int = 10;
    _ = c.signal(SIGUSR1, @intFromPtr(&sigusr1Handler));
}

/// Drive the vCPU until PSCI SYSTEM_OFF, an unhandled exit, the
/// configured serial-capture threshold, `max_exits`, or a
/// SIGUSR1-triggered snapshot.
fn runLoop(
    gpa: std.mem.Allocator,
    cfg: Config,
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    devs: *const Devices,
    irqs: IrqMap,
    ram: []u8,
    gic_fd: c_int,
) !Result {
    var exits: usize = 0;
    var saw_off = false;
    var snapshotted = false;
    while (exits < cfg.max_exits) : (exits += 1) {
        const reason = try vcpu.run();
        switch (reason) {
            .mmio => {
                const ev = vcpu.mmioExit();
                try routeMmio(vm, vcpu, devs, irqs, ev);
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
        if (!cfg.unbounded_serial and devs.uart.captured_len >= cfg.capture_bytes) break;
        // Snapshot trigger: SIGUSR1 set the flag. Write the whole-VM
        // state to cfg.snapshot_path and RESUME — destructiveness is
        // the snapshot engine's call (`performSnapshotSnaplet` powers
        // the source off for a plain `snapshot`, leaves it running for
        // `fork`). The SIGUSR1 handler stays installed so a later
        // signal (chained snapshot / fork-the-fork) triggers another.
        if (snapshot_requested.load(.seq_cst)) {
            if (cfg.snapshot_path) |path| {
                writeSnapshotFile(gpa, path, vcpu, ram, cfg, gic_fd, devs) catch |err| {
                    std.debug.print("kvm boot: snapshot write failed: {s}\n", .{@errorName(err)});
                };
                snapshotted = true;
                snapshot_requested.store(false, .seq_cst);
            }
        }
    }

    if (exits >= cfg.max_exits) {
        std.debug.print(
            "kvm boot: RanTooLong after {d} exits. Captured serial ({d} bytes):\n{s}\n",
            .{ exits, devs.uart.captured_len, devs.uart.capturedBytes() },
        );
        return error.RanTooLong;
    }

    const serial = try gpa.dupe(u8, devs.uart.capturedBytes());
    return .{
        .serial = serial,
        .saw_psci_shutdown = saw_off,
        .exits = exits,
        .snapshotted = snapshotted,
    };
}

const snap_c = struct {
    extern "c" fn open(path: [*:0]const u8, flags: c_int, mode: c_int) c_int;
    extern "c" fn close(fd: c_int) c_int;
    extern "c" fn write(fd: c_int, buf: *const anyopaque, count: usize) isize;
    extern "c" fn read(fd: c_int, buf: *anyopaque, count: usize) isize;
    extern "c" fn lseek(fd: c_int, offset: i64, whence: c_int) i64;
    extern "c" fn chmod(path: [*:0]const u8, mode: c_int) c_int;
    extern "c" fn rename(old: [*:0]const u8, new: [*:0]const u8) c_int;
};

// O_RDONLY=0, O_WRONLY=1, O_RDWR=2, O_CREAT=64 (Linux) / 0x200 (macOS)
// O_TRUNC=512 (Linux) / 0x400 (macOS). We bake target-specific flags
// at comptime instead of dragging libc headers in.
const O_RDONLY: c_int = 0;
const O_WRONLY: c_int = 1;
const O_CREAT: c_int = if (@import("builtin").os.tag == .macos) 0x200 else 64;
const O_TRUNC: c_int = if (@import("builtin").os.tag == .macos) 0x400 else 512;
const SEEK_END: c_int = 2;
const SEEK_SET: c_int = 0;

/// KVM register ID for a 64-bit AArch64 system register, given its
/// 16-bit op0/op1/CRn/CRm/op2 encoding.
/// REG_ARM64 | SIZE_U64 | ARM64_SYSREG(0x0013_0000) | encoding.
fn kvmSysregId(enc: u16) u64 {
    return 0x6030_0000_0013_0000 | @as(u64, enc);
}

/// KVM register ID for MPIDR_EL1 (op0=3,op1=0,CRn=0,CRm=0,op2=5).
const KVM_REG_MPIDR_EL1: u64 = 0x6030_0000_0013_C005;

fn kvmVcpuMpidr(vcpu: *kvm.Vcpu) u64 {
    return vcpu.getReg(KVM_REG_MPIDR_EL1) catch 0;
}

fn writeSnapshotFile(
    gpa: std.mem.Allocator,
    path: []const u8,
    vcpu: *kvm.Vcpu,
    ram: []const u8,
    cfg: Config,
    gic_fd: c_int,
    devs: *const Devices,
) !void {
    const snapshot = @import("snapshot.zig");
    const vcpu_dump = @import("vcpu_dump.zig");
    const ram_dump = @import("ram_dump.zig");
    const gic_state = @import("gic_state.zig");
    const virtio_dump = @import("virtio_dump.zig");
    const topology = @import("topology.zig");

    const vcpu_payload = try vcpu_dump.dumpKvm(gpa, vcpu.fd);
    defer gpa.free(vcpu_payload);
    const ram_payload = try ram_dump.encode(gpa, cfg.ram_base, ram);
    defer gpa.free(ram_payload);
    // GICv3 distributor + per-vCPU redistributor + CPU interface —
    // see the matching block in boot_hvf.zig for why a cross-VMM
    // restore can't resume without it.
    const mpidr = kvmVcpuMpidr(vcpu);
    const gic_dist_payload = try gic_state.dumpKvmDist(gpa, gic_fd);
    defer gpa.free(gic_dist_payload);
    const gic_redist_payload = try gic_state.dumpKvmRedist(gpa, gic_fd, mpidr);
    defer gpa.free(gic_redist_payload);
    const gic_cpuif_payload = try gic_state.dumpKvmCpuIf(gpa, gic_fd, mpidr);
    defer gpa.free(gic_cpuif_payload);

    const topo: topology.Topology = .{
        .ram_base = cfg.ram_base,
        .ram_size = cfg.ram_size,
        .gic_dist_base = cfg.gic_dist_addr,
        .gic_redist_base = cfg.gic_redist_addr,
    };

    // One `.virtio` section per present device (section `id` = the
    // device's MMIO base). See boot_hvf.zig's matching block for why
    // a restored guest's virtio drivers need this.
    var vbufs: [Devices.virtio_max]*virtio.Device = undefined;
    const vdevs = devs.virtioDevices(&vbufs);
    var varena = std.heap.ArenaAllocator.init(gpa);
    defer varena.deinit();

    var sections = std.ArrayList(snapshot.Section).empty;
    defer sections.deinit(gpa);
    try sections.append(gpa, .{ .tag = .vcpu, .id = 0, .payload = vcpu_payload });
    try sections.append(gpa, .{ .tag = .ram, .id = 0, .payload = ram_payload });
    try sections.append(gpa, .{ .tag = .gic_dist, .id = 0, .payload = gic_dist_payload });
    try sections.append(gpa, .{ .tag = .gic_redist, .id = 0, .payload = gic_redist_payload });
    try sections.append(gpa, .{ .tag = .gic_cpuif, .id = 0, .payload = gic_cpuif_payload });
    for (vdevs) |d| {
        const vp = try virtio_dump.dumpDevice(varena.allocator(), d);
        try sections.append(gpa, .{ .tag = .virtio, .id = @truncate(d.base), .payload = vp });
    }

    const bytes = try snapshot.encode(gpa, topo.hash(), sections.items);
    defer gpa.free(bytes);
    // gzip the whole container — guest RAM is mostly zero pages, so
    // this routinely shrinks the .snaplet by an order of magnitude.
    const out = try @import("snaplet_zip.zig").compress(gpa, bytes);
    defer gpa.free(out);
    std.debug.print("kvm: snapshot {d} bytes -> {d} compressed\n", .{ bytes.len, out.len });

    // Write atomically: dump into `<path>.tmp`, then rename() onto the
    // final path. The runtime's `performSnapshotSnaplet` polls for the
    // final path's existence as the "dump complete" signal, so a
    // partially-written file must never be observable there.
    const path_z = try gpa.dupeZ(u8, path);
    defer gpa.free(path_z);
    const tmp_z = try std.fmt.allocPrintSentinel(gpa, "{s}.tmp", .{path}, 0);
    defer gpa.free(tmp_z);
    const fd = snap_c.open(tmp_z, O_WRONLY | O_CREAT | O_TRUNC, 0o644);
    if (fd < 0) return error.OpenFailed;
    {
        defer _ = snap_c.close(fd);
        var off: usize = 0;
        while (off < out.len) {
            const rc = snap_c.write(fd, out.ptr + off, out.len - off);
            if (rc <= 0) return error.WriteFailed;
            off += @intCast(rc);
        }
    }
    _ = snap_c.chmod(tmp_z, 0o644);
    if (snap_c.rename(tmp_z, path_z) != 0) return error.WriteFailed;
}

fn applyRestoreFile(
    gpa: std.mem.Allocator,
    path: []const u8,
    vcpu: *kvm.Vcpu,
    ram: []u8,
    cfg: Config,
    gic_fd: c_int,
    devs: *const Devices,
) !void {
    const snapshot = @import("snapshot.zig");
    const vcpu_dump = @import("vcpu_dump.zig");
    const ram_dump = @import("ram_dump.zig");
    const gic_state = @import("gic_state.zig");
    const virtio_dump = @import("virtio_dump.zig");
    const topology = @import("topology.zig");

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
    var off: usize = 0;
    while (off < raw.len) {
        const rc = snap_c.read(fd, raw.ptr + off, raw.len - off);
        if (rc <= 0) return error.ReadFailed;
        off += @intCast(rc);
    }
    // gunzip if the file is compressed; a plain .snaplet passes through.
    const bytes = try @import("snaplet_zip.zig").decompress(gpa, raw);
    defer gpa.free(bytes);

    var snap = try snapshot.decode(gpa, bytes);
    defer snap.deinit();

    const topo: topology.Topology = .{
        .ram_base = cfg.ram_base,
        .ram_size = cfg.ram_size,
        .gic_dist_base = cfg.gic_dist_addr,
        .gic_redist_base = cfg.gic_redist_addr,
    };
    if (!std.mem.eql(u8, &topo.hash(), &snap.header.topology_hash)) {
        return error.TopologyMismatch;
    }

    const mpidr = kvmVcpuMpidr(vcpu);

    // GIC state is only applied when the snapshot carries a *complete*
    // picture: distributor + redistributor + a populated CPU-interface
    // (ICC_*) section. That is only ever true for a KVM-sourced
    // snapshot — HVF's hv_sys_reg_t doesn't expose ICC_*, so a
    // HVF-sourced snapshot's gic_cpuif section is empty.
    //
    // Applying the distributor/redistributor *without* a consistent
    // CPU interface is actively harmful: enabled+pending interrupts in
    // the (re)distributor with a mismatched CPU interface send the
    // vtimer PPI into a permanent storm that pins the vCPU at 100%
    // with zero forward progress. So for a HVF-sourced snapshot we
    // skip the GIC sections entirely and let the destination's clean
    // reset GIC stand — the resumed guest runs without delivered
    // interrupts, which is correct for the deterministic compute
    // harness and an honest reflection of the HVF API limitation.
    var apply_gic = false;
    for (snap.sections) |s| {
        // An empty gic_cpuif payload is exactly the 4-byte entry count.
        if (s.tag == .gic_cpuif and s.payload.len > 4) apply_gic = true;
    }

    var vbufs: [Devices.virtio_max]*virtio.Device = undefined;
    const vdevs = devs.virtioDevices(&vbufs);
    var cpuif_applied: usize = 0;
    for (snap.sections) |s| {
        switch (s.tag) {
            .vcpu => try vcpu_dump.loadKvm(gpa, vcpu.fd, s.payload),
            .ram => {
                const d = try ram_dump.decode(s.payload);
                if (d.ram.len > ram.len) return error.RamTooLarge;
                @memcpy(ram[0..d.ram.len], d.ram);
            },
            .gic_dist => if (apply_gic) try gic_state.loadKvmDist(gpa, gic_fd, s.payload),
            .gic_redist => if (apply_gic) try gic_state.loadKvmRedist(gpa, gic_fd, mpidr, s.payload),
            .gic_cpuif => if (apply_gic) {
                cpuif_applied = gic_state.loadKvmCpuIf(gpa, gic_fd, mpidr, s.payload) catch 0;
            },
            // Restore each virtio device's transport state onto the
            // matching freshly-created device (matched by MMIO base,
            // stored in the section `id`).
            .virtio => {
                for (vdevs) |d| {
                    if (@as(u32, @truncate(d.base)) == s.id) {
                        virtio_dump.applyDevice(gpa, d, s.payload) catch |err| {
                            std.debug.print(
                                "kvm boot: virtio restore for base 0x{x} failed: {s}\n",
                                .{ d.base, @errorName(err) },
                            );
                        };
                        break;
                    }
                }
            },
            else => {},
        }
    }
    std.debug.print(
        "kvm boot: GIC sections {s} (cpuif entries present={})\n",
        .{ if (apply_gic) "applied" else "skipped (HVF-sourced)", apply_gic },
    );

    // Virtual-timer fixup. The dump tags the guest comparator as
    // "CNTV_CVAL_EL0", whose sysreg encoding (S3_3_C14_C3_2 = 0xDF1A)
    // is bit-identical to KVM_REG_ARM_TIMER_CNT — so loadKvm above
    // actually wrote it into the guest's virtual *counter*, not the
    // comparator. KVM's separate KVM_REG_ARM_TIMER_CVAL carries the
    // *other* colliding encoding (S3_3_C14_C0_2 = 0xDF02, nominally
    // CNTVCT_EL0), and nothing in the dump touches it — so the real
    // comparator keeps KVM's reset value. Once the GIC CPU interface
    // is live (it now is), a stale comparator means CNTVCT >= CNTV_CVAL
    // holds forever and the vtimer PPI storms, pinning the vCPU at
    // 100% with zero forward progress. Mirror what loadKvm parked in
    // the counter into the comparator so CNTVCT and CNTV_CVAL line up:
    // one clean tick on resume, then normal cadence.
    const KVM_REG_ARM_TIMER_CNT = kvmSysregId(0xDF1A);
    const KVM_REG_ARM_TIMER_CVAL = kvmSysregId(0xDF02);
    const guest_cval = vcpu.getReg(KVM_REG_ARM_TIMER_CNT) catch 0;
    if (guest_cval != 0) {
        vcpu.setReg(KVM_REG_ARM_TIMER_CVAL, guest_cval) catch |err| {
            std.debug.print("kvm boot: timer comparator fixup failed: {s}\n", .{@errorName(err)});
        };
    }

    // Restore diagnostics — the cheapest signal for a guest that
    // won't resume. PC/PSTATE should match the snapshot's EL/PC; a
    // zeroed TTBR or cleared SCTLR.M means the MMU sysregs didn't
    // stick and EL0 will instruction-abort on the first fetch.
    const pc = vcpu.getReg(kvm.REG_PC) catch 0;
    const pstate = vcpu.getReg(kvm.REG_PSTATE) catch 0;
    const sctlr = vcpu.getReg(kvmSysregId(0xC080)) catch 0;
    const ttbr0 = vcpu.getReg(kvmSysregId(0xC100)) catch 0;
    const ttbr1 = vcpu.getReg(kvmSysregId(0xC101)) catch 0;
    std.debug.print(
        "kvm boot: restore readback PC=0x{x} PSTATE=0x{x} SCTLR_EL1=0x{x} TTBR0=0x{x} TTBR1=0x{x} cpuif_regs={d} timer_cval=0x{x}\n",
        .{ pc, pstate, sctlr, ttbr0, ttbr1, cpuif_applied, guest_cval },
    );
}

/// SPI ids encoded for KVM_IRQ_LINE (with KVM_ARM_IRQ_TYPE_SPI in
/// bits 27:24). Layout must stay byte-identical to virt.dts. Unlike
/// HVF, the encoding is fixed — there is no host-supplied SPI base.
const IrqMap = struct {
    pl011: u32,
    net: u32,
    blk: u32,
    blk2: u32,
    vsock: u32,
    balloon: u32,
    blk3: u32,
    blk4: u32,
    /// One per virtio-fs slot (DTS offsets 23..23+MAX_VIRTIOFS_SLOTS-1).
    virtiofs: [MAX_VIRTIOFS_SLOTS]u32,

    fn init() IrqMap {
        var virtiofs_irqs: [MAX_VIRTIOFS_SLOTS]u32 = undefined;
        for (0..MAX_VIRTIOFS_SLOTS) |i| {
            virtiofs_irqs[i] = kvm.irqSpi(23 + @as(u32, @intCast(i)));
        }
        return .{
            .pl011 = kvm.irqSpi(1),
            .net = kvm.irqSpi(16),
            .blk = kvm.irqSpi(17),
            .vsock = kvm.irqSpi(18),
            .blk2 = kvm.irqSpi(19),
            .balloon = kvm.irqSpi(20),
            .blk3 = kvm.irqSpi(21),
            .blk4 = kvm.irqSpi(22),
            .virtiofs = virtiofs_irqs,
        };
    }
};

/// Owning handles for everything the run loop needs to dispatch MMIO
/// against. `net_inst` is included separately from `netdev` so the
/// MMIO path can take its `irq_mu` even when the device is wired but
/// no gvproxy backend connected.
const Devices = struct {
    uart: *pl011_mod.Pl011,
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

    /// Upper bound on virtio devices: net + 4 blk slots + vsock + balloon.
    pub const virtio_max = 7;

    /// Collect every present virtio device into `buf`, returning the
    /// populated prefix. Used by snapshot/restore to dump/apply each
    /// device's transport state.
    pub fn virtioDevices(self: *const Devices, buf: *[virtio_max]*virtio.Device) []*virtio.Device {
        var n: usize = 0;
        buf[n] = self.netdev;
        n += 1;
        for ([_]?*virtio.Device{
            self.blk_dev, self.blk2_dev, self.blk3_dev, self.blk4_dev,
            self.vsock_dev, self.balloon_dev,
        }) |maybe| {
            if (maybe) |d| {
                buf[n] = d;
                n += 1;
            }
        }
        return buf[0..n];
    }
};

/// A virtio-fs slot whose MMIO window owns a phys addr, paired with IRQ.
const VirtiofsMatch = struct { dev: *virtio.Device, irq: u32 };

/// Find the virtio-fs slot (if any) whose MMIO window owns `phys_addr`.
fn virtiofsMatch(devs: *const Devices, irqs: IrqMap, phys_addr: u64) ?VirtiofsMatch {
    for (devs.virtiofs_devs, irqs.virtiofs) |dev_opt, irq| {
        if (dev_opt) |d| {
            if (d.handles(phys_addr)) return .{ .dev = d, .irq = irq };
        }
    }
    return null;
}

/// PL011 MMIO. Console-byte writes echo to host stderr; every access
/// resyncs the SPI line based on `irqAsserted()`.
fn handlePl011Mmio(
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    uart: *pl011_mod.Pl011,
    ev: kvm.MmioExit,
    irq: u32,
) !void {
    assert(uart.handles(ev.phys_addr));
    if (ev.is_write != 0) {
        const val = mmioReadValue(ev);
        uart.write(ev.phys_addr, val);
        if ((ev.phys_addr - uart.base) == 0 and ev.len > 0) {
            const byte: [1]u8 = .{ev.data[0]};
            _ = hostWrite(2, &byte, 1);
        }
    } else {
        vcpu.writeMmioReadData(uart.read(ev.phys_addr), ev.len);
    }
    vm.setIrq(irq, if (uart.irqAsserted()) 1 else 0) catch {};
}

/// virtio-MMIO read/write + raise/lower the SPI based on the device's
/// post-access interrupt_status. Shared shape across net / blk / blk2 /
/// vsock; the callers that need cross-thread serialisation take the
/// appropriate mutex around this call.
fn handleVirtioMmio(
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    dev: *virtio.Device,
    irq: u32,
    ev: kvm.MmioExit,
) !void {
    assert(dev.handles(ev.phys_addr));
    assert(irq >> kvm.KVM_ARM_IRQ_TYPE_SHIFT == kvm.KVM_ARM_IRQ_TYPE_SPI);
    if (ev.is_write != 0) {
        dev.write(ev.phys_addr, mmioReadValue(ev));
    } else {
        vcpu.writeMmioReadData(dev.read(ev.phys_addr), ev.len);
    }
    vm.setIrq(irq, if (@atomicLoad(u32, &dev.interrupt_status, .acquire) != 0) 1 else 0) catch {};
}

/// Route an MMIO exit to the device that owns the IPA. Each cross-
/// thread arm wraps `handleVirtioMmio` in the appropriate mutex.
fn routeMmio(
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
        try handlePl011Mmio(vm, vcpu, devs.uart, ev, irqs.pl011);
        return;
    }
    if (devs.netdev.handles(ev.phys_addr)) {
        try dispatchNetMmio(vm, vcpu, devs, irqs, ev);
        return;
    }
    if (devs.blk_dev) |d| if (d.handles(ev.phys_addr)) {
        try handleVirtioMmio(vm, vcpu, d, irqs.blk, ev);
        return;
    };
    if (devs.blk2_dev) |d| if (d.handles(ev.phys_addr)) {
        try handleVirtioMmio(vm, vcpu, d, irqs.blk2, ev);
        return;
    };
    if (devs.blk3_dev) |d| if (d.handles(ev.phys_addr)) {
        try handleVirtioMmio(vm, vcpu, d, irqs.blk3, ev);
        return;
    };
    if (devs.blk4_dev) |d| if (d.handles(ev.phys_addr)) {
        try handleVirtioMmio(vm, vcpu, d, irqs.blk4, ev);
        return;
    };
    if (devs.vsock_dev) |d| if (d.handles(ev.phys_addr)) {
        try dispatchVsockMmio(vm, vcpu, devs, d, irqs.vsock, ev);
        return;
    };
    if (devs.balloon_dev) |d| if (d.handles(ev.phys_addr)) {
        try handleVirtioMmio(vm, vcpu, d, irqs.balloon, ev);
        return;
    };
    if (virtiofsMatch(devs, irqs, ev.phys_addr)) |m| {
        // virtio-fs request handling is synchronous on the vCPU thread
        // (`handleVirtioMmio` → `dev.write` → `notify` drains the chain
        // inline through `virtiofs.Device.handleRequest`). No second
        // thread, so no mutex to take — unlike net / vsock.
        try handleVirtioMmio(vm, vcpu, m.dev, m.irq, ev);
        return;
    }
    // Other MMIO (DTB-described regions we haven't hooked up) — for
    // reads, hand back zeros (the writeMmioReadData default on
    // untouched kvm_run bytes is already zero, but be explicit so a
    // future non-zero lingerer doesn't bite).
    if (ev.is_write == 0) vcpu.writeMmioReadData(0, ev.len);
}

/// Run a virtio-net MMIO event under `net_inst.irq_mu`. The RX thread
/// inside NetSocket sets interrupt_status and asserts the SPI line
/// under `irq_mu`; we take the same mutex so our snapshot-based setIrq
/// can't override the bridge's. No-op when `net_inst` is null (no
/// gvproxy backend) — there is no second thread to race against, and
/// the kernel still sees a valid virtio-net device with link-down.
fn dispatchNetMmio(
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    devs: *const Devices,
    irqs: IrqMap,
    ev: kvm.MmioExit,
) !void {
    if (devs.net_inst) |n| n.lockIrq();
    defer if (devs.net_inst) |n| n.unlockIrq();
    try handleVirtioMmio(vm, vcpu, devs.netdev, irqs.net, ev);
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
fn dispatchVsockMmio(
    vm: *kvm.Vm,
    vcpu: *kvm.Vcpu,
    devs: *const Devices,
    dev: *virtio.Device,
    irq: u32,
    ev: kvm.MmioExit,
) !void {
    if (devs.vsock_bridge) |b| b.mu.lock();
    defer if (devs.vsock_bridge) |b| b.mu.unlock();
    try handleVirtioMmio(vm, vcpu, dev, irq, ev);
}

/// Pack the up-to-8 little-endian bytes KVM hands us in `mmio.data`
/// into a u64 the device handlers expect.
fn mmioReadValue(ev: kvm.MmioExit) u64 {
    assert(ev.len >= 1 and ev.len <= 8);
    var val: u64 = 0;
    const n = @min(@as(usize, ev.len), 8);
    assert(n >= 1 and n <= 8);
    for (0..n) |i| {
        val |= @as(u64, ev.data[i]) << @as(u6, @intCast(i * 8));
    }
    return val;
}

fn readAll(gpa: std.mem.Allocator, path: []const u8) ![]u8 {
    assert(path.len > 0);
    var path_buf: [4096]u8 = undefined;
    if (path.len >= path_buf.len) return error.NameTooLong;
    @memcpy(path_buf[0..path.len], path);
    path_buf[path.len] = 0;
    const path_z: [*:0]const u8 = @ptrCast(&path_buf);

    const fd = hostOpen(path_z, 0, 0);
    if (fd < 0) return error.OpenFailed;
    assert(fd >= 0);
    defer _ = hostClose(fd);

    const size_signed = hostLseek(fd, 0, 2);
    if (size_signed < 0) return error.SeekFailed;
    _ = hostLseek(fd, 0, 0);
    const size_bytes: usize = @intCast(size_signed);
    assert(size_bytes > 0);

    const buf = try gpa.alloc(u8, size_bytes);
    errdefer gpa.free(buf);
    var total_bytes: usize = 0;
    while (total_bytes < size_bytes) {
        const n_bytes = hostRead(fd, buf[total_bytes..].ptr, size_bytes - total_bytes);
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
    assert(ctx != null);
    const c: *VsockIrqCtx = @ptrCast(@alignCast(ctx.?));
    assert(c.irq >> kvm.KVM_ARM_IRQ_TYPE_SHIFT == kvm.KVM_ARM_IRQ_TYPE_SPI);
    c.vm.setIrq(c.irq, 1) catch {};
}

/// Same shape as VsockIrqCtx, but for the virtio-net SPI. NetSocket's
/// rxLoop calls `onNetIrq` after each frame it injects, with
/// `n.irq_mu` already held — we just pulse the line.
pub const NetIrqCtx = struct {
    vm: *kvm.Vm,
    irq: u32,
};

fn onNetIrq(ctx: ?*anyopaque) void {
    assert(ctx != null);
    const c: *NetIrqCtx = @ptrCast(@alignCast(ctx.?));
    assert(c.irq >> kvm.KVM_ARM_IRQ_TYPE_SHIFT == kvm.KVM_ARM_IRQ_TYPE_SPI);
    c.vm.setIrq(c.irq, 1) catch {};
}

/// Pump a guest-emitted ethernet frame through to gvproxy. Called
/// from `virtio.Device.notify()` on the vCPU thread when the kernel
/// kicks the TX queue. The 12-byte virtio-net header has already
/// been stripped by `walkAndEmit`, so we just hand the bare ethernet
/// frame to NetSocket.input which prepends the 4-byte length prefix
/// and writes to the gvproxy UDS.
fn onNetTx(ctx: ?*anyopaque, frame: []const u8) void {
    assert(ctx != null);
    assert(frame.len > 0);
    const n: *net_mod.NetSocket = @ptrCast(@alignCast(ctx.?));
    n.input(frame);
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
        assert(bytes.len > 0);
        if (bytes.len < 64) return error.TooSmall;
        assert(bytes.len >= 0x40);
        const got_magic = std.mem.readInt(u32, bytes[0x38..0x3C], .little);
        if (got_magic != magic) return error.BadMagic;
        const text_offset = std.mem.readInt(u64, bytes[0x08..0x10], .little);
        const image_size = std.mem.readInt(u64, bytes[0x10..0x18], .little);
        return .{
            .text_offset = text_offset,
            .image_size = image_size,
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
