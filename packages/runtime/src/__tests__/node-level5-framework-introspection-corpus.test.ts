import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadNodeLevel5FrameworkIntrospectionCorpusReport,
  verifyNodeLevel5FrameworkIntrospectionCorpusReport,
  writeNodeLevel5FrameworkIntrospectionCorpusReport,
  type NodeLevel5FrameworkIntrospectionCorpusRow,
} from "../node-level5-framework-introspection-corpus.ts";

describe("Node Level 5 framework introspection corpus", () => {
  it("verifies candidate framework introspection rows without raising claims", () => {
    const report = writeReport();

    expect(report).toMatchObject({
      accepted: true,
      rowCount: 16,
      claimChangeAllowed: false,
      currentNodeProductSupportClaimed: 85,
      currentBroadNodeProductSupportClaimed: 25,
      candidateNodeProductSupportClaimed: 90,
      candidateBroadNodeProductSupportClaimed: 30,
      candidateArbitraryProcessCrossArchRestoreClaimed: 0,
    });
    expect(verifyNodeLevel5FrameworkIntrospectionCorpusReport(report)).toMatchObject({
      accepted: true,
      rowsSha256Verified: true,
    });
  });

  it("round-trips report files", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-framework-introspection-"));
    const path = join(dir, "report.json");
    try {
      writeNodeLevel5FrameworkIntrospectionCorpusReport({ path, rows: rows() });
      expect(
        verifyNodeLevel5FrameworkIntrospectionCorpusReport(
          loadNodeLevel5FrameworkIntrospectionCorpusReport(path),
        ),
      ).toMatchObject({ accepted: true, rowCount: 16 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function writeReport() {
  const dir = mkdtempSync(join(tmpdir(), "machinen-framework-introspection-report-"));
  try {
    return writeNodeLevel5FrameworkIntrospectionCorpusReport({
      path: join(dir, "report.json"),
      rows: rows(),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
