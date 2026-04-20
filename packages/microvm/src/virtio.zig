//! Minimal virtio-MMIO device emulation.
//!
//! M1 (#46): serve the register window so Linux's `virtio_mmio` bus
//! driver probes us, walks the init handshake, and reaches DRIVER_OK
//! without aborting. virtio-net creates an eth0 interface.
//!
//! M2 (#46): parse the guest-posted descriptor/avail/used rings. When
//! the driver kicks the TX queue doorbell, walk each available
//! descriptor chain, drop the packet (null backend), post the
//! descriptor back on the used ring, and raise the device IRQ. The
//! receive side stays idle — no fake packets are manufactured — but
//! bringing up eth0 and attempting TX no longer stalls the driver.
//!
//! Register layout (virtio v1.1, MMIO transport):
//!
//!   0x000  MagicValue        RO  "virt" (0x74726976) — kernel panics if not this
//!   0x004  Version           RO  2 — modern transport
//!   0x008  DeviceID          RO  which kind of device (1 = net, 2 = blk, 19 = vsock)
//!   0x00C  VendorID          RO  any value; we return 0
//!   0x010  DeviceFeatures    RO  which features the device offers (driven by FeaturesSel)
//!   0x014  DeviceFeaturesSel RW  high or low 32 bits of features to read
//!   0x020  DriverFeatures    WO  which features the driver accepted (driven by DriverFeaturesSel)
//!   0x024  DriverFeaturesSel RW  same idea for writes
//!   0x030  QueueSel          RW  pick a queue to configure
//!   0x034  QueueNumMax       RO  max entries the device supports for selected queue
//!   0x038  QueueNum          RW  driver's chosen size for selected queue
//!   0x044  QueueReady        RW  1 = queue is live
//!   0x050  QueueNotify       WO  doorbell — driver writes queue index when buffers are ready
//!   0x060  InterruptStatus   RO  why we're interrupting
//!   0x064  InterruptACK      WO  which interrupt reasons the driver handled
//!   0x070  Status            RW  device init state machine
//!   0x080  QueueDescLow      WO ) 64-bit guest addrs, low/high halves, for selected queue:
//!   0x084  QueueDescHigh     WO )   descriptor table, available ring, used ring.
//!   0x090  QueueDriverLow    WO
//!   0x094  QueueDriverHigh   WO
//!   0x0A0  QueueDeviceLow    WO
//!   0x0A4  QueueDeviceHigh   WO
//!   0x0FC  ConfigGeneration  RO  changes when device config changes
//!   0x100+ Config space      RW  device-specific (e.g. virtio-net MAC lives here)

const std = @import("std");

pub const magic: u32 = 0x74726976; // 'v','i','r','t' little-endian
pub const version: u32 = 2;

/// virtio-MMIO device IDs. Only the ones we care about.
pub const DeviceId = enum(u32) {
    none = 0,
    net = 1,
    block = 2,
    console = 3,
    rng = 4,
    vsock = 19,
    _,
};

/// virtio device-status bits the driver sets as it walks init.
pub const Status = packed struct(u32) {
    acknowledge: bool = false, // 1
    driver: bool = false, // 2
    driver_ok: bool = false, // 4
    features_ok: bool = false, // 8
    _reserved_0: u2 = 0,
    device_needs_reset: bool = false, // 64
    failed: bool = false, // 128
    _reserved_1: u24 = 0,
};

/// Max number of queues we let the driver configure. virtio-net
/// uses 2 (RX, TX); reserving extra room is cheap.
pub const max_queues: u32 = 8;

/// Interrupt-status bits the driver expects to see at 0x060.
pub const IRQ_USED_BUFFER: u32 = 1 << 0; // VIRTIO_MMIO_INT_VRING
pub const IRQ_CONFIG_CHANGE: u32 = 1 << 1; // VIRTIO_MMIO_INT_CONFIG

/// Split-ring descriptor. 16 bytes, packed extern to match guest layout.
pub const VringDesc = extern struct {
    addr: u64,
    len: u32,
    flags: u16,
    next: u16,

    pub const F_NEXT: u16 = 1;
    pub const F_WRITE: u16 = 2;
    pub const F_INDIRECT: u16 = 4;
};

pub const VringAvail = extern struct {
    flags: u16,
    idx: u16,
    // ring[num] follows here; read via getRingEntry
};

pub const VringUsedElem = extern struct {
    id: u32,
    len: u32,
};

