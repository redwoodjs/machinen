const std = @import("std");
const runtime_helper = @import("runtime_helper");
const boot_plan = @import("../boot_plan.zig");
const protocol = @import("../protocol.zig");

const assert = std.debug.assert;

pub const name = "boot-plan";

const ParsedRequest = struct {
    memory_mib_text: ?[]const u8 = null,
    resources_memory: ?ParsedResourcesMemory = null,
    resources_cpu: ?ParsedResourcesCpu = null,
    auto_memory_mib_text: ?[]const u8 = null,
    host_total_bytes_text: ?[]const u8 = null,
    vmm_memory_preset: bool = false,
    has_image: bool = false,
    has_cmd: bool = false,
    has_snapshot: bool = false,
    root_disk: boot_plan.RootDiskMode = .unset,
    root_disk_option_false: bool = false,
    root_disk_option_true: bool = false,
    root_disk_option_path: ?[]const u8 = null,
    root_disk_restore_path: ?[]const u8 = null,
    guest_cwd: ?[]const u8 = null,
    mount_guest: ?[]const u8 = null,
    guest_env: std.json.ObjectMap = .{},
    name: ?[]const u8 = null,
    vsock_uds_path: ?[]const u8 = null,
    existing_vsock_spec: ?[]const u8 = null,
    auto_vsock_uds_path: ?[]const u8 = null,
    auto_vsock_temp_dir: ?[]const u8 = null,
    port_forward: []const boot_plan.PortForwardMapping = &.{},
    port_forward_net_socket: ?[]const u8 = null,
    gvproxy_planning_required: bool = false,
    gvproxy_net_socket: ?[]const u8 = null,
    gvproxy_path: ?[]const u8 = null,
    vmm_binary: ?[]const u8 = null,
    vmm_args: []const []const u8 = &.{},
    guest_hostname_pid_text: ?[]const u8 = null,
    guest_hostname_name: ?[]const u8 = null,
    guest_hostname_set_pid_text: ?[]const u8 = null,
    guest_hostname_set_name: ?[]const u8 = null,
    guest_hostname_set_vsock_uds_path: ?[]const u8 = null,
    guest_hostname_set_skip: bool = false,
    pdeathsig_path: ?[]const u8 = null,
    pdeathsig_requested: ?bool = null,
    detached: bool = false,
    boot_timeout_ms_text: ?[]const u8 = null,
    boot_timeout_forever: bool = false,
    kernel_path: ?[]const u8 = null,
    dtb_path: ?[]const u8 = null,
    initrd_path: ?[]const u8 = null,
    vmstate_path: ?[]const u8 = null,
    restore_path: ?[]const u8 = null,
    enable_vmstate_timing: bool = false,
    existing_vmstate_timing: ?[]const u8 = null,
    boot_vmstate_state_path: ?[]const u8 = null,
    boot_vmstate_temp_dir: ?[]const u8 = null,
    boot_vmstate_chain_id: ?[]const u8 = null,
    boot_vmstate_restore_path: ?[]const u8 = null,
    boot_vmstate_forked_from: ?[]const u8 = null,
    nested_requested: bool = false,
    live_mounts: []const boot_plan.LiveMountInput = &.{},
    live_mounts_resolved: []const boot_plan.LiveMount = &.{},
    batch_live_mount_validation_required: bool = false,
    restore_live_mounts_recorded: []const boot_plan.RestoreRecordedLiveMount = &.{},
    restore_live_mounts_overrides: []const boot_plan.RestoreLiveMountInput = &.{},
    existing_stats_file: ?[]const u8 = null,
    stats_file_path: ?[]const u8 = null,
    stats_file_temp_dir: ?[]const u8 = null,
    config_cmd: []const []const u8 = &.{},
    config_env: std.json.ObjectMap = .{},
    config_guest_cwd: ?[]const u8 = null,
    config_image_cwd: ?[]const u8 = null,
    config_live_mounts: []const boot_plan.LiveMount = &.{},
    bundle_explicit_cmd: ?[]const []const u8 = null,
    bundle_image_cmd: ?[]const []const u8 = null,
    bundle_snapshot_restore: bool = false,
    bundle_vmstate_restore: bool = false,
    bundle_live_mounts: []const boot_plan.LiveMount = &.{},
    bundle_command_required: bool = false,
    bundle_image_env: std.json.ObjectMap = .{},
    bundle_guest_env: std.json.ObjectMap = .{},
    bundle_workspace_temp_dir: ?[]const u8 = null,
    bundle_config_synth_dir: ?[]const u8 = null,
    bundle_pack_use_tiny: bool = false,
    bundle_pack_mount_guest: ?[]const u8 = null,
    bundle_pack_restore_mount_guest: ?[]const u8 = null,
    provision_guest_cpu: ?boot_plan.ProvisionGuestCpu = null,
    provision_guest_arch_override: ?[]const u8 = null,
    provision_host_arch: ?[]const u8 = null,
    provision_dtb_explicit: bool = false,
    provision_base_path: ?[]const u8 = null,
    provision_kernel_path: ?[]const u8 = null,
    provision_dtb_path: ?[]const u8 = null,
    provision_uds_path: ?[]const u8 = null,
    provision_scratch_disk_path: ?[]const u8 = null,
    provision_root_disk_path: ?[]const u8 = null,
    provision_repack_disk_path: ?[]const u8 = null,
    provision_repack_out_path: ?[]const u8 = null,
    provision_repack_extract_dir: ?[]const u8 = null,
    provision_image_config_has_cmd: bool = false,
    provision_image_config_cmd: []const []const u8 = &.{},
    provision_image_config_has_env: bool = false,
    provision_image_config_env: std.json.ObjectMap = .{},
    provision_work_dir: ?[]const u8 = null,
    provision_scratch_size_bytes_text: ?[]const u8 = null,
    provision_timeout_ms_text: ?[]const u8 = null,
    scratch_option_false: bool = false,
    scratch_option_path: ?[]const u8 = null,
    scratch_mode: boot_plan.ScratchDiskMode = .unset,
    scratch_snapshot_path: ?[]const u8 = null,
    scratch_restore_clone_path: ?[]const u8 = null,
    scratch_auto_path: ?[]const u8 = null,
    root_disk_runtime_mode: boot_plan.RootDiskRuntimeMode = .none,
    root_disk_source_path: ?[]const u8 = null,
    root_disk_clone_path: ?[]const u8 = null,
    mount_disk_runtime_mode: boot_plan.MountDiskRuntimeMode = .none,
    mount_disk_lower_path: ?[]const u8 = null,
    mount_disk_upper_path: ?[]const u8 = null,
    mount_disk_source_upper_path: ?[]const u8 = null,
    mount_disk_guest: ?[]const u8 = null,
    mount_disk_upper_size_text: ?[]const u8 = null,
    mount_disk_lower_fd_text: ?[]const u8 = null,
    mount_disk_upper_fd_text: ?[]const u8 = null,
    snapshot_mount_guest: ?[]const u8 = null,
    snapshot_mount_lower_path: ?[]const u8 = null,
    snapshot_mount_upper_path: ?[]const u8 = null,
    snapshot_live_mounts: []const boot_plan.LiveMount = &.{},
    snapshot_vmstate_path: ?[]const u8 = null,
    snapshot_vmstate_chain_id: ?[]const u8 = null,
    snapshot_vmstate_checkpoint_parent: ?[]const u8 = null,
    snapshot_vmstate_checkpoint_sequence_text: ?[]const u8 = null,
    registry_source_image_path: ?[]const u8 = null,
    registry_per_boot_root_disk: ?[]const u8 = null,
    registry_caller_root_disk_path: ?[]const u8 = null,
    registry_disk_path: ?[]const u8 = null,
    registry_forked_from: ?[]const u8 = null,
    registry_memory_ceiling_mib_text: ?[]const u8 = null,
    registry_stats_path: ?[]const u8 = null,
    registry_boot_log_root: ?[]const u8 = null,
    registry_child_pid_text: ?[]const u8 = null,
    registry_detached: bool = false,
    registry_per_boot_snap_disk: ?[]const u8 = null,
    registry_per_boot_mount_upper: ?[]const u8 = null,
    registry_bundle_temp_dir: ?[]const u8 = null,
    registry_vsock_temp_dir: ?[]const u8 = null,
    registry_stats_temp_dir: ?[]const u8 = null,
    registry_gv_socket_dir: ?[]const u8 = null,
    registry_cpu_cgroup_path: ?[]const u8 = null,
    registry_cpu_policy_max_vcpus_text: ?[]const u8 = null,
    registry_cpu_policy_quota_cpus_text: ?[]const u8 = null,
    registry_cpu_policy_weight_text: ?[]const u8 = null,
    registry_cpu_control_status: ?[]const u8 = null,
    registry_cpu_control_reason: ?[]const u8 = null,
    registry_vmstate_path: ?[]const u8 = null,
    registry_vmstate_chain_id: ?[]const u8 = null,
    registry_vmstate_checkpoint_parent: ?[]const u8 = null,
    registry_vmstate_checkpoint_sequence_text: ?[]const u8 = null,
    registry_nested: bool = false,
    registry_host_platform: ?[]const u8 = null,
    registry_vmm_binary: ?[]const u8 = null,
    registry_vmm_pdeathsig: bool = false,
    registry_vmm_observed_exe_base: ?[]const u8 = null,
    registry_gv_pid_text: ?[]const u8 = null,
    registry_gv_exe: ?[]const u8 = null,
    registry_gv_observed_exe_base: ?[]const u8 = null,
    registry_mount_guest: ?[]const u8 = null,
    registry_mount_lower_path: ?[]const u8 = null,
    registry_mount_upper_path: ?[]const u8 = null,
};

const ParsedResourcesMemory = struct {
    max_mib_text: []const u8,
    reclaim: ?[]const u8,
};

const ParsedResourcesCpu = struct {
    max_vcpus_text: ?[]const u8,
    quota_cpus_text: ?[]const u8,
    weight_text: ?[]const u8,
};

const boot_plan_fields = [_][]const u8{
    "memoryMib",
    "resourcesMemory",
    "resourcesCpu",
    "autoMemoryMib",
    "hostTotalBytes",
    "vmmMemoryPreset",
    "hasImage",
    "hasCmd",
    "hasSnapshot",
    "rootDisk",
    "rootDiskOptionFalse",
    "rootDiskOptionTrue",
    "rootDiskOptionPath",
    "rootDiskRestorePath",
    "guestCwd",
    "mountGuest",
    "guestEnv",
    "name",
    "vsockUdsPath",
    "existingVsockSpec",
    "autoVsockUdsPath",
    "autoVsockTempDir",
    "portForward",
    "portForwardNetSocket",
    "gvproxyPlanningRequired",
    "gvproxyNetSocket",
    "gvproxyPath",
    "vmmBinary",
    "vmmArgs",
    "guestHostnamePid",
    "guestHostnameName",
    "guestHostnameSetPid",
    "guestHostnameSetName",
    "guestHostnameSetVsockUdsPath",
    "guestHostnameSetSkip",
    "pdeathsigPath",
    "pdeathsig",
    "detached",
    "bootTimeoutMs",
    "bootTimeoutForever",
    "kernelPath",
    "dtbPath",
    "initrdPath",
    "vmstatePath",
    "restorePath",
    "enableVmstateTiming",
    "existingVmstateTiming",
    "bootVmstateStatePath",
    "bootVmstateTempDir",
    "bootVmstateChainId",
    "bootVmstateRestorePath",
    "bootVmstateForkedFrom",
    "nested",
    "liveMounts",
    "liveMountsResolved",
    "batchLiveMountValidationRequired",
    "restoreLiveMountsRecorded",
    "restoreLiveMountsOverrides",
    "existingStatsFile",
    "statsFilePath",
    "statsFileTempDir",
    "configCmd",
    "configEnv",
    "configGuestCwd",
    "configImageCwd",
    "configLiveMounts",
    "bundleExplicitCmd",
    "bundleImageCmd",
    "bundleSnapshotRestore",
    "bundleVmstateRestore",
    "bundleLiveMounts",
    "bundleCommandRequired",
    "bundleImageEnv",
    "bundleGuestEnv",
    "bundleWorkspaceTempDir",
    "bundleConfigSynthDir",
    "bundlePackUseTiny",
    "bundlePackMountGuest",
    "bundlePackRestoreMountGuest",
    "provisionGuestCpu",
    "provisionGuestArchOverride",
    "provisionHostArch",
    "provisionDtbExplicit",
    "provisionBasePath",
    "provisionKernelPath",
    "provisionDtbPath",
    "provisionUdsPath",
    "provisionScratchDiskPath",
    "provisionRootDiskPath",
    "provisionRepackDiskPath",
    "provisionRepackOutPath",
    "provisionRepackExtractDir",
    "provisionImageConfigHasCmd",
    "provisionImageConfigCmd",
    "provisionImageConfigHasEnv",
    "provisionImageConfigEnv",
    "provisionWorkDir",
    "provisionScratchSizeBytes",
    "provisionTimeoutMs",
    "scratchOptionFalse",
    "scratchOptionPath",
    "scratchMode",
    "scratchSnapshotPath",
    "scratchRestoreClonePath",
    "scratchAutoPath",
    "rootDiskRuntimeMode",
    "rootDiskSourcePath",
    "rootDiskClonePath",
    "mountDiskRuntimeMode",
    "mountDiskLowerPath",
    "mountDiskUpperPath",
    "mountDiskSourceUpperPath",
    "mountDiskGuest",
    "mountDiskUpperSize",
    "mountDiskLowerFd",
    "mountDiskUpperFd",
    "snapshotMountGuest",
    "snapshotMountLowerPath",
    "snapshotMountUpperPath",
    "snapshotLiveMounts",
    "snapshotVmstatePath",
    "snapshotVmstateChainId",
    "snapshotVmstateCheckpointParent",
    "snapshotVmstateCheckpointSequence",
    "registrySourceImagePath",
    "registryPerBootRootDisk",
    "registryCallerRootDiskPath",
    "registryDiskPath",
    "registryForkedFrom",
    "registryMemoryCeilingMib",
    "registryStatsPath",
    "registryBootLogRoot",
    "registryChildPid",
    "registryDetached",
    "registryPerBootSnapDisk",
    "registryPerBootMountUpper",
    "registryBundleTempDir",
    "registryVsockTempDir",
    "registryStatsTempDir",
    "registryGvSocketDir",
    "registryCpuCgroupPath",
    "registryCpuPolicyMaxVcpus",
    "registryCpuPolicyQuotaCpus",
    "registryCpuPolicyWeight",
    "registryCpuControlStatus",
    "registryCpuControlReason",
    "registryVmstatePath",
    "registryVmstateChainId",
    "registryVmstateCheckpointParent",
    "registryVmstateCheckpointSequence",
    "registryNested",
    "registryHostPlatform",
    "registryVmmBinary",
    "registryVmmPdeathsig",
    "registryVmmObservedExeBase",
    "registryGvPid",
    "registryGvExe",
    "registryGvObservedExeBase",
    "registryMountGuest",
    "registryMountLowerPath",
    "registryMountUpperPath",
};

