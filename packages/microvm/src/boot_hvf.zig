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

const assert = std.debug.assert;

comptime {
    if (builtin.os.tag != .macos) {
        @compileError("boot_hvf.zig only builds on macOS (uses HVF)");
    }
}

const hvf = @import("hvf.zig");
const virtio = @import("virtio.zig");
const net_mod = @import("net_socket.zig");
const blk_mod = @import("blk.zig");
const vsock_mod = @import("vsock.zig");
const balloon_mod = @import("balloon.zig");
const stats_mod = @import("stats.zig");
const dtb_patch = @import("dtb_patch.zig");

// Guest-physical bases. Each virtio-MMIO device lives in a 0x200
// window. The DTS has 32 slots at 0x0A000000 + i*0x200; we wire up
// the first seven.
//
// Slot 0 = net, slot 1 = blk (rootdisk), slot 2 = vsock,
// slot 3 = blk2 (scratch / CRIU disk), slot 4 = balloon,
// slot 5 = blk3 (mount lower / squashfs RO),
// slot 6 = blk4 (mount upper / ext4 RW).
//
// When all four blk slots are populated the kernel sees them in DTB
// order, so slot 1 = /dev/vda (rootfs), slot 3 = /dev/vdb (scratch),
// slot 5 = /dev/vdc (mount lower), slot 6 = /dev/vdd (mount upper).
// Linux assigns names by probe order, so absent slots shift letters
// down. See #114 (rootdisk) and #272 (mount overlay).
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

comptime {
    // virtio-mmio slot layout — must stay byte-identical to virt.dts
    // and to boot_kvm.zig's matching constants. Drift here means the
    // kernel probes the wrong window and devices never bind.
    assert(virtio_net_size == 0x200);
    assert(virtio_blk_size == 0x200);
    assert(virtio_vsock_size == 0x200);
    assert(virtio_blk2_size == 0x200);
    assert(virtio_blk_base == virtio_net_base + virtio_net_size);
    assert(virtio_vsock_base == virtio_blk_base + virtio_blk_size);
    assert(virtio_blk2_base == virtio_vsock_base + virtio_vsock_size);
    assert(virtio_balloon_size == 0x200);
    assert(virtio_balloon_base == virtio_blk2_base + virtio_blk2_size);
    assert(virtio_blk3_size == 0x200);
    assert(virtio_blk3_base == virtio_balloon_base + virtio_balloon_size);
    assert(virtio_blk4_size == 0x200);
    assert(virtio_blk4_base == virtio_blk3_base + virtio_blk3_size);
}

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
    initrd_path: ?[]const u8 = null,
    /// Optional path to a host file backing the rootdisk. When set,
    /// it lands on slot 1 (DTS `virtio_mmio@a000200`) and the kernel
    /// sees it as `/dev/vda`. The runtime mounts it as the rootfs and
    /// switch_roots into it (see init.zig + #114).
    rootdisk_path: ?[]const u8 = null,
    /// Optional path to a host file backing the scratch disk. With
    /// rootdisk_path set, this lands on slot 3 and the kernel names
    /// it `/dev/vdb`. With no rootdisk it lands on slot 1 and the
    /// kernel names it `/dev/vda` (legacy, pre-#114 layout).
    disk_path: ?[]const u8 = null,
    /// #272: pre-opened fd backing the squashfs RO lower for the
    /// `--mount` payload. The runtime opens the host file `O_RDONLY`
    /// (so the content-addressed cache file can never be corrupted
    /// by a buggy guest) and inherits the fd through `posix_spawn`.
    /// When set, lands on slot 5 → /dev/vdc.
    mountdisk_lower_fd: ?c_int = null,
    /// #272: pre-opened fd backing the ext4 RW upper for the
    /// `--mount` overlay. Per-VM sparse file, opened `O_RDWR`. When
    /// set, lands on slot 6 → /dev/vdd, with VIRTIO_BLK_F_DISCARD
    /// negotiated so ext4's `discard` mount option releases bytes
    /// back to the host.
    mountdisk_upper_fd: ?c_int = null,
    ram_base: u64 = 0x4000_0000,
    ram_size: usize = 4 * 1024 * 1024 * 1024, // 4 GB — room for Debian+Node+CRIU+Claude Code in the initramfs tmpfs
    // DTB sits well past the kernel so the kernel doesn't clobber it.
    dtb_offset: u64 = 0x0300_0000, // 48 MB into RAM
    // Where the initramfs goes in guest RAM. Must match the
    // `linux,initrd-start` property in the DTB's /chosen node.
    initrd_offset: u64 = 0x0400_0000, // 64 MB into RAM
    // How many bytes to capture from serial before we declare the
    // boot "far enough along to stop." Ignored when `unbounded_serial`
    // is true.
    capture_bytes: usize = 262144,
    // When false (default), the vCPU loop breaks once `captured` grows
    // past `capture_bytes` — a safety valve for tests that just want to
    // prove the kernel booted. When true, the loop only ends on PSCI
    // SYSTEM_OFF, an unhandled exception, or `max_exits`. Production
    // boots (main.zig) want this on; test fixtures want it off.
    unbounded_serial: bool = false,
    // Stop the loop after this many data-abort/HVC exits no matter what.
    max_exits: usize = 5_000_000,
};

pub const Result = struct {
    serial: []u8, // owned, free with allocator
    saw_psci_shutdown: bool,
    exits: usize,
};

