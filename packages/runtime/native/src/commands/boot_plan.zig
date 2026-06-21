const std = @import("std");
const runtime_helper = @import("runtime_helper");
const boot_plan = @import("../boot_plan.zig");
const protocol = @import("../protocol.zig");

pub const name = "boot-plan";

const ParsedRequest = struct {
    memory_mib_text: ?[]const u8,
    resources_memory: ?ParsedResourcesMemory,
    resources_cpu: ?ParsedResourcesCpu,
    auto_memory_mib_text: ?[]const u8,
    host_total_bytes_text: ?[]const u8,
    vmm_memory_preset: bool,
    has_image: bool,
    has_cmd: bool,
    has_snapshot: bool,
    root_disk: boot_plan.RootDiskMode,
    root_disk_option_false: bool,
    root_disk_option_true: bool,
    root_disk_option_path: ?[]const u8,
    root_disk_restore_path: ?[]const u8,
    guest_cwd: ?[]const u8,
    mount_guest: ?[]const u8,
    guest_env: std.json.ObjectMap,
    vmm_env_base: std.json.ObjectMap,
    vmm_env_overrides: std.json.ObjectMap,
    name: ?[]const u8,
    vsock_uds_path: ?[]const u8,
    guest_hostname_pid_text: ?[]const u8,
    guest_hostname_name: ?[]const u8,
    guest_hostname_set_pid_text: ?[]const u8,
    guest_hostname_set_name: ?[]const u8,
    guest_hostname_set_vsock_uds_path: ?[]const u8,
    guest_hostname_set_skip: bool,
    existing_vsock_spec: ?[]const u8,
    auto_vsock_uds_path: ?[]const u8,
    auto_vsock_temp_dir: ?[]const u8,
    port_forward: []const boot_plan.PortForwardMapping,
    port_forward_net_socket: ?[]const u8,
    gvproxy_planning_required: bool,
    gvproxy_net_socket: ?[]const u8,
    gvproxy_path: ?[]const u8,
    vmm_binary: ?[]const u8,
    vmm_args: []const []const u8,
    pdeathsig_path: ?[]const u8,
    pdeathsig_requested: ?bool,
    detached_requested: bool,
    boot_timeout_ms_text: ?[]const u8,
    boot_timeout_forever: bool,
    kernel_path: ?[]const u8,
    dtb_path: ?[]const u8,
    initrd_path: ?[]const u8,
    vmstate_path: ?[]const u8,
    restore_path: ?[]const u8,
    enable_vmstate_timing: bool,
    existing_vmstate_timing: ?[]const u8,
    boot_vmstate_engine: ?[]const u8,
    boot_vmstate_snapshot_disabled: bool,
    boot_vmstate_existing_temp_dir: ?[]const u8,
    boot_vmstate_state_path: ?[]const u8,
    boot_vmstate_temp_dir: ?[]const u8,
    boot_vmstate_chain_id: ?[]const u8,
    boot_vmstate_restore_path: ?[]const u8,
    boot_vmstate_forked_from: ?[]const u8,
    nested_requested: bool,
    live_mounts: []const boot_plan.LiveMountInput,
    live_mount_removed_option_index_text: ?[]const u8,
    live_mount_removed_option_has_cache: bool,
    live_mount_removed_option_has_sync: bool,
    live_mounts_resolved: []const boot_plan.LiveMount,
    batch_live_mount_validation_required: bool,
    restore_live_mounts_recorded: []const boot_plan.RestoreRecordedLiveMount,
    restore_live_mounts_overrides: []const boot_plan.RestoreLiveMountInput,
    existing_stats_file: ?[]const u8,
    stats_file_path: ?[]const u8,
    stats_file_temp_dir: ?[]const u8,
    stats_file_vsock_temp_dir: ?[]const u8,
    config_cmd: []const []const u8,
    config_env: std.json.ObjectMap,
    config_guest_cwd: ?[]const u8,
    config_image_cwd: ?[]const u8,
    config_live_mounts: []const boot_plan.LiveMount,
    bundle_explicit_cmd: ?[]const []const u8,
    bundle_image_cmd: ?[]const []const u8,
    bundle_snapshot_restore: bool,
    bundle_vmstate_restore: bool,
    bundle_live_mounts: []const boot_plan.LiveMount,
    bundle_command_requested: bool,
    bundle_image_env: std.json.ObjectMap,
    bundle_guest_env: std.json.ObjectMap,
    bundle_workspace_temp_dir: ?[]const u8,
    bundle_config_synth_dir: ?[]const u8,
    bundle_pack_use_tiny: bool,
    bundle_pack_mount_guest: ?[]const u8,
    bundle_pack_restore_mount_guest: ?[]const u8,
    provision_guest_cpu: ?boot_plan.ProvisionGuestCpu,
    provision_guest_arch_override: ?[]const u8,
    provision_host_arch: ?[]const u8,
    provision_dtb_explicit: bool,
    provision_cli_cache_home: ?[]const u8,
    provision_cli_cache_version: ?[]const u8,
    provision_asset_explicit_path: ?[]const u8,
    provision_asset_explicit_exists: ?bool,
    provision_asset_assets_dir_path: ?[]const u8,
    provision_asset_assets_dir_exists: ?bool,
    provision_asset_cache_path: ?[]const u8,
    provision_asset_cache_exists: ?bool,
    provision_base_path: ?[]const u8,
    provision_kernel_path: ?[]const u8,
    provision_dtb_path: ?[]const u8,
    provision_uds_path: ?[]const u8,
    provision_scratch_disk_path: ?[]const u8,
    provision_root_disk_path: ?[]const u8,
    provision_boot_vmm_env: std.json.ObjectMap,
    provision_repack_disk_path: ?[]const u8,
    provision_repack_out_path: ?[]const u8,
    provision_repack_extract_dir: ?[]const u8,
    provision_image_config_has_cmd: bool,
    provision_image_config_cmd: []const []const u8,
    provision_image_config_has_env: bool,
    provision_image_config_env: std.json.ObjectMap,
    provision_work_dir: ?[]const u8,
    provision_scratch_size_bytes_text: ?[]const u8,
    provision_timeout_ms_text: ?[]const u8,
    scratch_option_false: bool,
    scratch_option_path: ?[]const u8,
    scratch_mode: boot_plan.ScratchDiskMode,
    scratch_snapshot_path: ?[]const u8,
    scratch_restore_clone_path: ?[]const u8,
    scratch_auto_path: ?[]const u8,
    root_disk_runtime_mode: boot_plan.RootDiskRuntimeMode,
    root_disk_source_path: ?[]const u8,
    root_disk_clone_path: ?[]const u8,
    root_disk_materialize_restore_path: ?[]const u8,
    root_disk_materialize_caller_path: ?[]const u8,
    mount_disk_upper_size_option_text: ?[]const u8,
    mount_disk_runtime_mode: boot_plan.MountDiskRuntimeMode,
    mount_disk_lower_path: ?[]const u8,
    mount_disk_upper_path: ?[]const u8,
    mount_disk_source_upper_path: ?[]const u8,
    mount_disk_guest: ?[]const u8,
    mount_disk_upper_size_text: ?[]const u8,
    mount_disk_lower_fd_text: ?[]const u8,
    mount_disk_upper_fd_text: ?[]const u8,
    snapshot_mount_guest: ?[]const u8,
    snapshot_mount_lower_path: ?[]const u8,
    snapshot_mount_upper_path: ?[]const u8,
    snapshot_live_mounts: []const boot_plan.LiveMount,
    snapshot_vmstate_path: ?[]const u8,
    snapshot_vmstate_chain_id: ?[]const u8,
    snapshot_vmstate_checkpoint_parent: ?[]const u8,
    snapshot_vmstate_checkpoint_sequence_text: ?[]const u8,
    snapshot_backing_engine: ?[]const u8,
    snapshot_backing_action: ?[]const u8,
    snapshot_backing_disk_path: ?[]const u8,
    snapshot_backing_vmstate_path: ?[]const u8,
    registry_source_image_path: ?[]const u8,
    registry_disk_path: ?[]const u8,
    registry_forked_from: ?[]const u8,
    registry_memory_ceiling_mib_text: ?[]const u8,
    registry_stats_path: ?[]const u8,
    registry_per_boot_root_disk: ?[]const u8,
    registry_caller_root_disk_path: ?[]const u8,
    registry_boot_log_root: ?[]const u8,
    registry_child_pid_text: ?[]const u8,
    registry_detached: bool,
    registry_lifecycle_name: ?[]const u8,
    registry_lifecycle_vsock_uds_path: ?[]const u8,
    registry_per_boot_snap_disk: ?[]const u8,
    registry_per_boot_mount_upper: ?[]const u8,
    registry_bundle_temp_dir: ?[]const u8,
    registry_vsock_temp_dir: ?[]const u8,
    registry_stats_temp_dir: ?[]const u8,
    registry_gv_socket_dir: ?[]const u8,
    registry_cpu_cgroup_path: ?[]const u8,
    registry_cpu_policy_max_vcpus_text: ?[]const u8,
    registry_cpu_policy_quota_cpus_text: ?[]const u8,
    registry_cpu_policy_weight_text: ?[]const u8,
    registry_cpu_control_status: ?[]const u8,
    registry_cpu_control_reason: ?[]const u8,
    registry_vmstate_path: ?[]const u8,
    registry_vmstate_chain_id: ?[]const u8,
    registry_vmstate_checkpoint_parent: ?[]const u8,
    registry_vmstate_checkpoint_sequence_text: ?[]const u8,
    registry_nested: bool,
    registry_mount_guest: ?[]const u8,
    registry_mount_lower_path: ?[]const u8,
    registry_mount_upper_path: ?[]const u8,
    registry_host_platform: ?[]const u8,
    registry_vmm_binary: ?[]const u8,
    registry_vmm_pdeathsig: bool,
    registry_vmm_observed_exe_base: ?[]const u8,
    registry_gv_pid_text: ?[]const u8,
    registry_gv_exe: ?[]const u8,
    registry_gv_observed_exe_base: ?[]const u8,
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
    InvalidVmmEnvBase,
    InvalidVmmEnvOverrides,
    InvalidVmmEnvValue,
    InvalidName,
    InvalidVsockUdsPath,
    InvalidGuestHostnamePid,
    InvalidGuestHostnameName,
    InvalidGuestHostnameSetPid,
    InvalidGuestHostnameSetName,
    InvalidGuestHostnameSetVsockUdsPath,
    InvalidGuestHostnameSetSkip,
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
    InvalidBootVmstateEngine,
    InvalidBootVmstateSnapshotDisabled,
    InvalidBootVmstateExistingTempDir,
    InvalidBootVmstateStatePath,
    InvalidBootVmstateTempDir,
    InvalidBootVmstateChainId,
    InvalidBootVmstateRestorePath,
    InvalidBootVmstateForkedFrom,
    InvalidNested,
    InvalidLiveMounts,
    InvalidLiveMountGuest,
    InvalidLiveMountRemovedOptionIndex,
    InvalidLiveMountRemovedOptionHasCache,
    InvalidLiveMountRemovedOptionHasSync,
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
    InvalidStatsFileVsockTempDir,
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
    InvalidProvisionCliCacheHome,
    InvalidProvisionCliCacheVersion,
    InvalidProvisionAssetExplicitPath,
    InvalidProvisionAssetExplicitExists,
    InvalidProvisionAssetAssetsDirPath,
    InvalidProvisionAssetAssetsDirExists,
    InvalidProvisionAssetCachePath,
    InvalidProvisionAssetCacheExists,
    InvalidProvisionBasePath,
    InvalidProvisionKernelPath,
    InvalidProvisionDtbPath,
    InvalidProvisionUdsPath,
    InvalidProvisionScratchDiskPath,
    InvalidProvisionRootDiskPath,
    InvalidProvisionBootVmmEnv,
    InvalidProvisionBootVmmEnvValue,
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
    InvalidRootDiskMaterializeRestorePath,
    InvalidRootDiskMaterializeCallerPath,
    InvalidMountDiskUpperSizeOption,
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
    InvalidSnapshotBackingEngine,
    InvalidSnapshotBackingAction,
    InvalidSnapshotBackingDiskPath,
    InvalidSnapshotBackingVmstatePath,
    InvalidRegistrySourceImagePath,
    InvalidRegistryDiskPath,
    InvalidRegistryForkedFrom,
    InvalidRegistryMemoryCeilingMib,
    InvalidRegistryStatsPath,
    InvalidRegistryRootDiskPath,
    InvalidRegistryBootLogRoot,
    InvalidRegistryChildPid,
    InvalidRegistryDetached,
    InvalidRegistryLifecycleName,
    InvalidRegistryLifecycleVsockUdsPath,
    InvalidRegistryCleanupPath,
    InvalidRegistryCpuPolicy,
    InvalidRegistryCpuControlStatus,
    InvalidRegistryCpuControlReason,
    InvalidRegistryVmstatePath,
    InvalidRegistryVmstateChainId,
    InvalidRegistryVmstateCheckpointParent,
    InvalidRegistryVmstateCheckpointSequence,
    InvalidRegistryNested,
    InvalidRegistryMountGuest,
    InvalidRegistryMountLowerPath,
    InvalidRegistryMountUpperPath,
    InvalidRegistryHostPlatform,
    InvalidRegistryVmmBinary,
    InvalidRegistryVmmPdeathsig,
    InvalidRegistryVmmObservedExeBase,
    InvalidRegistryGvPid,
    InvalidRegistryGvExe,
    InvalidRegistryGvObservedExeBase,
} || protocol.RequestError;

