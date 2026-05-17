//! Hypervisor.framework bindings. See .docs/learnings/microvm/hvf.md.
//!
//! macOS-only. Importing on other OSes produces a compile error.

const std = @import("std");
const builtin = @import("builtin");
const pl011_mod = @import("pl011.zig");

const assert = std.debug.assert;

comptime {
    if (builtin.os.tag != .macos) {
        @compileError("hvf.zig only builds on macOS");
    }
}

// Re-export the pure-Zig PL011 model so existing hvf.Pl011 /
// hvf.PthreadMutex callers stay green. The code lives in pl011.zig
// so boot_kvm.zig (Linux) can reuse it.
pub const Pl011 = pl011_mod.Pl011;
pub const PthreadMutex = pl011_mod.PthreadMutex;

// Cherry-pick headers — the umbrella Hypervisor.h pulls in
// hv_vcpu_config.h, which has a `uint64_t values[_Nonnull 8]`
// declaration that Zig's translate-c can't parse. We pull what cImport
// handles cleanly (VM lifecycle + memory map + error codes) and declare
// the vCPU surface manually below.
pub const c = @cImport({
    @cInclude("Hypervisor/hv_error.h");
    @cInclude("Hypervisor/hv_vm.h");
});

pub const Error = error{
    Denied, // missing com.apple.security.hypervisor entitlement
    Busy,
    BadArgument,
    IllegalGuestState,
    NoResources,
    NoDevice,
    Unsupported,
    Unknown,
};

fn check(ret: c.hv_return_t) Error!void {
    if (ret == c.HV_SUCCESS) return;
    return switch (ret) {
        c.HV_ERROR => error.Unknown,
        c.HV_BUSY => error.Busy,
        c.HV_BAD_ARGUMENT => error.BadArgument,
        c.HV_ILLEGAL_GUEST_STATE => error.IllegalGuestState,
        c.HV_NO_RESOURCES => error.NoResources,
        c.HV_NO_DEVICE => error.NoDevice,
        c.HV_DENIED => error.Denied,
        c.HV_UNSUPPORTED => error.Unsupported,
        else => error.Unknown,
    };
}

/// Process-wide VM context. HVF currently supports one VM per process.
pub const Vm = struct {
    pub fn create() Error!Vm {
        try check(c.hv_vm_create(null));
        return .{};
    }

    pub fn destroy(_: Vm) void {
        _ = c.hv_vm_destroy();
    }

    /// Map host memory into the guest's physical address space.
    pub fn map(_: Vm, host_mem: []align(page_size) u8, guest_phys: u64, flags: MapFlags) Error!void {
        // HVF requires page-aligned, page-sized regions. Host pointer
        // alignment is enforced by the slice type; guest_phys + size
        // alignment are runtime invariants.
        assert(host_mem.len > 0);
        assert(host_mem.len % page_size == 0);
        assert(guest_phys % page_size == 0);
        // Mapping an unreadable page is a programmer bug — the guest
        // would trap on the first fetch with no useful diagnostic.
        assert(flags.read or flags.write or flags.exec);
        try check(c.hv_vm_map(host_mem.ptr, guest_phys, host_mem.len, flags.bits()));
    }

    pub fn unmap(_: Vm, guest_phys: u64, size: usize) Error!void {
        assert(size > 0);
        assert(size % page_size == 0);
        assert(guest_phys % page_size == 0);
        try check(c.hv_vm_unmap(guest_phys, size));
    }

    pub fn protect(_: Vm, guest_phys: u64, size: usize, flags: MapFlags) Error!void {
        assert(size > 0);
        assert(size % page_size == 0);
        assert(guest_phys % page_size == 0);
        assert(flags.read or flags.write or flags.exec);
        try check(c.hv_vm_protect(guest_phys, size, flags.bits()));
    }
};

pub const page_size = 0x4000; // 16 KiB pages on Apple Silicon arm64

comptime {
    // Apple Silicon arm64 mandates 16 KiB pages — anything else
    // means the wrong target was selected for this build.
    assert(page_size == 0x4000);

    // HVF ABI struct layouts. ExitReason is u32 then ExitException
    // (24 B, 8-aligned) → 4 B padding → total 32 B for VcpuExit.
    assert(@sizeOf(ExitException) == 24);
    assert(@offsetOf(ExitException, "syndrome") == 0);
    assert(@offsetOf(ExitException, "virtual_address") == 8);
    assert(@offsetOf(ExitException, "physical_address") == 16);
    assert(@sizeOf(VcpuExit) == 32);
    assert(@offsetOf(VcpuExit, "reason") == 0);
    assert(@offsetOf(VcpuExit, "exception") == 8);

    // Reg enum tags must match hv_reg_t values (X0..X30 contiguous,
    // then PC=31, FPCR=32, FPSR=33, CPSR=34).
    assert(@intFromEnum(Reg.x0) == 0);
    assert(@intFromEnum(Reg.x30) == 30);
    assert(@intFromEnum(Reg.pc) == 31);
    assert(@intFromEnum(Reg.cpsr) == 34);

    // ExceptionClass: top 6 bits of ESR_EL2.
    assert(@intFromEnum(ExceptionClass.trapped_wfx) == 0x01);
    assert(@intFromEnum(ExceptionClass.hvc_aarch64) == 0x16);
    assert(@intFromEnum(ExceptionClass.system_register) == 0x18);
    assert(@intFromEnum(ExceptionClass.data_abort_lower_el) == 0x24);
    assert(@intFromEnum(ExceptionClass.brk_aarch64) == 0x3C);

    // PSCI v1.1 function IDs (ARM DEN 0022).
    assert(@intFromEnum(Psci.Function.version) == 0x84000000);
    assert(@intFromEnum(Psci.Function.system_off) == 0x84000008);
    assert(@intFromEnum(Psci.Function.system_reset) == 0x84000009);
    // SMC64 entry points have the top nibble flipped from 0x8 to 0xC.
    assert(@intFromEnum(Psci.Function.cpu_on_64) == 0xC4000003);
}

