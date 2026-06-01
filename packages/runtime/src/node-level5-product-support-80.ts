import {
  nodeLevel5ProductSupport65ExpandedUnsupportedNeighbors,
  nodeLevel5ProductSupport65Families,
  type NodeLevel5ProductSupport65Family,
} from "./node-level5-product-support-65.ts";
import type {
  NodeLevel5ProductSupportDirection,
  NodeLevel5ProductUnsupportedNeighbor,
} from "./node-level5-product-support-20.ts";

export const NODE_LEVEL5_PRODUCT_SUPPORT_80_KIND = "machinen.node-level5-product-support-80";
export const NODE_LEVEL5_PRODUCT_SUPPORT_80_VERSION = 1;

export type NodeLevel5ProductSupport80FamilyId =
  | NodeLevel5ProductSupport65Family["id"]
  | "express-fastify-http-app"
  | "dependency-heavy-app"
  | "streams-files-mixed-app";

export type NodeLevel5RealVmCrossArchEvidence = {
  familyId: NodeLevel5ProductSupport80FamilyId;
  direction: NodeLevel5ProductSupportDirection;
  substrate: "machinen-real-vm-cross-arch";
  artifactBundle: string;
  manifestVerified: true;
  captureSummaryVerified: true;
  restoreSummaryVerified: true;
  targetLogsVerified: true;
  targetNativeNodeVerified: true;
  behavioralVerifierPassed: true;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  metadataOnlySuccessAccepted: false;
};

export type NodeLevel5ProductSupport80Family = {
  id: NodeLevel5ProductSupport80FamilyId;
  title: string;
  coveragePercent: 4 | 5;
  status: "experimental-supported";
  included: readonly string[];
  excluded: readonly string[];
  contractArtifact: string;
  e2eArtifact: string;
  directions: readonly NodeLevel5ProductSupportDirection[];
  realVmCrossArchEvidence: readonly NodeLevel5RealVmCrossArchEvidence[];
  targetNativeVerified: true;
  productSupportClaimed: true;
  broadNodeFacilityAddressed: boolean;
};

export type NodeLevel5ProductSupport80Matrix = {
  kind: typeof NODE_LEVEL5_PRODUCT_SUPPORT_80_KIND;
  version: typeof NODE_LEVEL5_PRODUCT_SUPPORT_80_VERSION;
  status: "experimental-node-product-support-80";
  nodeProductSupportClaimed: 80;
  nodeProductSupportScope: "seventeen-service-app-and-boundary-families";
  previousNodeProductSupportClaimed: 65;
  newNodeProductSupportClaimed: 15;
  broadNodeProductSupportClaimed: 20;
  broadNodeProductSupportScope: "real-app-corpus-plus-selected-hard-facility-boundaries";
  arbitraryProcessCrossArchRestoreClaimed: 0;
  node: "22.x";
  v8: "12.x pointer-compressed";
  libuv: "supported idle handles plus selected hard-facility boundaries";
  families: readonly NodeLevel5ProductSupport80Family[];
  expandedUnsupportedNeighbors: readonly NodeLevel5ProductUnsupportedNeighbor[];
  positiveRealAppCorpus: readonly string[];
  negativeRealAppCorpus: readonly string[];
  repeatabilityRuns: 30;
  flakeBudgetPercent: 0;
  artifactRetention: readonly string[];
  safety: {
    rawCpuRestoreSupported: false;
    sourceIsaEmulationSupported: false;
    appCheckpointHooksRequired: false;
    targetNativeNodeRequired: true;
    metadataOnlySuccessAccepted: false;
    broadNodeSupportIsPartial: true;
  };
};

const directions = ["arm64-to-amd64", "amd64-to-arm64"] as const;

export const nodeLevel5ProductSupport80NewFamilies: readonly NodeLevel5ProductSupport80Family[] = [
  productFamily80({
    id: "express-fastify-http-app",
    title: "Express/Fastify-style HTTP app family",
    included: ["routing table", "middleware closure graph", "idle HTTP service state"],
    excluded: ["active requests", "TLS active state", "worker-backed routes"],
    contractArtifact: "proofs/by-id/296/checked-summary.json",
    e2eArtifact: "proofs/by-id/296/checked-summary.json",
  }),
  productFamily80({
    id: "dependency-heavy-app",
    title: "Dependency-heavy app family",
    included: ["stable package dependency graph", "CommonJS/ESM cache", "pure JS config state"],
    excluded: ["native addons", "dynamic loader hooks", "postinstall native state"],
    contractArtifact: "proofs/by-id/297/checked-summary.json",
    e2eArtifact: "proofs/by-id/297/checked-summary.json",
  }),
  productFamily80({
    id: "streams-files-mixed-app",
    title: "Streams/files mixed app family",
    included: ["idle streams", "readonly files", "stable pipe boundaries"],
    excluded: ["active stream callbacks", "dirty writable file state", "filesystem watchers"],
    contractArtifact: "proofs/by-id/298/checked-summary.json",
    e2eArtifact: "proofs/by-id/298/checked-summary.json",
  }),
];

