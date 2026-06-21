type ScratchDiskAction = "none" | "existing" | "clone" | "allocate";
export type BootScratchMode = "false" | "path" | "auto";
export type BootRootDiskMode = "unset" | "false" | "path" | "true";
type RootDiskRuntimeAction = "none" | "existing" | "clone-restore" | "clone-cached";
type MountDiskRuntimeAction = "none" | "restore" | "fresh";
type GvproxyAction = "skip-existing" | "spawn" | "missing-ok";
export type ProvisionGuestCpu = "arm64" | "amd64";
export type PlannedLiveMount = { host: string; guest: string; mode: "ro" | "rw"; tag: string };
export type RestoreLiveMount = { host: string; guest: string; mode?: "ro" | "rw" };
export type PlannedPortForward = { hostPort: number; guestPort: number; hostAddr?: string };
export type PortForwardProbePlan = { hostPort: number; probeHost: string };
export type GvproxyPlan = { action: GvproxyAction; gvproxyPath: string | null };
export type VsockModePlan = { action: "existing" | "allocate"; existingSpec: string | null };
export type VmstateTempModePlan = { action: "skip" | "reuse" | "allocate"; tempDir: string | null };
export type StatsFileModePlan = { action: "existing" | "allocate"; existingPath: string | null };
type CpuPolicyPlan = { maxVcpus: number; quotaCpus?: number; weight: number };
type RegistryMountDiskPlan = { guest: string; lowerPath: string; upperPath: string };
type RegistryLiveMountPlan = { guest: string; host: string; mode: "ro" | "rw" };
type RegistryPortForwardPlan = PlannedPortForward;
type SnapshotMountDiskPlan = { guest: string; lowerPath: string; upperPath: string };
type SnapshotLiveMountPlan = { host: string; guest: string; mode: "ro" | "rw" };
type SnapshotVmstateChainPlan = { chainId: string; parentDir: string | null; sequence: number };
type SnapshotContextPlan = {
  mountDisk: SnapshotMountDiskPlan | null;
  liveMounts: SnapshotLiveMountPlan[];
  vmstateChain: SnapshotVmstateChainPlan | null;
};
export type RegistryProcessPlan = {
  vmmExe: string | null;
  gvproxyExe: string | null;
};
export type RegistryLifecyclePlan = {
  claimName: string | null;
  shouldWrite: boolean;
};
type RegistryCpuPlan = {
  maxVcpus: number;
  quotaCpus?: number;
  weight: number;
  enforcement: { status: "none" | "linux-cgroup-v2" | "unsupported"; reason?: string };
};
type RegistryVmstatePlan = {
  statePath: string | null;
  chainId: string | null;
  checkpointParent: string | null;
  checkpointSequence: number | null;
};
export type BootVmstateRuntimePlan = {
  statePath: string | null;
  chainId: string | null;
  checkpointParent: string | null;
  checkpointSequence: number | null;
};
export type BundleWorkspacePlan = {
  cpioPath: string | null;
  synthBundleDir: string | null;
};
export type BundleConfigPathsPlan = {
  rootfsDir: string | null;
  configPath: string | null;
};
export type BundlePackPlan = {
  kind: "fat" | "tiny";
  tinyMountGuest: string | null;
};
export type ProvisionAssetsPlan = {
  cpu: ProvisionGuestCpu;
  kernelAsset: string;
  dtbAsset: string | null;
  rootfsAsset: string;
};
export type ProvisionDtbPlan = {
  required: boolean;
  asset: string | null;
  cliCacheName: string | null;
};
export type ProvisionCliCachePlan = { baseDir: string | null };
export type ProvisionAssetLookupPlan = {
  path: string | null;
  error: "missing" | "assets-dir-invalid" | null;
};
export type ProvisionBootPlan = {
  imagePath: string | null;
  kernelPath: string | null;
  dtbPath: string | null;
  vmmVsock: string | null;
  timeoutMs: number | null;
  vmmEnv: Record<string, string>;
  cmd: string[];
  env: Record<string, string>;
  snapshotPath: string | null;
  rootDiskPath: string | null;
};
export type ProvisionWorkloadPlan = { tarToDiskCommand: string; poweroffCommand: string };
export type ProvisionRepackPlan = {
  extractArgs: string[];
  targzArgs: string[];
  imageConfigPath: string | null;
};
export type ProvisionImageConfigPlan = { cmd?: string[]; env?: Record<string, string> } | null;
export type ProvisionRuntimePlan = {
  scratchSizeBytes: number;
  deadlineMs: number;
  diskPath: string | null;
  rootDiskPath: string | null;
  udsPath: string | null;
};
export type RegistryShapePlan = {
  sourceImagePath: string | null;
  diskPath: string | null;
  forkedFrom: string | null;
  memoryCeilingMib: number | null;
  statsPath: string | null;
  rootDiskPath: string | null;
  rootDiskMode: "block" | "none";
  bootLogPath: string | null;
  cleanupPaths: string[];
  mountDisk: RegistryMountDiskPlan | null;
  liveMounts: RegistryLiveMountPlan[];
  portForward: RegistryPortForwardPlan[] | null;
  cpu: RegistryCpuPlan | null;
  vmstate: RegistryVmstatePlan;
  nested: boolean;
};
export type ScratchDiskPlan = {
  action: ScratchDiskAction;
  diskPath: string | null;
  perBootSnapDisk: string | null;
  vmmDisk: string | null;
};
export type RootDiskRuntimePlan = {
  action: RootDiskRuntimeAction;
  sourcePath: string | null;
  targetPath: string | null;
  perBootRootDisk: string | null;
  vmmRootDisk: string | null;
};
export type MountDiskRuntimePlan = {
  action: MountDiskRuntimeAction;
  lowerPath: string | null;
  upperPath: string | null;
  sourceUpperPath: string | null;
  guest: string | null;
  upperSizeBytes: number | null;
};
type MachinenConfigPlan = Record<string, unknown> & {
  cmd: string[];
  env: Record<string, string>;
  cwd?: string;
  liveMounts?: Array<{ guest: string; tag: string; mode: "ro" | "rw" }>;
};

