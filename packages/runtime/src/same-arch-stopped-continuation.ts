import type {
  NativeProcessImageArchitecture,
  NativeProcessImageRefusal,
} from "./native-process-image.ts";

export type SameArchStoppedContinuationState = "eligible" | "refused";
export type SameArchStoppedStopState = "ptrace-stopped" | "move-owned-stop" | "running" | "unknown";
export type SameArchStoppedActiveSyscallState =
  | "outside-syscall"
  | "active-syscall"
  | "syscall-restart"
  | "blocking-kernel-wait"
  | "unknown";
export type SameArchStoppedMappingKind =
  | "text"
  | "private-writable"
  | "stack"
  | "shared"
  | "device"
  | "vdso"
  | "vvar"
  | "jit"
  | "ambiguous";
export type SameArchStoppedFdKind =
  | "closed"
  | "dev-null"
  | "move-owned-stdio"
  | "file"
  | "pipe"
  | "socket"
  | "eventfd"
  | "epoll"
  | "timerfd"
  | "inotify"
  | "signalfd"
  | "device"
  | "unknown";

export interface SameArchStoppedContinuationRequest {
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
  process: {
    pid: number;
    ppid?: number;
    exe: string;
    argv: string[];
    cwd: string;
    uid?: number;
    gid?: number;
    executableSha256?: string;
    targetTextIdentityMatches?: boolean;
  };
  thread: {
    id: string;
    threadCount: number;
    stopState: SameArchStoppedStopState;
    activeSyscallState: SameArchStoppedActiveSyscallState;
    instructionPointer: string;
    stackPointer: string;
    generalPurposeRegisters: Record<string, string>;
    flagsOrPstate: string;
    tlsPointer: string;
    pcMappingId?: string;
  };
  mappings: SameArchStoppedMapping[];
  resources: {
    fds: SameArchStoppedFd[];
    signals: SameArchStoppedSignalState;
    timers: SameArchStoppedTimerState;
    sockets: SameArchStoppedSocketState;
    session: SameArchStoppedSessionState;
  };
  integrity?: {
    capturedAt?: string;
    sourceFreezeEvidence?: string;
    targetPreflightIdentityEvidence?: string;
    noReexecGuardEvidence?: string;
  };
}

export interface SameArchStoppedMapping {
  id: string;
  kind: SameArchStoppedMappingKind;
  start: string;
  end: string;
  permissions: string;
  sha256?: string;
  buildId?: string;
  capturedBytesSha256?: string;
  capturedBytesLength?: number;
}

export interface SameArchStoppedFd {
  fd: number;
  kind: SameArchStoppedFdKind;
  target?: string;
}

export interface SameArchStoppedSignalState {
  pending: string[];
  blocked: string[];
  caughtHandlers: string[];
  activeFrame: boolean;
  alternateStack: "disabled" | "enabled" | "unknown";
}

export interface SameArchStoppedTimerState {
  timers: string[];
  eventLoopState: "none" | "present" | "unknown";
}

export interface SameArchStoppedSocketState {
  sockets: string[];
  activeSessions: string[];
}

export interface SameArchStoppedSessionState {
  controllingTerminal: false | string | "unknown";
  pty: false | string | "unknown";
  processGroup: "default" | "custom" | "unknown";
  jobControl: "none" | "present" | "unknown";
}

export interface SameArchStoppedContinuationCapture {
  primitive: "same-arch-stopped-continuation-v1";
  processIdentity: SameArchStoppedContinuationRequest["process"];
  architecture: Pick<SameArchStoppedContinuationRequest, "sourceArch" | "targetArch"> & {
    abi: "linux-user";
  };
  threadState: SameArchStoppedContinuationRequest["thread"];
  memoryState: {
    verifiedExecutableMappings: SameArchStoppedMapping[];
    privateWritableMappings: SameArchStoppedMapping[];
    stackMapping: SameArchStoppedMapping;
    programCounterMappingId: string;
  };
  resourceState: SameArchStoppedContinuationRequest["resources"];
  integrity: Required<NonNullable<SameArchStoppedContinuationRequest["integrity"]>>;
}