pub const VringUsed = extern struct {
    flags: u16,
    idx: u16,
    // ring[num] follows here
};

/// Per-queue state tracked for each configured virtqueue.
pub const Queue = struct {
    num: u32 = 0,
    ready: u32 = 0,
    desc_addr: u64 = 0,
    driver_addr: u64 = 0,
    device_addr: u64 = 0,
    /// Last avail->idx we've already processed. Incremented by one
    /// per descriptor chain we consume, wraps naturally modulo
    /// 65536 (driver does the same when producing).
    last_avail_idx: u16 = 0,
};

/// A minimum virtio-MMIO device. This struct is the state the kernel
/// pokes via MMIO reads/writes. With ram + ram_base wired up it can
/// also parse the queues the driver posts there.
pub const Device = struct {
    base: u64,
    size: u64 = 0x200,
    id: DeviceId,
    /// 64-bit feature bitmap. Bits 0..31 are device-type specific,
    /// bits 32..63 are transport features (e.g. VIRTIO_F_VERSION_1 = bit 32).
    features: u64 = (1 << 32), // VERSION_1 always required for v2 transport
    /// Max per-queue size we claim to support. Reported back via
    /// QueueNumMax. 256 is a common default and well within reason.
    queue_num_max: u32 = 256,
    /// Optional device-specific config space starting at offset 0x100.
    /// virtio-net uses the first 6 bytes for the MAC address when
    /// VIRTIO_NET_F_MAC is offered. Caller owns the buffer; `null`
    /// means "reads return 0."
    config: ?[]const u8 = null,
    /// Guest RAM — lets us resolve the physical addresses the driver
    /// posts in queue registers. `null` disables queue processing.
    /// `ram_base` is the guest-physical address ram[0] lives at.
    ram: ?[]u8 = null,
    ram_base: u64 = 0,

    status: Status = .{},
    device_features_sel: u32 = 0,
    driver_features: u64 = 0,
    driver_features_sel: u32 = 0,
    queue_sel: u32 = 0,
    config_generation: u32 = 0,
    interrupt_status: u32 = 0,
    queues: [max_queues]Queue = @splat(.{}),

    pub fn handles(self: *const Device, addr: u64) bool {
        return addr >= self.base and addr < self.base + self.size;
    }

    /// Handle an MMIO read. Returns the value the kernel should see.
    pub fn read(self: *const Device, addr: u64) u64 {
        const off = addr - self.base;
        return switch (off) {
            0x000 => magic,
            0x004 => version,
            0x008 => @intFromEnum(self.id),
            0x00C => 0, // VendorID — anything
            0x010 => switch (self.device_features_sel) {
                0 => @as(u32, @truncate(self.features)),
                1 => @as(u32, @truncate(self.features >> 32)),
                else => 0,
            },
            0x034 => if (self.queue_sel < max_queues) self.queue_num_max else 0,
            0x044 => if (self.queue_sel < max_queues) self.queues[self.queue_sel].ready else 0,
            0x060 => self.interrupt_status,
            0x070 => @as(u32, @bitCast(self.status)),
            0x0FC => self.config_generation,
            0x100...0x1FF => self.readConfig(@intCast(off - 0x100)),
            else => 0,
        };
    }

    /// Handle an MMIO write. Updates internal state; returns void
    /// because the caller advances PC regardless.
    pub fn write(self: *Device, addr: u64, value: u64) void {
        const off = addr - self.base;
        const v32: u32 = @truncate(value);
        switch (off) {
            0x014 => self.device_features_sel = v32,
            0x020 => switch (self.driver_features_sel) {
                0 => self.driver_features = (self.driver_features & 0xFFFF_FFFF_0000_0000) | v32,
                1 => self.driver_features = (self.driver_features & 0x0000_0000_FFFF_FFFF) | (@as(u64, v32) << 32),
                else => {},
            },
            0x024 => self.driver_features_sel = v32,
            0x030 => self.queue_sel = v32,
            0x038 => if (self.queue_sel < max_queues) {
                self.queues[self.queue_sel].num = v32;
            },
            0x044 => if (self.queue_sel < max_queues) {
                self.queues[self.queue_sel].ready = v32;
            },
            0x050 => self.notify(v32),
            0x064 => self.interrupt_status &= ~v32,
            0x070 => self.status = @bitCast(v32),
            // 64-bit guest addresses written as low/high halves. Store
            // them so reads (if any) round-trip; actual parsing is M2.
            0x080 => if (self.queue_sel < max_queues) {
                const q = &self.queues[self.queue_sel];
                q.desc_addr = (q.desc_addr & 0xFFFF_FFFF_0000_0000) | v32;
            },
            0x084 => if (self.queue_sel < max_queues) {
                const q = &self.queues[self.queue_sel];
                q.desc_addr = (q.desc_addr & 0x0000_0000_FFFF_FFFF) | (@as(u64, v32) << 32);
            },
            0x090 => if (self.queue_sel < max_queues) {
                const q = &self.queues[self.queue_sel];
                q.driver_addr = (q.driver_addr & 0xFFFF_FFFF_0000_0000) | v32;
            },
            0x094 => if (self.queue_sel < max_queues) {
                const q = &self.queues[self.queue_sel];
                q.driver_addr = (q.driver_addr & 0x0000_0000_FFFF_FFFF) | (@as(u64, v32) << 32);
            },
            0x0A0 => if (self.queue_sel < max_queues) {
                const q = &self.queues[self.queue_sel];
                q.device_addr = (q.device_addr & 0xFFFF_FFFF_0000_0000) | v32;
            },
            0x0A4 => if (self.queue_sel < max_queues) {
                const q = &self.queues[self.queue_sel];
                q.device_addr = (q.device_addr & 0x0000_0000_FFFF_FFFF) | (@as(u64, v32) << 32);
            },
            else => {},
        }
    }

    fn readConfig(self: *const Device, off: usize) u64 {
        const cfg = self.config orelse return 0;
        if (off >= cfg.len) return 0;
        return @as(u64, cfg[off]);
    }

    /// Doorbell — the driver kicks us after posting descriptors on
    /// `q_idx`. Walks the avail ring, processes every new chain, posts
    /// used entries, and raises the used-buffer interrupt bit.
    ///
    /// The receive queue (q_idx=0 for virtio-net) has no work on the
    /// null backend — the driver posts empty receive buffers and
    /// we'd only write back to them when we had an incoming packet
    /// to deliver. Leave those descriptors in avail.
    ///
    /// The transmit queue (q_idx=1) has outgoing packets in the
    /// descriptors. We "send" by ignoring the data and acking the
    /// descriptor, which is exactly what the null backend should do
    /// — the kernel's TX path completes successfully, `tx_packets`
    /// counter increments, buffers get freed.
    pub fn notify(self: *Device, q_idx: u32) void {
        if (q_idx == 0) return; // RX: nothing to produce in M2
        if (q_idx >= max_queues) return;
        const q = &self.queues[q_idx];
        if (q.ready == 0 or q.num == 0) return;
        self.drainAvail(q);
    }

    fn drainAvail(self: *Device, q: *Queue) void {
        const avail = self.readAvailHeader(q) orelse return;
        while (q.last_avail_idx != avail.idx) {
            const head = self.readAvailRingEntry(q, q.last_avail_idx) orelse return;
            const total_len = self.walkDescChain(q, head);
            self.pushUsed(q, head, total_len);
            q.last_avail_idx +%= 1;
        }
        self.interrupt_status |= IRQ_USED_BUFFER;
    }

    fn walkDescChain(self: *Device, q: *Queue, head: u16) u32 {
        var total: u32 = 0;
        var idx: u16 = head;
        // Cap iterations at q.num to avoid a malicious/broken chain
        // spinning the host.
        var steps: u32 = 0;
        while (steps < q.num) : (steps += 1) {
            const desc = self.readDescriptor(q, idx) orelse return total;
            total +|= desc.len; // saturate on absurd totals
            if ((desc.flags & VringDesc.F_NEXT) == 0) return total;
            idx = desc.next;
        }
        return total;
    }

    /// Reads raw bytes from guest memory. `null` on out-of-range.
    fn guestSlice(self: *Device, addr: u64, len: usize) ?[]u8 {
        const ram = self.ram orelse return null;
        if (addr < self.ram_base) return null;
        const off: u64 = addr - self.ram_base;
        if (off + len > ram.len) return null;
        return ram[@intCast(off)..][0..len];
    }

    fn readDescriptor(self: *Device, q: *const Queue, idx: u16) ?VringDesc {
        if (idx >= q.num) return null;
        const offset: u64 = q.desc_addr + @as(u64, idx) * @sizeOf(VringDesc);
        const bytes = self.guestSlice(offset, @sizeOf(VringDesc)) orelse return null;
        var d: VringDesc = undefined;
        @memcpy(std.mem.asBytes(&d), bytes);
        return d;
    }

    fn readAvailHeader(self: *Device, q: *const Queue) ?VringAvail {
        const bytes = self.guestSlice(q.driver_addr, @sizeOf(VringAvail)) orelse return null;
        var a: VringAvail = undefined;
        @memcpy(std.mem.asBytes(&a), bytes);
        return a;
    }

    fn readAvailRingEntry(self: *Device, q: *const Queue, idx: u16) ?u16 {
        // avail.ring follows the 4-byte avail header.
        const slot: u32 = @as(u32, idx) % q.num;
        const offset: u64 = q.driver_addr + @sizeOf(VringAvail) + @as(u64, slot) * @sizeOf(u16);
        const bytes = self.guestSlice(offset, @sizeOf(u16)) orelse return null;
        return std.mem.readInt(u16, bytes[0..2], .little);
    }

    fn pushUsed(self: *Device, q: *Queue, id: u16, len: u32) void {
        // used header (4 bytes) + used.ring[num] of VringUsedElem (8 bytes each)
        const used_bytes = self.guestSlice(q.device_addr, @sizeOf(VringUsed)) orelse return;
        var header: VringUsed = undefined;
        @memcpy(std.mem.asBytes(&header), used_bytes);
        const slot: u32 = @as(u32, header.idx) % q.num;

        const elem_off: u64 = q.device_addr + @sizeOf(VringUsed) + @as(u64, slot) * @sizeOf(VringUsedElem);
        const elem_bytes = self.guestSlice(elem_off, @sizeOf(VringUsedElem)) orelse return;
        const elem = VringUsedElem{ .id = id, .len = len };
        @memcpy(elem_bytes, std.mem.asBytes(&elem));

        // Bump the used.idx — the driver watches this to learn about
        // completions. Write back into guest memory.
        header.idx +%= 1;
        @memcpy(used_bytes, std.mem.asBytes(&header));
    }
};

