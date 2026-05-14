//! snapshot-test — CLI surface for the .snaplet snapshot format.
//!
//! Subcommands:
//!   dump      stub in #16; wired up in #18/#19/#22+ when each section
//!             type gets its dumper.
//!   load      Parse a .snaplet from disk. Validates magic, version,
//!             arch, section bounds. With --expected-topology=<hex>,
//!             also checks the topology_hash. State injection into a
//!             VMM lands later.
//!   translate stub in #16; wired up alongside the cross-load tasks
//!             that need an interchange transform (#10/#14/#20).
//!   diff      Compare two .snaplet files. With --mask=sysreg=A,B,...
//!             ignores those named entries inside any VCPU section.
//!             Exit 0 on identical (after masking), 1 on real diff,
//!             2 on usage error.
//!
//! Exit codes:
//!   0  success / no diff
//!   1  validation failed / diff present
//!   2  usage error (bad args / unknown subcommand)

const std = @import("std");
const microvm = @import("microvm");
const snapshot = microvm.snapshot;
const snaplet_zip = microvm.snaplet_zip;

/// Read a (possibly gzip-compressed) .snaplet off disk and parse it.
/// Centralises the read + transparent-gunzip + decode the three
/// file-consuming subcommands share. Caller owns the returned
/// `Snaplet` and must `deinit()` it.
fn loadSnapletFile(allocator: std.mem.Allocator, path: []const u8) !snapshot.Snaplet {
    const raw = try std.Io.Dir.cwd().readFileAlloc(g_io, path, allocator, .limited(1 << 30));
    defer allocator.free(raw);
    const bytes = try snaplet_zip.decompress(allocator, raw);
    defer allocator.free(bytes);
    return snapshot.decode(allocator, bytes);
}

const Exit = enum(u8) { ok = 0, fail = 1, usage = 2 };

// One-shot global; set at the top of main(). Saves threading `io`
// through every helper for what is fundamentally a synchronous CLI.
var g_io: std.Io = undefined;

pub fn main(init: std.process.Init) !u8 {
    g_io = init.io;

    var it = init.minimal.args.iterate();
    _ = it.next(); // argv[0]

    const sub = it.next() orelse {
        try printUsage();
        return @intFromEnum(Exit.usage);
    };

    const allocator = init.gpa;

    if (eq(sub, "--help") or eq(sub, "-h") or eq(sub, "help")) {
        try printUsage();
        return @intFromEnum(Exit.ok);
    } else if (eq(sub, "dump")) {
        return @intFromEnum(try runDump(allocator, &it));
    } else if (eq(sub, "load")) {
        return @intFromEnum(try runLoad(allocator, &it));
    } else if (eq(sub, "translate")) {
        return @intFromEnum(try runTranslate(allocator, &it));
    } else if (eq(sub, "diff")) {
        return @intFromEnum(try runDiff(allocator, &it));
    } else if (eq(sub, "xload")) {
        return @intFromEnum(try runXload(allocator, &it));
    } else {
        try stderr("unknown subcommand: ");
        try stderr(sub);
        try stderr("\n");
        try printUsage();
        return @intFromEnum(Exit.usage);
    }
}

fn eq(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}

fn stderr(s: []const u8) !void {
    try std.Io.File.stderr().writeStreamingAll(g_io, s);
}

fn stdout(s: []const u8) !void {
    try std.Io.File.stdout().writeStreamingAll(g_io, s);
}

