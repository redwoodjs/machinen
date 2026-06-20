//! virtio-fs device backend (#332) — serves a host directory to the
//! guest over a virtio-fs device instead of FUSE-over-vsock.
//!
//! Shape mirrors `blk.zig`: this struct is the *backend*, and a
//! `virtio.Device` wraps it via `request_handler` / `request_ctx`.
//!
//! ## Why this exists
//!
//! #329 ported the host-side FUSE mount server to Zig. The remaining
//! ~2× gap vs. docker is the FUSE-over-vsock *wire* — per-request vsock
//! RTT, a guest-side fuse-agent byte-pump, single-stream framing.
//! virtio-fs replaces that wire with a virtio device queue: the FUSE
//! request rides the descriptor chain directly, no vsock framing, no
//! guest agent process.
//!
//! ## Protocol
//!
//! virtio-fs speaks a FUSE-derived protocol. Each request is one
//! descriptor chain:
//!
//!   * the device-readable descriptors carry the FUSE request — the
//!     40-byte `fuse_in_header` followed by the op payload, exactly
//!     the bytes the kernel's `/dev/fuse` would emit;
//!   * the device-writable descriptors are where the FUSE reply goes —
//!     the 16-byte `fuse_out_header` followed by the op payload.
//!
//! So the only difference from the vsock transport is framing: there's
//! no u32 length prefix and no socket. We gather the readable side into
//! a contiguous buffer, hand it to the shared `fuse.dispatch`, and
//! scatter the reply back across the writable side. The opcode handlers
//! are the #329 Zig handlers, reused verbatim via `@import("fuse")`.
//!
//! ## Queues
//!
//! virtio-fs has a hiprio queue (0) for FORGET / INTERRUPT and one or
//! more request queues (1..num_request_queues). We advertise a single
//! request queue. `fuse.dispatch` already handles every opcode either
//! queue can carry — FORGET / INTERRUPT return "no reply" — so one
//! handler serves both and no queue is skipped.

const std = @import("std");
const assert = std.debug.assert;
const virtio = @import("virtio.zig");
const fuse = @import("fuse");

/// virtio device ID for virtio-fs (virtio spec 1.2 §5.11). Mirrored
/// into `virtio.DeviceId.virtio_fs`.
pub const VIRTIO_ID_FS: u32 = 26;

/// `struct virtio_fs_config` — the device-specific config space the
/// guest reads at MMIO offset 0x100. 36-byte mount tag plus the count
/// of request virtqueues. Packed extern to match the guest's layout.
pub const FsConfig = extern struct {
    /// Mount tag. `mount -t virtiofs <tag> <dir>` in the guest. NUL-
    /// padded; not necessarily NUL-terminated when exactly 36 bytes.
    tag: [36]u8,
    /// Number of request virtqueues (queues 1..N). We serve one.
    num_request_queues: u32,
};

comptime {
    // The guest driver reads this layout directly out of config space;
    // a size drift would shift `num_request_queues` and the driver
    // would size the wrong number of queues.
    assert(@sizeOf(FsConfig) == 40);
    assert(@offsetOf(FsConfig, "tag") == 0);
    assert(@offsetOf(FsConfig, "num_request_queues") == 36);
}

/// Per-request descriptor-chain cap — the wedge guard for a guest that
/// points `next` in a cycle. virtio-fs needs a *much* larger bound
/// than `virtio.max_chain_descriptors` (32): that constant is sized
/// for net / blk / vsock, whose chains are ≤ 4, but virtio-fs scatters
/// a single 128 KiB FUSE READ/WRITE payload across one descriptor per
/// 4 KiB guest page — 32+ descriptors for the data alone, plus the
/// header and the reply window. Capping at 32 silently truncated
/// large writes (the data tail *and* the writable reply descriptor
/// fell off the end). 256 is the hard ceiling regardless: a split-ring
/// chain can't exceed the queue size, and `queue_num_max` is 256.
const MAX_CHAIN_DESCRIPTORS: u32 = 256;

comptime {
    // A chain physically can't be longer than the virtqueue, and the
    // gather buffer must hold every readable descriptor's bytes — at
    // 4 KiB per page, MAX_FUSE_MESSAGE / 4096 pages is the readable
    // worst case, comfortably under MAX_CHAIN_DESCRIPTORS.
    assert(MAX_CHAIN_DESCRIPTORS >= @divExact(fuse.MAX_FUSE_MESSAGE, 4096) + 4);
}

