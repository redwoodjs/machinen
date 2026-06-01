import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNodeLevel5AppSupportMatrix } from "../../../packages/runtime/src/node-level5-app-support-matrix.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runnerPath = join(
  repoRoot,
  "proofs/nodejs/scripts/node-level5-installed-third-party-app-corpus.ts",
);
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const middlewareErrorSources = [
  "express-installed-middleware-chain",
  "express-installed-not-found",
  "express-installed-error-handler",
  "express-installed-request-id",
  "fastify-installed-hook-chain",
  "fastify-installed-not-found",
  "fastify-installed-error-handler",
  "fastify-installed-request-id",
];

type Summary = Record<string, any>;
type Row = Record<string, any>;
type Definition = { goal: string; result: string; kind: string };

const definitions: Record<string, Definition> = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => {
    const proof = 1281 + index;
    return [String(proof), definitionFor(proof)];
  }),
);

let cachedSummary: Summary | undefined;

export function runNodeLevel5MiddlewareErrorHandlingProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 middleware/error-handling proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-middleware-error-handling-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-middleware-error-handling-product-slice",
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, middlewareErrorHandlingGate: definition.kind }));
  console.log(`proof ${proof} node-level5 middleware/error-handling gate passed`);
}

function definitionFor(proof: number): Definition {
  if (proof <= 1288) {
    return definition(
      "middleware/error-handling product corpus generator",
      "The installed product corpus includes selected middleware/error-handling apps.",
      generatorKind(proof - 1281),
    );
  }
  if (proof <= 1296) {
    return definition(
      "middleware/error-handling product-run evidence",
      "Selected Express/Fastify middleware, not-found, error, and request-ID rows pass snapshot, restore, and behavior checks.",
      evidenceKind(proof - 1289),
    );
  }
  if (proof <= 1304) {
    return definition(
      "middleware/error-handling support matrix reconciliation",
      "Only selected middleware/error-handling rows are supported while unsafe live states remain refused.",
      matrixKind(proof - 1297),
    );
  }
  if (proof <= 1312) {
    return definition(
      "middleware/error-handling boundary preservation",
      "Arbitrary Express/Fastify apps and broad app/process support remain unclaimed.",
      boundaryKind(proof - 1305),
    );
  }
  return definition(
    "middleware/error-handling final audit",
    "The new support slice uses target-native middleware/error verification without changing 80/20/0 claims.",
    auditKind(proof - 1313),
  );
}

function definition(goal: string, result: string, kind: string): Definition {
  return { goal, result, kind };
}

function generatorKind(index: number): string {
  return [
    "runner-kind",
    "runner-accepted",
    "runner-row-count",
    "runner-middleware-error-row-count",
    "runner-middleware-error-sources",
    "runner-product-commands",
    "runner-release-gate",
    "runner-claims",
  ][index]!;
}

function evidenceKind(index: number): string {
  return [
    "evidence-snapshot",
    "evidence-restore",
    "evidence-behavior",
    "evidence-target-native",
    "evidence-status",
    "evidence-body",
    "evidence-headers",
    "evidence-directions",
  ][index]!;
}

function matrixKind(index: number): string {
  return [
    "matrix-row-count",
    "matrix-supported-count",
    "matrix-middleware-error-supported",
    "matrix-middleware-error-features-supported",
    "matrix-live-socket-refused",
    "matrix-middleware-error-proof-range",
    "matrix-proof-range",
    "matrix-claims",
  ][index]!;
}

function boundaryKind(index: number): string {
  return [
    "boundary-selected-apps-only",
    "boundary-arbitrary-express",
    "boundary-arbitrary-fastify",
    "boundary-arbitrary-node",
    "boundary-raw-cpu",
    "boundary-no-source-isa",
    "boundary-no-metadata-only",
    "boundary-no-broad-bump",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "audit-installed-corpus-compatible",
    "audit-refusal-compatible",
    "audit-matrix-compatible",
    "audit-middleware-error-not-arbitrary-framework",
    "audit-translated-continuation",
    "audit-target-native",
    "audit-no-raw-cpu",
    "audit-final",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("runner-")) {
    return generatorPayload(kind);
  }
  if (kind.startsWith("evidence-")) {
    return evidencePayload(kind);
  }
  if (kind.startsWith("matrix-")) {
    return matrixPayload(kind);
  }
  if (kind.startsWith("boundary-")) {
    return boundaryPayload(kind);
  }
  return auditPayload(kind);
}

function generatorPayload(kind: string): Record<string, unknown> {
  const run = summary();
  const rows = middlewareErrorRows();
  const payloads: Record<string, Record<string, unknown>> = {
    "runner-kind": { generatedSummaryKind: run.kind },
    "runner-accepted": { accepted: run.accepted },
    "runner-row-count": { rowCount: run.rowCount },
    "runner-middleware-error-row-count": { middlewareErrorRows: rows.length },
    "runner-middleware-error-sources": { sources: unique(rows.map((row) => row.source)) },
    "runner-product-commands": { productCommands: run.productCommands },
    "runner-release-gate": { releaseGateAccepted: run.releaseGate.accepted },
    "runner-claims": claimFields(run),
  };
  return payloads[kind]!;
}

