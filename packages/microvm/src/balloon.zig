//! virtio-balloon backend — lets the guest tell the host which pages
//! it considers free, so the host can release the corresponding RSS
//! via `madvise` (Linux `MADV_DONTNEED`, Darwin `MADV_FREE_REUSABLE`).
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
//! We advertise `VIRTIO_F_VERSION_1` and `VIRTIO_BALLOON_F_REPORTING`.
//! The guest's virtio-balloon driver instantiates with the always-
//! present inflate + deflate queues plus the reporting queue; we
//! drive reclaim entirely through reporting. `num_pages` stays 0 so
//! the inflate handler is a minimal ack. See `handleReporting` for
//! the reclaim path.
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
//! `ram_base + addr` and reclaim the range via `madvise`:
//!   * Linux:  `madvise(addr, len, MADV_DONTNEED)` — kernel drops
//!     the physical pages immediately; next guest access zero-faults
//!     a fresh page through the same lazy-commit path as boot.
//!   * Darwin: `madvise(addr, len, MADV_FREE_REUSABLE)` — pages are
//!     marked discardable; the kernel reclaims them under pressure
//!     and the next guest access either re-uses the (now zeroed-on-
//!     reclaim or kept-as-is) page or zero-faults. Either way is
//!     safe — the guest only reports pages it considers free, so it
//!     never reads them; allocators overwrite on the next allocation.
//!
//! Why `madvise` rather than `mmap(MAP_FIXED | MAP_PRIVATE | MAP_ANONYMOUS)`:
//! the hypervisor's stage-2 mapping (`hv_vm_map` on HVF,
//! `KVM_SET_USER_MEMORY_REGION` on KVM) is registered against a
//! specific host VA. `mmap MAP_FIXED` tears down the existing VMA
//! and installs a fresh one at the same VA — a primitive whose
//! contract is "replace the address-space mapping", which is exactly
//! the relationship the hypervisor was told is stable. Whether the
//! kernel invalidates stage-2 in lockstep is implementation-defined;
//! under load the guest reads zeros from pages it still considers
//! in-use and corrupts its own page cache (HTTP stress reproduces it
//! as binaries getting `Exec format error`). KVM's API docs say so
//! directly: use `madvise(MADV_DONTNEED)`, not `mmap MAP_FIXED`.
//! `madvise` leaves the VMA — and therefore the hypervisor's view —
//! untouched; the kernel just drops physical pages.
//!
//! The reported runs are MAX_PAGE_ORDER-aligned (4 MiB on arm64
//! defconfig) — comfortably aligned to both the 4 KiB Linux host
//! page size and the 16 KiB Darwin host page size, so `madvise`
//! accepts them without rounding.
//!
//! ## Darwin RSS-reporting note
//!
//! After `MADV_FREE_REUSABLE`, `task_basic_info.resident_size` (what
//! `ps -o rss=` reads) does *not* drop until the kernel actually
//! reclaims the pages under pressure. `phys_footprint` (what
//! Activity Monitor's "Memory" column shows) *does* drop immediately
//! because reusable pages are excluded from the metric ledger. The
//! host runtime reads `phys_footprint` for `vm.memoryStats()
//! .hostRssBytes` so reclaim is observable in the natural place
//! (#274). See `packages/runtime/src/proc-rss.ts`.
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
const stats_mod = @import("stats.zig");
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
    /// Pointer to the shared host↔VMM `Counters` struct from
    /// stats.zig. Atomic increments here are visible to the host TS
    /// runtime through `MACHINEN_STATS_FILE` (#274). Defaults to the
    /// process-static stub when the VMM was launched without that
    /// env var; observability degrades silently to "always 0" but
    /// the device keeps working.
    counters: *stats_mod.Counters,

    /// Default constructor — uses the process-static stub. Convenient
    /// for unit tests and dev runs that don't need host-side stats.
    pub fn init() Backend {
        return .{ .counters = stats_mod.stubCounters() };
    }

    /// Construct a backend whose counters live at the caller-supplied
    /// pointer. Used by the boot wiring to redirect updates into the
    /// mmap'd stats region.
    pub fn initWithCounters(counters: *stats_mod.Counters) Backend {
        return .{ .counters = counters };
    }

    /// Feature bitmap to advertise in the device's `features` field.
    /// Pairs with `request_handler` below — adding a feature bit
    /// without a matching queue handler will hang the driver at
    /// `find_vqs`.
    ///
    /// We advertise `VIRTIO_BALLOON_F_REPORTING` so the guest posts
    /// free runs to the reporting queue and `handleReporting` can
    /// `madvise` them out of host RSS. The earlier corruption
    /// (#282 — guest reading zeros from pages it still considers in-
    /// use under HTTP stress) was a property of the previous reclaim
    /// primitive, `mmap(MAP_FIXED | MAP_PRIVATE | MAP_ANONYMOUS)`,
    /// which tore down the host VMA the hypervisor's stage-2 mapping
    /// was registered against. `madvise` leaves the VMA intact —
    /// the kernel just drops physical pages — so the race goes away.
    pub fn features() u64 {
        // Bit 32: VERSION_1, required for v2 transport.
        // Bit VIRTIO_BALLOON_F_REPORTING: free-page-reporting is
        // unconditionally on. The lazy-restore × reporting cycle that
        // used to motivate a runtime opt-out is fixed at the kernel
        // level in #290
        // (`packages/microvm/patches/kernel/0001-mm-page-reporting-skip-merge-with-reported-buddy.patch`).
        return (@as(u64, 1) << 32) | (@as(u64, 1) << VIRTIO_BALLOON_F_REPORTING);
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
        _ = @atomicRmw(u64, &self.counters.bytes_inflated, .Add, bytes_seen, .monotonic);
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
    /// We walk the chain once, collect all valid ranges, coalesce
    /// adjacent ones into a single madvise call, then issue the
    /// reclaims.
    ///
    /// Coalescing matters: the kernel's free-page-reporting framework
    /// posts up to 32 contiguous MAX_PAGE_ORDER (4 MiB) blocks in a
    /// single chain when a large run drains. Without merging, that's
    /// 32 separate madvise syscalls — each one takes a host kernel
    /// lock on the vCPU thread. Merging into one madvise of
    /// `n × 4 MiB` keeps the syscall count proportional to the
    /// number of non-contiguous *runs*, not raw descriptors.
    ///
    /// Firecracker's other half of this policy — rate-limiting across
    /// chains, to avoid hurting next-touch latency on workloads that
    /// rapidly re-allocate freed pages — needs a worker thread (the
    /// kernel's reporting framework only reports each page once, so
    /// "drop the chain to skip a cycle" loses reclaim opportunities
    /// permanently). Deferred to a follow-up. See #263 phase E.
    fn handleReporting(self: *Backend, dev: *virtio.Device, head: u16) void {
        const ram_slice = dev.ram orelse {
            ackChain(dev, QUEUE_REPORTING, head);
            return;
        };
        const ram_base = dev.ram_base;
        const ram_end = ram_base +% ram_slice.len;

        // Collect valid in-RAM ranges from the chain; cap at the
        // virtio chain limit (32) — a chain longer than that is
        // either malformed or pathological and we break out
        // silently per the existing virtio policy.
        var ranges: [virtio.max_chain_descriptors]Range = undefined;
        var n_ranges: usize = 0;
        var descs: u32 = 0;
        var bytes_seen: u64 = 0;
        var idx: u16 = head;
        var steps: u32 = 0;
        while (steps < virtio.max_chain_descriptors) : (steps += 1) {
            const d = dev.queueDescriptor(QUEUE_REPORTING, idx) orelse break;
            descs += 1;
            bytes_seen += d.len;
            if (d.len > 0 and d.addr >= ram_base and d.addr + d.len <= ram_end) {
                ranges[n_ranges] = .{ .addr = d.addr, .len = d.len };
                n_ranges += 1;
            } else if (debugEnabled()) {
                std.debug.print(
                    "balloon: report out of RAM range addr=0x{x} len={d} ram=[0x{x},0x{x})\n",
                    .{ d.addr, d.len, ram_base, ram_end },
                );
            }
            if ((d.flags & virtio.VringDesc.F_NEXT) == 0) break;
            idx = d.next;
        }

        // Sort by addr so adjacent ranges land next to each other.
        // n_ranges ≤ 32, so insertion sort is fine. The framework
        // walks a sorted free list so chains usually arrive ordered;
        // sortByAddr short-circuits in that case.
        sortByAddr(ranges[0..n_ranges]);

        // Coalesce adjacent ranges in place, then issue mmaps.
        var n_merged: usize = 0;
        if (n_ranges > 0) {
            n_merged = 1;
            for (ranges[1..n_ranges]) |r| {
                const tail = &ranges[n_merged - 1];
                if (tail.addr + tail.len == r.addr) {
                    tail.len += r.len;
                } else {
                    ranges[n_merged] = r;
                    n_merged += 1;
                }
            }
        }
        var bytes_freed: u64 = 0;
        for (ranges[0..n_merged]) |r| {
            const offset: usize = @intCast(r.addr - ram_base);
            const host_va_ptr: *anyopaque = @ptrFromInt(@intFromPtr(ram_slice.ptr) + offset);
            const len: usize = @intCast(r.len);
            // `madvise` releases the physical pages backing the range
            // without touching the VMA — the HVF/KVM stage-2 mapping
            // registered against this host VA stays valid, so the
            // hypervisor's view never desynchronises with the kernel's.
            // Linux uses MADV_DONTNEED (immediate drop, next access
            // zero-faults); Darwin uses MADV_FREE_REUSABLE (lazy drop
            // under memory pressure, accounted out of `phys_footprint`
            // immediately).
            const rc = madvise(host_va_ptr, len, MADVISE_RECLAIM);
            if (rc == 0) {
                bytes_freed += r.len;
            } else if (debugEnabled()) {
                std.debug.print(
                    "balloon: madvise reclaim failed addr=0x{x} len={d} rc={d}\n",
                    .{ r.addr, r.len, rc },
                );
            }
        }

        if (debugEnabled() and descs > 0) {
            std.debug.print(
                "balloon: reporting chain head={d} descs={d}->merged={d} seen={d} freed={d}\n",
                .{ head, descs, n_merged, bytes_seen, bytes_freed },
            );
        }
        _ = @atomicRmw(u64, &self.counters.bytes_reported, .Add, bytes_freed, .monotonic);
        dev.queuePushUsed(QUEUE_REPORTING, head, 0);
    }
};