/// Noisy diagnostics — GIC layout, per-TX-frame classifier, etc. —
/// are gated behind this so interactive boots (`try.sh shell` /
/// `try.sh repl`) don't bury the user's shell output under VMM logs.
/// Smokes that assert on `[tx]` lines set it before they run.
fn debugEnabled() bool {
    return getenv("MACHINEN_DEBUG") != null;
}

// DTB patching (initrd-end + memory@ size) lives in `dtb_patch.zig`,
// shared with boot_kvm.zig. See that file for the FDT walker + tests.

pub fn boot(gpa: std.mem.Allocator, cfg: Config) !Result {
    // Caller-supplied layout must satisfy the basic geometry the boot
    // protocol depends on. These are programmer errors at the call
    // site, not anything the guest can influence.
    assert(cfg.kernel_path.len > 0);
    assert(cfg.dtb_path.len > 0);
    assert(cfg.ram_size >= 16 * 1024 * 1024);
    assert(cfg.ram_size % hvf.page_size == 0);
    assert(cfg.ram_base % hvf.page_size == 0);
    assert(cfg.dtb_offset % hvf.page_size == 0);
    assert(cfg.initrd_offset % hvf.page_size == 0);
    assert(cfg.dtb_offset < cfg.ram_size);
    assert(cfg.initrd_offset < cfg.ram_size);
    assert(cfg.max_exits > 0);

    var fx = try loadFixtures(gpa, cfg);
    defer fx.deinit(gpa);

    const ram = try allocateAndPopulateRam(gpa, cfg, fx);
    defer std.posix.munmap(ram);

    const vm = try hvf.Vm.create();
    defer vm.destroy();

    // Turn on HVF's in-kernel GIC v3 at the addresses the device tree
    // advertises (distributor at 0x0800_0000, redistributor at
    // 0x080A_0000 per a QEMU `virt,gic-version=3` DTB dump). Without
    // this the kernel has nowhere to register interrupts and the
    // virtual timer has nothing to deliver to.
    try hvf.Gic.enable(.{});

    // Diagnostic: print GIC alignment + size requirements.
    if (debugEnabled()) {
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
    }

    // Give the guest full read/write/execute on this region. Stage-2
    // permissions; the guest's own MMU still decides what it does at
    // EL1 via its (eventually-enabled) page tables.
    try vm.map(ram, cfg.ram_base, hvf.MapFlags.rwx);
    defer vm.unmap(cfg.ram_base, cfg.ram_size) catch {};

    const vcpu = try initVcpu(fx.img, cfg);
    defer vcpu.destroy();

    // --- run loop -------------------------------------------------
    var uart: hvf.Pl011 = .init;
    // Production boots discard Result.serial unread (main.zig); skip
    // the per-byte capture allocations in that mode. See
    // .docs/learnings/microvm/allocations.md (#240).
    uart.capture_enabled = !cfg.unbounded_serial;
    defer uart.deinit(gpa);

    // virtio-net + gvproxy (#82). The Device is the "hardware"; gvproxy
    // (containers/gvisor-tap-vsock) runs out-of-process as a user-mode
    // TCP/IP stack and we talk to it over a Unix socket that carries
    // virtio-net frames with a 4-byte length prefix — the same wire
    // protocol QEMU uses with `-netdev socket,fd=…`.
    const virtio_mac = [_]u8{ 0x02, 0xDE, 0xAD, 0xBE, 0xEF, 0x01 };
    var tx_stats = TxStats{};
    var netdev = makeNetDevice(ram, cfg, &virtio_mac, &onTxFrame, @ptrCast(&tx_stats));

    // virtio-blk (#47, #114). Two slots:
    //   slot 1 (virtio_blk_base)  — rootdisk preferred; falls back to
    //                                disk_path so legacy boots (single
    //                                /dev/vda for snapshot) keep working.
    //   slot 3 (virtio_blk2_base) — scratch when rootdisk is also
    //                                present; otherwise empty.
    //
    // Linux probes virtio-mmio buses in DTB order, so slot 1 always
    // becomes /dev/vda and slot 3 becomes /dev/vdb when both are
    // populated. With only one, the lone device is /dev/vda.
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

    // virtio-balloon (#263 phase B). Always present; the guest's
    // free-page-reporting kernel thread continuously hands us free
    // runs, and the device's reporting handler madvises them out
    // of host RSS. No env knob — this is fire-and-forget memory.
    //
    // #274: redirect the balloon backend's accounting into the shared
    // stats file pointed at by `MACHINEN_STATS_FILE`, so the host's
    // `vm.memoryStats()` can read the live counters. Falls back to
    // a process-static stub on env-missing or open failure —
    // observability is best-effort, the device must boot regardless.
    var stats_inst = stats_mod.Stats.openOrStub();
    defer stats_inst.deinit();
    // Darwin-only background thread that polls `phys_footprint`
    // into the stats file every ~500 ms, so the host runtime's
    // `vm.memoryStats().hostRssBytes` reflects balloon reclaim
    // (`MADV_FREE_REUSABLE` doesn't drop `task_basic_info.resident_size`).
    // No-op on Linux. See `stats.zig` for details.
    stats_mod.startPhysFootprintSampler(stats_inst.counters);
    var balloon_backend = balloon_mod.Backend.initWithCounters(stats_inst.counters);
    var balloon_dev = makeBalloonDevice(ram, cfg, &balloon_backend);
    const balloon_dev_ptr: ?*virtio.Device = &balloon_dev;

    // virtio-blk slot 5 — squashfs RO lower for the `--mount` overlay
    // (#272). The runtime fd-passes the content-addressed cache file
    // O_RDONLY; we wrap it in a read-only Backend so any guest write
    // is rejected with VIRTIO_BLK_S_IOERR before the host pwrite.
    var blk3_backend_opt: ?blk_mod.Backend = openBlkBackendFromFd(cfg.mountdisk_lower_fd, true, "slot 5 (mount lower)");
    defer if (blk3_backend_opt) |*b| b.deinit();
    var blk3dev_opt: ?virtio.Device = if (blk3_backend_opt) |*b|
        makeBlkDevice(virtio_blk3_base, virtio_blk3_size, ram, cfg, b)
    else
        null;
    const blk3dev_ptr: ?*virtio.Device = if (blk3dev_opt) |_| &blk3dev_opt.? else null;

    // virtio-blk slot 6 — ext4 RW upper for the `--mount` overlay
    // (#272). Per-VM sparse file, opened O_RDWR; we negotiate
    // VIRTIO_BLK_F_DISCARD so ext4's `discard` mount option auto-
    // PUNCH_HOLEs the upper as the guest deletes.
    var blk4_backend_opt: ?blk_mod.Backend = openBlkBackendFromFd(cfg.mountdisk_upper_fd, false, "slot 6 (mount upper)");
    defer if (blk4_backend_opt) |*b| b.deinit();
    var blk4dev_opt: ?virtio.Device = if (blk4_backend_opt) |*b|
        makeBlkDeviceWithDiscard(virtio_blk4_base, virtio_blk4_size, ram, cfg, b)
    else
        null;
    const blk4dev_ptr: ?*virtio.Device = if (blk4dev_opt) |_| &blk4dev_opt.? else null;

    // virtio-vsock (#44). Off by default; set MACHINEN_VSOCK to enable.
    // Syntax (comma-separated):
    //   in:<guest_port>:<host_uds>   host listens; UDS clients → guest
    //   out:<guest_port>:<host_uds>  guest connects; host dials UDS
    //   <guest_port>:<host_uds>      legacy; treated as in:
    //
    // Parsed paths are allocated from gpa and leak for the VMM's life.
    const vsock_cid_storage: u64 = vsock_mod.default_guest_cid;
    const vsock_ports = parseVsockEnv(gpa);
    var vsock_dev_opt: ?virtio.Device = if (vsock_ports.len > 0)
        makeVsockDevice(ram, cfg, &vsock_cid_storage)
    else
        null;
    const vsock_dev_ptr: ?*virtio.Device = if (vsock_dev_opt) |_| &vsock_dev_opt.? else null;

    // Connect to gvproxy if a socket path was provided.
    const net_inst: ?*net_mod.NetSocket = connectGvproxy(gpa, &netdev);
    defer if (net_inst) |n| n.destroy();
    // Bridge context passed into TX/RX callbacks.
    var net_ctx = NetBridge{
        .stats = &tx_stats,
        .net = net_inst,
    };
    if (net_inst != null) {
        netdev.tx_handler = &onTxFrameBridge;
        netdev.tx_ctx = @ptrCast(&net_ctx);
    }

    const irqs = try assignIrqs();

    // Feed the virtio IRQ id into the network bridge, and arm the
    // RX callback so the net backend can raise the SPI after each
    // frame it injects.
    net_ctx.virtio_irq = irqs.net;
    if (net_inst) |n| {
        n.on_rx = &onNetRx;
        n.on_rx_ctx = @ptrCast(&net_ctx);
    }

    // virtio-vsock bridge startup. On any failure we drop the device
    // too so MMIO routing skips the now-half-initialised slot.
    var vsock_irq_ctx = VsockIrqCtx{ .irq = irqs.vsock };
    var vsock_bridge_opt: ?*vsock_mod.Bridge = null;
    if (vsock_dev_ptr) |d| {
        vsock_bridge_opt = startVsockBridge(gpa, d, vsock_ports, &vsock_irq_ctx);
        if (vsock_bridge_opt == null) vsock_dev_opt = null;
    }
    defer if (vsock_bridge_opt) |b| b.destroy();

    // No host-side pump thread needed: net_socket.NetSocket spawns its
    // own RX reader as part of `connect()`, and destroy() joins it.
    // The RX thread blocks in read() — zero CPU when idle — and fires
    // `on_rx` (wired above to `onNetRx`) after each injected frame.

    // Stdin-reader thread: blocks on read(0) and, when bytes arrive,
    // pushes them into the UART's RX FIFO and raises the PL011 IRQ.
    // We run this off the main (vCPU) thread because hv_vcpu_run()
    // blocks inside the guest's WFI and wouldn't return in time to
    // poll stdin. The stdin fd stays in its default blocking mode.
    var stdin_ctx = StdinThread{
        .uart = &uart,
        .irq = irqs.pl011,
        .gpa = gpa,
    };
    const stdin_thread = try std.Thread.spawn(.{}, stdinThreadMain, .{&stdin_ctx});
    defer {
        stdin_ctx.stop.store(true, .release);
        stdin_thread.detach();
    }

    const devs = Devices{
        .uart = &uart,
        .netdev = &netdev,
        .blk_dev = blkdev_ptr,
        .blk2_dev = blk2dev_ptr,
        .blk3_dev = blk3dev_ptr,
        .blk4_dev = blk4dev_ptr,
        .vsock_dev = vsock_dev_ptr,
        .vsock_bridge = vsock_bridge_opt,
        .balloon_dev = balloon_dev_ptr,
    };
    return try runLoop(gpa, cfg, vcpu, &devs, irqs);
}

