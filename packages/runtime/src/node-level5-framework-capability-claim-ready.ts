import {
  NODE_LEVEL5_FRAMEWORK_CAPABILITY_READINESS_KIND,
  type NodeLevel5FrameworkCapabilityReadinessReport,
} from "./node-level5-framework-capability-readiness.ts";
import {
  verifyNodeLevel5FrameworkProductEvidenceReport,
  type NodeLevel5FrameworkProductEvidenceReport,
} from "./node-level5-framework-product-evidence.ts";

export const NODE_LEVEL5_FRAMEWORK_CAPABILITY_CLAIM_READY_KIND =
  "machinen.node-level5-framework-capability-claim-ready";
export const NODE_LEVEL5_FRAMEWORK_CAPABILITY_CLAIM_READY_VERSION = 1;

export type NodeLevel5FrameworkCapabilityClaimReadyGateStatus = "passed" | "blocked";
export type NodeLevel5FrameworkCapabilityClaimReadyGateId =
  | "readiness-report-shape"
  | "readiness-candidate-evidence-complete"
  | "only-readiness-claim-unlock-blocked"
  | "framework-product-evidence-accepted"
  | "framework-graph-artifacts-complete"
  | "restored-behavior-probes-complete"
  | "unsafe-state-refusal-artifacts-complete"
  | "current-claim-remains-85-25-0"
  | "candidate-target-present"
  | "arbitrary-process-remains-zero"
  | "claim-change-unlocked";

export type NodeLevel5FrameworkCapabilityClaimReadyGate = {
  id: NodeLevel5FrameworkCapabilityClaimReadyGateId;
  status: NodeLevel5FrameworkCapabilityClaimReadyGateStatus;
  message: string;
};

export type NodeLevel5FrameworkCapabilityClaimReadyReport = {
  kind: typeof NODE_LEVEL5_FRAMEWORK_CAPABILITY_CLAIM_READY_KIND;
  version: typeof NODE_LEVEL5_FRAMEWORK_CAPABILITY_CLAIM_READY_VERSION;
  accepted: boolean;
  claimReadyEvidenceAccepted: boolean;
  claimChangeAllowed: true;
  currentNodeProductSupportClaimed: 85;
  currentBroadNodeProductSupportClaimed: 25;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateNodeProductSupportClaimed: 90;
  candidateBroadNodeProductSupportClaimed: 30;
  candidateArbitraryProcessCrossArchRestoreClaimed: 0;
  gates: NodeLevel5FrameworkCapabilityClaimReadyGate[];
  blockedGates: NodeLevel5FrameworkCapabilityClaimReadyGate[];
};

export function evaluateNodeLevel5FrameworkCapabilityClaimReady(input: {
  readinessReport: NodeLevel5FrameworkCapabilityReadinessReport;
  productEvidenceReport: NodeLevel5FrameworkProductEvidenceReport;
}): NodeLevel5FrameworkCapabilityClaimReadyReport {
  const productEvidence = verifyNodeLevel5FrameworkProductEvidenceReport(
    input.productEvidenceReport,
  );
  const gates = claimReadyGates(input.readinessReport, productEvidence);
  const blockedGates = gates.filter((item) => item.status === "blocked");
  return {
    kind: NODE_LEVEL5_FRAMEWORK_CAPABILITY_CLAIM_READY_KIND,
    version: NODE_LEVEL5_FRAMEWORK_CAPABILITY_CLAIM_READY_VERSION,
    accepted: blockedGates.length === 0,
    claimReadyEvidenceAccepted: blockedGates.length === 0,
    claimChangeAllowed: true,
    currentNodeProductSupportClaimed: 85,
    currentBroadNodeProductSupportClaimed: 25,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateNodeProductSupportClaimed: 90,
    candidateBroadNodeProductSupportClaimed: 30,
    candidateArbitraryProcessCrossArchRestoreClaimed: 0,
    gates,
    blockedGates,
  };
}

function claimReadyGates(
  readiness: NodeLevel5FrameworkCapabilityReadinessReport,
  evidence: ReturnType<typeof verifyNodeLevel5FrameworkProductEvidenceReport>,
): NodeLevel5FrameworkCapabilityClaimReadyGate[] {
  return [
    gate(
      "readiness-report-shape",
      readiness.kind === NODE_LEVEL5_FRAMEWORK_CAPABILITY_READINESS_KIND,
      "framework readiness report has the expected kind",
    ),
    gate(
      "readiness-candidate-evidence-complete",
      readiness.candidateEvidenceAccepted === true,
      "framework readiness candidate evidence passes",
    ),
    gate(
      "only-readiness-claim-unlock-blocked",
      onlyReadinessClaimUnlockBlocked(readiness),
      "the only readiness blocker is the intentional claim unlock",
    ),
    gate(
      "framework-product-evidence-accepted",
      evidence.accepted,
      "framework product evidence report is accepted by the verifier",
    ),
    gate(
      "framework-graph-artifacts-complete",
      evidence.graphArtifactCount === 18,
      "Express and Fastify framework graph artifacts are complete",
    ),
    gate(
      "restored-behavior-probes-complete",
      evidence.restoredBehaviorProbeCount === 16,
      "restored behavior probes are tied to framework graph artifacts",
    ),
    gate(
      "unsafe-state-refusal-artifacts-complete",
      evidence.refusalArtifactCount === 20,
      "unsafe dynamic and live states have refusal artifacts",
    ),
    gate(
      "current-claim-remains-85-25-0",
      currentClaimMatches(readiness),
      "current claim remains 85 / 25 / 0",
    ),
    gate(
      "candidate-target-present",
      candidateTargetMatches(readiness),
      "candidate target is 90 / 30 / 0",
    ),
    gate(
      "arbitrary-process-remains-zero",
      readiness.candidateArbitraryProcessCrossArchRestoreClaimed === 0,
      "arbitrary process cross-architecture restore remains 0",
    ),
    gate(
      "claim-change-unlocked",
      true,
      "all framework evidence is present for a future 90 / 30 / 0 claim PR",
    ),
  ];
}

function onlyReadinessClaimUnlockBlocked(
  report: NodeLevel5FrameworkCapabilityReadinessReport,
): boolean {
  return (
    report.accepted === false &&
    report.blockedGates.length === 1 &&
    report.blockedGates[0]?.id === "claim-change-unlocked"
  );
}

function currentClaimMatches(report: NodeLevel5FrameworkCapabilityReadinessReport): boolean {
  return (
    report.currentNodeProductSupportClaimed === 85 &&
    report.currentBroadNodeProductSupportClaimed === 25 &&
    report.currentArbitraryProcessCrossArchRestoreClaimed === 0
  );
}

function candidateTargetMatches(report: NodeLevel5FrameworkCapabilityReadinessReport): boolean {
  return (
    report.candidateNodeProductSupportClaimed === 90 &&
    report.candidateBroadNodeProductSupportClaimed === 30 &&
    report.candidateArbitraryProcessCrossArchRestoreClaimed === 0
  );
}

function gate(
  id: NodeLevel5FrameworkCapabilityClaimReadyGateId,
  passed: boolean,
  message: string,
): NodeLevel5FrameworkCapabilityClaimReadyGate {
  return { id, status: passed ? "passed" : "blocked", message };
}
