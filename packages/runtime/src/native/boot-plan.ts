import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import type { BootMemoryResourceOptions } from "../vm/memory-resources.ts";

type RootDiskPlanMode = "unset" | "false" | "path" | "true";
type ScratchDiskMode = "false" | "path" | "auto";
type ScratchDiskAction = "none" | "existing" | "clone" | "allocate";

type PortForwardPlanMapping = { hostPort: number; guestPort: number; hostAddr?: string };
type LiveMountPlanInput = { host: string; guest: string; mode?: string };
type PlannedLiveMount = { host: string; guest: string; mode: "ro" | "rw"; tag: string };

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
  scratchMode?: ScratchDiskMode;
  scratchSnapshotPath?: string;
  scratchRestoreClonePath?: string;
  scratchAutoPath?: string;
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
  scratchDisk: ScratchDiskPlan;
}

type ScratchDiskPlan = {
  action: ScratchDiskAction;
  diskPath: string | null;
  perBootSnapDisk: string | null;
  vmmDisk: string | null;
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
    ...scratchDiskData(input),
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
    isScratchDiskPlan(data.scratchDisk),
  ].every(Boolean);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isPlannedLiveMountArray(value: unknown): value is PlannedLiveMount[] {
  return Array.isArray(value) && value.every(isPlannedLiveMount);
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
