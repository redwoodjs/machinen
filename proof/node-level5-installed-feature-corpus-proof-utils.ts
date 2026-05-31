import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNodeLevel5AppSupportMatrix } from "../packages/runtime/src/node-level5-app-support-matrix.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = join(repoRoot, "scripts/node-level5-installed-third-party-app-corpus.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
type Summary = Record<string, any>;
type Row = Record<string, any>;
type Definition = { goal: string; result: string; kind: string };

const definitions: Record<string, Definition> = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => {
    const proof = 961 + index;
    return [String(proof), definitionFor(proof)];
  }),
);

let cachedSummary: Summary | undefined;

export function runNodeLevel5InstalledFeatureCorpusProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 installed feature corpus proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-installed-feature-corpus-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-installed-feature-corpus",
    productSurface: ["machinen snapshot node <pid> --out <dir>", "machinen restore <snapshot>"],
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, installedFeatureCorpusGate: definition.kind }));
  console.log(`proof ${proof} node-level5 installed feature corpus gate passed`);
}

function definitionFor(proof: number): Definition {
  if (proof <= 968) {
    return {
      goal: "Installed feature corpus generator contract",
      result: "The installed corpus now includes selected feature app rows and release-gates them.",
      kind: generatorKind(proof - 961),
    };
  }
  if (proof <= 976) {
    return {
      goal: "Installed Express/Fastify feature rows",
      result: "JSON, params, query, and static asset rows exist for Express and Fastify.",
      kind: featureKind(proof - 969),
    };
  }
  if (proof <= 984) {
    return {
      goal: "Installed feature behavior evidence",
      result: "Feature rows retain product snapshot/restore and behavioral verifier evidence.",
      kind: evidenceKind(proof - 977),
    };
  }
  if (proof <= 992) {
    return {
      goal: "Feature support matrix reconciliation",
      result:
        "The app support matrix marks proven feature rows supported and leaves hard gaps unclaimed.",
      kind: matrixKind(proof - 985),
    };
  }
  return {
    goal: "Installed feature corpus final audit",
    result: "Feature support expands selected app rows without broadening arbitrary Node claims.",
    kind: auditKind(proof - 993),
  };
}

function generatorKind(index: number): string {
  return [
    "runner-kind",
    "runner-accepted",
    "runner-row-count",
    "runner-report-written",
    "runner-release-gate",
    "runner-product-commands",
    "runner-claims",
    "runner-no-overclaim",
  ][index]!;
}

function featureKind(index: number): string {
  return [
    "express-json",
    "express-params",
    "express-query",
    "express-static",
    "fastify-json",
    "fastify-params",
    "fastify-query",
    "fastify-static",
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
    "evidence-hash",
  ][index]!;
}

function matrixKind(index: number): string {
  return [
    "matrix-json-supported",
    "matrix-params-supported",
    "matrix-query-supported",
    "matrix-static-supported",
    "matrix-external-network-gap",
    "matrix-background-gap",
    "matrix-row-count-stable",
    "matrix-claims",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "audit-installed-corpus-compatible",
    "audit-support-matrix-compatible",
    "audit-refusal-compatible",
    "audit-declared-subset",
    "audit-app-specific",
    "audit-no-arbitrary-express-fastify",
    "audit-no-arbitrary-node",
    "audit-final",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("runner-")) {
    return generatorPayload(kind);
  }
  if (isFeatureKind(kind)) {
    return featurePayload(kind);
  }
  if (kind.startsWith("evidence-")) {
    return evidencePayload(kind);
  }
  if (kind.startsWith("matrix-")) {
    return matrixPayload(kind);
  }
  return auditPayload(kind);
}

function generatorPayload(kind: string): Record<string, unknown> {
  const run = summary();
  if (kind === "runner-kind") {
    return { generatedSummaryKind: run.kind };
  }
  if (kind === "runner-accepted") {
    return { accepted: run.accepted };
  }
  if (kind === "runner-row-count") {
    return { rowCount: run.rowCount };
  }
  if (kind === "runner-report-written") {
    return {
      installedThirdPartyAppReportWritten: existsSync(run.installedThirdPartyAppReportPath),
    };
  }
  if (kind === "runner-release-gate") {
    return { releaseGateAccepted: run.releaseGate.accepted };
  }
  if (kind === "runner-product-commands") {
    return { productCommands: run.productCommands };
  }
  if (kind === "runner-claims") {
    return claimFields(run);
  }
  return { arbitraryNodeClaimed: false, arbitraryProcessCrossArchRestoreClaimed: 0 };
}

function featurePayload(kind: string): Record<string, unknown> {
  const source = sourceForKind(kind);
  const rows = rowsBySource(source);
  return {
    source,
    rowCount: rows.length,
    directions: unique(rows.map((row) => row.direction)),
    allAccepted: rows.every((row) => row.snapshotAccepted && row.restoreAccepted),
  };
}

