//! Linux /dev/kvm ioctl wrapper — the KVM-side twin of hvf.zig.
//!
//! Scope: just enough surface for a boot loop. VM + vCPU lifecycle,
//! guest-RAM mapping via KVM_SET_USER_MEMORY_REGION, arm64 register
//! get/set via KVM_GET/SET_ONE_REG, the vCPU run loop and MMIO exit
//! decode. GIC wiring (distributor + redistributor for in-kernel
//! vgic_v3) is stubbed here — a real boot path will flesh that out.
//!
//! Layered so boot.zig (on Linux) can call into a kvm.Vm/kvm.Vcpu
//! pair that has the same shape as hvf.Vm/hvf.Vcpu. Not yet wired
//! into a Linux boot path; this commit is the ioctl scaffold.

const std = @import("std");
const builtin = @import("builtin");

comptime {
    if (builtin.os.tag != .linux) {
        @compileError("kvm.zig only builds on Linux (uses /dev/kvm)");
    }
}

// ---------------------------------------------------------------
// _IOC macros — compute ioctl numbers at compile time so we don't
// have to hand-hex them per-struct-size and rely on copy-paste.

const IOC_NONE: u32 = 0;
const IOC_WRITE: u32 = 1;
const IOC_READ: u32 = 2;

fn ioc(dir: u32, comptime typ: u32, comptime nr: u32, comptime size: u32) u32 {
    return (dir << 30) | (size << 16) | (typ << 8) | nr;
}

fn io_(comptime typ: u32, comptime nr: u32) u32 {
    return ioc(IOC_NONE, typ, nr, 0);
}
fn iow(comptime typ: u32, comptime nr: u32, comptime size: u32) u32 {
    return ioc(IOC_WRITE, typ, nr, size);
}
fn ior(comptime typ: u32, comptime nr: u32, comptime size: u32) u32 {
    return ioc(IOC_READ, typ, nr, size);
}
fn iowr(comptime typ: u32, comptime nr: u32, comptime size: u32) u32 {
    return ioc(IOC_READ | IOC_WRITE, typ, nr, size);
}

// The KVM subsystem type byte.
pub const KVMIO: u32 = 0xAE;

// ---------------------------------------------------------------
// Ioctl numbers. Computed so the build catches struct-size drift.

pub const KVM_GET_API_VERSION = io_(KVMIO, 0x00);
pub const KVM_CREATE_VM = io_(KVMIO, 0x01);
pub const KVM_CHECK_EXTENSION = io_(KVMIO, 0x03);
pub const KVM_GET_VCPU_MMAP_SIZE = io_(KVMIO, 0x04);

pub const KVM_CREATE_VCPU = io_(KVMIO, 0x41);
pub const KVM_RUN = io_(KVMIO, 0x80);

pub const KVM_SET_USER_MEMORY_REGION = iow(KVMIO, 0x46, @sizeOf(UserspaceMemoryRegion));
pub const KVM_CREATE_IRQCHIP = io_(KVMIO, 0x60);
pub const KVM_IRQ_LINE = iow(KVMIO, 0x61, @sizeOf(IrqLevel));
pub const KVM_GET_IRQCHIP = iowr(KVMIO, 0x62, @sizeOf(Irqchip));
pub const KVM_SET_IRQCHIP = iow(KVMIO, 0x63, @sizeOf(Irqchip));

pub const KVM_ARM_PREFERRED_TARGET = ior(KVMIO, 0xAF, @sizeOf(VcpuInit));
pub const KVM_ARM_VCPU_INIT = iow(KVMIO, 0xAE, @sizeOf(VcpuInit));

pub const KVM_GET_ONE_REG = iow(KVMIO, 0xAB, @sizeOf(OneReg));
pub const KVM_SET_ONE_REG = iow(KVMIO, 0xAC, @sizeOf(OneReg));

// x86 register get/set. arm64 uses ONE_REG exclusively; x86 has
// dedicated ioctls for the GP + segment register banks.
pub const KVM_GET_REGS = ior(KVMIO, 0x81, @sizeOf(X86Regs));
pub const KVM_SET_REGS = iow(KVMIO, 0x82, @sizeOf(X86Regs));
pub const KVM_GET_SREGS = ior(KVMIO, 0x83, @sizeOf(X86Sregs));
pub const KVM_SET_SREGS = iow(KVMIO, 0x84, @sizeOf(X86Sregs));

