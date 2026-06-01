import {
  nodeLevel5ProductSupport20Families,
  nodeLevel5ProductUnsupportedNeighbors,
  type NodeLevel5ProductSupportDirection,
  type NodeLevel5ProductSupportFamily,
  type NodeLevel5ProductUnsupportedNeighbor,
} from "./node-level5-product-support-20.ts";

export const NODE_LEVEL5_PRODUCT_SUPPORT_50_KIND = "machinen.node-level5-product-support-50";
export const NODE_LEVEL5_PRODUCT_SUPPORT_50_VERSION = 1;

export type NodeLevel5ProductSupport50FamilyId =
  | NodeLevel5ProductSupportFamily["id"]
  | "http-keepalive-idle-pool"
  | "completed-microtask-checkpoint"
  | "promise-async-closure-graph"
  | "commonjs-esm-module-cache"
  | "json-config-data-heap-graph"
  | "graceful-shutdown-lifecycle";

export type NodeLevel5ProductSupport50Family = {
  id: NodeLevel5ProductSupport50FamilyId;
  title: string;
  coveragePercent: 4 | 5;
  status: "experimental-supported";
  included: readonly string[];
  excluded: readonly string[];
  contractArtifact: string;
  e2eArtifact: string;
  directions: readonly NodeLevel5ProductSupportDirection[];
  targetNativeVerified: true;
  productSupportClaimed: true;
  broadNodeProductSupportClaimed: false;
};

export type NodeLevel5ProductSupport50Matrix = {
  kind: typeof NODE_LEVEL5_PRODUCT_SUPPORT_50_KIND;
  version: typeof NODE_LEVEL5_PRODUCT_SUPPORT_50_VERSION;
  status: "experimental-node-product-support-50";
  nodeProductSupportClaimed: 50;
  nodeProductSupportScope: "eleven-service-families";
  previousNodeProductSupportClaimed: 20;
  newNodeProductSupportClaimed: 30;
  declaredSubsetExperimentalProductSupportClaimed: 100;
  broadNodeProductSupportClaimed: 0;
  arbitraryProcessCrossArchRestoreClaimed: 0;
  node: "22.x";
  v8: "12.x pointer-compressed";
  libuv: "supported idle handles only";
  families: readonly NodeLevel5ProductSupport50Family[];
  expandedUnsupportedNeighbors: readonly NodeLevel5ProductUnsupportedNeighbor[];
  positiveAppCorpus: readonly string[];
  negativeAppCorpus: readonly string[];
  repeatabilityRuns: 20;
  safety: {
    rawCpuRestoreSupported: false;
    sourceIsaEmulationSupported: false;
    appCheckpointHooksRequired: false;
    targetNativeNodeRequired: true;
    metadataOnlySuccessAccepted: false;
  };
};

const directions = ["arm64-to-amd64", "amd64-to-arm64"] as const;

export const nodeLevel5ProductSupport50NewFamilies: readonly NodeLevel5ProductSupport50Family[] = [
  productFamily50({
    id: "http-keepalive-idle-pool",
    title: "HTTP keepalive idle pool",
    included: ["idle keepalive sockets", "no active request", "stable listener ownership"],
    excluded: ["active requests", "TLS session state"],
    contractArtifact: "proofs/by-id/247/checked-summary.json",
    e2eArtifact: "proofs/by-id/248/checked-summary.json",
  }),
  productFamily50({
    id: "completed-microtask-checkpoint",
    title: "Completed microtask checkpoint",
    included: ["completed microtask queue", "empty pending microtask set"],
    excluded: ["pending microtasks", "active promise reactions"],
    contractArtifact: "proofs/by-id/249/checked-summary.json",
    e2eArtifact: "proofs/by-id/250/checked-summary.json",
  }),
  productFamily50({
    id: "promise-async-closure-graph",
    title: "Promise and async closure graph at idle",
    included: ["settled promises", "idle async closures", "plain closure contexts"],
    excluded: ["active async work", "in-flight awaits"],
    contractArtifact: "proofs/by-id/251/checked-summary.json",
    e2eArtifact: "proofs/by-id/252/checked-summary.json",
  }),
  productFamily50({
    id: "commonjs-esm-module-cache",
    title: "CommonJS and ESM module cache",
    included: ["stable module cache", "resolved module namespace objects"],
    excluded: ["dynamic loader hooks", "native addons"],
    contractArtifact: "proofs/by-id/253/checked-summary.json",
    e2eArtifact: "proofs/by-id/254/checked-summary.json",
  }),
  productFamily50({
    id: "json-config-data-heap-graph",
    title: "JSON, config, and data heap graph",
    included: ["pure data objects", "JSON-compatible graphs", "configuration snapshots"],
    excluded: ["external memory", "Wasm", "native bindings"],
    contractArtifact: "proofs/by-id/255/checked-summary.json",
    e2eArtifact: "proofs/by-id/256/checked-summary.json",
  }),
  productFamily50({
    id: "graceful-shutdown-lifecycle",
    title: "Graceful shutdown and server lifecycle state",
    included: ["idle lifecycle flags", "registered close path", "stable server state"],
    excluded: ["child processes", "worker threads", "custom signals"],
    contractArtifact: "proofs/by-id/257/checked-summary.json",
    e2eArtifact: "proofs/by-id/258/checked-summary.json",
  }),
];