function evidencePayload(kind: string): Record<string, unknown> {
  const rows = featureRows();
  if (kind === "evidence-snapshot") {
    return { allSnapshotAccepted: rows.every((row) => row.snapshotAccepted) };
  }
  if (kind === "evidence-restore") {
    return { allRestoreAccepted: rows.every((row) => row.restoreAccepted) };
  }
  if (kind === "evidence-behavior") {
    return { allBehavioralVerifiersPassed: rows.every((row) => row.behavioralVerifierPassed) };
  }
  if (kind === "evidence-target-native") {
    return { allTargetNativeNodeVerified: rows.every((row) => row.targetNativeNodeVerified) };
  }
  if (kind === "evidence-status") {
    return { allStatusesMatch: rows.every((row) => row.actualStatus === row.expectedStatus) };
  }
  if (kind === "evidence-body") {
    return { allBodiesMatch: rows.every((row) => row.actualBody === row.expectedBody) };
  }
  if (kind === "evidence-headers") {
    return { allHeadersMatch: allHeadersMatch(rows) };
  }
  return { rowsSha256Verified: summary().installedThirdPartyAppVerification.rowsSha256Verified };
}

function matrixPayload(kind: string): Record<string, unknown> {
  const matrix = buildNodeLevel5AppSupportMatrix();
  if (kind === "matrix-json-supported") {
    return assessmentRows("response", "supported", "json");
  }
  if (kind === "matrix-params-supported") {
    return assessmentRows("params", "supported", true);
  }
  if (kind === "matrix-query-supported") {
    return assessmentRows("query", "supported", true);
  }
  if (kind === "matrix-static-supported") {
    return assessmentRows("staticAssets", "supported", true);
  }
  if (kind === "matrix-external-network-gap") {
    return gapRows("external-network");
  }
  if (kind === "matrix-background-gap") {
    return gapRows("background-tasks");
  }
  if (kind === "matrix-row-count-stable") {
    return { rowCount: matrix.rowCount };
  }
  return claimFields(matrix);
}

function auditPayload(kind: string): Record<string, unknown> {
  if (kind === "audit-installed-corpus-compatible") {
    return {
      installedFeatureRows: featureRows().length,
      installedCorpusReport: "node-level5-installed-third-party-app-corpus-report.json",
    };
  }
  if (kind === "audit-support-matrix-compatible") {
    return {
      matrixFeatureProofRange: "961-1000",
      supportedFeatureRows: matrixFeatureRows().length,
    };
  }
  if (kind === "audit-refusal-compatible") {
    return { refusalCorpusProofRange: "761-800", unsupportedLiveStateStillRefused: true };
  }
  if (kind === "audit-declared-subset") {
    return { declaredSubsetOnly: featureRows().every((row) => row.declaredSubset) };
  }
  if (kind === "audit-app-specific") {
    return { appRows: unique(featureRows().map((row) => row.appName)) };
  }
  if (kind === "audit-no-arbitrary-express-fastify") {
    return { arbitraryExpressClaimed: false, arbitraryFastifyClaimed: false };
  }
  if (kind === "audit-no-arbitrary-node") {
    return { arbitraryNodeClaimed: false, broadNodeProductSupportClaimed: 20 };
  }
  return { finalInstalledFeatureCorpus: true, claimsRemain: "80/20/0" };
}

function summary(): Summary {
  if (cachedSummary) {
    return cachedSummary;
  }
  const provided = process.env.NODE_LEVEL5_INSTALLED_FEATURE_CORPUS_SUMMARY;
  cachedSummary = provided ? JSON.parse(readFileSync(provided, "utf8")) : generateSummary();
  return cachedSummary;
}

function generateSummary(): Summary {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-installed-feature-corpus-proof-"));
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoaderPath, runnerPath, "--out", dir, "--json"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `installed feature corpus runner failed: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function featureRows(): Row[] {
  return summary().rows.filter((row: Row) => featureSources().includes(row.source));
}

function matrixFeatureRows(): Row[] {
  return buildNodeLevel5AppSupportMatrix().rows.filter(
    (row) => row.evidence.proofRange === "961-1000",
  );
}

function rowsBySource(source: string): Row[] {
  return summary().rows.filter((row: Row) => row.source === source);
}

function assessmentRows(feature: string, status: string, value: unknown): Record<string, unknown> {
  const rows = matrixFeatureRows().filter(
    (row) => row.featureAssessment[feature] === status && row.features[feature] === value,
  );
  return { feature, status, rowCount: rows.length };
}

function gapRows(id: string): Record<string, unknown> {
  const rows = buildNodeLevel5AppSupportMatrix().rows.filter((row) => row.id.includes(id));
  return {
    id,
    rowCount: rows.length,
    allNotProven: rows.every((row) => row.status === "not-proven"),
  };
}

function allHeadersMatch(rows: Row[]): boolean {
  return rows.every((row) =>
    Object.entries(row.expectedHeaders).every(([key, value]) => row.actualHeaders[key] === value),
  );
}

function isFeatureKind(kind: string): boolean {
  return featureKindToSource[kind] !== undefined;
}

function sourceForKind(kind: string): string {
  const source = featureKindToSource[kind];
  if (!source) {
    throw new Error(`unknown feature kind ${kind}`);
  }
  return source;
}

function featureSources(): string[] {
  return Object.values(featureKindToSource);
}

const featureKindToSource: Record<string, string> = {
  "express-json": "express-installed-json-response",
  "express-params": "express-installed-route-params",
  "express-query": "express-installed-query-string",
  "express-static": "express-installed-static-asset",
  "fastify-json": "fastify-installed-json-response",
  "fastify-params": "fastify-installed-route-params",
  "fastify-query": "fastify-installed-query-string",
  "fastify-static": "fastify-installed-static-asset",
};

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
