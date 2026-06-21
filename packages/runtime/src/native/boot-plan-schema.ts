type ScratchDiskAction = "none" | "existing" | "clone" | "allocate";
type RootDiskRuntimeAction = "none" | "existing" | "clone-restore" | "clone-cached";
type MountDiskRuntimeAction = "none" | "restore" | "fresh";
export type ProvisionGuestCpu = "arm64" | "amd64";
type CpuPolicyPlan = { maxVcpus: number; quotaCpus?: number; weight: number };
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
export type PlannedPortForward = { hostPort: number; guestPort: number; hostAddr?: string };
export type BundleWorkspacePlan = { cpioPath: string | null; synthBundleDir: string | null };
export type BundleConfigPathsPlan = { rootfsDir: string | null; configPath: string | null };
type RegistryPortForwardPlan = PlannedPortForward;
export type BootVmstateRuntimePlan = {
  statePath: string | null;
  chainId: string | null;
  checkpointParent: string | null;
  checkpointSequence: number | null;
};
export type PlannedLiveMount = { host: string; guest: string; mode: "ro" | "rw"; tag: string };
type RegistryMountDiskPlan = { guest: string; lowerPath: string; upperPath: string };
type RegistryLiveMountPlan = { guest: string; host: string; mode: "ro" | "rw" };
export type ProvisionAssetsPlan = {
  cpu: ProvisionGuestCpu;
  kernelAsset: string;
  dtbAsset: string | null;
  rootfsAsset: string;
};
export type ProvisionBootPlan = {
  imagePath: string | null;
  kernelPath: string | null;
  dtbPath: string | null;
  vmmVsock: string | null;
  cmd: string[];
  env: Record<string, string>;
  snapshotPath: string | null;
  rootDiskPath: string | null;
};
export type ProvisionWorkloadPlan = { tarToDiskCommand: string; poweroffCommand: string };
export type ProvisionRepackPlan = { extractArgs: string[]; targzArgs: string[] };
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
  bootLogPath: string | null;
  rootDiskMode: "block" | "none";
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

const provisionGuestCpuValues = ["arm64", "amd64"] as const;
const scratchDiskActions = ["none", "existing", "clone", "allocate"] as const;
const rootDiskRuntimeActions = ["none", "existing", "clone-restore", "clone-cached"] as const;
const mountDiskRuntimeActions = ["none", "restore", "fresh"] as const;
const registryRootDiskModes = ["block", "none"] as const;
const liveMountModes = ["ro", "rw"] as const;

export interface NativeBootPlanResult {
  memoryCeilingMib: number | null;
  vmmMemory: string | null;
  cpuPolicy: CpuPolicyPlan | null;
  wantsRootDisk: boolean;
  needsInitramfs: boolean;
  timeoutMs: number | null;
  detachedReadinessTimeoutMs: number;
  normalizedMountGuest: string | null;
  guestHostname: string | null;
  mergedGuestEnv: Record<string, string>;
  vsockUdsPath: string | null;
  vmmVsock: string | null;
  vmmCommand: string | null;
  vmmArgs: string[];
  usePdeathsig: boolean;
  vmmKernel: string | null;
  vmmDtb: string | null;
  vmmSnapshotPath: string | null;
  vmmRestorePath: string | null;
  vmmVmstateTiming: string | null;
  vmmNested: string | null;
  virtiofsEnv: Record<string, string>;
  plannedLiveMounts: PlannedLiveMount[];
  statsFilePath: string | null;
  vmmStatsFile: string | null;
  vmstateRuntime: BootVmstateRuntimePlan;
  plannedPortForward: PlannedPortForward[];
  machinenConfig: MachinenConfigPlan;
  bundleCommand: string[];
  bundleEnv: Record<string, string>;
  bundleWorkspace: BundleWorkspacePlan;
  bundleConfigPaths: BundleConfigPathsPlan;
  provisionAssets: ProvisionAssetsPlan;
  provisionBoot: ProvisionBootPlan;
  provisionWorkload: ProvisionWorkloadPlan;
  provisionRepack: ProvisionRepackPlan;
  provisionImageConfig: ProvisionImageConfigPlan;
  provisionRuntime: ProvisionRuntimePlan;
  scratchDisk: ScratchDiskPlan;
  rootDiskRuntime: RootDiskRuntimePlan;
  mountDiskRuntime: MountDiskRuntimePlan;
  registryShape: RegistryShapePlan;
}

