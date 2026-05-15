//! Lightweight timing logs for whole-VM `.vmstate` restore.
//!
//! The restore path runs inside the VMM before the first vCPU run, so
//! runtime-side `PhaseTimer` can only see "VMM spawned → first stderr
//! byte". This module adds opt-in, per-phase timing from inside the
//! VMM for the expensive parts: file read, gzip inflate, container
//! decode, RAM reconstruction, and post-restore fixups.
//!
//! Enabled when any of these are set:
//!   - MACHINEN_VMSTATE_TIMING=1
//!   - MACHINEN_DEBUG=1
//!   - DEBUG includes machinen:vmstate, machinen:restore, or machinen:*

const std = @import("std");
const snapshot = @import("snapshot.zig");

const libc = struct {
    extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;
};

pub const RestoreTimer = struct {
    enabled: bool,
    backend: []const u8,
    start_us: i128,
    last_us: i128,

    pub fn start(backend: []const u8, file_bytes: usize, ram_bytes: usize) RestoreTimer {
        const e = enabled();
        const now = if (e) nowUs() else 0;
        if (e) {
            std.debug.print(
                "vmstate restore timing backend={s} event=start file_bytes={d} ram_bytes={d}\n",
                .{ backend, file_bytes, ram_bytes },
            );
        }
        return .{ .enabled = e, .backend = backend, .start_us = now, .last_us = now };
    }

    pub fn mark(self: *RestoreTimer, phase: []const u8) void {
        if (!self.enabled) return;
        const now = nowUs();
        std.debug.print(
            "vmstate restore timing backend={s} phase={s} delta_ms={d} total_ms={d}\n",
            .{ self.backend, phase, ms(now - self.last_us), ms(now - self.start_us) },
        );
        self.last_us = now;
    }

    pub fn sectionStart(self: *const RestoreTimer) i128 {
        if (!self.enabled) return 0;
        return nowUs();
    }

    pub fn section(
        self: *const RestoreTimer,
        tag: snapshot.SectionTag,
        id: u32,
        payload_bytes: usize,
        section_start_us: i128,
    ) void {
        if (!self.enabled) return;
        const now = nowUs();
        std.debug.print(
            "vmstate restore timing backend={s} section={s} id={d} bytes={d} ms={d} total_ms={d}\n",
            .{ self.backend, tagName(tag), id, payload_bytes, ms(now - section_start_us), ms(now - self.start_us) },
        );
    }

    pub fn done(self: *RestoreTimer) void {
        if (!self.enabled) return;
        const now = nowUs();
        std.debug.print(
            "vmstate restore timing backend={s} event=done total_ms={d}\n",
            .{ self.backend, ms(now - self.start_us) },
        );
        self.enabled = false;
    }
};

fn enabled() bool {
    if (libc.getenv("MACHINEN_VMSTATE_TIMING") != null) return true;
    if (libc.getenv("MACHINEN_DEBUG") != null) return true;
    const debug_raw = libc.getenv("DEBUG") orelse return false;
    return debugSpecEnablesTiming(std.mem.span(debug_raw));
}

pub fn debugSpecEnablesTiming(spec: []const u8) bool {
    var vmstate = false;
    var restore = false;

    var it = std.mem.tokenizeAny(u8, spec, ", ");
    while (it.next()) |raw_token| {
        if (raw_token.len == 0) continue;
        const negated = raw_token[0] == '-';
        const token = if (negated) raw_token[1..] else raw_token;
        if (token.len == 0) continue;

        if (debugTokenMatches(token, "machinen:vmstate")) vmstate = !negated;
        if (debugTokenMatches(token, "machinen:restore")) restore = !negated;
    }

    return vmstate or restore;
}

fn debugTokenMatches(token: []const u8, namespace: []const u8) bool {
    if (std.mem.eql(u8, token, "*")) return true;
    if (std.mem.endsWith(u8, token, "*")) {
        return std.mem.startsWith(u8, namespace, token[0 .. token.len - 1]);
    }
    return std.mem.eql(u8, token, namespace);
}

fn tagName(tag: snapshot.SectionTag) []const u8 {
    return switch (tag) {
        .ram => "ram",
        .vcpu => "vcpu",
        .gic_dist => "gic_dist",
        .gic_redist => "gic_redist",
        .virtio => "virtio",
        .gic_cpuif => "gic_cpuif",
        .virtiofs_state => "virtiofs_state",
        else => "unknown",
    };
}

fn nowUs() i128 {
    var tv: std.c.timeval = undefined;
    _ = std.c.gettimeofday(&tv, null);
    return @as(i128, tv.sec) * 1_000_000 + @as(i128, tv.usec);
}

fn ms(us: i128) i128 {
    return @divTrunc(us, 1000);
}

// -- tests --------------------------------------------------------

test "DEBUG spec enables vmstate restore timing" {
    try std.testing.expect(debugSpecEnablesTiming("machinen:vmstate"));
    try std.testing.expect(debugSpecEnablesTiming("machinen:restore"));
    try std.testing.expect(debugSpecEnablesTiming("machinen:*"));
    try std.testing.expect(debugSpecEnablesTiming("*,other"));
    try std.testing.expect(!debugSpecEnablesTiming("machinen:boot"));
    try std.testing.expect(!debugSpecEnablesTiming("machinen:*,-machinen:vmstate,-machinen:restore"));
}
