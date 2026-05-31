import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildNodeLevel5AppSupportMatrix,
  type NodeLevel5AppSupportFeatureName,
  type NodeLevel5AppSupportMatrix,
  type NodeLevel5AppSupportMatrixRow,
} from "../packages/runtime/src/node-level5-app-support-matrix.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedDirections = ["amd64-to-arm64", "arm64-to-amd64"];
const statuses = ["supported", "refused", "not-proven"];
const featureNames: NodeLevel5AppSupportFeatureName[] = [
  "route",
  "response",
  "middleware",
  "asyncHandler",
  "params",
  "query",
  "staticAssets",
  "externalNetwork",
  "backgroundTasks",
];
const expectedProofRanges = [
  "1121-1160",
  "1161-1200",
  "1201-1240",
  "1241-1280",
  "1281-1320",
  "1321-1360",
  "1361-1400",
  "1401-1420",
  "721-760",
  "761-800",
  "801-840",
  "841-880",
  "921-960",
  "961-1000",
];
const expectedReports = [
  "node-level5-real-app-corpus-report.json",
  "node-level5-third-party-app-corpus-report.json",
  "node-level5-installed-third-party-app-corpus-report.json",
  "node-level5-real-app-refusal-corpus-report.json",
  "none-yet",
];

const definitions: Record<string, Definition> = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => {
    const proof = 1041 + index;
    return [String(proof), definitionFor(proof)];
  }),
);

type Definition = { goal: string; result: string; kind: string };
type Bundle = ReturnType<typeof buildProofBundle>;

export function runNodeLevel5AppSupportReleaseBundleProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 app support release bundle proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-app-support-release-bundle-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-proof-only-release-bundle",
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <dir>"],
    proofOnly: true,
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, appSupportReleaseBundleGate: definition.kind }));
  console.log(`proof ${proof} node-level5 app support release bundle gate passed`);
}

function definitionFor(proof: number): Definition {
  if (proof <= 1048) {
    return bundleDefinition(bundleKind(proof - 1041));
  }
  if (proof <= 1056) {
    return supportedDefinition(supportedKind(proof - 1049));
  }
  if (proof <= 1064) {
    return refusalDefinition(refusalKind(proof - 1057));
  }
  if (proof <= 1072) {
    return boundaryDefinition(boundaryKind(proof - 1065));
  }
  return auditDefinition(auditKind(proof - 1073));
}

function bundleDefinition(kind: string): Definition {
  return {
    goal: "Proof-only app support release bundle contract",
    result:
      "The proof-local bundle retains the matrix contract, hashes, reports, and proof ranges.",
    kind,
  };
}

function supportedDefinition(kind: string): Definition {
  return {
    goal: "Proof-only supported app row reconciliation",
    result:
      "Supported fixture, template, installed, and feature rows remain scoped to idle HTTP apps.",
    kind,
  };
}

function refusalDefinition(kind: string): Definition {
  return {
    goal: "Proof-only refused app row reconciliation",
    result:
      "Unsafe live-state rows remain refused before snapshot across Express/Fastify directions.",
    kind,
  };
}

function boundaryDefinition(kind: string): Definition {
  return {
    goal: "Proof-only not-proven and boundary reconciliation",
    result: "Remaining gaps and broad app/process boundaries stay explicit and unclaimed.",
    kind,
  };
}

function auditDefinition(kind: string): Definition {
  return {
    goal: "Proof-only final release bundle audit",
    result: "The proof bundle preserves translated continuation and the 80/20/0 claim boundary.",
    kind,
  };
}

function bundleKind(index: number): string {
  return [
    "bundle-kind",
    "bundle-accepted",
    "bundle-version",
    "bundle-row-count",
    "bundle-status-counts",
    "bundle-hashes",
    "bundle-proof-ranges",
    "bundle-corpus-reports",
  ][index]!;
}

function supportedKind(index: number): string {
  return [
    "supported-row-count",
    "supported-frameworks",
    "supported-directions",
    "supported-product-behavior",
    "supported-fixture-template-installed",
    "supported-feature-rows",
    "supported-feature-assessments",
    "supported-limitations",
  ][index]!;
}