pub const MapFlags = packed struct {
    read: bool = false,
    write: bool = false,
    exec: bool = false,

    pub const rwx: MapFlags = .{ .read = true, .write = true, .exec = true };
    pub const rx: MapFlags = .{ .read = true, .exec = true };

    pub fn bits(self: MapFlags) c.hv_memory_flags_t {
        var v: c.hv_memory_flags_t = 0;
        if (self.read) v |= c.HV_MEMORY_READ;
        if (self.write) v |= c.HV_MEMORY_WRITE;
        if (self.exec) v |= c.HV_MEMORY_EXEC;
        return v;
    }
};

// =============================================================
// vCPU surface — declared by hand because hv_vcpu_config.h can't
// be cImported (see note at top of file).
// =============================================================

/// arm64 general-purpose and system register selectors. Matches
/// the hv_reg_t enum in Hypervisor/hv_vcpu_types.h (arm64 build).
pub const Reg = enum(u32) {
    x0 = 0,
    x1,
    x2,
    x3,
    x4,
    x5,
    x6,
    x7,
    x8,
    x9,
    x10,
    x11,
    x12,
    x13,
    x14,
    x15,
    x16,
    x17,
    x18,
    x19,
    x20,
    x21,
    x22,
    x23,
    x24,
    x25,
    x26,
    x27,
    x28,
    x29,
    x30,
    pc,
    fpcr,
    fpsr,
    cpsr,
};

/// hv_exit_reason_t — see Hypervisor/hv_vcpu_types.h.
pub const ExitReason = enum(u32) {
    canceled = 0,
    exception = 1,
    vtimer_activated = 2,
    unknown = 3,
    _,
};

/// hv_vcpu_exit_exception_t
pub const ExitException = extern struct {
    syndrome: u64,
    virtual_address: u64,
    physical_address: u64,
};

/// hv_vcpu_exit_t
pub const VcpuExit = extern struct {
    reason: ExitReason,
    exception: ExitException,
};

extern "c" fn hv_vcpu_create(vcpu: *u64, exit: **VcpuExit, config: ?*anyopaque) c.hv_return_t;
extern "c" fn hv_vcpu_destroy(vcpu: u64) c.hv_return_t;
extern "c" fn hv_vcpu_run(vcpu: u64) c.hv_return_t;
extern "c" fn hv_vcpu_get_reg(vcpu: u64, reg: u32, value: *u64) c.hv_return_t;
extern "c" fn hv_vcpu_set_reg(vcpu: u64, reg: u32, value: u64) c.hv_return_t;
extern "c" fn hv_vcpu_get_sys_reg(vcpu: u64, reg: u32, value: *u64) c.hv_return_t;
extern "c" fn hv_vcpu_set_sys_reg(vcpu: u64, reg: u32, value: u64) c.hv_return_t;
extern "c" fn hv_vcpu_set_vtimer_mask(vcpu: u64, vtimer_is_masked: bool) c.hv_return_t;

// GIC v3 (available on macOS 13+). Opaque config objects are treated
// as ?*anyopaque. See Hypervisor/hv_gic.h.
extern "c" fn hv_gic_config_create() ?*anyopaque;
extern "c" fn hv_gic_config_set_distributor_base(config: ?*anyopaque, addr: u64) c.hv_return_t;
extern "c" fn hv_gic_config_set_redistributor_base(config: ?*anyopaque, addr: u64) c.hv_return_t;
extern "c" fn hv_gic_create(config: ?*anyopaque) c.hv_return_t;
extern "c" fn hv_gic_get_distributor_base_alignment(alignment: *usize) c.hv_return_t;
extern "c" fn hv_gic_get_redistributor_base_alignment(alignment: *usize) c.hv_return_t;
extern "c" fn hv_gic_get_redistributor_base(vcpu: u64, base: *u64) c.hv_return_t;
extern "c" fn hv_gic_get_distributor_size(size: *usize) c.hv_return_t;
extern "c" fn hv_gic_get_redistributor_size(size: *usize) c.hv_return_t;
extern "c" fn hv_gic_get_redistributor_region_size(size: *usize) c.hv_return_t;
extern "c" fn hv_gic_get_distributor_reg(reg: u32, value: *u64) c.hv_return_t;
extern "c" fn hv_gic_set_distributor_reg(reg: u32, value: u64) c.hv_return_t;
extern "c" fn hv_gic_get_redistributor_reg(vcpu: u64, reg: u32, value: *u64) c.hv_return_t;
extern "c" fn hv_gic_set_redistributor_reg(vcpu: u64, reg: u32, value: u64) c.hv_return_t;
extern "c" fn hv_gic_get_icc_reg(vcpu: u64, reg: u32, value: *u64) c.hv_return_t;
extern "c" fn hv_gic_set_icc_reg(vcpu: u64, reg: u32, value: u64) c.hv_return_t;
extern "c" fn hv_gic_set_spi(intid: u32, level: bool) c.hv_return_t;
extern "c" fn hv_gic_get_spi_interrupt_range(base: *u32, count: *u32) c.hv_return_t;