pub fn run(allocator: std.mem.Allocator, io: std.Io) !protocol.Exit {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const parsed = parseRequest(arena, io) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };

    const input = makePlanInput(allocator, io, parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };

    const plan = boot_plan.planCore(input) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const root_disk_mode = boot_plan.planRootDiskMode(.{
        .false_value = parsed.root_disk_option_false,
        .true_value = parsed.root_disk_option_true,
        .path = parsed.root_disk_option_path,
        .restore_path = parsed.root_disk_restore_path,
    });
    const cpu_policy = makeCpuResources(parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const cpu_plan = boot_plan.planCpuResources(cpu_policy) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    switch (boot_plan.validatePortForward(parsed.port_forward)) {
        .ok => {},
        .invalid_host_port => |port| {
            try writePortForwardInvalid(io, "hostPort", port);
            return .fail;
        },
        .invalid_guest_port => |port| {
            try writePortForwardInvalid(io, "guestPort", port);
            return .fail;
        },
        .duplicate_host_port => |port| {
            try writeDuplicateHostPort(io, port);
            return .fail;
        },
    }
    boot_plan.validatePortForwardNetSocket(.{
        .port_forwards = parsed.port_forward,
        .net_socket = parsed.port_forward_net_socket,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const port_forward_probe = boot_plan.planPortForwardProbe(arena, parsed.port_forward) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const gvproxy_plan = boot_plan.planGvproxy(.{
        .planning_required = parsed.gvproxy_planning_required,
        .existing_net_socket = parsed.gvproxy_net_socket,
        .gvproxy_path = parsed.gvproxy_path,
        .port_forwards = parsed.port_forward,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const vsock_mode = boot_plan.planVsockMode(.{
        .existing_spec = parsed.existing_vsock_spec,
    });
    const vsock_plan = try boot_plan.planVsock(arena, .{
        .existing_spec = parsed.existing_vsock_spec,
        .auto_uds_path = parsed.auto_vsock_uds_path,
        .auto_temp_dir = parsed.auto_vsock_temp_dir,
    });
    const guest_env = makeGuestEnv(arena, parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const vmm_env = makeVmmEnv(arena, parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const guest_hostname = makeGuestHostname(arena, parsed) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };
    const guest_hostname_set = makeGuestHostnameSet(arena, parsed) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };
    const vmm_argv = try boot_plan.planVmmArgv(arena, .{
        .binary = parsed.vmm_binary,
        .args = parsed.vmm_args,
        .pdeathsig_path = parsed.pdeathsig_path,
    });
    const use_pdeathsig = boot_plan.planPdeathsig(.{
        .detached = parsed.detached_requested,
        .pdeathsig = parsed.pdeathsig_requested,
    });
    const kernel_dtb = boot_plan.planKernelDtb(.{
        .kernel_path = parsed.kernel_path,
        .dtb_path = parsed.dtb_path,
    });
    const initrd_env = boot_plan.planInitrdEnv(.{ .initrd_path = parsed.initrd_path });
    const vmstate_env = boot_plan.planVmstateEnv(.{
        .state_path = parsed.vmstate_path,
        .restore_path = parsed.restore_path,
        .enable_timing = parsed.enable_vmstate_timing,
        .existing_timing = parsed.existing_vmstate_timing,
    });
    const vmstate_temp_mode = boot_plan.planVmstateTempMode(.{
        .engine = parsed.boot_vmstate_engine,
        .snapshot_disabled = parsed.boot_vmstate_snapshot_disabled,
        .existing_temp_dir = parsed.boot_vmstate_existing_temp_dir,
    });
    const vmstate_runtime = boot_plan.planVmstateRuntime(arena, .{
        .state_path = parsed.boot_vmstate_state_path,
        .state_temp_dir = parsed.boot_vmstate_temp_dir,
        .chain_id = parsed.boot_vmstate_chain_id,
        .restore_path = parsed.boot_vmstate_restore_path,
        .forked_from = parsed.boot_vmstate_forked_from,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const nested_env = boot_plan.planNestedEnv(parsed.nested_requested);
    const planned_live_mounts = boot_plan.planLiveMounts(arena, parsed.live_mounts) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const live_mount_removed_option_index = if (parsed.live_mount_removed_option_index_text) |text|
        parseUnsigned(text) catch {
            try writeRequestError(io, error.InvalidLiveMountRemovedOptionIndex);
            return .fail;
        }
    else
        null;
    if (parsed.live_mount_removed_option_has_cache or parsed.live_mount_removed_option_has_sync) {
        const index = live_mount_removed_option_index orelse {
            try writeRequestError(io, error.InvalidLiveMountRemovedOptionIndex);
            return .fail;
        };
        const removed_options = boot_plan.validateLiveMountRemovedOptions(.{
            .index = index,
            .has_cache = parsed.live_mount_removed_option_has_cache,
            .has_sync = parsed.live_mount_removed_option_has_sync,
        });
        switch (removed_options) {
            .ok => {},
            .cache => |i| {
                try writeRemovedLiveMountCacheError(io, i);
                return .fail;
            },
            .sync => |i| {
                try writeRemovedLiveMountSyncError(io, i);
                return .fail;
            },
        }
    }
    const virtiofs_env = try boot_plan.planVirtiofsEnv(arena, parsed.live_mounts_resolved);
    const batch_live_mount_sync = boot_plan.planBatchLiveMountSync(.{
        .live_mounts = parsed.live_mounts_resolved,
        .vsock_uds_path = parsed.vsock_uds_path,
        .validation_required = parsed.batch_live_mount_validation_required,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const restore_live_mounts = try boot_plan.planRestoreLiveMounts(arena, .{
        .recorded = parsed.restore_live_mounts_recorded,
        .overrides = parsed.restore_live_mounts_overrides,
    });
    if (restore_live_mounts.unknown_guest) |guest| {
        try writeRestoreLiveMountOverrideError(arena, io, guest, parsed.restore_live_mounts_recorded);
        return .fail;
    }
    const stats_file_mode = boot_plan.planStatsFileMode(.{
        .existing_path = parsed.existing_stats_file,
    });
    const stats_file_temp_mode = boot_plan.planStatsFileTempMode(.{
        .existing_path = parsed.existing_stats_file,
        .vsock_temp_dir = parsed.stats_file_vsock_temp_dir,
    });
    const stats_file = try boot_plan.planStatsFile(arena, .{
        .existing_path = parsed.existing_stats_file,
        .planned_path = parsed.stats_file_path,
        .planned_temp_dir = parsed.stats_file_temp_dir,
    });
    const config_env = makeConfigEnv(arena, parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const config_cwd = boot_plan.planMachinenConfigCwd(.{
        .guest_cwd = parsed.config_guest_cwd,
        .image_cwd = parsed.config_image_cwd,
    });
    const bundle_command = if (parsed.bundle_command_requested)
        boot_plan.planBundleCommand(arena, .{
            .explicit_cmd = parsed.bundle_explicit_cmd,
            .image_cmd = parsed.bundle_image_cmd,
            .snapshot_restore = parsed.bundle_snapshot_restore,
            .vmstate_restore = parsed.bundle_vmstate_restore,
            .live_mounts = parsed.bundle_live_mounts,
        }) catch |err| {
            try writePlanError(io, err);
            return .fail;
        }
    else
        &.{};
    const bundle_env = makeBundleEnv(arena, parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const bundle_workspace = boot_plan.planBundleWorkspace(arena, .{
        .temp_dir = parsed.bundle_workspace_temp_dir,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const bundle_config_paths = boot_plan.planBundleConfigPaths(arena, .{
        .synth_bundle_dir = parsed.bundle_config_synth_dir,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const bundle_pack_input: boot_plan.BundlePackInput = .{
        .use_tiny = parsed.bundle_pack_use_tiny,
        .mount_guest = parsed.bundle_pack_mount_guest,
        .restore_mount_guest = parsed.bundle_pack_restore_mount_guest,
    };
    const bundle_pack = boot_plan.planBundlePack(bundle_pack_input);
    const bundle_mount_disk_mode = boot_plan.planBundleMountDiskMode(bundle_pack_input);
    const provision_assets = boot_plan.planProvisionAssets(.{
        .guest_cpu = parsed.provision_guest_cpu,
        .arch_override = parsed.provision_guest_arch_override,
        .host_arch = parsed.provision_host_arch,
    });
    const provision_dtb = boot_plan.planProvisionDtb(.{
        .explicit = parsed.provision_dtb_explicit,
        .guest_cpu = parsed.provision_guest_cpu,
        .arch_override = parsed.provision_guest_arch_override,
        .host_arch = parsed.provision_host_arch,
    });
    const provision_cli_cache = boot_plan.planProvisionCliCacheBaseDir(arena, .{
        .home_dir = parsed.provision_cli_cache_home,
        .version = parsed.provision_cli_cache_version,
        .guest_cpu = parsed.provision_guest_cpu,
        .arch_override = parsed.provision_guest_arch_override,
        .host_arch = parsed.provision_host_arch,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const provision_asset_lookup = boot_plan.planProvisionAssetLookup(.{
        .explicit_path = parsed.provision_asset_explicit_path,
        .explicit_exists = parsed.provision_asset_explicit_exists,
        .assets_dir_path = parsed.provision_asset_assets_dir_path,
        .assets_dir_exists = parsed.provision_asset_assets_dir_exists,
        .cache_path = parsed.provision_asset_cache_path,
        .cache_exists = parsed.provision_asset_cache_exists,
    });
    const provision_boot = makeProvisionBoot(arena, parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const provision_workload = boot_plan.planProvisionWorkload();
    const provision_runtime = makeProvisionRuntime(arena, parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const provision_image_config = makeProvisionImageConfig(arena, parsed) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const provision_repack = boot_plan.planProvisionRepack(arena, .{
        .disk_path = parsed.provision_repack_disk_path,
        .out_path = parsed.provision_repack_out_path,
        .extract_dir = parsed.provision_repack_extract_dir,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const planned_scratch_mode = boot_plan.planScratchMode(.{
        .false_value = parsed.scratch_option_false,
        .path = parsed.scratch_option_path,
    });
    const scratch_disk = boot_plan.planScratchDisk(.{
        .mode = parsed.scratch_mode,
        .has_cmd = parsed.has_cmd,
        .has_image = parsed.has_image,
        .snapshot_path = parsed.scratch_snapshot_path,
        .restore_clone_path = parsed.scratch_restore_clone_path,
        .auto_path = parsed.scratch_auto_path,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const root_disk_runtime = boot_plan.planRootDiskRuntime(.{
        .mode = parsed.root_disk_runtime_mode,
        .source_path = parsed.root_disk_source_path,
        .clone_path = parsed.root_disk_clone_path,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const root_disk_materialize_mode = boot_plan.planRootDiskMaterializeMode(.{
        .restore_path = parsed.root_disk_materialize_restore_path,
        .caller_path = parsed.root_disk_materialize_caller_path,
    });
    const mount_disk_upper_size_option = if (parsed.mount_disk_upper_size_option_text) |text|
        parseUnsigned(text) catch {
            try writeRequestError(io, error.InvalidMountDiskUpperSizeOption);
            return .fail;
        }
    else
        null;
    const mount_disk_upper_size_plan = boot_plan.planMountDiskUpperSize(.{
        .size_bytes = mount_disk_upper_size_option,
    });
    const planned_mount_disk_upper_size = switch (mount_disk_upper_size_plan) {
        .ok => |size| size,
        .invalid => |size| {
            try writeMountDiskUpperSizeError(io, size);
            return .fail;
        },
    };
    const mount_disk_upper_size = if (parsed.mount_disk_upper_size_text) |text|
        parseUnsigned(text) catch {
            try writeRequestError(io, error.InvalidMountDiskUpperSize);
            return .fail;
        }
    else
        null;
    const mount_disk_runtime = boot_plan.planMountDiskRuntime(.{
        .mode = parsed.mount_disk_runtime_mode,
        .lower_path = parsed.mount_disk_lower_path,
        .upper_path = parsed.mount_disk_upper_path,
        .source_upper_path = parsed.mount_disk_source_upper_path,
        .guest = parsed.mount_disk_guest,
        .upper_size_bytes = mount_disk_upper_size,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const mount_disk_lower_fd = if (parsed.mount_disk_lower_fd_text) |text|
        parseUnsigned(text) catch {
            try writeRequestError(io, error.InvalidMountDiskLowerFd);
            return .fail;
        }
    else
        null;
    const mount_disk_upper_fd = if (parsed.mount_disk_upper_fd_text) |text|
        parseUnsigned(text) catch {
            try writeRequestError(io, error.InvalidMountDiskUpperFd);
            return .fail;
        }
    else
        null;
    const mount_disk_fd_env = boot_plan.planMountDiskFdEnv(arena, .{
        .lower_fd = mount_disk_lower_fd,
        .upper_fd = mount_disk_upper_fd,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const snapshot_vmstate_checkpoint_sequence = if (parsed.snapshot_vmstate_checkpoint_sequence_text) |text|
        parseUnsigned(text) catch {
            try writeRequestError(io, error.InvalidSnapshotVmstateCheckpointSequence);
            return .fail;
        }
    else
        null;
    const snapshot_context = boot_plan.planSnapshotContext(arena, .{
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
            .checkpoint_sequence = snapshot_vmstate_checkpoint_sequence,
        },
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const snapshot_backing = boot_plan.planSnapshotBacking(.{
        .engine = parsed.snapshot_backing_engine,
        .action = parsed.snapshot_backing_action,
        .disk_path = parsed.snapshot_backing_disk_path,
        .vmstate_path = parsed.snapshot_backing_vmstate_path,
    });
    const registry_cpu_policy = makeRegistryCpuPolicy(parsed) catch |err| {
        try writeRequestError(io, err);
        return .fail;
    };
    const registry_child_pid = if (parsed.registry_child_pid_text) |text|
        parseSigned(text) catch {
            try writeRequestError(io, error.InvalidRegistryChildPid);
            return .fail;
        }
    else
        null;
    const registry_memory_ceiling_mib = if (parsed.registry_memory_ceiling_mib_text) |text|
        parseUnsigned(text) catch {
            try writeRequestError(io, error.InvalidRegistryMemoryCeilingMib);
            return .fail;
        }
    else
        null;
    const registry_vmstate_checkpoint_sequence = if (parsed.registry_vmstate_checkpoint_sequence_text) |text|
        parseUnsigned(text) catch {
            try writeRequestError(io, error.InvalidRegistryVmstateCheckpointSequence);
            return .fail;
        }
    else
        null;
    const registry_shape = boot_plan.planRegistryShape(arena, .{
        .source_image_path = parsed.registry_source_image_path,
        .disk_path = parsed.registry_disk_path,
        .forked_from = parsed.registry_forked_from,
        .memory_ceiling_mib = registry_memory_ceiling_mib,
        .stats_path = parsed.registry_stats_path,
        .per_boot_root_disk = parsed.registry_per_boot_root_disk,
        .caller_root_disk_path = parsed.registry_caller_root_disk_path,
        .boot_log_root = parsed.registry_boot_log_root,
        .child_pid = registry_child_pid,
        .detached = parsed.registry_detached,
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
        .cpu_policy = registry_cpu_policy,
        .cpu_control_status = parsed.registry_cpu_control_status,
        .cpu_control_reason = parsed.registry_cpu_control_reason,
        .vmstate = .{
            .state_path = parsed.registry_vmstate_path,
            .chain_id = parsed.registry_vmstate_chain_id,
            .checkpoint_parent = parsed.registry_vmstate_checkpoint_parent,
            .checkpoint_sequence = registry_vmstate_checkpoint_sequence,
        },
        .nested = parsed.registry_nested,
    }) catch |err| {
        try writePlanError(io, err);
        return .fail;
    };
    const registry_lifecycle = boot_plan.planRegistryLifecycle(.{
        .name = parsed.registry_lifecycle_name,
        .child_pid = registry_child_pid,
        .vsock_uds_path = parsed.registry_lifecycle_vsock_uds_path,
    });
    const registry_gv_pid = if (parsed.registry_gv_pid_text) |text|
        parseSigned(text) catch {
            try writeRequestError(io, error.InvalidRegistryGvPid);
            return .fail;
        }
    else
        null;
    const registry_process = boot_plan.planRegistryProcess(.{
        .host_platform = parsed.registry_host_platform,
        .vmm_binary = parsed.registry_vmm_binary,
        .vmm_pdeathsig = parsed.registry_vmm_pdeathsig,
        .vmm_observed_exe_base = parsed.registry_vmm_observed_exe_base,
        .gv_pid = registry_gv_pid,
        .gv_exe = parsed.registry_gv_exe,
        .gv_observed_exe_base = parsed.registry_gv_observed_exe_base,
    });

    try writePlan(io, plan, root_disk_mode, cpu_plan, guest_env, vmm_env, guest_hostname, guest_hostname_set, vsock_mode, vsock_plan, gvproxy_plan, vmm_argv, use_pdeathsig, kernel_dtb, initrd_env, vmstate_env, vmstate_temp_mode, vmstate_runtime, nested_env, virtiofs_env, batch_live_mount_sync, restore_live_mounts.mounts, stats_file_mode, stats_file_temp_mode, stats_file, planned_live_mounts, parsed.port_forward, port_forward_probe, parsed.config_cmd, config_env, config_cwd, parsed.config_live_mounts, bundle_command, bundle_env, bundle_workspace, bundle_config_paths, bundle_pack, bundle_mount_disk_mode, provision_assets, provision_dtb, provision_cli_cache, provision_asset_lookup, provision_boot, provision_workload, provision_repack, provision_image_config, provision_runtime, planned_scratch_mode, scratch_disk, root_disk_runtime, root_disk_materialize_mode, planned_mount_disk_upper_size, mount_disk_runtime, mount_disk_fd_env, snapshot_context, snapshot_backing, registry_shape, registry_lifecycle, registry_process);
    return .ok;
}

fn writePlan(
    io: std.Io,
    plan: boot_plan.Plan,
    root_disk_mode: boot_plan.RootDiskMode,
    cpu_policy: ?boot_plan.CpuPolicyPlan,
    guest_env: []const boot_plan.EnvPair,
    vmm_env: []const boot_plan.EnvPair,
    guest_hostname: ?[]const u8,
    guest_hostname_set: ?[]const u8,
    vsock_mode: boot_plan.VsockModePlan,
    vsock_plan: boot_plan.VsockPlan,
    gvproxy_plan: boot_plan.GvproxyPlan,
    vmm_argv: boot_plan.VmmArgvPlan,
    use_pdeathsig: bool,
    kernel_dtb: boot_plan.KernelDtbPlan,
    initrd_env: boot_plan.InitrdPlan,
    vmstate_env: boot_plan.VmstateEnvPlan,
    vmstate_temp_mode: boot_plan.VmstateTempModePlan,
    vmstate_runtime: boot_plan.VmstateRuntimePlan,
    nested_env: ?[]const u8,
    virtiofs_env: []const boot_plan.EnvPair,
    batch_live_mount_sync: boot_plan.BatchLiveMountPlan,
    restore_live_mounts: []const boot_plan.RestoreLiveMountInput,
    stats_file_mode: boot_plan.StatsFileModePlan,
    stats_file_temp_mode: boot_plan.StatsFileTempModePlan,
    stats_file: boot_plan.StatsFilePlan,
    planned_live_mounts: []const boot_plan.LiveMount,
    planned_port_forwards: []const boot_plan.PortForwardMapping,
    port_forward_probe: []const boot_plan.PortForwardProbePlan,
    config_cmd: []const []const u8,
    config_env: []const boot_plan.EnvPair,
    config_cwd: ?[]const u8,
    config_live_mounts: []const boot_plan.LiveMount,
    bundle_command: []const []const u8,
    bundle_env: []const boot_plan.EnvPair,
    bundle_workspace: boot_plan.BundleWorkspacePlan,
    bundle_config_paths: boot_plan.BundleConfigPathsPlan,
    bundle_pack: boot_plan.BundlePackPlan,
    bundle_mount_disk_mode: boot_plan.BundleMountDiskModePlan,
    provision_assets: boot_plan.ProvisionAssetsPlan,
    provision_dtb: boot_plan.ProvisionDtbPlan,
    provision_cli_cache: boot_plan.ProvisionCliCachePlan,
    provision_asset_lookup: boot_plan.ProvisionAssetLookupPlan,
    provision_boot: boot_plan.ProvisionBootPlan,
    provision_workload: boot_plan.ProvisionWorkloadPlan,
    provision_repack: boot_plan.ProvisionRepackPlan,
    provision_image_config: boot_plan.ProvisionImageConfigPlan,
    provision_runtime: boot_plan.ProvisionRuntimePlan,
    planned_scratch_mode: boot_plan.ScratchDiskMode,
    scratch_disk: boot_plan.ScratchDiskPlan,
    root_disk_runtime: boot_plan.RootDiskRuntimePlan,
    root_disk_materialize_mode: boot_plan.RootDiskMaterializeModePlan,
    planned_mount_disk_upper_size: u64,
    mount_disk_runtime: boot_plan.MountDiskRuntimePlan,
    mount_disk_fd_env: []const boot_plan.EnvPair,
    snapshot_context: boot_plan.SnapshotContextPlan,
    snapshot_backing: boot_plan.SnapshotBackingPlan,
    registry_shape: boot_plan.RegistryShapePlan,
    registry_lifecycle: boot_plan.RegistryLifecyclePlan,
    registry_process: boot_plan.RegistryProcessPlan,
) !void {
    try protocol.stdout(io, "{\"ok\":true,\"protocolVersion\":1,\"command\":\"boot-plan\",\"data\":{");
    try protocol.stdout(io, "\"memoryCeilingMib\":");
    if (plan.memory_ceiling_mib) |mib| {
        var buf: [32]u8 = undefined;
        try protocol.stdout(io, try std.fmt.bufPrint(&buf, "{d}", .{mib}));
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmMemory\":");
    if (plan.vmm_memory_mib) |mib| {
        var buf: [32]u8 = undefined;
        try protocol.writeJsonString(io, try std.fmt.bufPrint(&buf, "{d}", .{mib}));
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"cpuPolicy\":");
    if (cpu_policy) |cpu| {
        try protocol.stdout(io, "{\"maxVcpus\":");
        try writeU64(io, cpu.max_vcpus);
        if (cpu.quota_cpus) |quota| {
            try protocol.stdout(io, ",\"quotaCpus\":");
            try writeF64(io, quota);
        }
        try protocol.stdout(io, ",\"weight\":");
        try writeU64(io, cpu.weight);
        try protocol.stdout(io, "}");
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"wantsRootDisk\":");
    try protocol.stdout(io, if (plan.wants_root_disk) "true" else "false");
    try protocol.stdout(io, ",\"rootDiskMode\":");
    try protocol.writeJsonString(io, rootDiskModeName(root_disk_mode));
    try protocol.stdout(io, ",\"needsInitramfs\":");
    try protocol.stdout(io, if (plan.needs_initramfs) "true" else "false");
    try protocol.stdout(io, ",\"timeoutMs\":");
    try writeNullableU64(io, plan.timeout_ms);
    try protocol.stdout(io, ",\"detachedReadinessTimeoutMs\":");
    try writeU64(io, plan.detached_readiness_timeout_ms);
    try protocol.stdout(io, ",\"normalizedMountGuest\":");
    if (plan.normalized_mount_guest) |guest| {
        try protocol.writeJsonString(io, guest);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vsockMode\":{");
    try protocol.stdout(io, "\"action\":");
    try protocol.writeJsonString(io, vsock_mode.action);
    try protocol.stdout(io, ",\"existingSpec\":");
    try writeNullableJsonString(io, vsock_mode.existing_spec);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"vsockUdsPath\":");
    if (vsock_plan.uds_path) |path| {
        try protocol.writeJsonString(io, path);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmVsock\":");
    if (vsock_plan.vmm_vsock) |spec| {
        try protocol.writeJsonString(io, spec);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmKernel\":");
    if (kernel_dtb.vmm_kernel) |kernel| {
        try protocol.writeJsonString(io, kernel);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmDtb\":");
    if (kernel_dtb.vmm_dtb) |dtb| {
        try protocol.writeJsonString(io, dtb);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmInitrd\":");
    if (initrd_env.vmm_initrd) |initrd| {
        try protocol.writeJsonString(io, initrd);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmSnapshotPath\":");
    if (vmstate_env.snapshot_path) |snapshot_path| {
        try protocol.writeJsonString(io, snapshot_path);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmRestorePath\":");
    if (vmstate_env.restore_path) |restore_path| {
        try protocol.writeJsonString(io, restore_path);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmVmstateTiming\":");
    if (vmstate_env.vmstate_timing) |timing| {
        try protocol.writeJsonString(io, timing);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmstateTempMode\":{");
    try protocol.stdout(io, "\"action\":");
    try protocol.writeJsonString(io, vmstate_temp_mode.action);
    try protocol.stdout(io, ",\"tempDir\":");
    try writeNullableJsonString(io, vmstate_temp_mode.temp_dir);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"vmstateRuntime\":{");
    try protocol.stdout(io, "\"statePath\":");
    try writeNullableJsonString(io, vmstate_runtime.state_path);
    try protocol.stdout(io, ",\"chainId\":");
    try writeNullableJsonString(io, vmstate_runtime.chain_id);
    try protocol.stdout(io, ",\"checkpointParent\":");
    try writeNullableJsonString(io, vmstate_runtime.checkpoint_parent);
    try protocol.stdout(io, ",\"checkpointSequence\":");
    try writeNullableU64(io, vmstate_runtime.checkpoint_sequence);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"vmmNested\":");
    if (nested_env) |nested| {
        try protocol.writeJsonString(io, nested);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"statsFileMode\":{");
    try protocol.stdout(io, "\"action\":");
    try protocol.writeJsonString(io, stats_file_mode.action);
    try protocol.stdout(io, ",\"existingPath\":");
    try writeNullableJsonString(io, stats_file_mode.existing_path);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"statsFileTempMode\":{");
    try protocol.stdout(io, "\"action\":");
    try protocol.writeJsonString(io, stats_file_temp_mode.action);
    try protocol.stdout(io, ",\"existingPath\":");
    try writeNullableJsonString(io, stats_file_temp_mode.existing_path);
    try protocol.stdout(io, ",\"tempDir\":");
    try writeNullableJsonString(io, stats_file_temp_mode.temp_dir);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"statsFilePath\":");
    if (stats_file.stats_file_path) |path| {
        try protocol.writeJsonString(io, path);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmStatsFile\":");
    if (stats_file.vmm_stats_file) |path| {
        try protocol.writeJsonString(io, path);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"plannedLiveMounts\":[");
    for (planned_live_mounts, 0..) |mount, i| {
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
    try protocol.stdout(io, ",\"bundleCommand\":[");
    for (bundle_command, 0..) |arg, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, arg);
    }
    try protocol.stdout(io, "]");
    try protocol.stdout(io, ",\"bundleEnv\":{");
    for (bundle_env, 0..) |pair, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, pair.key);
        try protocol.stdout(io, ":");
        try protocol.writeJsonString(io, pair.value);
    }
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"bundleWorkspace\":{");
    try protocol.stdout(io, "\"cpioPath\":");
    try writeNullableJsonString(io, bundle_workspace.cpio_path);
    try protocol.stdout(io, ",\"synthBundleDir\":");
    try writeNullableJsonString(io, bundle_workspace.synth_bundle_dir);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"bundleConfigPaths\":{");
    try protocol.stdout(io, "\"rootfsDir\":");
    try writeNullableJsonString(io, bundle_config_paths.rootfs_dir);
    try protocol.stdout(io, ",\"configPath\":");
    try writeNullableJsonString(io, bundle_config_paths.config_path);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"bundlePack\":{");
    try protocol.stdout(io, "\"kind\":");
    try protocol.writeJsonString(io, bundle_pack.kind);
    try protocol.stdout(io, ",\"tinyMountGuest\":");
    try writeNullableJsonString(io, bundle_pack.tiny_mount_guest);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"bundleMountDiskMode\":{");
    try protocol.stdout(io, "\"action\":");
    try protocol.writeJsonString(io, bundle_mount_disk_mode.action);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"provisionAssets\":{");
    try protocol.stdout(io, "\"cpu\":");
    try protocol.writeJsonString(io, provision_assets.cpu);
    try protocol.stdout(io, ",\"kernelAsset\":");
    try protocol.writeJsonString(io, provision_assets.kernel_asset);
    try protocol.stdout(io, ",\"dtbAsset\":");
    try writeNullableJsonString(io, provision_assets.dtb_asset);
    try protocol.stdout(io, ",\"rootfsAsset\":");
    try protocol.writeJsonString(io, provision_assets.rootfs_asset);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"provisionDtb\":{");
    try protocol.stdout(io, "\"required\":");
    try protocol.stdout(io, if (provision_dtb.required) "true" else "false");
    try protocol.stdout(io, ",\"asset\":");
    try writeNullableJsonString(io, provision_dtb.asset);
    try protocol.stdout(io, ",\"cliCacheName\":");
    try writeNullableJsonString(io, provision_dtb.cli_cache_name);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"provisionCliCache\":{");
    try protocol.stdout(io, "\"baseDir\":");
    try writeNullableJsonString(io, provision_cli_cache.base_dir);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"provisionAssetLookup\":{");
    try protocol.stdout(io, "\"path\":");
    try writeNullableJsonString(io, provision_asset_lookup.path);
    try protocol.stdout(io, ",\"error\":");
    try writeNullableJsonString(io, provision_asset_lookup.error_kind);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"provisionBoot\":{");
    try protocol.stdout(io, "\"imagePath\":");
    try writeNullableJsonString(io, provision_boot.image_path);
    try protocol.stdout(io, ",\"kernelPath\":");
    try writeNullableJsonString(io, provision_boot.kernel_path);
    try protocol.stdout(io, ",\"dtbPath\":");
    try writeNullableJsonString(io, provision_boot.dtb_path);
    try protocol.stdout(io, ",\"vmmVsock\":");
    try writeNullableJsonString(io, provision_boot.vmm_vsock);
    try protocol.stdout(io, ",\"timeoutMs\":");
    try writeNullableU64(io, provision_boot.timeout_ms);
    try protocol.stdout(io, ",\"vmmEnv\":{");
    for (provision_boot.vmm_env, 0..) |pair, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, pair.key);
        try protocol.stdout(io, ":");
        try protocol.writeJsonString(io, pair.value);
    }
    try protocol.stdout(io, "},\"cmd\":[");
    for (provision_boot.cmd, 0..) |arg, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, arg);
    }
    try protocol.stdout(io, "],\"env\":{");
    for (provision_boot.env, 0..) |pair, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, pair.key);
        try protocol.stdout(io, ":");
        try protocol.writeJsonString(io, pair.value);
    }
    try protocol.stdout(io, "},\"snapshotPath\":");
    try writeNullableJsonString(io, provision_boot.snapshot_path);
    try protocol.stdout(io, ",\"rootDiskPath\":");
    try writeNullableJsonString(io, provision_boot.root_disk_path);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"provisionWorkload\":{");
    try protocol.stdout(io, "\"tarToDiskCommand\":");
    try protocol.writeJsonString(io, provision_workload.tar_to_disk_command);
    try protocol.stdout(io, ",\"poweroffCommand\":");
    try protocol.writeJsonString(io, provision_workload.poweroff_command);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"provisionRepack\":{");
    try protocol.stdout(io, "\"extractArgs\":[");
    for (provision_repack.extract_args, 0..) |arg, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, arg);
    }
    try protocol.stdout(io, "],\"targzArgs\":[");
    for (provision_repack.targz_args, 0..) |arg, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, arg);
    }
    try protocol.stdout(io, "],\"imageConfigPath\":");
    try writeNullableJsonString(io, provision_repack.image_config_path);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"provisionImageConfig\":");
    if (provision_image_config.has_config) {
        try protocol.stdout(io, "{");
        var wrote_field = false;
        if (provision_image_config.has_cmd) {
            try protocol.stdout(io, "\"cmd\":[");
            for (provision_image_config.cmd, 0..) |arg, i| {
                if (i != 0) try protocol.stdout(io, ",");
                try protocol.writeJsonString(io, arg);
            }
            try protocol.stdout(io, "]");
            wrote_field = true;
        }
        if (provision_image_config.has_env) {
            if (wrote_field) try protocol.stdout(io, ",");
            try protocol.stdout(io, "\"env\":{");
            for (provision_image_config.env, 0..) |pair, i| {
                if (i != 0) try protocol.stdout(io, ",");
                try protocol.writeJsonString(io, pair.key);
                try protocol.stdout(io, ":");
                try protocol.writeJsonString(io, pair.value);
            }
            try protocol.stdout(io, "}");
        }
        try protocol.stdout(io, "}");
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"provisionRuntime\":{");
    try protocol.stdout(io, "\"scratchSizeBytes\":");
    try writeU64(io, provision_runtime.scratch_size_bytes);
    try protocol.stdout(io, ",\"deadlineMs\":");
    try writeU64(io, provision_runtime.deadline_ms);
    try protocol.stdout(io, ",\"diskPath\":");
    try writeNullableJsonString(io, provision_runtime.disk_path);
    try protocol.stdout(io, ",\"rootDiskPath\":");
    try writeNullableJsonString(io, provision_runtime.root_disk_path);
    try protocol.stdout(io, ",\"udsPath\":");
    try writeNullableJsonString(io, provision_runtime.uds_path);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"plannedScratchMode\":");
    try protocol.writeJsonString(io, scratchDiskModeName(planned_scratch_mode));
    try protocol.stdout(io, ",\"scratchDisk\":{");
    try protocol.stdout(io, "\"action\":");
    try protocol.writeJsonString(io, scratch_disk.action);
    try protocol.stdout(io, ",\"diskPath\":");
    try writeNullableJsonString(io, scratch_disk.disk_path);
    try protocol.stdout(io, ",\"perBootSnapDisk\":");
    try writeNullableJsonString(io, scratch_disk.per_boot_snap_disk);
    try protocol.stdout(io, ",\"vmmDisk\":");
    try writeNullableJsonString(io, scratch_disk.vmm_disk);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"rootDiskRuntime\":{");
    try protocol.stdout(io, "\"action\":");
    try protocol.writeJsonString(io, root_disk_runtime.action);
    try protocol.stdout(io, ",\"sourcePath\":");
    try writeNullableJsonString(io, root_disk_runtime.source_path);
    try protocol.stdout(io, ",\"targetPath\":");
    try writeNullableJsonString(io, root_disk_runtime.target_path);
    try protocol.stdout(io, ",\"perBootRootDisk\":");
    try writeNullableJsonString(io, root_disk_runtime.per_boot_root_disk);
    try protocol.stdout(io, ",\"vmmRootDisk\":");
    try writeNullableJsonString(io, root_disk_runtime.vmm_root_disk);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"rootDiskMaterializeMode\":{");
    try protocol.stdout(io, "\"action\":");
    try protocol.writeJsonString(io, root_disk_materialize_mode.action);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"mountDiskUpperSizeBytes\":");
    try writeU64(io, planned_mount_disk_upper_size);
    try protocol.stdout(io, ",\"mountDiskRuntime\":{");
    try protocol.stdout(io, "\"action\":");
    try protocol.writeJsonString(io, mount_disk_runtime.action);
    try protocol.stdout(io, ",\"lowerPath\":");
    try writeNullableJsonString(io, mount_disk_runtime.lower_path);
    try protocol.stdout(io, ",\"upperPath\":");
    try writeNullableJsonString(io, mount_disk_runtime.upper_path);
    try protocol.stdout(io, ",\"sourceUpperPath\":");
    try writeNullableJsonString(io, mount_disk_runtime.source_upper_path);
    try protocol.stdout(io, ",\"guest\":");
    try writeNullableJsonString(io, mount_disk_runtime.guest);
    try protocol.stdout(io, ",\"upperSizeBytes\":");
    try writeNullableU64(io, mount_disk_runtime.upper_size_bytes);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"mountDiskFdEnv\":{");
    for (mount_disk_fd_env, 0..) |pair, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, pair.key);
        try protocol.stdout(io, ":");
        try protocol.writeJsonString(io, pair.value);
    }
    try protocol.stdout(io, "}");
    try writeSnapshotContext(io, snapshot_context);
    try protocol.stdout(io, ",\"snapshotBacking\":{");
    try protocol.stdout(io, "\"allowed\":");
    try protocol.stdout(io, if (snapshot_backing.allowed) "true" else "false");
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"registryShape\":{");
    try protocol.stdout(io, "\"sourceImagePath\":");
    try writeNullableJsonString(io, registry_shape.source_image_path);
    try protocol.stdout(io, ",\"diskPath\":");
    try writeNullableJsonString(io, registry_shape.disk_path);
    try protocol.stdout(io, ",\"forkedFrom\":");
    try writeNullableJsonString(io, registry_shape.forked_from);
    try protocol.stdout(io, ",\"memoryCeilingMib\":");
    try writeNullableU64(io, registry_shape.memory_ceiling_mib);
    try protocol.stdout(io, ",\"statsPath\":");
    try writeNullableJsonString(io, registry_shape.stats_path);
    try protocol.stdout(io, ",\"rootDiskPath\":");
    try writeNullableJsonString(io, registry_shape.root_disk_path);
    try protocol.stdout(io, ",\"rootDiskMode\":");
    try protocol.writeJsonString(io, registry_shape.root_disk_mode);
    try protocol.stdout(io, ",\"bootLogPath\":");
    try writeNullableJsonString(io, registry_shape.boot_log_path);
    try protocol.stdout(io, ",\"cleanupPaths\":[");
    for (registry_shape.cleanup_paths, 0..) |path, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, path);
    }
    try protocol.stdout(io, "]");
    try protocol.stdout(io, ",\"mountDisk\":");
    if (registry_shape.mount_disk) |mount_disk| {
        try protocol.stdout(io, "{\"guest\":");
        try protocol.writeJsonString(io, mount_disk.guest);
        try protocol.stdout(io, ",\"lowerPath\":");
        try protocol.writeJsonString(io, mount_disk.lower_path);
        try protocol.stdout(io, ",\"upperPath\":");
        try protocol.writeJsonString(io, mount_disk.upper_path);
        try protocol.stdout(io, "}");
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"liveMounts\":[");
    for (registry_shape.live_mounts, 0..) |mount, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.stdout(io, "{\"guest\":");
        try protocol.writeJsonString(io, mount.guest);
        try protocol.stdout(io, ",\"host\":");
        try protocol.writeJsonString(io, mount.host);
        try protocol.stdout(io, ",\"mode\":");
        try protocol.writeJsonString(io, mount.mode);
        try protocol.stdout(io, "}");
    }
    try protocol.stdout(io, "],\"portForward\":");
    try writePortForwardPlan(io, registry_shape.port_forwards, true);
    try protocol.stdout(io, ",\"cpu\":");
    if (registry_shape.cpu) |cpu| {
        try protocol.stdout(io, "{\"maxVcpus\":");
        try writeU64(io, cpu.max_vcpus);
        if (cpu.quota_cpus) |quota| {
            try protocol.stdout(io, ",\"quotaCpus\":");
            try writeF64(io, quota);
        }
        try protocol.stdout(io, ",\"weight\":");
        try writeU64(io, cpu.weight);
        try protocol.stdout(io, ",\"enforcement\":{\"status\":");
        try protocol.writeJsonString(io, cpu.enforcement_status);
        if (cpu.enforcement_reason) |reason| {
            try protocol.stdout(io, ",\"reason\":");
            try protocol.writeJsonString(io, reason);
        }
        try protocol.stdout(io, "}}");
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmstate\":{");
    try protocol.stdout(io, "\"statePath\":");
    try writeNullableJsonString(io, registry_shape.vmstate.state_path);
    try protocol.stdout(io, ",\"chainId\":");
    try writeNullableJsonString(io, registry_shape.vmstate.chain_id);
    try protocol.stdout(io, ",\"checkpointParent\":");
    try writeNullableJsonString(io, registry_shape.vmstate.checkpoint_parent);
    try protocol.stdout(io, ",\"checkpointSequence\":");
    try writeNullableU64(io, registry_shape.vmstate.checkpoint_sequence);
    try protocol.stdout(io, "},\"nested\":");
    try protocol.stdout(io, if (registry_shape.nested) "true" else "false");
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"registryLifecycle\":{");
    try protocol.stdout(io, "\"claimName\":");
    try writeNullableJsonString(io, registry_lifecycle.claim_name);
    try protocol.stdout(io, ",\"shouldWrite\":");
    try protocol.stdout(io, if (registry_lifecycle.should_write) "true" else "false");
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"registryProcess\":{");
    try protocol.stdout(io, "\"vmmExe\":");
    try writeNullableJsonString(io, registry_process.vmm_exe);
    try protocol.stdout(io, ",\"gvproxyExe\":");
    try writeNullableJsonString(io, registry_process.gvproxy_exe);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"machinenConfig\":{");
    try protocol.stdout(io, "\"cmd\":[");
    for (config_cmd, 0..) |arg, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, arg);
    }
    try protocol.stdout(io, "],\"env\":{");
    for (config_env, 0..) |pair, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, pair.key);
        try protocol.stdout(io, ":");
        try protocol.writeJsonString(io, pair.value);
    }
    try protocol.stdout(io, "}");
    if (config_cwd) |cwd| {
        try protocol.stdout(io, ",\"cwd\":");
        try protocol.writeJsonString(io, cwd);
    }
    if (config_live_mounts.len > 0) {
        try protocol.stdout(io, ",\"liveMounts\":[");
        for (config_live_mounts, 0..) |mount, i| {
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
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"virtiofsEnv\":{");
    for (virtiofs_env, 0..) |pair, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, pair.key);
        try protocol.stdout(io, ":");
        try protocol.writeJsonString(io, pair.value);
    }
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"batchLiveMountSyncRequired\":");
    try protocol.stdout(io, if (batch_live_mount_sync.sync_required) "true" else "false");
    try protocol.stdout(io, ",\"restoreLiveMounts\":[");
    for (restore_live_mounts, 0..) |mount, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.stdout(io, "{\"host\":");
        try protocol.writeJsonString(io, mount.host);
        try protocol.stdout(io, ",\"guest\":");
        try protocol.writeJsonString(io, mount.guest);
        if (mount.mode) |mode| {
            try protocol.stdout(io, ",\"mode\":");
            try protocol.writeJsonString(io, mode);
        }
        try protocol.stdout(io, "}");
    }
    try protocol.stdout(io, "]");
    try protocol.stdout(io, ",\"vmmCommand\":");
    if (vmm_argv.command) |command| {
        try protocol.writeJsonString(io, command);
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"vmmArgs\":[");
    for (vmm_argv.args, 0..) |arg, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, arg);
    }
    try protocol.stdout(io, "]");
    try protocol.stdout(io, ",\"usePdeathsig\":");
    try protocol.stdout(io, if (use_pdeathsig) "true" else "false");
    try protocol.stdout(io, ",\"guestHostname\":");
    try writeNullableJsonString(io, guest_hostname);
    try protocol.stdout(io, ",\"guestHostnameSet\":");
    try writeNullableJsonString(io, guest_hostname_set);
    try protocol.stdout(io, ",\"plannedPortForward\":");
    try writePortForwardPlan(io, planned_port_forwards, false);
    try protocol.stdout(io, ",\"portForwardProbe\":[");
    for (port_forward_probe, 0..) |probe, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.stdout(io, "{\"hostPort\":");
        try writeI64(io, probe.host_port);
        try protocol.stdout(io, ",\"probeHost\":");
        try protocol.writeJsonString(io, probe.probe_host);
        try protocol.stdout(io, "}");
    }
    try protocol.stdout(io, "]");
    try protocol.stdout(io, ",\"gvproxyPlan\":{\"action\":");
    try protocol.writeJsonString(io, gvproxy_plan.action);
    try protocol.stdout(io, ",\"gvproxyPath\":");
    try writeNullableJsonString(io, gvproxy_plan.gvproxy_path);
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"vmmEnv\":{");
    for (vmm_env, 0..) |pair, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, pair.key);
        try protocol.stdout(io, ":");
        try protocol.writeJsonString(io, pair.value);
    }
    try protocol.stdout(io, "}");
    try protocol.stdout(io, ",\"mergedGuestEnv\":{");
    for (guest_env, 0..) |pair, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.writeJsonString(io, pair.key);
        try protocol.stdout(io, ":");
        try protocol.writeJsonString(io, pair.value);
    }
    try protocol.stdout(io, "}}}\n");
}

