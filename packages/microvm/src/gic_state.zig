//! GICv3 distributor + redistributor register dump/load against the
//! live backend (HVF / KVM) — the boot-loop half of tasks #22/#23.
//!
//! `gic_dump.zig` is the section *container* codec; this module is
//! the register *accessor* + a flat payload codec. The portable wire
//! format is a list of {offset, width, value} entries keyed by
//! GICv3-spec register offsets. Both backends agree on those offsets:
//!
//!   * KVM — KVM_DEV_ARM_VGIC_GRP_DIST_REGS / _REDIST_REGS device
//!           attrs. 32-bit accesses; attr = (mpidr << 32) | offset.
//!   * HVF — hv_gic_{get,set}_{distributor,redistributor}_reg, same
//!           spec offsets, value carried in a u64.
//!
//! v1 scope: 32-bit registers only (CTLR, IGROUPR, ISENABLER,
//! ISPENDR, ISACTIVER, IPRIORITYR, ICFGR). GICD_IROUTERn (64-bit SPI
//! affinity routing) is intentionally skipped — our guests are
//! single-vCPU, so every SPI routes to affinity 0 on a fresh GIC
//! anyway, and skipping it keeps every access a clean u32.
//!
//! Restore correctness rests on a GICv3 invariant: ISENABLER /
//! ISPENDR / ISACTIVER are *set*-type registers (write-1-to-set,
//! write-0 is a no-op). A fresh backend GIC starts with all of them
//! zero, so replaying the dumped value reproduces the exact bitmask.
//! The plain RW registers (CTLR, IGROUPR, IPRIORITYR, ICFGR) are
//! written directly.

const std = @import("std");
const builtin = @import("builtin");
const snapshot = @import("snapshot.zig");

const assert = std.debug.assert;

/// One register in the portable dump. `width` is 4 or 8; v1 only
/// emits 4. `value` carries the contents in its low `width` bytes.
pub const Entry = extern struct {
    offset: u32,
    width: u32,
    value: u64,
};

pub const ENTRY_SIZE: usize = 16;

comptime {
    assert(@sizeOf(Entry) == ENTRY_SIZE);
}

pub const Error = error{
    WrongHost,
    Truncated,
    KvmGetDeviceAttrFailed,
    KvmSetDeviceAttrFailed,
} || std.mem.Allocator.Error;

// -- register offset tables (GICv3 spec, base-relative) -----------

const RegSpec = struct { offset: u32, width: u32 };

/// Distributor registers worth carrying. SPI-banked registers cover
/// INTID 32..255 (word index 1..7); that comfortably spans our DTS
/// SPI range (PL011 = INTID 33, virtio = 48..54) with margin.
const dist_regs = blk: {
    @setEvalBranchQuota(10000);
    const count = 1 + 4 * 7 + 56 + 14;
    var out: [count]RegSpec = undefined;
    var i: usize = 0;
    out[i] = .{ .offset = 0x0000, .width = 4 }; // GICD_CTLR
    i += 1;
    // GICD_{IGROUPR,ISENABLER,ISPENDR,ISACTIVER}: 1 bit/INTID → word
    // index 1..7 for INTID 32..255.
    for ([_]u32{ 0x0080, 0x0100, 0x0200, 0x0300 }) |base| {
        var n: u32 = 1;
        while (n <= 7) : (n += 1) {
            out[i] = .{ .offset = base + n * 4, .width = 4 };
            i += 1;
        }
    }
    // GICD_IPRIORITYR: 1 byte/INTID → word 8..63 for INTID 32..255.
    {
        var n: u32 = 8;
        while (n <= 63) : (n += 1) {
            out[i] = .{ .offset = 0x0400 + n * 4, .width = 4 };
            i += 1;
        }
    }
    // GICD_ICFGR: 2 bits/INTID → word 2..15 for INTID 32..255.
    {
        var n: u32 = 2;
        while (n <= 15) : (n += 1) {
            out[i] = .{ .offset = 0x0C00 + n * 4, .width = 4 };
            i += 1;
        }
    }
    assert(i == count);
    break :blk out;
};

