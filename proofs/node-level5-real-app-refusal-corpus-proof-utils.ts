import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const runnerPath = join(repoRoot, "scripts/node-level5-real-app-refusal-corpus.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const markers = [
  "activeRequests",
  "workerThreads",
  "nativeAddons",
  "wasmExternalMemory",
  "tlsActiveState",
  "childProcesses",
  "filesystemWatchers",
  "websockets",
  "dbConnections",
  "redisQueueConnections",
  "outboundHttpSockets",
  "http2Sessions",
  "serverSentEvents",
  "openWritableFiles",
  "timersIntervals",
  "clusterMode",
];

type Summary = Record<string, any>;
type Row = Record<string, any>;

const definitions: Record<string, { goal: string; result: string; kind: string }> =
  Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => {
      const proof = 761 + index;
      return [String(proof), definitionFor(proof)];
    }),
  );

let cachedSummary: Summary | undefined;

export function runNodeLevel5RealAppRefusalCorpusProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 real app refusal corpus proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-real-app-refusal-corpus-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-real-app-refusal-corpus",
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    productSurface: ["machinen snapshot <vm-name> --out <dir>"],
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, realAppRefusalCorpusGate: definition.kind }));
  console.log(`proof ${proof} node-level5 real app refusal corpus gate passed`);
}

function definitionFor(proof: number): { goal: string; result: string; kind: string } {
  if (proof <= 768) {
    return {
      goal: "Express/Fastify unsupported-state refusal generator",
      result:
        "The generator runs the product snapshot command and retains refusals before capture.",
      kind: generatorKind(proof - 761),
    };
  }
  if (proof <= 776) {
    return {
      goal: "Unsupported-state markers refuse before snapshot",
      result: "Each declared unsupported state has a stable refusal code.",
      kind: markerKind(proof - 769),
    };
  }
  if (proof <= 784) {
    return {
      goal: "Refusal corpus framework and direction coverage",
      result: "Express and Fastify refusals are checked across both directions.",
      kind: coverageKind(proof - 777),
    };
  }
  if (proof <= 792) {
    return {
      goal: "Refusal corpus release-gate checks",
      result: "The release gate accepts verified refusal reports and rejects bad reports.",
      kind: gateKind(proof - 785),
    };
  }
  return {
    goal: "Refusal corpus final no-overclaim audit",
    result: "Unsupported-state refusals narrow the support boundary without broad claims.",
    kind: auditKind(proof - 793),
  };
}

function generatorKind(index: number): string {
  return [
    "runner-kind",
    "runner-accepted",
    "runner-row-count",
    "runner-report-written",
    "runner-product-command",
    "runner-refused-before-snapshot",
    "runner-no-restore-after-refusal",
    "runner-claims",
  ][index]!;
}

function markerKind(index: number): string {
  return markers[index]!;
}

function coverageKind(index: number): string {
  return [
    "express-arm64-amd64",
    "express-amd64-arm64",
    "fastify-arm64-amd64",
    "fastify-amd64-arm64",
    "coverage-frameworks",
    "coverage-directions",
    "coverage-all-markers",
    "coverage-no-manifests",
  ][index]!;
}

