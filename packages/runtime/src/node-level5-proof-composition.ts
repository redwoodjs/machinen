export const NODE_LEVEL5_PROOF_COMPOSITION_FORMAT_VERSION = 1 as const;

export const nodeLevel5ProofIngredientNames = [
  "register-translation",
  "stack-return-chain-translation",
  "private-memory-materialization",
  "executable-target-module-materialization",
  "target-restore-loader",
  "level4-event-loop-resource-map",
  "target-native-verifier",
] as const;

export type NodeLevel5ProofIngredientName = (typeof nodeLevel5ProofIngredientNames)[number];

export const nodeLevel5ProofRefusalCodes = [
  "node-level5-tls-rseq-unsupported",
  "node-level5-simd-fpu-unsupported",
  "node-level5-signal-frame-unsupported",
  "node-level5-active-syscall-unsupported",
  "node-level5-active-tcp-unsupported",
  "node-level5-worker-thread-unsupported",
  "node-level5-multithread-unsupported",
  "node-level5-memory-mapping-unsupported",
  "node-level5-kernel-resource-unsupported",
  "node-level5-native-addon-abi-unsupported",
  "node-level5-inspector-unsupported",
  "node-level5-v8-libuv-state-unsupported",
  "node-level5-arbitrary-heap-stack-continuation-refused",
] as const;

export type NodeLevel5ProofRefusalCode = (typeof nodeLevel5ProofRefusalCodes)[number];

export interface NodeLevel5ProofIngredient {
  name: NodeLevel5ProofIngredientName;
  evidenceStatus: "checked" | "proof" | "missing";
  checkedSummary?: string;
  notes: string;
}

export interface NodeLevel5ProofCompositionInput {
  eventLoopResourceMapPresent: boolean;
  targetNativeVerifierPresent: boolean;
  checkedSummaries?: Partial<Record<NodeLevel5ProofIngredientName, string>>;
  targetProof?: NodeLevel5TargetProofEvidence;
}

export interface NodeLevel5TargetProofEvidence {
  path: string;
  status: "passed" | "missing" | "failed" | "not-run";
  kind?: "machinen.node-level5-target-side-continuation-proof";
  noSourceIsaEmulation: boolean;
  noSidecarOutput: boolean;
  noMetadataOnlySuccess: boolean;
  targetVerifierObservedActualNodeContinuation: boolean;
  message: string;
}

export interface NodeLevel5ProofCompositionRefusal {
  code: NodeLevel5ProofRefusalCode;
  message: string;
  migrationCompleted: false;
  productSupport: "unsupported";
  implementationLevel: "level-0-fail-closed-discovery";
  evidenceStatus: "refusal";
}

export interface NodeLevel5ProofEvidenceCheck {
  name: NodeLevel5ProofIngredientName;
  path: string;
  requiredFragments: string[];
  status: "passed" | "missing" | "failed";
  message: string;
}

export interface NodeLevel5ProofRefusalMatrixRow extends NodeLevel5ProofCompositionRefusal {
  unsafeNeighbor:
    | "tls-rseq"
    | "simd-fpu"
    | "active-signals"
    | "active-syscalls"
    | "active-tcp"
    | "worker-threads"
    | "multithread"
    | "unsupported-memory-mappings"
    | "unsupported-kernel-resources"
    | "native-addon-abi"
    | "inspector-debug"
    | "unsupported-v8-libuv-state"
    | "arbitrary-heap-stack-continuation";
}

export interface NodeLevel5ProofComposition {
  kind: "machinen.node-level5-proof-composition";
  formatVersion: typeof NODE_LEVEL5_PROOF_COMPOSITION_FORMAT_VERSION;
  sourceGoal: "009";
  evidenceStatus: "proof";
  productSupport: "not-yet-supported";
  implementationLevel: "not-implemented";
  graduationTargetLevel: "level-5-cross-arch-process-continuation";
  selectedSubset: "node-http-clean-root-v1-with-level4-event-loop-map";
  requiredIngredients: NodeLevel5ProofIngredient[];
  evidenceChecks?: NodeLevel5ProofEvidenceCheck[];
  targetProof?: NodeLevel5TargetProofEvidence;
  proofRunner?: "scripts/node-level5-proof-composition.ts";
  refusals: NodeLevel5ProofCompositionRefusal[];
  refusalMatrix: NodeLevel5ProofRefusalMatrixRow[];
  gates: {
    arbitraryV8HeapContinuationAllowed: false;
    arbitraryNativeStackContinuationAllowed: false;
    sourceIsaEmulationAllowed: false;
    sidecarRuntimeAllowed: false;
    metadataOnlyContinuationAllowed: false;
    publicProductVerbRequiredBeforeSupport: true;
  };
  summary: {
    required: number;
    present: number;
    missing: number;
    refusalCount: number;
    proofReady: boolean;
  };
}

