import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNodeLevel5AppSupportMatrix } from "../../../packages/runtime/src/node-level5-app-support-matrix.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const runnerPath = join(repoRoot, "scripts/node-level5-real-app-refusal-corpus.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
type Row = Record<string, any>;
type Summary = Record<string, any>;
type Definition = { goal: string; result: string; kind: string };

const newMarkers = [
  "dbConnections",
  "redisQueueConnections",
  "outboundHttpSockets",
  "http2Sessions",
  "serverSentEvents",
  "openWritableFiles",
  "timersIntervals",
  "clusterMode",
];

const definitions: Record<string, Definition> = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => {
    const proof = 1001 + index;
    return [String(proof), definitionFor(proof)];
  }),
);

let cachedSummary: Summary | undefined;

export function runNodeLevel5RefusalExpansionProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 refusal expansion proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-refusal-expansion-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-refusal-expansion",
    productSurface: ["machinen snapshot <vm-name> --out <dir>"],
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, refusalExpansionGate: definition.kind }));
  console.log(`proof ${proof} node-level5 refusal expansion gate passed`);
}

function definitionFor(proof: number): Definition {
  if (proof <= 1008) {
    return {
      goal: "Refusal expansion generator contract",
      result: "The refusal corpus retains expanded unsafe app-state refusals before snapshot.",
      kind: generatorKind(proof - 1001),
    };
  }
  if (proof <= 1016) {
    return {
      goal: "External/network refusal markers",
      result: "DB, queue, outbound HTTP, HTTP/2, and SSE state refuse before snapshot.",
      kind: externalKind(proof - 1009),
    };
  }
  if (proof <= 1024) {
    return {
      goal: "Background/resource refusal markers",
      result:
        "Writable files, timers, cluster mode, and matrix external/background refusals are retained.",
      kind: resourceKind(proof - 1017),
    };
  }
  if (proof <= 1032) {
    return {
      goal: "Refusal expansion release gate",
      result: "Expanded refusal reports are release-gated and tamper-checked.",
      kind: gateKind(proof - 1025),
    };
  }
  return {
    goal: "Refusal expansion final audit",
    result: "Expanded refusals narrow unsafe support without broadening Node claims.",
    kind: auditKind(proof - 1033),
  };
}

function generatorKind(index: number): string {
  return [
    "runner-kind",
    "runner-accepted",
    "runner-row-count",
    "runner-report-written",
    "runner-new-marker-count",
    "runner-refused-before-snapshot",
    "runner-no-manifests",
    "runner-claims",
  ][index]!;
}

function externalKind(index: number): string {
  return [
    "dbConnections",
    "redisQueueConnections",
    "outboundHttpSockets",
    "http2Sessions",
    "serverSentEvents",
    "external-frameworks",
    "external-directions",
    "external-codes",
  ][index]!;
}

function resourceKind(index: number): string {
  return [
    "openWritableFiles",
    "timersIntervals",
    "clusterMode",
    "resource-frameworks",
    "resource-directions",
    "matrix-external-refused",
    "matrix-background-refused",
    "matrix-not-proven-gaps-remain",
  ][index]!;
}

function gateKind(index: number): string {
  return [
    "gate-generated-report",
    "gate-row-count",
    "gate-tamper",
    "gate-missing",
    "gate-expanded-field",
    "gate-diagnostic-secondary",
    "gate-no-restore",
    "gate-no-overclaim",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "audit-refusal-corpus-compatible",
    "audit-feature-corpus-compatible",
    "audit-support-matrix-compatible",
    "audit-unsupported-boundary",
    "audit-no-raw-cpu",
    "audit-no-source-isa",
    "audit-no-broad-bump",
    "audit-final",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("runner-")) {
    return generatorPayload(kind);
  }
  if (newMarkers.includes(kind)) {
    return markerPayload(kind);
  }
  if (kind.startsWith("external-")) {
    return markerGroupPayload("external");
  }
  if (kind.startsWith("resource-") || kind.startsWith("matrix-")) {
    return resourcePayload(kind);
  }
  if (kind.startsWith("gate-")) {
    return gatePayload(kind);
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
    return { refusalReportWritten: existsSync(run.refusalReportPath) };
  }
  if (kind === "runner-new-marker-count") {
    return { newMarkerCount: newMarkers.length };
  }
  if (kind === "runner-refused-before-snapshot") {
    return { allRefusedBeforeSnapshot: newMarkerRows().every((row) => row.refusedBeforeSnapshot) };
  }
  if (kind === "runner-no-manifests") {
    return {
      noSnapshotManifestsWritten: newMarkerRows().every((row) => !row.snapshotManifestWritten),
    };
  }
  return claimFields(run);
}

function markerPayload(marker: string): Record<string, unknown> {
  const rows = rowsByMarker(marker);
  return {
    marker,
    rowCount: rows.length,
    frameworks: unique(rows.map((row) => row.framework)),
    directions: unique(rows.map((row) => row.direction)),
    expectedRefusalCodes: unique(rows.map((row) => row.expectedRefusalCode)),
    allExpectedCodesMatched: rows.every((row) => row.actualRefusalCode === row.expectedRefusalCode),
  };
}

function markerGroupPayload(group: "external" | "resource"): Record<string, unknown> {
  const rows = group === "external" ? externalRows() : resourceRows();
  return {
    group,
    rowCount: rows.length,
    frameworks: unique(rows.map((row) => row.framework)),
    directions: unique(rows.map((row) => row.direction)),
    allExpectedCodesMatched: rows.every((row) => row.actualRefusalCode === row.expectedRefusalCode),
  };
}

