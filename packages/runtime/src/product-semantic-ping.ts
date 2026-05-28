export const PRODUCT_SEMANTIC_PING_FORMAT_VERSION = 1 as const;

export const productSemanticPingRefusalCodes = [
  "semantic-ping-source-target-arch-match",
  "semantic-ping-invalid-counter-state",
  "semantic-ping-unread-receive-queue-unsupported",
  "semantic-ping-active-recvmsg-unsupported",
  "semantic-ping-raw-socket-state-unsupported",
  "semantic-ping-target-verifier-failed",
] as const;
export type ProductSemanticPingRefusalCode = (typeof productSemanticPingRefusalCodes)[number];

export type ProductSemanticPingArchitecture = "arm64" | "amd64";
export type ProductSemanticPingStateDecision =
  | "preserved"
  | "recreated"
  | "drained"
  | "dropped-irrelevant"
  | "logically-restored"
  | "refused";

export interface ProductSemanticPingObservableStateDecision {
  name: string;
  decision: ProductSemanticPingStateDecision;
  rationale: string;
}

export interface ProductSemanticPingDescriptorInput {
  sourceArch: ProductSemanticPingArchitecture;
  targetArch: ProductSemanticPingArchitecture;
  destination: string;
  intervalMs: number;
  identifier: number;
  nextSequence: number;
  sent: number;
  received: number;
  lost: number;
  receiveQueue: "empty" | "unread-replies";
  activeRecvmsg: boolean;
  rawSocketState?: "none" | "present";
  verifierEchoReplies: number;
}

export interface ProductSemanticPingDescriptor {
  kind: "machinen.product-semantic-ping-continuation";
  formatVersion: typeof PRODUCT_SEMANTIC_PING_FORMAT_VERSION;
  supportLevel: "level-2-semantic-continuation";
  profile: "ping-sequence-counter-semantic-continuation-v1";
  source: { architecture: ProductSemanticPingArchitecture };
  target: { architecture: ProductSemanticPingArchitecture };
  workload: {
    command: "ping";
    destination: string;
    intervalMs: number;
  };
  logicalState: {
    identifier: number;
    nextSequence: number;
    sent: number;
    received: number;
    lost: number;
    inFlightPacketPolicy: "drop-and-count-lost";
  };
  observableStateDecisions: ProductSemanticPingObservableStateDecision[];
  gates: {
    receiveQueueEmpty: true;
    activeRecvmsgAbsent: true;
    rawSocketKernelStateAbsent: true;
    targetNativeVerifierRequired: true;
    sourceIsaEmulationAllowed: false;
    sourceTextReplayAllowed: false;
    sidecarRuntimeAllowed: false;
    metadataOnlyContinuationAllowed: false;
  };
}

export interface ProductSemanticPingRestoreSummary {
  kind: "machinen.product-semantic-ping-restore-summary";
  formatVersion: typeof PRODUCT_SEMANTIC_PING_FORMAT_VERSION;
  supportLevel: "level-2-semantic-continuation";
  profile: "ping-sequence-counter-semantic-continuation-v1";
  state: "completed";
  migrationCompleted: true;
  targetVerifierResult: "passed";
  sourceArch: ProductSemanticPingArchitecture;
  targetArch: ProductSemanticPingArchitecture;
  continuedState: {
    identifier: number;
    firstTargetSequence: number;
    sentBeforeRestore: number;
    receivedBeforeRestore: number;
    lostBeforeRestore: number;
    sentAfterVerifier: number;
    receivedAfterVerifier: number;
    lostAfterVerifier: number;
  };
  observableStateDecisions: ProductSemanticPingObservableStateDecision[];
  shortcutInspection: {
    sourceIsaEmulationUsed: false;
    sourceTextReusedAsTargetCode: false;
    sidecarRuntimeUsed: false;
    metadataOnlyShortcutAccepted: false;
  };
}

export interface ProductSemanticPingRefusal {
  kind: "machinen.product-semantic-ping-refusal";
  formatVersion: typeof PRODUCT_SEMANTIC_PING_FORMAT_VERSION;
  supportLevel: "level-2-semantic-continuation";
  profile: "ping-sequence-counter-semantic-continuation-v1";
  state: "refused";
  migrationCompleted: false;
  expectedRefusalCode: ProductSemanticPingRefusalCode;
  message: string;
  observableStateDecisions: ProductSemanticPingObservableStateDecision[];
  evidence: Record<string, unknown>;
}

