import { describe, expect, it } from "vitest";

import { evaluateNodeLevel5FrameworkCapabilityReadiness } from "../node-level5-framework-capability-readiness.ts";
import { createNodeLevel5FrameworkIntrospectionCorpusReport } from "../node-level5-framework-introspection-corpus.ts";
import type { NodeLevel5FrameworkIntrospectionCorpusRow } from "../node-level5-framework-introspection-corpus.ts";

describe("Node Level 5 framework capability readiness", () => {
  it("accepts candidate evidence while keeping 90 / 30 / 0 locked", () => {
    const report = evaluateNodeLevel5FrameworkCapabilityReadiness({
      frameworkIntrospectionCorpusReport:
        createNodeLevel5FrameworkIntrospectionCorpusReport(rows()),
    });

    expect(report).toMatchObject({
      accepted: false,
      candidateEvidenceAccepted: true,
      claimChangeAllowed: false,
      currentNodeProductSupportClaimed: 85,
      currentBroadNodeProductSupportClaimed: 25,
      currentArbitraryProcessCrossArchRestoreClaimed: 0,
      candidateNodeProductSupportClaimed: 90,
      candidateBroadNodeProductSupportClaimed: 30,
      candidateArbitraryProcessCrossArchRestoreClaimed: 0,
    });
    expect(report.coverage).toMatchObject({
      expectedRows: 16,
      observedRows: 16,
      missingCoverageKeys: [],
      duplicateRowIds: [],
    });
    expect(report.blockedGates).toEqual([
      expect.objectContaining({ id: "claim-change-unlocked", status: "blocked" }),
    ]);
  });

  it("blocks candidate evidence when framework coverage is incomplete", () => {
    const incompleteRows = rows();
    incompleteRows[0] = {
      ...incompleteRows[0],
      id: "express-duplicate-route-graph-amd64-to-arm64",
      direction: "amd64-to-arm64",
    };

    const report = evaluateNodeLevel5FrameworkCapabilityReadiness({
      frameworkIntrospectionCorpusReport:
        createNodeLevel5FrameworkIntrospectionCorpusReport(incompleteRows),
    });

    expect(report.candidateEvidenceAccepted).toBe(false);
    expect(report.coverage.missingCoverageKeys).toContain("express:route-graph:arm64-to-amd64");
    expect(report.blockedGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "framework-introspection-coverage-complete" }),
        expect.objectContaining({ id: "claim-change-unlocked" }),
      ]),
    );
  });

  it("blocks candidate evidence when rows overclaim arbitrary support", () => {
    const overclaimedRows = rows();
    overclaimedRows[0] = {
      ...overclaimedRows[0],
      arbitraryFrameworkClaimed: true,
    } as unknown as NodeLevel5FrameworkIntrospectionCorpusRow;

    const report = evaluateNodeLevel5FrameworkCapabilityReadiness({
      frameworkIntrospectionCorpusReport:
        createNodeLevel5FrameworkIntrospectionCorpusReport(overclaimedRows),
    });

    expect(report.candidateEvidenceAccepted).toBe(false);
    expect(report.blockedGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "framework-introspection-corpus-accepted" }),
        expect.objectContaining({ id: "framework-introspection-no-arbitrary-claims" }),
      ]),
    );
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
