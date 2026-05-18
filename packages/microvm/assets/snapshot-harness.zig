//! Deterministic compute oracle for snapshot/restore experiments.
//!
//! Runs N=10_000_000 SHA256 iterations over a fixed 32-byte seed,
//! printing a checkpoint line every 100k iterations (and an early
//! one at 10k). Output, one line per checkpoint, line-buffered:
//!
//!   snapshot-harness: iter=<n> hash=<64 hex chars>
//!
//! No syscalls beyond write(2), reboot(2), and pause(2) if reboot
//! unexpectedly returns. No clock reads, no rng, no file I/O. SHA256
//! runs entirely in registers + stack.
//! That makes the (iter, hash) stream a pure function of the binary,
//! so any HVF<->KVM divergence here is a foundational determinism
//! problem, not a snapshot bug.
//!
//! On completion calls reboot(LINUX_REBOOT_CMD_POWER_OFF) so the VMM
//! exits cleanly via PSCI SYSTEM_OFF (same pattern as poweroff.zig).
//!
//! Build (from packages/microvm):
//!   zig build-exe assets/snapshot-harness.zig \
//!     -target aarch64-linux-musl -static -O ReleaseSmall \
//!     -lc -femit-bin=<out>/snapshot-harness

const std = @import("std");

const TOTAL_ITERS: u64 = 10_000_000;
const EARLY_CHECKPOINT: u64 = 10_000;
const CHECKPOINT_INTERVAL: u64 = 100_000;

const LINUX_REBOOT_MAGIC1: c_int = @bitCast(@as(u32, 0xfee1dead));
const LINUX_REBOOT_MAGIC2: c_int = 672274793;
const LINUX_REBOOT_CMD_POWER_OFF: c_int = @bitCast(@as(u32, 0x4321fedc));

extern "c" fn write(fd: c_int, buf: *const anyopaque, count: usize) isize;
extern "c" fn reboot(cmd: c_int) c_int;
extern "c" fn pause() c_int;

fn write_all(fd: c_int, bytes: []const u8) void {
    var off: usize = 0;
    while (off < bytes.len) {
        const rc = write(fd, bytes.ptr + off, bytes.len - off);
        if (rc <= 0) return;
        off += @intCast(rc);
    }
}

fn print_checkpoint(iter: u64, hash: *const [32]u8) void {
    // Format: "snapshot-harness: iter=<n> hash=<64 hex>\n"
    var buf: [128]u8 = undefined;
    var len: usize = 0;

    const prefix = "snapshot-harness: iter=";
    @memcpy(buf[len .. len + prefix.len], prefix);
    len += prefix.len;

    var iter_buf: [20]u8 = undefined;
    const iter_str = std.fmt.bufPrint(&iter_buf, "{d}", .{iter}) catch return;
    @memcpy(buf[len .. len + iter_str.len], iter_str);
    len += iter_str.len;

    const sep = " hash=";
    @memcpy(buf[len .. len + sep.len], sep);
    len += sep.len;

    const hex_digits = "0123456789abcdef";
    for (hash) |b| {
        buf[len] = hex_digits[(b >> 4) & 0xf];
        buf[len + 1] = hex_digits[b & 0xf];
        len += 2;
    }
    buf[len] = '\n';
    len += 1;
    write_all(1, buf[0..len]);
}

pub fn main() u8 {
    var state: [32]u8 = @splat(0);
    var i: u64 = 0;
    while (i < TOTAL_ITERS) : (i += 1) {
        var hasher = std.crypto.hash.sha2.Sha256.init(.{});
        hasher.update(&state);
        hasher.final(&state);
        const next = i + 1;
        if (next == EARLY_CHECKPOINT or
            (next >= CHECKPOINT_INTERVAL and next % CHECKPOINT_INTERVAL == 0))
        {
            print_checkpoint(next, &state);
        }
    }
    _ = reboot(LINUX_REBOOT_CMD_POWER_OFF);
    // reboot shouldn't return on success. If it does, park so /init
    // doesn't exit (which would panic the guest, not exit the VMM).
    while (true) {
        _ = pause();
    }
}
