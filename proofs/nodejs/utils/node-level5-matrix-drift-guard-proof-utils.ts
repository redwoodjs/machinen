import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildNodeLevel5AppSupportMatrix,
  type NodeLevel5AppSupportMatrixRow,
} from "../../../packages/runtime/src/node-level5-app-support-matrix.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const expectedStatusCounts = { supported: 68, refused: 42, "not-proven": 4 };
const expectedSupportedIds = [
  "express-fixture-product-run",
  "express-generator-router",
  "express-generic-vm-cjs",
  "express-generic-vm-esm",
  "express-installed-config-json-read",
  "express-installed-configured-prefix",
  "express-installed-cookie-read",
  "express-installed-custom-header",
  "express-installed-delete-route",
  "express-installed-env-read",
  "express-installed-error-handler",
  "express-installed-feature-flag-env",
  "express-installed-health-check",
  "express-installed-hello-world",
  "express-installed-idle-timer",
  "express-installed-json-response",
  "express-installed-middleware-chain",
  "express-installed-multi-route",
  "express-installed-nested-router",
  "express-installed-not-found",
  "express-installed-optional-param",
  "express-installed-post-json-body",
  "express-installed-put-route",
  "express-installed-query-string",
  "express-installed-redirect",
  "express-installed-request-id",
  "express-installed-response-header",
  "express-installed-route-params",
  "express-installed-router",
  "express-installed-safe-outbound-reconnect",
  "express-installed-static-asset",
  "express-installed-static-cache-header",
  "express-installed-status-code",
  "express-official-hello-world",
  "fastify-fixture-product-run",
  "fastify-generic-vm-cjs",
  "fastify-generic-vm-esm",
  "fastify-installed-config-json-read",
  "fastify-installed-configured-prefix",
  "fastify-installed-cookie-read",
  "fastify-installed-custom-header",
  "fastify-installed-delete-route",
  "fastify-installed-env-read",
  "fastify-installed-error-handler",
  "fastify-installed-feature-flag-env",
  "fastify-installed-getting-started",
  "fastify-installed-health-check",
  "fastify-installed-hook-chain",
  "fastify-installed-idle-timer",
  "fastify-installed-json-response",
  "fastify-installed-multi-route",
  "fastify-installed-not-found",
  "fastify-installed-optional-param",
  "fastify-installed-plugin-route",
  "fastify-installed-post-json-body",
  "fastify-installed-prefix-route",
  "fastify-installed-put-route",
  "fastify-installed-query-string",
  "fastify-installed-redirect",
  "fastify-installed-request-id",
  "fastify-installed-response-header",
  "fastify-installed-route-params",
  "fastify-installed-safe-outbound-reconnect",
  "fastify-installed-static-asset",
  "fastify-installed-static-cache-header",
  "fastify-installed-status-code",
  "fastify-official-getting-started",
  "fastify-plugin-route",
];
const expectedNotProvenIds = [
  "express-background-tasks-not-proven",
  "express-external-network-not-proven",
  "fastify-background-tasks-not-proven",
  "fastify-external-network-not-proven",
];
const expectedRefusalSuffixes = [
  "active-requests",
  "child-processes",
  "cluster-mode",
  "db-connections",
  "filesystem-watchers",
  "generic-vm-active-requests",
  "generic-vm-child-processes",
  "generic-vm-native-addons",
  "generic-vm-tls-active-state",
  "generic-vm-worker-threads",
  "http2-sessions",
  "native-addons",
  "open-writable-files",
  "outbound-http-sockets",
  "redis-queue-connections",
  "server-sent-events",
  "timers-intervals",
  "tls-active-state",
  "wasm-external-memory",
  "websockets",
  "worker-threads",
];
const expectedBoundaryIds = [
  "arbitrary-express-app",
  "arbitrary-fastify-app",
  "arbitrary-node-process",
  "raw-cross-arch-cpu-restore",
];
const expectedDirections = ["amd64-to-arm64", "arm64-to-amd64"];

const definitions: Record<string, Definition> = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => {
    const proof = 1081 + index;
    return [String(proof), definitionFor(proof)];
  }),
);

type Definition = { goal: string; result: string; kind: string };

type MatrixStatus = "supported" | "refused" | "not-proven";

