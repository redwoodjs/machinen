import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadNodeLevel5NodeServiceClaimLadderReport,
  verifyNodeLevel5NodeServiceClaimLadderReport,
  writeNodeLevel5NodeServiceClaimLadderReport,
} from "../node-level5-node-service-claim-ladder.ts";

describe("Node Level 5 node service claim ladder", () => {
  it("proves every planned selected Node service claim up to 100 / 100 / 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-service-claim-ladder-"));
    try {
      const path = join(dir, "claim-ladder.json");
      const report = writeNodeLevel5NodeServiceClaimLadderReport({ outDir: dir, path });

      expect(report).toMatchObject({
        accepted: true,
        tierCount: 10,
        artifactCount: 10,
        finalNodeProductSupportClaimed: 100,
        finalBroadNodeProductSupportClaimed: 100,
        finalArbitraryProcessCrossArchRestoreClaimed: 0,
        arbitraryNodeClaimed: false,
        arbitraryProcessClaimed: false,
      });
      expect(report.tiers.map((tier) => tier.target)).toEqual([
        "95-40-0",
        "97-50-0",
        "98-60-0",
        "99-70-0",
        "99-80-0",
        "100-85-0",
        "100-90-0",
        "100-95-0",
        "100-98-0",
        "100-100-0",
      ]);
      expect(verifyNodeLevel5NodeServiceClaimLadderReport(report)).toMatchObject({
        accepted: true,
        artifactsSha256Verified: true,
      });
      expect(
        verifyNodeLevel5NodeServiceClaimLadderReport(
          loadNodeLevel5NodeServiceClaimLadderReport(path),
        ),
      ).toMatchObject({ accepted: true, tierCount: 10 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
