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
const default_boot_timeout_ms: u64 = 60_000;
const default_mount_disk_upper_size_bytes: u64 = 4 * 1024 * 1024 * 1024;
const min_cpu_weight: u64 = 1;
const max_cpu_weight: u64 = 10_000;
const max_live_mounts = 5;
const max_registry_boot_log_path = std.fs.max_path_bytes;
const restore_command = [_][]const u8{"/sbin/machinen-restore"};
const poweroff_command = [_][]const u8{"/sbin/machinen-poweroff"};

pub const RootDiskMode = enum {
    unset,
    false_value,
    path,
    true_value,
};

pub const RootDiskOptionInput = struct {
    false_value: bool = false,
    true_value: bool = false,
    path: ?[]const u8 = null,
    restore_path: ?[]const u8 = null,
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

pub const VmmEnvInput = struct {
    base: []const EnvPair = &.{},
    overrides: []const EnvPair = &.{},
};

pub const GuestHostnameInput = struct {
    pid: ?i64 = null,
    name: ?[]const u8 = null,
};

pub const GuestHostnameSetInput = struct {
    pid: ?i64 = null,
    name: ?[]const u8 = null,
    vsock_uds_path: ?[]const u8 = null,
    skip: bool = false,
};

pub const VsockPlanInput = struct {
    existing_spec: ?[]const u8 = null,
    auto_uds_path: ?[]const u8 = null,
    auto_temp_dir: ?[]const u8 = null,
};

pub const VsockModeInput = struct {
    existing_spec: ?[]const u8 = null,
};

pub const VsockModePlan = struct {
    action: []const u8,
    existing_spec: ?[]const u8,
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

pub const PortForwardProbePlan = struct {
    host_port: i64,
    probe_host: []const u8,
};

pub const PortForwardNetSocketInput = struct {
    port_forwards: []const PortForwardMapping = &.{},
    net_socket: ?[]const u8 = null,
};

pub const GvproxyPlanInput = struct {
    planning_required: bool = false,
    existing_net_socket: ?[]const u8 = null,
    gvproxy_path: ?[]const u8 = null,
    port_forwards: []const PortForwardMapping = &.{},
};

pub const GvproxyPlan = struct {
    action: []const u8,
    gvproxy_path: ?[]const u8,
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
    nested: bool = false,
};

pub const BundleEnvInput = struct {
    image_env: []const EnvPair = &.{},
    guest_env: []const EnvPair = &.{},
};

pub const BundleWorkspaceInput = struct {
    temp_dir: ?[]const u8 = null,
};

pub const BundleWorkspacePlan = struct {
    cpio_path: ?[]const u8,
    synth_bundle_dir: ?[]const u8,
};

pub const BundleConfigPathsInput = struct {
    synth_bundle_dir: ?[]const u8 = null,
};

pub const BundleConfigPathsPlan = struct {
    rootfs_dir: ?[]const u8,
    config_path: ?[]const u8,
};

pub const BundlePackInput = struct {
    use_tiny: bool = false,
    mount_guest: ?[]const u8 = null,
    restore_mount_guest: ?[]const u8 = null,
};

pub const BundlePackPlan = struct {
    kind: []const u8,
    tiny_mount_guest: ?[]const u8,
};

pub const BundleMountDiskModePlan = struct {
    action: []const u8,
};

pub const ProvisionGuestCpu = enum {
    arm64,
    amd64,
};

pub const ProvisionGuestCpuInput = struct {
    arch_override: ?[]const u8 = null,
    host_arch: ?[]const u8 = null,
};

pub const ProvisionAssetsInput = struct {
    guest_cpu: ?ProvisionGuestCpu = null,
    arch_override: ?[]const u8 = null,
    host_arch: ?[]const u8 = null,
};

pub const ProvisionAssetsPlan = struct {
    cpu: []const u8,
    kernel_asset: []const u8,
    dtb_asset: ?[]const u8,
    rootfs_asset: []const u8,
};

pub const ProvisionDtbInput = struct {
    explicit: bool = false,
    guest_cpu: ?ProvisionGuestCpu = null,
    arch_override: ?[]const u8 = null,
    host_arch: ?[]const u8 = null,
};

pub const ProvisionDtbPlan = struct {
    required: bool,
    asset: ?[]const u8,
    cli_cache_name: ?[]const u8,
};

pub const ProvisionCliCacheInput = struct {
    home_dir: ?[]const u8 = null,
    version: ?[]const u8 = null,
    guest_cpu: ?ProvisionGuestCpu = null,
    arch_override: ?[]const u8 = null,
    host_arch: ?[]const u8 = null,
};

pub const ProvisionCliCachePlan = struct {
    base_dir: ?[]const u8,
};

pub const ProvisionAssetLookupInput = struct {
    explicit_path: ?[]const u8 = null,
    explicit_exists: ?bool = null,
    assets_dir_path: ?[]const u8 = null,
    assets_dir_exists: ?bool = null,
    cache_path: ?[]const u8 = null,
    cache_exists: ?bool = null,
};

pub const ProvisionAssetLookupPlan = struct {
    path: ?[]const u8,
    error_kind: ?[]const u8,
};

pub const RestoreImageInput = struct {
    explicit_path: ?[]const u8 = null,
    explicit_exists: ?bool = null,
    meta_source_path: ?[]const u8 = null,
    meta_source_exists: ?bool = null,
};

pub const RestoreImagePlan = struct {
    path: ?[]const u8,
    error_kind: ?[]const u8,
};

pub const ProvisionBootInput = struct {
    base_path: ?[]const u8 = null,
    kernel_path: ?[]const u8 = null,
    dtb_path: ?[]const u8 = null,
    uds_path: ?[]const u8 = null,
    scratch_disk_path: ?[]const u8 = null,
    root_disk_path: ?[]const u8 = null,
    vmm_env: []const EnvPair = &.{},
};

pub const ProvisionBootPlan = struct {
    image_path: ?[]const u8,
    kernel_path: ?[]const u8,
    dtb_path: ?[]const u8,
    vmm_vsock: ?[]const u8,
    vmm_env: []const EnvPair,
    timeout_ms: ?u64,
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
    image_config_path: ?[]const u8,
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

pub const ProvisionResultInput = struct {
    image_path: ?[]const u8 = null,
    size_bytes: ?u64 = null,
    elapsed_ms: ?u64 = null,
};

pub const ProvisionResultPlan = struct {
    image_path: ?[]const u8,
    size_bytes: ?u64,
    elapsed_ms: ?u64,
};

pub const KernelDtbInput = struct {
    kernel_path: ?[]const u8 = null,
    dtb_path: ?[]const u8 = null,
};

pub const KernelDtbPlan = struct {
    vmm_kernel: ?[]const u8,
    vmm_dtb: ?[]const u8,
};

pub const InitrdInput = struct {
    initrd_path: ?[]const u8 = null,
};

pub const InitrdPlan = struct {
    vmm_initrd: ?[]const u8,
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

pub const VmstateTempModeInput = struct {
    engine: ?[]const u8 = null,
    snapshot_disabled: bool = false,
    existing_temp_dir: ?[]const u8 = null,
};

pub const VmstateTempModePlan = struct {
    action: []const u8,
    temp_dir: ?[]const u8,
};

pub const VmstateRuntimeInput = struct {
    state_path: ?[]const u8 = null,
    state_temp_dir: ?[]const u8 = null,
    chain_id: ?[]const u8 = null,
    restore_path: ?[]const u8 = null,
    forked_from: ?[]const u8 = null,
};

pub const VmstateRuntimePlan = struct {
    state_path: ?[]const u8,
    chain_id: ?[]const u8,
    checkpoint_parent: ?[]const u8,
    checkpoint_sequence: ?u64,
};

pub const LiveMountInput = struct {
    host: []const u8,
    guest: []const u8,
    mode: ?[]const u8 = null,
};

pub const LiveMountRemovedOptionsInput = struct {
    index: u64,
    has_cache: bool = false,
    has_sync: bool = false,
};

pub const LiveMountRemovedOptionsValidation = union(enum) {
    ok,
    cache: u64,
    sync: u64,
};

pub const LiveMount = struct {
    host: []const u8,
    guest: []const u8,
    mode: []const u8,
    tag: []const u8,
};

pub const RestoreLiveMountInput = struct {
    host: []const u8,
    guest: []const u8,
    mode: ?[]const u8 = null,
};

pub const RestoreRecordedLiveMount = struct {
    host: []const u8,
    guest: []const u8,
    mode: []const u8,
};

pub const RestoreLiveMountPlanInput = struct {
    recorded: []const RestoreRecordedLiveMount = &.{},
    overrides: []const RestoreLiveMountInput = &.{},
};

pub const RestoreLiveMountPlan = struct {
    mounts: []const RestoreLiveMountInput,
    unknown_guest: ?[]const u8 = null,
};

pub const BatchLiveMountInput = struct {
    live_mounts: []const LiveMount = &.{},
    vsock_uds_path: ?[]const u8 = null,
    validation_required: bool = false,
};

pub const BatchLiveMountPlan = struct {
    sync_required: bool,
};

pub const StatsFileInput = struct {
    existing_path: ?[]const u8 = null,
    planned_path: ?[]const u8 = null,
    planned_temp_dir: ?[]const u8 = null,
};

pub const StatsFileModeInput = struct {
    existing_path: ?[]const u8 = null,
};

pub const StatsFileModePlan = struct {
    action: []const u8,
    existing_path: ?[]const u8,
};

pub const StatsFileTempModeInput = struct {
    existing_path: ?[]const u8 = null,
    vsock_temp_dir: ?[]const u8 = null,
};

pub const StatsFileTempModePlan = struct {
    action: []const u8,
    existing_path: ?[]const u8,
    temp_dir: ?[]const u8,
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

pub const ScratchTempPathKind = enum {
    none,
    restore,
    auto,
};

pub const ScratchTempPathInput = struct {
    kind: ScratchTempPathKind = .none,
    tmp_dir: ?[]const u8 = null,
    pid: ?u64 = null,
    nonce: ?[]const u8 = null,
};

pub const ScratchTempPathPlan = struct {
    path: ?[]const u8,
};

pub const ScratchOptionInput = struct {
    false_value: bool = false,
    path: ?[]const u8 = null,
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

pub const RootDiskMaterializeModeInput = struct {
    restore_path: ?[]const u8 = null,
    caller_path: ?[]const u8 = null,
};

pub const RootDiskTempPathKind = enum {
    none,
    restore,
    cached,
};

pub const RootDiskTempPathInput = struct {
    kind: RootDiskTempPathKind = .none,
    tmp_dir: ?[]const u8 = null,
    pid: ?u64 = null,
    nonce: ?[]const u8 = null,
};

pub const RootDiskTempPathPlan = struct {
    path: ?[]const u8,
};

pub const RootDiskMaterializeModePlan = struct {
    action: []const u8,
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

pub const MountDiskUpperSizeInput = struct {
    size_bytes: ?u64 = null,
};

pub const MountDiskTempPathKind = enum {
    none,
    restore_upper,
};

pub const MountDiskTempPathInput = struct {
    kind: MountDiskTempPathKind = .none,
    tmp_dir: ?[]const u8 = null,
    pid: ?u64 = null,
    nonce: ?[]const u8 = null,
};

pub const MountDiskTempPathPlan = struct {
    path: ?[]const u8,
};

pub const MountDiskUpperSizeValidation = union(enum) {
    ok: u64,
    invalid: u64,
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

pub const MountDiskFdEnvInput = struct {
    lower_fd: ?u64 = null,
    upper_fd: ?u64 = null,
};

pub const SnapshotMountDiskInput = struct {
    guest: ?[]const u8 = null,
    lower_path: ?[]const u8 = null,
    upper_path: ?[]const u8 = null,
};

pub const SnapshotMountDiskPlan = struct {
    guest: []const u8,
    lower_path: []const u8,
    upper_path: []const u8,
};

pub const SnapshotLiveMountPlan = struct {
    host: []const u8,
    guest: []const u8,
    mode: []const u8,
};

pub const SnapshotVmstateInput = struct {
    state_path: ?[]const u8 = null,
    chain_id: ?[]const u8 = null,
    checkpoint_parent: ?[]const u8 = null,
    checkpoint_sequence: ?u64 = null,
};

pub const SnapshotVmstateChainPlan = struct {
    chain_id: []const u8,
    parent_dir: ?[]const u8,
    sequence: u64,
};

pub const SnapshotContextInput = struct {
    mount_disk: SnapshotMountDiskInput = .{},
    live_mounts: []const LiveMount = &.{},
    vmstate: SnapshotVmstateInput = .{},
};

pub const SnapshotContextPlan = struct {
    mount_disk: ?SnapshotMountDiskPlan,
    live_mounts: []const SnapshotLiveMountPlan,
    vmstate_chain: ?SnapshotVmstateChainPlan,
};

pub const SnapshotBackingInput = struct {
    engine: ?[]const u8 = null,
    action: ?[]const u8 = null,
    disk_path: ?[]const u8 = null,
    vmstate_path: ?[]const u8 = null,
};

pub const SnapshotBackingPlan = struct {
    allowed: bool,
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

pub const RegistryProcessInput = struct {
    host_platform: ?[]const u8 = null,
    child_pid: ?i64 = null,
    vmm_binary: ?[]const u8 = null,
    vmm_pdeathsig: bool = false,
    vmm_observed_exe_base: ?[]const u8 = null,
    gv_pid: ?i64 = null,
    gv_exe: ?[]const u8 = null,
    gv_observed_exe_base: ?[]const u8 = null,
};

pub const RegistryProcessIdentityPlan = struct {
    vmm_pid: ?i64,
    gv_pid: ?i64,
};

pub const RegistryProcessPlan = struct {
    vmm_exe: ?[]const u8,
    gvproxy_exe: ?[]const u8,
};

pub const RegistryLifecycleInput = struct {
    name: ?[]const u8 = null,
    child_pid: ?i64 = null,
    vsock_uds_path: ?[]const u8 = null,
};

pub const RegistryLifecyclePlan = struct {
    claim_name: ?[]const u8,
    should_write: bool,
};

pub const RegistryShapeInput = struct {
    source_image_path: ?[]const u8 = null,
    per_boot_root_disk: ?[]const u8 = null,
    boot_log_root: ?[]const u8 = null,
    child_pid: ?i64 = null,
    detached: bool = false,
    caller_root_disk_path: ?[]const u8 = null,
    disk_path: ?[]const u8 = null,
    forked_from: ?[]const u8 = null,
    memory_ceiling_mib: ?u64 = null,
    stats_path: ?[]const u8 = null,
    cleanup: RegistryCleanupInput = .{},
    mount_disk: RegistryMountDiskInput = .{},
    live_mounts: []const LiveMount = &.{},
    port_forwards: []const PortForwardMapping = &.{},
    cpu_policy: ?CpuPolicyPlan = null,
    cpu_control_status: ?[]const u8 = null,
    cpu_control_reason: ?[]const u8 = null,
    vmstate: RegistryVmstateInput = .{},
    nested: bool = false,
};

pub const RegistryBootLogPath = struct {
    bytes: [max_registry_boot_log_path]u8 = undefined,
    len: u16 = 0,

    pub fn value(self: *const RegistryBootLogPath) ?[]const u8 {
        assert(self.len <= max_registry_boot_log_path);

        if (self.len == 0) return null;
        return self.bytes[0..self.len];
    }
};

pub const RegistryShapePlan = struct {
    source_image_path: ?[]const u8,
    root_disk_path: ?[]const u8,
    root_disk_mode: []const u8,
    boot_log_path: RegistryBootLogPath,
    disk_path: ?[]const u8,
    forked_from: ?[]const u8,
    memory_ceiling_mib: ?u64,
    stats_path: ?[]const u8,
    cleanup_paths: []const []const u8,
    mount_disk: ?RegistryMountDiskPlan,
    live_mounts: []const RegistryLiveMountPlan,
    port_forwards: []const RegistryPortForwardPlan,
    cpu: ?RegistryCpuPlan,
    vmstate: RegistryVmstatePlan,
    nested: bool,
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
    boot_timeout_ms: ?u64 = null,
    boot_timeout_forever: bool = false,
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
    timeout_ms: ?u64,
    detached_readiness_timeout_ms: u64,
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
    MissingMountDiskFdField,
    MissingBatchLiveMountVsock,
    PortForwardNetSocketPreset,
    MissingGvproxy,
    MissingSnapshotMountDiskField,
    MissingSnapshotVmstateField,
    IncompleteRegistryMountDisk,
    MissingProvisionRepackField,
    MissingRegistryCpuStatus,
    MissingRegistryVmstateField,
    MissingVmstateRuntimeChainId,
};

pub fn planDetachedReadinessTimeout(timeout_ms: ?u64) u64 {
    assert(default_boot_timeout_ms > 0);

    return timeout_ms orelse default_boot_timeout_ms;
}

pub fn planBootTimeout(timeout_ms: ?u64, forever: bool) ?u64 {
    assert(default_boot_timeout_ms > 0);

    if (forever) return null;
    return timeout_ms orelse default_boot_timeout_ms;
}

pub fn planPdeathsig(input: PdeathsigInput) bool {
    assert(@sizeOf(PdeathsigInput) > 0);

    if (input.detached) return false;
    return input.pdeathsig orelse true;
}

pub fn formatGuestHostname(buffer: []u8, input: GuestHostnameInput) !?[]const u8 {
    assert(buffer.len > 0);

    const pid = input.pid orelse return null;
    var len: u16 = 0;
    try appendSanitizedHostnameName(buffer, &len, input.name orelse "");
    if (len == 0) {
        try appendHostnameText(buffer, &len, "vm");
    }
    try appendHostnameText(buffer, &len, "-pid-");
    const pid_text = try std.fmt.bufPrint(buffer[len..], "{d}", .{pid});
    len += @intCast(pid_text.len);
    return buffer[0..len];
}

pub fn formatGuestHostnameSet(buffer: []u8, input: GuestHostnameSetInput) !?[]const u8 {
    assert(buffer.len > 0);

    if (input.skip) return null;
    if (input.vsock_uds_path == null) return null;
    return formatGuestHostname(buffer, .{ .pid = input.pid, .name = input.name });
}

fn appendSanitizedHostnameName(buffer: []u8, len: *u16, name: []const u8) !void {
    assert(name.len <= buffer.len or buffer.len > 0);

    for (name) |c| {
        if (isHostnameAlnum(c)) {
            try appendHostnameByte(buffer, len, c);
        } else {
            if (len.* > 0 and buffer[len.* - 1] != '-') {
                try appendHostnameByte(buffer, len, '-');
            }
        }
    }
    while (len.* > 0 and buffer[len.* - 1] == '-') {
        len.* -= 1;
    }
}

fn appendHostnameText(buffer: []u8, len: *u16, text: []const u8) !void {
    assert(text.len > 0);

    for (text) |c| try appendHostnameByte(buffer, len, c);
}

fn appendHostnameByte(buffer: []u8, len: *u16, byte: u8) !void {
    assert(buffer.len > 0);

    if (len.* >= buffer.len) return error.NoSpaceLeft;
    buffer[len.*] = byte;
    len.* += 1;
}

fn isHostnameAlnum(c: u8) bool {
    assert(@sizeOf(u8) == 1);

    return (c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or (c >= '0' and c <= '9');
}

pub fn planVmstateTempMode(input: VmstateTempModeInput) VmstateTempModePlan {
    assert(@sizeOf(VmstateTempModeInput) > 0);

    const engine = input.engine orelse return .{ .action = "skip", .temp_dir = null };
    if (!std.mem.eql(u8, engine, "vmstate") or input.snapshot_disabled) {
        return .{ .action = "skip", .temp_dir = null };
    }
    if (input.existing_temp_dir) |temp_dir| return .{ .action = "reuse", .temp_dir = temp_dir };
    return .{ .action = "allocate", .temp_dir = null };
}

pub fn planVmstateRuntime(
    allocator: std.mem.Allocator,
    input: VmstateRuntimeInput,
) PlanError!VmstateRuntimePlan {
    assert(@sizeOf(VmstateRuntimeInput) > 0);

    if (input.state_path == null and
        input.state_temp_dir == null and
        input.chain_id == null and
        input.restore_path == null and
        input.forked_from == null)
    {
        return .{
            .state_path = null,
            .chain_id = null,
            .checkpoint_parent = null,
            .checkpoint_sequence = null,
        };
    }
    const chain_id = input.chain_id orelse return error.MissingVmstateRuntimeChainId;
    const state_path = input.state_path orelse blk: {
        const dir = input.state_temp_dir orelse break :blk null;
        break :blk try std.fs.path.join(allocator, &.{ dir, "state.vmstate" });
    };
    return .{
        .state_path = state_path,
        .chain_id = chain_id,
        .checkpoint_parent = if (input.restore_path != null) input.forked_from else null,
        .checkpoint_sequence = 0,
    };
}

pub fn planNestedEnv(nested: bool) ?[]const u8 {
    assert(@sizeOf(bool) > 0);

    return if (nested) "1" else null;
}

pub fn planRootDiskMode(input: RootDiskOptionInput) RootDiskMode {
    assert(@sizeOf(RootDiskOptionInput) > 0);

    if (input.false_value) return .false_value;
    if (input.restore_path != null) return .path;
    if (input.path != null) return .path;
    if (input.true_value) return .true_value;
    return .unset;
}

pub fn planCpuResources(input: ?CpuResourcesInput) PlanError!?CpuPolicyPlan {
    assert(@sizeOf(CpuResourcesInput) > 0);

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

pub fn planVmmEnv(allocator: std.mem.Allocator, input: VmmEnvInput) ![]EnvPair {
    assert(@sizeOf(VmmEnvInput) > 0);

    return mergeEnvPairs(allocator, input.base, input.overrides);
}

pub fn planVsockMode(input: VsockModeInput) VsockModePlan {
    assert(@sizeOf(VsockModeInput) > 0);

    if (input.existing_spec) |spec| return .{ .action = "existing", .existing_spec = spec };
    return .{ .action = "allocate", .existing_spec = null };
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
    if (input.auto_temp_dir) |dir| {
        const uds = try std.fs.path.join(allocator, &.{ dir, "exec.sock" });
        errdefer allocator.free(uds);
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

pub fn planInitrdEnv(input: InitrdInput) InitrdPlan {
    assert(@sizeOf(InitrdInput) > 0);

    return .{ .vmm_initrd = input.initrd_path };
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

pub fn validateLiveMountRemovedOptions(
    input: LiveMountRemovedOptionsInput,
) LiveMountRemovedOptionsValidation {
    assert(@sizeOf(LiveMountRemovedOptionsInput) > 0);

    if (input.has_cache) return .{ .cache = input.index };
    if (input.has_sync) return .{ .sync = input.index };
    return .ok;
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

pub fn planBatchLiveMountSync(input: BatchLiveMountInput) PlanError!BatchLiveMountPlan {
    assert(@sizeOf(BatchLiveMountInput) > 0);

    for (input.live_mounts) |mount| {
        if (std.mem.eql(u8, mount.mode, "rw")) {
            if (input.validation_required and input.vsock_uds_path == null) {
                return error.MissingBatchLiveMountVsock;
            }
            return .{ .sync_required = true };
        }
    }
    return .{ .sync_required = false };
}

pub fn planRestoreLiveMounts(
    allocator: std.mem.Allocator,
    input: RestoreLiveMountPlanInput,
) !RestoreLiveMountPlan {
    assert(@sizeOf(RestoreLiveMountPlanInput) > 0);

    if (input.recorded.len == 0) {
        return .{ .mounts = input.overrides };
    }
    for (input.overrides) |override| {
        if (findRecordedLiveMount(input.recorded, override.guest) == null) {
            return .{ .mounts = &.{}, .unknown_guest = override.guest };
        }
    }
    var out: std.array_list.Aligned(RestoreLiveMountInput, null) = .empty;
    errdefer out.deinit(allocator);
    for (input.recorded) |recorded| {
        if (findRestoreLiveMountOverride(input.overrides, recorded.guest)) |override| {
            try out.append(allocator, .{
                .host = override.host,
                .guest = recorded.guest,
                .mode = override.mode orelse recorded.mode,
            });
        } else {
            try out.append(allocator, .{
                .host = recorded.host,
                .guest = recorded.guest,
                .mode = recorded.mode,
            });
        }
    }
    return .{ .mounts = try out.toOwnedSlice(allocator) };
}

fn findRecordedLiveMount(
    recorded: []const RestoreRecordedLiveMount,
    guest: []const u8,
) ?RestoreRecordedLiveMount {
    assert(@sizeOf(RestoreRecordedLiveMount) > 0);

    for (recorded) |mount| {
        if (std.mem.eql(u8, mount.guest, guest)) return mount;
    }
    return null;
}

fn findRestoreLiveMountOverride(
    overrides: []const RestoreLiveMountInput,
    guest: []const u8,
) ?RestoreLiveMountInput {
    assert(@sizeOf(RestoreLiveMountInput) > 0);

    var found: ?RestoreLiveMountInput = null;
    for (overrides) |mount| {
        if (std.mem.eql(u8, mount.guest, guest)) found = mount;
    }
    return found;
}

pub fn planStatsFileMode(input: StatsFileModeInput) StatsFileModePlan {
    assert(@sizeOf(StatsFileModeInput) > 0);

    if (input.existing_path) |path| return .{ .action = "existing", .existing_path = path };
    return .{ .action = "allocate", .existing_path = null };
}

pub fn planStatsFileTempMode(input: StatsFileTempModeInput) StatsFileTempModePlan {
    assert(@sizeOf(StatsFileTempModeInput) > 0);

    if (input.existing_path) |path| {
        return .{ .action = "existing", .existing_path = path, .temp_dir = null };
    }
    if (input.vsock_temp_dir) |dir| {
        return .{ .action = "reuse", .existing_path = null, .temp_dir = dir };
    }
    return .{ .action = "allocate", .existing_path = null, .temp_dir = null };
}

pub fn planStatsFile(allocator: std.mem.Allocator, input: StatsFileInput) !StatsFilePlan {
    assert(@sizeOf(StatsFileInput) > 0);

    if (input.existing_path) |path| {
        return .{ .stats_file_path = path, .vmm_stats_file = null };
    }
    const planned_path = input.planned_path orelse if (input.planned_temp_dir) |dir|
        try std.fs.path.join(allocator, &.{ dir, "stats.bin" })
    else
        null;
    if (planned_path) |path| {
        return .{ .stats_file_path = path, .vmm_stats_file = path };
    }
    return .{ .stats_file_path = null, .vmm_stats_file = null };
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

pub fn planProvisionResult(input: ProvisionResultInput) ProvisionResultPlan {
    assert(@sizeOf(ProvisionResultInput) > 0);

    return .{
        .image_path = input.image_path,
        .size_bytes = input.size_bytes,
        .elapsed_ms = input.elapsed_ms,
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
        return .{ .extract_args = &.{}, .targz_args = &.{}, .image_config_path = null };
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
    const image_config_path = try std.fs.path.join(allocator, &.{
        extract_dir,
        "machinen-config.json",
    });
    errdefer allocator.free(image_config_path);
    return .{
        .extract_args = extract_args,
        .targz_args = targz_args,
        .image_config_path = image_config_path,
    };
}

fn provisionRepackInputEmpty(input: ProvisionRepackInput) bool {
    assert(@sizeOf(ProvisionRepackInput) > 0);

    return input.disk_path == null and input.out_path == null and input.extract_dir == null;
}

pub fn planProvisionDtb(input: ProvisionDtbInput) ProvisionDtbPlan {
    assert(@sizeOf(ProvisionDtbInput) > 0);

    if (input.explicit) return .{ .required = false, .asset = null, .cli_cache_name = null };
    const assets = planProvisionAssets(.{
        .guest_cpu = input.guest_cpu,
        .arch_override = input.arch_override,
        .host_arch = input.host_arch,
    });
    const asset = assets.dtb_asset orelse return .{
        .required = false,
        .asset = null,
        .cli_cache_name = null,
    };
    return .{ .required = true, .asset = asset, .cli_cache_name = "virt.dtb" };
}

pub fn planProvisionCliCacheBaseDir(
    allocator: std.mem.Allocator,
    input: ProvisionCliCacheInput,
) !ProvisionCliCachePlan {
    assert(@sizeOf(ProvisionCliCacheInput) > 0);

    const home_dir = input.home_dir orelse return .{ .base_dir = null };
    const version = input.version orelse return .{ .base_dir = null };
    const assets = planProvisionAssets(.{
        .guest_cpu = input.guest_cpu,
        .arch_override = input.arch_override,
        .host_arch = input.host_arch,
    });
    var release_buf: [128]u8 = undefined;
    const release_dir = try std.fmt.bufPrint(&release_buf, "runtime-v{s}", .{version});
    var cpu_buf: [32]u8 = undefined;
    const cpu_dir = try std.fmt.bufPrint(&cpu_buf, "debian-{s}", .{assets.cpu});
    return .{
        .base_dir = try std.fs.path.join(
            allocator,
            &.{ home_dir, ".machinen", release_dir, "bases", cpu_dir },
        ),
    };
}

pub fn planProvisionAssetLookup(input: ProvisionAssetLookupInput) ProvisionAssetLookupPlan {
    assert(@sizeOf(ProvisionAssetLookupInput) > 0);

    if (input.explicit_path) |path| {
        if (input.explicit_exists == true) return .{ .path = path, .error_kind = null };
        return .{ .path = null, .error_kind = "missing" };
    }
    if (input.assets_dir_path) |path| {
        if (input.assets_dir_exists == true) return .{ .path = path, .error_kind = null };
        return .{ .path = null, .error_kind = "assets-dir-invalid" };
    }
    if (input.cache_path) |path| {
        if (input.cache_exists == true) return .{ .path = path, .error_kind = null };
    }
    return .{ .path = null, .error_kind = "missing" };
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
    const vmm_env = if (vmm_vsock) |spec| blk: {
        const overrides = [_]EnvPair{.{ .key = "MACHINEN_VSOCK", .value = spec }};
        break :blk try planVmmEnv(allocator, .{ .base = input.vmm_env, .overrides = &overrides });
    } else try planVmmEnv(allocator, .{ .base = input.vmm_env });
    errdefer allocator.free(vmm_env);
    return .{
        .image_path = input.base_path,
        .kernel_path = input.kernel_path,
        .dtb_path = input.dtb_path,
        .vmm_vsock = vmm_vsock,
        .vmm_env = vmm_env,
        .timeout_ms = null,
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

pub fn planProvisionGuestCpu(input: ProvisionGuestCpuInput) ProvisionGuestCpu {
    assert(@sizeOf(ProvisionGuestCpuInput) > 0);

    if (input.arch_override) |override| {
        if (std.mem.eql(u8, override, "arm64")) return .arm64;
        if (std.mem.eql(u8, override, "amd64")) return .amd64;
    }
    if (input.host_arch) |host_arch| {
        if (std.mem.eql(u8, host_arch, "x64")) return .amd64;
    }
    return .arm64;
}

pub fn planScratchMode(input: ScratchOptionInput) ScratchDiskMode {
    assert(@sizeOf(ScratchOptionInput) > 0);

    if (input.false_value) return .false_value;
    if (input.path != null) return .path;
    return .auto;
}

pub fn planProvisionAssets(input: ProvisionAssetsInput) ProvisionAssetsPlan {
    assert(@sizeOf(ProvisionAssetsInput) > 0);

    const cpu = input.guest_cpu orelse planProvisionGuestCpu(.{
        .arch_override = input.arch_override,
        .host_arch = input.host_arch,
    });
    return switch (cpu) {
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

pub fn planRestoreImage(input: RestoreImageInput) RestoreImagePlan {
    assert(@sizeOf(RestoreImageInput) > 0);

    if (input.explicit_path) |path| {
        if (input.explicit_exists == true) return .{ .path = path, .error_kind = null };
        return .{ .path = null, .error_kind = "explicit-missing" };
    }
    if (input.meta_source_path) |path| {
        if (input.meta_source_exists == true) return .{ .path = path, .error_kind = null };
        return .{ .path = null, .error_kind = "meta-missing" };
    }
    return .{ .path = null, .error_kind = "missing" };
}

pub fn planBundleWorkspace(
    allocator: std.mem.Allocator,
    input: BundleWorkspaceInput,
) !BundleWorkspacePlan {
    assert(@sizeOf(BundleWorkspaceInput) > 0);

    const temp_dir = input.temp_dir orelse return .{
        .cpio_path = null,
        .synth_bundle_dir = null,
    };
    const cpio_path = try std.fs.path.join(allocator, &.{ temp_dir, "initramfs.cpio" });
    errdefer allocator.free(cpio_path);
    return .{
        .cpio_path = cpio_path,
        .synth_bundle_dir = try std.fs.path.join(allocator, &.{ temp_dir, "bundle" }),
    };
}

pub fn planBundleConfigPaths(
    allocator: std.mem.Allocator,
    input: BundleConfigPathsInput,
) !BundleConfigPathsPlan {
    assert(@sizeOf(BundleConfigPathsInput) > 0);

    const synth_bundle_dir = input.synth_bundle_dir orelse return .{
        .rootfs_dir = null,
        .config_path = null,
    };
    const rootfs_dir = try std.fs.path.join(allocator, &.{ synth_bundle_dir, "rootfs" });
    errdefer allocator.free(rootfs_dir);
    return .{
        .rootfs_dir = rootfs_dir,
        .config_path = try std.fs.path.join(allocator, &.{
            synth_bundle_dir,
            "machinen-config.json",
        }),
    };
}

pub fn planBundlePack(input: BundlePackInput) BundlePackPlan {
    assert(@sizeOf(BundlePackInput) > 0);

    if (!input.use_tiny) return .{ .kind = "fat", .tiny_mount_guest = null };
    return .{
        .kind = "tiny",
        .tiny_mount_guest = input.mount_guest orelse input.restore_mount_guest,
    };
}

pub fn planBundleMountDiskMode(input: BundlePackInput) BundleMountDiskModePlan {
    assert(@sizeOf(BundlePackInput) > 0);

    if (!input.use_tiny) return .{ .action = "none" };
    if (input.restore_mount_guest != null) return .{ .action = "restore" };
    if (input.mount_guest != null) return .{ .action = "fresh" };
    return .{ .action = "none" };
}

pub fn planBundleEnv(allocator: std.mem.Allocator, input: BundleEnvInput) ![]EnvPair {
    assert(@sizeOf(BundleEnvInput) > 0);

    return mergeEnvPairs(allocator, input.image_env, input.guest_env);
}

fn mergeEnvPairs(
    allocator: std.mem.Allocator,
    base: []const EnvPair,
    overrides: []const EnvPair,
) ![]EnvPair {
    assert(@sizeOf(EnvPair) > 0);

    var out: std.array_list.Aligned(EnvPair, null) = .empty;
    errdefer out.deinit(allocator);
    try out.appendSlice(allocator, base);
    for (overrides) |pair| {
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

pub fn planScratchTempPath(
    allocator: std.mem.Allocator,
    input: ScratchTempPathInput,
) !ScratchTempPathPlan {
    assert(@sizeOf(ScratchTempPathInput) > 0);

    if (input.kind == .none) return .{ .path = null };
    const tmp_dir = input.tmp_dir orelse return .{ .path = null };
    const pid = input.pid orelse return .{ .path = null };
    const nonce = input.nonce orelse return .{ .path = null };
    var name_buf: [128]u8 = undefined;
    const file_name = switch (input.kind) {
        .none => unreachable,
        .restore => try std.fmt.bufPrint(
            &name_buf,
            "machinen-snap-restore-{d}-{s}.img",
            .{ pid, nonce },
        ),
        .auto => try std.fmt.bufPrint(
            &name_buf,
            "machinen-snap-{d}-{s}.img",
            .{ pid, nonce },
        ),
    };
    return .{ .path = try std.fs.path.join(allocator, &.{ tmp_dir, file_name }) };
}

pub fn planRootDiskTempPath(
    allocator: std.mem.Allocator,
    input: RootDiskTempPathInput,
) !RootDiskTempPathPlan {
    assert(@sizeOf(RootDiskTempPathInput) > 0);

    if (input.kind == .none) return .{ .path = null };
    const tmp_dir = input.tmp_dir orelse return .{ .path = null };
    const pid = input.pid orelse return .{ .path = null };
    const nonce = input.nonce orelse return .{ .path = null };
    var name_buf: [128]u8 = undefined;
    const file_name = switch (input.kind) {
        .none => unreachable,
        .restore => try std.fmt.bufPrint(
            &name_buf,
            "machinen-rootdisk-restore-{d}-{s}.img",
            .{ pid, nonce },
        ),
        .cached => try std.fmt.bufPrint(
            &name_buf,
            "machinen-rootdisk-{d}-{s}.img",
            .{ pid, nonce },
        ),
    };
    return .{ .path = try std.fs.path.join(allocator, &.{ tmp_dir, file_name }) };
}

pub fn planRootDiskMaterializeMode(
    input: RootDiskMaterializeModeInput,
) RootDiskMaterializeModePlan {
    assert(@sizeOf(RootDiskMaterializeModeInput) > 0);

    if (input.restore_path != null) return .{ .action = "restore" };
    if (input.caller_path != null) return .{ .action = "caller" };
    return .{ .action = "cached" };
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

pub fn planMountDiskTempPath(
    allocator: std.mem.Allocator,
    input: MountDiskTempPathInput,
) !MountDiskTempPathPlan {
    assert(@sizeOf(MountDiskTempPathInput) > 0);

    if (input.kind == .none) return .{ .path = null };
    const tmp_dir = input.tmp_dir orelse return .{ .path = null };
    const pid = input.pid orelse return .{ .path = null };
    const nonce = input.nonce orelse return .{ .path = null };
    var name_buf: [128]u8 = undefined;
    const file_name = switch (input.kind) {
        .none => unreachable,
        .restore_upper => try std.fmt.bufPrint(
            &name_buf,
            "machinen-mountdisk-upper-{d}-{s}.img",
            .{ pid, nonce },
        ),
    };
    return .{ .path = try std.fs.path.join(allocator, &.{ tmp_dir, file_name }) };
}

pub fn planMountDiskUpperSize(input: MountDiskUpperSizeInput) MountDiskUpperSizeValidation {
    assert(@sizeOf(MountDiskUpperSizeInput) > 0);

    const size_bytes = input.size_bytes orelse default_mount_disk_upper_size_bytes;
    if (size_bytes == 0 or size_bytes % 4096 != 0) return .{ .invalid = size_bytes };
    return .{ .ok = size_bytes };
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

pub fn planSnapshotContext(
    allocator: std.mem.Allocator,
    input: SnapshotContextInput,
) PlanError!SnapshotContextPlan {
    assert(@sizeOf(SnapshotContextInput) > 0);

    return .{
        .mount_disk = try planSnapshotMountDisk(input.mount_disk),
        .live_mounts = try planSnapshotLiveMounts(allocator, input.live_mounts),
        .vmstate_chain = try planSnapshotVmstateChain(input.vmstate),
    };
}

pub fn planSnapshotBacking(input: SnapshotBackingInput) SnapshotBackingPlan {
    assert(@sizeOf(SnapshotBackingInput) > 0);

    const engine = input.engine orelse return .{ .allowed = true };
    const action = input.action orelse return .{ .allowed = true };
    if (!std.mem.eql(u8, action, "snapshot") and !std.mem.eql(u8, action, "fork")) {
        return .{ .allowed = true };
    }
    if (std.mem.eql(u8, engine, "criu")) return .{ .allowed = input.disk_path != null };
    if (std.mem.eql(u8, engine, "vmstate")) return .{ .allowed = input.vmstate_path != null };
    return .{ .allowed = true };
}

fn planSnapshotMountDisk(input: SnapshotMountDiskInput) PlanError!?SnapshotMountDiskPlan {
    assert(@sizeOf(SnapshotMountDiskInput) > 0);

    if (input.guest == null and input.lower_path == null and input.upper_path == null) return null;
    return .{
        .guest = input.guest orelse return error.MissingSnapshotMountDiskField,
        .lower_path = input.lower_path orelse return error.MissingSnapshotMountDiskField,
        .upper_path = input.upper_path orelse return error.MissingSnapshotMountDiskField,
    };
}

fn planSnapshotLiveMounts(
    allocator: std.mem.Allocator,
    input: []const LiveMount,
) PlanError![]const SnapshotLiveMountPlan {
    assert(@sizeOf(LiveMount) > 0);

    if (input.len > max_live_mounts) return error.TooManyLiveMounts;
    var mounts: [max_live_mounts]SnapshotLiveMountPlan = undefined;
    for (input, 0..) |mount, i| {
        mounts[i] = .{ .host = mount.host, .guest = mount.guest, .mode = mount.mode };
    }
    return std.mem.concat(allocator, SnapshotLiveMountPlan, &.{mounts[0..input.len]});
}

fn planSnapshotVmstateChain(input: SnapshotVmstateInput) PlanError!?SnapshotVmstateChainPlan {
    assert(@sizeOf(SnapshotVmstateInput) > 0);

    if (input.state_path == null) return null;
    return .{
        .chain_id = input.chain_id orelse return error.MissingSnapshotVmstateField,
        .parent_dir = input.checkpoint_parent,
        .sequence = input.checkpoint_sequence orelse return error.MissingSnapshotVmstateField,
    };
}

pub fn planRegistryProcessIdentityReads(input: RegistryProcessInput) RegistryProcessIdentityPlan {
    assert(@sizeOf(RegistryProcessInput) > 0);

    const is_darwin = if (input.host_platform) |platform|
        std.mem.eql(u8, platform, "darwin")
    else
        false;
    if (!is_darwin) return .{ .vmm_pid = null, .gv_pid = null };
    const child_pid = input.child_pid orelse -1;
    const gv_pid = input.gv_pid orelse -1;
    return .{
        .vmm_pid = if (input.vmm_pdeathsig and child_pid > 0) child_pid else null,
        .gv_pid = if (gv_pid > 0) gv_pid else null,
    };
}

pub fn planRegistryProcess(input: RegistryProcessInput) RegistryProcessPlan {
    assert(@sizeOf(RegistryProcessInput) > 0);

    const is_darwin = if (input.host_platform) |platform|
        std.mem.eql(u8, platform, "darwin")
    else
        false;
    const vmm_exe = if (input.vmm_binary) |binary|
        if (is_darwin and input.vmm_pdeathsig) input.vmm_observed_exe_base orelse binary else binary
    else
        null;
    const gvproxy_exe = if (is_darwin and (input.gv_pid orelse 0) > 0)
        input.gv_observed_exe_base orelse input.gv_exe
    else
        input.gv_exe;
    return .{ .vmm_exe = vmm_exe, .gvproxy_exe = gvproxy_exe };
}

pub fn planRegistryLifecycle(input: RegistryLifecycleInput) RegistryLifecyclePlan {
    assert(@sizeOf(RegistryLifecycleInput) > 0);

    const has_live_pid = (input.child_pid orelse 0) > 0;
    const claim_name = if (has_live_pid) input.name else null;
    return .{
        .claim_name = claim_name,
        .should_write = has_live_pid and input.vsock_uds_path != null,
    };
}

pub fn planRegistryShape(
    allocator: std.mem.Allocator,
    input: RegistryShapeInput,
) PlanError!RegistryShapePlan {
    assert(@sizeOf(RegistryShapeInput) > 0);

    const root_disk_path = input.per_boot_root_disk orelse input.caller_root_disk_path;
    const boot_log_path = try planRegistryBootLogPath(input);
    return .{
        .source_image_path = input.source_image_path,
        .root_disk_path = root_disk_path,
        .root_disk_mode = if (root_disk_path != null) "block" else "none",
        .boot_log_path = boot_log_path,
        .disk_path = input.disk_path,
        .forked_from = input.forked_from,
        .memory_ceiling_mib = input.memory_ceiling_mib,
        .stats_path = input.stats_path,
        .cleanup_paths = try planRegistryCleanupPaths(allocator, input.cleanup),
        .mount_disk = try planRegistryMountDisk(input.mount_disk),
        .live_mounts = try planRegistryLiveMounts(allocator, input.live_mounts),
        .port_forwards = try planRegistryPortForwards(allocator, input.port_forwards),
        .cpu = try planRegistryCpu(input),
        .vmstate = try planRegistryVmstate(input.vmstate),
        .nested = input.nested,
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

fn planRegistryBootLogPath(input: RegistryShapeInput) !RegistryBootLogPath {
    assert(@sizeOf(RegistryShapeInput) > 0);

    var path: RegistryBootLogPath = .{};
    if (!input.detached) return path;
    const pid = input.child_pid orelse return path;
    if (pid <= 0) return path;
    const root = input.boot_log_root orelse return path;
    const text = std.fmt.bufPrint(&path.bytes, "{s}/{d}.boot.log", .{ root, pid }) catch
        return error.OutOfMemory;
    path.len = @intCast(text.len);
    return path;
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

pub fn planMountDiskFdEnv(
    allocator: std.mem.Allocator,
    input: MountDiskFdEnvInput,
) ![]EnvPair {
    assert(@sizeOf(MountDiskFdEnvInput) > 0);

    if (input.lower_fd == null and input.upper_fd == null) return &.{};
    const lower_fd = input.lower_fd orelse return error.MissingMountDiskFdField;
    const upper_fd = input.upper_fd orelse return error.MissingMountDiskFdField;
    var lower_buf: [20]u8 = undefined;
    var upper_buf: [20]u8 = undefined;
    const lower_text = try std.fmt.bufPrint(&lower_buf, "{d}", .{lower_fd});
    const upper_text = try std.fmt.bufPrint(&upper_buf, "{d}", .{upper_fd});
    const lower_value = try std.mem.concat(allocator, u8, &.{lower_text});
    errdefer allocator.free(lower_value);
    const upper_value = try std.mem.concat(allocator, u8, &.{upper_text});
    errdefer allocator.free(upper_value);
    return try std.mem.concat(allocator, EnvPair, &.{&[_]EnvPair{
        .{ .key = "MACHINEN_MOUNTDISK_LOWER_FD", .value = lower_value },
        .{ .key = "MACHINEN_MOUNTDISK_UPPER_FD", .value = upper_value },
    }});
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

pub fn planPortForwardProbe(mapping: PortForwardMapping) PortForwardProbePlan {
    assert(@sizeOf(PortForwardMapping) > 0);

    return .{
        .host_port = mapping.host_port,
        .probe_host = mapping.host_addr orelse "127.0.0.1",
    };
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
    const timeout_ms = planBootTimeout(input.boot_timeout_ms, input.boot_timeout_forever);
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
            .timeout_ms = timeout_ms,
            .detached_readiness_timeout_ms = planDetachedReadinessTimeout(timeout_ms),
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
        .timeout_ms = timeout_ms,
        .detached_readiness_timeout_ms = planDetachedReadinessTimeout(timeout_ms),
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

test "planBootTimeout defaults, preserves explicit values, and supports forever" {
    try std.testing.expectEqual(@as(u64, 60_000), planDetachedReadinessTimeout(null));
    try std.testing.expectEqual(@as(?u64, 60_000), planBootTimeout(null, false));
    try std.testing.expectEqual(@as(?u64, 2_500), planBootTimeout(2_500, false));
    try std.testing.expect(planBootTimeout(2_500, true) == null);
    try std.testing.expect((try planCore(std.testing.allocator, .{
        .memory_mib = 256,
        .boot_timeout_ms = 1_234,
    })).timeout_ms.? == 1_234);
    try std.testing.expect((try planCore(std.testing.allocator, .{
        .memory_mib = 256,
        .boot_timeout_forever = true,
    })).timeout_ms == null);
}

test "planGuestHostname sanitizes names and includes pid" {
    var named_buffer: [128]u8 = undefined;
    const named = (try formatGuestHostname(&named_buffer, .{ .pid = 1234, .name = "worker" })).?;
    try std.testing.expectEqualStrings("worker-pid-1234", named);

    var nameless_buffer: [128]u8 = undefined;
    const nameless = (try formatGuestHostname(&nameless_buffer, .{ .pid = 1234 })).?;
    try std.testing.expectEqualStrings("vm-pid-1234", nameless);

    var sanitized_buffer: [128]u8 = undefined;
    const sanitized = (try formatGuestHostname(
        &sanitized_buffer,
        .{ .pid = 99, .name = "src/name~fork" },
    )).?;
    try std.testing.expectEqualStrings("src-name-fork-pid-99", sanitized);

    var empty_buffer: [128]u8 = undefined;
    const empty = (try formatGuestHostname(&empty_buffer, .{ .pid = 99, .name = "///" })).?;
    try std.testing.expectEqualStrings("vm-pid-99", empty);

    var missing_buffer: [128]u8 = undefined;
    try std.testing.expect((try formatGuestHostname(&missing_buffer, .{})) == null);
}

test "planPdeathsig defaults on and lets detach or explicit false disable it" {
    try std.testing.expect(planPdeathsig(.{}));
    try std.testing.expect(planPdeathsig(.{ .pdeathsig = true }));
    try std.testing.expect(!planPdeathsig(.{ .pdeathsig = false }));
    try std.testing.expect(!planPdeathsig(.{ .detached = true, .pdeathsig = true }));
}

test "planVmstateTempMode selects skip reuse or allocate" {
    const skip_engine = planVmstateTempMode(.{ .engine = "none" });
    try std.testing.expectEqualStrings("skip", skip_engine.action);
    try std.testing.expect(skip_engine.temp_dir == null);

    const skip_snapshot = planVmstateTempMode(.{ .engine = "vmstate", .snapshot_disabled = true });
    try std.testing.expectEqualStrings("skip", skip_snapshot.action);
    try std.testing.expect(skip_snapshot.temp_dir == null);

    const reuse = planVmstateTempMode(.{
        .engine = "vmstate",
        .existing_temp_dir = "/tmp/machinen-vsock-abc",
    });
    try std.testing.expectEqualStrings("reuse", reuse.action);
    try std.testing.expectEqualStrings("/tmp/machinen-vsock-abc", reuse.temp_dir.?);

    const allocate = planVmstateTempMode(.{ .engine = "vmstate" });
    try std.testing.expectEqualStrings("allocate", allocate.action);
    try std.testing.expect(allocate.temp_dir == null);
}

test "planVmstateRuntime projects chain defaults and restore parent" {
    const fresh = try planVmstateRuntime(std.testing.allocator, .{
        .state_path = "/tmp/state.vmstate",
        .chain_id = "chain-1",
    });
    try std.testing.expectEqualStrings("/tmp/state.vmstate", fresh.state_path.?);
    try std.testing.expectEqualStrings("chain-1", fresh.chain_id.?);
    try std.testing.expect(fresh.checkpoint_parent == null);
    try std.testing.expectEqual(@as(u64, 0), fresh.checkpoint_sequence.?);

    const restore = try planVmstateRuntime(std.testing.allocator, .{
        .state_path = "/tmp/state.vmstate",
        .chain_id = "chain-2",
        .restore_path = "/tmp/restore.vmstate",
        .forked_from = "/snap/parent",
    });
    try std.testing.expectEqualStrings("/snap/parent", restore.checkpoint_parent.?);
    try std.testing.expectEqual(@as(u64, 0), restore.checkpoint_sequence.?);

    const empty = try planVmstateRuntime(std.testing.allocator, .{});
    try std.testing.expect(empty.state_path == null);
    try std.testing.expect(empty.chain_id == null);
    try std.testing.expect(empty.checkpoint_sequence == null);

    const temp = try planVmstateRuntime(std.testing.allocator, .{
        .state_temp_dir = "/tmp/machinen-vsock-abc",
        .chain_id = "chain-3",
    });
    defer std.testing.allocator.free(temp.state_path.?);
    try std.testing.expectEqualStrings("/tmp/machinen-vsock-abc/state.vmstate", temp.state_path.?);

    try std.testing.expectError(error.MissingVmstateRuntimeChainId, planVmstateRuntime(
        std.testing.allocator,
        .{ .state_path = "/tmp/state.vmstate" },
    ));
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
    try std.testing.expectError(
        error.UnsupportedCpuMaxVcpus,
        planCpuResources(.{ .max_vcpus = 2 }),
    );
    try std.testing.expectError(error.InvalidCpuQuotaCpus, planCpuResources(.{ .quota_cpus = 0 }));
    try std.testing.expectError(
        error.CpuQuotaExceedsMaxVcpus,
        planCpuResources(.{ .quota_cpus = 1.5 }),
    );
    try std.testing.expectError(error.InvalidCpuWeight, planCpuResources(.{ .weight = 0 }));
    try std.testing.expectError(error.InvalidCpuWeight, planCpuResources(.{ .weight = 10_001 }));
}

test "planRootDiskMode applies option precedence" {
    try std.testing.expectEqual(RootDiskMode.unset, planRootDiskMode(.{}));
    try std.testing.expectEqual(RootDiskMode.true_value, planRootDiskMode(.{ .true_value = true }));
    try std.testing.expectEqual(RootDiskMode.path, planRootDiskMode(.{ .path = "/tmp/root.img" }));
    try std.testing.expectEqual(
        RootDiskMode.path,
        planRootDiskMode(.{ .restore_path = "/restore/root.img" }),
    );
    try std.testing.expectEqual(RootDiskMode.false_value, planRootDiskMode(.{
        .false_value = true,
        .restore_path = "/restore/root.img",
    }));
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

test "planRegistryProcessIdentityReads plans darwin process identity reads" {
    const darwin = planRegistryProcessIdentityReads(.{
        .host_platform = "darwin",
        .child_pid = 1234,
        .vmm_pdeathsig = true,
        .gv_pid = 4321,
    });
    try std.testing.expectEqual(@as(?i64, 1234), darwin.vmm_pid);
    try std.testing.expectEqual(@as(?i64, 4321), darwin.gv_pid);

    const linux = planRegistryProcessIdentityReads(.{
        .host_platform = "linux",
        .child_pid = 1234,
        .vmm_pdeathsig = true,
        .gv_pid = 4321,
    });
    try std.testing.expect(linux.vmm_pid == null);
    try std.testing.expect(linux.gv_pid == null);

    const darwin_no_watch = planRegistryProcessIdentityReads(.{
        .host_platform = "darwin",
        .child_pid = 1234,
        .vmm_pdeathsig = false,
        .gv_pid = -1,
    });
    try std.testing.expect(darwin_no_watch.vmm_pid == null);
    try std.testing.expect(darwin_no_watch.gv_pid == null);
}

test "planRegistryProcess projects platform-specific executable metadata" {
    const darwin = planRegistryProcess(.{
        .host_platform = "darwin",
        .vmm_binary = "/pkg/machinen-vm",
        .vmm_pdeathsig = true,
        .vmm_observed_exe_base = "machinen-pdeathsig",
        .gv_pid = 42,
        .gv_exe = "/pkg/gvproxy",
        .gv_observed_exe_base = "gvproxy",
    });
    try std.testing.expectEqualStrings("machinen-pdeathsig", darwin.vmm_exe.?);
    try std.testing.expectEqualStrings("gvproxy", darwin.gvproxy_exe.?);

    const linux = planRegistryProcess(.{
        .host_platform = "linux",
        .vmm_binary = "/pkg/machinen-vm",
        .vmm_pdeathsig = true,
        .vmm_observed_exe_base = "machinen-pdeathsig",
        .gv_pid = 42,
        .gv_exe = "/pkg/gvproxy",
        .gv_observed_exe_base = "gvproxy-observed",
    });
    try std.testing.expectEqualStrings("/pkg/machinen-vm", linux.vmm_exe.?);
    try std.testing.expectEqualStrings("/pkg/gvproxy", linux.gvproxy_exe.?);

    const fallback = planRegistryProcess(.{
        .host_platform = "darwin",
        .vmm_binary = "/pkg/machinen-vm",
        .vmm_pdeathsig = true,
        .gv_pid = -1,
        .gv_exe = "/pkg/gvproxy",
        .gv_observed_exe_base = "ignored",
    });
    try std.testing.expectEqualStrings("/pkg/machinen-vm", fallback.vmm_exe.?);
    try std.testing.expectEqualStrings("/pkg/gvproxy", fallback.gvproxy_exe.?);
}

test "planSnapshotBacking requires the active engine backing path" {
    try std.testing.expect(!planSnapshotBacking(.{
        .engine = "criu",
        .action = "snapshot",
    }).allowed);
    try std.testing.expect(planSnapshotBacking(.{
        .engine = "criu",
        .action = "snapshot",
        .disk_path = "/tmp/scratch.img",
    }).allowed);
    try std.testing.expect(!planSnapshotBacking(.{
        .engine = "vmstate",
        .action = "fork",
    }).allowed);
    try std.testing.expect(planSnapshotBacking(.{
        .engine = "vmstate",
        .action = "fork",
        .vmstate_path = "/tmp/state.vmstate",
    }).allowed);
    try std.testing.expect(planSnapshotBacking(.{
        .engine = "none",
        .action = "snapshot",
    }).allowed);
}

test "planSnapshotContext projects mount live mount and vmstate chain fields" {
    const allocator = std.testing.allocator;
    const live = [_]LiveMount{.{
        .host = "/host/work",
        .guest = "/mnt/work",
        .mode = "rw",
        .tag = "machinen-lm0",
    }};
    const plan = try planSnapshotContext(allocator, .{
        .mount_disk = .{
            .guest = "/mnt/data",
            .lower_path = "/cache/lower.sqfs",
            .upper_path = "/tmp/upper.img",
        },
        .live_mounts = &live,
        .vmstate = .{
            .state_path = "/tmp/state.vmstate",
            .chain_id = "chain-1",
            .checkpoint_parent = "/snap/parent",
            .checkpoint_sequence = 3,
        },
    });
    defer allocator.free(plan.live_mounts);
    try std.testing.expectEqualStrings("/mnt/data", plan.mount_disk.?.guest);
    try std.testing.expectEqualStrings("/cache/lower.sqfs", plan.mount_disk.?.lower_path);
    try std.testing.expectEqualStrings("/tmp/upper.img", plan.mount_disk.?.upper_path);
    try std.testing.expect(plan.live_mounts.len == 1);
    try std.testing.expectEqualStrings("/host/work", plan.live_mounts[0].host);
    try std.testing.expectEqualStrings("/mnt/work", plan.live_mounts[0].guest);
    try std.testing.expectEqualStrings("rw", plan.live_mounts[0].mode);
    try std.testing.expectEqualStrings("chain-1", plan.vmstate_chain.?.chain_id);
    try std.testing.expectEqualStrings("/snap/parent", plan.vmstate_chain.?.parent_dir.?);
    try std.testing.expectEqual(@as(u64, 3), plan.vmstate_chain.?.sequence);

    const empty = try planSnapshotContext(allocator, .{});
    defer allocator.free(empty.live_mounts);
    try std.testing.expect(empty.mount_disk == null);
    try std.testing.expect(empty.vmstate_chain == null);

    try std.testing.expectError(
        error.MissingSnapshotMountDiskField,
        planSnapshotContext(allocator, .{
            .mount_disk = .{ .guest = "/mnt/data" },
        }),
    );
    try std.testing.expectError(error.MissingSnapshotVmstateField, planSnapshotContext(allocator, .{
        .vmstate = .{ .state_path = "/tmp/state.vmstate" },
    }));
}

test "planRestoreImage selects explicit metadata and missing outcomes" {
    const explicit_hit = planRestoreImage(.{
        .explicit_path = "/override/rootfs.tar.gz",
        .explicit_exists = true,
        .meta_source_path = "/meta/rootfs.tar.gz",
        .meta_source_exists = true,
    });
    try std.testing.expectEqualStrings("/override/rootfs.tar.gz", explicit_hit.path.?);
    try std.testing.expect(explicit_hit.error_kind == null);

    const explicit_missing = planRestoreImage(.{
        .explicit_path = "/override/missing.tar.gz",
        .explicit_exists = false,
        .meta_source_path = "/meta/rootfs.tar.gz",
        .meta_source_exists = true,
    });
    try std.testing.expect(explicit_missing.path == null);
    try std.testing.expectEqualStrings("explicit-missing", explicit_missing.error_kind.?);

    const meta_hit = planRestoreImage(.{
        .meta_source_path = "/meta/rootfs.tar.gz",
        .meta_source_exists = true,
    });
    try std.testing.expectEqualStrings("/meta/rootfs.tar.gz", meta_hit.path.?);
    try std.testing.expect(meta_hit.error_kind == null);

    const meta_missing = planRestoreImage(.{
        .meta_source_path = "/meta/missing.tar.gz",
        .meta_source_exists = false,
    });
    try std.testing.expect(meta_missing.path == null);
    try std.testing.expectEqualStrings("meta-missing", meta_missing.error_kind.?);

    const missing = planRestoreImage(.{});
    try std.testing.expect(missing.path == null);
    try std.testing.expectEqualStrings("missing", missing.error_kind.?);
}

test "planRegistryLifecycle gates name claim and registry writes" {
    const ready = planRegistryLifecycle(.{
        .name = "worker",
        .child_pid = 42,
        .vsock_uds_path = "/tmp/exec.sock",
    });
    try std.testing.expectEqualStrings("worker", ready.claim_name.?);
    try std.testing.expect(ready.should_write);

    const no_name = planRegistryLifecycle(.{ .child_pid = 42, .vsock_uds_path = "/tmp/exec.sock" });
    try std.testing.expect(no_name.claim_name == null);
    try std.testing.expect(no_name.should_write);

    const dead_pid = planRegistryLifecycle(.{ .name = "worker", .child_pid = 0 });
    try std.testing.expect(dead_pid.claim_name == null);
    try std.testing.expect(!dead_pid.should_write);

    const no_vsock = planRegistryLifecycle(.{ .name = "worker", .child_pid = 42 });
    try std.testing.expectEqualStrings("worker", no_vsock.claim_name.?);
    try std.testing.expect(!no_vsock.should_write);
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
        .boot_log_root = "/tmp/machinen-logs",
        .child_pid = 1234,
        .detached = true,
        .disk_path = "/disk.img",
        .forked_from = "/snap/source",
        .memory_ceiling_mib = 2048,
        .stats_path = "/stats.json",
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
    try std.testing.expectEqualStrings(
        "/tmp/machinen-logs/1234.boot.log",
        plan.boot_log_path.value().?,
    );
    try std.testing.expectEqualStrings("/disk.img", plan.disk_path.?);
    try std.testing.expectEqualStrings("/snap/source", plan.forked_from.?);
    try std.testing.expectEqual(@as(u64, 2048), plan.memory_ceiling_mib.?);
    try std.testing.expectEqualStrings("/stats.json", plan.stats_path.?);
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
    try std.testing.expect(!plan.nested);
    try std.testing.expectEqual(@as(@TypeOf(plan.live_mounts.len), 2), plan.live_mounts.len);
    try std.testing.expectEqualStrings("/mnt/work", plan.live_mounts[0].guest);
    try std.testing.expectEqualStrings("/host/work", plan.live_mounts[0].host);
    try std.testing.expectEqualStrings("rw", plan.live_mounts[0].mode);
}

test "planMountDiskFdEnv formats inherited fd env entries" {
    const allocator = std.testing.allocator;
    const env = try planMountDiskFdEnv(allocator, .{ .lower_fd = 3, .upper_fd = 4 });
    defer allocator.free(env[0].value);
    defer allocator.free(env[1].value);
    defer allocator.free(env);
    try std.testing.expect(env.len == 2);
    try std.testing.expectEqualStrings("MACHINEN_MOUNTDISK_LOWER_FD", env[0].key);
    try std.testing.expectEqualStrings("3", env[0].value);
    try std.testing.expectEqualStrings("MACHINEN_MOUNTDISK_UPPER_FD", env[1].key);
    try std.testing.expectEqualStrings("4", env[1].value);

    const none = try planMountDiskFdEnv(allocator, .{});
    try std.testing.expect(none.len == 0);
    try std.testing.expectError(
        error.MissingMountDiskFdField,
        planMountDiskFdEnv(allocator, .{ .lower_fd = 3 }),
    );
}

test "planMountDiskUpperSize defaults and validates alignment" {
    try std.testing.expectEqual(@as(u64, 4 * 1024 * 1024 * 1024), planMountDiskUpperSize(.{}).ok);
    try std.testing.expectEqual(
        @as(u64, 8192),
        planMountDiskUpperSize(.{ .size_bytes = 8192 }).ok,
    );
    try std.testing.expectEqual(@as(u64, 0), planMountDiskUpperSize(.{ .size_bytes = 0 }).invalid);
    try std.testing.expectEqual(
        @as(u64, 4097),
        planMountDiskUpperSize(.{ .size_bytes = 4097 }).invalid,
    );
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

test "planProvisionResult projects provision result fields" {
    const plan = planProvisionResult(.{
        .image_path = "/tmp/warm.tar.gz",
        .size_bytes = 1234,
        .elapsed_ms = 56,
    });
    try std.testing.expectEqualStrings("/tmp/warm.tar.gz", plan.image_path.?);
    try std.testing.expectEqual(@as(?u64, 1234), plan.size_bytes);
    try std.testing.expectEqual(@as(?u64, 56), plan.elapsed_ms);

    const empty = planProvisionResult(.{});
    try std.testing.expect(empty.image_path == null);
    try std.testing.expect(empty.size_bytes == null);
    try std.testing.expect(empty.elapsed_ms == null);
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
    defer allocator.free(repack.image_config_path.?);
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

test "planProvisionBoot builds provision boot inputs and vmm env" {
    const allocator = std.testing.allocator;
    const caller_env = [_]EnvPair{
        .{ .key = "MACHINEN_BOOT_TEST", .value = "1" },
        .{ .key = "MACHINEN_VSOCK", .value = "caller-owned" },
    };
    const plan = try planProvisionBoot(allocator, .{
        .base_path = "/base.tar.gz",
        .kernel_path = "/Image",
        .dtb_path = "/virt.dtb",
        .uds_path = "/tmp/exec.sock",
        .scratch_disk_path = "/tmp/scratch.img",
        .root_disk_path = "/tmp/rootfs.img",
        .vmm_env = &caller_env,
    });
    defer allocator.free(plan.cmd);
    defer allocator.free(plan.env);
    defer allocator.free(plan.vmm_env);
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

test "planProvisionGuestCpu uses override, host arch, and arm64 fallback" {
    try std.testing.expectEqual(.arm64, planProvisionGuestCpu(.{}));
    try std.testing.expectEqual(.amd64, planProvisionGuestCpu(.{
        .arch_override = "amd64",
        .host_arch = "arm64",
    }));
    try std.testing.expectEqual(.arm64, planProvisionGuestCpu(.{
        .arch_override = "arm64",
        .host_arch = "x64",
    }));
    try std.testing.expectEqual(.amd64, planProvisionGuestCpu(.{
        .arch_override = "bogus",
        .host_arch = "x64",
    }));
}

test "planScratchMode applies option precedence" {
    try std.testing.expectEqual(ScratchDiskMode.auto, planScratchMode(.{}));
    try std.testing.expectEqual(
        ScratchDiskMode.path,
        planScratchMode(.{ .path = "/tmp/scratch.img" }),
    );
    try std.testing.expectEqual(ScratchDiskMode.false_value, planScratchMode(.{
        .false_value = true,
        .path = "/tmp/scratch.img",
    }));
}

test "planProvisionAssetLookup preserves explicit assets-dir cache order" {
    const explicit_hit = planProvisionAssetLookup(.{
        .explicit_path = "/explicit/rootfs.tar.gz",
        .explicit_exists = true,
        .assets_dir_path = "/assets/rootfs.tar.gz",
        .assets_dir_exists = true,
    });
    try std.testing.expectEqualStrings("/explicit/rootfs.tar.gz", explicit_hit.path.?);
    try std.testing.expect(explicit_hit.error_kind == null);

    const explicit_missing = planProvisionAssetLookup(.{
        .explicit_path = "/explicit/rootfs.tar.gz",
        .explicit_exists = false,
        .assets_dir_path = "/assets/rootfs.tar.gz",
        .assets_dir_exists = true,
    });
    try std.testing.expect(explicit_missing.path == null);
    try std.testing.expectEqualStrings("missing", explicit_missing.error_kind.?);

    const assets_missing = planProvisionAssetLookup(.{
        .assets_dir_path = "/assets/rootfs.tar.gz",
        .assets_dir_exists = false,
        .cache_path = "/cache/rootfs.tar.gz",
        .cache_exists = true,
    });
    try std.testing.expect(assets_missing.path == null);
    try std.testing.expectEqualStrings("assets-dir-invalid", assets_missing.error_kind.?);

    const cache_hit = planProvisionAssetLookup(.{
        .cache_path = "/cache/rootfs.tar.gz",
        .cache_exists = true,
    });
    try std.testing.expectEqualStrings("/cache/rootfs.tar.gz", cache_hit.path.?);
}

test "planProvisionCliCacheBaseDir derives release cache by guest cpu" {
    const amd64 = (try planProvisionCliCacheBaseDir(std.testing.allocator, .{
        .home_dir = "/home/friend",
        .version = "0.6.1",
        .arch_override = "amd64",
    })).base_dir.?;
    defer std.testing.allocator.free(amd64);
    try std.testing.expectEqualStrings(
        "/home/friend/.machinen/runtime-v0.6.1/bases/debian-amd64",
        amd64,
    );

    const arm64 = (try planProvisionCliCacheBaseDir(std.testing.allocator, .{
        .home_dir = "/home/friend",
        .version = "0.6.1",
        .arch_override = "arm64",
    })).base_dir.?;
    defer std.testing.allocator.free(arm64);
    try std.testing.expectEqualStrings(
        "/home/friend/.machinen/runtime-v0.6.1/bases/debian-arm64",
        arm64,
    );

    try std.testing.expect((try planProvisionCliCacheBaseDir(std.testing.allocator, .{
        .version = "0.6.1",
    })).base_dir == null);
}

test "planProvisionDtb plans omitted dtb requirement by guest cpu" {
    const arm64 = planProvisionDtb(.{ .arch_override = "arm64", .host_arch = "x64" });
    try std.testing.expect(arm64.required);
    try std.testing.expectEqualStrings("virt-arm64.dtb", arm64.asset.?);
    try std.testing.expectEqualStrings("virt.dtb", arm64.cli_cache_name.?);

    const amd64 = planProvisionDtb(.{ .arch_override = "amd64", .host_arch = "arm64" });
    try std.testing.expect(!amd64.required);
    try std.testing.expect(amd64.asset == null);
    try std.testing.expect(amd64.cli_cache_name == null);

    const explicit = planProvisionDtb(.{ .explicit = true, .arch_override = "arm64" });
    try std.testing.expect(!explicit.required);
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

test "planBundleWorkspace derives staging paths from the runtime-owned temp dir" {
    const planned = try planBundleWorkspace(
        std.testing.allocator,
        .{ .temp_dir = "/tmp/machinen-bundle-abc" },
    );
    defer std.testing.allocator.free(planned.cpio_path.?);
    defer std.testing.allocator.free(planned.synth_bundle_dir.?);
    try std.testing.expectEqualStrings(
        "/tmp/machinen-bundle-abc/initramfs.cpio",
        planned.cpio_path.?,
    );
    try std.testing.expectEqualStrings(
        "/tmp/machinen-bundle-abc/bundle",
        planned.synth_bundle_dir.?,
    );
    const none = try planBundleWorkspace(std.testing.allocator, .{});
    try std.testing.expect(none.cpio_path == null);
    try std.testing.expect(none.synth_bundle_dir == null);
}

test "planBundleConfigPaths derives bundle config staging paths" {
    const planned = try planBundleConfigPaths(
        std.testing.allocator,
        .{ .synth_bundle_dir = "/tmp/machinen-bundle-abc/bundle" },
    );
    defer std.testing.allocator.free(planned.rootfs_dir.?);
    defer std.testing.allocator.free(planned.config_path.?);
    try std.testing.expectEqualStrings(
        "/tmp/machinen-bundle-abc/bundle/rootfs",
        planned.rootfs_dir.?,
    );
    try std.testing.expectEqualStrings(
        "/tmp/machinen-bundle-abc/bundle/machinen-config.json",
        planned.config_path.?,
    );
    const none = try planBundleConfigPaths(std.testing.allocator, .{});
    try std.testing.expect(none.rootfs_dir == null);
    try std.testing.expect(none.config_path == null);
}

test "planBundleMountDiskMode selects mount disk materialization action" {
    const fat = planBundleMountDiskMode(.{});
    try std.testing.expectEqualStrings("none", fat.action);

    const tiny_none = planBundleMountDiskMode(.{ .use_tiny = true });
    try std.testing.expectEqualStrings("none", tiny_none.action);

    const fresh = planBundleMountDiskMode(.{ .use_tiny = true, .mount_guest = "/mnt/data" });
    try std.testing.expectEqualStrings("fresh", fresh.action);

    const restore = planBundleMountDiskMode(.{
        .use_tiny = true,
        .mount_guest = "/mnt/data",
        .restore_mount_guest = "/mnt/restore",
    });
    try std.testing.expectEqualStrings("restore", restore.action);
}

test "planBundlePack selects fat or tiny initramfs inputs" {
    const fat = planBundlePack(.{});
    try std.testing.expectEqualStrings("fat", fat.kind);
    try std.testing.expect(fat.tiny_mount_guest == null);

    const tiny_fresh = planBundlePack(.{
        .use_tiny = true,
        .mount_guest = "/mnt/data",
        .restore_mount_guest = "/mnt/restore",
    });
    try std.testing.expectEqualStrings("tiny", tiny_fresh.kind);
    try std.testing.expectEqualStrings("/mnt/data", tiny_fresh.tiny_mount_guest.?);

    const tiny_restore = planBundlePack(.{
        .use_tiny = true,
        .restore_mount_guest = "/mnt/restore",
    });
    try std.testing.expectEqualStrings("tiny", tiny_restore.kind);
    try std.testing.expectEqualStrings("/mnt/restore", tiny_restore.tiny_mount_guest.?);
}

test "planVmmEnv overlays caller env on host env" {
    const host = [_]EnvPair{
        .{ .key = "PATH", .value = "/usr/bin" },
        .{ .key = "MACHINEN_MEMORY", .value = "512" },
    };
    const caller = [_]EnvPair{
        .{ .key = "MACHINEN_MEMORY", .value = "1024" },
        .{ .key = "MACHINEN_TRACE", .value = "1" },
    };
    const planned = try planVmmEnv(std.testing.allocator, .{ .base = &host, .overrides = &caller });
    defer std.testing.allocator.free(planned);
    try std.testing.expectEqualStrings("PATH", planned[0].key);
    try std.testing.expectEqualStrings("/usr/bin", planned[0].value);
    try std.testing.expectEqualStrings("MACHINEN_MEMORY", planned[1].key);
    try std.testing.expectEqualStrings("1024", planned[1].value);
    try std.testing.expectEqualStrings("MACHINEN_TRACE", planned[2].key);
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

test "planRootDiskTempPath formats restore and cached rootdisk paths" {
    const restore = try planRootDiskTempPath(std.testing.allocator, .{
        .kind = .restore,
        .tmp_dir = "/tmp",
        .pid = 1234,
        .nonce = "abcdef",
    });
    defer std.testing.allocator.free(restore.path.?);
    try std.testing.expectEqualStrings(
        "/tmp/machinen-rootdisk-restore-1234-abcdef.img",
        restore.path.?,
    );

    const cached = try planRootDiskTempPath(std.testing.allocator, .{
        .kind = .cached,
        .tmp_dir = "/tmp",
        .pid = 1234,
        .nonce = "abcdef",
    });
    defer std.testing.allocator.free(cached.path.?);
    try std.testing.expectEqualStrings("/tmp/machinen-rootdisk-1234-abcdef.img", cached.path.?);

    const missing = try planRootDiskTempPath(std.testing.allocator, .{});
    try std.testing.expect(missing.path == null);
}

test "planMountDiskTempPath formats restored upper paths" {
    const restore_upper = try planMountDiskTempPath(std.testing.allocator, .{
        .kind = .restore_upper,
        .tmp_dir = "/tmp",
        .pid = 1234,
        .nonce = "abcdef",
    });
    defer std.testing.allocator.free(restore_upper.path.?);
    try std.testing.expectEqualStrings(
        "/tmp/machinen-mountdisk-upper-1234-abcdef.img",
        restore_upper.path.?,
    );

    const missing = try planMountDiskTempPath(std.testing.allocator, .{});
    try std.testing.expect(missing.path == null);
}

test "planRootDiskMaterializeMode selects restore caller and cached precedence" {
    try std.testing.expectEqualStrings("cached", planRootDiskMaterializeMode(.{}).action);
    try std.testing.expectEqualStrings(
        "caller",
        planRootDiskMaterializeMode(.{ .caller_path = "/caller.img" }).action,
    );
    try std.testing.expectEqualStrings(
        "restore",
        planRootDiskMaterializeMode(.{ .restore_path = "/restore.img" }).action,
    );
    try std.testing.expectEqualStrings(
        "restore",
        planRootDiskMaterializeMode(.{
            .restore_path = "/restore.img",
            .caller_path = "/caller.img",
        }).action,
    );
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

test "planScratchTempPath formats restore and auto scratch paths" {
    const restore = try planScratchTempPath(std.testing.allocator, .{
        .kind = .restore,
        .tmp_dir = "/tmp",
        .pid = 1234,
        .nonce = "abcdef",
    });
    defer std.testing.allocator.free(restore.path.?);
    try std.testing.expectEqualStrings(
        "/tmp/machinen-snap-restore-1234-abcdef.img",
        restore.path.?,
    );

    const auto = try planScratchTempPath(std.testing.allocator, .{
        .kind = .auto,
        .tmp_dir = "/tmp",
        .pid = 1234,
        .nonce = "abcdef",
    });
    defer std.testing.allocator.free(auto.path.?);
    try std.testing.expectEqualStrings("/tmp/machinen-snap-1234-abcdef.img", auto.path.?);

    const missing = try planScratchTempPath(std.testing.allocator, .{});
    try std.testing.expect(missing.path == null);
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

test "validateLiveMountRemovedOptions preserves deprecated option precedence" {
    try std.testing.expectEqual(.ok, validateLiveMountRemovedOptions(.{ .index = 1 }));
    try std.testing.expectEqual(
        @as(u64, 2),
        validateLiveMountRemovedOptions(.{ .index = 2, .has_cache = true }).cache,
    );
    try std.testing.expectEqual(
        @as(u64, 3),
        validateLiveMountRemovedOptions(.{ .index = 3, .has_sync = true }).sync,
    );
    try std.testing.expectEqual(
        @as(u64, 4),
        validateLiveMountRemovedOptions(.{
            .index = 4,
            .has_cache = true,
            .has_sync = true,
        }).cache,
    );
}

test "planBatchLiveMountSync requires vsock for rw mounts when validation is requested" {
    const mounts = [_]LiveMount{
        .{ .host = "/host/a", .guest = "/mnt/a", .mode = "ro", .tag = "machinen-lm0" },
        .{ .host = "/host/b", .guest = "/mnt/b", .mode = "rw", .tag = "machinen-lm1" },
    };
    try std.testing.expectError(error.MissingBatchLiveMountVsock, planBatchLiveMountSync(.{
        .live_mounts = &mounts,
        .validation_required = true,
    }));
    const planned = try planBatchLiveMountSync(.{
        .live_mounts = &mounts,
        .vsock_uds_path = "/tmp/exec.sock",
        .validation_required = true,
    });
    try std.testing.expect(planned.sync_required);
    const none = try planBatchLiveMountSync(.{});
    try std.testing.expect(!none.sync_required);
}

test "planRestoreLiveMounts merges recorded mounts with overrides" {
    const recorded = [_]RestoreRecordedLiveMount{
        .{ .host = "/host/work", .guest = "/mnt/work", .mode = "rw" },
        .{ .host = "/host/cache", .guest = "/mnt/cache", .mode = "ro" },
    };
    const overrides = [_]RestoreLiveMountInput{
        .{ .host = "/new/cache", .guest = "/mnt/cache" },
    };
    const planned = try planRestoreLiveMounts(
        std.testing.allocator,
        .{ .recorded = &recorded, .overrides = &overrides },
    );
    defer std.testing.allocator.free(planned.mounts);
    try std.testing.expect(planned.unknown_guest == null);
    try std.testing.expect(planned.mounts.len == 2);
    try std.testing.expectEqualStrings("/host/work", planned.mounts[0].host);
    try std.testing.expectEqualStrings("rw", planned.mounts[0].mode.?);
    try std.testing.expectEqualStrings("/new/cache", planned.mounts[1].host);
    try std.testing.expectEqualStrings("ro", planned.mounts[1].mode.?);

    const legacy = try planRestoreLiveMounts(std.testing.allocator, .{ .overrides = &overrides });
    defer std.testing.allocator.free(legacy.mounts);
    try std.testing.expect(legacy.mounts.len == 1);
    try std.testing.expectEqualStrings("/new/cache", legacy.mounts[0].host);
    try std.testing.expect(legacy.mounts[0].mode == null);

    const bad = [_]RestoreLiveMountInput{.{
        .host = "/new/extra",
        .guest = "/mnt/extra",
        .mode = "rw",
    }};
    const rejected = try planRestoreLiveMounts(
        std.testing.allocator,
        .{ .recorded = &recorded, .overrides = &bad },
    );
    try std.testing.expectEqualStrings("/mnt/extra", rejected.unknown_guest.?);
}

test "planStatsFileMode selects existing or allocate" {
    const existing = planStatsFileMode(.{ .existing_path = "/tmp/caller-stats.bin" });
    try std.testing.expectEqualStrings("existing", existing.action);
    try std.testing.expectEqualStrings("/tmp/caller-stats.bin", existing.existing_path.?);

    const allocate = planStatsFileMode(.{});
    try std.testing.expectEqualStrings("allocate", allocate.action);
    try std.testing.expect(allocate.existing_path == null);
}

test "planStatsFileTempMode selects existing reuse or allocate" {
    const existing = planStatsFileTempMode(.{
        .existing_path = "/tmp/caller-stats.bin",
        .vsock_temp_dir = "/tmp/vsock",
    });
    try std.testing.expectEqualStrings("existing", existing.action);
    try std.testing.expectEqualStrings("/tmp/caller-stats.bin", existing.existing_path.?);
    try std.testing.expect(existing.temp_dir == null);

    const reuse = planStatsFileTempMode(.{ .vsock_temp_dir = "/tmp/vsock" });
    try std.testing.expectEqualStrings("reuse", reuse.action);
    try std.testing.expect(reuse.existing_path == null);
    try std.testing.expectEqualStrings("/tmp/vsock", reuse.temp_dir.?);

    const allocate = planStatsFileTempMode(.{});
    try std.testing.expectEqualStrings("allocate", allocate.action);
    try std.testing.expect(allocate.existing_path == null);
    try std.testing.expect(allocate.temp_dir == null);
}

test "planStatsFile preserves caller path or returns runtime-owned env value" {
    const existing = try planStatsFile(std.testing.allocator, .{
        .existing_path = "/tmp/caller-stats.bin",
    });
    try std.testing.expectEqualStrings("/tmp/caller-stats.bin", existing.stats_file_path.?);
    try std.testing.expectEqual(@as(?[]const u8, null), existing.vmm_stats_file);

    const planned = try planStatsFile(std.testing.allocator, .{
        .planned_path = "/tmp/runtime-stats.bin",
    });
    try std.testing.expectEqualStrings("/tmp/runtime-stats.bin", planned.stats_file_path.?);
    try std.testing.expectEqualStrings("/tmp/runtime-stats.bin", planned.vmm_stats_file.?);

    const planned_dir = try planStatsFile(std.testing.allocator, .{
        .planned_temp_dir = "/tmp/machinen-stats-abc",
    });
    defer std.testing.allocator.free(planned_dir.stats_file_path.?);
    try std.testing.expectEqualStrings(
        "/tmp/machinen-stats-abc/stats.bin",
        planned_dir.stats_file_path.?,
    );
    try std.testing.expectEqualStrings(planned_dir.stats_file_path.?, planned_dir.vmm_stats_file.?);
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

test "planInitrdEnv forwards resolved initrd path" {
    const plan = planInitrdEnv(.{ .initrd_path = "/tmp/initramfs.cpio" });
    try std.testing.expectEqualStrings("/tmp/initramfs.cpio", plan.vmm_initrd.?);
    const empty = planInitrdEnv(.{});
    try std.testing.expectEqual(@as(?[]const u8, null), empty.vmm_initrd);
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

pub fn validatePortForwardNetSocket(input: PortForwardNetSocketInput) PlanError!void {
    assert(@sizeOf(PortForwardNetSocketInput) > 0);

    if (input.port_forwards.len > 0 and input.net_socket != null) {
        return error.PortForwardNetSocketPreset;
    }
}

pub fn planGvproxy(input: GvproxyPlanInput) PlanError!GvproxyPlan {
    assert(@sizeOf(GvproxyPlanInput) > 0);

    if (input.existing_net_socket != null) {
        return .{ .action = "skip-existing", .gvproxy_path = null };
    }
    if (input.gvproxy_path) |path| return .{ .action = "spawn", .gvproxy_path = path };
    if (input.planning_required and input.port_forwards.len > 0) return error.MissingGvproxy;
    return .{ .action = "missing-ok", .gvproxy_path = null };
}

test "planGvproxy selects skip spawn missing-ok and missing-gvproxy actions" {
    const forwards = [_]PortForwardMapping{.{ .host_port = 8080, .guest_port = 3000 }};
    const existing = try planGvproxy(.{
        .existing_net_socket = "/tmp/net.sock",
        .port_forwards = &forwards,
    });
    try std.testing.expectEqualStrings("skip-existing", existing.action);
    try std.testing.expect(existing.gvproxy_path == null);

    const spawn = try planGvproxy(.{ .gvproxy_path = "/bin/gvproxy", .port_forwards = &forwards });
    try std.testing.expectEqualStrings("spawn", spawn.action);
    try std.testing.expectEqualStrings("/bin/gvproxy", spawn.gvproxy_path.?);

    const missing_ok = try planGvproxy(.{ .planning_required = true });
    try std.testing.expectEqualStrings("missing-ok", missing_ok.action);
    try std.testing.expectError(error.MissingGvproxy, planGvproxy(.{
        .planning_required = true,
        .port_forwards = &forwards,
    }));
}

test "validatePortForwardNetSocket rejects caller-owned net socket with forwards" {
    const forwards = [_]PortForwardMapping{.{ .host_port = 8080, .guest_port = 3000 }};
    try std.testing.expectError(error.PortForwardNetSocketPreset, validatePortForwardNetSocket(.{
        .port_forwards = &forwards,
        .net_socket = "/tmp/net.sock",
    }));
    try validatePortForwardNetSocket(.{ .port_forwards = &forwards });
    try validatePortForwardNetSocket(.{ .net_socket = "/tmp/net.sock" });
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

test "planVsockMode selects existing or allocate" {
    const existing = planVsockMode(.{ .existing_spec = "in:1978:/tmp/caller.sock" });
    try std.testing.expectEqualStrings("existing", existing.action);
    try std.testing.expectEqualStrings("in:1978:/tmp/caller.sock", existing.existing_spec.?);

    const allocate = planVsockMode(.{});
    try std.testing.expectEqualStrings("allocate", allocate.action);
    try std.testing.expect(allocate.existing_spec == null);
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

    const auto_dir = try planVsock(
        std.testing.allocator,
        .{ .auto_temp_dir = "/tmp/machinen-vsock-abc" },
    );
    defer std.testing.allocator.free(auto_dir.uds_path.?);
    defer std.testing.allocator.free(auto_dir.vmm_vsock.?);
    try std.testing.expectEqualStrings("/tmp/machinen-vsock-abc/exec.sock", auto_dir.uds_path.?);
    try std.testing.expectEqualStrings(
        "in:1978:/tmp/machinen-vsock-abc/exec.sock",
        auto_dir.vmm_vsock.?,
    );
}

test "formatGuestHostnameSet gates hostname side effect on vsock and skip flag" {
    var planned_buffer: [256]u8 = undefined;
    const planned = (try formatGuestHostnameSet(&planned_buffer, .{
        .pid = 1234,
        .name = "worker",
        .vsock_uds_path = "/tmp/exec.sock",
    })).?;
    try std.testing.expectEqualStrings("worker-pid-1234", planned);

    var missing_vsock_buffer: [256]u8 = undefined;
    try std.testing.expect((try formatGuestHostnameSet(&missing_vsock_buffer, .{
        .pid = 1234,
        .name = "worker",
    })) == null);
    var skip_buffer: [256]u8 = undefined;
    try std.testing.expect((try formatGuestHostnameSet(&skip_buffer, .{
        .pid = 1234,
        .name = "worker",
        .vsock_uds_path = "/tmp/exec.sock",
        .skip = true,
    })) == null);
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

    const command = try planCore(.{
        .vmm_memory_preset = true,
        .has_image = true,
        .has_cmd = true,
    });
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
