import { describe, expect, it } from "vitest";

import { evaluateNodeLevel5ProductSupport85ClaimReady } from "../node-level5-product-support-85-claim-ready.ts";
import type { NodeLevel5ProductSupport85ReadinessReport } from "../node-level5-product-support-85-readiness.ts";

describe("Node Level 5 product support 85 claim ready gate", () => {
  it("accepts evidence and unlocks the 85 / 25 / 0 claim", () => {
    const report = evaluateNodeLevel5ProductSupport85ClaimReady({
      readinessReport: readinessReport(),
    });

    expect(report).toMatchObject({
      accepted: true,
      claimReadyEvidenceAccepted: true,
      claimChangeAllowed: true,
      currentNodeProductSupportClaimed: 85,
      currentBroadNodeProductSupportClaimed: 25,
      currentArbitraryProcessCrossArchRestoreClaimed: 0,
      candidateNodeProductSupportClaimed: 85,
      candidateBroadNodeProductSupportClaimed: 25,
      candidateArbitraryProcessCrossArchRestoreClaimed: 0,
      matrixCounts: { total: 114, supported: 72, refused: 42, notProven: 0 },
    });
    expect(report.blockedGates).toEqual([]);
    expect(report.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "claim-change-unlocked", status: "passed" }),
      ]),
    );
  });

  it("blocks when readiness still has evidence gaps", () => {
    const report = evaluateNodeLevel5ProductSupport85ClaimReady({
      readinessReport: {
        ...readinessReport(),
        candidateEvidenceAccepted: false,
        blockedGates: [
          { id: "generic-vm-refusal-artifacts-complete", status: "blocked", message: "missing" },
          { id: "claim-change-unlocked", status: "blocked", message: "locked" },
        ],
      },
    });

    expect(report.claimReadyEvidenceAccepted).toBe(false);
    expect(report.blockedGates.map((gate) => gate.id)).toEqual(
      expect.arrayContaining(["candidate-evidence-complete", "only-claim-unlock-blocked"]),
    );
  });
});

function readinessReport(): NodeLevel5ProductSupport85ReadinessReport {
  return {
    kind: "machinen.node-level5-product-support-85-readiness",
    version: 1,
    accepted: false,
    candidateEvidenceAccepted: true,
    claimChangeAllowed: false,
    currentNodeProductSupportClaimed: 80,
    currentBroadNodeProductSupportClaimed: 20,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateNodeProductSupportClaimed: 85,
    candidateBroadNodeProductSupportClaimed: 25,
    candidateArbitraryProcessCrossArchRestoreClaimed: 0,
    gates: [{ id: "claim-change-unlocked", status: "blocked", message: "locked" }],
    blockedGates: [{ id: "claim-change-unlocked", status: "blocked", message: "locked" }],
  };
}