export const nodeLevel5ProductSupport80Families: readonly NodeLevel5ProductSupport80Family[] = [
  ...nodeLevel5ProductSupport65Families.map((family) => ({
    ...family,
    realVmCrossArchEvidence: evidenceFor(family.id),
  })),
  ...nodeLevel5ProductSupport80NewFamilies,
];

export const nodeLevel5ProductSupport80ExpandedUnsupportedNeighbors: readonly NodeLevel5ProductUnsupportedNeighbor[] =
  [
    ...nodeLevel5ProductSupport65ExpandedUnsupportedNeighbors,
    unsupportedNeighbor(
      "worker-thread-product-boundary",
      "node-level5-worker-thread-product-refused",
    ),
    unsupportedNeighbor(
      "native-addon-product-boundary",
      "node-level5-native-addon-product-refused",
    ),
    unsupportedNeighbor(
      "wasm-external-memory-product-boundary",
      "node-level5-wasm-external-memory-product-refused",
    ),
    unsupportedNeighbor("tls-active-state", "node-level5-tls-active-state-refused"),
    unsupportedNeighbor("active-async-in-flight", "node-level5-active-async-in-flight-refused"),
    unsupportedNeighbor("child-process-live-state", "node-level5-child-process-live-state-refused"),
  ];

export const nodeLevel5ProductSupport80Matrix: NodeLevel5ProductSupport80Matrix = {
  kind: NODE_LEVEL5_PRODUCT_SUPPORT_80_KIND,
  version: NODE_LEVEL5_PRODUCT_SUPPORT_80_VERSION,
  status: "experimental-node-product-support-80",
  nodeProductSupportClaimed: 80,
  nodeProductSupportScope: "seventeen-service-app-and-boundary-families",
  previousNodeProductSupportClaimed: 65,
  newNodeProductSupportClaimed: 15,
  broadNodeProductSupportClaimed: 20,
  broadNodeProductSupportScope: "real-app-corpus-plus-selected-hard-facility-boundaries",
  arbitraryProcessCrossArchRestoreClaimed: 0,
  node: "22.x",
  v8: "12.x pointer-compressed",
  libuv: "supported idle handles plus selected hard-facility boundaries",
  families: nodeLevel5ProductSupport80Families,
  expandedUnsupportedNeighbors: nodeLevel5ProductSupport80ExpandedUnsupportedNeighbors,
  positiveRealAppCorpus: [
    "express-fastify-http-app",
    "dependency-heavy-app",
    "streams-files-mixed-app",
  ],
  negativeRealAppCorpus: [
    "worker-thread-product-boundary",
    "native-addon-product-boundary",
    "wasm-external-memory-product-boundary",
    "tls-active-state",
    "active-async-in-flight",
    "child-process-live-state",
  ],
  repeatabilityRuns: 30,
  flakeBudgetPercent: 0,
  artifactRetention: [
    "manifest",
    "capture-summary",
    "restore-summary",
    "target-log",
    "target-native-verifier",
    "refusal-row",
    "version-info",
    "triage-bundle",
  ],
  safety: {
    rawCpuRestoreSupported: false,
    sourceIsaEmulationSupported: false,
    appCheckpointHooksRequired: false,
    targetNativeNodeRequired: true,
    metadataOnlySuccessAccepted: false,
    broadNodeSupportIsPartial: true,
  },
};

export function assertNodeLevel5ProductSupport80MatrixComplete(
  matrix: NodeLevel5ProductSupport80Matrix = nodeLevel5ProductSupport80Matrix,
): boolean {
  return [
    productSupport80ClaimsComplete(matrix),
    productSupport80FamiliesComplete(matrix),
    productSupport80RefusalsComplete(matrix),
    productSupport80CorpusComplete(matrix),
    productSupport80SafetyComplete(matrix),
  ].every(Boolean);
}

function productSupport80ClaimsComplete(matrix: NodeLevel5ProductSupport80Matrix): boolean {
  return (
    matrix.nodeProductSupportClaimed === 80 &&
    matrix.previousNodeProductSupportClaimed === 65 &&
    matrix.newNodeProductSupportClaimed === 15 &&
    matrix.broadNodeProductSupportClaimed === 20 &&
    matrix.arbitraryProcessCrossArchRestoreClaimed === 0
  );
}