fn printUsage() !void {
    const u =
        \\snapshot-test — .snaplet snapshot tool
        \\
        \\Usage:
        \\  snapshot-test dump --vmm=<kvm|hvf> --config=<path> --halt-at=<expr> --section=<name> [--out=<file>]
        \\  snapshot-test load <file> [--expected-topology=<64-hex>]
        \\  snapshot-test translate --from=<kvm|hvf> --to=<kvm|hvf> <in> [--out=<file>]
        \\  snapshot-test diff <a> <b> [--mask=<kind>=<n1,n2,...>]
        \\
        \\dump/translate are not yet wired (they need the VMM state-extraction
        \\paths from tasks #18, #19, #22+). load and diff are fully usable.
        \\
        \\Exit codes: 0 ok, 1 validation failed / diff, 2 usage error.
        \\
    ;
    try stderr(u);
}

fn runDump(allocator: std.mem.Allocator, it: *std.process.Args.Iterator) !Exit {
    var vmm: []const u8 = "";
    var section: []const u8 = "";
    while (it.next()) |arg| {
        if (std.mem.startsWith(u8, arg, "--vmm=")) {
            vmm = arg["--vmm=".len..];
        } else if (std.mem.startsWith(u8, arg, "--section=")) {
            section = arg["--section=".len..];
        }
    }
    if (vmm.len == 0 or section.len == 0) {
        try stderr("dump: need --vmm=<kvm|hvf> and --section=<vcpu|...>\n");
        return .usage;
    }

    if (eq(section, "vcpu") and eq(vmm, "kvm")) {
        if (builtin.os.tag != .linux) {
            try stderr("dump --vmm=kvm only runs on Linux\n");
            return .fail;
        }
        return try dumpVcpuKvmCmd(allocator);
    }
    if (eq(section, "vcpu") and eq(vmm, "hvf")) {
        if (builtin.os.tag != .macos) {
            try stderr("dump --vmm=hvf only runs on macOS\n");
            return .fail;
        }
        return try dumpVcpuHvfCmd(allocator);
    }

    try stderr("dump: --vmm=");
    try stderr(vmm);
    try stderr(" --section=");
    try stderr(section);
    try stderr(": not yet wired\n");
    return .fail;
}

const builtin = @import("builtin");

fn dumpVcpuKvmCmd(allocator: std.mem.Allocator) !Exit {
    if (builtin.os.tag != .linux) return .fail;
    const kvm = microvm.kvm;
    const vcpu_dump = microvm.vcpu_dump;

    var k = kvm.Kvm.open_() catch {
        try stderr("dump: cannot open /dev/kvm\n");
        return .fail;
    };
    defer k.close_();

    var vm = k.createVm() catch {
        try stderr("dump: KVM_CREATE_VM failed\n");
        return .fail;
    };
    defer vm.destroy();

    var pref: kvm.VcpuInit = std.mem.zeroes(kvm.VcpuInit);
    const c = struct {
        extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
    };
    const PREF_TARGET: c_ulong = (2 << 30) | (@sizeOf(kvm.VcpuInit) << 16) |
        (@as(c_ulong, 0xae) << 8) | 0xaf;
    if (c.ioctl(vm.fd, PREF_TARGET, &pref) < 0) {
        try stderr("dump: KVM_ARM_PREFERRED_TARGET failed\n");
        return .fail;
    }

    var vcpu = vm.createVcpu(0) catch {
        try stderr("dump: KVM_CREATE_VCPU failed\n");
        return .fail;
    };
    defer vcpu.destroy();
    vcpu.init(pref) catch {
        try stderr("dump: KVM_ARM_VCPU_INIT failed\n");
        return .fail;
    };

    const payload = vcpu_dump.dumpKvm(allocator, vcpu.fd) catch |err| {
        try stderr("dump: dumpKvm failed: ");
        try stderr(@errorName(err));
        try stderr("\n");
        return .fail;
    };
    defer allocator.free(payload);

    // Wrap in a single-section .snaplet with topology hash placeholder.
    const topology = microvm.topology;
    const topo: topology.Topology = .{
        .ram_base = 0x4000_0000,
        .ram_size = 4 * 1024 * 1024 * 1024,
        .gic_dist_base = 0x0800_0000,
        .gic_redist_base = 0x1000_0000,
    };
    const sections = [_]snapshot.Section{
        .{ .tag = .vcpu, .id = 0, .payload = payload },
    };
    const bytes = try snapshot.encode(allocator, topo.hash(), &sections);
    defer allocator.free(bytes);
    _ = try std.Io.File.stdout().writeStreamingAll(g_io, bytes);
    return .ok;
}

fn runXload(allocator: std.mem.Allocator, it: *std.process.Args.Iterator) !Exit {
    // xload --vmm=<hvf|kvm> <in.snaplet>
    // Load the VCPU section into a fresh vCPU of the named backend,
    // then dump back to stdout. Used for task #20 cross-load.
    var vmm: []const u8 = "";
    var in_path: ?[]const u8 = null;
    while (it.next()) |arg| {
        if (std.mem.startsWith(u8, arg, "--vmm=")) {
            vmm = arg["--vmm=".len..];
        } else if (in_path == null) {
            in_path = arg;
        }
    }
    const path = in_path orelse {
        try stderr("xload: missing <in.snaplet>\n");
        return .usage;
    };
    if (vmm.len == 0) {
        try stderr("xload: --vmm=<hvf|kvm> required\n");
        return .usage;
    }

    var snap = loadSnapletFile(allocator, path) catch |err| {
        try stderr("xload: cannot load ");
        try stderr(path);
        try stderr(": ");
        try stderr(@errorName(err));
        try stderr("\n");
        return .fail;
    };
    defer snap.deinit();

    var vcpu_payload: ?[]const u8 = null;
    for (snap.sections) |s| {
        if (s.tag == .vcpu) {
            vcpu_payload = s.payload;
            break;
        }
    }
    const payload = vcpu_payload orelse {
        try stderr("xload: no vcpu section in input\n");
        return .fail;
    };

    if (eq(vmm, "kvm")) {
        if (builtin.os.tag != .linux) {
            try stderr("xload --vmm=kvm only runs on Linux\n");
            return .fail;
        }
        return try xloadKvm(allocator, payload);
    } else if (eq(vmm, "hvf")) {
        if (builtin.os.tag != .macos) {
            try stderr("xload --vmm=hvf only runs on macOS\n");
            return .fail;
        }
        return try xloadHvf(allocator, payload);
    }
    try stderr("xload: --vmm must be hvf or kvm\n");
    return .usage;
}

fn xloadHvf(allocator: std.mem.Allocator, payload: []const u8) !Exit {
    if (builtin.os.tag != .macos) return .fail;
    const hvf = microvm.hvf;
    const vcpu_dump = microvm.vcpu_dump;

    var vm = hvf.Vm.create() catch {
        try stderr("xload: hv_vm_create failed\n");
        return .fail;
    };
    defer vm.destroy();
    const vcpu = hvf.Vcpu.create() catch {
        try stderr("xload: hv_vcpu_create failed\n");
        return .fail;
    };
    defer vcpu.destroy();

    vcpu_dump.loadHvf(allocator, vcpu.handle, payload) catch |err| {
        try stderr("xload: loadHvf: ");
        try stderr(@errorName(err));
        try stderr("\n");
        return .fail;
    };
    const out = vcpu_dump.dumpHvf(allocator, vcpu.handle) catch |err| {
        try stderr("xload: dumpHvf: ");
        try stderr(@errorName(err));
        try stderr("\n");
        return .fail;
    };
    defer allocator.free(out);

    const topology = microvm.topology;
    const topo: topology.Topology = .{
        .ram_base = 0x4000_0000,
        .ram_size = 4 * 1024 * 1024 * 1024,
        .gic_dist_base = 0x0800_0000,
        .gic_redist_base = 0x1000_0000,
    };
    const sections = [_]snapshot.Section{
        .{ .tag = .vcpu, .id = 0, .payload = out },
    };
    const bytes = try snapshot.encode(allocator, topo.hash(), &sections);
    defer allocator.free(bytes);
    _ = try std.Io.File.stdout().writeStreamingAll(g_io, bytes);
    return .ok;
}

fn xloadKvm(allocator: std.mem.Allocator, payload: []const u8) !Exit {
    if (builtin.os.tag != .linux) return .fail;
    const kvm = microvm.kvm;
    const vcpu_dump = microvm.vcpu_dump;

    var k = kvm.Kvm.open_() catch {
        try stderr("xload: cannot open /dev/kvm\n");
        return .fail;
    };
    defer k.close_();
    var vm = k.createVm() catch {
        try stderr("xload: KVM_CREATE_VM failed\n");
        return .fail;
    };
    defer vm.destroy();
    var pref: kvm.VcpuInit = std.mem.zeroes(kvm.VcpuInit);
    const c = struct {
        extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
    };
    const PREF_TARGET: c_ulong = (2 << 30) | (@sizeOf(kvm.VcpuInit) << 16) |
        (@as(c_ulong, 0xae) << 8) | 0xaf;
    if (c.ioctl(vm.fd, PREF_TARGET, &pref) < 0) {
        try stderr("xload: KVM_ARM_PREFERRED_TARGET failed\n");
        return .fail;
    }
    var vcpu = vm.createVcpu(0) catch {
        try stderr("xload: KVM_CREATE_VCPU failed\n");
        return .fail;
    };
    defer vcpu.destroy();
    vcpu.init(pref) catch {
        try stderr("xload: KVM_ARM_VCPU_INIT failed\n");
        return .fail;
    };

    vcpu_dump.loadKvm(allocator, vcpu.fd, payload) catch |err| {
        try stderr("xload: loadKvm: ");
        try stderr(@errorName(err));
        try stderr("\n");
        return .fail;
    };
    const out = vcpu_dump.dumpKvm(allocator, vcpu.fd) catch |err| {
        try stderr("xload: dumpKvm: ");
        try stderr(@errorName(err));
        try stderr("\n");
        return .fail;
    };
    defer allocator.free(out);

    const topology = microvm.topology;
    const topo: topology.Topology = .{
        .ram_base = 0x4000_0000,
        .ram_size = 4 * 1024 * 1024 * 1024,
        .gic_dist_base = 0x0800_0000,
        .gic_redist_base = 0x1000_0000,
    };
    const sections = [_]snapshot.Section{
        .{ .tag = .vcpu, .id = 0, .payload = out },
    };
    const bytes = try snapshot.encode(allocator, topo.hash(), &sections);
    defer allocator.free(bytes);
    _ = try std.Io.File.stdout().writeStreamingAll(g_io, bytes);
    return .ok;
}

fn dumpVcpuHvfCmd(allocator: std.mem.Allocator) !Exit {
    if (builtin.os.tag != .macos) return .fail;
    const hvf = microvm.hvf;
    const vcpu_dump = microvm.vcpu_dump;

    var vm = hvf.Vm.create() catch {
        try stderr("dump: hv_vm_create failed (entitlement missing?)\n");
        return .fail;
    };
    defer vm.destroy();
    const vcpu = hvf.Vcpu.create() catch {
        try stderr("dump: hv_vcpu_create failed\n");
        return .fail;
    };
    defer vcpu.destroy();

    const payload = vcpu_dump.dumpHvf(allocator, vcpu.handle) catch |err| {
        try stderr("dump: dumpHvf failed: ");
        try stderr(@errorName(err));
        try stderr("\n");
        return .fail;
    };
    defer allocator.free(payload);

    const topology = microvm.topology;
    const topo: topology.Topology = .{
        .ram_base = 0x4000_0000,
        .ram_size = 4 * 1024 * 1024 * 1024,
        .gic_dist_base = 0x0800_0000,
        .gic_redist_base = 0x1000_0000,
    };
    const sections = [_]snapshot.Section{
        .{ .tag = .vcpu, .id = 0, .payload = payload },
    };
    const bytes = try snapshot.encode(allocator, topo.hash(), &sections);
    defer allocator.free(bytes);
    _ = try std.Io.File.stdout().writeStreamingAll(g_io, bytes);
    return .ok;
}

fn runTranslate(allocator: std.mem.Allocator, _: *std.process.Args.Iterator) !Exit {
    _ = allocator;
    try stderr("translate: not yet wired (lands with #10/#14/#20)\n");
    return .fail;
}

fn runLoad(allocator: std.mem.Allocator, it: *std.process.Args.Iterator) !Exit {
    var path_opt: ?[]const u8 = null;
    var expected_topo: ?[32]u8 = null;

    while (it.next()) |arg| {
        if (std.mem.startsWith(u8, arg, "--expected-topology=")) {
            const hex = arg["--expected-topology=".len..];
            expected_topo = parseHex32(hex) catch {
                try stderr("load: --expected-topology requires 64 hex chars\n");
                return .usage;
            };
        } else if (path_opt == null) {
            path_opt = arg;
        } else {
            try stderr("load: too many positional args\n");
            return .usage;
        }
    }

    const path = path_opt orelse {
        try stderr("load: missing <file>\n");
        return .usage;
    };

    var snap = loadSnapletFile(allocator, path) catch |err| {
        try stderr("load: cannot load ");
        try stderr(path);
        try stderr(": ");
        try stderr(@errorName(err));
        try stderr("\n");
        return .fail;
    };
    defer snap.deinit();

    if (expected_topo) |exp| {
        if (!std.mem.eql(u8, &exp, &snap.header.topology_hash)) {
            try stderr("load: topology mismatch\n");
            try stderr("  expected: ");
            try writeHex(&exp);
            try stderr("\n  actual:   ");
            try writeHex(&snap.header.topology_hash);
            try stderr("\n");
            return .fail;
        }
    }

    var buf: [256]u8 = undefined;
    const msg = try std.fmt.bufPrint(&buf, "load: ok ({d} section{s})\n", .{
        snap.sections.len,
        if (snap.sections.len == 1) "" else "s",
    });
    try stdout(msg);
    return .ok;
}

const Mask = struct {
    kind: []const u8 = "",
    names: [][]const u8 = &.{},
};

fn runDiff(allocator: std.mem.Allocator, it: *std.process.Args.Iterator) !Exit {
    var a_path: ?[]const u8 = null;
    var b_path: ?[]const u8 = null;
    var mask: Mask = .{};

    while (it.next()) |arg| {
        if (std.mem.startsWith(u8, arg, "--mask=")) {
            mask = parseMask(allocator, arg["--mask=".len..]) catch {
                try stderr("diff: malformed --mask (expected <kind>=<n1,n2,...>)\n");
                return .usage;
            };
        } else if (a_path == null) {
            a_path = arg;
        } else if (b_path == null) {
            b_path = arg;
        } else {
            try stderr("diff: too many positional args\n");
            return .usage;
        }
    }
    defer if (mask.names.len > 0) allocator.free(mask.names);

    const ap = a_path orelse {
        try stderr("diff: missing <a>\n");
        return .usage;
    };
    const bp = b_path orelse {
        try stderr("diff: missing <b>\n");
        return .usage;
    };

    var snap_a = readSnaplet(allocator, ap) catch return .fail;
    defer snap_a.deinit();
    var snap_b = readSnaplet(allocator, bp) catch return .fail;
    defer snap_b.deinit();

    return diffSnaplets(allocator, &snap_a, &snap_b, mask);
}

fn readSnaplet(allocator: std.mem.Allocator, path: []const u8) !snapshot.Snaplet {
    return loadSnapletFile(allocator, path) catch |err| {
        try stderr("diff: cannot load ");
        try stderr(path);
        try stderr(": ");
        try stderr(@errorName(err));
        try stderr("\n");
        return err;
    };
}

fn diffSnaplets(
    allocator: std.mem.Allocator,
    a: *snapshot.Snaplet,
    b: *snapshot.Snaplet,
    mask: Mask,
) !Exit {
    var differs = false;

    if (a.header.version != b.header.version) {
        try diffMsg("header.version", a.header.version, b.header.version);
        differs = true;
    }
    if (a.header.arch != b.header.arch) {
        try diffMsg("header.arch", a.header.arch, b.header.arch);
        differs = true;
    }
    if (!std.mem.eql(u8, &a.header.topology_hash, &b.header.topology_hash)) {
        try stderr("header.topology_hash differs\n");
        differs = true;
    }
    if (a.sections.len != b.sections.len) {
        try diffMsg("section_count", a.sections.len, b.sections.len);
        differs = true;
    }

    const n = @min(a.sections.len, b.sections.len);
    for (a.sections[0..n], b.sections[0..n], 0..) |sa, sb, idx| {
        if (sa.tag != sb.tag) {
            var buf: [128]u8 = undefined;
            const msg = try std.fmt.bufPrint(&buf, "section[{d}].tag differs ({d} vs {d})\n", .{ idx, @intFromEnum(sa.tag), @intFromEnum(sb.tag) });
            try stderr(msg);
            differs = true;
            continue;
        }
        if (sa.id != sb.id) {
            var buf: [128]u8 = undefined;
            const msg = try std.fmt.bufPrint(&buf, "section[{d}].id differs ({d} vs {d})\n", .{ idx, sa.id, sb.id });
            try stderr(msg);
            differs = true;
            continue;
        }

        if (sa.tag == .vcpu) {
            // VCPU sections always get structured per-entry diff. A
            // sysreg mask suppresses named entries; with no mask, every
            // diverging entry is reported by name.
            const names: []const []const u8 = if (eq(mask.kind, "sysreg")) mask.names else &.{};
            if (try diffVcpuMasked(allocator, idx, sa.payload, sb.payload, names)) {
                differs = true;
            }
        } else {
            if (!std.mem.eql(u8, sa.payload, sb.payload)) {
                var buf: [128]u8 = undefined;
                const msg = try std.fmt.bufPrint(&buf, "section[{d}] (tag={d} id={d}) payload differs ({d} vs {d} bytes)\n", .{ idx, @intFromEnum(sa.tag), sa.id, sa.payload.len, sb.payload.len });
                try stderr(msg);
                differs = true;
            }
        }
    }

    return if (differs) .fail else .ok;
}

fn diffVcpuMasked(
    allocator: std.mem.Allocator,
    section_idx: usize,
    a_payload: []const u8,
    b_payload: []const u8,
    masked_names: []const []const u8,
) !bool {
    const entries_a = try snapshot.decodeVcpuPayload(allocator, a_payload);
    defer allocator.free(entries_a);
    const entries_b = try snapshot.decodeVcpuPayload(allocator, b_payload);
    defer allocator.free(entries_b);

    // Auto-mask any reg the classifier flags as .mask or .translate.
    // These are bytes that legitimately diverge across hosts (timers,
    // counters, PMU). Explicit --mask=sysreg=... adds to this set.
    const classify = microvm.sysreg_classify.classify;

    var differs = false;

    // Build a name->index lookup for b.
    var b_index = std.StringHashMap(usize).init(allocator);
    defer b_index.deinit();
    for (entries_b, 0..) |e, i| {
        try b_index.put(e.name, i);
    }

    var seen_in_b = try allocator.alloc(bool, entries_b.len);
    defer allocator.free(seen_in_b);
    @memset(seen_in_b, false);

    for (entries_a) |ea| {
        if (isMasked(ea.name, masked_names)) continue;
        const cls_a = classify(ea.name);
        if (cls_a == .mask or cls_a == .translate) continue;
        const bi = b_index.get(ea.name) orelse {
            var buf: [256]u8 = undefined;
            const msg = try std.fmt.bufPrint(&buf, "section[{d}].vcpu.{s}: present in A, missing in B\n", .{ section_idx, ea.name });
            try stderr(msg);
            differs = true;
            continue;
        };
        seen_in_b[bi] = true;
        if (!std.mem.eql(u8, ea.value, entries_b[bi].value)) {
            var buf: [256]u8 = undefined;
            const msg = try std.fmt.bufPrint(&buf, "section[{d}].vcpu.{s}: value differs\n", .{ section_idx, ea.name });
            try stderr(msg);
            differs = true;
        }
    }
    for (entries_b, 0..) |eb, i| {
        if (seen_in_b[i]) continue;
        if (isMasked(eb.name, masked_names)) continue;
        const cls_b = classify(eb.name);
        if (cls_b == .mask or cls_b == .translate) continue;
        var buf: [256]u8 = undefined;
        const msg = try std.fmt.bufPrint(&buf, "section[{d}].vcpu.{s}: present in B, missing in A\n", .{ section_idx, eb.name });
        try stderr(msg);
        differs = true;
    }
    return differs;
}

fn isMasked(name: []const u8, masked_names: []const []const u8) bool {
    for (masked_names) |m| if (eq(name, m)) return true;
    return false;
}

fn parseMask(allocator: std.mem.Allocator, s: []const u8) !Mask {
    const eq_idx = std.mem.indexOfScalar(u8, s, '=') orelse return error.MissingEquals;
    const kind = s[0..eq_idx];
    const rest = s[eq_idx + 1 ..];

    var count: usize = 1;
    for (rest) |c| {
        if (c == ',') count += 1;
    }
    const names = try allocator.alloc([]const u8, count);
    var i: usize = 0;
    var start: usize = 0;
    for (rest, 0..) |c, idx| {
        if (c == ',') {
            names[i] = rest[start..idx];
            i += 1;
            start = idx + 1;
        }
    }
    names[i] = rest[start..];
    return .{ .kind = kind, .names = names };
}

fn diffMsg(label: []const u8, a: anytype, b: anytype) !void {
    var buf: [128]u8 = undefined;
    const msg = try std.fmt.bufPrint(&buf, "{s} differs ({any} vs {any})\n", .{ label, a, b });
    try stderr(msg);
}

fn parseHex32(s: []const u8) ![32]u8 {
    if (s.len != 64) return error.InvalidLength;
    var out: [32]u8 = undefined;
    for (0..32) |i| {
        const hi = std.fmt.charToDigit(s[i * 2], 16) catch return error.InvalidHex;
        const lo = std.fmt.charToDigit(s[i * 2 + 1], 16) catch return error.InvalidHex;
        out[i] = (hi << 4) | lo;
    }
    return out;
}

fn writeHex(bytes: []const u8) !void {
    const hex = "0123456789abcdef";
    var buf: [128]u8 = undefined;
    var i: usize = 0;
    for (bytes) |b| {
        buf[i] = hex[(b >> 4) & 0xf];
        buf[i + 1] = hex[b & 0xf];
        i += 2;
    }
    try stderr(buf[0..i]);
}
