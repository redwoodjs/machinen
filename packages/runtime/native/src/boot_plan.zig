// Pure boot-planning rules shared by the native `boot-plan` command.
//
// TypeScript still owns effects such as mkdir, fd opening, gvproxy startup,
// and VMM spawn. This module owns the deterministic decisions that turn boot
// options into memory ceilings, guest env defaults, vsock/env strings, VMM
// argv, and validation errors. Keeping these rules native lets later PRs move
// more boot setup without scattering policy across TS and Zig.

const std = @import("std");

const assert = std.debug.assert;

const memory_floor_mib: u64 = 512;
const memory_default_ceiling_mib: u64 = 4096;
const default_cpu_max_vcpus: u64 = 1;
const default_cpu_weight: u64 = 100;
const min_cpu_weight: u64 = 1;
const max_cpu_weight: u64 = 10_000;
const max_live_mounts = 5;
const restore_command = [_][]const u8{"/sbin/machinen-restore"};
const poweroff_command = [_][]const u8{"/sbin/machinen-poweroff"};

pub const RootDiskMode = enum {
    unset,
    false_value,
    path,
    true_value,
};

pub const ResourcesMemory = struct {
    max_mib: u64,
    reclaim: ?[]const u8,
};

pub const CpuResourcesInput = struct {
    max_vcpus: ?u64 = null,
    quota_cpus: ?f64 = null,
    weight: ?u64 = null,
};

pub const CpuPolicyPlan = struct {
    max_vcpus: u64,
    quota_cpus: ?f64,
    weight: u64,
};

pub const EnvPair = struct {
    key: []const u8,
    value: []const u8,
};

pub const GuestEnvInput = struct {
    env: []const EnvPair,
    name: ?[]const u8 = null,
    vsock_uds_path: ?[]const u8 = null,
};

pub const GuestHostnameInput = struct {
    pid: ?i64 = null,
    name: ?[]const u8 = null,
};

pub const VsockPlanInput = struct {
    existing_spec: ?[]const u8 = null,
    auto_uds_path: ?[]const u8 = null,
};

pub const VsockPlan = struct {
    uds_path: ?[]const u8,
    vmm_vsock: ?[]const u8,
};

pub const PortForwardMapping = struct {
    host_port: i64,
    guest_port: i64,
    host_addr: ?[]const u8 = null,
};

pub const PortForwardValidation = union(enum) {
    ok,
    invalid_host_port: i64,
    invalid_guest_port: i64,
    duplicate_host_port: u16,
};

pub const PdeathsigInput = struct {
    detached: bool = false,
    pdeathsig: ?bool = null,
};

pub const VmmArgvInput = struct {
    binary: ?[]const u8 = null,
    args: []const []const u8 = &.{},
    pdeathsig_path: ?[]const u8 = null,
};

pub const VmmArgvPlan = struct {
    command: ?[]const u8,
    args: []const []const u8,
};

pub const BundleCommandInput = struct {
    explicit_cmd: ?[]const []const u8 = null,
    image_cmd: ?[]const []const u8 = null,
    snapshot_restore: bool = false,
    vmstate_restore: bool = false,
    live_mounts: []const LiveMount = &.{},
    port_forwards: []const PortForwardMapping = &.{},
    cpu_policy: ?CpuPolicyPlan = null,
    cpu_control_status: ?[]const u8 = null,
    cpu_control_reason: ?[]const u8 = null,
    vmstate: RegistryVmstateInput = .{},
};

pub const BundleEnvInput = struct {
    image_env: []const EnvPair = &.{},
    guest_env: []const EnvPair = &.{},
};

pub const ProvisionGuestCpu = enum {
    arm64,
    amd64,
};

pub const ProvisionAssetsInput = struct {
    guest_cpu: ProvisionGuestCpu = .arm64,
};

pub const ProvisionAssetsPlan = struct {
    cpu: []const u8,
    kernel_asset: []const u8,
    dtb_asset: ?[]const u8,
    rootfs_asset: []const u8,
};

pub const ProvisionBootInput = struct {
    base_path: ?[]const u8 = null,
    kernel_path: ?[]const u8 = null,
    dtb_path: ?[]const u8 = null,
    uds_path: ?[]const u8 = null,
    scratch_disk_path: ?[]const u8 = null,
    root_disk_path: ?[]const u8 = null,
};

pub const ProvisionBootPlan = struct {
    image_path: ?[]const u8,
    kernel_path: ?[]const u8,
    dtb_path: ?[]const u8,
    vmm_vsock: ?[]const u8,
    cmd: []const []const u8,
    env: []const EnvPair,
    snapshot_path: ?[]const u8,
    root_disk_path: ?[]const u8,
};

pub const ProvisionWorkloadPlan = struct {
    tar_to_disk_command: []const u8,
    poweroff_command: []const u8,
};

pub const ProvisionRepackInput = struct {
    disk_path: ?[]const u8 = null,
    out_path: ?[]const u8 = null,
    extract_dir: ?[]const u8 = null,
};

pub const ProvisionRepackPlan = struct {
    extract_args: []const []const u8,
    targz_args: []const []const u8,
};

pub const ProvisionImageConfigInput = struct {
    has_cmd: bool = false,
    cmd: []const []const u8 = &.{},
    has_env: bool = false,
    env: []const EnvPair = &.{},
};

pub const ProvisionImageConfigPlan = struct {
    has_config: bool,
    has_cmd: bool,
    cmd: []const []const u8,
    has_env: bool,
    env: []const EnvPair,
};

pub const ProvisionRuntimeInput = struct {
    work_dir: ?[]const u8 = null,
    scratch_size_bytes: ?u64 = null,
    timeout_ms: ?u64 = null,
};

pub const ProvisionRuntimePlan = struct {
    scratch_size_bytes: u64,
    deadline_ms: u64,
    disk_path: ?[]const u8,
    root_disk_path: ?[]const u8,
    uds_path: ?[]const u8,
};

pub const KernelDtbInput = struct {
    kernel_path: ?[]const u8 = null,
    dtb_path: ?[]const u8 = null,
};

pub const KernelDtbPlan = struct {
    vmm_kernel: ?[]const u8,
    vmm_dtb: ?[]const u8,
};

pub const VmstateEnvInput = struct {
    state_path: ?[]const u8 = null,
    restore_path: ?[]const u8 = null,
    enable_timing: bool = false,
    existing_timing: ?[]const u8 = null,
};

pub const VmstateEnvPlan = struct {
    snapshot_path: ?[]const u8,
    restore_path: ?[]const u8,
    vmstate_timing: ?[]const u8,
};

pub const LiveMountInput = struct {
    host: []const u8,
    guest: []const u8,
    mode: ?[]const u8 = null,
};

pub const LiveMount = struct {
    host: []const u8,
    guest: []const u8,
    mode: []const u8,
    tag: []const u8,
};

pub const StatsFileInput = struct {
    existing_path: ?[]const u8 = null,
    planned_path: ?[]const u8 = null,
};

pub const StatsFilePlan = struct {
    stats_file_path: ?[]const u8,
    vmm_stats_file: ?[]const u8,
};

pub const ScratchDiskMode = enum {
    unset,
    false_value,
    path,
    auto,
};

pub const ScratchDiskInput = struct {
    mode: ScratchDiskMode = .unset,
    has_cmd: bool = false,
    has_image: bool = false,
    snapshot_path: ?[]const u8 = null,
    restore_clone_path: ?[]const u8 = null,
    auto_path: ?[]const u8 = null,
};

pub const ScratchDiskPlan = struct {
    action: []const u8,
    disk_path: ?[]const u8,
    per_boot_snap_disk: ?[]const u8,
    vmm_disk: ?[]const u8,
};

pub const RootDiskRuntimeMode = enum {
    none,
    path,
    restore,
    cached,
};

pub const RootDiskRuntimeInput = struct {
    mode: RootDiskRuntimeMode = .none,
    source_path: ?[]const u8 = null,
    clone_path: ?[]const u8 = null,
};

pub const RootDiskRuntimePlan = struct {
    action: []const u8,
    source_path: ?[]const u8,
    target_path: ?[]const u8,
    per_boot_root_disk: ?[]const u8,
    vmm_root_disk: ?[]const u8,
};

pub const MountDiskRuntimeMode = enum {
    none,
    restore,
    fresh,
};

pub const MountDiskRuntimeInput = struct {
    mode: MountDiskRuntimeMode = .none,
    lower_path: ?[]const u8 = null,
    upper_path: ?[]const u8 = null,
    source_upper_path: ?[]const u8 = null,
    guest: ?[]const u8 = null,
    upper_size_bytes: ?u64 = null,
};

pub const MountDiskRuntimePlan = struct {
    action: []const u8,
    lower_path: ?[]const u8,
    upper_path: ?[]const u8,
    source_upper_path: ?[]const u8,
    guest: ?[]const u8,
    upper_size_bytes: ?u64,
};

pub const RegistryCleanupInput = struct {
    per_boot_root_disk: ?[]const u8 = null,
    per_boot_snap_disk: ?[]const u8 = null,
    per_boot_mount_upper: ?[]const u8 = null,
    bundle_temp_dir: ?[]const u8 = null,
    vsock_temp_dir: ?[]const u8 = null,
    stats_temp_dir: ?[]const u8 = null,
    gv_socket_dir: ?[]const u8 = null,
    cpu_cgroup_path: ?[]const u8 = null,
};

pub const RegistryMountDiskInput = struct {
    guest: ?[]const u8 = null,
    lower_path: ?[]const u8 = null,
    upper_path: ?[]const u8 = null,
};

pub const RegistryMountDiskPlan = struct {
    guest: []const u8,
    lower_path: []const u8,
    upper_path: []const u8,
};

pub const RegistryLiveMountPlan = struct {
    guest: []const u8,
    host: []const u8,
    mode: []const u8,
};

pub const RegistryPortForwardPlan = struct {
    host_port: i64,
    guest_port: i64,
    host_addr: ?[]const u8,
};

pub const RegistryCpuPlan = struct {
    max_vcpus: u64,
    quota_cpus: ?f64,
    weight: u64,
    enforcement_status: []const u8,
    enforcement_reason: ?[]const u8,
};

