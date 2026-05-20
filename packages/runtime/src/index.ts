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
export {
  RUNTIME_ADAPTER_BUNDLE_FILE,
  RuntimeAdapterValidationError,
  assertRuntimeAdapterDocument,
  runtimeAdapterRefusalCodes,
  runtimeAdapterSchemas,
  validateRuntimeAdapterDocument,
} from "./runtime-adapter.ts";
export {
  NODE_RUNTIME_NATIVE_RESOURCE_KINDS,
  NodeRuntimeAdapterUnsupportedError,
  captureNodeNativeResources,
  captureNodeRuntimeAdapterDocument,
  collectNodeRuntimeAdapterRefusals,
  restoreNodeCapturedResourceRecipes,
  restoreNodeRuntimeAdapterRoots,
} from "./node-runtime-adapter.ts";
export {
  captureNodeAsyncContinuations,
  restoreNodeAsyncContinuations,
} from "./node-async-continuation.ts";
export type {
  NodeAsyncContinuationHandlers,
  NodeAsyncContinuationInput,
  NodeAsyncContinuationKind,
  NodeAsyncContinuationRecord,
  NodeAsyncContinuationState,
  RestoredNodeAsyncContinuation,
} from "./node-async-continuation.ts";
export type {
  CaptureNodeNativeResourcesOptions,
  CaptureNodeRuntimeAdapterOptions,
  NodeRuntimeAdapterResourceKind,
  NodeRuntimeFileResource,
  NodeRuntimeNativeHandleRefusal,
  RestoredNodeResourceRecipes,
} from "./node-runtime-adapter.ts";
export { inspectBunPackagedExecutable, probeBunRuntimeAdapter } from "./bun-runtime-adapter.ts";
export type {
  BunPackagedExecutableIdentity,
  BunRuntimeAdapterProbe,
  ProbeBunRuntimeAdapterOptions,
} from "./bun-runtime-adapter.ts";
export { captureJsBuildIdentity, verifyJsBuildIdentity } from "./js-build-identity.ts";
export type {
  CaptureJsBuildIdentityOptions,
  JsBuildIdentityFile,
  JsBuildIdentitySidecar,
  JsBuildIdentityVerification,
} from "./js-build-identity.ts";
export type {
  RuntimeAdapterArch,
  RuntimeAdapterBuild,
  RuntimeAdapterBuildIdentity,
  RuntimeAdapterBuildModule,
  RuntimeAdapterBundleMapping,
  RuntimeAdapterBundleObjectMapping,
  RuntimeAdapterBundleResourceMapping,
  RuntimeAdapterDescriptor,
  RuntimeAdapterDocument,
  RuntimeAdapterEntrypoint,
  RuntimeAdapterEntrypoints,
  RuntimeAdapterGraph,
  RuntimeAdapterIdentityAssertion,
  RuntimeAdapterJsonSchema,
  RuntimeAdapterMapEntry,
  RuntimeAdapterMappingRole,
  RuntimeAdapterModuleKind,
  RuntimeAdapterObjectKind,
  RuntimeAdapterObjectNode,
  RuntimeAdapterProcess,
  RuntimeAdapterRefusal,
  RuntimeAdapterRefusalCode,
  RuntimeAdapterResource,
  RuntimeAdapterResourceKind,
  RuntimeAdapterResourceRecipe,
  RuntimeAdapterResourceState,
  RuntimeAdapterResources,
  RuntimeAdapterRestoreContract,
  RuntimeAdapterRoot,
  RuntimeAdapterRuntime,
  RuntimeAdapterRuntimeName,
  RuntimeAdapterSerializerCompatibility,
  RuntimeAdapterTarget,
  RuntimeAdapterTransport,
  RuntimeAdapterUnsupportedVocabulary,
  RuntimeAdapterValue,
  RuntimeAdapterValueKind,
} from "./runtime-adapter.ts";