export interface NativeBootPlanResult {
  memoryCeilingMib: number | null;
  vmmMemory: string | null;
  cpuPolicy: CpuPolicyPlan | null;
  wantsRootDisk: boolean;
  rootDiskMode: BootRootDiskMode;
  needsInitramfs: boolean;
  timeoutMs: number | null;
  detachedReadinessTimeoutMs: number;
  normalizedMountGuest: string | null;
  guestHostname: string | null;
  guestHostnameSet: string | null;
  plannedPortForward: PlannedPortForward[];
  portForwardProbe: PortForwardProbePlan[];
  gvproxyPlan: GvproxyPlan;
  mergedGuestEnv: Record<string, string>;
  vsockMode: VsockModePlan;
  vsockUdsPath: string | null;
  vmmVsock: string | null;
  vmmCommand: string | null;
  vmmArgs: string[];
  usePdeathsig: boolean;
  vmmEnv: Record<string, string>;
  vmmKernel: string | null;
  vmmDtb: string | null;
  vmmInitrd: string | null;
  vmmSnapshotPath: string | null;
  vmmRestorePath: string | null;
  vmmVmstateTiming: string | null;
  vmstateTempMode: VmstateTempModePlan;
  vmstateRuntime: BootVmstateRuntimePlan;
  vmmNested: string | null;
  virtiofsEnv: Record<string, string>;
  batchLiveMountSyncRequired: boolean;
  restoreLiveMounts: RestoreLiveMount[];
  plannedLiveMounts: PlannedLiveMount[];
  statsFileMode: StatsFileModePlan;
  statsFilePath: string | null;
  vmmStatsFile: string | null;
  machinenConfig: MachinenConfigPlan;
  bundleCommand: string[];
  bundleEnv: Record<string, string>;
  bundleWorkspace: BundleWorkspacePlan;
  bundleConfigPaths: BundleConfigPathsPlan;
  bundlePack: BundlePackPlan;
  provisionAssets: ProvisionAssetsPlan;
  provisionDtb: ProvisionDtbPlan;
  provisionCliCache: ProvisionCliCachePlan;
  provisionAssetLookup: ProvisionAssetLookupPlan;
  provisionBoot: ProvisionBootPlan;
  provisionWorkload: ProvisionWorkloadPlan;
  provisionRepack: ProvisionRepackPlan;
  provisionImageConfig: ProvisionImageConfigPlan;
  provisionRuntime: ProvisionRuntimePlan;
  plannedScratchMode: BootScratchMode;
  scratchDisk: ScratchDiskPlan;
  rootDiskRuntime: RootDiskRuntimePlan;
  mountDiskRuntime: MountDiskRuntimePlan;
  mountDiskFdEnv: Record<string, string>;
  snapshotContext: SnapshotContextPlan;
  registryShape: RegistryShapePlan;
  registryLifecycle: RegistryLifecyclePlan;
  registryProcess: RegistryProcessPlan;
}