pub const RegistryVmstateInput = struct {
    state_path: ?[]const u8 = null,
    chain_id: ?[]const u8 = null,
    checkpoint_parent: ?[]const u8 = null,
    checkpoint_sequence: ?u64 = null,
};

pub const RegistryVmstatePlan = struct {
    state_path: ?[]const u8,
    chain_id: ?[]const u8,
    checkpoint_parent: ?[]const u8,
    checkpoint_sequence: ?u64,
};

pub const RegistryShapeInput = struct {
    source_image_path: ?[]const u8 = null,
    per_boot_root_disk: ?[]const u8 = null,
    caller_root_disk_path: ?[]const u8 = null,
    cleanup: RegistryCleanupInput = .{},
    mount_disk: RegistryMountDiskInput = .{},
    live_mounts: []const LiveMount = &.{},
    port_forwards: []const PortForwardMapping = &.{},
    cpu_policy: ?CpuPolicyPlan = null,
    cpu_control_status: ?[]const u8 = null,
    cpu_control_reason: ?[]const u8 = null,
    vmstate: RegistryVmstateInput = .{},
};

pub const RegistryShapePlan = struct {
    source_image_path: ?[]const u8,
    root_disk_path: ?[]const u8,
    root_disk_mode: []const u8,
    cleanup_paths: []const []const u8,
    mount_disk: ?RegistryMountDiskPlan,
    live_mounts: []const RegistryLiveMountPlan,
    port_forwards: []const RegistryPortForwardPlan,
    cpu: ?RegistryCpuPlan,
    vmstate: RegistryVmstatePlan,
};

pub const MachinenConfigInput = struct {
    guest_cwd: ?[]const u8 = null,
    image_cwd: ?[]const u8 = null,
};

pub const Input = struct {
    memory_mib: ?u64 = null,
    resources_memory: ?ResourcesMemory = null,
    auto_memory_mib: ?u64 = null,
    host_total_bytes: ?u64 = null,
    vmm_memory_preset: bool = false,
    has_image: bool = false,
    has_cmd: bool = false,
    has_snapshot: bool = false,
    root_disk: RootDiskMode = .unset,
    guest_cwd: ?[]const u8 = null,
    mount_guest: ?[]const u8 = null,
};

pub const Plan = struct {
    memory_ceiling_mib: ?u64,
    vmm_memory_mib: ?u64,
    wants_root_disk: bool,
    needs_initramfs: bool,
    normalized_mount_guest: ?[]const u8,
};

pub const PlanError = error{
    OutOfMemory,
    InvalidMemory,
    ConflictingMemory,
    InvalidReclaim,
    InvalidCpuMaxVcpus,
    UnsupportedCpuMaxVcpus,
    InvalidCpuQuotaCpus,
    CpuQuotaExceedsMaxVcpus,
    InvalidCpuWeight,
    CmdWithoutImage,
    RootDiskWithoutImage,
    MissingAutoMemory,
    InvalidGuestCwdAbsolute,
    InvalidGuestCwdNul,
    InvalidMountGuestAbsolute,
    InvalidMountGuestRoot,
    TooManyLiveMounts,
    InvalidLiveMountMode,
    MissingBundleCommand,
    MissingScratchPath,
    MissingRootDiskRuntimePath,
    MissingMountDiskRuntimeField,
    IncompleteRegistryMountDisk,
    MissingProvisionRepackField,
    MissingRegistryCpuStatus,
    MissingRegistryVmstateField,
};

pub fn planPdeathsig(input: PdeathsigInput) bool {
    assert(@sizeOf(PdeathsigInput) > 0);

    if (input.detached) return false;
    return input.pdeathsig orelse true;
}

pub fn planGuestHostname(allocator: std.mem.Allocator, input: GuestHostnameInput) !?[]const u8 {
    assert(@sizeOf(GuestHostnameInput) > 0);

    const pid = input.pid orelse return null;
    const safe_name = try sanitizeHostnameName(allocator, input.name orelse "");
    defer allocator.free(safe_name);
    if (safe_name.len == 0) {
        const hostname = try std.fmt.allocPrint(allocator, "vm-{d}", .{pid});
        return hostname;
    }
    const hostname = try std.fmt.allocPrint(allocator, "vm-{d}-{s}", .{ pid, safe_name });
    return hostname;
}

fn sanitizeHostnameName(allocator: std.mem.Allocator, name: []const u8) ![]const u8 {
    assert(@sizeOf(std.mem.Allocator) > 0);

    var output = try std.ArrayList(u8).initCapacity(allocator, name.len);
    errdefer output.deinit(allocator);
    for (name) |c| {
        if (isHostnameAlnum(c)) {
            output.appendAssumeCapacity(std.ascii.toLower(c));
        } else if (output.items.len > 0 and output.items[output.items.len - 1] != '-') {
            output.appendAssumeCapacity('-');
        }
    }
    while (output.items.len > 0 and output.items[output.items.len - 1] == '-') {
        _ = output.pop();
    }
    return output.toOwnedSlice(allocator);
}

