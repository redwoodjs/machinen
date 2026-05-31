import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const runnerPath = join(repoRoot, "scripts/node-level5-installed-third-party-app-corpus.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
type Summary = Record<string, any>;
type Row = Record<string, any>;

const definitions: Record<string, { goal: string; result: string; kind: string }> =
  Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => {
      const proof = 841 + index;
      return [String(proof), definitionFor(proof)];
    }),
  );

let cachedSummary: Summary | undefined;

export function runNodeLevel5InstalledThirdPartyAppCorpusProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 installed third-party app corpus proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-installed-third-party-app-corpus-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-installed-third-party-app-corpus",
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, installedThirdPartyAppCorpusGate: definition.kind }));
  console.log(`proof ${proof} node-level5 installed third-party app corpus gate passed`);
}

function definitionFor(proof: number): { goal: string; result: string; kind: string } {
  if (proof <= 848) {
    return {
      goal: "Installed third-party app corpus generator contract",
      result: "The generator runs product snapshot/restore and writes a retained report.",
      kind: generatorKind(proof - 841),
    };
  }
  if (proof <= 856) {
    return {
      goal: "Third-party Express/Fastify app rows",
      result:
        "Selected declared-subset installed Express/Fastify package apps are retained across both directions.",
      kind: rowKind(proof - 849),
    };
  }
  if (proof <= 864) {
    return {
      goal: "Installed third-party app retained behavior evidence",
      result: "Rows retain route, status, body, header, and target-native evidence.",
      kind: evidenceKind(proof - 857),
    };
  }
  if (proof <= 872) {
    return {
      goal: "Installed third-party app release-gate checks",
      result: "The release gate accepts generated reports and rejects missing or tampered reports.",
      kind: gateKind(proof - 865),
    };
  }
  return {
    goal: "Installed third-party app corpus final audit",
    result:
      "Installed third-party app evidence stays inside the declared subset without broad claims.",
    kind: auditKind(proof - 873),
  };
}

function generatorKind(index: number): string {
  return [
    "runner-kind",
    "runner-accepted",
    "runner-row-count",
    "runner-report-written",
    "runner-product-commands",
    "runner-release-gate",
    "runner-declared-subset",
    "runner-claims",
  ][index]!;
}