// =============================================================
// Tests — pure data, no HVF.
// =============================================================

test "virtio: magic + version + device ID at fixed offsets" {
    var dev = Device{ .base = 0x0A00_0000, .id = .net };
    try std.testing.expectEqual(@as(u64, magic), dev.read(0x0A00_0000 + 0x000));
    try std.testing.expectEqual(@as(u64, 2), dev.read(0x0A00_0000 + 0x004));
    try std.testing.expectEqual(@as(u64, 1), dev.read(0x0A00_0000 + 0x008));
}

test "virtio: DeviceFeatures returns low or high half based on sel" {
    var dev = Device{ .base = 0x0A00_0000, .id = .net, .features = 0x1234_5678_ABCD_EF01 };

    dev.write(0x0A00_0000 + 0x014, 0); // select low
    try std.testing.expectEqual(@as(u64, 0xABCD_EF01), dev.read(0x0A00_0000 + 0x010));

    dev.write(0x0A00_0000 + 0x014, 1); // select high
    try std.testing.expectEqual(@as(u64, 0x1234_5678), dev.read(0x0A00_0000 + 0x010));
}

test "virtio: Status register round-trips driver writes" {
    var dev = Device{ .base = 0x0A00_0000, .id = .net };
    // Driver walks: ACK → DRIVER → FEATURES_OK → DRIVER_OK
    dev.write(0x0A00_0000 + 0x070, 0b0001); // ACK
    try std.testing.expect(dev.status.acknowledge);

    dev.write(0x0A00_0000 + 0x070, 0b0011); // ACK | DRIVER
    try std.testing.expect(dev.status.driver);

    dev.write(0x0A00_0000 + 0x070, 0b1111); // plus FEATURES_OK | DRIVER_OK
    try std.testing.expect(dev.status.features_ok);
    try std.testing.expect(dev.status.driver_ok);
}

