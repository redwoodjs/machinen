import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNodeLevel5AppSupportMatrix } from "../../../packages/runtime/src/node-level5-app-support-matrix.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
type Row = Record<string, any>;

type Definition = { goal: string; result: string; kind: string };

const definitions: Record<string, Definition> = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => {
    const proof = 881 + index;
    return [String(proof), definitionFor(proof)];
  }),
);

export function runNodeLevel5AppSupportMatrixProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 app support matrix proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-app-support-matrix-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-app-support-matrix",
    productSurface: [
      "machinen node-level5 support-matrix --json",
      "machinen snapshot <vm-name> --out <dir>",
      "machinen restore <snapshot>",
    ],
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, appSupportMatrixGate: definition.kind }));
  console.log(`proof ${proof} node-level5 app support matrix gate passed`);
}

function definitionFor(proof: number): Definition {
  if (proof <= 888) {
    return {
      goal: "App support matrix contract",
      result: "The matrix is app-based, accepted, and available from the CLI.",
      kind: contractKind(proof - 881),
    };
  }
  if (proof <= 896) {
    return {
      goal: "Supported app rows",
      result: "Supported rows are particular fixture, template, or installed idle HTTP apps.",
      kind: supportedKind(proof - 889),
    };
  }
  if (proof <= 904) {
    return {
      goal: "Refused app rows",
      result: "Unsupported live-state app rows refuse before snapshot.",
      kind: refusedKind(proof - 897),
    };
  }
  if (proof <= 912) {
    return {
      goal: "Support matrix boundaries",
      result: "The matrix keeps arbitrary Express/Fastify/Node and raw CPU restore unclaimed.",
      kind: boundaryKind(proof - 905),
    };
  }
  return {
    goal: "Support matrix final audit",
    result: "The app support matrix composes existing corpus evidence without broadening claims.",
    kind: auditKind(proof - 913),
  };
}

function contractKind(index: number): string {
  return [
    "matrix-kind",
    "matrix-accepted",
    "matrix-row-count",
    "matrix-cli",
    "matrix-claims",
    "matrix-statuses",
    "matrix-app-based",
    "matrix-directions",
  ][index]!;
}

function supportedKind(index: number): string {
  return [
    "supported-fixtures",
    "supported-templates",
    "supported-installed",
    "supported-express",
    "supported-fastify",
    "supported-product-behavior",
    "supported-declared-subset",
    "supported-limitations",
  ][index]!;
}

function refusedKind(index: number): string {
  return [
    "refused-active-requests",
    "refused-workers",
    "refused-native-addons",
    "refused-wasm",
    "refused-tls",
    "refused-child-processes",
    "refused-watchers",
    "refused-websockets",
  ][index]!;
}

function boundaryKind(index: number): string {
  return [
    "boundary-arbitrary-express",
    "boundary-arbitrary-fastify",
    "boundary-arbitrary-node",
    "boundary-raw-cpu",
    "boundary-no-broad-bump",
    "boundary-no-arbitrary-process",
    "boundary-translated-continuation",
    "boundary-particular-apps",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "audit-product-run-compatible",
    "audit-template-compatible",
    "audit-installed-compatible",
    "audit-refusal-compatible",
    "audit-docs-linked",
    "audit-cli-surface",
    "audit-claims-remain",
    "audit-final",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("matrix-")) {
    return contractPayload(kind);
  }
  if (kind.startsWith("supported-")) {
    return supportedPayload(kind);
  }
  if (kind.startsWith("refused-")) {
    return refusedPayload(kind);
  }
  if (kind.startsWith("boundary-")) {
    return boundaryPayload(kind);
  }
  return auditPayload(kind);
}

function contractPayload(kind: string): Record<string, unknown> {
  const matrix = buildNodeLevel5AppSupportMatrix();
  if (kind === "matrix-kind") {
    return { matrixKind: matrix.kind };
  }
  if (kind === "matrix-accepted") {
    return { accepted: matrix.accepted };
  }
  if (kind === "matrix-row-count") {
    return { rowCount: matrix.rowCount };
  }
  if (kind === "matrix-cli") {
    const cli = cliMatrix();
    return { cliAccepted: cli.accepted, cliRowCount: cli.rowCount };
  }
  if (kind === "matrix-claims") {
    return claimFields(matrix);
  }
  if (kind === "matrix-statuses") {
    return { statuses: unique(matrix.rows.map((row) => row.status)) };
  }
  if (kind === "matrix-app-based") {
    return { allRowsHaveAppName: matrix.rows.every((row) => Boolean(row.appName)) };
  }
  return { allRowsCoverBothDirections: matrix.rows.every(coversBothDirections) };
}