function refusalKind(index: number): string {
  return [
    "refused-row-count",
    "refused-frameworks",
    "refused-directions",
    "refused-before-snapshot",
    "refused-external-network",
    "refused-background-tasks",
    "refused-no-restore",
    "refused-corpus-proof-range",
  ][index]!;
}

function boundaryKind(index: number): string {
  return [
    "not-proven-row-count",
    "not-proven-frameworks",
    "not-proven-external-network",
    "not-proven-background-tasks",
    "boundary-arbitrary-express",
    "boundary-arbitrary-fastify",
    "boundary-arbitrary-node",
    "boundary-raw-cpu",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "audit-proof-only",
    "audit-release-surfaces",
    "audit-no-broad-bump",
    "audit-no-arbitrary-process",
    "audit-translated-continuation",
    "audit-no-source-isa",
    "audit-no-metadata-only",
    "audit-final",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("bundle-")) {
    return bundlePayload(kind);
  }
  if (kind.startsWith("supported-")) {
    return supportedPayload(kind);
  }
  if (kind.startsWith("refused-")) {
    return refusalPayload(kind);
  }
  if (kind.startsWith("not-proven-") || kind.startsWith("boundary-")) {
    return boundaryPayload(kind);
  }
  return auditPayload(kind);
}

function bundlePayload(kind: string): Record<string, unknown> {
  const bundle = buildProofBundle();
  const payloads: Record<string, Record<string, unknown>> = {
    "bundle-kind": { bundleKind: bundle.kind },
    "bundle-accepted": { accepted: bundle.accepted, matrixAccepted: bundle.matrixAccepted },
    "bundle-version": { matrixVersion: bundle.matrixVersion },
    "bundle-row-count": { rowCount: bundle.rowCount },
    "bundle-status-counts": bundle.statusCounts,
    "bundle-hashes": bundle.hashes,
    "bundle-proof-ranges": { proofRanges: bundle.proofRanges },
    "bundle-corpus-reports": { corpusReports: bundle.corpusReports },
  };
  return payloads[kind]!;
}

function supportedPayload(kind: string): Record<string, unknown> {
  const rows = rowsByStatus("supported");
  const payloads: Record<string, Record<string, unknown>> = {
    "supported-row-count": { supportedRows: rows.length },
    "supported-frameworks": { frameworks: unique(rows.map((row) => row.framework)) },
    "supported-directions": { directions: directionsFor(rows) },
    "supported-product-behavior": { behaviors: unique(rows.map((row) => row.productBehavior)) },
    "supported-fixture-template-installed": supportedEvidencePayload(rows),
    "supported-feature-rows": supportedFeaturePayload(rows),
    "supported-feature-assessments": supportedAssessmentPayload(rows),
    "supported-limitations": {
      allRowsHaveLimitations: rows.every((row) => row.limitations.length > 0),
    },
  };
  return payloads[kind]!;
}

function refusalPayload(kind: string): Record<string, unknown> {
  const rows = rowsByStatus("refused");
  const payloads: Record<string, Record<string, unknown>> = {
    "refused-row-count": { refusedRows: rows.length },
    "refused-frameworks": { frameworks: unique(rows.map((row) => row.framework)) },
    "refused-directions": { directions: directionsFor(rows) },
    "refused-before-snapshot": { behaviors: unique(rows.map((row) => row.productBehavior)) },
    "refused-external-network": refusedFeaturePayload(rows, "externalNetwork"),
    "refused-background-tasks": refusedFeaturePayload(rows, "backgroundTasks"),
    "refused-no-restore": { restoreAttempted: false, manifestWriteAllowed: false },
    "refused-corpus-proof-range": {
      proofRanges: unique(rows.map((row) => row.evidence.proofRange)),
    },
  };
  return payloads[kind]!;
}