test "virtio: QueueNumMax is reported so the driver can size its queues" {
    var dev = Device{ .base = 0x0A00_0000, .id = .net, .queue_num_max = 256 };
    dev.write(0x0A00_0000 + 0x030, 0); // select queue 0
    try std.testing.expectEqual(@as(u64, 256), dev.read(0x0A00_0000 + 0x034));
    // Out-of-range queue index: report 0 so the driver stops iterating.
    dev.write(0x0A00_0000 + 0x030, max_queues);
    try std.testing.expectEqual(@as(u64, 0), dev.read(0x0A00_0000 + 0x034));
}

test "virtio: queue addresses round-trip per queue" {
    var dev = Device{ .base = 0x0A00_0000, .id = .net };
    // Select queue 1, write desc_addr in low+high halves.
    dev.write(0x0A00_0000 + 0x030, 1);
    dev.write(0x0A00_0000 + 0x080, 0xCAFE_BABE); // low
    dev.write(0x0A00_0000 + 0x084, 0xDEAD_BEEF); // high
    dev.write(0x0A00_0000 + 0x038, 128); // QueueNum
    dev.write(0x0A00_0000 + 0x044, 1); // QueueReady

    try std.testing.expectEqual(@as(u64, 0xDEAD_BEEF_CAFE_BABE), dev.queues[1].desc_addr);
    try std.testing.expectEqual(@as(u32, 128), dev.queues[1].num);
    try std.testing.expectEqual(@as(u64, 1), dev.read(0x0A00_0000 + 0x044));
    // Queue 0 untouched.
    try std.testing.expectEqual(@as(u64, 0), dev.queues[0].desc_addr);
}

