import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import type {
  NodeLevel5ProductSnapshotDirection,
  NodeLevel5ProductSnapshotRefusalCode,
} from "./node-level5-product-snapshot.ts";
import type { NodeLevel5RealAppCorpusFramework } from "./node-level5-real-app-corpus.ts";

export const NODE_LEVEL5_GENERIC_VM_CORPUS_REPORT_KIND =
  "machinen.node-level5-generic-vm-corpus-report";
export const NODE_LEVEL5_GENERIC_VM_CORPUS_REPORT_VERSION = 1;

export type NodeLevel5GenericVmModuleSystem = "cjs" | "esm";
export type NodeLevel5GenericVmRefusalMarker =
  | "activeRequests"
  | "workerThreads"
  | "nativeAddons"
  | "tlsActiveState"
  | "childProcesses";

export type NodeLevel5GenericVmPositiveRow = {
  kind: "positive";
  id: string;
  framework: NodeLevel5RealAppCorpusFramework;
  moduleSystem: NodeLevel5GenericVmModuleSystem;
  direction: NodeLevel5ProductSnapshotDirection;
  productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>";
  wholeVmSnapshot: true;
  nodeDetectedInsideVm: true;
  hostPidProductTargetingUsed: false;
  nodeOnlyProductSelectorUsed: false;
  snapshotAccepted: true;
  restoreAccepted: true;
  behaviorVerified: true;
  targetNativeNodeVerified: true;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  metadataOnlySuccessAccepted: false;
};

export type NodeLevel5GenericVmRefusalRow = {
  kind: "refusal";
  id: string;
  framework: NodeLevel5RealAppCorpusFramework;
  marker: NodeLevel5GenericVmRefusalMarker;
  direction: NodeLevel5ProductSnapshotDirection;
  productCommandPath: "machinen snapshot <vm-name> --out <dir>";
  expectedRefusalCode: NodeLevel5ProductSnapshotRefusalCode;
  actualRefusalCode: NodeLevel5ProductSnapshotRefusalCode;
  snapshotAccepted: false;
  restoreAttempted: false;
  refusedBeforeSnapshot: true;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  metadataOnlySuccessAccepted: false;
};

export type NodeLevel5GenericVmCorpusRow =
  | NodeLevel5GenericVmPositiveRow
  | NodeLevel5GenericVmRefusalRow;

