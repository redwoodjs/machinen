//! sysreg-probe — enumerate arm64 sysregs reachable on the current
//! VMM backend. Output (sorted by encoding) goes to stdout, one line:
//!
//!   <encoding-hex>  <name>  <status>  [<value-hex>]
//!
//! status is one of:
//!   ok           — get_sys_reg succeeded (value follows, 16 hex chars)
//!   denied       — HV_DENIED on HVF, EPERM on KVM
//!   unsupported  — HV_UNSUPPORTED on HVF, ENOENT on KVM
//!   error=<n>    — anything else (numeric backend return code)
//!
//! Use:
//!   sysreg-probe > test-fixtures/snapshot/sysregs-<backend>.txt
//!
//! On macOS this probes every entry in HV_SYS_REG_* (148 today). On
//! Linux it calls KVM_GET_REG_LIST and joins each returned ID against
//! the same name table, leaving unmatched entries with name=?.

const std = @import("std");
const builtin = @import("builtin");
const microvm = @import("microvm");
const sysreg_names = microvm.sysreg_names;

var g_io: std.Io = undefined;

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;
    const allocator = init.gpa;

    return switch (builtin.os.tag) {
        .macos => try probe_hvf(allocator),
        .linux => try probe_kvm(allocator),
        else => {
            try stderr("sysreg-probe: unsupported host\n");
            return 2;
        },
    };
}

fn stdout(s: []const u8) !void {
    try std.Io.File.stdout().writeStreamingAll(g_io, s);
}
fn stderr(s: []const u8) !void {
    try std.Io.File.stderr().writeStreamingAll(g_io, s);
}

// -----------------------------------------------------------------
// HVF probe (macOS)

fn probe_hvf(_: std.mem.Allocator) !u8 {
    if (builtin.os.tag != .macos) unreachable;
    const hvf = microvm.hvf;
    var vm = try hvf.Vm.create();
    defer vm.destroy();

    const vcpu = try hvf.Vcpu.create();
    defer vcpu.destroy();

    // hv_vcpu_get_sys_reg's raw extern signature (no Zig wrapper:
    // microvm.hvf only exposes the two regs it uses for boot).
    const c = struct {
        extern "c" fn hv_vcpu_get_sys_reg(vcpu: u64, reg: u32, value: *u64) i32;
    };

    var lines = std.ArrayListUnmanaged([]u8).empty;
    defer lines.deinit(std.heap.page_allocator);

    for (sysreg_names.table) |entry| {
        var value: u64 = 0;
        const rc = c.hv_vcpu_get_sys_reg(vcpu.handle, entry.encoding, &value);
        var line_buf: [256]u8 = undefined;
        const line = try format_probe_line(&line_buf, entry.encoding, entry.name, rc, value);
        try lines.append(std.heap.page_allocator, try std.heap.page_allocator.dupe(u8, line));
    }

    std.mem.sort([]u8, lines.items, {}, less_than_line);
    for (lines.items) |l| {
        try stdout(l);
        try stdout("\n");
        std.heap.page_allocator.free(l);
    }
    return 0;
}

fn format_probe_line(buf: []u8, encoding: u16, name: []const u8, rc: i32, value: u64) ![]u8 {
    // HVF return codes (hv_return_t in hv_error.h):
    //   HV_SUCCESS      = 0
    //   HV_ERROR        = 0xfae94001
    //   HV_BUSY         = 0xfae94002
    //   HV_BAD_ARGUMENT = 0xfae94003
    //   HV_ILLEGAL_GUEST_STATE = 0xfae94004
    //   HV_NO_RESOURCES = 0xfae94005
    //   HV_NO_DEVICE    = 0xfae94006
    //   HV_DENIED       = 0xfae94007
    //   HV_UNSUPPORTED  = 0xfae9400f
    if (rc == 0) {
        return std.fmt.bufPrint(buf, "0x{x:04}\t{s}\tok\t0x{x:016}", .{ encoding, name, value });
    }
    const status: []const u8 = switch (@as(u32, @bitCast(rc))) {
        0xfae94007 => "denied",
        0xfae9400f => "unsupported",
        else => "error",
    };
    if (std.mem.eql(u8, status, "error")) {
        return std.fmt.bufPrint(buf, "0x{x:04}\t{s}\terror=0x{x:08}", .{ encoding, name, @as(u32, @bitCast(rc)) });
    }
    return std.fmt.bufPrint(buf, "0x{x:04}\t{s}\t{s}", .{ encoding, name, status });
}

