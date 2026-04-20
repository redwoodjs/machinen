//! Minimal virtio-MMIO device emulation.
//!
//! v0.1 (#46 milestone M1): serve the register window well enough
//! that the Linux `virtio_mmio` bus driver probes the device, goes
//! through the init handshake, and reaches DRIVER_OK without aborting.
//! No virtqueue parsing yet — the kernel will see a device with zero
//! queues and move on.
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

/// Per-queue state tracked for each configured virtqueue. We don't
/// parse descriptors yet (M2 job); we just remember what the driver
/// told us so reads round-trip and we don't bail mid-handshake.
pub const Queue = struct {
    num: u32 = 0,
    ready: u32 = 0,
    desc_addr: u64 = 0,
    driver_addr: u64 = 0,
    device_addr: u64 = 0,
};

/// A minimum virtio-MMIO device. This struct is the state the kernel
/// pokes via MMIO reads/writes. We accept queue configuration so the
/// driver reaches DRIVER_OK; servicing queues is the next milestone.
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

    status: Status = .{},
    device_features_sel: u32 = 0,
    driver_features: u64 = 0,
    driver_features_sel: u32 = 0,
    queue_sel: u32 = 0,
    config_generation: u32 = 0,
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
            0x060 => 0, // InterruptStatus — nothing pending until M2
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
            0x050 => {}, // QueueNotify doorbell — the driver kicks; we don't service yet
            0x064 => {}, // InterruptACK — nothing to ack
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
