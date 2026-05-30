export const NODE_LEVEL5_PRODUCT_SUPPORT_20_KIND = "machinen.node-level5-product-support-20";
export const NODE_LEVEL5_PRODUCT_SUPPORT_20_VERSION = 1;

export type NodeLevel5ProductSupportFamilyId =
  | "idle-http-listener"
  | "timer-service"
  | "plain-js-heap"
  | "readonly-file-stdio"
  | "pipes-streams-idle";

export type NodeLevel5ProductSupportDirection = "arm64-to-amd64" | "amd64-to-arm64";

export type NodeLevel5ProductSupportFamily = {
  id: NodeLevel5ProductSupportFamilyId;
  title: string;
  coveragePercent: 4;
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

export type NodeLevel5ProductUnsupportedNeighbor = {
  id: string;
  refusalCode: string;
  targetStarted: false;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  productSupportClaimed: false;
};

export type NodeLevel5ProductSupport20Matrix = {
  kind: typeof NODE_LEVEL5_PRODUCT_SUPPORT_20_KIND;
  version: typeof NODE_LEVEL5_PRODUCT_SUPPORT_20_VERSION;
  status: "experimental-node-product-support-20";
  nodeProductSupportClaimed: 20;
  nodeProductSupportScope: "five-idle-service-families";
  declaredSubsetExperimentalProductSupportClaimed: 100;
  broadNodeProductSupportClaimed: 0;
  arbitraryProcessCrossArchRestoreClaimed: 0;
  node: "22.x";
  v8: "12.x pointer-compressed";
  libuv: "supported idle handles only";
  families: readonly NodeLevel5ProductSupportFamily[];
  unsupportedNeighbors: readonly NodeLevel5ProductUnsupportedNeighbor[];
  safety: {
    rawCpuRestoreSupported: false;
    sourceIsaEmulationSupported: false;
    appCheckpointHooksRequired: false;
    targetNativeNodeRequired: true;
  };
};

const directions = ["arm64-to-amd64", "amd64-to-arm64"] as const;

export const nodeLevel5ProductSupport20Families: readonly NodeLevel5ProductSupportFamily[] = [
  productFamily({
    id: "idle-http-listener",
    title: "Idle HTTP listener",
    included: ["server socket open", "idle event loop", "no active request in flight"],
    excluded: ["active requests", "TLS", "keepalive edge cases"],
    contractArtifact: "proof/227/checked-summary.json",
    e2eArtifact: "proof/228/checked-summary.json",
  }),
  productFamily({
    id: "timer-service",
    title: "Timer service",
    included: ["idle timers", "known remaining time", "known interval state"],
    excluded: ["active timer callbacks", "pending microtasks"],
    contractArtifact: "proof/229/checked-summary.json",
    e2eArtifact: "proof/230/checked-summary.json",
  }),
  productFamily({
    id: "plain-js-heap",
    title: "Plain JavaScript heap",
    included: ["strings", "arrays", "plain objects", "closure contexts"],
    excluded: ["external memory", "native addon objects", "Wasm modules"],
    contractArtifact: "proof/231/checked-summary.json",
    e2eArtifact: "proof/232/checked-summary.json",
  }),
  productFamily({
    id: "readonly-file-stdio",
    title: "Readonly file and stdio",
    included: ["readonly file descriptors", "stdin", "stdout", "stderr"],
    excluded: ["dirty writable file state", "filesystem watchers"],
    contractArtifact: "proof/233/checked-summary.json",
    e2eArtifact: "proof/234/checked-summary.json",
  }),
  productFamily({
    id: "pipes-streams-idle",
    title: "Pipes and streams at idle boundary",
    included: ["idle pipe descriptors", "idle stream descriptors", "no active read or write"],
    excluded: ["backpressure in flight", "active stream callbacks"],
    contractArtifact: "proof/235/checked-summary.json",
    e2eArtifact: "proof/236/checked-summary.json",
  }),
];

export const nodeLevel5ProductUnsupportedNeighbors: readonly NodeLevel5ProductUnsupportedNeighbor[] =
  [
    unsupportedNeighbor("active-request", "node-level5-active-request-refused"),
    unsupportedNeighbor("tls", "node-level5-tls-refused"),
    unsupportedNeighbor("worker-thread", "node-level5-worker-thread-refused"),
    unsupportedNeighbor("native-addon", "node-level5-native-addon-refused"),
    unsupportedNeighbor("wasm", "node-level5-wasm-refused"),
    unsupportedNeighbor("external-memory", "node-level5-external-memory-refused"),
    unsupportedNeighbor("fs-watcher", "node-level5-fs-watcher-refused"),
    unsupportedNeighbor("raw-cpu-restore", "node-level5-raw-cpu-restore-refused"),
    unsupportedNeighbor("source-isa-emulation", "node-level5-source-isa-emulation-refused"),
  ];

export const nodeLevel5ProductSupport20Matrix: NodeLevel5ProductSupport20Matrix = {
  kind: NODE_LEVEL5_PRODUCT_SUPPORT_20_KIND,
  version: NODE_LEVEL5_PRODUCT_SUPPORT_20_VERSION,
  status: "experimental-node-product-support-20",
  nodeProductSupportClaimed: 20,
  nodeProductSupportScope: "five-idle-service-families",
  declaredSubsetExperimentalProductSupportClaimed: 100,
  broadNodeProductSupportClaimed: 0,
  arbitraryProcessCrossArchRestoreClaimed: 0,
  node: "22.x",
  v8: "12.x pointer-compressed",
  libuv: "supported idle handles only",
  families: nodeLevel5ProductSupport20Families,
  unsupportedNeighbors: nodeLevel5ProductUnsupportedNeighbors,
  safety: {
    rawCpuRestoreSupported: false,
    sourceIsaEmulationSupported: false,
    appCheckpointHooksRequired: false,
    targetNativeNodeRequired: true,
  },
};

export function assertNodeLevel5ProductSupport20MatrixComplete(
  matrix: NodeLevel5ProductSupport20Matrix = nodeLevel5ProductSupport20Matrix,
): boolean {
  const familyCoverage = matrix.families.reduce((sum, family) => sum + family.coveragePercent, 0);
  return (
    matrix.nodeProductSupportClaimed === 20 &&
    familyCoverage === 20 &&
    matrix.families.length === 5 &&
    matrix.families.every(
      (family) =>
        family.status === "experimental-supported" &&
        family.directions.includes("arm64-to-amd64") &&
        family.directions.includes("amd64-to-arm64") &&
        family.targetNativeVerified === true &&
        family.productSupportClaimed === true &&
        family.broadNodeProductSupportClaimed === false,
    ) &&
    matrix.unsupportedNeighbors.every(
      (neighbor) =>
        neighbor.targetStarted === false &&
        neighbor.rawCpuRestoreUsed === false &&
        neighbor.sourceIsaEmulationUsed === false &&
        neighbor.productSupportClaimed === false,
    ) &&
    matrix.broadNodeProductSupportClaimed === 0 &&
    matrix.arbitraryProcessCrossArchRestoreClaimed === 0 &&
    matrix.safety.rawCpuRestoreSupported === false &&
    matrix.safety.sourceIsaEmulationSupported === false &&
    matrix.safety.appCheckpointHooksRequired === false &&
    matrix.safety.targetNativeNodeRequired === true
  );
}

function productFamily(input: {
  id: NodeLevel5ProductSupportFamilyId;
  title: string;
  included: readonly string[];
  excluded: readonly string[];
  contractArtifact: string;
  e2eArtifact: string;
}): NodeLevel5ProductSupportFamily {
  return {
    ...input,
    coveragePercent: 4,
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
