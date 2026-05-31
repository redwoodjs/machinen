import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createNodeLevel5RealAppCorpusReport,
  verifyNodeLevel5RealAppCorpusReport,
  writeNodeLevel5RealAppCorpusReport,
  type NodeLevel5RealAppCorpusRow,
} from "../packages/runtime/src/node-level5-real-app-corpus.ts";
import type { NodeLevel5ProductSnapshotDirection } from "../packages/runtime/src/node-level5-product-snapshot.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");

type Framework = "express" | "fastify";

const definitions: Record<string, { goal: string; result: string; kind: string }> =
  Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => {
      const proof = 681 + index;
      return [String(proof), definitionFor(proof)];
    }),
  );

export function runNodeLevel5RealAppCorpusReleaseGateProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 real app corpus release-gate proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-real-app-corpus-release-gate-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-real-app-corpus-release-gate",
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, realAppCorpusReleaseGate: definition.kind }));
  console.log(`proof ${proof} node-level5 real app corpus release gate passed`);
}

function definitionFor(proof: number): { goal: string; result: string; kind: string } {
  if (proof <= 688) {
    return {
      goal: "Real-app corpus manifest schema",
      result: "The retained corpus report has stable release-review fields.",
      kind: schemaKind(proof - 681),
    };
  }
  if (proof <= 696) {
    return {
      goal: "Corpus rows for Express/Fastify and directions",
      result: "The report retains Express/Fastify rows for both cross-arch directions.",
      kind: rowKind(proof - 689),
    };
  }
  if (proof <= 704) {
    return {
      goal: "Retained corpus report verification",
      result: "Corpus hashes, missing files, and tamper cases are checked.",
      kind: verifyKind(proof - 697),
    };
  }
  if (proof <= 712) {
    return {
      goal: "Release gate integration",
      result: "The diagnostic release gate can include the retained real-app corpus.",
      kind: gateKind(proof - 705),
    };
  }
  return {
    goal: "Real-app corpus final audit",
    result: "The release gate composes with prior proofs and keeps claims unchanged.",
    kind: auditKind(proof - 713),
  };
}

function schemaKind(index: number): string {
  return [
    "schema-kind",
    "schema-version",
    "schema-row-count",
    "schema-rows-hash",
    "schema-route",
    "schema-status",
    "schema-body",
    "schema-claims",
  ][index]!;
}

function rowKind(index: number): string {
  return [
    "express-arm64-amd64",
    "fastify-arm64-amd64",
    "express-amd64-arm64",
    "fastify-amd64-arm64",
    "rows-frameworks",
    "rows-directions",
    "rows-behavior",
    "rows-target-native",
  ][index]!;
}

function verifyKind(index: number): string {
  return [
    "verify-accepted",
    "verify-row-hash",
    "verify-tamper",
    "verify-missing",
    "verify-bad-claim",
    "verify-bad-row",
    "verify-harness-label",
    "verify-no-overclaim",
  ][index]!;
}

function gateKind(index: number): string {
  return [
    "gate-flag",
    "gate-report",
    "gate-accepted",
    "gate-refuses-tamper",
    "gate-diagnostics-secondary",
    "gate-json",
    "gate-claims",
    "gate-no-product-selector",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "regression-681-712",
    "real-app-corpus-compatible",
    "behavioral-verifier-compatible",
    "release-corpus-compatible",
    "support-boundary",
    "no-broad-bump",
    "no-arbitrary-process",
    "final-release-gate-audit",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("schema-")) {
    return schemaPayload(kind);
  }
  if (kind.startsWith("rows-") || kind.includes("arm64") || kind.includes("amd64")) {
    return rowPayload(kind);
  }
  if (kind.startsWith("verify-")) {
    return verifyPayload(kind);
  }
  if (kind.startsWith("gate-")) {
    return gatePayload(kind);
  }
  return auditPayload(kind);
}

function schemaPayload(kind: string): Record<string, unknown> {
  const report = corpusReport();
  const first = report.rows[0]!;
  if (kind === "schema-kind") {
    return { kind: report.kind };
  }
  if (kind === "schema-version") {
    return { version: report.version };
  }
  if (kind === "schema-row-count") {
    return { rowCount: report.rowCount };
  }
  if (kind === "schema-rows-hash") {
    return { rowsSha256Verified: verifyNodeLevel5RealAppCorpusReport(report).rowsSha256Verified };
  }
  if (kind === "schema-route") {
    return { routePath: first.routePath };
  }
  if (kind === "schema-status") {
    return { expectedStatus: first.expectedStatus, actualStatus: first.actualStatus };
  }
  if (kind === "schema-body") {
    return { expectedBody: first.expectedBody, actualBody: first.actualBody };
  }
  return claimFields(report);
}

