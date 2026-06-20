import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import type { BootMemoryResourceOptions } from "../vm/memory-resources.ts";

type RootDiskPlanMode = "unset" | "false" | "path" | "true";
type ScratchDiskMode = "false" | "path" | "auto";
type ScratchDiskAction = "none" | "existing" | "clone" | "allocate";
type RootDiskRuntimeMode = "none" | "path" | "restore" | "cached";
type RootDiskRuntimeAction = "none" | "existing" | "clone-restore" | "clone-cached";
type MountDiskRuntimeMode = "none" | "restore" | "fresh";
type MountDiskRuntimeAction = "none" | "restore" | "fresh";
type ProvisionGuestCpu = "arm64" | "amd64";

type PortForwardPlanMapping = { hostPort: number; guestPort: number; hostAddr?: string };
type LiveMountPlanInput = { host: string; guest: string; mode?: string };
type PlannedLiveMount = { host: string; guest: string; mode: "ro" | "rw"; tag: string };
type RegistryMountDiskPlan = { guest: string; lowerPath: string; upperPath: string };
type RegistryLiveMountPlan = { guest: string; host: string; mode: "ro" | "rw" };
type ProvisionAssetsPlan = {
  cpu: ProvisionGuestCpu;
  kernelAsset: string;
  dtbAsset: string | null;
  rootfsAsset: string;
};

type ProvisionBootPlan = {
  imagePath: string | null;
  kernelPath: string | null;
  dtbPath: string | null;
  vmmVsock: string | null;
  cmd: string[];
  env: Record<string, string>;
  snapshotPath: string | null;
  rootDiskPath: string | null;
};

type ProvisionWorkloadPlan = {
  tarToDiskCommand: string;
  poweroffCommand: string;
};

type ProvisionRepackPlan = {
  extractArgs: string[];
  targzArgs: string[];
};

type ProvisionImageConfigPlan = {
  cmd?: string[];
  env?: Record<string, string>;
} | null;

type RegistryShapePlan = {
  sourceImagePath: string | null;
  rootDiskPath: string | null;
  rootDiskMode: "block" | "none";
  cleanupPaths: string[];
  mountDisk: RegistryMountDiskPlan | null;
  liveMounts: RegistryLiveMountPlan[];
};

interface NativeBootPlanInput {
  memoryMib?: number;
  resourcesMemory?: BootMemoryResourceOptions;
  autoMemoryMib?: number;
  hostTotalBytes?: number;
  vmmMemoryPreset: boolean;
  hasImage: boolean;
  hasCmd: boolean;
  rootDisk: RootDiskPlanMode;
  guestCwd?: string;
  mountGuest?: string;
  guestEnv?: Record<string, string>;
  name?: string;
  vsockUdsPath?: string;
  existingVsockSpec?: string;
  autoVsockUdsPath?: string;
  portForward?: PortForwardPlanMapping[];
  vmmBinary?: string;
  vmmArgs?: string[];
  pdeathsigPath?: string;
  kernelPath?: string;
  dtbPath?: string;
  vmstatePath?: string;
  restorePath?: string;
  enableVmstateTiming?: boolean;
  existingVmstateTiming?: string;
  liveMounts?: LiveMountPlanInput[];
  liveMountsResolved?: PlannedLiveMount[];
  existingStatsFile?: string;
  statsFilePath?: string;
  configCmd?: string[];
  configEnv?: Record<string, string>;
  configGuestCwd?: string;
  configImageCwd?: string;
  configLiveMounts?: PlannedLiveMount[];
  bundleExplicitCmd?: string[];
  bundleImageCmd?: string[];
  bundleSnapshotRestore?: boolean;
  bundleVmstateRestore?: boolean;
  bundleLiveMounts?: PlannedLiveMount[];
  bundleCommandRequired?: boolean;
  bundleImageEnv?: Record<string, string>;
  bundleGuestEnv?: Record<string, string>;
  provisionGuestCpu?: ProvisionGuestCpu;
  provisionBasePath?: string;
  provisionKernelPath?: string;
  provisionDtbPath?: string;
  provisionUdsPath?: string;
  provisionScratchDiskPath?: string;
  provisionRootDiskPath?: string;
  provisionRepackDiskPath?: string;
  provisionRepackOutPath?: string;
  provisionRepackExtractDir?: string;
  provisionImageConfigCmd?: string[];
  provisionImageConfigEnv?: Record<string, string>;
  scratchMode?: ScratchDiskMode;
  scratchSnapshotPath?: string;
  scratchRestoreClonePath?: string;
  scratchAutoPath?: string;
  rootDiskRuntimeMode?: RootDiskRuntimeMode;
  rootDiskSourcePath?: string;
  rootDiskClonePath?: string;
  mountDiskRuntimeMode?: MountDiskRuntimeMode;
  mountDiskLowerPath?: string;
  mountDiskUpperPath?: string;
  mountDiskSourceUpperPath?: string;
  mountDiskGuest?: string;
  mountDiskUpperSize?: number;
  registrySourceImagePath?: string;
  registryPerBootRootDisk?: string;
  registryCallerRootDiskPath?: string;
  registryPerBootSnapDisk?: string;
  registryPerBootMountUpper?: string;
  registryBundleTempDir?: string;
  registryVsockTempDir?: string;
  registryStatsTempDir?: string;
  registryGvSocketDir?: string;
  registryCpuCgroupPath?: string;
  registryMountGuest?: string;
  registryMountLowerPath?: string;
  registryMountUpperPath?: string;
}