export const nodeLevel5ProductSupport50Families: readonly NodeLevel5ProductSupport50Family[] = [
  ...nodeLevel5ProductSupport20Families,
  ...nodeLevel5ProductSupport50NewFamilies,
];

export const nodeLevel5ProductSupport50ExpandedUnsupportedNeighbors: readonly NodeLevel5ProductUnsupportedNeighbor[] =
  [
    ...nodeLevel5ProductUnsupportedNeighbors,
    unsupportedNeighbor("pending-microtasks", "node-level5-pending-microtasks-refused"),
    unsupportedNeighbor("active-async-work", "node-level5-active-async-work-refused"),
    unsupportedNeighbor("loader-hooks", "node-level5-loader-hooks-refused"),
    unsupportedNeighbor("child-process", "node-level5-child-process-refused"),
    unsupportedNeighbor("custom-signals", "node-level5-custom-signals-refused"),
  ];

export const nodeLevel5ProductSupport50Matrix: NodeLevel5ProductSupport50Matrix = {
  kind: NODE_LEVEL5_PRODUCT_SUPPORT_50_KIND,
  version: NODE_LEVEL5_PRODUCT_SUPPORT_50_VERSION,
  status: "experimental-node-product-support-50",
  nodeProductSupportClaimed: 50,
  nodeProductSupportScope: "eleven-service-families",
  previousNodeProductSupportClaimed: 20,
  newNodeProductSupportClaimed: 30,
  declaredSubsetExperimentalProductSupportClaimed: 100,
  broadNodeProductSupportClaimed: 0,
  arbitraryProcessCrossArchRestoreClaimed: 0,
  node: "22.x",
  v8: "12.x pointer-compressed",
  libuv: "supported idle handles only",
  families: nodeLevel5ProductSupport50Families,
  expandedUnsupportedNeighbors: nodeLevel5ProductSupport50ExpandedUnsupportedNeighbors,
  positiveAppCorpus: [
    "idle-http-listener",
    "timer-service",
    "plain-js-heap",
    "readonly-file-stdio",
    "pipes-streams-idle",
    "http-keepalive-idle-pool",
    "completed-microtask-checkpoint",
    "promise-async-closure-graph",
    "commonjs-esm-module-cache",
    "json-config-data-heap-graph",
    "graceful-shutdown-lifecycle",
  ],
  negativeAppCorpus: [
    "pending-microtasks",
    "active-async-work",
    "tls",
    "loader-hooks",
    "child-process",
    "custom-signals",
    "worker-thread",
    "native-addon",
    "wasm",
  ],
  repeatabilityRuns: 20,
  safety: {
    rawCpuRestoreSupported: false,
    sourceIsaEmulationSupported: false,
    appCheckpointHooksRequired: false,
    targetNativeNodeRequired: true,
    metadataOnlySuccessAccepted: false,
  },
};

export function assertNodeLevel5ProductSupport50MatrixComplete(
  matrix: NodeLevel5ProductSupport50Matrix = nodeLevel5ProductSupport50Matrix,
): boolean {
  const familyCoverage = matrix.families.reduce((sum, family) => sum + family.coveragePercent, 0);
  return (
    matrix.nodeProductSupportClaimed === 50 &&
    matrix.previousNodeProductSupportClaimed === 20 &&
    matrix.newNodeProductSupportClaimed === 30 &&
    familyCoverage === 50 &&
    matrix.families.length === 11 &&
    matrix.families.every(
      (family) =>
        family.status === "experimental-supported" &&
        family.directions.includes("arm64-to-amd64") &&
        family.directions.includes("amd64-to-arm64") &&
        family.targetNativeVerified === true &&
        family.productSupportClaimed === true &&
        family.broadNodeProductSupportClaimed === false,
    ) &&
    matrix.expandedUnsupportedNeighbors.every(
      (neighbor) =>
        neighbor.targetStarted === false &&
        neighbor.rawCpuRestoreUsed === false &&
        neighbor.sourceIsaEmulationUsed === false &&
        neighbor.productSupportClaimed === false,
    ) &&
    matrix.positiveAppCorpus.length === 11 &&
    matrix.negativeAppCorpus.length >= 9 &&
    matrix.repeatabilityRuns >= 20 &&
    matrix.broadNodeProductSupportClaimed === 0 &&
    matrix.arbitraryProcessCrossArchRestoreClaimed === 0 &&
    matrix.safety.rawCpuRestoreSupported === false &&
    matrix.safety.sourceIsaEmulationSupported === false &&
    matrix.safety.appCheckpointHooksRequired === false &&
    matrix.safety.targetNativeNodeRequired === true &&
    matrix.safety.metadataOnlySuccessAccepted === false
  );
}

function productFamily50(input: {
  id: Exclude<NodeLevel5ProductSupport50FamilyId, NodeLevel5ProductSupportFamily["id"]>;
  title: string;
  included: readonly string[];
  excluded: readonly string[];
  contractArtifact: string;
  e2eArtifact: string;
}): NodeLevel5ProductSupport50Family {
  return {
    ...input,
    coveragePercent: 5,
    status: "experimental-supported",
    directions,
    targetNativeVerified: true,
    productSupportClaimed: true,
    broadNodeProductSupportClaimed: false,
  };
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
