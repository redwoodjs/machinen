import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNodeClaimRowCoverageReport } from "./node-claim-row-coverage.ts";

const directions = ["arm64-to-amd64", "amd64-to-arm64"] as const;
type Direction = (typeof directions)[number];

type VerifierIntegrityRow = {
  rowId: string;
  direction: Direction;
  verifierPath: string;
  bodyPath: string;
  accepted: boolean;
  checks: Record<string, boolean>;
  bodySha256: string;
  verifierSha256: string;
};

type NodeRowVerifierIntegrityReport = {
  kind: "machinen.node-row-verifier-integrity-report";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  rowCount: number;
  directionVerifierCount: number;
  expectedDirectionVerifierCount: number;
  rows: VerifierIntegrityRow[];
  summary: {
    acceptedVerifiers: number;
    rejectedVerifiers: number;
    sourceIsaEmulationUsed: false;
    sidecarRuntimeUsed: false;
    appHooksRequired: false;
    metadataOnlySuccessAccepted: false;
  };
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildNodeRowVerifierIntegrityReport(options.root);
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `node row verifier integrity: ${report.summary.acceptedVerifiers}/${report.expectedDirectionVerifierCount} accepted\n`,
    );
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

export function buildNodeRowVerifierIntegrityReport(root: string): NodeRowVerifierIntegrityReport {
  const resolvedRoot = resolve(root);
  const coverage = buildNodeClaimRowCoverageReport(resolvedRoot);
  const supported = coverage.supportedCoverage;
  const rows = supported.map((entry) =>
    verifierIntegrityRow(resolvedRoot, entry.rowId, entry.direction),
  );
  const accepted =
    coverage.claimAllowed === true &&
    rows.length === supported.length &&
    rows.every((row) => row.accepted);
  return {
    kind: "machinen.node-row-verifier-integrity-report",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted,
    rowCount: new Set(rows.map((row) => row.rowId)).size,
    directionVerifierCount: rows.length,
    expectedDirectionVerifierCount: supported.length,
    rows,
    summary: {
      acceptedVerifiers: rows.filter((row) => row.accepted).length,
      rejectedVerifiers: rows.filter((row) => !row.accepted).length,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
      metadataOnlySuccessAccepted: false,
    },
  };
}

function verifierIntegrityRow(
  root: string,
  rowId: string,
  direction: string,
): VerifierIntegrityRow {
  if (!isDirection(direction)) {
    throw new Error(`unsupported direction ${direction}`);
  }
  const base = join(root, "claim-evidence-index/retained/row-evidence/supported", rowId, direction);
  const verifierPath = join(base, "target/verifier.json");
  const bodyPath = join(base, "target/target-http-body.txt");
  const verifier = existsSync(verifierPath) ? JSON.parse(readFileSync(verifierPath, "utf8")) : {};
  const body = existsSync(bodyPath) ? readFileSync(bodyPath) : Buffer.alloc(0);
  const actualBody = body.toString("utf8");
  const bodySha256 = sha256(body);
  const checks = {
    verifierExists: existsSync(verifierPath) && statSync(verifierPath).isFile(),
    bodyExists: existsSync(bodyPath) && statSync(bodyPath).isFile(),
    acceptedTrue: verifier.accepted === true,
    rowIdMatchesPath: verifier.rowId === rowId,
    directionMatchesPath: verifier.direction === direction,
    expectedBodyMatchesActual: verifier.expectedBody === verifier.actualBody,
    retainedBodyMatchesVerifier: verifier.actualBody === actualBody,
    bodyHashMatchesVerifier: verifier.bodySha256 === bodySha256,
    targetNativeNodeVerified: verifier.targetNativeNodeVerified === true,
    sourceIsaEmulationForbidden: verifier.sourceIsaEmulationUsed === false,
    sidecarForbidden: verifier.sidecarRuntimeUsed === false,
    appHooksForbidden: verifier.appHooksRequired === false,
    metadataOnlyForbidden: verifier.metadataOnlySuccessAccepted === false,
  };
  return {
    rowId,
    direction,
    verifierPath: displayPath(verifierPath),
    bodyPath: displayPath(bodyPath),
    accepted: Object.values(checks).every(Boolean),
    checks,
    bodySha256,
    verifierSha256: existsSync(verifierPath) ? sha256(readFileSync(verifierPath)) : "missing",
  };
}

function isDirection(value: string): value is Direction {
  return directions.includes(value as Direction);
}

function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function displayPath(path: string): string {
  return path.replace(`${process.cwd()}/`, "");
}

function parseArgs(args: string[]): { root: string; out?: string; json: boolean } {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, "../../..");
  const parsed: { root: string; out?: string; json: boolean } = {
    root: join(repoRoot, "proofs/nodejs"),
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--root") {
      parsed.root = takeValue(args, ++index, arg);
      continue;
    }
    if (arg === "--out") {
      parsed.out = takeValue(args, ++index, arg);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
