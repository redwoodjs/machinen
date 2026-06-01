import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  verifyNodeLevel5GenericVmCorpusReport,
  type NodeLevel5GenericVmCorpusReport,
  type NodeLevel5GenericVmRefusalMarker,
  type NodeLevel5GenericVmRefusalRow,
} from "./node-level5-generic-vm-corpus.ts";

export const NODE_LEVEL5_GENERIC_VM_REFUSAL_ARTIFACTS_REPORT_KIND =
  "machinen.node-level5-generic-vm-refusal-artifacts-report";
export const NODE_LEVEL5_GENERIC_VM_REFUSAL_ARTIFACTS_REPORT_VERSION = 1;

export type NodeLevel5GenericVmRefusalArtifactFile = {
  rowId: string;
  framework: NodeLevel5GenericVmRefusalRow["framework"];
  marker: NodeLevel5GenericVmRefusalMarker;
  direction: NodeLevel5GenericVmRefusalRow["direction"];
  expectedRefusalCode: NodeLevel5GenericVmRefusalRow["expectedRefusalCode"];
  path: string;
  sha256: string;
  required: true;
};

export type NodeLevel5GenericVmRefusalArtifactsReport = {
  kind: typeof NODE_LEVEL5_GENERIC_VM_REFUSAL_ARTIFACTS_REPORT_KIND;
  version: typeof NODE_LEVEL5_GENERIC_VM_REFUSAL_ARTIFACTS_REPORT_VERSION;
  accepted: boolean;
  refusalRowCount: number;
  refusalArtifactFiles: NodeLevel5GenericVmRefusalArtifactFile[];
  refusalArtifactFileCount: number;
  refusalArtifactFilesSha256: string;
  markersCovered: NodeLevel5GenericVmRefusalMarker[];
  claimChangeAllowed: false;
  candidateNodeProductSupportClaimed: 85;
  candidateBroadNodeProductSupportClaimed: 25;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5GenericVmRefusalArtifactsVerification = {
  accepted: boolean;
  kind: "machinen.node-level5-generic-vm-refusal-artifacts-verification";
  refusalArtifactFileCount: number;
  markersCovered: NodeLevel5GenericVmRefusalMarker[];
  refusalArtifactFilesSha256Verified: boolean;
  claimChangeAllowed: false;
  candidateNodeProductSupportClaimed: 85;
  candidateBroadNodeProductSupportClaimed: 25;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

const requiredMarkers: NodeLevel5GenericVmRefusalMarker[] = [
  "activeRequests",
  "workerThreads",
  "nativeAddons",
  "tlsActiveState",
  "childProcesses",
];

export function createNodeLevel5GenericVmRefusalArtifactsReport(input: {
  corpusReport: NodeLevel5GenericVmCorpusReport;
  outDir: string;
}): NodeLevel5GenericVmRefusalArtifactsReport {
  const corpusVerification = verifyNodeLevel5GenericVmCorpusReport(input.corpusReport);
  const refusalRows = input.corpusReport.rows.filter((row) => row.kind === "refusal");
  const artifactDir = join(input.outDir, "generic-vm-refusal-artifacts");
  mkdirSync(artifactDir, { recursive: true });
  const refusalArtifactFiles = refusalRows.map((row) => writeRefusalArtifact(artifactDir, row));
  const markersCovered = uniqueMarkers(refusalArtifactFiles);
  return {
    kind: NODE_LEVEL5_GENERIC_VM_REFUSAL_ARTIFACTS_REPORT_KIND,
    version: NODE_LEVEL5_GENERIC_VM_REFUSAL_ARTIFACTS_REPORT_VERSION,
    accepted:
      corpusVerification.accepted &&
      refusalRows.length === 20 &&
      refusalArtifactFiles.length === 20 &&
      hasAllRequiredMarkers(markersCovered),
    refusalRowCount: refusalRows.length,
    refusalArtifactFiles,
    refusalArtifactFileCount: refusalArtifactFiles.length,
    refusalArtifactFilesSha256: sha256Json(refusalArtifactFiles),
    markersCovered,
    claimChangeAllowed: false,
    candidateNodeProductSupportClaimed: 85,
    candidateBroadNodeProductSupportClaimed: 25,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function writeNodeLevel5GenericVmRefusalArtifactsReport(input: {
  corpusReport: NodeLevel5GenericVmCorpusReport;
  outDir: string;
  path: string;
}): NodeLevel5GenericVmRefusalArtifactsReport {
  const report = createNodeLevel5GenericVmRefusalArtifactsReport({
    corpusReport: input.corpusReport,
    outDir: input.outDir,
  });
  writeFileSync(input.path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyNodeLevel5GenericVmRefusalArtifactsReport(
  report: NodeLevel5GenericVmRefusalArtifactsReport,
): NodeLevel5GenericVmRefusalArtifactsVerification {
  const refusalArtifactFilesSha256Verified =
    report.refusalArtifactFilesSha256 === sha256Json(report.refusalArtifactFiles);
  const markersCovered = uniqueMarkers(report.refusalArtifactFiles);
  const rowIds = new Set(report.refusalArtifactFiles.map((file) => file.rowId));
  return {
    accepted:
      report.kind === NODE_LEVEL5_GENERIC_VM_REFUSAL_ARTIFACTS_REPORT_KIND &&
      report.version === NODE_LEVEL5_GENERIC_VM_REFUSAL_ARTIFACTS_REPORT_VERSION &&
      report.accepted === true &&
      report.refusalRowCount === 20 &&
      report.refusalArtifactFileCount === 20 &&
      report.refusalArtifactFiles.length === 20 &&
      rowIds.size === 20 &&
      hasAllRequiredMarkers(markersCovered) &&
      report.claimChangeAllowed === false &&
      report.candidateNodeProductSupportClaimed === 85 &&
      report.candidateBroadNodeProductSupportClaimed === 25 &&
      report.nodeProductSupportClaimed === 80 &&
      report.broadNodeProductSupportClaimed === 20 &&
      report.arbitraryProcessCrossArchRestoreClaimed === 0 &&
      refusalArtifactFilesSha256Verified,
    kind: "machinen.node-level5-generic-vm-refusal-artifacts-verification",
    refusalArtifactFileCount: report.refusalArtifactFiles.length,
    markersCovered,
    refusalArtifactFilesSha256Verified,
    claimChangeAllowed: false,
    candidateNodeProductSupportClaimed: 85,
    candidateBroadNodeProductSupportClaimed: 25,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function loadNodeLevel5GenericVmRefusalArtifactsReport(
  path: string,
): NodeLevel5GenericVmRefusalArtifactsReport {
  return JSON.parse(readFileSync(path, "utf8")) as NodeLevel5GenericVmRefusalArtifactsReport;
}

function writeRefusalArtifact(
  artifactDir: string,
  row: NodeLevel5GenericVmRefusalRow,
): NodeLevel5GenericVmRefusalArtifactFile {
  const path = join("generic-vm-refusal-artifacts", `${row.id}.json`);
  const fullPath = join(artifactDir, `${row.id}.json`);
  const artifact = {
    kind: "machinen.node-level5-generic-vm-refusal-artifact",
    rowId: row.id,
    framework: row.framework,
    marker: row.marker,
    direction: row.direction,
    expectedRefusalCode: row.expectedRefusalCode,
    actualRefusalCode: row.actualRefusalCode,
    refusedBeforeSnapshot: row.refusedBeforeSnapshot,
    restoreAttempted: row.restoreAttempted,
    claimChangeAllowed: false,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  const content = `${JSON.stringify(artifact, null, 2)}\n`;
  writeFileSync(fullPath, content);
  return {
    rowId: row.id,
    framework: row.framework,
    marker: row.marker,
    direction: row.direction,
    expectedRefusalCode: row.expectedRefusalCode,
    path,
    sha256: sha256String(content),
    required: true,
  };
}

function uniqueMarkers(
  files: NodeLevel5GenericVmRefusalArtifactFile[],
): NodeLevel5GenericVmRefusalMarker[] {
  return [...new Set(files.map((file) => file.marker))].sort();
}

function hasAllRequiredMarkers(markers: NodeLevel5GenericVmRefusalMarker[]): boolean {
  return requiredMarkers.every((marker) => markers.includes(marker));
}

function sha256String(value: string): string {
  return createHash("sha256").update(Buffer.from(value)).digest("hex");
}

function sha256Json(value: unknown): string {
  const serialized = JSON.stringify(value);
  return sha256String(serialized);
}
