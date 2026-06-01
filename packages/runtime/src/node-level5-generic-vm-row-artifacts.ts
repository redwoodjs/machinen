import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  verifyNodeLevel5GenericVmCorpusReport,
  type NodeLevel5GenericVmCorpusReport,
  type NodeLevel5GenericVmCorpusRow,
} from "./node-level5-generic-vm-corpus.ts";

export const NODE_LEVEL5_GENERIC_VM_ROW_ARTIFACTS_REPORT_KIND =
  "machinen.node-level5-generic-vm-row-artifacts-report";
export const NODE_LEVEL5_GENERIC_VM_ROW_ARTIFACTS_REPORT_VERSION = 1;

export type NodeLevel5GenericVmRowArtifactFile = {
  rowId: string;
  rowKind: NodeLevel5GenericVmCorpusRow["kind"];
  path: string;
  sha256: string;
  required: true;
};

export type NodeLevel5GenericVmRowArtifactsReport = {
  kind: typeof NODE_LEVEL5_GENERIC_VM_ROW_ARTIFACTS_REPORT_KIND;
  version: typeof NODE_LEVEL5_GENERIC_VM_ROW_ARTIFACTS_REPORT_VERSION;
  accepted: boolean;
  rowCount: number;
  positiveRowCount: number;
  refusalRowCount: number;
  rowArtifactFiles: NodeLevel5GenericVmRowArtifactFile[];
  rowArtifactFileCount: number;
  rowArtifactFilesSha256: string;
  claimChangeAllowed: false;
  candidateNodeProductSupportClaimed: 85;
  candidateBroadNodeProductSupportClaimed: 25;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5GenericVmRowArtifactsVerification = {
  accepted: boolean;
  kind: "machinen.node-level5-generic-vm-row-artifacts-verification";
  rowCount: number;
  positiveRowCount: number;
  refusalRowCount: number;
  rowArtifactFileCount: number;
  rowArtifactFilesSha256Verified: boolean;
  claimChangeAllowed: false;
  candidateNodeProductSupportClaimed: 85;
  candidateBroadNodeProductSupportClaimed: 25;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export function createNodeLevel5GenericVmRowArtifactsReport(input: {
  corpusReport: NodeLevel5GenericVmCorpusReport;
  outDir: string;
}): NodeLevel5GenericVmRowArtifactsReport {
  const corpusVerification = verifyNodeLevel5GenericVmCorpusReport(input.corpusReport);
  const artifactDir = join(input.outDir, "generic-vm-row-artifacts");
  mkdirSync(artifactDir, { recursive: true });
  const rowArtifactFiles = input.corpusReport.rows.map((row) => writeRowArtifact(artifactDir, row));
  const positiveRowCount = input.corpusReport.rows.filter((row) => row.kind === "positive").length;
  const refusalRowCount = input.corpusReport.rows.filter((row) => row.kind === "refusal").length;
  return {
    kind: NODE_LEVEL5_GENERIC_VM_ROW_ARTIFACTS_REPORT_KIND,
    version: NODE_LEVEL5_GENERIC_VM_ROW_ARTIFACTS_REPORT_VERSION,
    accepted:
      corpusVerification.accepted && rowArtifactFiles.length === input.corpusReport.rows.length,
    rowCount: input.corpusReport.rows.length,
    positiveRowCount,
    refusalRowCount,
    rowArtifactFiles,
    rowArtifactFileCount: rowArtifactFiles.length,
    rowArtifactFilesSha256: sha256Json(rowArtifactFiles),
    claimChangeAllowed: false,
    candidateNodeProductSupportClaimed: 85,
    candidateBroadNodeProductSupportClaimed: 25,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function writeNodeLevel5GenericVmRowArtifactsReport(input: {
  corpusReport: NodeLevel5GenericVmCorpusReport;
  outDir: string;
  path: string;
}): NodeLevel5GenericVmRowArtifactsReport {
  const report = createNodeLevel5GenericVmRowArtifactsReport({
    corpusReport: input.corpusReport,
    outDir: input.outDir,
  });
  writeFileSync(input.path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyNodeLevel5GenericVmRowArtifactsReport(
  report: NodeLevel5GenericVmRowArtifactsReport,
): NodeLevel5GenericVmRowArtifactsVerification {
  const rowArtifactFilesSha256Verified =
    report.rowArtifactFilesSha256 === sha256Json(report.rowArtifactFiles);
  const positiveRowCount = report.rowArtifactFiles.filter(
    (file) => file.rowKind === "positive",
  ).length;
  const refusalRowCount = report.rowArtifactFiles.filter(
    (file) => file.rowKind === "refusal",
  ).length;
  const rowIds = new Set(report.rowArtifactFiles.map((file) => file.rowId));
  return {
    accepted:
      report.kind === NODE_LEVEL5_GENERIC_VM_ROW_ARTIFACTS_REPORT_KIND &&
      report.version === NODE_LEVEL5_GENERIC_VM_ROW_ARTIFACTS_REPORT_VERSION &&
      report.accepted === true &&
      report.rowCount === 28 &&
      report.positiveRowCount === 8 &&
      report.refusalRowCount === 20 &&
      report.rowArtifactFileCount === 28 &&
      report.rowArtifactFiles.length === 28 &&
      rowIds.size === 28 &&
      positiveRowCount === 8 &&
      refusalRowCount === 20 &&
      report.claimChangeAllowed === false &&
      report.candidateNodeProductSupportClaimed === 85 &&
      report.candidateBroadNodeProductSupportClaimed === 25 &&
      report.nodeProductSupportClaimed === 80 &&
      report.broadNodeProductSupportClaimed === 20 &&
      report.arbitraryProcessCrossArchRestoreClaimed === 0 &&
      rowArtifactFilesSha256Verified,
    kind: "machinen.node-level5-generic-vm-row-artifacts-verification",
    rowCount: report.rowCount,
    positiveRowCount,
    refusalRowCount,
    rowArtifactFileCount: report.rowArtifactFiles.length,
    rowArtifactFilesSha256Verified,
    claimChangeAllowed: false,
    candidateNodeProductSupportClaimed: 85,
    candidateBroadNodeProductSupportClaimed: 25,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function loadNodeLevel5GenericVmRowArtifactsReport(
  path: string,
): NodeLevel5GenericVmRowArtifactsReport {
  return JSON.parse(readFileSync(path, "utf8")) as NodeLevel5GenericVmRowArtifactsReport;
}

function writeRowArtifact(
  artifactDir: string,
  row: NodeLevel5GenericVmCorpusRow,
): NodeLevel5GenericVmRowArtifactFile {
  const path = join("generic-vm-row-artifacts", `${row.id}.json`);
  const fullPath = join(artifactDir, `${row.id}.json`);
  const artifact = {
    kind: "machinen.node-level5-generic-vm-row-artifact",
    rowId: row.id,
    rowKind: row.kind,
    row,
    claimChangeAllowed: false,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  const content = `${JSON.stringify(artifact, null, 2)}\n`;
  writeFileSync(fullPath, content);
  return { rowId: row.id, rowKind: row.kind, path, sha256: sha256String(content), required: true };
}

function sha256String(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
