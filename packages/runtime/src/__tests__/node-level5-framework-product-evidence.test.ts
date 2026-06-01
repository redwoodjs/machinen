import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadNodeLevel5FrameworkProductEvidenceReport,
  verifyNodeLevel5FrameworkProductEvidenceReport,
  writeNodeLevel5FrameworkProductEvidenceReport,
} from "../node-level5-framework-product-evidence.ts";

describe("Node Level 5 framework product evidence", () => {
  it("retains framework graphs, restored probes, and refusal artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-framework-product-evidence-"));
    try {
      const reportPath = join(dir, "report.json");
      const report = writeNodeLevel5FrameworkProductEvidenceReport({
        outDir: dir,
        path: reportPath,
      });

      expect(report).toMatchObject({
        accepted: true,
        graphArtifactCount: 18,
        restoredBehaviorProbeCount: 16,
        refusalArtifactCount: 20,
        artifactCount: 54,
        currentNodeProductSupportClaimed: 85,
        currentBroadNodeProductSupportClaimed: 25,
        candidateNodeProductSupportClaimed: 90,
        candidateBroadNodeProductSupportClaimed: 30,
        candidateArbitraryProcessCrossArchRestoreClaimed: 0,
      });
      expect(verifyNodeLevel5FrameworkProductEvidenceReport(report)).toMatchObject({
        accepted: true,
        artifactFilesSha256Verified: true,
      });
      expect(
        verifyNodeLevel5FrameworkProductEvidenceReport(
          loadNodeLevel5FrameworkProductEvidenceReport(reportPath),
        ),
      ).toMatchObject({ accepted: true, artifactCount: 54 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
