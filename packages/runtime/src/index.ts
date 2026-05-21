// @machinen/runtime — public API façade.
//
// The runtime core (`boot`, `attach`, `restore`, `measureFirstByte`,
// the host-side VMM orchestration) lives in `./vm.ts`. This file is
// only re-exports — adding a new public symbol means adding it to
// `vm.ts` (or a sibling module) and lifting it here. See issue #190.

export { Sandboxes, Supervisor } from "./multiplex.ts";
export type { SandboxEntry, OnOutputListener, SupervisorOptions } from "./multiplex.ts";
export { bootPty } from "./pty.ts";
export type { PtyBootOptions, PtyVmHandle } from "./pty.ts";
export { VsockWinsize } from "./winsize.ts";
export type { VsockWinsizeOptions } from "./winsize.ts";
export { VsockSecrets } from "./secrets.ts";
export type { VsockSecretsOptions } from "./secrets.ts";
export { VsockFiles } from "./files.ts";
export type { VsockFilesOptions } from "./files.ts";
export { VsockExec } from "./exec.ts";
export type {
  VsockExecOptions,
  VsockExecPtyHandle,
  VsockExecPtyOptions,
  VsockExecPtyResult,
  VsockExecResult,
} from "./exec.ts";
export type { ChunkLogEvent, LogEvent, OnLog, PhaseLogEvent } from "./log.ts";
export { provision, resolveBaseDtb, resolveBaseKernel, resolveBaseRootfs } from "./provision.ts";
export type { ProvisionOptions, ProvisionResult } from "./provision.ts";
export {
  ensureRootfsImage,
  markRootfsImageClean,
  resolveMke2fs,
  rootfsImgCacheDir,
} from "./rootfs-img.ts";
export type { EnsureRootfsImageOptions } from "./rootfs-img.ts";
export {
  ensureMountDiskImage,
  ensureMountDiskUpper,
  markMountDiskImageClean,
  mountdiskImgCacheDir,
  resolveMksquashfs,
} from "./mountdisk-img.ts";
export type {
  EnsureMountDiskImageOptions,
  EnsureMountDiskImageResult,
  EnsureMountDiskUpperOptions,
  EnsureMountDiskUpperResult,
} from "./mountdisk-img.ts";
export { bootSnapshotPath, detachedLogRoot, writeBootSnapshot } from "./detached-log.ts";
export { validatePid } from "./pid-validate.ts";
export type { PidStatus } from "./pid-validate.ts";
export { runGc } from "./gc.ts";
export type { GcResult, RunGcOptions } from "./gc.ts";
export { list, registryRoot } from "./registry.ts";
export type { RegistryEntry } from "./registry.ts";
export {
  packBundle as mkinitramfsBundle,
  packTinyBundle as mkinitramfsTinyBundle,
  packRootfs as mkinitramfsRootfs,
  packWorkspace as mkinitramfsWorkspace,
  packMinimal as mkinitramfsMinimal,
  cli as mkinitramfsCli,
} from "./mkinitramfs.ts";
export type {
  PackBundleOptions,
  PackTinyBundleOptions,
  PackRootfsOptions,
  PackMinimalOptions,
  PackWorkspaceOptions,
} from "./mkinitramfs.ts";
export {
  MachinenError,
  BootError,
  ExecError,
  SnapshotError,
  ProvisionError,
  RegistryError,
  FilesError,
  MountError,
  SecretsError,
  WinsizeError,
  SandboxError,
  CacheError,
  GvproxyError,
  MkinitramfsError,
  ParseError,
  ErrorCode,
  isMachinenError,
  formatMachinenError,
} from "./errors.ts";
export type { MachinenErrorOptions } from "./errors.ts";
export type {
  ForkOptions,
  MemoryStats,
  SnapshotFileIdentity,
  SnapshotMeta,
  SnapshotOptions,
  SnapshotResult,
  VmHandle,
  VmstateBackend,
  VmstateSnapshotMeta,
  WriteFileOptions,
} from "./vm-handle.ts";
export type { SnapshotEngine } from "./vm/snapshot-engine.ts";
export { buildNativeCodeMap } from "./native-code-map.ts";
export type {
  NativeCodeMapRequest,
  NativeCodeMapResult,
  NativeCodeModule,
  NativeCodeSymbol,
} from "./native-code-map.ts";
export {
  inventoryNativeSourceCodeModules,
  resolveNativeRealUtilityCodeLocations,
} from "./native-real-utility-code-map.ts";
export type {
  NativeRealUtilityCodeLocationRequest,
  NativeRealUtilityCodeLocationResult,
  NativeRealUtilityExecutableRange,
  NativeRealUtilityModuleExpectation,
  NativeRealUtilityResolvedLocation,
  NativeRealUtilitySourceModule,
  NativeRealUtilityTargetModule,
} from "./native-real-utility-code-map.ts";
export { classifyNativeDebugMemoryPointers } from "./native-debug-memory.ts";
export type {
  NativeDebugAddressTranslation,
  NativeDebugMemoryField,
  NativeDebugMemoryFieldClassification,
  NativeDebugMemoryMetadataSource,
  NativeDebugMemoryObject,
  NativeDebugMemoryPointerClassificationRequest,
  NativeDebugMemoryPointerClassificationResult,
} from "./native-debug-memory.ts";
export { translateNativeMemory } from "./native-memory-translation.ts";
export type {
  NativeMemoryTranslationRequest,
  NativeMemoryTranslationResult,
  NativeMemoryWord,
} from "./native-memory-translation.ts";
export { planNativeMappingMaterialization } from "./native-mapping-materialization.ts";
export type {
  NativeMappingMaterializationAction,
  NativeMappingMaterializationRequest,
  NativeMappingMaterializationResult,
  NativeMappingMaterializationStep,
} from "./native-mapping-materialization.ts";
export { translateNativeRegisterState } from "./native-register-translation.ts";
export { translateNativeResources } from "./native-resource-translation.ts";
export type {
  NativeResourceTranslationRequest,
  NativeResourceTranslationResult,
} from "./native-resource-translation.ts";
export { translateNativeStack } from "./native-stack-translation.ts";
export type {
  NativeStackFrame,
  NativeStackSlot,
  NativeStackTranslationRequest,
  NativeStackTranslationResult,
} from "./native-stack-translation.ts";
export {
  discoverNativeUnwindFrames,
  nativeUnwindReturnAddressSlot,
} from "./native-unwind-frames.ts";
export type {
  NativeDiscoveredUnwindFrame,
  NativeUnwindFrameDiscoveryRequest,
  NativeUnwindFrameDiscoveryResult,
  NativeUnwindFrameRule,
  NativeUnwindMetadataKind,
  NativeUnwindRegister,
  NativeUnwindStackWord,
} from "./native-unwind-frames.ts";
export type {
  NativeContinuationTarget,
  NativeRegisterTranslationRequest,
  NativeRegisterTranslationResult,
} from "./native-register-translation.ts";
export {
  NATIVE_PROCESS_IMAGE_FILES,
  NATIVE_PROCESS_IMAGE_FORMAT_VERSION,
  NativeProcessImageValidationError,
  assertNativeProcessImageDocuments,
  isNativeProcessImageBundle,
  nativeProcessImageArchitectures,
  nativeProcessImageRefusalCodes,
  nativeProcessImageSchemas,
  validateNativeProcessImageBundle,
  validateNativeProcessImageDocuments,
} from "./native-process-image.ts";
export type {
  NativeAmd64Registers,
  NativeArm64Registers,
  NativeCodeLocationMapping,
  NativeMemoryMapping,
  NativeMemoryMappingKind,
  NativeMemoryRelocation,
  NativeProcessImageArchitecture,
  NativeProcessImageDocumentInput,
  NativeProcessImageDocuments,
  NativeProcessImageJsonSchema,
  NativeProcessImageManifest,
  NativeProcessImageMappings,
  NativeProcessImageRefusal,
  NativeProcessImageRefusalCode,
  NativeProcessImageRefusals,
  NativeProcessImageResources,
  NativeProcessImageThreads,
  NativeProcessImageTranslation,
  NativeProcessResource,
  NativeProcessResourceKind,
  NativeRegisterState,
  NativeThreadState,
  NativeThreadTranslation,
} from "./native-process-image.ts";
export {
  _internal,
  attach,
  autoSizeMemoryMib,
  boot,
  buildMachinenConfig,
  buildWriteFileCmd,
  buildWriteFileCmds,
  measureFirstByte,
  resolveVmmBinary,
  restore,
} from "./vm/index.ts";
export { warmImageConfigCache } from "./vm/index.ts";
export type { AttachOptions, BootOptions, ImageConfig, RestoreOptions } from "./vm/index.ts";
export {
  checkForkBackpressure,
  DEFAULT_FREE_MEMORY_THRESHOLD,
  readHostFreeBytes,
  readHostTotalBytes,
} from "./host-mem.ts";
export type { CheckForkBackpressureOptions } from "./host-mem.ts";
export { readHostRssBytes, readHostRssBytesMulti } from "./proc-rss.ts";
export type { RssTarget } from "./proc-rss.ts";
export { readBalloonStats, STATS_FILE_SIZE } from "./balloon-stats.ts";
export type { BalloonCounters } from "./balloon-stats.ts";
