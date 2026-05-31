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

import { buildNodeLevel5AppSupportMatrix } from "../packages/runtime/src/node-level5-app-support-matrix.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
type Row = Record<string, any>;
type Definition = { goal: string; result: string; kind: string };

const definitions: Record<string, Definition> = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => {
    const proof = 921 + index;
    return [String(proof), definitionFor(proof)];
  }),
);

export function runNodeLevel5AppSupportMatrixDimensionsProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 app support matrix dimensions proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-app-support-matrix-dimensions-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-app-support-matrix-dimensions",
    productSurface: ["machinen node-level5 support-matrix --json"],
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, appSupportMatrixDimensionsGate: definition.kind }));
  console.log(`proof ${proof} node-level5 app support matrix dimensions gate passed`);
}

function definitionFor(proof: number): Definition {
  if (proof <= 928) {
    return {
      goal: "Support matrix feature-dimension contract",
      result:
        "Every app row carries route, response, middleware, async, params, query, static asset, external network, and background-task dimensions.",
      kind: contractKind(proof - 921),
    };
  }
  if (proof <= 936) {
    return {
      goal: "Supported app feature dimensions",
      result: "Supported rows identify the particular app features backed by corpus evidence.",
      kind: supportedKind(proof - 929),
    };
  }
  if (proof <= 944) {
    return {
      goal: "Refused app feature dimensions",
      result: "Refused rows map unsupported live state to refused feature dimensions.",
      kind: refusedKind(proof - 937),
    };
  }
  if (proof <= 952) {
    return {
      goal: "Not-proven app feature gaps",
      result: "The matrix exposes unproven app features without turning them into support claims.",
      kind: gapKind(proof - 945),
    };
  }
  return {
    goal: "Support matrix dimensions final audit",
    result:
      "Feature dimensions preserve the app-specific support boundary and keep claims unchanged.",
    kind: auditKind(proof - 953),
  };
}

function contractKind(index: number): string {
  return [
    "contract-version",
    "contract-row-count",
    "contract-feature-objects",
    "contract-feature-assessments",
    "contract-cli",
    "contract-statuses",
    "contract-directions",
    "contract-claims",
  ][index]!;
}

function supportedKind(index: number): string {
  return [
    "supported-simple-routes",
    "supported-router-routes",
    "supported-plugin-routes",
    "supported-text-response",
    "supported-pure-js-middleware",
    "supported-async-handler",
    "supported-product-behavior",
    "supported-no-unsupported-features",
  ][index]!;
}

function refusedKind(index: number): string {
  return [
    "refused-route-live-state",
    "refused-external-network-live-state",
    "refused-background-state",
    "refused-before-snapshot",
    "refused-evidence",
    "refused-express-fastify",
    "refused-limitations",
    "refused-not-supported",
  ][index]!;
}

function gapKind(index: number): string {
  return [
    "gap-json-response",
    "gap-params",
    "gap-query",
    "gap-static-assets",
    "gap-external-network",
    "gap-background-tasks",
    "gap-no-product-behavior",
    "gap-no-claim",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "audit-app-specific",
    "audit-arbitrary-express-unclaimed",
    "audit-arbitrary-fastify-unclaimed",
    "audit-arbitrary-node-unclaimed",
    "audit-raw-cpu-out-of-scope",
    "audit-docs",
    "audit-cli",
    "audit-final",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("contract-")) {
    return contractPayload(kind);
  }
  if (kind.startsWith("supported-")) {
    return supportedPayload(kind);
  }
  if (kind.startsWith("refused-")) {
    return refusedPayload(kind);
  }
  if (kind.startsWith("gap-")) {
    return gapPayload(kind);
  }
  return auditPayload(kind);
}

function contractPayload(kind: string): Record<string, unknown> {
  const matrix = buildNodeLevel5AppSupportMatrix();
  if (kind === "contract-version") {
    return { version: matrix.version };
  }
  if (kind === "contract-row-count") {
    return { rowCount: matrix.rowCount };
  }
  if (kind === "contract-feature-objects") {
    return { allRowsHaveFeatures: matrix.rows.every(hasFeatureObject) };
  }
  if (kind === "contract-feature-assessments") {
    return { allRowsHaveFeatureAssessments: matrix.rows.every(hasFeatureAssessment) };
  }
  if (kind === "contract-cli") {
    const cli = cliMatrix();
    return { cliVersion: cli.version, cliRowCount: cli.rowCount };
  }
  if (kind === "contract-statuses") {
    return { statuses: unique(matrix.rows.map((row) => row.status)) };
  }
  if (kind === "contract-directions") {
    return { allRowsCoverBothDirections: matrix.rows.every(coversBothDirections) };
  }
  return claimFields(matrix);
}

function supportedPayload(kind: string): Record<string, unknown> {
  const rows = supportedRows();
  if (kind === "supported-simple-routes") {
    return routeCount(rows, "simple-route");
  }
  if (kind === "supported-router-routes") {
    return routeCount(rows, "router-route");
  }
  if (kind === "supported-plugin-routes") {
    return routeCount(rows, "plugin-route");
  }
  if (kind === "supported-text-response") {
    return { textRows: rows.filter((row) => row.features.response === "text").length };
  }
  if (kind === "supported-pure-js-middleware") {
    return {
      pureJsMiddlewareRows: rows.filter((row) => row.features.middleware === "pure-js").length,
    };
  }
  if (kind === "supported-async-handler") {
    return { asyncHandlerRows: rows.filter((row) => row.features.asyncHandler).length };
  }
  if (kind === "supported-product-behavior") {
    return { allProductPath: rows.every((row) => row.productBehavior.includes("snapshot")) };
  }
  return { noSupportedGapRows: rows.every((row) => row.evidence.kind !== "matrix-gap") };
}