export function isNativeBootPlanResult(value: unknown): value is NativeBootPlanResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<NativeBootPlanResult>;
  return [
    nullableNonNegativeNumber(data.memoryCeilingMib),
    nullableString(data.vmmMemory),
    data.cpuPolicy === null || isCpuPolicyPlan(data.cpuPolicy),
    typeof data.wantsRootDisk === "boolean",
    isBootRootDiskMode(data.rootDiskMode),
    typeof data.needsInitramfs === "boolean",
    nullableNonNegativeNumber(data.timeoutMs),
    nonNegativeNumber(data.detachedReadinessTimeoutMs),
    nullableString(data.normalizedMountGuest),
    nullableString(data.guestHostname),
    nullableString(data.guestHostnameSet),
    Array.isArray(data.plannedPortForward) && data.plannedPortForward.every(isPlannedPortForward),
    Array.isArray(data.portForwardProbe) && data.portForwardProbe.every(isPortForwardProbePlan),
    isGvproxyPlan(data.gvproxyPlan),
    isStringRecord(data.mergedGuestEnv),
    isVsockModePlan(data.vsockMode),
    nullableString(data.vsockUdsPath),
    nullableString(data.vmmVsock),
    nullableString(data.vmmCommand),
    isStringArray(data.vmmArgs),
    typeof data.usePdeathsig === "boolean",
    isStringRecord(data.vmmEnv),
    nullableString(data.vmmKernel),
    nullableString(data.vmmDtb),
    nullableString(data.vmmInitrd),
    nullableString(data.vmmSnapshotPath),
    nullableString(data.vmmRestorePath),
    nullableString(data.vmmVmstateTiming),
    isVmstateTempModePlan(data.vmstateTempMode),
    isBootVmstateRuntimePlan(data.vmstateRuntime),
    nullableString(data.vmmNested),
    isStringRecord(data.virtiofsEnv),
    typeof data.batchLiveMountSyncRequired === "boolean",
    Array.isArray(data.restoreLiveMounts) && data.restoreLiveMounts.every(isRestoreLiveMount),
    Array.isArray(data.plannedLiveMounts) && data.plannedLiveMounts.every(isPlannedLiveMount),
    isStatsFileModePlan(data.statsFileMode),
    nullableString(data.statsFilePath),
    nullableString(data.vmmStatsFile),
    isMachinenConfigPlan(data.machinenConfig),
    isStringArray(data.bundleCommand),
    isStringRecord(data.bundleEnv),
    isBundleWorkspacePlan(data.bundleWorkspace),
    isBundleConfigPathsPlan(data.bundleConfigPaths),
    isBundlePackPlan(data.bundlePack),
    isProvisionAssetsPlan(data.provisionAssets),
    isProvisionDtbPlan(data.provisionDtb),
    isProvisionCliCachePlan(data.provisionCliCache),
    isProvisionAssetLookupPlan(data.provisionAssetLookup),
    isProvisionBootPlan(data.provisionBoot),
    isProvisionWorkloadPlan(data.provisionWorkload),
    isProvisionRepackPlan(data.provisionRepack),
    isProvisionImageConfigPlan(data.provisionImageConfig),
    isProvisionRuntimePlan(data.provisionRuntime),
    isBootScratchMode(data.plannedScratchMode),
    isScratchDiskPlan(data.scratchDisk),
    isRootDiskRuntimePlan(data.rootDiskRuntime),
    isMountDiskRuntimePlan(data.mountDiskRuntime),
    isStringRecord(data.mountDiskFdEnv),
    isSnapshotContextPlan(data.snapshotContext),
    isRegistryShapePlan(data.registryShape),
    isRegistryLifecyclePlan(data.registryLifecycle),
    isRegistryProcessPlan(data.registryProcess),
  ].every(Boolean);
}

function isCpuPolicyPlan(value: unknown): value is CpuPolicyPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<CpuPolicyPlan>;
  return (
    nonNegativeNumber(plan.maxVcpus) &&
    (plan.quotaCpus === undefined || nonNegativeNumber(plan.quotaCpus)) &&
    nonNegativeNumber(plan.weight)
  );
}

function isBundleWorkspacePlan(value: unknown): value is BundleWorkspacePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<BundleWorkspacePlan>;
  return nullableString(plan.cpioPath) && nullableString(plan.synthBundleDir);
}