export function isNativeBootPlanResult(value: unknown): value is NativeBootPlanResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<NativeBootPlanResult>;
  return [
    nullableNonNegativeNumber(data.memoryCeilingMib),
    nullableString(data.vmmMemory),
    nullableCpuPolicy(data.cpuPolicy),
    typeof data.wantsRootDisk === "boolean",
    typeof data.needsInitramfs === "boolean",
    nullableNonNegativeNumber(data.timeoutMs),
    nonNegativeNumber(data.detachedReadinessTimeoutMs),
    nullableString(data.normalizedMountGuest),
    nullableString(data.guestHostname),
    isStringRecord(data.mergedGuestEnv),
    nullableString(data.vsockUdsPath),
    nullableString(data.vmmVsock),
    nullableString(data.vmmCommand),
    isStringArray(data.vmmArgs),
    typeof data.usePdeathsig === "boolean",
    nullableString(data.vmmKernel),
    nullableString(data.vmmDtb),
    nullableString(data.vmmSnapshotPath),
    nullableString(data.vmmRestorePath),
    nullableString(data.vmmVmstateTiming),
    nullableString(data.vmmNested),
    isStringRecord(data.virtiofsEnv),
    Array.isArray(data.plannedLiveMounts) && data.plannedLiveMounts.every(isPlannedLiveMount),
    nullableString(data.statsFilePath),
    nullableString(data.vmmStatsFile),
    isBootVmstateRuntimePlan(data.vmstateRuntime),
    Array.isArray(data.plannedPortForward) && data.plannedPortForward.every(isPlannedPortForward),
    isMachinenConfigPlan(data.machinenConfig),
    isStringArray(data.bundleCommand),
    isStringRecord(data.bundleEnv),
    isBundleWorkspacePlan(data.bundleWorkspace),
    isBundleConfigPathsPlan(data.bundleConfigPaths),
    isProvisionAssetsPlan(data.provisionAssets),
    isProvisionBootPlan(data.provisionBoot),
    isProvisionWorkloadPlan(data.provisionWorkload),
    isProvisionRepackPlan(data.provisionRepack),
    isProvisionImageConfigPlan(data.provisionImageConfig),
    isProvisionRuntimePlan(data.provisionRuntime),
    isScratchDiskPlan(data.scratchDisk),
    isRootDiskRuntimePlan(data.rootDiskRuntime),
    isMountDiskRuntimePlan(data.mountDiskRuntime),
    isRegistryShapePlan(data.registryShape),
  ].every(Boolean);
}

function isBundleWorkspacePlan(value: unknown): value is BundleWorkspacePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<BundleWorkspacePlan>;
  return [nullableString(plan.cpioPath), nullableString(plan.synthBundleDir)].every(Boolean);
}

function isBundleConfigPathsPlan(value: unknown): value is BundleConfigPathsPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<BundleConfigPathsPlan>;
  return [nullableString(plan.rootfsDir), nullableString(plan.configPath)].every(Boolean);
}

function nullableCpuPolicy(value: unknown): value is CpuPolicyPlan | null {
  return value === null || isCpuPolicyPlan(value);
}

function isCpuPolicyPlan(value: unknown): value is CpuPolicyPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<CpuPolicyPlan>;
  return [
    nonNegativeNumber(plan.maxVcpus),
    plan.quotaCpus === undefined || nonNegativeNumber(plan.quotaCpus),
    nonNegativeNumber(plan.weight),
  ].every(Boolean);
}

function isProvisionAssetsPlan(value: unknown): value is ProvisionAssetsPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<ProvisionAssetsPlan>;
  return [
    isOneOf(plan.cpu, provisionGuestCpuValues),
    typeof plan.kernelAsset === "string",
    nullableString(plan.dtbAsset),
    typeof plan.rootfsAsset === "string",
  ].every(Boolean);
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
  return isStringArray(plan.extractArgs) && isStringArray(plan.targzArgs);
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
  return [
    isOneOf(plan.action, scratchDiskActions),
    nullableString(plan.diskPath),
    nullableString(plan.perBootSnapDisk),
    nullableString(plan.vmmDisk),
  ].every(Boolean);
}