/// Drive the vCPU until PSCI SYSTEM_OFF, an unhandled exception, the
/// configured serial-capture threshold, or `max_exits`. Each exit is
/// classified and dispatched to the appropriate handler; the loop
/// owns the `saw_off` / `exits` accounting and emits the final Result.
fn runLoop(
    gpa: std.mem.Allocator,
    cfg: Config,
    vcpu: hvf.Vcpu,
    devs: *const Devices,
    irqs: IrqMap,
) !Result {
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
                switch (try handlePsci(vcpu)) {
                    .shutdown => {
                        saw_off = true;
                        break;
                    },
                    .handled => {},
                }
            },
            .data_abort_lower_el => {
                const info = hvf.DataAbort.decode(vcpu.exit.exception);
                try routeDataAbort(gpa, vcpu, devs, irqs, info);
            },
            else => {
                // Unhandled exception — record and stop.
                break;
            },
        }

        // Test-mode stop condition: we've seen enough serial output to
        // be confident the kernel booted far enough to prove our point.
        // Production boots set `unbounded_serial` so the loop ends only
        // on PSCI SYSTEM_OFF (or max_exits).
        if (!cfg.unbounded_serial and devs.uart.captured.items.len >= cfg.capture_bytes) break;
    }

    if (exits >= cfg.max_exits) return error.RanTooLong;

    const serial = try gpa.dupe(u8, devs.uart.captured.items);
    return .{
        .serial = serial,
        .saw_psci_shutdown = saw_off,
        .exits = exits,
    };
}