export function buildNodeLevel5ProofComposition(
  input: NodeLevel5ProofCompositionInput & {
    evidenceChecks?: NodeLevel5ProofEvidenceCheck[];
    proofRunner?: "scripts/node-level5-proof-composition.ts";
  },
): NodeLevel5ProofComposition {
  const requiredIngredients = nodeLevel5ProofIngredientNames.map((name) =>
    nodeLevel5ProofIngredient(name, input),
  );
  const present = requiredIngredients.filter(
    (ingredient) => ingredient.evidenceStatus !== "missing",
  );
  const refusalMatrix = nodeLevel5ProofRefusalCodes.map(nodeLevel5ProofRefusalMatrixRow);
  const refusals = refusalMatrix.map(({ unsafeNeighbor: _unsafeNeighbor, ...refusal }) => refusal);
  return {
    kind: "machinen.node-level5-proof-composition",
    formatVersion: NODE_LEVEL5_PROOF_COMPOSITION_FORMAT_VERSION,
    sourceGoal: "009",
    evidenceStatus: "proof",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    selectedSubset: "node-http-clean-root-v1-with-level4-event-loop-map",
    requiredIngredients,
    ...(input.evidenceChecks ? { evidenceChecks: input.evidenceChecks } : {}),
    ...(input.targetProof ? { targetProof: input.targetProof } : {}),
    ...(input.proofRunner ? { proofRunner: input.proofRunner } : {}),
    refusals,
    refusalMatrix,
    gates: {
      arbitraryV8HeapContinuationAllowed: false,
      arbitraryNativeStackContinuationAllowed: false,
      sourceIsaEmulationAllowed: false,
      sidecarRuntimeAllowed: false,
      metadataOnlyContinuationAllowed: false,
      publicProductVerbRequiredBeforeSupport: true,
    },
    summary: {
      required: requiredIngredients.length,
      present: present.length,
      missing: requiredIngredients.length - present.length,
      refusalCount: refusals.length,
      proofReady:
        present.length === requiredIngredients.length &&
        (input.targetProof === undefined || input.targetProof.status === "passed"),
    },
  };
}

function nodeLevel5ProofIngredient(
  name: NodeLevel5ProofIngredientName,
  input: NodeLevel5ProofCompositionInput,
): NodeLevel5ProofIngredient {
  const checkedSummary = input.checkedSummaries?.[name] ?? defaultCheckedSummary(name);
  const eventLoopMapMissing =
    name === "level4-event-loop-resource-map" && !input.eventLoopResourceMapPresent;
  const verifierMissing = name === "target-native-verifier" && !input.targetNativeVerifierPresent;
  const evidenceStatus = eventLoopMapMissing || verifierMissing ? "missing" : "checked";
  return {
    name,
    evidenceStatus,
    ...(evidenceStatus === "missing" ? {} : { checkedSummary }),
    notes: ingredientNotes(name),
  };
}

function nodeLevel5ProofRefusalMatrixRow(
  code: NodeLevel5ProofRefusalCode,
): NodeLevel5ProofRefusalMatrixRow {
  return {
    code,
    unsafeNeighbor: nodeLevel5ProofUnsafeNeighbor(code),
    message: nodeLevel5ProofRefusalMessage(code),
    migrationCompleted: false,
    productSupport: "unsupported",
    implementationLevel: "level-0-fail-closed-discovery",
    evidenceStatus: "refusal",
  };
}