// VM-scoped device creation (for vgic-v3, vsock, etc.) + per-device
// attributes. `KVM_CREATE_DEVICE` returns a fd for the device; attr
// ioctls happen on that fd.
pub const KVM_CREATE_DEVICE = iowr(KVMIO, 0xE0, @sizeOf(CreateDevice));
pub const KVM_SET_DEVICE_ATTR = iow(KVMIO, 0xE1, @sizeOf(DeviceAttr));
pub const KVM_GET_DEVICE_ATTR = iow(KVMIO, 0xE2, @sizeOf(DeviceAttr));
pub const KVM_HAS_DEVICE_ATTR = iow(KVMIO, 0xE3, @sizeOf(DeviceAttr));

// ---------------------------------------------------------------
// Flat structs — all have a KVM-stable layout across arm64/x86_64
// but we only build on arm64 for our guest.

pub const UserspaceMemoryRegion = extern struct {
    slot: u32,
    flags: u32,
    guest_phys_addr: u64,
    memory_size: u64,
    userspace_addr: u64,
};

pub const VcpuInit = extern struct {
    target: u32,
    features: [7]u32,
};

pub const OneReg = extern struct {
    id: u64,
    addr: u64,
};

pub const IrqLevel = extern struct {
    irq: u32,
    level: u32,
};

pub const Irqchip = extern struct {
    chip_id: u32,
    pad: u32,
    chip: [512]u8, // union of chip-specific state; opaque to us
};

// ---------------------------------------------------------------
// KVM device ioctls (vgic-v3, etc.). `CreateDevice.type` + `flags`
// select the device. For vgic-v3: type = KVM_DEV_TYPE_ARM_VGIC_V3
// (7), flags = 0. After create, `fd` is populated.

pub const CreateDevice = extern struct {
    type: u32,
    fd: u32, // out
    flags: u32,
};

pub const DeviceAttr = extern struct {
    flags: u32,
    group: u32,
    attr: u64,
    addr: u64, // userspace pointer to the attribute's value
};

pub const KVM_DEV_TYPE_ARM_VGIC_V3: u32 = 7;

// vgic-v3 attribute groups.
pub const KVM_DEV_ARM_VGIC_GRP_ADDR: u32 = 0;
pub const KVM_DEV_ARM_VGIC_GRP_CTRL: u32 = 4;

// vgic-v3 address-type attrs inside GRP_ADDR.
pub const KVM_VGIC_V3_ADDR_TYPE_DIST: u64 = 2;
pub const KVM_VGIC_V3_ADDR_TYPE_REDIST: u64 = 3;

// "init the device" attribute inside GRP_CTRL.
pub const KVM_DEV_ARM_VGIC_CTRL_INIT: u64 = 0;

// arm64 VCPU_INIT feature bits.
pub const KVM_ARM_VCPU_PSCI_0_2: u32 = 2;

// ---------------------------------------------------------------
// x86_64 register banks. arm64 boots don't touch these; they live
// here so the same kvm.zig wrapper serves both arches. Layouts
// match <include/uapi/linux/kvm.h> on x86.

pub const X86Regs = extern struct {
    rax: u64,
    rbx: u64,
    rcx: u64,
    rdx: u64,
    rsi: u64,
    rdi: u64,
    rsp: u64,
    rbp: u64,
    r8: u64,
    r9: u64,
    r10: u64,
    r11: u64,
    r12: u64,
    r13: u64,
    r14: u64,
    r15: u64,
    rip: u64,
    rflags: u64,
};

pub const X86Segment = extern struct {
    base: u64,
    limit: u32,
    selector: u16,
    seg_type: u8,
    present: u8,
    dpl: u8,
    db: u8,
    s: u8,
    l: u8,
    g: u8,
    avl: u8,
    unusable: u8,
    padding: u8,
};

pub const X86Dtable = extern struct {
    base: u64,
    limit: u16,
    padding: [3]u16,
};

pub const X86Sregs = extern struct {
    cs: X86Segment,
    ds: X86Segment,
    es: X86Segment,
    fs: X86Segment,
    gs: X86Segment,
    ss: X86Segment,
    tr: X86Segment,
    ldt: X86Segment,
    gdt: X86Dtable,
    idt: X86Dtable,
    cr0: u64,
    cr2: u64,
    cr3: u64,
    cr4: u64,
    cr8: u64,
    efer: u64,
    apic_base: u64,
    /// KVM_NR_INTERRUPTS = 256, so the bitmap is 4 × u64.
    interrupt_bitmap: [4]u64,
};

