import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import type { NodeLevel5ProductSnapshotDirection } from "./node-level5-product-snapshot.ts";

export const NODE_LEVEL5_REAL_APP_CORPUS_REPORT_KIND =
  "machinen.node-level5-real-app-corpus-report";
export const NODE_LEVEL5_REAL_APP_CORPUS_REPORT_VERSION = 1;

export type NodeLevel5RealAppCorpusFramework = "express" | "fastify";

export type NodeLevel5RealAppCorpusRow = {
  framework: NodeLevel5RealAppCorpusFramework;
  direction: NodeLevel5ProductSnapshotDirection;
  routePath: string;
  expectedStatus: number;
  actualStatus: number;
  expectedBody: string;
  actualBody: string;
  expectedHeaders: Record<string, string>;
  actualHeaders: Record<string, string>;
  snapshotAccepted: boolean;
  restoreAccepted: boolean;
  behavioralVerifierPassed: boolean;
  targetNativeNodeVerified: boolean;
};

export type NodeLevel5RealAppCorpusReport = {
  kind: typeof NODE_LEVEL5_REAL_APP_CORPUS_REPORT_KIND;
  version: typeof NODE_LEVEL5_REAL_APP_CORPUS_REPORT_VERSION;
  accepted: boolean;
  rowCount: number;
  rowsSha256: string;
  rows: NodeLevel5RealAppCorpusRow[];
  harnessProof: true;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5RealAppCorpusVerification = {
  accepted: boolean;
  kind: "machinen.node-level5-real-app-corpus-verification";
  rowCount: number;
  rowsSha256Verified: boolean;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export function createNodeLevel5RealAppCorpusReport(
  rows: NodeLevel5RealAppCorpusRow[],
): NodeLevel5RealAppCorpusReport {
  return {
    kind: NODE_LEVEL5_REAL_APP_CORPUS_REPORT_KIND,
    version: NODE_LEVEL5_REAL_APP_CORPUS_REPORT_VERSION,
    accepted: rows.every(isAcceptedRealAppCorpusRow),
    rowCount: rows.length,
    rowsSha256: sha256Json(rows),
    rows,
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function writeNodeLevel5RealAppCorpusReport(input: {
  path: string;
  rows: NodeLevel5RealAppCorpusRow[];
}): NodeLevel5RealAppCorpusReport {
  const report = createNodeLevel5RealAppCorpusReport(input.rows);
  writeFileSync(input.path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyNodeLevel5RealAppCorpusReport(
  report: NodeLevel5RealAppCorpusReport,
): NodeLevel5RealAppCorpusVerification {
  const rowsSha256Verified = report.rowsSha256 === sha256Json(report.rows);
  return {
    accepted:
      report.kind === NODE_LEVEL5_REAL_APP_CORPUS_REPORT_KIND &&
      report.version === NODE_LEVEL5_REAL_APP_CORPUS_REPORT_VERSION &&
      report.accepted === true &&
      report.harnessProof === true &&
      report.nodeProductSupportClaimed === 80 &&
      report.broadNodeProductSupportClaimed === 20 &&
      report.arbitraryProcessCrossArchRestoreClaimed === 0 &&
      rowsSha256Verified,
    kind: "machinen.node-level5-real-app-corpus-verification",
    rowCount: report.rows.length,
    rowsSha256Verified,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function loadNodeLevel5RealAppCorpusReport(path: string): NodeLevel5RealAppCorpusReport {
  return JSON.parse(readFileSync(path, "utf8")) as NodeLevel5RealAppCorpusReport;
}

function isAcceptedRealAppCorpusRow(row: NodeLevel5RealAppCorpusRow): boolean {
  return (
    row.snapshotAccepted &&
    row.restoreAccepted &&
    row.behavioralVerifierPassed &&
    row.targetNativeNodeVerified &&
    row.actualStatus === row.expectedStatus &&
    row.actualBody === row.expectedBody &&
    Object.entries(row.expectedHeaders).every(([key, value]) => row.actualHeaders[key] === value)
  );
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