function supportedPayload(kind: string): Record<string, unknown> {
  const rows = supportedRows();
  if (kind === "supported-fixtures") {
    return idsPayload(rows, ["express-fixture-product-run", "fastify-fixture-product-run"]);
  }
  if (kind === "supported-templates") {
    return idsPayload(rows, ["express-official-hello-world", "fastify-plugin-route"]);
  }
  if (kind === "supported-installed") {
    return idsPayload(rows, ["express-installed-hello-world", "fastify-installed-plugin-route"]);
  }
  if (kind === "supported-express") {
    return { expressSupportedRows: rows.filter((row) => row.framework === "express").length };
  }
  if (kind === "supported-fastify") {
    return { fastifySupportedRows: rows.filter((row) => row.framework === "fastify").length };
  }
  if (kind === "supported-product-behavior") {
    return {
      allUseProductSnapshotRestore: rows.every((row) => row.productBehavior.includes("snapshot")),
    };
  }
  if (kind === "supported-declared-subset") {
    return {
      allDeclaredSubsetIdleHttp: rows.every(
        (row) => row.supportScope === "declared-subset-idle-http",
      ),
    };
  }
  return { allSupportedRowsHaveLimitations: rows.every((row) => row.limitations.length > 0) };
}

function refusedPayload(kind: string): Record<string, unknown> {
  const marker = kind.replace("refused-", "");
  const rows = refusedRows().filter((row) => row.id.includes(marker));
  return {
    marker,
    rowCount: rows.length,
    allRefuseBeforeSnapshot: rows.every((row) => row.productBehavior === "refuse-before-snapshot"),
  };
}

function boundaryPayload(kind: string): Record<string, unknown> {
  const matrix = buildNodeLevel5AppSupportMatrix();
  const boundaries = matrix.boundaries;
  if (kind === "boundary-arbitrary-express") {
    return boundaryById(boundaries, "arbitrary-express-app");
  }
  if (kind === "boundary-arbitrary-fastify") {
    return boundaryById(boundaries, "arbitrary-fastify-app");
  }
  if (kind === "boundary-arbitrary-node") {
    return boundaryById(boundaries, "arbitrary-node-process");
  }
  if (kind === "boundary-raw-cpu") {
    return boundaryById(boundaries, "raw-cross-arch-cpu-restore");
  }
  if (kind === "boundary-no-broad-bump") {
    return { broadNodeProductSupportClaimed: matrix.broadNodeProductSupportClaimed };
  }
  if (kind === "boundary-no-arbitrary-process") {
    return {
      arbitraryProcessCrossArchRestoreClaimed: matrix.arbitraryProcessCrossArchRestoreClaimed,
    };
  }
  if (kind === "boundary-translated-continuation") {
    return { rawCpuRestoreProductPath: false, translatedContinuation: true };
  }
  return { particularAppRows: matrix.rows.every((row) => Boolean(row.id) && Boolean(row.appName)) };
}

function auditPayload(kind: string): Record<string, unknown> {
  const matrix = buildNodeLevel5AppSupportMatrix();
  if (kind === "audit-product-run-compatible") {
    return { proofRange: "721-760", rows: rowsWithEvidence("fixture-product-run-corpus").length };
  }
  if (kind === "audit-template-compatible") {
    return { proofRange: "801-840", rows: rowsWithEvidence("template-corpus").length };
  }
  if (kind === "audit-installed-compatible") {
    return { proofRange: "841-880", rows: rowsWithEvidence("installed-package-corpus").length };
  }
  if (kind === "audit-refusal-compatible") {
    return { proofRange: "761-800", rows: rowsWithEvidence("refusal-corpus").length };
  }
  if (kind === "audit-docs-linked") {
    return {
      docsExist: existsSync(join(repoRoot, "docs/snapshot/node-level5-app-support-matrix.md")),
    };
  }
  if (kind === "audit-cli-surface") {
    return { cliSurface: "machinen node-level5 support-matrix --json" };
  }
  if (kind === "audit-claims-remain") {
    return claimFields(matrix);
  }
  return { finalAppSupportMatrix: true, rowCount: matrix.rowCount, claimsRemain: "80/20/0" };
}

function supportedRows(): Row[] {
  return buildNodeLevel5AppSupportMatrix().rows.filter((row) => row.status === "supported");
}

function refusedRows(): Row[] {
  return buildNodeLevel5AppSupportMatrix().rows.filter((row) => row.status === "refused");
}

function rowsWithEvidence(kind: string): Row[] {
  return buildNodeLevel5AppSupportMatrix().rows.filter((row) => row.evidence.kind === kind);
}

function idsPayload(rows: Row[], ids: string[]): Record<string, unknown> {
  return { ids, allPresent: ids.every((id) => rows.some((row) => row.id === id)) };
}

function boundaryById(boundaries: Row[], id: string): Record<string, unknown> {
  const boundary = boundaries.find((item) => item.id === id);
  return { id, status: boundary?.status, reason: boundary?.reason };
}

function coversBothDirections(row: Row): boolean {
  return row.directions.includes("arm64-to-amd64") && row.directions.includes("amd64-to-arm64");
}

function cliMatrix(): Row {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-matrix-cli-"));
  const outputPath = join(dir, "matrix.json");
  const fd = openSync(outputPath, "w");
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", tsxLoaderPath, cliPath, "node-level5", "support-matrix", "--json"],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", fd, "pipe"] },
    );
    if (result.status !== 0) {
      throw new Error(`support matrix CLI failed: ${result.status} ${result.stderr}`);
    }
    closeSync(fd);
    return JSON.parse(readFileSync(outputPath, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