function defaultCheckedSummary(name: NodeLevel5ProofIngredientName): string {
  switch (name) {
    case "register-translation":
      return "docs/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json";
    case "stack-return-chain-translation":
      return "docs/snapshot/native-process-continuation-audit.md";
    case "private-memory-materialization":
      return "docs/snapshot/architecture-portable-snapshot-gauntlet.md";
    case "executable-target-module-materialization":
      return "docs/snapshot/architecture-portable-snapshot-gauntlet.md";
    case "target-restore-loader":
      return "scripts/native-restore-loader.mjs";
    case "level4-event-loop-resource-map":
      return "docs/snapshot/checked-summaries/level4-graduation/goal-008-node-event-loop-resource-map.json";
    case "target-native-verifier":
      return "docs/snapshot/checked-summaries/level4-graduation/goal-008-node-event-loop-resource-map.json";
  }
}

function ingredientNotes(name: NodeLevel5ProofIngredientName): string {
  switch (name) {
    case "register-translation":
      return "native register state must be translated into the target architecture ABI";
    case "stack-return-chain-translation":
      return "selected stack and return-chain frames must be rewritten, not replayed as source ISA";
    case "private-memory-materialization":
      return "private memory bytes are materialized in target process memory without accepting arbitrary V8 heap continuation as product support";
    case "executable-target-module-materialization":
      return "target executable/module mappings come from target-native artifacts";
    case "target-restore-loader":
      return "the loader enters target-native continuation and is not a sidecar output shortcut";
    case "level4-event-loop-resource-map":
      return "Node/libuv resources compose through the generic Level 4 resource map from Goal 008";
    case "target-native-verifier":
      return "verifier evidence must come from target-side process continuation";
  }
}

const nodeLevel5ProofUnsafeNeighbors: Record<
  NodeLevel5ProofRefusalCode,
  NodeLevel5ProofRefusalMatrixRow["unsafeNeighbor"]
> = {
  "node-level5-tls-rseq-unsupported": "tls-rseq",
  "node-level5-simd-fpu-unsupported": "simd-fpu",
  "node-level5-signal-frame-unsupported": "active-signals",
  "node-level5-active-syscall-unsupported": "active-syscalls",
  "node-level5-active-tcp-unsupported": "active-tcp",
  "node-level5-worker-thread-unsupported": "worker-threads",
  "node-level5-multithread-unsupported": "multithread",
  "node-level5-memory-mapping-unsupported": "unsupported-memory-mappings",
  "node-level5-kernel-resource-unsupported": "unsupported-kernel-resources",
  "node-level5-native-addon-abi-unsupported": "native-addon-abi",
  "node-level5-inspector-unsupported": "inspector-debug",
  "node-level5-v8-libuv-state-unsupported": "unsupported-v8-libuv-state",
  "node-level5-arbitrary-heap-stack-continuation-refused": "arbitrary-heap-stack-continuation",
};

function nodeLevel5ProofUnsafeNeighbor(
  code: NodeLevel5ProofRefusalCode,
): NodeLevel5ProofRefusalMatrixRow["unsafeNeighbor"] {
  return nodeLevel5ProofUnsafeNeighbors[code];
}

const nodeLevel5ProofRefusalMessages: Record<NodeLevel5ProofRefusalCode, string> = {
  "node-level5-tls-rseq-unsupported":
    "TLS and rseq state are refused until modeled for the selected Node Level 5 subset",
  "node-level5-simd-fpu-unsupported":
    "SIMD and FPU state are refused until target translation is checked",
  "node-level5-signal-frame-unsupported":
    "active signal frames and pending signal queues are refused",
  "node-level5-active-syscall-unsupported": "active syscalls and restart blocks are refused",
  "node-level5-active-tcp-unsupported": "active TCP streams and in-flight network I/O are refused",
  "node-level5-worker-thread-unsupported":
    "Node worker threads are refused until worker lifecycle and thread state are modeled",
  "node-level5-multithread-unsupported":
    "multi-thread Node state is refused for this selected proof subset",
  "node-level5-memory-mapping-unsupported": "unsupported memory mappings are refused",
  "node-level5-kernel-resource-unsupported": "kernel resources outside the Level 4 map are refused",
  "node-level5-native-addon-abi-unsupported":
    "native addon ABI and hidden native state are refused",
  "node-level5-inspector-unsupported": "inspector and debug state are refused",
  "node-level5-v8-libuv-state-unsupported": "unsupported V8 or libuv state is refused",
  "node-level5-arbitrary-heap-stack-continuation-refused":
    "arbitrary V8 heap and native stack continuation is not product support",
};

function nodeLevel5ProofRefusalMessage(code: NodeLevel5ProofRefusalCode): string {
  return nodeLevel5ProofRefusalMessages[code];
}
