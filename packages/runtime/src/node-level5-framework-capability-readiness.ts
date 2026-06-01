import {
  buildNodeLevel5FrameworkCapabilityMatrix,
  type NodeLevel5FrameworkCapabilityMatrix,
} from "./node-level5-framework-capability-matrix.ts";
import {
  verifyNodeLevel5FrameworkIntrospectionCorpusReport,
  type NodeLevel5FrameworkIntrospectionCapability,
  type NodeLevel5FrameworkIntrospectionCorpusReport,
  type NodeLevel5FrameworkIntrospectionCorpusRow,
} from "./node-level5-framework-introspection-corpus.ts";

export const NODE_LEVEL5_FRAMEWORK_CAPABILITY_READINESS_KIND =
  "machinen.node-level5-framework-capability-readiness";
export const NODE_LEVEL5_FRAMEWORK_CAPABILITY_READINESS_VERSION = 1;

export type NodeLevel5FrameworkCapabilityReadinessGateStatus = "passed" | "blocked";
export type NodeLevel5FrameworkCapabilityReadinessGateId =
  | "capability-matrix-stable"
  | "framework-introspection-corpus-accepted"
  | "framework-introspection-row-count"
  | "framework-introspection-coverage-complete"
  | "framework-introspection-product-path"
  | "framework-introspection-retained-artifacts"
  | "framework-introspection-no-arbitrary-claims"
  | "current-claim-remains-85-25-0"
  | "candidate-target-present"
  | "arbitrary-claims-remain-false"
  | "claim-change-unlocked";

export type NodeLevel5FrameworkCapabilityReadinessGate = {
  id: NodeLevel5FrameworkCapabilityReadinessGateId;
  status: NodeLevel5FrameworkCapabilityReadinessGateStatus;
  message: string;
};

export type NodeLevel5FrameworkCapabilityReadinessCoverage = {
  expectedRows: number;
  observedRows: number;
  expectedCoverageKeys: string[];
  observedCoverageKeys: string[];
  missingCoverageKeys: string[];
  duplicateRowIds: string[];
};

export type NodeLevel5FrameworkCapabilityReadinessReport = {
  kind: typeof NODE_LEVEL5_FRAMEWORK_CAPABILITY_READINESS_KIND;
  version: typeof NODE_LEVEL5_FRAMEWORK_CAPABILITY_READINESS_VERSION;
  accepted: boolean;
  candidateEvidenceAccepted: boolean;
  claimChangeAllowed: false;
  currentNodeProductSupportClaimed: 85;
  currentBroadNodeProductSupportClaimed: 25;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateNodeProductSupportClaimed: 90;
  candidateBroadNodeProductSupportClaimed: 30;
  candidateArbitraryProcessCrossArchRestoreClaimed: 0;
  coverage: NodeLevel5FrameworkCapabilityReadinessCoverage;
  gates: NodeLevel5FrameworkCapabilityReadinessGate[];
  blockedGates: NodeLevel5FrameworkCapabilityReadinessGate[];
};

export function evaluateNodeLevel5FrameworkCapabilityReadiness(input: {
  frameworkIntrospectionCorpusReport: NodeLevel5FrameworkIntrospectionCorpusReport;
  frameworkCapabilityMatrix?: NodeLevel5FrameworkCapabilityMatrix;
}): NodeLevel5FrameworkCapabilityReadinessReport {
  const matrix = input.frameworkCapabilityMatrix ?? buildNodeLevel5FrameworkCapabilityMatrix();
  const corpus = verifyNodeLevel5FrameworkIntrospectionCorpusReport(
    input.frameworkIntrospectionCorpusReport,
  );
  const coverage = frameworkIntrospectionCoverage(input.frameworkIntrospectionCorpusReport.rows);
  const gates = readinessGates({
    matrix,
    corpus,
    coverage,
    rows: input.frameworkIntrospectionCorpusReport.rows,
  });
  const blockedGates = gates.filter((item) => item.status === "blocked");
  return {
    kind: NODE_LEVEL5_FRAMEWORK_CAPABILITY_READINESS_KIND,
    version: NODE_LEVEL5_FRAMEWORK_CAPABILITY_READINESS_VERSION,
    accepted: false,
    candidateEvidenceAccepted: blockedGates.every((item) => item.id === "claim-change-unlocked"),
    claimChangeAllowed: false,
    currentNodeProductSupportClaimed: 85,
    currentBroadNodeProductSupportClaimed: 25,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateNodeProductSupportClaimed: 90,
    candidateBroadNodeProductSupportClaimed: 30,
    candidateArbitraryProcessCrossArchRestoreClaimed: 0,
    coverage,
    gates,
    blockedGates,
  };
}

