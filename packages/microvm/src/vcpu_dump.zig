//! vCPU dump+load for the .vmstate VCPU section (tasks #18, #19).
//!
//! Reads/writes a backend's vCPU register state via the existing
//! kvm.zig / hvf.zig wrappers, applies the classification from
//! sysreg_classify.zig, and produces a name-tagged VCPU payload the
//! snapshot.encodeVcpuPayload / decodeVcpuPayload codec understands.
//!
//! The name is the canonical ARM mnemonic (`X0`, `PC`, `PMCR_EL0`,
//! `S3_0_C0_C0_6`). It's the only thing portable across backends —
//! KVM register IDs and HVF `hv_sys_reg_t` codes are not.

const std = @import("std");
const builtin = @import("builtin");
const snapshot = @import("snapshot.zig");
const sysreg_names = @import("sysreg_names.zig");
const sysreg_classify = @import("sysreg_classify.zig");

// -- ARM core register names + offsets in struct kvm_regs ----------
//
// The layout of struct kvm_regs (from arch/arm64/include/uapi/asm/kvm.h):
//   struct user_pt_regs regs (0..271):
//     regs[0..30]  X0..X30          0..240 step 8
//     sp            SP_EL0          248
//     pc            PC              256
//     pstate        PSTATE          264
//   sp_el1                          272
//   elr_el1                         280
//   spsr[5]         SPSR_EL1..fiq   288..320 step 8
//   fp_regs.vregs[32] V0..V31       328..824 step 16 (128 bits each)
//   fp_regs.fpsr    FPSR            840
//   fp_regs.fpcr    FPCR            844
//
// KVM_REG_ARM_CORE encodes register ID as:
//   KVM_REG_ARM64 | KVM_REG_ARM_CORE | size | (struct_offset / 4)

const CoreReg = struct {
    name: []const u8,
    offset: u32, // byte offset in struct kvm_regs
    size: enum { u32_, u64_, u128_ },
};

pub const core_regs: []const CoreReg = &generateCoreRegs();

// X0..X30 + PC + PSTATE + SP_EL0 + SP_EL1 + ELR_EL1 + SPSR_EL1 +
// V0..V31 + FPSR + FPCR.
//
// SP_EL0/SP_EL1/ELR_EL1/SPSR_EL1 MUST live here: on KVM they are
// fields of `struct kvm_regs` reached via KVM_REG_ARM_CORE, NOT
// sysregs. HVF exposes them as system registers, so the dump tags
// them with their canonical names and HVF's load path resolves the
// name → sysreg encoding; KVM's load path resolves the same name →
// this core-reg offset. Routing them through the sysreg path on KVM
// (the pre-#37 bug) returned ENOENT, leaving SP_EL0 garbage and the
// resumed guest fault-looping on its first stack access.
fn generateCoreRegs() [71]CoreReg {
    @setEvalBranchQuota(20000);
    var out: [71]CoreReg = undefined;
    var idx: usize = 0;
    inline for (0..31) |i| {
        const name = std.fmt.comptimePrint("X{d}", .{i});
        out[idx] = .{ .name = name, .offset = @intCast(i * 8), .size = .u64_ };
        idx += 1;
    }
    out[idx] = .{ .name = "PC", .offset = 256, .size = .u64_ };
    idx += 1;
    out[idx] = .{ .name = "PSTATE", .offset = 264, .size = .u64_ };
    idx += 1;
    // user_pt_regs.sp (== SP_EL0) at 248, then sp_el1/elr_el1/spsr[0]
    // at 272/280/288 — see the struct kvm_regs layout note above.
    out[idx] = .{ .name = "SP_EL0", .offset = 248, .size = .u64_ };
    idx += 1;
    out[idx] = .{ .name = "SP_EL1", .offset = 272, .size = .u64_ };
    idx += 1;
    out[idx] = .{ .name = "ELR_EL1", .offset = 280, .size = .u64_ };
    idx += 1;
    out[idx] = .{ .name = "SPSR_EL1", .offset = 288, .size = .u64_ };
    idx += 1;
    // fp_regs starts at offset 336 (16-byte aligned for __uint128_t,
    // not 328 as a naive sum suggests). Verified at runtime via
    // offsetof() on a real Linux header — see commit notes.
    inline for (0..32) |i| {
        const name = std.fmt.comptimePrint("V{d}", .{i});
        out[idx] = .{ .name = name, .offset = @intCast(336 + i * 16), .size = .u128_ };
        idx += 1;
    }
    out[idx] = .{ .name = "FPSR", .offset = 848, .size = .u32_ };
    idx += 1;
    out[idx] = .{ .name = "FPCR", .offset = 852, .size = .u32_ };
    idx += 1;
    std.debug.assert(idx == out.len);
    return out;
}

// -- KVM register-ID encoding -------------------------------------