export interface SameArchStoppedContinuationClassification {
  primitive: "same-arch-stopped-continuation-v1";
  state: SameArchStoppedContinuationState;
  capture?: SameArchStoppedContinuationCapture;
  refusals: NativeProcessImageRefusal[];
  productSupport: false;
  nonClaims: readonly string[];
}

export interface SameArchStoppedContinuationResumeRequest {
  classification: SameArchStoppedContinuationClassification;
  target: {
    textIdentityVerified: boolean;
    memoryMaterialized: boolean;
    registersInstalled: boolean;
    noRefusedResourceDuringPreflight: boolean;
    targetPid?: number;
    reexecAttempted?: boolean;
    restartAttempted?: boolean;
    resourceReconstructionAttempted?: boolean;
    marker?: {
      kind: "captured-state-dependent" | "metadata-only" | "fresh-start-equivalent";
      observedValue: string | number | boolean;
      freshRestartWouldProduce: string | number | boolean;
      capturedStateInputs: string[];
    };
  };
}

export interface SameArchStoppedContinuationResumeResult {
  primitive: "same-arch-stopped-continuation-v1";
  state: "ready" | "refused";
  targetPid?: number;
  resumedFromCapturedState: boolean;
  targetProcessStarted: boolean;
  targetProcessKilledOnRefusal: boolean;
  reexecUsed: false;
  restartUsed: false;
  resourceReconstructionUsed: false;
  refusal?: NativeProcessImageRefusal;
}

export function classifySameArchStoppedContinuationCapture(
  request: SameArchStoppedContinuationRequest,
): SameArchStoppedContinuationClassification {
  const refusals = sameArchStoppedContinuationRefusals(request);
  return refusals.length === 0
    ? {
        primitive: "same-arch-stopped-continuation-v1",
        state: "eligible",
        capture: sameArchStoppedContinuationCapture(request),
        refusals,
        productSupport: false,
        nonClaims: sameArchStoppedContinuationNonClaims,
      }
    : {
        primitive: "same-arch-stopped-continuation-v1",
        state: "refused",
        refusals,
        productSupport: false,
        nonClaims: sameArchStoppedContinuationNonClaims,
      };
}

export function materializeSameArchStoppedContinuationTarget(
  request: SameArchStoppedContinuationResumeRequest,
): SameArchStoppedContinuationResumeResult {
  const refusal = sameArchStoppedContinuationResumeRefusal(request);
  if (refusal) {
    return {
      primitive: "same-arch-stopped-continuation-v1",
      state: "refused",
      resumedFromCapturedState: false,
      targetProcessStarted: false,
      targetProcessKilledOnRefusal: request.target.targetPid !== undefined,
      reexecUsed: false,
      restartUsed: false,
      resourceReconstructionUsed: false,
      refusal,
    };
  }
  return {
    primitive: "same-arch-stopped-continuation-v1",
    state: "ready",
    targetPid: request.target.targetPid,
    resumedFromCapturedState: true,
    targetProcessStarted: true,
    targetProcessKilledOnRefusal: false,
    reexecUsed: false,
    restartUsed: false,
    resourceReconstructionUsed: false,
  };
}

export const sameArchStoppedContinuationNonClaims = [
  "no product support until resume proof is recorded",
  "no cross-architecture support",
  "no reexec or restart",
  "no output replay or descriptor-only equivalence",
  "no source-ISA emulation",
  "no source-fd teleportation",
  "no metadata-only success",
  "no broad runtime or arbitrary process restore",
] as const;