const RequestError = error{
    MissingMemoryMib,
    InvalidMemoryMib,
    MissingResourcesMemory,
    InvalidResourcesMemory,
    MissingResourcesMaxMib,
    InvalidResourcesMaxMib,
    InvalidResourcesReclaim,
    InvalidResourcesCpu,
    InvalidResourcesCpuMaxVcpus,
    InvalidResourcesCpuQuotaCpus,
    InvalidResourcesCpuWeight,
    MissingAutoMemoryMib,
    InvalidAutoMemoryMib,
    MissingHostTotalBytes,
    InvalidHostTotalBytes,
    MissingVmmMemoryPreset,
    InvalidVmmMemoryPreset,
    MissingHasImage,
    InvalidHasImage,
    MissingHasCmd,
    InvalidHasCmd,
    InvalidHasSnapshot,
    MissingRootDisk,
    InvalidRootDisk,
    InvalidRootDiskOptionFalse,
    InvalidRootDiskOptionTrue,
    InvalidRootDiskOptionPath,
    InvalidRootDiskRestorePath,
    InvalidGuestCwd,
    InvalidMountGuest,
    InvalidGuestEnv,
    InvalidGuestEnvValue,
    InvalidName,
    InvalidVsockUdsPath,
    InvalidExistingVsockSpec,
    InvalidAutoVsockUdsPath,
    InvalidAutoVsockTempDir,
    InvalidPortForward,
    InvalidHostPort,
    InvalidGuestPort,
    InvalidPortForwardNetSocket,
    InvalidGvproxyPlanningRequired,
    InvalidGvproxyNetSocket,
    InvalidGvproxyPath,
    InvalidVmmBinary,
    InvalidVmmArgs,
    InvalidGuestHostnamePid,
    InvalidGuestHostnameName,
    InvalidGuestHostnameSetPid,
    InvalidGuestHostnameSetName,
    InvalidGuestHostnameSetVsockUdsPath,
    InvalidGuestHostnameSetSkip,
    InvalidPdeathsigPath,
    InvalidPdeathsig,
    InvalidDetached,
    InvalidBootTimeoutMs,
    InvalidBootTimeoutForever,
    InvalidKernelPath,
    InvalidDtbPath,
    InvalidInitrdPath,
    InvalidVmstatePath,
    InvalidRestorePath,
    InvalidEnableVmstateTiming,
    InvalidExistingVmstateTiming,
    InvalidBootVmstateStatePath,
    InvalidBootVmstateTempDir,
    InvalidBootVmstateChainId,
    InvalidBootVmstateRestorePath,
    InvalidBootVmstateForkedFrom,
    InvalidNested,
    InvalidLiveMounts,
    InvalidLiveMountGuest,
    InvalidLiveMountsResolved,
    InvalidLiveMountHost,
    InvalidLiveMountMode,
    InvalidLiveMountTag,
    InvalidBatchLiveMountValidationRequired,
    InvalidRestoreLiveMountsRecorded,
    InvalidRestoreLiveMountsOverrides,
    InvalidExistingStatsFile,
    InvalidStatsFilePath,
    InvalidStatsFileTempDir,
    InvalidConfigCmd,
    InvalidConfigEnv,
    InvalidConfigEnvValue,
    InvalidConfigGuestCwd,
    InvalidConfigImageCwd,
    InvalidConfigLiveMounts,
    InvalidBundleExplicitCmd,
    InvalidBundleImageCmd,
    InvalidBundleSnapshotRestore,
    InvalidBundleVmstateRestore,
    InvalidBundleLiveMounts,
    InvalidBundleCommandRequired,
    InvalidBundleImageEnv,
    InvalidBundleGuestEnv,
    InvalidBundleWorkspaceTempDir,
    InvalidBundleConfigSynthDir,
    InvalidBundlePackUseTiny,
    InvalidBundlePackMountGuest,
    InvalidBundlePackRestoreMountGuest,
    InvalidProvisionGuestCpu,
    InvalidProvisionGuestArchOverride,
    InvalidProvisionHostArch,
    InvalidProvisionDtbExplicit,
    InvalidProvisionBasePath,
    InvalidProvisionKernelPath,
    InvalidProvisionDtbPath,
    InvalidProvisionUdsPath,
    InvalidProvisionScratchDiskPath,
    InvalidProvisionRootDiskPath,
    InvalidProvisionRepackDiskPath,
    InvalidProvisionRepackOutPath,
    InvalidProvisionRepackExtractDir,
    InvalidProvisionImageConfigHasCmd,
    InvalidProvisionImageConfigCmd,
    InvalidProvisionImageConfigHasEnv,
    InvalidProvisionImageConfigEnv,
    InvalidProvisionImageConfigEnvValue,
    InvalidProvisionWorkDir,
    InvalidProvisionScratchSizeBytes,
    InvalidProvisionTimeoutMs,
    InvalidBundleEnvValue,
    InvalidScratchOptionFalse,
    InvalidScratchOptionPath,
    InvalidScratchMode,
    InvalidScratchSnapshotPath,
    InvalidScratchRestoreClonePath,
    InvalidScratchAutoPath,
    InvalidRootDiskRuntimeMode,
    InvalidRootDiskSourcePath,
    InvalidRootDiskClonePath,
    InvalidMountDiskRuntimeMode,
    InvalidMountDiskLowerPath,
    InvalidMountDiskUpperPath,
    InvalidMountDiskSourceUpperPath,
    InvalidMountDiskGuest,
    InvalidMountDiskUpperSize,
    InvalidMountDiskLowerFd,
    InvalidMountDiskUpperFd,
    InvalidSnapshotMountGuest,
    InvalidSnapshotMountLowerPath,
    InvalidSnapshotMountUpperPath,
    InvalidSnapshotLiveMounts,
    InvalidSnapshotVmstatePath,
    InvalidSnapshotVmstateChainId,
    InvalidSnapshotVmstateCheckpointParent,
    InvalidSnapshotVmstateCheckpointSequence,
    InvalidRegistrySourceImagePath,
    InvalidRegistryRootDiskPath,
    InvalidRegistryBootLogRoot,
    InvalidRegistryChildPid,
    InvalidRegistryDetached,
    InvalidRegistryDiskPath,
    InvalidRegistryForkedFrom,
    InvalidRegistryMemoryCeilingMib,
    InvalidRegistryStatsPath,
    InvalidRegistryCleanupPath,
    InvalidRegistryCpuPolicy,
    InvalidRegistryCpuControlStatus,
    InvalidRegistryCpuControlReason,
    InvalidRegistryVmstatePath,
    InvalidRegistryVmstateChainId,
    InvalidRegistryVmstateCheckpointParent,
    InvalidRegistryVmstateCheckpointSequence,
    InvalidRegistryNested,
    InvalidRegistryHostPlatform,
    InvalidRegistryVmmBinary,
    InvalidRegistryVmmPdeathsig,
    InvalidRegistryVmmObservedExeBase,
    InvalidRegistryGvPid,
    InvalidRegistryGvExe,
    InvalidRegistryGvObservedExeBase,
    InvalidRegistryMountGuest,
    InvalidRegistryMountLowerPath,
    InvalidRegistryMountUpperPath,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    assert(name.len > 0);

    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const parsed = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const plan = makeCorePlan(allocator, io, parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    if (try writePortForwardFailure(
        io,
        parsed.port_forward,
        parsed.port_forward_net_socket,
    )) return .fail;

    const parts = makePlanParts(arena, parsed, plan) catch |err| {
        if (err == error.RestoreLiveMountOverrideUnknown) {
            try writeRestoreLiveMountOverrideError(arena, io, parsed);
            return .fail;
        }
        try writePlanError(io, err);
        return .fail;
    };
    try writePlan(io, parts);
    return .ok;
}

const PlanParts = struct {
    plan: boot_plan.Plan,
    cpu_policy: ?boot_plan.CpuPolicyPlan,
    guest_env: []const boot_plan.EnvPair,
    vsock_plan: boot_plan.VsockPlan,
    gvproxy_plan: boot_plan.GvproxyPlan,
    guest_hostname: boot_plan.GuestHostnameInput,
    guest_hostname_set: boot_plan.GuestHostnameSetInput,
    vmm_argv: boot_plan.VmmArgvPlan,
    use_pdeathsig: bool,
    planned_port_forwards: []const boot_plan.PortForwardMapping,
    kernel_dtb: boot_plan.KernelDtbPlan,
    initrd_env: boot_plan.InitrdPlan,
    vmstate_env: boot_plan.VmstateEnvPlan,
    vmstate_runtime: boot_plan.VmstateRuntimePlan,
    nested_env: ?[]const u8,
    virtiofs_env: []const boot_plan.EnvPair,
    batch_live_mount_sync: boot_plan.BatchLiveMountPlan,
    restore_live_mounts: []const boot_plan.RestoreLiveMountInput,
    stats_file: boot_plan.StatsFilePlan,
    planned_live_mounts: []const boot_plan.LiveMount,
    config_cmd: []const []const u8,
    config_env: []const boot_plan.EnvPair,
    config_cwd: ?[]const u8,
    config_live_mounts: []const boot_plan.LiveMount,
    bundle_command: []const []const u8,
    bundle_env: []const boot_plan.EnvPair,
    bundle_workspace: boot_plan.BundleWorkspacePlan,
    bundle_config_paths: boot_plan.BundleConfigPathsPlan,
    bundle_pack: boot_plan.BundlePackPlan,
    provision_assets: boot_plan.ProvisionAssetsPlan,
    provision_dtb: boot_plan.ProvisionDtbPlan,
    provision_boot: boot_plan.ProvisionBootPlan,
    provision_workload: boot_plan.ProvisionWorkloadPlan,
    provision_repack: boot_plan.ProvisionRepackPlan,
    provision_image_config: boot_plan.ProvisionImageConfigPlan,
    provision_runtime: boot_plan.ProvisionRuntimePlan,
    planned_scratch_mode: boot_plan.ScratchDiskMode,
    scratch_disk: boot_plan.ScratchDiskPlan,
    root_disk_runtime: boot_plan.RootDiskRuntimePlan,
    mount_disk_runtime: boot_plan.MountDiskRuntimePlan,
    mount_disk_fd_env: []const boot_plan.EnvPair,
    snapshot_context: boot_plan.SnapshotContextPlan,
    registry_shape: boot_plan.RegistryShapePlan,
    registry_process: boot_plan.RegistryProcessPlan,
};

fn makeCorePlan(
    helper_allocator: std.mem.Allocator,
    io: std.Io,
    parsed: ParsedRequest,
) !boot_plan.Plan {
    assert(@sizeOf(boot_plan.Plan) > 0);

    const input = try makePlanInput(helper_allocator, io, parsed);
    return boot_plan.planCore(input);
}

const BootEnvParts = struct {
    vsock_plan: boot_plan.VsockPlan,
    gvproxy_plan: boot_plan.GvproxyPlan,
    vmm_argv: boot_plan.VmmArgvPlan,
    use_pdeathsig: bool,
    kernel_dtb: boot_plan.KernelDtbPlan,
    initrd_env: boot_plan.InitrdPlan,
    vmstate_env: boot_plan.VmstateEnvPlan,
    vmstate_runtime: boot_plan.VmstateRuntimePlan,
    nested_env: ?[]const u8,
    virtiofs_env: []const boot_plan.EnvPair,
    batch_live_mount_sync: boot_plan.BatchLiveMountPlan,
    restore_live_mounts: []const boot_plan.RestoreLiveMountInput,
    stats_file: boot_plan.StatsFilePlan,
};

const RuntimeParts = struct {
    planned_live_mounts: []const boot_plan.LiveMount,
    config_cmd: []const []const u8,
    config_env: []const boot_plan.EnvPair,
    config_cwd: ?[]const u8,
    config_live_mounts: []const boot_plan.LiveMount,
    bundle_command: []const []const u8,
    bundle_env: []const boot_plan.EnvPair,
    planned_scratch_mode: boot_plan.ScratchDiskMode,
    scratch_disk: boot_plan.ScratchDiskPlan,
    root_disk_runtime: boot_plan.RootDiskRuntimePlan,
    mount_disk_runtime: boot_plan.MountDiskRuntimePlan,
    mount_disk_fd_env: []const boot_plan.EnvPair,
    snapshot_context: boot_plan.SnapshotContextPlan,
    registry_shape: boot_plan.RegistryShapePlan,
    registry_process: boot_plan.RegistryProcessPlan,
};

fn makePlanParts(
    arena: std.mem.Allocator,
    parsed: ParsedRequest,
    plan: boot_plan.Plan,
) !PlanParts {
    assert(@sizeOf(PlanParts) > 0);

    const boot_env = try makeBootEnvParts(arena, parsed);
    const runtime = try makeRuntimeParts(arena, parsed);
    return .{
        .plan = plan,
        .cpu_policy = try makeCpuResources(parsed),
        .guest_env = try makeGuestEnv(arena, parsed),
        .guest_hostname = try makeGuestHostname(parsed),
        .guest_hostname_set = try makeGuestHostnameSet(parsed),
        .vsock_plan = boot_env.vsock_plan,
        .gvproxy_plan = boot_env.gvproxy_plan,
        .vmm_argv = boot_env.vmm_argv,
        .use_pdeathsig = boot_env.use_pdeathsig,
        .planned_port_forwards = parsed.port_forward,
        .kernel_dtb = boot_env.kernel_dtb,
        .initrd_env = boot_env.initrd_env,
        .vmstate_env = boot_env.vmstate_env,
        .vmstate_runtime = boot_env.vmstate_runtime,
        .nested_env = boot_env.nested_env,
        .virtiofs_env = boot_env.virtiofs_env,
        .batch_live_mount_sync = boot_env.batch_live_mount_sync,
        .restore_live_mounts = boot_env.restore_live_mounts,
        .stats_file = boot_env.stats_file,
        .planned_live_mounts = runtime.planned_live_mounts,
        .config_cmd = runtime.config_cmd,
        .config_env = runtime.config_env,
        .config_cwd = runtime.config_cwd,
        .config_live_mounts = runtime.config_live_mounts,
        .bundle_command = runtime.bundle_command,
        .bundle_env = runtime.bundle_env,
        .bundle_workspace = try boot_plan.planBundleWorkspace(arena, .{
            .temp_dir = parsed.bundle_workspace_temp_dir,
        }),
        .bundle_config_paths = try boot_plan.planBundleConfigPaths(arena, .{
            .synth_bundle_dir = parsed.bundle_config_synth_dir,
        }),
        .bundle_pack = boot_plan.planBundlePack(.{
            .use_tiny = parsed.bundle_pack_use_tiny,
            .mount_guest = parsed.bundle_pack_mount_guest,
            .restore_mount_guest = parsed.bundle_pack_restore_mount_guest,
        }),
        .provision_assets = boot_plan.planProvisionAssets(.{
            .guest_cpu = parsed.provision_guest_cpu,
            .arch_override = parsed.provision_guest_arch_override,
            .host_arch = parsed.provision_host_arch,
        }),
        .provision_dtb = boot_plan.planProvisionDtb(.{
            .explicit = parsed.provision_dtb_explicit,
            .guest_cpu = parsed.provision_guest_cpu,
            .arch_override = parsed.provision_guest_arch_override,
            .host_arch = parsed.provision_host_arch,
        }),
        .provision_boot = try makeProvisionBoot(arena, parsed),
        .provision_workload = boot_plan.planProvisionWorkload(),
        .provision_repack = try makeProvisionRepack(arena, parsed),
        .provision_image_config = try makeProvisionImageConfig(arena, parsed),
        .provision_runtime = try makeProvisionRuntime(arena, parsed),
        .planned_scratch_mode = runtime.planned_scratch_mode,
        .scratch_disk = runtime.scratch_disk,
        .root_disk_runtime = runtime.root_disk_runtime,
        .mount_disk_runtime = runtime.mount_disk_runtime,
        .mount_disk_fd_env = runtime.mount_disk_fd_env,
        .snapshot_context = runtime.snapshot_context,
        .registry_shape = runtime.registry_shape,
        .registry_process = runtime.registry_process,
    };
}

fn makeBootEnvParts(arena: std.mem.Allocator, parsed: ParsedRequest) !BootEnvParts {
    assert(@sizeOf(BootEnvParts) > 0);

    return .{
        .vsock_plan = try boot_plan.planVsock(arena, .{
            .existing_spec = parsed.existing_vsock_spec,
            .auto_uds_path = parsed.auto_vsock_uds_path,
            .auto_temp_dir = parsed.auto_vsock_temp_dir,
        }),
        .gvproxy_plan = try boot_plan.planGvproxy(.{
            .planning_required = parsed.gvproxy_planning_required,
            .existing_net_socket = parsed.gvproxy_net_socket,
            .gvproxy_path = parsed.gvproxy_path,
            .port_forwards = parsed.port_forward,
        }),
        .vmm_argv = try boot_plan.planVmmArgv(arena, .{
            .binary = parsed.vmm_binary,
            .args = parsed.vmm_args,
            .pdeathsig_path = parsed.pdeathsig_path,
        }),
        .use_pdeathsig = boot_plan.planPdeathsig(.{
            .detached = parsed.detached,
            .pdeathsig = parsed.pdeathsig_requested,
        }),
        .kernel_dtb = boot_plan.planKernelDtb(.{
            .kernel_path = parsed.kernel_path,
            .dtb_path = parsed.dtb_path,
        }),
        .initrd_env = boot_plan.planInitrdEnv(.{
            .initrd_path = parsed.initrd_path,
        }),
        .vmstate_env = boot_plan.planVmstateEnv(.{
            .state_path = parsed.vmstate_path,
            .restore_path = parsed.restore_path,
            .enable_timing = parsed.enable_vmstate_timing,
            .existing_timing = parsed.existing_vmstate_timing,
        }),
        .vmstate_runtime = try boot_plan.planVmstateRuntime(arena, .{
            .state_path = parsed.boot_vmstate_state_path,
            .state_temp_dir = parsed.boot_vmstate_temp_dir,
            .chain_id = parsed.boot_vmstate_chain_id,
            .restore_path = parsed.boot_vmstate_restore_path,
            .forked_from = parsed.boot_vmstate_forked_from,
        }),
        .nested_env = boot_plan.planNestedEnv(parsed.nested_requested),
        .virtiofs_env = try boot_plan.planVirtiofsEnv(arena, parsed.live_mounts_resolved),
        .batch_live_mount_sync = try boot_plan.planBatchLiveMountSync(.{
            .live_mounts = parsed.live_mounts_resolved,
            .vsock_uds_path = parsed.vsock_uds_path,
            .validation_required = parsed.batch_live_mount_validation_required,
        }),
        .restore_live_mounts = try makeRestoreLiveMounts(arena, parsed),
        .stats_file = try boot_plan.planStatsFile(arena, .{
            .existing_path = parsed.existing_stats_file,
            .planned_path = parsed.stats_file_path,
            .planned_temp_dir = parsed.stats_file_temp_dir,
        }),
    };
}

fn makeRestoreLiveMounts(
    arena: std.mem.Allocator,
    parsed: ParsedRequest,
) ![]const boot_plan.RestoreLiveMountInput {
    assert(@sizeOf(boot_plan.RestoreLiveMountPlanInput) > 0);

    const plan = try boot_plan.planRestoreLiveMounts(arena, .{
        .recorded = parsed.restore_live_mounts_recorded,
        .overrides = parsed.restore_live_mounts_overrides,
    });
    if (plan.unknown_guest != null) return error.RestoreLiveMountOverrideUnknown;
    return plan.mounts;
}

fn makeRuntimeParts(arena: std.mem.Allocator, parsed: ParsedRequest) !RuntimeParts {
    assert(@sizeOf(RuntimeParts) > 0);

    const bundle = try makeBundleParts(arena, parsed);
    const disks = try makeDiskParts(parsed);
    return .{
        .planned_live_mounts = try boot_plan.planLiveMounts(arena, parsed.live_mounts),
        .config_cmd = parsed.config_cmd,
        .config_env = try makeConfigEnv(arena, parsed),
        .config_cwd = boot_plan.planMachinenConfigCwd(.{
            .guest_cwd = parsed.config_guest_cwd,
            .image_cwd = parsed.config_image_cwd,
        }),
        .config_live_mounts = parsed.config_live_mounts,
        .bundle_command = bundle.command,
        .bundle_env = bundle.env,
        .planned_scratch_mode = disks.planned_scratch_mode,
        .scratch_disk = disks.scratch,
        .root_disk_runtime = disks.root,
        .mount_disk_runtime = disks.mount,
        .mount_disk_fd_env = try makeMountDiskFdEnv(arena, parsed),
        .snapshot_context = try makeSnapshotContext(arena, parsed),
        .registry_shape = try makeRegistryShape(arena, parsed),
        .registry_process = try makeRegistryProcess(parsed),
    };
}

const BundleParts = struct {
    command: []const []const u8,
    env: []const boot_plan.EnvPair,
};

fn makeBundleParts(arena: std.mem.Allocator, parsed: ParsedRequest) !BundleParts {
    assert(@sizeOf(BundleParts) > 0);

    const command = if (parsed.bundle_command_required)
        try boot_plan.planBundleCommand(arena, .{
            .explicit_cmd = parsed.bundle_explicit_cmd,
            .image_cmd = parsed.bundle_image_cmd,
            .snapshot_restore = parsed.bundle_snapshot_restore,
            .vmstate_restore = parsed.bundle_vmstate_restore,
            .live_mounts = parsed.bundle_live_mounts,
        })
    else
        &.{};
    return .{
        .command = command,
        .env = try makeBundleEnv(arena, parsed),
    };
}

const DiskParts = struct {
    planned_scratch_mode: boot_plan.ScratchDiskMode,
    scratch: boot_plan.ScratchDiskPlan,
    root: boot_plan.RootDiskRuntimePlan,
    mount: boot_plan.MountDiskRuntimePlan,
};

fn makeDiskParts(parsed: ParsedRequest) !DiskParts {
    assert(@sizeOf(DiskParts) > 0);

    const planned_scratch_mode = boot_plan.planScratchMode(.{
        .false_value = parsed.scratch_option_false,
        .path = parsed.scratch_option_path,
    });
    return .{
        .planned_scratch_mode = planned_scratch_mode,
        .scratch = try boot_plan.planScratchDisk(.{
            .mode = parsed.scratch_mode,
            .has_cmd = parsed.has_cmd,
            .has_image = parsed.has_image,
            .snapshot_path = parsed.scratch_snapshot_path,
            .restore_clone_path = parsed.scratch_restore_clone_path,
            .auto_path = parsed.scratch_auto_path,
        }),
        .root = try boot_plan.planRootDiskRuntime(.{
            .mode = parsed.root_disk_runtime_mode,
            .source_path = parsed.root_disk_source_path,
            .clone_path = parsed.root_disk_clone_path,
        }),
        .mount = try makeMountDiskRuntime(parsed),
    };
}

fn makeMountDiskRuntime(parsed: ParsedRequest) !boot_plan.MountDiskRuntimePlan {
    assert(@sizeOf(boot_plan.MountDiskRuntimePlan) > 0);

    const upper_size = if (parsed.mount_disk_upper_size_text) |text|
        parseUnsigned(text) catch return error.InvalidMountDiskUpperSize
    else
        null;
    return boot_plan.planMountDiskRuntime(.{
        .mode = parsed.mount_disk_runtime_mode,
        .lower_path = parsed.mount_disk_lower_path,
        .upper_path = parsed.mount_disk_upper_path,
        .source_upper_path = parsed.mount_disk_source_upper_path,
        .guest = parsed.mount_disk_guest,
        .upper_size_bytes = upper_size,
    });
}

fn makeProvisionBoot(
    arena: std.mem.Allocator,
    parsed: ParsedRequest,
) !boot_plan.ProvisionBootPlan {
    assert(@sizeOf(boot_plan.ProvisionBootPlan) > 0);

    return boot_plan.planProvisionBoot(arena, .{
        .base_path = parsed.provision_base_path,
        .kernel_path = parsed.provision_kernel_path,
        .dtb_path = parsed.provision_dtb_path,
        .uds_path = parsed.provision_uds_path,
        .scratch_disk_path = parsed.provision_scratch_disk_path,
        .root_disk_path = parsed.provision_root_disk_path,
    });
}

fn makeCpuResources(parsed: ParsedRequest) !?boot_plan.CpuPolicyPlan {
    assert(@sizeOf(ParsedRequest) > 0);

    const cpu = parsed.resources_cpu orelse return null;
    return boot_plan.planCpuResources(.{
        .max_vcpus = try optionalUnsignedText(
            cpu.max_vcpus_text,
            error.InvalidResourcesCpuMaxVcpus,
        ),
        .quota_cpus = try optionalFloatText(
            cpu.quota_cpus_text,
            error.InvalidResourcesCpuQuotaCpus,
        ),
        .weight = try optionalUnsignedText(cpu.weight_text, error.InvalidResourcesCpuWeight),
    });
}

fn optionalFloatText(text: ?[]const u8, err: RequestError) RequestError!?f64 {
    assert(@errorName(err).len > 0);

    if (text) |value| {
        return parseFloat(value) catch err;
    }
    return null;
}

fn makeProvisionRuntime(
    arena: std.mem.Allocator,
    parsed: ParsedRequest,
) !boot_plan.ProvisionRuntimePlan {
    assert(@sizeOf(boot_plan.ProvisionRuntimePlan) > 0);

    return boot_plan.planProvisionRuntime(arena, .{
        .work_dir = parsed.provision_work_dir,
        .scratch_size_bytes = try optionalUnsignedText(
            parsed.provision_scratch_size_bytes_text,
            error.InvalidProvisionScratchSizeBytes,
        ),
        .timeout_ms = try optionalUnsignedText(
            parsed.provision_timeout_ms_text,
            error.InvalidProvisionTimeoutMs,
        ),
    });
}

fn optionalUnsignedText(
    text: ?[]const u8,
    err: RequestError,
) RequestError!?u64 {
    assert(@errorName(err).len > 0);

    if (text) |value| {
        return parseUnsigned(value) catch err;
    }
    return null;
}

fn makeProvisionImageConfig(
    arena: std.mem.Allocator,
    parsed: ParsedRequest,
) !boot_plan.ProvisionImageConfigPlan {
    assert(@sizeOf(boot_plan.ProvisionImageConfigPlan) > 0);

    return boot_plan.planProvisionImageConfig(.{
        .has_cmd = parsed.provision_image_config_has_cmd,
        .cmd = parsed.provision_image_config_cmd,
        .has_env = parsed.provision_image_config_has_env,
        .env = try objectStringPairs(
            arena,
            parsed.provision_image_config_env,
            error.InvalidProvisionImageConfigEnvValue,
        ),
    });
}

fn makeProvisionRepack(
    arena: std.mem.Allocator,
    parsed: ParsedRequest,
) !boot_plan.ProvisionRepackPlan {
    assert(@sizeOf(boot_plan.ProvisionRepackPlan) > 0);

    return boot_plan.planProvisionRepack(arena, .{
        .disk_path = parsed.provision_repack_disk_path,
        .out_path = parsed.provision_repack_out_path,
        .extract_dir = parsed.provision_repack_extract_dir,
    });
}

fn makeRegistryCpuPolicy(parsed: ParsedRequest) RequestError!?boot_plan.CpuPolicyPlan {
    assert(@sizeOf(ParsedRequest) > 0);

    if (parsed.registry_cpu_policy_max_vcpus_text == null and
        parsed.registry_cpu_policy_quota_cpus_text == null and
        parsed.registry_cpu_policy_weight_text == null)
    {
        return null;
    }

    const max_vcpus_text = parsed.registry_cpu_policy_max_vcpus_text orelse
        return error.InvalidRegistryCpuPolicy;
    const weight_text = parsed.registry_cpu_policy_weight_text orelse
        return error.InvalidRegistryCpuPolicy;
    return .{
        .max_vcpus = parseUnsigned(max_vcpus_text) catch return error.InvalidRegistryCpuPolicy,
        .quota_cpus = try optionalFloatText(
            parsed.registry_cpu_policy_quota_cpus_text,
            error.InvalidRegistryCpuPolicy,
        ),
        .weight = parseUnsigned(weight_text) catch return error.InvalidRegistryCpuPolicy,
    };
}

fn makeMountDiskFdEnv(
    allocator: std.mem.Allocator,
    parsed: ParsedRequest,
) ![]const boot_plan.EnvPair {
    assert(@sizeOf(boot_plan.MountDiskFdEnvInput) > 0);

    const lower_fd = if (parsed.mount_disk_lower_fd_text) |text|
        parseUnsigned(text) catch return error.InvalidMountDiskLowerFd
    else
        null;
    const upper_fd = if (parsed.mount_disk_upper_fd_text) |text|
        parseUnsigned(text) catch return error.InvalidMountDiskUpperFd
    else
        null;
    return boot_plan.planMountDiskFdEnv(allocator, .{ .lower_fd = lower_fd, .upper_fd = upper_fd });
}

fn makeSnapshotContext(
    allocator: std.mem.Allocator,
    parsed: ParsedRequest,
) !boot_plan.SnapshotContextPlan {
    assert(@sizeOf(boot_plan.SnapshotContextInput) > 0);

    return boot_plan.planSnapshotContext(allocator, .{
        .mount_disk = .{
            .guest = parsed.snapshot_mount_guest,
            .lower_path = parsed.snapshot_mount_lower_path,
            .upper_path = parsed.snapshot_mount_upper_path,
        },
        .live_mounts = parsed.snapshot_live_mounts,
        .vmstate = .{
            .state_path = parsed.snapshot_vmstate_path,
            .chain_id = parsed.snapshot_vmstate_chain_id,
            .checkpoint_parent = parsed.snapshot_vmstate_checkpoint_parent,
            .checkpoint_sequence = try optionalUnsignedText(
                parsed.snapshot_vmstate_checkpoint_sequence_text,
                error.InvalidSnapshotVmstateCheckpointSequence,
            ),
        },
    });
}

fn makeRegistryProcess(parsed: ParsedRequest) !boot_plan.RegistryProcessPlan {
    assert(@sizeOf(boot_plan.RegistryProcessInput) > 0);

    const gv_pid = if (parsed.registry_gv_pid_text) |text|
        parseSigned(text) catch return error.InvalidRegistryGvPid
    else
        null;
    return boot_plan.planRegistryProcess(.{
        .host_platform = parsed.registry_host_platform,
        .vmm_binary = parsed.registry_vmm_binary,
        .vmm_pdeathsig = parsed.registry_vmm_pdeathsig,
        .vmm_observed_exe_base = parsed.registry_vmm_observed_exe_base,
        .gv_pid = gv_pid,
        .gv_exe = parsed.registry_gv_exe,
        .gv_observed_exe_base = parsed.registry_gv_observed_exe_base,
    });
}

fn makeRegistryShape(
    arena: std.mem.Allocator,
    parsed: ParsedRequest,
) !boot_plan.RegistryShapePlan {
    assert(@sizeOf(boot_plan.RegistryShapePlan) > 0);

    const registry_vmstate_checkpoint_sequence = try optionalUnsignedText(
        parsed.registry_vmstate_checkpoint_sequence_text,
        error.InvalidRegistryVmstateCheckpointSequence,
    );
    const registry_child_pid = if (parsed.registry_child_pid_text) |text|
        parseSigned(text) catch return error.InvalidRegistryChildPid
    else
        null;
    const registry_memory_ceiling_mib = try optionalUnsignedText(
        parsed.registry_memory_ceiling_mib_text,
        error.InvalidRegistryMemoryCeilingMib,
    );
    return boot_plan.planRegistryShape(arena, .{
        .source_image_path = parsed.registry_source_image_path,
        .per_boot_root_disk = parsed.registry_per_boot_root_disk,
        .caller_root_disk_path = parsed.registry_caller_root_disk_path,
        .boot_log_root = parsed.registry_boot_log_root,
        .child_pid = registry_child_pid,
        .detached = parsed.registry_detached,
        .disk_path = parsed.registry_disk_path,
        .forked_from = parsed.registry_forked_from,
        .memory_ceiling_mib = registry_memory_ceiling_mib,
        .stats_path = parsed.registry_stats_path,
        .cleanup = .{
            .per_boot_root_disk = parsed.registry_per_boot_root_disk,
            .per_boot_snap_disk = parsed.registry_per_boot_snap_disk,
            .per_boot_mount_upper = parsed.registry_per_boot_mount_upper,
            .bundle_temp_dir = parsed.registry_bundle_temp_dir,
            .vsock_temp_dir = parsed.registry_vsock_temp_dir,
            .stats_temp_dir = parsed.registry_stats_temp_dir,
            .gv_socket_dir = parsed.registry_gv_socket_dir,
            .cpu_cgroup_path = parsed.registry_cpu_cgroup_path,
        },
        .mount_disk = .{
            .guest = parsed.registry_mount_guest,
            .lower_path = parsed.registry_mount_lower_path,
            .upper_path = parsed.registry_mount_upper_path,
        },
        .live_mounts = parsed.live_mounts_resolved,
        .port_forwards = parsed.port_forward,
        .cpu_policy = try makeRegistryCpuPolicy(parsed),
        .cpu_control_status = parsed.registry_cpu_control_status,
        .cpu_control_reason = parsed.registry_cpu_control_reason,
        .vmstate = .{
            .state_path = parsed.registry_vmstate_path,
            .chain_id = parsed.registry_vmstate_chain_id,
            .checkpoint_parent = parsed.registry_vmstate_checkpoint_parent,
            .checkpoint_sequence = registry_vmstate_checkpoint_sequence,
        },
        .nested = parsed.registry_nested,
    });
}

fn writePortForwardFailure(
    io: std.Io,
    mappings: []const boot_plan.PortForwardMapping,
    net_socket: ?[]const u8,
) !bool {
    assert(@sizeOf(boot_plan.PortForwardMapping) > 0);

    switch (boot_plan.validatePortForward(mappings)) {
        .ok => {},
        .invalid_host_port => |port| {
            try writePortForwardInvalid(io, "hostPort", port);
            return true;
        },
        .invalid_guest_port => |port| {
            try writePortForwardInvalid(io, "guestPort", port);
            return true;
        },
        .duplicate_host_port => |port| {
            try writeDuplicateHostPort(io, port);
            return true;
        },
    }
    boot_plan.validatePortForwardNetSocket(.{
        .port_forwards = mappings,
        .net_socket = net_socket,
    }) catch |err| switch (err) {
        error.PortForwardNetSocketPreset => {
            try writeBootError(
                io,
                "BOOT_PORT_FORWARD_INVALID",
                "portForward requires the runtime to own gvproxy, " ++
                    "MACHINEN_NET_SOCKET is already set",
            );
            return true;
        },
        else => return err,
    };
    return false;
}

fn writePlan(io: std.Io, parts: PlanParts) !void {
    assert(@sizeOf(PlanParts) > 0);

    try protocol.stdout(io, "{\"ok\":true,\"protocolVersion\":1,");
    try protocol.stdout(io, "\"command\":\"boot-plan\",\"data\":{");
    try writeCoreFields(io, parts.plan, parts.cpu_policy);
    try writeVsockKernelFields(io, parts.vsock_plan, parts.kernel_dtb);
    try writeGvproxyPlanField(io, "gvproxyPlan", parts.gvproxy_plan, true);
    try writeNullableStringField(io, "vmmInitrd", parts.initrd_env.vmm_initrd, true);
    try writeGuestHostnameField(io, "guestHostname", parts.guest_hostname, true);
    try writeGuestHostnameSetField(io, "guestHostnameSet", parts.guest_hostname_set, true);
    try writeVmstateStatsFields(io, parts.vmstate_env, parts.stats_file);
    try writeVmstateRuntimeField(io, "vmstateRuntime", parts.vmstate_runtime, true);
    try writeBoolField(
        io,
        "batchLiveMountSyncRequired",
        parts.batch_live_mount_sync.sync_required,
        true,
    );
    try writeRestoreLiveMountsField(io, "restoreLiveMounts", parts.restore_live_mounts, true);
    try writeNullableStringField(io, "vmmNested", parts.nested_env, true);
    try writeLiveMountsArrayField(io, "plannedLiveMounts", parts.planned_live_mounts, true);
    try writePortForwardField(io, "plannedPortForward", parts.planned_port_forwards, false, true);
    try writeEnvObjectField(io, "virtiofsEnv", parts.virtiofs_env, true);
    try writeNullableStringField(io, "vmmCommand", parts.vmm_argv.command, true);
    try writeStringArrayField(io, "vmmArgs", parts.vmm_argv.args, true);
    try writeBoolField(io, "usePdeathsig", parts.use_pdeathsig, true);
    try writeEnvObjectField(io, "mergedGuestEnv", parts.guest_env, true);
    try writeMachinenConfigField(io, "machinenConfig", parts, true);
    try writeStringArrayField(io, "bundleCommand", parts.bundle_command, true);
    try writeEnvObjectField(io, "bundleEnv", parts.bundle_env, true);
    try writeBundleWorkspaceField(io, "bundleWorkspace", parts.bundle_workspace, true);
    try writeBundleConfigPathsField(io, "bundleConfigPaths", parts.bundle_config_paths, true);
    try writeBundlePackField(io, "bundlePack", parts.bundle_pack, true);
    try writeProvisionAssetsField(io, "provisionAssets", parts.provision_assets, true);
    try writeProvisionDtbField(io, "provisionDtb", parts.provision_dtb, true);
    try writeProvisionBootField(io, "provisionBoot", parts.provision_boot, true);
    try writeProvisionWorkloadField(io, "provisionWorkload", parts.provision_workload, true);
    try writeProvisionRepackField(io, "provisionRepack", parts.provision_repack, true);
    try writeProvisionImageConfigField(
        io,
        "provisionImageConfig",
        parts.provision_image_config,
        true,
    );
    try writeProvisionRuntimeField(io, "provisionRuntime", parts.provision_runtime, true);
    try writeScratchModeField(io, "plannedScratchMode", parts.planned_scratch_mode, true);
    try writeScratchDiskField(io, "scratchDisk", parts.scratch_disk, true);
    try writeRootDiskRuntimeField(io, "rootDiskRuntime", parts.root_disk_runtime, true);
    try writeMountDiskRuntimeField(io, "mountDiskRuntime", parts.mount_disk_runtime, true);
    try writeEnvObjectField(io, "mountDiskFdEnv", parts.mount_disk_fd_env, true);
    try writeSnapshotContextField(io, "snapshotContext", parts.snapshot_context, true);
    try writeRegistryShapeField(io, "registryShape", parts.registry_shape, true);
    try writeRegistryProcessField(io, "registryProcess", parts.registry_process, true);
    try protocol.stdout(io, "}}\n");
}

fn writeCoreFields(
    io: std.Io,
    plan: boot_plan.Plan,
    cpu_policy: ?boot_plan.CpuPolicyPlan,
) !void {
    assert(@sizeOf(boot_plan.Plan) > 0);

    try writeNullableU64Field(io, "memoryCeilingMib", plan.memory_ceiling_mib, false);
    try writeNullableU64StringField(io, "vmmMemory", plan.vmm_memory_mib, true);
    try writeNullableU64Field(io, "timeoutMs", plan.timeout_ms, true);
    try writeU64Field(io, "detachedReadinessTimeoutMs", plan.detached_readiness_timeout_ms, true);
    try writeBoolField(io, "needsInitramfs", plan.needs_initramfs, true);
    try writeCpuPolicyField(io, "cpuPolicy", cpu_policy, true);
    try writeBoolField(io, "wantsRootDisk", plan.wants_root_disk, true);
    try writeNullableStringField(
        io,
        "normalizedMountGuest",
        plan.normalized_mount_guest,
        true,
    );
}

fn writeCpuPolicyField(
    io: std.Io,
    comptime field: []const u8,
    cpu_policy: ?boot_plan.CpuPolicyPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (cpu_policy) |cpu| {
        try protocol.stdout(io, "{\"maxVcpus\":");
        try writeU64Bare(io, cpu.max_vcpus);
        if (cpu.quota_cpus) |quota| {
            try protocol.stdout(io, ",\"quotaCpus\":");
            try writeF64Bare(io, quota);
        }
        try protocol.stdout(io, ",\"weight\":");
        try writeU64Bare(io, cpu.weight);
        try protocol.stdout(io, "}");
    } else {
        try protocol.stdout(io, "null");
    }
}

fn writeU64Bare(io: std.Io, value: u64) !void {
    assert(@sizeOf(u64) > 0);

    var buf: [32]u8 = undefined;
    try protocol.stdout(io, try std.fmt.bufPrint(&buf, "{d}", .{value}));
}

fn writeI64Bare(io: std.Io, value: i64) !void {
    assert(@sizeOf(i64) > 0);

    var buf: [32]u8 = undefined;
    try protocol.stdout(io, try std.fmt.bufPrint(&buf, "{d}", .{value}));
}

fn writeF64Bare(io: std.Io, value: f64) !void {
    assert(@sizeOf(f64) > 0);

    var buf: [64]u8 = undefined;
    try protocol.stdout(io, try std.fmt.bufPrint(&buf, "{d}", .{value}));
}

fn writeVsockKernelFields(
    io: std.Io,
    vsock_plan: boot_plan.VsockPlan,
    kernel_dtb: boot_plan.KernelDtbPlan,
) !void {
    assert(@sizeOf(boot_plan.VsockPlan) > 0);

    try writeNullableStringField(io, "vsockUdsPath", vsock_plan.uds_path, true);
    try writeNullableStringField(io, "vmmVsock", vsock_plan.vmm_vsock, true);
    try writeNullableStringField(io, "vmmKernel", kernel_dtb.vmm_kernel, true);
    try writeNullableStringField(io, "vmmDtb", kernel_dtb.vmm_dtb, true);
}

fn writeGvproxyPlanField(
    io: std.Io,
    comptime field: []const u8,
    plan: boot_plan.GvproxyPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeNullableStringField(io, "action", plan.action, false);
    try writeNullableStringField(io, "gvproxyPath", plan.gvproxy_path, true);
    try protocol.stdout(io, "}");
}

fn writeGuestHostnameField(
    io: std.Io,
    comptime field: []const u8,
    input: boot_plan.GuestHostnameInput,
    comma: bool,
) !void {
    assert(field.len > 0);

    var buffer: [256]u8 = undefined;
    const hostname = boot_plan.formatGuestHostname(&buffer, input) catch
        return error.InvalidGuestHostnameName;
    try writeNullableStringField(io, field, hostname, comma);
}

fn writeGuestHostnameSetField(
    io: std.Io,
    comptime field: []const u8,
    input: boot_plan.GuestHostnameSetInput,
    comma: bool,
) !void {
    assert(field.len > 0);

    var buffer: [256]u8 = undefined;
    const hostname = boot_plan.formatGuestHostnameSet(&buffer, input) catch
        return error.InvalidGuestHostnameSetName;
    try writeNullableStringField(io, field, hostname, comma);
}

fn writeRestoreLiveMountsField(
    io: std.Io,
    comptime field: []const u8,
    mounts: []const boot_plan.RestoreLiveMountInput,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "[");
    for (mounts, 0..) |mount, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.stdout(io, "{");
        try writeNullableStringField(io, "host", mount.host, false);
        try writeNullableStringField(io, "guest", mount.guest, true);
        if (mount.mode) |mode| try writeNullableStringField(io, "mode", mode, true);
        try protocol.stdout(io, "}");
    }
    try protocol.stdout(io, "]");
}

