import type { CpuControlResult } from "../cpu-cgroup.ts";
import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import type { BootCpuResourceOptions, ResolvedCpuResourcePolicy } from "../vm/cpu-resources.ts";
import type { BootMemoryResourceOptions } from "../vm/memory-resources.ts";
import { isNativeBootPlanResult } from "./boot-plan-schema.ts";
import type {
  MountDiskRuntimePlan,
  PlannedLiveMount,
  PlannedPortForward,
  ProvisionAssetsPlan,
  ProvisionBootPlan,
  ProvisionGuestCpu,
  ProvisionImageConfigPlan,
  ProvisionRepackPlan,
  ProvisionRuntimePlan,
  ProvisionWorkloadPlan,
  RegistryShapePlan,
  RootDiskRuntimePlan,
  ScratchDiskPlan,
  NativeBootPlanResult,
} from "./boot-plan-schema.ts";

type RootDiskPlanMode = "unset" | "false" | "path" | "true";
type ScratchDiskMode = "false" | "path" | "auto";
type RootDiskRuntimeMode = "none" | "path" | "restore" | "cached";
type MountDiskRuntimeMode = "none" | "restore" | "fresh";

type PortForwardPlanMapping = { hostPort: number; guestPort: number; hostAddr?: string };
type LiveMountPlanInput = { host: string; guest: string; mode?: string };

interface NativeBootPlanInput {
  memoryMib?: number;
  resourcesMemory?: BootMemoryResourceOptions;
  resourcesCpu?: BootCpuResourceOptions;
  autoMemoryMib?: number;
  hostTotalBytes?: number;
  vmmMemoryPreset: boolean;
  hasImage: boolean;
  hasCmd: boolean;
  hasSnapshot?: boolean;
  rootDisk: RootDiskPlanMode;
  guestCwd?: string;
  mountGuest?: string;
  guestEnv?: Record<string, string>;
  name?: string;
  vsockUdsPath?: string;
  guestHostnamePid?: number;
  guestHostnameName?: string;
  existingVsockSpec?: string;
  autoVsockUdsPath?: string;
  portForward?: PortForwardPlanMapping[];
  vmmBinary?: string;
  vmmArgs?: string[];
  pdeathsigPath?: string;
  pdeathsig?: boolean;
  detached?: boolean;
  bootTimeoutMs?: number | null;
  kernelPath?: string;
  dtbPath?: string;
  vmstatePath?: string;
  restorePath?: string;
  enableVmstateTiming?: boolean;
  existingVmstateTiming?: string;
  nested?: boolean;
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
  provisionWorkDir?: string;
  provisionScratchSizeBytes?: number;
  provisionTimeoutMs?: number;
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
  registryBootLogRoot?: string;
  registryChildPid?: number;
  registryDetached?: boolean;
  registryPerBootSnapDisk?: string;
  registryPerBootMountUpper?: string;
  registryBundleTempDir?: string;
  registryVsockTempDir?: string;
  registryStatsTempDir?: string;
  registryGvSocketDir?: string;
  registryCpuCgroupPath?: string;
  registryCpuPolicy?: ResolvedCpuResourcePolicy;
  registryCpuControlStatus?: CpuControlResult["status"];
  registryCpuControlReason?: string;
  registryVmstatePath?: string;
  registryVmstateChainId?: string;
  registryVmstateCheckpointParent?: string;
  registryVmstateCheckpointSequence?: number;
  registryNested?: boolean;
  registryMountGuest?: string;
  registryMountLowerPath?: string;
  registryMountUpperPath?: string;
}

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
    resourcesCpu: resourcesCpuData(input.resourcesCpu),
    autoMemoryMib: numberText(input.autoMemoryMib),
    hostTotalBytes: numberText(input.hostTotalBytes),
    vmmMemoryPreset: input.vmmMemoryPreset,
    hasImage: input.hasImage,
    hasCmd: input.hasCmd,
    hasSnapshot: input.hasSnapshot === true,
    rootDisk: input.rootDisk,
    guestCwd: nullDefault(input.guestCwd),
    mountGuest: nullDefault(input.mountGuest),
    guestEnv: input.guestEnv ?? {},
    name: nullDefault(input.name),
    vsockUdsPath: nullDefault(input.vsockUdsPath),
    guestHostnamePid: numberText(input.guestHostnamePid),
    guestHostnameName: nullDefault(input.guestHostnameName),
    existingVsockSpec: nullDefault(input.existingVsockSpec),
    autoVsockUdsPath: nullDefault(input.autoVsockUdsPath),
    portForward: input.portForward ?? [],
    vmmBinary: nullDefault(input.vmmBinary),
    vmmArgs: input.vmmArgs ?? [],
    pdeathsigPath: nullDefault(input.pdeathsigPath),
    pdeathsig: input.pdeathsig ?? null,
    detached: input.detached === true,
    ...bootTimeoutData(input),
    kernelPath: nullDefault(input.kernelPath),
    dtbPath: nullDefault(input.dtbPath),
    vmstatePath: nullDefault(input.vmstatePath),
    restorePath: nullDefault(input.restorePath),
    enableVmstateTiming: input.enableVmstateTiming === true,
    existingVmstateTiming: nullDefault(input.existingVmstateTiming),
    nested: input.nested === true,
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