function sameArchStoppedContinuationResumeRefusal(
  request: SameArchStoppedContinuationResumeRequest,
): NativeProcessImageRefusal | undefined {
  if (request.classification.state !== "eligible" || !request.classification.capture) {
    return refusal(
      "target-semantic-continuation-missing",
      "eligibleCaptureRequired",
      "target continuation requires an eligible captured live-state bundle",
    );
  }
  if (
    request.target.reexecAttempted ||
    request.target.restartAttempted ||
    request.target.resourceReconstructionAttempted
  ) {
    return refusal(
      "target-semantic-continuation-missing",
      "noReexecRestartReconstruction",
      "target reexec, restart, and resource reconstruction are banned for machinen move",
    );
  }
  if (!request.target.textIdentityVerified) {
    return refusal(
      "target-build-mismatch",
      "textIdentityRequired",
      "target text identity was not verified",
    );
  }
  if (!request.target.memoryMaterialized || !request.target.registersInstalled) {
    return refusal(
      "target-resume-execution-unavailable",
      "targetStateMaterializationRequired",
      "captured memory and registers must be materialized before resume",
    );
  }
  if (!request.target.noRefusedResourceDuringPreflight) {
    return refusal(
      "resource-kind-unsupported",
      "targetPreflightResourceRefusal",
      "target preflight observed an unmodeled resource",
    );
  }
  if (!request.target.targetPid) {
    return refusal(
      "target-resume-execution-unavailable",
      "targetPidRequired",
      "resume target pid is missing",
    );
  }
  return markerRefusal(request);
}

function markerRefusal(
  request: SameArchStoppedContinuationResumeRequest,
): NativeProcessImageRefusal | undefined {
  const marker = request.target.marker;
  if (!marker || marker.kind !== "captured-state-dependent") {
    return refusal(
      "target-semantic-continuation-missing",
      "capturedStateDependentMarkerRequired",
      "continuation success marker must depend on captured live state",
    );
  }
  if (
    marker.capturedStateInputs.length === 0 ||
    marker.observedValue === marker.freshRestartWouldProduce
  ) {
    return refusal(
      "target-semantic-continuation-missing",
      "metadataOnlySuccessRefused",
      "fresh restart or metadata-only success cannot prove continuation",
    );
  }
  return undefined;
}

function sameArchStoppedContinuationRefusals(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal[] {
  return [
    sameArchRefusal(request),
    singleThreadRefusal(request),
    stoppedSafePointRefusal(request),
    activeSyscallRefusal(request),
    textIdentityRefusal(request),
    pcProvenanceRefusal(request),
    memoryRefusal(request),
    mappingRefusal(request),
    nonStdioFdRefusal(request),
    socketRefusal(request),
    timerRefusal(request),
    signalRefusal(request),
    terminalSessionRefusal(request),
  ].filter((refusal): refusal is NativeProcessImageRefusal => refusal !== undefined);
}

function sameArchStoppedContinuationCapture(
  request: SameArchStoppedContinuationRequest,
): SameArchStoppedContinuationCapture {
  const stackMapping = request.mappings.find((mapping) => mapping.kind === "stack");
  return {
    primitive: "same-arch-stopped-continuation-v1",
    processIdentity: request.process,
    architecture: {
      sourceArch: request.sourceArch,
      targetArch: request.targetArch,
      abi: "linux-user",
    },
    threadState: request.thread,
    memoryState: {
      verifiedExecutableMappings: request.mappings.filter((mapping) => mapping.kind === "text"),
      privateWritableMappings: request.mappings.filter(
        (mapping) => mapping.kind === "private-writable",
      ),
      stackMapping: stackMapping!,
      programCounterMappingId: request.thread.pcMappingId!,
    },
    resourceState: request.resources,
    integrity: {
      capturedAt: request.integrity?.capturedAt ?? "unknown",
      sourceFreezeEvidence: request.integrity?.sourceFreezeEvidence ?? "unknown",
      targetPreflightIdentityEvidence:
        request.integrity?.targetPreflightIdentityEvidence ?? "pending-target-preflight",
      noReexecGuardEvidence: request.integrity?.noReexecGuardEvidence ?? "pending-no-reexec-guard",
    },
  };
}

function sameArchRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  return request.sourceArch === request.targetArch
    ? undefined
    : refusal(
        "architecture-pair-unsupported",
        "sameArchRequired",
        "source and target architecture must match",
      );
}

function singleThreadRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  return request.thread.threadCount === 1
    ? undefined
    : refusal("thread-state-unsupported", "singleThreadRequired", "multiple threads are unmodeled");
}

function stoppedSafePointRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  return request.thread.stopState === "ptrace-stopped" ||
    request.thread.stopState === "move-owned-stop"
    ? undefined
    : refusal(
        "target-semantic-continuation-missing",
        "stoppedSafePointRequired",
        "source thread must be stopped at a move-owned safe point",
      );
}

function activeSyscallRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  return request.thread.activeSyscallState === "outside-syscall"
    ? undefined
    : refusal("active-syscall", "noActiveSyscall", "active syscall state is unmodeled");
}

function textIdentityRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  const hasTextIdentity = request.mappings.some(
    (mapping) => mapping.kind === "text" && Boolean(mapping.sha256 ?? mapping.buildId),
  );
  return request.process.executableSha256 &&
    request.process.targetTextIdentityMatches &&
    hasTextIdentity
    ? undefined
    : refusal(
        "target-build-mismatch",
        "textIdentityRequired",
        "target text identity is missing or mismatched",
      );
}

function pcProvenanceRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  return request.thread.pcMappingId &&
    request.mappings.some(
      (mapping) => mapping.id === request.thread.pcMappingId && mapping.kind === "text",
    )
    ? undefined
    : refusal(
        "target-code-location-unresolved",
        "pcProvenanceRequired",
        "program counter must point into verified text mapping",
      );
}

function memoryRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  const stack = request.mappings.find((mapping) => mapping.kind === "stack");
  const uncapturedPrivate = request.mappings.some(
    (mapping) =>
      (mapping.kind === "private-writable" || mapping.kind === "stack") &&
      (!mapping.capturedBytesSha256 || !mapping.capturedBytesLength),
  );
  return stack && !uncapturedPrivate
    ? undefined
    : refusal(
        "target-resume-fault-unmodeled-memory",
        "privateMemoryModeledOnly",
        "private writable mappings and stack bytes must be captured",
      );
}

function mappingRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  const unsupported = request.mappings.find((mapping) =>
    ["shared", "device", "vdso", "vvar", "jit", "ambiguous"].includes(mapping.kind),
  );
  return unsupported
    ? refusal(
        "mapping-shared-unsupported",
        "sharedOrDeviceMappingsRefused",
        `${unsupported.kind} mapping is unmodeled`,
      )
    : undefined;
}

function nonStdioFdRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  const unsupported = request.resources.fds.find(
    (fd) => fd.fd > 2 || !["closed", "dev-null", "move-owned-stdio"].includes(fd.kind),
  );
  return unsupported
    ? refusal("fd-kind-unsupported", "nonStdioFdRefused", `fd ${unsupported.fd} is unmodeled`)
    : undefined;
}

function socketRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  return request.resources.sockets.sockets.length === 0 &&
    request.resources.sockets.activeSessions.length === 0
    ? undefined
    : refusal(
        "target-socket-syscall-state-unsupported",
        "socketStateRefused",
        "socket state and active sessions are unmodeled",
      );
}

function timerRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  return request.resources.timers.timers.length === 0 &&
    request.resources.timers.eventLoopState === "none"
    ? undefined
    : refusal(
        "target-ppoll-timeout-missing",
        "timerStateRefused",
        "timer or event-loop state is unmodeled",
      );
}

function signalRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  const signals = request.resources.signals;
  return signals.pending.length === 0 &&
    signals.blocked.length === 0 &&
    signals.caughtHandlers.length === 0 &&
    !signals.activeFrame &&
    signals.alternateStack === "disabled"
    ? undefined
    : refusal("signal-state-unsupported", "signalStateRefused", "signal state is unmodeled");
}

function terminalSessionRefusal(
  request: SameArchStoppedContinuationRequest,
): NativeProcessImageRefusal | undefined {
  const session = request.resources.session;
  return session.controllingTerminal === false &&
    session.pty === false &&
    session.processGroup === "default" &&
    session.jobControl === "none"
    ? undefined
    : refusal(
        "kernel-state-unsupported",
        "terminalSessionRefused",
        "terminal, process-group, or job-control state is unmodeled",
      );
}

function refusal(
  code: NativeProcessImageRefusal["code"],
  refusalClass: string,
  message: string,
): NativeProcessImageRefusal {
  return {
    code,
    message,
    detail: { boundary: "same-arch-stopped-continuation-capture", refusalClass },
  };
}