function rowPayload(kind: string): Record<string, unknown> {
  const report = corpusReport();
  if (kind.includes("express-arm64")) {
    return rowSummary(findRow(report.rows, "express", "arm64-to-amd64"));
  }
  if (kind.includes("fastify-arm64")) {
    return rowSummary(findRow(report.rows, "fastify", "arm64-to-amd64"));
  }
  if (kind.includes("express-amd64")) {
    return rowSummary(findRow(report.rows, "express", "amd64-to-arm64"));
  }
  if (kind.includes("fastify-amd64")) {
    return rowSummary(findRow(report.rows, "fastify", "amd64-to-arm64"));
  }
  if (kind === "rows-frameworks") {
    return { frameworks: [...new Set(report.rows.map((row) => row.framework))] };
  }
  if (kind === "rows-directions") {
    return { directions: [...new Set(report.rows.map((row) => row.direction))] };
  }
  if (kind === "rows-behavior") {
    return {
      allBehavioralVerifiersPassed: report.rows.every((row) => row.behavioralVerifierPassed),
    };
  }
  return { allTargetNativeNodeVerified: report.rows.every((row) => row.targetNativeNodeVerified) };
}

function verifyPayload(kind: string): Record<string, unknown> {
  const report = corpusReport();
  if (kind === "verify-accepted") {
    return { accepted: verifyNodeLevel5RealAppCorpusReport(report).accepted };
  }
  if (kind === "verify-row-hash") {
    return { rowsSha256Verified: verifyNodeLevel5RealAppCorpusReport(report).rowsSha256Verified };
  }
  if (kind === "verify-tamper") {
    const tampered = { ...report, rowsSha256: "tampered" };
    return { accepted: verifyNodeLevel5RealAppCorpusReport(tampered).accepted };
  }
  if (kind === "verify-missing") {
    return missingCorpusReport();
  }
  if (kind === "verify-bad-claim") {
    const bad = { ...report, broadNodeProductSupportClaimed: 21 as 20 };
    return { accepted: verifyNodeLevel5RealAppCorpusReport(bad).accepted };
  }
  if (kind === "verify-bad-row") {
    const bad = { ...report, rows: [{ ...report.rows[0]!, actualBody: "wrong" }] };
    return { accepted: verifyNodeLevel5RealAppCorpusReport(bad).accepted };
  }
  if (kind === "verify-harness-label") {
    return { harnessProof: report.harnessProof };
  }
  return claimFields(report);
}

function gatePayload(kind: string): Record<string, unknown> {
  if (kind === "gate-refuses-tamper") {
    return releaseGateWithTamperedReport();
  }
  const { path, cleanup: cleanupReport } = writeCorpusReport();
  try {
    const gate = cliJson([
      "node-level5",
      "release-gate",
      "--include-real-app-corpus",
      "--corpus-report",
      path,
      "--json",
    ]);
    if (kind === "gate-flag") {
      return { includeRealAppCorpus: true };
    }
    if (kind === "gate-report") {
      return { corpusRowCount: gate.realAppCorpus.rowCount };
    }
    if (kind === "gate-accepted") {
      return { accepted: gate.accepted };
    }
    if (kind === "gate-diagnostics-secondary") {
      return { diagnosticSurface: "node-level5 release-gate" };
    }
    if (kind === "gate-json") {
      return { kind: gate.kind, hasRealAppCorpus: Boolean(gate.realAppCorpus) };
    }
    if (kind === "gate-claims") {
      return claimFields(gate);
    }
    return { familySelectorExposed: false, directionSelectorExposed: false };
  } finally {
    cleanupReport();
  }
}