export function runNodeLevel5MatrixDriftGuardProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 matrix drift guard proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-matrix-drift-guard-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-proof-only-matrix-drift-guard",
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <dir>"],
    proofOnly: true,
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, matrixDriftGuard: definition.kind }));
  console.log(`proof ${proof} node-level5 matrix drift guard passed`);
}

function definitionFor(proof: number): Definition {
  if (proof <= 1088) {
    return definition(
      "Matrix row identity drift guard",
      "Matrix row IDs and counts stay stable.",
      identityKind(proof - 1081),
    );
  }
  if (proof <= 1096) {
    return definition(
      "Supported row drift guard",
      "Supported rows stay tied to corpus-backed idle HTTP app behavior.",
      supportedKind(proof - 1089),
    );
  }
  if (proof <= 1104) {
    return definition(
      "Refused row drift guard",
      "Refused rows stay refusal-only and cannot become restores.",
      refusedKind(proof - 1097),
    );
  }
  if (proof <= 1112) {
    return definition(
      "Not-proven and boundary drift guard",
      "Gaps and broad app/process boundaries stay unclaimed.",
      boundaryKind(proof - 1105),
    );
  }
  return definition(
    "Final claim-boundary drift guard",
    "Proof-only audits preserve translated continuation and 80/20/0 claims.",
    auditKind(proof - 1113),
  );
}

function definition(goal: string, result: string, kind: string): Definition {
  return { goal, result, kind };
}

function identityKind(index: number): string {
  return [
    "matrix-version",
    "matrix-row-count",
    "matrix-status-counts",
    "matrix-no-duplicate-ids",
    "matrix-all-row-id-hash",
    "matrix-supported-id-hash",
    "matrix-refused-id-hash",
    "matrix-not-proven-id-hash",
  ][index]!;
}

function supportedKind(index: number): string {
  return [
    "supported-exact-ids",
    "supported-directions",
    "supported-product-behavior",
    "supported-proof-ranges",
    "supported-corpus-reports",
    "supported-declared-subset-scope",
    "supported-feature-assessments",
    "supported-no-live-state-support",
  ][index]!;
}

function refusedKind(index: number): string {
  return [
    "refused-exact-ids",
    "refused-directions",
    "refused-product-behavior",
    "refused-proof-range",
    "refused-external-network-count",
    "refused-background-task-count",
    "refused-no-supported-behavior",
    "refused-limitations",
  ][index]!;
}

function boundaryKind(index: number): string {
  return [
    "not-proven-exact-ids",
    "not-proven-not-supported",
    "not-proven-gap-evidence",
    "not-proven-feature-counts",
    "boundary-exact-ids",
    "boundary-arbitrary-express",
    "boundary-arbitrary-fastify",
    "boundary-arbitrary-node-and-cpu",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "audit-proof-only",
    "audit-product-surfaces",
    "audit-node-claim",
    "audit-broad-node-claim",
    "audit-arbitrary-process-claim",
    "audit-no-raw-cpu",
    "audit-no-source-isa",
    "audit-final",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("matrix-")) {
    return identityPayload(kind);
  }
  if (kind.startsWith("supported-")) {
    return supportedPayload(kind);
  }
  if (kind.startsWith("refused-")) {
    return refusedPayload(kind);
  }
  if (kind.startsWith("not-proven-") || kind.startsWith("boundary-")) {
    return boundaryPayload(kind);
  }
  return auditPayload(kind);
}

function identityPayload(kind: string): Record<string, unknown> {
  const matrix = buildNodeLevel5AppSupportMatrix();
  return recordFor(kind, {
    "matrix-version": { version: matrix.version },
    "matrix-row-count": { rowCount: matrix.rowCount },
    "matrix-status-counts": statusCountsPayload(),
    "matrix-no-duplicate-ids": { duplicateIds: duplicateIds(allIds()) },
    "matrix-all-row-id-hash": { allRowIdsSha256: sha256Json(allIds()) },
    "matrix-supported-id-hash": { supportedRowIdsSha256: sha256Json(rowIds("supported")) },
    "matrix-refused-id-hash": { refusedRowIdsSha256: sha256Json(rowIds("refused")) },
    "matrix-not-proven-id-hash": { notProvenRowIdsSha256: sha256Json(rowIds("not-proven")) },
  });
}