/// Redistributor SGI-frame registers (frame base 0x10000), covering
/// SGIs + PPIs (INTID 0..31). The arch virtual-timer PPI (INTID 27)
/// lives here — that's the interrupt the resumed guest's scheduler
/// tick depends on.
const redist_regs = blk: {
    @setEvalBranchQuota(10000);
    const sgi = 0x10000;
    const count = 4 + 8 + 2;
    var out: [count]RegSpec = undefined;
    var i: usize = 0;
    out[i] = .{ .offset = sgi + 0x0080, .width = 4 }; // GICR_IGROUPR0
    i += 1;
    out[i] = .{ .offset = sgi + 0x0100, .width = 4 }; // GICR_ISENABLER0
    i += 1;
    out[i] = .{ .offset = sgi + 0x0200, .width = 4 }; // GICR_ISPENDR0
    i += 1;
    out[i] = .{ .offset = sgi + 0x0300, .width = 4 }; // GICR_ISACTIVER0
    i += 1;
    {
        var n: u32 = 0;
        while (n <= 7) : (n += 1) {
            out[i] = .{ .offset = sgi + 0x0400 + n * 4, .width = 4 }; // GICR_IPRIORITYR0..7
            i += 1;
        }
    }
    out[i] = .{ .offset = sgi + 0x0C00, .width = 4 }; // GICR_ICFGR0
    i += 1;
    out[i] = .{ .offset = sgi + 0x0C04, .width = 4 }; // GICR_ICFGR1
    i += 1;
    assert(i == count);
    break :blk out;
};

/// Upper bound on a dump payload: every register table entry plus the
/// 4-byte count prefix. Lets call sites stack-bound their buffers.
pub const max_payload_bytes: usize = 4 + (dist_regs.len + redist_regs.len) * ENTRY_SIZE;

// -- portable payload codec ---------------------------------------

/// Encode an entry list into a section payload. Caller owns the bytes.
pub fn encode_payload(allocator: std.mem.Allocator, entries: []const Entry) ![]u8 {
    assert(entries.len <= std.math.maxInt(u32));

    const total = 4 + entries.len * ENTRY_SIZE;
    const buf = try allocator.alloc(u8, total);
    errdefer allocator.free(buf);

    std.mem.writeInt(u32, buf[0..4], @intCast(entries.len), .little);
    var off: usize = 4;
    for (entries) |e| {
        assert(e.width == 4 or e.width == 8);
        std.mem.writeInt(u32, buf[off..][0..4], e.offset, .little);
        std.mem.writeInt(u32, buf[off + 4 ..][0..4], e.width, .little);
        std.mem.writeInt(u64, buf[off + 8 ..][0..8], e.value, .little);
        off += ENTRY_SIZE;
    }
    assert(off == total);
    return buf;
}

/// Decode a section payload back into an entry list. Caller owns the
/// returned slice.
pub fn decode_payload(allocator: std.mem.Allocator, payload: []const u8) ![]Entry {
    if (payload.len < 4) return error.Truncated;
    const n = std.mem.readInt(u32, payload[0..4], .little);
    if (4 + @as(usize, n) * ENTRY_SIZE != payload.len) return error.Truncated;

    const out = try allocator.alloc(Entry, n);
    errdefer allocator.free(out);

    var off: usize = 4;
    for (out) |*e| {
        e.* = .{
            .offset = std.mem.readInt(u32, payload[off..][0..4], .little),
            .width = std.mem.readInt(u32, payload[off + 4 ..][0..4], .little),
            .value = std.mem.readInt(u64, payload[off + 8 ..][0..8], .little),
        };
        off += ENTRY_SIZE;
    }
    assert(off == payload.len);
    return out;
}

// -- HVF accessors (macOS) ----------------------------------------

const hvf_gic = struct {
    extern "c" fn hv_gic_get_distributor_reg(reg: u32, value: *u64) i32;
    extern "c" fn hv_gic_set_distributor_reg(reg: u32, value: u64) i32;
    extern "c" fn hv_gic_get_redistributor_reg(vcpu: u64, reg: u32, value: *u64) i32;
    extern "c" fn hv_gic_set_redistributor_reg(vcpu: u64, reg: u32, value: u64) i32;
};