/// One virtio-fs backend == one live mount. Owns the shared FUSE
/// handler state and a fixed request-gather buffer. Pinned for the
/// VM's lifetime once `init` returns — `virtio.Device.request_ctx`
/// holds a raw pointer to it.
pub const Device = struct {
    /// Shared, transport-agnostic FUSE handler state (#329 handlers).
    state: fuse.State,
    /// Backing store for the config space the `virtio.Device` hands
    /// the guest. Kept here so the slice reference stays stable.
    config: FsConfig,
    /// Single reusable request-gather buffer. The VMM is single-
    /// threaded and `handleRequest` is never re-entrant, so one buffer
    /// per backend is enough — and it keeps the hot path allocation-
    /// free, like the vsock transport's per-connection read buffer.
    req_buf: [fuse.MAX_FUSE_MESSAGE]u8 = undefined,

    /// Build a backend over `root_abs` (a host directory) exposed under
    /// `tag`. `root_abs` must be heap-allocated with `gpa` — `fuse.State`
    /// takes ownership and frees it in `deinit`. `tag` is copied into
    /// fixed config storage; it must be ≤ 36 bytes.
    pub fn init(
        gpa: std.mem.Allocator,
        tag: []const u8,
        root_abs: []u8,
        mode_rw: bool,
    ) !Device {
        assert(tag.len > 0);
        assert(tag.len <= 36);
        assert(root_abs.len > 0);

        var cfg: FsConfig = .{ .tag = @splat(0), .num_request_queues = 1 };
        @memcpy(cfg.tag[0..tag.len], tag);

        return .{
            .state = try fuse.State.init(gpa, root_abs, mode_rw),
            .config = cfg,
        };
    }

    pub fn deinit(self: *Device) void {
        self.state.deinit();
    }

    pub fn enable_profile(self: *Device, profile_path: []const u8) void {
        assert(self.state.root_abs.len > 0);
        if (profile_path.len == 0) return;
        self.state.stats_path = profile_path;
        self.state.profile_enabled = true;
        fuse.write_stats_atomic(&self.state);
    }

    /// The config-space slice for `virtio.Device.config`. Stable for
    /// the backend's lifetime.
    pub fn config_bytes(self: *const Device) []const u8 {
        return std.mem.asBytes(&self.config);
    }

    fn record_profile(
        self: *Device,
        gather_start_ns: u64,
        gather_end_ns: u64,
        dispatch_start_ns: u64,
        dispatch_end_ns: u64,
        scatter_start_ns: u64,
        scatter_end_ns: u64,
        request_bytes: u64,
        reply_bytes: u32,
    ) void {
        assert(self.state.root_abs.len > 0);
        if (!self.state.profile_enabled) return;
        fuse.record_virtqueue_profile(
            &self.state,
            gather_end_ns - gather_start_ns,
            dispatch_end_ns - dispatch_start_ns,
            scatter_end_ns - scatter_start_ns,
            request_bytes,
            reply_bytes,
        );
        if (self.state.virtqueue_request_count % 256 == 0) {
            fuse.write_stats_atomic(&self.state);
        }
    }

    /// `virtio.Device.request_handler` callback. Runs once per
    /// descriptor chain the guest kicks onto a virtio-fs queue —
    /// gathers the FUSE request, dispatches it, scatters the reply.
    ///
    /// Fail-soft throughout: a malformed chain, an out-of-range guest
    /// address, or an allocator failure all end in a zero-length used
    /// entry rather than a wedged VMM. This matches `blk.zig`'s policy
    /// — guest-driven input is never trusted to be well-formed.
    pub fn handle_request(ctx: ?*anyopaque, dev: *virtio.Device, q_idx: u32, head: u16) void {
        assert(ctx != null);
        const self: *Device = @ptrCast(@alignCast(ctx.?));
        assert(self.state.root_abs.len > 0);

        const profile_enabled = self.state.profile_enabled;
        const gather_start_ns = if (profile_enabled) fuse.profile_now_ns() else 0;

        // Walk the chain once. Device-readable descriptors are the FUSE
        // request — gather them contiguously into `req_buf`. Device-
        // writable descriptors are the reply window — remember them so
        // we can scatter the reply back after dispatch.
        var req_len: usize = 0;
        var writable: [MAX_CHAIN_DESCRIPTORS]virtio.VringDesc = undefined;
        var writable_count: usize = 0;

        var idx: u16 = head;
        var steps: u32 = 0;
        // #238-style wedge guard: a guest that points `next` in a cycle
        // would otherwise spin the VMM thread. Truncating an over-long
        // chain is fail-soft — the dispatch below sees a short request
        // and replies EINVAL, or the reply scatter drops bytes. The cap
        // is `MAX_CHAIN_DESCRIPTORS`, sized for virtio-fs's page-per-
        // descriptor large I/O (see the constant's doc comment).
        while (steps < MAX_CHAIN_DESCRIPTORS) : (steps += 1) {
            const d = dev.queue_descriptor(q_idx, idx) orelse break;
            if ((d.flags & virtio.VringDesc.F_WRITE) != 0) {
                if (writable_count < writable.len) {
                    writable[writable_count] = d;
                    writable_count += 1;
                }
            } else if (d.len > 0) {
                const src = dev.guest_bytes(d.addr, d.len) orelse break;
                const take: usize = @min(src.len, self.req_buf.len - req_len);
                @memcpy(self.req_buf[req_len..][0..take], src[0..take]);
                req_len += take;
            }
            if ((d.flags & virtio.VringDesc.F_NEXT) == 0) break;
            idx = d.next;
        }
        const gather_end_ns = if (profile_enabled) fuse.profile_now_ns() else 0;
        assert(steps <= MAX_CHAIN_DESCRIPTORS);
        assert(req_len <= self.req_buf.len);
        assert(writable_count <= writable.len);

        // A frame shorter than the FUSE in-header can't be dispatched —
        // `fuse.dispatch` asserts the precondition. Ack it and move on;
        // a well-formed guest never produces this.
        if (req_len < fuse.FUSE_IN_HEADER_SIZE) {
            self.record_profile(
                gather_start_ns,
                gather_end_ns,
                gather_end_ns,
                gather_end_ns,
                gather_end_ns,
                gather_end_ns,
                @intCast(req_len),
                0,
            );
            dev.queue_push_used(q_idx, head, 0);
            return;
        }

        // `dispatch` returns the reply frame (out-header + payload),
        // allocated with `state.gpa` and owned by us, or null for the
        // no-reply ops (FORGET, INTERRUPT). An error is an allocator
        // failure inside a handler — fail-soft ack, same as a malformed
        // chain.
        const dispatch_start_ns = if (profile_enabled) fuse.profile_now_ns() else 0;
        const reply_opt = fuse.dispatch(&self.state, self.req_buf[0..req_len]) catch {
            const dispatch_end_ns = if (profile_enabled) fuse.profile_now_ns() else 0;
            self.record_profile(
                gather_start_ns,
                gather_end_ns,
                dispatch_start_ns,
                dispatch_end_ns,
                dispatch_end_ns,
                dispatch_end_ns,
                @intCast(req_len),
                0,
            );
            dev.queue_push_used(q_idx, head, 0);
            return;
        };
        const dispatch_end_ns = if (profile_enabled) fuse.profile_now_ns() else 0;
        const reply = reply_opt orelse {
            self.record_profile(
                gather_start_ns,
                gather_end_ns,
                dispatch_start_ns,
                dispatch_end_ns,
                dispatch_end_ns,
                dispatch_end_ns,
                @intCast(req_len),
                0,
            );
            dev.queue_push_used(q_idx, head, 0);
            return;
        };
        defer self.state.gpa.free(reply);

        // Scatter the reply across the writable descriptors in order.
        // A well-formed guest sizes the writable window to fit (the
        // kernel knows the op's max reply); if it doesn't, we copy what
        // fits and report the truncated count — fail-soft, not a wedge.
        const scatter_start_ns = if (profile_enabled) fuse.profile_now_ns() else 0;
        var written: u32 = 0;
        var off: usize = 0;
        for (writable[0..writable_count]) |wd| {
            if (off >= reply.len) break;
            const dst = dev.guest_bytes(wd.addr, wd.len) orelse break;
            const n: usize = @min(dst.len, reply.len - off);
            @memcpy(dst[0..n], reply[off..][0..n]);
            off += n;
            written += @intCast(n);
        }
        const scatter_end_ns = if (profile_enabled) fuse.profile_now_ns() else 0;
        assert(off <= reply.len);
        self.record_profile(
            gather_start_ns,
            gather_end_ns,
            dispatch_start_ns,
            dispatch_end_ns,
            scatter_start_ns,
            scatter_end_ns,
            @intCast(req_len),
            written,
        );
        dev.queue_push_used(q_idx, head, written);
    }
};