const KVM_REG_ARM64: u64 = 0x6000_0000_0000_0000;
const KVM_REG_SIZE_U32: u64 = 0x0020_0000_0000_0000;
const KVM_REG_SIZE_U64: u64 = 0x0030_0000_0000_0000;
const KVM_REG_SIZE_U128: u64 = 0x0040_0000_0000_0000;
const KVM_REG_ARM_CORE: u64 = 0x0010_0000;
const KVM_REG_ARM64_SYSREG: u64 = 0x0013_0000;

fn kvmIdForCore(reg: CoreReg) u64 {
    // The register ID packs `offset / 4`; a non-4-aligned offset
    // would silently truncate and address the wrong register.
    std.debug.assert(reg.offset % 4 == 0);
    const size_bits: u64 = switch (reg.size) {
        .u32_ => KVM_REG_SIZE_U32,
        .u64_ => KVM_REG_SIZE_U64,
        .u128_ => KVM_REG_SIZE_U128,
    };
    return KVM_REG_ARM64 | KVM_REG_ARM_CORE | size_bits | (reg.offset / 4);
}

fn kvmIdForSysreg(encoding: u16) u64 {
    return KVM_REG_ARM64 | KVM_REG_SIZE_U64 | KVM_REG_ARM64_SYSREG | encoding;
}

// -- Name <-> sysreg encoding -------------------------------------

/// Look up the 16-bit op0/op1/CRn/CRm/op2 encoding for a sysreg name.
/// Recognizes both the named table (from hv_sys_reg_t) and the
/// generic `S<op0>_<op1>_C<CRn>_C<CRm>_<op2>` form.
pub fn encodingForName(name: []const u8) ?u16 {
    std.debug.assert(name.len > 0);
    for (sysreg_names.table) |e| {
        if (std.mem.eql(u8, e.name, name)) return e.encoding;
    }
    if (std.mem.startsWith(u8, name, "S")) {
        return parseSynthName(name);
    }
    return null;
}

fn parseSynthName(name: []const u8) ?u16 {
    // Format: S<op0>_<op1>_C<CRn>_C<CRm>_<op2>
    var it = std.mem.tokenizeScalar(u8, name, '_');
    const s_tok = it.next() orelse return null;
    if (s_tok.len < 2 or s_tok[0] != 'S') return null;
    const op0 = std.fmt.parseInt(u8, s_tok[1..], 10) catch return null;
    const op1 = std.fmt.parseInt(u8, it.next() orelse return null, 10) catch return null;
    const crn_tok = it.next() orelse return null;
    if (crn_tok.len < 2 or crn_tok[0] != 'C') return null;
    const crn = std.fmt.parseInt(u8, crn_tok[1..], 10) catch return null;
    const crm_tok = it.next() orelse return null;
    if (crm_tok.len < 2 or crm_tok[0] != 'C') return null;
    const crm = std.fmt.parseInt(u8, crm_tok[1..], 10) catch return null;
    const op2 = std.fmt.parseInt(u8, it.next() orelse return null, 10) catch return null;
    if (it.next() != null) return null;
    if (op0 > 3 or op1 > 7 or crn > 15 or crm > 15 or op2 > 7) return null;
    return (@as(u16, op0) << 14) | (@as(u16, op1) << 11) | (@as(u16, crn) << 7) | (@as(u16, crm) << 3) | op2;
}

/// Inverse: encoding → name. Returns the table name if present, else
/// the synthetic generic form. The returned slice for synth names
/// points into `buf` (caller-owned).
pub fn nameForEncoding(encoding: u16, buf: []u8) []const u8 {
    // Longest synthetic form is "S3_7_C15_C15_7" (14 bytes); the
    // bufPrint below relies on `buf` having room for it, which is
    // why its failure path can be `unreachable`.
    std.debug.assert(buf.len >= 16);
    for (sysreg_names.table) |e| {
        if (e.encoding == encoding) return e.name;
    }
    const op0: u8 = @intCast((encoding >> 14) & 0x3);
    const op1: u8 = @intCast((encoding >> 11) & 0x7);
    const crn: u8 = @intCast((encoding >> 7) & 0xf);
    const crm: u8 = @intCast((encoding >> 3) & 0xf);
    const op2: u8 = @intCast(encoding & 0x7);
    const out = std.fmt.bufPrint(buf, "S{d}_{d}_C{d}_C{d}_{d}", .{ op0, op1, crn, crm, op2 }) catch unreachable;
    std.debug.assert(out.len > 0);
    return out;
}

// -- KVM ioctl glue (Linux-only) ----------------------------------

const C = struct {
    extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
};

const KVMIO: u8 = 0xae;
const KVM_GET_ONE_REG: c_ulong = (1 << 30) | (@sizeOf(kvm_one_reg) << 16) | (@as(c_ulong, KVMIO) << 8) | 0xab;
const KVM_SET_ONE_REG: c_ulong = (1 << 30) | (@sizeOf(kvm_one_reg) << 16) | (@as(c_ulong, KVMIO) << 8) | 0xac;

const kvm_one_reg = extern struct {
    id: u64,
    addr: u64,
};

