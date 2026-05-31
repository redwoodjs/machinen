import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import type { NodeLevel5ProductSnapshotDirection } from "./node-level5-product-snapshot.ts";
import type { NodeLevel5RealAppCorpusFramework } from "./node-level5-real-app-corpus.ts";

export const NODE_LEVEL5_THIRD_PARTY_APP_CORPUS_REPORT_KIND =
  "machinen.node-level5-third-party-app-corpus-report";
export const NODE_LEVEL5_THIRD_PARTY_APP_CORPUS_REPORT_VERSION = 1;

export type NodeLevel5ThirdPartyAppSource =
  | "express-official-hello-world"
  | "express-generator-router"
  | "fastify-official-getting-started"
  | "fastify-plugin-route";

export type NodeLevel5ThirdPartyAppCorpusRow = {
  appName: string;
  source: NodeLevel5ThirdPartyAppSource;
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
  declaredSubset: true;
  unsupportedStateDetected: false;
};

export type NodeLevel5ThirdPartyAppCorpusReport = {
  kind: typeof NODE_LEVEL5_THIRD_PARTY_APP_CORPUS_REPORT_KIND;
  version: typeof NODE_LEVEL5_THIRD_PARTY_APP_CORPUS_REPORT_VERSION;
  accepted: boolean;
  rowCount: number;
  rowsSha256: string;
  rows: NodeLevel5ThirdPartyAppCorpusRow[];
  harnessProof: true;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5ThirdPartyAppCorpusVerification = {
  accepted: boolean;
  kind: "machinen.node-level5-third-party-app-corpus-verification";
  rowCount: number;
  rowsSha256Verified: boolean;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export function createNodeLevel5ThirdPartyAppCorpusReport(
  rows: NodeLevel5ThirdPartyAppCorpusRow[],
): NodeLevel5ThirdPartyAppCorpusReport {
  return {
    kind: NODE_LEVEL5_THIRD_PARTY_APP_CORPUS_REPORT_KIND,
    version: NODE_LEVEL5_THIRD_PARTY_APP_CORPUS_REPORT_VERSION,
    accepted: rows.every(isAcceptedThirdPartyAppCorpusRow),
    rowCount: rows.length,
    rowsSha256: sha256Json(rows),
    rows,
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function writeNodeLevel5ThirdPartyAppCorpusReport(input: {
  path: string;
  rows: NodeLevel5ThirdPartyAppCorpusRow[];
}): NodeLevel5ThirdPartyAppCorpusReport {
  const report = createNodeLevel5ThirdPartyAppCorpusReport(input.rows);
  writeFileSync(input.path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyNodeLevel5ThirdPartyAppCorpusReport(
  report: NodeLevel5ThirdPartyAppCorpusReport,
): NodeLevel5ThirdPartyAppCorpusVerification {
  const rowsSha256Verified = report.rowsSha256 === sha256Json(report.rows);
  return {
    accepted:
      report.kind === NODE_LEVEL5_THIRD_PARTY_APP_CORPUS_REPORT_KIND &&
      report.version === NODE_LEVEL5_THIRD_PARTY_APP_CORPUS_REPORT_VERSION &&
      report.accepted === true &&
      report.harnessProof === true &&
      report.nodeProductSupportClaimed === 80 &&
      report.broadNodeProductSupportClaimed === 20 &&
      report.arbitraryProcessCrossArchRestoreClaimed === 0 &&
      rowsSha256Verified,
    kind: "machinen.node-level5-third-party-app-corpus-verification",
    rowCount: report.rows.length,
    rowsSha256Verified,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function loadNodeLevel5ThirdPartyAppCorpusReport(
  path: string,
): NodeLevel5ThirdPartyAppCorpusReport {
  return JSON.parse(readFileSync(path, "utf8")) as NodeLevel5ThirdPartyAppCorpusReport;
}

function isAcceptedThirdPartyAppCorpusRow(row: NodeLevel5ThirdPartyAppCorpusRow): boolean {
  return (
    row.snapshotAccepted &&
    row.restoreAccepted &&
    row.behavioralVerifierPassed &&
    row.targetNativeNodeVerified &&
    row.declaredSubset === true &&
    row.unsupportedStateDetected === false &&
    row.actualStatus === row.expectedStatus &&
    row.actualBody === row.expectedBody &&
    Object.entries(row.expectedHeaders).every(([key, value]) => row.actualHeaders[key] === value)
  );
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