fn less_than_line(_: void, a: []const u8, b: []const u8) bool {
    return std.mem.lessThan(u8, a, b);
}

// -----------------------------------------------------------------
// KVM probe (Linux)

const KVM = struct {
    // /linux/kvm.h ioctl numbers for arm64.
    const KVMIO: u8 = 0xae;

    // Constructed via _IO/_IOR/_IOW/_IOWR macros from <linux/ioctl.h>.
    // The KVM ABI is direction-strict — wrong dir = ENOTTY at ioctl.
    //   KVM_CREATE_VM         _IO   (no payload)
    //   KVM_CREATE_VCPU       _IO   (no payload)
    //   KVM_ARM_PREFERRED_TARGET  _IOR  (kernel writes into struct)
    //   KVM_ARM_VCPU_INIT     _IOW  (userspace writes into struct)
    //   KVM_GET_ONE_REG       _IOW  (userspace passes id+addr)
    //   KVM_GET_REG_LIST      _IOWR (bidirectional)
    const KVM_CREATE_VM: c_ulong = io(0x01);
    const KVM_CREATE_VCPU: c_ulong = io(0x41);
    const KVM_ARM_VCPU_INIT: c_ulong = iow(0xae, kvm_vcpu_init);
    const KVM_ARM_PREFERRED_TARGET: c_ulong = ior(0xaf, kvm_vcpu_init);
    const KVM_GET_REG_LIST: c_ulong = iowr(0xb0, kvm_reg_list);
    const KVM_GET_ONE_REG: c_ulong = iow(0xab, kvm_one_reg);

    const kvm_vcpu_init = extern struct {
        target: u32,
        features: [7]u32,
    };

    const kvm_reg_list = extern struct {
        n: u64,
        // followed by [n]u64
    };

    const kvm_one_reg = extern struct {
        id: u64,
        addr: u64, // pointer to value
    };

    fn io(nr: u8) c_ulong {
        return ioc(0, KVMIO, nr, void);
    }
    fn ior(nr: u8, comptime T: type) c_ulong {
        return ioc(2, KVMIO, nr, T);
    }
    fn iow(nr: u8, comptime T: type) c_ulong {
        return ioc(1, KVMIO, nr, T);
    }
    fn iowr(nr: u8, comptime T: type) c_ulong {
        return ioc(3, KVMIO, nr, T);
    }
    fn ioc(dir: u8, ty: u8, nr: u8, comptime T: type) c_ulong {
        const size: c_ulong = if (T == void) 0 else @sizeOf(T);
        return (@as(c_ulong, dir) << 30) | (size << 16) | (@as(c_ulong, ty) << 8) | nr;
    }
};

// KVM register-ID format. We only need the bottom 16 bits + arm64
// system-reg discriminator. See arch/arm64/include/uapi/asm/kvm.h.
const KVM_REG_ARM64: u64 = 0x6000_0000_0000_0000;
const KVM_REG_SIZE_U64: u64 = 0x0030_0000_0000_0000;
const KVM_REG_ARM64_SYSREG: u64 = 0x0013_0000;
const KVM_REG_ARM64_SYSREG_ENC_MASK: u64 = 0xffff;

