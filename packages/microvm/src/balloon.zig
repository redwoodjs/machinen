//! virtio-balloon backend — lets the guest tell the host which pages
//! it considers free, so the host can release the corresponding RSS
//! via `madvise(MADV_DONTNEED)`.
//!
//! Why this exists: see `docs/memory.md`. On both HVF and KVM the
//! guest's anonymous RAM mapping is demand-paged (lazy commit), so
//! host RSS *grows* as the guest touches pages — but it never *shrinks*
//! when the guest frees them, because the host has no way to know
//! the guest stopped needing a page. virtio-balloon (and its modern
//! free-page-reporting variant) are how the guest tells us.
//!
//! ## Mode
//!
//! We negotiate `VIRTIO_BALLOON_F_REPORTING` (bit 5) — the modern
//! free-page-reporting variant added in Linux 5.7 (2020). With this
//! feature the guest *continuously* reports free runs on a dedicated
//! queue (queue 2, after inflate/deflate which are always present),
//! without the inflate/deflate ceremony of the classic balloon. We
//! never ask the guest to inflate, so `num_pages` in config space
//! stays 0; the inflate/deflate queue handlers are minimal acks.
//!
//! ## Queues (driver order, with REPORTING + no STATS / FREE_PAGE_HINT)
//!
//!   0  inflate    driver pushes pages into the balloon (we ack only)
//!   1  deflate    driver takes pages back (we ack only)
//!   2  reporting  driver reports free runs as scatter/gather entries
//!
//! ## Reporting queue payload
//!
//! Each reporting chain is one or more descriptors. Each descriptor
//! describes a contiguous *guest-physical* range of free memory:
//! `{ addr = guest_phys, len = bytes }`. We translate to host VA via
//! `ram_base + addr` and atomically replace the range with fresh
//! zero-fill pages via `mmap(MAP_FIXED | MAP_PRIVATE | MAP_ANONYMOUS)`.
//! That immediately drops the host's resident-set count for those
//! bytes; next guest access lazy-faults a zero page back in via
//! the same path as the original boot-time mapping.
//!
//! Why mmap rather than `madvise(MADV_DONTNEED)`: on Linux
//! `MADV_DONTNEED` does this exactly, but on Darwin it's only an
//! advisory hint to the page-replacement algorithm — the pages stay
//! resident until external memory pressure. `MADV_FREE_REUSABLE`
//! marks them discardable but still resident in `task_basic_info`.
//! `mmap MAP_FIXED` is the one operation with consistent immediate-
//! reclaim semantics across both platforms. (Firecracker uses the
//! same approach for the same reason.)
//!
//! The reported runs are MAX_PAGE_ORDER-aligned (4 MiB on arm64
//! defconfig) — comfortably aligned to both the 4 KiB Linux host
//! page size and the 16 KiB Darwin host page size, so mmap accepts
//! them without rounding.
//!
//! ## Page granularity
//!
//! The classic inflate/deflate queues use a u32 PFN array sized to
//! `VIRTIO_BALLOON_PFN_SHIFT` (always 12, i.e. 4 KiB pages on the
//! wire) regardless of the guest's actual page size. The reporting
//! queue's descriptor `len` is bytes and respects the guest page
//! size. Since we don't drive inflate, we don't have to care about
//! the PFN-shift detail beyond ack'ing chains correctly.

const std = @import("std");
const builtin = @import("builtin");
const virtio = @import("virtio.zig");
const assert = std.debug.assert;

// virtio-balloon DeviceID (virtio spec, section 5.5).
pub const device_id: u32 = 5;

// Feature bits (Linux uapi virtio_balloon.h).
pub const VIRTIO_BALLOON_F_MUST_TELL_HOST: u6 = 0;
pub const VIRTIO_BALLOON_F_STATS_VQ: u6 = 1;
pub const VIRTIO_BALLOON_F_DEFLATE_ON_OOM: u6 = 2;
pub const VIRTIO_BALLOON_F_FREE_PAGE_HINT: u6 = 3;
pub const VIRTIO_BALLOON_F_PAGE_POISON: u6 = 4;
pub const VIRTIO_BALLOON_F_REPORTING: u6 = 5;

