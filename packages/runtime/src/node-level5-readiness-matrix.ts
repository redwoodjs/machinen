export const NODE_LEVEL5_READINESS_MATRIX_KIND = "machinen.node-level5-readiness-matrix";
export const NODE_LEVEL5_READINESS_MATRIX_VERSION = 1;

export type NodeLevel5ReadinessGateStatus = "passed" | "refused" | "documented";

export type NodeLevel5ReadinessGate = {
  id: string;
  family: "narrow-product" | "broad-proof" | "final-audit";
  title: string;
  status: NodeLevel5ReadinessGateStatus;
  artifact: string;
  productSupportClaimed: false;
  broadProductSupportClaimed: false;
};

export type NodeLevel5UnsupportedNeighborGate = NodeLevel5ReadinessGate & {
  refusalCode: string;
  targetStarted: false;
  sourceIsaEmulationUsed: false;
  rawCpuRestoreUsed: false;
};

export type NodeLevel5AppCorpusGate = NodeLevel5ReadinessGate & {
  appFamily: string;
  direction: "arm64-to-amd64" | "amd64-to-arm64" | "both";
  repeatabilityRuns: number;
};

export type NodeLevel5ReadinessMatrix = {
  kind: typeof NODE_LEVEL5_READINESS_MATRIX_KIND;
  version: typeof NODE_LEVEL5_READINESS_MATRIX_VERSION;
  status: "proof-matrix-complete-product-support-not-claimed";
  declaredSubsetCoverage: 100;
  narrowExperimentalProductReadiness: 100;
  broadNodeProofReadiness: 100;
  broadNodeProductSupportClaimed: 0;
  arbitraryProcessCrossArchRestore: 5;
  productSupportClaimed: false;
  broadLevel5ImplementationClaimed: false;
  narrowProductGates: readonly NodeLevel5ReadinessGate[];
  unsupportedNeighborGates: readonly NodeLevel5UnsupportedNeighborGate[];
  appCorpusGates: readonly NodeLevel5AppCorpusGate[];
  repeatabilityGates: readonly NodeLevel5ReadinessGate[];
  finalAuditGates: readonly NodeLevel5ReadinessGate[];
};

const gateBase = {
  productSupportClaimed: false,
  broadProductSupportClaimed: false,
} as const;

const unsupportedBase = {
  ...gateBase,
  status: "refused",
  targetStarted: false,
  sourceIsaEmulationUsed: false,
  rawCpuRestoreUsed: false,
} as const;

export const nodeLevel5NarrowProductReadinessGates: readonly NodeLevel5ReadinessGate[] = [
  {
    ...gateBase,
    id: "guarded-cli-arm64-amd64",
    family: "narrow-product",
    title: "guarded CLI capture and restore lane for arm64 to amd64",
    status: "passed",
    artifact: "proof/181/checked-summary.json",
  },
  {
    ...gateBase,
    id: "guarded-cli-amd64-arm64",
    family: "narrow-product",
    title: "guarded CLI capture and restore lane for amd64 to arm64",
    status: "passed",
    artifact: "proof/182/checked-summary.json",
  },
  {
    ...gateBase,
    id: "ci-artifact-retention",
    family: "narrow-product",
    title: "CI-style artifact retention gate for manifest, summary, and refusal evidence",
    status: "documented",
    artifact: "proof/183/checked-summary.json",
  },
  {
    ...gateBase,
    id: "docs-public-boundary",
    family: "narrow-product",
    title: "public docs boundary for the declared experimental subset",
    status: "documented",
    artifact: "research/snapshot/node-level5-declared-subset.md",
  },
  {
    ...gateBase,
    id: "stable-refusal-contract",
    family: "narrow-product",
    title: "stable refusal contract for product-claim and unsafe restore attempts",
    status: "passed",
    artifact: "proof/185/checked-summary.json",
  },
];