/// Dump the HVF distributor register window into a portable payload.
pub fn dump_hvf_dist(allocator: std.mem.Allocator) ![]u8 {
    if (builtin.os.tag != .macos) return error.WrongHost;

    var list = std.ArrayList(Entry).empty;
    defer list.deinit(allocator);

    for (dist_regs) |r| {
        var v: u64 = 0;
        if (hvf_gic.hv_gic_get_distributor_reg(r.offset, &v) != 0) continue;
        try list.append(allocator, .{ .offset = r.offset, .width = r.width, .value = v });
    }
    return encode_payload(allocator, list.items);
}

/// Replay a distributor payload onto the HVF GIC. Best-effort: a reg
/// HVF rejects is skipped rather than aborting the whole restore.
pub fn load_hvf_dist(allocator: std.mem.Allocator, payload: []const u8) !void {
    if (builtin.os.tag != .macos) return error.WrongHost;

    const entries = try decode_payload(allocator, payload);
    defer allocator.free(entries);
    for (entries) |e| {
        _ = hvf_gic.hv_gic_set_distributor_reg(e.offset, e.value);
    }
}

/// Dump the HVF redistributor SGI-frame registers for one vCPU.
pub fn dump_hvf_redist(allocator: std.mem.Allocator, vcpu_handle: u64) ![]u8 {
    if (builtin.os.tag != .macos) return error.WrongHost;

    var list = std.ArrayList(Entry).empty;
    defer list.deinit(allocator);

    for (redist_regs) |r| {
        var v: u64 = 0;
        if (hvf_gic.hv_gic_get_redistributor_reg(vcpu_handle, r.offset, &v) != 0) continue;
        try list.append(allocator, .{ .offset = r.offset, .width = r.width, .value = v });
    }
    return encode_payload(allocator, list.items);
}

/// Replay a redistributor payload onto one HVF vCPU's redistributor.
pub fn load_hvf_redist(allocator: std.mem.Allocator, vcpu_handle: u64, payload: []const u8) !void {
    if (builtin.os.tag != .macos) return error.WrongHost;

    const entries = try decode_payload(allocator, payload);
    defer allocator.free(entries);
    for (entries) |e| {
        _ = hvf_gic.hv_gic_set_redistributor_reg(vcpu_handle, e.offset, e.value);
    }
}

// -- KVM accessors (Linux) ----------------------------------------
//
// Defined locally (not via @import("kvm.zig")) so this file still
// compiles on macOS — same pattern vcpu_dump.zig uses. The KVM
// functions early-return on non-Linux, so the kvm-only branches are
// never code-generated off-target.

const C = struct {
    extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
    extern "c" fn __errno_location() *c_int;
};

fn errno() c_int {
    return C.__errno_location().*;
}

const KVMIO: c_ulong = 0xae;

const KvmDeviceAttr = extern struct {
    flags: u32,
    group: u32,
    attr: u64,
    addr: u64,
};

comptime {
    assert(@sizeOf(KvmDeviceAttr) == 24);
}

// iow(KVMIO, 0xe1/0xe2, sizeof(kvm_device_attr)) — KVM_{SET,GET}_DEVICE_ATTR.
const KVM_SET_DEVICE_ATTR: c_ulong = (1 << 30) | (@as(c_ulong, @sizeOf(KvmDeviceAttr)) << 16) | (KVMIO << 8) | 0xe1;
const KVM_GET_DEVICE_ATTR: c_ulong = (1 << 30) | (@as(c_ulong, @sizeOf(KvmDeviceAttr)) << 16) | (KVMIO << 8) | 0xe2;

// vgic-v3 attribute groups — from <asm/kvm.h>. The full sequence is
// ADDR=0, DIST_REGS=1, CPU_REGS=2, NR_IRQS=3, CTRL=4, REDIST_REGS=5,
// CPU_SYSREGS=6, LEVEL_INFO=7, ITS_REGS=8. (kvm.zig already pins
// ADDR=0 and CTRL=4.)
const KVM_DEV_ARM_VGIC_GRP_DIST_REGS: u32 = 1;
const KVM_DEV_ARM_VGIC_GRP_REDIST_REGS: u32 = 5;

fn kvm_get_reg(gic_fd: c_int, group: u32, attr: u64) Error!u32 {
    assert(gic_fd >= 0);
    var val: u32 = 0;
    var da = KvmDeviceAttr{ .flags = 0, .group = group, .attr = attr, .addr = @intFromPtr(&val) };
    if (C.ioctl(gic_fd, KVM_GET_DEVICE_ATTR, &da) < 0) return error.KvmGetDeviceAttrFailed;
    return val;
}