function isBundleConfigPathsPlan(value: unknown): value is BundleConfigPathsPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<BundleConfigPathsPlan>;
  return nullableString(plan.rootfsDir) && nullableString(plan.configPath);
}

function isBundlePackPlan(value: unknown): value is BundlePackPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<BundlePackPlan>;
  return (plan.kind === "fat" || plan.kind === "tiny") && nullableString(plan.tinyMountGuest);
}

function isProvisionAssetsPlan(value: unknown): value is ProvisionAssetsPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<ProvisionAssetsPlan>;
  return (
    (plan.cpu === "arm64" || plan.cpu === "amd64") &&
    typeof plan.kernelAsset === "string" &&
    nullableString(plan.dtbAsset) &&
    typeof plan.rootfsAsset === "string"
  );
}

function isProvisionDtbPlan(value: unknown): value is ProvisionDtbPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<ProvisionDtbPlan>;
  return (
    typeof plan.required === "boolean" &&
    nullableString(plan.asset) &&
    nullableString(plan.cliCacheName)
  );
}

function isProvisionCliCachePlan(value: unknown): value is ProvisionCliCachePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  return nullableString((value as Partial<ProvisionCliCachePlan>).baseDir);
}

function isProvisionAssetLookupPlan(value: unknown): value is ProvisionAssetLookupPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<ProvisionAssetLookupPlan>;
  return (
    nullableString(plan.path) &&
    (plan.error === null || plan.error === "missing" || plan.error === "assets-dir-invalid")
  );
}

function isProvisionBootPlan(value: unknown): value is ProvisionBootPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<ProvisionBootPlan>;
  return [
    nullableString(plan.imagePath),
    nullableString(plan.kernelPath),
    nullableString(plan.dtbPath),
    nullableString(plan.vmmVsock),
    nullableNonNegativeNumber(plan.timeoutMs),
    isStringRecord(plan.vmmEnv),
    isStringArray(plan.cmd),
    isStringRecord(plan.env),
    nullableString(plan.snapshotPath),
    nullableString(plan.rootDiskPath),
  ].every(Boolean);
}

function isProvisionWorkloadPlan(value: unknown): value is ProvisionWorkloadPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<ProvisionWorkloadPlan>;
  return typeof plan.tarToDiskCommand === "string" && typeof plan.poweroffCommand === "string";
}

function isProvisionRepackPlan(value: unknown): value is ProvisionRepackPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<ProvisionRepackPlan>;
  return (
    isStringArray(plan.extractArgs) &&
    isStringArray(plan.targzArgs) &&
    nullableString(plan.imageConfigPath)
  );
}

function isProvisionImageConfigPlan(value: unknown): value is ProvisionImageConfigPlan {
  if (value === null) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<NonNullable<ProvisionImageConfigPlan>>;
  if (plan.cmd !== undefined && !isStringArray(plan.cmd)) {
    return false;
  }
  if (plan.env !== undefined && !isStringRecord(plan.env)) {
    return false;
  }
  return plan.cmd !== undefined || plan.env !== undefined;
}

function isProvisionRuntimePlan(value: unknown): value is ProvisionRuntimePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<ProvisionRuntimePlan>;
  return (
    nonNegativeNumber(plan.scratchSizeBytes) &&
    nonNegativeNumber(plan.deadlineMs) &&
    nullableString(plan.diskPath) &&
    nullableString(plan.rootDiskPath) &&
    nullableString(plan.udsPath)
  );
}

function isScratchDiskPlan(value: unknown): value is ScratchDiskPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<ScratchDiskPlan>;
  return (
    (plan.action === "none" ||
      plan.action === "existing" ||
      plan.action === "clone" ||
      plan.action === "allocate") &&
    nullableString(plan.diskPath) &&
    nullableString(plan.perBootSnapDisk) &&
    nullableString(plan.vmmDisk)
  );
}

function isRootDiskRuntimePlan(value: unknown): value is RootDiskRuntimePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<RootDiskRuntimePlan>;
  return [
    oneOfString(plan.action, ["none", "existing", "clone-restore", "clone-cached"]),
    nullableString(plan.sourcePath),
    nullableString(plan.targetPath),
    nullableString(plan.perBootRootDisk),
    nullableString(plan.vmmRootDisk),
  ].every(Boolean);
}