interface NativeBootPlanResult {
  memoryCeilingMib: number | null;
  vmmMemory: string | null;
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
  scratchDisk: ScratchDiskPlan;
  rootDiskRuntime: RootDiskRuntimePlan;
  mountDiskRuntime: MountDiskRuntimePlan;
  registryShape: RegistryShapePlan;
}

type ScratchDiskPlan = {
  action: ScratchDiskAction;
  diskPath: string | null;
  perBootSnapDisk: string | null;
  vmmDisk: string | null;
};

type RootDiskRuntimePlan = {
  action: RootDiskRuntimeAction;
  sourcePath: string | null;
  targetPath: string | null;
  perBootRootDisk: string | null;
  vmmRootDisk: string | null;
};

type MountDiskRuntimePlan = {
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

export function planBootCoreNative(input: NativeBootPlanInput): NativeBootPlanResult {
  return callRuntimeHelper({
    command: "boot-plan",
    data: buildBootPlanRequestData(input),
    errorCode: "BOOT_MEMORY_INVALID",
    makeError: bootPlanError,
    isData: isNativeBootPlanResult,
  });
}

function buildBootPlanRequestData(input: NativeBootPlanInput): Record<string, unknown> {
  return {
    memoryMib: numberText(input.memoryMib),
    resourcesMemory: resourcesMemoryData(input.resourcesMemory),
    autoMemoryMib: numberText(input.autoMemoryMib),
    hostTotalBytes: numberText(input.hostTotalBytes),
    vmmMemoryPreset: input.vmmMemoryPreset,
    hasImage: input.hasImage,
    hasCmd: input.hasCmd,
    rootDisk: input.rootDisk,
    guestCwd: nullDefault(input.guestCwd),
    mountGuest: nullDefault(input.mountGuest),
    guestEnv: input.guestEnv ?? {},
    name: nullDefault(input.name),
    vsockUdsPath: nullDefault(input.vsockUdsPath),
    existingVsockSpec: nullDefault(input.existingVsockSpec),
    autoVsockUdsPath: nullDefault(input.autoVsockUdsPath),
    portForward: input.portForward ?? [],
    vmmBinary: nullDefault(input.vmmBinary),
    vmmArgs: input.vmmArgs ?? [],
    pdeathsigPath: nullDefault(input.pdeathsigPath),
    kernelPath: nullDefault(input.kernelPath),
    dtbPath: nullDefault(input.dtbPath),
    vmstatePath: nullDefault(input.vmstatePath),
    restorePath: nullDefault(input.restorePath),
    enableVmstateTiming: input.enableVmstateTiming === true,
    existingVmstateTiming: nullDefault(input.existingVmstateTiming),
    liveMounts: liveMountsData(input.liveMounts),
    liveMountsResolved: input.liveMountsResolved ?? [],
    existingStatsFile: nullDefault(input.existingStatsFile),
    statsFilePath: nullDefault(input.statsFilePath),
    configCmd: input.configCmd ?? [],
    configEnv: input.configEnv ?? {},
    configGuestCwd: nullDefault(input.configGuestCwd),
    configImageCwd: nullDefault(input.configImageCwd),
    configLiveMounts: input.configLiveMounts ?? [],
    ...bundleCommandData(input),
    ...provisionData(input),
    ...scratchDiskData(input),
    ...rootDiskRuntimeData(input),
    ...mountDiskRuntimeData(input),
    ...registryShapeData(input),
  };
}

function bundleCommandData(input: NativeBootPlanInput): Record<string, unknown> {
  return {
    bundleExplicitCmd: input.bundleExplicitCmd ?? null,
    bundleImageCmd: input.bundleImageCmd ?? null,
    bundleSnapshotRestore: input.bundleSnapshotRestore === true,
    bundleVmstateRestore: input.bundleVmstateRestore === true,
    bundleLiveMounts: input.bundleLiveMounts ?? [],
    bundleCommandRequired: input.bundleCommandRequired === true,
    bundleImageEnv: input.bundleImageEnv ?? {},
    bundleGuestEnv: input.bundleGuestEnv ?? {},
  };
}

function provisionData(input: NativeBootPlanInput): Record<string, unknown> {
  return {
    provisionGuestCpu: input.provisionGuestCpu ?? null,
    provisionBasePath: nullDefault(input.provisionBasePath),
    provisionKernelPath: nullDefault(input.provisionKernelPath),
    provisionDtbPath: nullDefault(input.provisionDtbPath),
    provisionUdsPath: nullDefault(input.provisionUdsPath),
    provisionScratchDiskPath: nullDefault(input.provisionScratchDiskPath),
    provisionRootDiskPath: nullDefault(input.provisionRootDiskPath),
    provisionRepackDiskPath: nullDefault(input.provisionRepackDiskPath),
    provisionRepackOutPath: nullDefault(input.provisionRepackOutPath),
    provisionRepackExtractDir: nullDefault(input.provisionRepackExtractDir),
    provisionImageConfigHasCmd: input.provisionImageConfigCmd !== undefined,
    provisionImageConfigCmd: input.provisionImageConfigCmd ?? [],
    provisionImageConfigHasEnv: input.provisionImageConfigEnv !== undefined,
    provisionImageConfigEnv: input.provisionImageConfigEnv ?? {},
  };
}

function scratchDiskData(input: NativeBootPlanInput): Record<string, unknown> {
  return {
    scratchMode: input.scratchMode ?? null,
    scratchSnapshotPath: nullDefault(input.scratchSnapshotPath),
    scratchRestoreClonePath: nullDefault(input.scratchRestoreClonePath),
    scratchAutoPath: nullDefault(input.scratchAutoPath),
  };
}

function rootDiskRuntimeData(input: NativeBootPlanInput): Record<string, unknown> {
  return {
    rootDiskRuntimeMode: input.rootDiskRuntimeMode ?? null,
    rootDiskSourcePath: nullDefault(input.rootDiskSourcePath),
    rootDiskClonePath: nullDefault(input.rootDiskClonePath),
  };
}

function mountDiskRuntimeData(input: NativeBootPlanInput): Record<string, unknown> {
  return {
    mountDiskRuntimeMode: input.mountDiskRuntimeMode ?? null,
    mountDiskLowerPath: nullDefault(input.mountDiskLowerPath),
    mountDiskUpperPath: nullDefault(input.mountDiskUpperPath),
    mountDiskSourceUpperPath: nullDefault(input.mountDiskSourceUpperPath),
    mountDiskGuest: nullDefault(input.mountDiskGuest),
    mountDiskUpperSize: numberText(input.mountDiskUpperSize),
  };
}

function registryShapeData(input: NativeBootPlanInput): Record<string, unknown> {
  return {
    registrySourceImagePath: nullDefault(input.registrySourceImagePath),
    registryPerBootRootDisk: nullDefault(input.registryPerBootRootDisk),
    registryCallerRootDiskPath: nullDefault(input.registryCallerRootDiskPath),
    registryPerBootSnapDisk: nullDefault(input.registryPerBootSnapDisk),
    registryPerBootMountUpper: nullDefault(input.registryPerBootMountUpper),
    registryBundleTempDir: nullDefault(input.registryBundleTempDir),
    registryVsockTempDir: nullDefault(input.registryVsockTempDir),
    registryStatsTempDir: nullDefault(input.registryStatsTempDir),
    registryGvSocketDir: nullDefault(input.registryGvSocketDir),
    registryCpuCgroupPath: nullDefault(input.registryCpuCgroupPath),
    registryMountGuest: nullDefault(input.registryMountGuest),
    registryMountLowerPath: nullDefault(input.registryMountLowerPath),
    registryMountUpperPath: nullDefault(input.registryMountUpperPath),
  };
}

function resourcesMemoryData(memory: BootMemoryResourceOptions | undefined): unknown {
  if (!memory) {
    return null;
  }
  return {
    maxMib: numberTextRequired(memory.maxMib),
    reclaim: nullDefault(memory.reclaim),
  };
}

function liveMountsData(liveMounts: LiveMountPlanInput[] | undefined): unknown[] {
  return (liveMounts ?? []).map((mount) => ({
    host: mount.host,
    guest: mount.guest,
    mode: mount.mode ?? null,
  }));
}

function nullDefault<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

export function planProvisionWorkloadNative(): ProvisionWorkloadPlan {
  return planBootCoreNative({
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).provisionWorkload;
}

export function planProvisionRepackNative(input: {
  diskPath: string;
  outPath: string;
  extractDir: string;
}): ProvisionRepackPlan {
  return planBootCoreNative({
    provisionRepackDiskPath: input.diskPath,
    provisionRepackOutPath: input.outPath,
    provisionRepackExtractDir: input.extractDir,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).provisionRepack;
}

export function planProvisionImageConfigNative(input: {
  cmd?: string[];
  env?: Record<string, string>;
}): ProvisionImageConfigPlan {
  return planBootCoreNative({
    provisionImageConfigCmd: input.cmd,
    provisionImageConfigEnv: input.env,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).provisionImageConfig;
}

export function planProvisionBootNative(input: {
  basePath: string;
  kernelPath: string;
  dtbPath?: string;
  udsPath: string;
  scratchDiskPath: string;
  rootDiskPath: string;
}): ProvisionBootPlan {
  return planBootCoreNative({
    provisionBasePath: input.basePath,
    provisionKernelPath: input.kernelPath,
    provisionDtbPath: input.dtbPath,
    provisionUdsPath: input.udsPath,
    provisionScratchDiskPath: input.scratchDiskPath,
    provisionRootDiskPath: input.rootDiskPath,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).provisionBoot;
}

export function planProvisionAssetsNative(cpu: ProvisionGuestCpu): ProvisionAssetsPlan {
  return planBootCoreNative({
    provisionGuestCpu: cpu,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).provisionAssets;
}

export function planBootMountDiskRuntimeNative(input: {
  mode: MountDiskRuntimeMode;
  lowerPath?: string;
  upperPath?: string;
  sourceUpperPath?: string;
  guest?: string;
  upperSizeBytes?: number;
}): MountDiskRuntimePlan {
  return planBootCoreNative({
    mountDiskRuntimeMode: input.mode,
    mountDiskLowerPath: input.lowerPath,
    mountDiskUpperPath: input.upperPath,
    mountDiskSourceUpperPath: input.sourceUpperPath,
    mountDiskGuest: input.guest,
    mountDiskUpperSize: input.upperSizeBytes,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).mountDiskRuntime;
}

export function planBootRegistryShapeNative(input: {
  sourceImagePath?: string;
  rootDisk?: {
    perBootRootDisk?: string;
    callerRootDiskPath?: string;
  };
  cleanup?: {
    perBootRootDisk?: string;
    perBootSnapDisk?: string;
    perBootMountUpper?: string;
    bundleTempDir?: string;
    vsockTempDir?: string;
    statsTempDir?: string;
    gvSocketDir?: string;
    cpuCgroupPath?: string;
  };
  mountDisk?: { guest: string; lowerPath: string; upperPath: string };
  liveMounts?: PlannedLiveMount[];
}): RegistryShapePlan {
  return planBootCoreNative({
    registrySourceImagePath: input.sourceImagePath,
    registryPerBootRootDisk: input.rootDisk?.perBootRootDisk ?? input.cleanup?.perBootRootDisk,
    registryCallerRootDiskPath: input.rootDisk?.callerRootDiskPath,
    registryPerBootSnapDisk: input.cleanup?.perBootSnapDisk,
    registryPerBootMountUpper: input.cleanup?.perBootMountUpper,
    registryBundleTempDir: input.cleanup?.bundleTempDir,
    registryVsockTempDir: input.cleanup?.vsockTempDir,
    registryStatsTempDir: input.cleanup?.statsTempDir,
    registryGvSocketDir: input.cleanup?.gvSocketDir,
    registryCpuCgroupPath: input.cleanup?.cpuCgroupPath,
    registryMountGuest: input.mountDisk?.guest,
    registryMountLowerPath: input.mountDisk?.lowerPath,
    registryMountUpperPath: input.mountDisk?.upperPath,
    liveMountsResolved: input.liveMounts,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).registryShape;
}

export function planBootBundleEnvNative(input: {
  imageEnv?: Record<string, string>;
  guestEnv: Record<string, string>;
}): Record<string, string> {
  return planBootCoreNative({
    bundleImageEnv: input.imageEnv,
    bundleGuestEnv: input.guestEnv,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).bundleEnv;
}

export function planBootRootDiskRuntimeNative(input: {
  mode: RootDiskRuntimeMode;
  sourcePath?: string;
  clonePath?: string;
}): RootDiskRuntimePlan {
  return planBootCoreNative({
    rootDiskRuntimeMode: input.mode,
    rootDiskSourcePath: input.sourcePath,
    rootDiskClonePath: input.clonePath,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).rootDiskRuntime;
}

export function planBootScratchDiskNative(input: {
  mode: ScratchDiskMode;
  hasCmd: boolean;
  hasImage: boolean;
  snapshotPath?: string;
  restoreClonePath?: string;
  autoPath?: string;
}): ScratchDiskPlan {
  return planBootCoreNative({
    scratchMode: input.mode,
    scratchSnapshotPath: input.snapshotPath,
    scratchRestoreClonePath: input.restoreClonePath,
    scratchAutoPath: input.autoPath,
    vmmMemoryPreset: true,
    hasImage: input.hasImage,
    hasCmd: input.hasCmd,
    rootDisk: "false",
  }).scratchDisk;
}

export function planBootBundleCommandNative(input: {
  explicitCmd?: string[];
  imageCmd?: string[];
  snapshotRestore: boolean;
  vmstateRestore: boolean;
  liveMounts: PlannedLiveMount[];
}): string[] {
  return planBootCoreNative({
    bundleExplicitCmd: input.explicitCmd,
    bundleImageCmd: input.imageCmd,
    bundleSnapshotRestore: input.snapshotRestore,
    bundleVmstateRestore: input.vmstateRestore,
    bundleLiveMounts: input.liveMounts,
    bundleCommandRequired: true,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).bundleCommand;
}

export function planBootMachinenConfigNative(input: {
  cmd: string[];
  env: Record<string, string>;
  guestCwd?: string;
  imageCwd?: string;
  liveMounts: PlannedLiveMount[];
}): Record<string, unknown> {
  return planBootCoreNative({
    configCmd: input.cmd,
    configEnv: input.env,
    configGuestCwd: input.guestCwd,
    configImageCwd: input.imageCwd,
    configLiveMounts: input.liveMounts,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).machinenConfig;
}

export function planBootStatsFileNative(input: { existingPath?: string; plannedPath?: string }): {
  statsFilePath?: string;
  vmmStatsFile?: string;
} {
  const plan = planBootCoreNative({
    existingStatsFile: input.existingPath,
    statsFilePath: input.plannedPath,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  });
  return {
    statsFilePath: plan.statsFilePath ?? undefined,
    vmmStatsFile: plan.vmmStatsFile ?? undefined,
  };
}

export function planBootLiveMountsNative(liveMounts: LiveMountPlanInput[]): PlannedLiveMount[] {
  return planBootCoreNative({
    liveMounts,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).plannedLiveMounts;
}

export function planBootVirtiofsEnvNative(liveMounts: PlannedLiveMount[]): Record<string, string> {
  return planBootCoreNative({
    liveMountsResolved: liveMounts,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).virtiofsEnv;
}

export function planBootVmstateEnvNative(input: {
  vmstatePath?: string;
  restorePath?: string;
  enableTiming: boolean;
  existingTiming?: string;
}): { snapshotPath?: string; restorePath?: string; vmstateTiming?: string } {
  const plan = planBootCoreNative({
    vmstatePath: input.vmstatePath,
    restorePath: input.restorePath,
    enableVmstateTiming: input.enableTiming,
    existingVmstateTiming: input.existingTiming,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  });
  return {
    snapshotPath: plan.vmmSnapshotPath ?? undefined,
    restorePath: plan.vmmRestorePath ?? undefined,
    vmstateTiming: plan.vmmVmstateTiming ?? undefined,
  };
}

export function planBootKernelDtbNative(input: { kernelPath?: string; dtbPath?: string }): {
  kernelPath?: string;
  dtbPath?: string;
} {
  const plan = planBootCoreNative({
    kernelPath: input.kernelPath,
    dtbPath: input.dtbPath,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  });
  return {
    kernelPath: plan.vmmKernel ?? undefined,
    dtbPath: plan.vmmDtb ?? undefined,
  };
}

export function planBootVmmArgvNative(input: {
  binary: string;
  args: string[];
  pdeathsigPath: string | null;
}): { command: string; args: string[] } {
  const plan = planBootCoreNative({
    vmmBinary: input.binary,
    vmmArgs: input.args,
    pdeathsigPath: input.pdeathsigPath ?? undefined,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  });
  if (plan.vmmCommand === null) {
    throw new BootError("BOOT_VMM_MISSING", "boot: native planner returned no VMM command");
  }
  return { command: plan.vmmCommand, args: plan.vmmArgs };
}

export function validateBootPortForwardNative(portForward: PortForwardPlanMapping[]): void {
  planBootCoreNative({
    portForward,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  });
}

export function rootDiskPlanMode(rootDisk: boolean | string | undefined): RootDiskPlanMode {
  if (rootDisk === false) {
    return "false";
  }
  if (rootDisk === true) {
    return "true";
  }
  if (typeof rootDisk === "string") {
    return "path";
  }
  return "unset";
}

function bootPlanError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}

function numberText(value: number | undefined): string | null {
  return value === undefined ? null : String(value);
}

function numberTextRequired(value: number): string {
  return String(value);
}

function isNativeBootPlanResult(value: unknown): value is NativeBootPlanResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<NativeBootPlanResult>;
  return [
    nullableNonNegativeNumber(data.memoryCeilingMib),
    nullableString(data.vmmMemory),
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
    isStringRecord(data.virtiofsEnv),
    isPlannedLiveMountArray(data.plannedLiveMounts),
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
    isScratchDiskPlan(data.scratchDisk),
    isRootDiskRuntimePlan(data.rootDiskRuntime),
    isMountDiskRuntimePlan(data.mountDiskRuntime),
    isRegistryShapePlan(data.registryShape),
  ].every(Boolean);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isPlannedLiveMountArray(value: unknown): value is PlannedLiveMount[] {
  return Array.isArray(value) && value.every(isPlannedLiveMount);
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

function isScratchDiskPlan(value: unknown): value is ScratchDiskPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<ScratchDiskPlan>;
  return (
    isScratchDiskAction(plan.action) &&
    nullableString(plan.diskPath) &&
    nullableString(plan.perBootSnapDisk) &&
    nullableString(plan.vmmDisk)
  );
}

function isScratchDiskAction(value: unknown): value is ScratchDiskAction {
  return value === "none" || value === "existing" || value === "clone" || value === "allocate";
}

function isRootDiskRuntimePlan(value: unknown): value is RootDiskRuntimePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<RootDiskRuntimePlan>;
  return (
    isRootDiskRuntimeAction(plan.action) &&
    nullableString(plan.sourcePath) &&
    nullableString(plan.targetPath) &&
    nullableString(plan.perBootRootDisk) &&
    nullableString(plan.vmmRootDisk)
  );
}

function isRootDiskRuntimeAction(value: unknown): value is RootDiskRuntimeAction {
  return (
    value === "none" ||
    value === "existing" ||
    value === "clone-restore" ||
    value === "clone-cached"
  );
}

function isMountDiskRuntimePlan(value: unknown): value is MountDiskRuntimePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<MountDiskRuntimePlan>;
  return (
    isMountDiskRuntimeAction(plan.action) &&
    nullableString(plan.lowerPath) &&
    nullableString(plan.upperPath) &&
    nullableString(plan.sourceUpperPath) &&
    nullableString(plan.guest) &&
    nullableNonNegativeNumber(plan.upperSizeBytes)
  );
}

function isMountDiskRuntimeAction(value: unknown): value is MountDiskRuntimeAction {
  return value === "none" || value === "restore" || value === "fresh";
}

function isRegistryShapePlan(value: unknown): value is RegistryShapePlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Partial<RegistryShapePlan>;
  return [
    nullableString(plan.sourceImagePath),
    nullableString(plan.rootDiskPath),
    isRegistryRootDiskMode(plan.rootDiskMode),
    isStringArray(plan.cleanupPaths),
    plan.mountDisk === null || isRegistryMountDisk(plan.mountDisk),
    Array.isArray(plan.liveMounts) && plan.liveMounts.every(isRegistryLiveMount),
  ].every(Boolean);
}

function isRegistryRootDiskMode(value: unknown): value is "block" | "none" {
  return value === "block" || value === "none";
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const config = value as Partial<MachinenConfigPlan>;
  return (
    isStringArray(config.cmd) &&
    isStringRecord(config.env) &&
    optionalString(config.cwd) &&
    optionalConfigLiveMounts(config.liveMounts)
  );
}

function optionalConfigLiveMounts(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  return (
    Array.isArray(value) &&
    value.every((mount) => {
      if (!mount || typeof mount !== "object") {
        return false;
      }
      const entry = mount as { guest?: unknown; tag?: unknown; mode?: unknown };
      return (
        typeof entry.guest === "string" &&
        typeof entry.tag === "string" &&
        (entry.mode === "ro" || entry.mode === "rw")
      );
    })
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

function nullableNonNegativeNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}