export type ProductSemanticPingContinuationResult =
  | {
      state: "completed";
      migrationCompleted: true;
      descriptor: ProductSemanticPingDescriptor;
      summary: ProductSemanticPingRestoreSummary;
    }
  | {
      state: "refused";
      migrationCompleted: false;
      refusal: ProductSemanticPingRefusal;
    };

export function createProductSemanticPingContinuation(
  input: ProductSemanticPingDescriptorInput,
): ProductSemanticPingContinuationResult {
  const baseDecisions = semanticPingObservableStateDecisions(input);
  const refusal = semanticPingRefusal(input, baseDecisions);
  if (refusal) {
    return { state: "refused", migrationCompleted: false, refusal };
  }

  if (input.verifierEchoReplies <= 0) {
    return {
      state: "refused",
      migrationCompleted: false,
      refusal: productSemanticPingRefusal(
        "semantic-ping-target-verifier-failed",
        "target-native verifier did not observe any echo replies after restore",
        baseDecisions,
        { verifierEchoReplies: input.verifierEchoReplies },
      ),
    };
  }

  const descriptor: ProductSemanticPingDescriptor = {
    kind: "machinen.product-semantic-ping-continuation",
    formatVersion: PRODUCT_SEMANTIC_PING_FORMAT_VERSION,
    supportLevel: "level-2-semantic-continuation",
    profile: "ping-sequence-counter-semantic-continuation-v1",
    source: { architecture: input.sourceArch },
    target: { architecture: input.targetArch },
    workload: {
      command: "ping",
      destination: input.destination,
      intervalMs: input.intervalMs,
    },
    logicalState: {
      identifier: input.identifier,
      nextSequence: input.nextSequence,
      sent: input.sent,
      received: input.received,
      lost: input.lost,
      inFlightPacketPolicy: "drop-and-count-lost",
    },
    observableStateDecisions: baseDecisions,
    gates: {
      receiveQueueEmpty: true,
      activeRecvmsgAbsent: true,
      rawSocketKernelStateAbsent: true,
      targetNativeVerifierRequired: true,
      sourceIsaEmulationAllowed: false,
      sourceTextReplayAllowed: false,
      sidecarRuntimeAllowed: false,
      metadataOnlyContinuationAllowed: false,
    },
  };
  const summary = verifyProductSemanticPingContinuation(descriptor, input.verifierEchoReplies);
  return { state: "completed", migrationCompleted: true, descriptor, summary };
}

export function verifyProductSemanticPingContinuation(
  descriptor: ProductSemanticPingDescriptor,
  verifierEchoReplies: number,
): ProductSemanticPingRestoreSummary {
  const replies = Math.max(0, Math.trunc(verifierEchoReplies));
  const sentAfterVerifier = descriptor.logicalState.sent + replies;
  const receivedAfterVerifier = descriptor.logicalState.received + replies;
  const targetVerifierResult = replies > 0 ? "passed" : "failed";
  if (targetVerifierResult !== "passed") {
    throw new ProductSemanticPingError(
      "SEMANTIC_PING_TARGET_VERIFIER_FAILED",
      "target-native verifier requires at least one echo reply",
    );
  }
  return {
    kind: "machinen.product-semantic-ping-restore-summary",
    formatVersion: PRODUCT_SEMANTIC_PING_FORMAT_VERSION,
    supportLevel: "level-2-semantic-continuation",
    profile: descriptor.profile,
    state: "completed",
    migrationCompleted: true,
    targetVerifierResult,
    sourceArch: descriptor.source.architecture,
    targetArch: descriptor.target.architecture,
    continuedState: {
      identifier: descriptor.logicalState.identifier,
      firstTargetSequence: descriptor.logicalState.nextSequence,
      sentBeforeRestore: descriptor.logicalState.sent,
      receivedBeforeRestore: descriptor.logicalState.received,
      lostBeforeRestore: descriptor.logicalState.lost,
      sentAfterVerifier,
      receivedAfterVerifier,
      lostAfterVerifier: descriptor.logicalState.lost,
    },
    observableStateDecisions: descriptor.observableStateDecisions,
    shortcutInspection: {
      sourceIsaEmulationUsed: false,
      sourceTextReusedAsTargetCode: false,
      sidecarRuntimeUsed: false,
      metadataOnlyShortcutAccepted: false,
    },
  };
}

