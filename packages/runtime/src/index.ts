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
export {
  LEVEL5_RUNTIME_ADAPTER_SUBSTRATE_FORMAT_VERSION,
  buildLevel5ProofOnlyStatus,
  buildLevel5RefusalEnvelope,
  buildLevel5RuntimeAdapterRegistrySummary,
  createLevel5RuntimeAdapterRegistry,
  level5SubstrateRefusalCodes,
} from "./level5-runtime-adapter.ts";
export type { PidStatus } from "./pid-validate.ts";
export type {
  Level5AdapterDetectInput,
  Level5AdapterDetection,
  Level5AdapterOperation,
  Level5ArchitectureMetadata,
  Level5ArtifactEnvelope,
  Level5EvidenceStatus,
  Level5GraduationTargetLevel,
  Level5ImplementationLevel,
  Level5ProductSupport,
  Level5QuiesceResult,
  Level5RefusalEnvelope,
  Level5RestorePlan,
  Level5RuntimeAdapter,
  Level5RuntimeAdapterMatch,
  Level5RuntimeAdapterRegistry,
  Level5RuntimeAdapterRegistrySummary,
  Level5RuntimeFamily,
  Level5StatusFields,
  Level5SubstrateRefusalCode,
  Level5ValidationResult,
  Level5VerifierEvidence,
} from "./level5-runtime-adapter.ts";
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
  NODE_LEVEL5_TARGET_SIDE_PROOF_FORMAT_VERSION,
  runNodeLevel5TargetSideProof,
} from "./node-level5-target-side-proof.ts";
export {
  NODE_LEVEL5_HTTP_PROFILE_FORMAT_VERSION,
  NODE_LEVEL5_HTTP_PROFILE_NAME,
  buildNodeLevel5HttpProfileCapture,
  isSupportedNodeLevel5HttpSelectedState,
  nodeLevel5HttpProfileRefusalCodes,
  nodeLevel5HttpProfileRefusalRows,
} from "./node-level5-http-profile.ts";
export {
  NODE_PROPER_LEVEL5_SOURCE_INSPECTION_KIND,
  parseNodeProperLevel5ProcMaps,
  summarizeNodeProperLevel5SourceInspection,
} from "./node-proper-level5-source-inspection.ts";
export {
  NODE_PROPER_LEVEL5_V8_CLOSURE_RECOVERY_KIND,
  recoverNodeProperLevel5RawV8ContextSmiCounter,
  recoverNodeProperLevel5V8ClosureCounterCell,
} from "./node-proper-level5-v8-closure-recovery.ts";
export {
  NODE_PROPER_LEVEL5_LIBUV_TIMER_RECOVERY_KIND,
  recoverNodeProperLevel5LibuvTimerEvidence,
} from "./node-proper-level5-libuv-timer-recovery.ts";
export {
  NODE_PROPER_LEVEL5_V8_OBJECT_RECOVERY_KIND,
  recoverNodeProperLevel5V8ObjectStateEvidence,
} from "./node-proper-level5-v8-object-recovery.ts";
export {
  NODE_PROPER_LEVEL5_HTTP_STATE_POLICY_KIND,
  classifyNodeProperLevel5HttpStatePolicy,
} from "./node-proper-level5-http-state-policy.ts";
export {
  NODE_LEVEL5_PROOF_COMPOSITION_FORMAT_VERSION,
  buildNodeLevel5ProofComposition,
  nodeLevel5ProofIngredientNames,
  nodeLevel5ProofRefusalCodes,
} from "./node-level5-proof-composition.ts";
export {
  NODE_LEVEL5_DECLARED_SUBSET_FORMAT_VERSION,
  NODE_LEVEL5_DECLARED_SUBSET_MANIFEST,
  NODE_LEVEL5_DECLARED_SUBSET_RESTORE_SUMMARY,
  createNodeLevel5DeclaredSubsetCapture,
  isNodeLevel5DeclaredSubsetManifest,
  nodeLevel5DeclaredSubsetRefusalCodes,
  nodeLevel5DeclaredSubsetSupportMatrix,
  restoreNodeLevel5DeclaredSubset,
} from "./node-level5-declared-subset.ts";
export {
  NODE_LEVEL5_READINESS_MATRIX_KIND,
  NODE_LEVEL5_READINESS_MATRIX_VERSION,
  assertNodeLevel5ReadinessMatrixComplete,
  nodeLevel5AppCorpusGates,
  nodeLevel5FinalAuditGates,
  nodeLevel5NarrowProductReadinessGates,
  nodeLevel5ReadinessMatrix,
  nodeLevel5UnsupportedNeighborGates,
} from "./node-level5-readiness-matrix.ts";
export {
  NODE_LEVEL5_PRODUCT_SUPPORT_20_KIND,
  NODE_LEVEL5_PRODUCT_SUPPORT_20_VERSION,
  assertNodeLevel5ProductSupport20MatrixComplete,
  nodeLevel5ProductSupport20Families,
  nodeLevel5ProductSupport20Matrix,
  nodeLevel5ProductUnsupportedNeighbors,
} from "./node-level5-product-support-20.ts";
export {
  NODE_LEVEL5_PRODUCT_SUPPORT_50_KIND,
  NODE_LEVEL5_PRODUCT_SUPPORT_50_VERSION,
  assertNodeLevel5ProductSupport50MatrixComplete,
  nodeLevel5ProductSupport50ExpandedUnsupportedNeighbors,
  nodeLevel5ProductSupport50Families,
  nodeLevel5ProductSupport50Matrix,
  nodeLevel5ProductSupport50NewFamilies,
} from "./node-level5-product-support-50.ts";
export {
  NODE_LEVEL5_PRODUCT_SUPPORT_65_KIND,
  NODE_LEVEL5_PRODUCT_SUPPORT_65_VERSION,
  assertNodeLevel5ProductSupport65MatrixComplete,
  nodeLevel5ProductSupport65ExpandedUnsupportedNeighbors,
  nodeLevel5ProductSupport65Families,
  nodeLevel5ProductSupport65Matrix,
  nodeLevel5ProductSupport65NewFamilies,
} from "./node-level5-product-support-65.ts";
export {
  NODE_LEVEL5_PRODUCT_SUPPORT_80_KIND,
  NODE_LEVEL5_PRODUCT_SUPPORT_80_VERSION,
  assertNodeLevel5ProductSupport80MatrixComplete,
  nodeLevel5ProductSupport80ExpandedUnsupportedNeighbors,
  nodeLevel5ProductSupport80Families,
  nodeLevel5ProductSupport80Matrix,
  nodeLevel5ProductSupport80NewFamilies,
} from "./node-level5-product-support-80.ts";
export {
  NODE_LEVEL5_PRODUCT_SUPPORT_85_KIND,
  NODE_LEVEL5_PRODUCT_SUPPORT_85_VERSION,
  nodeLevel5ProductSupport85ClaimRegistry,
  type NodeLevel5ProductSupport85ClaimRegistry,
} from "./node-level5-product-support-85.ts";