test "virtio: config-space reads pass through a caller-owned buffer" {
    const mac = [_]u8{ 0x02, 0x00, 0x00, 0x11, 0x22, 0x33 };
    var dev = Device{ .base = 0x0A00_0000, .id = .net, .config = &mac };
    try std.testing.expectEqual(@as(u64, 0x02), dev.read(0x0A00_0000 + 0x100));
    try std.testing.expectEqual(@as(u64, 0x33), dev.read(0x0A00_0000 + 0x105));
    try std.testing.expectEqual(@as(u64, 0), dev.read(0x0A00_0000 + 0x106));
}

test "virtio: handles() bounds the MMIO window" {
    var dev = Device{ .base = 0x0A00_0000, .id = .net, .size = 0x200 };
    try std.testing.expect(dev.handles(0x0A00_0000));
    try std.testing.expect(dev.handles(0x0A00_0000 + 0x1FF));
    try std.testing.expect(!dev.handles(0x0A00_0000 + 0x200));
    try std.testing.expect(!dev.handles(0x09FF_FFFF));
}

test "virtio: DriverFeatures are written into the right half based on sel" {
    var dev = Device{ .base = 0x0A00_0000, .id = .net };
    dev.write(0x0A00_0000 + 0x024, 0); // select low
    dev.write(0x0A00_0000 + 0x020, 0x1234_5678);
    dev.write(0x0A00_0000 + 0x024, 1); // select high
    dev.write(0x0A00_0000 + 0x020, 0xABCD);
    try std.testing.expectEqual(@as(u64, 0x0000_ABCD_1234_5678), dev.driver_features);
}

// --- virtqueue processing (M2) -------------------------------------
//
// These tests put a fake ring in a flat byte buffer, point a Device at
// it, kick the doorbell, and check that the used ring + interrupt
// status reflect the work. No HVF, no real kernel.

fn setupRing(ram: []u8, comptime num: u32) struct { q: Queue } {
    _ = ram;
    // Lay out descriptor table, avail, used back-to-back starting at 0.
    const q = Queue{
        .num = num,
        .ready = 1,
        .desc_addr = 0,
        .driver_addr = num * @sizeOf(VringDesc),
        .device_addr = num * @sizeOf(VringDesc) + @sizeOf(VringAvail) + num * @sizeOf(u16),
    };
    return .{ .q = q };
}