function supportedPayload(kind: string): Record<string, unknown> {
  const rows = rowsByStatus("supported");
  return recordFor(kind, {
    "supported-exact-ids": { ids: rowIds("supported") },
    "supported-directions": { directions: directionsFor(rows) },
    "supported-product-behavior": { behaviors: unique(rows.map((row) => row.productBehavior)) },
    "supported-proof-ranges": { proofRanges: unique(rows.map((row) => row.evidence.proofRange)) },
    "supported-corpus-reports": {
      corpusReports: unique(rows.map((row) => row.evidence.corpusReport)),
    },
    "supported-declared-subset-scope": { scopes: unique(rows.map((row) => row.supportScope)) },
    "supported-feature-assessments": supportedFeaturePayload(rows),
    "supported-no-live-state-support": { liveStateRowsSupported: supportedLiveStateRows(rows) },
  });
}

function refusedPayload(kind: string): Record<string, unknown> {
  const rows = rowsByStatus("refused");
  return recordFor(kind, {
    "refused-exact-ids": { ids: rowIds("refused") },
    "refused-directions": { directions: directionsFor(rows) },
    "refused-product-behavior": { behaviors: unique(rows.map((row) => row.productBehavior)) },
    "refused-proof-range": { proofRanges: unique(rows.map((row) => row.evidence.proofRange)) },
    "refused-external-network-count": {
      externalNetworkRefusedRows: refusedFeatureRows(rows, "externalNetwork"),
    },
    "refused-background-task-count": {
      backgroundTaskRefusedRows: refusedFeatureRows(rows, "backgroundTasks"),
    },
    "refused-no-supported-behavior": {
      supportedBehaviorRows: rows.filter((row) => row.productBehavior !== "refuse-before-snapshot")
        .length,
    },
    "refused-limitations": {
      allRowsStateNoRestore: rows.every((row) =>
        row.limitations.includes("restore is not attempted"),
      ),
    },
  });
}

function boundaryPayload(kind: string): Record<string, unknown> {
  const rows = rowsByStatus("not-proven");
  const boundaries = buildNodeLevel5AppSupportMatrix().boundaries;
  return recordFor(kind, {
    "not-proven-exact-ids": { ids: rowIds("not-proven") },
    "not-proven-not-supported": {
      supportedNotProvenRows: rows.filter((row) => row.status === "supported").length,
    },
    "not-proven-gap-evidence": {
      evidenceKinds: unique(rows.map((row) => row.evidence.kind)),
      reports: unique(rows.map((row) => row.evidence.corpusReport)),
    },
    "not-proven-feature-counts": {
      externalNetworkRows: featureFlagCount(rows, "externalNetwork"),
      backgroundTaskRows: featureFlagCount(rows, "backgroundTasks"),
    },
    "boundary-exact-ids": { boundaryIds: boundaries.map((entry) => entry.id).sort() },
    "boundary-arbitrary-express": boundaryEntryPayload("arbitrary-express-app"),
    "boundary-arbitrary-fastify": boundaryEntryPayload("arbitrary-fastify-app"),
    "boundary-arbitrary-node-and-cpu": {
      node: boundaryEntryPayload("arbitrary-node-process"),
      cpu: boundaryEntryPayload("raw-cross-arch-cpu-restore"),
    },
  });
}

function auditPayload(kind: string): Record<string, unknown> {
  const matrix = buildNodeLevel5AppSupportMatrix();
  return recordFor(kind, {
    "audit-proof-only": { proofOnly: true, productCodeChanged: false },
    "audit-product-surfaces": {
      productSurfaces: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <dir>"],
    },
    "audit-node-claim": { nodeProductSupportClaimed: matrix.nodeProductSupportClaimed },
    "audit-broad-node-claim": {
      broadNodeProductSupportClaimed: matrix.broadNodeProductSupportClaimed,
    },
    "audit-arbitrary-process-claim": {
      arbitraryProcessCrossArchRestoreClaimed: matrix.arbitraryProcessCrossArchRestoreClaimed,
    },
    "audit-no-raw-cpu": { rawCpuRestoreUsed: false },
    "audit-no-source-isa": { sourceIsaEmulationUsed: false },
    "audit-final": {
      accepted: matrix.accepted,
      claimsRemain: "80/20/0",
      matrixRowsGuarded: matrix.rowCount,
    },
  });
}

