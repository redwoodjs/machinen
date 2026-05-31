import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import type {
  NodeLevel5ProductSnapshotDirection,
  NodeLevel5ProductSnapshotRefusalCode,
} from "./node-level5-product-snapshot.ts";
import type { NodeLevel5RealAppCorpusFramework } from "./node-level5-real-app-corpus.ts";

export const NODE_LEVEL5_REAL_APP_REFUSAL_CORPUS_REPORT_KIND =
  "machinen.node-level5-real-app-refusal-corpus-report";
export const NODE_LEVEL5_REAL_APP_REFUSAL_CORPUS_REPORT_VERSION = 1;

export type NodeLevel5RealAppRefusalMarker =
  | "activeRequests"
  | "workerThreads"
  | "nativeAddons"
  | "wasmExternalMemory"
  | "tlsActiveState"
  | "childProcesses"
  | "filesystemWatchers"
  | "websockets"
  | "dbConnections"
  | "redisQueueConnections"
  | "outboundHttpSockets"
  | "http2Sessions"
  | "serverSentEvents"
  | "openWritableFiles"
  | "timersIntervals"
  | "clusterMode";

export type NodeLevel5RealAppRefusalCorpusRow = {
  framework: NodeLevel5RealAppCorpusFramework;
  direction: NodeLevel5ProductSnapshotDirection;
  marker: NodeLevel5RealAppRefusalMarker;
  expectedRefusalCode: NodeLevel5ProductSnapshotRefusalCode;
  actualRefusalCode: NodeLevel5ProductSnapshotRefusalCode;
  snapshotAccepted: false;
  snapshotManifestWritten: false;
  refusedBeforeSnapshot: true;
  productCommandPath: "machinen snapshot node <pid> --out <dir>";
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  metadataOnlySuccessAccepted: false;
};

export type NodeLevel5RealAppRefusalCorpusReport = {
  kind: typeof NODE_LEVEL5_REAL_APP_REFUSAL_CORPUS_REPORT_KIND;
  version: typeof NODE_LEVEL5_REAL_APP_REFUSAL_CORPUS_REPORT_VERSION;
  accepted: boolean;
  rowCount: number;
  rowsSha256: string;
  rows: NodeLevel5RealAppRefusalCorpusRow[];
  harnessProof: true;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5RealAppRefusalCorpusVerification = {
  accepted: boolean;
  kind: "machinen.node-level5-real-app-refusal-corpus-verification";
  rowCount: number;
  rowsSha256Verified: boolean;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export function createNodeLevel5RealAppRefusalCorpusReport(
  rows: NodeLevel5RealAppRefusalCorpusRow[],
): NodeLevel5RealAppRefusalCorpusReport {
  return {
    kind: NODE_LEVEL5_REAL_APP_REFUSAL_CORPUS_REPORT_KIND,
    version: NODE_LEVEL5_REAL_APP_REFUSAL_CORPUS_REPORT_VERSION,
    accepted: rows.every(isAcceptedRealAppRefusalCorpusRow),
    rowCount: rows.length,
    rowsSha256: sha256Json(rows),
    rows,
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function writeNodeLevel5RealAppRefusalCorpusReport(input: {
  path: string;
  rows: NodeLevel5RealAppRefusalCorpusRow[];
}): NodeLevel5RealAppRefusalCorpusReport {
  const report = createNodeLevel5RealAppRefusalCorpusReport(input.rows);
  writeFileSync(input.path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyNodeLevel5RealAppRefusalCorpusReport(
  report: NodeLevel5RealAppRefusalCorpusReport,
): NodeLevel5RealAppRefusalCorpusVerification {
  const rowsSha256Verified = report.rowsSha256 === sha256Json(report.rows);
  return {
    accepted:
      report.kind === NODE_LEVEL5_REAL_APP_REFUSAL_CORPUS_REPORT_KIND &&
      report.version === NODE_LEVEL5_REAL_APP_REFUSAL_CORPUS_REPORT_VERSION &&
      report.accepted === true &&
      report.harnessProof === true &&
      report.nodeProductSupportClaimed === 80 &&
      report.broadNodeProductSupportClaimed === 20 &&
      report.arbitraryProcessCrossArchRestoreClaimed === 0 &&
      rowsSha256Verified,
    kind: "machinen.node-level5-real-app-refusal-corpus-verification",
    rowCount: report.rows.length,
    rowsSha256Verified,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function loadNodeLevel5RealAppRefusalCorpusReport(
  path: string,
): NodeLevel5RealAppRefusalCorpusReport {
  return JSON.parse(readFileSync(path, "utf8")) as NodeLevel5RealAppRefusalCorpusReport;
}

function isAcceptedRealAppRefusalCorpusRow(row: NodeLevel5RealAppRefusalCorpusRow): boolean {
  return (
    row.actualRefusalCode === row.expectedRefusalCode &&
    row.snapshotAccepted === false &&
    row.snapshotManifestWritten === false &&
    row.refusedBeforeSnapshot === true &&
    row.rawCpuRestoreUsed === false &&
    row.sourceIsaEmulationUsed === false &&
    row.metadataOnlySuccessAccepted === false &&
    row.productCommandPath === "machinen snapshot node <pid> --out <dir>"
  );
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