test "virtio: notify acks a single-descriptor TX chain + raises IRQ" {
    const num = 8;
    var ram: [4096]u8 = @splat(0);
    var dev = Device{
        .base = 0x0A00_0000,
        .id = .net,
        .ram = &ram,
        .ram_base = 0, // our ram[0] is guest-phys 0 for this test
    };
    const r = setupRing(&ram, num);
    dev.queues[1] = r.q;

    // Descriptor 0: points at a 64-byte "packet" at offset 0x200 in ram.
    const desc0 = VringDesc{ .addr = 0x200, .len = 64, .flags = 0, .next = 0 };
    @memcpy(ram[0..@sizeOf(VringDesc)], std.mem.asBytes(&desc0));

    // Avail ring: idx=1, ring[0]=0 (descriptor 0 is the head).
    const avail = VringAvail{ .flags = 0, .idx = 1 };
    @memcpy(ram[r.q.driver_addr..][0..@sizeOf(VringAvail)], std.mem.asBytes(&avail));
    const ring_slot = r.q.driver_addr + @sizeOf(VringAvail);
    std.mem.writeInt(u16, ram[ring_slot..][0..2], 0, .little);

    // Kick TX queue 1.
    dev.notify(1);

    // Used ring now has one entry: { id=0, len=64 }, used.idx=1.
    var used_hdr: VringUsed = undefined;
    @memcpy(std.mem.asBytes(&used_hdr), ram[r.q.device_addr..][0..@sizeOf(VringUsed)]);
    try std.testing.expectEqual(@as(u16, 1), used_hdr.idx);

    const elem_off = r.q.device_addr + @sizeOf(VringUsed);
    var elem: VringUsedElem = undefined;
    @memcpy(std.mem.asBytes(&elem), ram[elem_off..][0..@sizeOf(VringUsedElem)]);
    try std.testing.expectEqual(@as(u32, 0), elem.id);
    try std.testing.expectEqual(@as(u32, 64), elem.len);

    try std.testing.expectEqual(IRQ_USED_BUFFER, dev.interrupt_status & IRQ_USED_BUFFER);
    try std.testing.expectEqual(@as(u16, 1), dev.queues[1].last_avail_idx);
}

test "virtio: notify follows F_NEXT chains and sums lengths" {
    const num = 8;
    var ram: [4096]u8 = @splat(0);
    var dev = Device{ .base = 0x0A00_0000, .id = .net, .ram = &ram, .ram_base = 0 };
    const r = setupRing(&ram, num);
    dev.queues[1] = r.q;

    // desc0 -> desc1 -> desc2 (end). Lengths 10 + 20 + 30 = 60.
    const descs = [_]VringDesc{
        .{ .addr = 0x300, .len = 10, .flags = VringDesc.F_NEXT, .next = 1 },
        .{ .addr = 0x310, .len = 20, .flags = VringDesc.F_NEXT, .next = 2 },
        .{ .addr = 0x330, .len = 30, .flags = 0, .next = 0 },
    };
    const desc_bytes = std.mem.sliceAsBytes(&descs);
    @memcpy(ram[0..desc_bytes.len], desc_bytes);

    const avail = VringAvail{ .flags = 0, .idx = 1 };
    @memcpy(ram[r.q.driver_addr..][0..@sizeOf(VringAvail)], std.mem.asBytes(&avail));
    std.mem.writeInt(u16, ram[r.q.driver_addr + @sizeOf(VringAvail) ..][0..2], 0, .little);

    dev.notify(1);

    const elem_off = r.q.device_addr + @sizeOf(VringUsed);
    var elem: VringUsedElem = undefined;
    @memcpy(std.mem.asBytes(&elem), ram[elem_off..][0..@sizeOf(VringUsedElem)]);
    try std.testing.expectEqual(@as(u32, 0), elem.id); // head is still desc 0
    try std.testing.expectEqual(@as(u32, 60), elem.len); // 10 + 20 + 30
}

test "virtio: notify on RX queue is a no-op (null backend)" {
    const num = 8;
    var ram: [4096]u8 = @splat(0);
    var dev = Device{ .base = 0x0A00_0000, .id = .net, .ram = &ram, .ram_base = 0 };
    const r = setupRing(&ram, num);
    dev.queues[0] = r.q;

    // Pretend there's an avail waiting.
    const avail = VringAvail{ .flags = 0, .idx = 1 };
    @memcpy(ram[r.q.driver_addr..][0..@sizeOf(VringAvail)], std.mem.asBytes(&avail));

    dev.notify(0);

    // Neither last_avail_idx nor interrupt_status changes.
    try std.testing.expectEqual(@as(u16, 0), dev.queues[0].last_avail_idx);
    try std.testing.expectEqual(@as(u32, 0), dev.interrupt_status);
}

test "virtio: InterruptACK clears the bits the driver wrote" {
    var dev = Device{ .base = 0x0A00_0000, .id = .net };
    dev.interrupt_status = IRQ_USED_BUFFER | IRQ_CONFIG_CHANGE;
    dev.write(0x0A00_0000 + 0x064, IRQ_USED_BUFFER);
    try std.testing.expectEqual(IRQ_CONFIG_CHANGE, dev.interrupt_status);
    dev.write(0x0A00_0000 + 0x064, IRQ_CONFIG_CHANGE);
    try std.testing.expectEqual(@as(u32, 0), dev.interrupt_status);
}