// ---------------------------------------------------------------
// kvm_run — the shared mmap'd struct per vCPU. Bigger than a cache
// line; caller mmaps KVM_GET_VCPU_MMAP_SIZE bytes and casts. We
// only touch a handful of fields here; the rest are kept as
// padding / opaque bytes so the layout matches the kernel.

pub const ExitReason = enum(u32) {
    unknown = 0,
    exception = 1,
    io = 2,
    hypercall = 3,
    debug = 4,
    hlt = 5,
    mmio = 6,
    irq_window_open = 7,
    shutdown = 8,
    fail_entry = 9,
    intr = 10,
    set_tpr = 11,
    tpr_access = 12,
    s390_sieic = 13,
    s390_reset = 14,
    dcr = 15,
    nmi = 16,
    internal_error = 17,
    osi = 18,
    papr_hcall = 19,
    s390_ucontrol = 20,
    watchdog = 21,
    s390_tsch = 22,
    epr = 23,
    system_event = 24,
    s390_stsi = 25,
    ioapic_eoi = 26,
    hyperv = 27,
    arm_nisv = 28,
    riscv_sbi = 29,
    riscv_csr = 30,
    notify = 31,
    loongarch_iocsr = 32,
    memory_fault = 33,
    _,
};

/// MMIO exit payload (kvm_run.mmio).
pub const MmioExit = extern struct {
    phys_addr: u64,
    data: [8]u8,
    len: u32,
    is_write: u8,
    _pad: [3]u8 = @splat(0),
};

/// System-event exit payload (for PSCI-style SHUTDOWN / RESET).
pub const SystemEventExit = extern struct {
    type: u32,
    ndata: u32,
    data: [16]u64,
};

pub const SystemEventType = enum(u32) {
    shutdown = 1,
    reset = 2,
    crash = 3,
    wakeup = 4,
    // `suspend` is a Zig reserved keyword; use `@"suspend"` syntax
    // for the identifier so the enum tag still matches KVM_SYSTEM_EVENT_SUSPEND.
    @"suspend" = 5,
    seev2 = 6,
    _,
};

// ---------------------------------------------------------------
// arm64 register IDs. KVM builds these out of a coprocessor+sysreg
// encoding. For the handful we touch we just hardcode the known
// values — the alternative is a 3-header deep helper macro.

pub const REG_ARM64: u64 = 0x6000_0000_0000_0000;
pub const REG_SIZE_U32: u64 = 0x0020_0000_0000_0000;
pub const REG_SIZE_U64: u64 = 0x0030_0000_0000_0000;
pub const REG_ARM_CORE: u64 = 0x00_0010_0000;

/// Build an ID for a core register at the given struct offset.
fn armCoreReg(comptime offset: u64) u64 {
    // struct user_pt_regs fields on arm64 are u64; offsets are in
    // bytes. Encoding: ARM64 | U64 | REG_ARM_CORE | (offset / 4).
    return REG_ARM64 | REG_SIZE_U64 | REG_ARM_CORE | (offset / 4);
}

pub const REG_X0 = armCoreReg(0x00);
pub const REG_X1 = armCoreReg(0x08);
pub const REG_X2 = armCoreReg(0x10);
pub const REG_X3 = armCoreReg(0x18);
pub const REG_SP = armCoreReg(0xF8);
pub const REG_PC = armCoreReg(0x100);
pub const REG_PSTATE = armCoreReg(0x108);

// ---------------------------------------------------------------
// libc bindings. Kept narrow so we don't pull in std.posix's
// ever-shifting Io surface.

extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
extern "c" fn mmap(addr: ?*anyopaque, len: usize, prot: c_int, flags: c_int, fd: c_int, off: c_long) ?*anyopaque;
extern "c" fn munmap(addr: *anyopaque, len: usize) c_int;
extern "c" fn __errno_location() *c_int;

fn errno() c_int {
    return __errno_location().*;
}