fn writeNullableJsonString(io: std.Io, value: ?[]const u8) !void {
    if (value) |text| {
        try protocol.writeJsonString(io, text);
    } else {
        try protocol.stdout(io, "null");
    }
}

fn writeSnapshotContext(io: std.Io, context: boot_plan.SnapshotContextPlan) !void {
    try protocol.stdout(io, ",\"snapshotContext\":{");
    try protocol.stdout(io, "\"mountDisk\":");
    if (context.mount_disk) |mount| {
        try protocol.stdout(io, "{\"guest\":");
        try protocol.writeJsonString(io, mount.guest);
        try protocol.stdout(io, ",\"lowerPath\":");
        try protocol.writeJsonString(io, mount.lower_path);
        try protocol.stdout(io, ",\"upperPath\":");
        try protocol.writeJsonString(io, mount.upper_path);
        try protocol.stdout(io, "}");
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, ",\"liveMounts\":[");
    for (context.live_mounts, 0..) |mount, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.stdout(io, "{\"host\":");
        try protocol.writeJsonString(io, mount.host);
        try protocol.stdout(io, ",\"guest\":");
        try protocol.writeJsonString(io, mount.guest);
        try protocol.stdout(io, ",\"mode\":");
        try protocol.writeJsonString(io, mount.mode);
        try protocol.stdout(io, "}");
    }
    try protocol.stdout(io, "],\"vmstateChain\":");
    if (context.vmstate_chain) |chain| {
        try protocol.stdout(io, "{\"chainId\":");
        try protocol.writeJsonString(io, chain.chain_id);
        try protocol.stdout(io, ",\"parentDir\":");
        try writeNullableJsonString(io, chain.parent_dir);
        try protocol.stdout(io, ",\"sequence\":");
        try writeU64(io, chain.sequence);
        try protocol.stdout(io, "}");
    } else {
        try protocol.stdout(io, "null");
    }
    try protocol.stdout(io, "}");
}