function isRootDiskRuntimePlan(value: unknown): value is RootDiskRuntimePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<RootDiskRuntimePlan>;
  return [
    isOneOf(plan.action, rootDiskRuntimeActions),
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
    isOneOf(plan.action, mountDiskRuntimeActions),
    nullableString(plan.lowerPath),
    nullableString(plan.upperPath),
    nullableString(plan.sourceUpperPath),
    nullableString(plan.guest),
    nullableNonNegativeNumber(plan.upperSizeBytes),
  ].every(Boolean);
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
    nullableString(plan.bootLogPath),
    isOneOf(plan.rootDiskMode, registryRootDiskModes),
    isStringArray(plan.cleanupPaths),
    nullableRegistryMountDisk(plan.mountDisk),
    Array.isArray(plan.liveMounts),
    plan.liveMounts?.every(isRegistryLiveMount) === true,
    nullableObject(plan.portForward, isRegistryPortForwardArray),
    nullableRegistryCpu(plan.cpu),
    isRegistryVmstatePlan(plan.vmstate),
    typeof plan.nested === "boolean",
  ].every(Boolean);
}

function isBootVmstateRuntimePlan(value: unknown): value is BootVmstateRuntimePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  return isVmstatePlanShape(value as Partial<BootVmstateRuntimePlan>);
}

function isVmstatePlanShape(plan: Partial<BootVmstateRuntimePlan>): boolean {
  return (
    nullableString(plan.statePath) &&
    nullableString(plan.chainId) &&
    nullableString(plan.checkpointParent) &&
    nullableNonNegativeNumber(plan.checkpointSequence)
  );
}

function isRegistryPortForwardArray(value: unknown): value is RegistryPortForwardPlan[] {
  return Array.isArray(value) && value.every(isPlannedPortForward);
}

function isPlannedPortForward(value: unknown): value is PlannedPortForward {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mapping = value as Partial<PlannedPortForward>;
  return [
    nonNegativeNumber(mapping.hostPort),
    nonNegativeNumber(mapping.guestPort),
    optionalString(mapping.hostAddr),
  ].every(Boolean);
}

function isRegistryVmstatePlan(value: unknown): value is RegistryVmstatePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  return isVmstatePlanShape(value as Partial<RegistryVmstatePlan>);
}

function nullableRegistryCpu(value: unknown): value is RegistryCpuPlan | null {
  return value === null || isRegistryCpuPlan(value);
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
  return [
    isOneOf(enforcement.status, ["none", "linux-cgroup-v2", "unsupported"] as const),
    enforcement.reason === undefined || typeof enforcement.reason === "string",
  ].every(Boolean);
}

function isRegistryMountDisk(value: unknown): value is RegistryMountDiskPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mount = value as Partial<RegistryMountDiskPlan>;
  return [
    typeof mount.guest === "string",
    typeof mount.lowerPath === "string",
    typeof mount.upperPath === "string",
  ].every(Boolean);
}

function nullableRegistryMountDisk(value: unknown): boolean {
  return value === null || isRegistryMountDisk(value);
}

function isRegistryLiveMount(value: unknown): value is RegistryLiveMountPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mount = value as Partial<RegistryLiveMountPlan>;
  return [
    typeof mount.guest === "string",
    typeof mount.host === "string",
    isOneOf(mount.mode, liveMountModes),
  ].every(Boolean);
}

function isPlannedLiveMount(value: unknown): value is PlannedLiveMount {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mount = value as Partial<PlannedLiveMount>;
  return [
    typeof mount.host === "string",
    typeof mount.guest === "string",
    isOneOf(mount.mode, liveMountModes),
    typeof mount.tag === "string",
  ].every(Boolean);
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function nullableObject<T>(value: unknown, check: (candidate: unknown) => candidate is T): boolean {
  return value === null || check(value);
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