fn writeVmstateRuntimeField(
    io: std.Io,
    comptime field: []const u8,
    runtime: boot_plan.VmstateRuntimePlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeNullableStringField(io, "statePath", runtime.state_path, false);
    try writeNullableStringField(io, "chainId", runtime.chain_id, true);
    try writeNullableStringField(io, "checkpointParent", runtime.checkpoint_parent, true);
    try writeNullableU64Field(io, "checkpointSequence", runtime.checkpoint_sequence, true);
    try protocol.stdout(io, "}");
}

fn writeVmstateStatsFields(
    io: std.Io,
    vmstate_env: boot_plan.VmstateEnvPlan,
    stats_file: boot_plan.StatsFilePlan,
) !void {
    assert(@sizeOf(boot_plan.VmstateEnvPlan) > 0);

    try writeNullableStringField(io, "vmmSnapshotPath", vmstate_env.snapshot_path, true);
    try writeNullableStringField(io, "vmmRestorePath", vmstate_env.restore_path, true);
    try writeNullableStringField(io, "vmmVmstateTiming", vmstate_env.vmstate_timing, true);
    try writeNullableStringField(io, "statsFilePath", stats_file.stats_file_path, true);
    try writeNullableStringField(io, "vmmStatsFile", stats_file.vmm_stats_file, true);
}