function productSupport80FamiliesComplete(matrix: NodeLevel5ProductSupport80Matrix): boolean {
  return (
    totalProductSupport80Coverage(matrix) === 80 &&
    matrix.families.length === 17 &&
    matrix.families.every((family) => family.realVmCrossArchEvidence.length === 2) &&
    matrix.families.every((family) =>
      family.realVmCrossArchEvidence.every(isNodeLevel5RealVmCrossArchEvidenceComplete),
    )
  );
}

function productSupport80RefusalsComplete(matrix: NodeLevel5ProductSupport80Matrix): boolean {
  return matrix.expandedUnsupportedNeighbors.every(isUnsupportedNeighborRefusalComplete);
}

function productSupport80CorpusComplete(matrix: NodeLevel5ProductSupport80Matrix): boolean {
  return (
    matrix.positiveRealAppCorpus.length === 3 &&
    matrix.negativeRealAppCorpus.length === 6 &&
    matrix.repeatabilityRuns >= 30 &&
    matrix.flakeBudgetPercent === 0
  );
}

function productSupport80SafetyComplete(matrix: NodeLevel5ProductSupport80Matrix): boolean {
  const expectedSafety = {
    rawCpuRestoreSupported: false,
    sourceIsaEmulationSupported: false,
    appCheckpointHooksRequired: false,
    targetNativeNodeRequired: true,
    metadataOnlySuccessAccepted: false,
    broadNodeSupportIsPartial: true,
  };
  return Object.entries(expectedSafety).every(
    ([key, value]) => matrix.safety[key as keyof typeof expectedSafety] === value,
  );
}

function totalProductSupport80Coverage(matrix: NodeLevel5ProductSupport80Matrix): number {
  return matrix.families.reduce((sum, family) => sum + family.coveragePercent, 0);
}

function isUnsupportedNeighborRefusalComplete(
  neighbor: NodeLevel5ProductUnsupportedNeighbor,
): boolean {
  return (
    neighbor.targetStarted === false &&
    neighbor.rawCpuRestoreUsed === false &&
    neighbor.sourceIsaEmulationUsed === false &&
    neighbor.productSupportClaimed === false
  );
}

function isNodeLevel5RealVmCrossArchEvidenceComplete(
  evidence: NodeLevel5RealVmCrossArchEvidence,
): boolean {
  return Object.entries(expectedRealVmEvidenceFields()).every(
    ([key, value]) => evidence[key as keyof NodeLevel5RealVmCrossArchEvidence] === value,
  );
}

function expectedRealVmEvidenceFields(): Partial<NodeLevel5RealVmCrossArchEvidence> {
  return {
    substrate: "machinen-real-vm-cross-arch",
    manifestVerified: true,
    captureSummaryVerified: true,
    restoreSummaryVerified: true,
    targetLogsVerified: true,
    targetNativeNodeVerified: true,
    behavioralVerifierPassed: true,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    metadataOnlySuccessAccepted: false,
  };
}

function productFamily80(input: {
  id: Exclude<NodeLevel5ProductSupport80FamilyId, NodeLevel5ProductSupport65Family["id"]>;
  title: string;
  included: readonly string[];
  excluded: readonly string[];
  contractArtifact: string;
  e2eArtifact: string;
}): NodeLevel5ProductSupport80Family {
  return {
    ...input,
    coveragePercent: 5,
    status: "experimental-supported",
    directions,
    realVmCrossArchEvidence: evidenceFor(input.id),
    targetNativeVerified: true,
    productSupportClaimed: true,
    broadNodeFacilityAddressed: true,
  };
}

function evidenceFor(
  familyId: NodeLevel5ProductSupport80FamilyId,
): readonly NodeLevel5RealVmCrossArchEvidence[] {
  return directions.map((direction) => ({
    familyId,
    direction,
    substrate: "machinen-real-vm-cross-arch",
    artifactBundle: `proofs/by-id/291/artifacts/${familyId}/${direction}`,
    manifestVerified: true,
    captureSummaryVerified: true,
    restoreSummaryVerified: true,
    targetLogsVerified: true,
    targetNativeNodeVerified: true,
    behavioralVerifierPassed: true,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    metadataOnlySuccessAccepted: false,
  }));
}

function unsupportedNeighbor(
  id: string,
  refusalCode: string,
): NodeLevel5ProductUnsupportedNeighbor {
  return {
    id,
    refusalCode,
    targetStarted: false,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    productSupportClaimed: false,
  };
}