/// Queue indices (post-feature-negotiation, with our feature set).
pub const QUEUE_INFLATE: u32 = 0;
pub const QUEUE_DEFLATE: u32 = 1;
pub const QUEUE_REPORTING: u32 = 2;

/// On-wire balloon config space at MMIO offset 0x100.
///
/// `num_pages` is the host's "I want this many 4 KiB pages in the
/// balloon" request; the driver echoes the count it actually moved
/// into the balloon via `actual`. We never ask, so both stay 0 for
/// the lifetime of the device — fire-and-forget reclaim happens
/// entirely on the reporting queue.
pub const BalloonConfig = extern struct {
    num_pages: u32 align(1) = 0,
    actual: u32 align(1) = 0,
    free_page_hint_cmd_id: u32 align(1) = 0,
    poison_val: u32 align(1) = 0,
};

comptime {
    // Wire layout — driver reads/writes these byte offsets directly.
    assert(@offsetOf(BalloonConfig, "num_pages") == 0);
    assert(@offsetOf(BalloonConfig, "actual") == 4);
    assert(@offsetOf(BalloonConfig, "free_page_hint_cmd_id") == 8);
    assert(@offsetOf(BalloonConfig, "poison_val") == 12);
    assert(@sizeOf(BalloonConfig) == 16);
}

