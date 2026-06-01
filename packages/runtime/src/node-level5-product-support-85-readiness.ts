import {
  verifyNodeLevel5GenericVmCorpusReport,
  type NodeLevel5GenericVmCorpusReport,
} from "./node-level5-generic-vm-corpus.ts";

export const NODE_LEVEL5_PRODUCT_SUPPORT_85_READINESS_KIND =
  "machinen.node-level5-product-support-85-readiness";
export const NODE_LEVEL5_PRODUCT_SUPPORT_85_READINESS_VERSION = 1;

export type NodeLevel5ProductSupport85ReadinessGateStatus = "passed" | "blocked";
export type NodeLevel5ProductSupport85ReadinessGateId =
  | "generic-vm-corpus-accepted"
  | "generic-vm-positive-row-count"
  | "generic-vm-refusal-row-count"
  | "generic-vm-corpus-hash-verified"
  | "claim-values-remain-current"
  | "claim-change-unlocked";

export type NodeLevel5ProductSupport85ReadinessGate = {
  id: NodeLevel5ProductSupport85ReadinessGateId;
  status: NodeLevel5ProductSupport85ReadinessGateStatus;
  message: string;
};

export type NodeLevel5ProductSupport85ReadinessReport = {
  kind: typeof NODE_LEVEL5_PRODUCT_SUPPORT_85_READINESS_KIND;
  version: typeof NODE_LEVEL5_PRODUCT_SUPPORT_85_READINESS_VERSION;
  accepted: boolean;
  candidateEvidenceAccepted: boolean;
  claimChangeAllowed: false;
  currentNodeProductSupportClaimed: 80;
  currentBroadNodeProductSupportClaimed: 20;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateNodeProductSupportClaimed: 85;
  candidateBroadNodeProductSupportClaimed: 25;
  candidateArbitraryProcessCrossArchRestoreClaimed: 0;
  gates: NodeLevel5ProductSupport85ReadinessGate[];
  blockedGates: NodeLevel5ProductSupport85ReadinessGate[];
};

export function evaluateNodeLevel5ProductSupport85Readiness(input: {
  genericVmCorpusReport: NodeLevel5GenericVmCorpusReport;
}): NodeLevel5ProductSupport85ReadinessReport {
  const verification = verifyNodeLevel5GenericVmCorpusReport(input.genericVmCorpusReport);
  const gates: NodeLevel5ProductSupport85ReadinessGate[] = [
    gate(
      "generic-vm-corpus-accepted",
      verification.accepted,
      "generic VM corpus report is accepted by the release verifier",
    ),
    gate(
      "generic-vm-positive-row-count",
      verification.positiveRowCount === 8,
      "generic VM corpus has Express/Fastify CJS/ESM positive rows in both directions",
    ),
    gate(
      "generic-vm-refusal-row-count",
      verification.refusalRowCount === 20,
      "generic VM corpus has active-request, worker, native-addon, TLS, and child-process refusal rows in both directions",
    ),
    gate(
      "generic-vm-corpus-hash-verified",
      verification.rowsSha256Verified,
      "generic VM corpus row hash is verified",
    ),
    gate(
      "claim-values-remain-current",
      verification.nodeProductSupportClaimed === 80 &&
        verification.broadNodeProductSupportClaimed === 20 &&
        verification.arbitraryProcessCrossArchRestoreClaimed === 0,
      "current claim values remain 80 / 20 / 0 while evidence is candidate-only",
    ),
    gate(
      "claim-change-unlocked",
      false,
      "claim change is intentionally locked until retained product-run evidence is reviewed in the claim PR",
    ),
  ];
  const blockedGates = gates.filter((item) => item.status === "blocked");
  return {
    kind: NODE_LEVEL5_PRODUCT_SUPPORT_85_READINESS_KIND,
    version: NODE_LEVEL5_PRODUCT_SUPPORT_85_READINESS_VERSION,
    accepted: false,
    candidateEvidenceAccepted: blockedGates.every((item) => item.id === "claim-change-unlocked"),
    claimChangeAllowed: false,
    currentNodeProductSupportClaimed: 80,
    currentBroadNodeProductSupportClaimed: 20,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateNodeProductSupportClaimed: 85,
    candidateBroadNodeProductSupportClaimed: 25,
    candidateArbitraryProcessCrossArchRestoreClaimed: 0,
    gates,
    blockedGates,
  };
}

function gate(
  id: NodeLevel5ProductSupport85ReadinessGateId,
  passed: boolean,
  message: string,
): NodeLevel5ProductSupport85ReadinessGate {
  return { id, status: passed ? "passed" : "blocked", message };
}