// =============================================================
// Tests — fake virtqueue in a flat buffer, no HVF, no kernel.
// Mirrors the ring-setup pattern in virtio.zig's own M2 tests.
// =============================================================

const testing = std.testing;

/// Lay out a split-ring (descriptor table, avail, used) back-to-back
/// at offset 0 of `ram`, returning the configured Queue.
fn test_setup_ring(comptime num: u32) virtio.Queue {
    return .{
        .num = num,
        .ready = 1,
        .desc_addr = 0,
        .driver_addr = num * @sizeOf(virtio.VringDesc),
        .device_addr = num * @sizeOf(virtio.VringDesc) + @sizeOf(virtio.VringAvail) + num * @sizeOf(u16),
    };
}

/// Write descriptor `i` of the table at ram[0].
fn test_put_desc(ram: []u8, i: usize, d: virtio.VringDesc) void {
    @memcpy(ram[i * @sizeOf(virtio.VringDesc) ..][0..@sizeOf(virtio.VringDesc)], std.mem.asBytes(&d));
}

/// Post descriptor `head` on the avail ring (single chain, idx 0).
fn test_post_avail(ram: []u8, q: virtio.Queue, head: u16) void {
    const avail = virtio.VringAvail{ .flags = 0, .idx = 1 };
    @memcpy(ram[q.driver_addr..][0..@sizeOf(virtio.VringAvail)], std.mem.asBytes(&avail));
    std.mem.writeInt(u16, ram[q.driver_addr + @sizeOf(virtio.VringAvail) ..][0..2], head, .little);
}

/// Read the single used-ring entry the device posted.
fn test_read_used(ram: []u8, q: virtio.Queue) virtio.VringUsedElem {
    var elem: virtio.VringUsedElem = undefined;
    const elem_off = q.device_addr + @sizeOf(virtio.VringUsed);
    @memcpy(std.mem.asBytes(&elem), ram[elem_off..][0..@sizeOf(virtio.VringUsedElem)]);
    return elem;
}

test "FsConfig carries the mount tag and one request queue" {
    const gpa = testing.allocator;
    var dev = try Device.init(gpa, "machinen0", try gpa.dupe(u8, "/test-root"), true);
    defer dev.deinit();

    const bytes = dev.config_bytes();
    try testing.expectEqual(@as(usize, 40), bytes.len);
    try testing.expectEqualStrings("machinen0", bytes[0..9]);
    try testing.expectEqual(@as(u8, 0), bytes[9]); // NUL-padded past the tag
    try testing.expectEqual(@as(u32, 1), std.mem.readInt(u32, bytes[36..40], .little));
}

test "handleRequest: FUSE_INIT round-trips through the virtqueue" {
    const gpa = testing.allocator;
    var fsdev = try Device.init(gpa, "machinen0", try gpa.dupe(u8, "/test-root"), true);
    defer fsdev.deinit();

    const num = 8;
    var ram: [8192]u8 = @splat(0);
    var dev = virtio.Device{
        .base = 0x0A00_0000,
        .id = .virtio_fs,
        .ram = &ram,
        .ram_base = 0,
        .request_handler = &Device.handle_request,
        .request_ctx = @ptrCast(&fsdev),
    };
    const q = test_setup_ring(num);
    dev.queues[1] = q;

    // Build a FUSE_INIT request: 40-byte in-header + 16-byte init body.
    // opcode 26 = INIT; the body offers major 7 / minor 36.
    const req_off: u64 = 0x800;
    const reply_off: u64 = 0x1000;
    var req: [56]u8 = @splat(0);
    std.mem.writeInt(u32, req[0..4], 56, .little); // len
    std.mem.writeInt(u32, req[4..8], 26, .little); // opcode = INIT
    std.mem.writeInt(u64, req[8..16], 99, .little); // unique
    std.mem.writeInt(u32, req[40..44], 7, .little); // init major
    std.mem.writeInt(u32, req[44..48], 36, .little); // init minor
    @memcpy(ram[req_off..][0..req.len], &req);

    // Descriptor 0: readable request. Descriptor 1: writable reply
    // window (chained off 0).
    test_put_desc(&ram, 0, .{ .addr = req_off, .len = req.len, .flags = virtio.VringDesc.F_NEXT, .next = 1 });
    test_put_desc(&ram, 1, .{ .addr = reply_off, .len = 256, .flags = virtio.VringDesc.F_WRITE, .next = 0 });
    test_post_avail(&ram, q, 0);

    dev.notify(1);

    // The used entry records how many bytes the device wrote: a FUSE
    // out-header (16) + the fuse_init_out payload (64) = 80.
    const elem = test_read_used(&ram, q);
    try testing.expectEqual(@as(u32, 0), elem.id);
    try testing.expectEqual(@as(u32, fuse.FUSE_OUT_HEADER_SIZE + 64), elem.len);

    // The reply landed in the writable descriptor: error 0, unique
    // echoed, negotiated minor clamped to our 7.31.
    const reply = ram[reply_off..][0..@as(usize, elem.len)];
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, reply[4..8], .little));
    try testing.expectEqual(@as(u64, 99), std.mem.readInt(u64, reply[8..16], .little));
    const init_out = reply[fuse.FUSE_OUT_HEADER_SIZE..];
    try testing.expectEqual(@as(u32, 7), std.mem.readInt(u32, init_out[0..4], .little));
    try testing.expectEqual(@as(u32, 31), std.mem.readInt(u32, init_out[4..8], .little));
}