/// In-kernel GIC v3 emulation exposed by HVF. Must be created after
/// the VM exists but before the first vCPU runs.
pub const Gic = struct {
    pub const Config = struct {
        distributor_base: u64 = 0x0800_0000,
        // HVF's redistributor region wants 32 MB even for one vCPU.
        // QEMU's default virt layout only reserves 15.4 MB at
        // 0x080A_0000, so we place ours at 0x1000_0000 (below the
        // 0x4000_0000 RAM base, nothing else in the way) and use a
        // matching custom device tree (test-fixtures/virt.dtb).
        redistributor_base: u64 = 0x1000_0000,
    };

    pub fn enable(cfg: Config) Error!void {
        // Distributor and redistributor MMIO windows must be distinct
        // and non-zero; placing them at the same address silently
        // breaks GIC routing.
        assert(cfg.distributor_base != 0);
        assert(cfg.redistributor_base != 0);
        assert(cfg.distributor_base != cfg.redistributor_base);
        const config = hv_gic_config_create() orelse return error.NoResources;
        try check(hv_gic_config_set_distributor_base(config, cfg.distributor_base));
        try check(hv_gic_config_set_redistributor_base(config, cfg.redistributor_base));
        try check(hv_gic_create(config));
    }

    pub fn distributorAlignment() Error!usize {
        var a: usize = 0;
        try check(hv_gic_get_distributor_base_alignment(&a));
        return a;
    }

    pub fn redistributorAlignment() Error!usize {
        var a: usize = 0;
        try check(hv_gic_get_redistributor_base_alignment(&a));
        return a;
    }

    pub fn redistributorBase(vcpu: Vcpu) Error!u64 {
        var b: u64 = 0;
        try check(hv_gic_get_redistributor_base(vcpu.handle, &b));
        assert(b != 0);
        return b;
    }

    pub fn distributorSize() Error!usize {
        var s: usize = 0;
        try check(hv_gic_get_distributor_size(&s));
        return s;
    }

    pub fn redistributorSize() Error!usize {
        var s: usize = 0;
        try check(hv_gic_get_redistributor_size(&s));
        return s;
    }

    pub fn redistributorRegionSize() Error!usize {
        var s: usize = 0;
        try check(hv_gic_get_redistributor_region_size(&s));
        return s;
    }

    /// Read a distributor register (offset within the distributor MMIO).
    /// Returns 0 if HVF doesn't recognize the offset — common for
    /// reserved or vendor-specific areas; matches GIC "read as zero"
    /// semantics.
    pub fn readDistributor(offset: u32) u64 {
        var v: u64 = 0;
        _ = hv_gic_get_distributor_reg(offset, &v);
        return v;
    }

    pub fn writeDistributor(offset: u32, value: u64) void {
        _ = hv_gic_set_distributor_reg(offset, value);
    }

    pub fn readRedistributor(vcpu: Vcpu, offset: u32) u64 {
        var v: u64 = 0;
        _ = hv_gic_get_redistributor_reg(vcpu.handle, offset, &v);
        return v;
    }

    pub fn writeRedistributor(vcpu: Vcpu, offset: u32, value: u64) void {
        _ = hv_gic_set_redistributor_reg(vcpu.handle, offset, value);
    }

    /// True when `encoding` is one of the ICC CPU-interface registers
    /// Apple exposes through hv_gic_{get,set}_icc_reg. Values are the
    /// standard arm64 op0/op1/CRn/CRm/op2 packing used by hv_sys_reg_t.
    pub fn isIccReg(encoding: u16) bool {
        return switch (encoding) {
            0xC230, // ICC_PMR_EL1
            0xC643, // ICC_BPR0_EL1
            0xC644, // ICC_AP0R0_EL1
            0xC648, // ICC_AP1R0_EL1
            0xC65B, // ICC_RPR_EL1
            0xC663, // ICC_BPR1_EL1
            0xC664, // ICC_CTLR_EL1
            0xC665, // ICC_SRE_EL1
            0xC666, // ICC_IGRPEN0_EL1
            0xC667, // ICC_IGRPEN1_EL1
            0xE64D, // ICC_SRE_EL2
            => true,
            else => false,
        };
    }

    pub fn readIcc(vcpu: Vcpu, encoding: u16) Error!u64 {
        assert(isIccReg(encoding));
        var v: u64 = 0;
        try check(hv_gic_get_icc_reg(vcpu.handle, encoding, &v));
        return v;
    }

    pub fn writeIcc(vcpu: Vcpu, encoding: u16, value: u64) Error!void {
        assert(isIccReg(encoding));
        try check(hv_gic_set_icc_reg(vcpu.handle, encoding, value));
    }

    /// Set the level (asserted/deasserted) of a shared peripheral
    /// interrupt. `intid` is the GIC-absolute id (SPIs start at 32
    /// on ARM GIC; the DTS number is 0-based within SPIs, so for a
    /// device that says `interrupts = <0 1 4>` call with intid = 33).
    pub fn setSpi(intid: u32, level: bool) Error!void {
        // SPIs start at 32 on ARM GIC; values below that hit SGI/PPI
        // ranges and silently drop on hv_gic_set_spi.
        assert(intid >= 32);
        // GICv3 caps SPI INTID at 1019 (hardware-defined).
        assert(intid <= 1019);
        try check(hv_gic_set_spi(intid, level));
    }

    /// Returns (base_intid, count) — the absolute GIC ID range of SPIs.
    pub fn spiRange() Error!struct { base: u32, count: u32 } {
        var base: u32 = 0;
        var count: u32 = 0;
        try check(hv_gic_get_spi_interrupt_range(&base, &count));
        return .{ .base = base, .count = count };
    }
};

/// System register selectors. Matches hv_sys_reg_t in hv_vcpu_types.h.
/// Only the handful we need.
pub const SysReg = enum(u32) {
    // Encoding for hv_sys_reg_t follows arm64 op0/op1/CRn/CRm/op2 packing.
    // MPIDR_EL1 — must be set BEFORE the first vcpu run, otherwise
    // Apple's GIC won't bind this vCPU to a redistributor frame and
    // later `hv_gic_*_redistributor_reg` calls return HV_DENIED.
    mpidr_el1 = 0xC005,
    sctlr_el1 = 0xC080,
};

/// arm64 vCPU wrapper. Must be created from the thread that will run it.
pub const Vcpu = struct {
    handle: u64,
    exit: *VcpuExit,

    pub fn create() Error!Vcpu {
        var handle: u64 = 0;
        var exit_ptr: *VcpuExit = undefined;
        try check(hv_vcpu_create(&handle, &exit_ptr, null));
        return .{ .handle = handle, .exit = exit_ptr };
    }

    pub fn destroy(self: Vcpu) void {
        _ = hv_vcpu_destroy(self.handle);
    }

    pub fn setReg(self: Vcpu, reg: Reg, value: u64) Error!void {
        try check(hv_vcpu_set_reg(self.handle, @intFromEnum(reg), value));
    }

    pub fn getReg(self: Vcpu, reg: Reg) Error!u64 {
        var value: u64 = 0;
        try check(hv_vcpu_get_reg(self.handle, @intFromEnum(reg), &value));
        return value;
    }

    pub fn setSysReg(self: Vcpu, reg: SysReg, value: u64) Error!void {
        try check(hv_vcpu_set_sys_reg(self.handle, @intFromEnum(reg), value));
    }

    pub fn getSysReg(self: Vcpu, reg: SysReg) Error!u64 {
        var value: u64 = 0;
        try check(hv_vcpu_get_sys_reg(self.handle, @intFromEnum(reg), &value));
        return value;
    }

    pub fn setRawSysReg(self: Vcpu, encoding: u16, value: u64) Error!void {
        try check(hv_vcpu_set_sys_reg(self.handle, encoding, value));
    }

    pub fn getRawSysReg(self: Vcpu, encoding: u16) Error!u64 {
        var value: u64 = 0;
        try check(hv_vcpu_get_sys_reg(self.handle, encoding, &value));
        return value;
    }

    pub fn run(self: Vcpu) Error!void {
        try check(hv_vcpu_run(self.handle));
    }

    /// Control whether the virtual timer's expiry wakes the vCPU. Mask
    /// it (true) to let the guest run with the timer disabled; unmask
    /// (false) before running so an expired timer triggers a
    /// vtimer_activated exit.
    pub fn setVtimerMask(self: Vcpu, masked: bool) Error!void {
        try check(hv_vcpu_set_vtimer_mask(self.handle, masked));
    }
};