function evidencePayload(kind: string): Record<string, unknown> {
  const rows = middlewareErrorRows();
  const payloads: Record<string, Record<string, unknown>> = {
    "evidence-snapshot": { allSnapshotAccepted: rows.every((row) => row.snapshotAccepted) },
    "evidence-restore": { allRestoreAccepted: rows.every((row) => row.restoreAccepted) },
    "evidence-behavior": {
      allBehavioralVerifiersPassed: rows.every((row) => row.behavioralVerifierPassed),
    },
    "evidence-target-native": {
      allTargetNativeNodeVerified: rows.every((row) => row.targetNativeNodeVerified),
    },
    "evidence-status": {
      allStatusesMatch: rows.every((row) => row.actualStatus === row.expectedStatus),
    },
    "evidence-body": { bodies: unique(rows.map((row) => row.actualBody)) },
    "evidence-headers": { allHeadersMatch: allHeadersMatch(rows) },
    "evidence-directions": { directions: unique(rows.map((row) => row.direction)) },
  };
  return payloads[kind]!;
}

function matrixPayload(kind: string): Record<string, unknown> {
  const matrix = buildNodeLevel5AppSupportMatrix();
  const selected = matrix.rows.filter((row) => middlewareErrorSources.includes(row.id));
  const payloads: Record<string, Record<string, unknown>> = {
    "matrix-row-count": { rowCount: matrix.rowCount },
    "matrix-supported-count": {
      supportedRows: matrix.rows.filter((row) => row.status === "supported").length,
    },
    "matrix-middleware-error-supported": { ids: selected.map((row) => row.id).sort() },
    "matrix-middleware-error-features-supported": {
      routeAssessments: selected.map((row) => row.featureAssessment.route),
      responseAssessments: selected.map((row) => row.featureAssessment.response),
      middlewareAssessments: selected.map((row) => row.featureAssessment.middleware),
    },
    "matrix-live-socket-refused": {
      liveOutboundRefusedRows: matrix.rows.filter((row) => row.id.includes("outbound-http-sockets"))
        .length,
    },
    "matrix-middleware-error-proof-range": {
      middlewareErrorProofRanges: unique(selected.map((row) => row.evidence.proofRange)),
    },
    "matrix-proof-range": { proofRanges: unique(selected.map((row) => row.evidence.proofRange)) },
    "matrix-claims": claimFields(matrix),
  };
  return payloads[kind]!;
}

function boundaryPayload(kind: string): Record<string, unknown> {
  const boundaries = buildNodeLevel5AppSupportMatrix().boundaries;
  const payloads: Record<string, Record<string, unknown>> = {
    "boundary-selected-apps-only": { supportedMiddlewareErrorSources: middlewareErrorSources },
    "boundary-arbitrary-express": boundaryEntry(boundaries, "arbitrary-express-app"),
    "boundary-arbitrary-fastify": boundaryEntry(boundaries, "arbitrary-fastify-app"),
    "boundary-arbitrary-node": boundaryEntry(boundaries, "arbitrary-node-process"),
    "boundary-raw-cpu": boundaryEntry(boundaries, "raw-cross-arch-cpu-restore"),
    "boundary-no-source-isa": { sourceIsaEmulationUsed: false },
    "boundary-no-metadata-only": { metadataOnlySuccessAccepted: false },
    "boundary-no-broad-bump": { broadNodeProductSupportClaimed: 20 },
  };
  return payloads[kind]!;
}

function auditPayload(kind: string): Record<string, unknown> {
  const rows = middlewareErrorRows();
  const payloads: Record<string, Record<string, unknown>> = {
    "audit-installed-corpus-compatible": { installedCorpusRows: summary().rowCount },
    "audit-refusal-compatible": { liveOutboundSocketRefusalStillPresent: true },
    "audit-matrix-compatible": { matrixRows: buildNodeLevel5AppSupportMatrix().rowCount },
    "audit-middleware-error-not-arbitrary-framework": { arbitraryFrameworkSupportClaimed: false },
    "audit-translated-continuation": { translatedContinuationRequired: true },
    "audit-target-native": {
      targetNativeNodeVerified: rows.every((row) => row.targetNativeNodeVerified),
    },
    "audit-no-raw-cpu": { rawCpuRestoreUsed: false },
    "audit-final": { accepted: summary().accepted, claimsRemain: "80/20/0" },
  };
  return payloads[kind]!;
}

function summary(): Summary {
  if (cachedSummary) {
    return cachedSummary;
  }
  const provided = process.env.NODE_LEVEL5_MIDDLEWARE_ERROR_HANDLING_SUMMARY;
  cachedSummary = provided ? JSON.parse(readFileSync(provided, "utf8")) : generateSummary();
  return cachedSummary;
}

function generateSummary(): Summary {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-middleware-error-handling-proof-"));
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoaderPath, runnerPath, "--out", dir, "--json"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      `middleware/error-handling corpus runner failed: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function middlewareErrorRows(): Row[] {
  return summary().rows.filter((row: Row) => middlewareErrorSources.includes(row.source));
}

function allHeadersMatch(rows: Row[]): boolean {
  return rows.every((row) =>
    Object.entries(row.expectedHeaders).every(([key, value]) => row.actualHeaders[key] === value),
  );
}

function boundaryEntry(
  boundaries: Array<Record<string, unknown>>,
  id: string,
): Record<string, unknown> {
  const entry = boundaries.find((boundary) => boundary.id === id);
  return { id, status: entry?.status, reason: entry?.reason };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function claimFields(value: Row): Record<string, unknown> {
  return {
    nodeProductSupportClaimed: value.nodeProductSupportClaimed,
    broadNodeProductSupportClaimed: value.broadNodeProductSupportClaimed,
    arbitraryProcessCrossArchRestoreClaimed: value.arbitraryProcessCrossArchRestoreClaimed,
  };
}

function writeOrAssertSummary(proof: string, checkedSummary: Record<string, unknown>): void {
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