test "handleRequest: unknown opcode replies ENOSYS without wedging" {
    const gpa = testing.allocator;
    var fsdev = try Device.init(gpa, "machinen0", try gpa.dupe(u8, "/test-root"), true);
    defer fsdev.deinit();

    const num = 8;
    var ram: [8192]u8 = @splat(0);
    var dev = virtio.Device{
        .base = 0x0A00_0000,
        .id = .virtio_fs,
        .ram = &ram,
        .ram_base = 0,
        .request_handler = &Device.handle_request,
        .request_ctx = @ptrCast(&fsdev),
    };
    const q = test_setup_ring(num);
    dev.queues[1] = q;

    const req_off: u64 = 0x800;
    const reply_off: u64 = 0x1000;
    var req: [40]u8 = @splat(0);
    std.mem.writeInt(u32, req[0..4], 40, .little);
    std.mem.writeInt(u32, req[4..8], 9999, .little); // bogus opcode
    std.mem.writeInt(u64, req[8..16], 7, .little); // unique
    @memcpy(ram[req_off..][0..req.len], &req);

    test_put_desc(&ram, 0, .{ .addr = req_off, .len = req.len, .flags = virtio.VringDesc.F_NEXT, .next = 1 });
    test_put_desc(&ram, 1, .{ .addr = reply_off, .len = 256, .flags = virtio.VringDesc.F_WRITE, .next = 0 });
    test_post_avail(&ram, q, 0);

    dev.notify(1);

    const elem = test_read_used(&ram, q);
    try testing.expectEqual(@as(u32, fuse.FUSE_OUT_HEADER_SIZE), elem.len);
    const reply = ram[reply_off..][0..@as(usize, elem.len)];
    // -ENOSYS == -38 in the out-header's error field.
    try testing.expectEqual(@as(i32, -38), std.mem.readInt(i32, reply[4..8], .little));
}

test "handleRequest: a short frame is acked, not dispatched" {
    const gpa = testing.allocator;
    var fsdev = try Device.init(gpa, "machinen0", try gpa.dupe(u8, "/test-root"), true);
    defer fsdev.deinit();

    const num = 8;
    var ram: [8192]u8 = @splat(0);
    var dev = virtio.Device{
        .base = 0x0A00_0000,
        .id = .virtio_fs,
        .ram = &ram,
        .ram_base = 0,
        .request_handler = &Device.handle_request,
        .request_ctx = @ptrCast(&fsdev),
    };
    const q = test_setup_ring(num);
    dev.queues[1] = q;

    // 8-byte readable descriptor — well under the 40-byte in-header.
    test_put_desc(&ram, 0, .{ .addr = 0x800, .len = 8, .flags = 0, .next = 0 });
    test_post_avail(&ram, q, 0);

    dev.notify(1);

    const elem = test_read_used(&ram, q);
    try testing.expectEqual(@as(u32, 0), elem.id);
    try testing.expectEqual(@as(u32, 0), elem.len);
}

// --- end-to-end opcode tests over a real host directory ----------------
//
// The tests above prove the virtqueue framing. These prove the shared
// #329 handlers actually touch the host fs through the virtio-fs path,
// mirroring `mount-server.test.ts`'s contract per the FUSE-ops rule in
// CLAUDE.md: happy path, error path, the `:ro` gate, and a wedge guard.

/// A reply read back out of the writable descriptor.
const TestReply = struct {
    used_len: u32,
    buf: [4096]u8 = @splat(0),

    fn err(self: *const TestReply) i32 {
        return std.mem.readInt(i32, self.buf[4..8], .little);
    }
    /// The op payload — the bytes after the 16-byte fuse_out_header.
    fn payload(self: *const TestReply) []const u8 {
        return self.buf[fuse.FUSE_OUT_HEADER_SIZE..self.used_len];
    }
};

/// Drive one FUSE request through `fsdev`'s virtqueue path and read the
/// reply back. Builds a 2-descriptor chain (readable request → writable
/// 4 KiB reply window), kicks the queue, and copies out the used entry.
fn test_run_op(fsdev: *Device, opcode: u32, unique: u64, nodeid: u64, body: []const u8) TestReply {
    var ram: [16384]u8 = @splat(0);
    var dev = virtio.Device{
        .base = 0x0A00_0000,
        .id = .virtio_fs,
        .ram = &ram,
        .ram_base = 0,
        .request_handler = &Device.handle_request,
        .request_ctx = @ptrCast(fsdev),
    };
    const q = test_setup_ring(8);
    dev.queues[1] = q;

    const req_off: u64 = 0x1000;
    const reply_off: u64 = 0x3000;
    const req_total: u32 = @intCast(fuse.FUSE_IN_HEADER_SIZE + body.len);
    std.mem.writeInt(u32, ram[req_off..][0..4], req_total, .little);
    std.mem.writeInt(u32, ram[req_off + 4 ..][0..4], opcode, .little);
    std.mem.writeInt(u64, ram[req_off + 8 ..][0..8], unique, .little);
    std.mem.writeInt(u64, ram[req_off + 16 ..][0..8], nodeid, .little);
    @memcpy(ram[req_off + fuse.FUSE_IN_HEADER_SIZE ..][0..body.len], body);

    test_put_desc(&ram, 0, .{ .addr = req_off, .len = req_total, .flags = virtio.VringDesc.F_NEXT, .next = 1 });
    test_put_desc(&ram, 1, .{ .addr = reply_off, .len = 4096, .flags = virtio.VringDesc.F_WRITE, .next = 0 });
    test_post_avail(&ram, q, 0);

    dev.notify(1);

    const elem = test_read_used(&ram, q);
    var r = TestReply{ .used_len = elem.len };
    const n: usize = @min(elem.len, r.buf.len);
    @memcpy(r.buf[0..n], ram[reply_off..][0..n]);
    return r;
}