/// ARMv8 exception class — top 6 bits of ESR_EL2 (what HVF delivers).
/// See Arm ARM D17.2.41 ("Exception class"). Most minimal-VMM flows
/// exit via HVC (trapped directly to EL2) rather than BRK (which stays
/// at EL1 and needs a vector table set up).
pub const ExceptionClass = enum(u6) {
    trapped_wfx = 0x01,
    hvc_aarch64 = 0x16,
    system_register = 0x18,
    data_abort_lower_el = 0x24,
    brk_aarch64 = 0x3C,
    _,

    pub fn fromSyndrome(syndrome: u64) ExceptionClass {
        return @enumFromInt(@as(u6, @truncate(syndrome >> 26)));
    }
};

/// Decoded trapped WFI/WFE info. Valid when ExceptionClass ==
/// .trapped_wfx. ISS bit 0 is TI: 0 = WFI, 1 = WFE.
pub const WaitTrap = struct {
    instruction: enum { wfi, wfe },

    pub fn decode(ex: ExitException) WaitTrap {
        return .{ .instruction = if ((ex.syndrome & 1) == 0) .wfi else .wfe };
    }
};

/// Decoded AArch64 system-register trap. Valid when ExceptionClass ==
/// .system_register for MRS/MSR traps. `encoding` is the same 16-bit
/// op0/op1/CRn/CRm/op2 packing HVF and KVM use everywhere else.
pub fn isDebugSysReg(encoding: u16) bool {
    // AArch64 debug register bank (DBGBVR/DBGBCR/DBGWVR/DBGWCR,
    // MDSCR/MDCCINT, and future breakpoint/watchpoint slots). Apple
    // SDKs currently name only slots 0..15, but M4/Tahoe can expose
    // more slots to Linux and trap writes such as DBGBVR19_EL1
    // (S2_0_C1_C3_4 = 0x809c). We do not virtualize guest hardware
    // debug state, so unsupported debug regs are safe to read-as-zero
    // and ignore-on-write.
    return encoding >= 0x8000 and encoding <= 0x80ff;
}

pub fn shouldIgnoreUnsupportedSysRegWrite(encoding: u16, value: u64) bool {
    // Linux commonly clears optional CPU state by writing xzr / 0.
    // If a future Apple CPU exposes a new optional register before
    // HVF exposes it, dropping that zero-write is safer than killing
    // the VM during early boot. Non-zero writes still fail unless the
    // register class is explicitly RAZ/WI-safe (debug regs above).
    return value == 0 or isDebugSysReg(encoding);
}

pub const SysRegTrap = struct {
    is_read: bool, // true = MRS (sysreg -> Rt), false = MSR (Rt -> sysreg)
    rt: u5,
    encoding: u16,

    pub fn decode(ex: ExitException) SysRegTrap {
        const iss: u32 = @truncate(ex.syndrome);
        const op0: u16 = @truncate((iss >> 20) & 0b11);
        const op1: u16 = @truncate((iss >> 14) & 0b111);
        const crn: u16 = @truncate((iss >> 10) & 0b1111);
        const crm: u16 = @truncate((iss >> 1) & 0b1111);
        const op2: u16 = @truncate((iss >> 17) & 0b111);
        return .{
            .is_read = (iss & 1) != 0,
            .rt = @truncate((iss >> 5) & 0b11111),
            .encoding = (op0 << 14) | (op1 << 11) | (crn << 7) | (crm << 3) | op2,
        };
    }

    pub fn readSource(self: SysRegTrap, vcpu: Vcpu) Error!u64 {
        assert(!self.is_read);
        assert(self.rt <= 31);
        if (self.rt == 31) return 0; // XZR
        const reg: Reg = @enumFromInt(@as(u32, self.rt));
        return vcpu.getReg(reg);
    }

    pub fn writeTarget(self: SysRegTrap, vcpu: Vcpu, value: u64) Error!void {
        assert(self.is_read);
        assert(self.rt <= 31);
        if (self.rt == 31) return; // XZR
        const reg: Reg = @enumFromInt(@as(u32, self.rt));
        try vcpu.setReg(reg, value);
    }
};

/// Decoded load/store info when the guest faults reaching unmapped memory.
/// Valid when ExceptionClass == .data_abort_lower_el and isv is true.
pub const DataAbort = struct {
    is_write: bool,
    sas: u2, // access size: 0=byte, 1=half, 2=word, 3=dword
    srt: u5, // source/target register number (0..30 = Xn, 31 = XZR)
    sf: bool, // true if 64-bit register operand
    isv: bool, // true when sas/srt/sf are meaningful
    ipa: u64, // guest-physical address that was touched

    pub fn decode(ex: ExitException) DataAbort {
        const iss: u32 = @truncate(ex.syndrome);
        return .{
            .isv = (iss & (1 << 24)) != 0,
            .sas = @truncate((iss >> 22) & 0b11),
            .srt = @truncate((iss >> 16) & 0b11111),
            .sf = (iss & (1 << 15)) != 0,
            .is_write = (iss & (1 << 6)) != 0,
            .ipa = ex.physical_address,
        };
    }

    /// Read the guest register holding the value the guest was storing.
    /// XZR reads as 0. Out-of-range is a bug.
    pub fn readSource(self: DataAbort, vcpu: Vcpu) Error!u64 {
        // Only meaningful when the syndrome decoded a load/store
        // operand; otherwise srt is whatever bits happened to land.
        assert(self.isv);
        assert(self.srt <= 31);
        if (self.srt == 31) return 0; // XZR
        const reg: Reg = @enumFromInt(@as(u32, self.srt));
        return vcpu.getReg(reg);
    }
};

