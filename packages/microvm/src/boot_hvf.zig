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

const thread_spawn_config = std.Thread.SpawnConfig{
    .stack_size = std.Thread.SpawnConfig.default_stack_size,
    .allocator = null,
};

comptime {
    if (builtin.os.tag != .macos) {
        @compileError("boot_hvf.zig only builds on macOS (uses HVF)");
    }
}

const hvf = @import("hvf.zig");
const virtio = @import("virtio.zig");
const net_mod = @import("net_socket.zig");
const blk_mod = @import("blk.zig");
const ram_dump = @import("ram_dump.zig");
const vsock_mod = @import("vsock.zig");
const virtiofs_mod = @import("virtiofs.zig");
const balloon_mod = @import("balloon.zig");
const stats_mod = @import("stats.zig");
const dtb_patch = @import("dtb_patch.zig");
const vmstate_writer = @import("vmstate_writer.zig");
const nested_poweroff = @import("nested_poweroff.zig");

// Guest-physical bases. Each virtio-MMIO device lives in a 0x200
// window. The DTS has slots at 0x0A000000 + i*0x200; we wire up the
// first eleven.
//
// Slot 0 = net, slot 1 = blk (rootdisk), slot 2 = vsock,
// slot 3 = blk2 (scratch / CRIU disk), slot 4 = balloon,
// slot 5 = blk3 (mount lower / squashfs RO),
// slot 6 = blk4 (mount upper / ext4 RW),
// slots 7..11 = virtio-fs (#332 live mount; up to 5 per VM — #338).
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
const virtio_virtiofs_size: u64 = 0x200;

// #338: up to five virtio-fs devices, one per `--mount-live` (one is
// consumed internally by a lazy restore). Slots 7..11, contiguous
// after blk4. The runtime caps `liveMounts` to this many.
const MAX_VIRTIOFS_SLOTS: usize = 5;
const virtio_virtiofs_bases: [MAX_VIRTIOFS_SLOTS]u64 = .{
    0x0A00_0E00,
    0x0A00_1000,
    0x0A00_1200,
    0x0A00_1400,
    0x0A00_1600,
};

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
    NestedVirtUnsupported,
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
    /// Snapshot integration mirroring boot_kvm.zig's Config. Set
    /// `restore_path` to load .vmstate bytes at boot before the first
    /// vcpu.run(). Set `snapshot_path` to enable SIGUSR1-triggered
    /// capture during the run loop; compression/write continue on a
    /// background thread while the guest resumes.
    restore_path: ?[]const u8 = null,
    snapshot_path: ?[]const u8 = null,
    /// Optional host file written when SIGUSR1 reaches the HVF run loop
    /// without vmstate snapshots enabled. Used as a VMM-native pause
    /// marker for portable semantic snapshot evidence.
    pause_marker_path: ?[]const u8 = null,
    /// Expose EL2 to the guest via Hypervisor.framework's macOS 15+
    /// hv_vm_config API so the guest can run its own VMs.
    nested: bool = false,
};

pub const Result = struct {
    serial: []u8, // owned, free with allocator
    saw_psci_shutdown: bool,
    exits: usize,
    /// True iff a SIGUSR1-triggered snapshot was accepted.
    snapshotted: bool = false,
};

/// Noisy diagnostics — GIC layout, per-TX-frame classifier, etc. —
/// are gated behind this so interactive boots (`try.sh shell` /
/// `try.sh repl`) don't bury the user's shell output under VMM logs.
/// Smokes that assert on `[tx]` lines set it before they run.
fn debug_enabled() bool {
    return getenv("MACHINEN_DEBUG") != null;
}

fn log_best_effort(comptime label: []const u8, err: anyerror) void {
    comptime assert(label.len > 0);
    if (debug_enabled()) std.debug.print("{s}: {s}\n", .{ label, @errorName(err) });
}

fn set_spi_best_effort(irq: u32, level: bool) void {
    assert(irq >= 32);
    hvf.Gic.set_spi(irq, level) catch |err| log_best_effort("hvf: set_spi best-effort failed", err);
}

fn advance_past_mmio(vcpu: hvf.Vcpu) !void {
    const pc = try vcpu.get_reg(.pc);
    assert(pc % 4 == 0);
    try vcpu.set_reg(.pc, pc + 4);
}

// DTB patching (initrd-end + memory@ size) lives in `dtb_patch.zig`,
// shared with boot_kvm.zig. See that file for the FDT walker + tests.

/// Caller-supplied layout must satisfy the basic geometry the boot
/// protocol depends on. These are programmer errors at the call site,
/// not anything the guest can influence — assert hard.
fn validate_config(cfg: *const Config) void {
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
}

/// Turn on HVF's in-kernel GIC v3 at the addresses the device tree
/// advertises (distributor at 0x0800_0000, redistributor at
/// 0x080A_0000 per a QEMU `virt,gic-version=3` DTB dump). Without
/// this the kernel has nowhere to register interrupts and the virtual
/// timer has nothing to deliver to.
fn enable_gic() !void {
    try hvf.Gic.enable(.{});
    if (debug_enabled()) {
        std.debug.print(
            "GIC dist align=0x{x} size=0x{x}; rdist align=0x{x} size=0x{x} region=0x{x}\n",
            .{
                try hvf.Gic.distributor_alignment(),
                try hvf.Gic.distributor_size(),
                try hvf.Gic.redistributor_alignment(),
                try hvf.Gic.redistributor_size(),
                try hvf.Gic.redistributor_region_size(),
            },
        );
    }
}