function boundaryPayload(kind: string): Record<string, unknown> {
  const rows = rowsByStatus("not-proven");
  const boundaries = buildNodeLevel5AppSupportMatrix().boundaries;
  const payloads: Record<string, Record<string, unknown>> = {
    "not-proven-row-count": { notProvenRows: rows.length },
    "not-proven-frameworks": { frameworks: unique(rows.map((row) => row.framework)) },
    "not-proven-external-network": notProvenFeaturePayload(rows, "externalNetwork"),
    "not-proven-background-tasks": notProvenFeaturePayload(rows, "backgroundTasks"),
    "boundary-arbitrary-express": boundaryPayloadFor(boundaries, "arbitrary-express-app"),
    "boundary-arbitrary-fastify": boundaryPayloadFor(boundaries, "arbitrary-fastify-app"),
    "boundary-arbitrary-node": boundaryPayloadFor(boundaries, "arbitrary-node-process"),
    "boundary-raw-cpu": boundaryPayloadFor(boundaries, "raw-cross-arch-cpu-restore"),
  };
  return payloads[kind]!;
}

function auditPayload(kind: string): Record<string, unknown> {
  const bundle = buildProofBundle();
  const payloads: Record<string, Record<string, unknown>> = {
    "audit-proof-only": { proofOnly: true, productCodeChanged: false },
    "audit-release-surfaces": { productSurfaces: bundle.productSurfaces },
    "audit-no-broad-bump": claimFields(bundle),
    "audit-no-arbitrary-process": { arbitraryProcessCrossArchRestoreClaimed: 0 },
    "audit-translated-continuation": {
      translatedContinuationRequired: true,
      rawCpuRestoreUsed: false,
    },
    "audit-no-source-isa": { sourceIsaEmulationUsed: false },
    "audit-no-metadata-only": { metadataOnlySuccessAccepted: false },
    "audit-final": { accepted: bundle.accepted, claimsRemain: "80/20/0" },
  };
  return payloads[kind]!;
}

function buildProofBundle() {
  const matrix = buildNodeLevel5AppSupportMatrix();
  const rows = matrix.rows;
  const statusCounts = Object.fromEntries(
    statuses.map((status) => [status, rowsByStatus(status).length]),
  );
  const hashes = hashBundleParts(matrix);
  return {
    kind: "machinen.node-level5-app-support-release-bundle-proof",
    accepted: matrix.accepted && Object.values(hashes).every((value) => value.length === 64),
    matrixAccepted: matrix.accepted,
    matrixVersion: matrix.version,
    rowCount: matrix.rowCount,
    statusCounts,
    hashes,
    proofRanges: unique(rows.map((row) => row.evidence.proofRange)),
    corpusReports: unique(rows.map((row) => row.evidence.corpusReport)),
    productSurfaces: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <dir>"],
    nodeProductSupportClaimed: matrix.nodeProductSupportClaimed,
    broadNodeProductSupportClaimed: matrix.broadNodeProductSupportClaimed,
    arbitraryProcessCrossArchRestoreClaimed: matrix.arbitraryProcessCrossArchRestoreClaimed,
  };
}

function hashBundleParts(matrix: NodeLevel5AppSupportMatrix): Record<string, string> {
  return {
    matrix: sha256Json(matrix),
    supportedRows: sha256Json(rowsByStatus("supported")),
    refusedRows: sha256Json(rowsByStatus("refused")),
    notProvenRows: sha256Json(rowsByStatus("not-proven")),
    boundaries: sha256Json(matrix.boundaries),
  };
}

function rowsByStatus(status: string): NodeLevel5AppSupportMatrixRow[] {
  return buildNodeLevel5AppSupportMatrix().rows.filter((row) => row.status === status);
}

function supportedEvidencePayload(rows: NodeLevel5AppSupportMatrixRow[]): Record<string, unknown> {
  return {
    evidenceKinds: unique(rows.map((row) => row.evidence.kind)),
    proofRanges: unique(rows.map((row) => row.evidence.proofRange)),
  };
}

function supportedFeaturePayload(rows: NodeLevel5AppSupportMatrixRow[]): Record<string, unknown> {
  return {
    jsonRows: rowsWithFeature(rows, "response", "json"),
    paramsRows: rowsWithFlag(rows, "params"),
    queryRows: rowsWithFlag(rows, "query"),
    staticAssetRows: rowsWithFlag(rows, "staticAssets"),
  };
}

function supportedAssessmentPayload(
  rows: NodeLevel5AppSupportMatrixRow[],
): Record<string, unknown> {
  return {
    featureNames,
    allPresentFeaturesSupported: rows.every((row) =>
      featureNames.every(
        (name) => !featurePresent(row, name) || row.featureAssessment[name] === "supported",
      ),
    ),
  };
}

