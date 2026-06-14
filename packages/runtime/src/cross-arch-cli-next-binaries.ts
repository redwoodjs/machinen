import type { NativeProcessImageArchitecture } from "./native-process-image.ts";

export type CrossArchNextBinaryContinuationState = "eligible" | "refused";
export type CrossArchCatFdKind =
  | "regular-file"
  | "terminal"
  | "pty"
  | "pipe"
  | "socket"
  | "device"
  | "unknown";
export type CrossArchCatSafePointKind = "between-reads" | "split-read" | "unknown";

export interface CrossArchCatContinuationRequest {
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
  process: {
    pid: number;
    executable: string;
    argv: string[];
    cwd: string;
    executableSha256?: string;
  };
  input: {
    kind: CrossArchCatFdKind;
    path?: string;
    device?: string;
    inode?: string;
    identityDigest?: string;
    size: number;
    mtimeMs: number;
    contentHashWindow: string;
    readOffset: number;
    partialReadBufferHex?: string;
    partialReadBufferComplete: boolean;
    dirtyWritableAliasPresent: boolean;
  };
  output: {
    stdoutKind: CrossArchCatFdKind;
    stdoutCursor: number;
    stderrCursor: number;
    terminalSessionAbsent: boolean;
  };
  safePoint: {
    kind: CrossArchCatSafePointKind;
    evidence: string;
  };
  targetPreflight: {
    equivalentInputIdentityVerified: boolean;
    contentHashWindowMatches: boolean;
    regularFileOpenable: boolean;
    stdoutCursorInstallable: boolean;
    crossIsaReaderVesselAvailable: boolean;
    noTargetProcessBeforeEligibilityEvidence: string;
  };
  shortcuts?: CrossArchCatShortcutAttempts;
}

export interface CrossArchCatShortcutAttempts {
  sameArchProductAttempted?: boolean;
  argvRestartAttempted?: boolean;
  execveFromArgvAttempted?: boolean;
  reexecAttempted?: boolean;
  outputReplayAttempted?: boolean;
  descriptorOnlySuccessAttempted?: boolean;
  sourceIsaEmulationAttempted?: boolean;
  sourceFdTeleportationAttempted?: boolean;
  metadataOnlySuccessAttempted?: boolean;
}

export interface CrossArchCatSemanticCapture {
  primitive: "cross-arch-cat-reader-semantic-continuation-v1";
  architecture: {
    sourceArch: NativeProcessImageArchitecture;
    targetArch: NativeProcessImageArchitecture;
    crossIsa: true;
  };
  process: CrossArchCatContinuationRequest["process"];
  input: CrossArchCatContinuationRequest["input"];
  output: CrossArchCatContinuationRequest["output"];
  safePoint: CrossArchCatContinuationRequest["safePoint"];
  targetPreflight: CrossArchCatContinuationRequest["targetPreflight"];
}

export interface CrossArchCatContinuationClassification {
  primitive: "cross-arch-cat-reader-semantic-continuation-v1";
  state: CrossArchNextBinaryContinuationState;
  capture?: CrossArchCatSemanticCapture;
  refusals: string[];
  productContinuationEligible: boolean;
  targetProcessPlanned: false;
  nonClaims: readonly string[];
}

export interface CrossArchCatTargetContinuationRequest {
  classification: CrossArchCatContinuationClassification;
  target: {
    crossIsaVerified: boolean;
    readerVesselCreated: boolean;
    fileIdentityVerified: boolean;
    contentWindowVerified: boolean;
    seekInstalled: boolean;
    partialBufferInstalled: boolean;
    stdoutCursorInstalled: boolean;
    noReplayGuardInstalled: boolean;
    targetPid?: number;
    marker?: CrossArchCatContinuationMarker;
  };
  shortcuts?: CrossArchCatShortcutAttempts;
}

export interface CrossArchCatContinuationMarker {
  sourceReadOffset: number;
  targetFirstByteOffset: number;
  targetFirstByteHex: string;
  replayedByteOffsets: number[];
  freshRestartWouldStartAtOffset: number;
  finalReadOffset: number;
}

export interface CrossArchCatTargetContinuationPlan {
  primitive: "cross-arch-cat-reader-semantic-continuation-v1";
  state: "ready" | "refused";
  targetPid?: number;
  resumedFromCapturedSemanticState: boolean;
  targetProcessStarted: boolean;
  targetProcessKilledOnRefusal: boolean;
  refusals: string[];
  argvRestartUsed: false;
  execveFromArgvUsed: false;
  reexecUsed: false;
  outputReplayUsed: false;
  descriptorOnlySuccessUsed: false;
  sourceIsaEmulationUsed: false;
  sourceFdTeleportationUsed: false;
  metadataOnlySuccessUsed: false;
  marker?: CrossArchCatContinuationMarker;
  nonClaims: readonly string[];
}

export const crossArchCliNextBinariesNonClaims = [
  "no arbitrary process restore",
  "no any-binary movement",
  "no argv restart",
  "no target execve from argv",
  "no output replay",
  "no descriptor-only success",
  "no source-ISA emulation",
  "no source-fd teleportation",
  "no metadata-only success",
  "no terminal, pipe, socket, service, database, or shell support without explicit models",
] as const;