export {
  NODE_LEVEL5_PRODUCT_SUPPORT_85_CLAIM_READY_KIND,
  NODE_LEVEL5_PRODUCT_SUPPORT_85_CLAIM_READY_VERSION,
  evaluateNodeLevel5ProductSupport85ClaimReady,
  type NodeLevel5ProductSupport85ClaimReadyGate,
  type NodeLevel5ProductSupport85ClaimReadyGateId,
  type NodeLevel5ProductSupport85ClaimReadyGateStatus,
  type NodeLevel5ProductSupport85ClaimReadyReport,
} from "./node-level5-product-support-85-claim-ready.ts";

export {
  NODE_LEVEL5_PRODUCT_SUPPORT_85_READINESS_KIND,
  NODE_LEVEL5_PRODUCT_SUPPORT_85_READINESS_VERSION,
  evaluateNodeLevel5ProductSupport85Readiness,
  loadNodeLevel5ProductSupport85ReadinessReport,
  type NodeLevel5ProductSupport85ReadinessGate,
  type NodeLevel5ProductSupport85ReadinessGateId,
  type NodeLevel5ProductSupport85ReadinessGateStatus,
  type NodeLevel5ProductSupport85ReadinessReport,
} from "./node-level5-product-support-85-readiness.ts";

export {
  NODE_LEVEL5_PRODUCT_SUPPORT_80_ARTIFACT_BUNDLE_KIND,
  NODE_LEVEL5_PRODUCT_SUPPORT_80_HARDENING_KIND,
  assertNodeLevel5ProductSupport80HardeningComplete,
  createNodeLevel5ProductSupport80ArtifactBundle,
  loadNodeLevel5ProductSupport80ArtifactBundle,
  nodeLevel5ProductSupport80ClaimRegistry,
  nodeLevel5ProductSupport80UnsupportedDetectors,
  verifyNodeLevel5ProductSupport80ArtifactBundle,
} from "./node-level5-product-support-80-hardening.ts";
export {
  NODE_LEVEL5_APP_SUPPORT_MATRIX_KIND,
  NODE_LEVEL5_APP_SUPPORT_MATRIX_VERSION,
  buildNodeLevel5AppSupportMatrix,
  notProvenNodeLevel5AppSupportRows,
  refusedNodeLevel5AppSupportRows,
  supportedNodeLevel5AppSupportRows,
} from "./node-level5-app-support-matrix.ts";
export {
  NODE_LEVEL5_INSTALLED_THIRD_PARTY_APP_CORPUS_REPORT_KIND,
  NODE_LEVEL5_INSTALLED_THIRD_PARTY_APP_CORPUS_REPORT_VERSION,
  createNodeLevel5InstalledThirdPartyAppCorpusReport,
  loadNodeLevel5InstalledThirdPartyAppCorpusReport,
  verifyNodeLevel5InstalledThirdPartyAppCorpusReport,
  writeNodeLevel5InstalledThirdPartyAppCorpusReport,
} from "./node-level5-installed-third-party-app-corpus.ts";
export {
  NODE_LEVEL5_THIRD_PARTY_APP_CORPUS_REPORT_KIND,
  NODE_LEVEL5_THIRD_PARTY_APP_CORPUS_REPORT_VERSION,
  createNodeLevel5ThirdPartyAppCorpusReport,
  loadNodeLevel5ThirdPartyAppCorpusReport,
  verifyNodeLevel5ThirdPartyAppCorpusReport,
  writeNodeLevel5ThirdPartyAppCorpusReport,
} from "./node-level5-third-party-app-corpus.ts";
export {
  NODE_LEVEL5_REAL_APP_REFUSAL_CORPUS_REPORT_KIND,
  NODE_LEVEL5_REAL_APP_REFUSAL_CORPUS_REPORT_VERSION,
  createNodeLevel5RealAppRefusalCorpusReport,
  loadNodeLevel5RealAppRefusalCorpusReport,
  verifyNodeLevel5RealAppRefusalCorpusReport,
  writeNodeLevel5RealAppRefusalCorpusReport,
} from "./node-level5-real-app-refusal-corpus.ts";
export {
  NODE_LEVEL5_REAL_APP_CORPUS_REPORT_KIND,
  NODE_LEVEL5_REAL_APP_CORPUS_REPORT_VERSION,
  createNodeLevel5RealAppCorpusReport,
  loadNodeLevel5RealAppCorpusReport,
  verifyNodeLevel5RealAppCorpusReport,
  writeNodeLevel5RealAppCorpusReport,
} from "./node-level5-real-app-corpus.ts";
export {
  DEFAULT_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION,
  NODE_LEVEL5_PRODUCT_BEHAVIORAL_VERIFIER_REPORT_KIND,
  NODE_LEVEL5_PRODUCT_CAPTURE_REPORT_KIND,
  NODE_LEVEL5_PRODUCT_DETECTOR_REPORT_KIND,
  NODE_LEVEL5_PRODUCT_RESTORE_LAUNCH_REPORT_KIND,
  NODE_LEVEL5_PRODUCT_RESTORE_MATERIALIZATION_REPORT_KIND,
  NODE_LEVEL5_PRODUCT_SNAPSHOT_KIND,
  NODE_LEVEL5_PRODUCT_TARGET_IDENTITY_KIND,
  NODE_LEVEL5_PRODUCT_SNAPSHOT_VERSION,
  createNodeLevel5ProductSnapshot,
  detectNodeLevel5ProductSnapshotApp,
  isNodeLevel5ProductSnapshotBundle,
  restoreNodeLevel5ProductSnapshot,
} from "./node-level5-product-snapshot.ts";
export { buildNativeCodeMap } from "./native-code-map.ts";
export {
  classifyNativeActiveSyscalls,
  classifyNativeThreadSyscall,
  modelNativeFdReadState,
  modelNativeFdWriteState,
  modelNativePingSocketRecvmsgState,
  modelNativePpollTimeoutState,
  modelNativeSleepTimerState,
} from "./native-active-syscall-policy.ts";
export type {
  NodeLevel5TargetSideProof,
  NodeLevel5TargetSideProofInput,
} from "./node-level5-target-side-proof.ts";
export type {
  NodeLevel5HttpProfileCapture,
  NodeLevel5HttpProfileCaptureInput,
  NodeLevel5HttpProfileRefusal,
  NodeLevel5HttpProfileRefusalCode,
  NodeLevel5HttpProfileSelectedState,
} from "./node-level5-http-profile.ts";
export type {
  NodeProperLevel5MapKind,
  NodeProperLevel5ProcMapEntry,
  NodeProperLevel5SourceInspectionInput,
  NodeProperLevel5SourceInspectionSummary,
} from "./node-proper-level5-source-inspection.ts";
export type {
  NodeProperLevel5RawMemoryFragment,
  NodeProperLevel5RawV8ContextSmiRecoveryResult,
  NodeProperLevel5V8ClosureCounterCellCandidate,
  NodeProperLevel5V8ClosureRecoveryRefusal,
  NodeProperLevel5V8ClosureRecoveryRefusalCode,
  NodeProperLevel5V8ClosureRecoveryResult,
} from "./node-proper-level5-v8-closure-recovery.ts";
export type {
  NodeProperLevel5LibuvTimerCandidate,
  NodeProperLevel5LibuvTimerMemoryFragment,
  NodeProperLevel5LibuvTimerRecoveryRefusal,
  NodeProperLevel5LibuvTimerRecoveryRefusalCode,
  NodeProperLevel5LibuvTimerRecoveryResult,
} from "./node-proper-level5-libuv-timer-recovery.ts";
export type {
  NodeProperLevel5V8ObjectCandidate,
  NodeProperLevel5V8ObjectMemoryFragment,
  NodeProperLevel5V8ObjectRecoveryOptions,
  NodeProperLevel5V8ObjectRecoveryRefusal,
  NodeProperLevel5V8ObjectRecoveryRefusalCode,
  NodeProperLevel5V8ObjectRecoveryResult,
} from "./node-proper-level5-v8-object-recovery.ts";
export type {
  NodeProperLevel5HttpStatePolicyInput,
  NodeProperLevel5HttpStatePolicyRefusal,
  NodeProperLevel5HttpStatePolicyRefusalCode,
  NodeProperLevel5HttpStatePolicyResult,
} from "./node-proper-level5-http-state-policy.ts";
export type {
  NodeLevel5ProofComposition,
  NodeLevel5ProofCompositionInput,
  NodeLevel5ProofCompositionRefusal,
  NodeLevel5ProofEvidenceCheck,
  NodeLevel5ProofIngredient,
  NodeLevel5ProofRefusalMatrixRow,
  NodeLevel5TargetProofEvidence,
  NodeLevel5ProofIngredientName,
  NodeLevel5ProofRefusalCode,
} from "./node-level5-proof-composition.ts";
export type {
  CreateNodeLevel5DeclaredSubsetCaptureInput,
  NodeLevel5DeclaredSubsetArchitecture,
  NodeLevel5DeclaredSubsetCaptureSummary,
  NodeLevel5DeclaredSubsetManifest,
  NodeLevel5DeclaredSubsetRefusal,
  NodeLevel5DeclaredSubsetRefusalCode,
  NodeLevel5DeclaredSubsetRestoreSummary,
  NodeLevel5DeclaredSubsetSupportMatrix,
  RestoreNodeLevel5DeclaredSubsetInput,
} from "./node-level5-declared-subset.ts";
export type {
  NodeLevel5AppCorpusGate,
  NodeLevel5ReadinessGate,
  NodeLevel5ReadinessGateStatus,
  NodeLevel5ReadinessMatrix,
  NodeLevel5UnsupportedNeighborGate,
} from "./node-level5-readiness-matrix.ts";
export type {
  NodeLevel5ProductSupport20Matrix,
  NodeLevel5ProductSupportDirection,
  NodeLevel5ProductSupportFamily,
  NodeLevel5ProductSupportFamilyId,
  NodeLevel5ProductUnsupportedNeighbor,
} from "./node-level5-product-support-20.ts";
export type {
  NodeLevel5ProductSupport50Family,
  NodeLevel5ProductSupport50FamilyId,
  NodeLevel5ProductSupport50Matrix,
} from "./node-level5-product-support-50.ts";
export type {
  NodeLevel5ProductSupport65Family,
  NodeLevel5ProductSupport65FamilyId,
  NodeLevel5ProductSupport65Matrix,
} from "./node-level5-product-support-65.ts";
export type {
  NodeLevel5ProductSupport80Family,
  NodeLevel5ProductSupport80FamilyId,
  NodeLevel5ProductSupport80Matrix,
  NodeLevel5RealVmCrossArchEvidence,
} from "./node-level5-product-support-80.ts";
export type {
  NodeLevel5ProductSupport80ArtifactBundle,
  NodeLevel5ProductSupport80ArtifactVerification,
  NodeLevel5ProductSupport80ClaimRegistry,
  NodeLevel5ProductSupport80UnsupportedDetector,
} from "./node-level5-product-support-80-hardening.ts";
export type {
  NodeLevel5AppSupportBoundary,
  NodeLevel5AppSupportDirection,
  NodeLevel5AppSupportEvidence,
  NodeLevel5AppSupportEvidenceKind,
  NodeLevel5AppSupportFeatureAssessment,
  NodeLevel5AppSupportFeatureName,
  NodeLevel5AppSupportFeatureStatus,
  NodeLevel5AppSupportFeatures,
  NodeLevel5AppSupportFramework,
  NodeLevel5AppSupportMiddlewareFeature,
  NodeLevel5AppSupportMatrix,
  NodeLevel5AppSupportMatrixRow,
  NodeLevel5AppSupportProductBehavior,
  NodeLevel5AppSupportResponseFeature,
  NodeLevel5AppSupportRouteFeature,
  NodeLevel5AppSupportStatus,
} from "./node-level5-app-support-matrix.ts";
export type { NodeLevel5CorpusHttpEvidence } from "./node-level5-corpus-common.ts";
export type {
  NodeLevel5InstalledThirdPartyAppCorpusReport,
  NodeLevel5InstalledThirdPartyAppCorpusRow,
  NodeLevel5InstalledThirdPartyAppCorpusVerification,
  NodeLevel5InstalledThirdPartyAppSource,
} from "./node-level5-installed-third-party-app-corpus.ts";
export type {
  NodeLevel5ThirdPartyAppCorpusReport,
  NodeLevel5ThirdPartyAppCorpusRow,
  NodeLevel5ThirdPartyAppCorpusVerification,
  NodeLevel5ThirdPartyAppSource,
} from "./node-level5-third-party-app-corpus.ts";
export type {
  NodeLevel5RealAppRefusalCorpusReport,
  NodeLevel5RealAppRefusalCorpusRow,
  NodeLevel5RealAppRefusalCorpusVerification,
  NodeLevel5RealAppRefusalMarker,
} from "./node-level5-real-app-refusal-corpus.ts";
export type {
  NodeLevel5RealAppCorpusFramework,
  NodeLevel5RealAppCorpusReport,
  NodeLevel5RealAppCorpusRow,
  NodeLevel5RealAppCorpusVerification,
} from "./node-level5-real-app-corpus.ts";
export type {
  NodeLevel5ProductBehavioralVerifierReport,
  NodeLevel5ProductCaptureReport,
  NodeLevel5ProductDetectedFeature,
  NodeLevel5ProductDetectorReport,
  NodeLevel5ProductRestoreLaunchReport,
  NodeLevel5ProductRestoreMaterializationReport,
  NodeLevel5ProductRestoreSummary,
  NodeLevel5ProductSnapshotDirection,
  NodeLevel5ProductSnapshotManifest,
  NodeLevel5ProductSnapshotRefusal,
  NodeLevel5ProductSnapshotRefusalCode,
  NodeLevel5ProductSnapshotSummary,
  NodeLevel5ProductTargetIdentity,
} from "./node-level5-product-snapshot.ts";
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
  NativeActiveFdReadContinuation,
  NativeActiveFdWriteContinuation,
  NativeActivePpollTimeoutContinuation,
  NativeActiveSyscallPolicyOptions,
  NativeActiveSleepTimerContinuation,
  NativeFdReadPolicy,
  NativeFdReadResourcePolicy,
  NativeFdWritePolicy,
  NativeFdWriteResourcePolicy,
  NativeModeledFdReadState,
  NativeModeledFdReadTargetResource,
  NativeModeledFdReadTimerRemainingTime,
  NativeModeledFdWriteState,
  NativeModeledFdWriteTargetResource,
  NativeModeledPingSocketRecvmsgState,
  NativeModeledPpollTimeoutRemainingTime,
  NativeModeledPpollTimeoutState,
  NativeModeledSleepTimerRemainingTime,
  NativeModeledSleepTimerState,
  NativePingSocketRecvmsgModelResult,
  NativePingSocketRecvmsgPolicy,
  NativePollTimeoutFdPolicy,
  NativePollTimeoutSyscallPolicy,
  NativeFdReadModelResult,
  NativeFdWriteModelResult,
  NativePpollTimeoutModelResult,
  NativeModeledPpollFdState,
  NativeModeledPpollTargetResource,
  NativeSleepTimerDuration,
  NativeSleepTimerModelResult,
  NativeSleepTimerSyscallPolicy,
  NativeActivePingSocketRecvmsgContinuation,
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
export {
  NATIVE_MACHINE_RESTORE_DESCRIPTOR_FORMAT_VERSION,
  NATIVE_MACHINE_RESTORE_DESCRIPTOR_KIND,
  NativeMachineRestoreDescriptorValidationError,
  buildNativeMachineRestoreDescriptor,
  parseNativeMachineRestoreDescriptor,
  serializeNativeMachineRestoreDescriptor,
  validateNativeMachineRestoreDescriptor,
} from "./native-machine-restore-descriptor.ts";
export { planNativeMachineRestore } from "./native-machine-restore-plan.ts";
export { planNativeMappingMaterialization } from "./native-mapping-materialization.ts";
export type { NativeMachineRestoreDescriptor } from "./native-machine-restore-descriptor.ts";
export type {
  NativeMachineRestorePlan,
  NativeMachineRestorePlanRequest,
} from "./native-machine-restore-plan.ts";
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
export { materializeNativeReturnChainFrames } from "./native-return-chain-materializer.ts";
export { planNativeReturnChain } from "./native-return-chain.ts";
export { materializeNativeStackWindowWrites } from "./native-stack-window-materializer.ts";
export {
  planNativeStackWindowMaterialization,
  translateNativeStack,
} from "./native-stack-translation.ts";
export type {
  NativeReturnChainFrameWrite,
  NativeReturnChainMaterialization,
} from "./native-return-chain-materializer.ts";
export type {
  NativeReturnChainFrame,
  NativeReturnChainPlan,
  NativeReturnChainPlanFrame,
  NativeReturnChainPlanRequest,
} from "./native-return-chain.ts";
export type {
  NativeStackWindowGuardMapping,
  NativeStackWindowMaterializedWrites,
  NativeStackWindowWrite,
} from "./native-stack-window-materializer.ts";
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
  ARCHITECTURE_PORTABLE_SNAPSHOT_GAUNTLET_KIND,
  ARCHITECTURE_PORTABLE_SNAPSHOT_GAUNTLET_ROW_KIND,
  buildArchitecturePortableSnapshotGauntletRow,
  architecturePortableSnapshotGauntletEvidenceStatuses,
  architecturePortableSnapshotEvidenceCategories,
  architecturePortableSnapshotProductSupportStates,
  architecturePortableSnapshotTargetExecutions,
  requiredArchitecturePortableSnapshotClaimIds,
  stableGauntletDigest,
  summarizeArchitecturePortableSnapshotGauntletRows,
  validateArchitecturePortableSnapshotGauntletInvariants,
  validateArchitecturePortableSnapshotGauntletRows,
  validateArchitecturePortableSnapshotGauntletSchema,
} from "./architecture-portable-snapshot-gauntlet.ts";
export {
  NESTED_VIRTUALIZATION_STRETCH_PROOF_KIND,
  buildNestedVirtualizationStretchProofRow,
  nestedVirtualizationStretchProofClassifications,
  nestedVirtualizationStretchProofRefusalCodes,
  summarizeNestedVirtualizationStretchProofRows,
  validateNestedVirtualizationStretchProofRows,
} from "./nested-virtualization-stretch-proof.ts";
export { probeNestedVirtualization } from "./nested-virt.ts";
export {
  ADVANCED_LINUX_FACILITY_PROBE_KIND,
  advancedLinuxFacilityProbeClassifications,
  advancedLinuxFacilityProbeFacilities,
  advancedLinuxFacilityProbeRefusalCodes,
  buildAdvancedLinuxFacilityProbeRow,
  summarizeAdvancedLinuxFacilityProbeRows,
  validateAdvancedLinuxFacilityProbeRows,
} from "./advanced-linux-facility-probe.ts";
export {
  RUNTIME_CONFIDENCE_PROFILE_KIND,
  buildRuntimeConfidenceProfileMatrix,
  buildRuntimeConfidenceProfileRow,
  runtimeConfidenceClassifications,
  runtimeConfidenceProfileFixtures,
  runtimeConfidenceRefusalCodes,
  summarizeRuntimeConfidenceProfiles,
  validateRuntimeConfidenceProfiles,
} from "./runtime-confidence-profile.ts";
export {
  PORTABLE_SNAPSHOT_GUEST_CHECKPOINT_COMPOSITION_KIND,
  buildPortableSnapshotGuestCheckpointCompositionRow,
  portableSnapshotGuestCheckpointCompositionRefusalCodes,
  summarizePortableSnapshotGuestCheckpointCompositionRows,
  validatePortableSnapshotGuestCheckpointCompositionRows,
} from "./portable-snapshot-guest-checkpoint-composition.ts";
export {
  GUEST_CHECKPOINT_SUBSTRATE_KIND,
  buildGuestCheckpointSubstrateRow,
  guestCheckpointSubstrateRefusalCodes,
  summarizeGuestCheckpointSubstrateRows,
  validateGuestCheckpointSubstrateRows,
} from "./guest-checkpoint-substrate.ts";
export {
  STATEFUL_DATABASE_RESTORE_KIND,
  buildStatefulDatabaseRestoreSummary,
  postgresLogicalRestoreInput,
  sqliteRollbackJournalRestoreInput,
  sqliteWalCheckpointRestoreInput,
  statefulDatabaseRestoreRefusalCodes,
} from "./stateful-database-restore.ts";
export {
  OPPOSITE_ISA_VM_EXECUTION_KIND,
  buildOppositeIsaVmExecutionSummary,
  classifyOppositeIsaProviderRoute,
  hostArchitectureFromNode,
  normalizeGuestMachine,
  oppositeGuestArchitecture,
  oppositeIsaVmExecutionRefusalCodes,
} from "./opposite-isa-vm-execution.ts";
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
  MOVE_DESCRIPTOR_FORMAT_VERSION,
  MOVE_REFUSAL_CODE,
  buildMoveIssueReport,
  createMoveDescriptor,
  loadMoveDescriptor,
  saveMoveDescriptor,
  scanMovePidGraph,
} from "./move-pid-graph.ts";
export {
  PRODUCT_CLAIM_PROOF_ONLY_REFUSAL_CODE,
  PRODUCT_CLAIM_REGISTRY_FORMAT_VERSION,
  buildProductClaimRegistry,
  filterProductClaimRegistry,
  productClaimEntryFromProofProfile,
  productClaimFamilies,
  productClaimRefusalSummary,
  productClaimStatuses,
  productSupportLevels,
  summarizeProductClaimRegistry,
} from "./product-claim-registry.ts";
export {
  TARGET_GUEST_RESTORE_DESCRIPTOR_KIND,
  TargetGuestRestoreLoaderValidationError,
  buildNativeActualResumeTrampolineArgs,
  buildTargetGuestRestoreLoaderArgv,
  parseTargetGuestRestoreDescriptor,
  serializeTargetGuestRestoreDescriptor,
  validateTargetGuestRestoreDescriptor,
} from "./target-guest-restore-loader.ts";
export { planTargetGuestActiveSyscallRestore } from "./target-guest-active-syscall-restore.ts";
export { planTargetGuestExecutableMaterialization } from "./target-guest-executable-materialization.ts";
export { planTargetGuestMemoryMaterialization } from "./target-guest-memory-materialization.ts";
export { planTargetGuestPrivateMemoryRestore } from "./target-guest-private-memory-restore.ts";
export { planTargetGuestProcessContextRestore } from "./target-guest-process-context-restore.ts";
export { planTargetGuestSignalRestore } from "./target-guest-signal-restore.ts";
export { planTargetGuestTwoThreadRestore } from "./target-guest-two-thread-restore.ts";
export {
  parseTargetNativeConsumptionEvents,
  targetNativeConsumptionFields,
  targetNativeConsumptionPassed,
} from "./target-native-consumption-results.ts";
export {
  completePortableMachineVmRestoreProof,
  planPortableMachineTargetRestoreDescriptor,
  planPortableMachineVmRestoreProof,
} from "./portable-machine-restore-proof.ts";
export type {
  ArchitecturePortableSnapshotGauntletEvidenceStatus,
  ArchitecturePortableSnapshotGauntletRow,
  ArchitecturePortableSnapshotGauntletRowInput,
  ArchitecturePortableSnapshotGauntletSummary,
  ArchitecturePortableSnapshotEvidenceCategory,
  ArchitecturePortableSnapshotProductSupport,
  ArchitecturePortableSnapshotTargetExecution,
} from "./architecture-portable-snapshot-gauntlet.ts";
export type { NestedVirtProbeHost, NestedVirtProbeResult } from "./nested-virt.ts";
export type {
  NestedVirtualizationStretchProofClassification,
  NestedVirtualizationStretchProofInput,
  NestedVirtualizationStretchProofRefusalCode,
  NestedVirtualizationStretchProofRow,
  NestedVirtualizationStretchProofSummary,
} from "./nested-virtualization-stretch-proof.ts";
export type {
  AdvancedLinuxFacilityProbeClassification,
  AdvancedLinuxFacilityProbeFacility,
  AdvancedLinuxFacilityProbeInput,
  AdvancedLinuxFacilityProbeRefusalCode,
  AdvancedLinuxFacilityProbeRow,
  AdvancedLinuxFacilityProbeStateModel,
  AdvancedLinuxFacilityProbeSummary,
} from "./advanced-linux-facility-probe.ts";
export type {
  RuntimeConfidenceArch,
  RuntimeConfidenceClassification,
  RuntimeConfidenceProfileInput,
  RuntimeConfidenceProfileRow,
  RuntimeConfidenceProfileSummary,
  RuntimeConfidenceRefusalCode,
  RuntimeConfidenceRuntime,
  RuntimeConfidenceStateModel,
} from "./runtime-confidence-profile.ts";
export type {
  PortableSnapshotGuestCheckpointCompositionInput,
  PortableSnapshotGuestCheckpointCompositionRefusalCode,
  PortableSnapshotGuestCheckpointCompositionRow,
  PortableSnapshotGuestCheckpointCompositionState,
  PortableSnapshotGuestCheckpointCompositionSummary,
  PortableSnapshotGuestCheckpointMachinenStateModel,
} from "./portable-snapshot-guest-checkpoint-composition.ts";
export type {
  GuestCheckpointSubstrateInput,
  GuestCheckpointSubstrateProfile,
  GuestCheckpointSubstrateRefusalCode,
  GuestCheckpointSubstrateRow,
  GuestCheckpointSubstrateState,
  GuestCheckpointSubstrateSummary,
} from "./guest-checkpoint-substrate.ts";
export type {
  StatefulDatabaseRestoreArch,
  StatefulDatabaseRestoreDatabase,
  StatefulDatabaseRestoreInput,
  StatefulDatabaseRestoreRefusalCode,
  StatefulDatabaseRestoreState,
  StatefulDatabaseRestoreStateModel,
  StatefulDatabaseRestoreSummary,
} from "./stateful-database-restore.ts";
export type {
  OppositeIsaVmExecutionArch,
  OppositeIsaVmExecutionEvidence,
  OppositeIsaVmExecutionProviderRoute,
  OppositeIsaVmExecutionRefusalCode,
  OppositeIsaVmExecutionState,
  OppositeIsaVmExecutionSummary,
} from "./opposite-isa-vm-execution.ts";
export type {
  PortableMachineSnapshotArchitecture,
  PortableMachineSnapshotDocuments,
  PortableMachineSnapshotManifest,
  PortableMachineSnapshotRefusal,
  PortableMachineSnapshotRefusalCode,
  PortableMachineSnapshotRefusals,
} from "./portable-machine-snapshot.ts";
export type {
  MoveDescriptor,
  MoveIssueReport,
  MovePidGraph,
  MovePidGraphEdge,
  MovePidGraphNode,
  MoveProcessStateClass,
  MoveRefusalEvidence,
  MoveSaveResult,
} from "./move-pid-graph.ts";
export type {
  ProductClaimEntry,
  ProductClaimFamily,
  ProductClaimObservableStateDecision,
  ProductClaimProofProfileInput,
  ProductClaimRegistry,
  ProductClaimRegistryFilter,
  ProductClaimRegistrySummary,
  ProductClaimStatus,
  ProductSupportLevel,
} from "./product-claim-registry.ts";
export type {
  TargetGuestEpollWatchRecipe,
  TargetGuestNativeRestoreStep,
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
  TargetGuestActiveSyscallRestorePlan,
  TargetGuestActiveSyscallRestoreStep,
} from "./target-guest-active-syscall-restore.ts";
export type {
  TargetGuestExecutableMappingStep,
  TargetGuestExecutableMaterializationPlan,
} from "./target-guest-executable-materialization.ts";
export type {
  TargetGuestCopyCapturedBytesEntry,
  TargetGuestMemoryMaterializationEntry,
  TargetGuestMemoryMaterializationKind,
  TargetGuestMemoryMaterializationRequest,
  TargetGuestMemoryMaterializationResult,
  TargetGuestRecreateGuardEntry,
} from "./target-guest-memory-materialization.ts";
export type {
  TargetGuestPrivateMemoryRestorePlan,
  TargetGuestPrivateMemoryRestoreStep,
} from "./target-guest-private-memory-restore.ts";
export type {
  TargetGuestProcessContextRestoreMode,
  TargetGuestProcessContextRestoreOptions,
  TargetGuestProcessContextRestorePlan,
  TargetGuestProcessContextRestoreStep,
} from "./target-guest-process-context-restore.ts";
export type {
  TargetGuestSignalRestorePlan,
  TargetGuestSignalRestoreStep,
} from "./target-guest-signal-restore.ts";
export type {
  TargetGuestTwoThreadBinding,
  TargetGuestTwoThreadRestorePlan,
  TargetGuestTwoThreadSpawnStep,
} from "./target-guest-two-thread-restore.ts";
export type {
  TargetNativeConsumptionEvent,
  TargetNativeConsumptionEvents,
  TargetNativeConsumptionStatus,
} from "./target-native-consumption-results.ts";
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
  PortableMachineTargetNativePlanConsumptionResult,
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
export type {
  AttachOptions,
  BootCpuResourceOptions,
  BootMemoryResourceOptions,
  BootOptions,
  BootResourcesOptions,
  ImageConfig,
  LiveMountCacheMode,
  ResolvedCpuResourcePolicy,
  RestoreOptions,
} from "./vm/index.ts";
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
  NODE_LEVEL5_GENERIC_VM_REFUSAL_ARTIFACTS_REPORT_KIND,
  NODE_LEVEL5_GENERIC_VM_REFUSAL_ARTIFACTS_REPORT_VERSION,
  createNodeLevel5GenericVmRefusalArtifactsReport,
  loadNodeLevel5GenericVmRefusalArtifactsReport,
  verifyNodeLevel5GenericVmRefusalArtifactsReport,
  writeNodeLevel5GenericVmRefusalArtifactsReport,
  type NodeLevel5GenericVmRefusalArtifactFile,
  type NodeLevel5GenericVmRefusalArtifactsReport,
  type NodeLevel5GenericVmRefusalArtifactsVerification,
} from "./node-level5-generic-vm-refusal-artifacts.ts";

