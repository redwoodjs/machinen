import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ARBITRARY_PROCESS_LEVEL5_CLAIM_READY_REPORT,
  evaluateArbitraryProcessLevel5ClaimReady,
  loadArbitraryProcessLevel5ClaimReadyReport,
  verifyArbitraryProcessLevel5ClaimReadyReport,
  writeArbitraryProcessLevel5ClaimReadyReport,
  type ArbitraryProcessLevel5VerifiedSeedInput,
} from "../arbitrary-process-level5-claim-ready.ts";
import { createArbitraryProcessLevel5RegularFileFdProof } from "../arbitrary-process-level5-regular-file-fd-proof.ts";
import { createArbitraryProcessLevel5SeedReport } from "../arbitrary-process-level5-seed-matrix.ts";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("arbitrary process Level 5 claim-ready gate", () => {
  it("keeps claimChangeAllowed false when only one verified seed exists", () => {
    const outDir = mkdtempSync(join(tmpdir(), "arbitrary-claim-ready-"));
    const seedReport = createArbitraryProcessLevel5SeedReport({ outDir: join(outDir, "seed") });
    const regularFile = createArbitraryProcessLevel5RegularFileFdProof({
      outDir: join(outDir, "regular-file"),
    });

    const report = evaluateArbitraryProcessLevel5ClaimReady({
      seedReport,
      verifiedSeeds: [
        {
          rowId: regularFile.rowId,
          accepted: regularFile.accepted,
          proofStatus: regularFile.proofStatus,
          artifact: "regular-file-fd-proof-report.json",
          sha256: regularFile.artifactsSha256,
        },
      ],
    });

    expect(report.accepted).toBe(false);
    expect(report.claimChangeAllowed).toBe(false);
    expect(report.currentArbitraryProcessCrossArchRestoreClaimed).toBe(0);
    expect(report.candidateArbitraryProcessCrossArchRestoreClaimed).toBe(1);
    expect(report.gates.find((gate) => gate.id === "minimum-verified-seeds")?.passed).toBe(false);
  });

  it("is the only gate that can unlock a candidate 1% claim", () => {
    const outDir = mkdtempSync(join(tmpdir(), "arbitrary-claim-ready-pass-"));
    const seedReport = createArbitraryProcessLevel5SeedReport({ outDir: join(outDir, "seed") });
    const verifiedSeeds: ArbitraryProcessLevel5VerifiedSeedInput[] = [
      "native-regular-file-fd",
      "native-simple-pipe-fd",
      "native-idle-epoll-or-tcp",
    ].map((rowId) => ({
      rowId,
      accepted: true,
      proofStatus: "verified-seed",
      artifact: `${rowId}.json`,
      sha256: sha(rowId),
    }));

    const report = evaluateArbitraryProcessLevel5ClaimReady({ seedReport, verifiedSeeds });
    const reportDir = join(outDir, "report");
    writeArbitraryProcessLevel5ClaimReadyReport(reportDir, report);
    const loaded = loadArbitraryProcessLevel5ClaimReadyReport(
      join(reportDir, ARBITRARY_PROCESS_LEVEL5_CLAIM_READY_REPORT),
    );
    const verified = verifyArbitraryProcessLevel5ClaimReadyReport(loaded);

    expect(verified.accepted).toBe(true);
    expect(verified.claimChangeAllowed).toBe(true);
    expect(verified.currentArbitraryProcessCrossArchRestoreClaimed).toBe(0);
    expect(verified.candidateArbitraryProcessCrossArchRestoreClaimed).toBe(1);
    expect(verified.arbitraryProcessClaimed).toBe(false);
  });
});