pub const Backend = struct {
    config: BalloonConfig = .{},
    /// Total bytes the device has reported via madvise(MADV_DONTNEED).
    /// Updated atomically on every reporting-queue chain so a
    /// supervisor thread can read it without locking. Useful for
    /// the future `vm.memoryStats()` (#263 phase E).
    bytes_reported: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),
    /// Total bytes the device has seen on the inflate queue. We don't
    /// drive inflate, but a buggy / hostile guest could push pages
    /// anyway — track for visibility.
    bytes_inflated: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),

    pub fn init() Backend {
        return .{};
    }

    /// Feature bitmap to advertise in the device's `features` field.
    /// Pairs with `request_handler` below — adding a feature bit
    /// without a matching queue handler will hang the driver at
    /// `find_vqs`.
    pub fn features() u64 {
        // Bit 5 (REPORTING) + bit 32 (VERSION_1, required for v2 transport).
        return (@as(u64, 1) << VIRTIO_BALLOON_F_REPORTING) | (@as(u64, 1) << 32);
    }

    /// Wire-format config bytes for `virtio.Device.config`. Stable
    /// pointer for the lifetime of `*Backend`.
    pub fn configBytes(self: *const Backend) []const u8 {
        return std.mem.asBytes(&self.config);
    }

    /// Dispatch entry point. Plug into `virtio.Device.request_handler`.
    /// Switches on `q_idx` and hands off to the per-queue handler.
    pub fn handleRequest(ctx: ?*anyopaque, dev: *virtio.Device, q_idx: u32, head: u16) void {
        assert(ctx != null);
        const self: *Backend = @ptrCast(@alignCast(ctx.?));
        switch (q_idx) {
            QUEUE_INFLATE => self.handleInflate(dev, head),
            QUEUE_DEFLATE => self.handleDeflate(dev, head),
            QUEUE_REPORTING => self.handleReporting(dev, head),
            else => {
                // Unknown queue — fold into "ack the chain so the
                // driver doesn't stall." Treats stats/free-page-hint
                // as no-ops since we didn't negotiate them.
                ackChain(dev, q_idx, head);
            },
        }
    }

    /// Inflate-queue chain. The classic balloon hands us an array of
    /// 4 KiB-PFN u32s describing pages the guest is donating. We
    /// don't *drive* inflate (`num_pages` stays 0), so a well-behaved
    /// guest never sends anything here. Account for completeness and
    /// ack so a buggy driver doesn't wedge on a ring that never
    /// drains.
    fn handleInflate(self: *Backend, dev: *virtio.Device, head: u16) void {
        var bytes_seen: u64 = 0;
        var idx: u16 = head;
        var steps: u32 = 0;
        while (steps < virtio.max_chain_descriptors) : (steps += 1) {
            const d = dev.queueDescriptor(QUEUE_INFLATE, idx) orelse break;
            // Each descriptor is a u32 array; len is bytes; one page
            // == one u32. We don't actually act on these.
            bytes_seen += @as(u64, d.len) / 4 * 4096;
            if ((d.flags & virtio.VringDesc.F_NEXT) == 0) break;
            idx = d.next;
        }
        _ = self.bytes_inflated.fetchAdd(bytes_seen, .monotonic);
        dev.queuePushUsed(QUEUE_INFLATE, head, 0);
    }

    /// Deflate-queue chain. Same story as inflate but in reverse:
    /// driver giving pages back. We don't track "balloon contents"
    /// so this is a pure ack.
    fn handleDeflate(self: *Backend, dev: *virtio.Device, head: u16) void {
        _ = self;
        ackChain(dev, QUEUE_DEFLATE, head);
    }

    /// Reporting-queue chain. Each descriptor describes a contiguous
    /// guest-physical range of free memory:
    ///   `{ addr = guest_phys, len = bytes }`
    /// Translate to host VA, call `madvise(MADV_DONTNEED)`, account.
    /// Per Firecracker's lesson (see `docs/memory.md`), aggressive
    /// immediate reclaim hurts next-touch latency — a future change
    /// will batch + rate-limit these calls. For first cut: madvise
    /// each range straight through.
    fn handleReporting(self: *Backend, dev: *virtio.Device, head: u16) void {
        const ram_slice = dev.ram orelse {
            ackChain(dev, QUEUE_REPORTING, head);
            return;
        };
        const ram_base = dev.ram_base;
        const ram_end = ram_base +% ram_slice.len;

        var bytes_freed: u64 = 0;
        var descs: u32 = 0;
        var bytes_seen: u64 = 0;
        var idx: u16 = head;
        var steps: u32 = 0;
        while (steps < virtio.max_chain_descriptors) : (steps += 1) {
            const d = dev.queueDescriptor(QUEUE_REPORTING, idx) orelse break;
            descs += 1;
            bytes_seen += d.len;
            // Descriptor describes a guest-physical range. Validate it
            // sits inside our RAM slab before madvising — a malformed
            // or hostile descriptor pointing outside RAM (e.g. into
            // MMIO) would otherwise blow up the host process.
            if (d.len > 0 and d.addr >= ram_base and d.addr + d.len <= ram_end) {
                const offset: usize = @intCast(d.addr - ram_base);
                const host_va_ptr: *anyopaque = @ptrFromInt(@intFromPtr(ram_slice.ptr) + offset);
                const len: usize = @intCast(d.len);
                // mmap MAP_FIXED|MAP_PRIVATE|MAP_ANONYMOUS atomically
                // replaces the range with a fresh zero-fill mapping.
                // Returns the same address on success; MAP_FAILED
                // (-1 cast to pointer) on error. The HVF/KVM stage-2
                // entries for the range still resolve through the
                // host VA, so the next guest access faults a fresh
                // zero page back in — same lazy-commit path as the
                // original mapping.
                const got = mmap(
                    host_va_ptr,
                    len,
                    PROT_READ | PROT_WRITE,
                    MAP_FIXED | MAP_PRIVATE | MAP_ANONYMOUS,
                    -1,
                    0,
                );
                if (@intFromPtr(got) == @intFromPtr(host_va_ptr)) {
                    bytes_freed += d.len;
                } else if (debugEnabled()) {
                    std.debug.print(
                        "balloon: mmap MAP_FIXED failed addr=0x{x} len={d} got=0x{x}\n",
                        .{ d.addr, d.len, @intFromPtr(got) },
                    );
                }
            } else if (debugEnabled()) {
                std.debug.print(
                    "balloon: report out of RAM range addr=0x{x} len={d} ram=[0x{x},0x{x})\n",
                    .{ d.addr, d.len, ram_base, ram_end },
                );
            }
            if ((d.flags & virtio.VringDesc.F_NEXT) == 0) break;
            idx = d.next;
        }
        if (debugEnabled() and descs > 0) {
            std.debug.print(
                "balloon: reporting chain head={d} descs={d} seen={d} freed={d}\n",
                .{ head, descs, bytes_seen, bytes_freed },
            );
        }
        _ = self.bytes_reported.fetchAdd(bytes_freed, .monotonic);
        dev.queuePushUsed(QUEUE_REPORTING, head, 0);
    }
};