// =============================================================
// arm64 Linux kernel Image header
// =============================================================

/// The first 64 bytes of an arm64 `Image` file, per
/// arch/arm64/include/asm/image.h. See
/// .docs/learnings/microvm/arm64-linux-boot.md.
pub const KernelImage = struct {
    /// Offset from the base of RAM where the kernel wants to be loaded.
    text_offset: u64,
    /// How many bytes of RAM the kernel reserves (can exceed file size).
    image_size: u64,
    /// The raw bytes (whole Image file; caller owns the memory).
    bytes: []const u8,

    pub const magic: u32 = 0x644D5241; // "ARM\x64"

    pub const Error = error{ TooSmall, BadMagic };

    /// Parse the header. `bytes` is the entire kernel Image file.
    pub fn parse(bytes: []const u8) KernelImage.Error!KernelImage {
        assert(bytes.len > 0);
        if (bytes.len < 64) return error.TooSmall;
        assert(bytes.len >= 0x40);
        const got_magic = std.mem.readInt(u32, bytes[0x38..0x3C], .little);
        if (got_magic != magic) return error.BadMagic;
        const text_offset = std.mem.readInt(u64, bytes[0x08..0x10], .little);
        const image_size = std.mem.readInt(u64, bytes[0x10..0x18], .little);
        return .{
            .text_offset = text_offset,
            .image_size = image_size,
            .bytes = bytes,
        };
    }
};

// =============================================================
// PSCI — the one kernel-to-hypervisor call we have to understand
// =============================================================

/// PSCI function IDs the kernel uses via HVC #0. IDs per PSCI v1.1 spec
/// (ARM DEN 0022). Top bit of the ID distinguishes SMC32 (0x8-) from
/// SMC64 (0xC-). We handle the ones a Linux boot actually touches.
pub const Psci = struct {
    pub const Function = enum(u32) {
        version = 0x84000000,
        cpu_off = 0x84000002,
        cpu_on_64 = 0xC4000003,
        affinity_info_64 = 0xC4000004,
        migrate_info_type = 0x84000006,
        system_off = 0x84000008,
        system_reset = 0x84000009,
        features = 0x8400000A,
        _,
    };

    /// When the vCPU exits with EC=HVC, the requested function ID
    /// is in X0. Returns null if it isn't a PSCI-shaped HVC.
    pub fn decode(vcpu: Vcpu) Error!?Function {
        const x0 = try vcpu.getReg(.x0);
        const f: Function = @enumFromInt(@as(u32, @truncate(x0)));
        return switch (f) {
            .version,
            .cpu_off,
            .cpu_on_64,
            .affinity_info_64,
            .migrate_info_type,
            .system_off,
            .system_reset,
            .features,
            => f,
            _ => null,
        };
    }
};

// =============================================================
// Tests
// =============================================================

test "decode WFI/WFE traps" {
    const wfi: ExitException = .{
        .syndrome = (@as(u64, @intFromEnum(ExceptionClass.trapped_wfx)) << 26),
        .virtual_address = 0,
        .physical_address = 0,
    };
    try std.testing.expectEqual(.wfi, WaitTrap.decode(wfi).instruction);

    const wfe: ExitException = .{
        .syndrome = (@as(u64, @intFromEnum(ExceptionClass.trapped_wfx)) << 26) | 1,
        .virtual_address = 0,
        .physical_address = 0,
    };
    try std.testing.expectEqual(.wfe, WaitTrap.decode(wfe).instruction);
}

test "decode system register traps to HVF encoding" {
    // ICC_SRE_EL1 = S3_0_C12_C12_5 = 0xC665 in HVF/KVM encoding.
    const iss: u64 = (@as(u64, 3) << 20) | (@as(u64, 0) << 14) | (@as(u64, 12) << 10) |
        (@as(u64, 12) << 1) | (@as(u64, 5) << 17) | (@as(u64, 2) << 5) | 1;
    const ex: ExitException = .{
        .syndrome = (@as(u64, @intFromEnum(ExceptionClass.system_register)) << 26) | iss,
        .virtual_address = 0,
        .physical_address = 0,
    };
    const trap = SysRegTrap.decode(ex);
    try std.testing.expect(trap.is_read);
    try std.testing.expectEqual(@as(u5, 2), trap.rt);
    try std.testing.expectEqual(@as(u16, 0xC665), trap.encoding);
}

test "debug sysreg classifier includes Tahoe/M4 high breakpoint slots" {
    try std.testing.expect(isDebugSysReg(0x8004)); // DBGBVR0_EL1
    try std.testing.expect(isDebugSysReg(0x809c)); // DBGBVR19_EL1 on M4/Tahoe
    try std.testing.expect(!isDebugSysReg(0xC665)); // ICC_SRE_EL1
}

test "unsupported sysreg write policy ignores zero writes" {
    try std.testing.expect(shouldIgnoreUnsupportedSysRegWrite(0x809c, 0x1234)); // debug reg
    try std.testing.expect(shouldIgnoreUnsupportedSysRegWrite(0xD123, 0)); // clear unknown optional state
    try std.testing.expect(!shouldIgnoreUnsupportedSysRegWrite(0xD123, 1)); // non-zero unknown state
}

test "hv_vm_create and destroy" {
    const vm = Vm.create() catch |err| switch (err) {
        error.Denied => {
            std.debug.print(
                "hv_vm_create: HV_DENIED — expected without entitlement\n",
                .{},
            );
            return;
        },
        else => return err,
    };
    defer vm.destroy();
    std.debug.print("hv_vm_create: HV_SUCCESS (entitled)\n", .{});
}