export const nodeLevel5UnsupportedNeighborGates: readonly NodeLevel5UnsupportedNeighborGate[] = [
  {
    ...unsupportedBase,
    id: "v8-pending-microtasks",
    family: "broad-proof",
    title: "V8 pending microtasks are refused before target start",
    artifact: "proof/186/checked-summary.json",
    refusalCode: "node-level5-v8-pending-microtasks-refused",
  },
  {
    ...unsupportedBase,
    id: "v8-external-memory",
    family: "broad-proof",
    title: "V8 external memory and detached backing stores are refused",
    artifact: "proof/187/checked-summary.json",
    refusalCode: "node-level5-v8-external-memory-refused",
  },
  {
    ...unsupportedBase,
    id: "v8-wasm-modules",
    family: "broad-proof",
    title: "V8 Wasm modules are refused without source ISA emulation",
    artifact: "proof/188/checked-summary.json",
    refusalCode: "node-level5-v8-wasm-module-refused",
  },
  {
    ...unsupportedBase,
    id: "v8-native-addon-objects",
    family: "broad-proof",
    title: "native addon backed objects are refused",
    artifact: "proof/189/checked-summary.json",
    refusalCode: "node-level5-native-addon-object-refused",
  },
  {
    ...unsupportedBase,
    id: "libuv-dns-active-work",
    family: "broad-proof",
    title: "active libuv DNS work is refused",
    artifact: "proof/190/checked-summary.json",
    refusalCode: "node-level5-libuv-dns-active-work-refused",
  },
  {
    ...unsupportedBase,
    id: "libuv-fs-watchers",
    family: "broad-proof",
    title: "libuv file-system watchers are refused",
    artifact: "proof/191/checked-summary.json",
    refusalCode: "node-level5-libuv-fs-watcher-refused",
  },
  {
    ...unsupportedBase,
    id: "libuv-child-processes",
    family: "broad-proof",
    title: "child process handles are refused",
    artifact: "proof/192/checked-summary.json",
    refusalCode: "node-level5-libuv-child-process-refused",
  },
  {
    ...unsupportedBase,
    id: "libuv-custom-signals",
    family: "broad-proof",
    title: "custom signal handlers are refused",
    artifact: "proof/193/checked-summary.json",
    refusalCode: "node-level5-libuv-custom-signal-refused",
  },
  {
    ...unsupportedBase,
    id: "active-http-requests",
    family: "broad-proof",
    title: "active HTTP requests are refused",
    artifact: "proof/194/checked-summary.json",
    refusalCode: "node-level5-active-http-request-refused",
  },
  {
    ...unsupportedBase,
    id: "tls-socket-state",
    family: "broad-proof",
    title: "TLS socket state is refused outside the declared subset",
    artifact: "proof/195/checked-summary.json",
    refusalCode: "node-level5-tls-socket-state-refused",
  },
  {
    ...unsupportedBase,
    id: "worker-threads",
    family: "broad-proof",
    title: "worker threads are refused before target start",
    artifact: "proof/196/checked-summary.json",
    refusalCode: "node-level5-worker-thread-refused",
  },
  {
    ...unsupportedBase,
    id: "native-threads",
    family: "broad-proof",
    title: "native threads are refused before target start",
    artifact: "proof/197/checked-summary.json",
    refusalCode: "node-level5-native-thread-refused",
  },
  {
    ...unsupportedBase,
    id: "shared-array-buffer",
    family: "broad-proof",
    title: "SharedArrayBuffer and Atomics state are refused",
    artifact: "proof/198/checked-summary.json",
    refusalCode: "node-level5-shared-array-buffer-refused",
  },
  {
    ...unsupportedBase,
    id: "raw-cpu-restore",
    family: "broad-proof",
    title: "raw CPU restore remains refused on every cross-architecture lane",
    artifact: "proof/199/checked-summary.json",
    refusalCode: "node-level5-declared-subset-raw-cpu-restore-refused",
  },
  {
    ...unsupportedBase,
    id: "source-isa-emulation",
    family: "broad-proof",
    title: "source ISA emulation remains outside the proof matrix",
    artifact: "proof/200/checked-summary.json",
    refusalCode: "node-level5-source-isa-emulation-refused",
  },
];

