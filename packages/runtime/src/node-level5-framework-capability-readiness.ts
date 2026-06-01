import {
  buildNodeLevel5FrameworkCapabilityMatrix,
  type NodeLevel5FrameworkCapabilityMatrix,
} from "./node-level5-framework-capability-matrix.ts";
import {
  verifyNodeLevel5FrameworkIntrospectionCorpusReport,
  type NodeLevel5FrameworkIntrospectionCorpusReport,
} from "./node-level5-framework-introspection-corpus.ts";

export const NODE_LEVEL5_FRAMEWORK_CAPABILITY_READINESS_KIND =
  "machinen.node-level5-framework-capability-readiness";
export const NODE_LEVEL5_FRAMEWORK_CAPABILITY_READINESS_VERSION = 1;

export type NodeLevel5FrameworkCapabilityReadinessGateStatus = "passed" | "blocked";
export type NodeLevel5FrameworkCapabilityReadinessGateId =
  | "capability-matrix-stable"
  | "framework-introspection-corpus-accepted"
  | "framework-introspection-row-count"
  | "current-claim-remains-85-25-0"
  | "candidate-target-present"
  | "arbitrary-claims-remain-false"
  | "claim-change-unlocked";

export type NodeLevel5FrameworkCapabilityReadinessGate = {
  id: NodeLevel5FrameworkCapabilityReadinessGateId;
  status: NodeLevel5FrameworkCapabilityReadinessGateStatus;
  message: string;
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
  const gates = readinessGates({ matrix, corpus });
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
    gates,
    blockedGates,
  };
}

function readinessGates(input: {
  matrix: NodeLevel5FrameworkCapabilityMatrix;
  corpus: ReturnType<typeof verifyNodeLevel5FrameworkIntrospectionCorpusReport>;
}): NodeLevel5FrameworkCapabilityReadinessGate[] {
  return [
    gate(
      "capability-matrix-stable",
      input.matrix.accepted && input.matrix.rowCount === 24,
      "framework capability matrix remains stable at 24 rows",
    ),
    gate(
      "framework-introspection-corpus-accepted",
      input.corpus.accepted,
      "framework introspection corpus is accepted by the verifier",
    ),
    gate(
      "framework-introspection-row-count",
      input.corpus.rowCount === 16,
      "framework introspection corpus covers Express/Fastify capabilities in both directions",
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