fn writeFieldName(io: std.Io, comptime field: []const u8, comma: bool) !void {
    assert(field.len > 0);

    if (comma) try protocol.stdout(io, ",");
    try protocol.writeJsonString(io, field);
    try protocol.stdout(io, ":");
}

fn writeU64Field(
    io: std.Io,
    comptime field: []const u8,
    value: u64,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try writeU64Bare(io, value);
}

fn writeNullableU64Field(
    io: std.Io,
    comptime field: []const u8,
    value: ?u64,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (value) |number| {
        var buf: [32]u8 = undefined;
        try protocol.stdout(io, try std.fmt.bufPrint(&buf, "{d}", .{number}));
    } else {
        try protocol.stdout(io, "null");
    }
}

fn writeNullableU64StringField(
    io: std.Io,
    comptime field: []const u8,
    value: ?u64,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (value) |number| {
        var buf: [32]u8 = undefined;
        try protocol.writeJsonString(io, try std.fmt.bufPrint(&buf, "{d}", .{number}));
    } else {
        try protocol.stdout(io, "null");
    }
}

fn writeNullableStringField(
    io: std.Io,
    comptime field: []const u8,
    value: ?[]const u8,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (value) |text| {
        try protocol.writeJsonString(io, text);
    } else {
        try protocol.stdout(io, "null");
    }
}

fn writeBoolField(
    io: std.Io,
    comptime field: []const u8,
    value: bool,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, if (value) "true" else "false");
}

fn writeLiveMountsArrayField(
    io: std.Io,
    comptime field: []const u8,
    mounts: []const boot_plan.LiveMount,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "[");
    for (mounts, 0..) |mount, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.stdout(io, "{\"host\":");
        try protocol.writeJsonString(io, mount.host);
        try protocol.stdout(io, ",\"guest\":");
        try protocol.writeJsonString(io, mount.guest);
        try protocol.stdout(io, ",\"mode\":");
        try protocol.writeJsonString(io, mount.mode);
        try protocol.stdout(io, ",\"tag\":");
        try protocol.writeJsonString(io, mount.tag);
        try protocol.stdout(io, "}");
    }
    try protocol.stdout(io, "]");
}

fn writeBundleWorkspaceField(
    io: std.Io,
    comptime field: []const u8,
    workspace: boot_plan.BundleWorkspacePlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeNullableStringField(io, "cpioPath", workspace.cpio_path, false);
    try writeNullableStringField(io, "synthBundleDir", workspace.synth_bundle_dir, true);
    try protocol.stdout(io, "}");
}

fn writeBundleConfigPathsField(
    io: std.Io,
    comptime field: []const u8,
    paths: boot_plan.BundleConfigPathsPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeNullableStringField(io, "rootfsDir", paths.rootfs_dir, false);
    try writeNullableStringField(io, "configPath", paths.config_path, true);
    try protocol.stdout(io, "}");
}

fn writeBundlePackField(
    io: std.Io,
    comptime field: []const u8,
    plan: boot_plan.BundlePackPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeFieldName(io, "kind", false);
    try protocol.writeJsonString(io, plan.kind);
    try writeNullableStringField(io, "tinyMountGuest", plan.tiny_mount_guest, true);
    try protocol.stdout(io, "}");
}

fn writeProvisionAssetsField(
    io: std.Io,
    comptime field: []const u8,
    assets: boot_plan.ProvisionAssetsPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{\"cpu\":");
    try protocol.writeJsonString(io, assets.cpu);
    try protocol.stdout(io, ",\"kernelAsset\":");
    try protocol.writeJsonString(io, assets.kernel_asset);
    try writeNullableStringField(io, "dtbAsset", assets.dtb_asset, true);
    try protocol.stdout(io, ",\"rootfsAsset\":");
    try protocol.writeJsonString(io, assets.rootfs_asset);
    try protocol.stdout(io, "}");
}

fn writeProvisionDtbField(
    io: std.Io,
    comptime field: []const u8,
    plan: boot_plan.ProvisionDtbPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeBoolField(io, "required", plan.required, false);
    try writeNullableStringField(io, "asset", plan.asset, true);
    try writeNullableStringField(io, "cliCacheName", plan.cli_cache_name, true);
    try protocol.stdout(io, "}");
}

fn writeProvisionBootField(
    io: std.Io,
    comptime field: []const u8,
    boot: boot_plan.ProvisionBootPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeNullableStringField(io, "imagePath", boot.image_path, false);
    try writeNullableStringField(io, "kernelPath", boot.kernel_path, true);
    try writeNullableStringField(io, "dtbPath", boot.dtb_path, true);
    try writeNullableStringField(io, "vmmVsock", boot.vmm_vsock, true);
    try writeStringArrayField(io, "cmd", boot.cmd, true);
    try writeEnvObjectField(io, "env", boot.env, true);
    try writeNullableStringField(io, "snapshotPath", boot.snapshot_path, true);
    try writeNullableStringField(io, "rootDiskPath", boot.root_disk_path, true);
    try protocol.stdout(io, "}");
}

fn writeProvisionWorkloadField(
    io: std.Io,
    comptime field: []const u8,
    workload: boot_plan.ProvisionWorkloadPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{\"tarToDiskCommand\":");
    try protocol.writeJsonString(io, workload.tar_to_disk_command);
    try protocol.stdout(io, ",\"poweroffCommand\":");
    try protocol.writeJsonString(io, workload.poweroff_command);
    try protocol.stdout(io, "}");
}

fn writeProvisionRepackField(
    io: std.Io,
    comptime field: []const u8,
    repack: boot_plan.ProvisionRepackPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeStringArrayField(io, "extractArgs", repack.extract_args, false);
    try writeStringArrayField(io, "targzArgs", repack.targz_args, true);
    try writeNullableStringField(io, "imageConfigPath", repack.image_config_path, true);
    try protocol.stdout(io, "}");
}

fn writeProvisionImageConfigField(
    io: std.Io,
    comptime field: []const u8,
    config: boot_plan.ProvisionImageConfigPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (!config.has_config) {
        try protocol.stdout(io, "null");
        return;
    }

    try protocol.stdout(io, "{");
    var wrote = false;
    if (config.has_cmd) {
        try writeStringArrayField(io, "cmd", config.cmd, false);
        wrote = true;
    }
    if (config.has_env) {
        try writeEnvObjectField(io, "env", config.env, wrote);
    }
    try protocol.stdout(io, "}");
}

fn writeProvisionRuntimeField(
    io: std.Io,
    comptime field: []const u8,
    runtime: boot_plan.ProvisionRuntimePlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeNullableU64Field(io, "scratchSizeBytes", runtime.scratch_size_bytes, false);
    try writeNullableU64Field(io, "deadlineMs", runtime.deadline_ms, true);
    try writeNullableStringField(io, "diskPath", runtime.disk_path, true);
    try writeNullableStringField(io, "rootDiskPath", runtime.root_disk_path, true);
    try writeNullableStringField(io, "udsPath", runtime.uds_path, true);
    try protocol.stdout(io, "}");
}

fn writeScratchModeField(
    io: std.Io,
    comptime field: []const u8,
    mode: boot_plan.ScratchDiskMode,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.writeJsonString(io, scratchDiskModeName(mode));
}

fn scratchDiskModeName(mode: boot_plan.ScratchDiskMode) []const u8 {
    assert(@sizeOf(boot_plan.ScratchDiskMode) > 0);

    return switch (mode) {
        .unset => "unset",
        .false_value => "false",
        .path => "path",
        .auto => "auto",
    };
}

fn writeScratchDiskField(
    io: std.Io,
    comptime field: []const u8,
    scratch: boot_plan.ScratchDiskPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{\"action\":");
    try protocol.writeJsonString(io, scratch.action);
    try writeNullableStringField(io, "diskPath", scratch.disk_path, true);
    try writeNullableStringField(io, "perBootSnapDisk", scratch.per_boot_snap_disk, true);
    try writeNullableStringField(io, "vmmDisk", scratch.vmm_disk, true);
    try protocol.stdout(io, "}");
}

fn writeRootDiskRuntimeField(
    io: std.Io,
    comptime field: []const u8,
    root_disk: boot_plan.RootDiskRuntimePlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{\"action\":");
    try protocol.writeJsonString(io, root_disk.action);
    try writeNullableStringField(io, "sourcePath", root_disk.source_path, true);
    try writeNullableStringField(io, "targetPath", root_disk.target_path, true);
    try writeNullableStringField(
        io,
        "perBootRootDisk",
        root_disk.per_boot_root_disk,
        true,
    );
    try writeNullableStringField(io, "vmmRootDisk", root_disk.vmm_root_disk, true);
    try protocol.stdout(io, "}");
}

fn writeMountDiskRuntimeField(
    io: std.Io,
    comptime field: []const u8,
    mount_disk: boot_plan.MountDiskRuntimePlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{\"action\":");
    try protocol.writeJsonString(io, mount_disk.action);
    try writeNullableStringField(io, "lowerPath", mount_disk.lower_path, true);
    try writeNullableStringField(io, "upperPath", mount_disk.upper_path, true);
    try writeNullableStringField(
        io,
        "sourceUpperPath",
        mount_disk.source_upper_path,
        true,
    );
    try writeNullableStringField(io, "guest", mount_disk.guest, true);
    try writeNullableU64Field(io, "upperSizeBytes", mount_disk.upper_size_bytes, true);
    try protocol.stdout(io, "}");
}

fn writeMachinenConfigField(
    io: std.Io,
    comptime field: []const u8,
    parts: PlanParts,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeStringArrayField(io, "cmd", parts.config_cmd, false);
    try writeEnvObjectField(io, "env", parts.config_env, true);
    if (parts.config_cwd) |cwd| {
        try writeFieldName(io, "cwd", true);
        try protocol.writeJsonString(io, cwd);
    }
    try writeConfigLiveMountsField(io, "liveMounts", parts.config_live_mounts, true);
    try protocol.stdout(io, "}");
}

fn writeConfigLiveMountsField(
    io: std.Io,
    comptime field: []const u8,
    mounts: []const boot_plan.LiveMount,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "[");
    for (mounts, 0..) |mount, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.stdout(io, "{\"guest\":");
        try protocol.writeJsonString(io, mount.guest);
        try protocol.stdout(io, ",\"tag\":");
        try protocol.writeJsonString(io, mount.tag);
        try protocol.stdout(io, ",\"mode\":");
        try protocol.writeJsonString(io, mount.mode);
        try protocol.stdout(io, "}");
    }
    try protocol.stdout(io, "]");
}

fn writeSnapshotContextField(
    io: std.Io,
    comptime field: []const u8,
    context: boot_plan.SnapshotContextPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeSnapshotMountDiskField(io, "mountDisk", context.mount_disk, false);
    try writeSnapshotLiveMountsField(io, "liveMounts", context.live_mounts, true);
    try writeSnapshotVmstateChainField(io, "vmstateChain", context.vmstate_chain, true);
    try protocol.stdout(io, "}");
}

fn writeSnapshotMountDiskField(
    io: std.Io,
    comptime field: []const u8,
    mount: ?boot_plan.SnapshotMountDiskPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (mount) |disk| {
        try protocol.stdout(io, "{");
        try writeNullableStringField(io, "guest", disk.guest, false);
        try writeNullableStringField(io, "lowerPath", disk.lower_path, true);
        try writeNullableStringField(io, "upperPath", disk.upper_path, true);
        try protocol.stdout(io, "}");
    } else try protocol.stdout(io, "null");
}

fn writeSnapshotLiveMountsField(
    io: std.Io,
    comptime field: []const u8,
    mounts: []const boot_plan.SnapshotLiveMountPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "[");
    for (mounts, 0..) |mount, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.stdout(io, "{");
        try writeNullableStringField(io, "host", mount.host, false);
        try writeNullableStringField(io, "guest", mount.guest, true);
        try writeNullableStringField(io, "mode", mount.mode, true);
        try protocol.stdout(io, "}");
    }
    try protocol.stdout(io, "]");
}

