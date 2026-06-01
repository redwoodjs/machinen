import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import type { NodeLevel5FrameworkCapabilityFramework } from "./node-level5-framework-capability-matrix.ts";
import type { NodeLevel5ProductSnapshotDirection } from "./node-level5-product-snapshot.ts";

export const NODE_LEVEL5_FRAMEWORK_INTROSPECTION_CORPUS_REPORT_KIND =
  "machinen.node-level5-framework-introspection-corpus-report";
export const NODE_LEVEL5_FRAMEWORK_INTROSPECTION_CORPUS_REPORT_VERSION = 1;

export type NodeLevel5FrameworkIntrospectionCapability =
  | "route-graph"
  | "middleware-hook-graph"
  | "plugin-graph"
  | "idle-lifecycle-state";

export type NodeLevel5FrameworkIntrospectionCorpusRow = {
  id: string;
  framework: NodeLevel5FrameworkCapabilityFramework;
  capability: NodeLevel5FrameworkIntrospectionCapability;
  direction: NodeLevel5ProductSnapshotDirection;
  productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>";
  vmDetectedNodeWorkload: true;
  frameworkMetadataCapturedInsideVm: true;
  retainedFrameworkGraphArtifact: true;
  targetNativeRestoreProbePassed: true;
  arbitraryFrameworkClaimed: false;
  arbitraryNodeClaimed: false;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5FrameworkIntrospectionCorpusReport = {
  kind: typeof NODE_LEVEL5_FRAMEWORK_INTROSPECTION_CORPUS_REPORT_KIND;
  version: typeof NODE_LEVEL5_FRAMEWORK_INTROSPECTION_CORPUS_REPORT_VERSION;
  accepted: boolean;
  rowCount: number;
  rowsSha256: string;
  rows: NodeLevel5FrameworkIntrospectionCorpusRow[];
  claimChangeAllowed: false;
  currentNodeProductSupportClaimed: 85;
  currentBroadNodeProductSupportClaimed: 25;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateNodeProductSupportClaimed: 90;
  candidateBroadNodeProductSupportClaimed: 30;
  candidateArbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5FrameworkIntrospectionCorpusVerification = {
  accepted: boolean;
  kind: "machinen.node-level5-framework-introspection-corpus-verification";
  rowCount: number;
  rowsSha256Verified: boolean;
  claimChangeAllowed: false;
  currentNodeProductSupportClaimed: 85;
  currentBroadNodeProductSupportClaimed: 25;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateNodeProductSupportClaimed: 90;
  candidateBroadNodeProductSupportClaimed: 30;
  candidateArbitraryProcessCrossArchRestoreClaimed: 0;
};

export function createNodeLevel5FrameworkIntrospectionCorpusReport(
  rows: NodeLevel5FrameworkIntrospectionCorpusRow[],
): NodeLevel5FrameworkIntrospectionCorpusReport {
  return {
    kind: NODE_LEVEL5_FRAMEWORK_INTROSPECTION_CORPUS_REPORT_KIND,
    version: NODE_LEVEL5_FRAMEWORK_INTROSPECTION_CORPUS_REPORT_VERSION,
    accepted: rows.every(isAcceptedRow),
    rowCount: rows.length,
    rowsSha256: sha256Json(rows),
    rows,
    claimChangeAllowed: false,
    currentNodeProductSupportClaimed: 85,
    currentBroadNodeProductSupportClaimed: 25,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateNodeProductSupportClaimed: 90,
    candidateBroadNodeProductSupportClaimed: 30,
    candidateArbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function writeNodeLevel5FrameworkIntrospectionCorpusReport(input: {
  path: string;
  rows: NodeLevel5FrameworkIntrospectionCorpusRow[];
}): NodeLevel5FrameworkIntrospectionCorpusReport {
  const report = createNodeLevel5FrameworkIntrospectionCorpusReport(input.rows);
  writeFileSync(input.path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyNodeLevel5FrameworkIntrospectionCorpusReport(
  report: NodeLevel5FrameworkIntrospectionCorpusReport,
): NodeLevel5FrameworkIntrospectionCorpusVerification {
  const rowsSha256Verified = report.rowsSha256 === sha256Json(report.rows);
  return {
    accepted:
      report.kind === NODE_LEVEL5_FRAMEWORK_INTROSPECTION_CORPUS_REPORT_KIND &&
      report.version === NODE_LEVEL5_FRAMEWORK_INTROSPECTION_CORPUS_REPORT_VERSION &&
      report.accepted === true &&
      report.rowCount === report.rows.length &&
      report.rowCount === 16 &&
      report.claimChangeAllowed === false &&
      report.currentNodeProductSupportClaimed === 85 &&
      report.currentBroadNodeProductSupportClaimed === 25 &&
      report.currentArbitraryProcessCrossArchRestoreClaimed === 0 &&
      report.candidateNodeProductSupportClaimed === 90 &&
      report.candidateBroadNodeProductSupportClaimed === 30 &&
      report.candidateArbitraryProcessCrossArchRestoreClaimed === 0 &&
      rowsSha256Verified,
    kind: "machinen.node-level5-framework-introspection-corpus-verification",
    rowCount: report.rows.length,
    rowsSha256Verified,
    claimChangeAllowed: false,
    currentNodeProductSupportClaimed: 85,
    currentBroadNodeProductSupportClaimed: 25,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateNodeProductSupportClaimed: 90,
    candidateBroadNodeProductSupportClaimed: 30,
    candidateArbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function loadNodeLevel5FrameworkIntrospectionCorpusReport(
  path: string,
): NodeLevel5FrameworkIntrospectionCorpusReport {
  return JSON.parse(readFileSync(path, "utf8")) as NodeLevel5FrameworkIntrospectionCorpusReport;
}

function isAcceptedRow(row: NodeLevel5FrameworkIntrospectionCorpusRow): boolean {
  return (
    row.productCommandPath === "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>" &&
    row.vmDetectedNodeWorkload === true &&
    row.frameworkMetadataCapturedInsideVm === true &&
    row.retainedFrameworkGraphArtifact === true &&
    row.targetNativeRestoreProbePassed === true &&
    row.arbitraryFrameworkClaimed === false &&
    row.arbitraryNodeClaimed === false &&
    row.arbitraryProcessCrossArchRestoreClaimed === 0
  );
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
