import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateNodeLevel5FrameworkCapabilityClaimReady } from "../node-level5-framework-capability-claim-ready.ts";
import { evaluateNodeLevel5FrameworkCapabilityReadiness } from "../node-level5-framework-capability-readiness.ts";
import { createNodeLevel5FrameworkIntrospectionCorpusReport } from "../node-level5-framework-introspection-corpus.ts";
import type { NodeLevel5FrameworkIntrospectionCorpusRow } from "../node-level5-framework-introspection-corpus.ts";
import { writeNodeLevel5FrameworkProductEvidenceReport } from "../node-level5-framework-product-evidence.ts";

describe("Node Level 5 framework capability claim-ready gate", () => {
  it("unlocks the 90 / 30 / 0 candidate only after framework evidence passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-framework-claim-ready-"));
    try {
      const readinessReport = evaluateNodeLevel5FrameworkCapabilityReadiness({
        frameworkIntrospectionCorpusReport:
          createNodeLevel5FrameworkIntrospectionCorpusReport(rows()),
      });
      const productEvidenceReport = writeNodeLevel5FrameworkProductEvidenceReport({
        outDir: dir,
        path: join(dir, "product-evidence.json"),
      });

      const report = evaluateNodeLevel5FrameworkCapabilityClaimReady({
        readinessReport,
        productEvidenceReport,
      });

      expect(report).toMatchObject({
        accepted: true,
        claimReadyEvidenceAccepted: true,
        claimChangeAllowed: true,
        currentNodeProductSupportClaimed: 85,
        currentBroadNodeProductSupportClaimed: 25,
        currentArbitraryProcessCrossArchRestoreClaimed: 0,
        candidateNodeProductSupportClaimed: 90,
        candidateBroadNodeProductSupportClaimed: 30,
        candidateArbitraryProcessCrossArchRestoreClaimed: 0,
        blockedGates: [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function rows(): NodeLevel5FrameworkIntrospectionCorpusRow[] {
  const frameworks = ["express", "fastify"] as const;
  const capabilities = [
    "route-graph",
    "middleware-hook-graph",
    "plugin-graph",
    "idle-lifecycle-state",
  ] as const;
  const directions = ["arm64-to-amd64", "amd64-to-arm64"] as const;
  return frameworks.flatMap((framework) =>
    capabilities.flatMap((capability) =>
      directions.map((direction) => ({
        id: `${framework}-${capability}-${direction}`,
        framework,
        capability,
        direction,
        productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>",
        vmDetectedNodeWorkload: true,
        frameworkMetadataCapturedInsideVm: true,
        retainedFrameworkGraphArtifact: true,
        targetNativeRestoreProbePassed: true,
        arbitraryFrameworkClaimed: false,
        arbitraryNodeClaimed: false,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      })),
    ),
  );
}