/// Absolute path of a `std.testing.tmpDir` — `<cwd>/.zig-cache/tmp/<sub>`.
/// The #329 FUSE handlers need a real path to stat/open against.
/// Heap-allocated with `gpa`; the caller hands it to `Device.init`,
/// which takes ownership and frees it in `deinit`.
fn test_tmp_root_abs(gpa: std.mem.Allocator, tmp: *const std.testing.TmpDir) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, gpa);
    defer gpa.free(cwd);
    return std.fs.path.join(gpa, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path });
}

test "handleRequest: CREATE materializes a file on the host fs" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    var fsdev = try Device.init(gpa, "machinen0", try test_tmp_root_abs(gpa, &tmp), true);
    defer fsdev.deinit();

    // fuse_create_in: flags(4) mode(4) umask(4) open_flags(4) + name.
    var body: [16 + 12]u8 = @splat(0);
    std.mem.writeInt(u32, body[0..4], 2, .little); // Linux O_RDWR
    std.mem.writeInt(u32, body[4..8], 0o644, .little); // mode
    @memcpy(body[16..][0.."created.txt".len], "created.txt");

    const r = test_run_op(&fsdev, 35, 1, 1, &body); // CREATE, parent = root
    try testing.expectEqual(@as(i32, 0), r.err());
    // The handler ran against the real host fs — the file is there.
    try tmp.dir.access(std.testing.io, "created.txt", .{});
}

test "handleRequest: GETATTR on the root inode stats the host directory" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    var fsdev = try Device.init(gpa, "machinen0", try test_tmp_root_abs(gpa, &tmp), true);
    defer fsdev.deinit();

    const r = test_run_op(&fsdev, 3, 7, 1, &.{}); // GETATTR, nodeid = root
    try testing.expectEqual(@as(i32, 0), r.err());
    // fuse_attr_out = attr_valid(8) + nsec(4) + dummy(4) + fuse_attr(88);
    // fuse_attr.mode sits 60 bytes into fuse_attr. Root is a directory.
    const mode = std.mem.readInt(u32, r.payload()[16 + 60 ..][0..4], .little);
    try testing.expectEqual(@as(u32, 0o040000), mode & 0o170000);
}

test "handleRequest: O_WRONLY open of an existing file supports READ fill and WRITE" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "existing.txt", .data = "old-data" });
    var fsdev = try Device.init(gpa, "machinen0", try test_tmp_root_abs(gpa, &tmp), true);
    defer fsdev.deinit();

    const lookup = test_run_op(&fsdev, 1, 1, 1, "existing.txt\x00");
    try testing.expectEqual(@as(i32, 0), lookup.err());
    const nodeid = std.mem.readInt(u64, lookup.payload()[0..8], .little);

    var open_body: [8]u8 = @splat(0);
    std.mem.writeInt(u32, open_body[0..4], 1 | 0o1000, .little); // O_WRONLY | O_TRUNC
    const open = test_run_op(&fsdev, 14, 2, nodeid, &open_body);
    try testing.expectEqual(@as(i32, 0), open.err());
    const fh = std.mem.readInt(u64, open.payload()[0..8], .little);

    var read_body: [32]u8 = @splat(0);
    std.mem.writeInt(u64, read_body[0..8], fh, .little);
    std.mem.writeInt(u32, read_body[16..20], 16, .little);
    const read = test_run_op(&fsdev, 15, 3, nodeid, &read_body);
    try testing.expectEqual(@as(i32, 0), read.err());

    var write_body: [40 + 3]u8 = @splat(0);
    std.mem.writeInt(u64, write_body[0..8], fh, .little);
    std.mem.writeInt(u32, write_body[16..20], 3, .little);
    @memcpy(write_body[40..], "new");
    const write_reply = test_run_op(&fsdev, 16, 4, nodeid, &write_body);
    try testing.expectEqual(@as(i32, 0), write_reply.err());
    try testing.expectEqual(@as(u32, 3), std.mem.readInt(u32, write_reply.payload()[0..4], .little));

    const got = try tmp.dir.readFileAlloc(std.testing.io, "existing.txt", gpa, .limited(1024));
    defer gpa.free(got);
    try testing.expectEqualStrings("new", got);
}

test "handleRequest: READLINK returns symlink targets and errors through virtio-fs" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "target.txt", .data = "target-data" });
    try tmp.dir.symLink(std.testing.io, "target.txt", "link.txt", .{});
    var fsdev = try Device.init(gpa, "machinen0", try test_tmp_root_abs(gpa, &tmp), true);
    defer fsdev.deinit();

    const lookup = test_run_op(&fsdev, 1, 1, 1, "link.txt\x00");
    try testing.expectEqual(@as(i32, 0), lookup.err());
    const link_nodeid = std.mem.readInt(u64, lookup.payload()[0..8], .little);

    const readlink = test_run_op(&fsdev, 5, 2, link_nodeid, &.{});
    try testing.expectEqual(@as(i32, 0), readlink.err());
    try testing.expectEqualStrings("target.txt", readlink.payload());

    const regular_lookup = test_run_op(&fsdev, 1, 3, 1, "target.txt\x00");
    try testing.expectEqual(@as(i32, 0), regular_lookup.err());
    const regular_nodeid = std.mem.readInt(u64, regular_lookup.payload()[0..8], .little);
    const nonlink = test_run_op(&fsdev, 5, 4, regular_nodeid, &.{});
    try testing.expectEqual(@as(i32, -22), nonlink.err()); // -EINVAL

    const stale = test_run_op(&fsdev, 5, 5, 9999, &.{});
    try testing.expectEqual(@as(i32, -116), stale.err()); // -ESTALE
}