const O_RDWR: c_int = 0o2;
const O_CLOEXEC: c_int = 0o2000000;
const PROT_READ: c_int = 0x1;
const PROT_WRITE: c_int = 0x2;
const MAP_SHARED: c_int = 0x01;
const MAP_FAILED = @as(?*anyopaque, @ptrFromInt(std.math.maxInt(usize)));

pub const KvmError = error{
    KvmDeviceOpenFailed,
    KvmApiMismatch,
    KvmCreateVmFailed,
    KvmCreateVcpuFailed,
    KvmSetMemoryFailed,
    KvmPreferredTargetFailed,
    KvmVcpuInitFailed,
    KvmSetRegFailed,
    KvmGetRegFailed,
    KvmRunFailed,
    KvmCreateIrqchipFailed,
    KvmIrqLineFailed,
    KvmMmapRunFailed,
    Unsupported,
};

// ---------------------------------------------------------------
// Thin wrappers. The Vm/Vcpu types mirror hvf.zig naming so boot.zig
// can eventually dispatch at comptime without special-casing.

/// Top-level handle. Owns /dev/kvm and the VM fd.
pub const Kvm = struct {
    kvm_fd: c_int,
    vcpu_mmap_size: usize,

    pub fn open_() !Kvm {
        const fd = open("/dev/kvm", O_RDWR | O_CLOEXEC);
        if (fd < 0) return error.KvmDeviceOpenFailed;
        errdefer _ = close(fd);

        // glibc's ioctl is declared `int ioctl(int, unsigned long,
        // ...)` — the third arg is variadic. Even for "no payload"
        // requests we have to pass a value, else the variadic slot
        // is uninitialised and the kernel's copy_from_user reads
        // garbage. Pass an explicit 0.
        const ver = ioctl(fd, @as(c_ulong, KVM_GET_API_VERSION), @as(c_ulong, 0));
        if (ver != 12) return error.KvmApiMismatch;

        const sz = ioctl(fd, @as(c_ulong, KVM_GET_VCPU_MMAP_SIZE), @as(c_ulong, 0));
        if (sz <= 0) return error.Unsupported;
        return .{ .kvm_fd = fd, .vcpu_mmap_size = @intCast(sz) };
    }

    pub fn close_(self: *Kvm) void {
        _ = close(self.kvm_fd);
    }

    pub fn createVm(self: *Kvm) !Vm {
        const fd = ioctl(self.kvm_fd, KVM_CREATE_VM, @as(c_ulong, 0));
        if (fd < 0) return error.KvmCreateVmFailed;
        return .{ .fd = fd, .parent = self };
    }
};