fn writePortForwardPlan(io: std.Io, mappings: anytype, null_when_empty: bool) !void {
    if (mappings.len == 0 and null_when_empty) {
        try protocol.stdout(io, "null");
        return;
    }
    try protocol.stdout(io, "[");
    for (mappings, 0..) |mapping, i| {
        if (i != 0) try protocol.stdout(io, ",");
        try protocol.stdout(io, "{\"hostPort\":");
        try writeI64(io, mapping.host_port);
        try protocol.stdout(io, ",\"guestPort\":");
        try writeI64(io, mapping.guest_port);
        if (mapping.host_addr) |host_addr| {
            try protocol.stdout(io, ",\"hostAddr\":");
            try protocol.writeJsonString(io, host_addr);
        }
        try protocol.stdout(io, "}");
    }
    try protocol.stdout(io, "]");
}

fn rootDiskModeName(mode: boot_plan.RootDiskMode) []const u8 {
    return switch (mode) {
        .unset => "unset",
        .false_value => "false",
        .path => "path",
        .true_value => "true",
    };
}

fn scratchDiskModeName(mode: boot_plan.ScratchDiskMode) []const u8 {
    return switch (mode) {
        .unset => "unset",
        .false_value => "false",
        .path => "path",
        .auto => "auto",
    };
}

fn writeU64(io: std.Io, number: u64) !void {
    var buf: [32]u8 = undefined;
    try protocol.stdout(io, try std.fmt.bufPrint(&buf, "{d}", .{number}));
}

fn writeI64(io: std.Io, number: i64) !void {
    var buf: [32]u8 = undefined;
    try protocol.stdout(io, try std.fmt.bufPrint(&buf, "{d}", .{number}));
}

fn writeF64(io: std.Io, number: f64) !void {
    var buf: [64]u8 = undefined;
    try protocol.stdout(io, try std.fmt.bufPrint(&buf, "{d}", .{number}));
}

fn writeNullableU64(io: std.Io, value: ?u64) !void {
    if (value) |number| {
        var buf: [32]u8 = undefined;
        try protocol.stdout(io, try std.fmt.bufPrint(&buf, "{d}", .{number}));
    } else {
        try protocol.stdout(io, "null");
    }
}

fn makeGuestEnv(allocator: std.mem.Allocator, parsed: ParsedRequest) ![]boot_plan.EnvPair {
    const env_pairs = try objectStringPairs(allocator, parsed.guest_env, error.InvalidGuestEnvValue);
    return boot_plan.planGuestEnv(allocator, .{
        .env = env_pairs,
        .name = parsed.name,
        .vsock_uds_path = parsed.vsock_uds_path,
    });
}

fn makeVmmEnv(allocator: std.mem.Allocator, parsed: ParsedRequest) ![]boot_plan.EnvPair {
    return boot_plan.planVmmEnv(allocator, .{
        .base = try objectStringPairs(allocator, parsed.vmm_env_base, error.InvalidVmmEnvValue),
        .overrides = try objectStringPairs(allocator, parsed.vmm_env_overrides, error.InvalidVmmEnvValue),
    });
}

fn makeGuestHostname(allocator: std.mem.Allocator, parsed: ParsedRequest) RequestError!?[]const u8 {
    return boot_plan.planGuestHostname(allocator, .{
        .pid = if (parsed.guest_hostname_pid_text) |text| parseSigned(text) catch return error.InvalidGuestHostnamePid else null,
        .name = parsed.guest_hostname_name,
    }) catch return error.InvalidGuestHostnameName;
}

fn makeGuestHostnameSet(allocator: std.mem.Allocator, parsed: ParsedRequest) RequestError!?[]const u8 {
    return boot_plan.planGuestHostnameSet(allocator, .{
        .pid = if (parsed.guest_hostname_set_pid_text) |text| parseSigned(text) catch return error.InvalidGuestHostnameSetPid else null,
        .name = parsed.guest_hostname_set_name,
        .vsock_uds_path = parsed.guest_hostname_set_vsock_uds_path,
        .skip = parsed.guest_hostname_set_skip,
    }) catch return error.InvalidGuestHostnameSetName;
}

fn makeCpuResources(parsed: ParsedRequest) !?boot_plan.CpuResourcesInput {
    const cpu = parsed.resources_cpu orelse return null;
    return .{
        .max_vcpus = if (cpu.max_vcpus_text) |text| parseUnsigned(text) catch return error.InvalidCpuMaxVcpus else null,
        .quota_cpus = if (cpu.quota_cpus_text) |text| parseFloat(text) catch return error.InvalidCpuQuotaCpus else null,
        .weight = if (cpu.weight_text) |text| parseUnsigned(text) catch return error.InvalidCpuWeight else null,
    };
}

fn makeRegistryCpuPolicy(parsed: ParsedRequest) RequestError!?boot_plan.CpuPolicyPlan {
    if (parsed.registry_cpu_policy_max_vcpus_text == null and
        parsed.registry_cpu_policy_quota_cpus_text == null and
        parsed.registry_cpu_policy_weight_text == null)
    {
        return null;
    }
    const max_vcpus_text = parsed.registry_cpu_policy_max_vcpus_text orelse return error.InvalidRegistryCpuPolicy;
    const weight_text = parsed.registry_cpu_policy_weight_text orelse return error.InvalidRegistryCpuPolicy;
    return .{
        .max_vcpus = parseUnsigned(max_vcpus_text) catch return error.InvalidRegistryCpuPolicy,
        .quota_cpus = if (parsed.registry_cpu_policy_quota_cpus_text) |text| parseFloat(text) catch return error.InvalidRegistryCpuPolicy else null,
        .weight = parseUnsigned(weight_text) catch return error.InvalidRegistryCpuPolicy,
    };
}

fn makeConfigEnv(allocator: std.mem.Allocator, parsed: ParsedRequest) ![]boot_plan.EnvPair {
    return objectStringPairs(allocator, parsed.config_env, error.InvalidConfigEnvValue);
}