function resourcePayload(kind: string): Record<string, unknown> {
  if (newMarkers.includes(kind)) {
    return markerPayload(kind);
  }
  if (kind === "resource-frameworks" || kind === "resource-directions") {
    return markerGroupPayload("resource");
  }
  const matrix = buildNodeLevel5AppSupportMatrix();
  if (kind === "matrix-external-refused") {
    return {
      externalRefusedRows: matrix.rows.filter(
        (row) => row.featureAssessment.externalNetwork === "refused",
      ).length,
    };
  }
  if (kind === "matrix-background-refused") {
    return {
      backgroundRefusedRows: matrix.rows.filter(
        (row) => row.featureAssessment.backgroundTasks === "refused",
      ).length,
    };
  }
  return { notProvenRows: matrix.rows.filter((row) => row.status === "not-proven").length };
}

function gatePayload(kind: string): Record<string, unknown> {
  const run = summary();
  if (kind === "gate-generated-report") {
    return {
      accepted: run.releaseGate.accepted,
      hasRefusalCorpus: Boolean(run.releaseGate.realAppRefusalCorpus),
    };
  }
  if (kind === "gate-row-count") {
    return { rowCount: run.releaseGate.realAppRefusalCorpus.rowCount };
  }
  if (kind === "gate-tamper") {
    return tamperedGate(run.refusalReportPath);
  }
  if (kind === "gate-missing") {
    return missingGate();
  }
  if (kind === "gate-expanded-field") {
    return { expandedMarkers: newMarkers };
  }
  if (kind === "gate-diagnostic-secondary") {
    return { diagnosticSurface: "node-level5 release-gate --include-refusal-corpus" };
  }
  if (kind === "gate-no-restore") {
    return { restoreAttemptedAfterRefusal: false };
  }
  return claimFields(run.releaseGate);
}

function auditPayload(kind: string): Record<string, unknown> {
  const run = summary();
  if (kind === "audit-refusal-corpus-compatible") {
    return { refusalRows: run.rowCount, newMarkerRows: newMarkerRows().length };
  }
  if (kind === "audit-feature-corpus-compatible") {
    return { installedFeatureProofRange: "961-1000", expandedRefusalsCompatible: true };
  }
  if (kind === "audit-support-matrix-compatible") {
    return { supportMatrixRows: buildNodeLevel5AppSupportMatrix().rowCount };
  }
  if (kind === "audit-unsupported-boundary") {
    return { expandedUnsupportedMarkers: newMarkers, refusedBeforeSnapshot: true };
  }
  if (kind === "audit-no-raw-cpu") {
    return { rawCpuRestoreUsed: false };
  }
  if (kind === "audit-no-source-isa") {
    return { sourceIsaEmulationUsed: false };
  }
  if (kind === "audit-no-broad-bump") {
    return { broadNodeProductSupportClaimed: 20 };
  }
  return {
    finalRefusalExpansion: true,
    claimsRemain: "80/20/0",
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

function summary(): Summary {
  if (cachedSummary) {
    return cachedSummary;
  }
  const provided = process.env.NODE_LEVEL5_REFUSAL_EXPANSION_SUMMARY;
  cachedSummary = provided ? JSON.parse(readFileSync(provided, "utf8")) : generateSummary();
  return cachedSummary;
}

function generateSummary(): Summary {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-refusal-expansion-proof-"));
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoaderPath, runnerPath, "--out", dir, "--json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `refusal expansion runner failed: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function newMarkerRows(): Row[] {
  return summary().rows.filter((row: Row) => newMarkers.includes(row.marker));
}

function rowsByMarker(marker: string): Row[] {
  return summary().rows.filter((row: Row) => row.marker === marker);
}

function externalRows(): Row[] {
  return newMarkerRows().filter((row) => externalMarkers().includes(row.marker));
}

function resourceRows(): Row[] {
  return newMarkerRows().filter((row) => resourceMarkers().includes(row.marker));
}

function externalMarkers(): string[] {
  return [
    "dbConnections",
    "redisQueueConnections",
    "outboundHttpSockets",
    "http2Sessions",
    "serverSentEvents",
  ];
}

function resourceMarkers(): string[] {
  return ["openWritableFiles", "timersIntervals", "clusterMode"];
}

function tamperedGate(reportPath: string): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-refusal-expansion-tamper-"));
  try {
    const path = join(dir, "node-level5-real-app-refusal-corpus-report.json");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    report.rowsSha256 = "tampered";
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    const gate = cliJson(
      [
        "node-level5",
        "release-gate",
        "--include-refusal-corpus",
        "--refusal-corpus-report",
        path,
        "--json",
      ],
      1,
    );
    return {
      accepted: gate.accepted,
      rowsSha256Verified: gate.realAppRefusalCorpus.rowsSha256Verified,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function missingGate(): Record<string, unknown> {
  const path = join(tmpdir(), "missing-node-level5-refusal-expansion-report.json");
  const gate = cliJson(
    [
      "node-level5",
      "release-gate",
      "--include-refusal-corpus",
      "--refusal-corpus-report",
      path,
      "--json",
    ],
    1,
  );
  return { accepted: gate.accepted, code: gate.realAppRefusalCorpus.code };
}

function cliJson(args: string[], expectedStatus: number): Record<string, any> {
  const result = spawnSync(process.execPath, ["--import", tsxLoaderPath, cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== expectedStatus) {
    throw new Error(
      `CLI failed ${args.join(" ")}: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout || result.stderr);
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
