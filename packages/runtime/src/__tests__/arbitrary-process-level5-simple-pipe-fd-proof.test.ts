import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ARBITRARY_PROCESS_LEVEL5_SIMPLE_PIPE_FD_PROOF_REPORT,
  createArbitraryProcessLevel5SimplePipeFdProof,
  loadArbitraryProcessLevel5SimplePipeFdProofReport,
  verifyArbitraryProcessLevel5SimplePipeFdProofReport,
} from "../arbitrary-process-level5-simple-pipe-fd-proof.ts";

describe("arbitrary process simple pipe FD proof", () => {
  it("retains a target-native simple pipe verifier artifact without raising the claim", () => {
    const outDir = mkdtempSync(join(tmpdir(), "simple-pipe-fd-proof-"));
    const report = createArbitraryProcessLevel5SimplePipeFdProof({ outDir });
    const loaded = loadArbitraryProcessLevel5SimplePipeFdProofReport(
      join(outDir, ARBITRARY_PROCESS_LEVEL5_SIMPLE_PIPE_FD_PROOF_REPORT),
    );
    const verified = verifyArbitraryProcessLevel5SimplePipeFdProofReport(loaded);

    expect(verified.accepted).toBe(true);
    expect(verified.rowId).toBe("native-simple-pipe-fd");
    expect(verified.proofStatus).toBe("verified-seed");
    expect(verified.targetReconstruction.sidecarReplayUsed).toBe(false);
    expect(verified.targetReconstruction.rawCpuRestoreUsed).toBe(false);
    expect(verified.targetReconstruction.sourceIsaEmulationUsed).toBe(false);
    expect(verified.verifier.targetReadBytesSha256Matched).toBe(true);
    expect(verified.verifier.eofAfterBufferedBytes).toBe(true);
    expect(verified.claimChangeAllowed).toBe(false);
    expect(verified.currentArbitraryProcessCrossArchRestoreClaimed).toBe(0);
    expect(existsSync(join(outDir, "target-verifier.json"))).toBe(true);
    expect(report.artifacts).toHaveLength(3);
  });
});