fn makeBundleEnv(allocator: std.mem.Allocator, parsed: ParsedRequest) ![]boot_plan.EnvPair {
    return boot_plan.planBundleEnv(allocator, .{
        .image_env = try objectStringPairs(allocator, parsed.bundle_image_env, error.InvalidBundleEnvValue),
        .guest_env = try objectStringPairs(allocator, parsed.bundle_guest_env, error.InvalidBundleEnvValue),
    });
}

fn makeProvisionBoot(allocator: std.mem.Allocator, parsed: ParsedRequest) !boot_plan.ProvisionBootPlan {
    return boot_plan.planProvisionBoot(allocator, .{
        .base_path = parsed.provision_base_path,
        .kernel_path = parsed.provision_kernel_path,
        .dtb_path = parsed.provision_dtb_path,
        .uds_path = parsed.provision_uds_path,
        .scratch_disk_path = parsed.provision_scratch_disk_path,
        .root_disk_path = parsed.provision_root_disk_path,
        .vmm_env = try objectStringPairs(allocator, parsed.provision_boot_vmm_env, error.InvalidProvisionBootVmmEnvValue),
    });
}

fn makeProvisionRuntime(allocator: std.mem.Allocator, parsed: ParsedRequest) !boot_plan.ProvisionRuntimePlan {
    return boot_plan.planProvisionRuntime(allocator, .{
        .work_dir = parsed.provision_work_dir,
        .scratch_size_bytes = if (parsed.provision_scratch_size_bytes_text) |text| parseUnsigned(text) catch return error.InvalidProvisionScratchSizeBytes else null,
        .timeout_ms = if (parsed.provision_timeout_ms_text) |text| parseUnsigned(text) catch return error.InvalidProvisionTimeoutMs else null,
    });
}

fn makeProvisionImageConfig(allocator: std.mem.Allocator, parsed: ParsedRequest) !boot_plan.ProvisionImageConfigPlan {
    return boot_plan.planProvisionImageConfig(.{
        .has_cmd = parsed.provision_image_config_has_cmd,
        .cmd = parsed.provision_image_config_cmd,
        .has_env = parsed.provision_image_config_has_env,
        .env = try objectStringPairs(allocator, parsed.provision_image_config_env, error.InvalidProvisionImageConfigEnvValue),
    });
}

fn objectStringPairs(allocator: std.mem.Allocator, object: std.json.ObjectMap, invalid: anyerror) ![]boot_plan.EnvPair {
    var pairs: std.ArrayList(boot_plan.EnvPair) = .empty;
    errdefer pairs.deinit(allocator);
    var it = object.iterator();
    while (it.next()) |entry| {
        if (entry.value_ptr.* != .string) return invalid;
        try pairs.append(allocator, .{ .key = entry.key_ptr.*, .value = entry.value_ptr.string });
    }
    return pairs.toOwnedSlice(allocator);
}

fn makePlanInput(allocator: std.mem.Allocator, io: std.Io, parsed: ParsedRequest) anyerror!boot_plan.Input {
    const explicit_memory = if (parsed.memory_mib_text) |text| try parseMib(text) else null;
    const resources_memory = if (parsed.resources_memory) |memory| boot_plan.ResourcesMemory{
        .max_mib = try parseMib(memory.max_mib_text),
        .reclaim = memory.reclaim,
    } else null;
    const auto_memory = if (parsed.auto_memory_mib_text) |text| try parseMib(text) else null;
    const boot_timeout_ms = if (parsed.boot_timeout_ms_text) |text|
        parseUnsigned(text) catch return error.InvalidBootTimeoutMs
    else
        null;
    const host_total_bytes = if (parsed.host_total_bytes_text) |text|
        parseUnsigned(text) catch return error.InvalidMemory
    else if (explicit_memory == null and resources_memory == null and auto_memory == null and !parsed.vmm_memory_preset)
        (try runtime_helper.host.readHostMemory(allocator, io)).total_bytes
    else
        null;
    return .{
        .memory_mib = explicit_memory,
        .resources_memory = resources_memory,
        .auto_memory_mib = auto_memory,
        .host_total_bytes = host_total_bytes,
        .vmm_memory_preset = parsed.vmm_memory_preset,
        .has_image = parsed.has_image,
        .has_cmd = parsed.has_cmd,
        .has_snapshot = parsed.has_snapshot,
        .root_disk = parsed.root_disk,
        .guest_cwd = parsed.guest_cwd,
        .mount_guest = parsed.mount_guest,
        .boot_timeout_ms = boot_timeout_ms,
        .boot_timeout_forever = parsed.boot_timeout_forever,
    };
}

fn parseMib(text: []const u8) boot_plan.PlanError!u64 {
    const value = parseUnsigned(text) catch return error.InvalidMemory;
    return boot_plan.validateMemoryMib(value);
}

fn parseUnsigned(text: []const u8) !u64 {
    if (text.len == 0) return error.Invalid;
    for (text) |c| {
        if (c < '0' or c > '9') return error.Invalid;
    }
    return std.fmt.parseUnsigned(u64, text, 10);
}

fn parseSigned(text: []const u8) !i64 {
    if (text.len == 0) return error.Invalid;
    var start: usize = 0;
    if (text[0] == '-') {
        if (text.len == 1) return error.Invalid;
        start = 1;
    }
    for (text[start..]) |c| {
        if (c < '0' or c > '9') return error.Invalid;
    }
    return std.fmt.parseInt(i64, text, 10);
}

fn parseFloat(text: []const u8) !f64 {
    if (text.len == 0) return error.Invalid;
    return std.fmt.parseFloat(f64, text);
}