fn kvmGet(vcpu_fd: c_int, id: u64, buf: []u8) !void {
    // KVM writes the register width into `buf`; a zero-length target
    // is always a caller bug.
    std.debug.assert(buf.len > 0);
    const r: kvm_one_reg = .{ .id = id, .addr = @intFromPtr(buf.ptr) };
    if (C.ioctl(vcpu_fd, KVM_GET_ONE_REG, &r) < 0) return error.KvmGetOneRegFailed;
}

fn kvmSet(vcpu_fd: c_int, id: u64, buf: []const u8) !void {
    // KVM reads the register width from `buf`; a zero-length source
    // is always a caller bug.
    std.debug.assert(buf.len > 0);
    const r: kvm_one_reg = .{ .id = id, .addr = @intFromPtr(buf.ptr) };
    if (C.ioctl(vcpu_fd, KVM_SET_ONE_REG, &r) < 0) return error.KvmSetOneRegFailed;
}

// -- HVF accessors (macOS) ----------------------------------------

const hvf_extern = struct {
    extern "c" fn hv_vcpu_get_reg(vcpu: u64, reg: u32, value: *u64) i32;
    extern "c" fn hv_vcpu_set_reg(vcpu: u64, reg: u32, value: u64) i32;
    extern "c" fn hv_vcpu_get_simd_fp_reg(vcpu: u64, reg: u32, value: *u128) i32;
    extern "c" fn hv_vcpu_set_simd_fp_reg(vcpu: u64, reg: u32, value: u128) i32;
    extern "c" fn hv_vcpu_get_sys_reg(vcpu: u64, reg: u32, value: *u64) i32;
    extern "c" fn hv_vcpu_set_sys_reg(vcpu: u64, reg: u32, value: u64) i32;
};

// hv_reg_t enum values from hv_vcpu_types.h.
const HV_REG_X0: u32 = 0; // X1..X30 are X0+i
const HV_REG_PC: u32 = 31;
const HV_REG_FPCR: u32 = 32;
const HV_REG_FPSR: u32 = 33;
const HV_REG_CPSR: u32 = 34; // canonical name "PSTATE"
// hv_simd_fp_reg_t starts at 0 too, but is a separate enum
// addressed via hv_vcpu_get_simd_fp_reg.

// -- public dump/load API -----------------------------------------

/// Dump every dumpable register from `vcpu_fd` into a fresh
/// name-tagged VCPU payload. Skip-classified regs are omitted.
/// Caller owns the returned bytes.
pub fn dumpKvm(allocator: std.mem.Allocator, vcpu_fd: c_int) ![]u8 {
    if (builtin.os.tag != .linux) return error.WrongHost;

    var entries = std.ArrayList(snapshot.VcpuEntry).empty;
    defer entries.deinit(allocator);

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();

    for (core_regs) |reg| {
        if (sysreg_classify.classify(reg.name) == .skip) continue;
        const sz: usize = switch (reg.size) {
            .u32_ => 4,
            .u64_ => 8,
            .u128_ => 16,
        };
        const buf = try a.alloc(u8, sz);
        // Some core slots (e.g. SPSR_ABT/UND/IRQ/FIQ) aren't exposed
        // by every KVM version; treat ENOENT as "drop the entry"
        // rather than abort the whole dump.
        kvmGet(vcpu_fd, kvmIdForCore(reg), buf) catch |err| {
            if (err == error.KvmGetOneRegFailed) continue;
            return err;
        };
        try entries.append(allocator, .{ .name = reg.name, .value = buf });
    }

    for (sysreg_names.table) |e| {
        if (sysreg_classify.classify(e.name) == .skip) continue;
        const buf = try a.alloc(u8, 8);
        kvmGet(vcpu_fd, kvmIdForSysreg(e.encoding), buf) catch |err| {
            // KVM may not expose every reg Apple's enum lists (e.g.
            // SME on hosts without it). That's fine; drop the entry.
            if (err == error.KvmGetOneRegFailed) continue;
            return err;
        };
        try entries.append(allocator, .{ .name = e.name, .value = buf });
    }

    const out = try snapshot.encodeVcpuPayload(allocator, entries.items);
    // The codec always emits at least the entry_count header word.
    std.debug.assert(out.len >= 4);
    return out;
}

// -- HVF dump / load ----------------------------------------------

