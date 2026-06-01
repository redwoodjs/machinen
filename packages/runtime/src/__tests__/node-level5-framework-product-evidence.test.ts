import { createHash } from "node:crypto";
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
        graphArtifactCoverageComplete: true,
        restoredBehaviorProbeCoverageComplete: true,
        refusalArtifactCoverageComplete: true,
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

  it("rejects drift in unsafe-state refusal artifact coverage", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-framework-product-refusal-drift-"));
    try {
      const report = writeNodeLevel5FrameworkProductEvidenceReport({
        outDir: dir,
        path: join(dir, "report.json"),
      });
      const refusalFile = report.artifactFiles.find(
        (file) =>
          file.evidenceKind === "refusal-artifact" && file.unsafeStateMarker === "activeRequests",
      );
      if (!refusalFile) {
        throw new Error("missing active request refusal artifact");
      }
      refusalFile.unsafeStateMarker = "workerThreads";
      report.artifactFilesSha256 = hashJson(report.artifactFiles);

      expect(verifyNodeLevel5FrameworkProductEvidenceReport(report)).toMatchObject({
        accepted: false,
        artifactFilesSha256Verified: true,
        refusalArtifactCoverageComplete: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
