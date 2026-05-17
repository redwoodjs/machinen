//! Tiny paravirtualized shutdown fallback for nested guests.
//!
//! When EL2 is exposed to the guest, Linux owns the HVC conduit used by
//! PSCI. A normal `reboot(POWER_OFF)` can therefore be consumed by the
//! L1 kernel instead of reaching the L0 VMM. The guest-side
//! /sbin/machinen-poweroff helper writes this marker to /dev/console
//! when it detects /dev/kvm; the VMM watches serial output and exits.

const std = @import("std");

pub const marker = "::machinen-nested-poweroff::";

pub const Detector = struct {
    matched: usize = 0,
    seen: bool = false,

    pub fn observe(self: *Detector, byte: u8) void {
        if (self.seen) return;
        if (byte == marker[self.matched]) {
            self.matched += 1;
            if (self.matched == marker.len) {
                self.seen = true;
            }
            return;
        }
        self.matched = if (byte == marker[0]) 1 else 0;
    }
};

test "detector sees the nested poweroff marker in a serial stream" {
    var detector: Detector = .{};
    for ("noise\r\n::machinen-nested-poweroff::\r\n") |byte| {
        detector.observe(byte);
    }
    try std.testing.expect(detector.seen);
}