pub fn dumpHvf(allocator: std.mem.Allocator, vcpu_handle: u64) ![]u8 {
    if (builtin.os.tag != .macos) return error.WrongHost;

    var entries = std.ArrayList(snapshot.VcpuEntry).empty;
    defer entries.deinit(allocator);

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // X0..X30
    for (0..31) |i| {
        const name = try std.fmt.allocPrint(a, "X{d}", .{i});
        var v: u64 = 0;
        if (hvf_extern.hv_vcpu_get_reg(vcpu_handle, HV_REG_X0 + @as(u32, @intCast(i)), &v) != 0) continue;
        const buf = try a.alloc(u8, 8);
        std.mem.writeInt(u64, buf[0..8], v, .little);
        try entries.append(allocator, .{ .name = name, .value = buf });
    }
    // PC, PSTATE, FPCR, FPSR
    const single_gprs = [_]struct { name: []const u8, reg: u32, bytes: u8 }{
        .{ .name = "PC", .reg = HV_REG_PC, .bytes = 8 },
        .{ .name = "PSTATE", .reg = HV_REG_CPSR, .bytes = 8 },
        .{ .name = "FPCR", .reg = HV_REG_FPCR, .bytes = 4 },
        .{ .name = "FPSR", .reg = HV_REG_FPSR, .bytes = 4 },
    };
    for (single_gprs) |g| {
        var v: u64 = 0;
        if (hvf_extern.hv_vcpu_get_reg(vcpu_handle, g.reg, &v) != 0) continue;
        const buf = try a.alloc(u8, g.bytes);
        if (g.bytes == 8) std.mem.writeInt(u64, buf[0..8], v, .little);
        if (g.bytes == 4) std.mem.writeInt(u32, buf[0..4], @intCast(v & 0xffff_ffff), .little);
        try entries.append(allocator, .{ .name = g.name, .value = buf });
    }
    // V0..V31 — SIMD 128-bit
    for (0..32) |i| {
        const name = try std.fmt.allocPrint(a, "V{d}", .{i});
        var v: u128 = 0;
        if (hvf_extern.hv_vcpu_get_simd_fp_reg(vcpu_handle, @intCast(i), &v) != 0) continue;
        const buf = try a.alloc(u8, 16);
        std.mem.writeInt(u128, buf[0..16], v, .little);
        try entries.append(allocator, .{ .name = name, .value = buf });
    }
    // Sysregs
    for (sysreg_names.table) |e| {
        if (sysreg_classify.classify(e.name) == .skip) continue;
        var v: u64 = 0;
        if (hvf_extern.hv_vcpu_get_sys_reg(vcpu_handle, e.encoding, &v) != 0) continue;
        const buf = try a.alloc(u8, 8);
        std.mem.writeInt(u64, buf[0..8], v, .little);
        try entries.append(allocator, .{ .name = e.name, .value = buf });
    }

    const out = try snapshot.encodeVcpuPayload(allocator, entries.items);
    // The codec always emits at least the entry_count header word.
    std.debug.assert(out.len >= 4);
    return out;
}

pub fn loadHvf(allocator: std.mem.Allocator, vcpu_handle: u64, payload: []const u8) !void {
    if (builtin.os.tag != .macos) return error.WrongHost;
    const entries = try snapshot.decodeVcpuPayload(allocator, payload);
    defer allocator.free(entries);

    for (entries) |e| {
        // X<n>?
        if (e.name.len >= 2 and e.name[0] == 'X') {
            const idx = std.fmt.parseInt(u32, e.name[1..], 10) catch {
                applyHvfNamed(vcpu_handle, e) catch {};
                continue;
            };
            if (idx > 30) continue;
            if (e.value.len != 8) continue;
            const v = std.mem.readInt(u64, e.value[0..8], .little);
            _ = hvf_extern.hv_vcpu_set_reg(vcpu_handle, HV_REG_X0 + idx, v);
            continue;
        }
        // V<n>?
        if (e.name.len >= 2 and e.name[0] == 'V') {
            const idx = std.fmt.parseInt(u32, e.name[1..], 10) catch {
                applyHvfNamed(vcpu_handle, e) catch {};
                continue;
            };
            if (idx > 31) continue;
            if (e.value.len != 16) continue;
            const v = std.mem.readInt(u128, e.value[0..16], .little);
            _ = hvf_extern.hv_vcpu_set_simd_fp_reg(vcpu_handle, idx, v);
            continue;
        }
        applyHvfNamed(vcpu_handle, e) catch {};
    }
}

fn applyHvfNamed(vcpu_handle: u64, e: snapshot.VcpuEntry) !void {
    if (std.mem.eql(u8, e.name, "PC")) {
        if (e.value.len != 8) return;
        const v = std.mem.readInt(u64, e.value[0..8], .little);
        _ = hvf_extern.hv_vcpu_set_reg(vcpu_handle, HV_REG_PC, v);
    } else if (std.mem.eql(u8, e.name, "PSTATE")) {
        if (e.value.len != 8) return;
        const v = std.mem.readInt(u64, e.value[0..8], .little);
        _ = hvf_extern.hv_vcpu_set_reg(vcpu_handle, HV_REG_CPSR, v);
    } else if (std.mem.eql(u8, e.name, "FPCR")) {
        if (e.value.len != 4) return;
        const v = @as(u64, std.mem.readInt(u32, e.value[0..4], .little));
        _ = hvf_extern.hv_vcpu_set_reg(vcpu_handle, HV_REG_FPCR, v);
    } else if (std.mem.eql(u8, e.name, "FPSR")) {
        if (e.value.len != 4) return;
        const v = @as(u64, std.mem.readInt(u32, e.value[0..4], .little));
        _ = hvf_extern.hv_vcpu_set_reg(vcpu_handle, HV_REG_FPSR, v);
    } else if (encodingForName(e.name)) |enc| {
        if (e.value.len != 8) return;
        const v = std.mem.readInt(u64, e.value[0..8], .little);
        _ = hvf_extern.hv_vcpu_set_sys_reg(vcpu_handle, enc, v);
    }
}

