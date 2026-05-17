//! Virtio device snapshot codec + apply (tasks #28–#31).
//!
//! Captures the full runtime state of a `virtio.Device` — everything
//! the guest's driver programmed via MMIO that does NOT live in guest
//! RAM. The queue rings themselves are in guest RAM (restored by the
//! `.ram` section), but the *addresses* of those rings, the negotiated
//! features, the device status, and the device-side avail-ring cursor
//! are VMM-side state. Without them a restored guest talks to a
//! freshly-reset virtio device while its in-RAM driver state still
//! expects the old configuration — the device can't find the queues
//! and every notify is dropped.
//!
//! One codec covers blk / net / vsock / balloon / virtio-fs — virtio
//! 1.x devices share the same transport state shape, and the `device`
//! discriminant records which DeviceId the payload belongs to so
//! restore can validate it lands on the matching device. virtio-fs
//! transport state is just its hiprio + request queues; the FUSE
//! backend's host-side state is captured separately (see fuse_state.zig).
//!
//! Header (32 bytes):
//!   device u32           — DeviceId (net=1, blk=2, console=3, balloon=5, vsock=19, virtio_fs=26)
//!   queue_count u32      — number of QueueState records that follow
//!   driver_features u64  — features the guest driver accepted
//!   status u32           — virtio device-status byte (packed Status @bitCast)
//!   queue_sel u32        — currently selected queue index
//!   interrupt_status u32 — pending interrupt-status bits
//!   _reserved u32
//!
//! Body:
//!   queue_count × QueueState (40 bytes each)

const std = @import("std");
const virtio = @import("virtio.zig");

pub const DEVICE_NET: u32 = 1;
pub const DEVICE_BLK: u32 = 2;
pub const DEVICE_CONSOLE: u32 = 3;
pub const DEVICE_BALLOON: u32 = 5;
pub const DEVICE_VSOCK: u32 = 19;
pub const DEVICE_VIRTIO_FS: u32 = 26;

pub const HEADER_SIZE: usize = 32;
pub const QUEUE_ENTRY_SIZE: usize = 40;

pub const Header = extern struct {
    device: u32,
    queue_count: u32,
    driver_features: u64,
    status: u32,
    queue_sel: u32,
    interrupt_status: u32,
    _reserved: u32 = 0,
};

/// Per-queue VMM-side state — the ring base addresses + size + ready
/// flag the driver programmed via MMIO, plus the device's avail-ring
/// cursor. `last_avail_idx` is a u16 in `virtio.Queue`; widened to u32
/// here purely for a padding-free extern layout.
pub const QueueState = extern struct {
    num: u32,
    ready: u32,
    last_avail_idx: u32,
    _pad: u32 = 0,
    desc_addr: u64,
    driver_addr: u64,
    device_addr: u64,
};

comptime {
    std.debug.assert(@sizeOf(Header) == HEADER_SIZE);
    std.debug.assert(@sizeOf(QueueState) == QUEUE_ENTRY_SIZE);
}

pub const DecodeError = error{ Truncated, BadDevice } || std.mem.Allocator.Error;

pub const Snapshot = struct {
    device: u32,
    driver_features: u64,
    status: u32,
    queue_sel: u32,
    interrupt_status: u32,
    queues: []QueueState,
};

fn known_device(device: u32) bool {
    return device == DEVICE_NET or device == DEVICE_BLK or
        device == DEVICE_CONSOLE or device == DEVICE_BALLOON or
        device == DEVICE_VSOCK or device == DEVICE_VIRTIO_FS;
}

pub fn encode(
    allocator: std.mem.Allocator,
    device: u32,
    driver_features: u64,
    status: u32,
    queue_sel: u32,
    interrupt_status: u32,
    queues: []const QueueState,
) ![]u8 {
    // Tiger-style: bounded queue count + recognized device id.
    std.debug.assert(queues.len <= std.math.maxInt(u32));
    std.debug.assert(known_device(device));

    const total = HEADER_SIZE + queues.len * QUEUE_ENTRY_SIZE;
    const out = try allocator.alloc(u8, total);
    errdefer allocator.free(out);
    const hdr: Header = .{
        .device = device,
        .queue_count = @intCast(queues.len),
        .driver_features = driver_features,
        .status = status,
        .queue_sel = queue_sel,
        .interrupt_status = interrupt_status,
    };
    @memcpy(out[0..HEADER_SIZE], std.mem.asBytes(&hdr));
    var off: usize = HEADER_SIZE;
    for (queues) |q| {
        @memcpy(out[off..][0..QUEUE_ENTRY_SIZE], std.mem.asBytes(&q));
        off += QUEUE_ENTRY_SIZE;
    }
    std.debug.assert(off == total);
    return out;
}

