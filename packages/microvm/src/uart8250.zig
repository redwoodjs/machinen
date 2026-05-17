//! Minimal 16550A/8250-compatible UART for the x86_64 KVM machine.
//!
//! Linux drives this through `earlycon=uart8250,io,0x3f8` and
//! `console=ttyS0`. We only need TX for Machinen's guest console; RX and
//! interrupts are stubbed well enough for the 8250 driver to bind.

const std = @import("std");
const assert = std.debug.assert;

const PthreadMutex = @import("pl011.zig").PthreadMutex;

pub const captured_capacity: usize = 256 * 1024;
pub const rx_capacity: usize = 4096;

pub const Uart8250 = struct {
    base: u64,
    size: u64 = 0x1000,
    captured: [captured_capacity]u8 = undefined,
    captured_len: usize = 0,
    rx_buf: [rx_capacity]u8 = undefined,
    rx_len: usize = 0,
    capture_enabled: bool = true,

    ier: u8 = 0,
    iir: u8 = 0x01, // bit 0 set = no interrupt pending
    fcr: u8 = 0,
    lcr: u8 = 0x03, // 8n1 after reset is what Linux programs anyway
    mcr: u8 = 0,
    lsr: u8 = 0x60, // THR empty | transmitter empty
    msr: u8 = 0xb0,
    scr: u8 = 0,
    dll: u8 = 0,
    dlm: u8 = 0,
    mutex: PthreadMutex = .{},

    pub const init: Uart8250 = .{ .base = 0x0900_0000 };

    pub fn with_base(base: u64) Uart8250 {
        assert(base != 0);
        return .{ .base = base };
    }

    pub fn handles(self: *const Uart8250, addr: u64) bool {
        assert(self.size > 0);
        return addr >= self.base and addr < self.base + self.size;
    }

    pub fn irq_asserted(self: *Uart8250) bool {
        _ = self;
        return false;
    }

    pub fn captured_bytes(self: *const Uart8250) []const u8 {
        assert(self.captured_len <= captured_capacity);
        return self.captured[0..self.captured_len];
    }

    pub fn push_rx(self: *Uart8250, bytes: []const u8) void {
        self.mutex.lock();
        defer self.mutex.unlock();
        const room = rx_capacity - self.rx_len;
        const n = @min(room, bytes.len);
        if (n == 0) return;
        @memcpy(self.rx_buf[self.rx_len..][0..n], bytes[0..n]);
        self.rx_len += n;
        self.lsr |= 0x01; // data ready
    }

    pub fn write(self: *Uart8250, addr: u64, value: u64) void {
        assert(self.handles(addr));
        self.mutex.lock();
        defer self.mutex.unlock();
        const offset = (addr - self.base) & 0x7;
        const v: u8 = @truncate(value);
        const dlab = (self.lcr & 0x80) != 0;
        switch (offset) {
            0 => if (dlab) {
                self.dll = v;
            } else {
                self.lsr |= 0x60;
                if (self.capture_enabled and self.captured_len < captured_capacity) {
                    self.captured[self.captured_len] = v;
                    self.captured_len += 1;
                }
            },
            1 => {
                if (dlab) self.dlm = v else self.ier = v;
            },
            2 => self.fcr = v,
            3 => self.lcr = v,
            4 => self.mcr = v,
            7 => self.scr = v,
            else => {},
        }
    }

    pub fn read(self: *Uart8250, addr: u64) u64 {
        assert(self.handles(addr));
        self.mutex.lock();
        defer self.mutex.unlock();
        const offset = (addr - self.base) & 0x7;
        const dlab = (self.lcr & 0x80) != 0;
        switch (offset) {
            0 => {
                if (dlab) return self.dll;
                if (self.rx_len == 0) return 0;
                const b = self.rx_buf[0];
                std.mem.copyForwards(u8, self.rx_buf[0 .. self.rx_len - 1], self.rx_buf[1..self.rx_len]);
                self.rx_len -= 1;
                if (self.rx_len == 0) self.lsr &= ~@as(u8, 0x01);
                return b;
            },
            1 => return if (dlab) self.dlm else self.ier,
            2 => return self.iir,
            3 => return self.lcr,
            4 => return self.mcr,
            5 => return self.lsr | if (self.rx_len > 0) @as(u8, 0x01) else @as(u8, 0),
            6 => return self.msr,
            7 => return self.scr,
            else => return 0,
        }
    }
};

test "uart8250 captures THR writes" {
    var uart = Uart8250.init;
    uart.write(uart.base, 'O');
    uart.write(uart.base, 'K');
    try std.testing.expectEqualStrings("OK", uart.captured_bytes());
    try std.testing.expectEqual(@as(u64, 0x60), uart.read(uart.base + 5) & 0x60);
}