function bootTimeoutData(input: NativeBootPlanInput): Record<string, unknown> {
  return {
    bootTimeoutMs: input.bootTimeoutMs === null ? null : numberText(input.bootTimeoutMs),
    bootTimeoutForever: input.bootTimeoutMs === null,
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
    provisionWorkDir: nullDefault(input.provisionWorkDir),
    provisionScratchSizeBytes: numberText(input.provisionScratchSizeBytes),
    provisionTimeoutMs: numberText(input.provisionTimeoutMs),
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
    registryBootLogRoot: nullDefault(input.registryBootLogRoot),
    registryChildPid: numberText(input.registryChildPid),
    registryDetached: input.registryDetached === true,
    registryPerBootSnapDisk: nullDefault(input.registryPerBootSnapDisk),
    registryPerBootMountUpper: nullDefault(input.registryPerBootMountUpper),
    registryBundleTempDir: nullDefault(input.registryBundleTempDir),
    registryVsockTempDir: nullDefault(input.registryVsockTempDir),
    registryStatsTempDir: nullDefault(input.registryStatsTempDir),
    registryGvSocketDir: nullDefault(input.registryGvSocketDir),
    registryCpuCgroupPath: nullDefault(input.registryCpuCgroupPath),
    registryCpuPolicyMaxVcpus: numberText(input.registryCpuPolicy?.maxVcpus),
    registryCpuPolicyQuotaCpus: numberText(input.registryCpuPolicy?.quotaCpus),
    registryCpuPolicyWeight: numberText(input.registryCpuPolicy?.weight),
    registryCpuControlStatus: nullDefault(input.registryCpuControlStatus),
    registryCpuControlReason: nullDefault(input.registryCpuControlReason),
    registryVmstatePath: nullDefault(input.registryVmstatePath),
    registryVmstateChainId: nullDefault(input.registryVmstateChainId),
    registryVmstateCheckpointParent: nullDefault(input.registryVmstateCheckpointParent),
    registryVmstateCheckpointSequence: numberText(input.registryVmstateCheckpointSequence),
    registryNested: input.registryNested === true,
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

function resourcesCpuData(cpu: BootCpuResourceOptions | undefined): unknown {
  if (!cpu) {
    return null;
  }
  return {
    maxVcpus: numberText(cpu.maxVcpus),
    quotaCpus: numberText(cpu.quotaCpus),
    weight: numberText(cpu.weight),
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

export function planBootCpuResourcesNative(
  cpu: BootCpuResourceOptions | undefined,
): ResolvedCpuResourcePolicy | undefined {
  return (
    planBootCoreNative({
      resourcesCpu: cpu,
      vmmMemoryPreset: true,
      hasImage: false,
      hasCmd: false,
      rootDisk: "false",
    }).cpuPolicy ?? undefined
  );
}

export function planBootGuestHostnameNative(pid: number, name?: string): string {
  const plan = planBootCoreNative({
    guestHostnamePid: pid,
    guestHostnameName: name,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  });
  if (plan.guestHostname === null) {
    throw new BootError("BOOT_VMM_MISSING", "boot: native planner returned no guest hostname");
  }
  return plan.guestHostname;
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

export function planProvisionRuntimeNative(input: {
  workDir: string;
  scratchDiskSizeBytes?: number;
  timeoutMs?: number;
}): ProvisionRuntimePlan {
  return planBootCoreNative({
    provisionWorkDir: input.workDir,
    provisionScratchSizeBytes: input.scratchDiskSizeBytes,
    provisionTimeoutMs: input.timeoutMs,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).provisionRuntime;
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

interface BootRegistryShapeNativeInput {
  sourceImagePath?: string;
  rootDisk?: {
    perBootRootDisk?: string;
    callerRootDiskPath?: string;
  };
  bootLog?: { root: string; childPid: number; detached?: boolean };
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
  cpu?: {
    policy: ResolvedCpuResourcePolicy | undefined;
    control: CpuControlResult;
  };
  vmstate?: {
    statePath?: string;
    chainId?: string;
    checkpointParent?: string;
    checkpointSequence?: number;
  };
  nested?: boolean;
  mountDisk?: { guest: string; lowerPath: string; upperPath: string };
  liveMounts?: PlannedLiveMount[];
  portForward?: PortForwardPlanMapping[];
}

export function planBootRegistryShapeNative(
  input: BootRegistryShapeNativeInput,
): RegistryShapePlan {
  return planBootCoreNative({
    registrySourceImagePath: input.sourceImagePath,
    ...registryRootDiskData(input),
    ...registryBootLogData(input),
    ...registryCleanupData(input),
    ...registryCpuData(input),
    ...registryVmstateData(input),
    registryNested: input.nested,
    ...registryMountDiskData(input),
    liveMountsResolved: input.liveMounts,
    portForward: input.portForward,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).registryShape;
}

function registryRootDiskData(input: BootRegistryShapeNativeInput): Partial<NativeBootPlanInput> {
  return {
    registryPerBootRootDisk: input.rootDisk?.perBootRootDisk ?? input.cleanup?.perBootRootDisk,
    registryCallerRootDiskPath: input.rootDisk?.callerRootDiskPath,
  };
}

function registryBootLogData(input: BootRegistryShapeNativeInput): Partial<NativeBootPlanInput> {
  return {
    registryBootLogRoot: input.bootLog?.root,
    registryChildPid: input.bootLog?.childPid,
    registryDetached: input.bootLog?.detached,
  };
}

function registryCleanupData(input: BootRegistryShapeNativeInput): Partial<NativeBootPlanInput> {
  return {
    registryPerBootSnapDisk: input.cleanup?.perBootSnapDisk,
    registryPerBootMountUpper: input.cleanup?.perBootMountUpper,
    registryBundleTempDir: input.cleanup?.bundleTempDir,
    registryVsockTempDir: input.cleanup?.vsockTempDir,
    registryStatsTempDir: input.cleanup?.statsTempDir,
    registryGvSocketDir: input.cleanup?.gvSocketDir,
    registryCpuCgroupPath: input.cleanup?.cpuCgroupPath,
  };
}

function registryCpuData(input: BootRegistryShapeNativeInput): Partial<NativeBootPlanInput> {
  return {
    registryCpuPolicy: input.cpu?.policy,
    registryCpuControlStatus: input.cpu?.control.status,
    registryCpuControlReason: input.cpu?.control.reason,
  };
}

function registryVmstateData(input: BootRegistryShapeNativeInput): Partial<NativeBootPlanInput> {
  return {
    registryVmstatePath: input.vmstate?.statePath,
    registryVmstateChainId: input.vmstate?.chainId,
    registryVmstateCheckpointParent: input.vmstate?.checkpointParent,
    registryVmstateCheckpointSequence: input.vmstate?.checkpointSequence,
  };
}

function registryMountDiskData(input: BootRegistryShapeNativeInput): Partial<NativeBootPlanInput> {
  return {
    registryMountGuest: input.mountDisk?.guest,
    registryMountLowerPath: input.mountDisk?.lowerPath,
    registryMountUpperPath: input.mountDisk?.upperPath,
  };
}

export function planBootRegistryCpuNative(input: {
  policy: ResolvedCpuResourcePolicy | undefined;
  control: CpuControlResult;
}): RegistryShapePlan["cpu"] | undefined {
  return planBootRegistryShapeNative({ cpu: input }).cpu ?? undefined;
}

export function planBootRegistryVmstateNative(input: {
  statePath?: string;
  chainId?: string;
  checkpointParent?: string;
  checkpointSequence?: number;
}): RegistryShapePlan["vmstate"] {
  return planBootRegistryShapeNative({ vmstate: input }).vmstate;
}

export function planBootRegistryNestedNative(nested: boolean | undefined): boolean | undefined {
  return planBootRegistryShapeNative({ nested }).nested || undefined;
}

export function planBootRegistryPortForwardNative(
  portForward: PortForwardPlanMapping[],
): RegistryShapePlan["portForward"] | undefined {
  return planBootRegistryShapeNative({ portForward }).portForward ?? undefined;
}

export function planBootPortForwardNative(
  portForward: PortForwardPlanMapping[] | undefined,
): PlannedPortForward[] {
  return planBootCoreNative({
    portForward,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  }).plannedPortForward;
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

export function planBootNestedEnvNative(nested: boolean | undefined): string | undefined {
  return (
    planBootCoreNative({
      nested,
      vmmMemoryPreset: true,
      hasImage: false,
      hasCmd: false,
      rootDisk: "false",
    }).vmmNested ?? undefined
  );
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