fn kvm_set_reg(gic_fd: c_int, group: u32, attr: u64, val: u32) Error!void {
    assert(gic_fd >= 0);
    var v = val;
    var da = KvmDeviceAttr{ .flags = 0, .group = group, .attr = attr, .addr = @intFromPtr(&v) };
    if (C.ioctl(gic_fd, KVM_SET_DEVICE_ATTR, &da) < 0) return error.KvmSetDeviceAttrFailed;
}

/// KVM REDIST_REGS keys the redistributor by MPIDR affinity in attr
/// bits 63:32. Aff0..2 are all our single-vCPU guest ever uses; Aff3
/// (MPIDR bits 39:32) has no room in the 32-bit field and is dropped.
fn redist_attr(mpidr: u64, offset: u32) u64 {
    const aff: u64 = mpidr & 0x00ff_ffff;
    return (aff << 32) | offset;
}

/// Dump the KVM distributor registers into a portable payload.
pub fn dump_kvm_dist(allocator: std.mem.Allocator, gic_fd: c_int) ![]u8 {
    if (builtin.os.tag != .linux) return error.WrongHost;
    assert(gic_fd >= 0);

    var list = std.ArrayList(Entry).empty;
    defer list.deinit(allocator);

    var failed: usize = 0;
    var first_errno: c_int = 0;
    var nonzero: usize = 0;
    for (dist_regs) |r| {
        const v = kvm_get_reg(gic_fd, KVM_DEV_ARM_VGIC_GRP_DIST_REGS, r.offset) catch {
            failed += 1;
            if (first_errno == 0) first_errno = errno();
            continue;
        };
        if (v != 0) nonzero += 1;
        try list.append(allocator, .{ .offset = r.offset, .width = 4, .value = v });
    }
    std.debug.print(
        "gic_state.dumpKvmDist: {d}/{d} read ({d} non-zero), {d} failed (errno={d})\n",
        .{ list.items.len, dist_regs.len, nonzero, failed, first_errno },
    );
    return encode_payload(allocator, list.items);
}

/// Replay a distributor payload onto the KVM GIC. Best-effort per reg.
pub fn load_kvm_dist(allocator: std.mem.Allocator, gic_fd: c_int, payload: []const u8) !void {
    if (builtin.os.tag != .linux) return error.WrongHost;
    assert(gic_fd >= 0);

    const entries = try decode_payload(allocator, payload);
    defer allocator.free(entries);
    for (entries) |e| {
        kvm_set_reg(
            gic_fd,
            KVM_DEV_ARM_VGIC_GRP_DIST_REGS,
            e.offset,
            @truncate(e.value),
        ) catch {
            // Best-effort replay: host kernels expose slightly different VGIC regs.
        };
    }
}

/// Dump the KVM redistributor SGI-frame registers for one vCPU,
/// selected by `mpidr` (the vCPU's MPIDR_EL1).
pub fn dump_kvm_redist(allocator: std.mem.Allocator, gic_fd: c_int, mpidr: u64) ![]u8 {
    if (builtin.os.tag != .linux) return error.WrongHost;
    assert(gic_fd >= 0);

    var list = std.ArrayList(Entry).empty;
    defer list.deinit(allocator);

    var failed: usize = 0;
    var first_errno: c_int = 0;
    for (redist_regs) |r| {
        const v = kvm_get_reg(gic_fd, KVM_DEV_ARM_VGIC_GRP_REDIST_REGS, redist_attr(mpidr, r.offset)) catch {
            failed += 1;
            if (first_errno == 0) first_errno = errno();
            continue;
        };
        try list.append(allocator, .{ .offset = r.offset, .width = 4, .value = v });
    }
    std.debug.print(
        "gic_state.dumpKvmRedist: {d}/{d} read, {d} failed (mpidr=0x{x} errno={d})\n",
        .{ list.items.len, redist_regs.len, failed, mpidr, first_errno },
    );
    return encode_payload(allocator, list.items);
}