test "map a page, run hvc #0, observe exception exit" {
    const vm = Vm.create() catch |err| switch (err) {
        error.Denied => {
            std.debug.print("skip: HV_DENIED\n", .{});
            return;
        },
        else => return err,
    };
    defer vm.destroy();

    // Allocate one page of host memory. We only need RW from the host
    // side — the host writes the instruction; the guest is what needs
    // to execute it, and that's controlled by the hv_vm_map flags below.
    // macOS refuses anonymous PROT_EXEC without a JIT entitlement anyway.
    const host_mem = try std.posix.mmap(
        null,
        page_size,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
        -1,
        0,
    );
    defer std.posix.munmap(host_mem);

    // Plant a single instruction: `hvc #0` = 0xD4000002. HVC from EL1
    // traps directly to EL2 (HVF), so the host sees a clean exit with
    // EC=0x16. BRK would stay at EL1 and require a vector table.
    const hvc0_instr: u32 = 0xD4000002;
    @as(*align(4) u32, @ptrCast(@alignCast(host_mem.ptr))).* = hvc0_instr;

    // Map at a typical arm64 RAM base address.
    const guest_base: u64 = 0x40000000;
    try vm.map(host_mem, guest_base, MapFlags.rx);
    defer vm.unmap(guest_base, page_size) catch {};

    const vcpu = try Vcpu.create();
    defer vcpu.destroy();

    // Put the vCPU in EL1h with all interrupts masked:
    //   M[3:0]=0101 (EL1h), F=I=A=D=1 → CPSR = 0x3C5.
    // HVF's default CPSR on arm64 starts the vCPU at EL0, so an
    // instruction fetch at guest_base would fault (IA from lower EL,
    // EC=0x20) before reaching our BRK.
    try vcpu.setReg(.cpsr, 0x3C5);

    // Configure SCTLR_EL1:
    //   M (bit 0)  = 0 — MMU disabled, VA = PA
    //   I (bit 12) = 1 — instruction cache (and, critically, normal
    //                    memory type for instruction fetches when the
    //                    MMU is off; otherwise fetches are Device and
    //                    non-executable).
    try vcpu.setSysReg(.sctlr_el1, 1 << 12);

    // Point the vCPU at our instruction.
    try vcpu.setReg(.pc, guest_base);

    // Run. The vCPU exits immediately after executing HVC.
    try vcpu.run();

    // Expected exit: exception reason, EC=0x16 (HVC), PC advanced by 4.
    try std.testing.expectEqual(ExitReason.exception, vcpu.exit.reason);
    const ec = ExceptionClass.fromSyndrome(vcpu.exit.exception.syndrome);
    try std.testing.expectEqual(ExceptionClass.hvc_aarch64, ec);
    try std.testing.expectEqual(@as(u64, guest_base + 4), try vcpu.getReg(.pc));

    std.debug.print(
        "hvc #0 exit: EC=0x{x:0>2} (HVC), pc=0x{x} (advanced past instr)\n",
        .{ @intFromEnum(ec), try vcpu.getReg(.pc) },
    );
}

test "run a small program and read register state" {
    const vm = Vm.create() catch |err| switch (err) {
        error.Denied => {
            std.debug.print("skip: HV_DENIED\n", .{});
            return;
        },
        else => return err,
    };
    defer vm.destroy();

    const host_mem = try std.posix.mmap(
        null,
        page_size,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
        -1,
        0,
    );
    defer std.posix.munmap(host_mem);

    // Three-instruction program:
    //   movz x0, #42    ; x0 = 42
    //   movz x1, #99    ; x1 = 99
    //   hvc  #0         ; exit to host
    const program = [_]u32{
        0xD2800540, // movz x0, #42
        0xD2800C61, // movz x1, #99
        0xD4000002, // hvc  #0
    };
    const program_bytes = std.mem.sliceAsBytes(program[0..]);
    @memcpy(host_mem[0..program_bytes.len], program_bytes);

    const guest_base: u64 = 0x40000000;
    try vm.map(host_mem, guest_base, MapFlags.rx);
    defer vm.unmap(guest_base, page_size) catch {};

    const vcpu = try Vcpu.create();
    defer vcpu.destroy();

    try vcpu.setReg(.cpsr, 0x3C5);
    try vcpu.setSysReg(.sctlr_el1, 1 << 12);
    try vcpu.setReg(.pc, guest_base);

    try vcpu.run();

    // Check the vCPU ran all three instructions:
    // - exit reason is exception via HVC
    // - pc advanced past the HVC (guest_base + 12)
    // - x0 == 42, x1 == 99
    try std.testing.expectEqual(ExitReason.exception, vcpu.exit.reason);
    try std.testing.expectEqual(
        ExceptionClass.hvc_aarch64,
        ExceptionClass.fromSyndrome(vcpu.exit.exception.syndrome),
    );
    try std.testing.expectEqual(@as(u64, guest_base + 12), try vcpu.getReg(.pc));
    try std.testing.expectEqual(@as(u64, 42), try vcpu.getReg(.x0));
    try std.testing.expectEqual(@as(u64, 99), try vcpu.getReg(.x1));

    std.debug.print(
        "3-instr program: x0=42 x1=99 pc=0x{x}\n",
        .{try vcpu.getReg(.pc)},
    );
}

test "catch guest store to unmapped MMIO address" {
    const vm = Vm.create() catch |err| switch (err) {
        error.Denied => {
            std.debug.print("skip: HV_DENIED\n", .{});
            return;
        },
        else => return err,
    };
    defer vm.destroy();

    const host_mem = try std.posix.mmap(
        null,
        page_size,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
        -1,
        0,
    );
    defer std.posix.munmap(host_mem);

    // Guest program: write 0xABCD to MMIO 0x09000000 (unmapped), then exit.
    //   movz x2, #0x0900, lsl #16   ; x2 = 0x09000000
    //   movz x3, #0xABCD            ; x3 = 0xABCD
    //   str  x3, [x2]               ; *(u64*)0x09000000 = 0xABCD  <-- traps
    //   hvc  #0                     ; exit
    const program = [_]u32{
        0xD2A12002,
        0xD29579A3,
        0xF9000043,
        0xD4000002,
    };
    const program_bytes = std.mem.sliceAsBytes(program[0..]);
    @memcpy(host_mem[0..program_bytes.len], program_bytes);

    // Map the code at guest_base. Note we do NOT map anything at the
    // MMIO base (0x09000000) — that's what makes the store trap.
    const guest_base: u64 = 0x40000000;
    const mmio_base: u64 = 0x09000000;
    try vm.map(host_mem, guest_base, MapFlags.rx);
    defer vm.unmap(guest_base, page_size) catch {};

    const vcpu = try Vcpu.create();
    defer vcpu.destroy();

    try vcpu.setReg(.cpsr, 0x3C5);
    try vcpu.setSysReg(.sctlr_el1, 1 << 12);
    try vcpu.setReg(.pc, guest_base);

    // Host run loop: keep running the vCPU; on data aborts, record the
    // write and step past the instruction; on HVC, we're done.
    var mmio_addr: u64 = 0;
    var mmio_value: u64 = 0;
    var mmio_writes: usize = 0;
    const max_iters: usize = 8;
    var iters: usize = 0;
    while (iters < max_iters) : (iters += 1) {
        try vcpu.run();

        if (vcpu.exit.reason != .exception) return error.UnexpectedExitReason;
        const ec = ExceptionClass.fromSyndrome(vcpu.exit.exception.syndrome);

        switch (ec) {
            .hvc_aarch64 => break, // clean exit
            .data_abort_lower_el => {
                const info = DataAbort.decode(vcpu.exit.exception);
                try std.testing.expect(info.isv); // syndrome was actually helpful
                if (info.is_write) {
                    mmio_addr = info.ipa;
                    mmio_value = try info.readSource(vcpu);
                    mmio_writes += 1;
                }
                // Advance PC past the faulting instruction (all arm64
                // instructions are 4 bytes) and resume.
                const faulting_pc = try vcpu.getReg(.pc);
                try vcpu.setReg(.pc, faulting_pc + 4);
            },
            else => return error.UnexpectedExceptionClass,
        }
    }
    try std.testing.expect(iters < max_iters); // didn't get stuck

    // The guest wrote 0xABCD to 0x09000000, exactly once.
    try std.testing.expectEqual(@as(usize, 1), mmio_writes);
    try std.testing.expectEqual(mmio_base, mmio_addr);
    try std.testing.expectEqual(@as(u64, 0xABCD), mmio_value);

    std.debug.print(
        "caught MMIO store: addr=0x{x} value=0x{x}\n",
        .{ mmio_addr, mmio_value },
    );
}

