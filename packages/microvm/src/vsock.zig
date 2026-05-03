//! virtio-vsock device — guest↔host stream sockets over virtio.
//!
//! # M1 scope (#44)
//!
//! * Host-initiated stream connections only. The guest already has a
//!   working kernel driver (vmw_vsock_virtio_transport.ko); all we do
//!   is serve packets.
//! * One guest (CID=3), one host (CID=2). No multi-tenancy.
//! * A small port map declared at VMM boot: each entry says "when a
//!   UDS client connects to this host socket path, open a stream to
//!   the guest on this port." That's enough for:
//!
//!     host$ nc -U /tmp/machinen-vsock-1234.sock
//!     guest$ socat VSOCK-LISTEN:1234,fork -
//!
//! * No credit-based flow control. We advertise a big buf_alloc on
//!   every packet; the guest kernel respects that pace.
//!
//! # Packet layout
//!
//! Every TX/RX chain carries exactly one packet: a 44-byte header
//! followed by 0..len bytes of payload. Chains are descriptor chains,
//! possibly split across multiple descriptors, so we gather/scatter.
//!
//! Header (virtio_vsock_hdr, little-endian):
//!
//!   0   src_cid   u64
//!   8   dst_cid   u64
//!  16   src_port  u32
//!  20   dst_port  u32
//!  24   len       u32  — payload byte count (bytes after the header)
//!  28   type      u16  — 1 = stream
//!  30   op        u16  — see Op
//!  32   flags     u32  — SHUTDOWN uses bit 0 (recv) / bit 1 (send)
//!  36   buf_alloc u32  — how many bytes peer may send us before draining
//!  40   fwd_cnt   u32  — bytes we've consumed (for credit update)

const std = @import("std");
const builtin = @import("builtin");
const virtio = @import("virtio.zig");
const assert = std.debug.assert;

