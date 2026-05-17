//! Linux /dev/kvm ioctl wrapper — the KVM-side twin of hvf.zig.
//!
//! Scope: just enough surface for a boot loop. VM + vCPU lifecycle,
//! guest-RAM mapping via KVM_SET_USER_MEMORY_REGION, arm64 register
//! get/set via KVM_GET/SET_ONE_REG, the vCPU run loop and MMIO exit
//! decode. GIC wiring (distributor + redistributor for in-kernel
//! vgic_v3) is stubbed here — a real boot path will flesh that out.
//!
//! Layered so boot_kvm.zig can call into a kvm.Vm/kvm.Vcpu
//! pair that has the same shape as hvf.Vm/hvf.Vcpu. Not yet wired
//! into a Linux boot path; this commit is the ioctl scaffold.

const std = @import("std");
const builtin = @import("builtin");

const assert = std.debug.assert;

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
pub const KVM_GET_SUPPORTED_CPUID = iowr(KVMIO, 0x05, @sizeOf(Cpuid2Header));

// x86 VM setup helpers. KVM_SET_TSS_ADDR is required before creating an
// in-kernel irqchip on Intel hosts; KVM_CREATE_PIT2 gives Linux a legacy
// PIT to calibrate timers against during early boot.
pub const KVM_SET_TSS_ADDR = io_(KVMIO, 0x47);
pub const KVM_CREATE_PIT2 = iow(KVMIO, 0x77, @sizeOf(PitConfig));
pub const KVM_GET_PIT2 = ior(KVMIO, 0x9f, @sizeOf(PitState2));
pub const KVM_SET_PIT2 = iow(KVMIO, 0xa0, @sizeOf(PitState2));

pub const KVM_CREATE_VCPU = io_(KVMIO, 0x41);
pub const KVM_GET_DIRTY_LOG = iow(KVMIO, 0x42, @sizeOf(DirtyLog));
pub const KVM_RUN = io_(KVMIO, 0x80);

pub const KVM_SET_USER_MEMORY_REGION = iow(KVMIO, 0x46, @sizeOf(UserspaceMemoryRegion));
pub const KVM_CLEAR_DIRTY_LOG = iowr(KVMIO, 0xC0, @sizeOf(ClearDirtyLog));
pub const KVM_CREATE_IRQCHIP = io_(KVMIO, 0x60);
pub const KVM_IRQ_LINE = iow(KVMIO, 0x61, @sizeOf(IrqLevel));
pub const KVM_GET_IRQCHIP = iowr(KVMIO, 0x62, @sizeOf(Irqchip));
pub const KVM_SET_IRQCHIP = ior(KVMIO, 0x63, @sizeOf(Irqchip));

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
pub const KVM_SET_CPUID2 = iow(KVMIO, 0x90, @sizeOf(Cpuid2Header));

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

pub const KVM_MEM_LOG_DIRTY_PAGES: u32 = 1 << 0;

pub const UserspaceMemoryRegion = extern struct {
    slot: u32,
    flags: u32,
    guest_phys_addr: u64,
    memory_size: u64,
    userspace_addr: u64,
};

pub const DirtyLog = extern struct {
    slot: u32,
    padding1: u32 = 0,
    dirty_bitmap: u64,
};