pub fn boot(gpa: std.mem.Allocator, cfg: Config) !Result {
    validate_config(&cfg);

    // Install the SIGUSR1 snapshot handler FIRST — before the
    // multi-second fixture load + device bring-up. Until the handler
    // exists, SIGUSR1's default disposition terminates the VMM, so a
    // runtime that signals as soon as the registry entry appears
    // (right after spawn) would otherwise race the boot and kill us.
    // The watcher thread still starts later (it needs the vCPU
    // handle); a SIGUSR1 in the gap just sets the atomic flag, which
    // the watcher picks up the moment it comes up.
    if (cfg.snapshot_path != null or cfg.pause_marker_path != null) install_snapshot_signal();

    // Topology fingerprint — matches the KVM side (task #25). GIC
    // addresses on HVF are baked into hvf.Gic defaults (no Config
    // field today); if they ever drift from KVM the hash will too.
    const topo: @import("topology.zig").Topology = .{
        .ram_base = cfg.ram_base,
        .ram_size = cfg.ram_size,
        .gic_dist_base = 0x0800_0000,
        .gic_redist_base = 0x1000_0000,
    };
    const topo_hex = topo.hash_hex();
    std.debug.print("topology: {s}\n", .{topo_hex});

    var fx = try load_fixtures(gpa, &cfg);
    defer fx.deinit(gpa);

    const ram = try allocate_and_populate_ram(gpa, &cfg, fx);
    assert(ram.len == cfg.ram_size);
    defer std.posix.munmap(ram);

    const vm = if (cfg.nested) nested_vm: {
        break :nested_vm hvf.Vm.create_nested() catch |err| {
            std.debug.print("hvf boot: nested virtualization requested but EL2 is unavailable: {s}\n", .{@errorName(err)});
            return error.NestedVirtUnsupported;
        };
    } else try hvf.Vm.create();
    defer vm.destroy();

    try enable_gic();

    // Give the guest full read/write/execute on this region. Stage-2
    // permissions; the guest's own MMU still decides what it does at
    // EL1 via its (eventually-enabled) page tables.
    try vm.map(ram, cfg.ram_base, hvf.MapFlags.rwx);
    defer vm.unmap(cfg.ram_base, cfg.ram_size) catch |err| {
        log_best_effort("hvf: unmap failed", err);
    };

    const vcpu = try init_vcpu(fx.img, &cfg);
    defer vcpu.destroy();

    // --- run loop -------------------------------------------------
    var uart: hvf.Pl011 = .init;
    // Production boots discard Result.serial unread (main.zig); skip
    // the per-byte capture writes in that mode. See
    // .docs/learnings/microvm/allocations.md (#240).
    uart.capture_enabled = !cfg.unbounded_serial;

    // virtio-net + gvproxy (#82). The Device is the "hardware"; gvproxy
    // (containers/gvisor-tap-vsock) runs out-of-process as a user-mode
    // TCP/IP stack and we talk to it over a Unix socket that carries
    // virtio-net frames with a 4-byte length prefix — the same wire
    // protocol QEMU uses with `-netdev socket,fd=…`.
    const virtio_mac = [_]u8{ 0x02, 0xDE, 0xAD, 0xBE, 0xEF, 0x01 };
    var tx_stats = TxStats{};
    var netdev = make_net_device(ram, &cfg, &virtio_mac, &on_tx_frame, @ptrCast(&tx_stats));

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

    var blk_backend_opt: ?blk_mod.Backend = open_blk_backend(slot1_path, "slot 1");
    defer if (blk_backend_opt) |*b| b.deinit();
    if (cfg.rootdisk_path != null and cfg.snapshot_path != null) {
        if (blk_backend_opt) |*b| b.enable_dirty_tracking(gpa) catch |err| {
            std.debug.print("blk: rootdisk dirty tracking disabled: {s}\n", .{@errorName(err)});
        };
    }
    var blkdev_opt: ?virtio.Device = if (blk_backend_opt) |*b|
        make_blk_device(virtio_blk_base, virtio_blk_size, ram, &cfg, b)
    else
        null;
    const blkdev_ptr: ?*virtio.Device = if (blkdev_opt) |_| &blkdev_opt.? else null;

    var blk2_backend_opt: ?blk_mod.Backend = open_blk_backend(slot3_path, "slot 3");
    defer if (blk2_backend_opt) |*b| b.deinit();
    var blk2dev_opt: ?virtio.Device = if (blk2_backend_opt) |*b|
        make_blk_device(virtio_blk2_base, virtio_blk2_size, ram, &cfg, b)
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
    var stats_inst = stats_mod.Stats.open_or_stub();
    defer stats_inst.deinit();
    // Darwin-only background thread that polls `phys_footprint`
    // into the stats file every ~500 ms, so the host runtime's
    // `vm.memoryStats().hostRssBytes` reflects balloon reclaim
    // (`MADV_FREE_REUSABLE` doesn't drop `task_basic_info.resident_size`).
    // No-op on Linux. See `stats.zig` for details.
    stats_mod.start_phys_footprint_sampler(stats_inst.counters);
    var balloon_backend = balloon_mod.Backend.init_with_counters(stats_inst.counters);
    var balloon_dev = make_balloon_device(ram, &cfg, &balloon_backend);
    const balloon_dev_ptr: ?*virtio.Device = &balloon_dev;

    // virtio-blk slot 5 — squashfs RO lower for the `--mount` overlay
    // (#272). The runtime fd-passes the content-addressed cache file
    // O_RDONLY; we wrap it in a read-only Backend so any guest write
    // is rejected with VIRTIO_BLK_S_IOERR before the host pwrite.
    var blk3_backend_opt: ?blk_mod.Backend = open_blk_backend_from_fd(cfg.mountdisk_lower_fd, true, "slot 5 (mount lower)");
    defer if (blk3_backend_opt) |*b| b.deinit();
    var blk3dev_opt: ?virtio.Device = if (blk3_backend_opt) |*b|
        make_blk_device(virtio_blk3_base, virtio_blk3_size, ram, &cfg, b)
    else
        null;
    const blk3dev_ptr: ?*virtio.Device = if (blk3dev_opt) |_| &blk3dev_opt.? else null;

    // virtio-blk slot 6 — ext4 RW upper for the `--mount` overlay
    // (#272). Per-VM sparse file, opened O_RDWR; we negotiate
    // VIRTIO_BLK_F_DISCARD so ext4's `discard` mount option auto-
    // PUNCH_HOLEs the upper as the guest deletes.
    var blk4_backend_opt: ?blk_mod.Backend = open_blk_backend_from_fd(cfg.mountdisk_upper_fd, false, "slot 6 (mount upper)");
    defer if (blk4_backend_opt) |*b| b.deinit();
    var blk4dev_opt: ?virtio.Device = if (blk4_backend_opt) |*b|
        make_blk_device_with_discard(virtio_blk4_base, virtio_blk4_size, ram, &cfg, b)
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
    const vsock_ports = parse_vsock_env(gpa);
    var vsock_dev_opt: ?virtio.Device = if (vsock_ports.len > 0)
        make_vsock_device(ram, &cfg, &vsock_cid_storage)
    else
        null;
    const vsock_dev_ptr: ?*virtio.Device = if (vsock_dev_opt) |_| &vsock_dev_opt.? else null;

    // virtio-fs slots 7..10 (#332, #338). Off by default; set
    // MACHINEN_VIRTIOFS_0..3 to serve up to four `--mount-live` shares
    // over the in-VMM virtio-fs transport. The FUSE opcode handlers are
    // the #329 Zig handlers, reused verbatim — no mount-server process,
    // no guest fuse-agent. Request handling is synchronous on the vCPU
    // thread (the device's `request_handler` drains on each guest
    // kick), so unlike vsock no host poll thread is needed.
    var virtiofs_backends: [MAX_VIRTIOFS_SLOTS]?virtiofs_mod.Device = parse_virtiofs_env();
    defer for (&virtiofs_backends) |*b| {
        if (b.*) |*d| d.deinit();
    };
    var virtiofs_devs: [MAX_VIRTIOFS_SLOTS]?virtio.Device = undefined;
    for (0..MAX_VIRTIOFS_SLOTS) |i| {
        virtiofs_devs[i] = if (virtiofs_backends[i]) |*b|
            make_virtio_fs_device(virtio_virtiofs_bases[i], ram, &cfg, b)
        else
            null;
    }
    var virtiofs_dev_ptrs: [MAX_VIRTIOFS_SLOTS]?*virtio.Device = undefined;
    for (0..MAX_VIRTIOFS_SLOTS) |i| {
        virtiofs_dev_ptrs[i] = if (virtiofs_devs[i]) |_| &virtiofs_devs[i].? else null;
    }

    // Connect to gvproxy if a socket path was provided.
    const net_inst: ?*net_mod.NetSocket = connect_gvproxy(gpa, &netdev);
    defer if (net_inst) |n| n.destroy();
    // Bridge context passed into TX/RX callbacks.
    var net_ctx = NetBridge{
        .stats = &tx_stats,
        .net = net_inst,
    };
    if (net_inst != null) {
        netdev.tx_handler = &on_tx_frame_bridge;
        netdev.tx_ctx = @ptrCast(&net_ctx);
    }

    const irqs = try assign_irqs();

    // Feed the virtio IRQ id into the network bridge, and arm the
    // RX callback so the net backend can raise the SPI after each
    // frame it injects.
    net_ctx.virtio_irq = irqs.net;
    if (net_inst) |n| {
        n.on_rx = &on_net_rx;
        n.on_rx_ctx = @ptrCast(&net_ctx);
    }

    // virtio-vsock bridge startup. On any failure we drop the device
    // too so MMIO routing skips the now-half-initialised slot.
    var vsock_irq_ctx = VsockIrqCtx{ .irq = irqs.vsock };
    var vsock_bridge_opt: ?*vsock_mod.Bridge = null;
    if (vsock_dev_ptr) |d| {
        vsock_bridge_opt = start_vsock_bridge(gpa, d, vsock_ports, &vsock_irq_ctx);
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
    };
    const stdin_thread = try std.Thread.spawn(
        thread_spawn_config,
        stdin_thread_main,
        .{&stdin_ctx},
    );
    defer {
        stdin_ctx.stop.store(true, .release);
        stdin_thread.detach();
    }

    var nested_poweroff_detector: nested_poweroff.Detector = .{};
    const devs = Devices{
        .uart = &uart,
        .netdev = &netdev,
        .root_blk = if (cfg.rootdisk_path != null) (if (blk_backend_opt) |_| &blk_backend_opt.? else null) else null,
        .blk_dev = blkdev_ptr,
        .blk2_dev = blk2dev_ptr,
        .blk3_dev = blk3dev_ptr,
        .blk4_dev = blk4dev_ptr,
        .vsock_dev = vsock_dev_ptr,
        .vsock_bridge = vsock_bridge_opt,
        .balloon_dev = balloon_dev_ptr,
        .nested = cfg.nested,
        .nested_poweroff = &nested_poweroff_detector,
        .virtiofs_devs = virtiofs_dev_ptrs,
    };
    // Apply restore-from-vmstate before the first vcpu.run() if the
    // host orchestrator gave us one.
    if (cfg.restore_path) |path| {
        apply_restore_file(gpa, path, vcpu, ram, &cfg, &devs) catch |err| {
            std.debug.print("hvf boot: restore from {s} failed: {s}\n", .{ path, @errorName(err) });
            return err;
        };
        std.debug.print("hvf boot: restored from {s}\n", .{path});
    }
    if (cfg.snapshot_path != null or cfg.pause_marker_path != null) {
        std.debug.print("hvf boot: starting snapshot watcher (vcpu={d})\n", .{vcpu.handle});
        start_snapshot_watcher(vcpu.handle);
    }

    return try run_loop(gpa, &cfg, vm, vcpu, &devs, irqs, ram);
}

// SIGUSR1 atomic + watcher-thread plumbing. macOS HVF doesn't return
// from hv_vcpu_run on signal, so the signal handler alone isn't
// enough: we spawn a watcher pthread that polls the atomic and calls
// hv_vcpus_exit() to force the vCPU out of its run when set. The run
// loop then sees the flag on its next iteration and dumps. SIGUSR2 is
// the matching runtime acknowledgment: after it has copied rootdisk /
// mount-overlay sidecars that must match the captured CPU/RAM point, it
// lets the paused vCPU resume.
var snapshot_requested_hvf: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var snapshot_resume_requested_hvf: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var snapshot_watcher_running: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var snapshot_watcher_vcpu: u64 = 0;

extern "c" fn hv_vcpus_exit(vcpus: *const u64, count: u32) c_int;

fn sigusr1_handler_hvf(sig: c_int) callconv(.c) void {
    _ = sig;
    snapshot_requested_hvf.store(true, .seq_cst);
    const vcpu_id = snapshot_watcher_vcpu;
    if (vcpu_id != 0) {
        const exit_rc = hv_vcpus_exit(&vcpu_id, 1);
        assert(exit_rc == 0 or exit_rc != 0);
    }
}

fn sigusr2_handler_hvf(sig: c_int) callconv(.c) void {
    _ = sig;
    snapshot_resume_requested_hvf.store(true, .seq_cst);
}

fn install_snapshot_signal() void {
    const c = struct {
        extern "c" fn signal(sig: c_int, handler: usize) usize;
    };
    const SIGUSR1: c_int = 30; // macOS SIGUSR1; differs from Linux (10)
    const SIGUSR2: c_int = 31; // macOS SIGUSR2; differs from Linux (12)
    const old_usr1 = c.signal(SIGUSR1, @intFromPtr(&sigusr1_handler_hvf));
    const old_usr2 = c.signal(SIGUSR2, @intFromPtr(&sigusr2_handler_hvf));
    assert(old_usr1 == old_usr1);
    assert(old_usr2 == old_usr2);
}