fn writeSnapshotVmstateChainField(
    io: std.Io,
    comptime field: []const u8,
    chain: ?boot_plan.SnapshotVmstateChainPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (chain) |vmstate| {
        try protocol.stdout(io, "{");
        try writeNullableStringField(io, "chainId", vmstate.chain_id, false);
        try writeNullableStringField(io, "parentDir", vmstate.parent_dir, true);
        try writeU64Field(io, "sequence", vmstate.sequence, true);
        try protocol.stdout(io, "}");
    } else try protocol.stdout(io, "null");
}

fn writeRegistryProcessField(
    io: std.Io,
    comptime field: []const u8,
    process: boot_plan.RegistryProcessPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeNullableStringField(io, "vmmExe", process.vmm_exe, false);
    try writeNullableStringField(io, "gvproxyExe", process.gvproxy_exe, true);
    try protocol.stdout(io, "}");
}

fn writeRegistryShapeField(
    io: std.Io,
    comptime field: []const u8,
    registry: boot_plan.RegistryShapePlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeNullableStringField(io, "sourceImagePath", registry.source_image_path, false);
    try writeNullableStringField(io, "diskPath", registry.disk_path, true);
    try writeNullableStringField(io, "forkedFrom", registry.forked_from, true);
    try writeNullableU64Field(io, "memoryCeilingMib", registry.memory_ceiling_mib, true);
    try writeNullableStringField(io, "statsPath", registry.stats_path, true);
    try writeNullableStringField(io, "rootDiskPath", registry.root_disk_path, true);
    try writeNullableStringField(io, "bootLogPath", registry.boot_log_path.value(), true);
    try writeFieldName(io, "rootDiskMode", true);
    try protocol.writeJsonString(io, registry.root_disk_mode);
    try writeStringArrayField(io, "cleanupPaths", registry.cleanup_paths, true);
    try writeRegistryMountDiskField(io, "mountDisk", registry.mount_disk, true);
    try writeRegistryLiveMountsField(io, "liveMounts", registry.live_mounts, true);
    try writePortForwardField(io, "portForward", registry.port_forwards, true, true);
    try writeRegistryCpuField(io, "cpu", registry.cpu, true);
    try writeRegistryVmstateField(io, "vmstate", registry.vmstate, true);
    try writeBoolField(io, "nested", registry.nested, true);
    try protocol.stdout(io, "}");
}

fn writeRegistryMountDiskField(
    io: std.Io,
    comptime field: []const u8,
    mount_disk: ?boot_plan.RegistryMountDiskPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (mount_disk) |disk| {
        try protocol.stdout(io, "{\"guest\":");
        try protocol.writeJsonString(io, disk.guest);
        try protocol.stdout(io, ",\"lowerPath\":");
        try protocol.writeJsonString(io, disk.lower_path);
        try protocol.stdout(io, ",\"upperPath\":");
        try protocol.writeJsonString(io, disk.upper_path);
        try protocol.stdout(io, "}");
    } else {
        try protocol.stdout(io, "null");
    }
}

fn writeRegistryLiveMountsField(
    io: std.Io,
    comptime field: []const u8,
    mounts: []const boot_plan.RegistryLiveMountPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "[");
    for (mounts, 0..) |mount, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.stdout(io, "{\"guest\":");
        try protocol.writeJsonString(io, mount.guest);
        try protocol.stdout(io, ",\"host\":");
        try protocol.writeJsonString(io, mount.host);
        try protocol.stdout(io, ",\"mode\":");
        try protocol.writeJsonString(io, mount.mode);
        try protocol.stdout(io, "}");
    }
    try protocol.stdout(io, "]");
}

fn writePortForwardField(
    io: std.Io,
    comptime field: []const u8,
    mappings: anytype,
    null_when_empty: bool,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (mappings.len == 0 and null_when_empty) {
        try protocol.stdout(io, "null");
        return;
    }
    try protocol.stdout(io, "[");
    for (mappings, 0..) |mapping, i| {
        if (i > 0) try protocol.stdout(io, ",");
        try protocol.stdout(io, "{\"hostPort\":");
        try writeI64Bare(io, mapping.host_port);
        try protocol.stdout(io, ",\"guestPort\":");
        try writeI64Bare(io, mapping.guest_port);
        if (mapping.host_addr) |host_addr| {
            try protocol.stdout(io, ",\"hostAddr\":");
            try protocol.writeJsonString(io, host_addr);
        }
        try protocol.stdout(io, "}");
    }
    try protocol.stdout(io, "]");
}

fn writeRegistryVmstateField(
    io: std.Io,
    comptime field: []const u8,
    vmstate: boot_plan.RegistryVmstatePlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    try writeNullableStringField(io, "statePath", vmstate.state_path, false);
    try writeNullableStringField(io, "chainId", vmstate.chain_id, true);
    try writeNullableStringField(io, "checkpointParent", vmstate.checkpoint_parent, true);
    try writeNullableU64Field(io, "checkpointSequence", vmstate.checkpoint_sequence, true);
    try protocol.stdout(io, "}");
}

fn writeRegistryCpuField(
    io: std.Io,
    comptime field: []const u8,
    cpu: ?boot_plan.RegistryCpuPlan,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    if (cpu) |plan| {
        try protocol.stdout(io, "{\"maxVcpus\":");
        try writeU64Bare(io, plan.max_vcpus);
        if (plan.quota_cpus) |quota| {
            try protocol.stdout(io, ",\"quotaCpus\":");
            try writeF64Bare(io, quota);
        }
        try protocol.stdout(io, ",\"weight\":");
        try writeU64Bare(io, plan.weight);
        try protocol.stdout(io, ",\"enforcement\":{\"status\":");
        try protocol.writeJsonString(io, plan.enforcement_status);
        if (plan.enforcement_reason) |reason| {
            try protocol.stdout(io, ",\"reason\":");
            try protocol.writeJsonString(io, reason);
        }
        try protocol.stdout(io, "}}");
    } else {
        try protocol.stdout(io, "null");
    }
}

fn writeEnvObjectField(
    io: std.Io,
    comptime field: []const u8,
    pairs: []const boot_plan.EnvPair,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "{");
    for (pairs, 0..) |pair, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, pair.key);
        try protocol.stdout(io, ":");
        try protocol.writeJsonString(io, pair.value);
    }
    try protocol.stdout(io, "}");
}

fn writeStringArrayField(
    io: std.Io,
    comptime field: []const u8,
    values: []const []const u8,
    comma: bool,
) !void {
    assert(field.len > 0);

    try writeFieldName(io, field, comma);
    try protocol.stdout(io, "[");
    for (values, 0..) |value, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, value);
    }
    try protocol.stdout(io, "]");
}

fn makeGuestHostname(parsed: ParsedRequest) RequestError!boot_plan.GuestHostnameInput {
    assert(@sizeOf(ParsedRequest) > 0);

    return .{
        .pid = if (parsed.guest_hostname_pid_text) |text|
            parseSigned(text) catch return error.InvalidGuestHostnamePid
        else
            null,
        .name = parsed.guest_hostname_name,
    };
}

fn makeGuestHostnameSet(parsed: ParsedRequest) RequestError!boot_plan.GuestHostnameSetInput {
    assert(@sizeOf(ParsedRequest) > 0);

    return .{
        .pid = if (parsed.guest_hostname_set_pid_text) |text|
            parseSigned(text) catch return error.InvalidGuestHostnameSetPid
        else
            null,
        .name = parsed.guest_hostname_set_name,
        .vsock_uds_path = parsed.guest_hostname_set_vsock_uds_path,
        .skip = parsed.guest_hostname_set_skip,
    };
}

fn makeGuestEnv(allocator: std.mem.Allocator, parsed: ParsedRequest) ![]boot_plan.EnvPair {
    assert(@sizeOf(ParsedRequest) > 0);

    var pairs: std.array_list.Aligned(boot_plan.EnvPair, null) = .empty;
    errdefer pairs.deinit(allocator);
    var it = parsed.guest_env.iterator();
    while (it.next()) |entry| {
        if (entry.value_ptr.* != .string) return error.InvalidGuestEnvValue;
        try pairs.append(allocator, .{ .key = entry.key_ptr.*, .value = entry.value_ptr.string });
    }
    const env_pairs = try pairs.toOwnedSlice(allocator);
    return boot_plan.planGuestEnv(allocator, .{
        .env = env_pairs,
        .name = parsed.name,
        .vsock_uds_path = parsed.vsock_uds_path,
    });
}

fn makeConfigEnv(allocator: std.mem.Allocator, parsed: ParsedRequest) ![]boot_plan.EnvPair {
    assert(@sizeOf(ParsedRequest) > 0);

    var pairs: std.array_list.Aligned(boot_plan.EnvPair, null) = .empty;
    errdefer pairs.deinit(allocator);
    var it = parsed.config_env.iterator();
    while (it.next()) |entry| {
        if (entry.value_ptr.* != .string) return error.InvalidConfigEnvValue;
        try pairs.append(allocator, .{
            .key = entry.key_ptr.*,
            .value = entry.value_ptr.string,
        });
    }
    return pairs.toOwnedSlice(allocator);
}

fn makeBundleEnv(allocator: std.mem.Allocator, parsed: ParsedRequest) ![]boot_plan.EnvPair {
    assert(@sizeOf(ParsedRequest) > 0);

    return boot_plan.planBundleEnv(allocator, .{
        .image_env = try objectStringPairs(
            allocator,
            parsed.bundle_image_env,
            error.InvalidBundleEnvValue,
        ),
        .guest_env = try objectStringPairs(
            allocator,
            parsed.bundle_guest_env,
            error.InvalidBundleEnvValue,
        ),
    });
}

fn objectStringPairs(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    invalid: anyerror,
) ![]boot_plan.EnvPair {
    assert(@sizeOf(boot_plan.EnvPair) > 0);

    var pairs: std.array_list.Aligned(boot_plan.EnvPair, null) = .empty;
    errdefer pairs.deinit(allocator);
    var it = object.iterator();
    while (it.next()) |entry| {
        if (entry.value_ptr.* != .string) return invalid;
        try pairs.append(allocator, .{
            .key = entry.key_ptr.*,
            .value = entry.value_ptr.string,
        });
    }
    return pairs.toOwnedSlice(allocator);
}

fn makePlanInput(
    allocator: std.mem.Allocator,
    io: std.Io,
    parsed: ParsedRequest,
) anyerror!boot_plan.Input {
    assert(@sizeOf(boot_plan.Input) > 0);

    const explicit_memory = if (parsed.memory_mib_text) |text| try parseMib(text) else null;
    const resources_memory = if (parsed.resources_memory) |memory| boot_plan.ResourcesMemory{
        .max_mib = try parseMib(memory.max_mib_text),
        .reclaim = memory.reclaim,
    } else null;
    const auto_memory = if (parsed.auto_memory_mib_text) |text| try parseMib(text) else null;
    const should_probe_host = explicit_memory == null and
        resources_memory == null and
        auto_memory == null and
        !parsed.vmm_memory_preset;
    const probed_host_bytes = if (should_probe_host)
        (try runtime_helper.host.readHostMemory(allocator, io)).total_bytes
    else
        null;
    const host_total_bytes = if (parsed.host_total_bytes_text) |text|
        parseUnsigned(text) catch return error.InvalidMemory
    else
        probed_host_bytes;
    const boot_timeout_ms = try optionalUnsignedText(
        parsed.boot_timeout_ms_text,
        error.InvalidBootTimeoutMs,
    );
    return .{
        .memory_mib = explicit_memory,
        .resources_memory = resources_memory,
        .auto_memory_mib = auto_memory,
        .host_total_bytes = host_total_bytes,
        .vmm_memory_preset = parsed.vmm_memory_preset,
        .boot_timeout_ms = boot_timeout_ms,
        .boot_timeout_forever = parsed.boot_timeout_forever,
        .has_image = parsed.has_image,
        .has_cmd = parsed.has_cmd,
        .has_snapshot = parsed.has_snapshot,
        .root_disk = parsed.root_disk,
        .guest_cwd = parsed.guest_cwd,
        .mount_guest = parsed.mount_guest,
    };
}

fn parseMib(text: []const u8) boot_plan.PlanError!u64 {
    assert(@sizeOf(u64) > 0);

    const value = parseUnsigned(text) catch return error.InvalidMemory;
    return boot_plan.validateMemoryMib(value);
}

fn parseUnsigned(text: []const u8) !u64 {
    assert(@sizeOf(u64) > 0);

    if (text.len == 0) return error.Invalid;
    for (text) |c| {
        if (c < '0' or c > '9') return error.Invalid;
    }
    return std.fmt.parseUnsigned(u64, text, 10);
}

fn parseSigned(text: []const u8) !i64 {
    assert(@sizeOf(i64) > 0);

    if (text.len == 0) return error.Invalid;
    return std.fmt.parseInt(i64, text, 10);
}

fn parseFloat(text: []const u8) !f64 {
    assert(@sizeOf(f64) > 0);

    if (text.len == 0) return error.Invalid;
    return std.fmt.parseFloat(f64, text);
}

fn parseRequest(allocator: std.mem.Allocator, io: std.Io) RequestError!ParsedRequest {
    assert(protocol.version == 1);

    const data = try protocol.readStdinAll(allocator, io, protocol.max_request_bytes);
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, data, .{
        .duplicate_field_behavior = .@"error",
        .ignore_unknown_fields = false,
        .max_value_len = data.len,
        .allocate = .alloc_if_needed,
        .parse_numbers = true,
    }) catch return error.InvalidJson;
    const request_value = parsed.value;
    if (request_value != .object) return error.InvalidShape;
    const envelope = request_value.object;
    try protocol.rejectUnknownFields(envelope, &.{ "protocolVersion", "data" });
    try protocol.requireProtocolVersion(envelope);
    const data_value = envelope.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    return parseRequestObject(allocator, data_value.object);
}

fn parseRequestObject(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
) RequestError!ParsedRequest {
    assert(boot_plan_fields.len > 0);

    try protocol.rejectUnknownFields(object, &boot_plan_fields);
    var request: ParsedRequest = .{};
    try parseMemoryFields(object, &request);
    try parseBootShapeFields(object, &request);
    try parseTransportFields(allocator, object, &request);
    try parseKernelVmstateFields(allocator, object, &request);
    return request;
}

fn parseMemoryFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.memory_mib_text = try optionalString(
        object,
        "memoryMib",
        error.MissingMemoryMib,
        error.InvalidMemoryMib,
    );
    request.resources_memory = try optionalResourcesMemory(object);
    request.resources_cpu = try optionalResourcesCpu(object);
    request.auto_memory_mib_text = try optionalString(
        object,
        "autoMemoryMib",
        error.MissingAutoMemoryMib,
        error.InvalidAutoMemoryMib,
    );
    request.host_total_bytes_text = try optionalString(
        object,
        "hostTotalBytes",
        error.MissingHostTotalBytes,
        error.InvalidHostTotalBytes,
    );
    request.vmm_memory_preset = try requiredBool(
        object,
        "vmmMemoryPreset",
        error.MissingVmmMemoryPreset,
        error.InvalidVmmMemoryPreset,
    );
}

fn parseBootShapeFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.has_image = try requiredBool(
        object,
        "hasImage",
        error.MissingHasImage,
        error.InvalidHasImage,
    );
    request.has_cmd = try requiredBool(object, "hasCmd", error.MissingHasCmd, error.InvalidHasCmd);
    request.has_snapshot = try optionalBoolDefaultFalse(
        object,
        "hasSnapshot",
        error.InvalidHasSnapshot,
    );
    request.root_disk_option_false = try optionalBoolDefaultFalse(
        object,
        "rootDiskOptionFalse",
        error.InvalidRootDiskOptionFalse,
    );
    request.root_disk_option_true = try optionalBoolDefaultFalse(
        object,
        "rootDiskOptionTrue",
        error.InvalidRootDiskOptionTrue,
    );
    request.root_disk_option_path = try optionalStringDefaultNull(
        object,
        "rootDiskOptionPath",
        error.InvalidRootDiskOptionPath,
    );
    request.root_disk_restore_path = try optionalStringDefaultNull(
        object,
        "rootDiskRestorePath",
        error.InvalidRootDiskRestorePath,
    );
    const legacy_root_disk = try optionalRootDisk(object);
    const option_root_disk = boot_plan.planRootDiskMode(.{
        .false_value = request.root_disk_option_false,
        .true_value = request.root_disk_option_true,
        .path = request.root_disk_option_path,
        .restore_path = request.root_disk_restore_path,
    });
    request.root_disk = if (option_root_disk != .unset) option_root_disk else legacy_root_disk;
    request.guest_cwd = try optionalStringDefaultNull(
        object,
        "guestCwd",
        error.InvalidGuestCwd,
    );
    request.mount_guest = try optionalStringDefaultNull(
        object,
        "mountGuest",
        error.InvalidMountGuest,
    );
    request.guest_env = try optionalObjectDefaultEmpty(object, "guestEnv", error.InvalidGuestEnv);
    request.name = try optionalStringDefaultNull(object, "name", error.InvalidName);
}

fn parseTransportFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    try parseVsockFields(object, request);
    try parseVmmLaunchFields(allocator, object, request);
}

fn parseVsockFields(object: std.json.ObjectMap, request: *ParsedRequest) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.vsock_uds_path = try optionalStringDefaultNull(
        object,
        "vsockUdsPath",
        error.InvalidVsockUdsPath,
    );
    request.guest_hostname_pid_text = try optionalStringDefaultNull(
        object,
        "guestHostnamePid",
        error.InvalidGuestHostnamePid,
    );
    request.guest_hostname_name = try optionalStringDefaultNull(
        object,
        "guestHostnameName",
        error.InvalidGuestHostnameName,
    );
    request.guest_hostname_set_pid_text = try optionalStringDefaultNull(
        object,
        "guestHostnameSetPid",
        error.InvalidGuestHostnameSetPid,
    );
    request.guest_hostname_set_name = try optionalStringDefaultNull(
        object,
        "guestHostnameSetName",
        error.InvalidGuestHostnameSetName,
    );
    request.guest_hostname_set_vsock_uds_path = try optionalStringDefaultNull(
        object,
        "guestHostnameSetVsockUdsPath",
        error.InvalidGuestHostnameSetVsockUdsPath,
    );
    request.guest_hostname_set_skip = try optionalBoolDefaultFalse(
        object,
        "guestHostnameSetSkip",
        error.InvalidGuestHostnameSetSkip,
    );
    request.existing_vsock_spec = try optionalStringDefaultNull(
        object,
        "existingVsockSpec",
        error.InvalidExistingVsockSpec,
    );
    request.auto_vsock_uds_path = try optionalStringDefaultNull(
        object,
        "autoVsockUdsPath",
        error.InvalidAutoVsockUdsPath,
    );
    request.auto_vsock_temp_dir = try optionalStringDefaultNull(
        object,
        "autoVsockTempDir",
        error.InvalidAutoVsockTempDir,
    );
}