/// Load every reg in `payload` into `vcpu_fd`. Unknown names are
/// silently dropped (a future dump format may carry more regs than
/// the current load path understands; that's not an error).
pub fn loadKvm(allocator: std.mem.Allocator, vcpu_fd: c_int, payload: []const u8) !void {
    if (builtin.os.tag != .linux) return error.WrongHost;
    const entries = try snapshot.decodeVcpuPayload(allocator, payload);
    defer allocator.free(entries);

    // Restore diagnostics — a high `failed` count, and especially
    // *which* registers failed, is the tell-tale of a guest that
    // resumes into a broken register state.
    var applied: usize = 0;
    var failed: usize = 0;
    var unknown: usize = 0;
    // Bounded scratch for the failed-name list; one stderr line.
    var fail_buf: [1024]u8 = undefined;
    var fail_len: usize = 0;
    for (entries) |e| {
        // Invariant: the failed-name scratch never overflows — every
        // append goes through bufPrint into the remaining tail.
        std.debug.assert(fail_len <= fail_buf.len);
        var ok = true;
        var handled = false;
        // First try core reg.
        for (core_regs) |c| {
            if (std.mem.eql(u8, c.name, e.name)) {
                handled = true;
                ok = if (kvmSet(vcpu_fd, kvmIdForCore(c), e.value)) true else |_| false;
                break;
            }
        }
        if (!handled) {
            // Else sysreg by name.
            if (encodingForName(e.name)) |enc| {
                handled = true;
                ok = if (kvmSet(vcpu_fd, kvmIdForSysreg(enc), e.value)) true else |_| false;
            }
        }
        if (!handled) {
            unknown += 1;
        } else if (ok) {
            applied += 1;
        } else {
            failed += 1;
            const sep: []const u8 = if (fail_len == 0) "" else ",";
            const chunk = std.fmt.bufPrint(
                fail_buf[fail_len..],
                "{s}{s}",
                .{ sep, e.name },
            ) catch "";
            fail_len += chunk.len;
        }
    }
    std.debug.print(
        "vcpu_dump.loadKvm: {d} applied, {d} failed, {d} unknown ({d} total)\n  failed: {s}\n",
        .{ applied, failed, unknown, entries.len, fail_buf[0..fail_len] },
    );
}

// -- tests --------------------------------------------------------

test "encodingForName resolves known names" {
    try std.testing.expectEqual(@as(?u16, 0x8012), encodingForName("MDSCR_EL1"));
    try std.testing.expectEqual(@as(?u16, 0xc080), encodingForName("SCTLR_EL1"));
}

test "encodingForName parses synthetic names" {
    // S3_0_C0_C0_6 = (3<<14)|(0<<11)|(0<<7)|(0<<3)|6 = 0xC006
    try std.testing.expectEqual(@as(?u16, 0xC006), encodingForName("S3_0_C0_C0_6"));
    // S2_4_C0_C7_0 = (2<<14)|(4<<11)|(0<<7)|(7<<3)|0 = 0xA038
    try std.testing.expectEqual(@as(?u16, 0xA038), encodingForName("S2_4_C0_C7_0"));
}

test "encodingForName rejects malformed synthetic names" {
    try std.testing.expectEqual(@as(?u16, null), encodingForName("S5_0_C0_C0_0")); // op0 > 3
    try std.testing.expectEqual(@as(?u16, null), encodingForName("S3_X_C0_C0_0")); // bad int
    try std.testing.expectEqual(@as(?u16, null), encodingForName("noprefix"));
}

test "nameForEncoding round-trips" {
    var buf: [32]u8 = undefined;
    try std.testing.expectEqualStrings("MDSCR_EL1", nameForEncoding(0x8012, &buf));
    try std.testing.expectEqualStrings("SCTLR_EL1", nameForEncoding(0xc080, &buf));
    try std.testing.expectEqualStrings("S3_0_C0_C0_6", nameForEncoding(0xc006, &buf));
}

test "core reg generation produces the right set" {
    // 31 X + PC + PSTATE + SP_EL0 + SP_EL1 + ELR_EL1 + SPSR_EL1
    // + 32 V + FPSR + FPCR = 71
    try std.testing.expectEqual(@as(usize, 71), core_regs.len);
    try std.testing.expectEqualStrings("X0", core_regs[0].name);
    try std.testing.expectEqualStrings("X30", core_regs[30].name);
    try std.testing.expectEqualStrings("FPCR", core_regs[core_regs.len - 1].name);
    // SP_EL0/SP_EL1/ELR_EL1/SPSR_EL1 must resolve to KVM core-reg
    // offsets, not sysreg encodings.
    var saw_sp_el0 = false;
    for (core_regs) |r| {
        if (std.mem.eql(u8, r.name, "SP_EL0")) {
            saw_sp_el0 = true;
            try std.testing.expectEqual(@as(u32, 248), r.offset);
        }
    }
    try std.testing.expect(saw_sp_el0);
}