fn parseRequest(allocator: std.mem.Allocator, io: std.Io) RequestError!ParsedRequest {
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
    const protocol_version = envelope.get("protocolVersion") orelse return error.UnsupportedProtocolVersion;
    if (protocol_version != .integer or protocol_version.integer != protocol.version) return error.UnsupportedProtocolVersion;
    const data_value = envelope.get("data") orelse return error.MissingData;
    if (data_value != .object) return error.InvalidData;
    const object = data_value.object;
    try protocol.rejectUnknownFields(object, &.{ "memoryMib", "resourcesMemory", "resourcesCpu", "autoMemoryMib", "hostTotalBytes", "vmmMemoryPreset", "hasImage", "hasCmd", "hasSnapshot", "rootDisk", "rootDiskOptionFalse", "rootDiskOptionTrue", "rootDiskOptionPath", "rootDiskRestorePath", "guestCwd", "mountGuest", "guestEnv", "vmmEnvBase", "vmmEnvOverrides", "name", "vsockUdsPath", "guestHostnamePid", "guestHostnameName", "guestHostnameSetPid", "guestHostnameSetName", "guestHostnameSetVsockUdsPath", "guestHostnameSetSkip", "existingVsockSpec", "autoVsockUdsPath", "autoVsockTempDir", "portForward", "portForwardNetSocket", "gvproxyPlanningRequired", "gvproxyNetSocket", "gvproxyPath", "vmmBinary", "vmmArgs", "pdeathsigPath", "pdeathsig", "detached", "bootTimeoutMs", "bootTimeoutForever", "kernelPath", "dtbPath", "initrdPath", "vmstatePath", "restorePath", "enableVmstateTiming", "existingVmstateTiming", "bootVmstateEngine", "bootVmstateSnapshotDisabled", "bootVmstateExistingTempDir", "bootVmstateStatePath", "bootVmstateTempDir", "bootVmstateChainId", "bootVmstateRestorePath", "bootVmstateForkedFrom", "nested", "liveMounts", "liveMountRemovedOptionIndex", "liveMountRemovedOptionHasCache", "liveMountRemovedOptionHasSync", "liveMountsResolved", "batchLiveMountValidationRequired", "restoreLiveMountsRecorded", "restoreLiveMountsOverrides", "existingStatsFile", "statsFilePath", "statsFileTempDir", "statsFileVsockTempDir", "configCmd", "configEnv", "configGuestCwd", "configImageCwd", "configLiveMounts", "bundleExplicitCmd", "bundleImageCmd", "bundleSnapshotRestore", "bundleVmstateRestore", "bundleLiveMounts", "bundleCommandRequired", "bundleImageEnv", "bundleGuestEnv", "bundleWorkspaceTempDir", "bundleConfigSynthDir", "bundlePackUseTiny", "bundlePackMountGuest", "bundlePackRestoreMountGuest", "provisionGuestCpu", "provisionGuestArchOverride", "provisionHostArch", "provisionDtbExplicit", "provisionCliCacheHome", "provisionCliCacheVersion", "provisionAssetExplicitPath", "provisionAssetExplicitExists", "provisionAssetAssetsDirPath", "provisionAssetAssetsDirExists", "provisionAssetCachePath", "provisionAssetCacheExists", "provisionBasePath", "provisionKernelPath", "provisionDtbPath", "provisionUdsPath", "provisionScratchDiskPath", "provisionRootDiskPath", "provisionBootVmmEnv", "provisionRepackDiskPath", "provisionRepackOutPath", "provisionRepackExtractDir", "provisionImageConfigHasCmd", "provisionImageConfigCmd", "provisionImageConfigHasEnv", "provisionImageConfigEnv", "provisionWorkDir", "provisionScratchSizeBytes", "provisionTimeoutMs", "scratchOptionFalse", "scratchOptionPath", "scratchMode", "scratchSnapshotPath", "scratchRestoreClonePath", "scratchAutoPath", "rootDiskRuntimeMode", "rootDiskSourcePath", "rootDiskClonePath", "rootDiskMaterializeRestorePath", "rootDiskMaterializeCallerPath", "mountDiskUpperSizeOption", "mountDiskRuntimeMode", "mountDiskLowerPath", "mountDiskUpperPath", "mountDiskSourceUpperPath", "mountDiskGuest", "mountDiskUpperSize", "mountDiskLowerFd", "mountDiskUpperFd", "snapshotMountGuest", "snapshotMountLowerPath", "snapshotMountUpperPath", "snapshotLiveMounts", "snapshotVmstatePath", "snapshotVmstateChainId", "snapshotVmstateCheckpointParent", "snapshotVmstateCheckpointSequence", "snapshotBackingEngine", "snapshotBackingAction", "snapshotBackingDiskPath", "snapshotBackingVmstatePath", "registrySourceImagePath", "registryDiskPath", "registryForkedFrom", "registryMemoryCeilingMib", "registryStatsPath", "registryPerBootRootDisk", "registryCallerRootDiskPath", "registryBootLogRoot", "registryChildPid", "registryDetached", "registryLifecycleName", "registryLifecycleVsockUdsPath", "registryPerBootSnapDisk", "registryPerBootMountUpper", "registryBundleTempDir", "registryVsockTempDir", "registryStatsTempDir", "registryGvSocketDir", "registryCpuCgroupPath", "registryCpuPolicyMaxVcpus", "registryCpuPolicyQuotaCpus", "registryCpuPolicyWeight", "registryCpuControlStatus", "registryCpuControlReason", "registryVmstatePath", "registryVmstateChainId", "registryVmstateCheckpointParent", "registryVmstateCheckpointSequence", "registryNested", "registryMountGuest", "registryMountLowerPath", "registryMountUpperPath", "registryHostPlatform", "registryVmmBinary", "registryVmmPdeathsig", "registryVmmObservedExeBase", "registryGvPid", "registryGvExe", "registryGvObservedExeBase" });
    return .{
        .memory_mib_text = try optionalString(object, "memoryMib", error.MissingMemoryMib, error.InvalidMemoryMib),
        .resources_memory = try optionalResourcesMemory(object),
        .resources_cpu = try optionalResourcesCpu(object),
        .auto_memory_mib_text = try optionalString(object, "autoMemoryMib", error.MissingAutoMemoryMib, error.InvalidAutoMemoryMib),
        .host_total_bytes_text = try optionalString(object, "hostTotalBytes", error.MissingHostTotalBytes, error.InvalidHostTotalBytes),
        .vmm_memory_preset = try requiredBool(object, "vmmMemoryPreset", error.MissingVmmMemoryPreset, error.InvalidVmmMemoryPreset),
        .has_image = try requiredBool(object, "hasImage", error.MissingHasImage, error.InvalidHasImage),
        .has_cmd = try requiredBool(object, "hasCmd", error.MissingHasCmd, error.InvalidHasCmd),
        .has_snapshot = try optionalBoolDefaultFalse(object, "hasSnapshot", error.InvalidHasSnapshot),
        .root_disk = try requiredRootDisk(object),
        .root_disk_option_false = try optionalBoolDefaultFalse(object, "rootDiskOptionFalse", error.InvalidRootDiskOptionFalse),
        .root_disk_option_true = try optionalBoolDefaultFalse(object, "rootDiskOptionTrue", error.InvalidRootDiskOptionTrue),
        .root_disk_option_path = try optionalStringDefaultNull(object, "rootDiskOptionPath", error.InvalidRootDiskOptionPath),
        .root_disk_restore_path = try optionalStringDefaultNull(object, "rootDiskRestorePath", error.InvalidRootDiskRestorePath),
        .guest_cwd = try optionalStringDefaultNull(object, "guestCwd", error.InvalidGuestCwd),
        .mount_guest = try optionalStringDefaultNull(object, "mountGuest", error.InvalidMountGuest),
        .guest_env = try optionalObjectDefaultEmpty(object, "guestEnv", error.InvalidGuestEnv),
        .vmm_env_base = try optionalObjectDefaultEmpty(object, "vmmEnvBase", error.InvalidVmmEnvBase),
        .vmm_env_overrides = try optionalObjectDefaultEmpty(object, "vmmEnvOverrides", error.InvalidVmmEnvOverrides),
        .name = try optionalStringDefaultNull(object, "name", error.InvalidName),
        .vsock_uds_path = try optionalStringDefaultNull(object, "vsockUdsPath", error.InvalidVsockUdsPath),
        .guest_hostname_pid_text = try optionalStringDefaultNull(object, "guestHostnamePid", error.InvalidGuestHostnamePid),
        .guest_hostname_name = try optionalStringDefaultNull(object, "guestHostnameName", error.InvalidGuestHostnameName),
        .guest_hostname_set_pid_text = try optionalStringDefaultNull(object, "guestHostnameSetPid", error.InvalidGuestHostnameSetPid),
        .guest_hostname_set_name = try optionalStringDefaultNull(object, "guestHostnameSetName", error.InvalidGuestHostnameSetName),
        .guest_hostname_set_vsock_uds_path = try optionalStringDefaultNull(object, "guestHostnameSetVsockUdsPath", error.InvalidGuestHostnameSetVsockUdsPath),
        .guest_hostname_set_skip = try optionalBoolDefaultFalse(object, "guestHostnameSetSkip", error.InvalidGuestHostnameSetSkip),
        .existing_vsock_spec = try optionalStringDefaultNull(object, "existingVsockSpec", error.InvalidExistingVsockSpec),
        .auto_vsock_uds_path = try optionalStringDefaultNull(object, "autoVsockUdsPath", error.InvalidAutoVsockUdsPath),
        .auto_vsock_temp_dir = try optionalStringDefaultNull(object, "autoVsockTempDir", error.InvalidAutoVsockTempDir),
        .port_forward = try optionalPortForward(allocator, object),
        .port_forward_net_socket = try optionalStringDefaultNull(object, "portForwardNetSocket", error.InvalidPortForwardNetSocket),
        .gvproxy_planning_required = try optionalBoolDefaultFalse(object, "gvproxyPlanningRequired", error.InvalidGvproxyPlanningRequired),
        .gvproxy_net_socket = try optionalStringDefaultNull(object, "gvproxyNetSocket", error.InvalidGvproxyNetSocket),
        .gvproxy_path = try optionalStringDefaultNull(object, "gvproxyPath", error.InvalidGvproxyPath),
        .vmm_binary = try optionalStringDefaultNull(object, "vmmBinary", error.InvalidVmmBinary),
        .vmm_args = try optionalStringArrayDefaultEmpty(allocator, object, "vmmArgs", error.InvalidVmmArgs),
        .pdeathsig_path = try optionalStringDefaultNull(object, "pdeathsigPath", error.InvalidPdeathsigPath),
        .pdeathsig_requested = try optionalBoolDefaultNull(object, "pdeathsig", error.InvalidPdeathsig),
        .detached_requested = try optionalBoolDefaultFalse(object, "detached", error.InvalidDetached),
        .boot_timeout_ms_text = try optionalStringDefaultNull(object, "bootTimeoutMs", error.InvalidBootTimeoutMs),
        .boot_timeout_forever = try optionalBoolDefaultFalse(object, "bootTimeoutForever", error.InvalidBootTimeoutForever),
        .kernel_path = try optionalStringDefaultNull(object, "kernelPath", error.InvalidKernelPath),
        .dtb_path = try optionalStringDefaultNull(object, "dtbPath", error.InvalidDtbPath),
        .initrd_path = try optionalStringDefaultNull(object, "initrdPath", error.InvalidInitrdPath),
        .vmstate_path = try optionalStringDefaultNull(object, "vmstatePath", error.InvalidVmstatePath),
        .restore_path = try optionalStringDefaultNull(object, "restorePath", error.InvalidRestorePath),
        .enable_vmstate_timing = try optionalBoolDefaultFalse(object, "enableVmstateTiming", error.InvalidEnableVmstateTiming),
        .existing_vmstate_timing = try optionalStringDefaultNull(object, "existingVmstateTiming", error.InvalidExistingVmstateTiming),
        .boot_vmstate_engine = try optionalStringDefaultNull(object, "bootVmstateEngine", error.InvalidBootVmstateEngine),
        .boot_vmstate_snapshot_disabled = try optionalBoolDefaultFalse(object, "bootVmstateSnapshotDisabled", error.InvalidBootVmstateSnapshotDisabled),
        .boot_vmstate_existing_temp_dir = try optionalStringDefaultNull(object, "bootVmstateExistingTempDir", error.InvalidBootVmstateExistingTempDir),
        .boot_vmstate_state_path = try optionalStringDefaultNull(object, "bootVmstateStatePath", error.InvalidBootVmstateStatePath),
        .boot_vmstate_temp_dir = try optionalStringDefaultNull(object, "bootVmstateTempDir", error.InvalidBootVmstateTempDir),
        .boot_vmstate_chain_id = try optionalStringDefaultNull(object, "bootVmstateChainId", error.InvalidBootVmstateChainId),
        .boot_vmstate_restore_path = try optionalStringDefaultNull(object, "bootVmstateRestorePath", error.InvalidBootVmstateRestorePath),
        .boot_vmstate_forked_from = try optionalStringDefaultNull(object, "bootVmstateForkedFrom", error.InvalidBootVmstateForkedFrom),
        .nested_requested = try optionalBoolDefaultFalse(object, "nested", error.InvalidNested),
        .live_mounts = try optionalLiveMounts(allocator, object),
        .live_mount_removed_option_index_text = try optionalStringDefaultNull(object, "liveMountRemovedOptionIndex", error.InvalidLiveMountRemovedOptionIndex),
        .live_mount_removed_option_has_cache = try optionalBoolDefaultFalse(object, "liveMountRemovedOptionHasCache", error.InvalidLiveMountRemovedOptionHasCache),
        .live_mount_removed_option_has_sync = try optionalBoolDefaultFalse(object, "liveMountRemovedOptionHasSync", error.InvalidLiveMountRemovedOptionHasSync),
        .live_mounts_resolved = try optionalLiveMountsResolved(allocator, object),
        .batch_live_mount_validation_required = try optionalBoolDefaultFalse(object, "batchLiveMountValidationRequired", error.InvalidBatchLiveMountValidationRequired),
        .restore_live_mounts_recorded = try optionalRestoreLiveMountsRecorded(allocator, object),
        .restore_live_mounts_overrides = try optionalRestoreLiveMountsOverrides(allocator, object),
        .existing_stats_file = try optionalStringDefaultNull(object, "existingStatsFile", error.InvalidExistingStatsFile),
        .stats_file_path = try optionalStringDefaultNull(object, "statsFilePath", error.InvalidStatsFilePath),
        .stats_file_temp_dir = try optionalStringDefaultNull(object, "statsFileTempDir", error.InvalidStatsFileTempDir),
        .stats_file_vsock_temp_dir = try optionalStringDefaultNull(object, "statsFileVsockTempDir", error.InvalidStatsFileVsockTempDir),
        .config_cmd = try optionalStringArrayDefaultEmpty(allocator, object, "configCmd", error.InvalidConfigCmd),
        .config_env = try optionalObjectDefaultEmpty(object, "configEnv", error.InvalidConfigEnv),
        .config_guest_cwd = try optionalStringDefaultNull(object, "configGuestCwd", error.InvalidConfigGuestCwd),
        .config_image_cwd = try optionalStringDefaultNull(object, "configImageCwd", error.InvalidConfigImageCwd),
        .config_live_mounts = try optionalLiveMountsResolvedField(allocator, object, "configLiveMounts", error.InvalidConfigLiveMounts),
        .bundle_explicit_cmd = try optionalStringArrayDefaultNull(allocator, object, "bundleExplicitCmd", error.InvalidBundleExplicitCmd),
        .bundle_image_cmd = try optionalStringArrayDefaultNull(allocator, object, "bundleImageCmd", error.InvalidBundleImageCmd),
        .bundle_snapshot_restore = try optionalBoolDefaultFalse(object, "bundleSnapshotRestore", error.InvalidBundleSnapshotRestore),
        .bundle_vmstate_restore = try optionalBoolDefaultFalse(object, "bundleVmstateRestore", error.InvalidBundleVmstateRestore),
        .bundle_live_mounts = try optionalLiveMountsResolvedField(allocator, object, "bundleLiveMounts", error.InvalidBundleLiveMounts),
        .bundle_command_requested = (try optionalBoolDefaultFalse(object, "bundleCommandRequired", error.InvalidBundleCommandRequired)) or hasBundleCommandField(object),
        .bundle_image_env = try optionalObjectDefaultEmpty(object, "bundleImageEnv", error.InvalidBundleImageEnv),
        .bundle_guest_env = try optionalObjectDefaultEmpty(object, "bundleGuestEnv", error.InvalidBundleGuestEnv),
        .bundle_workspace_temp_dir = try optionalStringDefaultNull(object, "bundleWorkspaceTempDir", error.InvalidBundleWorkspaceTempDir),
        .bundle_config_synth_dir = try optionalStringDefaultNull(object, "bundleConfigSynthDir", error.InvalidBundleConfigSynthDir),
        .bundle_pack_use_tiny = try optionalBoolDefaultFalse(object, "bundlePackUseTiny", error.InvalidBundlePackUseTiny),
        .bundle_pack_mount_guest = try optionalStringDefaultNull(object, "bundlePackMountGuest", error.InvalidBundlePackMountGuest),
        .bundle_pack_restore_mount_guest = try optionalStringDefaultNull(object, "bundlePackRestoreMountGuest", error.InvalidBundlePackRestoreMountGuest),
        .provision_guest_cpu = try optionalProvisionGuestCpu(object),
        .provision_guest_arch_override = try optionalStringDefaultNull(object, "provisionGuestArchOverride", error.InvalidProvisionGuestArchOverride),
        .provision_host_arch = try optionalStringDefaultNull(object, "provisionHostArch", error.InvalidProvisionHostArch),
        .provision_dtb_explicit = try optionalBoolDefaultFalse(object, "provisionDtbExplicit", error.InvalidProvisionDtbExplicit),
        .provision_cli_cache_home = try optionalStringDefaultNull(object, "provisionCliCacheHome", error.InvalidProvisionCliCacheHome),
        .provision_cli_cache_version = try optionalStringDefaultNull(object, "provisionCliCacheVersion", error.InvalidProvisionCliCacheVersion),
        .provision_asset_explicit_path = try optionalStringDefaultNull(object, "provisionAssetExplicitPath", error.InvalidProvisionAssetExplicitPath),
        .provision_asset_explicit_exists = try optionalBoolDefaultNull(object, "provisionAssetExplicitExists", error.InvalidProvisionAssetExplicitExists),
        .provision_asset_assets_dir_path = try optionalStringDefaultNull(object, "provisionAssetAssetsDirPath", error.InvalidProvisionAssetAssetsDirPath),
        .provision_asset_assets_dir_exists = try optionalBoolDefaultNull(object, "provisionAssetAssetsDirExists", error.InvalidProvisionAssetAssetsDirExists),
        .provision_asset_cache_path = try optionalStringDefaultNull(object, "provisionAssetCachePath", error.InvalidProvisionAssetCachePath),
        .provision_asset_cache_exists = try optionalBoolDefaultNull(object, "provisionAssetCacheExists", error.InvalidProvisionAssetCacheExists),
        .provision_base_path = try optionalStringDefaultNull(object, "provisionBasePath", error.InvalidProvisionBasePath),
        .provision_kernel_path = try optionalStringDefaultNull(object, "provisionKernelPath", error.InvalidProvisionKernelPath),
        .provision_dtb_path = try optionalStringDefaultNull(object, "provisionDtbPath", error.InvalidProvisionDtbPath),
        .provision_uds_path = try optionalStringDefaultNull(object, "provisionUdsPath", error.InvalidProvisionUdsPath),
        .provision_scratch_disk_path = try optionalStringDefaultNull(object, "provisionScratchDiskPath", error.InvalidProvisionScratchDiskPath),
        .provision_root_disk_path = try optionalStringDefaultNull(object, "provisionRootDiskPath", error.InvalidProvisionRootDiskPath),
        .provision_boot_vmm_env = try optionalObjectDefaultEmpty(object, "provisionBootVmmEnv", error.InvalidProvisionBootVmmEnv),
        .provision_repack_disk_path = try optionalStringDefaultNull(object, "provisionRepackDiskPath", error.InvalidProvisionRepackDiskPath),
        .provision_repack_out_path = try optionalStringDefaultNull(object, "provisionRepackOutPath", error.InvalidProvisionRepackOutPath),
        .provision_repack_extract_dir = try optionalStringDefaultNull(object, "provisionRepackExtractDir", error.InvalidProvisionRepackExtractDir),
        .provision_image_config_has_cmd = try optionalBoolDefaultFalse(object, "provisionImageConfigHasCmd", error.InvalidProvisionImageConfigHasCmd),
        .provision_image_config_cmd = try optionalStringArrayDefaultEmpty(allocator, object, "provisionImageConfigCmd", error.InvalidProvisionImageConfigCmd),
        .provision_image_config_has_env = try optionalBoolDefaultFalse(object, "provisionImageConfigHasEnv", error.InvalidProvisionImageConfigHasEnv),
        .provision_image_config_env = try optionalObjectDefaultEmpty(object, "provisionImageConfigEnv", error.InvalidProvisionImageConfigEnv),
        .provision_work_dir = try optionalStringDefaultNull(object, "provisionWorkDir", error.InvalidProvisionWorkDir),
        .provision_scratch_size_bytes_text = try optionalStringDefaultNull(object, "provisionScratchSizeBytes", error.InvalidProvisionScratchSizeBytes),
        .provision_timeout_ms_text = try optionalStringDefaultNull(object, "provisionTimeoutMs", error.InvalidProvisionTimeoutMs),
        .scratch_option_false = try optionalBoolDefaultFalse(object, "scratchOptionFalse", error.InvalidScratchOptionFalse),
        .scratch_option_path = try optionalStringDefaultNull(object, "scratchOptionPath", error.InvalidScratchOptionPath),
        .scratch_mode = try optionalScratchMode(object),
        .scratch_snapshot_path = try optionalStringDefaultNull(object, "scratchSnapshotPath", error.InvalidScratchSnapshotPath),
        .scratch_restore_clone_path = try optionalStringDefaultNull(object, "scratchRestoreClonePath", error.InvalidScratchRestoreClonePath),
        .scratch_auto_path = try optionalStringDefaultNull(object, "scratchAutoPath", error.InvalidScratchAutoPath),
        .root_disk_runtime_mode = try optionalRootDiskRuntimeMode(object),
        .root_disk_source_path = try optionalStringDefaultNull(object, "rootDiskSourcePath", error.InvalidRootDiskSourcePath),
        .root_disk_clone_path = try optionalStringDefaultNull(object, "rootDiskClonePath", error.InvalidRootDiskClonePath),
        .root_disk_materialize_restore_path = try optionalStringDefaultNull(object, "rootDiskMaterializeRestorePath", error.InvalidRootDiskMaterializeRestorePath),
        .root_disk_materialize_caller_path = try optionalStringDefaultNull(object, "rootDiskMaterializeCallerPath", error.InvalidRootDiskMaterializeCallerPath),
        .mount_disk_upper_size_option_text = try optionalStringDefaultNull(object, "mountDiskUpperSizeOption", error.InvalidMountDiskUpperSizeOption),
        .mount_disk_runtime_mode = try optionalMountDiskRuntimeMode(object),
        .mount_disk_lower_path = try optionalStringDefaultNull(object, "mountDiskLowerPath", error.InvalidMountDiskLowerPath),
        .mount_disk_upper_path = try optionalStringDefaultNull(object, "mountDiskUpperPath", error.InvalidMountDiskUpperPath),
        .mount_disk_source_upper_path = try optionalStringDefaultNull(object, "mountDiskSourceUpperPath", error.InvalidMountDiskSourceUpperPath),
        .mount_disk_guest = try optionalStringDefaultNull(object, "mountDiskGuest", error.InvalidMountDiskGuest),
        .mount_disk_upper_size_text = try optionalStringDefaultNull(object, "mountDiskUpperSize", error.InvalidMountDiskUpperSize),
        .mount_disk_lower_fd_text = try optionalStringDefaultNull(object, "mountDiskLowerFd", error.InvalidMountDiskLowerFd),
        .mount_disk_upper_fd_text = try optionalStringDefaultNull(object, "mountDiskUpperFd", error.InvalidMountDiskUpperFd),
        .snapshot_mount_guest = try optionalStringDefaultNull(object, "snapshotMountGuest", error.InvalidSnapshotMountGuest),
        .snapshot_mount_lower_path = try optionalStringDefaultNull(object, "snapshotMountLowerPath", error.InvalidSnapshotMountLowerPath),
        .snapshot_mount_upper_path = try optionalStringDefaultNull(object, "snapshotMountUpperPath", error.InvalidSnapshotMountUpperPath),
        .snapshot_live_mounts = try optionalLiveMountsResolvedField(allocator, object, "snapshotLiveMounts", error.InvalidSnapshotLiveMounts),
        .snapshot_vmstate_path = try optionalStringDefaultNull(object, "snapshotVmstatePath", error.InvalidSnapshotVmstatePath),
        .snapshot_vmstate_chain_id = try optionalStringDefaultNull(object, "snapshotVmstateChainId", error.InvalidSnapshotVmstateChainId),
        .snapshot_vmstate_checkpoint_parent = try optionalStringDefaultNull(object, "snapshotVmstateCheckpointParent", error.InvalidSnapshotVmstateCheckpointParent),
        .snapshot_vmstate_checkpoint_sequence_text = try optionalStringDefaultNull(object, "snapshotVmstateCheckpointSequence", error.InvalidSnapshotVmstateCheckpointSequence),
        .snapshot_backing_engine = try optionalStringDefaultNull(object, "snapshotBackingEngine", error.InvalidSnapshotBackingEngine),
        .snapshot_backing_action = try optionalStringDefaultNull(object, "snapshotBackingAction", error.InvalidSnapshotBackingAction),
        .snapshot_backing_disk_path = try optionalStringDefaultNull(object, "snapshotBackingDiskPath", error.InvalidSnapshotBackingDiskPath),
        .snapshot_backing_vmstate_path = try optionalStringDefaultNull(object, "snapshotBackingVmstatePath", error.InvalidSnapshotBackingVmstatePath),
        .registry_source_image_path = try optionalStringDefaultNull(object, "registrySourceImagePath", error.InvalidRegistrySourceImagePath),
        .registry_disk_path = try optionalStringDefaultNull(object, "registryDiskPath", error.InvalidRegistryDiskPath),
        .registry_forked_from = try optionalStringDefaultNull(object, "registryForkedFrom", error.InvalidRegistryForkedFrom),
        .registry_memory_ceiling_mib_text = try optionalStringDefaultNull(object, "registryMemoryCeilingMib", error.InvalidRegistryMemoryCeilingMib),
        .registry_stats_path = try optionalStringDefaultNull(object, "registryStatsPath", error.InvalidRegistryStatsPath),
        .registry_per_boot_root_disk = try optionalStringDefaultNull(object, "registryPerBootRootDisk", error.InvalidRegistryRootDiskPath),
        .registry_caller_root_disk_path = try optionalStringDefaultNull(object, "registryCallerRootDiskPath", error.InvalidRegistryRootDiskPath),
        .registry_boot_log_root = try optionalStringDefaultNull(object, "registryBootLogRoot", error.InvalidRegistryBootLogRoot),
        .registry_child_pid_text = try optionalStringDefaultNull(object, "registryChildPid", error.InvalidRegistryChildPid),
        .registry_detached = try optionalBoolDefaultFalse(object, "registryDetached", error.InvalidRegistryDetached),
        .registry_lifecycle_name = try optionalStringDefaultNull(object, "registryLifecycleName", error.InvalidRegistryLifecycleName),
        .registry_lifecycle_vsock_uds_path = try optionalStringDefaultNull(object, "registryLifecycleVsockUdsPath", error.InvalidRegistryLifecycleVsockUdsPath),
        .registry_per_boot_snap_disk = try optionalStringDefaultNull(object, "registryPerBootSnapDisk", error.InvalidRegistryCleanupPath),
        .registry_per_boot_mount_upper = try optionalStringDefaultNull(object, "registryPerBootMountUpper", error.InvalidRegistryCleanupPath),
        .registry_bundle_temp_dir = try optionalStringDefaultNull(object, "registryBundleTempDir", error.InvalidRegistryCleanupPath),
        .registry_vsock_temp_dir = try optionalStringDefaultNull(object, "registryVsockTempDir", error.InvalidRegistryCleanupPath),
        .registry_stats_temp_dir = try optionalStringDefaultNull(object, "registryStatsTempDir", error.InvalidRegistryCleanupPath),
        .registry_gv_socket_dir = try optionalStringDefaultNull(object, "registryGvSocketDir", error.InvalidRegistryCleanupPath),
        .registry_cpu_cgroup_path = try optionalStringDefaultNull(object, "registryCpuCgroupPath", error.InvalidRegistryCleanupPath),
        .registry_cpu_policy_max_vcpus_text = try optionalStringDefaultNull(object, "registryCpuPolicyMaxVcpus", error.InvalidRegistryCpuPolicy),
        .registry_cpu_policy_quota_cpus_text = try optionalStringDefaultNull(object, "registryCpuPolicyQuotaCpus", error.InvalidRegistryCpuPolicy),
        .registry_cpu_policy_weight_text = try optionalStringDefaultNull(object, "registryCpuPolicyWeight", error.InvalidRegistryCpuPolicy),
        .registry_cpu_control_status = try optionalRegistryCpuControlStatus(object),
        .registry_cpu_control_reason = try optionalStringDefaultNull(object, "registryCpuControlReason", error.InvalidRegistryCpuControlReason),
        .registry_vmstate_path = try optionalStringDefaultNull(object, "registryVmstatePath", error.InvalidRegistryVmstatePath),
        .registry_vmstate_chain_id = try optionalStringDefaultNull(object, "registryVmstateChainId", error.InvalidRegistryVmstateChainId),
        .registry_vmstate_checkpoint_parent = try optionalStringDefaultNull(object, "registryVmstateCheckpointParent", error.InvalidRegistryVmstateCheckpointParent),
        .registry_vmstate_checkpoint_sequence_text = try optionalStringDefaultNull(object, "registryVmstateCheckpointSequence", error.InvalidRegistryVmstateCheckpointSequence),
        .registry_nested = try optionalBoolDefaultFalse(object, "registryNested", error.InvalidRegistryNested),
        .registry_mount_guest = try optionalStringDefaultNull(object, "registryMountGuest", error.InvalidRegistryMountGuest),
        .registry_mount_lower_path = try optionalStringDefaultNull(object, "registryMountLowerPath", error.InvalidRegistryMountLowerPath),
        .registry_mount_upper_path = try optionalStringDefaultNull(object, "registryMountUpperPath", error.InvalidRegistryMountUpperPath),
        .registry_host_platform = try optionalStringDefaultNull(object, "registryHostPlatform", error.InvalidRegistryHostPlatform),
        .registry_vmm_binary = try optionalStringDefaultNull(object, "registryVmmBinary", error.InvalidRegistryVmmBinary),
        .registry_vmm_pdeathsig = try optionalBoolDefaultFalse(object, "registryVmmPdeathsig", error.InvalidRegistryVmmPdeathsig),
        .registry_vmm_observed_exe_base = try optionalStringDefaultNull(object, "registryVmmObservedExeBase", error.InvalidRegistryVmmObservedExeBase),
        .registry_gv_pid_text = try optionalStringDefaultNull(object, "registryGvPid", error.InvalidRegistryGvPid),
        .registry_gv_exe = try optionalStringDefaultNull(object, "registryGvExe", error.InvalidRegistryGvExe),
        .registry_gv_observed_exe_base = try optionalStringDefaultNull(object, "registryGvObservedExeBase", error.InvalidRegistryGvObservedExeBase),
    };
}