fn parseVmmLaunchFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.port_forward = try optionalPortForward(allocator, object);
    request.port_forward_net_socket = try optionalStringDefaultNull(
        object,
        "portForwardNetSocket",
        error.InvalidPortForwardNetSocket,
    );
    request.gvproxy_planning_required = try optionalBoolDefaultFalse(
        object,
        "gvproxyPlanningRequired",
        error.InvalidGvproxyPlanningRequired,
    );
    request.gvproxy_net_socket = try optionalStringDefaultNull(
        object,
        "gvproxyNetSocket",
        error.InvalidGvproxyNetSocket,
    );
    request.gvproxy_path = try optionalStringDefaultNull(
        object,
        "gvproxyPath",
        error.InvalidGvproxyPath,
    );
    request.vmm_binary = try optionalStringDefaultNull(object, "vmmBinary", error.InvalidVmmBinary);
    request.vmm_args = try optionalStringArrayDefaultEmpty(
        allocator,
        object,
        "vmmArgs",
        error.InvalidVmmArgs,
    );
    request.pdeathsig_path = try optionalStringDefaultNull(
        object,
        "pdeathsigPath",
        error.InvalidPdeathsigPath,
    );
    request.pdeathsig_requested = try optionalBoolDefaultNull(
        object,
        "pdeathsig",
        error.InvalidPdeathsig,
    );
    request.detached = try optionalBoolDefaultFalse(object, "detached", error.InvalidDetached);
    request.boot_timeout_ms_text = try optionalStringDefaultNull(
        object,
        "bootTimeoutMs",
        error.InvalidBootTimeoutMs,
    );
    request.boot_timeout_forever = try optionalBoolDefaultFalse(
        object,
        "bootTimeoutForever",
        error.InvalidBootTimeoutForever,
    );
}

fn parseKernelVmstateFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    try parseKernelFields(object, request);
    try parseVmstateFields(object, request);
    try parseRuntimeMountStatsFields(allocator, object, request);
    try parseConfigFields(allocator, object, request);
    try parseBundleFields(allocator, object, request);
    try parseProvisionFields(allocator, object, request);
    try parseDiskRuntimeFields(allocator, object, request);
}

fn parseKernelFields(object: std.json.ObjectMap, request: *ParsedRequest) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.kernel_path = try optionalStringDefaultNull(
        object,
        "kernelPath",
        error.InvalidKernelPath,
    );
    request.dtb_path = try optionalStringDefaultNull(object, "dtbPath", error.InvalidDtbPath);
    request.initrd_path = try optionalStringDefaultNull(
        object,
        "initrdPath",
        error.InvalidInitrdPath,
    );
}

fn parseVmstateFields(object: std.json.ObjectMap, request: *ParsedRequest) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.vmstate_path = try optionalStringDefaultNull(
        object,
        "vmstatePath",
        error.InvalidVmstatePath,
    );
    request.restore_path = try optionalStringDefaultNull(
        object,
        "restorePath",
        error.InvalidRestorePath,
    );
    request.enable_vmstate_timing = try optionalBoolDefaultFalse(
        object,
        "enableVmstateTiming",
        error.InvalidEnableVmstateTiming,
    );
    request.existing_vmstate_timing = try optionalStringDefaultNull(
        object,
        "existingVmstateTiming",
        error.InvalidExistingVmstateTiming,
    );
    request.boot_vmstate_state_path = try optionalStringDefaultNull(
        object,
        "bootVmstateStatePath",
        error.InvalidBootVmstateStatePath,
    );
    request.boot_vmstate_temp_dir = try optionalStringDefaultNull(
        object,
        "bootVmstateTempDir",
        error.InvalidBootVmstateTempDir,
    );
    request.boot_vmstate_chain_id = try optionalStringDefaultNull(
        object,
        "bootVmstateChainId",
        error.InvalidBootVmstateChainId,
    );
    request.boot_vmstate_restore_path = try optionalStringDefaultNull(
        object,
        "bootVmstateRestorePath",
        error.InvalidBootVmstateRestorePath,
    );
    request.boot_vmstate_forked_from = try optionalStringDefaultNull(
        object,
        "bootVmstateForkedFrom",
        error.InvalidBootVmstateForkedFrom,
    );
    request.nested_requested = try optionalBoolDefaultFalse(object, "nested", error.InvalidNested);
}

fn parseRuntimeMountStatsFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.live_mounts = try optionalLiveMounts(allocator, object);
    request.live_mounts_resolved = try optionalLiveMountsResolved(
        allocator,
        object,
        "liveMountsResolved",
        error.InvalidLiveMountsResolved,
    );
    request.batch_live_mount_validation_required = try optionalBoolDefaultFalse(
        object,
        "batchLiveMountValidationRequired",
        error.InvalidBatchLiveMountValidationRequired,
    );
    request.restore_live_mounts_recorded = try optionalRestoreLiveMountsRecorded(
        allocator,
        object,
    );
    request.restore_live_mounts_overrides = try optionalRestoreLiveMountsOverrides(
        allocator,
        object,
    );
    request.existing_stats_file = try optionalStringDefaultNull(
        object,
        "existingStatsFile",
        error.InvalidExistingStatsFile,
    );
    request.stats_file_path = try optionalStringDefaultNull(
        object,
        "statsFilePath",
        error.InvalidStatsFilePath,
    );
    request.stats_file_temp_dir = try optionalStringDefaultNull(
        object,
        "statsFileTempDir",
        error.InvalidStatsFileTempDir,
    );
}

fn parseConfigFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.config_cmd = try optionalStringArrayDefaultEmpty(
        allocator,
        object,
        "configCmd",
        error.InvalidConfigCmd,
    );
    request.config_env = try optionalObjectDefaultEmpty(
        object,
        "configEnv",
        error.InvalidConfigEnv,
    );
    request.config_guest_cwd = try optionalStringDefaultNull(
        object,
        "configGuestCwd",
        error.InvalidConfigGuestCwd,
    );
    request.config_image_cwd = try optionalStringDefaultNull(
        object,
        "configImageCwd",
        error.InvalidConfigImageCwd,
    );
    request.config_live_mounts = try optionalLiveMountsResolved(
        allocator,
        object,
        "configLiveMounts",
        error.InvalidConfigLiveMounts,
    );
}

fn parseBundleFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.bundle_explicit_cmd = try optionalStringArrayOrNull(
        allocator,
        object,
        "bundleExplicitCmd",
        error.InvalidBundleExplicitCmd,
    );
    request.bundle_image_cmd = try optionalStringArrayOrNull(
        allocator,
        object,
        "bundleImageCmd",
        error.InvalidBundleImageCmd,
    );
    request.bundle_snapshot_restore = try optionalBoolDefaultFalse(
        object,
        "bundleSnapshotRestore",
        error.InvalidBundleSnapshotRestore,
    );
    request.bundle_vmstate_restore = try optionalBoolDefaultFalse(
        object,
        "bundleVmstateRestore",
        error.InvalidBundleVmstateRestore,
    );
    request.bundle_live_mounts = try optionalLiveMountsResolved(
        allocator,
        object,
        "bundleLiveMounts",
        error.InvalidBundleLiveMounts,
    );
    request.bundle_command_required = (try optionalBoolDefaultFalse(
        object,
        "bundleCommandRequired",
        error.InvalidBundleCommandRequired,
    )) or hasBundleCommandField(object);
    request.bundle_image_env = try optionalObjectDefaultEmpty(
        object,
        "bundleImageEnv",
        error.InvalidBundleImageEnv,
    );
    request.bundle_guest_env = try optionalObjectDefaultEmpty(
        object,
        "bundleGuestEnv",
        error.InvalidBundleGuestEnv,
    );
    request.bundle_workspace_temp_dir = try optionalStringDefaultNull(
        object,
        "bundleWorkspaceTempDir",
        error.InvalidBundleWorkspaceTempDir,
    );
    request.bundle_config_synth_dir = try optionalStringDefaultNull(
        object,
        "bundleConfigSynthDir",
        error.InvalidBundleConfigSynthDir,
    );
    request.bundle_pack_use_tiny = try optionalBoolDefaultFalse(
        object,
        "bundlePackUseTiny",
        error.InvalidBundlePackUseTiny,
    );
    request.bundle_pack_mount_guest = try optionalStringDefaultNull(
        object,
        "bundlePackMountGuest",
        error.InvalidBundlePackMountGuest,
    );
    request.bundle_pack_restore_mount_guest = try optionalStringDefaultNull(
        object,
        "bundlePackRestoreMountGuest",
        error.InvalidBundlePackRestoreMountGuest,
    );
}

fn parseProvisionFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.provision_guest_cpu = try optionalProvisionGuestCpu(object);
    request.provision_guest_arch_override = try optionalStringDefaultNull(
        object,
        "provisionGuestArchOverride",
        error.InvalidProvisionGuestArchOverride,
    );
    request.provision_host_arch = try optionalStringDefaultNull(
        object,
        "provisionHostArch",
        error.InvalidProvisionHostArch,
    );
    request.provision_dtb_explicit = try optionalBoolDefaultFalse(
        object,
        "provisionDtbExplicit",
        error.InvalidProvisionDtbExplicit,
    );
    try parseProvisionBootFields(object, request);
    try parseProvisionRepackFields(object, request);
    try parseProvisionImageConfigFields(allocator, object, request);
}

fn parseProvisionBootFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.provision_base_path = try optionalStringDefaultNull(
        object,
        "provisionBasePath",
        error.InvalidProvisionBasePath,
    );
    request.provision_kernel_path = try optionalStringDefaultNull(
        object,
        "provisionKernelPath",
        error.InvalidProvisionKernelPath,
    );
    request.provision_dtb_path = try optionalStringDefaultNull(
        object,
        "provisionDtbPath",
        error.InvalidProvisionDtbPath,
    );
    request.provision_uds_path = try optionalStringDefaultNull(
        object,
        "provisionUdsPath",
        error.InvalidProvisionUdsPath,
    );
    request.provision_scratch_disk_path = try optionalStringDefaultNull(
        object,
        "provisionScratchDiskPath",
        error.InvalidProvisionScratchDiskPath,
    );
    request.provision_root_disk_path = try optionalStringDefaultNull(
        object,
        "provisionRootDiskPath",
        error.InvalidProvisionRootDiskPath,
    );
}

fn parseProvisionRepackFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.provision_repack_disk_path = try optionalStringDefaultNull(
        object,
        "provisionRepackDiskPath",
        error.InvalidProvisionRepackDiskPath,
    );
    request.provision_repack_out_path = try optionalStringDefaultNull(
        object,
        "provisionRepackOutPath",
        error.InvalidProvisionRepackOutPath,
    );
    request.provision_repack_extract_dir = try optionalStringDefaultNull(
        object,
        "provisionRepackExtractDir",
        error.InvalidProvisionRepackExtractDir,
    );
    request.provision_work_dir = try optionalStringDefaultNull(
        object,
        "provisionWorkDir",
        error.InvalidProvisionWorkDir,
    );
    request.provision_scratch_size_bytes_text = try optionalStringDefaultNull(
        object,
        "provisionScratchSizeBytes",
        error.InvalidProvisionScratchSizeBytes,
    );
    request.provision_timeout_ms_text = try optionalStringDefaultNull(
        object,
        "provisionTimeoutMs",
        error.InvalidProvisionTimeoutMs,
    );
}

fn parseProvisionImageConfigFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.provision_image_config_has_cmd = try optionalBoolDefaultFalse(
        object,
        "provisionImageConfigHasCmd",
        error.InvalidProvisionImageConfigHasCmd,
    );
    request.provision_image_config_cmd = try optionalStringArrayDefaultEmpty(
        allocator,
        object,
        "provisionImageConfigCmd",
        error.InvalidProvisionImageConfigCmd,
    );
    request.provision_image_config_has_env = try optionalBoolDefaultFalse(
        object,
        "provisionImageConfigHasEnv",
        error.InvalidProvisionImageConfigHasEnv,
    );
    request.provision_image_config_env = try optionalObjectDefaultEmpty(
        object,
        "provisionImageConfigEnv",
        error.InvalidProvisionImageConfigEnv,
    );
}

fn parseDiskRuntimeFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    try parseScratchFields(object, request);
    try parseRootDiskRuntimeFields(object, request);
    try parseMountDiskRuntimeFields(allocator, object, request);
}

fn parseScratchFields(object: std.json.ObjectMap, request: *ParsedRequest) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.scratch_option_false = try optionalBoolDefaultFalse(
        object,
        "scratchOptionFalse",
        error.InvalidScratchOptionFalse,
    );
    request.scratch_option_path = try optionalStringDefaultNull(
        object,
        "scratchOptionPath",
        error.InvalidScratchOptionPath,
    );
    request.scratch_mode = try optionalScratchMode(object);
    request.scratch_snapshot_path = try optionalStringDefaultNull(
        object,
        "scratchSnapshotPath",
        error.InvalidScratchSnapshotPath,
    );
    request.scratch_restore_clone_path = try optionalStringDefaultNull(
        object,
        "scratchRestoreClonePath",
        error.InvalidScratchRestoreClonePath,
    );
    request.scratch_auto_path = try optionalStringDefaultNull(
        object,
        "scratchAutoPath",
        error.InvalidScratchAutoPath,
    );
}

fn parseRootDiskRuntimeFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.root_disk_runtime_mode = try optionalRootDiskRuntimeMode(object);
    request.root_disk_source_path = try optionalStringDefaultNull(
        object,
        "rootDiskSourcePath",
        error.InvalidRootDiskSourcePath,
    );
    request.root_disk_clone_path = try optionalStringDefaultNull(
        object,
        "rootDiskClonePath",
        error.InvalidRootDiskClonePath,
    );
}

fn parseMountDiskRuntimeFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.mount_disk_runtime_mode = try optionalMountDiskRuntimeMode(object);
    request.mount_disk_lower_path = try optionalStringDefaultNull(
        object,
        "mountDiskLowerPath",
        error.InvalidMountDiskLowerPath,
    );
    request.mount_disk_upper_path = try optionalStringDefaultNull(
        object,
        "mountDiskUpperPath",
        error.InvalidMountDiskUpperPath,
    );
    request.mount_disk_source_upper_path = try optionalStringDefaultNull(
        object,
        "mountDiskSourceUpperPath",
        error.InvalidMountDiskSourceUpperPath,
    );
    request.mount_disk_guest = try optionalStringDefaultNull(
        object,
        "mountDiskGuest",
        error.InvalidMountDiskGuest,
    );
    request.mount_disk_upper_size_text = try optionalStringDefaultNull(
        object,
        "mountDiskUpperSize",
        error.InvalidMountDiskUpperSize,
    );
    request.mount_disk_lower_fd_text = try optionalStringDefaultNull(
        object,
        "mountDiskLowerFd",
        error.InvalidMountDiskLowerFd,
    );
    request.mount_disk_upper_fd_text = try optionalStringDefaultNull(
        object,
        "mountDiskUpperFd",
        error.InvalidMountDiskUpperFd,
    );
    try parseSnapshotContextFields(allocator, object, request);
    try parseRegistryShapeFields(object, request);
}

fn parseSnapshotContextFields(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.snapshot_mount_guest = try optionalStringDefaultNull(
        object,
        "snapshotMountGuest",
        error.InvalidSnapshotMountGuest,
    );
    request.snapshot_mount_lower_path = try optionalStringDefaultNull(
        object,
        "snapshotMountLowerPath",
        error.InvalidSnapshotMountLowerPath,
    );
    request.snapshot_mount_upper_path = try optionalStringDefaultNull(
        object,
        "snapshotMountUpperPath",
        error.InvalidSnapshotMountUpperPath,
    );
    request.snapshot_live_mounts = try optionalLiveMountsResolved(
        allocator,
        object,
        "snapshotLiveMounts",
        error.InvalidSnapshotLiveMounts,
    );
    request.snapshot_vmstate_path = try optionalStringDefaultNull(
        object,
        "snapshotVmstatePath",
        error.InvalidSnapshotVmstatePath,
    );
    request.snapshot_vmstate_chain_id = try optionalStringDefaultNull(
        object,
        "snapshotVmstateChainId",
        error.InvalidSnapshotVmstateChainId,
    );
    request.snapshot_vmstate_checkpoint_parent = try optionalStringDefaultNull(
        object,
        "snapshotVmstateCheckpointParent",
        error.InvalidSnapshotVmstateCheckpointParent,
    );
    request.snapshot_vmstate_checkpoint_sequence_text = try optionalStringDefaultNull(
        object,
        "snapshotVmstateCheckpointSequence",
        error.InvalidSnapshotVmstateCheckpointSequence,
    );
}

fn parseRegistryShapeFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    try parseRegistryRootDiskFields(object, request);
    try parseRegistryCleanupFields(object, request);
    try parseRegistryMountDiskFields(object, request);
}

