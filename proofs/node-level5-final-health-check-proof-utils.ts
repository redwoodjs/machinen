import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNodeLevel5AppSupportMatrix } from "../packages/runtime/src/node-level5-app-support-matrix.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = join(repoRoot, "scripts/node-level5-installed-third-party-app-corpus.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const finalHealthCheckSources = [
  "express-installed-health-check",
  "fastify-installed-health-check",
];

type Summary = Record<string, any>;
type Row = Record<string, any>;
type Definition = { goal: string; result: string; kind: string };

const definitions: Record<string, Definition> = Object.fromEntries(
  Array.from({ length: 20 }, (_, index) => {
    const proof = 1401 + index;
    return [String(proof), definitionFor(proof)];
  }),
);

let cachedSummary: Summary | undefined;

export function runNodeLevel5FinalHealthCheckProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 final health-check proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-final-health-check-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-final-health-check-product-slice",
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, finalHealthCheckGate: definition.kind }));
  console.log(`proof ${proof} node-level5 final health-check gate passed`);
}

function definitionFor(proof: number): Definition {
  if (proof <= 1404) {
    return definition(
      "final health-check product corpus generator",
      "The installed product corpus includes selected Express/Fastify health-check apps.",
      generatorKind(proof - 1401),
    );
  }
  if (proof <= 1408) {
    return definition(
      "final health-check product-run evidence",
      "Selected Express/Fastify health-check rows pass snapshot, restore, and behavior checks.",
      evidenceKind(proof - 1405),
    );
  }
  if (proof <= 1412) {
    return definition(
      "final health-check support matrix reconciliation",
      "The matrix reaches 100 rows with only selected health-check rows added as support.",
      matrixKind(proof - 1409),
    );
  }
  if (proof <= 1416) {
    return definition(
      "final health-check boundary preservation",
      "Arbitrary Express/Fastify apps and broad app/process support remain unclaimed.",
      boundaryKind(proof - 1413),
    );
  }
  return definition(
    "final health-check audit",
    "The final two rows use target-native verification without changing 80/20/0 claims.",
    auditKind(proof - 1417),
  );
}

function definition(goal: string, result: string, kind: string): Definition {
  return { goal, result, kind };
}

function generatorKind(index: number): string {
  return ["runner-kind", "runner-accepted", "runner-row-count", "runner-health-check-sources"][
    index
  ]!;
}

function evidenceKind(index: number): string {
  return ["evidence-snapshot", "evidence-restore", "evidence-behavior", "evidence-target-native"][
    index
  ]!;
}

function matrixKind(index: number): string {
  return [
    "matrix-row-count",
    "matrix-supported-count",
    "matrix-health-check-supported",
    "matrix-health-check-proof-range",
  ][index]!;
}

function boundaryKind(index: number): string {
  return [
    "boundary-selected-apps-only",
    "boundary-arbitrary-node",
    "boundary-raw-cpu",
    "boundary-no-broad-bump",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "audit-installed-corpus-compatible",
    "audit-matrix-compatible",
    "audit-target-native",
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
  const rows = finalHealthCheckRows();
  const payloads: Record<string, Record<string, unknown>> = {
    "runner-kind": { generatedSummaryKind: run.kind },
    "runner-accepted": { accepted: run.accepted },
    "runner-row-count": { rowCount: run.rowCount },
    "runner-health-check-sources": { sources: unique(rows.map((row) => row.source)) },
  };
  return payloads[kind]!;
}

function evidencePayload(kind: string): Record<string, unknown> {
  const rows = finalHealthCheckRows();
  const payloads: Record<string, Record<string, unknown>> = {
    "evidence-snapshot": { allSnapshotAccepted: rows.every((row) => row.snapshotAccepted) },
    "evidence-restore": { allRestoreAccepted: rows.every((row) => row.restoreAccepted) },
    "evidence-behavior": {
      allBehavioralVerifiersPassed: rows.every((row) => row.behavioralVerifierPassed),
    },
    "evidence-target-native": {
      allTargetNativeNodeVerified: rows.every((row) => row.targetNativeNodeVerified),
    },
  };
  return payloads[kind]!;
}

function matrixPayload(kind: string): Record<string, unknown> {
  const matrix = buildNodeLevel5AppSupportMatrix();
  const selected = matrix.rows.filter((row) => finalHealthCheckSources.includes(row.id));
  const payloads: Record<string, Record<string, unknown>> = {
    "matrix-row-count": { rowCount: matrix.rowCount },
    "matrix-supported-count": {
      supportedRows: matrix.rows.filter((row) => row.status === "supported").length,
    },
    "matrix-health-check-supported": { ids: selected.map((row) => row.id).sort() },
    "matrix-health-check-proof-range": {
      healthCheckProofRanges: unique(selected.map((row) => row.evidence.proofRange)),
    },
  };
  return payloads[kind]!;
}

function boundaryPayload(kind: string): Record<string, unknown> {
  const boundaries = buildNodeLevel5AppSupportMatrix().boundaries;
  const payloads: Record<string, Record<string, unknown>> = {
    "boundary-selected-apps-only": { supportedFinalHealthCheckSources: finalHealthCheckSources },
    "boundary-arbitrary-node": boundaryEntry(boundaries, "arbitrary-node-process"),
    "boundary-raw-cpu": boundaryEntry(boundaries, "raw-cross-arch-cpu-restore"),
    "boundary-no-broad-bump": { broadNodeProductSupportClaimed: 20 },
  };
  return payloads[kind]!;
}

function auditPayload(kind: string): Record<string, unknown> {
  const rows = finalHealthCheckRows();
  const payloads: Record<string, Record<string, unknown>> = {
    "audit-installed-corpus-compatible": { installedCorpusRows: summary().rowCount },
    "audit-matrix-compatible": { matrixRows: buildNodeLevel5AppSupportMatrix().rowCount },
    "audit-target-native": {
      targetNativeNodeVerified: rows.every((row) => row.targetNativeNodeVerified),
    },
    "audit-final": { accepted: summary().accepted, claimsRemain: "80/20/0" },
  };
  return payloads[kind]!;
}

function summary(): Summary {
  if (cachedSummary) {
    return cachedSummary;
  }
  const provided = process.env.NODE_LEVEL5_FINAL_HEALTH_CHECK_SUMMARY;
  cachedSummary = provided ? JSON.parse(readFileSync(provided, "utf8")) : generateSummary();
  return cachedSummary;
}

function generateSummary(): Summary {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-final-health-check-proof-"));
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoaderPath, runnerPath, "--out", dir, "--json"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      `final health-check corpus runner failed: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function finalHealthCheckRows(): Row[] {
  return summary().rows.filter((row: Row) => finalHealthCheckSources.includes(row.source));
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