fn hasBundleCommandField(object: std.json.ObjectMap) bool {
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

fn optionalScratchMode(object: std.json.ObjectMap) RequestError!boot_plan.ScratchDiskMode {
    const value = object.get("scratchMode") orelse return .unset;
    if (value == .null) return .unset;
    if (value != .string) return error.InvalidScratchMode;
    if (std.mem.eql(u8, value.string, "false")) return .false_value;
    if (std.mem.eql(u8, value.string, "path")) return .path;
    if (std.mem.eql(u8, value.string, "auto")) return .auto;
    return error.InvalidScratchMode;
}

fn optionalProvisionGuestCpu(object: std.json.ObjectMap) RequestError!?boot_plan.ProvisionGuestCpu {
    const value = object.get("provisionGuestCpu") orelse return null;
    if (value == .null) return null;
    if (value != .string) return error.InvalidProvisionGuestCpu;
    if (std.mem.eql(u8, value.string, "arm64")) return .arm64;
    if (std.mem.eql(u8, value.string, "amd64")) return .amd64;
    return error.InvalidProvisionGuestCpu;
}

fn optionalRootDiskRuntimeMode(object: std.json.ObjectMap) RequestError!boot_plan.RootDiskRuntimeMode {
    const value = object.get("rootDiskRuntimeMode") orelse return .none;
    if (value == .null) return .none;
    if (value != .string) return error.InvalidRootDiskRuntimeMode;
    if (std.mem.eql(u8, value.string, "none")) return .none;
    if (std.mem.eql(u8, value.string, "path")) return .path;
    if (std.mem.eql(u8, value.string, "restore")) return .restore;
    if (std.mem.eql(u8, value.string, "cached")) return .cached;
    return error.InvalidRootDiskRuntimeMode;
}

fn optionalMountDiskRuntimeMode(object: std.json.ObjectMap) RequestError!boot_plan.MountDiskRuntimeMode {
    const value = object.get("mountDiskRuntimeMode") orelse return .none;
    if (value == .null) return .none;
    if (value != .string) return error.InvalidMountDiskRuntimeMode;
    if (std.mem.eql(u8, value.string, "none")) return .none;
    if (std.mem.eql(u8, value.string, "restore")) return .restore;
    if (std.mem.eql(u8, value.string, "fresh")) return .fresh;
    return error.InvalidMountDiskRuntimeMode;
}

fn optionalLiveMounts(allocator: std.mem.Allocator, object: std.json.ObjectMap) RequestError![]const boot_plan.LiveMountInput {
    const value = object.get("liveMounts") orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return error.InvalidLiveMounts;
    var mounts: std.ArrayList(boot_plan.LiveMountInput) = .empty;
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

fn optionalLiveMountsResolved(allocator: std.mem.Allocator, object: std.json.ObjectMap) RequestError![]const boot_plan.LiveMount {
    return optionalLiveMountsResolvedField(allocator, object, "liveMountsResolved", error.InvalidLiveMountsResolved);
}

fn optionalLiveMountsResolvedField(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError![]const boot_plan.LiveMount {
    const value = object.get(field) orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return invalid;
    var mounts: std.ArrayList(boot_plan.LiveMount) = .empty;
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
        if (!std.mem.eql(u8, mode.string, "ro") and !std.mem.eql(u8, mode.string, "rw")) return error.InvalidLiveMountMode;
        if (tag != .string) return error.InvalidLiveMountTag;
        try mounts.append(allocator, .{ .host = host.string, .guest = guest.string, .mode = mode.string, .tag = tag.string });
    }
    return mounts.toOwnedSlice(allocator);
}

fn optionalRestoreLiveMountsRecorded(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
) RequestError![]const boot_plan.RestoreRecordedLiveMount {
    const value = object.get("restoreLiveMountsRecorded") orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return error.InvalidRestoreLiveMountsRecorded;
    var mounts: std.ArrayList(boot_plan.RestoreRecordedLiveMount) = .empty;
    errdefer mounts.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .object) return error.InvalidRestoreLiveMountsRecorded;
        const host = item.object.get("host") orelse return error.InvalidRestoreLiveMountsRecorded;
        const guest = item.object.get("guest") orelse return error.InvalidRestoreLiveMountsRecorded;
        const mode = item.object.get("mode") orelse return error.InvalidRestoreLiveMountsRecorded;
        if (host != .string or guest != .string or mode != .string or !isLiveMountMode(mode.string)) return error.InvalidRestoreLiveMountsRecorded;
        try mounts.append(allocator, .{ .host = host.string, .guest = guest.string, .mode = mode.string });
    }
    return mounts.toOwnedSlice(allocator);
}

fn optionalRestoreLiveMountsOverrides(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
) RequestError![]const boot_plan.RestoreLiveMountInput {
    const value = object.get("restoreLiveMountsOverrides") orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return error.InvalidRestoreLiveMountsOverrides;
    var mounts: std.ArrayList(boot_plan.RestoreLiveMountInput) = .empty;
    errdefer mounts.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .object) return error.InvalidRestoreLiveMountsOverrides;
        const host = item.object.get("host") orelse return error.InvalidRestoreLiveMountsOverrides;
        const guest = item.object.get("guest") orelse return error.InvalidRestoreLiveMountsOverrides;
        const mode = item.object.get("mode") orelse .null;
        if (host != .string or guest != .string) return error.InvalidRestoreLiveMountsOverrides;
        if (mode != .null and (mode != .string or !isLiveMountMode(mode.string))) return error.InvalidRestoreLiveMountsOverrides;
        try mounts.append(allocator, .{ .host = host.string, .guest = guest.string, .mode = if (mode == .string) mode.string else null });
    }
    return mounts.toOwnedSlice(allocator);
}

fn isLiveMountMode(mode: []const u8) bool {
    return std.mem.eql(u8, mode, "ro") or std.mem.eql(u8, mode, "rw");
}