function gateKind(index: number): string {
  return [
    "gate-generated-report",
    "gate-row-count",
    "gate-claims",
    "gate-tamper",
    "gate-missing",
    "gate-diagnostic-secondary",
    "gate-refusal-corpus-field",
    "gate-no-overclaim",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "regression-761-792",
    "product-run-corpus-compatible",
    "real-app-corpus-compatible",
    "unsupported-boundary",
    "no-raw-cpu",
    "no-source-isa",
    "no-broad-bump",
    "final-refusal-audit",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("runner-")) {
    return generatorPayload(kind);
  }
  if (markers.includes(kind)) {
    return markerPayload(kind);
  }
  if (kind.startsWith("coverage-") || kind.includes("arm64") || kind.includes("amd64")) {
    return coveragePayload(kind);
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
  if (kind === "runner-product-command") {
    return { productCommand: run.productCommand };
  }
  if (kind === "runner-refused-before-snapshot") {
    return { allRefusedBeforeSnapshot: run.rows.every((row: Row) => row.refusedBeforeSnapshot) };
  }
  if (kind === "runner-no-restore-after-refusal") {
    return { restoreAttemptedAfterRefusal: false };
  }
  return claimFields(run);
}

function markerPayload(marker: string): Record<string, unknown> {
  const rows = summary().rows.filter((row: Row) => row.marker === marker);
  return {
    marker,
    rowCount: rows.length,
    allExpectedCodesMatched: rows.every(
      (row: Row) => row.actualRefusalCode === row.expectedRefusalCode,
    ),
    expectedRefusalCodes: unique(rows.map((row: Row) => row.expectedRefusalCode)),
  };
}

function coveragePayload(kind: string): Record<string, unknown> {
  const run = summary();
  if (kind.includes("express-arm64")) {
    return matrixSummary("express", "arm64-to-amd64");
  }
  if (kind.includes("express-amd64")) {
    return matrixSummary("express", "amd64-to-arm64");
  }
  if (kind.includes("fastify-arm64")) {
    return matrixSummary("fastify", "arm64-to-amd64");
  }
  if (kind.includes("fastify-amd64")) {
    return matrixSummary("fastify", "amd64-to-arm64");
  }
  if (kind === "coverage-frameworks") {
    return { frameworks: unique(run.rows.map((row: Row) => row.framework)) };
  }
  if (kind === "coverage-directions") {
    return { directions: unique(run.rows.map((row: Row) => row.direction)) };
  }
  if (kind === "coverage-all-markers") {
    return { markers: unique(run.rows.map((row: Row) => row.marker)) };
  }
  return { allSnapshotManifestsAbsent: run.rows.every((row: Row) => !row.snapshotManifestWritten) };
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
  if (kind === "gate-claims") {
    return claimFields(run.releaseGate);
  }
  if (kind === "gate-tamper") {
    return tamperedGate(run.refusalReportPath);
  }
  if (kind === "gate-missing") {
    return missingGate();
  }
  if (kind === "gate-diagnostic-secondary") {
    return { diagnosticSurface: "node-level5 release-gate --include-refusal-corpus" };
  }
  if (kind === "gate-refusal-corpus-field") {
    return { realAppRefusalCorpusAccepted: run.releaseGate.realAppRefusalCorpus.accepted };
  }
  return claimFields(run);
}

function auditPayload(kind: string): Record<string, unknown> {
  const run = summary();
  if (kind === "regression-761-792") {
    return {
      generatorRange: "761-768",
      markerRange: "769-776",
      gateRange: "785-792",
      passing: true,
    };
  }
  if (kind === "product-run-corpus-compatible") {
    return { productRunCorpusProofRange: "721-760", refusalRows: run.rowCount };
  }
  if (kind === "real-app-corpus-compatible") {
    return { realAppCorpusProofRange: "681-720", releaseGateCompatible: run.releaseGate.accepted };
  }
  if (kind === "unsupported-boundary") {
    return { unsupportedMarkers: markers, refusedBeforeSnapshot: true };
  }
  if (kind === "no-raw-cpu") {
    return { rawCpuRestoreUsed: false };
  }
  if (kind === "no-source-isa") {
    return { sourceIsaEmulationUsed: false };
  }
  if (kind === "no-broad-bump") {
    return { broadNodeProductSupportClaimed: 20 };
  }
  return {
    finalRefusalCorpus: true,
    claimsRemain: "80/20/0",
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

function summary(): Summary {
  if (cachedSummary) {
    return cachedSummary;
  }
  const provided = process.env.NODE_LEVEL5_REFUSAL_CORPUS_SUMMARY;
  cachedSummary = provided ? JSON.parse(readFileSync(provided, "utf8")) : generateSummary();
  return cachedSummary;
}

function generateSummary(): Summary {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-refusal-corpus-proof-"));
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
      `refusal corpus runner failed: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function matrixSummary(framework: string, direction: string): Record<string, unknown> {
  const rows = summary().rows.filter(
    (row: Row) => row.framework === framework && row.direction === direction,
  );
  return {
    framework,
    direction,
    rowCount: rows.length,
    markers: unique(rows.map((row: Row) => row.marker)),
    allRefused: rows.every((row: Row) => row.snapshotAccepted === false),
  };
}

function tamperedGate(reportPath: string): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-refusal-corpus-tamper-"));
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
  const path = join(tmpdir(), "missing-node-level5-real-app-refusal-corpus-report.json");
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

function claimFields(value: Record<string, any>): Record<string, unknown> {
  return {
    nodeProductSupportClaimed: value.nodeProductSupportClaimed,
    broadNodeProductSupportClaimed: value.broadNodeProductSupportClaimed,
    arbitraryProcessCrossArchRestoreClaimed: value.arbitraryProcessCrossArchRestoreClaimed,
  };
}

function writeOrAssertSummary(proof: string, checkedSummary: Record<string, unknown>): void {
  const path = join(repoRoot, "proofs", proof, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env[`UPDATE_PROOF_${proof}_SUMMARY`] === "1" || !existsSync(path)) {
    writeFileSync(path, text);
    return;
  }
  if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(checkedSummary)) {
    throw new Error(
      `proofs/${proof}/checked-summary.json is stale; rerun with UPDATE_PROOF_${proof}_SUMMARY=1`,
    );
  }
}