// Context shared between the vCPU thread and the stdin-reader thread.
const StdinThread = struct {
    uart: *hvf.Pl011,
    irq: u32,
    gpa: std.mem.Allocator,
    stop: std.atomic.Value(bool) = .init(false),
};

/// Running count of TX frames the guest produces, classified by the
/// first couple of bytes of the ethernet destination MAC.
pub const TxStats = struct {
    frames: u64 = 0,
    bytes: u64 = 0,
    ipv4: u64 = 0,
    ipv6_mcast: u64 = 0,
    arp: u64 = 0,
    other: u64 = 0,
};

/// Glue passed into the TX/RX callbacks so each frame can be counted
/// AND handed to the net backend.
pub const NetBridge = struct {
    stats: *TxStats,
    net: ?*net_mod.NetSocket,
    virtio_irq: u32 = 0,
};

fn onTxFrameBridge(ctx: ?*anyopaque, frame: []const u8) void {
    assert(ctx != null);
    assert(frame.len > 0);
    const bridge: *NetBridge = @ptrCast(@alignCast(ctx.?));
    // Still log for smoke tests and diagnostics.
    onTxFrame(@ptrCast(bridge.stats), frame);
    if (bridge.net) |n| n.input(frame);
}

fn onNetRx(ctx: ?*anyopaque) void {
    assert(ctx != null);
    const bridge: *NetBridge = @ptrCast(@alignCast(ctx.?));
    assert(bridge.virtio_irq >= 32);
    // Device's interrupt_status was set inside injectRx. Sync the GIC
    // line so the guest sees a pending interrupt.
    hvf.Gic.setSpi(bridge.virtio_irq, true) catch {};
}

/// Opaque box holding the vsock virtio IRQ id. The Bridge thread calls
/// the raise_irq callback; we carry the id so the callback doesn't
/// capture a stack slot that may have moved.
pub const VsockIrqCtx = struct { irq: u32 };

fn onVsockIrq(ctx: ?*anyopaque) void {
    assert(ctx != null);
    const c: *VsockIrqCtx = @ptrCast(@alignCast(ctx.?));
    assert(c.irq >= 32);
    hvf.Gic.setSpi(c.irq, true) catch {};
}

fn onTxFrame(ctx: ?*anyopaque, frame: []const u8) void {
    assert(ctx != null);
    const stats: *TxStats = @ptrCast(@alignCast(ctx.?));
    stats.frames += 1;
    stats.bytes += frame.len;

    var ethertype: u16 = 0;
    var class: []const u8 = "short";
    if (frame.len >= 14) {
        ethertype = (@as(u16, frame[12]) << 8) | @as(u16, frame[13]);
        class = switch (ethertype) {
            0x0800 => blk: {
                stats.ipv4 += 1;
                break :blk "ipv4";
            },
            0x0806 => blk: {
                stats.arp += 1;
                break :blk "arp";
            },
            0x86DD => blk: {
                if (frame[0] == 0x33 and frame[1] == 0x33) {
                    stats.ipv6_mcast += 1;
                    break :blk "ipv6-mcast";
                } else {
                    stats.other += 1;
                    break :blk "ipv6";
                }
            },
            else => blk: {
                stats.other += 1;
                break :blk "other";
            },
        };
    } else {
        stats.other += 1;
    }

    // One line per frame so smoke tests can grep. Off by default
    // because interactive boots drown under it the moment the guest
    // does any network.
    if (!debugEnabled()) return;
    var buf: [96]u8 = undefined;
    const msg = std.fmt.bufPrint(
        &buf,
        "[tx] #{d} len={d} ethertype=0x{x:0>4} class={s}\n",
        .{ stats.frames, frame.len, ethertype, class },
    ) catch return;
    _ = write(2, msg.ptr, msg.len);
}

