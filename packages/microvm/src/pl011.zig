//! Bare-bones PL011 UART (the serial port on the ARM virt machine).
//!
//! Hypervisor-independent — HVF and KVM both route MMIO for this
//! device back into here. See hvf.zig / boot_kvm.zig for wiring.
//!
//!   - DR (offset 0x000): byte writes append to `captured`; reads pop
//!     from `rx_buf` (the bytes we received from host stdin).
//!   - FR (offset 0x018): bit 4 (RXFE) = 1 when rx_buf is empty, 0 otherwise.
//!     Other bits keep their "TX empty, not busy" state.
//!   - IMSC/RIS/MIS/ICR (0x038–0x044): real PL011 interrupt regs so
//!     the Linux driver's ISR can mask/unmask and clear interrupts.
//!   - PrimeCell IDs (0xFE0–0xFFC): the AMBA bus probes these before
//!     binding the PL011 driver; without them the driver never attaches.

const std = @import("std");
const builtin = @import("builtin");

/// Platform-sized pthread mutex. Zig 0.16 moved `std.Thread.Mutex`
/// under `std.Io` (it now requires an Io context), so we bind
/// pthread directly rather than take on that dependency just for
/// a lock. macOS layout: 64 bytes with a `sig` magic. Linux glibc
/// layout: 40 bytes, all-zeros == `PTHREAD_MUTEX_INITIALIZER`.
pub const PthreadMutex = extern struct {
    pub const macos_pad: usize = 56;
    pub const linux_pad: usize = 40;

    // One union-like blob sized for the bigger platform; we just
    // zero-init the whole thing and let pthread handle it. macOS
    // has a sentinel magic it requires, which we write into the
    // first 8 bytes.
    _bytes: [64]u8 align(8) = if (builtin.os.tag == .macos) macosInit() else @splat(0),

    fn macosInit() [64]u8 {
        var out: [64]u8 = @splat(0);
        // sig = 0x32AAABA7 (PTHREAD_MUTEX_INITIALIZER's magic).
        const sig: u64 = 0x32AAABA7;
        std.mem.writeInt(u64, out[0..8], sig, .little);
        return out;
    }

    extern "c" fn pthread_mutex_lock(m: *PthreadMutex) c_int;
    extern "c" fn pthread_mutex_unlock(m: *PthreadMutex) c_int;

    pub fn lock(self: *PthreadMutex) void {
        _ = pthread_mutex_lock(self);
    }
    pub fn unlock(self: *PthreadMutex) void {
        _ = pthread_mutex_unlock(self);
    }
};

pub const Pl011 = struct {
    base: u64,
    size: u64 = 0x1000,
    captured: std.ArrayList(u8),
    rx_buf: std.ArrayList(u8),
    // Interrupt mask/status. The kernel's PL011 IRQ handler reads MIS
    // (masked = RIS & IMSC) and clears matching bits via ICR.
    imsc: u32 = 0,
    ris: u32 = 0,
    mutex: PthreadMutex = .{},

    // Bit 4 of RIS/MIS/ICR is RX interrupt.
    pub const RX_INT: u32 = 1 << 4;

    pub const init: Pl011 = .{
        .base = 0x0900_0000,
        .captured = .empty,
        .rx_buf = .empty,
    };

    pub fn withBase(base: u64) Pl011 {
        return .{ .base = base, .captured = .empty, .rx_buf = .empty };
    }

    pub fn deinit(self: *Pl011, gpa: std.mem.Allocator) void {
        self.captured.deinit(gpa);
        self.rx_buf.deinit(gpa);
    }

    pub fn handles(self: *const Pl011, addr: u64) bool {
        return addr >= self.base and addr < self.base + self.size;
    }

    /// IRQ line should be asserted iff there's any masked interrupt pending.
    pub fn irqAsserted(self: *Pl011) bool {
        self.mutex.lock();
        defer self.mutex.unlock();
        return (self.ris & self.imsc) != 0;
    }

    pub fn pushRx(self: *Pl011, gpa: std.mem.Allocator, bytes: []const u8) !void {
        self.mutex.lock();
        defer self.mutex.unlock();
        try self.rx_buf.appendSlice(gpa, bytes);
        if (self.rx_buf.items.len > 0) self.ris |= RX_INT;
    }

    pub fn write(self: *Pl011, gpa: std.mem.Allocator, addr: u64, value: u64) !void {
        self.mutex.lock();
        defer self.mutex.unlock();
        const offset = addr - self.base;
        switch (offset) {
            0x000 => try self.captured.append(gpa, @truncate(value)),
            0x038 => self.imsc = @truncate(value),
            0x044 => {
                self.ris &= ~@as(u32, @truncate(value));
                if (self.rx_buf.items.len > 0) self.ris |= RX_INT;
            },
            else => {},
        }
    }

    pub fn read(self: *Pl011, addr: u64) u64 {
        self.mutex.lock();
        defer self.mutex.unlock();
        const offset = addr - self.base;
        switch (offset) {
            0x000 => {
                if (self.rx_buf.items.len == 0) return 0;
                const b = self.rx_buf.items[0];
                std.mem.copyForwards(u8, self.rx_buf.items[0 .. self.rx_buf.items.len - 1], self.rx_buf.items[1..]);
                self.rx_buf.items.len -= 1;
                if (self.rx_buf.items.len == 0) self.ris &= ~RX_INT;
                return b;
            },
            0x018 => {
                const rxfe: u64 = if (self.rx_buf.items.len == 0) (1 << 4) else 0;
                return 0x80 | rxfe;
            },
            0x038 => return self.imsc,
            0x03C => return self.ris,
            0x040 => return self.ris & self.imsc,
            // ARM PrimeCell peripheral ID registers — without these the
            // AMBA bus can't identify the device and the kernel's PL011
            // driver never binds. Values are the standard for a real PL011.
            0xFE0 => return 0x11,
            0xFE4 => return 0x10,
            0xFE8 => return 0x14,
            0xFEC => return 0x00,
            0xFF0 => return 0x0D,
            0xFF4 => return 0xF0,
            0xFF8 => return 0x05,
            0xFFC => return 0xB1,
            else => return 0,
        }
    }
};