fn wait_for_snapshot_resume_hvf() void {
    const c = struct {
        extern "c" fn usleep(usec: u32) c_int;
    };
    const poll_us: u32 = 1_000;
    const timeout_us: u64 = 120 * 1_000_000;
    var waited_us: u64 = 0;
    std.debug.print("hvf: snapshot captured; waiting for runtime resume\n", .{});
    while (!snapshot_resume_requested_hvf.load(.seq_cst) and waited_us < timeout_us) : (waited_us += poll_us) {
        const sleep_rc = c.usleep(poll_us);
        assert(sleep_rc == 0 or sleep_rc != 0);
    }
    if (snapshot_resume_requested_hvf.load(.seq_cst)) {
        snapshot_resume_requested_hvf.store(false, .seq_cst);
        std.debug.print("hvf: snapshot resume received\n", .{});
    } else {
        std.debug.print("hvf: snapshot resume timed out after {d}us; resuming fail-open\n", .{waited_us});
    }
}

fn handle_configured_pause_marker(marker_path: ?[]const u8, backend: []const u8) bool {
    assert(backend.len > 0);
    const path = marker_path orelse return false;
    snapshot_resume_requested_hvf.store(false, .seq_cst);
    write_configured_pause_marker(path, backend);
    snapshot_requested_hvf.store(false, .seq_cst);
    wait_for_snapshot_resume_hvf();
    return true;
}

fn write_configured_pause_marker(marker_path: ?[]const u8, backend: []const u8) void {
    assert(backend.len > 0);
    if (marker_path) |path| {
        write_pause_marker(path, backend) catch |err| {
            std.debug.print("{s}: pause marker write failed: {s}\n", .{ backend, @errorName(err) });
        };
    }
}

fn write_pause_marker(path: []const u8, backend: []const u8) !void {
    assert(path.len > 0);
    assert(backend.len > 0);
    const c = struct {
        extern "c" fn fopen(path: [*:0]const u8, mode: [*:0]const u8) ?*anyopaque;
        extern "c" fn fwrite(
            ptr: ?*const anyopaque,
            size: c_ulong,
            nmemb: c_ulong,
            stream: ?*anyopaque,
        ) c_ulong;
        extern "c" fn fclose(stream: ?*anyopaque) c_int;
    };
    var path_buf: [4096:0]u8 = undefined;
    if (path.len >= path_buf.len) return error.PauseMarkerPathTooLong;
    @memcpy(path_buf[0..path.len], path);
    path_buf[path.len] = 0;
    var buf: [512]u8 = undefined;
    const bytes = try std.fmt.bufPrint(
        &buf,
        "{{\"kind\":\"machinen.vmm-pause-marker\",\"version\":1," ++
            "\"backend\":\"{s}\",\"vcpusStopped\":true," ++
            "\"resumeSignalRequired\":\"SIGUSR2\"}}\n",
        .{backend},
    );
    const zpath = path_buf[0..path.len :0];
    const file = c.fopen(zpath.ptr, "w") orelse return error.PauseMarkerOpenFailed;
    defer {
        const close_rc = c.fclose(file);
        assert(close_rc == 0 or close_rc != 0);
    }
    if (c.fwrite(bytes.ptr, 1, bytes.len, file) != bytes.len) return error.PauseMarkerWriteFailed;
}

fn snapshot_watcher_thread(arg: ?*anyopaque) callconv(.c) ?*anyopaque {
    _ = arg;
    std.debug.print("hvf watcher: thread started, vcpu={d}\n", .{snapshot_watcher_vcpu});
    const c = struct {
        extern "c" fn usleep(usec: u32) c_int;
    };
    var fired = false;
    while (snapshot_watcher_running.load(.seq_cst)) {
        if (snapshot_requested_hvf.load(.seq_cst)) {
            const vcpu_id = snapshot_watcher_vcpu;
            const rc = hv_vcpus_exit(&vcpu_id, 1);
            if (!fired) {
                std.debug.print("hvf watcher: hv_vcpus_exit({d}) rc={d}\n", .{ vcpu_id, rc });
                fired = true;
            }
        }
        _ = c.usleep(2_000);
    }
    std.debug.print("hvf watcher: exiting\n", .{});
    return null;
}

fn start_snapshot_watcher(vcpu_handle: u64) void {
    snapshot_watcher_vcpu = vcpu_handle;
    snapshot_watcher_running.store(true, .seq_cst);
    const c = struct {
        // pthread_t is opaque on macOS (struct _opaque_pthread_t *),
        // size_t on Linux. Use ?*anyopaque to be portable.
        extern "c" fn pthread_create(
            thread: *?*anyopaque,
            attr: ?*anyopaque,
            start_routine: *const fn (?*anyopaque) callconv(.c) ?*anyopaque,
            arg: ?*anyopaque,
        ) c_int;
        extern "c" fn pthread_detach(thread: ?*anyopaque) c_int;
    };
    var tid: ?*anyopaque = null;
    const rc = c.pthread_create(&tid, null, &snapshot_watcher_thread, null);
    if (rc != 0) {
        std.debug.print("hvf boot: pthread_create failed: {d}\n", .{rc});
        return;
    }
    _ = c.pthread_detach(tid);
}

const snap_c = struct {
    extern "c" fn open(path: [*:0]const u8, flags: c_int, mode: c_int) c_int;
    extern "c" fn close(fd: c_int) c_int;
    extern "c" fn read(fd: c_int, buf: *anyopaque, count: usize) isize;
    extern "c" fn lseek(fd: c_int, offset: i64, whence: c_int) i64;
};

const SNAP_O_RDONLY: c_int = 0;
const SNAP_SEEK_END: c_int = 2;
const SNAP_SEEK_SET: c_int = 0;

fn capture_snapshot_job(
    gpa: std.mem.Allocator,
    path: []const u8,
    vcpu: hvf.Vcpu,
    ram: []const u8,
    cfg: *const Config,
    devs: *const Devices,
    full_ram: bool,
    dirty_bits: ?[]const u64,
) !*vmstate_writer.Job {
    assert(path.len > 0);
    assert(ram.len == cfg.ram_size);
    if (full_ram) assert(dirty_bits == null) else assert(dirty_bits != null);

    const snapshot = @import("snapshot.zig");
    const vcpu_dump = @import("vcpu_dump.zig");
    const gic_state = @import("gic_state.zig");
    const virtio_dump = @import("virtio_dump.zig");
    const topology = @import("topology.zig");

    const topo: topology.Topology = .{
        .ram_base = cfg.ram_base,
        .ram_size = cfg.ram_size,
        .gic_dist_base = 0x0800_0000,
        .gic_redist_base = 0x1000_0000,
    };

    const job = try vmstate_writer.Job.create(gpa, "hvf", path, topo.hash());
    errdefer job.destroy();
    const a = job.arena_allocator();

    const vcpu_payload = try vcpu_dump.dump_hvf(a, vcpu.handle);
    const ram_payload = if (full_ram)
        try ram_dump.encode(a, cfg.ram_base, ram)
    else
        try ram_dump.encode_delta(a, cfg.ram_base, ram, dirty_bits.?);
    // GICv3 distributor + per-vCPU redistributor state. Without these
    // a cross-VMM restore lands the guest on a fresh GIC: interrupts
    // the kernel thinks are enabled (the vtimer PPI especially) are
    // silently disabled, and the resumed guest never makes progress.
    const gic_dist_payload = try gic_state.dump_hvf_dist(a);
    const gic_redist_payload = try gic_state.dump_hvf_redist(a, vcpu.handle);
    // CPU interface (ICC_*) — captured via hv_gic_get_icc_reg. This
    // gates whether interrupts the distributor marks pending actually
    // reach the resumed vCPU; without a real capture the restored
    // interface sits at reset (IGRPEN1=0, PMR=0) and the guest never
    // wakes from its idle WFI.
    const gic_cpuif_payload = try gic_state.dump_hvf_cpu_if(a, vcpu.handle);

    // One `.virtio` section per present device — the section `id` is
    // the device's MMIO base so restore can match it back. Without
    // this the resumed guest's in-RAM virtio drivers point at a
    // freshly-reset device (queues unconfigured) and every notify is
    // dropped — the exec-agent's vsock goes silent.
    var vbufs: [Devices.virtio_max]*virtio.Device = undefined;
    const vdevs = devs.virtio_devices(&vbufs);

    var sections = std.ArrayList(snapshot.Section).empty;
    try sections.append(a, .{ .tag = .vcpu, .id = 0, .payload = vcpu_payload });
    try sections.append(a, .{ .tag = if (full_ram) .ram else .ram_delta, .id = 0, .payload = ram_payload });
    try sections.append(a, .{ .tag = .gic_dist, .id = 0, .payload = gic_dist_payload });
    try sections.append(a, .{ .tag = .gic_redist, .id = 0, .payload = gic_redist_payload });
    try sections.append(a, .{ .tag = .gic_cpuif, .id = 0, .payload = gic_cpuif_payload });
    for (vdevs) |d| {
        const vp = try virtio_dump.dump_device(a, d);
        try sections.append(a, .{ .tag = .virtio, .id = @truncate(d.base), .payload = vp });
    }
    // virtio-fs FUSE backend state — the nodeid→path map and the open
    // handle table. The `.virtio` loop above captured each virtio-fs
    // device's transport (queue) state; this captures the host-side
    // FUSE session so the restored guest's cached nodeids and open fds
    // keep resolving instead of hitting a fresh, empty backend. Keyed
    // by MMIO base, same as `.virtio`. The backend is recovered from
    // `request_ctx` — the same pointer `handleRequest` casts per request.
    for (vdevs) |d| {
        if (d.id != .virtio_fs) continue;
        const backend: *virtiofs_mod.Device = @ptrCast(@alignCast(d.request_ctx.?));
        const fp = try backend.state.dump_state(a);
        try sections.append(a, .{ .tag = .virtiofs_state, .id = @truncate(d.base), .payload = fp });
    }
    if (!full_ram) {
        if (devs.root_blk) |b| {
            const dp = try b.encode_dirty_delta(a);
            try sections.append(a, .{ .tag = .rootdisk_delta, .id = 0, .payload = dp });
        }
    }
    job.sections = try sections.toOwnedSlice(a);
    return job;
}