/// Walk a chain to the end, then push it back on the used ring with
/// zero bytes written. Used for queues whose state we don't track.
fn ackChain(dev: *virtio.Device, q_idx: u32, head: u16) void {
    var idx: u16 = head;
    var steps: u32 = 0;
    while (steps < virtio.max_chain_descriptors) : (steps += 1) {
        const d = dev.queueDescriptor(q_idx, idx) orelse break;
        if ((d.flags & virtio.VringDesc.F_NEXT) == 0) break;
        idx = d.next;
    }
    dev.queuePushUsed(q_idx, head, 0);
}

/// Gate noisy diagnostics on `MACHINEN_DEBUG=1` so production runs
/// stay quiet. Mirrors `boot_hvf.zig`'s `debugEnabled` helper.
fn debugEnabled() bool {
    const c = struct {
        extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;
    };
    return c.getenv("MACHINEN_DEBUG") != null;
}

// libc bindings for the mmap-based reclaim. mmap with MAP_FIXED is
// the portable "release these pages now" primitive: Linux drops RSS
// immediately, Darwin does the same. The flag values below are the
// canonical macOS / Linux constants — both happen to agree on
// MAP_PRIVATE (2) and MAP_FIXED (0x10), and on PROT_READ (1) /
// PROT_WRITE (2), but MAP_ANONYMOUS differs:
//   * Linux:  MAP_ANONYMOUS = 0x20
//   * Darwin: MAP_ANON      = 0x1000
extern "c" fn mmap(
    addr: ?*anyopaque,
    len: usize,
    prot: c_int,
    flags: c_int,
    fd: c_int,
    offset: c_long,
) *anyopaque;

const PROT_READ: c_int = 0x1;
const PROT_WRITE: c_int = 0x2;
const MAP_PRIVATE: c_int = 0x2;
const MAP_FIXED: c_int = 0x10;
const MAP_ANONYMOUS: c_int = if (builtin.os.tag == .macos) 0x1000 else 0x20;

// --- tests ---

test "Backend.features advertises REPORTING + VERSION_1" {
    const f = Backend.features();
    try std.testing.expect((f & (@as(u64, 1) << VIRTIO_BALLOON_F_REPORTING)) != 0);
    try std.testing.expect((f & (@as(u64, 1) << 32)) != 0); // VERSION_1
    // We must NOT advertise STATS_VQ or FREE_PAGE_HINT — those add
    // queues we don't implement, and the driver hangs at find_vqs
    // if we offer them.
    try std.testing.expect((f & (@as(u64, 1) << VIRTIO_BALLOON_F_STATS_VQ)) == 0);
    try std.testing.expect((f & (@as(u64, 1) << VIRTIO_BALLOON_F_FREE_PAGE_HINT)) == 0);
}

test "BalloonConfig has the v1.1 layout the driver expects" {
    var cfg: BalloonConfig = .{};
    cfg.num_pages = 0xdeadbeef;
    const bytes = std.mem.asBytes(&cfg);
    try std.testing.expectEqual(@as(usize, 16), bytes.len);
    // num_pages is little-endian on the wire on every supported arch.
    try std.testing.expectEqual(@as(u8, 0xef), bytes[0]);
    try std.testing.expectEqual(@as(u8, 0xbe), bytes[1]);
}

test "Backend.init starts with zero accounting" {
    const b: Backend = .init();
    try std.testing.expectEqual(@as(u64, 0), b.bytes_reported.load(.monotonic));
    try std.testing.expectEqual(@as(u64, 0), b.bytes_inflated.load(.monotonic));
}