/// Kernel + DTB bytes loaded off disk plus the parsed kernel header.
/// Owns the two byte buffers; caller invokes `deinit` once boot is
/// done with them (the @memcpy into guest RAM doesn't keep them live).
const LoadedFixtures = struct {
    kernel: []u8,
    dtb: []u8,
    img: hvf.KernelImage,

    fn deinit(self: *LoadedFixtures, gpa: std.mem.Allocator) void {
        gpa.free(self.kernel);
        gpa.free(self.dtb);
    }
};

/// Read kernel + DTB off disk, parse the kernel header, and validate
/// they fit in the configured guest RAM. `error.FixtureMissing` is
/// surfaced so the boot tests can `expectError` it cleanly.
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

    const img = try hvf.KernelImage.parse(kernel);
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
    const ram = try std.posix.mmap(
        null,
        cfg.ram_size,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
        -1,
        0,
    );
    errdefer std.posix.munmap(ram);
    assert(ram.len == cfg.ram_size);
    assert(@intFromPtr(ram.ptr) % hvf.page_size == 0);

    @memcpy(ram[fx.img.text_offset..][0..fx.kernel.len], fx.kernel);
    @memcpy(ram[cfg.dtb_offset..][0..fx.dtb.len], fx.dtb);

    // #263 phase A: rewrite the DTB's `memory@<base>` reg-size cells
    // to match cfg.ram_size. The shipped DTB hardcodes 4 GiB (compiled
    // from virt.dts); without this patch any other ceiling silently
    // becomes 4 GiB to the kernel. Failures here would silently cap
    // the guest, so log loudly even outside debug mode.
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
        // Sub-second spawn (#50): patch the DTB's `linux,initrd-end` in
        // place to point just past the actual cpio. The kernel scans the
        // full [initrd-start, initrd-end) region for concatenated cpio /
        // compressed archives — at ~1 GB/s of wall clock. Leaving 1 GB
        // of dead tail in that window costs ~1 s of early boot.
        const initrd_end_abs: u32 = @intCast(cfg.ram_base + cfg.initrd_offset + initrd.len);
        dtb_patch.patchInitrdEnd(ram[cfg.dtb_offset..][0..fx.dtb.len], initrd_end_abs) catch |err| {
            if (debugEnabled()) std.debug.print(
                "warn: patchInitrdEnd failed ({s}); kernel will scan the full DTB-declared initrd window\n",
                .{@errorName(err)},
            );
        };
    }
    return ram;
}

/// Bring up the vCPU: register MPIDR/timer/EL1 state, then point
/// X0 at the DTB and PC at the kernel entry per the arm64 Linux boot
/// protocol. Caller owns the destroy.
fn initVcpu(img: hvf.KernelImage, cfg: Config) !hvf.Vcpu {
    const vcpu = try hvf.Vcpu.create();
    errdefer vcpu.destroy();

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
    if (debugEnabled()) {
        if (hvf.Gic.redistributorBase(vcpu)) |rdist| {
            std.debug.print("GIC redistributor for vcpu 0: 0x{x}\n", .{rdist});
        } else |err| {
            std.debug.print("GIC redistributor query failed: {s}\n", .{@errorName(err)});
        }
    }

    // EL1h, all interrupts masked.
    try vcpu.setReg(.cpsr, 0x3C5);
    // MMU off (kernel turns it on itself); I-bit for executable fetches.
    try vcpu.setSysReg(.sctlr_el1, 1 << 12);

    // arm64 Linux boot protocol: X0 = physical address of DTB.
    const dtb_phys = cfg.ram_base + cfg.dtb_offset;
    const entry_phys = cfg.ram_base + img.text_offset;
    assert(dtb_phys >= cfg.ram_base);
    assert(entry_phys >= cfg.ram_base);
    assert(entry_phys < cfg.ram_base + cfg.ram_size);
    try vcpu.setReg(.x0, dtb_phys);
    try vcpu.setReg(.x1, 0);
    try vcpu.setReg(.x2, 0);
    try vcpu.setReg(.x3, 0);
    try vcpu.setReg(.pc, entry_phys);

    return vcpu;
}

/// SPI ids for the four virtio-mmio slots + PL011, derived from the
/// Apple-supplied SPI base. DTS IRQ numbers are encoded as `<0 N 1>`
/// (0 = SPI namespace, N = offset, 1 = edge) so the absolute id is
/// `spi.base + N`. Layout must stay byte-identical to virt.dts.
const IrqMap = struct {
    pl011: u32,
    net: u32,
    blk: u32,
    blk2: u32,
    vsock: u32,
    balloon: u32,
    blk3: u32,
    blk4: u32,
};

fn assignIrqs() !IrqMap {
    const spi = try hvf.Gic.spiRange();
    // SPIs start at 32 on ARM GIC; HVF must report at least the device
    // IDs we wire up (1, 16, 17, 18, 19, 20, 21, 22) past spi.base.
    assert(spi.base >= 32);
    assert(spi.count >= 23);
    return .{
        .pl011 = spi.base + 1,
        .net = spi.base + 16,
        .blk = spi.base + 17,
        .vsock = spi.base + 18,
        .blk2 = spi.base + 19,
        .balloon = spi.base + 20,
        .blk3 = spi.base + 21,
        .blk4 = spi.base + 22,
    };
}