/// Platform-sized pthread mutex. Zig 0.16 moved `std.Thread.Mutex`
/// under `std.Io` (it now requires an Io context), so we bind
/// pthread directly rather than take on that dependency just for
/// a lock. macOS layout: 64 bytes with a `sig` magic. Linux glibc
/// layout: 40 bytes, all-zeros == `PTHREAD_MUTEX_INITIALIZER`.
///
/// Mirrors `pl011.PthreadMutex`. The previous form here hardcoded
/// the macOS magic into a 64-byte struct and relied on the bridge
/// thread being the only caller — on Linux that magic put glibc's
/// pthread_mutex_lock into an undefined state so the bridge silently
/// hung, but no other thread tried to take the same mutex so nothing
/// else broke. The vsock-MMIO lock-take in boot_kvm.zig is the first
/// place the vCPU thread tries to acquire it, which is what surfaced
/// the bug as a kernel hang at earlycon.
const PthreadMutex = extern struct {
    _bytes: [64]u8 align(8) = if (builtin.os.tag == .macos) macosInit() else @splat(0),

    fn macosInit() [64]u8 {
        var out: [64]u8 = @splat(0);
        // sig = 0x32AAABA7 (macOS PTHREAD_MUTEX_INITIALIZER magic).
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

pub const header_size: usize = 44;

pub const host_cid: u64 = 2;
pub const default_guest_cid: u64 = 3;

/// On-wire virtio_vsock_hdr. Extern + packed field order; the whole
/// structure is little-endian on every arch that matters (arm64 LE).
pub const VsockHdr = extern struct {
    src_cid: u64,
    dst_cid: u64,
    src_port: u32,
    dst_port: u32,
    len: u32,
    type: u16,
    op: u16,
    flags: u32,
    buf_alloc: u32,
    fwd_cnt: u32,

    pub fn encode(self: VsockHdr, out: *[header_size]u8) void {
        std.mem.writeInt(u64, out[0..8], self.src_cid, .little);
        std.mem.writeInt(u64, out[8..16], self.dst_cid, .little);
        std.mem.writeInt(u32, out[16..20], self.src_port, .little);
        std.mem.writeInt(u32, out[20..24], self.dst_port, .little);
        std.mem.writeInt(u32, out[24..28], self.len, .little);
        std.mem.writeInt(u16, out[28..30], self.type, .little);
        std.mem.writeInt(u16, out[30..32], self.op, .little);
        std.mem.writeInt(u32, out[32..36], self.flags, .little);
        std.mem.writeInt(u32, out[36..40], self.buf_alloc, .little);
        std.mem.writeInt(u32, out[40..44], self.fwd_cnt, .little);
    }

    pub fn decode(in: *const [header_size]u8) VsockHdr {
        return .{
            .src_cid = std.mem.readInt(u64, in[0..8], .little),
            .dst_cid = std.mem.readInt(u64, in[8..16], .little),
            .src_port = std.mem.readInt(u32, in[16..20], .little),
            .dst_port = std.mem.readInt(u32, in[20..24], .little),
            .len = std.mem.readInt(u32, in[24..28], .little),
            .type = std.mem.readInt(u16, in[28..30], .little),
            .op = std.mem.readInt(u16, in[30..32], .little),
            .flags = std.mem.readInt(u32, in[32..36], .little),
            .buf_alloc = std.mem.readInt(u32, in[36..40], .little),
            .fwd_cnt = std.mem.readInt(u32, in[40..44], .little),
        };
    }
};

// Note: @sizeOf(VsockHdr) rounds up to 48 due to u64 alignment. We
// don't memcpy this struct to/from guest RAM — encode/decode below is
// the authoritative wire format (44 bytes, no padding).

pub const Op = enum(u16) {
    invalid = 0,
    request = 1,
    response = 2,
    rst = 3,
    shutdown = 4,
    rw = 5,
    credit_update = 6,
    credit_request = 7,
    _,
};

pub const Type = enum(u16) {
    stream = 1,
    dgram = 3,
    seqpacket = 2,
    _,
};

pub const ShutdownFlag = struct {
    pub const recv: u32 = 1 << 0;
    pub const send: u32 = 1 << 1;
    pub const both: u32 = recv | send;
};

/// Queue indices the Linux virtio-vsock driver uses.
pub const Q_RX: u32 = 0;
pub const Q_TX: u32 = 1;
pub const Q_EVENT: u32 = 2;

/// Max per-packet payload. The driver will split larger sends across
/// packets; this just bounds our scratch buffer (TX direction).
pub const max_payload: usize = 64 * 1024;

/// Per-iteration cap on the wake-pipe drain in the bridge poll loop.
/// Each read drains up to 64 B; 256 iterations covers a 16 KiB
/// backlog. A peer that keeps writing past this just wakes us again
/// next poll — the surrounding poll() already serves as the rate limit.
pub const wake_drain_iters_max: u32 = 256;

/// Cumulative EAGAIN stalls allowed while waiting for a UDS write to
/// drain in dispatchGuestPacket. Each stall is a 100 ms poll, so 50
/// caps the per-packet wait at ~5 s before we give up on a wedged
/// peer rather than block the bridge thread indefinitely.
pub const tx_eagain_stalls_max: u32 = 50;

/// Hard cap on entries parsed out of MACHINEN_VSOCK. Bounded by the
/// number of port-mapping arguments a sane operator would ever pass.
/// Keeps parseEnv from looping forever on a pathological input.
pub const parse_env_entries_max: u32 = 256;

/// Initial capacity for `Bridge.runThread`'s pollset scratch slice.
/// Sized to comfortably cover the steady-state pollset (one entry per
/// listener + one per active connection + the wake-pipe head); chosen
/// to keep the realloc branch in `runThread` from firing under any
/// realistic operator config. NASA Power-of-Ten Rule 3, see
/// .docs/learnings/microvm/allocations.md (#240).
pub const bridge_initial_poll_cap: usize = 256;

/// Per-packet body cap we use when INJECTING RX packets into the
/// guest. The Linux virtio-vsock driver posts RX buffers as a
/// SINGLE flat descriptor (not a chain — contrary to what the
/// spec-tour docs imply). Observed size in Debian 6.1 + modern
/// kernels is 3776 bytes, covering both the 44-byte vsock header
/// AND the body. So the body cap is 3776 - 44 = 3732. We round
/// down further for safety — if any future kernel lowers the
/// buffer size we'd rather ship packets that fit than silently
/// corrupt streams.
///
/// The symptom of exceeding this cap is writePacket returning null,
/// injectRx returning false, and `drainConnection` silently losing
/// whatever it just read from the UDS. File-transfer #57 turned
/// that into "tar says This does not look like a tar archive"
/// because the tar header bytes were the ones dropped.
///
/// Callers that want to send > 3600 bytes just call drain multiple
/// times; the poll loop re-fires while there's data in the UDS and
/// room in the peer window.
pub const rx_body_per_packet_max: usize = 3600;

/// buf_alloc we advertise on every header we emit. Bigger is cheaper:
/// fewer credit updates. The guest driver caps its in-flight bytes to
/// this before draining.
pub const advertised_buf_alloc: u32 = 256 * 1024;

comptime {
    // Wire-format size: every encode/decode call assumes a 44-byte
    // virtio_vsock_hdr. (@sizeOf(VsockHdr) is 48 because the u64s
    // force 8-byte alignment — encode/decode is the wire authority,
    // not the struct layout.)
    assert(header_size == 44);
    // Op enum values are wire constants; flipping any of these would
    // silently mistype packets in dispatchGuestPacket.
    assert(@intFromEnum(Op.invalid) == 0);
    assert(@intFromEnum(Op.request) == 1);
    assert(@intFromEnum(Op.response) == 2);
    assert(@intFromEnum(Op.rst) == 3);
    assert(@intFromEnum(Op.shutdown) == 4);
    assert(@intFromEnum(Op.rw) == 5);
    assert(@intFromEnum(Op.credit_update) == 6);
    assert(@intFromEnum(Op.credit_request) == 7);
    assert(@intFromEnum(Type.stream) == 1);
    // Queue indices we route through virtio.Device must fit the
    // device's queue table.
    assert(Q_RX < virtio.max_queues);
    assert(Q_TX < virtio.max_queues);
    assert(Q_EVENT < virtio.max_queues);
    assert(Q_RX != Q_TX and Q_TX != Q_EVENT and Q_RX != Q_EVENT);
    // CIDs are protocol-fixed; mixing them up would mis-route packets.
    assert(host_cid != default_guest_cid);
    // RX body cap leaves room for the header inside the kernel-posted
    // 4096-byte buffer (3776 observed - 44 header = 3732, rounded to 3600).
    assert(rx_body_per_packet_max + header_size < 4096);
    assert(rx_body_per_packet_max > 0);
    assert(advertised_buf_alloc > 0);
    assert(max_payload >= rx_body_per_packet_max);
    // ShutdownFlag bit layout matches the wire spec.
    assert(ShutdownFlag.recv == 1);
    assert(ShutdownFlag.send == 2);
    assert(ShutdownFlag.both == 3);
    assert(wake_drain_iters_max > 0);
    assert(tx_eagain_stalls_max > 0);
    assert(parse_env_entries_max > 0);
    assert(bridge_initial_poll_cap > 0);
}

/// Parse a `MACHINEN_VSOCK` value into a `PortMap` list.
///
/// Accepted shapes per entry (comma-separated):
///
///   `<port>:<path>`     — legacy inbound (host listens, guest accepts)
///   `in:<port>:<path>`  — inbound
///   `out:<port>:<path>` — outbound (guest connects; host dials the
///                         UDS when the guest's REQUEST lands)
///
/// The returned slice and the path strings inside it are allocated
/// with `gpa` and must be freed by the caller (via `freeParsed`).
pub fn parseEnv(gpa: std.mem.Allocator, raw: []const u8) ![]PortMap {
    var list: std.ArrayList(PortMap) = .empty;
    errdefer {
        for (list.items) |pm| gpa.free(pm.uds_path);
        list.deinit(gpa);
    }
    var rest: []const u8 = raw;
    var entries: u32 = 0;
    // #238: cap entries so a pathological env value can't pin the
    // parser. Real configs have a handful of mappings; 256 is far
    // beyond anything a sane operator would set.
    while (rest.len > 0 and entries < parse_env_entries_max) : (entries += 1) {
        const end = std.mem.indexOfScalar(u8, rest, ',') orelse rest.len;
        var entry = rest[0..end];
        if (end < rest.len) rest = rest[end + 1 ..] else rest = "";
        if (entry.len == 0) continue;

        var direction: Direction = .inbound;
        if (std.mem.startsWith(u8, entry, "in:")) {
            entry = entry[3..];
        } else if (std.mem.startsWith(u8, entry, "out:")) {
            direction = .outbound;
            entry = entry[4..];
        }

        const colon = std.mem.indexOfScalar(u8, entry, ':') orelse return error.MissingColon;
        const port_str = entry[0..colon];
        const path_str = entry[colon + 1 ..];
        const port = std.fmt.parseInt(u32, port_str, 10) catch return error.BadPort;
        if (path_str.len == 0) return error.EmptyPath;

        const path = try gpa.allocSentinel(u8, path_str.len, 0);
        @memcpy(path[0..path_str.len], path_str);
        try list.append(gpa, .{ .guest_port = port, .uds_path = path, .direction = direction });
    }
    return list.toOwnedSlice(gpa);
}

pub fn freeParsed(gpa: std.mem.Allocator, parsed: []PortMap) void {
    for (parsed) |pm| gpa.free(pm.uds_path);
    gpa.free(parsed);
}

// =============================================================
// Pure tests — no HVF, no sockets.
// =============================================================

test "VsockHdr round-trips through encode/decode" {
    const hdr = VsockHdr{
        .src_cid = host_cid,
        .dst_cid = default_guest_cid,
        .src_port = 49152,
        .dst_port = 1234,
        .len = 5,
        .type = @intFromEnum(Type.stream),
        .op = @intFromEnum(Op.request),
        .flags = 0,
        .buf_alloc = advertised_buf_alloc,
        .fwd_cnt = 0,
    };
    var buf: [header_size]u8 = @splat(0);
    hdr.encode(&buf);
    const out = VsockHdr.decode(&buf);
    try std.testing.expectEqual(hdr.src_cid, out.src_cid);
    try std.testing.expectEqual(hdr.dst_cid, out.dst_cid);
    try std.testing.expectEqual(hdr.src_port, out.src_port);
    try std.testing.expectEqual(hdr.dst_port, out.dst_port);
    try std.testing.expectEqual(hdr.len, out.len);
    try std.testing.expectEqual(hdr.type, out.type);
    try std.testing.expectEqual(hdr.op, out.op);
    try std.testing.expectEqual(hdr.flags, out.flags);
    try std.testing.expectEqual(hdr.buf_alloc, out.buf_alloc);
    try std.testing.expectEqual(hdr.fwd_cnt, out.fwd_cnt);
}

test "VsockHdr encode writes fields at documented offsets" {
    const hdr = VsockHdr{
        .src_cid = 0x1122_3344_5566_7788,
        .dst_cid = 0xAABB_CCDD_EEFF_0011,
        .src_port = 0xDEAD_BEEF,
        .dst_port = 0xCAFE_0001,
        .len = 0x00AA_00BB,
        .type = 1,
        .op = 5,
        .flags = 0x8000_0001,
        .buf_alloc = 0x0001_0000,
        .fwd_cnt = 0x0000_0042,
    };
    var buf: [header_size]u8 = @splat(0);
    hdr.encode(&buf);
    // src_cid little-endian at [0..8]
    try std.testing.expectEqual(@as(u8, 0x88), buf[0]);
    try std.testing.expectEqual(@as(u8, 0x77), buf[1]);
    try std.testing.expectEqual(@as(u8, 0x11), buf[7]);
    // op at [30..32], little-endian 0x0005
    try std.testing.expectEqual(@as(u8, 0x05), buf[30]);
    try std.testing.expectEqual(@as(u8, 0x00), buf[31]);
    // fwd_cnt at [40..44], low byte 0x42
    try std.testing.expectEqual(@as(u8, 0x42), buf[40]);
}

test "Op and Type enums survive unknown values via catch-all" {
    const op: Op = @enumFromInt(999);
    try std.testing.expect(op != .request);
    const ty: Type = @enumFromInt(42);
    try std.testing.expect(ty != .stream);
}

// ---------------------------------------------------------------
// Walk a guest descriptor chain and pull out the packet (hdr + body).
// ---------------------------------------------------------------

/// Read one TX packet off a descriptor chain starting at `head`.
/// Returns the parsed header plus a borrowed slice of the payload
/// that lives inside the caller-provided `scratch` buffer.
///
/// Returns `null` if the chain is malformed (too short, header read
/// went out of guest RAM, etc.).
pub fn readPacket(
    dev: *virtio.Device,
    q_idx: u32,
    head: u16,
    scratch: []u8,
) ?struct { hdr: VsockHdr, body: []const u8 } {
    // Programmer-side preconditions: caller picks a real queue index
    // and gives us a scratch large enough to hold at least the header.
    assert(q_idx < virtio.max_queues);
    assert(scratch.len >= header_size);
    // Gather the whole chain contents into scratch. The split between
    // "header" and "body" is fixed at header_size bytes, regardless of
    // how the descriptors fall.
    var written: usize = 0;
    var idx: u16 = head;
    var steps: u32 = 0;
    // Chain length is guest-driven; cap at virtio.max_chain_descriptors
    // (the same 32-entry policy as blk.zig and virtio's own walks)
    // and silently truncate longer chains.
    while (steps < virtio.max_chain_descriptors) : (steps += 1) {
        const d = dev.queueDescriptor(q_idx, idx) orelse return null;
        if (d.len > 0) {
            const take: usize = @min(@as(usize, d.len), scratch.len - written);
            if (take > 0) {
                const src = dev.guestBytes(d.addr, take) orelse return null;
                @memcpy(scratch[written..][0..take], src);
                written += take;
            }
        }
        if ((d.flags & virtio.VringDesc.F_NEXT) == 0) break;
        idx = d.next;
    }
    assert(steps <= virtio.max_chain_descriptors);
    assert(written <= scratch.len);
    if (written < header_size) return null;

    var hdr_bytes: [header_size]u8 = undefined;
    @memcpy(&hdr_bytes, scratch[0..header_size]);
    const hdr = VsockHdr.decode(&hdr_bytes);

    const body_end: usize = @min(scratch.len, header_size + @as(usize, hdr.len));
    assert(body_end >= header_size);
    assert(body_end <= scratch.len);
    const body = scratch[header_size..body_end];
    return .{ .hdr = hdr, .body = body };
}

/// Write one RX packet into the descriptor chain starting at `head`.
/// Lays down hdr.encode() followed by `body`. Returns the number of
/// bytes written (= header_size + body.len on success), or `null` if
/// the chain was too short to hold everything.
pub fn writePacket(
    dev: *virtio.Device,
    q_idx: u32,
    head: u16,
    hdr: VsockHdr,
    body: []const u8,
) ?u32 {
    assert(q_idx < virtio.max_queues);
    // The bridge never hands us > max_payload bytes; bigger means a
    // caller bug, not a guest one.
    assert(body.len <= max_payload);
    var hdr_bytes: [header_size]u8 = undefined;
    hdr.encode(&hdr_bytes);

    var remaining_hdr: []const u8 = &hdr_bytes;
    var remaining_body: []const u8 = body;

    var idx: u16 = head;
    var steps: u32 = 0;
    var total: u32 = 0;
    // Mirror the readPacket bound: cap at virtio.max_chain_descriptors
    // and treat a longer chain as "too short" to fit our packet (return
    // null) — same fail-soft as the chain-too-short branch below.
    while (steps < virtio.max_chain_descriptors) : (steps += 1) {
        const d = dev.queueDescriptor(q_idx, idx) orelse return null;
        // RX descriptors must be writable.
        if ((d.flags & virtio.VringDesc.F_WRITE) == 0) return null;

        var budget: u32 = d.len;
        var desc_off: u32 = 0;
        // Inner loop: each iteration consumes ≥ 1 byte from
        // remaining_hdr or remaining_body (both bounded), so it
        // terminates in at most header_size + body.len iterations.
        while (budget > 0 and (remaining_hdr.len > 0 or remaining_body.len > 0)) {
            const source: []const u8 = if (remaining_hdr.len > 0) remaining_hdr else remaining_body;
            const chunk: u32 = @intCast(@min(@as(u64, budget), source.len));
            assert(chunk > 0);
            const dst = dev.guestBytes(d.addr + desc_off, chunk) orelse return null;
            @memcpy(dst, source[0..chunk]);
            if (remaining_hdr.len > 0) {
                remaining_hdr = remaining_hdr[chunk..];
            } else {
                remaining_body = remaining_body[chunk..];
            }
            budget -= chunk;
            desc_off += chunk;
            total += chunk;
        }

        if (remaining_hdr.len == 0 and remaining_body.len == 0) break;
        if ((d.flags & virtio.VringDesc.F_NEXT) == 0) return null; // chain too short
        idx = d.next;
    }
    assert(steps <= virtio.max_chain_descriptors);
    if (remaining_hdr.len != 0 or remaining_body.len != 0) return null;
    assert(total == @as(u32, header_size) + @as(u32, @intCast(body.len)));
    return total;
}

test "readPacket reads a single-descriptor TX chain" {
    const num = 4;
    var ram: [4096]u8 = @splat(0);
    var dev = virtio.Device{ .base = 0x0A00_0000, .id = .vsock, .ram = &ram, .ram_base = 0 };

    // Ring layout: descriptors at 0, avail after descriptors, used after avail.
    const desc_addr: u64 = 0;
    const driver_addr: u64 = num * @sizeOf(virtio.VringDesc);
    const device_addr: u64 = driver_addr + @sizeOf(virtio.VringAvail) + num * @sizeOf(u16);
    dev.queues[Q_TX] = .{
        .num = num,
        .ready = 1,
        .desc_addr = desc_addr,
        .driver_addr = driver_addr,
        .device_addr = device_addr,
    };

    // Plant a header + 5-byte payload at offset 0x300 in guest RAM.
    const pkt_off: usize = 0x300;
    const hdr = VsockHdr{
        .src_cid = default_guest_cid,
        .dst_cid = host_cid,
        .src_port = 1234,
        .dst_port = 5678,
        .len = 5,
        .type = @intFromEnum(Type.stream),
        .op = @intFromEnum(Op.rw),
        .flags = 0,
        .buf_alloc = 0x4000,
        .fwd_cnt = 0,
    };
    var hdr_bytes: [header_size]u8 = undefined;
    hdr.encode(&hdr_bytes);
    @memcpy(ram[pkt_off..][0..header_size], &hdr_bytes);
    const body = "hello";
    @memcpy(ram[pkt_off + header_size ..][0..body.len], body);

    // Descriptor 0 points at pkt_off, len=header_size+body.len.
    const desc0 = virtio.VringDesc{
        .addr = pkt_off,
        .len = @intCast(header_size + body.len),
        .flags = 0,
        .next = 0,
    };
    @memcpy(ram[0..@sizeOf(virtio.VringDesc)], std.mem.asBytes(&desc0));

    var scratch: [256]u8 = undefined;
    const pkt = readPacket(&dev, Q_TX, 0, &scratch) orelse return error.TestFailed;
    try std.testing.expectEqual(hdr.src_cid, pkt.hdr.src_cid);
    try std.testing.expectEqual(hdr.dst_port, pkt.hdr.dst_port);
    try std.testing.expectEqual(@as(u32, 5), pkt.hdr.len);
    try std.testing.expectEqualSlices(u8, body, pkt.body);
}

test "writePacket lays down hdr + body into an RX chain" {
    const num = 4;
    var ram: [4096]u8 = @splat(0);
    var dev = virtio.Device{ .base = 0x0A00_0000, .id = .vsock, .ram = &ram, .ram_base = 0 };

    const desc_addr: u64 = 0;
    const driver_addr: u64 = num * @sizeOf(virtio.VringDesc);
    const device_addr: u64 = driver_addr + @sizeOf(virtio.VringAvail) + num * @sizeOf(u16);
    dev.queues[Q_RX] = .{
        .num = num,
        .ready = 1,
        .desc_addr = desc_addr,
        .driver_addr = driver_addr,
        .device_addr = device_addr,
    };

    // Writable descriptor pointing at a 128-byte buffer at 0x800.
    const buf_off: usize = 0x800;
    const desc0 = virtio.VringDesc{
        .addr = buf_off,
        .len = 128,
        .flags = virtio.VringDesc.F_WRITE,
        .next = 0,
    };
    @memcpy(ram[0..@sizeOf(virtio.VringDesc)], std.mem.asBytes(&desc0));

    const hdr = VsockHdr{
        .src_cid = host_cid,
        .dst_cid = default_guest_cid,
        .src_port = 7777,
        .dst_port = 1234,
        .len = 3,
        .type = @intFromEnum(Type.stream),
        .op = @intFromEnum(Op.response),
        .flags = 0,
        .buf_alloc = advertised_buf_alloc,
        .fwd_cnt = 0,
    };
    const body = [_]u8{ 0xAA, 0xBB, 0xCC };
    const n = writePacket(&dev, Q_RX, 0, hdr, &body) orelse return error.TestFailed;
    try std.testing.expectEqual(@as(u32, header_size + 3), n);

    // Verify what the guest would see.
    var dst_hdr_bytes: [header_size]u8 = undefined;
    @memcpy(&dst_hdr_bytes, ram[buf_off..][0..header_size]);
    const read_back = VsockHdr.decode(&dst_hdr_bytes);
    try std.testing.expectEqual(hdr.op, read_back.op);
    try std.testing.expectEqual(hdr.dst_port, read_back.dst_port);
    try std.testing.expectEqual(@as(u32, 3), read_back.len);
    try std.testing.expectEqualSlices(u8, &body, ram[buf_off + header_size ..][0..3]);
}

// ---------------------------------------------------------------
// Bridge — host↔guest byte forwarding.
//
// This is the wires-and-glue part: a background thread opens UDS
// listeners, maps each incoming UDS connection to a guest vsock port,
// and forwards bytes. It cooperates with the vCPU thread (which calls
// handleTx when the guest kicks the TX queue) via a mutex.
// ---------------------------------------------------------------

pub const Direction = enum {
    /// Host listens on a UDS; UDS clients drive a stream into the
    /// guest (host-initiated). Example: `nc -U /tmp/x.sock` reaches
    /// a listener on the guest side.
    inbound,
    /// Guest initiates a stream to (cid=2, port). When REQUEST lands,
    /// the host opens the mapped UDS and wires it to the connection.
    /// The UDS peer is typically a local echo/service.
    outbound,
};

pub const PortMap = struct {
    guest_port: u32,
    /// For `inbound`: path to the UDS the host listens on. Unlinked
    /// and re-bound on bridge start.
    /// For `outbound`: path to the UDS the host connects to when the
    /// guest sends a REQUEST to this port.
    uds_path: [:0]const u8,
    direction: Direction = .inbound,
};

const POLLIN: i16 = 0x0001;
const POLLOUT_: i16 = 0x0004;
const POLLERR: i16 = 0x0008;
const POLLHUP: i16 = 0x0010;

const PollFd = extern struct { fd: c_int, events: i16, revents: i16 };
extern "c" fn poll(fds: [*]PollFd, nfds: c_ulong, timeout_ms: c_int) c_int;

// BSD socket bits — we bind and open UDS listeners by hand because
// std.posix's async-flavoured API churns between Zig releases.
const AF_UNIX: c_int = 1;
const SOCK_STREAM: c_int = 1;
const SOL_SOCKET: c_int = if (@import("builtin").os.tag == .macos) 0xFFFF else 1;
const SO_REUSEADDR: c_int = if (@import("builtin").os.tag == .macos) 0x0004 else 2;
const F_SETFL: c_int = 4;
const O_NONBLOCK: c_int = if (@import("builtin").os.tag == .macos) 0x0004 else 0o04000;

extern "c" fn socket(domain: c_int, sock_type: c_int, protocol: c_int) c_int;
extern "c" fn bind(fd: c_int, addr: *const anyopaque, addrlen: u32) c_int;
extern "c" fn listen(fd: c_int, backlog: c_int) c_int;
extern "c" fn accept(fd: c_int, addr: ?*anyopaque, addrlen: ?*u32) c_int;
extern "c" fn connect(fd: c_int, addr: *const anyopaque, addrlen: u32) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn unlink(path: [*:0]const u8) c_int;
extern "c" fn pipe(fds: *[2]c_int) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn fcntl(fd: c_int, cmd: c_int, ...) c_int;
extern "c" fn setsockopt(fd: c_int, level: c_int, name: c_int, val: *const anyopaque, len: u32) c_int;

// On macOS sockaddr_un has a 1-byte sun_len; on Linux it doesn't.
// Construct the buffer as a blob and pass addrlen separately.
const SockaddrUn = extern struct {
    // Layout sufficient for both platforms: we zero it and fill in the
    // path, then compute addrlen = offsetof(path) + strlen(path) + 1.
    bytes: [110]u8 align(4) = @splat(0),
};

fn makeSockaddrUn(path: []const u8) struct { sa: SockaddrUn, len: u32 } {
    assert(path.len > 0);
    // Leave room for sun_len/sun_family + NUL.
    assert(path.len < 100);
    var sa = SockaddrUn{};
    if (@import("builtin").os.tag == .macos) {
        // sun_len (1 byte), sun_family (1 byte), sun_path (104 bytes on macOS)
        // Path starts at byte 2.
        sa.bytes[1] = AF_UNIX;
        const path_off: usize = 2;
        const take = @min(path.len, sa.bytes.len - path_off - 1);
        @memcpy(sa.bytes[path_off..][0..take], path[0..take]);
        sa.bytes[0] = @intCast(path_off + take + 1);
        return .{ .sa = sa, .len = @as(u32, @intCast(path_off + take + 1)) };
    } else {
        // sun_family u16, sun_path 108 bytes (path starts at byte 2).
        sa.bytes[0] = AF_UNIX;
        sa.bytes[1] = 0;
        const path_off: usize = 2;
        const take = @min(path.len, sa.bytes.len - path_off - 1);
        @memcpy(sa.bytes[path_off..][0..take], path[0..take]);
        return .{ .sa = sa, .len = @as(u32, @intCast(path_off + take + 1)) };
    }
}

fn setNonblocking(fd: c_int) void {
    assert(fd >= 0);
    _ = fcntl(fd, F_SETFL, O_NONBLOCK);
}

/// Connect (blocking) to a UDS at `path`. Returns the fd on success,
/// -1 on any failure. Caller sets nonblocking and tracks the fd.
fn connectUds(path: [:0]const u8) c_int {
    assert(path.len > 0);
    assert(path.len < 100);
    const fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    const made = makeSockaddrUn(path);
    if (connect(fd, &made.sa, made.len) != 0) {
        _ = close(fd);
        return -1;
    }
    return fd;
}

pub const ConnState = enum {
    /// We sent REQUEST; waiting for guest RESPONSE.
    connecting,
    /// Guest replied RESPONSE; both sides can exchange RW packets.
    established,
    /// Either side initiated close; drain and free.
    closing,
};

pub const Connection = struct {
    guest_port: u32,
    host_port: u32,
    uds_fd: c_int,
    state: ConnState,
    /// Bytes we've consumed off this connection's UDS fd (and forwarded
    /// to the guest). Reported as `fwd_cnt` in every packet we emit so
    /// the guest's credit accounting stays honest.
    fwd_cnt: u32 = 0,
    /// Total bytes of payload the guest has sent us across all RW
    /// packets for this connection. Bumped on every inbound RW.
    bytes_from_peer: u32 = 0,
    /// Total bytes of payload we've sent the guest across all RW
    /// packets. Bumped on every successful injectRx(RW, body).
    bytes_to_peer: u32 = 0,
    /// Peer's advertised receive window, picked up from every inbound
    /// header's buf_alloc. Caps how many of our bytes_to_peer can be
    /// unacknowledged at once.
    peer_buf_alloc: u32 = 0,
    /// Peer's last-reported fwd_cnt (how many of OUR bytes it has
    /// consumed). Together with bytes_to_peer this gives us the
    /// in-flight count: bytes_to_peer - peer_fwd_cnt.
    peer_fwd_cnt: u32 = 0,
    /// True once we've pulled this fd out of the poll set because
    /// the peer window was full. When a CREDIT_UPDATE or RW from the
    /// guest bumps peer_fwd_cnt, we re-enable POLLIN on it.
    paused: bool = false,
    /// The fwd_cnt we last advertised to the peer. Used to decide
    /// when the gap with `fwd_cnt` is big enough to emit a new
    /// CREDIT_UPDATE.
    last_credit_fwd_cnt: u32 = 0,
};

pub const BridgeConfig = struct {
    guest_cid: u64 = default_guest_cid,
    ports: []const PortMap,
    /// Set by boot_hvf.zig to hvf.Gic.setSpi(irq, true). Called after we
    /// inject an RX packet so the guest sees the virtio interrupt.
    raise_irq: ?*const fn (ctx: ?*anyopaque) void = null,
    raise_irq_ctx: ?*anyopaque = null,
};

pub const Bridge = struct {
    gpa: std.mem.Allocator,
    cfg: BridgeConfig,
    dev: *virtio.Device,

    mu: PthreadMutex = .{},
    stop_flag: std.atomic.Value(bool) = .init(false),

    /// Next host-side port to allocate for an outgoing stream.
    next_host_port: u32 = 1024,

    /// One listener fd per INBOUND entry in cfg.ports. Index-aligned
    /// with `listener_port_idx` so we can reach back to cfg.ports.
    listeners: std.ArrayList(c_int) = .empty,
    listener_port_idx: std.ArrayList(usize) = .empty,

    /// Active connections.
    conns: std.ArrayList(Connection) = .empty,

    /// Self-pipe so sendPacket wakes the poll loop. Index 0 = read, 1 = write.
    wake: [2]c_int = .{ -1, -1 },

    thread: ?std.Thread = null,

    pub fn create(gpa: std.mem.Allocator, dev: *virtio.Device, cfg: BridgeConfig) !*Bridge {
        assert(dev.size > 0);
        assert(cfg.guest_cid != host_cid);
        const self = try gpa.create(Bridge);
        self.* = .{
            .gpa = gpa,
            .cfg = cfg,
            .dev = dev,
        };
        return self;
    }

    pub fn destroy(self: *Bridge) void {
        self.stop() catch {};
        for (self.listeners.items) |fd| _ = close(fd);
        self.listeners.deinit(self.gpa);
        self.listener_port_idx.deinit(self.gpa);
        for (self.conns.items) |c| _ = close(c.uds_fd);
        self.conns.deinit(self.gpa);
        if (self.wake[0] >= 0) _ = close(self.wake[0]);
        if (self.wake[1] >= 0) _ = close(self.wake[1]);
        self.gpa.destroy(self);
    }

    pub fn start(self: *Bridge) !void {
        // No double-start: listeners + thread must be untouched.
        assert(self.thread == null);
        assert(self.listeners.items.len == 0);
        // Open a UDS listener for every INBOUND entry up front so a
        // failure here is visible before the guest boots. Outbound
        // entries don't open anything yet — we dial on-demand when
        // the guest sends REQUEST.
        for (self.cfg.ports, 0..) |pm, i| {
            if (pm.direction != .inbound) continue;
            _ = unlink(pm.uds_path.ptr);
            const fd = socket(AF_UNIX, SOCK_STREAM, 0);
            if (fd < 0) return error.UdsSocketFailed;
            errdefer _ = close(fd);
            const yes: c_int = 1;
            _ = setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, @sizeOf(c_int));
            const made = makeSockaddrUn(pm.uds_path);
            if (bind(fd, &made.sa, made.len) != 0) return error.UdsBindFailed;
            if (listen(fd, 8) != 0) return error.UdsListenFailed;
            setNonblocking(fd);
            try self.listeners.append(self.gpa, fd);
            try self.listener_port_idx.append(self.gpa, i);
        }

        var pipe_fds: [2]c_int = .{ -1, -1 };
        if (pipe(&pipe_fds) != 0) return error.PipeFailed;
        setNonblocking(pipe_fds[0]);
        setNonblocking(pipe_fds[1]);
        self.wake = pipe_fds;

        self.thread = try std.Thread.spawn(.{}, runThread, .{self});
    }

    pub fn stop(self: *Bridge) !void {
        self.stop_flag.store(true, .release);
        self.nudge();
        if (self.thread) |t| {
            t.join();
            self.thread = null;
        }
    }

    fn nudge(self: *Bridge) void {
        if (self.wake[1] >= 0) {
            const b: [1]u8 = .{1};
            _ = write(self.wake[1], &b, 1);
        }
    }

    fn runThread(self: *Bridge) void {
        // Self-pipe must be wired up by start() before this thread spawns.
        assert(self.wake[0] >= 0);
        assert(self.wake[1] >= 0);
        // #240: pre-sized large enough that the realloc branch below
        // is dead code under any realistic operator config. Kept as a
        // safety valve for pathological port-map / connection counts.
        var scratch = self.gpa.alloc(PollFd, bridge_initial_poll_cap) catch return;
        defer self.gpa.free(scratch);

        while (!self.stop_flag.load(.acquire)) {
            // Build poll set: [wake, listeners..., conns...]
            self.mu.lock();
            const want = 1 + self.listeners.items.len + self.conns.items.len;
            if (want > scratch.len) {
                scratch = self.gpa.realloc(scratch, want) catch {
                    self.mu.unlock();
                    return;
                };
            }
            var n: usize = 0;
            scratch[n] = .{ .fd = self.wake[0], .events = POLLIN, .revents = 0 };
            n += 1;
            for (self.listeners.items) |fd| {
                scratch[n] = .{ .fd = fd, .events = POLLIN, .revents = 0 };
                n += 1;
            }
            for (self.conns.items) |c| {
                // Paused connections are waiting on credit from the
                // peer — no POLLIN; we still want POLLHUP/ERR so we
                // notice a UDS peer close while paused.
                const events: i16 = if (c.paused) 0 else POLLIN;
                scratch[n] = .{ .fd = c.uds_fd, .events = events, .revents = 0 };
                n += 1;
            }
            self.mu.unlock();

            _ = poll(scratch.ptr, @intCast(n), 250);

            // Drain the wake pipe. Capped per #238 so a peer that keeps
            // writing nudges can't pin this thread out of the poll set.
            if ((scratch[0].revents & POLLIN) != 0) {
                var drain: [64]u8 = undefined;
                var drain_iters: u32 = 0;
                while (drain_iters < wake_drain_iters_max) : (drain_iters += 1) {
                    if (read(self.wake[0], &drain, drain.len) <= 0) break;
                }
                assert(drain_iters <= wake_drain_iters_max);
            }

            // Accept listeners.
            const listener_end = 1 + self.listeners.items.len;
            var i: usize = 1;
            while (i < listener_end) : (i += 1) {
                if ((scratch[i].revents & POLLIN) == 0) continue;
                self.mu.lock();
                const listener_idx = i - 1;
                if (listener_idx < self.listeners.items.len) {
                    const lfd = self.listeners.items[listener_idx];
                    const port_idx = self.listener_port_idx.items[listener_idx];
                    const port = self.cfg.ports[port_idx].guest_port;
                    const c = accept(lfd, null, null);
                    if (c >= 0) {
                        setNonblocking(c);
                        self.startConnection(c, port) catch |err| {
                            std.debug.print("vsock: startConnection failed: {s}\n", .{@errorName(err)});
                            _ = close(c);
                        };
                    }
                }
                self.mu.unlock();
            }

            // Read from established conns.
            i = listener_end;
            while (i < n) : (i += 1) {
                const events = scratch[i].revents;
                if (events == 0) continue;
                self.mu.lock();
                // conns may have shifted under us — re-look up by fd.
                const fd = scratch[i].fd;
                var match: ?usize = null;
                for (self.conns.items, 0..) |c, k| if (c.uds_fd == fd) {
                    match = k;
                    break;
                };
                if (match) |k| {
                    if ((events & POLLIN) != 0) {
                        self.drainConnection(k) catch |err| {
                            std.debug.print("vsock: drainConnection err {s}\n", .{@errorName(err)});
                            self.closeConnection(k);
                        };
                    } else if ((events & (POLLERR | POLLHUP)) != 0) {
                        self.closeConnection(k);
                    }
                }
                self.mu.unlock();
            }
        }
    }

    fn findOutbound(self: *Bridge, host_port: u32) ?[:0]const u8 {
        for (self.cfg.ports) |pm| {
            if (pm.direction == .outbound and pm.guest_port == host_port) {
                return pm.uds_path;
            }
        }
        return null;
    }

    fn sendRst(self: *Bridge, in: VsockHdr) void {
        const rst = VsockHdr{
            .src_cid = host_cid,
            .dst_cid = self.cfg.guest_cid,
            .src_port = in.dst_port,
            .dst_port = in.src_port,
            .len = 0,
            .type = in.type,
            .op = @intFromEnum(Op.rst),
            .flags = 0,
            .buf_alloc = advertised_buf_alloc,
            .fwd_cnt = 0,
        };
        _ = self.injectRx(rst, &[_]u8{});
    }

    // Must be called with self.mu held.
    fn startConnection(self: *Bridge, uds_fd: c_int, guest_port: u32) !void {
        assert(uds_fd >= 0);
        assert(guest_port != 0);
        const host_port = self.next_host_port;
        self.next_host_port += 1;
        assert(host_port != 0);
        try self.conns.append(self.gpa, .{
            .guest_port = guest_port,
            .host_port = host_port,
            .uds_fd = uds_fd,
            .state = .connecting,
        });
        // Inject REQUEST into guest RX.
        const hdr = VsockHdr{
            .src_cid = host_cid,
            .dst_cid = self.cfg.guest_cid,
            .src_port = host_port,
            .dst_port = guest_port,
            .len = 0,
            .type = @intFromEnum(Type.stream),
            .op = @intFromEnum(Op.request),
            .flags = 0,
            .buf_alloc = advertised_buf_alloc,
            .fwd_cnt = 0,
        };
        const ok = self.injectRx(hdr, &[_]u8{});
        if (!ok) {
            std.debug.print("vsock: REQUEST inject failed (guest not ready?) — closing\n", .{});
            self.closeConnection(self.conns.items.len - 1);
        }
    }

    /// How many more bytes the peer will accept right now. A fresh
    /// stream starts with no window info; treat zero as "send one
    /// and see" so we don't deadlock before the first packet.
    fn peerRoom(c: *const Connection) u32 {
        if (c.peer_buf_alloc == 0) return 64 * 1024;
        const inflight = c.bytes_to_peer -% c.peer_fwd_cnt;
        if (inflight >= c.peer_buf_alloc) return 0;
        return c.peer_buf_alloc - inflight;
    }

    // Must be called with self.mu held.
    fn drainConnection(self: *Bridge, idx: usize) !void {
        assert(idx < self.conns.items.len);
        const c = &self.conns.items[idx];
        assert(c.uds_fd >= 0);
        if (c.state != .established) return; // wait for RESPONSE first
        const room = peerRoom(c);
        if (room == 0) {
            c.paused = true;
            return;
        }
        // Cap to rx_body_per_packet_max so we never exceed the 4096-
        // byte body descriptor the Linux vsock driver posts. Multi-
        // packet streams fall out naturally: the poll loop re-fires
        // while data is still in the UDS buffer + the peer window is
        // still open.
        var buf: [rx_body_per_packet_max]u8 = undefined;
        const cap: usize = @min(buf.len, room);
        const n = read(c.uds_fd, &buf, cap);
        if (n == 0) {
            // EOF from the UDS side — tell the guest and start close.
            const hdr = VsockHdr{
                .src_cid = host_cid,
                .dst_cid = self.cfg.guest_cid,
                .src_port = c.host_port,
                .dst_port = c.guest_port,
                .len = 0,
                .type = @intFromEnum(Type.stream),
                .op = @intFromEnum(Op.shutdown),
                .flags = ShutdownFlag.both,
                .buf_alloc = advertised_buf_alloc,
                .fwd_cnt = c.fwd_cnt,
            };
            _ = self.injectRx(hdr, &[_]u8{});
            c.state = .closing;
            return;
        }
        if (n < 0) return; // EAGAIN / try later
        const payload = buf[0..@intCast(n)];
        const hdr = VsockHdr{
            .src_cid = host_cid,
            .dst_cid = self.cfg.guest_cid,
            .src_port = c.host_port,
            .dst_port = c.guest_port,
            .len = @intCast(payload.len),
            .type = @intFromEnum(Type.stream),
            .op = @intFromEnum(Op.rw),
            .flags = 0,
            .buf_alloc = advertised_buf_alloc,
            .fwd_cnt = c.fwd_cnt,
        };
        if (self.injectRx(hdr, payload)) {
            c.bytes_to_peer +%= @intCast(payload.len);
        }
    }

    // Must be called with self.mu held.
    fn closeConnection(self: *Bridge, idx: usize) void {
        assert(idx < self.conns.items.len);
        const c = self.conns.swapRemove(idx);
        assert(c.uds_fd >= 0);
        _ = close(c.uds_fd);
    }

    // Must be called with self.mu held.
    //
    // Claim the next posted RX descriptor chain, lay down hdr+body,
    // push used, and raise the virtio IRQ.
    fn injectRx(self: *Bridge, hdr: VsockHdr, body: []const u8) bool {
        assert(self.dev.size > 0);
        // Body is constructed on the host side; oversized means a
        // bridge-internal bug, not a guest one.
        assert(body.len <= rx_body_per_packet_max);
        const q = &self.dev.queues[Q_RX];
        if (q.ready == 0 or q.num == 0) return false;

        // Use Device.readAvailHeader (now pub) so we get its acquire-
        // load on avail.idx — required to pair with the driver's
        // smp_wmb() between writing ring[idx] and bumping avail.idx.
        // Inlining @memcpy here used to skip the barrier and let
        // weakly-ordered cores hoist the ring[idx] read above the
        // avail.idx load. See #192.
        const avail = self.dev.readAvailHeader(q) orelse return false;
        if (q.last_avail_idx == avail.idx) return false; // no buffer posted

        // avail.ring[slot]
        const slot: u32 = @as(u32, q.last_avail_idx) % q.num;
        const ring_off: u64 = q.driver_addr + @sizeOf(virtio.VringAvail) + @as(u64, slot) * @sizeOf(u16);
        const ring_bytes = self.dev.guestBytes(ring_off, @sizeOf(u16)) orelse return false;
        const head: u16 = std.mem.readInt(u16, ring_bytes[0..2], .little);

        const written = writePacket(self.dev, Q_RX, head, hdr, body) orelse return false;
        self.dev.queuePushUsed(Q_RX, head, written);
        q.last_avail_idx +%= 1;
        _ = @atomicRmw(u32, &self.dev.interrupt_status, .Or, virtio.IRQ_USED_BUFFER, .release);

        if (self.cfg.raise_irq) |f| f(self.cfg.raise_irq_ctx);
        return true;
    }

    /// Called from the vCPU thread when the guest kicks the TX queue.
    /// Signature matches virtio.Device.request_handler.
    ///
    /// PRECONDITION: caller holds `self.mu`. The vCPU's vsock-MMIO
    /// handler must lock the bridge mutex around the whole MMIO so the
    /// (RMW interrupt_status + setIrq) pair can't interleave with the
    /// bridge poll thread's own pair — see the `Why locking the bridge
    /// mutex around vsock MMIO` doc on `Bridge`. We rely on that
    /// outer lock instead of taking it again here (PthreadMutex isn't
    /// reentrant).
    pub fn handleTxChain(ctx: ?*anyopaque, dev: *virtio.Device, q_idx: u32, head: u16) void {
        assert(ctx != null);
        assert(q_idx < virtio.max_queues);
        const self: *Bridge = @ptrCast(@alignCast(ctx.?));
        assert(self.dev == dev);
        if (q_idx != Q_TX) {
            // Event queue or unexpected: ack and move on.
            dev.queuePushUsed(q_idx, head, 0);
            return;
        }

        var scratch: [max_payload + header_size]u8 = undefined;
        const pkt = readPacket(dev, q_idx, head, &scratch) orelse {
            dev.queuePushUsed(q_idx, head, 0);
            return;
        };
        const total_len: u32 = @as(u32, @intCast(header_size)) + @as(u32, @intCast(pkt.body.len));
        dev.queuePushUsed(q_idx, head, total_len);

        self.dispatchGuestPacket(pkt.hdr, pkt.body);
    }

    // Must be called with self.mu held.
    fn dispatchGuestPacket(self: *Bridge, hdr: VsockHdr, body: []const u8) void {
        // body is the slice readPacket carved out of its scratch; the
        // caller bounded it to scratch.len = max_payload + header_size.
        assert(body.len <= max_payload);
        // Match by (src_port = guest_port, dst_port = host_port).
        var match: ?usize = null;
        for (self.conns.items, 0..) |c, k| {
            if (c.guest_port == hdr.src_port and c.host_port == hdr.dst_port) {
                match = k;
                break;
            }
        }
        const op: Op = @enumFromInt(hdr.op);

        if (match == null) {
            // No existing connection. If it's a REQUEST targeting an
            // outbound-mapped host port, dial the UDS and accept.
            if (op == .request) {
                if (self.findOutbound(hdr.dst_port)) |uds_path| {
                    const fd = connectUds(uds_path);
                    if (fd >= 0) {
                        setNonblocking(fd);
                        self.conns.append(self.gpa, .{
                            .guest_port = hdr.src_port,
                            .host_port = hdr.dst_port,
                            .uds_fd = fd,
                            .state = .established,
                            .peer_buf_alloc = hdr.buf_alloc,
                            .peer_fwd_cnt = hdr.fwd_cnt,
                        }) catch {
                            _ = close(fd);
                            self.sendRst(hdr);
                            return;
                        };
                        const resp = VsockHdr{
                            .src_cid = host_cid,
                            .dst_cid = self.cfg.guest_cid,
                            .src_port = hdr.dst_port,
                            .dst_port = hdr.src_port,
                            .len = 0,
                            .type = hdr.type,
                            .op = @intFromEnum(Op.response),
                            .flags = 0,
                            .buf_alloc = advertised_buf_alloc,
                            .fwd_cnt = 0,
                        };
                        _ = self.injectRx(resp, &[_]u8{});
                        return;
                    }
                }
            }
            // Unknown / unmapped stream → reject with RST.
            self.sendRst(hdr);
            return;
        }
        const idx = match.?;
        const c = &self.conns.items[idx];

        // Every inbound packet carries peer window + fwd_cnt — pick them
        // up before dispatch so peerRoom() reflects the latest view.
        const had_room = peerRoom(c) > 0;
        c.peer_buf_alloc = hdr.buf_alloc;
        c.peer_fwd_cnt = hdr.fwd_cnt;
        const has_room = peerRoom(c) > 0;
        // If credit opened up, unpause so the next poll wakes the fd.
        if (c.paused and !had_room and has_room) {
            c.paused = false;
            self.nudge();
        }

        switch (op) {
            .response => {
                c.state = .established;
            },
            .rw => {
                // Write body to UDS, looping over partial writes AND
                // brief EAGAIN stalls. The UDS fd is nonblocking (so
                // the bridge thread's poll loop works); without the
                // retry, a non-reading host peer made `write()` return
                // EAGAIN and we'd drop everything past the first
                // couple of KB. Bug bit hard on pull (#58): guest tar
                // bytes 3K+ silently vanished and host tar reported
                // "Truncated tar archive".
                var remaining = body;
                var stalls: u32 = 0;
                // remaining strictly shrinks on n > 0; stalls is the
                // EAGAIN-only counter, capped to keep a wedged peer
                // from pinning the bridge thread (#238).
                while (remaining.len > 0 and stalls <= tx_eagain_stalls_max) {
                    const n = write(c.uds_fd, remaining.ptr, remaining.len);
                    if (n > 0) {
                        remaining = remaining[@intCast(n)..];
                        continue;
                    }
                    if (n == 0) break; // peer closed
                    // n < 0: EAGAIN. Wait briefly for writability.
                    var pfds = [_]PollFd{.{ .fd = c.uds_fd, .events = POLLOUT_, .revents = 0 }};
                    _ = poll(&pfds, 1, 100);
                    stalls += 1;
                }
                assert(stalls <= tx_eagain_stalls_max + 1);
                c.bytes_from_peer +%= @intCast(body.len);
                c.fwd_cnt = c.bytes_from_peer;
                // Emit a credit update when we've consumed enough new
                // bytes to be worth telling the peer about. "Enough" is
                // half of our advertised window — chosen so the guest
                // gets at least a handful of updates across a full
                // window but we don't stuff the RX queue on small
                // trickles.
                const threshold: u32 = advertised_buf_alloc / 2;
                if ((c.fwd_cnt -% c.last_credit_fwd_cnt) >= threshold) {
                    self.sendCreditUpdate(c);
                }
            },
            .shutdown, .rst => {
                self.closeConnection(idx);
            },
            .credit_request => {
                self.sendCreditUpdate(c);
            },
            .credit_update => {
                // peer_fwd_cnt already absorbed above.
            },
            else => {},
        }
    }

    fn sendCreditUpdate(self: *Bridge, c: *Connection) void {
        assert(c.uds_fd >= 0);
        assert(c.host_port != 0);
        const credit = VsockHdr{
            .src_cid = host_cid,
            .dst_cid = self.cfg.guest_cid,
            .src_port = c.host_port,
            .dst_port = c.guest_port,
            .len = 0,
            .type = @intFromEnum(Type.stream),
            .op = @intFromEnum(Op.credit_update),
            .flags = 0,
            .buf_alloc = advertised_buf_alloc,
            .fwd_cnt = c.fwd_cnt,
        };
        if (self.injectRx(credit, &[_]u8{})) {
            c.last_credit_fwd_cnt = c.fwd_cnt;
        }
    }
};

test "parseEnv: legacy single-entry defaults to inbound" {
    const gpa = std.testing.allocator;
    const parsed = try parseEnv(gpa, "1234:/tmp/a.sock");
    defer freeParsed(gpa, parsed);
    try std.testing.expectEqual(@as(usize, 1), parsed.len);
    try std.testing.expectEqual(@as(u32, 1234), parsed[0].guest_port);
    try std.testing.expectEqual(Direction.inbound, parsed[0].direction);
    try std.testing.expectEqualStrings("/tmp/a.sock", parsed[0].uds_path);
}

test "parseEnv: in: and out: prefixes" {
    const gpa = std.testing.allocator;
    const parsed = try parseEnv(gpa, "in:10:/tmp/i.sock,out:20:/tmp/o.sock");
    defer freeParsed(gpa, parsed);
    try std.testing.expectEqual(@as(usize, 2), parsed.len);
    try std.testing.expectEqual(Direction.inbound, parsed[0].direction);
    try std.testing.expectEqual(@as(u32, 10), parsed[0].guest_port);
    try std.testing.expectEqual(Direction.outbound, parsed[1].direction);
    try std.testing.expectEqual(@as(u32, 20), parsed[1].guest_port);
}

test "parseEnv: rejects malformed input" {
    const gpa = std.testing.allocator;
    try std.testing.expectError(error.MissingColon, parseEnv(gpa, "nope"));
    try std.testing.expectError(error.BadPort, parseEnv(gpa, "abc:/tmp/x.sock"));
    try std.testing.expectError(error.EmptyPath, parseEnv(gpa, "10:"));
}

test "parseEnv: skips empty segments (trailing comma)" {
    const gpa = std.testing.allocator;
    const parsed = try parseEnv(gpa, "1:/a.sock,,2:/b.sock,");
    defer freeParsed(gpa, parsed);
    try std.testing.expectEqual(@as(usize, 2), parsed.len);
}

test "writePacket fails cleanly when the chain is too short" {
    const num = 4;
    var ram: [4096]u8 = @splat(0);
    var dev = virtio.Device{ .base = 0x0A00_0000, .id = .vsock, .ram = &ram, .ram_base = 0 };

    const driver_addr: u64 = num * @sizeOf(virtio.VringDesc);
    const device_addr: u64 = driver_addr + @sizeOf(virtio.VringAvail) + num * @sizeOf(u16);
    dev.queues[Q_RX] = .{
        .num = num,
        .ready = 1,
        .desc_addr = 0,
        .driver_addr = driver_addr,
        .device_addr = device_addr,
    };

    // Writable descriptor, but only 10 bytes — not even enough for the header.
    const desc0 = virtio.VringDesc{ .addr = 0x400, .len = 10, .flags = virtio.VringDesc.F_WRITE, .next = 0 };
    @memcpy(ram[0..@sizeOf(virtio.VringDesc)], std.mem.asBytes(&desc0));

    const hdr = VsockHdr{
        .src_cid = host_cid,
        .dst_cid = default_guest_cid,
        .src_port = 1,
        .dst_port = 2,
        .len = 0,
        .type = @intFromEnum(Type.stream),
        .op = @intFromEnum(Op.rst),
        .flags = 0,
        .buf_alloc = advertised_buf_alloc,
        .fwd_cnt = 0,
    };
    try std.testing.expectEqual(@as(?u32, null), writePacket(&dev, Q_RX, 0, hdr, &[_]u8{}));
}