export type NodeLevel5GenericVmCorpusReport = {
  kind: typeof NODE_LEVEL5_GENERIC_VM_CORPUS_REPORT_KIND;
  version: typeof NODE_LEVEL5_GENERIC_VM_CORPUS_REPORT_VERSION;
  accepted: boolean;
  rowCount: number;
  positiveRowCount: number;
  refusalRowCount: number;
  rowsSha256: string;
  rows: NodeLevel5GenericVmCorpusRow[];
  claimChangeAllowed: false;
  candidateNodeProductSupportClaimed: 85;
  candidateBroadNodeProductSupportClaimed: 25;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5GenericVmCorpusVerification = {
  accepted: boolean;
  kind: "machinen.node-level5-generic-vm-corpus-verification";
  rowCount: number;
  positiveRowCount: number;
  refusalRowCount: number;
  rowsSha256Verified: boolean;
  claimChangeAllowed: false;
  candidateNodeProductSupportClaimed: 85;
  candidateBroadNodeProductSupportClaimed: 25;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export function createNodeLevel5GenericVmCorpusReport(
  rows: NodeLevel5GenericVmCorpusRow[],
): NodeLevel5GenericVmCorpusReport {
  return {
    kind: NODE_LEVEL5_GENERIC_VM_CORPUS_REPORT_KIND,
    version: NODE_LEVEL5_GENERIC_VM_CORPUS_REPORT_VERSION,
    accepted: rows.every(isAcceptedGenericVmCorpusRow),
    rowCount: rows.length,
    positiveRowCount: rows.filter((row) => row.kind === "positive").length,
    refusalRowCount: rows.filter((row) => row.kind === "refusal").length,
    rowsSha256: sha256Json(rows),
    rows,
    claimChangeAllowed: false,
    candidateNodeProductSupportClaimed: 85,
    candidateBroadNodeProductSupportClaimed: 25,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function writeNodeLevel5GenericVmCorpusReport(input: {
  path: string;
  rows: NodeLevel5GenericVmCorpusRow[];
}): NodeLevel5GenericVmCorpusReport {
  const report = createNodeLevel5GenericVmCorpusReport(input.rows);
  writeFileSync(input.path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyNodeLevel5GenericVmCorpusReport(
  report: NodeLevel5GenericVmCorpusReport,
): NodeLevel5GenericVmCorpusVerification {
  const rowsSha256Verified = report.rowsSha256 === sha256Json(report.rows);
  const rowCount = report.rows.length;
  const positiveRowCount = report.rows.filter((row) => row.kind === "positive").length;
  const refusalRowCount = report.rows.filter((row) => row.kind === "refusal").length;
  return {
    accepted:
      report.kind === NODE_LEVEL5_GENERIC_VM_CORPUS_REPORT_KIND &&
      report.version === NODE_LEVEL5_GENERIC_VM_CORPUS_REPORT_VERSION &&
      report.accepted === true &&
      report.rowCount === rowCount &&
      report.positiveRowCount === positiveRowCount &&
      report.refusalRowCount === refusalRowCount &&
      report.claimChangeAllowed === false &&
      report.candidateNodeProductSupportClaimed === 85 &&
      report.candidateBroadNodeProductSupportClaimed === 25 &&
      report.nodeProductSupportClaimed === 80 &&
      report.broadNodeProductSupportClaimed === 20 &&
      report.arbitraryProcessCrossArchRestoreClaimed === 0 &&
      rowsSha256Verified,
    kind: "machinen.node-level5-generic-vm-corpus-verification",
    rowCount,
    positiveRowCount,
    refusalRowCount,
    rowsSha256Verified,
    claimChangeAllowed: false,
    candidateNodeProductSupportClaimed: 85,
    candidateBroadNodeProductSupportClaimed: 25,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function loadNodeLevel5GenericVmCorpusReport(path: string): NodeLevel5GenericVmCorpusReport {
  return JSON.parse(readFileSync(path, "utf8")) as NodeLevel5GenericVmCorpusReport;
}

function isAcceptedGenericVmCorpusRow(row: NodeLevel5GenericVmCorpusRow): boolean {
  return row.kind === "positive" ? isAcceptedPositiveRow(row) : isAcceptedRefusalRow(row);
}

function isAcceptedPositiveRow(row: NodeLevel5GenericVmPositiveRow): boolean {
  return (
    row.productCommandPath === "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>" &&
    row.wholeVmSnapshot === true &&
    row.nodeDetectedInsideVm === true &&
    row.hostPidProductTargetingUsed === false &&
    row.nodeOnlyProductSelectorUsed === false &&
    row.snapshotAccepted === true &&
    row.restoreAccepted === true &&
    row.behaviorVerified === true &&
    row.targetNativeNodeVerified === true &&
    row.rawCpuRestoreUsed === false &&
    row.sourceIsaEmulationUsed === false &&
    row.metadataOnlySuccessAccepted === false
  );
}

function isAcceptedRefusalRow(row: NodeLevel5GenericVmRefusalRow): boolean {
  return (
    row.productCommandPath === "machinen snapshot <vm-name> --out <dir>" &&
    row.expectedRefusalCode === row.actualRefusalCode &&
    row.snapshotAccepted === false &&
    row.restoreAttempted === false &&
    row.refusedBeforeSnapshot === true &&
    row.rawCpuRestoreUsed === false &&
    row.sourceIsaEmulationUsed === false &&
    row.metadataOnlySuccessAccepted === false
  );
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