test "guest writes bytes to PL011 UART, host captures them" {
    const vm = Vm.create() catch |err| switch (err) {
        error.Denied => {
            std.debug.print("skip: HV_DENIED\n", .{});
            return;
        },
        else => return err,
    };
    defer vm.destroy();

    const host_mem = try std.posix.mmap(
        null,
        page_size,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
        -1,
        0,
    );
    defer std.posix.munmap(host_mem);

    // Guest program: write the bytes 'H', 'i', '\n' to the UART data
    // register one at a time, then exit.
    //   movz x2, #0x0900, lsl #16   ; x2 = UART base
    //   movz x3, #'H'   ; strb w3, [x2]
    //   movz x3, #'i'   ; strb w3, [x2]
    //   movz x3, #'\n'  ; strb w3, [x2]
    //   hvc #0
    const program = [_]u32{
        0xD2A12002, // movz x2, #0x0900, lsl #16
        0xD2800903, // movz x3, #0x48 ('H')
        0x39000043, // strb w3, [x2]
        0xD2800D23, // movz x3, #0x69 ('i')
        0x39000043, // strb w3, [x2]
        0xD2800143, // movz x3, #0x0A ('\n')
        0x39000043, // strb w3, [x2]
        0xD4000002, // hvc #0
    };
    const program_bytes = std.mem.sliceAsBytes(program[0..]);
    @memcpy(host_mem[0..program_bytes.len], program_bytes);

    const guest_base: u64 = 0x40000000;
    try vm.map(host_mem, guest_base, MapFlags.rx);
    defer vm.unmap(guest_base, page_size) catch {};

    const vcpu = try Vcpu.create();
    defer vcpu.destroy();

    try vcpu.setReg(.cpsr, 0x3C5);
    try vcpu.setSysReg(.sctlr_el1, 1 << 12);
    try vcpu.setReg(.pc, guest_base);

    var uart: Pl011 = .init;

    const max_iters: usize = 32;
    var iters: usize = 0;
    while (iters < max_iters) : (iters += 1) {
        try vcpu.run();
        if (vcpu.exit.reason != .exception) return error.UnexpectedExitReason;
        const ec = ExceptionClass.fromSyndrome(vcpu.exit.exception.syndrome);

        switch (ec) {
            .hvc_aarch64 => break,
            .data_abort_lower_el => {
                const info = DataAbort.decode(vcpu.exit.exception);
                if (uart.handles(info.ipa)) {
                    if (info.is_write) {
                        const value = try info.readSource(vcpu);
                        uart.write(info.ipa, value);
                    }
                    // (reads not exercised in this test)
                }
                // advance past faulting instruction
                const pc = try vcpu.getReg(.pc);
                try vcpu.setReg(.pc, pc + 4);
            },
            else => return error.UnexpectedExceptionClass,
        }
    }
    try std.testing.expect(iters < max_iters);

    try std.testing.expectEqualStrings("Hi\n", uart.capturedBytes());
    std.debug.print(
        "PL011 captured {d} bytes: \"{s}\"",
        .{ uart.captured_len, uart.capturedBytes() },
    );
}

// =============================================================
// Pl011 RX path — unit tests, no HVF needed
// =============================================================
//
// These cover the pieces the stdin-reader thread and the guest ISR
// touch: pushRx updates rx_buf + RIS, irqAsserted gates on IMSC,
// ICR clears selected bits, a DR read pops a byte and clears RX_INT
// when the FIFO drains. FR.RXFE flips with FIFO state. PrimeCell IDs
// return the standard PL011 values so the AMBA bus binds.

test "Pl011: pushRx buffers bytes and sets RX_INT in RIS" {
    var uart: Pl011 = .init;

    uart.pushRx("abc");
    try std.testing.expectEqual(@as(usize, 3), uart.rx_len);
    try std.testing.expect((uart.ris & Pl011.RX_INT) != 0);
}

test "Pl011: irqAsserted is gated on IMSC" {
    var uart: Pl011 = .init;

    uart.pushRx("x");
    // RIS has RX_INT set, but the kernel hasn't enabled the mask yet.
    try std.testing.expect(!uart.irqAsserted());

    // Kernel enables RX interrupt (IMSC bit 4 = 0x10).
    uart.write(uart.base + 0x038, 0x10);
    try std.testing.expect(uart.irqAsserted());

    // Kernel masks everything — IRQ line should drop even though bytes remain.
    uart.write(uart.base + 0x038, 0x00);
    try std.testing.expect(!uart.irqAsserted());
}