test "handleRequest: LINK creates hardlinks and maps :ro/malformed failures" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "a.txt", .data = "hard" });
    var fsdev = try Device.init(gpa, "machinen0", try test_tmp_root_abs(gpa, &tmp), true);
    defer fsdev.deinit();

    const lookup = test_run_op(&fsdev, 1, 1, 1, "a.txt\x00");
    try testing.expectEqual(@as(i32, 0), lookup.err());
    const oldnodeid = std.mem.readInt(u64, lookup.payload()[0..8], .little);

    var body: [8 + 6]u8 = @splat(0);
    std.mem.writeInt(u64, body[0..8], oldnodeid, .little);
    @memcpy(body[8..][0.."b.txt".len], "b.txt");
    const linked = test_run_op(&fsdev, 13, 2, 1, body[0 .. 8 + "b.txt".len + 1]);
    try testing.expectEqual(@as(i32, 0), linked.err());
    try testing.expectEqual(oldnodeid, std.mem.readInt(u64, linked.payload()[0..8], .little));

    const st = try tmp.dir.statFile(std.testing.io, "a.txt", .{});
    try testing.expect(st.nlink >= 2);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "a.txt", .data = "updated" });
    const got = try tmp.dir.readFileAlloc(std.testing.io, "b.txt", gpa, .limited(1024));
    defer gpa.free(got);
    try testing.expectEqualStrings("updated", got);
    try tmp.dir.deleteFile(std.testing.io, "a.txt");
    const after_unlink = try tmp.dir.readFileAlloc(std.testing.io, "b.txt", gpa, .limited(1024));
    defer gpa.free(after_unlink);
    try testing.expectEqualStrings("updated", after_unlink);

    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "a.txt", .data = "again" });
    const rel_lookup = test_run_op(&fsdev, 1, 3, 1, "a.txt\x00");
    try testing.expectEqual(@as(i32, 0), rel_lookup.err());
    std.mem.writeInt(u64, body[0..8], std.mem.readInt(u64, rel_lookup.payload()[0..8], .little), .little);
    const exists = test_run_op(&fsdev, 13, 4, 1, body[0 .. 8 + "b.txt".len + 1]);
    try testing.expectEqual(@as(i32, -17), exists.err()); // -EEXIST

    var ro = try Device.init(gpa, "machinen1", try test_tmp_root_abs(gpa, &tmp), false);
    defer ro.deinit();
    const ro_lookup = test_run_op(&ro, 1, 5, 1, "a.txt\x00");
    try testing.expectEqual(@as(i32, 0), ro_lookup.err());
    var ro_body: [8 + 9]u8 = @splat(0);
    std.mem.writeInt(u64, ro_body[0..8], std.mem.readInt(u64, ro_lookup.payload()[0..8], .little), .little);
    @memcpy(ro_body[8..][0.."ro-b.txt".len], "ro-b.txt");
    const blocked = test_run_op(&ro, 13, 6, 1, ro_body[0 .. 8 + "ro-b.txt".len + 1]);
    try testing.expectEqual(@as(i32, -30), blocked.err()); // -EROFS
    try testing.expectError(error.FileNotFound, tmp.dir.access(std.testing.io, "ro-b.txt", .{}));

    const malformed = test_run_op(&fsdev, 13, 7, 1, "short");
    try testing.expectEqual(@as(i32, -22), malformed.err()); // -EINVAL, not a wedge
}

test "handleRequest: SETATTR FATTR_MODE makes chmod executable on the host" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "script.sh", .data = "#!/bin/sh\necho hi\n" });
    var fsdev = try Device.init(gpa, "machinen0", try test_tmp_root_abs(gpa, &tmp), true);
    defer fsdev.deinit();

    const lookup = test_run_op(&fsdev, 1, 1, 1, "script.sh\x00");
    try testing.expectEqual(@as(i32, 0), lookup.err());
    const nodeid = std.mem.readInt(u64, lookup.payload()[0..8], .little);

    var body: [88]u8 = @splat(0);
    std.mem.writeInt(u32, body[0..4], 1, .little); // FATTR_MODE
    std.mem.writeInt(u32, body[68..72], 0o755, .little);
    const chmodded = test_run_op(&fsdev, 4, 2, nodeid, &body);
    try testing.expectEqual(@as(i32, 0), chmodded.err());
    const mode = std.mem.readInt(u32, chmodded.payload()[16 + 60 ..][0..4], .little);
    try testing.expectEqual(@as(u32, 0o755), mode & 0o777);

    const st = try tmp.dir.statFile(std.testing.io, "script.sh", .{});
    try testing.expectEqual(@as(u32, 0o755), @as(u32, @intCast(st.permissions.toMode())) & 0o777);

    var ro = try Device.init(gpa, "machinen1", try test_tmp_root_abs(gpa, &tmp), false);
    defer ro.deinit();
    const ro_lookup = test_run_op(&ro, 1, 3, 1, "script.sh\x00");
    try testing.expectEqual(@as(i32, 0), ro_lookup.err());
    const ro_nodeid = std.mem.readInt(u64, ro_lookup.payload()[0..8], .little);
    std.mem.writeInt(u32, body[68..72], 0o600, .little);
    const blocked = test_run_op(&ro, 4, 4, ro_nodeid, &body);
    try testing.expectEqual(@as(i32, -30), blocked.err()); // -EROFS
}

