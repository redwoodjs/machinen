export type NodeLevel5CorpusHttpEvidence = {
  routePath: string;
  expectedStatus: number;
  actualStatus: number;
  expectedBody: string;
  actualBody: string;
  expectedHeaders: Record<string, string>;
  actualHeaders: Record<string, string>;
  snapshotAccepted: boolean;
  restoreAccepted: boolean;
  behavioralVerifierPassed: boolean;
  targetNativeNodeVerified: boolean;
};

export function isNodeLevel5CorpusHttpEvidenceAccepted(
  evidence: NodeLevel5CorpusHttpEvidence,
): boolean {
  return (
    evidence.snapshotAccepted &&
    evidence.restoreAccepted &&
    evidence.behavioralVerifierPassed &&
    evidence.targetNativeNodeVerified &&
    evidence.actualStatus === evidence.expectedStatus &&
    evidence.actualBody === evidence.expectedBody &&
    Object.entries(evidence.expectedHeaders).every(
      ([key, value]) => evidence.actualHeaders[key] === value,
    )
  );
}
