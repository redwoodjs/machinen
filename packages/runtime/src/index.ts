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
export {
  classifyNativeActiveSyscalls,
  classifyNativeThreadSyscall,
  modelNativePpollTimeoutState,
  modelNativeSleepTimerState,
} from "./native-active-syscall-policy.ts";
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
export { planNativeRealUtilityContinuationAttempt } from "./native-real-utility-continuation.ts";
export { planNativeActualRealUtilityContinuationAttempt } from "./native-actual-real-utility-continuation.ts";
export { inventoryNativeActualTargetModules } from "./native-actual-target-module-inventory.ts";
export {
  matchNativeTargetUnwindFrame,
  parseNativeTargetEhFrameText,
} from "./native-target-unwind.ts";
export { planNativeTargetFrameStateMaterialization } from "./native-target-frame-state.ts";
export { planNativeSyntheticTargetCallerFrame } from "./native-target-caller-frame.ts";
export { planNativeThreadRestoreBoundary } from "./native-thread-restore-policy.ts";
export { planNativeControlledTwoThreadRestoreBoundary } from "./native-two-thread-boundary.ts";
export { planNativeSignalRestorePolicy, safeSignalRestoreRefusal } from "./native-signal-policy.ts";
export {
  NATIVE_SIMD_FPU_LIVE_SUBSET_POLICY,
  planNativeSimdFpuLiveSubsetPolicy,
  planNativeSimdFpuRestorePolicy,
  safeSimdFpuRefusal,
} from "./native-simd-fpu-policy.ts";
export {
  planNativeTlsSegmentBaseHandoff,
  safeTlsSegmentBaseRefusal,
} from "./native-tls-segment-policy.ts";
export {
  inspectNativeTargetResumeLanding,
  nativeTargetResumeLandingRefusals,
} from "./native-target-landing-provenance.ts";
export {
  classifyNativeTargetResumeExecutionAttempt,
  planNativeTargetResumeExecution,
} from "./native-target-resume-execution.ts";
export { materializeNativeTargetModuleBytes } from "./native-target-module-bytes.ts";
export {
  buildNativeSyntheticSyscallContinuationDescriptor,
  NATIVE_SYNTHETIC_SYSCALL_EINTR_EXIT_STATUS,
  NATIVE_SYNTHETIC_SYSCALL_RESTART_EXIT_STATUS,
  NATIVE_SYNTHETIC_SYSCALL_UNMODELED_RETURN_EXIT_STATUS,
  nativeSyntheticContinuationBytesHex,
  nativeSyntheticContinuationBytesSha256,
  nativeSyntheticContinuationDescriptorSha256,
  nativeSyntheticEintrErrno,
  nativeSyntheticExitProcessSuffix,
  nativeSyntheticRestartLikeErrnos,
  nativeSyntheticSyscallFailureExitBuckets,
  nativeSyntheticSyscallRestartContract,
} from "./native-synthetic-continuation.ts";
export {
  NATIVE_SYNTHETIC_PPOLL_SYSCALL_BASE,
  NATIVE_SYNTHETIC_PPOLL_SYSCALL_BUILD_ID,
  NATIVE_SYNTHETIC_PPOLL_SYSCALL_LOGICAL_NAME,
  NATIVE_SYNTHETIC_PPOLL_SYSCALL_PATH,
  buildNativeSyntheticPpollSyscallContinuation,
} from "./native-synthetic-ppoll-continuation.ts";
export {
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_BASE,
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_BUILD_ID,
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_LOGICAL_NAME,
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_PATH,
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_EINTR_EXIT_STATUS,
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_FAILURE_EXIT_STATUS,
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_RESTART_EXIT_STATUS,
  NATIVE_SYNTHETIC_SLEEP_SYSCALL_UNMODELED_RETURN_EXIT_STATUS,
  buildNativeSyntheticSleepSyscallContinuation,
} from "./native-synthetic-sleep-continuation.ts";
export type {
  NativeRealUtilityCodeLocationRequest,
  NativeRealUtilityCodeLocationResult,
  NativeRealUtilityContinuationStrategy,
  NativeRealUtilityDeferredActiveSyscallLanding,
  NativeRealUtilityExecutableRange,
  NativeRealUtilityModuleExpectation,
  NativeRealUtilityResolvedLocation,
  NativeRealUtilitySemanticContinuationSelection,
  NativeRealUtilitySourceModule,
  NativeRealUtilitySyntheticContinuationSelection,
  NativeRealUtilityTargetContinuationKind,
  NativeRealUtilityTargetModule,
  NativeRealUtilityTargetSemanticContinuation,
} from "./native-real-utility-code-map.ts";
export type {
  NativeRealUtilityContinuationBoundary,
  NativeRealUtilityContinuationPlan,
  NativeRealUtilityContinuationRequest,
} from "./native-real-utility-continuation.ts";
export type {
  NativeActualRealUtilityContinuationBoundary,
  NativeActualRealUtilityContinuationPlan,
  NativeActualRealUtilityContinuationRequest,
} from "./native-actual-real-utility-continuation.ts";
export type {
  NativeActualTargetModuleInventoryRequest,
  NativeActualTargetModuleInventoryResult,
} from "./native-actual-target-module-inventory.ts";
export type {
  NativeActiveSyscallClass,
  NativeActiveSyscallClassification,
  NativeActiveSyscallClassificationResult,
  NativeActiveSyscallContinuation,
  NativeActivePpollTimeoutContinuation,
  NativeActiveSyscallPolicyOptions,
  NativeActiveSleepTimerContinuation,
  NativeModeledPpollTimeoutRemainingTime,
  NativeModeledPpollTimeoutState,
  NativeModeledSleepTimerRemainingTime,
  NativeModeledSleepTimerState,
  NativePollTimeoutFdPolicy,
  NativePollTimeoutSyscallPolicy,
  NativePpollTimeoutModelResult,
  NativeModeledPpollFdState,
  NativeModeledPpollTargetResource,
  NativeSleepTimerDuration,
  NativeSleepTimerModelResult,
  NativeSleepTimerSyscallPolicy,
} from "./native-active-syscall-policy.ts";
export type {
  NativeTargetModuleByteMaterialization,
  NativeTargetModuleByteMaterializationRequest,
  NativeTargetModuleByteMaterializationResult,
} from "./native-target-module-bytes.ts";
export type {
  NativeSyntheticContinuationByteEncoding,
  NativeSyntheticContinuationByteSource,
  NativeSyntheticContinuationCompletionDescriptor,
  NativeSyntheticContinuationFailureExitBucket,
  NativeSyntheticContinuationFailureExitBucketCondition,
  NativeSyntheticContinuationFailureKind,
  NativeSyntheticContinuationProvenanceSource,
  NativeSyntheticContinuationRegister,
  NativeSyntheticContinuationRegisterSetupAbi,
  NativeSyntheticContinuationRegisterSetupDescriptor,
  NativeSyntheticContinuationRestartContract,
  NativeSyntheticContinuationStackSetupDescriptor,
  NativeSyntheticContinuationSyscallAbi,
  NativeSyntheticContinuationTargetArch,
  NativeSyntheticSyscallArgumentDescriptor,
  NativeSyntheticSyscallContinuationDescriptor,
  NativeSyntheticSyscallContinuationDescriptorPayload,
  NativeSyntheticSyscallContinuationDescriptorRequest,
  NativeSyntheticSyscallDescriptor,
} from "./native-synthetic-continuation.ts";
export type {
  NativeSyntheticPpollCompletionMode,
  NativeSyntheticPpollSyscallArgumentProvenance,
  NativeSyntheticPpollSyscallCompletionProvenance,
  NativeSyntheticPpollSyscallContinuation,
  NativeSyntheticPpollSyscallContinuationProvenance,
  NativeSyntheticPpollSyscallContinuationRequest,
  NativeSyntheticPpollSyscallContinuationResult,
  NativeSyntheticPpollSyscallProvenanceSource,
  NativeSyntheticPpollSyscallRegisterSetupProvenance,
  NativeSyntheticPpollSyscallStackSetupProvenance,
} from "./native-synthetic-ppoll-continuation.ts";
export type {
  NativeSyntheticSleepCompletionMode,
  NativeSyntheticSleepSyscallArgumentProvenance,
  NativeSyntheticSleepSyscallCompletionProvenance,
  NativeSyntheticSleepSyscallContinuation,
  NativeSyntheticSleepSyscallContinuationProvenance,
  NativeSyntheticSleepSyscallContinuationRequest,
  NativeSyntheticSleepSyscallContinuationResult,
  NativeSyntheticSleepSyscallProvenanceSource,
  NativeSyntheticSleepSyscallRegisterSetupProvenance,
  NativeSyntheticSleepSyscallStackSetupProvenance,
} from "./native-synthetic-sleep-continuation.ts";
export type {
  NativeTargetLandingDisassemblyProvenance,
  NativeTargetLandingFdeProvenance,
  NativeTargetLandingInstructionBoundary,
  NativeTargetLandingInstructionBoundaryState,
  NativeTargetLandingModuleProvenance,
  NativeTargetLandingSectionProvenance,
  NativeTargetLandingSymbolProvenance,
  NativeTargetResumeLandingInspectionRequest,
  NativeTargetResumeLandingProvenance,
} from "./native-target-landing-provenance.ts";
export type {
  NativeTargetResumeExecutionAttempt,
  NativeTargetResumeExecutionAttemptStatus,
  NativeTargetResumeFaultBoundary,
  NativeTargetResumeFaultClassification,
  NativeTargetResumeFaultClassificationOptions,
  NativeTargetResumeFaultClassificationResult,
  NativeTargetResumeFaultRegisters,
  NativeTargetResumeExecutionMode,
  NativeTargetResumeExecutionPlan,
  NativeTargetResumeExecutionPlanRequest,
  NativeTargetResumeExecutionPlanResult,
  NativeTargetResumeExecutor,
} from "./native-target-resume-execution.ts";
export type {
  NativeSyntheticTargetCallerFrame,
  NativeSyntheticTargetCallerFramePlanRequest,
  NativeSyntheticTargetCallerFramePlanResult,
  NativeSyntheticTargetCallerFramePolicy,
  NativeSyntheticTargetCallerFrameSlot,
} from "./native-target-caller-frame.ts";
export type {
  NativeSyntheticTargetCallerFrameStatePolicy,
  NativeTargetFrameRegisterValue,
  NativeTargetFrameStateMaterialization,
  NativeTargetFrameStateMaterializationRequest,
  NativeTargetFrameStateMaterializationResult,
  NativeTargetFrameStateRegister,
  NativeTargetFrameStateRequirement,
  NativeTargetFrameStateValueSource,
} from "./native-target-frame-state.ts";
export type {
  NativeTargetCalleeSavedPolicy,
  NativeTargetCalleeSavedSlot,
  NativeTargetEhFrameTextParseRequest,
  NativeTargetEhFrameTextParseResult,
  NativeTargetUnwindFrameMatch,
  NativeTargetUnwindFrameRule,
  NativeTargetUnwindMatchRequest,
  NativeTargetUnwindMatchResult,
  NativeTargetUnwindRegister,
} from "./native-target-unwind.ts";
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
  NativePrivateWritableGuardRequest,
  NativeMappingMaterializationResult,
  NativeMappingMaterializationStep,
} from "./native-mapping-materialization.ts";
export { translateNativeRegisterState } from "./native-register-translation.ts";
export {
  planNativeTargetFdTable,
  translateNativeResources,
} from "./native-resource-translation.ts";
export type {
  NativeInheritedStdioPolicy,
  NativeResourceTranslationRequest,
  NativeResourceTranslationResult,
  NativeTargetFdTableEntry,
  NativeTargetFdTableEntryKind,
  NativeTargetFdTablePlan,
  NativeTargetFdTablePlanRequest,
} from "./native-resource-translation.ts";
export { planNativeReturnChain } from "./native-return-chain.ts";
export {
  planNativeStackWindowMaterialization,
  translateNativeStack,
} from "./native-stack-translation.ts";
export type {
  NativeReturnChainFrame,
  NativeReturnChainPlan,
  NativeReturnChainPlanFrame,
  NativeReturnChainPlanRequest,
} from "./native-return-chain.ts";
export type {
  NativeStackFrame,
  NativeStackPointerRange,
  NativeStackSlot,
  NativeStackTranslationRequest,
  NativeStackTranslationResult,
  NativeStackWindowMaterializationPlan,
  NativeStackWindowMaterializationRequest,
} from "./native-stack-translation.ts";
export {
  discoverNativeUnwindFrames,
  nativeUnwindReturnAddressSlot,
  parseNativeEhFrameText,
} from "./native-unwind-frames.ts";
export type {
  NativeDiscoveredUnwindFrame,
  NativeEhFrameTextParseRequest,
  NativeEhFrameTextParseResult,
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
export {
  PORTABLE_MACHINE_SNAPSHOT_FILES,
  PORTABLE_MACHINE_SNAPSHOT_FORMAT_VERSION,
  PortableMachineSnapshotValidationError,
  buildPortableMachineSnapshotManifestFromNativeProcessImage,
  crossIsaVmstateRestoreRefusal,
  isPortableMachineSnapshotBundle,
  portableMachineSnapshotArchitectures,
  portableMachineSnapshotManifestSchema,
  portableMachineSnapshotRefusalCodes,
  validatePortableMachineSnapshotBundle,
  validatePortableMachineSnapshotManifest,
} from "./portable-machine-snapshot.ts";
export {
  TARGET_GUEST_RESTORE_DESCRIPTOR_KIND,
  TargetGuestRestoreLoaderValidationError,
  buildNativeActualResumeTrampolineArgs,
  buildTargetGuestRestoreLoaderArgv,
  parseTargetGuestRestoreDescriptor,
  serializeTargetGuestRestoreDescriptor,
  validateTargetGuestRestoreDescriptor,
} from "./target-guest-restore-loader.ts";
export { planTargetGuestMemoryMaterialization } from "./target-guest-memory-materialization.ts";
export {
  completePortableMachineVmRestoreProof,
  planPortableMachineTargetRestoreDescriptor,
  planPortableMachineVmRestoreProof,
} from "./portable-machine-restore-proof.ts";
export type {
  PortableMachineSnapshotArchitecture,
  PortableMachineSnapshotDocuments,
  PortableMachineSnapshotManifest,
  PortableMachineSnapshotRefusal,
  PortableMachineSnapshotRefusalCode,
  PortableMachineSnapshotRefusals,
} from "./portable-machine-snapshot.ts";
export type {
  TargetGuestRestoreContinuationDescriptor,
  TargetGuestRestoreDescriptor,
  TargetGuestRestoreLoaderRefusalCode,
  TargetGuestRestoreResourceRecipe,
  TargetGuestRestoreResumeMode,
  TargetGuestResumeRegisterName,
  TargetGuestResumeRegisters,
  TargetGuestTranslatedFrameDescriptor,
  TargetGuestTranslatedFrameRegister,
  TargetGuestTranslatedFrameRegisterName,
  TargetGuestTranslatedFrameSlot,
} from "./target-guest-restore-loader.ts";
export type {
  TargetGuestCopyCapturedBytesEntry,
  TargetGuestMemoryMaterializationEntry,
  TargetGuestMemoryMaterializationKind,
  TargetGuestMemoryMaterializationRequest,
  TargetGuestMemoryMaterializationResult,
  TargetGuestRecreateGuardEntry,
} from "./target-guest-memory-materialization.ts";
export type {
  PortableMachineTargetContinuationKind,
  PortableMachineTargetFrameRestoreResult,
  PortableMachineTargetRegisterRestoreResult,
  PortableMachineTargetRflagsRestoreResult,
  PortableMachineTargetTlsRestoreResult,
  PortableMachineTargetResourceStatus,
  PortableMachineTargetResumePathResult,
  PortableMachineTargetReturnChainResult,
  PortableMachineTargetRestoreDescriptorPlan,
  PortableMachineTargetRestoreObservation,
  PortableMachineTargetThreadRestoreResult,
  PortableMachineTargetRestoreDescriptorRequest,
  PortableMachineTargetStateConsumptionResult,
  PortableMachineTargetVerifierResult,
  PortableMachineVmRestoreProofPlan,
  PortableMachineVmRestoreProofRequest,
  PortableMachineVmRestoreProofState,
  PortableMachineVmRestoreTargetResult,
} from "./portable-machine-restore-proof.ts";
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
  NativeSimdFpuLiveSubset,
  NativeSimdFpuState,
  NativeThreadState,
  NativeTlsAmd64SegmentBases,
  NativeTlsThreadPointerRegister,
  NativeThreadTranslation,
} from "./native-process-image.ts";
export type {
  NativeThreadRestorePlan,
  NativeThreadRestorePlanRequest,
} from "./native-thread-restore-policy.ts";
export type {
  NativeControlledTwoThreadRestorePlan,
  NativeControlledTwoThreadRestorePlanRequest,
} from "./native-two-thread-boundary.ts";
export type {
  NativeSignalBlockedMaskPolicy,
  NativeSignalRestorePolicyRequest,
  NativeSignalRestorePolicyResult,
} from "./native-signal-policy.ts";
export type {
  NativeSimdFpuLiveSubsetPolicy,
  NativeSimdFpuRestorePolicyResult,
} from "./native-simd-fpu-policy.ts";
export type {
  NativeThreadTlsPolicyRequest,
  NativeTlsSegmentBaseHandoffRequest,
  NativeTlsSegmentBaseHandoffResult,
  NativeTlsTargetAccessPolicy,
} from "./native-tls-segment-policy.ts";
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