pub fn decode(allocator: std.mem.Allocator, bytes: []const u8) DecodeError!Snapshot {
    if (bytes.len < HEADER_SIZE) return error.Truncated;
    var hdr: Header = undefined;
    @memcpy(std.mem.asBytes(&hdr), bytes[0..HEADER_SIZE]);
    if (!known_device(hdr.device)) return error.BadDevice;

    const needed = HEADER_SIZE + @as(usize, hdr.queue_count) * QUEUE_ENTRY_SIZE;
    if (needed != bytes.len) return error.Truncated;

    const queues = try allocator.alloc(QueueState, hdr.queue_count);
    var off: usize = HEADER_SIZE;
    for (queues) |*q| {
        @memcpy(std.mem.asBytes(q), bytes[off..][0..QUEUE_ENTRY_SIZE]);
        off += QUEUE_ENTRY_SIZE;
    }
    return .{
        .device = hdr.device,
        .driver_features = hdr.driver_features,
        .status = hdr.status,
        .queue_sel = hdr.queue_sel,
        .interrupt_status = hdr.interrupt_status,
        .queues = queues,
    };
}

// -- device-level dump / apply ------------------------------------

/// Serialize a live `virtio.Device`'s transport state. All
/// `virtio.max_queues` queues are captured (unused ones are zero —
/// cheap, and keeps restore a straight index-for-index copy). Caller
/// owns the returned bytes.
pub fn dump_device(allocator: std.mem.Allocator, dev: *const virtio.Device) ![]u8 {
    var queues: [virtio.max_queues]QueueState = undefined;
    for (&queues, dev.queues) |*qs, q| {
        qs.* = .{
            .num = q.num,
            .ready = q.ready,
            .last_avail_idx = q.last_avail_idx,
            .desc_addr = q.desc_addr,
            .driver_addr = q.driver_addr,
            .device_addr = q.device_addr,
        };
    }
    return encode(
        allocator,
        @intFromEnum(dev.id),
        dev.driver_features,
        @as(u32, @bitCast(dev.status)),
        dev.queue_sel,
        @atomicLoad(u32, &dev.interrupt_status, .acquire),
        &queues,
    );
}

pub const ApplyError = DecodeError || error{DeviceMismatch};

/// Replay a payload from `dumpDevice` onto a freshly-created
/// `virtio.Device`. The device must already exist with the same
/// `id`, MMIO base, and `ram`/`ram_base` wiring — this only restores
/// the driver-programmed transport state on top.
pub fn apply_device(allocator: std.mem.Allocator, dev: *virtio.Device, payload: []const u8) ApplyError!void {
    const snap = try decode(allocator, payload);
    defer allocator.free(snap.queues);
    if (snap.device != @intFromEnum(dev.id)) return error.DeviceMismatch;

    dev.driver_features = snap.driver_features;
    dev.status = @bitCast(snap.status);
    dev.queue_sel = snap.queue_sel;
    @atomicStore(u32, &dev.interrupt_status, snap.interrupt_status, .release);

    const n = @min(snap.queues.len, dev.queues.len);
    for (dev.queues[0..n], snap.queues[0..n]) |*q, qs| {
        q.num = qs.num;
        q.ready = qs.ready;
        q.desc_addr = qs.desc_addr;
        q.driver_addr = qs.driver_addr;
        q.device_addr = qs.device_addr;
        q.last_avail_idx = @truncate(qs.last_avail_idx);
    }
}

// --- tests ---

test "encode/decode round-trip preserves header + queues" {
    const a = std.testing.allocator;
    const queues = [_]QueueState{
        .{ .num = 256, .ready = 1, .last_avail_idx = 7, .desc_addr = 0x4001_0000, .driver_addr = 0x4001_1000, .device_addr = 0x4001_2000 },
        .{ .num = 128, .ready = 1, .last_avail_idx = 3, .desc_addr = 0x4002_0000, .driver_addr = 0x4002_1000, .device_addr = 0x4002_2000 },
    };
    const out = try encode(a, DEVICE_BLK, 0x1_0000_0001, 0x0f, 1, 0x2, &queues);
    defer a.free(out);
    const snap = try decode(a, out);
    defer a.free(snap.queues);
    try std.testing.expectEqual(DEVICE_BLK, snap.device);
    try std.testing.expectEqual(@as(u64, 0x1_0000_0001), snap.driver_features);
    try std.testing.expectEqual(@as(u32, 0x0f), snap.status);
    try std.testing.expectEqual(@as(u32, 1), snap.queue_sel);
    try std.testing.expectEqual(@as(u32, 0x2), snap.interrupt_status);
    try std.testing.expectEqual(@as(usize, 2), snap.queues.len);
    try std.testing.expectEqual(@as(u64, 0x4002_1000), snap.queues[1].driver_addr);
    try std.testing.expectEqual(@as(u32, 7), snap.queues[0].last_avail_idx);
}