export {
  NODE_LEVEL5_GENERIC_VM_ROW_ARTIFACTS_REPORT_KIND,
  NODE_LEVEL5_GENERIC_VM_ROW_ARTIFACTS_REPORT_VERSION,
  createNodeLevel5GenericVmRowArtifactsReport,
  loadNodeLevel5GenericVmRowArtifactsReport,
  verifyNodeLevel5GenericVmRowArtifactsReport,
  writeNodeLevel5GenericVmRowArtifactsReport,
  type NodeLevel5GenericVmRowArtifactFile,
  type NodeLevel5GenericVmRowArtifactsReport,
  type NodeLevel5GenericVmRowArtifactsVerification,
} from "./node-level5-generic-vm-row-artifacts.ts";

export {
  NODE_LEVEL5_GENERIC_VM_RETAINED_EVIDENCE_REPORT_KIND,
  NODE_LEVEL5_GENERIC_VM_RETAINED_EVIDENCE_REPORT_VERSION,
  createNodeLevel5GenericVmRetainedEvidenceReport,
  loadNodeLevel5GenericVmRetainedEvidenceReport,
  verifyNodeLevel5GenericVmRetainedEvidenceReport,
  writeNodeLevel5GenericVmRetainedEvidenceReport,
  type NodeLevel5GenericVmRetainedEvidenceFile,
  type NodeLevel5GenericVmRetainedEvidenceReport,
  type NodeLevel5GenericVmRetainedEvidenceVerification,
} from "./node-level5-generic-vm-retained-evidence.ts";

export {
  NODE_LEVEL5_GENERIC_VM_CORPUS_REPORT_KIND,
  NODE_LEVEL5_GENERIC_VM_CORPUS_REPORT_VERSION,
  createNodeLevel5GenericVmCorpusReport,
  loadNodeLevel5GenericVmCorpusReport,
  verifyNodeLevel5GenericVmCorpusReport,
  writeNodeLevel5GenericVmCorpusReport,
} from "./node-level5-generic-vm-corpus.ts";
export type {
  NodeLevel5GenericVmCorpusReport,
  NodeLevel5GenericVmCorpusRow,
  NodeLevel5GenericVmCorpusVerification,
  NodeLevel5GenericVmModuleSystem,
  NodeLevel5GenericVmPositiveRow,
  NodeLevel5GenericVmRefusalMarker,
  NodeLevel5GenericVmRefusalRow,
} from "./node-level5-generic-vm-corpus.ts";