/// Pair of (guest-physical addr, byte length). Used internally by
/// the reporting handler to collect descriptor ranges before
/// coalescing.
const Range = struct { addr: u64, len: u64 };

/// In-place insertion sort by `addr`. n is bounded by the virtio
/// chain limit (32 today), so the O(n²) worst case is trivial.
/// Short-circuits if the slice is already sorted — the common case
/// for free-page-reporting since the kernel walks a sorted free list.
fn sortByAddr(rs: []Range) void {
    var i: usize = 1;
    while (i < rs.len) : (i += 1) {
        var j: usize = i;
        while (j > 0 and rs[j - 1].addr > rs[j].addr) : (j -= 1) {
            const tmp = rs[j];
            rs[j] = rs[j - 1];
            rs[j - 1] = tmp;
        }
    }
}

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
    return getenv("MACHINEN_DEBUG") != null;
}

extern "c" fn getenv(name: [*:0]const u8) ?[*:0]const u8;

// libc binding for the madvise-based reclaim. `madvise` leaves the
// VMA intact — it just drops the physical pages — which is the
// property we need for HVF/KVM: their stage-2 mappings are
// registered against the host VA and must not be torn down by a
// reclaim-time call.
//
// Constants below are the canonical macOS / Linux values:
//   * Linux:  MADV_DONTNEED       = 4   (immediate drop; next access
//                                        zero-faults a fresh page)
//   * Darwin: MADV_FREE_REUSABLE  = 7   (mark discardable; kernel
//                                        reclaims under pressure;
//                                        excluded from phys_footprint
//                                        immediately)
extern "c" fn madvise(addr: *anyopaque, len: usize, advice: c_int) c_int;