/// Build the virtio-net device. virtio-net sits in slot 0 with a
/// stable MAC the runtime hands the gvproxy DHCP server.
fn makeNetDevice(ram: []u8, cfg: Config, mac: *const [6]u8, tx_handler: *const fn (?*anyopaque, []const u8) void, tx_ctx: ?*anyopaque) virtio.Device {
    return .{
        .base = virtio_net_base,
        .size = virtio_net_size,
        .id = .net,
        // Bit 32 = VIRTIO_F_VERSION_1 (always required for v2 transport);
        // bit 5 = VIRTIO_NET_F_MAC (we publish the MAC in config space).
        .features = (1 << 32) | (1 << 5),
        .config = mac,
        .ram = ram,
        .ram_base = cfg.ram_base,
        .tx_handler = tx_handler,
        .tx_ctx = tx_ctx,
    };
}

/// Open a host file as a virtio-blk backend. Returns null when the
/// caller didn't ask for this slot, or when the file open failed —
/// matches the original "warn and continue" policy so a missing scratch
/// disk doesn't prevent the rest of the VMM from booting.
fn openBlkBackend(path: ?[]const u8, label: []const u8) ?blk_mod.Backend {
    const p = path orelse return null;
    return blk_mod.openFile(p) catch |err| {
        std.debug.print("virtio-blk {s} disabled: {s} ({s})\n", .{ label, @errorName(err), p });
        return null;
    };
}