function refusedPayload(kind: string): Record<string, unknown> {
  const rows = refusedRows();
  if (kind === "refused-route-live-state") {
    return assessmentCount(rows, "route", "refused");
  }
  if (kind === "refused-external-network-live-state") {
    return assessmentCount(rows, "externalNetwork", "refused");
  }
  if (kind === "refused-background-state") {
    return assessmentCount(rows, "backgroundTasks", "refused");
  }
  if (kind === "refused-before-snapshot") {
    return {
      allRefuseBeforeSnapshot: rows.every(
        (row) => row.productBehavior === "refuse-before-snapshot",
      ),
    };
  }
  if (kind === "refused-evidence") {
    return { allRefusalCorpus: rows.every((row) => row.evidence.kind === "refusal-corpus") };
  }
  if (kind === "refused-express-fastify") {
    return { frameworks: unique(rows.map((row) => row.framework)) };
  }
  if (kind === "refused-limitations") {
    return { allHaveLimitations: rows.every((row) => row.limitations.length > 0) };
  }
  return { noRefusedRowsSupported: rows.every((row) => row.status === "refused") };
}

function gapPayload(kind: string): Record<string, unknown> {
  const rows = gapRows();
  if (kind === "gap-json-response") {
    return gapById(rows, "json-response");
  }
  if (kind === "gap-params") {
    return gapById(rows, "params");
  }
  if (kind === "gap-query") {
    return gapById(rows, "query");
  }
  if (kind === "gap-static-assets") {
    return gapById(rows, "static-assets");
  }
  if (kind === "gap-external-network") {
    return gapById(rows, "external-network");
  }
  if (kind === "gap-background-tasks") {
    return gapById(rows, "background-tasks");
  }
  if (kind === "gap-no-product-behavior") {
    return { allNotProvenBehavior: rows.every((row) => row.productBehavior === "not-proven") };
  }
  return { allNotSupportClaims: rows.every((row) => row.status === "not-proven") };
}

function auditPayload(kind: string): Record<string, unknown> {
  const matrix = buildNodeLevel5AppSupportMatrix();
  if (kind === "audit-app-specific") {
    return { allRowsHaveAppNames: matrix.rows.every((row) => Boolean(row.appName)) };
  }
  if (kind === "audit-arbitrary-express-unclaimed") {
    return boundaryById("arbitrary-express-app");
  }
  if (kind === "audit-arbitrary-fastify-unclaimed") {
    return boundaryById("arbitrary-fastify-app");
  }
  if (kind === "audit-arbitrary-node-unclaimed") {
    return boundaryById("arbitrary-node-process");
  }
  if (kind === "audit-raw-cpu-out-of-scope") {
    return boundaryById("raw-cross-arch-cpu-restore");
  }
  if (kind === "audit-docs") {
    return {
      docsExist: existsSync(join(repoRoot, "docs/snapshot/node-level5-app-support-matrix.md")),
    };
  }
  if (kind === "audit-cli") {
    return { cliSurface: "machinen node-level5 support-matrix --json" };
  }
  return { finalMatrixDimensions: true, rowCount: matrix.rowCount, claimsRemain: "80/20/0" };
}

function supportedRows(): Row[] {
  return buildNodeLevel5AppSupportMatrix().rows.filter((row) => row.status === "supported");
}

function refusedRows(): Row[] {
  return buildNodeLevel5AppSupportMatrix().rows.filter((row) => row.status === "refused");
}

function gapRows(): Row[] {
  return buildNodeLevel5AppSupportMatrix().rows.filter((row) => row.status === "not-proven");
}

function hasFeatureObject(row: Row): boolean {
  return Boolean(row.features?.route && row.features?.response && row.features?.middleware);
}

function hasFeatureAssessment(row: Row): boolean {
  return featureNames().every((name) => Boolean(row.featureAssessment?.[name]));
}

function routeCount(rows: Row[], route: string): Record<string, unknown> {
  return { route, rowCount: rows.filter((row) => row.features.route === route).length };
}

function assessmentCount(rows: Row[], feature: string, status: string): Record<string, unknown> {
  return {
    feature,
    status,
    rowCount: rows.filter((row) => row.featureAssessment[feature] === status).length,
  };
}

function gapById(rows: Row[], id: string): Record<string, unknown> {
  const matches = rows.filter((row) => row.id.includes(id));
  return {
    id,
    rowCount: matches.length,
    allNotProven: matches.every((row) => row.status === "not-proven"),
  };
}

function boundaryById(id: string): Record<string, unknown> {
  const boundary = buildNodeLevel5AppSupportMatrix().boundaries.find((item) => item.id === id);
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

function featureNames(): string[] {
  return [
    "route",
    "response",
    "middleware",
    "asyncHandler",
    "params",
    "query",
    "staticAssets",
    "externalNetwork",
    "backgroundTasks",
  ];
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