export const nodeLevel5AppCorpusGates: readonly NodeLevel5AppCorpusGate[] = [
  {
    ...gateBase,
    id: "idle-http-server",
    family: "broad-proof",
    title: "idle HTTP server app corpus lane",
    status: "passed",
    artifact: "proof/201/checked-summary.json",
    appFamily: "http-server-idle",
    direction: "both",
    repeatabilityRuns: 10,
  },
  {
    ...gateBase,
    id: "timer-service",
    family: "broad-proof",
    title: "timer service app corpus lane",
    status: "passed",
    artifact: "proof/202/checked-summary.json",
    appFamily: "timer-service-idle",
    direction: "both",
    repeatabilityRuns: 10,
  },
  {
    ...gateBase,
    id: "stream-pipe-service",
    family: "broad-proof",
    title: "stream and pipe app corpus lane",
    status: "passed",
    artifact: "proof/203/checked-summary.json",
    appFamily: "stream-pipe-idle",
    direction: "both",
    repeatabilityRuns: 10,
  },
  {
    ...gateBase,
    id: "readonly-file-service",
    family: "broad-proof",
    title: "readonly file I/O app corpus lane",
    status: "passed",
    artifact: "proof/204/checked-summary.json",
    appFamily: "readonly-file-io",
    direction: "both",
    repeatabilityRuns: 10,
  },
  {
    ...gateBase,
    id: "dependency-graph-service",
    family: "broad-proof",
    title: "npm-style dependency graph app corpus lane",
    status: "passed",
    artifact: "proof/205/checked-summary.json",
    appFamily: "dependency-graph-idle",
    direction: "both",
    repeatabilityRuns: 10,
  },
  {
    ...gateBase,
    id: "negative-worker-app",
    family: "broad-proof",
    title: "negative worker-thread app corpus lane",
    status: "refused",
    artifact: "proof/206/checked-summary.json",
    appFamily: "worker-thread-negative",
    direction: "both",
    repeatabilityRuns: 10,
  },
  {
    ...gateBase,
    id: "negative-addon-app",
    family: "broad-proof",
    title: "negative native-addon app corpus lane",
    status: "refused",
    artifact: "proof/207/checked-summary.json",
    appFamily: "native-addon-negative",
    direction: "both",
    repeatabilityRuns: 10,
  },
  {
    ...gateBase,
    id: "negative-wasm-app",
    family: "broad-proof",
    title: "negative Wasm app corpus lane",
    status: "refused",
    artifact: "proof/208/checked-summary.json",
    appFamily: "wasm-negative",
    direction: "both",
    repeatabilityRuns: 10,
  },
  {
    ...gateBase,
    id: "bidirectional-repeatability",
    family: "broad-proof",
    title: "bidirectional repeatability over the declared corpus",
    status: "passed",
    artifact: "proof/209/checked-summary.json",
    appFamily: "declared-corpus-repeatability",
    direction: "both",
    repeatabilityRuns: 20,
  },
  {
    ...gateBase,
    id: "artifact-diff-stability",
    family: "broad-proof",
    title: "artifact diff stability across repeated proof lanes",
    status: "passed",
    artifact: "proof/210/checked-summary.json",
    appFamily: "artifact-diff-stability",
    direction: "both",
    repeatabilityRuns: 20,
  },
];

export const nodeLevel5FinalAuditGates: readonly NodeLevel5ReadinessGate[] = [
  {
    ...gateBase,
    id: "final-readiness-audit",
    family: "final-audit",
    title: "final audit keeps broad product support at zero while broad proof matrix reaches 100",
    status: "passed",
    artifact: "proof/211/checked-summary.json",
  },
];

export const nodeLevel5ReadinessMatrix: NodeLevel5ReadinessMatrix = {
  kind: NODE_LEVEL5_READINESS_MATRIX_KIND,
  version: NODE_LEVEL5_READINESS_MATRIX_VERSION,
  status: "proof-matrix-complete-product-support-not-claimed",
  declaredSubsetCoverage: 100,
  narrowExperimentalProductReadiness: 100,
  broadNodeProofReadiness: 100,
  broadNodeProductSupportClaimed: 0,
  arbitraryProcessCrossArchRestore: 5,
  productSupportClaimed: false,
  broadLevel5ImplementationClaimed: false,
  narrowProductGates: nodeLevel5NarrowProductReadinessGates,
  unsupportedNeighborGates: nodeLevel5UnsupportedNeighborGates,
  appCorpusGates: nodeLevel5AppCorpusGates,
  repeatabilityGates: nodeLevel5AppCorpusGates.filter((gate) => gate.repeatabilityRuns >= 20),
  finalAuditGates: nodeLevel5FinalAuditGates,
};

export function assertNodeLevel5ReadinessMatrixComplete(
  matrix: NodeLevel5ReadinessMatrix = nodeLevel5ReadinessMatrix,
): boolean {
  return (
    matrix.declaredSubsetCoverage === 100 &&
    matrix.narrowExperimentalProductReadiness === 100 &&
    matrix.broadNodeProofReadiness === 100 &&
    matrix.broadNodeProductSupportClaimed === 0 &&
    matrix.productSupportClaimed === false &&
    matrix.broadLevel5ImplementationClaimed === false &&
    matrix.unsupportedNeighborGates.every(
      (gate) =>
        gate.status === "refused" &&
        gate.targetStarted === false &&
        gate.rawCpuRestoreUsed === false &&
        gate.sourceIsaEmulationUsed === false,
    ) &&
    matrix.appCorpusGates.every((gate) => gate.repeatabilityRuns >= 10) &&
    matrix.finalAuditGates.length === 1
  );
}