test "handleRequest: RMDIR removes empty dirs and maps ENOTEMPTY/:ro/malformed failures" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.createDir(std.testing.io, "empty", .default_dir);
    try tmp.dir.createDir(std.testing.io, "nonempty", .default_dir);
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "nonempty/child.txt", .data = "x" });
    try tmp.dir.createDir(std.testing.io, "blocked", .default_dir);
    var fsdev = try Device.init(gpa, "machinen0", try test_tmp_root_abs(gpa, &tmp), true);
    defer fsdev.deinit();

    const removed = test_run_op(&fsdev, 11, 1, 1, "empty\x00");
    try testing.expectEqual(@as(i32, 0), removed.err());
    try testing.expectError(error.FileNotFound, tmp.dir.access(std.testing.io, "empty", .{}));

    const nonempty = test_run_op(&fsdev, 11, 2, 1, "nonempty\x00");
    try testing.expectEqual(@as(i32, -39), nonempty.err()); // -ENOTEMPTY, not -EIO
    try tmp.dir.access(std.testing.io, "nonempty/child.txt", .{});

    const missing = test_run_op(&fsdev, 11, 3, 1, "missing\x00");
    try testing.expectEqual(@as(i32, -2), missing.err()); // -ENOENT

    var ro = try Device.init(gpa, "machinen1", try test_tmp_root_abs(gpa, &tmp), false);
    defer ro.deinit();
    const blocked = test_run_op(&ro, 11, 4, 1, "blocked\x00");
    try testing.expectEqual(@as(i32, -30), blocked.err()); // -EROFS
    try tmp.dir.access(std.testing.io, "blocked", .{});

    const malformed = test_run_op(&fsdev, 11, 5, 1, "bad/name\x00");
    try testing.expectEqual(@as(i32, -22), malformed.err()); // -EINVAL, not a wedge
}

test "handleRequest: RENAME replaces an existing file and :ro/malformed paths fail soft" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "src.txt", .data = "source" });
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = "dst.txt", .data = "dest" });
    var fsdev = try Device.init(gpa, "machinen0", try test_tmp_root_abs(gpa, &tmp), true);
    defer fsdev.deinit();

    var rename_body: [8 + 16]u8 = @splat(0);
    std.mem.writeInt(u64, rename_body[0..8], 1, .little); // newdir = root
    @memcpy(rename_body[8..][0.."src.txt".len], "src.txt");
    @memcpy(rename_body[8 + "src.txt".len + 1 ..][0.."dst.txt".len], "dst.txt");
    const rename_len = 8 + "src.txt".len + 1 + "dst.txt".len + 1;
    const renamed = test_run_op(&fsdev, 12, 1, 1, rename_body[0..rename_len]);
    try testing.expectEqual(@as(i32, 0), renamed.err());
    try testing.expectError(error.FileNotFound, tmp.dir.access(std.testing.io, "src.txt", .{}));
    const got = try tmp.dir.readFileAlloc(std.testing.io, "dst.txt", gpa, .limited(1024));
    defer gpa.free(got);
    try testing.expectEqualStrings("source", got);

    var missing_body: [8 + 16]u8 = @splat(0);
    std.mem.writeInt(u64, missing_body[0..8], 1, .little);
    @memcpy(missing_body[8..][0.."missing".len], "missing");
    @memcpy(missing_body[8 + "missing".len + 1 ..][0.."other".len], "other");
    const missing_len = 8 + "missing".len + 1 + "other".len + 1;
    const missing = test_run_op(&fsdev, 12, 2, 1, missing_body[0..missing_len]);
    try testing.expectEqual(@as(i32, -2), missing.err()); // -ENOENT

    var ro = try Device.init(gpa, "machinen1", try test_tmp_root_abs(gpa, &tmp), false);
    defer ro.deinit();
    const blocked = test_run_op(&ro, 12, 3, 1, rename_body[0..rename_len]);
    try testing.expectEqual(@as(i32, -30), blocked.err()); // -EROFS

    const malformed = test_run_op(&fsdev, 12, 4, 1, "short");
    try testing.expectEqual(@as(i32, -22), malformed.err()); // -EINVAL, not a wedge
}

test "handleRequest: LOOKUP of a missing name returns ENOENT" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    var fsdev = try Device.init(gpa, "machinen0", try test_tmp_root_abs(gpa, &tmp), true);
    defer fsdev.deinit();

    const r = test_run_op(&fsdev, 1, 9, 1, "nonexistent\x00"); // LOOKUP under root
    try testing.expectEqual(@as(i32, -2), r.err()); // -ENOENT
}

test "handleRequest: CREATE on a :ro mount returns EROFS and never touches the host" {
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    var fsdev = try Device.init(gpa, "machinen0", try test_tmp_root_abs(gpa, &tmp), false); // :ro
    defer fsdev.deinit();

    var body: [16 + 12]u8 = @splat(0);
    std.mem.writeInt(u32, body[0..4], 2, .little);
    std.mem.writeInt(u32, body[4..8], 0o644, .little);
    @memcpy(body[16..][0.."blocked.txt".len], "blocked.txt");

    const r = test_run_op(&fsdev, 35, 1, 1, &body); // CREATE
    try testing.expectEqual(@as(i32, -30), r.err()); // -EROFS
    // The `:ro` gate fires before any host syscall — nothing was created.
    try testing.expectError(error.FileNotFound, tmp.dir.access(std.testing.io, "blocked.txt", .{}));
}