test "kvmIdForCore matches known constants" {
    // X0: KVM_REG_ARM64 | ARM_CORE | SIZE_U64 | (0/4) = 0x6030_0000_0010_0000
    const x0 = kvmIdForCore(core_regs[0]);
    try std.testing.expectEqual(@as(u64, 0x6030_0000_0010_0000), x0);
    // PC is index 31 (31 X regs, then PC).
    try std.testing.expectEqualStrings("PC", core_regs[31].name);
    const pc = kvmIdForCore(core_regs[31]);
    try std.testing.expectEqual(@as(u64, 0x6030_0000_0010_0040), pc);
}

test "kvmIdForSysreg matches expected layout" {
    // PMCR_EL0 encoding 0xdce0: id = 0x6030_0000_0013_dce0
    const id = kvmIdForSysreg(0xdce0);
    try std.testing.expectEqual(@as(u64, 0x6030_0000_0013_dce0), id);
}

// Round-trip integration test — only on linux/arm64 with /dev/kvm.
// Boots a fresh vCPU, mutates a few regs to known values, dumps,
// loads into a second fresh vCPU, dumps again, asserts equality
// modulo mask-classified entries. Skips silently elsewhere.
test "dump/load round-trip on HVF" {
    if (builtin.os.tag != .macos) return error.SkipZigTest;
    const hvf = @import("hvf.zig");

    const a = std.testing.allocator;

    // First VM+vCPU: set X0/PC/PSTATE, dump.
    var vm_a = try hvf.Vm.create();
    var vcpu_a = try hvf.Vcpu.create();
    _ = hvf_extern.hv_vcpu_set_reg(vcpu_a.handle, HV_REG_X0, 0xDEAD_BEEF_CAFE_BABE);
    _ = hvf_extern.hv_vcpu_set_reg(vcpu_a.handle, HV_REG_PC, 0x4000_0000);
    _ = hvf_extern.hv_vcpu_set_reg(vcpu_a.handle, HV_REG_CPSR, 0x3C5);
    const dump_a = try dumpHvf(a, vcpu_a.handle);
    defer a.free(dump_a);
    vcpu_a.destroy();
    vm_a.destroy();

    // Second VM+vCPU: load dump_a, dump again.
    var vm_b = try hvf.Vm.create();
    defer vm_b.destroy();
    var vcpu_b = try hvf.Vcpu.create();
    defer vcpu_b.destroy();
    try loadHvf(a, vcpu_b.handle, dump_a);
    const dump_b = try dumpHvf(a, vcpu_b.handle);
    defer a.free(dump_b);

    // Compare under classification.
    const entries_a = try snapshot.decodeVcpuPayload(a, dump_a);
    defer a.free(entries_a);
    const entries_b = try snapshot.decodeVcpuPayload(a, dump_b);
    defer a.free(entries_b);

    var b_index = std.StringHashMap([]const u8).init(a);
    defer b_index.deinit();
    for (entries_b) |e| try b_index.put(e.name, e.value);

    var diff_count: usize = 0;
    for (entries_a) |ea| {
        const cls = sysreg_classify.classify(ea.name);
        if (cls == .mask or cls == .skip) continue;
        const vb = b_index.get(ea.name) orelse {
            std.debug.print("missing in B: {s}\n", .{ea.name});
            diff_count += 1;
            continue;
        };
        if (!std.mem.eql(u8, ea.value, vb)) {
            std.debug.print("differs: {s}\n", .{ea.name});
            diff_count += 1;
        }
    }
    try std.testing.expectEqual(@as(usize, 0), diff_count);

    // Spot-check the three regs we set explicitly.
    const seen_x0 = b_index.get("X0") orelse return error.MissingX0;
    try std.testing.expectEqual(@as(u64, 0xDEAD_BEEF_CAFE_BABE), std.mem.readInt(u64, seen_x0[0..8], .little));
    const seen_pc = b_index.get("PC") orelse return error.MissingPC;
    try std.testing.expectEqual(@as(u64, 0x4000_0000), std.mem.readInt(u64, seen_pc[0..8], .little));
}

