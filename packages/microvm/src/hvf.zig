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
    data_abort_lower_el = 0x24,
    brk_aarch64 = 0x3C,
    _,

    pub fn fromSyndrome(syndrome: u64) ExceptionClass {
        return @enumFromInt(@as(u6, @truncate(syndrome >> 26)));
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
        if (bytes.len < 64) return error.TooSmall;
        const got_magic = std.mem.readInt(u32, bytes[0x38..0x3C], .little);
        if (got_magic != magic) return error.BadMagic;
        return .{
            .text_offset = std.mem.readInt(u64, bytes[0x08..0x10], .little),
            .image_size = std.mem.readInt(u64, bytes[0x10..0x18], .little),
            .bytes = bytes,
        };
    }
};

// =============================================================
// PSCI — the one kernel-to-hypervisor call we have to understand
// =============================================================

/// PSCI function IDs the kernel uses via HVC #0. Top bit distinguishes
/// 64-bit from 32-bit calling convention. We only handle the few we
/// need for single-vCPU boot.
pub const Psci = struct {
    pub const Function = enum(u32) {
        version = 0x84000000,
        cpu_on_64 = 0xC4000003,
        system_off = 0x84000009,
        system_reset = 0x84000009 + 1, // 0x8400000A
        _,
    };

    /// When the vCPU exits with EC=HVC, the requested function ID
    /// is in X0. Returns null if it isn't a PSCI-shaped HVC.
    pub fn decode(vcpu: Vcpu) Error!?Function {
        const x0 = try vcpu.getReg(.x0);
        const f: Function = @enumFromInt(@as(u32, @truncate(x0)));
        return switch (f) {
            .version, .cpu_on_64, .system_off, .system_reset => f,
            _ => null,
        };
    }
};

// =============================================================
// Minimal PL011 UART
// =============================================================

/// Bare-bones PL011 UART (the serial port on the ARM virt machine).
/// Only enough registers to accept writes from a guest printk and
/// keep the guest from stalling on flag-register reads:
///   - DR (offset 0x000): byte writes append to `captured`; reads return 0.
///   - FR (offset 0x018): reads return "TX empty, not busy" (0x90).
///   - other registers: writes ignored, reads return 0.
pub const Pl011 = struct {
    base: u64,
    size: u64 = 0x1000,
    captured: std.ArrayList(u8),

    pub const init: Pl011 = .{ .base = 0x0900_0000, .captured = .empty };

    pub fn withBase(base: u64) Pl011 {
        return .{ .base = base, .captured = .empty };
    }

    pub fn deinit(self: *Pl011, gpa: std.mem.Allocator) void {
        self.captured.deinit(gpa);
    }

    pub fn handles(self: Pl011, addr: u64) bool {
        return addr >= self.base and addr < self.base + self.size;
    }

    pub fn write(self: *Pl011, gpa: std.mem.Allocator, addr: u64, value: u64) !void {
        switch (addr - self.base) {
            0x000 => try self.captured.append(gpa, @truncate(value)),
            else => {}, // accept-and-discard
        }
    }

    pub fn read(self: Pl011, addr: u64) u64 {
        return switch (addr - self.base) {
            0x018 => 0x90, // FR: TX FIFO empty + not busy
            else => 0,
        };
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

    const gpa = std.testing.allocator;
    var uart: Pl011 = .init;
    defer uart.deinit(gpa);

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
                        try uart.write(gpa, info.ipa, value);
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

    try std.testing.expectEqualStrings("Hi\n", uart.captured.items);
    std.debug.print(
        "PL011 captured {d} bytes: \"{s}\"",
        .{ uart.captured.items.len, uart.captured.items },
    );
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