const MADV_DONTNEED: c_int = 4;
const MADV_FREE_REUSABLE: c_int = 7;
const MADVISE_RECLAIM: c_int = if (builtin.os.tag == .macos) MADV_FREE_REUSABLE else MADV_DONTNEED;

// --- tests ---

test "Backend.features advertises VERSION_1 + REPORTING" {
    const f = Backend.features();
    try std.testing.expect((f & (@as(u64, 1) << 32)) != 0); // VERSION_1
    // REPORTING drives the reclaim path — see `handleReporting`.
    try std.testing.expect((f & (@as(u64, 1) << VIRTIO_BALLOON_F_REPORTING)) != 0);
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
    var counters: stats_mod.Counters = .{};
    const b: Backend = .initWithCounters(&counters);
    try std.testing.expectEqual(
        @as(u64, 0),
        @atomicLoad(u64, &b.counters.bytes_reported, .monotonic),
    );
    try std.testing.expectEqual(
        @as(u64, 0),
        @atomicLoad(u64, &b.counters.bytes_inflated, .monotonic),
    );
}

test "sortByAddr orders ranges and short-circuits sorted input" {
    var rs = [_]Range{
        .{ .addr = 0x100, .len = 0x10 },
        .{ .addr = 0x080, .len = 0x10 },
        .{ .addr = 0x200, .len = 0x10 },
        .{ .addr = 0x040, .len = 0x10 },
    };
    sortByAddr(&rs);
    try std.testing.expectEqual(@as(u64, 0x040), rs[0].addr);
    try std.testing.expectEqual(@as(u64, 0x080), rs[1].addr);
    try std.testing.expectEqual(@as(u64, 0x100), rs[2].addr);
    try std.testing.expectEqual(@as(u64, 0x200), rs[3].addr);
}

test "coalescing merges adjacent ranges" {
    // Three contiguous 4 MiB blocks should collapse to one 12 MiB
    // range; a non-adjacent fourth block stays separate.
    var ranges = [_]Range{
        .{ .addr = 0x40000000, .len = 0x400000 },
        .{ .addr = 0x40400000, .len = 0x400000 },
        .{ .addr = 0x40800000, .len = 0x400000 },
        .{ .addr = 0x41000000, .len = 0x400000 }, // 4 MiB gap
    };
    sortByAddr(&ranges);
    var n_merged: usize = 1;
    for (ranges[1..]) |r| {
        const tail = &ranges[n_merged - 1];
        if (tail.addr + tail.len == r.addr) {
            tail.len += r.len;
        } else {
            ranges[n_merged] = r;
            n_merged += 1;
        }
    }
    try std.testing.expectEqual(@as(usize, 2), n_merged);
    try std.testing.expectEqual(@as(u64, 0x40000000), ranges[0].addr);
    try std.testing.expectEqual(@as(u64, 0xC00000), ranges[0].len); // 12 MiB
    try std.testing.expectEqual(@as(u64, 0x41000000), ranges[1].addr);
    try std.testing.expectEqual(@as(u64, 0x400000), ranges[1].len);
}
