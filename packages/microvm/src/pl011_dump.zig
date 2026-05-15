//! PL011 UART snapshot codec for the .vmstate `virtio` section
//! placeholder (task #27). PL011 isn't virtio but we reuse the same
//! section-id convention — id 0 reserved for "the UART".
//!
//! Guest-visible state we capture:
//!   imsc u32         — interrupt mask
//!   ris u32          — raw interrupt status
//!   rx_len u32       — pending RX FIFO byte count
//!   rx_buf[rx_len]   — pending RX bytes
//!
//! Captured TX bytes are host-side observation, NOT guest state, so
//! they don't go in the snapshot. The TX FIFO at the hardware level
//! is empty after every DR-write (we drain immediately into the
//! host-echo path), so there's nothing to dump.

const std = @import("std");
const pl011 = @import("pl011.zig");

pub const Header = extern struct {
    imsc: u32,
    ris: u32,
    rx_len: u32,
    _reserved: u32 = 0,
};

pub const HEADER_SIZE: usize = @sizeOf(Header);

pub const DecodeError = error{
    Truncated,
    RxLenOverflow,
};

pub fn encode(allocator: std.mem.Allocator, p: *pl011.Pl011) ![]u8 {
    p.mutex.lock();
    defer p.mutex.unlock();
    // Tiger-style: bounded by the inline rx buffer the caller allocated.
    std.debug.assert(p.rx_len <= pl011.rx_capacity);
    const rx_len = p.rx_len;
    const out = try allocator.alloc(u8, HEADER_SIZE + rx_len);
    const hdr: Header = .{
        .imsc = p.imsc,
        .ris = p.ris,
        .rx_len = @intCast(rx_len),
    };
    @memcpy(out[0..HEADER_SIZE], std.mem.asBytes(&hdr));
    if (rx_len > 0) @memcpy(out[HEADER_SIZE..], p.rx_buf[0..rx_len]);
    return out;
}

pub fn decode(payload: []const u8) DecodeError!struct { imsc: u32, ris: u32, rx: []const u8 } {
    if (payload.len < HEADER_SIZE) return error.Truncated;
    var hdr: Header = undefined;
    @memcpy(std.mem.asBytes(&hdr), payload[0..HEADER_SIZE]);

    if (hdr.rx_len > pl011.rx_capacity) return error.RxLenOverflow;
    if (HEADER_SIZE + hdr.rx_len > payload.len) return error.Truncated;
    return .{
        .imsc = hdr.imsc,
        .ris = hdr.ris,
        .rx = payload[HEADER_SIZE..][0..hdr.rx_len],
    };
}

/// Apply a decoded PL011 state to a fresh device. Returns void.
pub fn apply(p: *pl011.Pl011, state: anytype) void {
    p.mutex.lock();
    defer p.mutex.unlock();
    p.imsc = state.imsc;
    p.ris = state.ris;
    p.rx_len = state.rx.len;
    if (state.rx.len > 0) @memcpy(p.rx_buf[0..state.rx.len], state.rx);
}

// --- tests ---

test "encode/decode empty UART" {
    const a = std.testing.allocator;
    var p = pl011.Pl011.init;
    const payload = try encode(a, &p);
    defer a.free(payload);
    const d = try decode(payload);
    try std.testing.expectEqual(@as(u32, 0), d.imsc);
    try std.testing.expectEqual(@as(u32, 0), d.ris);
    try std.testing.expectEqual(@as(usize, 0), d.rx.len);
}

test "encode/decode UART with pending RX + IRQ flags" {
    const a = std.testing.allocator;
    var p = pl011.Pl011.init;
    p.imsc = pl011.Pl011.RX_INT;
    p.ris = pl011.Pl011.RX_INT;
    p.rx_buf[0] = 'A';
    p.rx_buf[1] = 'B';
    p.rx_buf[2] = 'C';
    p.rx_len = 3;

    const payload = try encode(a, &p);
    defer a.free(payload);

    const d = try decode(payload);
    try std.testing.expectEqual(@as(u32, pl011.Pl011.RX_INT), d.imsc);
    try std.testing.expectEqual(@as(u32, pl011.Pl011.RX_INT), d.ris);
    try std.testing.expectEqualSlices(u8, "ABC", d.rx);
}

test "apply restores a fresh UART to the captured state" {
    const a = std.testing.allocator;
    var p_src = pl011.Pl011.init;
    p_src.imsc = pl011.Pl011.RX_INT;
    p_src.rx_buf[0] = 'X';
    p_src.rx_buf[1] = 'Y';
    p_src.rx_len = 2;

    const payload = try encode(a, &p_src);
    defer a.free(payload);

    var p_dst = pl011.Pl011.init;
    const d = try decode(payload);
    apply(&p_dst, d);

    try std.testing.expectEqual(p_src.imsc, p_dst.imsc);
    try std.testing.expectEqual(p_src.rx_len, p_dst.rx_len);
    try std.testing.expectEqualSlices(u8, p_src.rx_buf[0..p_src.rx_len], p_dst.rx_buf[0..p_dst.rx_len]);
}

test "decode rejects truncated" {
    try std.testing.expectError(error.Truncated, decode("short"));
}

test "decode rejects oversized rx_len" {
    var bad: [16]u8 = @splat(0);
    // rx_len at offset 8, u32 LE
    std.mem.writeInt(u32, bad[8..12], pl011.rx_capacity + 1, .little);
    try std.testing.expectError(error.RxLenOverflow, decode(&bad));
}