/// Replay a redistributor payload onto one KVM vCPU's redistributor.
pub fn load_kvm_redist(allocator: std.mem.Allocator, gic_fd: c_int, mpidr: u64, payload: []const u8) !void {
    if (builtin.os.tag != .linux) return error.WrongHost;
    assert(gic_fd >= 0);

    const entries = try decode_payload(allocator, payload);
    defer allocator.free(entries);
    for (entries) |e| {
        kvm_set_reg(
            gic_fd,
            KVM_DEV_ARM_VGIC_GRP_REDIST_REGS,
            redist_attr(mpidr, e.offset),
            @truncate(e.value),
        ) catch {
            // Best-effort replay: host kernels expose slightly different VGIC regs.
        };
    }
}

// -- GIC CPU interface (ICC_* system registers) -------------------
//
// The CPU interface is per-vCPU virtual-GIC state held in system
// registers, not the MMIO windows — it gates whether an interrupt
// the distributor/redistributor has marked pending actually reaches
// the vCPU. KVM exposes it via KVM_DEV_ARM_VGIC_GRP_CPU_SYSREGS.
//
// HVF's hv_sys_reg_t enum does NOT list the ICC_* encodings, so a
// HVF dump comes back empty and a HVF-sourced snapshot carries no CPU
// interface state. The KVM restore path deliberately does NOT
// substitute a guessed default programming: getting EOImode (split
// vs. direct) wrong storms the vtimer PPI. Only a real captured
// section (KVM-sourced) is replayed; otherwise the interface is left
// at the destination's reset state.

const KVM_DEV_ARM_VGIC_GRP_CPU_SYSREGS: u32 = 6;

/// ICC_* registers that gate interrupt delivery. `enc` is the 16-bit
/// op0/op1/CRn/CRm/op2 encoding (== KVM CPU_SYSREGS `instr` field ==
/// HVF hv_sys_reg_t value).
const CpuIfReg = struct { name: []const u8, enc: u16 };
const cpuif_regs = [_]CpuIfReg{
    .{ .name = "ICC_SRE_EL1", .enc = 0xC665 },
    .{ .name = "ICC_CTLR_EL1", .enc = 0xC664 },
    .{ .name = "ICC_PMR_EL1", .enc = 0xC230 },
    .{ .name = "ICC_BPR0_EL1", .enc = 0xC643 },
    .{ .name = "ICC_BPR1_EL1", .enc = 0xC663 },
    .{ .name = "ICC_IGRPEN0_EL1", .enc = 0xC666 },
    .{ .name = "ICC_IGRPEN1_EL1", .enc = 0xC667 },
    .{ .name = "ICC_AP1R0_EL1", .enc = 0xC648 },
    .{ .name = "ICC_AP0R0_EL1", .enc = 0xC644 },
};

fn cpu_if_reg_by_name(name: []const u8) ?CpuIfReg {
    for (cpuif_regs) |r| {
        if (std.mem.eql(u8, r.name, name)) return r;
    }
    return null;
}

// The ICC_* CPU-interface registers are NOT in hv_sys_reg_t —
// hv_vcpu_{get,set}_sys_reg rejects them. Apple exposes them through
// a dedicated GIC API instead: hv_gic_{get,set}_icc_reg, taking an
// hv_gic_icc_reg_t whose enum values are exactly the 16-bit ARM
// op0/op1/CRn/CRm/op2 encodings — i.e. `CpuIfReg.enc` passes straight
// through. Routing the dump/load through hv_vcpu_*_sys_reg (the
// pre-fix bug) silently no-op'd: a HVF-sourced snapshot carried no
// CPU-interface state, and on restore the interface stayed at the
// fresh-vCPU reset value (IGRPEN1=0, PMR=0) so every interrupt the
// distributor marked pending — vtimer PPI, virtio SPIs — was dropped
// before reaching the resumed guest.
const hvf_gic_icc = struct {
    extern "c" fn hv_gic_get_icc_reg(vcpu: u64, reg: u32, value: *u64) i32;
    extern "c" fn hv_gic_set_icc_reg(vcpu: u64, reg: u32, value: u64) i32;
};