export function classifyCrossArchCatContinuationCapture(
  request: CrossArchCatContinuationRequest,
): CrossArchCatContinuationClassification {
  const refusals = crossArchCatCaptureRefusals(request);
  if (refusals.length > 0) {
    return {
      primitive: "cross-arch-cat-reader-semantic-continuation-v1",
      state: "refused",
      refusals,
      productContinuationEligible: false,
      targetProcessPlanned: false,
      nonClaims: crossArchCliNextBinariesNonClaims,
    };
  }

  return {
    primitive: "cross-arch-cat-reader-semantic-continuation-v1",
    state: "eligible",
    capture: {
      primitive: "cross-arch-cat-reader-semantic-continuation-v1",
      architecture: {
        sourceArch: request.sourceArch,
        targetArch: request.targetArch,
        crossIsa: true,
      },
      process: request.process,
      input: request.input,
      output: request.output,
      safePoint: request.safePoint,
      targetPreflight: request.targetPreflight,
    },
    refusals: [],
    productContinuationEligible: true,
    targetProcessPlanned: false,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

export function planCrossArchCatContinuationTarget(
  request: CrossArchCatTargetContinuationRequest,
): CrossArchCatTargetContinuationPlan {
  const refusals = crossArchCatTargetRefusals(request);
  const targetPid = request.target.targetPid;
  if (refusals.length > 0 || !request.classification.capture) {
    return crossArchCatRefusedPlan(refusals, targetPid);
  }

  return {
    primitive: "cross-arch-cat-reader-semantic-continuation-v1",
    state: "ready",
    targetPid,
    resumedFromCapturedSemanticState: true,
    targetProcessStarted: true,
    targetProcessKilledOnRefusal: false,
    refusals: [],
    argvRestartUsed: false,
    execveFromArgvUsed: false,
    reexecUsed: false,
    outputReplayUsed: false,
    descriptorOnlySuccessUsed: false,
    sourceIsaEmulationUsed: false,
    sourceFdTeleportationUsed: false,
    metadataOnlySuccessUsed: false,
    marker: request.target.marker,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

function crossArchCatCaptureRefusals(request: CrossArchCatContinuationRequest): string[] {
  const refusals: string[] = [];
  if (request.sourceArch === request.targetArch) {
    refusals.push("sameArchProductSuccessRefused");
  }
  if (!request.process.executable.endsWith("/cat") && request.process.executable !== "cat") {
    refusals.push("catExecutableIdentityMissing");
  }
  if (request.process.argv[0] !== request.process.executable) {
    refusals.push("catArgvIdentityMismatch");
  }
  if (request.input.kind !== "regular-file") {
    refusals.push(`${request.input.kind}InputRefused`);
  }
  if (!request.input.path && !request.input.identityDigest) {
    refusals.push("inputIdentityMissing");
  }
  if (request.input.readOffset < 0) {
    refusals.push("negativeReadOffsetRefused");
  }
  if (request.input.readOffset > request.input.size) {
    refusals.push("readOffsetBeyondSizeRefused");
  }
  if (request.input.dirtyWritableAliasPresent) {
    refusals.push("dirtyWritableAliasRefused");
  }
  if (request.safePoint.kind === "split-read" && !request.input.partialReadBufferComplete) {
    refusals.push("partialReadBufferMissing");
  }
  if (request.safePoint.kind === "unknown" || request.safePoint.evidence.length === 0) {
    refusals.push("safePointEvidenceMissing");
  }
  if (request.output.stdoutKind !== "regular-file") {
    refusals.push(`${request.output.stdoutKind}OutputRefused`);
  }
  if (!request.output.terminalSessionAbsent) {
    refusals.push("terminalSessionStateRefused");
  }
  if (!request.targetPreflight.equivalentInputIdentityVerified) {
    refusals.push("targetInputIdentityPreflightFailed");
  }
  if (!request.targetPreflight.contentHashWindowMatches) {
    refusals.push("targetContentWindowMismatch");
  }
  if (!request.targetPreflight.regularFileOpenable) {
    refusals.push("targetRegularFileOpenRefused");
  }
  if (!request.targetPreflight.stdoutCursorInstallable) {
    refusals.push("targetStdoutCursorPreflightFailed");
  }
  if (!request.targetPreflight.crossIsaReaderVesselAvailable) {
    refusals.push("targetNativeReaderVesselMissing");
  }
  if (request.targetPreflight.noTargetProcessBeforeEligibilityEvidence.length === 0) {
    refusals.push("noTargetProcessBeforeEligibilityEvidenceMissing");
  }
  refusals.push(...shortcutRefusals(request.shortcuts));
  return refusals;
}

function crossArchCatTargetRefusals(request: CrossArchCatTargetContinuationRequest): string[] {
  const refusals: string[] = [];
  if (request.classification.state !== "eligible" || !request.classification.capture) {
    refusals.push("captureNotEligible");
  }
  if (!request.classification.productContinuationEligible) {
    refusals.push("productContinuationNotEligible");
  }
  if (!request.target.crossIsaVerified) {
    refusals.push("targetCrossIsaVerificationMissing");
  }
  if (!request.target.readerVesselCreated) {
    refusals.push("targetNativeReaderVesselMissing");
  }
  if (!request.target.fileIdentityVerified) {
    refusals.push("targetFileIdentityVerificationMissing");
  }
  if (!request.target.contentWindowVerified) {
    refusals.push("targetContentWindowVerificationMissing");
  }
  if (!request.target.seekInstalled) {
    refusals.push("targetSeekNotInstalled");
  }
  if (!request.target.partialBufferInstalled) {
    refusals.push("targetPartialBufferNotInstalled");
  }
  if (!request.target.stdoutCursorInstalled) {
    refusals.push("targetStdoutCursorNotInstalled");
  }
  if (!request.target.noReplayGuardInstalled) {
    refusals.push("targetNoReplayGuardMissing");
  }
  if (request.target.targetPid === undefined) {
    refusals.push("targetPidMissing");
  }
  if (!request.target.marker) {
    refusals.push("capturedStateDependentMarkerMissing");
  } else {
    const readOffset = request.classification.capture?.input.readOffset;
    if (readOffset !== undefined && request.target.marker.sourceReadOffset !== readOffset) {
      refusals.push("markerReadOffsetMismatch");
    }
    if (readOffset !== undefined && request.target.marker.targetFirstByteOffset < readOffset) {
      refusals.push("markerReplaysBytesBeforeCapturedOffset");
    }
    if (
      request.target.marker.replayedByteOffsets.some(
        (offset) => readOffset !== undefined && offset < readOffset,
      )
    ) {
      refusals.push("markerContainsReplayedByteOffsets");
    }
    if (request.target.marker.freshRestartWouldStartAtOffset !== 0) {
      refusals.push("freshRestartDiscriminatorMissing");
    }
  }
  refusals.push(...shortcutRefusals(request.shortcuts));
  return refusals;
}

function shortcutRefusals(shortcuts: CrossArchCatShortcutAttempts | undefined): string[] {
  const refusals: string[] = [];
  if (shortcuts?.sameArchProductAttempted) {
    refusals.push("sameArchProductSuccessRefused");
  }
  if (shortcuts?.argvRestartAttempted) {
    refusals.push("argvRestartRefused");
  }
  if (shortcuts?.execveFromArgvAttempted) {
    refusals.push("targetExecveFromArgvRefused");
  }
  if (shortcuts?.reexecAttempted) {
    refusals.push("reexecRefused");
  }
  if (shortcuts?.outputReplayAttempted) {
    refusals.push("outputReplayRefused");
  }
  if (shortcuts?.descriptorOnlySuccessAttempted) {
    refusals.push("descriptorOnlySuccessRefused");
  }
  if (shortcuts?.sourceIsaEmulationAttempted) {
    refusals.push("sourceIsaEmulationRefused");
  }
  if (shortcuts?.sourceFdTeleportationAttempted) {
    refusals.push("sourceFdTeleportationRefused");
  }
  if (shortcuts?.metadataOnlySuccessAttempted) {
    refusals.push("metadataOnlySuccessRefused");
  }
  return refusals;
}

function crossArchCatRefusedPlan(
  refusals: string[],
  targetPid: number | undefined,
): CrossArchCatTargetContinuationPlan {
  return {
    primitive: "cross-arch-cat-reader-semantic-continuation-v1",
    state: "refused",
    targetPid,
    resumedFromCapturedSemanticState: false,
    targetProcessStarted: false,
    targetProcessKilledOnRefusal: targetPid !== undefined,
    refusals: refusals.length > 0 ? refusals : ["captureNotEligible"],
    argvRestartUsed: false,
    execveFromArgvUsed: false,
    reexecUsed: false,
    outputReplayUsed: false,
    descriptorOnlySuccessUsed: false,
    sourceIsaEmulationUsed: false,
    sourceFdTeleportationUsed: false,
    metadataOnlySuccessUsed: false,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

export type CrossArchDdFdKind = CrossArchCatFdKind;
export type CrossArchDdSafePointKind = "between-blocks" | "partial-block" | "unknown";
export type CrossArchDdConvFlag = "none" | "notrunc" | "fsync" | "sparse" | "sync" | "unknown";

export interface CrossArchDdContinuationRequest {
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
  process: {
    pid: number;
    executable: string;
    argv: string[];
    cwd: string;
    executableSha256?: string;
  };
  input: CrossArchDdFileState;
  output: CrossArchDdFileState;
  copyState: {
    blockSize: number;
    inputOffset: number;
    outputOffset: number;
    partialBlockHex?: string;
    partialBlockLength: number;
    partialBlockComplete: boolean;
    recordsIn: number;
    recordsOut: number;
    bytesCopied: number;
    convFlags: CrossArchDdConvFlag[];
    directIo: boolean;
    sparseRequested: boolean;
    signalStatusPending: boolean;
    statusOutputCursor: number;
  };
  safePoint: {
    kind: CrossArchDdSafePointKind;
    evidence: string;
  };
  targetPreflight: {
    inputIdentityVerified: boolean;
    outputIdentityVerified: boolean;
    inputOpenable: boolean;
    outputOpenable: boolean;
    offsetsInstallable: boolean;
    countersInstallable: boolean;
    crossIsaCopyVesselAvailable: boolean;
    noTargetProcessBeforeEligibilityEvidence: string;
  };
  shortcuts?: CrossArchDdShortcutAttempts;
}

export interface CrossArchDdFileState {
  kind: CrossArchDdFdKind;
  path?: string;
  device?: string;
  inode?: string;
  identityDigest?: string;
  size: number;
  mtimeMs: number;
  contentHashWindow: string;
  dirtyWritableAliasPresent: boolean;
}

export type CrossArchDdShortcutAttempts = CrossArchCatShortcutAttempts;

export interface CrossArchDdSemanticCapture {
  primitive: "cross-arch-dd-regular-file-semantic-continuation-v1";
  architecture: {
    sourceArch: NativeProcessImageArchitecture;
    targetArch: NativeProcessImageArchitecture;
    crossIsa: true;
  };
  process: CrossArchDdContinuationRequest["process"];
  input: CrossArchDdContinuationRequest["input"];
  output: CrossArchDdContinuationRequest["output"];
  copyState: CrossArchDdContinuationRequest["copyState"];
  safePoint: CrossArchDdContinuationRequest["safePoint"];
  targetPreflight: CrossArchDdContinuationRequest["targetPreflight"];
}

export interface CrossArchDdContinuationClassification {
  primitive: "cross-arch-dd-regular-file-semantic-continuation-v1";
  state: CrossArchNextBinaryContinuationState;
  capture?: CrossArchDdSemanticCapture;
  refusals: string[];
  productContinuationEligible: boolean;
  targetProcessPlanned: false;
  nonClaims: readonly string[];
}

export interface CrossArchDdTargetContinuationRequest {
  classification: CrossArchDdContinuationClassification;
  target: {
    crossIsaVerified: boolean;
    copyVesselCreated: boolean;
    inputIdentityVerified: boolean;
    outputIdentityVerified: boolean;
    inputSeekInstalled: boolean;
    outputSeekInstalled: boolean;
    partialBlockInstalled: boolean;
    countersInstalled: boolean;
    noRecopyGuardInstalled: boolean;
    targetPid?: number;
    marker?: CrossArchDdContinuationMarker;
  };
  shortcuts?: CrossArchDdShortcutAttempts;
}

export interface CrossArchDdContinuationMarker {
  sourceInputOffset: number;
  sourceOutputOffset: number;
  targetFirstInputOffset: number;
  targetFirstOutputOffset: number;
  recopiedInputOffsets: number[];
  freshRestartWouldStartInputOffset: number;
  recordsInStart: number;
  recordsOutStart: number;
  finalInputOffset: number;
  finalOutputOffset: number;
}

export interface CrossArchDdTargetContinuationPlan {
  primitive: "cross-arch-dd-regular-file-semantic-continuation-v1";
  state: "ready" | "refused";
  targetPid?: number;
  resumedFromCapturedSemanticState: boolean;
  targetProcessStarted: boolean;
  targetProcessKilledOnRefusal: boolean;
  refusals: string[];
  argvRestartUsed: false;
  execveFromArgvUsed: false;
  reexecUsed: false;
  outputReplayUsed: false;
  descriptorOnlySuccessUsed: false;
  sourceIsaEmulationUsed: false;
  sourceFdTeleportationUsed: false;
  metadataOnlySuccessUsed: false;
  marker?: CrossArchDdContinuationMarker;
  nonClaims: readonly string[];
}

export function classifyCrossArchDdContinuationCapture(
  request: CrossArchDdContinuationRequest,
): CrossArchDdContinuationClassification {
  const refusals = crossArchDdCaptureRefusals(request);
  if (refusals.length > 0) {
    return {
      primitive: "cross-arch-dd-regular-file-semantic-continuation-v1",
      state: "refused",
      refusals,
      productContinuationEligible: false,
      targetProcessPlanned: false,
      nonClaims: crossArchCliNextBinariesNonClaims,
    };
  }

  return {
    primitive: "cross-arch-dd-regular-file-semantic-continuation-v1",
    state: "eligible",
    capture: {
      primitive: "cross-arch-dd-regular-file-semantic-continuation-v1",
      architecture: {
        sourceArch: request.sourceArch,
        targetArch: request.targetArch,
        crossIsa: true,
      },
      process: request.process,
      input: request.input,
      output: request.output,
      copyState: request.copyState,
      safePoint: request.safePoint,
      targetPreflight: request.targetPreflight,
    },
    refusals: [],
    productContinuationEligible: true,
    targetProcessPlanned: false,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

export function planCrossArchDdContinuationTarget(
  request: CrossArchDdTargetContinuationRequest,
): CrossArchDdTargetContinuationPlan {
  const refusals = crossArchDdTargetRefusals(request);
  const targetPid = request.target.targetPid;
  if (refusals.length > 0 || !request.classification.capture) {
    return crossArchDdRefusedPlan(refusals, targetPid);
  }

  return {
    primitive: "cross-arch-dd-regular-file-semantic-continuation-v1",
    state: "ready",
    targetPid,
    resumedFromCapturedSemanticState: true,
    targetProcessStarted: true,
    targetProcessKilledOnRefusal: false,
    refusals: [],
    argvRestartUsed: false,
    execveFromArgvUsed: false,
    reexecUsed: false,
    outputReplayUsed: false,
    descriptorOnlySuccessUsed: false,
    sourceIsaEmulationUsed: false,
    sourceFdTeleportationUsed: false,
    metadataOnlySuccessUsed: false,
    marker: request.target.marker,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

function crossArchDdCaptureRefusals(request: CrossArchDdContinuationRequest): string[] {
  const refusals: string[] = [];
  if (request.sourceArch === request.targetArch) {
    refusals.push("sameArchProductSuccessRefused");
  }
  if (!request.process.executable.endsWith("/dd") && request.process.executable !== "dd") {
    refusals.push("ddExecutableIdentityMissing");
  }
  if (request.input.kind !== "regular-file") {
    refusals.push(`${request.input.kind}InputRefused`);
  }
  if (request.output.kind !== "regular-file") {
    refusals.push(`${request.output.kind}OutputRefused`);
  }
  if (!request.input.path && !request.input.identityDigest) {
    refusals.push("inputIdentityMissing");
  }
  if (!request.output.path && !request.output.identityDigest) {
    refusals.push("outputIdentityMissing");
  }
  if (request.input.dirtyWritableAliasPresent || request.output.dirtyWritableAliasPresent) {
    refusals.push("dirtyWritableAliasRefused");
  }
  if (request.copyState.blockSize <= 0) {
    refusals.push("invalidBlockSizeRefused");
  }
  if (request.copyState.inputOffset < 0) {
    refusals.push("negativeInputOffsetRefused");
  }
  if (request.copyState.outputOffset < 0) {
    refusals.push("negativeOutputOffsetRefused");
  }
  if (request.copyState.inputOffset > request.input.size) {
    refusals.push("inputOffsetBeyondSizeRefused");
  }
  if (request.copyState.outputOffset > request.output.size) {
    refusals.push("outputOffsetBeyondSizeRefused");
  }
  if (request.safePoint.kind === "partial-block" && !request.copyState.partialBlockComplete) {
    refusals.push("partialBlockStateMissing");
  }
  if (request.copyState.directIo) {
    refusals.push("directIoRefused");
  }
  if (request.copyState.sparseRequested || request.copyState.convFlags.includes("sparse")) {
    refusals.push("sparseModeRefused");
  }
  if (request.copyState.convFlags.some((flag) => flag === "sync" || flag === "unknown")) {
    refusals.push("unsafeConvFlagRefused");
  }
  if (request.copyState.signalStatusPending) {
    refusals.push("signalInterruptedStatusRefused");
  }
  if (request.safePoint.kind === "unknown" || request.safePoint.evidence.length === 0) {
    refusals.push("safePointEvidenceMissing");
  }
  if (!request.targetPreflight.inputIdentityVerified) {
    refusals.push("targetInputIdentityPreflightFailed");
  }
  if (!request.targetPreflight.outputIdentityVerified) {
    refusals.push("targetOutputIdentityPreflightFailed");
  }
  if (!request.targetPreflight.inputOpenable) {
    refusals.push("targetInputOpenRefused");
  }
  if (!request.targetPreflight.outputOpenable) {
    refusals.push("targetOutputOpenRefused");
  }
  if (!request.targetPreflight.offsetsInstallable) {
    refusals.push("targetOffsetsPreflightFailed");
  }
  if (!request.targetPreflight.countersInstallable) {
    refusals.push("targetCountersPreflightFailed");
  }
  if (!request.targetPreflight.crossIsaCopyVesselAvailable) {
    refusals.push("targetNativeCopyVesselMissing");
  }
  if (request.targetPreflight.noTargetProcessBeforeEligibilityEvidence.length === 0) {
    refusals.push("noTargetProcessBeforeEligibilityEvidenceMissing");
  }
  refusals.push(...shortcutRefusals(request.shortcuts));
  return refusals;
}

function crossArchDdTargetRefusals(request: CrossArchDdTargetContinuationRequest): string[] {
  const refusals: string[] = [];
  if (request.classification.state !== "eligible" || !request.classification.capture) {
    refusals.push("captureNotEligible");
  }
  if (!request.classification.productContinuationEligible) {
    refusals.push("productContinuationNotEligible");
  }
  if (!request.target.crossIsaVerified) {
    refusals.push("targetCrossIsaVerificationMissing");
  }
  if (!request.target.copyVesselCreated) {
    refusals.push("targetNativeCopyVesselMissing");
  }
  if (!request.target.inputIdentityVerified) {
    refusals.push("targetInputIdentityVerificationMissing");
  }
  if (!request.target.outputIdentityVerified) {
    refusals.push("targetOutputIdentityVerificationMissing");
  }
  if (!request.target.inputSeekInstalled) {
    refusals.push("targetInputSeekNotInstalled");
  }
  if (!request.target.outputSeekInstalled) {
    refusals.push("targetOutputSeekNotInstalled");
  }
  if (!request.target.partialBlockInstalled) {
    refusals.push("targetPartialBlockNotInstalled");
  }
  if (!request.target.countersInstalled) {
    refusals.push("targetCountersNotInstalled");
  }
  if (!request.target.noRecopyGuardInstalled) {
    refusals.push("targetNoRecopyGuardMissing");
  }
  if (request.target.targetPid === undefined) {
    refusals.push("targetPidMissing");
  }
  if (!request.target.marker) {
    refusals.push("capturedStateDependentMarkerMissing");
  } else {
    const capture = request.classification.capture;
    const inputOffset = capture?.copyState.inputOffset;
    const outputOffset = capture?.copyState.outputOffset;
    if (inputOffset !== undefined && request.target.marker.sourceInputOffset !== inputOffset) {
      refusals.push("markerInputOffsetMismatch");
    }
    if (outputOffset !== undefined && request.target.marker.sourceOutputOffset !== outputOffset) {
      refusals.push("markerOutputOffsetMismatch");
    }
    if (inputOffset !== undefined && request.target.marker.targetFirstInputOffset < inputOffset) {
      refusals.push("markerRecopiesInputBeforeCapturedOffset");
    }
    if (
      outputOffset !== undefined &&
      request.target.marker.targetFirstOutputOffset < outputOffset
    ) {
      refusals.push("markerRewritesOutputBeforeCapturedOffset");
    }
    if (
      request.target.marker.recopiedInputOffsets.some(
        (offset) => inputOffset !== undefined && offset < inputOffset,
      )
    ) {
      refusals.push("markerContainsRecopiedInputOffsets");
    }
    if (request.target.marker.freshRestartWouldStartInputOffset !== 0) {
      refusals.push("freshRestartDiscriminatorMissing");
    }
  }
  refusals.push(...shortcutRefusals(request.shortcuts));
  return refusals;
}

function crossArchDdRefusedPlan(
  refusals: string[],
  targetPid: number | undefined,
): CrossArchDdTargetContinuationPlan {
  return {
    primitive: "cross-arch-dd-regular-file-semantic-continuation-v1",
    state: "refused",
    targetPid,
    resumedFromCapturedSemanticState: false,
    targetProcessStarted: false,
    targetProcessKilledOnRefusal: targetPid !== undefined,
    refusals: refusals.length > 0 ? refusals : ["captureNotEligible"],
    argvRestartUsed: false,
    execveFromArgvUsed: false,
    reexecUsed: false,
    outputReplayUsed: false,
    descriptorOnlySuccessUsed: false,
    sourceIsaEmulationUsed: false,
    sourceFdTeleportationUsed: false,
    metadataOnlySuccessUsed: false,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

export type CrossArchWcLineFdKind = CrossArchCatFdKind;
export type CrossArchWcLineSafePointKind = "between-lines" | "partial-line" | "unknown";

export interface CrossArchWcLineContinuationRequest {
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
  process: {
    pid: number;
    executable: string;
    argv: string[];
    cwd: string;
    executableSha256?: string;
  };
  input: {
    kind: CrossArchWcLineFdKind;
    path?: string;
    device?: string;
    inode?: string;
    identityDigest?: string;
    size: number;
    mtimeMs: number;
    contentHashWindow: string;
    byteOffset: number;
    dirtyWritableAliasPresent: boolean;
  };
  parserState: {
    lineCountSoFar: number;
    partialNewlineState: "at-boundary" | "after-non-newline" | "after-cr" | "unknown";
    lineDecoderState: "byte-newline" | "utf8-boundary" | "unknown";
    locale: "C" | "POSIX";
    broadByteModeRequested: boolean;
    broadCharModeRequested: boolean;
    broadWordModeRequested: boolean;
    multipleInputsPresent: boolean;
  };
  output: {
    stdoutKind: CrossArchWcLineFdKind;
    stdoutCursor: number;
    stderrCursor: number;
    terminalSessionAbsent: boolean;
  };
  safePoint: {
    kind: CrossArchWcLineSafePointKind;
    evidence: string;
  };
  targetPreflight: {
    inputIdentityVerified: boolean;
    contentHashWindowMatches: boolean;
    inputOpenable: boolean;
    byteOffsetInstallable: boolean;
    lineCounterInstallable: boolean;
    stdoutCursorInstallable: boolean;
    crossIsaLineCounterVesselAvailable: boolean;
    noTargetProcessBeforeEligibilityEvidence: string;
  };
  shortcuts?: CrossArchCatShortcutAttempts;
}

export interface CrossArchWcLineSemanticCapture {
  primitive: "cross-arch-wc-line-semantic-continuation-v1";
  architecture: {
    sourceArch: NativeProcessImageArchitecture;
    targetArch: NativeProcessImageArchitecture;
    crossIsa: true;
  };
  process: CrossArchWcLineContinuationRequest["process"];
  input: CrossArchWcLineContinuationRequest["input"];
  parserState: CrossArchWcLineContinuationRequest["parserState"];
  output: CrossArchWcLineContinuationRequest["output"];
  safePoint: CrossArchWcLineContinuationRequest["safePoint"];
  targetPreflight: CrossArchWcLineContinuationRequest["targetPreflight"];
}

export interface CrossArchWcLineContinuationClassification {
  primitive: "cross-arch-wc-line-semantic-continuation-v1";
  state: CrossArchNextBinaryContinuationState;
  capture?: CrossArchWcLineSemanticCapture;
  refusals: string[];
  productContinuationEligible: boolean;
  targetProcessPlanned: false;
  nonClaims: readonly string[];
}

export interface CrossArchWcLineTargetContinuationRequest {
  classification: CrossArchWcLineContinuationClassification;
  target: {
    crossIsaVerified: boolean;
    lineCounterVesselCreated: boolean;
    inputIdentityVerified: boolean;
    contentWindowVerified: boolean;
    byteOffsetSeekInstalled: boolean;
    lineCountInstalled: boolean;
    newlineStateInstalled: boolean;
    stdoutCursorInstalled: boolean;
    noRereadGuardInstalled: boolean;
    targetPid?: number;
    marker?: CrossArchWcLineContinuationMarker;
  };
  shortcuts?: CrossArchCatShortcutAttempts;
}

export interface CrossArchWcLineContinuationMarker {
  sourceByteOffset: number;
  sourceLineCountSoFar: number;
  suffixLineCount: number;
  targetFinalLineCount: number;
  targetFirstByteOffset: number;
  rereadByteOffsets: number[];
  freshRestartWouldStartByteOffset: number;
}

export interface CrossArchWcLineTargetContinuationPlan {
  primitive: "cross-arch-wc-line-semantic-continuation-v1";
  state: "ready" | "refused";
  targetPid?: number;
  resumedFromCapturedSemanticState: boolean;
  targetProcessStarted: boolean;
  targetProcessKilledOnRefusal: boolean;
  refusals: string[];
  argvRestartUsed: false;
  execveFromArgvUsed: false;
  reexecUsed: false;
  outputReplayUsed: false;
  descriptorOnlySuccessUsed: false;
  sourceIsaEmulationUsed: false;
  sourceFdTeleportationUsed: false;
  metadataOnlySuccessUsed: false;
  marker?: CrossArchWcLineContinuationMarker;
  nonClaims: readonly string[];
}

export function classifyCrossArchWcLineContinuationCapture(
  request: CrossArchWcLineContinuationRequest,
): CrossArchWcLineContinuationClassification {
  const refusals = crossArchWcLineCaptureRefusals(request);
  if (refusals.length > 0) {
    return {
      primitive: "cross-arch-wc-line-semantic-continuation-v1",
      state: "refused",
      refusals,
      productContinuationEligible: false,
      targetProcessPlanned: false,
      nonClaims: crossArchCliNextBinariesNonClaims,
    };
  }

  return {
    primitive: "cross-arch-wc-line-semantic-continuation-v1",
    state: "eligible",
    capture: {
      primitive: "cross-arch-wc-line-semantic-continuation-v1",
      architecture: {
        sourceArch: request.sourceArch,
        targetArch: request.targetArch,
        crossIsa: true,
      },
      process: request.process,
      input: request.input,
      parserState: request.parserState,
      output: request.output,
      safePoint: request.safePoint,
      targetPreflight: request.targetPreflight,
    },
    refusals: [],
    productContinuationEligible: true,
    targetProcessPlanned: false,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

export function planCrossArchWcLineContinuationTarget(
  request: CrossArchWcLineTargetContinuationRequest,
): CrossArchWcLineTargetContinuationPlan {
  const refusals = crossArchWcLineTargetRefusals(request);
  const targetPid = request.target.targetPid;
  if (refusals.length > 0 || !request.classification.capture) {
    return crossArchWcLineRefusedPlan(refusals, targetPid);
  }

  return {
    primitive: "cross-arch-wc-line-semantic-continuation-v1",
    state: "ready",
    targetPid,
    resumedFromCapturedSemanticState: true,
    targetProcessStarted: true,
    targetProcessKilledOnRefusal: false,
    refusals: [],
    argvRestartUsed: false,
    execveFromArgvUsed: false,
    reexecUsed: false,
    outputReplayUsed: false,
    descriptorOnlySuccessUsed: false,
    sourceIsaEmulationUsed: false,
    sourceFdTeleportationUsed: false,
    metadataOnlySuccessUsed: false,
    marker: request.target.marker,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

function crossArchWcLineCaptureRefusals(request: CrossArchWcLineContinuationRequest): string[] {
  const refusals: string[] = [];
  if (request.sourceArch === request.targetArch) {
    refusals.push("sameArchProductSuccessRefused");
  }
  if (!request.process.executable.endsWith("/wc") && request.process.executable !== "wc") {
    refusals.push("wcExecutableIdentityMissing");
  }
  if (!request.process.argv.includes("-l")) {
    refusals.push("wcLineFlagMissing");
  }
  if (request.input.kind !== "regular-file") {
    refusals.push(`${request.input.kind}InputRefused`);
  }
  if (!request.input.path && !request.input.identityDigest) {
    refusals.push("inputIdentityMissing");
  }
  if (request.input.byteOffset < 0) {
    refusals.push("negativeByteOffsetRefused");
  }
  if (request.input.byteOffset > request.input.size) {
    refusals.push("byteOffsetBeyondSizeRefused");
  }
  if (request.input.dirtyWritableAliasPresent) {
    refusals.push("dirtyWritableAliasRefused");
  }
  if (request.parserState.lineCountSoFar < 0) {
    refusals.push("negativeLineCountRefused");
  }
  if (request.parserState.partialNewlineState === "unknown") {
    refusals.push("partialNewlineStateMissing");
  }
  if (request.parserState.lineDecoderState === "unknown") {
    refusals.push("lineDecoderStateMissing");
  }
  if (request.parserState.locale !== "C" && request.parserState.locale !== "POSIX") {
    refusals.push("unmodeledLocaleRefused");
  }
  if (request.parserState.broadByteModeRequested) {
    refusals.push("broadWcByteModeRefused");
  }
  if (request.parserState.broadCharModeRequested) {
    refusals.push("broadWcCharModeRefused");
  }
  if (request.parserState.broadWordModeRequested) {
    refusals.push("broadWcWordModeRefused");
  }
  if (request.parserState.multipleInputsPresent) {
    refusals.push("multipleInputsWithoutListCursorRefused");
  }
  if (request.output.stdoutKind !== "regular-file") {
    refusals.push(`${request.output.stdoutKind}OutputRefused`);
  }
  if (!request.output.terminalSessionAbsent) {
    refusals.push("terminalSessionStateRefused");
  }
  if (request.safePoint.kind === "unknown" || request.safePoint.evidence.length === 0) {
    refusals.push("safePointEvidenceMissing");
  }
  if (!request.targetPreflight.inputIdentityVerified) {
    refusals.push("targetInputIdentityPreflightFailed");
  }
  if (!request.targetPreflight.contentHashWindowMatches) {
    refusals.push("targetContentWindowMismatch");
  }
  if (!request.targetPreflight.inputOpenable) {
    refusals.push("targetInputOpenRefused");
  }
  if (!request.targetPreflight.byteOffsetInstallable) {
    refusals.push("targetByteOffsetPreflightFailed");
  }
  if (!request.targetPreflight.lineCounterInstallable) {
    refusals.push("targetLineCounterPreflightFailed");
  }
  if (!request.targetPreflight.stdoutCursorInstallable) {
    refusals.push("targetStdoutCursorPreflightFailed");
  }
  if (!request.targetPreflight.crossIsaLineCounterVesselAvailable) {
    refusals.push("targetNativeLineCounterVesselMissing");
  }
  if (request.targetPreflight.noTargetProcessBeforeEligibilityEvidence.length === 0) {
    refusals.push("noTargetProcessBeforeEligibilityEvidenceMissing");
  }
  refusals.push(...shortcutRefusals(request.shortcuts));
  return refusals;
}

function crossArchWcLineTargetRefusals(
  request: CrossArchWcLineTargetContinuationRequest,
): string[] {
  const refusals: string[] = [];
  if (request.classification.state !== "eligible" || !request.classification.capture) {
    refusals.push("captureNotEligible");
  }
  if (!request.classification.productContinuationEligible) {
    refusals.push("productContinuationNotEligible");
  }
  if (!request.target.crossIsaVerified) {
    refusals.push("targetCrossIsaVerificationMissing");
  }
  if (!request.target.lineCounterVesselCreated) {
    refusals.push("targetNativeLineCounterVesselMissing");
  }
  if (!request.target.inputIdentityVerified) {
    refusals.push("targetInputIdentityVerificationMissing");
  }
  if (!request.target.contentWindowVerified) {
    refusals.push("targetContentWindowVerificationMissing");
  }
  if (!request.target.byteOffsetSeekInstalled) {
    refusals.push("targetByteOffsetSeekNotInstalled");
  }
  if (!request.target.lineCountInstalled) {
    refusals.push("targetLineCountNotInstalled");
  }
  if (!request.target.newlineStateInstalled) {
    refusals.push("targetNewlineStateNotInstalled");
  }
  if (!request.target.stdoutCursorInstalled) {
    refusals.push("targetStdoutCursorNotInstalled");
  }
  if (!request.target.noRereadGuardInstalled) {
    refusals.push("targetNoRereadGuardMissing");
  }
  if (request.target.targetPid === undefined) {
    refusals.push("targetPidMissing");
  }
  if (!request.target.marker) {
    refusals.push("capturedStateDependentMarkerMissing");
  } else {
    const capture = request.classification.capture;
    const byteOffset = capture?.input.byteOffset;
    const lineCount = capture?.parserState.lineCountSoFar;
    if (byteOffset !== undefined && request.target.marker.sourceByteOffset !== byteOffset) {
      refusals.push("markerByteOffsetMismatch");
    }
    if (lineCount !== undefined && request.target.marker.sourceLineCountSoFar !== lineCount) {
      refusals.push("markerLineCountMismatch");
    }
    if (byteOffset !== undefined && request.target.marker.targetFirstByteOffset < byteOffset) {
      refusals.push("markerRereadsBytesBeforeCapturedOffset");
    }
    if (
      request.target.marker.rereadByteOffsets.some(
        (offset) => byteOffset !== undefined && offset < byteOffset,
      )
    ) {
      refusals.push("markerContainsRereadByteOffsets");
    }
    if (
      lineCount !== undefined &&
      request.target.marker.targetFinalLineCount !==
        lineCount + request.target.marker.suffixLineCount
    ) {
      refusals.push("markerFinalLineCountNotCapturedPlusSuffix");
    }
    if (request.target.marker.freshRestartWouldStartByteOffset !== 0) {
      refusals.push("freshRestartDiscriminatorMissing");
    }
  }
  refusals.push(...shortcutRefusals(request.shortcuts));
  return refusals;
}

function crossArchWcLineRefusedPlan(
  refusals: string[],
  targetPid: number | undefined,
): CrossArchWcLineTargetContinuationPlan {
  return {
    primitive: "cross-arch-wc-line-semantic-continuation-v1",
    state: "refused",
    targetPid,
    resumedFromCapturedSemanticState: false,
    targetProcessStarted: false,
    targetProcessKilledOnRefusal: targetPid !== undefined,
    refusals: refusals.length > 0 ? refusals : ["captureNotEligible"],
    argvRestartUsed: false,
    execveFromArgvUsed: false,
    reexecUsed: false,
    outputReplayUsed: false,
    descriptorOnlySuccessUsed: false,
    sourceIsaEmulationUsed: false,
    sourceFdTeleportationUsed: false,
    metadataOnlySuccessUsed: false,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

export type CrossArchSeqSafePointKind = "between-values" | "partial-value" | "unknown";

export interface CrossArchSeqContinuationRequest {
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
  process: {
    pid: number;
    executable: string;
    argv: string[];
    cwd: string;
    executableSha256?: string;
  };
  sequenceState: {
    firstValue: string;
    currentValue: string;
    nextValue: string;
    endValue: string;
    stepValue: string;
    format: string;
    separator: string;
    emittedItemCursor: number;
    stdoutCursor: number;
    partialFormattedValue?: string;
    partialFormattedValueComplete: boolean;
    integerOnly: boolean;
    locale: "C" | "POSIX" | "unknown";
    numericPrecisionAssumption: "safe-integer" | "bigint-decimal" | "floating" | "unknown";
  };
  output: {
    stdoutKind: CrossArchCatFdKind;
    stderrCursor: number;
    terminalSessionAbsent: boolean;
  };
  safePoint: {
    kind: CrossArchSeqSafePointKind;
    evidence: string;
  };
  targetPreflight: {
    generatorVesselAvailable: boolean;
    numericPrecisionMatches: boolean;
    formatInstallable: boolean;
    stdoutCursorInstallable: boolean;
    crossIsaGeneratorVesselAvailable: boolean;
    noTargetProcessBeforeEligibilityEvidence: string;
  };
  shortcuts?: CrossArchCatShortcutAttempts;
}

export interface CrossArchSeqSemanticCapture {
  primitive: "cross-arch-seq-semantic-continuation-v1";
  architecture: {
    sourceArch: NativeProcessImageArchitecture;
    targetArch: NativeProcessImageArchitecture;
    crossIsa: true;
  };
  process: CrossArchSeqContinuationRequest["process"];
  sequenceState: CrossArchSeqContinuationRequest["sequenceState"];
  output: CrossArchSeqContinuationRequest["output"];
  safePoint: CrossArchSeqContinuationRequest["safePoint"];
  targetPreflight: CrossArchSeqContinuationRequest["targetPreflight"];
}

export interface CrossArchSeqContinuationClassification {
  primitive: "cross-arch-seq-semantic-continuation-v1";
  state: CrossArchNextBinaryContinuationState;
  capture?: CrossArchSeqSemanticCapture;
  refusals: string[];
  productContinuationEligible: boolean;
  targetProcessPlanned: false;
  nonClaims: readonly string[];
}

export interface CrossArchSeqTargetContinuationRequest {
  classification: CrossArchSeqContinuationClassification;
  target: {
    crossIsaVerified: boolean;
    generatorVesselCreated: boolean;
    nextValueInstalled: boolean;
    endStepFormatInstalled: boolean;
    stdoutCursorInstalled: boolean;
    noRestartGuardInstalled: boolean;
    targetPid?: number;
    marker?: CrossArchSeqContinuationMarker;
  };
  shortcuts?: CrossArchCatShortcutAttempts;
}

export interface CrossArchSeqContinuationMarker {
  sourceFirstValue: string;
  sourceCurrentValue: string;
  sourceNextValue: string;
  targetFirstEmittedValue: string;
  emittedItemCursorStart: number;
  freshRestartWouldEmitFirstValue: string;
  replayedValues: string[];
}

export interface CrossArchSeqTargetContinuationPlan {
  primitive: "cross-arch-seq-semantic-continuation-v1";
  state: "ready" | "refused";
  targetPid?: number;
  resumedFromCapturedSemanticState: boolean;
  targetProcessStarted: boolean;
  targetProcessKilledOnRefusal: boolean;
  refusals: string[];
  argvRestartUsed: false;
  execveFromArgvUsed: false;
  reexecUsed: false;
  outputReplayUsed: false;
  descriptorOnlySuccessUsed: false;
  sourceIsaEmulationUsed: false;
  sourceFdTeleportationUsed: false;
  metadataOnlySuccessUsed: false;
  marker?: CrossArchSeqContinuationMarker;
  nonClaims: readonly string[];
}

export function classifyCrossArchSeqContinuationCapture(
  request: CrossArchSeqContinuationRequest,
): CrossArchSeqContinuationClassification {
  const refusals = crossArchSeqCaptureRefusals(request);
  if (refusals.length > 0) {
    return {
      primitive: "cross-arch-seq-semantic-continuation-v1",
      state: "refused",
      refusals,
      productContinuationEligible: false,
      targetProcessPlanned: false,
      nonClaims: crossArchCliNextBinariesNonClaims,
    };
  }

  return {
    primitive: "cross-arch-seq-semantic-continuation-v1",
    state: "eligible",
    capture: {
      primitive: "cross-arch-seq-semantic-continuation-v1",
      architecture: {
        sourceArch: request.sourceArch,
        targetArch: request.targetArch,
        crossIsa: true,
      },
      process: request.process,
      sequenceState: request.sequenceState,
      output: request.output,
      safePoint: request.safePoint,
      targetPreflight: request.targetPreflight,
    },
    refusals: [],
    productContinuationEligible: true,
    targetProcessPlanned: false,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

export function planCrossArchSeqContinuationTarget(
  request: CrossArchSeqTargetContinuationRequest,
): CrossArchSeqTargetContinuationPlan {
  const refusals = crossArchSeqTargetRefusals(request);
  const targetPid = request.target.targetPid;
  if (refusals.length > 0 || !request.classification.capture) {
    return crossArchSeqRefusedPlan(refusals, targetPid);
  }

  return {
    primitive: "cross-arch-seq-semantic-continuation-v1",
    state: "ready",
    targetPid,
    resumedFromCapturedSemanticState: true,
    targetProcessStarted: true,
    targetProcessKilledOnRefusal: false,
    refusals: [],
    argvRestartUsed: false,
    execveFromArgvUsed: false,
    reexecUsed: false,
    outputReplayUsed: false,
    descriptorOnlySuccessUsed: false,
    sourceIsaEmulationUsed: false,
    sourceFdTeleportationUsed: false,
    metadataOnlySuccessUsed: false,
    marker: request.target.marker,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

function crossArchSeqCaptureRefusals(request: CrossArchSeqContinuationRequest): string[] {
  const refusals: string[] = [];
  if (request.sourceArch === request.targetArch) {
    refusals.push("sameArchProductSuccessRefused");
  }
  if (!request.process.executable.endsWith("/seq") && request.process.executable !== "seq") {
    refusals.push("seqExecutableIdentityMissing");
  }
  if (request.sequenceState.firstValue.length === 0) {
    refusals.push("firstValueMissing");
  }
  if (request.sequenceState.currentValue.length === 0) {
    refusals.push("currentValueMissing");
  }
  if (request.sequenceState.nextValue.length === 0) {
    refusals.push("nextValueMissing");
  }
  if (request.sequenceState.endValue.length === 0) {
    refusals.push("endValueMissing");
  }
  if (request.sequenceState.stepValue.length === 0 || request.sequenceState.stepValue === "0") {
    refusals.push("invalidStepValueRefused");
  }
  if (!request.sequenceState.integerOnly) {
    refusals.push("unsupportedFloatingFormatRefused");
  }
  if (request.sequenceState.locale === "unknown") {
    refusals.push("unmodeledLocaleRefused");
  }
  if (request.sequenceState.numericPrecisionAssumption === "floating") {
    refusals.push("unsupportedFloatingPrecisionRefused");
  }
  if (request.sequenceState.numericPrecisionAssumption === "unknown") {
    refusals.push("numericPrecisionAssumptionMissing");
  }
  if (request.sequenceState.emittedItemCursor < 0) {
    refusals.push("negativeEmittedItemCursorRefused");
  }
  if (request.sequenceState.stdoutCursor < 0) {
    refusals.push("negativeStdoutCursorRefused");
  }
  if (
    request.safePoint.kind === "partial-value" &&
    !request.sequenceState.partialFormattedValueComplete
  ) {
    refusals.push("partialFormattedValueStateMissing");
  }
  if (request.output.stdoutKind !== "regular-file") {
    refusals.push(`${request.output.stdoutKind}OutputRefused`);
  }
  if (!request.output.terminalSessionAbsent) {
    refusals.push("terminalSessionStateRefused");
  }
  if (request.safePoint.kind === "unknown" || request.safePoint.evidence.length === 0) {
    refusals.push("safePointEvidenceMissing");
  }
  if (!request.targetPreflight.generatorVesselAvailable) {
    refusals.push("targetGeneratorVesselMissing");
  }
  if (!request.targetPreflight.numericPrecisionMatches) {
    refusals.push("targetNumericPrecisionMismatch");
  }
  if (!request.targetPreflight.formatInstallable) {
    refusals.push("targetFormatPreflightFailed");
  }
  if (!request.targetPreflight.stdoutCursorInstallable) {
    refusals.push("targetStdoutCursorPreflightFailed");
  }
  if (!request.targetPreflight.crossIsaGeneratorVesselAvailable) {
    refusals.push("targetNativeGeneratorVesselMissing");
  }
  if (request.targetPreflight.noTargetProcessBeforeEligibilityEvidence.length === 0) {
    refusals.push("noTargetProcessBeforeEligibilityEvidenceMissing");
  }
  refusals.push(...shortcutRefusals(request.shortcuts));
  return refusals;
}

function crossArchSeqTargetRefusals(request: CrossArchSeqTargetContinuationRequest): string[] {
  const refusals: string[] = [];
  if (request.classification.state !== "eligible" || !request.classification.capture) {
    refusals.push("captureNotEligible");
  }
  if (!request.classification.productContinuationEligible) {
    refusals.push("productContinuationNotEligible");
  }
  if (!request.target.crossIsaVerified) {
    refusals.push("targetCrossIsaVerificationMissing");
  }
  if (!request.target.generatorVesselCreated) {
    refusals.push("targetNativeGeneratorVesselMissing");
  }
  if (!request.target.nextValueInstalled) {
    refusals.push("targetNextValueNotInstalled");
  }
  if (!request.target.endStepFormatInstalled) {
    refusals.push("targetEndStepFormatNotInstalled");
  }
  if (!request.target.stdoutCursorInstalled) {
    refusals.push("targetStdoutCursorNotInstalled");
  }
  if (!request.target.noRestartGuardInstalled) {
    refusals.push("targetNoRestartGuardMissing");
  }
  if (request.target.targetPid === undefined) {
    refusals.push("targetPidMissing");
  }
  if (!request.target.marker) {
    refusals.push("capturedStateDependentMarkerMissing");
  } else {
    const capture = request.classification.capture;
    const sequence = capture?.sequenceState;
    if (sequence && request.target.marker.sourceFirstValue !== sequence.firstValue) {
      refusals.push("markerFirstValueMismatch");
    }
    if (sequence && request.target.marker.sourceCurrentValue !== sequence.currentValue) {
      refusals.push("markerCurrentValueMismatch");
    }
    if (sequence && request.target.marker.sourceNextValue !== sequence.nextValue) {
      refusals.push("markerNextValueMismatch");
    }
    if (sequence && request.target.marker.targetFirstEmittedValue !== sequence.nextValue) {
      refusals.push("markerDoesNotEmitCapturedNextValue");
    }
    if (sequence && request.target.marker.freshRestartWouldEmitFirstValue !== sequence.firstValue) {
      refusals.push("freshRestartDiscriminatorMissing");
    }
    if (sequence && request.target.marker.replayedValues.includes(sequence.firstValue)) {
      refusals.push("markerReplaysFirstValue");
    }
  }
  refusals.push(...shortcutRefusals(request.shortcuts));
  return refusals;
}

function crossArchSeqRefusedPlan(
  refusals: string[],
  targetPid: number | undefined,
): CrossArchSeqTargetContinuationPlan {
  return {
    primitive: "cross-arch-seq-semantic-continuation-v1",
    state: "refused",
    targetPid,
    resumedFromCapturedSemanticState: false,
    targetProcessStarted: false,
    targetProcessKilledOnRefusal: targetPid !== undefined,
    refusals: refusals.length > 0 ? refusals : ["captureNotEligible"],
    argvRestartUsed: false,
    execveFromArgvUsed: false,
    reexecUsed: false,
    outputReplayUsed: false,
    descriptorOnlySuccessUsed: false,
    sourceIsaEmulationUsed: false,
    sourceFdTeleportationUsed: false,
    metadataOnlySuccessUsed: false,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

export type CrossArchFixedStringGrepFdKind = CrossArchCatFdKind;
export type CrossArchFixedStringGrepSafePointKind = "between-lines" | "partial-line" | "unknown";

export interface CrossArchFixedStringGrepContinuationRequest {
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
  process: {
    pid: number;
    executable: string;
    argv: string[];
    cwd: string;
    executableSha256?: string;
  };
  pattern: {
    patternBytesHex: string;
    fixedString: true;
    caseInsensitive: boolean;
    locale: "C" | "POSIX";
  };
  input: {
    kind: CrossArchFixedStringGrepFdKind;
    path?: string;
    device?: string;
    inode?: string;
    identityDigest?: string;
    size: number;
    mtimeMs: number;
    contentHashWindow: string;
    byteOffset: number;
    dirtyWritableAliasPresent: boolean;
  };
  parserState: {
    partialLineBufferHex?: string;
    partialLineComplete: boolean;
    lineDecoderState: "byte-line" | "utf8-boundary" | "unknown";
    matcherState: "fixed-string-boundary" | "unknown";
    matchCountSoFar: number;
    lastCompletedLineNumber: number;
    regexModeRequested: boolean;
    pcreModeRequested: boolean;
    backrefsPresent: boolean;
    contextOutputRequested: boolean;
    colorOutputRequested: boolean;
    binaryFileModeUnmodeled: boolean;
    recursiveInputRequested: boolean;
    multipleFilesPresent: boolean;
  };
  output: {
    stdoutKind: CrossArchFixedStringGrepFdKind;
    stdoutCursor: number;
    stderrCursor: number;
    terminalSessionAbsent: boolean;
  };
  safePoint: {
    kind: CrossArchFixedStringGrepSafePointKind;
    evidence: string;
  };
  targetPreflight: {
    inputIdentityVerified: boolean;
    contentHashWindowMatches: boolean;
    inputOpenable: boolean;
    byteOffsetInstallable: boolean;
    matcherStateInstallable: boolean;
    outputCursorInstallable: boolean;
    crossIsaFixedStringMatcherVesselAvailable: boolean;
    noTargetProcessBeforeEligibilityEvidence: string;
  };
  shortcuts?: CrossArchCatShortcutAttempts;
}

export interface CrossArchFixedStringGrepSemanticCapture {
  primitive: "cross-arch-grep-fixed-string-semantic-continuation-v1";
  architecture: {
    sourceArch: NativeProcessImageArchitecture;
    targetArch: NativeProcessImageArchitecture;
    crossIsa: true;
  };
  process: CrossArchFixedStringGrepContinuationRequest["process"];
  pattern: CrossArchFixedStringGrepContinuationRequest["pattern"];
  input: CrossArchFixedStringGrepContinuationRequest["input"];
  parserState: CrossArchFixedStringGrepContinuationRequest["parserState"];
  output: CrossArchFixedStringGrepContinuationRequest["output"];
  safePoint: CrossArchFixedStringGrepContinuationRequest["safePoint"];
  targetPreflight: CrossArchFixedStringGrepContinuationRequest["targetPreflight"];
}

export interface CrossArchFixedStringGrepContinuationClassification {
  primitive: "cross-arch-grep-fixed-string-semantic-continuation-v1";
  state: CrossArchNextBinaryContinuationState;
  capture?: CrossArchFixedStringGrepSemanticCapture;
  refusals: string[];
  productContinuationEligible: boolean;
  targetProcessPlanned: false;
  nonClaims: readonly string[];
}

export interface CrossArchFixedStringGrepTargetContinuationRequest {
  classification: CrossArchFixedStringGrepContinuationClassification;
  target: {
    crossIsaVerified: boolean;
    matcherVesselCreated: boolean;
    inputIdentityVerified: boolean;
    contentWindowVerified: boolean;
    byteOffsetSeekInstalled: boolean;
    partialLineInstalled: boolean;
    matcherStateInstalled: boolean;
    matchCountInstalled: boolean;
    outputCursorInstalled: boolean;
    noRematchGuardInstalled: boolean;
    targetPid?: number;
    marker?: CrossArchFixedStringGrepContinuationMarker;
  };
  shortcuts?: CrossArchCatShortcutAttempts;
}

export interface CrossArchFixedStringGrepContinuationMarker {
  sourceByteOffset: number;
  sourceMatchCountSoFar: number;
  targetFirstScannedByteOffset: number;
  targetFirstMatchedLineNumber: number;
  priorMatchedLinesReplayed: number[];
  rematchedLineNumbers: number[];
  freshRestartWouldVisitLine: number;
  matchCountStart: number;
}

export interface CrossArchFixedStringGrepTargetContinuationPlan {
  primitive: "cross-arch-grep-fixed-string-semantic-continuation-v1";
  state: "ready" | "refused";
  targetPid?: number;
  resumedFromCapturedSemanticState: boolean;
  targetProcessStarted: boolean;
  targetProcessKilledOnRefusal: boolean;
  refusals: string[];
  argvRestartUsed: false;
  execveFromArgvUsed: false;
  reexecUsed: false;
  outputReplayUsed: false;
  descriptorOnlySuccessUsed: false;
  sourceIsaEmulationUsed: false;
  sourceFdTeleportationUsed: false;
  metadataOnlySuccessUsed: false;
  marker?: CrossArchFixedStringGrepContinuationMarker;
  nonClaims: readonly string[];
}

export function classifyCrossArchFixedStringGrepContinuationCapture(
  request: CrossArchFixedStringGrepContinuationRequest,
): CrossArchFixedStringGrepContinuationClassification {
  const refusals = crossArchFixedStringGrepCaptureRefusals(request);
  if (refusals.length > 0) {
    return {
      primitive: "cross-arch-grep-fixed-string-semantic-continuation-v1",
      state: "refused",
      refusals,
      productContinuationEligible: false,
      targetProcessPlanned: false,
      nonClaims: crossArchCliNextBinariesNonClaims,
    };
  }

  return {
    primitive: "cross-arch-grep-fixed-string-semantic-continuation-v1",
    state: "eligible",
    capture: {
      primitive: "cross-arch-grep-fixed-string-semantic-continuation-v1",
      architecture: {
        sourceArch: request.sourceArch,
        targetArch: request.targetArch,
        crossIsa: true,
      },
      process: request.process,
      pattern: request.pattern,
      input: request.input,
      parserState: request.parserState,
      output: request.output,
      safePoint: request.safePoint,
      targetPreflight: request.targetPreflight,
    },
    refusals: [],
    productContinuationEligible: true,
    targetProcessPlanned: false,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

export function planCrossArchFixedStringGrepContinuationTarget(
  request: CrossArchFixedStringGrepTargetContinuationRequest,
): CrossArchFixedStringGrepTargetContinuationPlan {
  const refusals = crossArchFixedStringGrepTargetRefusals(request);
  const targetPid = request.target.targetPid;
  if (refusals.length > 0 || !request.classification.capture) {
    return crossArchFixedStringGrepRefusedPlan(refusals, targetPid);
  }

  return {
    primitive: "cross-arch-grep-fixed-string-semantic-continuation-v1",
    state: "ready",
    targetPid,
    resumedFromCapturedSemanticState: true,
    targetProcessStarted: true,
    targetProcessKilledOnRefusal: false,
    refusals: [],
    argvRestartUsed: false,
    execveFromArgvUsed: false,
    reexecUsed: false,
    outputReplayUsed: false,
    descriptorOnlySuccessUsed: false,
    sourceIsaEmulationUsed: false,
    sourceFdTeleportationUsed: false,
    metadataOnlySuccessUsed: false,
    marker: request.target.marker,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}

function crossArchFixedStringGrepCaptureRefusals(
  request: CrossArchFixedStringGrepContinuationRequest,
): string[] {
  const refusals: string[] = [];
  if (request.sourceArch === request.targetArch) {
    refusals.push("sameArchProductSuccessRefused");
  }
  if (!request.process.executable.endsWith("/grep") && request.process.executable !== "grep") {
    refusals.push("grepExecutableIdentityMissing");
  }
  if (!request.process.argv.includes("-F")) {
    refusals.push("fixedStringFlagMissing");
  }
  if (!request.pattern.fixedString) {
    refusals.push("regexModeRefused");
  }
  if (request.pattern.patternBytesHex.length === 0) {
    refusals.push("patternBytesMissing");
  }
  if (request.input.kind !== "regular-file") {
    refusals.push(`${request.input.kind}InputRefused`);
  }
  if (!request.input.path && !request.input.identityDigest) {
    refusals.push("inputIdentityMissing");
  }
  if (request.input.byteOffset < 0) {
    refusals.push("negativeByteOffsetRefused");
  }
  if (request.input.byteOffset > request.input.size) {
    refusals.push("byteOffsetBeyondSizeRefused");
  }
  if (request.input.dirtyWritableAliasPresent) {
    refusals.push("dirtyWritableAliasRefused");
  }
  if (
    request.parserState.partialLineComplete === false &&
    request.safePoint.kind === "partial-line"
  ) {
    refusals.push("partialLineStateMissing");
  }
  if (request.parserState.lineDecoderState === "unknown") {
    refusals.push("lineDecoderStateMissing");
  }
  if (request.parserState.matcherState === "unknown") {
    refusals.push("matcherStateMissing");
  }
  if (request.parserState.matchCountSoFar < 0) {
    refusals.push("negativeMatchCountRefused");
  }
  if (request.parserState.regexModeRequested) {
    refusals.push("regexModeRefused");
  }
  if (request.parserState.pcreModeRequested) {
    refusals.push("pcreModeRefused");
  }
  if (request.parserState.backrefsPresent) {
    refusals.push("backrefsRefused");
  }
  if (request.parserState.contextOutputRequested) {
    refusals.push("contextOutputRefused");
  }
  if (request.parserState.colorOutputRequested) {
    refusals.push("colorOutputRefused");
  }
  if (request.parserState.binaryFileModeUnmodeled) {
    refusals.push("binaryFileModeRefused");
  }
  if (request.parserState.recursiveInputRequested) {
    refusals.push("recursiveInputRefused");
  }
  if (request.parserState.multipleFilesPresent) {
    refusals.push("multipleFilesWithoutListCursorRefused");
  }
  if (request.output.stdoutKind !== "regular-file") {
    refusals.push(`${request.output.stdoutKind}OutputRefused`);
  }
  if (!request.output.terminalSessionAbsent) {
    refusals.push("terminalSessionStateRefused");
  }
  if (request.safePoint.kind === "unknown" || request.safePoint.evidence.length === 0) {
    refusals.push("safePointEvidenceMissing");
  }
  if (!request.targetPreflight.inputIdentityVerified) {
    refusals.push("targetInputIdentityPreflightFailed");
  }
  if (!request.targetPreflight.contentHashWindowMatches) {
    refusals.push("targetContentWindowMismatch");
  }
  if (!request.targetPreflight.inputOpenable) {
    refusals.push("targetInputOpenRefused");
  }
  if (!request.targetPreflight.byteOffsetInstallable) {
    refusals.push("targetByteOffsetPreflightFailed");
  }
  if (!request.targetPreflight.matcherStateInstallable) {
    refusals.push("targetMatcherStatePreflightFailed");
  }
  if (!request.targetPreflight.outputCursorInstallable) {
    refusals.push("targetOutputCursorPreflightFailed");
  }
  if (!request.targetPreflight.crossIsaFixedStringMatcherVesselAvailable) {
    refusals.push("targetNativeFixedStringMatcherVesselMissing");
  }
  if (request.targetPreflight.noTargetProcessBeforeEligibilityEvidence.length === 0) {
    refusals.push("noTargetProcessBeforeEligibilityEvidenceMissing");
  }
  refusals.push(...shortcutRefusals(request.shortcuts));
  return refusals;
}

function crossArchFixedStringGrepTargetRefusals(
  request: CrossArchFixedStringGrepTargetContinuationRequest,
): string[] {
  const refusals: string[] = [];
  if (request.classification.state !== "eligible" || !request.classification.capture) {
    refusals.push("captureNotEligible");
  }
  if (!request.classification.productContinuationEligible) {
    refusals.push("productContinuationNotEligible");
  }
  if (!request.target.crossIsaVerified) {
    refusals.push("targetCrossIsaVerificationMissing");
  }
  if (!request.target.matcherVesselCreated) {
    refusals.push("targetNativeFixedStringMatcherVesselMissing");
  }
  if (!request.target.inputIdentityVerified) {
    refusals.push("targetInputIdentityVerificationMissing");
  }
  if (!request.target.contentWindowVerified) {
    refusals.push("targetContentWindowVerificationMissing");
  }
  if (!request.target.byteOffsetSeekInstalled) {
    refusals.push("targetByteOffsetSeekNotInstalled");
  }
  if (!request.target.partialLineInstalled) {
    refusals.push("targetPartialLineNotInstalled");
  }
  if (!request.target.matcherStateInstalled) {
    refusals.push("targetMatcherStateNotInstalled");
  }
  if (!request.target.matchCountInstalled) {
    refusals.push("targetMatchCountNotInstalled");
  }
  if (!request.target.outputCursorInstalled) {
    refusals.push("targetOutputCursorNotInstalled");
  }
  if (!request.target.noRematchGuardInstalled) {
    refusals.push("targetNoRematchGuardMissing");
  }
  if (request.target.targetPid === undefined) {
    refusals.push("targetPidMissing");
  }
  if (!request.target.marker) {
    refusals.push("capturedStateDependentMarkerMissing");
  } else {
    const capture = request.classification.capture;
    const byteOffset = capture?.input.byteOffset;
    const matchCount = capture?.parserState.matchCountSoFar;
    const lastCompletedLine = capture?.parserState.lastCompletedLineNumber;
    if (byteOffset !== undefined && request.target.marker.sourceByteOffset !== byteOffset) {
      refusals.push("markerByteOffsetMismatch");
    }
    if (matchCount !== undefined && request.target.marker.sourceMatchCountSoFar !== matchCount) {
      refusals.push("markerMatchCountMismatch");
    }
    if (
      byteOffset !== undefined &&
      request.target.marker.targetFirstScannedByteOffset < byteOffset
    ) {
      refusals.push("markerScansBeforeCapturedOffset");
    }
    if (
      lastCompletedLine !== undefined &&
      request.target.marker.rematchedLineNumbers.some((line) => line <= lastCompletedLine)
    ) {
      refusals.push("markerRematchesPriorLines");
    }
    if (request.target.marker.priorMatchedLinesReplayed.length > 0) {
      refusals.push("markerReplaysPriorMatchedOutput");
    }
    if (request.target.marker.freshRestartWouldVisitLine !== 1) {
      refusals.push("freshRestartDiscriminatorMissing");
    }
  }
  refusals.push(...shortcutRefusals(request.shortcuts));
  return refusals;
}

function crossArchFixedStringGrepRefusedPlan(
  refusals: string[],
  targetPid: number | undefined,
): CrossArchFixedStringGrepTargetContinuationPlan {
  return {
    primitive: "cross-arch-grep-fixed-string-semantic-continuation-v1",
    state: "refused",
    targetPid,
    resumedFromCapturedSemanticState: false,
    targetProcessStarted: false,
    targetProcessKilledOnRefusal: targetPid !== undefined,
    refusals: refusals.length > 0 ? refusals : ["captureNotEligible"],
    argvRestartUsed: false,
    execveFromArgvUsed: false,
    reexecUsed: false,
    outputReplayUsed: false,
    descriptorOnlySuccessUsed: false,
    sourceIsaEmulationUsed: false,
    sourceFdTeleportationUsed: false,
    metadataOnlySuccessUsed: false,
    nonClaims: crossArchCliNextBinariesNonClaims,
  };
}