test "decode rejects truncated + bad device" {
    const a = std.testing.allocator;
    try std.testing.expectError(error.Truncated, decode(a, "short"));
    var bad: [HEADER_SIZE]u8 = @splat(0);
    std.mem.writeInt(u32, bad[0..4], 999, .little);
    try std.testing.expectError(error.BadDevice, decode(a, &bad));
}

test "dumpDevice/applyDevice round-trip a live device's transport state" {
    const a = std.testing.allocator;
    var src: virtio.Device = .{ .base = 0x0a00_0200, .id = .vsock };
    src.driver_features = 0x1_0000_0005;
    src.status = @bitCast(@as(u32, 0x0f));
    src.queue_sel = 2;
    src.interrupt_status = 0x1;
    src.queues[0] = .{ .num = 256, .ready = 1, .desc_addr = 0x4010_0000, .driver_addr = 0x4010_1000, .device_addr = 0x4010_2000, .last_avail_idx = 42 };
    src.queues[1] = .{ .num = 256, .ready = 1, .desc_addr = 0x4011_0000, .driver_addr = 0x4011_1000, .device_addr = 0x4011_2000, .last_avail_idx = 9 };

    const payload = try dump_device(a, &src);
    defer a.free(payload);

    var dst: virtio.Device = .{ .base = 0x0a00_0200, .id = .vsock };
    try apply_device(a, &dst, payload);

    try std.testing.expectEqual(src.driver_features, dst.driver_features);
    try std.testing.expectEqual(@as(u32, @bitCast(src.status)), @as(u32, @bitCast(dst.status)));
    try std.testing.expectEqual(src.queue_sel, dst.queue_sel);
    try std.testing.expectEqual(src.interrupt_status, dst.interrupt_status);
    try std.testing.expectEqual(src.queues[0].desc_addr, dst.queues[0].desc_addr);
    try std.testing.expectEqual(src.queues[0].last_avail_idx, dst.queues[0].last_avail_idx);
    try std.testing.expectEqual(src.queues[1].driver_addr, dst.queues[1].driver_addr);
}

test "dumpDevice/applyDevice round-trip a virtio-fs device's transport state" {
    // virtio-fs (device id 26) rides the same transport codec — its
    // hiprio queue (0) and request queue (1) are plain virtio queues.
    const a = std.testing.allocator;
    var src: virtio.Device = .{ .base = 0x0a00_0e00, .id = .virtio_fs };
    src.driver_features = 0x1_0000_0000;
    src.status = @bitCast(@as(u32, 0x0f));
    src.queue_sel = 1;
    src.interrupt_status = 0x1;
    src.queues[0] = .{ .num = 256, .ready = 1, .desc_addr = 0x5000_0000, .driver_addr = 0x5000_1000, .device_addr = 0x5000_2000, .last_avail_idx = 3 };
    src.queues[1] = .{ .num = 256, .ready = 1, .desc_addr = 0x5001_0000, .driver_addr = 0x5001_1000, .device_addr = 0x5001_2000, .last_avail_idx = 71 };

    const payload = try dump_device(a, &src);
    defer a.free(payload);
    try std.testing.expectEqual(DEVICE_VIRTIO_FS, std.mem.readInt(u32, payload[0..4], .little));

    var dst: virtio.Device = .{ .base = 0x0a00_0e00, .id = .virtio_fs };
    try apply_device(a, &dst, payload);
    try std.testing.expectEqual(src.driver_features, dst.driver_features);
    try std.testing.expectEqual(src.queue_sel, dst.queue_sel);
    try std.testing.expectEqual(src.queues[1].desc_addr, dst.queues[1].desc_addr);
    try std.testing.expectEqual(src.queues[1].last_avail_idx, dst.queues[1].last_avail_idx);
}

test "applyDevice rejects a payload from a different device type" {
    const a = std.testing.allocator;
    var blk: virtio.Device = .{ .base = 0x0a00_0200, .id = .block };
    const payload = try dump_device(a, &blk);
    defer a.free(payload);
    var net: virtio.Device = .{ .base = 0x0a00_0000, .id = .net };
    try std.testing.expectError(error.DeviceMismatch, apply_device(a, &net, payload));
}