test "handleRequest: a self-cycling descriptor chain is capped, not hung" {
    const gpa = testing.allocator;
    var fsdev = try Device.init(gpa, "machinen0", try gpa.dupe(u8, "/test-root"), true);
    defer fsdev.deinit();

    var ram: [8192]u8 = @splat(0);
    var dev = virtio.Device{
        .base = 0x0A00_0000,
        .id = .virtio_fs,
        .ram = &ram,
        .ram_base = 0,
        .request_handler = &Device.handle_request,
        .request_ctx = @ptrCast(&fsdev),
    };
    const q = test_setup_ring(8);
    dev.queues[1] = q;

    // desc 0 points `next` at itself with F_NEXT set — an infinite
    // cycle without the max_chain_descriptors cap. len 0 keeps the
    // gather empty so the capped walk ends in a short-frame ack. The
    // assertion that matters is simply that `notify` *returns*.
    test_put_desc(&ram, 0, .{ .addr = 0x800, .len = 0, .flags = virtio.VringDesc.F_NEXT, .next = 0 });
    test_post_avail(&ram, q, 0);

    dev.notify(1);

    const elem = test_read_used(&ram, q);
    try testing.expectEqual(@as(u32, 0), elem.id);
    try testing.expectEqual(@as(u32, 0), elem.len);
}

test "handleRequest: a large WRITE spanning >32 descriptors is fully gathered" {
    // Regression for the #332 cap bug: a 128 KiB+ FUSE WRITE arrives as
    // one descriptor per 4 KiB guest page, so the chain runs well past
    // the old 32-descriptor cap. Capping there truncated the payload
    // (and dropped the writable reply descriptor) — large writes over
    // a virtio-fs live mount silently corrupted. T9v in smoke-tests.sh
    // is the end-to-end guard; this is the fast in-`zig build test` one.
    const gpa = testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    var fsdev = try Device.init(gpa, "machinen0", try test_tmp_root_abs(gpa, &tmp), true);
    defer fsdev.deinit();

    // CREATE the target file and capture its handle. fuse_create_in
    // (16) + name; the reply is entry_out(128) + open_out(16), fh at
    // payload offset 128.
    var create_body: [16 + 8]u8 = @splat(0);
    std.mem.writeInt(u32, create_body[0..4], 2, .little); // Linux O_RDWR
    std.mem.writeInt(u32, create_body[4..8], 0o644, .little);
    @memcpy(create_body[16..][0.."big.bin".len], "big.bin");
    const create = test_run_op(&fsdev, 35, 1, 1, &create_body);
    try testing.expectEqual(@as(i32, 0), create.err());
    const fh = std.mem.readInt(u64, create.payload()[128..136], .little);

    // Build a WRITE whose payload is fragmented one 4 KiB page per
    // descriptor — 40 pages = 160 KiB, well past the old 32-desc cap.
    // Chain: [in_header + fuse_write_in] -> 40 data descs -> [reply].
    const page: usize = 4096;
    const pages: usize = 40;
    const payload_len: usize = page * pages;
    var ram: [512 * 1024]u8 = @splat(0);
    var dev = virtio.Device{
        .base = 0x0A00_0000,
        .id = .virtio_fs,
        .ram = &ram,
        .ram_base = 0,
        .request_handler = &Device.handle_request,
        .request_ctx = @ptrCast(&fsdev),
    };
    const q = test_setup_ring(64);
    dev.queues[1] = q;

    const hdr_off: u64 = 0x4000;
    const data_off: u64 = 0x6000;
    const reply_off: u64 = 0x60000;
    // fuse_in_header (40 bytes).
    std.mem.writeInt(u32, ram[hdr_off..][0..4], @intCast(fuse.FUSE_IN_HEADER_SIZE + 40 + payload_len), .little);
    std.mem.writeInt(u32, ram[hdr_off + 4 ..][0..4], 16, .little); // opcode WRITE
    std.mem.writeInt(u64, ram[hdr_off + 8 ..][0..8], 77, .little); // unique
    std.mem.writeInt(u64, ram[hdr_off + 16 ..][0..8], 1, .little); // nodeid
    // fuse_write_in (40 bytes): fh(8) offset(8) size(4) ...
    std.mem.writeInt(u64, ram[hdr_off + 40 ..][0..8], fh, .little);
    std.mem.writeInt(u64, ram[hdr_off + 48 ..][0..8], 0, .little); // offset
    std.mem.writeInt(u32, ram[hdr_off + 56 ..][0..4], @intCast(payload_len), .little); // size
    // payload — a deterministic byte pattern.
    for (0..payload_len) |i| ram[data_off + i] = @intCast(i & 0xff);

    // desc 0: the 80-byte header (in-header + fuse_write_in).
    test_put_desc(&ram, 0, .{
        .addr = hdr_off,
        .len = @intCast(fuse.FUSE_IN_HEADER_SIZE + 40),
        .flags = virtio.VringDesc.F_NEXT,
        .next = 1,
    });
    // descs 1..pages: one 4 KiB data page each.
    var i: usize = 0;
    while (i < pages) : (i += 1) {
        test_put_desc(&ram, 1 + i, .{
            .addr = data_off + i * page,
            .len = page,
            .flags = virtio.VringDesc.F_NEXT,
            .next = @intCast(2 + i),
        });
    }
    // final desc: the writable reply window.
    test_put_desc(&ram, 1 + pages, .{
        .addr = reply_off,
        .len = 256,
        .flags = virtio.VringDesc.F_WRITE,
        .next = 0,
    });
    test_post_avail(&ram, q, 0);

    dev.notify(1);

    // The reply is fuse_write_out, and its `size` must equal the full
    // payload — proof the gather walked every descriptor, not just 32.
    const elem = test_read_used(&ram, q);
    try testing.expectEqual(@as(u32, fuse.FUSE_OUT_HEADER_SIZE + 8), elem.len);
    const reply = ram[reply_off..][0..@as(usize, elem.len)];
    try testing.expectEqual(@as(i32, 0), std.mem.readInt(i32, reply[4..8], .little));
    try testing.expectEqual(
        @as(u32, @intCast(payload_len)),
        std.mem.readInt(u32, reply[fuse.FUSE_OUT_HEADER_SIZE..][0..4], .little),
    );
}