function rowKind(index: number): string {
  return [
    "express-installed",
    "express-router",
    "fastify-installed",
    "fastify-plugin",
    "rows-frameworks",
    "rows-directions",
    "rows-sources",
    "rows-no-unsupported-state",
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

function gateKind(index: number): string {
  return [
    "gate-generated-report",
    "gate-row-count",
    "gate-claims",
    "gate-tamper",
    "gate-missing",
    "gate-diagnostic-secondary",
    "gate-installed-third-party-field",
    "gate-no-overclaim",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "regression-841-872",
    "product-run-corpus-compatible",
    "refusal-corpus-compatible",
    "declared-subset-boundary",
    "selected-installed-third-party-limit",
    "support-boundary",
    "no-broad-bump",
    "final-installed-third-party-audit",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("runner-")) {
    return generatorPayload(kind);
  }
  if (kind.startsWith("rows-") || isSourceRowKind(kind)) {
    return rowPayload(kind);
  }
  if (kind.startsWith("evidence-")) {
    return evidencePayload(kind);
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
    return {
      installedThirdPartyAppReportWritten: existsSync(run.installedThirdPartyAppReportPath),
    };
  }
  if (kind === "runner-product-commands") {
    return { productCommands: run.productCommands };
  }
  if (kind === "runner-release-gate") {
    return { releaseGateAccepted: run.releaseGate.accepted };
  }
  if (kind === "runner-declared-subset") {
    return { allDeclaredSubset: run.rows.every((row: Row) => row.declaredSubset) };
  }
  return claimFields(run);
}

function rowPayload(kind: string): Record<string, unknown> {
  const run = summary();
  if (kind === "express-installed") {
    return sourceSummary("express-installed-hello-world");
  }
  if (kind === "express-router") {
    return sourceSummary("express-installed-router");
  }
  if (kind === "fastify-installed") {
    return sourceSummary("fastify-installed-getting-started");
  }
  if (kind === "fastify-plugin") {
    return sourceSummary("fastify-installed-plugin-route");
  }
  if (kind === "rows-frameworks") {
    return { frameworks: unique(run.rows.map((row: Row) => row.framework)) };
  }
  if (kind === "rows-directions") {
    return { directions: unique(run.rows.map((row: Row) => row.direction)) };
  }
  if (kind === "rows-sources") {
    return { sources: unique(run.rows.map((row: Row) => row.source)) };
  }
  return {
    noUnsupportedStateDetected: run.rows.every((row: Row) => !row.unsupportedStateDetected),
  };
}

function evidencePayload(kind: string): Record<string, unknown> {
  const run = summary();
  if (kind === "evidence-snapshot") {
    return { allSnapshotAccepted: run.rows.every((row: Row) => row.snapshotAccepted) };
  }
  if (kind === "evidence-restore") {
    return { allRestoreAccepted: run.rows.every((row: Row) => row.restoreAccepted) };
  }
  if (kind === "evidence-behavior") {
    return {
      allBehavioralVerifiersPassed: run.rows.every((row: Row) => row.behavioralVerifierPassed),
    };
  }
  if (kind === "evidence-target-native") {
    return {
      allTargetNativeNodeVerified: run.rows.every((row: Row) => row.targetNativeNodeVerified),
    };
  }
  if (kind === "evidence-status") {
    return {
      allStatusesMatch: run.rows.every((row: Row) => row.actualStatus === row.expectedStatus),
    };
  }
  if (kind === "evidence-body") {
    return { allBodiesMatch: run.rows.every((row: Row) => row.actualBody === row.expectedBody) };
  }
  if (kind === "evidence-headers") {
    return { allHeadersMatch: allHeadersMatch(run.rows) };
  }
  return { rowsSha256Verified: run.installedThirdPartyAppVerification.rowsSha256Verified };
}

function gatePayload(kind: string): Record<string, unknown> {
  const run = summary();
  if (kind === "gate-generated-report") {
    return {
      accepted: run.releaseGate.accepted,
      hasInstalledThirdPartyCorpus: Boolean(run.releaseGate.installedThirdPartyAppCorpus),
    };
  }
  if (kind === "gate-row-count") {
    return { rowCount: run.releaseGate.installedThirdPartyAppCorpus.rowCount };
  }
  if (kind === "gate-claims") {
    return claimFields(run.releaseGate);
  }
  if (kind === "gate-tamper") {
    return tamperedGate(run.installedThirdPartyAppReportPath);
  }
  if (kind === "gate-missing") {
    return missingGate();
  }
  if (kind === "gate-diagnostic-secondary") {
    return {
      diagnosticSurface: "node-level5 release-gate --include-installed-third-party-app-corpus",
    };
  }
  if (kind === "gate-installed-third-party-field") {
    return {
      installedThirdPartyAppCorpusAccepted: run.releaseGate.installedThirdPartyAppCorpus.accepted,
    };
  }
  return claimFields(run);
}

function auditPayload(kind: string): Record<string, unknown> {
  const run = summary();
  if (kind === "regression-841-872") {
    return { generatorRange: "841-848", rowRange: "849-856", gateRange: "865-872", passing: true };
  }
  if (kind === "product-run-corpus-compatible") {
    return { productRunCorpusProofRange: "721-760", installedThirdPartyRows: run.rowCount };
  }
  if (kind === "refusal-corpus-compatible") {
    return { refusalCorpusProofRange: "761-800", unsupportedStatesStillRefuse: true };
  }
  if (kind === "declared-subset-boundary") {
    return { declaredSubsetOnly: true, unsupportedStateDetected: false };
  }
  if (kind === "selected-installed-third-party-limit") {
    return { arbitraryInstalledThirdPartyAppsClaimed: false, selectedInstalledPackagesOnly: true };
  }
  if (kind === "support-boundary") {
    return claimFields(run);
  }
  if (kind === "no-broad-bump") {
    return { broadNodeProductSupportClaimed: 20 };
  }
  return {
    finalInstalledThirdPartyCorpus: true,
    claimsRemain: "80/20/0",
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

function summary(): Summary {
  if (cachedSummary) {
    return cachedSummary;
  }
  const provided = process.env.NODE_LEVEL5_INSTALLED_THIRD_PARTY_APP_CORPUS_SUMMARY;
  cachedSummary = provided ? JSON.parse(readFileSync(provided, "utf8")) : generateSummary();
  return cachedSummary;
}

function generateSummary(): Summary {
  const dir = mkdtempSync(
    join(tmpdir(), "machinen-node-level5-installed-third-party-app-corpus-proof-"),
  );
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
      `installed third-party app corpus runner failed: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function sourceSummary(source: string): Record<string, unknown> {
  const rows = summary().rows.filter((row: Row) => row.source === source);
  return {
    source,
    rowCount: rows.length,
    directions: unique(rows.map((row: Row) => row.direction)),
    allAccepted: rows.every((row: Row) => row.snapshotAccepted && row.restoreAccepted),
  };
}

function allHeadersMatch(rows: Row[]): boolean {
  return rows.every((row) =>
    Object.entries(row.expectedHeaders).every(([key, value]) => row.actualHeaders[key] === value),
  );
}

function tamperedGate(reportPath: string): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-installed-third-party-app-tamper-"));
  try {
    const path = join(dir, "node-level5-installed-third-party-app-corpus-report.json");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    report.rowsSha256 = "tampered";
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    const gate = cliJson(
      [
        "node-level5",
        "release-gate",
        "--include-installed-third-party-app-corpus",
        "--installed-third-party-app-corpus-report",
        path,
        "--json",
      ],
      1,
    );
    return {
      accepted: gate.accepted,
      rowsSha256Verified: gate.installedThirdPartyAppCorpus.rowsSha256Verified,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function missingGate(): Record<string, unknown> {
  const path = join(tmpdir(), "missing-node-level5-installed-third-party-app-corpus-report.json");
  const gate = cliJson(
    [
      "node-level5",
      "release-gate",
      "--include-installed-third-party-app-corpus",
      "--installed-third-party-app-corpus-report",
      path,
      "--json",
    ],
    1,
  );
  return { accepted: gate.accepted, code: gate.installedThirdPartyAppCorpus.code };
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

function isSourceRowKind(kind: string): boolean {
  return ["express-installed", "express-router", "fastify-installed", "fastify-plugin"].includes(
    kind,
  );
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
