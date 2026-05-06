//! Allocate N MiB of anonymous memory, dirty every page, print READY,
//! then park on pause(2). Used by the headline RSS smoke test (#266) to
//! spike a parent VM's anon RSS in a controlled, deterministic way so
//! we can snapshot it and observe lazy-pages-restored forks staying
//! light on host RSS until they actually touch a page.
//!
//! Usage: /sbin/machinen-memdirty <MiB>
//!
//! Why a separate helper and not `dd if=/dev/urandom of=/dev/shm/...`:
//! tmpfs-backed pages live in page cache, not anon, and CRIU dumps
//! anon mappings via the page-server lazy-pages path we're trying to
//! exercise. Hence: explicit MAP_PRIVATE | MAP_ANONYMOUS mmap, dirtied
//! pagewise so each 4 KiB really materializes in the workload's anon
//! RSS before the snapshot fires.
//!
//! Build (matches the loop in scripts/build-base-assets.sh):
//!   zig build-exe assets/memdirty.zig \
//!     -target aarch64-linux-musl -O ReleaseSmall -lc \
//!     -femit-bin=<out>/memdirty

const std = @import("std");

const PROT_READ: c_int = 1;
const PROT_WRITE: c_int = 2;
const MAP_PRIVATE: c_int = 0x02;
const MAP_ANONYMOUS: c_int = 0x20;
const MAP_FAILED: ?*anyopaque = @ptrFromInt(@as(usize, @bitCast(@as(isize, -1))));

const PAGE_SIZE: usize = 4096;

extern "c" fn mmap(addr: ?*anyopaque, len: usize, prot: c_int, flags: c_int, fd: c_int, offset: i64) ?*anyopaque;
extern "c" fn pause() c_int;
extern "c" fn write(fd: c_int, buf: [*]const u8, n: usize) isize;

fn writeAll(fd: c_int, buf: []const u8) void {
    var off: usize = 0;
    while (off < buf.len) {
        const n = write(fd, buf.ptr + off, buf.len - off);
        if (n <= 0) return;
        off += @intCast(n);
    }
}

fn die(msg: []const u8) noreturn {
    writeAll(2, msg);
    writeAll(2, "\n");
    std.process.exit(1);
}

pub fn main(init: std.process.Init) !void {
    var it = try std.process.Args.Iterator.initAllocator(init.minimal.args, init.gpa);
    defer it.deinit();
    _ = it.next(); // argv[0]

    const arg = it.next() orelse die("usage: machinen-memdirty <MiB>");
    const mib = std.fmt.parseInt(u64, arg, 10) catch die("memdirty: <MiB> must be a non-negative integer");

    const bytes = mib * 1024 * 1024;
    if (bytes == 0) die("memdirty: refusing to mmap 0 bytes");

    const ptr = mmap(null, bytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (ptr == MAP_FAILED or ptr == null) die("memdirty: mmap failed");

    // Dirty every page so the kernel actually materializes anon
    // backing. Writing the page index byte gives us deterministic,
    // non-zero contents — zero pages can be elided by some paths and
    // we want to force real RSS growth.
    const base: [*]u8 = @ptrCast(ptr.?);
    var off: usize = 0;
    var idx: usize = 0;
    while (off < bytes) : ({
        off += PAGE_SIZE;
        idx +%= 1;
    }) {
        base[off] = @truncate(idx);
    }

    // Stdout marker for the host-side smoke test to wait on.
    var buf: [64]u8 = undefined;
    const line = std.fmt.bufPrint(&buf, "READY mib={d}\n", .{mib}) catch unreachable;
    writeAll(1, line);

    // Park forever — caller signals exit via SIGTERM (machinen
    // snapshot/restore tear-down). Loop guards against EINTR.
    while (true) {
        _ = pause();
    }
}
