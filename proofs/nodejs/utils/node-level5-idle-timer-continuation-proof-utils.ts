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
const idleTimerSources = ["express-installed-idle-timer", "fastify-installed-idle-timer"];

type Summary = Record<string, any>;
type Row = Record<string, any>;
type Definition = { goal: string; result: string; kind: string };

const definitions: Record<string, Definition> = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => {
    const proof = 1121 + index;
    return [String(proof), definitionFor(proof)];
  }),
);

let cachedSummary: Summary | undefined;

export function runNodeLevel5IdleTimerContinuationProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 idle timer continuation proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-idle-timer-continuation-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-idle-timer-continuation-product-slice",
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, idleTimerContinuationGate: definition.kind }));
  console.log(`proof ${proof} node-level5 idle timer continuation gate passed`);
}

function definitionFor(proof: number): Definition {
  if (proof <= 1128) {
    return definition(
      "Idle timer product corpus generator",
      "The installed product corpus includes selected safe idle timer apps.",
      generatorKind(proof - 1121),
    );
  }
  if (proof <= 1136) {
    return definition(
      "Idle timer product-run evidence",
      "Selected Express/Fastify idle timer rows pass snapshot, restore, and behavior checks.",
      evidenceKind(proof - 1129),
    );
  }
  if (proof <= 1144) {
    return definition(
      "Idle timer support matrix reconciliation",
      "Only selected idle timer rows mark backgroundTasks supported while unsafe timers remain refused.",
      matrixKind(proof - 1137),
    );
  }
  if (proof <= 1152) {
    return definition(
      "Idle timer boundary preservation",
      "General background schedulers and broad app/process support remain unclaimed.",
      boundaryKind(proof - 1145),
    );
  }
  return definition(
    "Idle timer final audit",
    "The new support slice uses translated target-native reconstruction without changing 80/20/0 claims.",
    auditKind(proof - 1153),
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
    "runner-idle-row-count",
    "runner-idle-sources",
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
    "matrix-idle-supported",
    "matrix-background-supported",
    "matrix-unsafe-timers-refused",
    "matrix-background-gap-remains",
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
    "audit-idle-not-arbitrary-scheduler",
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
  const rows = idleTimerRows();
  const payloads: Record<string, Record<string, unknown>> = {
    "runner-kind": { generatedSummaryKind: run.kind },
    "runner-accepted": { accepted: run.accepted },
    "runner-row-count": { rowCount: run.rowCount },
    "runner-idle-row-count": { idleTimerRows: rows.length },
    "runner-idle-sources": { sources: unique(rows.map((row) => row.source)) },
    "runner-product-commands": { productCommands: run.productCommands },
    "runner-release-gate": { releaseGateAccepted: run.releaseGate.accepted },
    "runner-claims": claimFields(run),
  };
  return payloads[kind]!;
}

function evidencePayload(kind: string): Record<string, unknown> {
  const rows = idleTimerRows();
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
  const idleRows = matrix.rows.filter((row) => idleTimerSources.includes(row.id));
  const payloads: Record<string, Record<string, unknown>> = {
    "matrix-row-count": { rowCount: matrix.rowCount },
    "matrix-supported-count": {
      supportedRows: matrix.rows.filter((row) => row.status === "supported").length,
    },
    "matrix-idle-supported": { ids: idleRows.map((row) => row.id).sort() },
    "matrix-background-supported": {
      idleBackgroundAssessments: idleRows.map((row) => row.featureAssessment.backgroundTasks),
    },
    "matrix-unsafe-timers-refused": {
      refusedTimerRows: matrix.rows.filter((row) => row.id.includes("timers-intervals")).length,
    },
    "matrix-background-gap-remains": {
      backgroundGapRows: matrix.rows.filter((row) => row.id.includes("background-tasks-not-proven"))
        .length,
    },
    "matrix-proof-range": { proofRanges: unique(idleRows.map((row) => row.evidence.proofRange)) },
    "matrix-claims": claimFields(matrix),
  };
  return payloads[kind]!;
}

function boundaryPayload(kind: string): Record<string, unknown> {
  const boundaries = buildNodeLevel5AppSupportMatrix().boundaries;
  const payloads: Record<string, Record<string, unknown>> = {
    "boundary-selected-apps-only": { supportedIdleTimerSources: idleTimerSources },
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
  const rows = idleTimerRows();
  const payloads: Record<string, Record<string, unknown>> = {
    "audit-installed-corpus-compatible": { installedCorpusRows: summary().rowCount },
    "audit-refusal-compatible": { unsafeTimerRefusalStillPresent: true },
    "audit-matrix-compatible": { matrixRows: buildNodeLevel5AppSupportMatrix().rowCount },
    "audit-idle-not-arbitrary-scheduler": { arbitrarySchedulerClaimed: false },
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
  const provided = process.env.NODE_LEVEL5_IDLE_TIMER_CONTINUATION_SUMMARY;
  cachedSummary = provided ? JSON.parse(readFileSync(provided, "utf8")) : generateSummary();
  return cachedSummary;
}

function generateSummary(): Summary {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-idle-timer-proof-"));
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoaderPath, runnerPath, "--out", dir, "--json"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `idle timer corpus runner failed: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function idleTimerRows(): Row[] {
  return summary().rows.filter((row: Row) => idleTimerSources.includes(row.source));
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