fn optionalBoolDefaultFalse(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!bool {
    const value = object.get(field) orelse return false;
    return switch (value) {
        .bool => |b| b,
        else => invalid,
    };
}

fn optionalBoolDefaultNull(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!?bool {
    const value = object.get(field) orelse return null;
    if (value == .null) return null;
    return switch (value) {
        .bool => |b| b,
        else => invalid,
    };
}

fn optionalStringArrayDefaultNull(
    allocator: std.mem.Allocator,
    object: std.json.ObjectMap,
    field: []const u8,
    invalid: RequestError,
) RequestError!?[]const []const u8 {
    const value = object.get(field) orelse return null;
    if (value == .null) return null;
    if (value != .array) return invalid;
    const array = try stringArrayFromJson(allocator, value, invalid);
    return array;
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
    return stringArrayFromJson(allocator, value, invalid);
}

fn stringArrayFromJson(allocator: std.mem.Allocator, value: std.json.Value, invalid: RequestError) RequestError![]const []const u8 {
    var out: std.ArrayList([]const u8) = .empty;
    errdefer out.deinit(allocator);
    for (value.array.items) |item| {
        if (item != .string) return invalid;
        try out.append(allocator, item.string);
    }
    return out.toOwnedSlice(allocator);
}

fn optionalPortForward(allocator: std.mem.Allocator, object: std.json.ObjectMap) RequestError![]const boot_plan.PortForwardMapping {
    const value = object.get("portForward") orelse return &.{};
    if (value == .null) return &.{};
    if (value != .array) return error.InvalidPortForward;
    var mappings: std.ArrayList(boot_plan.PortForwardMapping) = .empty;
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

fn requiredPort(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!i64 {
    const value = object.get(field) orelse return invalid;
    return switch (value) {
        .integer => |i| i,
        else => invalid,
    };
}

fn optionalString(object: std.json.ObjectMap, field: []const u8, missing: RequestError, invalid: RequestError) RequestError!?[]const u8 {
    const value = object.get(field) orelse return missing;
    return switch (value) {
        .null => null,
        .string => |s| s,
        else => invalid,
    };
}

fn optionalObjectDefaultEmpty(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!std.json.ObjectMap {
    const value = object.get(field) orelse return .{};
    return switch (value) {
        .object => |o| o,
        else => invalid,
    };
}

fn optionalStringDefaultNull(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!?[]const u8 {
    const value = object.get(field) orelse return null;
    return switch (value) {
        .null => null,
        .string => |s| s,
        else => invalid,
    };
}

fn requiredBool(object: std.json.ObjectMap, field: []const u8, missing: RequestError, invalid: RequestError) RequestError!bool {
    const value = object.get(field) orelse return missing;
    return switch (value) {
        .bool => |b| b,
        else => invalid,
    };
}

fn optionalResourcesMemory(object: std.json.ObjectMap) RequestError!?ParsedResourcesMemory {
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

fn optionalResourcesCpu(object: std.json.ObjectMap) RequestError!?ParsedResourcesCpu {
    const value = object.get("resourcesCpu") orelse return null;
    if (value == .null) return null;
    if (value != .object) return error.InvalidResourcesCpu;
    try protocol.rejectUnknownFields(value.object, &.{ "maxVcpus", "quotaCpus", "weight" });
    return .{
        .max_vcpus_text = try optionalObjectStringField(value.object, "maxVcpus", error.InvalidResourcesCpuMaxVcpus),
        .quota_cpus_text = try optionalObjectStringField(value.object, "quotaCpus", error.InvalidResourcesCpuQuotaCpus),
        .weight_text = try optionalObjectStringField(value.object, "weight", error.InvalidResourcesCpuWeight),
    };
}

fn optionalObjectStringField(object: std.json.ObjectMap, field: []const u8, invalid: RequestError) RequestError!?[]const u8 {
    const value = object.get(field) orelse return null;
    if (value == .null) return null;
    if (value != .string) return invalid;
    return value.string;
}

fn optionalRegistryCpuControlStatus(object: std.json.ObjectMap) RequestError!?[]const u8 {
    const value = object.get("registryCpuControlStatus") orelse return null;
    if (value == .null) return null;
    if (value != .string) return error.InvalidRegistryCpuControlStatus;
    if (std.mem.eql(u8, value.string, "none")) return value.string;
    if (std.mem.eql(u8, value.string, "linux-cgroup-v2")) return value.string;
    if (std.mem.eql(u8, value.string, "unsupported")) return value.string;
    return error.InvalidRegistryCpuControlStatus;
}

fn requiredRootDisk(object: std.json.ObjectMap) RequestError!boot_plan.RootDiskMode {
    const value = object.get("rootDisk") orelse return error.MissingRootDisk;
    if (value != .string) return error.InvalidRootDisk;
    if (std.mem.eql(u8, value.string, "unset")) return .unset;
    if (std.mem.eql(u8, value.string, "false")) return .false_value;
    if (std.mem.eql(u8, value.string, "path")) return .path;
    if (std.mem.eql(u8, value.string, "true")) return .true_value;
    return error.InvalidRootDisk;
}

fn writePortForwardInvalid(io: std.Io, label: []const u8, port: i64) !void {
    var buf: [256]u8 = undefined;
    try protocol.writeError(
        io,
        "BOOT_PORT_FORWARD_INVALID",
        try std.fmt.bufPrint(&buf, "portForward: {s} must be an integer in 1..65535 (got {d})", .{ label, port }),
    );
}

fn writeDuplicateHostPort(io: std.Io, port: u16) !void {
    var buf: [128]u8 = undefined;
    try protocol.writeError(
        io,
        "BOOT_PORT_FORWARD_CONFLICT",
        try std.fmt.bufPrint(&buf, "portForward: duplicate hostPort {d}", .{port}),
    );
}

fn writeMountDiskUpperSizeError(io: std.Io, size: u64) !void {
    var buf: [256]u8 = undefined;
    try protocol.writeError(
        io,
        "BOOT_MOUNT_INVALID",
        try std.fmt.bufPrint(&buf, "mountDiskUpperSizeBytes must be a positive multiple of 4096 (got {d})", .{size}),
    );
}

fn writeRemovedLiveMountCacheError(io: std.Io, index: u64) !void {
    var buf: [256]u8 = undefined;
    try protocol.writeError(
        io,
        "BOOT_MOUNT_INVALID",
        try std.fmt.bufPrint(&buf, "liveMounts[{d}] cache is no longer supported; metadata caching uses the fast policy", .{index}),
    );
}

fn writeRemovedLiveMountSyncError(io: std.Io, index: u64) !void {
    var buf: [256]u8 = undefined;
    try protocol.writeError(
        io,
        "BOOT_MOUNT_INVALID",
        try std.fmt.bufPrint(&buf, "liveMounts[{d}] sync is no longer supported; rw live mounts sync in batches", .{index}),
    );
}

fn writeRestoreLiveMountOverrideError(
    allocator: std.mem.Allocator,
    io: std.Io,
    guest: []const u8,
    recorded: []const boot_plan.RestoreRecordedLiveMount,
) !void {
    var known: std.ArrayList(u8) = .empty;
    defer known.deinit(allocator);
    for (recorded, 0..) |mount, i| {
        if (i != 0) try known.appendSlice(allocator, ", ");
        try known.appendSlice(allocator, mount.guest);
    }
    const msg = try std.fmt.allocPrint(
        allocator,
        "restore: liveMounts override for guest={s} doesn't match any\n" ++
            "  liveMount recorded in the bundle. The bundle's recorded guest paths are:\n" ++
            "    {s}\n" ++
            "  restore() reproduces the snapshot's mount topology — opts.liveMounts is\n" ++
            "  an override map, not an additive list. To override, set 'guest' to one\n" ++
            "  of the recorded paths above and supply a new 'host' / 'mode'.",
        .{ guest, known.items },
    );
    try protocol.writeError(io, "BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN", msg);
}

fn writePlanError(io: std.Io, err: anyerror) !void {
    switch (err) {
        error.InvalidMemory => try protocol.writeError(io, "BOOT_MEMORY_INVALID", "boot: memory must be a positive integer at least 512 MiB"),
        error.ConflictingMemory => try protocol.writeError(io, "BOOT_MEMORY_INVALID", "boot: memory conflicts with resources.memory.maxMib. Use one value."),
        error.InvalidReclaim => try protocol.writeError(io, "BOOT_MEMORY_INVALID", "boot: resources.memory.reclaim must be \"auto\" when set."),
        error.InvalidCpuMaxVcpus => try protocol.writeError(io, "BOOT_CPU_INVALID", "boot: resources.cpu.maxVcpus must be a positive integer"),
        error.UnsupportedCpuMaxVcpus => try protocol.writeError(io, "BOOT_CPU_INVALID", "boot: resources.cpu.maxVcpus greater than 1 is not supported yet. CPU quota is scheduling budget, not extra guest-visible CPUs."),
        error.InvalidCpuQuotaCpus => try protocol.writeError(io, "BOOT_CPU_INVALID", "boot: resources.cpu.quotaCpus must be > 0 when set"),
        error.CpuQuotaExceedsMaxVcpus => try protocol.writeError(io, "BOOT_CPU_INVALID", "boot: resources.cpu.quotaCpus cannot exceed resources.cpu.maxVcpus"),
        error.InvalidCpuWeight => try protocol.writeError(io, "BOOT_CPU_INVALID", "boot: resources.cpu.weight must be an integer in 1..10000"),
        error.CmdWithoutImage => try protocol.writeError(io, "BOOT_CMD_WITHOUT_IMAGE", "boot: `image` is required when `cmd` is set."),
        error.RootDiskWithoutImage => try protocol.writeError(io, "BOOT_CMD_WITHOUT_IMAGE", "boot: rootDisk: true requires an `image` (the .tar.gz to materialize)."),
        error.MissingAutoMemory => try protocol.writeError(io, "BOOT_MEMORY_INVALID", "boot: memory auto-size input is missing"),
        error.InvalidGuestCwdAbsolute => try protocol.writeError(io, "BOOT_CWD_INVALID", "guestCwd must be an absolute path"),
        error.InvalidGuestCwdNul => try protocol.writeError(io, "BOOT_CWD_INVALID", "guestCwd must not contain NUL bytes"),
        error.InvalidMountGuestAbsolute => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "mount guest path must be absolute"),
        error.InvalidMountGuestRoot => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "mount guest path must live under /mnt/"),
        error.TooManyLiveMounts => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "liveMounts: at most 5 live mounts are supported per VM — the VMM wires 5 virtio-fs slots."),
        error.InvalidLiveMountMode => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "liveMounts: mode must be ro or rw"),
        error.MissingBundleCommand => try protocol.writeError(io, "BOOT_CMD_MISSING", "boot: no cmd to run — pass `cmd` on boot() or bake one into the image via `provision({ cmd })`."),
        error.MissingScratchPath => try protocol.writeError(io, "BOOT_SNAPSHOT_NOT_FOUND", "boot-plan scratch disk path missing"),
        error.MissingRootDiskRuntimePath => try protocol.writeError(io, "BOOT_IMAGE_NOT_FOUND", "boot-plan rootDisk path missing"),
        error.MissingMountDiskRuntimeField => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "boot-plan mountDisk field missing"),
        error.MissingMountDiskFdField => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "boot-plan mountDisk fd field missing"),
        error.MissingBatchLiveMountVsock => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "liveMounts: writable mounts require the exec vsock bridge for batched sync"),
        error.PortForwardNetSocketPreset => try protocol.writeError(io, "BOOT_PORT_FORWARD_INVALID", "portForward requires the runtime to own gvproxy, but MACHINEN_NET_SOCKET is already set. Either drop the env var or install the forwards yourself against your gvproxy's control API."),
        error.MissingGvproxy => try protocol.writeError(io, "BOOT_PORT_FORWARD_NO_GVPROXY", "portForward requires gvproxy, but no gvproxy binary was found. Install gvproxy or point MACHINEN_GVPROXY at one."),
        error.MissingSnapshotMountDiskField => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan snapshot mountDisk fields are incomplete"),
        error.MissingSnapshotVmstateField => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan snapshot vmstate fields are incomplete"),
        error.IncompleteRegistryMountDisk => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "boot-plan registry mountDisk field missing"),
        error.MissingRegistryCpuStatus => try protocol.writeError(io, "BOOT_CPU_INVALID", "boot-plan registry cpu control status missing"),
        error.MissingRegistryVmstateField => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry vmstate fields are incomplete"),
        error.MissingVmstateRuntimeChainId => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan vmstate runtime chain id is missing"),
        error.MissingProvisionRepackField => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision repack field missing"),
        error.UnsupportedHostMemory => try protocol.writeError(io, "BOOT_MEMORY_INVALID", "boot: host memory probing is unsupported on this platform"),
        error.InvalidGuestEnvValue => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan guestEnv values must be strings"),
        error.InvalidVmmEnvValue => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan vmm env values must be strings"),
        error.InvalidBundleEnvValue => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan bundle env values must be strings"),
        error.InvalidProvisionImageConfigEnvValue => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision image config env values must be strings"),
        error.InvalidProvisionBootVmmEnvValue => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision boot vmm env values must be strings"),
        error.InvalidProvisionDtbExplicit => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision dtb explicit flag must be a boolean"),
        error.InvalidProvisionCliCacheHome, error.InvalidProvisionCliCacheVersion => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision cli cache fields must be strings"),
        error.InvalidProvisionAssetExplicitPath, error.InvalidProvisionAssetAssetsDirPath, error.InvalidProvisionAssetCachePath => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision asset lookup paths must be strings"),
        error.InvalidProvisionAssetExplicitExists, error.InvalidProvisionAssetAssetsDirExists, error.InvalidProvisionAssetCacheExists => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision asset lookup exists flags must be booleans"),
        error.InvalidBundlePackUseTiny => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan bundle pack tiny flag must be a boolean"),
        error.InvalidBundlePackMountGuest, error.InvalidBundlePackRestoreMountGuest => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan bundle pack mount guests must be strings"),
        error.InvalidScratchOptionFalse => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan scratch option false flag must be a boolean"),
        error.InvalidScratchOptionPath => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan scratch option path must be a string"),
        error.InvalidProvisionScratchSizeBytes => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision scratch size must be a decimal integer"),
        error.InvalidProvisionTimeoutMs => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision timeout must be a decimal integer"),
        error.InvalidBootTimeoutMs => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan boot timeout must be a decimal integer"),
        else => try protocol.writeError(io, "BOOT_MEMORY_INVALID", @errorName(err)),
    }
}

fn writeRequestError(io: std.Io, err: RequestError) !void {
    switch (err) {
        error.RequestTooLarge => try protocol.writeError(io, "REQUEST_TOO_LARGE", "request JSON exceeds the maximum size"),
        error.UnknownField => try protocol.writeError(io, "UNKNOWN_FIELD", "request contains an unknown field"),
        error.UnsupportedProtocolVersion => try protocol.writeError(io, "UNSUPPORTED_PROTOCOL_VERSION", "request protocolVersion must be 1"),
        error.MissingData => try protocol.writeError(io, "INVALID_REQUEST", "request must include a data object"),
        error.InvalidData => try protocol.writeError(io, "INVALID_REQUEST", "request data field must be an object"),
        error.InvalidJson => try protocol.writeError(io, "INVALID_JSON", "request body is not valid JSON"),
        error.InvalidShape => try protocol.writeError(io, "INVALID_REQUEST", "request body must be a JSON object"),
        error.InvalidRootDiskOptionFalse, error.InvalidRootDiskOptionTrue => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan rootDisk option flags must be booleans"),
        error.InvalidRootDiskOptionPath, error.InvalidRootDiskRestorePath => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan rootDisk option paths must be strings"),
        error.InvalidRootDiskMaterializeRestorePath, error.InvalidRootDiskMaterializeCallerPath => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan rootDisk materialize paths must be strings"),
        error.InvalidExistingStatsFile, error.InvalidStatsFilePath, error.InvalidStatsFileTempDir, error.InvalidStatsFileVsockTempDir => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan stats file fields must be strings"),
        error.InvalidMountDiskUpperSizeOption => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan mountDisk upper size option must be a decimal integer"),
        error.InvalidScratchOptionFalse => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan scratch option false flag must be a boolean"),
        error.InvalidScratchOptionPath => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan scratch option path must be a string"),
        error.InvalidProvisionDtbExplicit => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision dtb explicit flag must be a boolean"),
        error.InvalidProvisionCliCacheHome, error.InvalidProvisionCliCacheVersion => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision cli cache fields must be strings"),
        error.InvalidProvisionAssetExplicitPath, error.InvalidProvisionAssetAssetsDirPath, error.InvalidProvisionAssetCachePath => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision asset lookup paths must be strings"),
        error.InvalidProvisionAssetExplicitExists, error.InvalidProvisionAssetAssetsDirExists, error.InvalidProvisionAssetCacheExists => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision asset lookup exists flags must be booleans"),
        error.InvalidVmmEnvBase, error.InvalidVmmEnvOverrides => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan vmm env fields must be objects"),
        error.InvalidProvisionBootVmmEnv => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan provision boot vmm env field must be an object"),
        error.InvalidPortForward, error.InvalidHostPort, error.InvalidGuestPort => try protocol.writeError(io, "BOOT_PORT_FORWARD_INVALID", "portForward: hostPort and guestPort must be integers in 1..65535"),
        error.InvalidPortForwardNetSocket => try protocol.writeError(io, "BOOT_PORT_FORWARD_INVALID", "boot-plan portForward net socket field must be a string"),
        error.InvalidGvproxyPlanningRequired => try protocol.writeError(io, "BOOT_PORT_FORWARD_NO_GVPROXY", "boot-plan gvproxy planning flag must be a boolean"),
        error.InvalidGvproxyNetSocket, error.InvalidGvproxyPath => try protocol.writeError(io, "BOOT_PORT_FORWARD_NO_GVPROXY", "boot-plan gvproxy fields must be strings"),
        error.InvalidGuestHostnameSetPid => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan guest hostname set pid must be a decimal integer"),
        error.InvalidGuestHostnameSetSkip => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan guest hostname set skip flag must be a boolean"),
        error.InvalidGuestHostnameSetName, error.InvalidGuestHostnameSetVsockUdsPath => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan guest hostname set fields must be strings"),
        error.InvalidSnapshotMountGuest, error.InvalidSnapshotMountLowerPath, error.InvalidSnapshotMountUpperPath => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan snapshot mountDisk fields must be strings"),
        error.InvalidSnapshotLiveMounts => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan snapshot liveMounts entries are invalid"),
        error.InvalidSnapshotVmstatePath, error.InvalidSnapshotVmstateChainId, error.InvalidSnapshotVmstateCheckpointParent => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan snapshot vmstate path fields must be strings"),
        error.InvalidSnapshotVmstateCheckpointSequence => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan snapshot vmstate checkpoint sequence must be a decimal integer"),
        error.InvalidSnapshotBackingEngine, error.InvalidSnapshotBackingAction, error.InvalidSnapshotBackingDiskPath, error.InvalidSnapshotBackingVmstatePath => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan snapshot backing fields must be strings"),
        error.InvalidLiveMounts, error.InvalidLiveMountGuest => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "liveMounts: entries must include host and guest paths"),
        error.InvalidLiveMountRemovedOptionIndex => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan live mount removed option index must be a decimal integer"),
        error.InvalidLiveMountRemovedOptionHasCache, error.InvalidLiveMountRemovedOptionHasSync => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan live mount removed option flags must be booleans"),
        error.InvalidLiveMountsResolved, error.InvalidLiveMountHost, error.InvalidLiveMountMode, error.InvalidLiveMountTag => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "liveMounts: resolved live mount entries must include host, guest, tag, and mode ro/rw"),
        error.InvalidBatchLiveMountValidationRequired => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "boot-plan batch live mount validation flag must be a boolean"),
        error.InvalidRestoreLiveMountsRecorded, error.InvalidRestoreLiveMountsOverrides => try protocol.writeError(io, "BOOT_MOUNT_INVALID", "restore liveMount entries must include host, guest, and valid mode fields"),
        error.InvalidRegistryCpuPolicy => try protocol.writeError(io, "BOOT_CPU_INVALID", "boot-plan registry cpu policy fields are invalid"),
        error.InvalidRegistryCpuControlStatus => try protocol.writeError(io, "BOOT_CPU_INVALID", "boot-plan registry cpu control status must be none, linux-cgroup-v2, or unsupported"),
        error.InvalidRegistryCpuControlReason => try protocol.writeError(io, "BOOT_CPU_INVALID", "boot-plan registry cpu control reason must be a string"),
        error.InvalidRegistryVmstatePath, error.InvalidRegistryVmstateChainId, error.InvalidRegistryVmstateCheckpointParent => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry vmstate path fields must be strings"),
        error.InvalidRegistryVmstateCheckpointSequence => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry vmstate checkpoint sequence must be a decimal integer"),
        error.InvalidBootVmstateStatePath, error.InvalidBootVmstateTempDir, error.InvalidBootVmstateChainId, error.InvalidBootVmstateRestorePath, error.InvalidBootVmstateForkedFrom => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan vmstate runtime fields must be strings"),
        error.InvalidRegistryDiskPath => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry disk path must be a string"),
        error.InvalidRegistryForkedFrom => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry forked-from path must be a string"),
        error.InvalidRegistryMemoryCeilingMib => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry memory ceiling must be a decimal integer"),
        error.InvalidRegistryStatsPath => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry stats path must be a string"),
        error.InvalidRegistryBootLogRoot => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry boot log root must be a string"),
        error.InvalidRegistryChildPid => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry child pid must be a decimal integer"),
        error.InvalidRegistryDetached => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry detached flag must be a boolean"),
        error.InvalidRegistryLifecycleName, error.InvalidRegistryLifecycleVsockUdsPath => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry lifecycle fields must be strings"),
        error.InvalidRegistryNested => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry nested flag must be a boolean"),
        error.InvalidRegistryVmmPdeathsig => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry pdeathsig flag must be a boolean"),
        error.InvalidRegistryGvPid => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry gvproxy pid must be a decimal integer"),
        error.InvalidRegistryHostPlatform, error.InvalidRegistryVmmBinary, error.InvalidRegistryVmmObservedExeBase, error.InvalidRegistryGvExe, error.InvalidRegistryGvObservedExeBase => try protocol.writeError(io, "INVALID_REQUEST", "boot-plan registry process fields must be strings"),
        else => try protocol.writeError(io, "INVALID_REQUEST", @errorName(err)),
    }
}