fn apply_restore_file(
    gpa: std.mem.Allocator,
    path: []const u8,
    vcpu: hvf.Vcpu,
    ram: []u8,
    cfg: *const Config,
    devs: *const Devices,
) !void {
    assert(path.len > 0);
    assert(ram.len == cfg.ram_size);

    const snapshot = @import("snapshot.zig");
    const vcpu_dump = @import("vcpu_dump.zig");
    const gic_state = @import("gic_state.zig");
    const virtio_dump = @import("virtio_dump.zig");
    const topology = @import("topology.zig");
    const vmstate_timing = @import("vmstate_timing.zig");

    const path_z = try gpa.dupeZ(u8, path);
    defer gpa.free(path_z);
    const fd = snap_c.open(path_z, SNAP_O_RDONLY, 0);
    if (fd < 0) return error.OpenFailed;
    defer _ = snap_c.close(fd);

    const size = snap_c.lseek(fd, 0, SNAP_SEEK_END);
    if (size <= 0) return error.EmptyFile;
    _ = snap_c.lseek(fd, 0, SNAP_SEEK_SET);

    const raw = try gpa.alloc(u8, @intCast(size));
    defer gpa.free(raw);
    var timing = vmstate_timing.RestoreTimer.start("hvf", raw.len, ram.len);

    var off: usize = 0;
    while (off < raw.len) {
        const rc = snap_c.read(fd, raw.ptr + off, raw.len - off);
        if (rc <= 0) return error.ReadFailed;
        off += @intCast(rc);
    }
    timing.mark("read-file");

    // gunzip if the file is compressed; a plain .vmstate borrows `raw`.
    const decoded = try @import("vmstate_zip.zig").decompress_maybe_owned(gpa, raw);
    defer decoded.deinit(gpa);
    timing.mark("decompress");

    var snap = try snapshot.decode(gpa, decoded.bytes);
    defer snap.deinit();
    timing.mark("container-decode");

    const topo: topology.Topology = .{
        .ram_base = cfg.ram_base,
        .ram_size = cfg.ram_size,
        .gic_dist_base = 0x0800_0000,
        .gic_redist_base = 0x1000_0000,
    };
    if (!std.mem.eql(u8, &topo.hash(), &snap.header.topology_hash)) {
        return error.TopologyMismatch;
    }
    timing.mark("topology-check");

    // A resumed normal VM needs interrupts: the vtimer PPI to drive
    // the scheduler, the virtio SPIs to wake blocked drivers (the
    // exec-agent's vsock). So the GIC distributor + redistributor
    // state IS applied (HVF's hv_gic_* API round-trips those), and
    // `applyHvfCpuIfDefaults` below seeds the CPU interface HVF can't
    // capture. This only works paired with the vtimer-offset fixup at
    // the end — re-enabling the GIC without fixing the counter jump
    // just trades a quiescent guest for a tick-catch-up storm.
    var vbufs: [Devices.virtio_max]*virtio.Device = undefined;
    const vdevs = devs.virtio_devices(&vbufs);
    var gic_cpuif_applied = false;
    for (snap.sections) |s| {
        const section_t0 = timing.section_start();
        switch (s.tag) {
            .vcpu => try vcpu_dump.load_hvf(gpa, vcpu.handle, s.payload),
            .ram => {
                // Reconstructs straight into the live guest RAM: zero
                // pages are implicit, stored extents land on top.
                _ = try ram_dump.decode_into_zeroed(s.payload, ram);
            },
            .ram_delta => {
                // Overlay a checkpoint delta onto the RAM reconstructed
                // from its parent section(s).
                _ = try ram_dump.decode_delta_into(s.payload, ram);
            },
            .gic_dist => gic_state.load_hvf_dist(gpa, s.payload) catch |err| {
                std.debug.print("hvf boot: gic_dist restore failed: {s}\n", .{@errorName(err)});
            },
            .gic_redist => gic_state.load_hvf_redist(gpa, vcpu.handle, s.payload) catch |err| {
                std.debug.print("hvf boot: gic_redist restore failed: {s}\n", .{@errorName(err)});
            },
            .gic_cpuif => {
                if (s.payload.len > 4) {
                    gic_state.load_hvf_cpu_if(gpa, vcpu.handle, s.payload) catch |err| {
                        std.debug.print("hvf boot: gic_cpuif restore failed: {s}\n", .{@errorName(err)});
                    };
                    gic_cpuif_applied = true;
                }
            },
            // Restore each virtio device's transport state onto the
            // matching freshly-created device (matched by MMIO base,
            // which the snapshot stored in the section `id`). Without
            // this the resumed guest's drivers can't reach their
            // devices — the exec-agent's vsock never reconnects.
            .virtio => {
                for (vdevs) |d| {
                    if (@as(u32, @truncate(d.base)) == s.id) {
                        virtio_dump.apply_device(gpa, d, s.payload) catch |err| {
                            std.debug.print(
                                "hvf boot: virtio restore for base 0x{x} failed: {s}\n",
                                .{ d.base, @errorName(err) },
                            );
                        };
                        break;
                    }
                }
            },
            // Restore the virtio-fs FUSE backend state onto the matching
            // freshly-booted device (matched by MMIO base in `s.id`).
            // A decode failure is logged and skipped — the mount falls
            // back to an empty backend rather than wedging the boot.
            .virtiofs_state => {
                for (vdevs) |d| {
                    if (d.id != .virtio_fs) continue;
                    if (@as(u32, @truncate(d.base)) != s.id) continue;
                    const backend: *virtiofs_mod.Device = @ptrCast(@alignCast(d.request_ctx.?));
                    backend.state.apply_state(s.payload) catch |err| {
                        std.debug.print(
                            "hvf boot: virtio-fs state restore for base 0x{x} failed: {s}\n",
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

    // If the snapshot carried a real `gic_cpuif` section it was just
    // replayed (the captured ICC_* values are always correct). Only
    // fall back to seeded Linux defaults for legacy `.vmstate` files
    // written before `dumpHvfCpuIf` could capture the CPU interface —
    // without *some* programming the interface stays at reset and the
    // resumed guest never wakes from its idle WFI.
    if (!gic_cpuif_applied) gic_state.apply_hvf_cpu_if_defaults(vcpu.handle);
    timing.mark("gic-cpuif-fallback");

    // Virtual-timer fixup. loadHvf restored CNTV_CVAL_EL0 — an absolute
    // point on the guest's virtual-counter timeline — but a fresh HVF
    // vCPU's virtual counter runs off the host's physical counter,
    // unrelated to where the snapshotted guest's CNTVCT was. The guest
    // kernel's timekeeping, RCU, and scheduler all key off CNTVCT; a
    // wild discontinuity sends the resumed guest straight into a fault
    // loop. Shift the vtimer offset so CNTVCT lands back on the
    // restored comparator — the timer reads as "about to fire", the
    // guest takes one clean tick, then resumes normal cadence.
    {
        const tc = struct {
            extern "c" fn hv_vcpu_get_vtimer_offset(vcpu: u64, offset: *u64) c_int;
            extern "c" fn hv_vcpu_set_vtimer_offset(vcpu: u64, offset: u64) c_int;
            extern "c" fn hv_vcpu_get_sys_reg(vcpu: u64, reg: u32, value: *u64) c_int;
            extern "c" fn mach_absolute_time() u64;
        };
        const CNTPCT_EL0: u32 = 0xDF01; // S3_3_C14_C0_1
        const CNTV_CVAL_EL0: u32 = 0xDF1A; // S3_3_C14_C3_2
        var cval: u64 = 0;
        var cntpct_reg: u64 = 0;
        var cur_off: u64 = 0;
        const r1 = tc.hv_vcpu_get_sys_reg(vcpu.handle, CNTV_CVAL_EL0, &cval);
        const rp = tc.hv_vcpu_get_sys_reg(vcpu.handle, CNTPCT_EL0, &cntpct_reg);
        const r3 = tc.hv_vcpu_get_vtimer_offset(vcpu.handle, &cur_off);
        // CNTVCT_EL0 can't be read via hv_vcpu_get_sys_reg, and a fresh
        // vCPU's vtimer offset is 0, so CNTPCT == CNTVCT == the host's
        // physical counter. On Apple Silicon mach_absolute_time() runs
        // off that same 24 MHz timebase — use the register read if HVF
        // honours it, else fall back to mach_absolute_time().
        const mach = tc.mach_absolute_time();
        const cntpct: u64 = if (rp == 0 and cntpct_reg != 0) cntpct_reg else mach;
        std.debug.print(
            "hvf boot: timer fixup cval=0x{x}(r{d}) cntpct_reg=0x{x}(r{d}) mach=0x{x} off=0x{x}(r{d})\n",
            .{ cval, r1, cntpct_reg, rp, mach, cur_off, r3 },
        );
        if (r1 == 0 and r3 == 0 and cval != 0) {
            // Want CNTVCT == cval. CNTVCT = CNTPCT - offset, so
            // offset = CNTPCT - cval (wrapping; CNTVOFF is a raw 64-bit
            // register and a guest "ahead" of the host counter just
            // means a large unsigned offset).
            const new_off = cntpct -% cval;
            const r4 = tc.hv_vcpu_set_vtimer_offset(vcpu.handle, new_off);
            std.debug.print(
                "hvf boot: timer fixup offset 0x{x} -> 0x{x} (r{d})\n",
                .{ cur_off, new_off, r4 },
            );
        }
    }
    timing.mark("timer-fixup");
    timing.done();
}

const RamDirtyTracker = struct {
    allocator: std.mem.Allocator,
    vm: hvf.Vm,
    ram_base: u64,
    ram_size: usize,
    bits: []u64,
    active: bool = false,

    fn init(allocator: std.mem.Allocator, vm: hvf.Vm, cfg: *const Config) !RamDirtyTracker {
        const page_count = @divExact(cfg.ram_size, ram_dump.PAGE);
        const word_count = @divFloor(page_count + 63, 64);
        const bits = try allocator.alloc(u64, word_count);
        @memset(bits, 0);
        return .{ .allocator = allocator, .vm = vm, .ram_base = cfg.ram_base, .ram_size = cfg.ram_size, .bits = bits };
    }

    fn deinit(self: *RamDirtyTracker) void {
        self.allocator.free(self.bits);
        self.bits = &.{};
    }

    fn activate_clean(self: *RamDirtyTracker) !void {
        @memset(self.bits, 0);
        try self.vm.protect(self.ram_base, self.ram_size, hvf.MapFlags.rx);
        self.active = true;
    }

    fn handle_write_fault(self: *RamDirtyTracker, info: hvf.DataAbort) !bool {
        if (!self.active or !info.is_write) return false;
        if (info.ipa < self.ram_base) return false;
        const rel = info.ipa - self.ram_base;
        if (rel >= self.ram_size) return false;
        const hv_page_rel = @divFloor(rel, hvf.page_size) * hvf.page_size;
        const hv_page_ipa = self.ram_base + hv_page_rel;
        const first_page = @divExact(hv_page_rel, @as(u64, ram_dump.PAGE));
        const subpages = @divExact(hvf.page_size, ram_dump.PAGE);
        for (0..subpages) |i| {
            const page = first_page + i;
            if (page * ram_dump.PAGE >= self.ram_size) break;
            const word = @divFloor(page, 64);
            const bit: u6 = @intCast(page % 64);
            if (word < self.bits.len) self.bits[word] |= @as(u64, 1) << bit;
        }
        try self.vm.protect(hv_page_ipa, hvf.page_size, hvf.MapFlags.rwx);
        return true;
    }
};

/// Drive the vCPU until PSCI SYSTEM_OFF, an unhandled exception, the
/// configured serial-capture threshold, or `max_exits`. Each exit is
/// classified and dispatched to the appropriate handler; the loop
/// owns the `saw_off` / `exits` accounting and emits the final Result.
fn run_loop(
    gpa: std.mem.Allocator,
    cfg: *const Config,
    vm: hvf.Vm,
    vcpu: hvf.Vcpu,
    devs: *const Devices,
    irqs: IrqMap,
    ram: []u8,
) !Result {
    assert(cfg.max_exits > 0);
    assert(ram.len == cfg.ram_size);

    var exits: usize = 0;
    var saw_off = false;
    var snapshotted = false;
    var checkpoint_delta_mode = cfg.restore_path != null;
    var ram_dirty = try RamDirtyTracker.init(gpa, vm, cfg);
    defer ram_dirty.deinit();
    if (checkpoint_delta_mode and cfg.snapshot_path != null) {
        try ram_dirty.activate_clean();
    }
    var snapshot_writer_state: vmstate_writer.Writer = .{};
    defer snapshot_writer_state.wait();
    while (exits < cfg.max_exits) : (exits += 1) {
        try vcpu.run();

        // Async exit from hv_vcpus_exit (watcher thread, snapshot
        // trigger). Don't treat as a guest fault; check the flag and
        // either capture a snapshot or resume after the runtime sends
        // SIGUSR2.
        if (vcpu.exit.reason == .canceled) {
            if (snapshot_requested_hvf.load(.seq_cst)) {
                if (cfg.snapshot_path) |path| {
                    snapshot_resume_requested_hvf.store(false, .seq_cst);
                    const full_ram = !checkpoint_delta_mode;
                    const dirty_bits: ?[]const u64 = if (full_ram) null else ram_dirty.bits;
                    if (queue_snapshot_write(
                        &snapshot_writer_state,
                        gpa,
                        path,
                        vcpu,
                        ram,
                        cfg,
                        devs,
                        full_ram,
                        dirty_bits,
                    )) {
                        snapshotted = true;
                        checkpoint_delta_mode = true;
                        try ram_dirty.activate_clean();
                        if (devs.root_blk) |b| b.clear_dirty();
                        // Clear the flag and wait for the runtime's
                        // SIGUSR2 before RESUME so sidecar files are
                        // point-in-time consistent with CPU/RAM. Keep
                        // the watcher thread alive so a later SIGUSR1
                        // (chained snapshot / fork-the-fork) triggers
                        // another capture.
                        snapshot_requested_hvf.store(false, .seq_cst);
                        wait_for_snapshot_resume_hvf();
                    } else {
                        snapshot_requested_hvf.store(false, .seq_cst);
                    }
                } else {
                    if (!handle_configured_pause_marker(cfg.pause_marker_path, "hvf")) {
                        snapshot_requested_hvf.store(false, .seq_cst);
                    }
                }
            }
            continue;
        }

        // Virtual timer expired while the vCPU was running. Re-mask so
        // we don't immediately re-fire on the next run; the kernel
        // handles the timer interrupt the GIC delivers.
        if (vcpu.exit.reason == .vtimer_activated) {
            try vcpu.set_vtimer_mask(true);
            try vcpu.set_vtimer_mask(false);
            continue;
        }

        if (vcpu.exit.reason != .exception) {
            log_unhandled_exit(vcpu, "non-exception exit");
            return error.GuestCrashed;
        }
        const ec = hvf.ExceptionClass.from_syndrome(vcpu.exit.exception.syndrome);

        switch (ec) {
            .trapped_wfx => {
                try handle_wait_trap(vcpu);
            },
            .hvc_aarch64, .smc_aarch64 => {
                switch (try handle_psci(vcpu)) {
                    .shutdown => {
                        saw_off = true;
                        break;
                    },
                    .handled => {},
                }
            },
            .system_register => {
                if (!try handle_system_register_trap(vcpu)) {
                    log_unhandled_exception(vcpu, ec, "unsupported system-register trap");
                    break;
                }
            },
            .data_abort_lower_el => {
                const info = hvf.DataAbort.decode(vcpu.exit.exception);
                if (!try ram_dirty.handle_write_fault(info)) {
                    try route_data_abort(vcpu, devs, irqs, info);
                }
            },
            else => {
                log_unhandled_exception(vcpu, ec, "unhandled exception class");
                break;
            },
        }

        if (devs.nested_poweroff.seen) {
            saw_off = true;
            break;
        }

        // Test-mode stop condition: we've seen enough serial output to
        // be confident the kernel booted far enough to prove our point.
        // Production boots set `unbounded_serial` so the loop ends only
        // on PSCI SYSTEM_OFF (or max_exits).
        if (!cfg.unbounded_serial and devs.uart.captured_len >= cfg.capture_bytes) break;

        // Snapshot trigger fallback — for the rare case the watcher's
        // hv_vcpus_exit() landed as a plain exception exit rather than
        // `.canceled`. Same capture-and-SIGUSR2-resume contract as
        // above.
        if (snapshot_requested_hvf.load(.seq_cst)) {
            if (cfg.snapshot_path) |path| {
                snapshot_resume_requested_hvf.store(false, .seq_cst);
                const full_ram = !checkpoint_delta_mode;
                const dirty_bits: ?[]const u64 = if (full_ram) null else ram_dirty.bits;
                if (queue_snapshot_write(
                    &snapshot_writer_state,
                    gpa,
                    path,
                    vcpu,
                    ram,
                    cfg,
                    devs,
                    full_ram,
                    dirty_bits,
                )) {
                    snapshotted = true;
                    checkpoint_delta_mode = true;
                    try ram_dirty.activate_clean();
                    if (devs.root_blk) |b| b.clear_dirty();
                    snapshot_requested_hvf.store(false, .seq_cst);
                    wait_for_snapshot_resume_hvf();
                } else {
                    snapshot_requested_hvf.store(false, .seq_cst);
                }
            } else {
                if (!handle_configured_pause_marker(cfg.pause_marker_path, "hvf")) {
                    snapshot_requested_hvf.store(false, .seq_cst);
                }
            }
        }
    }

    if (exits >= cfg.max_exits) return error.RanTooLong;

    const serial = try gpa.dupe(u8, devs.uart.captured_bytes());
    return .{
        .serial = serial,
        .saw_psci_shutdown = saw_off,
        .exits = exits,
        .snapshotted = snapshotted,
    };
}

/// macOS 26/Tahoe can surface trapped WFI/WFE as a normal exception
/// instead of blocking inside hv_vcpu_run(). Emulate the architected
/// wait instruction by stepping over it and yielding briefly; pending
/// GIC/timer state is then observed on the next vCPU entry.
fn handle_wait_trap(vcpu: hvf.Vcpu) !void {
    const trap = hvf.WaitTrap.decode(vcpu.exit.exception);
    const pc = try vcpu.get_reg(.pc);
    try vcpu.set_reg(.pc, pc + 4);

    // WFI should park until an interrupt, while WFE is only a hint.
    // HVF does not expose a portable "pending interrupt" poll here,
    // so use a tiny sleep to avoid a hot idle spin while keeping exec /
    // network wakeups responsive.
    switch (trap.instruction) {
        .wfi => sleep_micros(250),
        .wfe => sleep_micros(10),
    }
}

/// Forward a trapped MRS/MSR to HVF's register accessors. Tahoe may
/// choose to expose system-register traps that older macOS releases
/// handled internally; if HVF recognizes the register, emulating it
/// here keeps the Linux boot moving without hard-coding guest values.
fn handle_system_register_trap(vcpu: hvf.Vcpu) !bool {
    const trap = hvf.SysRegTrap.decode(vcpu.exit.exception);
    if (trap.is_read) {
        const value = read_trapped_sys_reg(vcpu, trap.encoding) catch |err| switch (err) {
            error.BadArgument, error.Denied, error.Unsupported => return false,
            else => return err,
        };
        try trap.write_target(vcpu, value);
    } else {
        const value = try trap.read_source(vcpu);
        write_trapped_sys_reg(vcpu, trap.encoding, value) catch |err| switch (err) {
            error.BadArgument, error.Denied, error.Unsupported => return false,
            else => return err,
        };
    }

    const pc = try vcpu.get_reg(.pc);
    try vcpu.set_reg(.pc, pc + 4);
    return true;
}

fn read_trapped_sys_reg(vcpu: hvf.Vcpu, encoding: u16) hvf.Error!u64 {
    if (hvf.Gic.is_icc_reg(encoding)) {
        return hvf.Gic.read_icc(vcpu, encoding) catch |err| switch (err) {
            error.BadArgument, error.Unsupported => return vcpu.get_raw_sys_reg(encoding),
            else => return err,
        };
    }
    return vcpu.get_raw_sys_reg(encoding) catch |err| switch (err) {
        // Guest hardware-debug state is not virtualized. Linux only
        // clears/probes these while booting; read-as-zero keeps that
        // init path moving on M4/Tahoe slots missing from Apple's SDK.
        error.BadArgument, error.Denied, error.Unsupported => if (hvf.is_debug_sys_reg(encoding)) 0 else return err,
        else => return err,
    };
}

fn write_trapped_sys_reg(vcpu: hvf.Vcpu, encoding: u16, value: u64) hvf.Error!void {
    if (hvf.Gic.is_icc_reg(encoding)) {
        hvf.Gic.write_icc(vcpu, encoding, value) catch |err| switch (err) {
            error.BadArgument, error.Unsupported => return vcpu.set_raw_sys_reg(encoding, value),
            else => return err,
        };
        return;
    }
    vcpu.set_raw_sys_reg(encoding, value) catch |err| switch (err) {
        // Same debug-register policy as reads, plus a broader early-boot
        // hardening rule: unsupported zero-writes are clears of optional
        // state, so drop them instead of killing the VM. The Tahoe report
        // that drove this was `msr DBGBVR19_EL1, xzr` (encoding 0x809c).
        error.BadArgument, error.Denied, error.Unsupported => if (hvf.should_ignore_unsupported_sys_reg_write(encoding, value)) return else return err,
        else => return err,
    };
}

fn log_unhandled_exit(vcpu: hvf.Vcpu, why: []const u8) void {
    const pc = vcpu.get_reg(.pc) catch 0;
    std.debug.print(
        "hvf boot: {s}: reason={d} syndrome=0x{x} far=0x{x} ipa=0x{x} pc=0x{x}\n",
        .{
            why,
            @intFromEnum(vcpu.exit.reason),
            vcpu.exit.exception.syndrome,
            vcpu.exit.exception.virtual_address,
            vcpu.exit.exception.physical_address,
            pc,
        },
    );
    log_report_hint();
}

fn log_unhandled_exception(vcpu: hvf.Vcpu, ec: hvf.ExceptionClass, why: []const u8) void {
    const pc = vcpu.get_reg(.pc) catch 0;
    const trap = if (ec == .system_register) hvf.SysRegTrap.decode(vcpu.exit.exception) else null;
    if (trap) |t| {
        std.debug.print(
            "hvf boot: {s}: ec=0x{x} syndrome=0x{x} sysreg=0x{x} {s} rt={d} pc=0x{x}\n",
            .{
                why,
                @intFromEnum(ec),
                vcpu.exit.exception.syndrome,
                t.encoding,
                if (t.is_read) "read" else "write",
                t.rt,
                pc,
            },
        );
        log_report_hint();
        return;
    }
    std.debug.print(
        "hvf boot: {s}: ec=0x{x} syndrome=0x{x} far=0x{x} ipa=0x{x} pc=0x{x}\n",
        .{
            why,
            @intFromEnum(ec),
            vcpu.exit.exception.syndrome,
            vcpu.exit.exception.virtual_address,
            vcpu.exit.exception.physical_address,
            pc,
        },
    );
    log_report_hint();
}

fn log_report_hint() void {
    std.debug.print(
        "hvf boot: please report this diagnostic at https://github.com/redwoodjs/machinen.dev/issues/new\n",
        .{},
    );
}

fn queue_snapshot_write(
    writer: *vmstate_writer.Writer,
    gpa: std.mem.Allocator,
    path: []const u8,
    vcpu: hvf.Vcpu,
    ram: []const u8,
    cfg: *const Config,
    devs: *const Devices,
    full_ram: bool,
    dirty_bits: ?[]const u64,
) bool {
    if (writer.busy()) {
        std.debug.print("hvf: snapshot requested while previous write is still in flight\n", .{});
        return false;
    }

    std.debug.print("hvf: writing snapshot to {s}\n", .{path});
    write_configured_pause_marker(cfg.pause_marker_path, "hvf");
    const job = capture_snapshot_job(gpa, path, vcpu, ram, cfg, devs, full_ram, dirty_bits) catch |err| {
        std.debug.print("hvf boot: snapshot capture failed: {s}\n", .{@errorName(err)});
        return false;
    };
    writer.start(job) catch |err| {
        std.debug.print(
            "hvf: snapshot async writer spawn failed: {s}; writing synchronously\n",
            .{@errorName(err)},
        );
        vmstate_writer.write_and_destroy(job) catch |write_err| {
            std.debug.print("hvf boot: snapshot write failed: {s}\n", .{@errorName(write_err)});
            return false;
        };
        return true;
    };
    std.debug.print("hvf: snapshot capture done; async write started\n", .{});
    return true;
}

// Context shared between the vCPU thread and the stdin-reader thread.
const StdinThread = struct {
    uart: *hvf.Pl011,
    irq: u32,
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

fn on_tx_frame_bridge(ctx: ?*anyopaque, frame: []const u8) void {
    assert(ctx != null);
    assert(frame.len > 0);
    const bridge: *NetBridge = @ptrCast(@alignCast(ctx.?));
    // Still log for smoke tests and diagnostics.
    on_tx_frame(@ptrCast(bridge.stats), frame);
    if (bridge.net) |n| n.input(frame);
}

fn on_net_rx(ctx: ?*anyopaque) void {
    assert(ctx != null);
    const bridge: *NetBridge = @ptrCast(@alignCast(ctx.?));
    assert(bridge.virtio_irq >= 32);
    // Device's interrupt_status was set inside injectRx. Sync the GIC
    // line so the guest sees a pending interrupt.
    set_spi_best_effort(bridge.virtio_irq, true);
}

/// Opaque box holding the vsock virtio IRQ id. The Bridge thread calls
/// the raise_irq callback; we carry the id so the callback doesn't
/// capture a stack slot that may have moved.
pub const VsockIrqCtx = struct { irq: u32 };

fn on_vsock_irq(ctx: ?*anyopaque) void {
    assert(ctx != null);
    const c: *VsockIrqCtx = @ptrCast(@alignCast(ctx.?));
    assert(c.irq >= 32);
    set_spi_best_effort(c.irq, true);
}

fn on_tx_frame(ctx: ?*anyopaque, frame: []const u8) void {
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
    if (!debug_enabled()) return;
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
fn load_fixtures(gpa: std.mem.Allocator, cfg: *const Config) !LoadedFixtures {
    const kernel = read_all(gpa, cfg.kernel_path) catch |err| {
        if (err == error.FileNotFound) return error.FixtureMissing;
        return err;
    };
    errdefer gpa.free(kernel);
    assert(kernel.len > 0);

    const dtb = read_all(gpa, cfg.dtb_path) catch |err| {
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
fn allocate_and_populate_ram(
    gpa: std.mem.Allocator,
    cfg: *const Config,
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

    if (cfg.restore_path != null) {
        // Restore snapshots cover guest RAM themselves. Leave the fresh
        // anonymous mmap untouched so sparse RAM restore can rely on
        // demand-zero pages instead of clearing the full RAM ceiling.
        return ram;
    }

    @memcpy(ram[fx.img.text_offset..][0..fx.kernel.len], fx.kernel);
    @memcpy(ram[cfg.dtb_offset..][0..fx.dtb.len], fx.dtb);

    // #263 phase A: rewrite the DTB's `memory@<base>` reg-size cells
    // to match cfg.ram_size. The shipped DTB hardcodes 4 GiB (compiled
    // from virt.dts); without this patch any other ceiling silently
    // becomes 4 GiB to the kernel. Failures here would silently cap
    // the guest, so log loudly even outside debug mode.
    dtb_patch.patch_memory_size(ram[cfg.dtb_offset..][0..fx.dtb.len], cfg.ram_size) catch |err| {
        std.debug.print(
            "warn: patchMemorySize failed ({s}); guest will see the DTB-declared ceiling, not cfg.ram_size={d}\n",
            .{ @errorName(err), cfg.ram_size },
        );
    };

    if (cfg.initrd_path) |initrd_path| {
        const initrd = read_all(gpa, initrd_path) catch |err| {
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
        dtb_patch.patch_initrd_end(ram[cfg.dtb_offset..][0..fx.dtb.len], initrd_end_abs) catch |err| {
            if (debug_enabled()) std.debug.print(
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
fn init_vcpu(img: hvf.KernelImage, cfg: *const Config) !hvf.Vcpu {
    const vcpu = try hvf.Vcpu.create();
    errdefer vcpu.destroy();

    // Set the vCPU's multiprocessor affinity. Without this, Apple's
    // GIC won't associate this vCPU with a redistributor frame and
    // any `hv_gic_*_redistributor_reg` call returns HV_DENIED. Value
    // layout: bit 31 reserved-as-1, bits 23:16/15:8/7:0 = Aff2/Aff1/Aff0.
    // For our single-CPU guest, all affinity fields = 0.
    try vcpu.set_sys_reg(.mpidr_el1, 1 << 31);

    // Let the virtual timer wake the vCPU so we can deliver ticks.
    try vcpu.set_vtimer_mask(false);

    // Diagnostic: query where HVF actually placed this vCPU's
    // redistributor. If this differs from what we told the kernel via
    // the DTB, the kernel will report "No redistributor present."
    if (debug_enabled()) {
        if (hvf.Gic.redistributor_base(vcpu)) |rdist| {
            std.debug.print("GIC redistributor for vcpu 0: 0x{x}\n", .{rdist});
        } else |err| {
            std.debug.print("GIC redistributor query failed: {s}\n", .{@errorName(err)});
        }
    }

    if (cfg.nested) {
        // EL2h, all interrupts masked. When EL2 is exposed, Linux must
        // enter at EL2 so it can own the guest hypervisor state and
        // later provide /dev/kvm to workloads inside the VM.
        try vcpu.set_reg(.cpsr, 0x3C9);
        // HCR_EL2.RW=1 selects AArch64 for EL1. CNTHCTL bits allow EL1
        // to read the physical counter/timer as required by the arm64
        // boot protocol. Keep the virtual offset at zero.
        try vcpu.set_sys_reg(.hcr_el2, @as(u64, 1) << 31);
        try vcpu.set_sys_reg(.cnthctl_el2, 0x3);
        try vcpu.set_sys_reg(.cntvoff_el2, 0);
    } else {
        // EL1h, all interrupts masked.
        try vcpu.set_reg(.cpsr, 0x3C5);
        // MMU off (kernel turns it on itself); I-bit for executable fetches.
        try vcpu.set_sys_reg(.sctlr_el1, 1 << 12);
    }

    // arm64 Linux boot protocol: X0 = physical address of DTB.
    const dtb_phys = cfg.ram_base + cfg.dtb_offset;
    const entry_phys = cfg.ram_base + img.text_offset;
    assert(dtb_phys >= cfg.ram_base);
    assert(entry_phys >= cfg.ram_base);
    assert(entry_phys < cfg.ram_base + cfg.ram_size);
    try vcpu.set_reg(.x0, dtb_phys);
    try vcpu.set_reg(.x1, 0);
    try vcpu.set_reg(.x2, 0);
    try vcpu.set_reg(.x3, 0);
    try vcpu.set_reg(.pc, entry_phys);

    return vcpu;
}

/// SPI ids for the virtio-mmio slots + PL011, derived from the
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
    /// One per virtio-fs slot (DTS offsets 23..23+MAX_VIRTIOFS_SLOTS-1).
    virtiofs: [MAX_VIRTIOFS_SLOTS]u32,
};

fn assign_irqs() !IrqMap {
    const spi = try hvf.Gic.spi_range();
    // SPIs start at 32 on ARM GIC; HVF must report at least the device
    // IDs we wire up (1, 16..23+MAX_VIRTIOFS_SLOTS-1) past spi.base.
    assert(spi.base >= 32);
    assert(spi.count >= 23 + MAX_VIRTIOFS_SLOTS);
    var virtiofs_irqs: [MAX_VIRTIOFS_SLOTS]u32 = undefined;
    for (0..MAX_VIRTIOFS_SLOTS) |i| {
        virtiofs_irqs[i] = spi.base + 23 + @as(u32, @intCast(i));
    }
    return .{
        .pl011 = spi.base + 1,
        .net = spi.base + 16,
        .blk = spi.base + 17,
        .vsock = spi.base + 18,
        .blk2 = spi.base + 19,
        .balloon = spi.base + 20,
        .blk3 = spi.base + 21,
        .blk4 = spi.base + 22,
        .virtiofs = virtiofs_irqs,
    };
}

/// Build the virtio-net device. virtio-net sits in slot 0 with a
/// stable MAC the runtime hands the gvproxy DHCP server.
fn make_net_device(
    ram: []u8,
    cfg: *const Config,
    mac: *const [6]u8,
    tx_handler: *const fn (?*anyopaque, []const u8) void,
    tx_ctx: ?*anyopaque,
) virtio.Device {
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
fn open_blk_backend(path: ?[]const u8, label: []const u8) ?blk_mod.Backend {
    const p = path orelse return null;
    return blk_mod.open_file(p) catch |err| {
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
fn open_blk_backend_from_fd(fd: ?c_int, read_only: bool, label: []const u8) ?blk_mod.Backend {
    const f = fd orelse return null;
    if (f < 0) return null;
    // SEEK_END to discover size — same trick `openFile` uses. The
    // file-scope `lseek` extern further down in this file resolves
    // against libc; both squashfs and ext4 images are seekable.
    const size_bytes = lseek(f, 0, SEEK_END);
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
fn make_blk_device(
    base: u64,
    size: u64,
    ram: []u8,
    cfg: *const Config,
    backend: *blk_mod.Backend,
) virtio.Device {
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
/// in the feature bits. Used by the mount-upper slot (#272) so the
/// guest's ext4 driver can issue discard requests when mounted with
/// `discard` and the host punches the corresponding holes via
/// fallocate(PUNCH_HOLE).
fn make_blk_device_with_discard(
    base: u64,
    size: u64,
    ram: []u8,
    cfg: *const Config,
    backend: *blk_mod.Backend,
) virtio.Device {
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
/// env doesn't prevent boot. The returned slice and its path strings
/// are allocated from `gpa`.
fn parse_vsock_env(gpa: std.mem.Allocator) []vsock_mod.PortMap {
    const raw = getenv("MACHINEN_VSOCK") orelse return &.{};
    const s = std.mem.span(raw);
    if (s.len == 0) return &.{};
    return vsock_mod.parse_env(gpa, s) catch |err| {
        std.debug.print("vsock: MACHINEN_VSOCK parse failed ({s}); ignoring\n", .{@errorName(err)});
        return &.{};
    };
}

/// Build the virtio-balloon device. `backend` must outlive the
/// returned Device — the config + request_ctx are pointers into it.
/// #263 phase B: continuous free-page reporting (no inflate driving).
fn make_balloon_device(ram: []u8, cfg: *const Config, backend: *balloon_mod.Backend) virtio.Device {
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

/// Build the virtio-vsock device. `cid_ptr` must outlive the device —
/// the config field is a pointer into it.
fn make_vsock_device(ram: []u8, cfg: *const Config, cid_ptr: *const u64) virtio.Device {
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
        // queues — we fill them on demand, not on every kick.
        .skip_notify_queues = (1 << 0) | (1 << 2),
    };
}

/// Parse `MACHINEN_VIRTIOFS_0..N` into per-slot virtio-fs backends
/// (#332, #338). One numbered env var per `--mount-live`, each:
///
///   MACHINEN_VIRTIOFS_<i>=<tag>:<mode>:<host_abs_path>
///
/// `<mode>` is `ro` or `rw`; `<host_abs_path>` is everything after the
/// second colon, so a path may itself contain colons. Numbered (rather
/// than one comma-joined var) so a host path can contain any byte.
/// A missing slot is null; a malformed value logs and is left null so
/// a typo can't prevent boot — warn-and-continue, like the other
/// device parsers here.
///
/// Each backend owns a `fuse.State` allocated from
/// `std.heap.c_allocator`: the #329 handlers issue ~tens-of-thousands
/// of tiny replies per bench and the page allocator's per-alloc
/// mmap/munmap dominated wall-clock during that bring-up. The backends
/// outlive boot() in the caller's frame; `deinit` frees the state.
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
/// given slot `base`. `backend` must outlive the returned device —
/// `config` and `request_ctx` are pointers into it.
fn make_virtio_fs_device(
    base: u64,
    ram: []u8,
    cfg: *const Config,
    backend: *virtiofs_mod.Device,
) virtio.Device {
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

/// What `handlePsci` decided. Most PSCI calls just return a value to
/// the guest; SYSTEM_OFF / SYSTEM_RESET ask the run loop to stop.
const PsciOutcome = enum { handled, shutdown };

/// Decode and respond to a PSCI HVC/SMC. Returns `.shutdown` only on
/// SYSTEM_OFF / SYSTEM_RESET; all other cases are answered in-place.
fn handle_psci(vcpu: hvf.Vcpu) !PsciOutcome {
    const f = try hvf.Psci.decode(vcpu) orelse return .handled;
    switch (f) {
        .system_off, .system_reset => return .shutdown,
        .version => {
            // PSCI 1.0 = major 1, minor 0.
            try vcpu.set_reg(.x0, 0x0001_0000);
        },
        .migrate_info_type => {
            // "Not present" — no migratable trusted OS.
            try vcpu.set_reg(.x0, 2);
        },
        .affinity_info_64 => {
            // CPU 0 is "ON." The kernel queries this as part of setup;
            // anything else gets NOT_SUPPORTED.
            const x1 = try vcpu.get_reg(.x1);
            try vcpu.set_reg(.x0, if (x1 == 0) 0 else @bitCast(@as(i64, -1)));
        },
        .cpu_off, .cpu_on_64, .features => {
            // We only support one CPU and no optional features.
            try vcpu.set_reg(.x0, @bitCast(@as(i64, -1)));
        },
        _ => {
            try vcpu.set_reg(.x0, @bitCast(@as(i64, -1)));
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
    root_blk: ?*blk_mod.Backend,
    blk_dev: ?*virtio.Device,
    blk2_dev: ?*virtio.Device,
    blk3_dev: ?*virtio.Device,
    blk4_dev: ?*virtio.Device,
    vsock_dev: ?*virtio.Device,
    vsock_bridge: ?*vsock_mod.Bridge,
    balloon_dev: ?*virtio.Device,
    nested: bool,
    nested_poweroff: *nested_poweroff.Detector,

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

/// A virtio-fs slot whose MMIO window owns an IPA, paired with its IRQ.
const VirtiofsMatch = struct { dev: *virtio.Device, irq: u32 };

/// Find the virtio-fs slot (if any) whose MMIO window owns `ipa`.
fn virtiofs_match(devs: *const Devices, irqs: IrqMap, ipa: u64) ?VirtiofsMatch {
    for (devs.virtiofs_devs, irqs.virtiofs) |dev_opt, irq| {
        if (dev_opt) |d| {
            if (d.handles(ipa)) return .{ .dev = d, .irq = irq };
        }
    }
    return null;
}

fn handle_vsock_data_abort(
    vcpu: hvf.Vcpu,
    devs: *const Devices,
    irqs: IrqMap,
    info: hvf.DataAbort,
) !bool {
    assert(irqs.vsock >= 32);
    const dev = devs.vsock_dev orelse return false;
    if (!dev.handles(info.ipa)) return false;

    // The vCPU side of (RMW interrupt_status + setSpi) must serialise
    // against the bridge poll thread's same pair. Apple's hv_gic_set_spi
    // appears to absorb the race in practice, but the hazard is the same
    // as on KVM — taking the bridge lock keeps both backends identical.
    if (devs.vsock_bridge) |b| b.mu.lock();
    defer if (devs.vsock_bridge) |b| b.mu.unlock();
    try handle_virtio_mmio(dev, irqs.vsock, vcpu, info);
    return true;
}

/// Route a data-abort MMIO fault to the device that owns the IPA, then
/// advance PC past the faulting load/store. This is the dispatch table
/// — the per-device helpers do the actual read/write.
fn route_data_abort(
    vcpu: hvf.Vcpu,
    devs: *const Devices,
    irqs: IrqMap,
    info: hvf.DataAbort,
) !void {
    if (devs.uart.handles(info.ipa)) {
        try handle_pl011_mmio(devs.uart, vcpu, info, irqs.pl011, devs.nested, devs.nested_poweroff);
        return advance_past_mmio(vcpu);
    }
    if (info.ipa >= 0x0800_0000 and info.ipa < 0x0801_0000) {
        try handle_gic_dist_mmio(vcpu, info);
        return advance_past_mmio(vcpu);
    }
    if (devs.netdev.handles(info.ipa)) {
        try handle_virtio_mmio(devs.netdev, irqs.net, vcpu, info);
        return advance_past_mmio(vcpu);
    }
    if (devs.blk_dev) |dev| {
        if (dev.handles(info.ipa)) {
            try handle_virtio_mmio(dev, irqs.blk, vcpu, info);
            return advance_past_mmio(vcpu);
        }
    }
    if (devs.blk2_dev) |dev| {
        if (dev.handles(info.ipa)) {
            try handle_virtio_mmio(dev, irqs.blk2, vcpu, info);
            return advance_past_mmio(vcpu);
        }
    }
    if (devs.blk3_dev) |dev| {
        if (dev.handles(info.ipa)) {
            try handle_virtio_mmio(dev, irqs.blk3, vcpu, info);
            return advance_past_mmio(vcpu);
        }
    }
    if (devs.blk4_dev) |dev| {
        if (dev.handles(info.ipa)) {
            try handle_virtio_mmio(dev, irqs.blk4, vcpu, info);
            return advance_past_mmio(vcpu);
        }
    }
    if (try handle_vsock_data_abort(vcpu, devs, irqs, info)) {
        return advance_past_mmio(vcpu);
    }
    if (devs.balloon_dev) |dev| {
        if (dev.handles(info.ipa)) {
            try handle_virtio_mmio(dev, irqs.balloon, vcpu, info);
            return advance_past_mmio(vcpu);
        }
    }
    if (virtiofs_match(devs, irqs, info.ipa)) |m| {
        // virtio-fs request handling is synchronous on this thread —
        // `handleVirtioMmio` → `dev.write` → `notify` drains the chain
        // through `virtiofs.Device.handleRequest` inline. No bridge
        // lock to take (unlike vsock): there's no host poll thread.
        try handle_virtio_mmio(m.dev, m.irq, vcpu, info);
        return advance_past_mmio(vcpu);
    }
    if (info.ipa >= 0x1000_0000 and info.ipa < 0x1200_0000) {
        try handle_gic_rdist_mmio(vcpu, info);
        return advance_past_mmio(vcpu);
    }
    try handle_unknown_mmio(vcpu, info);
    return advance_past_mmio(vcpu);
}

/// Sync the PL011 IRQ line to the UART's current state. Called from
/// the vCPU thread after any PL011 MMIO that can change imsc/ris (the
/// kernel masking interrupts in its ISR is the common case). The
/// stdin thread does its own update after pushing bytes.
fn sync_pl011_irq(uart: *hvf.Pl011, irq: u32) void {
    assert(irq >= 32);
    set_spi_best_effort(irq, uart.irq_asserted());
}

/// PL011 MMIO. DR-write echoes to host stderr so the user sees guest
/// console output live; every access resyncs the IRQ line.
fn handle_pl011_mmio(
    uart: *hvf.Pl011,
    vcpu: hvf.Vcpu,
    info: hvf.DataAbort,
    irq: u32,
    nested: bool,
    poweroff: *nested_poweroff.Detector,
) !void {
    assert(uart.handles(info.ipa));
    if (info.is_write) {
        const value = try info.read_source(vcpu);
        uart.write(info.ipa, value);
        if ((info.ipa - uart.base) == 0) {
            const byte: [1]u8 = .{@truncate(value)};
            _ = write(2, &byte, 1);
            if (nested) poweroff.observe(byte[0]);
        }
    } else {
        const v = uart.read(info.ipa);
        if (info.srt != 31) {
            const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
            try vcpu.set_reg(reg, v);
        }
    }
    sync_pl011_irq(uart, irq);
}

/// virtio-MMIO read/write + raise/lower the SPI based on the device's
/// post-access interrupt_status. Shared shape across net / blk / blk2;
/// vsock callers wrap this in `bridge.mu` per the locking note in
/// `vsock.Bridge.handleTxChain`.
fn handle_virtio_mmio(
    dev: *virtio.Device,
    irq: u32,
    vcpu: hvf.Vcpu,
    info: hvf.DataAbort,
) !void {
    assert(dev.handles(info.ipa));
    assert(irq >= 32);
    if (info.is_write) {
        const value = try info.read_source(vcpu);
        dev.write(info.ipa, value);
    } else {
        if (info.srt != 31) {
            const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
            try vcpu.set_reg(reg, dev.read(info.ipa));
        }
    }
    set_spi_best_effort(irq, @atomicLoad(u32, &dev.interrupt_status, .acquire) != 0);
}

/// GIC distributor MMIO ([0x0800_0000, 0x0801_0000)). Routes the
/// access to HVF; reads land in the target register.
fn handle_gic_dist_mmio(vcpu: hvf.Vcpu, info: hvf.DataAbort) !void {
    const offset: u32 = @truncate(info.ipa - 0x0800_0000);
    if (info.is_write) {
        const value = try info.read_source(vcpu);
        hvf.Gic.write_distributor(offset, value);
    } else {
        if (info.srt != 31) {
            const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
            try vcpu.set_reg(reg, hvf.Gic.read_distributor(offset));
        }
    }
}

/// GIC redistributor MMIO ([0x1000_0000, 0x1200_0000)). Each vCPU's
/// frame is 128 KB; for our single-vCPU setup, frame 0 is the only
/// one and the offset within it is the HVF register.
fn handle_gic_rdist_mmio(vcpu: hvf.Vcpu, info: hvf.DataAbort) !void {
    const offset: u32 = @truncate((info.ipa - 0x1000_0000) % 0x0002_0000);
    if (info.is_write) {
        const value = try info.read_source(vcpu);
        hvf.Gic.write_redistributor(vcpu, offset, value);
    } else {
        if (info.srt != 31) {
            const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
            try vcpu.set_reg(reg, hvf.Gic.read_redistributor(vcpu, offset));
        }
    }
}

/// MMIO outside any registered window. Reads return 0; writes are
/// dropped. Keeps the boot moving instead of crashing the run loop on
/// stray DTB-described regions we haven't hooked up yet.
fn handle_unknown_mmio(vcpu: hvf.Vcpu, info: hvf.DataAbort) !void {
    if (!info.is_write and info.srt != 31) {
        const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
        try vcpu.set_reg(reg, 0);
    }
}

fn stdin_thread_main(ctx: *StdinThread) void {
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
        ctx.uart.push_rx(buf[0..@intCast(n)]);
        // Assert the IRQ so the vCPU wakes from WFI and services it.
        set_spi_best_effort(ctx.irq, ctx.uart.irq_asserted());
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
extern "c" fn usleep(useconds: c_uint) c_int;
extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;

fn sleep_micros(useconds: c_uint) void {
    _ = usleep(useconds);
}

fn read_all(gpa: std.mem.Allocator, path: []const u8) ![]u8 {
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

    const size_signed = lseek(fd, 0, SEEK_END);
    if (size_signed < 0) return error.SeekFailed;
    _ = lseek(fd, 0, SEEK_SET);
    const size_bytes: usize = @intCast(size_signed);
    assert(size_bytes > 0);

    const buf = try gpa.alloc(u8, size_bytes);
    errdefer gpa.free(buf);

    var total_bytes: usize = 0;
    while (total_bytes < size_bytes) {
        const n_bytes = read(fd, buf[total_bytes..].ptr, size_bytes - total_bytes);
        if (n_bytes <= 0) return error.ShortRead;
        total_bytes += @intCast(n_bytes);
    }
    assert(total_bytes == size_bytes);
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

fn fixtures_present() bool {
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
    if (!fixtures_present()) {
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