fn parseRegistryRootDiskFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.registry_source_image_path = try optionalStringDefaultNull(
        object,
        "registrySourceImagePath",
        error.InvalidRegistrySourceImagePath,
    );
    request.registry_per_boot_root_disk = try optionalStringDefaultNull(
        object,
        "registryPerBootRootDisk",
        error.InvalidRegistryRootDiskPath,
    );
    request.registry_caller_root_disk_path = try optionalStringDefaultNull(
        object,
        "registryCallerRootDiskPath",
        error.InvalidRegistryRootDiskPath,
    );
    request.registry_disk_path = try optionalStringDefaultNull(
        object,
        "registryDiskPath",
        error.InvalidRegistryDiskPath,
    );
    request.registry_forked_from = try optionalStringDefaultNull(
        object,
        "registryForkedFrom",
        error.InvalidRegistryForkedFrom,
    );
    request.registry_memory_ceiling_mib_text = try optionalStringDefaultNull(
        object,
        "registryMemoryCeilingMib",
        error.InvalidRegistryMemoryCeilingMib,
    );
    request.registry_stats_path = try optionalStringDefaultNull(
        object,
        "registryStatsPath",
        error.InvalidRegistryStatsPath,
    );
    request.registry_boot_log_root = try optionalStringDefaultNull(
        object,
        "registryBootLogRoot",
        error.InvalidRegistryBootLogRoot,
    );
    request.registry_child_pid_text = try optionalStringDefaultNull(
        object,
        "registryChildPid",
        error.InvalidRegistryChildPid,
    );
    request.registry_detached = try optionalBoolDefaultFalse(
        object,
        "registryDetached",
        error.InvalidRegistryDetached,
    );
}

fn parseRegistryCleanupFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    try parseRegistryCleanupPathFields(object, request);
    try parseRegistryCpuFields(object, request);
    try parseRegistryVmstateFields(object, request);
}

fn parseRegistryCleanupPathFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.registry_per_boot_snap_disk = try optionalStringDefaultNull(
        object,
        "registryPerBootSnapDisk",
        error.InvalidRegistryCleanupPath,
    );
    request.registry_per_boot_mount_upper = try optionalStringDefaultNull(
        object,
        "registryPerBootMountUpper",
        error.InvalidRegistryCleanupPath,
    );
    request.registry_bundle_temp_dir = try optionalStringDefaultNull(
        object,
        "registryBundleTempDir",
        error.InvalidRegistryCleanupPath,
    );
    request.registry_vsock_temp_dir = try optionalStringDefaultNull(
        object,
        "registryVsockTempDir",
        error.InvalidRegistryCleanupPath,
    );
    request.registry_stats_temp_dir = try optionalStringDefaultNull(
        object,
        "registryStatsTempDir",
        error.InvalidRegistryCleanupPath,
    );
    request.registry_gv_socket_dir = try optionalStringDefaultNull(
        object,
        "registryGvSocketDir",
        error.InvalidRegistryCleanupPath,
    );
    request.registry_cpu_cgroup_path = try optionalStringDefaultNull(
        object,
        "registryCpuCgroupPath",
        error.InvalidRegistryCleanupPath,
    );
}

fn parseRegistryCpuFields(object: std.json.ObjectMap, request: *ParsedRequest) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.registry_cpu_policy_max_vcpus_text = try optionalStringDefaultNull(
        object,
        "registryCpuPolicyMaxVcpus",
        error.InvalidRegistryCpuPolicy,
    );
    request.registry_cpu_policy_quota_cpus_text = try optionalStringDefaultNull(
        object,
        "registryCpuPolicyQuotaCpus",
        error.InvalidRegistryCpuPolicy,
    );
    request.registry_cpu_policy_weight_text = try optionalStringDefaultNull(
        object,
        "registryCpuPolicyWeight",
        error.InvalidRegistryCpuPolicy,
    );
    request.registry_cpu_control_status = try optionalRegistryCpuControlStatus(object);
    request.registry_cpu_control_reason = try optionalStringDefaultNull(
        object,
        "registryCpuControlReason",
        error.InvalidRegistryCpuControlReason,
    );
}

fn parseRegistryVmstateFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.registry_vmstate_path = try optionalStringDefaultNull(
        object,
        "registryVmstatePath",
        error.InvalidRegistryVmstatePath,
    );
    request.registry_vmstate_chain_id = try optionalStringDefaultNull(
        object,
        "registryVmstateChainId",
        error.InvalidRegistryVmstateChainId,
    );
    request.registry_vmstate_checkpoint_parent = try optionalStringDefaultNull(
        object,
        "registryVmstateCheckpointParent",
        error.InvalidRegistryVmstateCheckpointParent,
    );
    request.registry_vmstate_checkpoint_sequence_text = try optionalStringDefaultNull(
        object,
        "registryVmstateCheckpointSequence",
        error.InvalidRegistryVmstateCheckpointSequence,
    );
    request.registry_nested = try optionalBoolDefaultFalse(
        object,
        "registryNested",
        error.InvalidRegistryNested,
    );
    request.registry_host_platform = try optionalStringDefaultNull(
        object,
        "registryHostPlatform",
        error.InvalidRegistryHostPlatform,
    );
    request.registry_vmm_binary = try optionalStringDefaultNull(
        object,
        "registryVmmBinary",
        error.InvalidRegistryVmmBinary,
    );
    request.registry_vmm_pdeathsig = try optionalBoolDefaultFalse(
        object,
        "registryVmmPdeathsig",
        error.InvalidRegistryVmmPdeathsig,
    );
    request.registry_vmm_observed_exe_base = try optionalStringDefaultNull(
        object,
        "registryVmmObservedExeBase",
        error.InvalidRegistryVmmObservedExeBase,
    );
    request.registry_gv_pid_text = try optionalStringDefaultNull(
        object,
        "registryGvPid",
        error.InvalidRegistryGvPid,
    );
    request.registry_gv_exe = try optionalStringDefaultNull(
        object,
        "registryGvExe",
        error.InvalidRegistryGvExe,
    );
    request.registry_gv_observed_exe_base = try optionalStringDefaultNull(
        object,
        "registryGvObservedExeBase",
        error.InvalidRegistryGvObservedExeBase,
    );
}

fn parseRegistryMountDiskFields(
    object: std.json.ObjectMap,
    request: *ParsedRequest,
) RequestError!void {
    assert(@sizeOf(ParsedRequest) > 0);

    request.registry_mount_guest = try optionalStringDefaultNull(
        object,
        "registryMountGuest",
        error.InvalidRegistryMountGuest,
    );
    request.registry_mount_lower_path = try optionalStringDefaultNull(
        object,
        "registryMountLowerPath",
        error.InvalidRegistryMountLowerPath,
    );
    request.registry_mount_upper_path = try optionalStringDefaultNull(
        object,
        "registryMountUpperPath",
        error.InvalidRegistryMountUpperPath,
    );
}

fn hasBundleCommandField(object: std.json.ObjectMap) bool {
    assert(@sizeOf(std.json.ObjectMap) > 0);

    if (object.get("bundleExplicitCmd")) |value| {
        if (value != .null) return true;
    }
    if (object.get("bundleImageCmd")) |value| {
        if (value != .null) return true;
    }
    if (object.get("bundleSnapshotRestore")) |value| {
        if (value == .bool and value.bool) return true;
    }
    if (object.get("bundleVmstateRestore")) |value| {
        if (value == .bool and value.bool) return true;
    }
    return false;
}

fn optionalRegistryCpuControlStatus(object: std.json.ObjectMap) RequestError!?[]const u8 {
    assert(@sizeOf(std.json.ObjectMap) > 0);

    const value = object.get("registryCpuControlStatus") orelse return null;
    if (value == .null) return null;
    if (value != .string) return error.InvalidRegistryCpuControlStatus;
    if (std.mem.eql(u8, value.string, "none")) return value.string;
    if (std.mem.eql(u8, value.string, "linux-cgroup-v2")) return value.string;
    if (std.mem.eql(u8, value.string, "unsupported")) return value.string;
    return error.InvalidRegistryCpuControlStatus;
}

fn optionalProvisionGuestCpu(
    object: std.json.ObjectMap,
) RequestError!?boot_plan.ProvisionGuestCpu {
    assert(@sizeOf(boot_plan.ProvisionGuestCpu) > 0);

    const value = object.get("provisionGuestCpu") orelse return null;
    if (value == .null) return null;
    if (value != .string) return error.InvalidProvisionGuestCpu;
    if (std.mem.eql(u8, value.string, "amd64")) return .amd64;
    if (std.mem.eql(u8, value.string, "arm64")) return .arm64;
    return error.InvalidProvisionGuestCpu;
}

fn optionalScratchMode(object: std.json.ObjectMap) RequestError!boot_plan.ScratchDiskMode {
    assert(@sizeOf(boot_plan.ScratchDiskMode) > 0);

    const value = object.get("scratchMode") orelse return .unset;
    if (value == .null) return .unset;
    if (value != .string) return error.InvalidScratchMode;
    if (std.mem.eql(u8, value.string, "false")) return .false_value;
    if (std.mem.eql(u8, value.string, "path")) return .path;
    if (std.mem.eql(u8, value.string, "auto")) return .auto;
    return error.InvalidScratchMode;
}

fn optionalRootDiskRuntimeMode(
    object: std.json.ObjectMap,
) RequestError!boot_plan.RootDiskRuntimeMode {
    assert(@sizeOf(boot_plan.RootDiskRuntimeMode) > 0);

    const value = object.get("rootDiskRuntimeMode") orelse return .none;
    if (value == .null) return .none;
    if (value != .string) return error.InvalidRootDiskRuntimeMode;
    if (std.mem.eql(u8, value.string, "none")) return .none;
    if (std.mem.eql(u8, value.string, "path")) return .path;
    if (std.mem.eql(u8, value.string, "restore")) return .restore;
    if (std.mem.eql(u8, value.string, "cached")) return .cached;
    return error.InvalidRootDiskRuntimeMode;
}

fn optionalMountDiskRuntimeMode(
    object: std.json.ObjectMap,
) RequestError!boot_plan.MountDiskRuntimeMode {
    assert(@sizeOf(boot_plan.MountDiskRuntimeMode) > 0);

    const value = object.get("mountDiskRuntimeMode") orelse return .none;
    if (value == .null) return .none;
    if (value != .string) return error.InvalidMountDiskRuntimeMode;
    if (std.mem.eql(u8, value.string, "none")) return .none;
    if (std.mem.eql(u8, value.string, "restore")) return .restore;
    if (std.mem.eql(u8, value.string, "fresh")) return .fresh;
    return error.InvalidMountDiskRuntimeMode;
}

fn optionalLiveMounts(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
) RequestError![]const boot_plan.LiveMountInput {
    assert(@sizeOf(boot_plan.LiveMountInput) > 0);

    const value = object.get("liveMounts") orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return error.InvalidLiveMounts;
    var mounts: std.array_list.Aligned(boot_plan.LiveMountInput, null) = .empty;
    errdefer mounts.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .object) return error.InvalidLiveMounts;
        try protocol.rejectUnknownFields(item.object, &.{ "host", "guest", "mode" });
        const host = item.object.get("host") orelse return error.InvalidLiveMountHost;
        const guest = item.object.get("guest") orelse return error.InvalidLiveMountGuest;
        const mode = item.object.get("mode") orelse .null;
        if (host != .string) return error.InvalidLiveMountHost;
        if (guest != .string) return error.InvalidLiveMountGuest;
        if (mode != .null and mode != .string) return error.InvalidLiveMountMode;
        try mounts.append(allocator, .{
            .host = host.string,
            .guest = guest.string,
            .mode = if (mode == .string) mode.string else null,
        });
    }
    return mounts.toOwnedSlice(allocator);
}

fn optionalLiveMountsResolved(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    comptime field: []const u8,
    invalid: RequestError,
) RequestError![]const boot_plan.LiveMount {
    assert(@sizeOf(boot_plan.LiveMount) > 0);

    const value = object.get(field) orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return invalid;
    var mounts: std.array_list.Aligned(boot_plan.LiveMount, null) = .empty;
    errdefer mounts.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .object) return invalid;
        try protocol.rejectUnknownFields(item.object, &.{ "host", "guest", "mode", "tag" });
        const host = item.object.get("host") orelse return error.InvalidLiveMountHost;
        const guest = item.object.get("guest") orelse return error.InvalidLiveMountGuest;
        const mode = item.object.get("mode") orelse return error.InvalidLiveMountMode;
        const tag = item.object.get("tag") orelse return error.InvalidLiveMountTag;
        if (host != .string) return error.InvalidLiveMountHost;
        if (guest != .string) return error.InvalidLiveMountGuest;
        if (mode != .string) return error.InvalidLiveMountMode;
        if (!std.mem.eql(u8, mode.string, "ro") and
            !std.mem.eql(u8, mode.string, "rw"))
        {
            return error.InvalidLiveMountMode;
        }
        if (tag != .string) return error.InvalidLiveMountTag;
        try mounts.append(allocator, .{
            .host = host.string,
            .guest = guest.string,
            .mode = mode.string,
            .tag = tag.string,
        });
    }
    return mounts.toOwnedSlice(allocator);
}

fn optionalRestoreLiveMountsRecorded(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
) RequestError![]const boot_plan.RestoreRecordedLiveMount {
    assert(@sizeOf(boot_plan.RestoreRecordedLiveMount) > 0);

    const value = object.get("restoreLiveMountsRecorded") orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return error.InvalidRestoreLiveMountsRecorded;
    var mounts: std.array_list.Aligned(boot_plan.RestoreRecordedLiveMount, null) = .empty;
    errdefer mounts.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .object) return error.InvalidRestoreLiveMountsRecorded;
        try protocol.rejectUnknownFields(
            item.object,
            &.{ "host", "guest", "mode", "sync", "cache" },
        );
        const host = item.object.get("host") orelse return error.InvalidRestoreLiveMountsRecorded;
        const guest = item.object.get("guest") orelse return error.InvalidRestoreLiveMountsRecorded;
        const mode = item.object.get("mode") orelse return error.InvalidRestoreLiveMountsRecorded;
        if (host != .string or guest != .string or mode != .string) {
            return error.InvalidRestoreLiveMountsRecorded;
        }
        if (!isLiveMountMode(mode.string)) return error.InvalidRestoreLiveMountsRecorded;
        try mounts.append(allocator, .{
            .host = host.string,
            .guest = guest.string,
            .mode = mode.string,
        });
    }
    return mounts.toOwnedSlice(allocator);
}

fn optionalRestoreLiveMountsOverrides(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
) RequestError![]const boot_plan.RestoreLiveMountInput {
    assert(@sizeOf(boot_plan.RestoreLiveMountInput) > 0);

    const value = object.get("restoreLiveMountsOverrides") orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return error.InvalidRestoreLiveMountsOverrides;
    var mounts: std.array_list.Aligned(boot_plan.RestoreLiveMountInput, null) = .empty;
    errdefer mounts.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .object) return error.InvalidRestoreLiveMountsOverrides;
        try protocol.rejectUnknownFields(item.object, &.{ "host", "guest", "mode" });
        const host = item.object.get("host") orelse return error.InvalidRestoreLiveMountsOverrides;
        const guest = item.object.get("guest") orelse {
            return error.InvalidRestoreLiveMountsOverrides;
        };
        const mode = item.object.get("mode") orelse .null;
        if (host != .string or guest != .string) return error.InvalidRestoreLiveMountsOverrides;
        if (mode != .null and (mode != .string or !isLiveMountMode(mode.string))) {
            return error.InvalidRestoreLiveMountsOverrides;
        }
        try mounts.append(allocator, .{
            .host = host.string,
            .guest = guest.string,
            .mode = if (mode == .string) mode.string else null,
        });
    }
    return mounts.toOwnedSlice(allocator);
}

fn isLiveMountMode(mode: []const u8) bool {
    assert(mode.len > 0);

    return std.mem.eql(u8, mode, "ro") or std.mem.eql(u8, mode, "rw");
}

fn optionalBoolDefaultNull(
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!?bool {
    assert(field.len > 0);

    const value = object.get(field) orelse return null;
    return switch (value) {
        .null => null,
        .bool => |b| b,
        else => invalid,
    };
}

fn optionalBoolDefaultFalse(
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!bool {
    assert(field.len > 0);

    const value = object.get(field) orelse return false;
    return switch (value) {
        .bool => |b| b,
        else => invalid,
    };
}

fn optionalStringArrayDefaultEmpty(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError![]const []const u8 {
    const value = object.get(field) orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return invalid;
    assert(field.len > 0);

    var out: std.array_list.Aligned([]const u8, null) = .empty;
    errdefer out.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .string) return invalid;
        try out.append(allocator, item.string);
    }
    return out.toOwnedSlice(allocator);
}

fn optionalStringArrayOrNull(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!?[]const []const u8 {
    assert(field.len > 0);

    const value = object.get(field) orelse return null;
    if (value == .null) return null;
    if (value != .array) return invalid;
    var out: std.array_list.Aligned([]const u8, null) = .empty;
    errdefer out.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .string) return invalid;
        try out.append(allocator, item.string);
    }
    const owned: []const []const u8 = try out.toOwnedSlice(allocator);
    return owned;
}

fn optionalPortForward(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
) RequestError![]const boot_plan.PortForwardMapping {
    assert(@sizeOf(boot_plan.PortForwardMapping) > 0);

    const value = object.get("portForward") orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return error.InvalidPortForward;
    var mappings: std.array_list.Aligned(boot_plan.PortForwardMapping, null) = .empty;
    errdefer mappings.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .object) return error.InvalidPortForward;
        try protocol.rejectUnknownFields(item.object, &.{ "hostPort", "guestPort", "hostAddr" });
        const host_port = try requiredPort(item.object, "hostPort", error.InvalidHostPort);
        const guest_port = try requiredPort(item.object, "guestPort", error.InvalidGuestPort);
        const host_addr = item.object.get("hostAddr") orelse .null;
        if (host_addr != .null and host_addr != .string) return error.InvalidPortForward;
        try mappings.append(allocator, .{
            .host_port = host_port,
            .guest_port = guest_port,
            .host_addr = if (host_addr == .string) host_addr.string else null,
        });
    }
    return mappings.toOwnedSlice(allocator);
}

