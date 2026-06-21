type ScratchDiskAction = "none" | "existing" | "clone" | "allocate";
type RootDiskRuntimeAction = "none" | "existing" | "clone-restore" | "clone-cached";
type MountDiskRuntimeAction = "none" | "restore" | "fresh";
export type ProvisionGuestCpu = "arm64" | "amd64";
export type PlannedLiveMount = { host: string; guest: string; mode: "ro" | "rw"; tag: string };
type CpuPolicyPlan = { maxVcpus: number; quotaCpus?: number; weight: number };
type RegistryMountDiskPlan = { guest: string; lowerPath: string; upperPath: string };
type RegistryLiveMountPlan = { guest: string; host: string; mode: "ro" | "rw" };
type RegistryCpuPlan = {
  maxVcpus: number;
  quotaCpus?: number;
  weight: number;
  enforcement: { status: "none" | "linux-cgroup-v2" | "unsupported"; reason?: string };
};
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
  rootDiskPath: string | null;
  rootDiskMode: "block" | "none";
  cleanupPaths: string[];
  mountDisk: RegistryMountDiskPlan | null;
  liveMounts: RegistryLiveMountPlan[];
  cpu: RegistryCpuPlan | null;
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
  normalizedMountGuest: string | null;
  mergedGuestEnv: Record<string, string>;
  vsockUdsPath: string | null;
  vmmVsock: string | null;
  vmmCommand: string | null;
  vmmArgs: string[];
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
  machinenConfig: MachinenConfigPlan;
  bundleCommand: string[];
  bundleEnv: Record<string, string>;
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
    data.cpuPolicy === null || isCpuPolicyPlan(data.cpuPolicy),
    typeof data.wantsRootDisk === "boolean",
    nullableString(data.normalizedMountGuest),
    isStringRecord(data.mergedGuestEnv),
    nullableString(data.vsockUdsPath),
    nullableString(data.vmmVsock),
    nullableString(data.vmmCommand),
    isStringArray(data.vmmArgs),
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
    isMachinenConfigPlan(data.machinenConfig),
    isStringArray(data.bundleCommand),
    isStringRecord(data.bundleEnv),
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

function isRegistryShapePlan(value: unknown): value is RegistryShapePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<RegistryShapePlan>;
  return [
    nullableString(plan.sourceImagePath),
    nullableString(plan.rootDiskPath),
    oneOfString(plan.rootDiskMode, ["block", "none"]),
    isStringArray(plan.cleanupPaths),
    nullableObject(plan.mountDisk, isRegistryMountDisk),
    Array.isArray(plan.liveMounts) && plan.liveMounts.every(isRegistryLiveMount),
    nullableObject(plan.cpu, isRegistryCpuPlan),
  ].every(Boolean);
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