test "Pl011: ICR clears selected RIS bits, preserves RX_INT while FIFO has bytes" {
    var uart: Pl011 = .init;

    uart.pushRx("y");
    // Enable + assert: the RT (receive-timeout) bit too, so we can see
    // ICR clear it without clearing RX_INT.
    uart.ris |= (1 << 6); // RT
    try std.testing.expect((uart.ris & 0x10) != 0);
    try std.testing.expect((uart.ris & 0x40) != 0);

    // Kernel writes ICR=0x50 (RX | RT). RT should clear permanently;
    // RX_INT should re-latch because rx_buf still holds a byte.
    uart.write(uart.base + 0x044, 0x50);
    try std.testing.expectEqual(@as(u32, 0x10), uart.ris);
}

test "Pl011: DR read pops a byte; RX_INT clears when FIFO drains" {
    var uart: Pl011 = .init;

    uart.pushRx("hi");
    const a = uart.read(uart.base + 0x000); // DR
    try std.testing.expectEqual(@as(u64, 'h'), a);
    try std.testing.expect((uart.ris & Pl011.RX_INT) != 0); // still one byte left

    const b = uart.read(uart.base + 0x000);
    try std.testing.expectEqual(@as(u64, 'i'), b);
    try std.testing.expectEqual(@as(usize, 0), uart.rx_len);
    try std.testing.expect((uart.ris & Pl011.RX_INT) == 0); // drained → clear
}

test "Pl011: FR.RXFE flips with FIFO occupancy" {
    var uart: Pl011 = .init;

    // Empty: bit 4 (RXFE) set.
    try std.testing.expect((uart.read(uart.base + 0x018) & (1 << 4)) != 0);

    uart.pushRx("z");
    // Not empty: RXFE clear.
    try std.testing.expect((uart.read(uart.base + 0x018) & (1 << 4)) == 0);

    _ = uart.read(uart.base + 0x000); // drain
    try std.testing.expect((uart.read(uart.base + 0x018) & (1 << 4)) != 0);
}

test "Pl011: PrimeCell IDs return the standard PL011 values" {
    var uart: Pl011 = .init;
    // Without these, AMBA's bus scan refuses to bind the PL011 driver.
    try std.testing.expectEqual(@as(u64, 0x11), uart.read(uart.base + 0xFE0));
    try std.testing.expectEqual(@as(u64, 0x10), uart.read(uart.base + 0xFE4));
    try std.testing.expectEqual(@as(u64, 0x14), uart.read(uart.base + 0xFE8));
    try std.testing.expectEqual(@as(u64, 0x00), uart.read(uart.base + 0xFEC));
    try std.testing.expectEqual(@as(u64, 0x0D), uart.read(uart.base + 0xFF0));
    try std.testing.expectEqual(@as(u64, 0xF0), uart.read(uart.base + 0xFF4));
    try std.testing.expectEqual(@as(u64, 0x05), uart.read(uart.base + 0xFF8));
    try std.testing.expectEqual(@as(u64, 0xB1), uart.read(uart.base + 0xFFC));
}

test "KernelImage.parse accepts a valid header" {
    var header: [64]u8 = @splat(0);
    // text_offset at 0x08 (8 bytes, LE)
    std.mem.writeInt(u64, header[0x08..0x10], 0x80000, .little);
    // image_size at 0x10
    std.mem.writeInt(u64, header[0x10..0x18], 0x200000, .little);
    // magic "ARM\x64" at 0x38
    std.mem.writeInt(u32, header[0x38..0x3C], KernelImage.magic, .little);

    const img = try KernelImage.parse(&header);
    try std.testing.expectEqual(@as(u64, 0x80000), img.text_offset);
    try std.testing.expectEqual(@as(u64, 0x200000), img.image_size);
}

test "KernelImage.parse rejects bad magic and too-small buffers" {
    try std.testing.expectError(error.TooSmall, KernelImage.parse(&[_]u8{0} ** 32));

    var header: [64]u8 = @splat(0);
    // Leave magic zero.
    try std.testing.expectError(error.BadMagic, KernelImage.parse(&header));
}

test "guest makes a PSCI SYSTEM_OFF call, host stops the run loop" {
    const vm = Vm.create() catch |err| switch (err) {
        error.Denied => {
            std.debug.print("skip: HV_DENIED\n", .{});
            return;
        },
        else => return err,
    };
    defer vm.destroy();

    const host_mem = try std.posix.mmap(
        null,
        page_size,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
        -1,
        0,
    );
    defer std.posix.munmap(host_mem);

    // Guest program: place 0x84000009 (PSCI SYSTEM_OFF) into x0 then
    // HVC. The kernel makes this exact call when it shuts down.
    //   movz x0, #0x0009            ; low 16 bits
    //   movk x0, #0x8400, lsl #16   ; upper 16 bits
    //   hvc  #0
    const program = [_]u32{
        0xD2800120, // movz x0, #0x0009
        0xF2B08000, // movk x0, #0x8400, lsl #16
        0xD4000002, // hvc  #0
    };
    const program_bytes = std.mem.sliceAsBytes(program[0..]);
    @memcpy(host_mem[0..program_bytes.len], program_bytes);

    const guest_base: u64 = 0x40000000;
    try vm.map(host_mem, guest_base, MapFlags.rx);
    defer vm.unmap(guest_base, page_size) catch {};

    const vcpu = try Vcpu.create();
    defer vcpu.destroy();

    try vcpu.setReg(.cpsr, 0x3C5);
    try vcpu.setSysReg(.sctlr_el1, 1 << 12);
    try vcpu.setReg(.pc, guest_base);

    // Run loop: exit on PSCI SYSTEM_OFF.
    var saw_system_off = false;
    while (true) {
        try vcpu.run();
        if (vcpu.exit.reason != .exception) return error.UnexpectedExitReason;
        const ec = ExceptionClass.fromSyndrome(vcpu.exit.exception.syndrome);
        if (ec != .hvc_aarch64) return error.UnexpectedExceptionClass;

        if (try Psci.decode(vcpu)) |f| switch (f) {
            .system_off, .system_reset => {
                saw_system_off = true;
                break;
            },
            else => {
                // other PSCI calls would be answered here; none expected in this test
                return error.UnexpectedPsciFunction;
            },
        } else {
            return error.NonPsciHvc;
        }
    }

    try std.testing.expect(saw_system_off);
    std.debug.print("guest requested PSCI SYSTEM_OFF, host stopped\n", .{});
}