/// Dump the HVF CPU interface into a name-tagged payload via
/// hv_gic_get_icc_reg. A reg HVF rejects is dropped rather than
/// aborting the whole dump.
pub fn dump_hvf_cpu_if(allocator: std.mem.Allocator, vcpu_handle: u64) ![]u8 {
    if (builtin.os.tag != .macos) return error.WrongHost;

    var entries = std.ArrayList(snapshot.VcpuEntry).empty;
    defer entries.deinit(allocator);
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();

    for (cpuif_regs) |r| {
        var v: u64 = 0;
        if (hvf_gic_icc.hv_gic_get_icc_reg(vcpu_handle, r.enc, &v) != 0) continue;
        const buf = try a.alloc(u8, 8);
        std.mem.writeInt(u64, buf[0..8], v, .little);
        try entries.append(allocator, .{ .name = r.name, .value = buf });
    }
    return snapshot.encode_vcpu_payload(allocator, entries.items);
}

/// Replay a CPU-interface payload onto an HVF vCPU via
/// hv_gic_set_icc_reg. Best-effort: a rejected reg is skipped.
pub fn load_hvf_cpu_if(allocator: std.mem.Allocator, vcpu_handle: u64, payload: []const u8) !void {
    if (builtin.os.tag != .macos) return error.WrongHost;

    const entries = try snapshot.decode_vcpu_payload(allocator, payload);
    defer allocator.free(entries);
    for (entries) |e| {
        const r = cpu_if_reg_by_name(e.name) orelse continue;
        if (e.value.len != 8) continue;
        _ = hvf_gic_icc.hv_gic_set_icc_reg(vcpu_handle, r.enc, std.mem.readInt(u64, e.value[0..8], .little));
    }
}

/// Linux GICv3-driver CPU-interface programming. The kernel sets
/// these once at boot and never touches them again (bar the AP*
/// active-priority regs, which are zero at a non-interrupt snapshot
/// point), so seeding them is equivalent to a capture for a guest
/// snapshotted in EL0 — used when the snapshot carries no real
/// gic_cpuif section (HVF can't dump ICC_*).
const cpuif_defaults = [_]struct { enc: u16, value: u64 }{
    .{ .enc = 0xC665, .value = 0x1 }, // ICC_SRE_EL1: SRE=1
    .{ .enc = 0xC230, .value = 0xf0 }, // ICC_PMR_EL1: DEFAULT_PMR_VALUE
    .{ .enc = 0xC663, .value = 0x0 }, // ICC_BPR1_EL1
    .{ .enc = 0xC664, .value = 0x0 }, // ICC_CTLR_EL1: EOImode=0
    .{ .enc = 0xC666, .value = 0x0 }, // ICC_IGRPEN0_EL1
    .{ .enc = 0xC648, .value = 0x0 }, // ICC_AP1R0_EL1
    .{ .enc = 0xC644, .value = 0x0 }, // ICC_AP0R0_EL1
    .{ .enc = 0xC667, .value = 0x1 }, // ICC_IGRPEN1_EL1: group 1 enabled (last)
};

/// Seed the HVF CPU interface with Linux's known-static GICv3
/// programming, via hv_gic_set_icc_reg. Fallback for `.vmstate`
/// files written before `dumpHvfCpuIf` could capture the real ICC_*
/// state — a current snapshot carries a real `gic_cpuif` section and
/// `loadHvfCpuIf` replays that instead, so this only runs when no
/// section is present.
pub fn apply_hvf_cpu_if_defaults(vcpu_handle: u64) void {
    if (builtin.os.tag != .macos) return;
    for (cpuif_defaults) |r| {
        _ = hvf_gic_icc.hv_gic_set_icc_reg(vcpu_handle, r.enc, r.value);
    }
}

fn kvm_get_sysreg(gic_fd: c_int, mpidr: u64, enc: u16) Error!u64 {
    assert(gic_fd >= 0);
    var val: u64 = 0;
    var da = KvmDeviceAttr{
        .flags = 0,
        .group = KVM_DEV_ARM_VGIC_GRP_CPU_SYSREGS,
        .attr = ((mpidr & 0x00ff_ffff) << 32) | enc,
        .addr = @intFromPtr(&val),
    };
    if (C.ioctl(gic_fd, KVM_GET_DEVICE_ATTR, &da) < 0) return error.KvmGetDeviceAttrFailed;
    return val;
}