/// Wrap a runtime-passed fd as a virtio-blk backend (#272). The
/// runtime opens the host file (squashfs lower or ext4 upper) before
/// `posix_spawn` and inherits the fd into the VMM; we just
/// `lseek(SEEK_END)` to discover the size and wrap. Returns null
/// when the caller didn't pass an fd — matches the warn-and-continue
/// policy so the rest of the VMM keeps booting if the runtime
/// neglected to wire the slot up.
fn openBlkBackendFromFd(fd: ?c_int, read_only: bool, label: []const u8) ?blk_mod.Backend {
    const f = fd orelse return null;
    if (f < 0) return null;
    // SEEK_END to discover size — same trick `openFile` uses. The
    // file-scope `lseek` extern further down in this file resolves
    // against libc; both squashfs and ext4 images are seekable.
    const sz = lseek(f, 0, SEEK_END);
    if (sz <= 0) {
        std.debug.print("virtio-blk {s} disabled: lseek(fd={d}) returned {d}\n", .{ label, f, sz });
        return null;
    }
    if (@rem(sz, 512) != 0) {
        std.debug.print(
            "virtio-blk {s} disabled: size {d} is not a multiple of 512 (fd={d})\n",
            .{ label, sz, f },
        );
        return null;
    }
    return blk_mod.Backend.initFromFdWithMode(f, @intCast(sz), read_only);
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
/// in the feature bits. Used by the mount-upper slot (#272) so the
/// guest's ext4 driver can issue discard requests when mounted with
/// `discard` and the host punches the corresponding holes via
/// fallocate(PUNCH_HOLE).
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
/// env doesn't prevent boot. The returned slice and its path strings
/// are allocated from `gpa`.
fn parseVsockEnv(gpa: std.mem.Allocator) []vsock_mod.PortMap {
    const raw = getenv("MACHINEN_VSOCK") orelse return &.{};
    const s = std.mem.span(raw);
    if (s.len == 0) return &.{};
    return vsock_mod.parseEnv(gpa, s) catch |err| {
        std.debug.print("vsock: MACHINEN_VSOCK parse failed ({s}); ignoring\n", .{@errorName(err)});
        return &.{};
    };
}

/// Build the virtio-balloon device. `backend` must outlive the
/// returned Device — the config + request_ctx are pointers into it.
/// #263 phase B: continuous free-page reporting (no inflate driving).
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
        // queues — we fill them on demand, not on every kick.
        .skip_notify_queues = (1 << 0) | (1 << 2),
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

/// What `handlePsci` decided. Most PSCI calls just return a value to
/// the guest; SYSTEM_OFF / SYSTEM_RESET ask the run loop to stop.
const PsciOutcome = enum { handled, shutdown };

/// Decode and respond to a PSCI HVC. Returns `.shutdown` only on
/// SYSTEM_OFF / SYSTEM_RESET; all other cases are answered in-place.
fn handlePsci(vcpu: hvf.Vcpu) !PsciOutcome {
    const f = try hvf.Psci.decode(vcpu) orelse return .handled;
    switch (f) {
        .system_off, .system_reset => return .shutdown,
        .version => {
            // PSCI 1.0 = major 1, minor 0.
            try vcpu.setReg(.x0, 0x0001_0000);
        },
        .migrate_info_type => {
            // "Not present" — no migratable trusted OS.
            try vcpu.setReg(.x0, 2);
        },
        .affinity_info_64 => {
            // CPU 0 is "ON." The kernel queries this as part of setup;
            // anything else gets NOT_SUPPORTED.
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
    }
    return .handled;
}

/// Owning handles for everything the run loop needs to dispatch MMIO
/// against. Construction in boot() drives the lifetimes; this struct
/// is just the bag of pointers we hand to runLoop / its callees.
const Devices = struct {
    uart: *hvf.Pl011,
    netdev: *virtio.Device,
    blk_dev: ?*virtio.Device,
    blk2_dev: ?*virtio.Device,
    blk3_dev: ?*virtio.Device,
    blk4_dev: ?*virtio.Device,
    vsock_dev: ?*virtio.Device,
    vsock_bridge: ?*vsock_mod.Bridge,
    balloon_dev: ?*virtio.Device,
};

/// Route a data-abort MMIO fault to the device that owns the IPA, then
/// advance PC past the faulting load/store. This is the dispatch table
/// — the per-device helpers do the actual read/write.
fn routeDataAbort(
    gpa: std.mem.Allocator,
    vcpu: hvf.Vcpu,
    devs: *const Devices,
    irqs: IrqMap,
    info: hvf.DataAbort,
) !void {
    if (devs.uart.handles(info.ipa)) {
        try handlePl011Mmio(devs.uart, gpa, vcpu, info, irqs.pl011);
    } else if (info.ipa >= 0x0800_0000 and info.ipa < 0x0801_0000) {
        try handleGicDistMmio(vcpu, info);
    } else if (devs.netdev.handles(info.ipa)) {
        try handleVirtioMmio(devs.netdev, irqs.net, vcpu, info);
    } else if (devs.blk_dev != null and devs.blk_dev.?.handles(info.ipa)) {
        try handleVirtioMmio(devs.blk_dev.?, irqs.blk, vcpu, info);
    } else if (devs.blk2_dev != null and devs.blk2_dev.?.handles(info.ipa)) {
        try handleVirtioMmio(devs.blk2_dev.?, irqs.blk2, vcpu, info);
    } else if (devs.blk3_dev != null and devs.blk3_dev.?.handles(info.ipa)) {
        try handleVirtioMmio(devs.blk3_dev.?, irqs.blk3, vcpu, info);
    } else if (devs.blk4_dev != null and devs.blk4_dev.?.handles(info.ipa)) {
        try handleVirtioMmio(devs.blk4_dev.?, irqs.blk4, vcpu, info);
    } else if (devs.vsock_dev != null and devs.vsock_dev.?.handles(info.ipa)) {
        // The vCPU side of (RMW interrupt_status + setSpi) must
        // serialise against the bridge poll thread's same pair.
        // Apple's hv_gic_set_spi appears to absorb the race in
        // practice, but the underlying hazard is the same as on KVM
        // (where it bites hard) — taking the bridge lock here makes
        // the semantics identical across backends and removes a
        // latent footgun. handleTxChain assumes the caller holds
        // bridge.mu; see its docstring.
        if (devs.vsock_bridge) |b| b.mu.lock();
        defer if (devs.vsock_bridge) |b| b.mu.unlock();
        try handleVirtioMmio(devs.vsock_dev.?, irqs.vsock, vcpu, info);
    } else if (devs.balloon_dev != null and devs.balloon_dev.?.handles(info.ipa)) {
        try handleVirtioMmio(devs.balloon_dev.?, irqs.balloon, vcpu, info);
    } else if (info.ipa >= 0x1000_0000 and info.ipa < 0x1200_0000) {
        try handleGicRdistMmio(vcpu, info);
    } else {
        try handleUnknownMmio(vcpu, info);
    }
    const pc = try vcpu.getReg(.pc);
    try vcpu.setReg(.pc, pc + 4);
}

/// Sync the PL011 IRQ line to the UART's current state. Called from
/// the vCPU thread after any PL011 MMIO that can change imsc/ris (the
/// kernel masking interrupts in its ISR is the common case). The
/// stdin thread does its own update after pushing bytes.
fn syncPl011Irq(uart: *hvf.Pl011, irq: u32) void {
    assert(irq >= 32);
    hvf.Gic.setSpi(irq, uart.irqAsserted()) catch {};
}

/// PL011 MMIO. DR-write echoes to host stderr so the user sees guest
/// console output live; every access resyncs the IRQ line.
fn handlePl011Mmio(
    uart: *hvf.Pl011,
    gpa: std.mem.Allocator,
    vcpu: hvf.Vcpu,
    info: hvf.DataAbort,
    irq: u32,
) !void {
    assert(uart.handles(info.ipa));
    if (info.is_write) {
        const value = try info.readSource(vcpu);
        try uart.write(gpa, info.ipa, value);
        if ((info.ipa - uart.base) == 0) {
            const byte: [1]u8 = .{@truncate(value)};
            _ = write(2, &byte, 1);
        }
    } else {
        const v = uart.read(info.ipa);
        if (info.srt != 31) {
            const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
            try vcpu.setReg(reg, v);
        }
    }
    syncPl011Irq(uart, irq);
}

/// virtio-MMIO read/write + raise/lower the SPI based on the device's
/// post-access interrupt_status. Shared shape across net / blk / blk2;
/// vsock callers wrap this in `bridge.mu` per the locking note in
/// `vsock.Bridge.handleTxChain`.
fn handleVirtioMmio(
    dev: *virtio.Device,
    irq: u32,
    vcpu: hvf.Vcpu,
    info: hvf.DataAbort,
) !void {
    assert(dev.handles(info.ipa));
    assert(irq >= 32);
    if (info.is_write) {
        const value = try info.readSource(vcpu);
        dev.write(info.ipa, value);
    } else if (info.srt != 31) {
        const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
        try vcpu.setReg(reg, dev.read(info.ipa));
    }
    hvf.Gic.setSpi(irq, @atomicLoad(u32, &dev.interrupt_status, .acquire) != 0) catch {};
}

/// GIC distributor MMIO ([0x0800_0000, 0x0801_0000)). Routes the
/// access to HVF; reads land in the target register.
fn handleGicDistMmio(vcpu: hvf.Vcpu, info: hvf.DataAbort) !void {
    const offset: u32 = @truncate(info.ipa - 0x0800_0000);
    if (info.is_write) {
        const value = try info.readSource(vcpu);
        hvf.Gic.writeDistributor(offset, value);
    } else if (info.srt != 31) {
        const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
        try vcpu.setReg(reg, hvf.Gic.readDistributor(offset));
    }
}

/// GIC redistributor MMIO ([0x1000_0000, 0x1200_0000)). Each vCPU's
/// frame is 128 KB; for our single-vCPU setup, frame 0 is the only
/// one and the offset within it is the HVF register.
fn handleGicRdistMmio(vcpu: hvf.Vcpu, info: hvf.DataAbort) !void {
    const offset: u32 = @truncate((info.ipa - 0x1000_0000) % 0x0002_0000);
    if (info.is_write) {
        const value = try info.readSource(vcpu);
        hvf.Gic.writeRedistributor(vcpu, offset, value);
    } else if (info.srt != 31) {
        const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
        try vcpu.setReg(reg, hvf.Gic.readRedistributor(vcpu, offset));
    }
}

/// MMIO outside any registered window. Reads return 0; writes are
/// dropped. Keeps the boot moving instead of crashing the run loop on
/// stray DTB-described regions we haven't hooked up yet.
fn handleUnknownMmio(vcpu: hvf.Vcpu, info: hvf.DataAbort) !void {
    if (!info.is_write and info.srt != 31) {
        const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
        try vcpu.setReg(reg, 0);
    }
}

fn stdinThreadMain(ctx: *StdinThread) void {
    assert(ctx.irq >= 32);
    var buf: [256]u8 = undefined;
    while (!ctx.stop.load(.acquire)) {
        const n = read(0, &buf, buf.len);
        if (n <= 0) {
            // EOF or error — stop polling. The guest can keep running;
            // it just won't receive any more serial input.
            return;
        }
        assert(@as(usize, @intCast(n)) <= buf.len);
        ctx.uart.pushRx(ctx.gpa, buf[0..@intCast(n)]) catch return;
        // Assert the IRQ so the vCPU wakes from WFI and services it.
        hvf.Gic.setSpi(ctx.irq, ctx.uart.irqAsserted()) catch {};
    }
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
    assert(path.len > 0);
    var path_buf: [4096]u8 = undefined;
    if (path.len >= path_buf.len) return error.NameTooLong;
    @memcpy(path_buf[0..path.len], path);
    path_buf[path.len] = 0;
    const path_z: [*:0]const u8 = @ptrCast(&path_buf);

    const fd = open(path_z, O_RDONLY);
    if (fd < 0) return error.OpenFailed;
    assert(fd >= 0);
    defer _ = close(fd);

    const size_i = lseek(fd, 0, SEEK_END);
    if (size_i < 0) return error.SeekFailed;
    _ = lseek(fd, 0, SEEK_SET);
    const size: usize = @intCast(size_i);
    assert(size > 0);

    const buf = try gpa.alloc(u8, size);
    errdefer gpa.free(buf);

    var total: usize = 0;
    while (total < size) {
        const n = read(fd, buf[total..].ptr, size - total);
        if (n <= 0) return error.ShortRead;
        total += @intCast(n);
    }
    assert(total == size);
    return buf;
}

// =============================================================
// Tests
// =============================================================

/// Relative path from packages/microvm/ to the kernel. The test is
/// skipped if this file isn't present — run scripts/build-base-assets.sh
/// from the repo root to produce it.
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
            "skip: missing {s} or {s} (run scripts/build-base-assets.sh)\n",
            .{ kernel_fixture, dtb_fixture },
        );
        return;
    }

    const gpa = std.testing.allocator;
    // If the caller placed a disk image alongside the kernel (or set
    // MACHINEN_DISK in the env), expose it as /dev/vda. Otherwise
    // the virtio-blk device is disabled.
    const disk_env = getenv("MACHINEN_DISK");
    const disk_path: ?[]const u8 = blk: {
        if (disk_env) |p| {
            const s = std.mem.span(p);
            if (s.len > 0) break :blk s;
        }
        const fallback = "test-fixtures/disk.img";
        if (access(fallback ++ "\x00", F_OK) == 0) break :blk fallback;
        break :blk null;
    };
    // Optional override: MACHINEN_INITRD lets the host-side runtime
    // point at a freshly-packed initramfs without clobbering the
    // in-tree fixture. Falls back to test-fixtures/initramfs.cpio.
    const initrd_env = getenv("MACHINEN_INITRD");
    const initrd_path: []const u8 = blk: {
        if (initrd_env) |p| {
            const s = std.mem.span(p);
            if (s.len > 0) break :blk s;
        }
        break :blk initrd_fixture;
    };
    // The test fixture supports either layout: legacy single-disk
    // (MACHINEN_DISK only) or virtio-blk root (MACHINEN_ROOTDISK +
    // optional MACHINEN_DISK). #114.
    const rootdisk_env = getenv("MACHINEN_ROOTDISK");
    const rootdisk_path: ?[]const u8 = blk: {
        if (rootdisk_env) |p| {
            const s = std.mem.span(p);
            if (s.len > 0) break :blk s;
        }
        break :blk null;
    };
    const result = boot(gpa, .{
        .kernel_path = kernel_fixture,
        .dtb_path = dtb_fixture,
        .initrd_path = initrd_path,
        .rootdisk_path = rootdisk_path,
        .disk_path = disk_path,
    }) catch |err| {
        std.debug.print("boot returned {s}\n", .{@errorName(err)});
        if (err == error.Denied) return; // entitlement not set in this build
        return err;
    };
    defer gpa.free(result.serial);

    // The test captures serial too, but for an interactive run what
    // matters is the live stderr echo from inside the loop. Skip the
    // at-exit dump.
    _ = result.exits;

    // The real "did we succeed" signal: did the guest kernel say
    // anything at all on serial?
    try std.testing.expect(result.serial.len > 0);
}