test "dump/load round-trip on KVM" {
    if (builtin.os.tag != .linux) return error.SkipZigTest;

    const kvm = @import("kvm.zig");

    var k = kvm.Kvm.open_() catch return error.SkipZigTest;
    defer k.close_();

    // Helper: open KVM, create VM+vCPU, init with the preferred
    // target. Returns vcpu_fd via the kvm.Vcpu wrapper.
    const makeVcpu = struct {
        fn run(k_: *kvm.Kvm) !struct { vm: kvm.Vm, vcpu: kvm.Vcpu } {
            var vm = try k_.createVm();
            errdefer vm.destroy();
            var pref: kvm.VcpuInit = std.mem.zeroes(kvm.VcpuInit);
            const c = struct {
                extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
            };
            const PREF_TARGET: c_ulong = (2 << 30) | (@sizeOf(kvm.VcpuInit) << 16) |
                (@as(c_ulong, 0xae) << 8) | 0xaf;
            if (c.ioctl(vm.fd, PREF_TARGET, &pref) < 0) return error.PreferredTargetFailed;
            var vcpu = try vm.createVcpu(0);
            errdefer vcpu.destroy();
            try vcpu.init(pref);
            return .{ .vm = vm, .vcpu = vcpu };
        }
    }.run;

    const a = std.testing.allocator;

    // First vCPU: set X0/PC/PSTATE to recognizable values, then dump.
    var pair_a = try makeVcpu(&k);
    defer pair_a.vcpu.destroy();
    defer pair_a.vm.destroy();
    try pair_a.vcpu.setReg(kvmIdForCore(core_regs[0]), 0xDEAD_BEEF_CAFE_BABE); // X0
    try pair_a.vcpu.setReg(kvmIdForCore(core_regs[31]), 0x4000_0000); // PC
    try pair_a.vcpu.setReg(kvmIdForCore(core_regs[32]), 0x3C5); // PSTATE
    const dump_a = try dumpKvm(a, pair_a.vcpu.fd);
    defer a.free(dump_a);

    // Second vCPU: fresh init, load dump_a, then dump again.
    var pair_b = try makeVcpu(&k);
    defer pair_b.vcpu.destroy();
    defer pair_b.vm.destroy();
    try loadKvm(a, pair_b.vcpu.fd, dump_a);
    const dump_b = try dumpKvm(a, pair_b.vcpu.fd);
    defer a.free(dump_b);

    // Compare under the classification: entries that classify as
    // .mask may differ (PMU counters, debug regs); .skip never
    // appears in either dump; .portable / .translate must match.
    const entries_a = try snapshot.decodeVcpuPayload(a, dump_a);
    defer a.free(entries_a);
    const entries_b = try snapshot.decodeVcpuPayload(a, dump_b);
    defer a.free(entries_b);

    // Build a name -> value lookup for b.
    var b_index = std.StringHashMap([]const u8).init(a);
    defer b_index.deinit();
    for (entries_b) |e| try b_index.put(e.name, e.value);

    var diff_count: usize = 0;
    for (entries_a) |ea| {
        const cls = sysreg_classify.classify(ea.name);
        if (cls == .mask or cls == .skip) continue;
        const vb = b_index.get(ea.name) orelse {
            std.debug.print("missing in B: {s}\n", .{ea.name});
            diff_count += 1;
            continue;
        };
        if (!std.mem.eql(u8, ea.value, vb)) {
            std.debug.print("differs: {s}\n", .{ea.name});
            diff_count += 1;
        }
    }
    try std.testing.expectEqual(@as(usize, 0), diff_count);

    // And the three regs we explicitly set must be present and equal.
    const seen_x0 = b_index.get("X0") orelse return error.MissingX0;
    try std.testing.expectEqual(@as(u64, 0xDEAD_BEEF_CAFE_BABE), std.mem.readInt(u64, seen_x0[0..8], .little));
    const seen_pc = b_index.get("PC") orelse return error.MissingPC;
    try std.testing.expectEqual(@as(u64, 0x4000_0000), std.mem.readInt(u64, seen_pc[0..8], .little));
}

// Single-host HVF round trip across vCPU + RAM (task #33 MVP).
// Same shape as the KVM equivalent below, with HVF APIs. Apple's
// one-VM-per-process limit forces the destroy-and-recreate sequence
// instead of two VMs side-by-side.
test "single-host HVF RT (vCPU + RAM, no execution)" {
    if (builtin.os.tag != .macos) return error.SkipZigTest;
    const hvf = @import("hvf.zig");
    const ram_dump = @import("ram_dump.zig");

    const a = std.testing.allocator;
    const RAM_BASE: u64 = 0x4000_0000;
    const RAM_LEN: usize = 64 * 1024; // 64 KiB

    // Side A.
    var vm_a = try hvf.Vm.create();
    var vcpu_a = try hvf.Vcpu.create();

    // HVF needs page-aligned host memory. Allocate via posix mmap so
    // the address is page-aligned for hv_vm_map.
    const ram_a_raw = try std.posix.mmap(
        null,
        RAM_LEN,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
        -1,
        0,
    );
    defer std.posix.munmap(ram_a_raw);
    const ram_a: []align(hvf.page_size) u8 = @alignCast(ram_a_raw);
    for (ram_a, 0..) |*b, i| b.* = @intCast(i & 0xff);
    try vm_a.map(ram_a, RAM_BASE, hvf.MapFlags.rwx);

    _ = hvf_extern.hv_vcpu_set_reg(vcpu_a.handle, HV_REG_X0, 0xCAFE_F00D_1234_5678);
    _ = hvf_extern.hv_vcpu_set_reg(vcpu_a.handle, HV_REG_X0 + 1, 0x0001_0002_0003_0004);

    const cpu_payload = try dumpHvf(a, vcpu_a.handle);
    defer a.free(cpu_payload);
    const ram_payload = try ram_dump.encode(a, RAM_BASE, ram_a);
    defer a.free(ram_payload);

    vcpu_a.destroy();
    try vm_a.unmap(RAM_BASE, RAM_LEN);
    vm_a.destroy();

    // Side B.
    var vm_b = try hvf.Vm.create();
    defer vm_b.destroy();
    var vcpu_b = try hvf.Vcpu.create();
    defer vcpu_b.destroy();

    const ram_b_raw = try std.posix.mmap(
        null,
        RAM_LEN,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
        -1,
        0,
    );
    defer std.posix.munmap(ram_b_raw);
    const ram_b: []align(hvf.page_size) u8 = @alignCast(ram_b_raw);
    @memset(ram_b, 0);

    try loadHvf(a, vcpu_b.handle, cpu_payload);
    _ = try ram_dump.decodeInto(ram_payload, ram_b);
    try vm_b.map(ram_b, RAM_BASE, hvf.MapFlags.rwx);
    defer vm_b.unmap(RAM_BASE, RAM_LEN) catch {};

    try std.testing.expectEqualSlices(u8, ram_a, ram_b);
    var x0: u64 = 0;
    _ = hvf_extern.hv_vcpu_get_reg(vcpu_b.handle, HV_REG_X0, &x0);
    try std.testing.expectEqual(@as(u64, 0xCAFE_F00D_1234_5678), x0);
    var x1: u64 = 0;
    _ = hvf_extern.hv_vcpu_get_reg(vcpu_b.handle, HV_REG_X0 + 1, &x1);
    try std.testing.expectEqual(@as(u64, 0x0001_0002_0003_0004), x1);
}