fn kvm_set_sysreg(gic_fd: c_int, mpidr: u64, enc: u16, val: u64) Error!void {
    assert(gic_fd >= 0);
    var v = val;
    var da = KvmDeviceAttr{
        .flags = 0,
        .group = KVM_DEV_ARM_VGIC_GRP_CPU_SYSREGS,
        .attr = ((mpidr & 0x00ff_ffff) << 32) | enc,
        .addr = @intFromPtr(&v),
    };
    if (C.ioctl(gic_fd, KVM_SET_DEVICE_ATTR, &da) < 0) return error.KvmSetDeviceAttrFailed;
}

/// Dump the KVM CPU interface for one vCPU into a name-tagged payload.
pub fn dump_kvm_cpu_if(allocator: std.mem.Allocator, gic_fd: c_int, mpidr: u64) ![]u8 {
    if (builtin.os.tag != .linux) return error.WrongHost;
    assert(gic_fd >= 0);

    var entries = std.ArrayList(snapshot.VcpuEntry).empty;
    defer entries.deinit(allocator);
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var failed: usize = 0;
    var first_errno: c_int = 0;
    for (cpuif_regs) |r| {
        const v = kvm_get_sysreg(gic_fd, mpidr, r.enc) catch {
            failed += 1;
            if (first_errno == 0) first_errno = errno();
            continue;
        };
        const buf = try a.alloc(u8, 8);
        std.mem.writeInt(u64, buf[0..8], v, .little);
        try entries.append(allocator, .{ .name = r.name, .value = buf });
    }
    std.debug.print(
        "gic_state.dumpKvmCpuIf: {d}/{d} read, {d} failed (mpidr=0x{x} errno={d})\n",
        .{ entries.items.len, cpuif_regs.len, failed, mpidr, first_errno },
    );
    return snapshot.encode_vcpu_payload(allocator, entries.items);
}

/// Replay a CPU-interface payload onto one KVM vCPU. Best-effort per
/// register. Returns the count actually applied so the caller can
/// tell a real capture from an empty (HVF-sourced) one.
pub fn load_kvm_cpu_if(allocator: std.mem.Allocator, gic_fd: c_int, mpidr: u64, payload: []const u8) !usize {
    if (builtin.os.tag != .linux) return error.WrongHost;
    assert(gic_fd >= 0);

    const entries = try snapshot.decode_vcpu_payload(allocator, payload);
    defer allocator.free(entries);
    var applied: usize = 0;
    for (entries) |e| {
        const r = cpu_if_reg_by_name(e.name) orelse continue;
        if (e.value.len != 8) continue;
        kvm_set_sysreg(gic_fd, mpidr, r.enc, std.mem.readInt(u64, e.value[0..8], .little)) catch continue;
        applied += 1;
    }
    return applied;
}

// -- tests --------------------------------------------------------

test "payload round-trips an entry list" {
    const a = std.testing.allocator;
    const entries = [_]Entry{
        .{ .offset = 0x0000, .width = 4, .value = 0x37 },
        .{ .offset = 0x0104, .width = 4, .value = 0xdead_beef },
        .{ .offset = 0x6000, .width = 8, .value = 0x1122_3344_5566_7788 },
    };
    const payload = try encode_payload(a, &entries);
    defer a.free(payload);

    const decoded = try decode_payload(a, payload);
    defer a.free(decoded);

    try std.testing.expectEqual(@as(usize, 3), decoded.len);
    for (entries, decoded) |want, got| {
        try std.testing.expectEqual(want.offset, got.offset);
        try std.testing.expectEqual(want.width, got.width);
        try std.testing.expectEqual(want.value, got.value);
    }
}

test "payload round-trips an empty list" {
    const a = std.testing.allocator;
    const payload = try encode_payload(a, &.{});
    defer a.free(payload);
    try std.testing.expectEqual(@as(usize, 4), payload.len);

    const decoded = try decode_payload(a, payload);
    defer a.free(decoded);
    try std.testing.expectEqual(@as(usize, 0), decoded.len);
}

test "decode rejects a truncated payload" {
    const a = std.testing.allocator;
    try std.testing.expectError(error.Truncated, decode_payload(a, &[_]u8{ 1, 0, 0 }));
    // count says 2 entries but only one entry's worth of bytes follow.
    var buf: [4 + ENTRY_SIZE]u8 = @splat(0);
    std.mem.writeInt(u32, buf[0..4], 2, .little);
    try std.testing.expectError(error.Truncated, decode_payload(a, &buf));
}

