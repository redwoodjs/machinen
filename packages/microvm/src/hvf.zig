//! Hypervisor.framework bindings. See .docs/learnings/microvm/hvf.md.
//!
//! macOS-only. Importing on other OSes produces a compile error.

const std = @import("std");
const builtin = @import("builtin");

comptime {
    if (builtin.os.tag != .macos) {
        @compileError("hvf.zig only builds on macOS");
    }
}

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
        try check(c.hv_vm_map(host_mem.ptr, guest_phys, host_mem.len, flags.bits()));
    }

    pub fn unmap(_: Vm, guest_phys: u64, size: usize) Error!void {
        try check(c.hv_vm_unmap(guest_phys, size));
    }
};

pub const page_size = 0x4000; // 16 KiB pages on Apple Silicon arm64

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

/// System register selectors. Matches hv_sys_reg_t in hv_vcpu_types.h.
/// Only the handful we need for the smoke test.
pub const SysReg = enum(u32) {
    // Encoding for hv_sys_reg_t follows arm64 op0/op1/CRn/CRm/op2 packing.
    // SCTLR_EL1 = op0=3 op1=0 CRn=1 CRm=0 op2=0 → 0xC080
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

    pub fn run(self: Vcpu) Error!void {
        try check(hv_vcpu_run(self.handle));
    }
};

/// ARMv8 exception class — top 6 bits of ESR_EL2 (what HVF delivers).
/// See Arm ARM D17.2.41 ("Exception class"). Most minimal-VMM flows
/// exit via HVC (trapped directly to EL2) rather than BRK (which stays
/// at EL1 and needs a vector table set up).
pub const ExceptionClass = enum(u6) {
    hvc_aarch64 = 0x16,
    brk_aarch64 = 0x3C,
    _,

    pub fn fromSyndrome(syndrome: u64) ExceptionClass {
        return @enumFromInt(@as(u6, @truncate(syndrome >> 26)));
    }
};

// =============================================================
// Tests
// =============================================================

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
    @as(*align(4) u32, @alignCast(@ptrCast(host_mem.ptr))).* = hvc0_instr;

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