fn isHostnameAlnum(c: u8) bool {
    return (c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or (c >= '0' and c <= '9');
}

pub fn planNestedEnv(nested: bool) ?[]const u8 {
    assert(@sizeOf(bool) > 0);

    return if (nested) "1" else null;
}

pub fn planCpuResources(input: ?CpuResourcesInput) PlanError!?CpuPolicyPlan {
    const cpu = input orelse return null;
    const max_vcpus = cpu.max_vcpus orelse default_cpu_max_vcpus;
    if (max_vcpus < 1) return error.InvalidCpuMaxVcpus;
    if (max_vcpus != default_cpu_max_vcpus) return error.UnsupportedCpuMaxVcpus;

    const quota_cpus = if (cpu.quota_cpus) |quota| blk: {
        if (!std.math.isFinite(quota) or quota <= 0) return error.InvalidCpuQuotaCpus;
        if (quota > @as(f64, @floatFromInt(max_vcpus))) return error.CpuQuotaExceedsMaxVcpus;
        break :blk quota;
    } else null;

    const weight = cpu.weight orelse default_cpu_weight;
    if (weight < min_cpu_weight or weight > max_cpu_weight) return error.InvalidCpuWeight;
    return .{ .max_vcpus = max_vcpus, .quota_cpus = quota_cpus, .weight = weight };
}

pub fn planGuestEnv(allocator: std.mem.Allocator, input: GuestEnvInput) ![]EnvPair {
    assert(@sizeOf(GuestEnvInput) > 0);

    var out: std.array_list.Aligned(EnvPair, null) = .empty;
    errdefer out.deinit(allocator);
    var has_name = false;
    var has_hostname_wait = false;
    for (input.env) |pair| {
        try out.append(allocator, pair);
        if (std.mem.eql(u8, pair.key, "MACHINEN_VM_NAME")) has_name = true;
        if (std.mem.eql(u8, pair.key, "MACHINEN_VM_HOSTNAME_WAIT")) has_hostname_wait = true;
    }
    if (input.name) |name| {
        if (!has_name) try out.append(allocator, .{ .key = "MACHINEN_VM_NAME", .value = name });
    }
    if (input.vsock_uds_path != null and !has_hostname_wait) {
        try out.append(allocator, .{ .key = "MACHINEN_VM_HOSTNAME_WAIT", .value = "1" });
    }
    return out.toOwnedSlice(allocator);
}

pub fn planVsock(allocator: std.mem.Allocator, input: VsockPlanInput) !VsockPlan {
    assert(@sizeOf(VsockPlanInput) > 0);

    if (input.existing_spec) |spec| {
        return .{ .uds_path = parseVsockUdsPath(spec), .vmm_vsock = null };
    }
    if (input.auto_uds_path) |uds| {
        return .{
            .uds_path = uds,
            .vmm_vsock = try std.mem.concat(allocator, u8, &.{ "in:1978:", uds }),
        };
    }
    return .{ .uds_path = null, .vmm_vsock = null };
}

pub fn parseVsockUdsPath(spec: []const u8) ?[]const u8 {
    assert(@sizeOf([]const u8) > 0);

    var entries = std.mem.splitScalar(u8, spec, ',');
    while (entries.next()) |entry| {
        const first_colon = std.mem.indexOfScalar(u8, entry, ':') orelse continue;
        const rest = entry[first_colon + 1 ..];
        const second_rel = std.mem.indexOfScalar(u8, rest, ':') orelse continue;
        const port = rest[0..second_rel];
        if (port.len == 0) continue;
        if (!isDecimal(port)) continue;
        const path = rest[second_rel + 1 ..];
        if (path.len > 0) return path;
    }
    return null;
}

pub fn planKernelDtb(input: KernelDtbInput) KernelDtbPlan {
    assert(@sizeOf(KernelDtbInput) > 0);

    return .{ .vmm_kernel = input.kernel_path, .vmm_dtb = input.dtb_path };
}

pub fn planVmstateEnv(input: VmstateEnvInput) VmstateEnvPlan {
    assert(@sizeOf(VmstateEnvInput) > 0);

    const should_set_timing = input.restore_path != null and
        input.enable_timing and
        (input.existing_timing == null or input.existing_timing.?.len == 0);
    return .{
        .snapshot_path = input.state_path,
        .restore_path = input.restore_path,
        .vmstate_timing = if (should_set_timing) "1" else null,
    };
}

pub fn planLiveMounts(allocator: std.mem.Allocator, mounts: []const LiveMountInput) ![]LiveMount {
    assert(@sizeOf(LiveMountInput) > 0);

    if (mounts.len > max_live_mounts) return error.TooManyLiveMounts;
    var out: std.array_list.Aligned(LiveMount, null) = .empty;
    errdefer out.deinit(allocator);
    for (mounts, 0..) |mount, i| {
        const mode = mount.mode orelse "rw";
        if (!std.mem.eql(u8, mode, "ro") and !std.mem.eql(u8, mode, "rw")) {
            return error.InvalidLiveMountMode;
        }
        const guest = try normalizeMountGuest(mount.guest);
        var tag_buf: [64]u8 = undefined;
        const tag_text = try std.fmt.bufPrint(&tag_buf, "machinen-lm{d}", .{i});
        const tag = try std.mem.concat(allocator, u8, &.{tag_text});
        try out.append(allocator, .{
            .host = mount.host,
            .guest = guest,
            .mode = mode,
            .tag = tag,
        });
    }
    return out.toOwnedSlice(allocator);
}

pub fn planVirtiofsEnv(allocator: std.mem.Allocator, mounts: []const LiveMount) ![]EnvPair {
    assert(@sizeOf(LiveMount) > 0);

    var out: std.array_list.Aligned(EnvPair, null) = .empty;
    errdefer out.deinit(allocator);
    for (mounts, 0..) |mount, i| {
        var key_buf: [64]u8 = undefined;
        const key_text = try std.fmt.bufPrint(&key_buf, "MACHINEN_VIRTIOFS_{d}", .{i});
        const key = try std.mem.concat(allocator, u8, &.{key_text});
        const value = try std.mem.concat(
            allocator,
            u8,
            &.{ mount.tag, ":", mount.mode, ":", mount.host },
        );
        try out.append(allocator, .{ .key = key, .value = value });
    }
    return out.toOwnedSlice(allocator);
}

pub fn planStatsFile(input: StatsFileInput) StatsFilePlan {
    assert(@sizeOf(StatsFileInput) > 0);

    if (input.existing_path) |path| {
        return .{ .stats_file_path = path, .vmm_stats_file = null };
    }
    return .{ .stats_file_path = input.planned_path, .vmm_stats_file = input.planned_path };
}

pub fn planMachinenConfigCwd(input: MachinenConfigInput) ?[]const u8 {
    assert(@sizeOf(MachinenConfigInput) > 0);

    return input.guest_cwd orelse input.image_cwd;
}

pub fn planProvisionRuntime(
    allocator: std.mem.Allocator,
    input: ProvisionRuntimeInput,
) !ProvisionRuntimePlan {
    assert(@sizeOf(ProvisionRuntimeInput) > 0);

    var paths = ProvisionRuntimePaths{};
    if (input.work_dir) |work_dir| paths = try planProvisionRuntimePaths(allocator, work_dir);
    return .{
        .scratch_size_bytes = input.scratch_size_bytes orelse 1024 * 1024 * 1024,
        .deadline_ms = input.timeout_ms orelse 10 * 60 * 1000,
        .disk_path = paths.disk_path,
        .root_disk_path = paths.root_disk_path,
        .uds_path = paths.uds_path,
    };
}

const ProvisionRuntimePaths = struct {
    disk_path: ?[]const u8 = null,
    root_disk_path: ?[]const u8 = null,
    uds_path: ?[]const u8 = null,
};

fn planProvisionRuntimePaths(
    allocator: std.mem.Allocator,
    work_dir: []const u8,
) !ProvisionRuntimePaths {
    assert(work_dir.len > 0);

    const disk_path = try std.fs.path.join(allocator, &.{ work_dir, "scratch.img" });
    errdefer allocator.free(disk_path);
    const root_disk_path = try std.fs.path.join(allocator, &.{ work_dir, "rootfs.img" });
    errdefer allocator.free(root_disk_path);
    const uds_path = try std.fs.path.join(allocator, &.{ work_dir, "exec.sock" });
    return .{
        .disk_path = disk_path,
        .root_disk_path = root_disk_path,
        .uds_path = uds_path,
    };
}

pub fn planProvisionImageConfig(input: ProvisionImageConfigInput) ProvisionImageConfigPlan {
    assert(@sizeOf(ProvisionImageConfigInput) > 0);

    return .{
        .has_config = input.has_cmd or input.has_env,
        .has_cmd = input.has_cmd,
        .cmd = input.cmd,
        .has_env = input.has_env,
        .env = input.env,
    };
}

pub fn planProvisionWorkload() ProvisionWorkloadPlan {
    assert(poweroff_command.len == 1);

    return .{
        .tar_to_disk_command = provision_tar_to_disk_command,
        .poweroff_command = poweroff_command[0],
    };
}

const provision_tar_to_disk_command =
    "tar -C / " ++
    "--exclude=./proc " ++
    "--exclude=./sys " ++
    "--exclude=./dev " ++
    "--exclude=./tmp " ++
    "--exclude=./run " ++
    "--exclude=./machinen-config.json " ++
    "--exclude=./etc/machinen-boot-epoch " ++
    "--sort=name --numeric-owner --owner=0 --group=0 " ++
    "-cf /dev/vdb .";

pub fn planProvisionRepack(
    allocator: std.mem.Allocator,
    input: ProvisionRepackInput,
) !ProvisionRepackPlan {
    assert(@sizeOf(ProvisionRepackInput) > 0);

    if (provisionRepackInputEmpty(input)) {
        return .{ .extract_args = &.{}, .targz_args = &.{} };
    }
    const disk_path = input.disk_path orelse return error.MissingProvisionRepackField;
    const out_path = input.out_path orelse return error.MissingProvisionRepackField;
    const extract_dir = input.extract_dir orelse return error.MissingProvisionRepackField;
    const extract_args = try std.mem.concat(
        allocator,
        []const u8,
        &.{&[_][]const u8{ "-xf", disk_path, "-C", extract_dir }},
    );
    errdefer allocator.free(extract_args);
    const targz_args = try std.mem.concat(
        allocator,
        []const u8,
        &.{&[_][]const u8{ "-czf", out_path, "-C", extract_dir, "." }},
    );
    errdefer allocator.free(targz_args);
    return .{ .extract_args = extract_args, .targz_args = targz_args };
}

fn provisionRepackInputEmpty(input: ProvisionRepackInput) bool {
    assert(@sizeOf(ProvisionRepackInput) > 0);

    return input.disk_path == null and input.out_path == null and input.extract_dir == null;
}

pub fn planProvisionBoot(
    allocator: std.mem.Allocator,
    input: ProvisionBootInput,
) !ProvisionBootPlan {
    assert(@sizeOf(ProvisionBootInput) > 0);

    const cmd = try std.mem.concat(allocator, []const u8, &.{&[_][]const u8{"/exec-agent"}});
    errdefer allocator.free(cmd);
    const env = try std.mem.concat(allocator, EnvPair, &.{&provision_boot_env});
    errdefer allocator.free(env);
    const vmm_vsock = try planProvisionVsock(allocator, input.uds_path);
    errdefer if (vmm_vsock) |spec| allocator.free(spec);
    return .{
        .image_path = input.base_path,
        .kernel_path = input.kernel_path,
        .dtb_path = input.dtb_path,
        .vmm_vsock = vmm_vsock,
        .cmd = cmd,
        .env = env,
        .snapshot_path = input.scratch_disk_path,
        .root_disk_path = input.root_disk_path,
    };
}

const provision_boot_env = [_]EnvPair{.{
    .key = "PATH",
    .value = "/usr/local/bin:/usr/bin:/bin:/sbin",
}};

fn planProvisionVsock(
    allocator: std.mem.Allocator,
    uds_path: ?[]const u8,
) !?[]const u8 {
    assert(@sizeOf(@TypeOf(uds_path)) > 0);

    if (uds_path) |path| return try std.mem.concat(allocator, u8, &.{ "in:1978:", path });
    return null;
}

pub fn planProvisionAssets(input: ProvisionAssetsInput) ProvisionAssetsPlan {
    assert(@sizeOf(ProvisionAssetsInput) > 0);

    return switch (input.guest_cpu) {
        .amd64 => .{
            .cpu = "amd64",
            .kernel_asset = "bzImage-x86_64",
            .dtb_asset = null,
            .rootfs_asset = "rootfs-debian-amd64.tar.gz",
        },
        .arm64 => .{
            .cpu = "arm64",
            .kernel_asset = "Image-arm64",
            .dtb_asset = "virt-arm64.dtb",
            .rootfs_asset = "rootfs-debian-arm64.tar.gz",
        },
    };
}

pub fn planBundleEnv(allocator: std.mem.Allocator, input: BundleEnvInput) ![]EnvPair {
    assert(@sizeOf(BundleEnvInput) > 0);

    var out: std.array_list.Aligned(EnvPair, null) = .empty;
    errdefer out.deinit(allocator);
    try out.appendSlice(allocator, input.image_env);
    for (input.guest_env) |pair| {
        var replaced = false;
        for (out.items) |*existing| {
            if (std.mem.eql(u8, existing.key, pair.key)) {
                existing.value = pair.value;
                replaced = true;
                break;
            }
        }
        if (!replaced) try out.append(allocator, pair);
    }
    return out.toOwnedSlice(allocator);
}

pub fn planRootDiskRuntime(input: RootDiskRuntimeInput) PlanError!RootDiskRuntimePlan {
    assert(@sizeOf(RootDiskRuntimeInput) > 0);

    return switch (input.mode) {
        .none => .{
            .action = "none",
            .source_path = null,
            .target_path = null,
            .per_boot_root_disk = null,
            .vmm_root_disk = null,
        },
        .path => blk: {
            const source = input.source_path orelse return error.MissingRootDiskRuntimePath;
            break :blk .{
                .action = "existing",
                .source_path = source,
                .target_path = null,
                .per_boot_root_disk = null,
                .vmm_root_disk = source,
            };
        },
        .restore => blk: {
            const source = input.source_path orelse return error.MissingRootDiskRuntimePath;
            const target = input.clone_path orelse return error.MissingRootDiskRuntimePath;
            break :blk .{
                .action = "clone-restore",
                .source_path = source,
                .target_path = target,
                .per_boot_root_disk = target,
                .vmm_root_disk = target,
            };
        },
        .cached => blk: {
            const source = input.source_path orelse return error.MissingRootDiskRuntimePath;
            const target = input.clone_path orelse return error.MissingRootDiskRuntimePath;
            break :blk .{
                .action = "clone-cached",
                .source_path = source,
                .target_path = target,
                .per_boot_root_disk = target,
                .vmm_root_disk = target,
            };
        },
    };
}

pub fn planMountDiskRuntime(input: MountDiskRuntimeInput) PlanError!MountDiskRuntimePlan {
    assert(@sizeOf(MountDiskRuntimeInput) > 0);

    return switch (input.mode) {
        .none => .{
            .action = "none",
            .lower_path = null,
            .upper_path = null,
            .source_upper_path = null,
            .guest = null,
            .upper_size_bytes = null,
        },
        .restore => blk: {
            const lower = input.lower_path orelse return error.MissingMountDiskRuntimeField;
            const upper = input.upper_path orelse return error.MissingMountDiskRuntimeField;
            const source_upper = input.source_upper_path orelse
                return error.MissingMountDiskRuntimeField;
            const guest = input.guest orelse return error.MissingMountDiskRuntimeField;
            const upper_size = input.upper_size_bytes orelse
                return error.MissingMountDiskRuntimeField;
            break :blk .{
                .action = "restore",
                .lower_path = lower,
                .upper_path = upper,
                .source_upper_path = source_upper,
                .guest = guest,
                .upper_size_bytes = upper_size,
            };
        },
        .fresh => blk: {
            const lower = input.lower_path orelse return error.MissingMountDiskRuntimeField;
            const upper = input.upper_path orelse return error.MissingMountDiskRuntimeField;
            const guest = input.guest orelse return error.MissingMountDiskRuntimeField;
            const upper_size = input.upper_size_bytes orelse
                return error.MissingMountDiskRuntimeField;
            break :blk .{
                .action = "fresh",
                .lower_path = lower,
                .upper_path = upper,
                .source_upper_path = null,
                .guest = guest,
                .upper_size_bytes = upper_size,
            };
        },
    };
}

pub fn planRegistryShape(
    allocator: std.mem.Allocator,
    input: RegistryShapeInput,
) PlanError!RegistryShapePlan {
    assert(@sizeOf(RegistryShapeInput) > 0);

    const root_disk_path = input.per_boot_root_disk orelse input.caller_root_disk_path;
    return .{
        .source_image_path = input.source_image_path,
        .root_disk_path = root_disk_path,
        .root_disk_mode = if (root_disk_path != null) "block" else "none",
        .cleanup_paths = try planRegistryCleanupPaths(allocator, input.cleanup),
        .mount_disk = try planRegistryMountDisk(input.mount_disk),
        .live_mounts = try planRegistryLiveMounts(allocator, input.live_mounts),
        .port_forwards = try planRegistryPortForwards(allocator, input.port_forwards),
        .cpu = try planRegistryCpu(input),
        .vmstate = try planRegistryVmstate(input.vmstate),
    };
}

fn planRegistryPortForwards(
    allocator: std.mem.Allocator,
    input: []const PortForwardMapping,
) ![]const RegistryPortForwardPlan {
    assert(@sizeOf(PortForwardMapping) > 0);

    var forwards: std.array_list.Aligned(RegistryPortForwardPlan, null) = .empty;
    errdefer forwards.deinit(allocator);
    for (input) |mapping| {
        try forwards.append(allocator, .{
            .host_port = mapping.host_port,
            .guest_port = mapping.guest_port,
            .host_addr = mapping.host_addr,
        });
    }
    return forwards.toOwnedSlice(allocator);
}

fn planRegistryVmstate(input: RegistryVmstateInput) PlanError!RegistryVmstatePlan {
    assert(@sizeOf(RegistryVmstateInput) > 0);

    if (input.state_path == null) {
        return .{
            .state_path = null,
            .chain_id = null,
            .checkpoint_parent = null,
            .checkpoint_sequence = null,
        };
    }
    return .{
        .state_path = input.state_path,
        .chain_id = input.chain_id orelse return error.MissingRegistryVmstateField,
        .checkpoint_parent = input.checkpoint_parent,
        .checkpoint_sequence = input.checkpoint_sequence orelse
            return error.MissingRegistryVmstateField,
    };
}

fn planRegistryCpu(input: RegistryShapeInput) PlanError!?RegistryCpuPlan {
    assert(@sizeOf(RegistryShapeInput) > 0);

    const policy = input.cpu_policy orelse return null;
    const status = input.cpu_control_status orelse return error.MissingRegistryCpuStatus;
    return .{
        .max_vcpus = policy.max_vcpus,
        .quota_cpus = policy.quota_cpus,
        .weight = policy.weight,
        .enforcement_status = status,
        .enforcement_reason = input.cpu_control_reason,
    };
}

fn planRegistryCleanupPaths(
    allocator: std.mem.Allocator,
    cleanup: RegistryCleanupInput,
) ![]const []const u8 {
    assert(@sizeOf(RegistryCleanupInput) > 0);

    var paths: [8][]const u8 = undefined;
    var count: u8 = 0;
    for ([_]?[]const u8{
        cleanup.per_boot_root_disk,
        cleanup.per_boot_snap_disk,
        cleanup.per_boot_mount_upper,
        cleanup.bundle_temp_dir,
        cleanup.vsock_temp_dir,
        cleanup.stats_temp_dir,
        cleanup.gv_socket_dir,
        cleanup.cpu_cgroup_path,
    }) |path| {
        if (path) |value| {
            paths[count] = value;
            count += 1;
        }
    }
    return std.mem.concat(allocator, []const u8, &.{paths[0..count]});
}

fn planRegistryMountDisk(
    input: RegistryMountDiskInput,
) PlanError!?RegistryMountDiskPlan {
    assert(@sizeOf(RegistryMountDiskInput) > 0);

    if (registryMountDiskEmpty(input)) return null;
    return .{
        .guest = input.guest orelse return error.IncompleteRegistryMountDisk,
        .lower_path = input.lower_path orelse return error.IncompleteRegistryMountDisk,
        .upper_path = input.upper_path orelse return error.IncompleteRegistryMountDisk,
    };
}

fn registryMountDiskEmpty(input: RegistryMountDiskInput) bool {
    assert(@sizeOf(RegistryMountDiskInput) > 0);

    return input.guest == null and input.lower_path == null and input.upper_path == null;
}

fn planRegistryLiveMounts(
    allocator: std.mem.Allocator,
    input: []const LiveMount,
) PlanError![]const RegistryLiveMountPlan {
    assert(@sizeOf(LiveMount) > 0);

    if (input.len > max_live_mounts) return error.TooManyLiveMounts;
    var mounts: [max_live_mounts]RegistryLiveMountPlan = undefined;
    for (input, 0..) |mount, i| {
        mounts[i] = .{ .guest = mount.guest, .host = mount.host, .mode = mount.mode };
    }
    return std.mem.concat(allocator, RegistryLiveMountPlan, &.{mounts[0..input.len]});
}

pub fn planScratchDisk(input: ScratchDiskInput) PlanError!ScratchDiskPlan {
    assert(@sizeOf(ScratchDiskInput) > 0);

    return switch (input.mode) {
        .unset, .false_value => .{
            .action = "none",
            .disk_path = null,
            .per_boot_snap_disk = null,
            .vmm_disk = null,
        },
        .path => blk: {
            const snapshot_path = input.snapshot_path orelse return error.MissingScratchPath;
            if (input.has_cmd) {
                break :blk .{
                    .action = "existing",
                    .disk_path = snapshot_path,
                    .per_boot_snap_disk = null,
                    .vmm_disk = snapshot_path,
                };
            }
            const clone_path = input.restore_clone_path orelse return error.MissingScratchPath;
            break :blk .{
                .action = "clone",
                .disk_path = clone_path,
                .per_boot_snap_disk = clone_path,
                .vmm_disk = clone_path,
            };
        },
        .auto => if (!input.has_image) .{
            .action = "none",
            .disk_path = null,
            .per_boot_snap_disk = null,
            .vmm_disk = null,
        } else blk: {
            const auto_path = input.auto_path orelse return error.MissingScratchPath;
            break :blk .{
                .action = "allocate",
                .disk_path = auto_path,
                .per_boot_snap_disk = auto_path,
                .vmm_disk = auto_path,
            };
        },
    };
}

pub fn planBundleCommand(
    allocator: std.mem.Allocator,
    input: BundleCommandInput,
) ![]const []const u8 {
    assert(@sizeOf(BundleCommandInput) > 0);

    const base_cmd = input.explicit_cmd orelse
        fallbackBundleBaseCommand(input) orelse
        return error.MissingBundleCommand;
    if (isSupervisorCommand(base_cmd)) return base_cmd;

    const workload = if (hasWritableLiveMount(input.live_mounts))
        try wrapBatchWorkloadCommand(allocator, base_cmd)
    else
        base_cmd;
    var out: std.array_list.Aligned([]const u8, null) = .empty;
    errdefer out.deinit(allocator);
    try out.append(allocator, "/sbin/machinen-supervisor");
    if (input.snapshot_restore) try out.append(allocator, "--session");
    try out.appendSlice(allocator, workload);
    return out.toOwnedSlice(allocator);
}

fn fallbackBundleBaseCommand(input: BundleCommandInput) ?[]const []const u8 {
    assert(@sizeOf(BundleCommandInput) > 0);

    if (input.snapshot_restore) return restore_command[0..];
    if (input.vmstate_restore) return poweroff_command[0..];
    return input.image_cmd;
}

fn isSupervisorCommand(cmd: []const []const u8) bool {
    assert(@sizeOf([]const []const u8) > 0);

    if (cmd.len == 0) return false;
    return std.mem.eql(u8, cmd[0], "/exec-agent") or
        std.mem.eql(u8, cmd[0], "/sbin/machinen-restore");
}

fn hasWritableLiveMount(mounts: []const LiveMount) bool {
    assert(@sizeOf(LiveMount) > 0);

    for (mounts) |mount| {
        if (std.mem.eql(u8, mount.mode, "rw")) return true;
    }
    return false;
}

fn wrapBatchWorkloadCommand(
    allocator: std.mem.Allocator,
    cmd: []const []const u8,
) ![]const []const u8 {
    assert(@sizeOf([]const []const u8) > 0);

    const batch_script = "batch_sync() { " ++
        "if [ -s /run/machinen-batch-sync.sh ]; then " ++
        "sh /run/machinen-batch-sync.sh; fi; }; " ++
        "\"$@\" & child=$!; " ++
        "trap 'kill -TERM \"$child\" 2>/dev/null' TERM; " ++
        "trap 'kill -INT \"$child\" 2>/dev/null' INT; " ++
        "wait \"$child\"; status=$?; " ++
        "batch_sync || { sync_status=$?; " ++
        "if [ \"$status\" -eq 0 ]; then status=$sync_status; fi; }; " ++
        "exit \"$status\"";
    const prefix = [_][]const u8{
        "/bin/sh",
        "-c",
        batch_script,
        "machinen-batch-wrapper",
    };
    var out: std.array_list.Aligned([]const u8, null) = .empty;
    errdefer out.deinit(allocator);
    try out.appendSlice(allocator, &prefix);
    try out.appendSlice(allocator, cmd);
    return out.toOwnedSlice(allocator);
}

pub fn planVmmArgv(allocator: std.mem.Allocator, input: VmmArgvInput) !VmmArgvPlan {
    assert(@sizeOf(VmmArgvInput) > 0);

    const binary = input.binary orelse return .{ .command = null, .args = &.{} };
    if (input.pdeathsig_path) |pdeathsig| {
        var args: std.array_list.Aligned([]const u8, null) = .empty;
        errdefer args.deinit(allocator);
        try args.append(allocator, binary);
        try args.appendSlice(allocator, input.args);
        return .{ .command = pdeathsig, .args = try args.toOwnedSlice(allocator) };
    }
    return .{ .command = binary, .args = input.args };
}

pub fn validatePortForward(mappings: []const PortForwardMapping) PortForwardValidation {
    assert(@sizeOf(PortForwardMapping) > 0);

    var seen = std.StaticBitSet(65536).initEmpty();
    for (mappings) |mapping| {
        const host_port = validateTcpPort(mapping.host_port) orelse
            return .{ .invalid_host_port = mapping.host_port };
        if (validateTcpPort(mapping.guest_port) == null) {
            return .{ .invalid_guest_port = mapping.guest_port };
        }
        if (seen.isSet(@intCast(host_port))) return .{ .duplicate_host_port = host_port };
        seen.set(@intCast(host_port));
    }
    return .ok;
}

fn validateTcpPort(port: i64) ?u16 {
    assert(@sizeOf(i64) == 8);

    if (port < 1 or port > 65535) return null;
    return @intCast(port);
}

pub fn autoSizeMemoryMib(host_total_bytes: u64) u64 {
    assert(memory_floor_mib > 0);

    const host_mib = @divFloor(host_total_bytes, 1024 * 1024);
    const host_aware_ceiling = @divFloor(host_mib, 2);
    return @max(memory_floor_mib, @min(host_aware_ceiling, memory_default_ceiling_mib));
}

pub fn validateMemoryMib(mib: u64) PlanError!u64 {
    assert(memory_floor_mib > 0);

    if (mib < memory_floor_mib) return error.InvalidMemory;
    return mib;
}

pub fn planCore(input: Input) PlanError!Plan {
    assert(@sizeOf(Input) > 0);

    if (input.has_cmd and !input.has_image) return error.CmdWithoutImage;

    const wants_root_disk = input.root_disk != .false_value and
        (input.root_disk == .path or input.root_disk == .true_value or input.has_image);
    const needs_initramfs = input.has_image or input.has_cmd or input.has_snapshot;
    if (wants_root_disk and input.root_disk != .path and !input.has_image) {
        return error.RootDiskWithoutImage;
    }
    if (input.guest_cwd) |cwd| try validateGuestCwd(cwd);
    const normalized_mount_guest = if (input.mount_guest) |guest|
        try normalizeMountGuest(guest)
    else
        null;

    const explicit = try resolveExplicitMemory(input);
    if (input.vmm_memory_preset) {
        return .{
            .memory_ceiling_mib = null,
            .vmm_memory_mib = null,
            .wants_root_disk = wants_root_disk,
            .needs_initramfs = needs_initramfs,
            .normalized_mount_guest = normalized_mount_guest,
        };
    }

    const host_ceiling = if (input.host_total_bytes) |bytes|
        autoSizeMemoryMib(bytes)
    else
        null;
    const ceiling = explicit orelse input.auto_memory_mib orelse host_ceiling orelse
        return error.MissingAutoMemory;
    return .{
        .memory_ceiling_mib = ceiling,
        .vmm_memory_mib = ceiling,
        .wants_root_disk = wants_root_disk,
        .needs_initramfs = needs_initramfs,
        .normalized_mount_guest = normalized_mount_guest,
    };
}

pub fn validateGuestCwd(cwd: []const u8) PlanError!void {
    assert(@sizeOf([]const u8) > 0);

    if (cwd.len == 0 or cwd[0] != '/') return error.InvalidGuestCwdAbsolute;
    if (std.mem.indexOfScalar(u8, cwd, 0) != null) return error.InvalidGuestCwdNul;
}

pub fn normalizeMountGuest(guest: []const u8) PlanError![]const u8 {
    assert(@sizeOf([]const u8) > 0);

    if (guest.len == 0 or guest[0] != '/') return error.InvalidMountGuestAbsolute;
    var end = guest.len;
    while (end > 0 and guest[end - 1] == '/') : (end -= 1) {}
    const trimmed = guest[0..end];
    if (!std.mem.startsWith(u8, trimmed, "/mnt/") or std.mem.eql(u8, trimmed, "/mnt")) {
        return error.InvalidMountGuestRoot;
    }
    return trimmed;
}

fn isDecimal(text: []const u8) bool {
    assert(@sizeOf([]const u8) > 0);

    if (text.len == 0) return false;
    for (text) |c| {
        if (c < '0' or c > '9') return false;
    }
    return true;
}

fn resolveExplicitMemory(input: Input) PlanError!?u64 {
    assert(@sizeOf(ResourcesMemory) > 0);

    const alias_ceiling = if (input.memory_mib) |mib| try validateMemoryMib(mib) else null;
    const resource_ceiling = if (input.resources_memory) |memory| blk: {
        if (memory.reclaim) |reclaim| {
            if (!std.mem.eql(u8, reclaim, "auto")) return error.InvalidReclaim;
        }
        break :blk try validateMemoryMib(memory.max_mib);
    } else null;
    if (alias_ceiling != null and
        resource_ceiling != null and
        alias_ceiling.? != resource_ceiling.?)
    {
        return error.ConflictingMemory;
    }
    return resource_ceiling orelse alias_ceiling;
}

test "autoSizeMemoryMib applies floor, half-host, and default ceiling" {
    try std.testing.expectEqual(@as(u64, 4096), autoSizeMemoryMib(32 * 1024 * 1024 * 1024));
    try std.testing.expectEqual(@as(u64, 3072), autoSizeMemoryMib(6 * 1024 * 1024 * 1024));
    try std.testing.expectEqual(@as(u64, 512), autoSizeMemoryMib(256 * 1024 * 1024));
}

test "planCore resolves explicit memory aliases" {
    try std.testing.expectEqual(@as(?u64, 2048), (try planCore(.{
        .memory_mib = 2048,
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    })).memory_ceiling_mib);
    try std.testing.expectEqual(@as(?u64, 4096), (try planCore(.{
        .resources_memory = .{ .max_mib = 4096, .reclaim = "auto" },
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    })).memory_ceiling_mib);
    try std.testing.expectError(error.ConflictingMemory, planCore(.{
        .memory_mib = 1024,
        .resources_memory = .{ .max_mib = 2048, .reclaim = "auto" },
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    try std.testing.expectError(error.InvalidReclaim, planCore(.{
        .resources_memory = .{ .max_mib = 2048, .reclaim = "manual" },
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
}

test "planGuestHostname sanitizes names and includes pid" {
    const named = (try planGuestHostname(std.testing.allocator, .{ .pid = 1234, .name = "worker" })).?;
    defer std.testing.allocator.free(named);
    try std.testing.expectEqualStrings("vm-1234-worker", named);

    const nameless = (try planGuestHostname(std.testing.allocator, .{ .pid = 1234 })).?;
    defer std.testing.allocator.free(nameless);
    try std.testing.expectEqualStrings("vm-1234", nameless);

    const sanitized = (try planGuestHostname(std.testing.allocator, .{ .pid = 99, .name = "src/name~fork" })).?;
    defer std.testing.allocator.free(sanitized);
    try std.testing.expectEqualStrings("vm-99-src-name-fork", sanitized);

    const empty = (try planGuestHostname(std.testing.allocator, .{ .pid = 99, .name = "///" })).?;
    defer std.testing.allocator.free(empty);
    try std.testing.expectEqualStrings("vm-99", empty);

    try std.testing.expect((try planGuestHostname(std.testing.allocator, .{})) == null);
}

test "planPdeathsig defaults on and lets detach or explicit false disable it" {
    try std.testing.expect(planPdeathsig(.{}));
    try std.testing.expect(planPdeathsig(.{ .pdeathsig = true }));
    try std.testing.expect(!planPdeathsig(.{ .pdeathsig = false }));
    try std.testing.expect(!planPdeathsig(.{ .detached = true, .pdeathsig = true }));
}

test "planNestedEnv sets nested only when requested" {
    try std.testing.expectEqualStrings("1", planNestedEnv(true).?);
    try std.testing.expect(planNestedEnv(false) == null);
}

test "planCpuResources applies defaults and validates cpu policy" {
    try std.testing.expect((try planCpuResources(null)) == null);

    const defaults = (try planCpuResources(.{})).?;
    try std.testing.expectEqual(@as(u64, 1), defaults.max_vcpus);
    try std.testing.expect(defaults.quota_cpus == null);
    try std.testing.expectEqual(@as(u64, 100), defaults.weight);

    const constrained = (try planCpuResources(.{
        .max_vcpus = 1,
        .quota_cpus = 0.5,
        .weight = 200,
    })).?;
    try std.testing.expectEqual(@as(u64, 1), constrained.max_vcpus);
    try std.testing.expectEqual(@as(f64, 0.5), constrained.quota_cpus.?);
    try std.testing.expectEqual(@as(u64, 200), constrained.weight);

    try std.testing.expectError(error.InvalidCpuMaxVcpus, planCpuResources(.{ .max_vcpus = 0 }));
    try std.testing.expectError(error.UnsupportedCpuMaxVcpus, planCpuResources(.{ .max_vcpus = 2 }));
    try std.testing.expectError(error.InvalidCpuQuotaCpus, planCpuResources(.{ .quota_cpus = 0 }));
    try std.testing.expectError(error.CpuQuotaExceedsMaxVcpus, planCpuResources(.{ .quota_cpus = 1.5 }));
    try std.testing.expectError(error.InvalidCpuWeight, planCpuResources(.{ .weight = 0 }));
    try std.testing.expectError(error.InvalidCpuWeight, planCpuResources(.{ .weight = 10_001 }));
}

test "planCore validates command and rootdisk image requirements" {
    try std.testing.expectError(error.CmdWithoutImage, planCore(.{
        .has_cmd = true,
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    try std.testing.expectError(error.RootDiskWithoutImage, planCore(.{
        .root_disk = .true_value,
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    try std.testing.expect((try planCore(.{
        .has_image = true,
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    })).wants_root_disk);
    try std.testing.expect(!(try planCore(.{
        .has_image = true,
        .root_disk = .false_value,
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    })).wants_root_disk);
}

test "planCore validates guest cwd and normalizes mount guest paths" {
    try std.testing.expectError(error.InvalidGuestCwdAbsolute, planCore(.{
        .guest_cwd = "relative/dir",
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    try std.testing.expectError(error.InvalidGuestCwdNul, planCore(.{
        .guest_cwd = "/mnt/work\x00space",
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    try std.testing.expectError(error.InvalidMountGuestAbsolute, planCore(.{
        .mount_guest = "mnt/app",
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    try std.testing.expectError(error.InvalidMountGuestRoot, planCore(.{
        .mount_guest = "/srv/app",
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    }));
    const plan = try planCore(.{
        .mount_guest = "/mnt/app///",
        .host_total_bytes = 8 * 1024 * 1024 * 1024,
    });
    try std.testing.expectEqualStrings("/mnt/app", plan.normalized_mount_guest.?);
}

test "planRegistryShape collects cleanup paths and strips registry-only mount fields" {
    const allocator = std.testing.allocator;
    const live = [_]LiveMount{
        .{ .host = "/host/work", .guest = "/mnt/work", .mode = "rw", .tag = "machinen-lm0" },
        .{ .host = "/host/cache", .guest = "/mnt/cache", .mode = "ro", .tag = "machinen-lm1" },
    };
    const plan = try planRegistryShape(allocator, .{
        .source_image_path = "/images/rootfs.tar.gz",
        .per_boot_root_disk = "/tmp/per-boot-root.img",
        .caller_root_disk_path = "/caller/root.img",
        .cleanup = .{
            .per_boot_root_disk = "/tmp/root.img",
            .per_boot_snap_disk = null,
            .per_boot_mount_upper = "/tmp/upper.img",
            .bundle_temp_dir = "/tmp/bundle",
            .vsock_temp_dir = "/tmp/vsock",
            .stats_temp_dir = null,
            .gv_socket_dir = "/tmp/gv",
            .cpu_cgroup_path = "/sys/fs/cgroup/machinen",
        },
        .mount_disk = .{
            .guest = "/mnt/data",
            .lower_path = "/cache/lower.sqfs",
            .upper_path = "/tmp/upper.img",
        },
        .live_mounts = &live,
        .port_forwards = &[_]PortForwardMapping{
            .{ .host_port = 8080, .guest_port = 80, .host_addr = "127.0.0.1" },
            .{ .host_port = 8443, .guest_port = 443 },
        },
    });
    defer allocator.free(plan.cleanup_paths);
    defer allocator.free(plan.live_mounts);
    defer allocator.free(plan.port_forwards);

    try std.testing.expectEqualStrings("/images/rootfs.tar.gz", plan.source_image_path.?);
    try std.testing.expectEqualStrings("/tmp/per-boot-root.img", plan.root_disk_path.?);
    try std.testing.expectEqualStrings("block", plan.root_disk_mode);
    try std.testing.expectEqual(@as(@TypeOf(plan.cleanup_paths.len), 6), plan.cleanup_paths.len);
    try std.testing.expectEqualStrings("/tmp/root.img", plan.cleanup_paths[0]);
    try std.testing.expectEqualStrings("/tmp/upper.img", plan.cleanup_paths[1]);
    try std.testing.expectEqualStrings("/tmp/bundle", plan.cleanup_paths[2]);
    try std.testing.expectEqualStrings("/tmp/vsock", plan.cleanup_paths[3]);
    try std.testing.expectEqualStrings("/tmp/gv", plan.cleanup_paths[4]);
    try std.testing.expectEqualStrings("/sys/fs/cgroup/machinen", plan.cleanup_paths[5]);
    try std.testing.expectEqualStrings("/mnt/data", plan.mount_disk.?.guest);
    try std.testing.expectEqualStrings("/cache/lower.sqfs", plan.mount_disk.?.lower_path);
    try std.testing.expectEqualStrings("/tmp/upper.img", plan.mount_disk.?.upper_path);
    try std.testing.expectEqual(@as(u64, 1), plan.cpu.?.max_vcpus);
    try std.testing.expectEqual(@as(f64, 0.5), plan.cpu.?.quota_cpus.?);
    try std.testing.expectEqual(@as(u64, 200), plan.cpu.?.weight);
    try std.testing.expectEqualStrings("linux-cgroup-v2", plan.cpu.?.enforcement_status);
    try std.testing.expectEqualStrings("limited", plan.cpu.?.enforcement_reason.?);
    try std.testing.expectEqualStrings("/tmp/state.vmstate", plan.vmstate.state_path.?);
    try std.testing.expectEqualStrings("chain-1", plan.vmstate.chain_id.?);
    try std.testing.expectEqualStrings("/snap/parent", plan.vmstate.checkpoint_parent.?);
    try std.testing.expectEqual(@as(u64, 3), plan.vmstate.checkpoint_sequence.?);
    try std.testing.expectEqual(@as(@TypeOf(plan.live_mounts.len), 2), plan.live_mounts.len);
    try std.testing.expectEqualStrings("/mnt/work", plan.live_mounts[0].guest);
    try std.testing.expectEqualStrings("/host/work", plan.live_mounts[0].host);
    try std.testing.expectEqualStrings("rw", plan.live_mounts[0].mode);
}

test "planMountDiskRuntime selects restore and fresh actions" {
    const none = try planMountDiskRuntime(.{});
    try std.testing.expectEqualStrings("none", none.action);
    try std.testing.expect(none.lower_path == null);

    const restore = try planMountDiskRuntime(.{
        .mode = .restore,
        .lower_path = "/lower.sqfs",
        .upper_path = "/upper-copy.img",
        .source_upper_path = "/upper.img",
        .guest = "/mnt/data",
        .upper_size_bytes = 4096,
    });
    try std.testing.expectEqualStrings("restore", restore.action);
    try std.testing.expectEqualStrings("/lower.sqfs", restore.lower_path.?);
    try std.testing.expectEqualStrings("/upper-copy.img", restore.upper_path.?);
    try std.testing.expectEqualStrings("/upper.img", restore.source_upper_path.?);
    try std.testing.expectEqualStrings("/mnt/data", restore.guest.?);
    try std.testing.expectEqual(@as(u64, 4096), restore.upper_size_bytes.?);

    const fresh = try planMountDiskRuntime(.{
        .mode = .fresh,
        .lower_path = "/lower.sqfs",
        .upper_path = "/upper.img",
        .guest = "/mnt/data",
        .upper_size_bytes = 8192,
    });
    try std.testing.expectEqualStrings("fresh", fresh.action);
    try std.testing.expect(fresh.source_upper_path == null);
    try std.testing.expectEqual(@as(u64, 8192), fresh.upper_size_bytes.?);
}

test "planProvisionRuntime defaults and derives workdir paths" {
    const allocator = std.testing.allocator;
    const plan = try planProvisionRuntime(allocator, .{
        .work_dir = "/tmp/machinen-provision-a",
        .scratch_size_bytes = 42,
        .timeout_ms = 99,
    });
    defer allocator.free(plan.disk_path.?);
    defer allocator.free(plan.root_disk_path.?);
    defer allocator.free(plan.uds_path.?);
    try std.testing.expectEqual(@as(u64, 42), plan.scratch_size_bytes);
    try std.testing.expectEqual(@as(u64, 99), plan.deadline_ms);
    try std.testing.expectEqualStrings("/tmp/machinen-provision-a/scratch.img", plan.disk_path.?);
    try std.testing.expectEqualStrings(
        "/tmp/machinen-provision-a/rootfs.img",
        plan.root_disk_path.?,
    );
    try std.testing.expectEqualStrings("/tmp/machinen-provision-a/exec.sock", plan.uds_path.?);

    const defaults = try planProvisionRuntime(allocator, .{});
    try std.testing.expectEqual(@as(u64, 1024 * 1024 * 1024), defaults.scratch_size_bytes);
    try std.testing.expectEqual(@as(u64, 10 * 60 * 1000), defaults.deadline_ms);
    try std.testing.expect(defaults.disk_path == null);
}

test "planProvisionImageConfig preserves optional cmd and env" {
    const env = [_]EnvPair{.{ .key = "FOO", .value = "bar" }};
    const cmd = [_][]const u8{ "/bin/echo", "hi" };
    const both = planProvisionImageConfig(.{
        .has_cmd = true,
        .cmd = &cmd,
        .has_env = true,
        .env = &env,
    });
    try std.testing.expect(both.has_config);
    try std.testing.expect(both.has_cmd);
    try std.testing.expect(both.has_env);
    try std.testing.expectEqualSlices([]const u8, &cmd, both.cmd);
    try std.testing.expectEqual(@as(@TypeOf(both.env.len), 1), both.env.len);
    try std.testing.expectEqualStrings("FOO", both.env[0].key);
    try std.testing.expectEqualStrings("bar", both.env[0].value);

    const none = planProvisionImageConfig(.{});
    try std.testing.expect(!none.has_config);
    try std.testing.expect(!none.has_cmd);
    try std.testing.expect(!none.has_env);
}

test "planProvisionWorkload and planProvisionRepack build commands" {
    const workload = planProvisionWorkload();
    try std.testing.expect(std.mem.startsWith(u8, workload.tar_to_disk_command, "tar -C /"));
    try std.testing.expect(std.mem.endsWith(u8, workload.tar_to_disk_command, "-cf /dev/vdb ."));
    try std.testing.expectEqualStrings("/sbin/machinen-poweroff", workload.poweroff_command);

    const allocator = std.testing.allocator;
    const repack = try planProvisionRepack(allocator, .{
        .disk_path = "/tmp/scratch.img",
        .out_path = "/tmp/out.tar.gz",
        .extract_dir = "/tmp/extract",
    });
    defer allocator.free(repack.extract_args);
    defer allocator.free(repack.targz_args);
    try std.testing.expectEqualSlices(
        []const u8,
        &[_][]const u8{ "-xf", "/tmp/scratch.img", "-C", "/tmp/extract" },
        repack.extract_args,
    );
    try std.testing.expectEqualSlices(
        []const u8,
        &[_][]const u8{ "-czf", "/tmp/out.tar.gz", "-C", "/tmp/extract", "." },
        repack.targz_args,
    );
}

test "planProvisionBoot builds provision boot inputs" {
    const allocator = std.testing.allocator;
    const plan = try planProvisionBoot(allocator, .{
        .base_path = "/base.tar.gz",
        .kernel_path = "/Image",
        .dtb_path = "/virt.dtb",
        .uds_path = "/tmp/exec.sock",
        .scratch_disk_path = "/tmp/scratch.img",
        .root_disk_path = "/tmp/rootfs.img",
    });
    defer allocator.free(plan.cmd);
    defer allocator.free(plan.env);
    defer if (plan.vmm_vsock) |spec| allocator.free(spec);

    try std.testing.expectEqualStrings("/base.tar.gz", plan.image_path.?);
    try std.testing.expectEqualStrings("/Image", plan.kernel_path.?);
    try std.testing.expectEqualStrings("/virt.dtb", plan.dtb_path.?);
    try std.testing.expectEqualStrings("in:1978:/tmp/exec.sock", plan.vmm_vsock.?);
    try std.testing.expectEqual(@as(@TypeOf(plan.cmd.len), 1), plan.cmd.len);
    try std.testing.expectEqualStrings("/exec-agent", plan.cmd[0]);
    try std.testing.expectEqual(@as(@TypeOf(plan.env.len), 1), plan.env.len);
    try std.testing.expectEqualStrings("PATH", plan.env[0].key);
    try std.testing.expectEqualStrings("/usr/local/bin:/usr/bin:/bin:/sbin", plan.env[0].value);
    try std.testing.expectEqualStrings("/tmp/scratch.img", plan.snapshot_path.?);
    try std.testing.expectEqualStrings("/tmp/rootfs.img", plan.root_disk_path.?);
}

test "planProvisionAssets selects asset names by guest CPU" {
    const arm = planProvisionAssets(.{ .guest_cpu = .arm64 });
    try std.testing.expectEqualStrings("arm64", arm.cpu);
    try std.testing.expectEqualStrings("Image-arm64", arm.kernel_asset);
    try std.testing.expectEqualStrings("virt-arm64.dtb", arm.dtb_asset.?);
    try std.testing.expectEqualStrings("rootfs-debian-arm64.tar.gz", arm.rootfs_asset);

    const x64 = planProvisionAssets(.{ .guest_cpu = .amd64 });
    try std.testing.expectEqualStrings("amd64", x64.cpu);
    try std.testing.expectEqualStrings("bzImage-x86_64", x64.kernel_asset);
    try std.testing.expect(x64.dtb_asset == null);
    try std.testing.expectEqualStrings("rootfs-debian-amd64.tar.gz", x64.rootfs_asset);
}

test "planBundleEnv overlays guest env on image env" {
    const image = [_]EnvPair{
        .{ .key = "FOO", .value = "image" },
        .{ .key = "BAR", .value = "image" },
    };
    const guest = [_]EnvPair{
        .{ .key = "FOO", .value = "guest" },
        .{ .key = "BAZ", .value = "guest" },
    };
    const planned = try planBundleEnv(std.testing.allocator, .{
        .image_env = &image,
        .guest_env = &guest,
    });
    defer std.testing.allocator.free(planned);
    try std.testing.expectEqual(@as(@TypeOf(planned.len), 3), planned.len);
    try std.testing.expectEqualStrings("FOO", planned[0].key);
    try std.testing.expectEqualStrings("guest", planned[0].value);
    try std.testing.expectEqualStrings("BAR", planned[1].key);
    try std.testing.expectEqualStrings("image", planned[1].value);
    try std.testing.expectEqualStrings("BAZ", planned[2].key);
    try std.testing.expectEqualStrings("guest", planned[2].value);
}

test "planRootDiskRuntime selects existing restore and cached clone actions" {
    const none = try planRootDiskRuntime(.{});
    try std.testing.expectEqualStrings("none", none.action);
    try std.testing.expect(none.vmm_root_disk == null);

    const existing = try planRootDiskRuntime(.{ .mode = .path, .source_path = "/root.img" });
    try std.testing.expectEqualStrings("existing", existing.action);
    try std.testing.expectEqualStrings("/root.img", existing.vmm_root_disk.?);
    try std.testing.expect(existing.per_boot_root_disk == null);

    const restore = try planRootDiskRuntime(.{
        .mode = .restore,
        .source_path = "/restore.img",
        .clone_path = "/restore-clone.img",
    });
    try std.testing.expectEqualStrings("clone-restore", restore.action);
    try std.testing.expectEqualStrings("/restore.img", restore.source_path.?);
    try std.testing.expectEqualStrings("/restore-clone.img", restore.target_path.?);
    try std.testing.expectEqualStrings("/restore-clone.img", restore.per_boot_root_disk.?);

    const cached = try planRootDiskRuntime(.{
        .mode = .cached,
        .source_path = "/cache.img",
        .clone_path = "/boot.img",
    });
    try std.testing.expectEqualStrings("clone-cached", cached.action);
    try std.testing.expectEqualStrings("/cache.img", cached.source_path.?);
    try std.testing.expectEqualStrings("/boot.img", cached.vmm_root_disk.?);
}

test "planScratchDisk selects restore clone auto allocation and no-disk cases" {
    const disabled = try planScratchDisk(.{ .mode = .false_value, .has_image = true });
    try std.testing.expectEqualStrings("none", disabled.action);
    try std.testing.expect(disabled.vmm_disk == null);

    const existing = try planScratchDisk(.{
        .mode = .path,
        .has_cmd = true,
        .snapshot_path = "/snap.img",
        .restore_clone_path = "/clone.img",
    });
    try std.testing.expectEqualStrings("existing", existing.action);
    try std.testing.expectEqualStrings("/snap.img", existing.vmm_disk.?);
    try std.testing.expect(existing.per_boot_snap_disk == null);

    const clone = try planScratchDisk(.{
        .mode = .path,
        .snapshot_path = "/snap.img",
        .restore_clone_path = "/clone.img",
    });
    try std.testing.expectEqualStrings("clone", clone.action);
    try std.testing.expectEqualStrings("/clone.img", clone.disk_path.?);
    try std.testing.expectEqualStrings("/clone.img", clone.per_boot_snap_disk.?);

    const auto_without_image = try planScratchDisk(.{ .mode = .auto });
    try std.testing.expectEqualStrings("none", auto_without_image.action);

    const auto = try planScratchDisk(.{
        .mode = .auto,
        .has_image = true,
        .auto_path = "/auto.img",
    });
    try std.testing.expectEqualStrings("allocate", auto.action);
    try std.testing.expectEqualStrings("/auto.img", auto.vmm_disk.?);
}

test "planBundleCommand resolves image restore supervisor and batch wrappers" {
    const ro_mounts = [_]LiveMount{.{
        .host = "/host",
        .guest = "/mnt/ro",
        .mode = "ro",
        .tag = "machinen-lm0",
    }};
    const image = [_][]const u8{"/bin/true"};
    const planned = try planBundleCommand(std.testing.allocator, .{
        .image_cmd = &image,
        .live_mounts = &ro_mounts,
    });
    defer std.testing.allocator.free(planned);
    try std.testing.expectEqualStrings("/sbin/machinen-supervisor", planned[0]);
    try std.testing.expectEqualStrings("/bin/true", planned[1]);

    const restore = try planBundleCommand(std.testing.allocator, .{ .snapshot_restore = true });
    try std.testing.expectEqualStrings("/sbin/machinen-restore", restore[0]);

    const rw_mounts = [_]LiveMount{.{
        .host = "/host",
        .guest = "/mnt/rw",
        .mode = "rw",
        .tag = "machinen-lm0",
    }};
    const explicit = [_][]const u8{ "/bin/echo", "hi" };
    const batched = try planBundleCommand(std.testing.allocator, .{
        .explicit_cmd = &explicit,
        .live_mounts = &rw_mounts,
    });
    defer std.testing.allocator.free(batched);
    try std.testing.expectEqualStrings("/sbin/machinen-supervisor", batched[0]);
    try std.testing.expectEqualStrings("/bin/sh", batched[1]);
    try std.testing.expectEqualStrings("machinen-batch-wrapper", batched[4]);
    try std.testing.expectEqualStrings("/bin/echo", batched[5]);
}

test "planMachinenConfigCwd prefers guest cwd over image cwd" {
    try std.testing.expectEqualStrings(
        "/mnt/work",
        planMachinenConfigCwd(.{ .guest_cwd = "/mnt/work", .image_cwd = "/srv/app" }).?,
    );
    try std.testing.expectEqualStrings(
        "/srv/app",
        planMachinenConfigCwd(.{ .image_cwd = "/srv/app" }).?,
    );
    try std.testing.expectEqual(@as(?[]const u8, null), planMachinenConfigCwd(.{}));
}

test "planLiveMounts validates count guest paths modes and tags" {
    const mounts = [_]LiveMountInput{
        .{ .host = "./a", .guest = "/mnt/a", .mode = null },
        .{ .host = "./b", .guest = "/mnt/b/", .mode = "ro" },
    };
    const planned = try planLiveMounts(std.testing.allocator, &mounts);
    defer {
        for (planned) |mount| std.testing.allocator.free(mount.tag);
        std.testing.allocator.free(planned);
    }
    try std.testing.expectEqual(@as(@TypeOf(planned.len), 2), planned.len);
    try std.testing.expectEqualStrings("./a", planned[0].host);
    try std.testing.expectEqualStrings("/mnt/a", planned[0].guest);
    try std.testing.expectEqualStrings("rw", planned[0].mode);
    try std.testing.expectEqualStrings("machinen-lm0", planned[0].tag);
    try std.testing.expectEqualStrings("/mnt/b", planned[1].guest);
    try std.testing.expectEqualStrings("ro", planned[1].mode);
    try std.testing.expectEqualStrings("machinen-lm1", planned[1].tag);

    const bad_mode = [_]LiveMountInput{.{
        .host = "./a",
        .guest = "/mnt/a",
        .mode = "eager",
    }};
    try std.testing.expectError(
        error.InvalidLiveMountMode,
        planLiveMounts(std.testing.allocator, &bad_mode),
    );
}

test "planStatsFile preserves caller path or returns runtime-owned env value" {
    const existing = planStatsFile(.{ .existing_path = "/tmp/caller-stats.bin" });
    try std.testing.expectEqualStrings("/tmp/caller-stats.bin", existing.stats_file_path.?);
    try std.testing.expectEqual(@as(?[]const u8, null), existing.vmm_stats_file);

    const planned = planStatsFile(.{ .planned_path = "/tmp/runtime-stats.bin" });
    try std.testing.expectEqualStrings("/tmp/runtime-stats.bin", planned.stats_file_path.?);
    try std.testing.expectEqualStrings("/tmp/runtime-stats.bin", planned.vmm_stats_file.?);
}

test "planVirtiofsEnv formats indexed virtiofs env entries" {
    const mounts = [_]LiveMount{
        .{ .host = "/host/a", .guest = "/mnt/a", .mode = "rw", .tag = "machinen-lm0" },
        .{ .host = "/host/b", .guest = "/mnt/b", .mode = "ro", .tag = "machinen-lm1" },
    };
    const env = try planVirtiofsEnv(std.testing.allocator, &mounts);
    defer {
        for (env) |pair| {
            std.testing.allocator.free(pair.key);
            std.testing.allocator.free(pair.value);
        }
        std.testing.allocator.free(env);
    }
    try std.testing.expectEqual(@as(@TypeOf(env.len), 2), env.len);
    try std.testing.expectEqualStrings("MACHINEN_VIRTIOFS_0", env[0].key);
    try std.testing.expectEqualStrings("machinen-lm0:rw:/host/a", env[0].value);
    try std.testing.expectEqualStrings("MACHINEN_VIRTIOFS_1", env[1].key);
    try std.testing.expectEqualStrings("machinen-lm1:ro:/host/b", env[1].value);
}

test "planVmstateEnv forwards snapshot restore and timing env" {
    const plan = planVmstateEnv(.{
        .state_path = "/tmp/state.vmstate",
        .restore_path = "/tmp/restore.vmstate",
        .enable_timing = true,
    });
    try std.testing.expectEqualStrings("/tmp/state.vmstate", plan.snapshot_path.?);
    try std.testing.expectEqualStrings("/tmp/restore.vmstate", plan.restore_path.?);
    try std.testing.expectEqualStrings("1", plan.vmstate_timing.?);

    const preset = planVmstateEnv(.{
        .restore_path = "/tmp/restore.vmstate",
        .enable_timing = true,
        .existing_timing = "0",
    });
    try std.testing.expectEqual(@as(?[]const u8, null), preset.vmstate_timing);
}

test "planKernelDtb forwards resolved kernel and dtb paths" {
    const plan = planKernelDtb(.{ .kernel_path = "/tmp/Image", .dtb_path = "/tmp/virt.dtb" });
    try std.testing.expectEqualStrings("/tmp/Image", plan.vmm_kernel.?);
    try std.testing.expectEqualStrings("/tmp/virt.dtb", plan.vmm_dtb.?);
    const empty = planKernelDtb(.{});
    try std.testing.expectEqual(@as(?[]const u8, null), empty.vmm_kernel);
    try std.testing.expectEqual(@as(?[]const u8, null), empty.vmm_dtb);
}

test "planVmmArgv wraps VMM argv with pdeathsig when present" {
    const direct = try planVmmArgv(std.testing.allocator, .{
        .binary = "/bin/vmm",
        .args = &.{ "--dev", "1" },
    });
    try std.testing.expectEqualStrings("/bin/vmm", direct.command.?);
    try std.testing.expectEqual(@as(@TypeOf(direct.args.len), 2), direct.args.len);
    try std.testing.expectEqualStrings("--dev", direct.args[0]);

    const wrapped = try planVmmArgv(std.testing.allocator, .{
        .binary = "/bin/vmm",
        .args = &.{"--dev"},
        .pdeathsig_path = "/bin/pdeathsig",
    });
    defer std.testing.allocator.free(wrapped.args);
    try std.testing.expectEqualStrings("/bin/pdeathsig", wrapped.command.?);
    try std.testing.expectEqual(@as(@TypeOf(wrapped.args.len), 2), wrapped.args.len);
    try std.testing.expectEqualStrings("/bin/vmm", wrapped.args[0]);
    try std.testing.expectEqualStrings("--dev", wrapped.args[1]);
}

test "validatePortForward rejects invalid and duplicate ports" {
    try std.testing.expectEqual(PortForwardValidation.ok, validatePortForward(&.{
        .{ .host_port = 8080, .guest_port = 3000 },
        .{ .host_port = 8081, .guest_port = 3001 },
    }));
    try std.testing.expectEqual(
        PortForwardValidation{ .invalid_host_port = 0 },
        validatePortForward(&.{.{ .host_port = 0, .guest_port = 3000 }}),
    );
    try std.testing.expectEqual(
        PortForwardValidation{ .invalid_guest_port = 70000 },
        validatePortForward(&.{.{ .host_port = 8080, .guest_port = 70000 }}),
    );
    try std.testing.expectEqual(
        PortForwardValidation{ .duplicate_host_port = 8080 },
        validatePortForward(&.{
            .{ .host_port = 8080, .guest_port = 3000 },
            .{ .host_port = 8080, .guest_port = 3001 },
        }),
    );
}

test "planVsock parses existing specs and formats auto specs" {
    try std.testing.expectEqualStrings(
        "/tmp/exec.sock",
        parseVsockUdsPath("in:1978:/tmp/exec.sock").?,
    );
    try std.testing.expectEqualStrings(
        "/tmp/first.sock",
        parseVsockUdsPath("out:1970:/tmp/first.sock,in:1978:/tmp/second.sock").?,
    );
    try std.testing.expectEqual(
        @as(?[]const u8, null),
        parseVsockUdsPath("in:not-a-port:/tmp/nope"),
    );

    const existing = try planVsock(std.testing.allocator, .{
        .existing_spec = "in:1978:/tmp/caller.sock",
    });
    try std.testing.expectEqualStrings("/tmp/caller.sock", existing.uds_path.?);
    try std.testing.expectEqual(@as(?[]const u8, null), existing.vmm_vsock);

    const auto = try planVsock(std.testing.allocator, .{ .auto_uds_path = "/tmp/auto.sock" });
    defer std.testing.allocator.free(auto.vmm_vsock.?);
    try std.testing.expectEqualStrings("/tmp/auto.sock", auto.uds_path.?);
    try std.testing.expectEqualStrings("in:1978:/tmp/auto.sock", auto.vmm_vsock.?);
}

test "planGuestEnv applies name and hostname wait defaults without overriding caller env" {
    const env = [_]EnvPair{.{ .key = "FOO", .value = "bar" }};
    const planned = try planGuestEnv(std.testing.allocator, .{
        .env = &env,
        .name = "worker",
        .vsock_uds_path = "/tmp/exec.sock",
    });
    defer std.testing.allocator.free(planned);
    try std.testing.expectEqual(@as(@TypeOf(planned.len), 3), planned.len);
    try std.testing.expectEqualStrings("FOO", planned[0].key);
    try std.testing.expectEqualStrings("MACHINEN_VM_NAME", planned[1].key);
    try std.testing.expectEqualStrings("worker", planned[1].value);
    try std.testing.expectEqualStrings("MACHINEN_VM_HOSTNAME_WAIT", planned[2].key);
    try std.testing.expectEqualStrings("1", planned[2].value);

    const caller_env = [_]EnvPair{
        .{ .key = "MACHINEN_VM_NAME", .value = "caller" },
        .{ .key = "MACHINEN_VM_HOSTNAME_WAIT", .value = "0" },
    };
    const preserved = try planGuestEnv(std.testing.allocator, .{
        .env = &caller_env,
        .name = "worker",
        .vsock_uds_path = "/tmp/exec.sock",
    });
    defer std.testing.allocator.free(preserved);
    try std.testing.expectEqual(@as(@TypeOf(preserved.len), 2), preserved.len);
    try std.testing.expectEqualStrings("caller", preserved[0].value);
    try std.testing.expectEqualStrings("0", preserved[1].value);
}

test "planCore plans whether initramfs packing is needed" {
    const none = try planCore(.{ .vmm_memory_preset = true });
    try std.testing.expect(!none.needs_initramfs);

    const image = try planCore(.{ .vmm_memory_preset = true, .has_image = true });
    try std.testing.expect(image.needs_initramfs);

    const command = try planCore(.{ .vmm_memory_preset = true, .has_image = true, .has_cmd = true });
    try std.testing.expect(command.needs_initramfs);

    const snapshot = try planCore(.{ .vmm_memory_preset = true, .has_snapshot = true });
    try std.testing.expect(snapshot.needs_initramfs);
}

test "planCore honors preset VMM memory after validating public input" {
    const plan = try planCore(.{
        .memory_mib = 1024,
        .vmm_memory_preset = true,
    });
    try std.testing.expectEqual(@as(?u64, null), plan.memory_ceiling_mib);
    try std.testing.expectEqual(@as(?u64, null), plan.vmm_memory_mib);
    try std.testing.expectError(error.InvalidMemory, planCore(.{
        .memory_mib = 64,
        .vmm_memory_preset = true,
    }));
}