function isMountDiskRuntimePlan(value: unknown): value is MountDiskRuntimePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<MountDiskRuntimePlan>;
  return [
    oneOfString(plan.action, ["none", "restore", "fresh"]),
    nullableString(plan.lowerPath),
    nullableString(plan.upperPath),
    nullableString(plan.sourceUpperPath),
    nullableString(plan.guest),
    nullableNonNegativeNumber(plan.upperSizeBytes),
  ].every(Boolean);
}

function isSnapshotContextPlan(value: unknown): value is SnapshotContextPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<SnapshotContextPlan>;
  return (
    nullableObject(plan.mountDisk, isSnapshotMountDiskPlan) &&
    Array.isArray(plan.liveMounts) &&
    plan.liveMounts.every(isSnapshotLiveMountPlan) &&
    nullableObject(plan.vmstateChain, isSnapshotVmstateChainPlan)
  );
}

function isSnapshotMountDiskPlan(value: unknown): value is SnapshotMountDiskPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<SnapshotMountDiskPlan>;
  return (
    typeof plan.guest === "string" &&
    typeof plan.lowerPath === "string" &&
    typeof plan.upperPath === "string"
  );
}

function isSnapshotLiveMountPlan(value: unknown): value is SnapshotLiveMountPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<SnapshotLiveMountPlan>;
  return (
    typeof plan.host === "string" &&
    typeof plan.guest === "string" &&
    (plan.mode === "ro" || plan.mode === "rw")
  );
}

function isSnapshotVmstateChainPlan(value: unknown): value is SnapshotVmstateChainPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<SnapshotVmstateChainPlan>;
  return (
    typeof plan.chainId === "string" &&
    nullableString(plan.parentDir) &&
    nonNegativeNumber(plan.sequence)
  );
}

function isRegistryLifecyclePlan(value: unknown): value is RegistryLifecyclePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<RegistryLifecyclePlan>;
  return nullableString(plan.claimName) && typeof plan.shouldWrite === "boolean";
}

function isRegistryProcessPlan(value: unknown): value is RegistryProcessPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<RegistryProcessPlan>;
  return nullableString(plan.vmmExe) && nullableString(plan.gvproxyExe);
}

function isRegistryShapePlan(value: unknown): value is RegistryShapePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<RegistryShapePlan>;
  return [
    nullableString(plan.sourceImagePath),
    nullableString(plan.diskPath),
    nullableString(plan.forkedFrom),
    nullableNonNegativeNumber(plan.memoryCeilingMib),
    nullableString(plan.statsPath),
    nullableString(plan.rootDiskPath),
    oneOfString(plan.rootDiskMode, ["block", "none"]),
    nullableString(plan.bootLogPath),
    isStringArray(plan.cleanupPaths),
    nullableObject(plan.mountDisk, isRegistryMountDisk),
    Array.isArray(plan.liveMounts) && plan.liveMounts.every(isRegistryLiveMount),
    nullableObject(plan.portForward, isRegistryPortForwardArray),
    nullableObject(plan.cpu, isRegistryCpuPlan),
    isRegistryVmstatePlan(plan.vmstate),
    typeof plan.nested === "boolean",
  ].every(Boolean);
}

function isRegistryVmstatePlan(value: unknown): value is RegistryVmstatePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<RegistryVmstatePlan>;
  return isVmstatePlanShape(plan);
}

function isBootVmstateRuntimePlan(value: unknown): value is BootVmstateRuntimePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<BootVmstateRuntimePlan>;
  return isVmstatePlanShape(plan);
}

function isVmstatePlanShape(plan: Partial<BootVmstateRuntimePlan>): boolean {
  return (
    nullableString(plan.statePath) &&
    nullableString(plan.chainId) &&
    nullableString(plan.checkpointParent) &&
    nullableNonNegativeNumber(plan.checkpointSequence)
  );
}

function isRegistryCpuPlan(value: unknown): value is RegistryCpuPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<RegistryCpuPlan>;
  return [
    nonNegativeNumber(plan.maxVcpus),
    plan.quotaCpus === undefined || nonNegativeNumber(plan.quotaCpus),
    nonNegativeNumber(plan.weight),
    isRegistryCpuEnforcement(plan.enforcement),
  ].every(Boolean);
}

function isRegistryCpuEnforcement(value: unknown): value is RegistryCpuPlan["enforcement"] {
  if (!value || typeof value !== "object") {
    return false;
  }
  const enforcement = value as Partial<RegistryCpuPlan["enforcement"]>;
  return (
    oneOfString(enforcement.status, ["none", "linux-cgroup-v2", "unsupported"]) &&
    (enforcement.reason === undefined || typeof enforcement.reason === "string")
  );
}