// fallow-ignore-next-line complexity
function semanticPingRefusal(
  input: ProductSemanticPingDescriptorInput,
  decisions: ProductSemanticPingObservableStateDecision[],
): ProductSemanticPingRefusal | undefined {
  if (input.sourceArch === input.targetArch) {
    return productSemanticPingRefusal(
      "semantic-ping-source-target-arch-match",
      "semantic ping continuation is a cross-architecture profile; same-architecture vmstate restore should be used instead",
      decisions,
      { sourceArch: input.sourceArch, targetArch: input.targetArch },
    );
  }
  if (
    input.sent < 0 ||
    input.received < 0 ||
    input.lost < 0 ||
    input.nextSequence < 0 ||
    input.received + input.lost > input.sent ||
    input.nextSequence < input.sent
  ) {
    return productSemanticPingRefusal(
      "semantic-ping-invalid-counter-state",
      "ping counters must be non-negative and internally consistent before continuation can be claimed",
      decisions,
      {
        sent: input.sent,
        received: input.received,
        lost: input.lost,
        nextSequence: input.nextSequence,
      },
    );
  }
  if (input.receiveQueue !== "empty") {
    return productSemanticPingRefusal(
      "semantic-ping-unread-receive-queue-unsupported",
      "unread ping replies are ambiguous; this Level 2 profile has no receive-queue model",
      decisions,
      { receiveQueue: input.receiveQueue },
    );
  }
  if (input.activeRecvmsg) {
    return productSemanticPingRefusal(
      "semantic-ping-active-recvmsg-unsupported",
      "active recvmsg state is kernel-private and is not part of the semantic ping descriptor",
      decisions,
      { activeRecvmsg: input.activeRecvmsg },
    );
  }
  if (input.rawSocketState === "present") {
    return productSemanticPingRefusal(
      "semantic-ping-raw-socket-state-unsupported",
      "raw socket options, queues, routes, and credentials require a Level 4 kernel-resource model",
      decisions,
      { rawSocketState: input.rawSocketState },
    );
  }
  return undefined;
}

function semanticPingObservableStateDecisions(
  input: ProductSemanticPingDescriptorInput,
): ProductSemanticPingObservableStateDecision[] {
  const decisions: ProductSemanticPingObservableStateDecision[] = [
    {
      name: "destination",
      decision: "preserved",
      rationale: "the target ping operation uses the same destination string from the descriptor",
    },
    {
      name: "identifier-and-next-sequence",
      decision: "logically-restored",
      rationale:
        "the target starts at the recorded next sequence number rather than replaying source memory",
    },
    {
      name: "sent-received-lost-counters",
      decision: "logically-restored",
      rationale:
        "counters are carried as logical integers and advanced only after target verifier replies",
    },
    {
      name: "source-ping-process-memory",
      decision: "dropped-irrelevant",
      rationale:
        "process memory is outside this Level 2 semantic contract and is not claimed as preserved",
    },
    {
      name: "target-ping-process",
      decision: "recreated",
      rationale: "restore uses target-native ping semantics rather than source-ISA execution",
    },
  ];
  if (input.receiveQueue !== "empty") {
    decisions.push({
      name: "unread-receive-queue",
      decision: "refused",
      rationale: "queued replies could change user-visible counters and are refused until modeled",
    });
  } else {
    decisions.push({
      name: "receive-queue",
      decision: "drained",
      rationale: "the accepted profile requires no unread replies at the boundary",
    });
  }
  if (input.activeRecvmsg) {
    decisions.push({
      name: "active-recvmsg",
      decision: "refused",
      rationale: "in-flight kernel recvmsg state is not represented in the Level 2 descriptor",
    });
  }
  if (input.rawSocketState === "present") {
    decisions.push({
      name: "raw-socket-kernel-state",
      decision: "refused",
      rationale: "kernel-exact socket state is a Level 4 problem and is refused here",
    });
  }
  return decisions;
}

function productSemanticPingRefusal(
  code: ProductSemanticPingRefusalCode,
  message: string,
  observableStateDecisions: ProductSemanticPingObservableStateDecision[],
  evidence: Record<string, unknown>,
): ProductSemanticPingRefusal {
  return {
    kind: "machinen.product-semantic-ping-refusal",
    formatVersion: PRODUCT_SEMANTIC_PING_FORMAT_VERSION,
    supportLevel: "level-2-semantic-continuation",
    profile: "ping-sequence-counter-semantic-continuation-v1",
    state: "refused",
    migrationCompleted: false,
    expectedRefusalCode: code,
    message,
    observableStateDecisions,
    evidence,
  };
}

export class ProductSemanticPingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductSemanticPingError";
  }
}
