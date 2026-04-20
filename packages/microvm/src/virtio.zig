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

/// A minimum virtio-MMIO device. This struct is the state the kernel
/// pokes via MMIO reads/writes. v0.1 has no queues so most of the
/// queue-side state is present-but-ignored.
pub const Device = struct {
    base: u64,
    size: u64 = 0x200,
    id: DeviceId,
    /// 64-bit feature bitmap. Bits 0..31 are device-type specific,
    /// bits 32..63 are transport features (e.g. VIRTIO_F_VERSION_1 = bit 32).
    features: u64 = (1 << 32), // VERSION_1 always required for v2 transport

    status: Status = .{},
    device_features_sel: u32 = 0,
    driver_features: u64 = 0,
    driver_features_sel: u32 = 0,
    queue_sel: u32 = 0,
    config_generation: u32 = 0,

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
            0x034 => 0, // QueueNumMax — 0 means "no queues supported here" (M1)
            0x044 => 0, // QueueReady
            0x060 => 0, // InterruptStatus
            0x070 => @as(u32, @bitCast(self.status)),
            0x0FC => self.config_generation,
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
            0x038, 0x044, 0x050, 0x064 => {}, // QueueNum, QueueReady, QueueNotify, InterruptACK — ignored in M1
            0x070 => self.status = @bitCast(v32),
            // Queue address registers: driver writes them; we ignore
            // them in M1 because QueueNumMax=0 means "no queues."
            0x080, 0x084, 0x090, 0x094, 0x0A0, 0x0A4 => {},
            else => {},
        }
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

test "virtio: QueueNumMax is 0 so the kernel skips queue setup" {
    var dev = Device{ .base = 0x0A00_0000, .id = .net };
    dev.write(0x0A00_0000 + 0x030, 0); // select queue 0
    try std.testing.expectEqual(@as(u64, 0), dev.read(0x0A00_0000 + 0x034));
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
