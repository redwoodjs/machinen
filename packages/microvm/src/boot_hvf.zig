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
        @compileError("boot_hvf.zig only builds on macOS (uses HVF)");
    }
}

const hvf = @import("hvf.zig");
const virtio = @import("virtio.zig");
const net_mod = @import("net_socket.zig");
const blk_mod = @import("blk.zig");
const vsock_mod = @import("vsock.zig");

// Guest-physical bases. Each virtio-MMIO device lives in a 0x200
// window. The DTS has 32 slots at 0x0A000000 + i*0x200; we wire up
// the first four.
//
// Slot 0 = net, slot 1 = blk (rootdisk), slot 2 = vsock,
// slot 3 = blk2 (scratch / CRIU disk). When both blk slots are
// populated the kernel sees them in DTB order, so slot 1 = /dev/vda
// (rootfs) and slot 3 = /dev/vdb (scratch). When only one is
// populated, Linux still names the lone device /dev/vda regardless
// of its slot. See #114.
const virtio_net_base: u64 = 0x0A00_0000;
const virtio_net_size: u64 = 0x200;
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

/// Overwrite the `linux,initrd-end` u32 cell in a DTB with `new_end`.
///
/// The DTB is the Flattened Device Tree format (big-endian on the
/// wire). Linux treats [initrd-start, initrd-end) as the initramfs
/// region and scans the whole window for cpio / compressed archives —
/// if we reserve 1 GB in the DTS but only ship a 300 MB cpio, the
/// kernel spends real wall-clock walking the tail. Patching the end
/// pointer to match the actual cpio eliminates that.
fn patchDtbInitrdEnd(dtb: []u8, new_end: u32) !void {
    if (dtb.len < 40) return error.DtbTooSmall;

    const magic = std.mem.readInt(u32, dtb[0..4], .big);
    if (magic != 0xd00dfeed) return error.DtbBadMagic;

    const off_struct = std.mem.readInt(u32, dtb[8..12], .big);
    const off_strings = std.mem.readInt(u32, dtb[12..16], .big);
    const size_strings = std.mem.readInt(u32, dtb[32..36], .big);

    if (@as(usize, off_strings) + @as(usize, size_strings) > dtb.len) return error.DtbOutOfBounds;
    if (off_struct > dtb.len) return error.DtbOutOfBounds;

    // Find "linux,initrd-end" in the strings block; record its offset
    // within that block — the value FDT_PROP entries reference.
    const needle = "linux,initrd-end\x00";
    const strings = dtb[off_strings..][0..size_strings];
    const pos = std.mem.indexOf(u8, strings, needle) orelse return error.InitrdEndNotFound;
    const name_offset: u32 = @intCast(pos);

    // FDT tokens (all big-endian u32).
    const FDT_BEGIN_NODE: u32 = 1;
    const FDT_END_NODE: u32 = 2;
    const FDT_PROP: u32 = 3;
    const FDT_NOP: u32 = 4;
    const FDT_END: u32 = 9;

    var i: usize = off_struct;
    while (i + 4 <= dtb.len) {
        const tok = std.mem.readInt(u32, dtb[i..][0..4], .big);
        i += 4;
        switch (tok) {
            FDT_BEGIN_NODE => {
                while (i < dtb.len and dtb[i] != 0) : (i += 1) {}
                if (i >= dtb.len) return error.DtbTruncated;
                i += 1; // consume null
                i = std.mem.alignForward(usize, i, 4);
            },
            FDT_END_NODE, FDT_NOP => {},
            FDT_PROP => {
                if (i + 8 > dtb.len) return error.DtbTruncated;
                const plen = std.mem.readInt(u32, dtb[i..][0..4], .big);
                const nameoff = std.mem.readInt(u32, dtb[i + 4 ..][0..4], .big);
                i += 8;
                if (nameoff == name_offset) {
                    if (plen != 4) return error.InitrdEndWrongSize;
                    if (i + 4 > dtb.len) return error.DtbTruncated;
                    std.mem.writeInt(u32, dtb[i..][0..4], new_end, .big);
                    return;
                }
                i += plen;
                i = std.mem.alignForward(usize, i, 4);
            },
            FDT_END => return error.InitrdEndNotFound,
            else => return error.DtbBadToken,
        }
    }
    return error.DtbTruncated;
}