pub const ClearDirtyLog = extern struct {
    slot: u32,
    num_pages: u32,
    first_page: u64,
    dirty_bitmap: u64,
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

pub const PitConfig = extern struct {
    flags: u32,
    pad: [15]u32 = @splat(0),
};

pub const PitChannelState = extern struct {
    count: u32,
    latched_count: u16,
    count_latched: u8,
    status_latched: u8,
    status: u8,
    read_state: u8,
    write_state: u8,
    write_latch: u8,
    rw_mode: u8,
    mode: u8,
    bcd: u8,
    gate: u8,
    count_load_time: i64,
};

pub const PitState2 = extern struct {
    channels: [3]PitChannelState,
    flags: u32,
    reserved: [9]u32,
};

pub const KVM_PIT_SPEAKER_DUMMY: u32 = 1;
pub const KVM_IRQCHIP_PIC_MASTER: u32 = 0;
pub const KVM_IRQCHIP_PIC_SLAVE: u32 = 1;
pub const KVM_IRQCHIP_IOAPIC: u32 = 2;

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

// VM type helper for arm64 IPA sizing. Passing 0 to KVM_CREATE_VM keeps
// the kernel default; KVM_VM_TYPE_ARM_IPA_SIZE(n) requests n IPA bits.
pub const KVM_VM_TYPE_ARM_IPA_SIZE_MASK: u64 = 0xff;
pub fn KVM_VM_TYPE_ARM_IPA_SIZE(bits: u64) u64 {
    return bits & KVM_VM_TYPE_ARM_IPA_SIZE_MASK;
}

// KVM_CHECK_EXTENSION capabilities used by the optional nested-EL2 path.
pub const KVM_CAP_ARM_VM_IPA_SIZE: c_ulong = 165;
pub const KVM_CAP_ARM_EL2: c_ulong = 240;

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
pub const KVM_ARM_VCPU_HAS_EL2: u32 = 7;
// Pointer authentication — must be requested as a pair. HVF gives the
// guest active FEAT_PAuth, so a HVF-sourced snapshot's RAM holds
// signed pointers; the KVM vCPU must also implement FEAT_PAuth (with
// the snapshot's keys restored) or those pointers can't be used.
pub const KVM_ARM_VCPU_PTRAUTH_ADDRESS: u32 = 5;
pub const KVM_ARM_VCPU_PTRAUTH_GENERIC: u32 = 6;

// KVM_IRQ_LINE encoding (arm64).
pub const KVM_ARM_IRQ_TYPE_SHIFT: u5 = 24;
pub const KVM_ARM_IRQ_TYPE_CPU: u32 = 0;
pub const KVM_ARM_IRQ_TYPE_SPI: u32 = 1;
pub const KVM_ARM_IRQ_TYPE_PPI: u32 = 2;

/// Encode `KVM_ARM_IRQ_TYPE_SPI | (32 + spi_id)` for `Vm.setIrq`.
/// `spi_id` is the device-tree-relative SPI number (e.g. PL011 = 1,
/// virtio-blk slot 1 = 17). Without the type bits, KVM treats the
/// call as a legacy CPU-line IRQ (type 0) and silently drops virtio
/// doorbells, which manifests as guest hangs after QueueNotify.
pub fn irqSpi(spi_id: u32) u32 {
    // INTID lives in bits 15:0 of the encoded value; anything wider
    // would either collide with the type field or wrap silently.
    assert(spi_id < (1 << 16) - 32);
    const intid: u32 = 32 + spi_id;
    assert(intid >= 32);
    return (KVM_ARM_IRQ_TYPE_SPI << KVM_ARM_IRQ_TYPE_SHIFT) | intid;
}

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

pub const CpuidEntry2 = extern struct {
    function: u32,
    index: u32,
    flags: u32,
    eax: u32,
    ebx: u32,
    ecx: u32,
    edx: u32,
    padding: [3]u32 = @splat(0),
};

pub const Cpuid2Header = extern struct {
    nent: u32,
    padding: u32 = 0,
};

pub const max_cpuid_entries: usize = 256;

pub const Cpuid2 = extern struct {
    nent: u32,
    padding: u32 = 0,
    entries: [max_cpuid_entries]CpuidEntry2 = @splat(std.mem.zeroes(CpuidEntry2)),
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

pub const IoDirection = enum(u8) {
    in = 0,
    out = 1,
    _,
};

/// I/O-port exit payload (kvm_run.io).
pub const IoExit = extern struct {
    direction: u8,
    size: u8,
    port: u16,
    count: u32,
    data_offset: u64,
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
// Layout asserts — KVM ABI is stable; if any of these trip, our
// struct definitions drifted from <linux/kvm.h> and every ioctl in
// this file will silently corrupt kernel memory.

comptime {
    // _IOC dir bits.
    assert(IOC_NONE == 0);
    assert(IOC_WRITE == 1);
    assert(IOC_READ == 2);
    assert(KVMIO == 0xAE);

    // KVM_IRQ_LINE arm64 encoding constants.
    assert(KVM_ARM_IRQ_TYPE_SHIFT == 24);
    assert(KVM_ARM_IRQ_TYPE_CPU == 0);
    assert(KVM_ARM_IRQ_TYPE_SPI == 1);
    assert(KVM_ARM_IRQ_TYPE_PPI == 2);

    // UserspaceMemoryRegion (32 B).
    assert(@sizeOf(UserspaceMemoryRegion) == 32);
    assert(@offsetOf(UserspaceMemoryRegion, "slot") == 0);
    assert(@offsetOf(UserspaceMemoryRegion, "flags") == 4);
    assert(@offsetOf(UserspaceMemoryRegion, "guest_phys_addr") == 8);
    assert(@offsetOf(UserspaceMemoryRegion, "memory_size") == 16);
    assert(@offsetOf(UserspaceMemoryRegion, "userspace_addr") == 24);

    // VcpuInit (32 B: u32 target + 7 × u32 features).
    assert(@sizeOf(VcpuInit) == 32);
    assert(@offsetOf(VcpuInit, "target") == 0);
    assert(@offsetOf(VcpuInit, "features") == 4);

    // OneReg / IrqLevel / PIT config.
    assert(@sizeOf(OneReg) == 16);
    assert(@offsetOf(OneReg, "id") == 0);
    assert(@offsetOf(OneReg, "addr") == 8);
    assert(@sizeOf(IrqLevel) == 8);
    assert(@offsetOf(IrqLevel, "irq") == 0);
    assert(@offsetOf(IrqLevel, "level") == 4);
    assert(@sizeOf(PitConfig) == 64);
    assert(@offsetOf(PitConfig, "flags") == 0);
    assert(@sizeOf(PitChannelState) == 24);
    assert(@offsetOf(PitChannelState, "count_load_time") == 16);
    assert(@sizeOf(PitState2) == 112);
    assert(@offsetOf(PitState2, "flags") == 72);
    assert(@offsetOf(PitConfig, "pad") == 4);

    // CreateDevice / DeviceAttr.
    assert(@sizeOf(CreateDevice) == 12);
    assert(@offsetOf(CreateDevice, "type") == 0);
    assert(@offsetOf(CreateDevice, "fd") == 4);
    assert(@offsetOf(CreateDevice, "flags") == 8);
    assert(@sizeOf(DeviceAttr) == 24);
    assert(@offsetOf(DeviceAttr, "flags") == 0);
    assert(@offsetOf(DeviceAttr, "group") == 4);
    assert(@offsetOf(DeviceAttr, "attr") == 8);
    assert(@offsetOf(DeviceAttr, "addr") == 16);

    // x86 register banks — sizes are baked into the ioctl numbers.
    assert(@sizeOf(CpuidEntry2) == 40);
    assert(@sizeOf(Cpuid2Header) == 8);
    assert(@offsetOf(CpuidEntry2, "function") == 0);
    assert(@offsetOf(CpuidEntry2, "eax") == 12);
    assert(@offsetOf(CpuidEntry2, "padding") == 28);
    assert(@offsetOf(Cpuid2, "entries") == 8);
    assert(@sizeOf(X86Regs) == 144);
    assert(@sizeOf(X86Segment) == 24);
    assert(@sizeOf(X86Dtable) == 16);
    assert(@sizeOf(X86Sregs) == 312);

    // kvm_run union payloads we touch (offsets relative to union base).
    assert(@sizeOf(IoExit) == 16);
    assert(@offsetOf(IoExit, "direction") == 0);
    assert(@offsetOf(IoExit, "size") == 1);
    assert(@offsetOf(IoExit, "port") == 2);
    assert(@offsetOf(IoExit, "count") == 4);
    assert(@offsetOf(IoExit, "data_offset") == 8);
    assert(@sizeOf(MmioExit) == 24);
    assert(@offsetOf(MmioExit, "phys_addr") == 0);
    assert(@offsetOf(MmioExit, "data") == 8);
    assert(@offsetOf(MmioExit, "len") == 16);
    assert(@offsetOf(MmioExit, "is_write") == 20);
    assert(@sizeOf(SystemEventExit) == 136);
    assert(@offsetOf(SystemEventExit, "type") == 0);
    assert(@offsetOf(SystemEventExit, "ndata") == 4);
    assert(@offsetOf(SystemEventExit, "data") == 8);

    // arm64 core-reg encoding (see armCoreReg).
    assert(REG_ARM64 == 0x6000_0000_0000_0000);
    assert(REG_SIZE_U64 == 0x0030_0000_0000_0000);
    assert(REG_ARM_CORE == 0x0010_0000);
    assert(REG_PC == 0x6030_0000_0010_0040);
    assert(REG_PSTATE == 0x6030_0000_0010_0042);
    assert(REG_X0 == 0x6030_0000_0010_0000);
}

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
// errno value for a syscall interrupted by a signal (Linux generic).
const EINTR: c_int = 4;
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
    KvmCreatePitFailed,
    KvmSetTssAddrFailed,
    KvmIrqLineFailed,
    KvmMmapRunFailed,
    KvmCheckExtensionFailed,
    Unsupported,
};

// ---------------------------------------------------------------
// Thin wrappers. The Vm/Vcpu types mirror hvf.zig naming so the
// boot_{hvf,kvm}.zig pair can stay structurally symmetric.

/// Top-level handle. Owns /dev/kvm and the VM fd.
pub const Kvm = struct {
    kvm_fd: c_int,
    vcpu_mmap_size: usize,

    pub fn open_() !Kvm {
        const fd = open("/dev/kvm", O_RDWR | O_CLOEXEC);
        if (fd < 0) return error.KvmDeviceOpenFailed;
        errdefer _ = close(fd);
        assert(fd >= 0);

        // glibc's ioctl is declared `int ioctl(int, unsigned long,
        // ...)` — the third arg is variadic. Even for "no payload"
        // requests we have to pass a value, else the variadic slot
        // is uninitialised and the kernel's copy_from_user reads
        // garbage. Pass an explicit 0.
        const ver = ioctl(fd, @as(c_ulong, KVM_GET_API_VERSION), @as(c_ulong, 0));
        if (ver != 12) return error.KvmApiMismatch;

        const sz = ioctl(fd, @as(c_ulong, KVM_GET_VCPU_MMAP_SIZE), @as(c_ulong, 0));
        if (sz <= 0) return error.Unsupported;
        // Mmap size must be at least one page; anything smaller is a
        // kernel bug we can't safely cast or mmap.
        assert(sz >= 4096);
        return .{ .kvm_fd = fd, .vcpu_mmap_size = @intCast(sz) };
    }

    pub fn close_(self: *Kvm) void {
        assert(self.kvm_fd >= 0);
        _ = close(self.kvm_fd);
    }

    pub fn checkExtension(self: *Kvm, cap: c_ulong) !c_int {
        assert(self.kvm_fd >= 0);
        const r = ioctl(self.kvm_fd, KVM_CHECK_EXTENSION, cap);
        if (r < 0) return error.KvmCheckExtensionFailed;
        return r;
    }

    pub fn armEl2Supported(self: *Kvm) bool {
        return (self.checkExtension(KVM_CAP_ARM_EL2) catch 0) > 0;
    }

    pub fn supportedCpuid(self: *Kvm) !Cpuid2 {
        assert(self.kvm_fd >= 0);
        var out = Cpuid2{ .nent = max_cpuid_entries };
        if (ioctl(self.kvm_fd, KVM_GET_SUPPORTED_CPUID, &out) != 0) {
            return error.Unsupported;
        }
        assert(out.nent <= max_cpuid_entries);
        return out;
    }

    pub fn createVm(self: *Kvm) !Vm {
        return self.createVmWithType(0);
    }

    pub fn createVmWithType(self: *Kvm, vm_type: c_ulong) !Vm {
        assert(self.kvm_fd >= 0);
        assert(self.vcpu_mmap_size >= 4096);
        const fd = ioctl(self.kvm_fd, KVM_CREATE_VM, vm_type);
        if (fd < 0) return error.KvmCreateVmFailed;
        assert(fd != self.kvm_fd);
        return .{ .fd = fd, .parent = self };
    }
};

pub const Vm = struct {
    fd: c_int,
    parent: *Kvm,

    pub fn destroy(self: *Vm) void {
        assert(self.fd >= 0);
        _ = close(self.fd);
    }

    /// Map `host_buf` into the guest at `guest_phys_addr`.
    pub fn mapMemory(
        self: *Vm,
        slot: u32,
        guest_phys_addr: u64,
        host_buf: []u8,
    ) !void {
        return self.mapMemoryWithFlags(slot, guest_phys_addr, host_buf, 0);
    }

    pub fn mapMemoryWithFlags(
        self: *Vm,
        slot: u32,
        guest_phys_addr: u64,
        host_buf: []u8,
        flags: u32,
    ) !void {
        assert(self.fd >= 0);
        assert(host_buf.len > 0);
        // KVM requires both the guest-physical address and the host
        // userspace address to be page-aligned, and the size to be a
        // multiple of the page size. Mis-aligned mappings are a
        // programmer bug — KVM rejects with -EINVAL but we want a
        // clearer signal in debug builds.
        assert(guest_phys_addr % 4096 == 0);
        assert(@intFromPtr(host_buf.ptr) % 4096 == 0);
        assert(host_buf.len % 4096 == 0);
        const r = UserspaceMemoryRegion{
            .slot = slot,
            .flags = flags,
            .guest_phys_addr = guest_phys_addr,
            .memory_size = host_buf.len,
            .userspace_addr = @intFromPtr(host_buf.ptr),
        };
        if (ioctl(self.fd, KVM_SET_USER_MEMORY_REGION, &r) != 0) {
            return error.KvmSetMemoryFailed;
        }
    }

    pub fn getDirtyLog(self: *Vm, allocator: std.mem.Allocator, slot: u32, page_count: usize) ![]u64 {
        assert(page_count > 0);
        const word_count = (page_count + 63) / 64;
        const bits = try allocator.alloc(u64, word_count);
        errdefer allocator.free(bits);
        @memset(bits, 0);
        var log = DirtyLog{ .slot = slot, .dirty_bitmap = @intFromPtr(bits.ptr) };
        if (ioctl(self.fd, KVM_GET_DIRTY_LOG, &log) != 0) return error.KvmGetDirtyLogFailed;
        return bits;
    }

    pub fn clearDirtyLog(self: *Vm, slot: u32, bits: []const u64, page_count: usize) void {
        if (bits.len == 0 or page_count == 0) return;
        var clear = ClearDirtyLog{
            .slot = slot,
            .num_pages = @intCast(page_count),
            .first_page = 0,
            .dirty_bitmap = @intFromPtr(bits.ptr),
        };
        // Older kernels either clear on KVM_GET_DIRTY_LOG or lack this
        // ioctl. Best effort: correctness survives as cumulative deltas.
        _ = ioctl(self.fd, KVM_CLEAR_DIRTY_LOG, &clear);
    }

    /// x86 only: set the per-VM TSS address KVM uses for ring transitions.
    /// Must happen before createIrqchip() on Intel hosts.
    pub fn setTssAddr(self: *Vm, addr: u64) !void {
        assert(self.fd >= 0);
        assert(addr % 4096 == 0);
        if (ioctl(self.fd, KVM_SET_TSS_ADDR, @as(c_ulong, @intCast(addr))) != 0) {
            return error.KvmSetTssAddrFailed;
        }
    }

    /// x86 only: create the in-kernel PIC + IOAPIC irqchip.
    pub fn createIrqchip(self: *Vm) !void {
        assert(self.fd >= 0);
        if (ioctl(self.fd, KVM_CREATE_IRQCHIP, @as(c_ulong, 0)) != 0) {
            return error.KvmCreateIrqchipFailed;
        }
    }

    /// x86 only: create an in-kernel PIT so early Linux timer calibration works.
    pub fn createPit2(self: *Vm) !void {
        assert(self.fd >= 0);
        var cfg = PitConfig{ .flags = KVM_PIT_SPEAKER_DUMMY };
        if (ioctl(self.fd, KVM_CREATE_PIT2, &cfg) != 0) {
            return error.KvmCreatePitFailed;
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
        assert(self.fd >= 0);
        // Distributor and redistributor MMIO windows must occupy
        // distinct, non-zero, 64 KiB-aligned guest-physical regions.
        assert(dist_addr != 0);
        assert(redist_addr != 0);
        assert(dist_addr != redist_addr);
        assert(dist_addr % 0x10000 == 0);
        assert(redist_addr % 0x10000 == 0);
        var args = CreateDevice{
            .type = KVM_DEV_TYPE_ARM_VGIC_V3,
            .fd = 0,
            .flags = 0,
        };
        if (ioctl(self.fd, KVM_CREATE_DEVICE, &args) != 0) {
            return error.KvmCreateIrqchipFailed;
        }
        const gic_fd: c_int = @intCast(args.fd);
        assert(gic_fd >= 0);
        assert(gic_fd != self.fd);
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

    /// Raise or lower an interrupt line. `irq` uses KVM's arm64
    /// encoding (uapi/linux/kvm.h):
    ///
    ///   bits 27:24 = type (KVM_ARM_IRQ_TYPE_SPI = 1, _PPI = 2, _CPU = 0)
    ///   bits 23:16 = vCPU index (PPI/CPU only; SPI is system-wide)
    ///   bits 15:0  = irq_number; for SPI this is the GIC INTID
    ///                (private-IRQs offset 32 already included; KVM
    ///                subtracts 32 internally before talking to vgic).
    ///
    /// Use `irqSpi(spi_id)` to encode the type+id correctly. Without
    /// the type bits, KVM treats the call as a CPU-line legacy IRQ
    /// (type 0) which silently drops virtio doorbells.
    pub fn setIrq(self: *Vm, irq: u32, level: u32) !void {
        assert(self.fd >= 0);
        // KVM_IRQ_LINE level is a boolean (0 = deassert, 1 = assert).
        // Anything else is a programmer bug — the kernel ignores high
        // bits but a non-{0,1} value usually means we forgot to mask.
        assert(level <= 1);
        var lvl = IrqLevel{ .irq = irq, .level = level };
        if (ioctl(self.fd, KVM_IRQ_LINE, &lvl) != 0) return error.KvmIrqLineFailed;
    }

    pub fn getIrqchip(self: *Vm, chip_id: u32) !Irqchip {
        assert(self.fd >= 0);
        var chip = Irqchip{ .chip_id = chip_id, .pad = 0, .chip = @splat(0) };
        if (ioctl(self.fd, KVM_GET_IRQCHIP, &chip) != 0) return error.KvmGetRegFailed;
        return chip;
    }

    pub fn setIrqchip(self: *Vm, chip: Irqchip) !void {
        assert(self.fd >= 0);
        var v = chip;
        if (ioctl(self.fd, KVM_SET_IRQCHIP, &v) != 0) return error.KvmSetRegFailed;
    }

    pub fn getPit2(self: *Vm) !PitState2 {
        assert(self.fd >= 0);
        var pit: PitState2 = undefined;
        if (ioctl(self.fd, KVM_GET_PIT2, &pit) != 0) return error.KvmGetRegFailed;
        return pit;
    }

    pub fn setPit2(self: *Vm, pit: PitState2) !void {
        assert(self.fd >= 0);
        var v = pit;
        if (ioctl(self.fd, KVM_SET_PIT2, &v) != 0) return error.KvmSetRegFailed;
    }

    pub fn createVcpu(self: *Vm, id: u32) !Vcpu {
        assert(self.fd >= 0);
        assert(self.parent.vcpu_mmap_size >= 4096);
        const fd = ioctl(self.fd, KVM_CREATE_VCPU, @as(c_ulong, id));
        if (fd < 0) return error.KvmCreateVcpuFailed;
        assert(fd != self.fd);
        errdefer _ = close(fd);
        const run_ptr = mmap(null, self.parent.vcpu_mmap_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
        if (run_ptr == MAP_FAILED or run_ptr == null) return error.KvmMmapRunFailed;
        return .{ .fd = fd, .run_page = run_ptr.?, .run_size = self.parent.vcpu_mmap_size };
    }

    /// Fill in `out` with the host's preferred CPU target for this
    /// VM's arm64 vCPUs. Caller passes that to Vcpu.init.
    pub fn preferredTarget(self: *Vm) !VcpuInit {
        assert(self.fd >= 0);
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
        assert(self.fd >= 0);
        assert(self.vm_fd >= 0);
        assert(self.fd != self.vm_fd);
        _ = close(self.fd);
    }

    pub fn finalize(self: *Gic) !void {
        assert(self.fd >= 0);
        assert(self.vm_fd >= 0);
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
        assert(self.fd >= 0);
        assert(self.run_size >= 4096);
        _ = munmap(self.run_page, self.run_size);
        _ = close(self.fd);
    }

    pub fn init(self: *Vcpu, vi: VcpuInit) !void {
        assert(self.fd >= 0);
        var v = vi;
        if (ioctl(self.fd, KVM_ARM_VCPU_INIT, &v) != 0) {
            return error.KvmVcpuInitFailed;
        }
    }

    pub fn setReg(self: *Vcpu, id: u64, value: u64) !void {
        assert(self.fd >= 0);
        // Reg id 0 is reserved; KVM rejects with -ENOENT.
        assert(id != 0);
        var v = value;
        const r = OneReg{ .id = id, .addr = @intFromPtr(&v) };
        if (ioctl(self.fd, KVM_SET_ONE_REG, &r) != 0) {
            return error.KvmSetRegFailed;
        }
    }

    pub fn getReg(self: *Vcpu, id: u64) !u64 {
        assert(self.fd >= 0);
        assert(id != 0);
        var v: u64 = 0;
        const r = OneReg{ .id = id, .addr = @intFromPtr(&v) };
        if (ioctl(self.fd, KVM_GET_ONE_REG, &r) != 0) {
            return error.KvmGetRegFailed;
        }
        return v;
    }

    pub fn run(self: *Vcpu) !ExitReason {
        assert(self.fd >= 0);
        // We at minimum need to read exit_reason (offset 8, 4 bytes)
        // and decode the union at offset 0x20. Anything smaller and
        // the mmap is a kernel bug we can't safely indirect through.
        assert(self.run_size >= 0x20 + @sizeOf(SystemEventExit));
        if (ioctl(self.fd, KVM_RUN, @as(c_ulong, 0)) != 0) {
            // A signal (e.g. the SIGUSR1 snapshot trigger) interrupts
            // KVM_RUN with EINTR. Surface it as a benign .intr exit so
            // the run loop can act on the pending signal rather than
            // aborting the whole boot with error.KvmRunFailed.
            if (errno() == EINTR) return .intr;
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

    /// Read the I/O-port exit payload. Call only when run() returned .io.
    pub fn ioExit(self: *Vcpu) IoExit {
        assert(self.run_size >= 0x20 + @sizeOf(IoExit));
        const base: [*]u8 = @ptrCast(self.run_page);
        var out: IoExit = undefined;
        @memcpy(std.mem.asBytes(&out), base[0x20..][0..@sizeOf(IoExit)]);
        assert(out.size == 1 or out.size == 2 or out.size == 4);
        assert(out.count > 0);
        assert(out.data_offset < self.run_size);
        return out;
    }

    /// Read the first scalar attached to a KVM_EXIT_IO OUT payload.
    pub fn ioDataValue(self: *Vcpu, ev: IoExit) u32 {
        assert(ev.size == 1 or ev.size == 2 or ev.size == 4);
        assert(ev.count > 0);
        assert(ev.data_offset + ev.size <= self.run_size);
        const base: [*]const u8 = @ptrCast(self.run_page);
        const data = base[ev.data_offset..][0..ev.size];
        return switch (ev.size) {
            1 => data[0],
            2 => std.mem.readInt(u16, data[0..2], .little),
            4 => std.mem.readInt(u32, data[0..4], .little),
            else => unreachable,
        };
    }

    /// Fill the first scalar attached to a KVM_EXIT_IO IN payload.
    pub fn writeIoReadData(self: *Vcpu, ev: IoExit, value: u32) void {
        assert(ev.size == 1 or ev.size == 2 or ev.size == 4);
        assert(ev.count > 0);
        assert(ev.data_offset + ev.size <= self.run_size);
        const base: [*]u8 = @ptrCast(self.run_page);
        const data = base[ev.data_offset..][0..ev.size];
        switch (ev.size) {
            1 => data[0] = @truncate(value),
            2 => std.mem.writeInt(u16, data[0..2], @truncate(value), .little),
            4 => std.mem.writeInt(u32, data[0..4], value, .little),
            else => unreachable,
        }
    }

    /// Read the MMIO exit payload. Call only when run() returned
    /// .mmio. The union starts at offset 0x20 inside kvm_run (right
    /// after `apic_base` at 0x18), on builds without the S390
    /// extension — which matches x86_64 and arm64.
    pub fn mmioExit(self: *Vcpu) MmioExit {
        assert(self.run_size >= 0x20 + @sizeOf(MmioExit));
        const base: [*]u8 = @ptrCast(self.run_page);
        var out: MmioExit = undefined;
        @memcpy(std.mem.asBytes(&out), base[0x20..][0..@sizeOf(MmioExit)]);
        // The kernel never emits len > 8 (mmio.data is 8 bytes); a
        // wider value means we read the wrong offset.
        assert(out.len <= 8);
        assert(out.is_write <= 1);
        return out;
    }

    /// Read the SYSTEM_EVENT exit payload. Used for PSCI SHUTDOWN /
    /// RESET. Same struct union as MMIO; offset 0x20 inside kvm_run.
    pub fn systemEventExit(self: *Vcpu) SystemEventExit {
        assert(self.run_size >= 0x20 + @sizeOf(SystemEventExit));
        const base: [*]u8 = @ptrCast(self.run_page);
        var out: SystemEventExit = undefined;
        @memcpy(std.mem.asBytes(&out), base[0x20..][0..@sizeOf(SystemEventExit)]);
        // ndata bounds the populated portion of `data` and must fit.
        assert(out.ndata <= out.data.len);
        return out;
    }

    /// When handling an MMIO READ exit, the guest expects us to
    /// fill `kvm_run.mmio.data[0..len]` with the register contents
    /// before the next `KVM_RUN`. `mmio.data` lives at 0x20 + 8 =
    /// 0x28 in the kvm_run page.
    pub fn writeMmioReadData(self: *Vcpu, value: u64, len: u32) void {
        assert(self.run_size >= 0x28 + 8);
        // mmio.data is 8 bytes; len > 8 would corrupt the next field.
        assert(len <= 8);
        assert(len > 0);
        const base: [*]u8 = @ptrCast(self.run_page);
        const slot: []u8 = base[0x28 .. 0x28 + 8];
        std.mem.writeInt(u64, slot[0..8], value, .little);
    }

    // x86-specific register access. arm64 uses setReg/getReg above.

    pub fn setCpuid2(self: *Vcpu, cpuid: *const Cpuid2) !void {
        assert(self.fd >= 0);
        assert(cpuid.nent <= max_cpuid_entries);
        if (ioctl(self.fd, KVM_SET_CPUID2, cpuid) != 0) return error.Unsupported;
    }

    pub fn getRegsX86(self: *Vcpu) !X86Regs {
        assert(self.fd >= 0);
        var r: X86Regs = undefined;
        if (ioctl(self.fd, KVM_GET_REGS, &r) != 0) return error.KvmGetRegFailed;
        return r;
    }

    pub fn setRegsX86(self: *Vcpu, r: X86Regs) !void {
        assert(self.fd >= 0);
        var v = r;
        if (ioctl(self.fd, KVM_SET_REGS, &v) != 0) return error.KvmSetRegFailed;
    }

    pub fn getSregsX86(self: *Vcpu) !X86Sregs {
        assert(self.fd >= 0);
        var s: X86Sregs = undefined;
        if (ioctl(self.fd, KVM_GET_SREGS, &s) != 0) return error.KvmGetRegFailed;
        return s;
    }

    pub fn setSregsX86(self: *Vcpu, s: X86Sregs) !void {
        assert(self.fd >= 0);
        var v = s;
        if (ioctl(self.fd, KVM_SET_SREGS, &v) != 0) return error.KvmSetRegFailed;
    }
};

// =============================================================
// Tests — layout + ioctl-number constants.
// =============================================================

test "KVM arm64 nested constants match uapi" {
    try std.testing.expectEqual(@as(c_ulong, 165), KVM_CAP_ARM_VM_IPA_SIZE);
    try std.testing.expectEqual(@as(c_ulong, 240), KVM_CAP_ARM_EL2);
    try std.testing.expectEqual(@as(u32, 7), KVM_ARM_VCPU_HAS_EL2);
    try std.testing.expectEqual(@as(u64, 0), KVM_VM_TYPE_ARM_IPA_SIZE(0));
    try std.testing.expectEqual(@as(u64, 40), KVM_VM_TYPE_ARM_IPA_SIZE(40));
    try std.testing.expectEqual(@as(u64, 0xff), KVM_VM_TYPE_ARM_IPA_SIZE(0x1ff));
}

test "KVMIO ioctl numbers match their documented kernel values" {
    // Values grabbed from <linux/kvm.h> on arm64. If any of these
    // trip, our _IOC macros or our struct sizes drifted.
    try std.testing.expectEqual(@as(u32, 0xAE00), KVM_GET_API_VERSION);
    try std.testing.expectEqual(@as(u32, 0xAE01), KVM_CREATE_VM);
    try std.testing.expectEqual(@as(u32, 0xAE03), KVM_CHECK_EXTENSION);
    try std.testing.expectEqual(@as(u32, 0xAE04), KVM_GET_VCPU_MMAP_SIZE);
    try std.testing.expectEqual(@as(u32, 0xC008AE05), KVM_GET_SUPPORTED_CPUID);
    try std.testing.expectEqual(@as(u32, 0xAE47), KVM_SET_TSS_ADDR);
    try std.testing.expectEqual(@as(u32, 0x4040AE77), KVM_CREATE_PIT2);
    try std.testing.expectEqual(@as(u32, 0x8070AE9F), KVM_GET_PIT2);
    try std.testing.expectEqual(@as(u32, 0x4070AEA0), KVM_SET_PIT2);
    try std.testing.expectEqual(@as(u32, 0xAE41), KVM_CREATE_VCPU);
    try std.testing.expectEqual(@as(u32, 0xAE80), KVM_RUN);
    try std.testing.expectEqual(@as(u32, 0x4020AE46), KVM_SET_USER_MEMORY_REGION);
    try std.testing.expectEqual(@as(u32, 0xAE60), KVM_CREATE_IRQCHIP);
    try std.testing.expectEqual(@as(u32, 0x4008AE61), KVM_IRQ_LINE);
    try std.testing.expectEqual(@as(u32, 0xC208AE62), KVM_GET_IRQCHIP);
    try std.testing.expectEqual(@as(u32, 0x8208AE63), KVM_SET_IRQCHIP);
    try std.testing.expectEqual(@as(u32, 0x4020AEAE), KVM_ARM_VCPU_INIT);
    try std.testing.expectEqual(@as(u32, 0x8020AEAF), KVM_ARM_PREFERRED_TARGET);
    try std.testing.expectEqual(@as(u32, 0x4010AEAB), KVM_GET_ONE_REG);
    try std.testing.expectEqual(@as(u32, 0x4010AEAC), KVM_SET_ONE_REG);
    // x86 banks. Sizes are 144 (regs) and 312 (sregs) — hard locks.
    try std.testing.expectEqual(@as(u32, 0x8090AE81), KVM_GET_REGS);
    try std.testing.expectEqual(@as(u32, 0x4090AE82), KVM_SET_REGS);
    try std.testing.expectEqual(@as(u32, 0x8138AE83), KVM_GET_SREGS);
    try std.testing.expectEqual(@as(u32, 0x4138AE84), KVM_SET_SREGS);
    try std.testing.expectEqual(@as(u32, 0x4008AE90), KVM_SET_CPUID2);
}

test "struct sizes match what _IOC embeds" {
    // If either side drifts the ioctl number changes and the kernel
    // rejects the call. Lock the sizes.
    try std.testing.expectEqual(@as(usize, 32), @sizeOf(UserspaceMemoryRegion));
    try std.testing.expectEqual(@as(usize, 32), @sizeOf(VcpuInit));
    try std.testing.expectEqual(@as(usize, 16), @sizeOf(OneReg));
    try std.testing.expectEqual(@as(usize, 8), @sizeOf(IrqLevel));
    try std.testing.expectEqual(@as(usize, 64), @sizeOf(PitConfig));
    try std.testing.expectEqual(@as(usize, 24), @sizeOf(PitChannelState));
    try std.testing.expectEqual(@as(usize, 112), @sizeOf(PitState2));
    try std.testing.expectEqual(@as(usize, 16), @sizeOf(IoExit));
    try std.testing.expectEqual(@as(usize, 40), @sizeOf(CpuidEntry2));
    try std.testing.expectEqual(@as(usize, 8), @sizeOf(Cpuid2Header));
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
    // sure CHECK_EXTENSION is wired through the wrapper.
    const cap_user_memory: c_ulong = 3;
    const has_user_memory = try kvm.checkExtension(cap_user_memory);
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