function readinessGates(input: {
  matrix: NodeLevel5FrameworkCapabilityMatrix;
  corpus: ReturnType<typeof verifyNodeLevel5FrameworkIntrospectionCorpusReport>;
  coverage: NodeLevel5FrameworkCapabilityReadinessCoverage;
  rows: NodeLevel5FrameworkIntrospectionCorpusRow[];
}): NodeLevel5FrameworkCapabilityReadinessGate[] {
  return [
    gate(
      "capability-matrix-stable",
      capabilityMatrixStable(input.matrix),
      "framework capability matrix remains stable at 24 rows",
    ),
    gate(
      "framework-introspection-corpus-accepted",
      input.corpus.accepted,
      "framework introspection corpus is accepted by the verifier",
    ),
    gate(
      "framework-introspection-row-count",
      input.corpus.rowCount === input.coverage.expectedRows,
      "framework introspection corpus covers Express/Fastify capabilities in both directions",
    ),
    gate(
      "framework-introspection-coverage-complete",
      coverageComplete(input.coverage),
      "framework introspection corpus includes every framework/capability/direction combination exactly once",
    ),
    gate(
      "framework-introspection-product-path",
      rowsUseProductPath(input.rows),
      "framework introspection evidence comes from VM-detected product snapshot and restore commands",
    ),
    gate(
      "framework-introspection-retained-artifacts",
      rowsRetainFrameworkArtifacts(input.rows),
      "framework introspection evidence retains framework graph artifacts and target-native restore probes",
    ),
    gate(
      "framework-introspection-no-arbitrary-claims",
      rowsAvoidArbitraryClaims(input.rows),
      "framework introspection evidence does not claim arbitrary framework, Node, or process restore support",
    ),
    gate(
      "current-claim-remains-85-25-0",
      currentClaimMatches(input.corpus),
      "current claim remains 85 / 25 / 0",
    ),
    gate(
      "candidate-target-present",
      candidateTargetMatches(input.corpus),
      "candidate target is 90 / 30 / 0",
    ),
    gate(
      "arbitrary-claims-remain-false",
      arbitraryClaimsRemainFalse(input.matrix),
      "arbitrary Express, Fastify, and Node remain unclaimed",
    ),
    gate(
      "claim-change-unlocked",
      false,
      "framework capability claim change is locked until future retained product evidence passes",
    ),
  ];
}

const expectedFrameworks = ["express", "fastify"] as const;
const expectedCapabilities: NodeLevel5FrameworkIntrospectionCapability[] = [
  "route-graph",
  "middleware-hook-graph",
  "plugin-graph",
  "idle-lifecycle-state",
];
const expectedDirections = ["arm64-to-amd64", "amd64-to-arm64"] as const;
const productCommandPath = "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>";

function frameworkIntrospectionCoverage(
  rows: NodeLevel5FrameworkIntrospectionCorpusRow[],
): NodeLevel5FrameworkCapabilityReadinessCoverage {
  const expectedCoverageKeys = expectedFrameworks.flatMap((framework) =>
    expectedCapabilities.flatMap((capability) =>
      expectedDirections.map((direction) => coverageKey({ framework, capability, direction })),
    ),
  );
  const observedCoverageKeys = rows.map(coverageKey).sort();
  const duplicateRowIds = duplicateValues(rows.map((row) => row.id));
  return {
    expectedRows: expectedCoverageKeys.length,
    observedRows: rows.length,
    expectedCoverageKeys: expectedCoverageKeys.sort(),
    observedCoverageKeys,
    missingCoverageKeys: expectedCoverageKeys.filter((key) => !observedCoverageKeys.includes(key)),
    duplicateRowIds,
  };
}

function coverageKey(
  row: Pick<NodeLevel5FrameworkIntrospectionCorpusRow, "framework" | "capability" | "direction">,
): string {
  return `${row.framework}:${row.capability}:${row.direction}`;
}

function duplicateValues(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index).sort();
}

function capabilityMatrixStable(matrix: NodeLevel5FrameworkCapabilityMatrix): boolean {
  return matrix.accepted && matrix.rowCount === 24;
}

function coverageComplete(coverage: NodeLevel5FrameworkCapabilityReadinessCoverage): boolean {
  return (
    coverage.observedRows === coverage.expectedRows &&
    coverage.missingCoverageKeys.length === 0 &&
    coverage.duplicateRowIds.length === 0
  );
}

function rowsUseProductPath(rows: NodeLevel5FrameworkIntrospectionCorpusRow[]): boolean {
  return rows.every(
    (row) => row.productCommandPath === productCommandPath && row.vmDetectedNodeWorkload === true,
  );
}

function rowsRetainFrameworkArtifacts(rows: NodeLevel5FrameworkIntrospectionCorpusRow[]): boolean {
  return rows.every(
    (row) =>
      row.frameworkMetadataCapturedInsideVm === true &&
      row.retainedFrameworkGraphArtifact === true &&
      row.targetNativeRestoreProbePassed === true,
  );
}

function rowsAvoidArbitraryClaims(rows: NodeLevel5FrameworkIntrospectionCorpusRow[]): boolean {
  return rows.every(
    (row) =>
      row.arbitraryFrameworkClaimed === false &&
      row.arbitraryNodeClaimed === false &&
      row.arbitraryProcessCrossArchRestoreClaimed === 0,
  );
}

function currentClaimMatches(
  corpus: ReturnType<typeof verifyNodeLevel5FrameworkIntrospectionCorpusReport>,
): boolean {
  return (
    corpus.currentNodeProductSupportClaimed === 85 &&
    corpus.currentBroadNodeProductSupportClaimed === 25 &&
    corpus.currentArbitraryProcessCrossArchRestoreClaimed === 0
  );
}

function candidateTargetMatches(
  corpus: ReturnType<typeof verifyNodeLevel5FrameworkIntrospectionCorpusReport>,
): boolean {
  return (
    corpus.candidateNodeProductSupportClaimed === 90 &&
    corpus.candidateBroadNodeProductSupportClaimed === 30 &&
    corpus.candidateArbitraryProcessCrossArchRestoreClaimed === 0
  );
}

function arbitraryClaimsRemainFalse(matrix: NodeLevel5FrameworkCapabilityMatrix): boolean {
  return (
    matrix.arbitraryExpressClaimed === false &&
    matrix.arbitraryFastifyClaimed === false &&
    matrix.arbitraryNodeClaimed === false
  );
}

function gate(
  id: NodeLevel5FrameworkCapabilityReadinessGateId,
  passed: boolean,
  message: string,
): NodeLevel5FrameworkCapabilityReadinessGate {
  return { id, status: passed ? "passed" : "blocked", message };
}