fn requiredPort(
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!i64 {
    assert(field.len > 0);

    const value = object.get(field) orelse return invalid;
    return switch (value) {
        .integer => |i| i,
        else => invalid,
    };
}

fn optionalString(
    object: std.json.ObjectMap,
    field: []const u8,
    missing: RequestError,
    invalid: RequestError,
) RequestError!?[]const u8 {
    assert(field.len > 0);

    const value = object.get(field) orelse return missing;
    return switch (value) {
        .null => null,
        .string => |s| s,
        else => invalid,
    };
}

fn optionalObjectDefaultEmpty(
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!std.json.ObjectMap {
    assert(field.len > 0);

    const value = object.get(field) orelse return .{};
    return switch (value) {
        .object => |o| o,
        else => invalid,
    };
}

fn optionalStringDefaultNull(
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!?[]const u8 {
    assert(field.len > 0);

    const value = object.get(field) orelse return null;
    return switch (value) {
        .null => null,
        .string => |s| s,
        else => invalid,
    };
}

fn requiredBool(
    object: std.json.ObjectMap,
    field: []const u8,
    missing: RequestError,
    invalid: RequestError,
) RequestError!bool {
    assert(field.len > 0);

    const value = object.get(field) orelse return missing;
    return switch (value) {
        .bool => |b| b,
        else => invalid,
    };
}

fn optionalResourcesCpu(object: std.json.ObjectMap) RequestError!?ParsedResourcesCpu {
    assert(@sizeOf(ParsedResourcesCpu) > 0);

    const value = object.get("resourcesCpu") orelse return null;
    if (value == .null) return null;
    if (value != .object) return error.InvalidResourcesCpu;
    try protocol.rejectUnknownFields(value.object, &.{ "maxVcpus", "quotaCpus", "weight" });
    return .{
        .max_vcpus_text = try optionalStringDefaultNull(
            value.object,
            "maxVcpus",
            error.InvalidResourcesCpuMaxVcpus,
        ),
        .quota_cpus_text = try optionalStringDefaultNull(
            value.object,
            "quotaCpus",
            error.InvalidResourcesCpuQuotaCpus,
        ),
        .weight_text = try optionalStringDefaultNull(
            value.object,
            "weight",
            error.InvalidResourcesCpuWeight,
        ),
    };
}

fn optionalResourcesMemory(object: std.json.ObjectMap) RequestError!?ParsedResourcesMemory {
    assert(@sizeOf(ParsedResourcesMemory) > 0);

    const value = object.get("resourcesMemory") orelse return error.MissingResourcesMemory;
    if (value == .null) return null;
    if (value != .object) return error.InvalidResourcesMemory;
    try protocol.rejectUnknownFields(value.object, &.{ "maxMib", "reclaim" });
    const max_mib = value.object.get("maxMib") orelse return error.MissingResourcesMaxMib;
    if (max_mib != .string) return error.InvalidResourcesMaxMib;
    const reclaim = value.object.get("reclaim") orelse .null;
    if (reclaim != .null and reclaim != .string) return error.InvalidResourcesReclaim;
    return .{
        .max_mib_text = max_mib.string,
        .reclaim = if (reclaim == .string) reclaim.string else null,
    };
}

fn optionalRootDisk(object: std.json.ObjectMap) RequestError!boot_plan.RootDiskMode {
    assert(@sizeOf(boot_plan.RootDiskMode) > 0);

    const value = object.get("rootDisk") orelse return .unset;
    if (value != .string) return error.InvalidRootDisk;
    if (std.mem.eql(u8, value.string, "unset")) return .unset;
    if (std.mem.eql(u8, value.string, "false")) return .false_value;
    if (std.mem.eql(u8, value.string, "path")) return .path;
    if (std.mem.eql(u8, value.string, "true")) return .true_value;
    return error.InvalidRootDisk;
}

fn writePortForwardInvalid(io: std.Io, label: []const u8, port: i64) !void {
    assert(label.len > 0);

    var buf: [256]u8 = undefined;
    try protocol.writeError(
        io,
        "BOOT_PORT_FORWARD_INVALID",
        try std.fmt.bufPrint(
            &buf,
            "portForward: {s} must be an integer in 1..65535 (got {d})",
            .{ label, port },
        ),
    );
}

fn writeDuplicateHostPort(io: std.Io, port: u16) !void {
    assert(port > 0);

    var buf: [128]u8 = undefined;
    try protocol.writeError(
        io,
        "BOOT_PORT_FORWARD_CONFLICT",
        try std.fmt.bufPrint(&buf, "portForward: duplicate hostPort {d}", .{port}),
    );
}

fn writeRestoreLiveMountOverrideError(
    arena: std.mem.Allocator,
    io: std.Io,
    parsed: ParsedRequest,
) !void {
    assert(parsed.restore_live_mounts_overrides.len > 0);

    const plan = try boot_plan.planRestoreLiveMounts(arena, .{
        .recorded = parsed.restore_live_mounts_recorded,
        .overrides = parsed.restore_live_mounts_overrides,
    });
    const guest = plan.unknown_guest orelse "<unknown>";
    const recorded = if (parsed.restore_live_mounts_recorded.len > 0)
        parsed.restore_live_mounts_recorded[0].guest
    else
        "<none>";
    var buf: [512]u8 = undefined;
    try protocol.writeError(
        io,
        "BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN",
        try std.fmt.bufPrint(
            &buf,
            "restore: liveMounts override guest={s} has no recorded mount; recorded includes {s}",
            .{ guest, recorded },
        ),
    );
}

fn writePlanError(io: std.Io, err: anyerror) !void {
    assert(@errorName(err).len > 0);

    if (try writeMemoryPlanError(io, err)) return;
    if (try writeCpuPlanError(io, err)) return;
    if (try writePathPlanError(io, err)) return;
    if (try writeEnvPlanError(io, err)) return;
    if (try writeDiskPlanError(io, err)) return;
    try writeBootError(io, "BOOT_MEMORY_INVALID", @errorName(err));
}

fn writeMemoryPlanError(io: std.Io, err: anyerror) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.InvalidMemory => try writeBootError(
            io,
            "BOOT_MEMORY_INVALID",
            "boot: memory must be a positive integer at least 512 MiB",
        ),
        error.ConflictingMemory => try writeBootError(
            io,
            "BOOT_MEMORY_INVALID",
            "boot: memory conflicts with resources.memory.maxMib. Use one value.",
        ),
        error.InvalidReclaim => try writeBootError(
            io,
            "BOOT_MEMORY_INVALID",
            "boot: resources.memory.reclaim must be \"auto\" when set.",
        ),
        error.MissingAutoMemory => try writeBootError(
            io,
            "BOOT_MEMORY_INVALID",
            "boot: memory auto-size input is missing",
        ),
        error.UnsupportedHostMemory => try writeBootError(
            io,
            "BOOT_MEMORY_INVALID",
            "boot: host memory probing is unsupported on this platform",
        ),
        else => return false,
    }
    return true;
}

fn writeCpuPlanError(io: std.Io, err: anyerror) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.InvalidCpuMaxVcpus,
        error.InvalidResourcesCpuMaxVcpus,
        => try writeBootError(
            io,
            "BOOT_CPU_INVALID",
            "boot: resources.cpu.maxVcpus must be a positive integer",
        ),
        error.UnsupportedCpuMaxVcpus => try writeBootError(
            io,
            "BOOT_CPU_INVALID",
            "boot: resources.cpu.maxVcpus greater than 1 is not supported yet. " ++
                "CPU quota is scheduling budget, not extra guest-visible CPUs.",
        ),
        error.InvalidCpuQuotaCpus,
        error.InvalidResourcesCpuQuotaCpus,
        => try writeBootError(
            io,
            "BOOT_CPU_INVALID",
            "boot: resources.cpu.quotaCpus must be > 0 when set",
        ),
        error.CpuQuotaExceedsMaxVcpus => try writeBootError(
            io,
            "BOOT_CPU_INVALID",
            "boot: resources.cpu.quotaCpus cannot exceed resources.cpu.maxVcpus",
        ),
        error.InvalidCpuWeight,
        error.InvalidResourcesCpuWeight,
        => try writeBootError(
            io,
            "BOOT_CPU_INVALID",
            "boot: resources.cpu.weight must be an integer in 1..10000",
        ),
        else => return false,
    }
    return true;
}

fn writePathPlanError(io: std.Io, err: anyerror) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.CmdWithoutImage => try writeBootError(
            io,
            "BOOT_CMD_WITHOUT_IMAGE",
            "boot: `image` is required when `cmd` is set.",
        ),
        error.RootDiskWithoutImage => try writeBootError(
            io,
            "BOOT_CMD_WITHOUT_IMAGE",
            "boot: rootDisk: true requires an `image` (the .tar.gz to materialize).",
        ),
        error.InvalidGuestCwdAbsolute => try writeBootError(
            io,
            "BOOT_CWD_INVALID",
            "guestCwd must be an absolute path",
        ),
        error.InvalidGuestCwdNul => try writeBootError(
            io,
            "BOOT_CWD_INVALID",
            "guestCwd must not contain NUL bytes",
        ),
        error.InvalidMountGuestAbsolute => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "mount guest path must be absolute",
        ),
        error.InvalidMountGuestRoot => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "mount guest path must live under /mnt/",
        ),
        else => return false,
    }
    return true;
}

fn writeEnvPlanError(io: std.Io, err: anyerror) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.TooManyLiveMounts => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "liveMounts: at most 5 live mounts are supported per VM",
        ),
        error.InvalidLiveMountMode => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "liveMounts: mode must be ro or rw",
        ),
        error.MissingBatchLiveMountVsock => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "liveMounts: writable mounts require the exec vsock bridge for batched sync",
        ),
        error.MissingGvproxy => try writeBootError(
            io,
            "BOOT_PORT_FORWARD_NO_GVPROXY",
            "portForward requires gvproxy, but no gvproxy binary was found",
        ),
        error.MissingSnapshotMountDiskField => try writeBootError(
            io,
            "INVALID_REQUEST",
            "boot-plan snapshot mountDisk fields are incomplete",
        ),
        error.MissingSnapshotVmstateField => try writeBootError(
            io,
            "INVALID_REQUEST",
            "boot-plan snapshot vmstate fields are incomplete",
        ),
        error.InvalidGuestEnvValue => try writeBootError(
            io,
            "INVALID_REQUEST",
            "boot-plan guestEnv values must be strings",
        ),
        error.InvalidConfigEnvValue => try writeBootError(
            io,
            "INVALID_REQUEST",
            "boot-plan configEnv values must be strings",
        ),
        error.InvalidBundleEnvValue => try writeBootError(
            io,
            "INVALID_REQUEST",
            "boot-plan bundle env values must be strings",
        ),
        else => return false,
    }
    return true;
}

fn writeDiskPlanError(io: std.Io, err: anyerror) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.MissingBundleCommand => try writeBootError(
            io,
            "BOOT_CMD_MISSING",
            "boot: no cmd to run — pass `cmd` on boot() or bake one into the " ++
                "image via `provision({ cmd })`.",
        ),
        error.MissingScratchPath => try writeBootError(
            io,
            "BOOT_SNAPSHOT_NOT_FOUND",
            "boot-plan scratch disk path missing",
        ),
        error.MissingRootDiskRuntimePath => try writeBootError(
            io,
            "BOOT_IMAGE_NOT_FOUND",
            "boot-plan rootDisk path missing",
        ),
        error.MissingMountDiskRuntimeField => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "boot-plan mountDisk field missing",
        ),
        error.MissingMountDiskFdField => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "boot-plan mountDisk fd field missing",
        ),
        error.IncompleteRegistryMountDisk => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "boot-plan registry mountDisk field missing",
        ),
        error.InvalidMountDiskUpperSize => try writeBootError(
            io,
            "BOOT_MOUNT_INVALID",
            "boot-plan mountDisk upper size must be an integer",
        ),
        else => return false,
    }
    return true;
}

fn writeBootError(io: std.Io, code: []const u8, message: []const u8) !void {
    assert(code.len > 0);
    assert(message.len > 0);

    try protocol.writeError(io, code, message);
}

fn writeRequestError(io: std.Io, err: RequestError) !void {
    assert(@errorName(err).len > 0);
    if (try protocol.writeCommonRequestError(io, err)) return;
    if (try writePortForwardRequestError(io, err)) return;
    if (try writeSnapshotRequestError(io, err)) return;
    if (try writeLiveMountRequestError(io, err)) return;
    if (try writeBundleRequestError(io, err)) return;
    if (try writeGuestHostnameRequestError(io, err)) return;
    if (try writeRootDiskRequestError(io, err)) return;
    if (try writeScratchRequestError(io, err)) return;
    if (try writeProvisionDtbRequestError(io, err)) return;

    switch (err) {
        error.InvalidResourcesCpuMaxVcpus => try protocol.writeError(
            io,
            "BOOT_CPU_INVALID",
            "boot: resources.cpu.maxVcpus must be a positive integer",
        ),
        error.InvalidResourcesCpuQuotaCpus => try protocol.writeError(
            io,
            "BOOT_CPU_INVALID",
            "boot: resources.cpu.quotaCpus must be > 0 when set",
        ),
        error.InvalidResourcesCpuWeight => try protocol.writeError(
            io,
            "BOOT_CPU_INVALID",
            "boot: resources.cpu.weight must be an integer in 1..10000",
        ),
        else => try protocol.writeError(io, "INVALID_REQUEST", @errorName(err)),
    }
}

fn writeProvisionDtbRequestError(io: std.Io, err: RequestError) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.InvalidProvisionDtbExplicit => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "boot-plan provision dtb explicit flag must be a boolean",
        ),
        else => return false,
    }
    return true;
}

fn writeScratchRequestError(io: std.Io, err: RequestError) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.InvalidScratchOptionFalse => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "boot-plan scratch option false flag must be a boolean",
        ),
        error.InvalidScratchOptionPath => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "boot-plan scratch option path must be a string",
        ),
        else => return false,
    }
    return true;
}

fn writeRootDiskRequestError(io: std.Io, err: RequestError) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.InvalidRootDiskOptionFalse,
        error.InvalidRootDiskOptionTrue,
        => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "boot-plan rootDisk option flags must be booleans",
        ),
        error.InvalidRootDiskOptionPath,
        error.InvalidRootDiskRestorePath,
        => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "boot-plan rootDisk option paths must be strings",
        ),
        else => return false,
    }
    return true;
}

fn writeGuestHostnameRequestError(io: std.Io, err: RequestError) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.InvalidGuestHostnameSetPid => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "boot-plan guest hostname set pid must be a decimal integer",
        ),
        error.InvalidGuestHostnameSetSkip => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "boot-plan guest hostname set skip flag must be a boolean",
        ),
        error.InvalidGuestHostnameSetName,
        error.InvalidGuestHostnameSetVsockUdsPath,
        => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "boot-plan guest hostname set fields must be strings",
        ),
        else => return false,
    }
    return true;
}

fn writeBundleRequestError(io: std.Io, err: RequestError) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.InvalidBundlePackUseTiny => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "boot-plan bundle pack tiny flag must be a boolean",
        ),
        error.InvalidBundlePackMountGuest,
        error.InvalidBundlePackRestoreMountGuest,
        => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "boot-plan bundle pack mount guests must be strings",
        ),
        else => return false,
    }
    return true;
}

fn writePortForwardRequestError(io: std.Io, err: RequestError) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.InvalidPortForward,
        error.InvalidHostPort,
        error.InvalidGuestPort,
        => try protocol.writeError(
            io,
            "BOOT_PORT_FORWARD_INVALID",
            "portForward: hostPort and guestPort must be integers in 1..65535",
        ),
        error.InvalidPortForwardNetSocket => try protocol.writeError(
            io,
            "BOOT_PORT_FORWARD_INVALID",
            "boot-plan portForward net socket field must be a string",
        ),
        error.InvalidGvproxyPlanningRequired => try protocol.writeError(
            io,
            "BOOT_PORT_FORWARD_NO_GVPROXY",
            "boot-plan gvproxy planning flag must be a boolean",
        ),
        error.InvalidGvproxyNetSocket,
        error.InvalidGvproxyPath,
        => try protocol.writeError(
            io,
            "BOOT_PORT_FORWARD_NO_GVPROXY",
            "boot-plan gvproxy fields must be strings",
        ),
        else => return false,
    }
    return true;
}

fn writeSnapshotRequestError(io: std.Io, err: RequestError) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.InvalidSnapshotMountGuest,
        error.InvalidSnapshotMountLowerPath,
        error.InvalidSnapshotMountUpperPath,
        error.InvalidSnapshotLiveMounts,
        error.InvalidSnapshotVmstatePath,
        error.InvalidSnapshotVmstateChainId,
        error.InvalidSnapshotVmstateCheckpointParent,
        => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "boot-plan snapshot fields must be strings or resolved live mounts",
        ),
        error.InvalidSnapshotVmstateCheckpointSequence => try protocol.writeError(
            io,
            "INVALID_REQUEST",
            "boot-plan snapshot vmstate checkpoint sequence must be a decimal integer",
        ),
        else => return false,
    }
    return true;
}

fn writeLiveMountRequestError(io: std.Io, err: RequestError) !bool {
    assert(@errorName(err).len > 0);

    switch (err) {
        error.InvalidLiveMounts,
        error.InvalidLiveMountGuest,
        => try protocol.writeError(
            io,
            "BOOT_MOUNT_INVALID",
            "liveMounts: entries must include host and guest paths",
        ),
        error.InvalidLiveMountsResolved,
        error.InvalidConfigLiveMounts,
        error.InvalidBundleLiveMounts,
        error.InvalidLiveMountHost,
        error.InvalidLiveMountMode,
        error.InvalidLiveMountTag,
        => try protocol.writeError(
            io,
            "BOOT_MOUNT_INVALID",
            "liveMounts: resolved entries must include host, guest, tag, and mode ro/rw",
        ),
        error.InvalidBatchLiveMountValidationRequired => try protocol.writeError(
            io,
            "BOOT_MOUNT_INVALID",
            "boot-plan batch live mount validation flag must be a boolean",
        ),
        error.InvalidRestoreLiveMountsRecorded,
        error.InvalidRestoreLiveMountsOverrides,
        => try protocol.writeError(
            io,
            "BOOT_MOUNT_INVALID",
            "restore liveMount entries must include host, guest, and valid mode fields",
        ),
        else => return false,
    }
    return true;
}