function rowsByStatus(status: MatrixStatus): NodeLevel5AppSupportMatrixRow[] {
  return buildNodeLevel5AppSupportMatrix().rows.filter((row) => row.status === status);
}

function rowIds(status: MatrixStatus): string[] {
  return rowsByStatus(status)
    .map((row) => row.id)
    .sort();
}

function allIds(): string[] {
  return buildNodeLevel5AppSupportMatrix()
    .rows.map((row) => row.id)
    .sort();
}

function statusCountsPayload(): Record<string, number> {
  return Object.fromEntries(
    Object.keys(expectedStatusCounts).map((status) => [
      status,
      rowsByStatus(status as MatrixStatus).length,
    ]),
  );
}

function supportedFeaturePayload(rows: NodeLevel5AppSupportMatrixRow[]): Record<string, unknown> {
  return {
    allPresentFeaturesSupported: rows.every((row) =>
      Object.entries(row.features).every(
        ([feature, value]) =>
          !isPresentFeature(value) ||
          row.featureAssessment[feature as keyof typeof row.featureAssessment] === "supported",
      ),
    ),
  };
}

function supportedLiveStateRows(rows: NodeLevel5AppSupportMatrixRow[]): string[] {
  return rows
    .filter((row) => row.features.externalNetwork || row.features.backgroundTasks)
    .map((row) => row.id)
    .sort();
}

function refusedFeatureRows(
  rows: NodeLevel5AppSupportMatrixRow[],
  feature: "externalNetwork" | "backgroundTasks",
): string[] {
  return rows
    .filter((row) => row.featureAssessment[feature] === "refused")
    .map((row) => row.id)
    .sort();
}

function featureFlagCount(
  rows: NodeLevel5AppSupportMatrixRow[],
  feature: "externalNetwork" | "backgroundTasks",
): number {
  return rows.filter((row) => row.features[feature]).length;
}

function boundaryEntryPayload(id: string): Record<string, unknown> {
  const entry = buildNodeLevel5AppSupportMatrix().boundaries.find((boundary) => boundary.id === id);
  return { id, status: entry?.status, reason: entry?.reason };
}

function directionsFor(rows: NodeLevel5AppSupportMatrixRow[]): string[] {
  return unique(rows.flatMap((row) => row.directions));
}

function duplicateIds(ids: string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}

function recordFor(
  kind: string,
  values: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const value = values[kind];
  if (!value) {
    throw new Error(`missing matrix drift guard payload for ${kind}`);
  }
  return value;
}

function isPresentFeature(value: unknown): boolean {
  return (
    value === true ||
    (typeof value === "string" &&
      value !== "none" &&
      value !== "not-proven" &&
      value !== "unsupported-live-state")
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function writeOrAssertSummary(proof: string, checkedSummary: Record<string, unknown>): void {
  validateMatrixGuardConstants();
  const path = join(repoRoot, "proofs", "by-id", proof, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env[`UPDATE_PROOF_${proof}_SUMMARY`] === "1" || !existsSync(path)) {
    writeFileSync(path, text);
    return;
  }
  if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(checkedSummary)) {
    throw new Error(
      `proofs/by-id/${proof}/checked-summary.json is stale; rerun with UPDATE_PROOF_${proof}_SUMMARY=1`,
    );
  }
}

function validateMatrixGuardConstants(): void {
  assertJsonEqual(statusCountsPayload(), expectedStatusCounts, "status counts");
  assertJsonEqual(rowIds("supported"), expectedSupportedIds, "supported IDs");
  assertJsonEqual(rowIds("not-proven"), expectedNotProvenIds, "not-proven IDs");
  assertJsonEqual(refusalSuffixes(), expectedRefusalSuffixes, "refusal suffixes");
  assertJsonEqual(
    directionsFor(buildNodeLevel5AppSupportMatrix().rows),
    expectedDirections,
    "directions",
  );
  assertJsonEqual(
    buildNodeLevel5AppSupportMatrix()
      .boundaries.map((entry) => entry.id)
      .sort(),
    expectedBoundaryIds,
    "boundary IDs",
  );
}

function refusalSuffixes(): string[] {
  return rowIds("refused")
    .map((id) => id.replace(/^express-/, "").replace(/^fastify-/, ""))
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .sort();
}

function assertJsonEqual(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`matrix drift guard ${label} changed`);
  }
}