test "register tables are non-empty and bounded" {
    try std.testing.expect(dist_regs.len > 0);
    try std.testing.expect(redist_regs.len > 0);
    // Every entry is a 32-bit register in v1.
    for (dist_regs) |r| try std.testing.expectEqual(@as(u32, 4), r.width);
    for (redist_regs) |r| try std.testing.expectEqual(@as(u32, 4), r.width);
    // Redistributor regs all live in the SGI frame (>= 0x10000).
    for (redist_regs) |r| try std.testing.expect(r.offset >= 0x10000);
    try std.testing.expectEqual(
        4 + (dist_regs.len + redist_regs.len) * ENTRY_SIZE,
        max_payload_bytes,
    );
}

test "redistAttr packs mpidr affinity into bits 63:32" {
    try std.testing.expectEqual(@as(u64, 0x10100), redist_attr(0, 0x10100));
    // Aff3 (MPIDR bits 39:32) is dropped; Aff0..2 survive.
    try std.testing.expectEqual(@as(u64, 0x0012_3499_0001_0080), redist_attr(0xff00_0012_3499, 0x10080));
}

test "cpuif register table resolves names to ICC encodings" {
    const grpen1 = cpu_if_reg_by_name("ICC_IGRPEN1_EL1") orelse return error.TestExpectedEqual;
    try std.testing.expectEqual(@as(u16, 0xC667), grpen1.enc);
    const pmr = cpu_if_reg_by_name("ICC_PMR_EL1") orelse return error.TestExpectedEqual;
    try std.testing.expectEqual(@as(u16, 0xC230), pmr.enc);
    try std.testing.expectEqual(@as(?CpuIfReg, null), cpu_if_reg_by_name("NOT_A_REG"));
}

test "cpuif encodings match the hv_gic_icc_reg_t enum values" {
    // `CpuIfReg.enc` is passed straight to hv_gic_{get,set}_icc_reg as
    // the hv_gic_icc_reg_t argument — the HVF dump/load path no longer
    // routes through hv_vcpu_*_sys_reg, which silently rejects ICC_*.
    // These constants are the hv_gic_icc_reg_t enumerators from
    // <Hypervisor/hv_gic_types.h>; a drift here re-introduces the bug
    // where a HVF-sourced snapshot carried no CPU-interface state.
    const want = [_]struct { name: []const u8, enc: u16 }{
        .{ .name = "ICC_PMR_EL1", .enc = 0xc230 },
        .{ .name = "ICC_BPR0_EL1", .enc = 0xc643 },
        .{ .name = "ICC_AP0R0_EL1", .enc = 0xc644 },
        .{ .name = "ICC_AP1R0_EL1", .enc = 0xc648 },
        .{ .name = "ICC_BPR1_EL1", .enc = 0xc663 },
        .{ .name = "ICC_CTLR_EL1", .enc = 0xc664 },
        .{ .name = "ICC_SRE_EL1", .enc = 0xc665 },
        .{ .name = "ICC_IGRPEN0_EL1", .enc = 0xc666 },
        .{ .name = "ICC_IGRPEN1_EL1", .enc = 0xc667 },
    };
    for (want) |w| {
        const r = cpu_if_reg_by_name(w.name) orelse return error.TestExpectedEqual;
        try std.testing.expectEqual(w.enc, r.enc);
    }
}

test "KVM device-attr ioctl numbers match the kernel" {
    // iow(0xae, 0xe1, 24) / iow(0xae, 0xe2, 24).
    try std.testing.expectEqual(@as(c_ulong, 0x4018aee1), KVM_SET_DEVICE_ATTR);
    try std.testing.expectEqual(@as(c_ulong, 0x4018aee2), KVM_GET_DEVICE_ATTR);
}

test "KVM vgic-v3 attribute groups match the kernel ABI" {
    // The off-by-N here was a real bug: the whole KVM GIC path was a
    // silent no-op until these were pinned to the <asm/kvm.h> values.
    try std.testing.expectEqual(@as(u32, 1), KVM_DEV_ARM_VGIC_GRP_DIST_REGS);
    try std.testing.expectEqual(@as(u32, 5), KVM_DEV_ARM_VGIC_GRP_REDIST_REGS);
    try std.testing.expectEqual(@as(u32, 6), KVM_DEV_ARM_VGIC_GRP_CPU_SYSREGS);
}