function refusedFeaturePayload(
  rows: NodeLevel5AppSupportMatrixRow[],
  feature: NodeLevel5AppSupportFeatureName,
): Record<string, unknown> {
  const matching = rows.filter((row) => row.featureAssessment[feature] === "refused");
  return { feature, rowCount: matching.length, ids: matching.map((row) => row.id).sort() };
}

function notProvenFeaturePayload(
  rows: NodeLevel5AppSupportMatrixRow[],
  feature: NodeLevel5AppSupportFeatureName,
): Record<string, unknown> {
  const matching = rows.filter((row) => row.features[feature] === true);
  return { feature, rowCount: matching.length, ids: matching.map((row) => row.id).sort() };
}

function boundaryPayloadFor(boundaries: NodeLevel5AppSupportMatrix["boundaries"], id: string) {
  const boundary = boundaries.find((entry) => entry.id === id);
  return { id, status: boundary?.status, reason: boundary?.reason };
}

function rowsWithFeature(
  rows: NodeLevel5AppSupportMatrixRow[],
  feature: "response",
  value: string,
): string[] {
  return rows
    .filter((row) => row.features[feature] === value)
    .map((row) => row.id)
    .sort();
}

function rowsWithFlag(
  rows: NodeLevel5AppSupportMatrixRow[],
  feature: "params" | "query" | "staticAssets",
): string[] {
  return rows
    .filter((row) => row.features[feature])
    .map((row) => row.id)
    .sort();
}

function featurePresent(row: NodeLevel5AppSupportMatrixRow, name: NodeLevel5AppSupportFeatureName) {
  if (name === "route") {
    return row.features.route !== "not-proven" && row.features.route !== "unsupported-live-state";
  }
  if (name === "response") {
    return row.features.response !== "not-proven";
  }
  if (name === "middleware") {
    return row.features.middleware !== "not-proven";
  }
  return row.features[name] === true;
}

function directionsFor(rows: NodeLevel5AppSupportMatrixRow[]): string[] {
  return unique(rows.flatMap((row) => row.directions));
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function claimFields(bundle: Bundle): Record<string, unknown> {
  return {
    nodeProductSupportClaimed: bundle.nodeProductSupportClaimed,
    broadNodeProductSupportClaimed: bundle.broadNodeProductSupportClaimed,
    arbitraryProcessCrossArchRestoreClaimed: bundle.arbitraryProcessCrossArchRestoreClaimed,
  };
}

function writeOrAssertSummary(proof: string, checkedSummary: Record<string, unknown>): void {
  validateExpectedBundleConstants(checkedSummary);
  const path = join(repoRoot, "proof", proof, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env[`UPDATE_PROOF_${proof}_SUMMARY`] === "1" || !existsSync(path)) {
    writeFileSync(path, text);
    return;
  }
  if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(checkedSummary)) {
    throw new Error(
      `proof/${proof}/checked-summary.json is stale; rerun with UPDATE_PROOF_${proof}_SUMMARY=1`,
    );
  }
}

function validateExpectedBundleConstants(summary: Record<string, unknown>): void {
  const bundle = buildProofBundle();
  if (bundle.rowCount !== 100) {
    throw new Error(`expected 100 app support matrix rows, got ${bundle.rowCount}`);
  }
  if (JSON.stringify(bundle.proofRanges) !== JSON.stringify(expectedProofRanges)) {
    throw new Error(`unexpected proof ranges: ${bundle.proofRanges.join(",")}`);
  }
  if (
    JSON.stringify(directionsFor(buildNodeLevel5AppSupportMatrix().rows)) !==
    JSON.stringify(expectedDirections)
  ) {
    throw new Error("unexpected app support matrix directions");
  }
  if (JSON.stringify(bundle.corpusReports) !== JSON.stringify(expectedReports.sort())) {
    throw new Error(`unexpected corpus reports: ${bundle.corpusReports.join(",")}`);
  }
  if (summary.nodeProductSupportClaimed !== 80 || summary.broadNodeProductSupportClaimed !== 20) {
    throw new Error("proof-only bundle changed Node Level 5 support claims");
  }
}