fn probe_kvm(allocator: std.mem.Allocator) !u8 {
    if (builtin.os.tag != .linux) unreachable;

    const c = struct {
        extern "c" fn open(path: [*:0]const u8, flags: c_int) c_int;
        extern "c" fn close(fd: c_int) c_int;
        extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
        extern "c" fn __errno_location() *c_int;
    };

    const kvm_fd = c.open("/dev/kvm", 2);
    if (kvm_fd < 0) {
        try stderr("sysreg-probe: open /dev/kvm failed\n");
        return 1;
    }
    std.debug.assert(kvm_fd >= 0);
    defer _ = c.close(kvm_fd);

    const vm_fd = c.ioctl(kvm_fd, KVM.KVM_CREATE_VM, @as(c_long, 0));
    if (vm_fd < 0) {
        try stderr("sysreg-probe: KVM_CREATE_VM failed\n");
        return 1;
    }
    std.debug.assert(vm_fd >= 0);
    defer _ = c.close(vm_fd);

    const vcpu_fd = c.ioctl(vm_fd, KVM.KVM_CREATE_VCPU, @as(c_long, 0));
    if (vcpu_fd < 0) {
        try stderr("sysreg-probe: KVM_CREATE_VCPU failed\n");
        return 1;
    }
    std.debug.assert(vcpu_fd >= 0);
    defer _ = c.close(vcpu_fd);

    var init: KVM.kvm_vcpu_init = .{ .target = 0, .features = @splat(0) };
    if (c.ioctl(vm_fd, KVM.KVM_ARM_PREFERRED_TARGET, &init) < 0) {
        try stderr("sysreg-probe: KVM_ARM_PREFERRED_TARGET failed\n");
        return 1;
    }
    if (c.ioctl(vcpu_fd, KVM.KVM_ARM_VCPU_INIT, &init) < 0) {
        try stderr("sysreg-probe: KVM_ARM_VCPU_INIT failed\n");
        return 1;
    }

    // Two-call dance: first call with n=0 returns the required size in n
    // (and ENOENT/E2BIG). Second call allocates and fills.
    var probe: KVM.kvm_reg_list = .{ .n = 0 };
    _ = c.ioctl(vcpu_fd, KVM.KVM_GET_REG_LIST, &probe);
    const n = probe.n;

    const buf = try allocator.alloc(u8, 8 + n * 8);
    defer allocator.free(buf);
    @memcpy(buf[0..8], std.mem.asBytes(&n));
    if (c.ioctl(vcpu_fd, KVM.KVM_GET_REG_LIST, buf.ptr) < 0) {
        try stderr("sysreg-probe: KVM_GET_REG_LIST failed\n");
        return 1;
    }

    var name_lookup = std.AutoHashMap(u16, []const u8).init(allocator);
    defer name_lookup.deinit();
    for (sysreg_names.table) |e| try name_lookup.put(e.encoding, e.name);

    var lines = std.ArrayListUnmanaged([]u8).empty;
    defer lines.deinit(std.heap.page_allocator);

    var i: usize = 0;
    while (i < n) : (i += 1) {
        const id = std.mem.readInt(u64, buf[8 + i * 8 ..][0..8], .little);
        // Filter to AArch64 sysregs (KVM_REG_ARM64 | KVM_REG_ARM64_SYSREG).
        if ((id & KVM_REG_ARM64) != KVM_REG_ARM64) continue;
        if ((id & 0x00ff_0000) != KVM_REG_ARM64_SYSREG) continue;

        const enc: u16 = @intCast(id & KVM_REG_ARM64_SYSREG_ENC_MASK);
        var synth_buf: [32]u8 = undefined;
        const name = if (name_lookup.get(enc)) |known|
            known
        else blk: {
            // Apple's hv_sys_reg_t enum doesn't cover this register;
            // fall back to the ARM-canonical "S<op0>_<op1>_C<CRn>_C<CRm>_<op2>"
            // generic form. Same bit layout HVF uses.
            const op0: u8 = @intCast((enc >> 14) & 0x3);
            const op1: u8 = @intCast((enc >> 11) & 0x7);
            const crn: u8 = @intCast((enc >> 7) & 0xf);
            const crm: u8 = @intCast((enc >> 3) & 0xf);
            const op2: u8 = @intCast(enc & 0x7);
            break :blk try std.fmt.bufPrint(&synth_buf, "S{d}_{d}_C{d}_C{d}_{d}", .{ op0, op1, crn, crm, op2 });
        };

        // Try to read the value. Not strictly required, but lets us
        // confirm the register actually responds (some are read-only,
        // some return EPERM).
        var value: u64 = 0;
        const one: KVM.kvm_one_reg = .{ .id = id, .addr = @intFromPtr(&value) };
        const rc = c.ioctl(vcpu_fd, KVM.KVM_GET_ONE_REG, &one);

        var line_buf: [256]u8 = undefined;
        const line = if (rc == 0)
            try std.fmt.bufPrint(&line_buf, "0x{x:04}\t{s}\tok\t0x{x:016}", .{ enc, name, value })
        else
            try std.fmt.bufPrint(&line_buf, "0x{x:04}\t{s}\terror=errno", .{ enc, name });

        try lines.append(std.heap.page_allocator, try std.heap.page_allocator.dupe(u8, line));
    }

    std.mem.sort([]u8, lines.items, {}, less_than_line);
    for (lines.items) |l| {
        try stdout(l);
        try stdout("\n");
        std.heap.page_allocator.free(l);
    }
    return 0;
}
