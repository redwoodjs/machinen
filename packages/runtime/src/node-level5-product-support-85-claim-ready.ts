import {
  buildNodeLevel5AppSupportMatrix,
  type NodeLevel5AppSupportMatrix,
} from "./node-level5-app-support-matrix.ts";
import {
  NODE_LEVEL5_PRODUCT_SUPPORT_85_READINESS_KIND,
  type NodeLevel5ProductSupport85ReadinessReport,
} from "./node-level5-product-support-85-readiness.ts";

export const NODE_LEVEL5_PRODUCT_SUPPORT_85_CLAIM_READY_KIND =
  "machinen.node-level5-product-support-85-claim-ready";
export const NODE_LEVEL5_PRODUCT_SUPPORT_85_CLAIM_READY_VERSION = 1;

export type NodeLevel5ProductSupport85ClaimReadyGateStatus = "passed" | "blocked";
export type NodeLevel5ProductSupport85ClaimReadyGateId =
  | "readiness-report-shape"
  | "candidate-evidence-complete"
  | "only-claim-unlock-blocked"
  | "matrix-counts-stable"
  | "claim-values-current"
  | "candidate-target-present"
  | "arbitrary-process-remains-zero"
  | "claim-change-unlocked";

export type NodeLevel5ProductSupport85ClaimReadyGate = {
  id: NodeLevel5ProductSupport85ClaimReadyGateId;
  status: NodeLevel5ProductSupport85ClaimReadyGateStatus;
  message: string;
};

export type NodeLevel5ProductSupport85ClaimReadyReport = {
  kind: typeof NODE_LEVEL5_PRODUCT_SUPPORT_85_CLAIM_READY_KIND;
  version: typeof NODE_LEVEL5_PRODUCT_SUPPORT_85_CLAIM_READY_VERSION;
  accepted: boolean;
  claimReadyEvidenceAccepted: boolean;
  claimChangeAllowed: false;
  currentNodeProductSupportClaimed: 80;
  currentBroadNodeProductSupportClaimed: 20;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateNodeProductSupportClaimed: 85;
  candidateBroadNodeProductSupportClaimed: 25;
  candidateArbitraryProcessCrossArchRestoreClaimed: 0;
  matrixCounts: {
    total: 114;
    supported: 68;
    refused: 42;
    notProven: 4;
  };
  gates: NodeLevel5ProductSupport85ClaimReadyGate[];
  blockedGates: NodeLevel5ProductSupport85ClaimReadyGate[];
};

export function evaluateNodeLevel5ProductSupport85ClaimReady(input: {
  readinessReport: NodeLevel5ProductSupport85ReadinessReport;
  appSupportMatrix?: NodeLevel5AppSupportMatrix;
}): NodeLevel5ProductSupport85ClaimReadyReport {
  const matrix = input.appSupportMatrix ?? buildNodeLevel5AppSupportMatrix();
  const matrixCounts = countMatrixStatuses(matrix);
  const gates: NodeLevel5ProductSupport85ClaimReadyGate[] = [
    gate(
      "readiness-report-shape",
      input.readinessReport.kind === NODE_LEVEL5_PRODUCT_SUPPORT_85_READINESS_KIND,
      "85 readiness report has the expected kind",
    ),
    gate(
      "candidate-evidence-complete",
      input.readinessReport.candidateEvidenceAccepted === true,
      "all candidate evidence gates pass before the final claim unlock",
    ),
    gate(
      "only-claim-unlock-blocked",
      onlyClaimUnlockBlocked(input.readinessReport),
      "the only remaining readiness blocker is the intentional claim unlock",
    ),
    gate(
      "matrix-counts-stable",
      matrix.rowCount === 114 &&
        matrixCounts.supported === 68 &&
        matrixCounts.refused === 42 &&
        matrixCounts.notProven === 4,
      "support matrix remains 114 rows with 68 supported, 42 refused, and 4 not-proven",
    ),
    gate(
      "claim-values-current",
      input.readinessReport.currentNodeProductSupportClaimed === 80 &&
        input.readinessReport.currentBroadNodeProductSupportClaimed === 20 &&
        input.readinessReport.currentArbitraryProcessCrossArchRestoreClaimed === 0,
      "current claims remain 80 / 20 / 0 before the claim PR",
    ),
    gate(
      "candidate-target-present",
      input.readinessReport.candidateNodeProductSupportClaimed === 85 &&
        input.readinessReport.candidateBroadNodeProductSupportClaimed === 25,
      "candidate target remains 85 / 25 / 0",
    ),
    gate(
      "arbitrary-process-remains-zero",
      input.readinessReport.candidateArbitraryProcessCrossArchRestoreClaimed === 0,
      "arbitrary process cross-architecture restore remains 0",
    ),
    gate(
      "claim-change-unlocked",
      false,
      "claim change remains locked until the final claim PR intentionally flips it",
    ),
  ];
  const blockedGates = gates.filter((item) => item.status === "blocked");
  return {
    kind: NODE_LEVEL5_PRODUCT_SUPPORT_85_CLAIM_READY_KIND,
    version: NODE_LEVEL5_PRODUCT_SUPPORT_85_CLAIM_READY_VERSION,
    accepted: false,
    claimReadyEvidenceAccepted: blockedGates.every((item) => item.id === "claim-change-unlocked"),
    claimChangeAllowed: false,
    currentNodeProductSupportClaimed: 80,
    currentBroadNodeProductSupportClaimed: 20,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateNodeProductSupportClaimed: 85,
    candidateBroadNodeProductSupportClaimed: 25,
    candidateArbitraryProcessCrossArchRestoreClaimed: 0,
    matrixCounts: {
      total: 114,
      supported: 68,
      refused: 42,
      notProven: 4,
    },
    gates,
    blockedGates,
  };
}

function onlyClaimUnlockBlocked(report: NodeLevel5ProductSupport85ReadinessReport): boolean {
  return (
    report.accepted === false &&
    report.blockedGates.length === 1 &&
    report.blockedGates[0]?.id === "claim-change-unlocked"
  );
}

function countMatrixStatuses(matrix: NodeLevel5AppSupportMatrix): {
  supported: number;
  refused: number;
  notProven: number;
} {
  return {
    supported: matrix.rows.filter((row) => row.status === "supported").length,
    refused: matrix.rows.filter((row) => row.status === "refused").length,
    notProven: matrix.rows.filter((row) => row.status === "not-proven").length,
  };
}

function gate(
  id: NodeLevel5ProductSupport85ClaimReadyGateId,
  passed: boolean,
  message: string,
): NodeLevel5ProductSupport85ClaimReadyGate {
  return { id, status: passed ? "passed" : "blocked", message };
}