test "patchDtbInitrdEnd round-trips a minimal hand-built DTB" {
    // Minimal FDT with one node + one property named
    // `linux,initrd-end` so the parser has something real to walk.
    // Layout (byte offsets):
    //   0x00 header (40 bytes)
    //   0x28 mem rsvmap terminator (16 zero bytes)
    //   0x38 struct block: BEGIN_NODE "" / PROP(len=4,nameoff=0,data) /
    //                      END_NODE / END  — 32 bytes
    //   0x58 strings block: "linux,initrd-end\0" — 17 bytes
    //   end  at 0x69 (105 bytes)
    var buf = [_]u8{
        // header
        0xd0, 0x0d, 0xfe, 0xed, 0x00, 0x00, 0x00, 0x69, // magic, totalsize
        0x00, 0x00, 0x00, 0x38, 0x00, 0x00, 0x00, 0x58, // off_dt_struct, off_dt_strings
        0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x11, // off_mem_rsvmap, version
        0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, // last_comp_version, boot_cpuid
        0x00, 0x00, 0x00, 0x11, 0x00, 0x00, 0x00, 0x20, // size_dt_strings (17), size_dt_struct (32)
        // mem rsvmap terminator
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        // struct block
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, // BEGIN_NODE, "" + 3 pad
        0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, // PROP, len=4
        0x00, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0xcc, 0xdd, // nameoff=0, data=0xaabbccdd
        0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x09, // END_NODE, END
        // strings block
        'l', 'i', 'n', 'u', 'x', ',', 'i', 'n',
        'i', 't', 'r', 'd', '-', 'e', 'n', 'd', 0x00,
    };
    try patchDtbInitrdEnd(&buf, 0x12345678);
    try std.testing.expectEqualSlices(u8, &[_]u8{ 0x12, 0x34, 0x56, 0x78 }, buf[0x4C..][0..4]);
}

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

    // optional initramfs
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
        patchDtbInitrdEnd(ram[cfg.dtb_offset..][0..dtb.len], initrd_end_abs) catch |err| {
            if (debugEnabled()) std.debug.print(
                "warn: patchDtbInitrdEnd failed ({s}); kernel will scan the full DTB-declared initrd window\n",
                .{@errorName(err)},
            );
        };
    }

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
    try vcpu.setReg(.x0, dtb_phys);
    try vcpu.setReg(.x1, 0);
    try vcpu.setReg(.x2, 0);
    try vcpu.setReg(.x3, 0);
    try vcpu.setReg(.pc, cfg.ram_base + img.text_offset);

    // --- run loop -------------------------------------------------
    var uart: hvf.Pl011 = .init;
    defer uart.deinit(gpa);

    // virtio-net + gvproxy (#82). The Device is the "hardware"; gvproxy
    // (containers/gvisor-tap-vsock) runs out-of-process as a user-mode
    // TCP/IP stack and we talk to it over a Unix socket that carries
    // virtio-net frames with a 4-byte length prefix — the same wire
    // protocol QEMU uses with `-netdev socket,fd=…`.
    const virtio_mac = [_]u8{ 0x02, 0xDE, 0xAD, 0xBE, 0xEF, 0x01 };
    var tx_stats = TxStats{};
    var netdev = virtio.Device{
        .base = virtio_net_base,
        .size = virtio_net_size,
        .id = .net,
        .features = (1 << 32) | (1 << 5),
        .config = &virtio_mac,
        .ram = ram,
        .ram_base = cfg.ram_base,
        .tx_handler = &onTxFrame,
        .tx_ctx = @ptrCast(&tx_stats),
    };

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

    // virtio-vsock (#44). Off by default; set MACHINEN_VSOCK to enable.
    // Syntax (comma-separated):
    //   in:<guest_port>:<host_uds>   host listens; UDS clients → guest
    //   out:<guest_port>:<host_uds>  guest connects; host dials UDS
    //   <guest_port>:<host_uds>      legacy; treated as in:
    //
    // Parsed paths are allocated from gpa and leak for the VMM's life.
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
            // queues — we fill them on demand, not on every kick.
            .skip_notify_queues = (1 << 0) | (1 << 2),
        };
    }
    const vsock_dev_ptr: ?*virtio.Device = if (vsock_dev_opt) |_| &vsock_dev_opt.? else null;

    // Connect to gvproxy if a socket path was provided. If
    // MACHINEN_NET_SOCKET isn't set, or the connect fails, fall back
    // to the classifier-only TX handler so the rest of the VMM still
    // runs gracefully.
    const net_inst: ?*net_mod.NetSocket = blk: {
        const env = getenv("MACHINEN_NET_SOCKET") orelse {
            break :blk null;
        };
        const path = std.mem.span(env);
        if (path.len == 0) break :blk null;
        break :blk net_mod.NetSocket.connect(gpa, &netdev, .{ .socket_path = path }) catch |err| {
            std.debug.print("net: connect to {s} failed: {s} — continuing without network\n", .{ path, @errorName(err) });
            break :blk null;
        };
    };
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

    var exits: usize = 0;
    var saw_off = false;

    // IRQs. DTS gives each device a SPI number (0-based within SPIs):
    //   PL011 UART:  interrupts = <0 1  4>  -> SPI #1
    //   virtio-mmio: interrupts = <0 16 1>  -> SPI #16
    // The absolute GIC id is `spi.base + <n>`.
    const spi = try hvf.Gic.spiRange();
    const pl011_irq: u32 = spi.base + 1;
    // DTS interrupts = <0 N 1> for each virtio-mmio slot. Slots:
    //   slot 0 → SPI #16 (net)
    //   slot 1 → SPI #17 (blk / rootdisk)
    //   slot 2 → SPI #18 (vsock)
    //   slot 3 → SPI #19 (blk2 / scratch)
    const virtio_irq: u32 = spi.base + 16;
    const virtio_blk_irq: u32 = spi.base + 17;
    const virtio_vsock_irq: u32 = spi.base + 18;
    const virtio_blk2_irq: u32 = spi.base + 19;

    // Feed the virtio IRQ id into the network bridge, and arm the
    // RX callback so the net backend can raise the SPI after each
    // frame it injects.
    net_ctx.virtio_irq = virtio_irq;
    if (net_inst) |n| {
        n.on_rx = &onNetRx;
        n.on_rx_ctx = @ptrCast(&net_ctx);
    }

    // virtio-vsock bridge startup.
    var vsock_irq_ctx = VsockIrqCtx{ .irq = virtio_vsock_irq };
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
        .irq = pl011_irq,
        .gpa = gpa,
    };
    const stdin_thread = try std.Thread.spawn(.{}, stdinThreadMain, .{&stdin_ctx});
    defer {
        stdin_ctx.stop.store(true, .release);
        stdin_thread.detach();
    }

    // Helper: sync the PL011 IRQ line to match the UART's current state.
    // Called by the main thread after any MMIO access that can change
    // imsc/ris (e.g. the kernel masking interrupts in its ISR). The
    // stdin thread does its own update after pushing bytes.
    const syncIrq = struct {
        fn call(u: *hvf.Pl011, id: u32) void {
            hvf.Gic.setSpi(id, u.irqAsserted()) catch {};
        }
    }.call;

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
                        // Echo DR writes (offset 0) to host stderr so the
                        // user sees guest console output live.
                        if ((info.ipa - uart.base) == 0) {
                            const byte: [1]u8 = .{@truncate(value)};
                            _ = write(2, &byte, 1);
                        }
                        // The guest may have masked/unmasked or cleared
                        // interrupts — resync the PL011 IRQ line.
                        syncIrq(&uart, pl011_irq);
                    } else {
                        // Reads: return the UART's answer into the target
                        // register so the guest sees valid flags.
                        const v = uart.read(info.ipa);
                        if (info.srt != 31) {
                            const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
                            try vcpu.setReg(reg, v);
                        }
                        // A DR read drains rx_buf; resync the IRQ line.
                        syncIrq(&uart, pl011_irq);
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
                } else if (netdev.handles(info.ipa)) {
                    if (info.is_write) {
                        const value = try info.readSource(vcpu);
                        netdev.write(info.ipa, value);
                    } else if (info.srt != 31) {
                        const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
                        try vcpu.setReg(reg, netdev.read(info.ipa));
                    }
                    hvf.Gic.setSpi(virtio_irq, @atomicLoad(u32, &netdev.interrupt_status, .acquire) != 0) catch {};
                } else if (blkdev_ptr != null and blkdev_ptr.?.handles(info.ipa)) {
                    const d = blkdev_ptr.?;
                    if (info.is_write) {
                        const value = try info.readSource(vcpu);
                        d.write(info.ipa, value);
                    } else if (info.srt != 31) {
                        const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
                        try vcpu.setReg(reg, d.read(info.ipa));
                    }
                    hvf.Gic.setSpi(virtio_blk_irq, @atomicLoad(u32, &d.interrupt_status, .acquire) != 0) catch {};
                } else if (blk2dev_ptr != null and blk2dev_ptr.?.handles(info.ipa)) {
                    const d = blk2dev_ptr.?;
                    if (info.is_write) {
                        const value = try info.readSource(vcpu);
                        d.write(info.ipa, value);
                    } else if (info.srt != 31) {
                        const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
                        try vcpu.setReg(reg, d.read(info.ipa));
                    }
                    hvf.Gic.setSpi(virtio_blk2_irq, @atomicLoad(u32, &d.interrupt_status, .acquire) != 0) catch {};
                } else if (vsock_dev_ptr != null and vsock_dev_ptr.?.handles(info.ipa)) {
                    const d = vsock_dev_ptr.?;
                    // The vCPU side of (RMW interrupt_status + setSpi)
                    // must serialise against the bridge poll thread's
                    // same pair. Apple's hv_gic_set_spi appears to
                    // absorb the race in practice, but the underlying
                    // hazard is the same as on KVM (where it bites
                    // hard) — taking the bridge lock here makes the
                    // semantics identical across backends and removes
                    // a latent footgun. handleTxChain assumes the
                    // caller holds bridge.mu; see its docstring.
                    if (vsock_bridge_opt) |b| b.mu.lock();
                    defer if (vsock_bridge_opt) |b| b.mu.unlock();
                    if (info.is_write) {
                        const value = try info.readSource(vcpu);
                        d.write(info.ipa, value);
                    } else if (info.srt != 31) {
                        const reg: hvf.Reg = @enumFromInt(@as(u32, info.srt));
                        try vcpu.setReg(reg, d.read(info.ipa));
                    }
                    hvf.Gic.setSpi(virtio_vsock_irq, @atomicLoad(u32, &d.interrupt_status, .acquire) != 0) catch {};
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

        // Test-mode stop condition: we've seen enough serial output to
        // be confident the kernel booted far enough to prove our point.
        // Production boots set `unbounded_serial` so the loop ends only
        // on PSCI SYSTEM_OFF (or max_exits).
        if (!cfg.unbounded_serial and uart.captured.items.len >= cfg.capture_bytes) break;
    }

    if (exits >= cfg.max_exits) return error.RanTooLong;

    const serial = try gpa.dupe(u8, uart.captured.items);
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
    const bridge: *NetBridge = @ptrCast(@alignCast(ctx.?));
    // Still log for smoke tests and diagnostics.
    onTxFrame(@ptrCast(bridge.stats), frame);
    if (bridge.net) |n| n.input(frame);
}

fn onNetRx(ctx: ?*anyopaque) void {
    const bridge: *NetBridge = @ptrCast(@alignCast(ctx.?));
    // Device's interrupt_status was set inside injectRx. Sync the GIC
    // line so the guest sees a pending interrupt.
    hvf.Gic.setSpi(bridge.virtio_irq, true) catch {};
}

/// Opaque box holding the vsock virtio IRQ id. The Bridge thread calls
/// the raise_irq callback; we carry the id so the callback doesn't
/// capture a stack slot that may have moved.
pub const VsockIrqCtx = struct { irq: u32 };

fn onVsockIrq(ctx: ?*anyopaque) void {
    const c: *VsockIrqCtx = @ptrCast(@alignCast(ctx.?));
    hvf.Gic.setSpi(c.irq, true) catch {};
}

fn onTxFrame(ctx: ?*anyopaque, frame: []const u8) void {
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

fn stdinThreadMain(ctx: *StdinThread) void {
    var buf: [256]u8 = undefined;
    while (!ctx.stop.load(.acquire)) {
        const n = read(0, &buf, buf.len);
        if (n <= 0) {
            // EOF or error — stop polling. The guest can keep running;
            // it just won't receive any more serial input.
            return;
        }
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