function isRegistryMountDisk(value: unknown): value is RegistryMountDiskPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mount = value as Partial<RegistryMountDiskPlan>;
  return (
    typeof mount.guest === "string" &&
    typeof mount.lowerPath === "string" &&
    typeof mount.upperPath === "string"
  );
}

function isRegistryLiveMount(value: unknown): value is RegistryLiveMountPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mount = value as Partial<RegistryLiveMountPlan>;
  return (
    typeof mount.guest === "string" &&
    typeof mount.host === "string" &&
    (mount.mode === "ro" || mount.mode === "rw")
  );
}

function isRegistryPortForwardArray(value: unknown): value is RegistryPortForwardPlan[] {
  return Array.isArray(value) && value.every(isPlannedPortForward);
}

function isPortForwardProbePlan(value: unknown): value is PortForwardProbePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<PortForwardProbePlan>;
  return nonNegativeNumber(plan.hostPort) && typeof plan.probeHost === "string";
}

function isGvproxyPlan(value: unknown): value is GvproxyPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<GvproxyPlan>;
  return (
    (plan.action === "skip-existing" || plan.action === "spawn" || plan.action === "missing-ok") &&
    nullableString(plan.gvproxyPath)
  );
}

function isPlannedPortForward(value: unknown): value is PlannedPortForward {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mapping = value as Partial<PlannedPortForward>;
  return (
    nonNegativeNumber(mapping.hostPort) &&
    nonNegativeNumber(mapping.guestPort) &&
    (mapping.hostAddr === undefined || typeof mapping.hostAddr === "string")
  );
}

function isRestoreLiveMount(value: unknown): value is RestoreLiveMount {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mount = value as Partial<RestoreLiveMount>;
  return (
    typeof mount.host === "string" &&
    typeof mount.guest === "string" &&
    (mount.mode === undefined || mount.mode === "ro" || mount.mode === "rw")
  );
}

function isPlannedLiveMount(value: unknown): value is PlannedLiveMount {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mount = value as Partial<PlannedLiveMount>;
  return (
    typeof mount.host === "string" &&
    typeof mount.guest === "string" &&
    (mount.mode === "ro" || mount.mode === "rw") &&
    typeof mount.tag === "string"
  );
}

function isVsockModePlan(value: unknown): value is VsockModePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<VsockModePlan>;
  return (
    (plan.action === "existing" || plan.action === "allocate") && nullableString(plan.existingSpec)
  );
}

function isVmstateTempModePlan(value: unknown): value is VmstateTempModePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<VmstateTempModePlan>;
  return (
    (plan.action === "skip" || plan.action === "reuse" || plan.action === "allocate") &&
    nullableString(plan.tempDir)
  );
}

function isStatsFileModePlan(value: unknown): value is StatsFileModePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<StatsFileModePlan>;
  return (
    (plan.action === "existing" || plan.action === "allocate") && nullableString(plan.existingPath)
  );
}

function isMachinenConfigPlan(value: unknown): value is MachinenConfigPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const config = value as Partial<MachinenConfigPlan>;
  if (!isStringArray(config.cmd) || !isStringRecord(config.env)) {
    return false;
  }
  if (config.cwd !== undefined && typeof config.cwd !== "string") {
    return false;
  }
  if (config.liveMounts !== undefined) {
    if (!Array.isArray(config.liveMounts)) {
      return false;
    }
    return config.liveMounts.every((mount) => {
      if (!mount || typeof mount !== "object") {
        return false;
      }
      const candidate = mount as { guest?: unknown; tag?: unknown; mode?: unknown };
      return (
        typeof candidate.guest === "string" &&
        typeof candidate.tag === "string" &&
        (candidate.mode === "ro" || candidate.mode === "rw")
      );
    });
  }
  return true;
}

function oneOfString(value: unknown, allowed: string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

function nullableObject<T>(value: unknown, guard: (item: unknown) => item is T): boolean {
  return value === null || guard(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isBootScratchMode(value: unknown): value is BootScratchMode {
  return value === "false" || value === "path" || value === "auto";
}

function isBootRootDiskMode(value: unknown): value is BootRootDiskMode {
  return value === "unset" || value === "false" || value === "path" || value === "true";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function nonNegativeNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nullableNonNegativeNumber(value: unknown): boolean {
  return value === null || nonNegativeNumber(value);
}