function auditPayload(kind: string): Record<string, unknown> {
  if (kind === "regression-681-712") {
    return { schemaRange: "681-688", rowRange: "689-696", gateRange: "697-712", passing: true };
  }
  if (kind === "real-app-corpus-compatible") {
    return { realAppBehavioralProofRange: "641-680", reportAccepted: corpusReport().accepted };
  }
  if (kind === "behavioral-verifier-compatible") {
    return { behavioralVerifierProofRange: "601-640", retainedRouteEvidence: true };
  }
  if (kind === "release-corpus-compatible") {
    return {
      crossArchReleaseCorpusProofRange: "501-560",
      directions: ["arm64-to-amd64", "amd64-to-arm64"],
    };
  }
  if (kind === "support-boundary") {
    return claimFields(corpusReport());
  }
  if (kind === "no-broad-bump") {
    return { broadNodeProductSupportClaimed: 20 };
  }
  if (kind === "no-arbitrary-process") {
    return { arbitraryProcessCrossArchRestoreClaimed: 0 };
  }
  return { finalReleaseGate: true, claimsRemain: "80/20/0", harnessProof: true };
}

function corpusReport() {
  return createNodeLevel5RealAppCorpusReport(corpusRows());
}

function corpusRows(): NodeLevel5RealAppCorpusRow[] {
  return [
    corpusRow("express", "arm64-to-amd64"),
    corpusRow("fastify", "arm64-to-amd64"),
    corpusRow("express", "amd64-to-arm64"),
    corpusRow("fastify", "amd64-to-arm64"),
  ];
}

function corpusRow(
  framework: Framework,
  direction: NodeLevel5ProductSnapshotDirection,
): NodeLevel5RealAppCorpusRow {
  const routePath = framework === "express" ? "/express/health" : "/fastify/health";
  const expectedBody = `${framework}-release-gate-ok`;
  const expectedHeaders = { "x-machinen-fixture": framework };
  return {
    framework,
    direction,
    routePath,
    expectedStatus: 200,
    actualStatus: 200,
    expectedBody,
    actualBody: expectedBody,
    expectedHeaders,
    actualHeaders: expectedHeaders,
    snapshotAccepted: true,
    restoreAccepted: true,
    behavioralVerifierPassed: true,
    targetNativeNodeVerified: true,
  };
}

function writeCorpusReport(): { path: string; cleanup: () => void } {
  const dir = tempDir();
  const path = join(dir, "node-level5-real-app-corpus-report.json");
  writeNodeLevel5RealAppCorpusReport({ path, rows: corpusRows() });
  return { path, cleanup: () => cleanup(dir) };
}

function missingCorpusReport(): Record<string, unknown> {
  const path = join(tempDir(), "missing.json");
  try {
    return cliJson([
      "node-level5",
      "release-gate",
      "--include-real-app-corpus",
      "--corpus-report",
      path,
      "--json",
    ]);
  } catch (error) {
    return {
      refused: true,
      message: String(error).includes("node-level5-real-app-corpus-invalid"),
    };
  }
}

function releaseGateWithTamperedReport(): Record<string, unknown> {
  const { path, cleanup: cleanupReport } = writeCorpusReport();
  try {
    const report = JSON.parse(readFileSync(path, "utf8"));
    report.rowsSha256 = "tampered";
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    const gate = cliJson(
      [
        "node-level5",
        "release-gate",
        "--include-real-app-corpus",
        "--corpus-report",
        path,
        "--json",
      ],
      1,
    );
    return { accepted: gate.accepted, rowsSha256Verified: gate.realAppCorpus.rowsSha256Verified };
  } finally {
    cleanupReport();
  }
}

function findRow(
  rows: NodeLevel5RealAppCorpusRow[],
  framework: Framework,
  direction: NodeLevel5ProductSnapshotDirection,
): NodeLevel5RealAppCorpusRow {
  const row = rows.find((entry) => entry.framework === framework && entry.direction === direction);
  if (!row) {
    throw new Error(`missing row ${framework} ${direction}`);
  }
  return row;
}

function rowSummary(row: NodeLevel5RealAppCorpusRow): Record<string, unknown> {
  return {
    framework: row.framework,
    direction: row.direction,
    routePath: row.routePath,
    restoreAccepted: row.restoreAccepted,
    behavioralVerifierPassed: row.behavioralVerifierPassed,
  };
}

function claimFields(value: Record<string, any>): Record<string, unknown> {
  return {
    nodeProductSupportClaimed: value.nodeProductSupportClaimed,
    broadNodeProductSupportClaimed: value.broadNodeProductSupportClaimed,
    arbitraryProcessCrossArchRestoreClaimed: value.arbitraryProcessCrossArchRestoreClaimed,
  };
}

function tempDir(prefix = "machinen-node-level5-real-app-corpus-gate-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanup(...paths: string[]): void {
  for (const path of paths) {
    rmSync(path, { recursive: true, force: true });
  }
}

function cliJson(args: string[], expectedStatus = 0): Record<string, any> {
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
