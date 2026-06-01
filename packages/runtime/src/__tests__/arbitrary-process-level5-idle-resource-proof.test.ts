import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ARBITRARY_PROCESS_LEVEL5_IDLE_RESOURCE_PROOF_REPORT,
  createArbitraryProcessLevel5IdleResourceProof,
  loadArbitraryProcessLevel5IdleResourceProofReport,
  verifyArbitraryProcessLevel5IdleResourceProofReport,
} from "../arbitrary-process-level5-idle-resource-proof.ts";

describe("arbitrary process idle epoll/TCP proof", () => {
  it("retains an idle-only resource reconstruction verifier", () => {
    const outDir = mkdtempSync(join(tmpdir(), "idle-resource-proof-"));
    createArbitraryProcessLevel5IdleResourceProof({ outDir });
    const report = verifyArbitraryProcessLevel5IdleResourceProofReport(
      loadArbitraryProcessLevel5IdleResourceProofReport(
        join(outDir, ARBITRARY_PROCESS_LEVEL5_IDLE_RESOURCE_PROOF_REPORT),
      ),
    );

    expect(report.accepted).toBe(true);
    expect(report.rowId).toBe("native-idle-epoll-or-tcp");
    expect(report.capturedState.epollReadyEvents).toBe(0);
    expect(report.capturedState.acceptedStreams).toBe(0);
    expect(report.targetReconstruction.idleOnly).toBe(true);
    expect(report.targetReconstruction.activeSocketStreamsRestored).toBe(false);
    expect(report.verifier.epollWaitReturnedNoEvents).toBe(true);
    expect(report.verifier.listenerAcceptedNoStreams).toBe(true);
    expect(report.claimChangeAllowed).toBe(false);
    expect(existsSync(join(outDir, "target-verifier.json"))).toBe(true);
  });
});