pub const Vm = struct {
    fd: c_int,
    parent: *Kvm,

    pub fn destroy(self: *Vm) void {
        _ = close(self.fd);
    }

    /// Map `host_buf` into the guest at `guest_phys_addr`.
    pub fn mapMemory(
        self: *Vm,
        slot: u32,
        guest_phys_addr: u64,
        host_buf: []u8,
    ) !void {
        const r = UserspaceMemoryRegion{
            .slot = slot,
            .flags = 0,
            .guest_phys_addr = guest_phys_addr,
            .memory_size = host_buf.len,
            .userspace_addr = @intFromPtr(host_buf.ptr),
        };
        if (ioctl(self.fd, KVM_SET_USER_MEMORY_REGION, &r) != 0) {
            return error.KvmSetMemoryFailed;
        }
    }

    /// Create an in-kernel vgic-v3 and place its distributor +
    /// redistributor MMIO windows at the given guest-physical
    /// addresses. Call BEFORE `createVcpu` — KVM requires it.
    /// Returns a Gic with the device fd owned; destroy() closes it.
    pub fn createGicV3(
        self: *Vm,
        dist_addr: u64,
        redist_addr: u64,
    ) !Gic {
        var args = CreateDevice{
            .type = KVM_DEV_TYPE_ARM_VGIC_V3,
            .fd = 0,
            .flags = 0,
        };
        if (ioctl(self.fd, KVM_CREATE_DEVICE, &args) != 0) {
            return error.KvmCreateIrqchipFailed;
        }
        const gic_fd: c_int = @intCast(args.fd);
        errdefer _ = close(gic_fd);

        var dist = dist_addr;
        var dist_attr = DeviceAttr{
            .flags = 0,
            .group = KVM_DEV_ARM_VGIC_GRP_ADDR,
            .attr = KVM_VGIC_V3_ADDR_TYPE_DIST,
            .addr = @intFromPtr(&dist),
        };
        if (ioctl(gic_fd, KVM_SET_DEVICE_ATTR, &dist_attr) != 0) {
            return error.KvmCreateIrqchipFailed;
        }

        var redist = redist_addr;
        var redist_attr = DeviceAttr{
            .flags = 0,
            .group = KVM_DEV_ARM_VGIC_GRP_ADDR,
            .attr = KVM_VGIC_V3_ADDR_TYPE_REDIST,
            .addr = @intFromPtr(&redist),
        };
        if (ioctl(gic_fd, KVM_SET_DEVICE_ATTR, &redist_attr) != 0) {
            return error.KvmCreateIrqchipFailed;
        }

        return .{ .fd = gic_fd, .vm_fd = self.fd };
    }

    /// Raise or lower an interrupt line. `irq` uses KVM's encoding:
    /// bits 27:24 = type (0 = SPI), bits 23:16 = vcpu_id, bits 15:0 =
    /// irq_number. For arm64 SPIs, irq_number = GIC SPI base (32) +
    /// device-specific offset; our DTS maps PL011 to 33, virtio-net
    /// to 48, etc.
    pub fn setIrq(self: *Vm, irq: u32, level: u32) !void {
        var lvl = IrqLevel{ .irq = irq, .level = level };
        if (ioctl(self.fd, KVM_IRQ_LINE, &lvl) != 0) return error.KvmIrqLineFailed;
    }

    pub fn createVcpu(self: *Vm, id: u32) !Vcpu {
        const fd = ioctl(self.fd, KVM_CREATE_VCPU, @as(c_ulong, id));
        if (fd < 0) return error.KvmCreateVcpuFailed;
        errdefer _ = close(fd);
        const run_ptr = mmap(null, self.parent.vcpu_mmap_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
        if (run_ptr == MAP_FAILED or run_ptr == null) return error.KvmMmapRunFailed;
        return .{ .fd = fd, .run_page = run_ptr.?, .run_size = self.parent.vcpu_mmap_size };
    }

    /// Fill in `out` with the host's preferred CPU target for this
    /// VM's arm64 vCPUs. Caller passes that to Vcpu.init.
    pub fn preferredTarget(self: *Vm) !VcpuInit {
        var out: VcpuInit = .{ .target = 0, .features = @splat(0) };
        if (ioctl(self.fd, KVM_ARM_PREFERRED_TARGET, &out) != 0) {
            return error.KvmPreferredTargetFailed;
        }
        return out;
    }
};

/// In-kernel vgic-v3 handle. Addresses are set in createGicV3; the
/// device is only "ready" after all vCPUs are up AND `finalize()`
/// runs KVM_DEV_ARM_VGIC_CTRL_INIT.
pub const Gic = struct {
    fd: c_int,
    vm_fd: c_int,

    pub fn destroy(self: *Gic) void {
        _ = close(self.fd);
    }

    pub fn finalize(self: *Gic) !void {
        var attr = DeviceAttr{
            .flags = 0,
            .group = KVM_DEV_ARM_VGIC_GRP_CTRL,
            .attr = KVM_DEV_ARM_VGIC_CTRL_INIT,
            .addr = 0,
        };
        if (ioctl(self.fd, KVM_SET_DEVICE_ATTR, &attr) != 0) {
            return error.KvmCreateIrqchipFailed;
        }
    }
};

pub const Vcpu = struct {
    fd: c_int,
    run_page: *anyopaque,
    run_size: usize,

    pub fn destroy(self: *Vcpu) void {
        _ = munmap(self.run_page, self.run_size);
        _ = close(self.fd);
    }

    pub fn init(self: *Vcpu, vi: VcpuInit) !void {
        var v = vi;
        if (ioctl(self.fd, KVM_ARM_VCPU_INIT, &v) != 0) {
            return error.KvmVcpuInitFailed;
        }
    }

    pub fn setReg(self: *Vcpu, id: u64, value: u64) !void {
        var v = value;
        const r = OneReg{ .id = id, .addr = @intFromPtr(&v) };
        if (ioctl(self.fd, KVM_SET_ONE_REG, &r) != 0) {
            return error.KvmSetRegFailed;
        }
    }

    pub fn getReg(self: *Vcpu, id: u64) !u64 {
        var v: u64 = 0;
        const r = OneReg{ .id = id, .addr = @intFromPtr(&v) };
        if (ioctl(self.fd, KVM_GET_ONE_REG, &r) != 0) {
            return error.KvmGetRegFailed;
        }
        return v;
    }

    pub fn run(self: *Vcpu) !ExitReason {
        if (ioctl(self.fd, KVM_RUN, @as(c_ulong, 0)) != 0) {
            return error.KvmRunFailed;
        }
        // exit_reason lives at offset 8 in kvm_run:
        //   __u8 request_interrupt_window;  // 0
        //   __u8 immediate_exit;            // 1
        //   __u8 padding1[6];               // 2..7
        //   __u32 exit_reason;              // 8
        const base: [*]const u8 = @ptrCast(self.run_page);
        const ptr: *const u32 = @ptrCast(@alignCast(base + 8));
        return @enumFromInt(ptr.*);
    }

    /// Read the MMIO exit payload. Call only when run() returned
    /// .mmio. The union starts at offset 0x20 inside kvm_run (right
    /// after `apic_base` at 0x18), on builds without the S390
    /// extension — which matches x86_64 and arm64.
    pub fn mmioExit(self: *Vcpu) MmioExit {
        const base: [*]u8 = @ptrCast(self.run_page);
        var out: MmioExit = undefined;
        @memcpy(std.mem.asBytes(&out), base[0x20..][0..@sizeOf(MmioExit)]);
        return out;
    }

    /// Read the SYSTEM_EVENT exit payload. Used for PSCI SHUTDOWN /
    /// RESET. Same struct union as MMIO; offset 0x20 inside kvm_run.
    pub fn systemEventExit(self: *Vcpu) SystemEventExit {
        const base: [*]u8 = @ptrCast(self.run_page);
        var out: SystemEventExit = undefined;
        @memcpy(std.mem.asBytes(&out), base[0x20..][0..@sizeOf(SystemEventExit)]);
        return out;
    }

    /// When handling an MMIO READ exit, the guest expects us to
    /// fill `kvm_run.mmio.data[0..len]` with the register contents
    /// before the next `KVM_RUN`. `mmio.data` lives at 0x20 + 8 =
    /// 0x28 in the kvm_run page.
    pub fn writeMmioReadData(self: *Vcpu, value: u64, len: u32) void {
        const base: [*]u8 = @ptrCast(self.run_page);
        const slot: []u8 = base[0x28 .. 0x28 + 8];
        std.mem.writeInt(u64, slot[0..8], value, .little);
        _ = len;
    }

    // x86-specific register access. arm64 uses setReg/getReg above.

    pub fn getRegsX86(self: *Vcpu) !X86Regs {
        var r: X86Regs = undefined;
        if (ioctl(self.fd, KVM_GET_REGS, &r) != 0) return error.KvmGetRegFailed;
        return r;
    }

    pub fn setRegsX86(self: *Vcpu, r: X86Regs) !void {
        var v = r;
        if (ioctl(self.fd, KVM_SET_REGS, &v) != 0) return error.KvmSetRegFailed;
    }

    pub fn getSregsX86(self: *Vcpu) !X86Sregs {
        var s: X86Sregs = undefined;
        if (ioctl(self.fd, KVM_GET_SREGS, &s) != 0) return error.KvmGetRegFailed;
        return s;
    }

    pub fn setSregsX86(self: *Vcpu, s: X86Sregs) !void {
        var v = s;
        if (ioctl(self.fd, KVM_SET_SREGS, &v) != 0) return error.KvmSetRegFailed;
    }
};

// =============================================================
// Tests — layout + ioctl-number constants.
// =============================================================

test "KVMIO ioctl numbers match their documented kernel values" {
    // Values grabbed from <linux/kvm.h> on arm64. If any of these
    // trip, our _IOC macros or our struct sizes drifted.
    try std.testing.expectEqual(@as(u32, 0xAE00), KVM_GET_API_VERSION);
    try std.testing.expectEqual(@as(u32, 0xAE01), KVM_CREATE_VM);
    try std.testing.expectEqual(@as(u32, 0xAE03), KVM_CHECK_EXTENSION);
    try std.testing.expectEqual(@as(u32, 0xAE04), KVM_GET_VCPU_MMAP_SIZE);
    try std.testing.expectEqual(@as(u32, 0xAE41), KVM_CREATE_VCPU);
    try std.testing.expectEqual(@as(u32, 0xAE80), KVM_RUN);
    try std.testing.expectEqual(@as(u32, 0x4020AE46), KVM_SET_USER_MEMORY_REGION);
    try std.testing.expectEqual(@as(u32, 0xAE60), KVM_CREATE_IRQCHIP);
    try std.testing.expectEqual(@as(u32, 0x4008AE61), KVM_IRQ_LINE);
    try std.testing.expectEqual(@as(u32, 0x4020AEAE), KVM_ARM_VCPU_INIT);
    try std.testing.expectEqual(@as(u32, 0x8020AEAF), KVM_ARM_PREFERRED_TARGET);
    try std.testing.expectEqual(@as(u32, 0x4010AEAB), KVM_GET_ONE_REG);
    try std.testing.expectEqual(@as(u32, 0x4010AEAC), KVM_SET_ONE_REG);
    // x86 banks. Sizes are 144 (regs) and 312 (sregs) — hard locks.
    try std.testing.expectEqual(@as(u32, 0x8090AE81), KVM_GET_REGS);
    try std.testing.expectEqual(@as(u32, 0x4090AE82), KVM_SET_REGS);
    try std.testing.expectEqual(@as(u32, 0x8138AE83), KVM_GET_SREGS);
    try std.testing.expectEqual(@as(u32, 0x4138AE84), KVM_SET_SREGS);
}

test "struct sizes match what _IOC embeds" {
    // If either side drifts the ioctl number changes and the kernel
    // rejects the call. Lock the sizes.
    try std.testing.expectEqual(@as(usize, 32), @sizeOf(UserspaceMemoryRegion));
    try std.testing.expectEqual(@as(usize, 32), @sizeOf(VcpuInit));
    try std.testing.expectEqual(@as(usize, 16), @sizeOf(OneReg));
    try std.testing.expectEqual(@as(usize, 8), @sizeOf(IrqLevel));
    // x86 banks.
    try std.testing.expectEqual(@as(usize, 144), @sizeOf(X86Regs));
    try std.testing.expectEqual(@as(usize, 24), @sizeOf(X86Segment));
    try std.testing.expectEqual(@as(usize, 16), @sizeOf(X86Dtable));
    try std.testing.expectEqual(@as(usize, 312), @sizeOf(X86Sregs));
}

test "arm64 core reg encoding matches the kernel macro" {
    // REG_PC = ARM64 | U64 | CORE | (offsetof(user_pt_regs, pc) / 4)
    //        = 0x6030000000100000 | (256 / 4)
    //        = 0x6030000000100040
    try std.testing.expectEqual(@as(u64, 0x6030_0000_0010_0040), REG_PC);
    try std.testing.expectEqual(@as(u64, 0x6030_0000_0010_0042), REG_PSTATE);
    try std.testing.expectEqual(@as(u64, 0x6030_0000_0010_0000), REG_X0);
}

// The real smokes — split arch-agnostic (runs on every Linux CI)
// from arm64-specific (needs an arm64 Linux host).

const access_ = struct {
    extern "c" fn access(path: [*:0]const u8, mode: c_int) c_int;
}.access;
const F_OK: c_int = 0;

test "KVM arch-agnostic: open, API v12, create VM, check capability" {
    if (access_("/dev/kvm", F_OK) != 0) return;

    var kvm = Kvm.open_() catch |err| {
        std.debug.print("kvm open: {s}\n", .{@errorName(err)});
        return;
    };
    defer kvm.close_();
    // vcpu_mmap_size should be at least one page (typical: 4096 or 12288).
    try std.testing.expect(kvm.vcpu_mmap_size >= 4096);

    var vm = try kvm.createVm();
    defer vm.destroy();

    // KVM_CAP_USER_MEMORY = 3 — present on every modern kernel; makes
    // sure the vm fd responds to CHECK_EXTENSION.
    const cap_user_memory: c_ulong = 3;
    const has_user_memory = ioctl(kvm.kvm_fd, KVM_CHECK_EXTENSION, cap_user_memory);
    try std.testing.expect(has_user_memory >= 1);
}

test "KVM x86_64 proof-of-life: create VM, map `hlt`, run, expect KVM_EXIT_HLT" {
    if (access_("/dev/kvm", F_OK) != 0) return;
    if (builtin.cpu.arch != .x86_64) return;

    var kvm = Kvm.open_() catch |err| {
        std.debug.print("kvm open: {s}\n", .{@errorName(err)});
        return;
    };
    defer kvm.close_();

    var vm = try kvm.createVm();
    defer vm.destroy();

    // One 4 KiB page of anonymous guest RAM.
    const page_size: usize = 4096;
    const page_ptr = mmap(null, page_size, PROT_READ | PROT_WRITE, MAP_SHARED | 0x20, -1, 0);
    if (page_ptr == null or page_ptr == MAP_FAILED) return error.KvmMmapRunFailed;
    defer _ = munmap(page_ptr.?, page_size);
    const page: [*]u8 = @ptrCast(page_ptr.?);

    // Guest instruction: hlt (0xF4). vCPU halts → KVM_EXIT_HLT.
    const guest_phys: u64 = 0x1000;
    page[0] = 0xF4;
    try vm.mapMemory(0, guest_phys, page[0..page_size]);

    var vcpu = try vm.createVcpu(0);
    defer vcpu.destroy();

    // Zero-out CS.base + CS.selector so real-mode execution starts
    // at physical RIP instead of CS*16 + IP. The rest of the default
    // SREGS (GDT/IDT/LDT, other segments) is fine — we never
    // dereference anything but the instruction byte.
    var sregs = try vcpu.getSregsX86();
    sregs.cs.base = 0;
    sregs.cs.selector = 0;
    try vcpu.setSregsX86(sregs);

    // RIP = guest_phys, RFLAGS = 0x2 (the single mandatory bit).
    var regs = try vcpu.getRegsX86();
    regs.rip = guest_phys;
    regs.rflags = 0x2;
    try vcpu.setRegsX86(regs);

    const reason = try vcpu.run();
    try std.testing.expectEqual(ExitReason.hlt, reason);
}

test "KVM proof-of-life: create VM, create vCPU, map + run one instr" {
    // Skip if /dev/kvm isn't there (macOS CI, arm64 host without
    // nested virt, etc.). Also skip on non-arm64 targets since our
    // one-instruction blob and register ids are arm64-specific.
    if (access_("/dev/kvm", F_OK) != 0) return;
    if (builtin.cpu.arch != .aarch64) return;

    var kvm = Kvm.open_() catch |err| {
        std.debug.print("kvm open: {s}\n", .{@errorName(err)});
        return;
    };
    defer kvm.close_();

    var vm = try kvm.createVm();
    defer vm.destroy();

    // One 4 KiB page of host memory, anonymous, mmap'd so the kernel
    // treats it as real guest RAM.
    const page_size: usize = 4096;
    const page_ptr = mmap(null, page_size, PROT_READ | PROT_WRITE, MAP_SHARED | 0x20, -1, 0);
    if (page_ptr == null or page_ptr == MAP_FAILED) return error.KvmMmapRunFailed;
    defer _ = munmap(page_ptr.?, page_size);
    const page: [*]u8 = @ptrCast(page_ptr.?);

    // ARM64 `LDR W0, [X0]` = 0xB9400000 (little-endian: 00 00 40 B9).
    // With X0 preloaded to an unmapped guest-physical address, the
    // load faults and KVM bounces back to userspace with KVM_EXIT_MMIO.
    // This is the most portable "did a guest instruction run and did
    // KVM return cleanly" check — WFI and HVC both have kernel paths
    // that can swallow the exit.
    page[0] = 0x00;
    page[1] = 0x00;
    page[2] = 0x40;
    page[3] = 0xB9;

    const guest_phys: u64 = 0x4000_0000;
    try vm.mapMemory(0, guest_phys, page[0..page_size]);

    const target = try vm.preferredTarget();

    var vcpu = try vm.createVcpu(0);
    defer vcpu.destroy();

    try vcpu.init(target);
    try vcpu.setReg(REG_PC, guest_phys);
    // Unmapped address — the load will fault and exit with MMIO.
    try vcpu.setReg(REG_X0, 0xA000_0000);

    const reason = try vcpu.run();
    std.debug.print("kvm proof-of-life: exit reason = {d}\n", .{@intFromEnum(reason)});
    try std.testing.expectEqual(ExitReason.mmio, reason);
}
