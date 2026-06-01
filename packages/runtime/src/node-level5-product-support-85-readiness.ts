import {
  verifyNodeLevel5GenericVmCorpusReport,
  type NodeLevel5GenericVmCorpusReport,
} from "./node-level5-generic-vm-corpus.ts";
import {
  verifyNodeLevel5GenericVmRetainedEvidenceReport,
  type NodeLevel5GenericVmRetainedEvidenceReport,
} from "./node-level5-generic-vm-retained-evidence.ts";
import {
  verifyNodeLevel5GenericVmRowArtifactsReport,
  type NodeLevel5GenericVmRowArtifactsReport,
} from "./node-level5-generic-vm-row-artifacts.ts";

export const NODE_LEVEL5_PRODUCT_SUPPORT_85_READINESS_KIND =
  "machinen.node-level5-product-support-85-readiness";
export const NODE_LEVEL5_PRODUCT_SUPPORT_85_READINESS_VERSION = 1;

export type NodeLevel5ProductSupport85ReadinessGateStatus = "passed" | "blocked";
export type NodeLevel5ProductSupport85ReadinessGateId =
  | "generic-vm-corpus-accepted"
  | "generic-vm-positive-row-count"
  | "generic-vm-refusal-row-count"
  | "generic-vm-corpus-hash-verified"
  | "generic-vm-retained-evidence-accepted"
  | "generic-vm-retained-evidence-files"
  | "generic-vm-row-artifacts-accepted"
  | "generic-vm-row-artifacts-complete"
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
  genericVmRetainedEvidenceReport?: NodeLevel5GenericVmRetainedEvidenceReport;
  genericVmRowArtifactsReport?: NodeLevel5GenericVmRowArtifactsReport;
}): NodeLevel5ProductSupport85ReadinessReport {
  const verification = verifyNodeLevel5GenericVmCorpusReport(input.genericVmCorpusReport);
  const retainedEvidence = input.genericVmRetainedEvidenceReport
    ? verifyNodeLevel5GenericVmRetainedEvidenceReport(input.genericVmRetainedEvidenceReport)
    : undefined;
  const rowArtifacts = input.genericVmRowArtifactsReport
    ? verifyNodeLevel5GenericVmRowArtifactsReport(input.genericVmRowArtifactsReport)
    : undefined;
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
    ...retainedEvidenceGates(retainedEvidence),
    ...rowArtifactGates(rowArtifacts),
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

function retainedEvidenceGates(
  retainedEvidence: ReturnType<typeof verifyNodeLevel5GenericVmRetainedEvidenceReport> | undefined,
): NodeLevel5ProductSupport85ReadinessGate[] {
  if (!retainedEvidence) {
    return [];
  }
  return [
    gate(
      "generic-vm-retained-evidence-accepted",
      retainedEvidence.accepted,
      "generic VM retained evidence report is accepted by the release verifier",
    ),
    gate(
      "generic-vm-retained-evidence-files",
      retainedEvidence.retainedFileCount === 6 && retainedEvidence.retainedFilesSha256Verified,
      "generic VM retained evidence keeps snapshot, restore, manifest, and workload artifacts",
    ),
  ];
}

function rowArtifactGates(
  rowArtifacts: ReturnType<typeof verifyNodeLevel5GenericVmRowArtifactsReport> | undefined,
): NodeLevel5ProductSupport85ReadinessGate[] {
  if (!rowArtifacts) {
    return [];
  }
  return [
    gate(
      "generic-vm-row-artifacts-accepted",
      rowArtifacts.accepted,
      "generic VM row artifact report is accepted by the release verifier",
    ),
    gate(
      "generic-vm-row-artifacts-complete",
      rowArtifacts.rowArtifactFileCount === 28 &&
        rowArtifacts.positiveRowCount === 8 &&
        rowArtifacts.refusalRowCount === 20,
      "generic VM row artifacts cover every positive and refusal corpus row",
    ),
  ];
}

function gate(
  id: NodeLevel5ProductSupport85ReadinessGateId,
  passed: boolean,
  message: string,
): NodeLevel5ProductSupport85ReadinessGate {
  return { id, status: passed ? "passed" : "blocked", message };
}