// Single-host KVM round trip across vCPU + RAM (task #32 MVP). Sets
// up a small RAM region with a known pattern, captures vCPU + RAM
// into a vmstate-section payload, restores into a fresh vCPU + RAM
// buffer, asserts both match. Doesn't run the guest — that's the
// "dynamic" full integration test for later, but this proves the
// dump+load pipeline preserves both register and memory state.
test "single-host KVM RT (vCPU + RAM, no execution)" {
    if (builtin.os.tag != .linux) return error.SkipZigTest;
    const kvm = @import("kvm.zig");
    const ram_dump = @import("ram_dump.zig");

    var k = kvm.Kvm.open_() catch return error.SkipZigTest;
    defer k.close_();

    const a = std.testing.allocator;
    const RAM_BASE: u64 = 0x4000_0000;
    const RAM_LEN: usize = 64 * 1024; // 64 KiB

    // Side A: VM + vCPU with known register values; RAM filled with a
    // pattern.
    var vm_a = try k.createVm();
    defer vm_a.destroy();
    var pref: kvm.VcpuInit = std.mem.zeroes(kvm.VcpuInit);
    const c = struct {
        extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
    };
    const PREF_TARGET: c_ulong = (2 << 30) | (@sizeOf(kvm.VcpuInit) << 16) |
        (@as(c_ulong, 0xae) << 8) | 0xaf;
    if (c.ioctl(vm_a.fd, PREF_TARGET, &pref) < 0) return error.PrefTargetFailed;
    var vcpu_a = try vm_a.createVcpu(0);
    defer vcpu_a.destroy();
    try vcpu_a.init(pref);

    try vcpu_a.setReg(kvmIdForCore(core_regs[0]), 0xCAFE_F00D_1234_5678);
    try vcpu_a.setReg(kvmIdForCore(core_regs[1]), 0x0001_0002_0003_0004);

    const ram_a = try a.alloc(u8, RAM_LEN);
    defer a.free(ram_a);
    for (ram_a, 0..) |*b, i| b.* = @intCast(i & 0xff);

    const cpu_payload = try dumpKvm(a, vcpu_a.fd);
    defer a.free(cpu_payload);
    const ram_payload = try ram_dump.encode(a, RAM_BASE, ram_a);
    defer a.free(ram_payload);

    // Side B: fresh VM + vCPU, fresh RAM (zeroed).
    var vm_b = try k.createVm();
    defer vm_b.destroy();
    if (c.ioctl(vm_b.fd, PREF_TARGET, &pref) < 0) return error.PrefTargetFailed;
    var vcpu_b = try vm_b.createVcpu(0);
    defer vcpu_b.destroy();
    try vcpu_b.init(pref);

    const ram_b = try a.alloc(u8, RAM_LEN);
    defer a.free(ram_b);
    @memset(ram_b, 0);

    try loadKvm(a, vcpu_b.fd, cpu_payload);
    const decoded = try ram_dump.decodeInto(ram_payload, ram_b);
    try std.testing.expectEqual(@as(u64, RAM_BASE), decoded.ram_base);
    try std.testing.expectEqual(@as(u64, RAM_LEN), decoded.ram_size);

    // Verify side B matches side A.
    try std.testing.expectEqualSlices(u8, ram_a, ram_b);
    const x0 = try vcpu_b.getReg(kvmIdForCore(core_regs[0]));
    try std.testing.expectEqual(@as(u64, 0xCAFE_F00D_1234_5678), x0);
    const x1 = try vcpu_b.getReg(kvmIdForCore(core_regs[1]));
    try std.testing.expectEqual(@as(u64, 0x0001_0002_0003_0004), x1);
}
