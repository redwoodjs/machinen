import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNodeClaimRowCoverageReport } from "./node-claim-row-coverage.ts";

type ArtifactEntry = {
  role: string;
  path: string;
  required: boolean;
  exists: boolean;
  bytes: number;
  sha256: string;
};

type NodeArtifactIntegrityManifest = {
  kind: "machinen.node-artifact-integrity-manifest";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  artifactCount: number;
  missingArtifactCount: number;
  supportedDirectionArtifacts: number;
  refusalArtifacts: number;
  totalBytes: number;
  artifactsSha256: string;
  artifacts: ArtifactEntry[];
  policy: {
    retainedArtifactsRequired: true;
    checkedSummariesAloneAccepted: false;
    metadataOnlySuccessAccepted: false;
    sourceIsaEmulationAccepted: false;
    sidecarRuntimeAccepted: false;
  };
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildNodeArtifactIntegrityManifest(options.root);
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `node artifact integrity manifest: ${report.artifactCount} artifacts accepted=${report.accepted}\n`,
    );
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

export function buildNodeArtifactIntegrityManifest(root: string): NodeArtifactIntegrityManifest {
  const resolvedRoot = resolve(root);
  const coverage = buildNodeClaimRowCoverageReport(resolvedRoot);
  const supportedArtifacts = coverage.supportedCoverage.flatMap((row) =>
    Object.entries(row.requiredFiles).map(([role, path]) => artifact(role, path, true)),
  );
  const refusalArtifacts = unique(
    coverage.refusedCoverage
      .filter((row) => row.status === "covered")
      .map((row) => row.artifact)
      .filter((path) => path !== "missing"),
  ).map((path) => artifact("refusalArtifact", path, true));
  const retainedReports = [
    "proofs/nodejs/claim-evidence-index/retained/node-claim-row-coverage-report.json",
    "proofs/nodejs/claim-evidence-index/retained/node-claim-boundary-guard-report.json",
    "proofs/nodejs/claim-evidence-index/retained/node-row-verifier-integrity-report.json",
    "proofs/nodejs/real-cross-arch-e2e-gate/retained/node-real-cross-arch-e2e-gate-report.json",
  ].map((path) => artifact("retainedReport", path, true));
  const artifacts = [...supportedArtifacts, ...refusalArtifacts, ...retainedReports].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  const missingArtifactCount = artifacts.filter((entry) => !entry.exists).length;
  const totalBytes = artifacts.reduce((sum, entry) => sum + entry.bytes, 0);
  return {
    kind: "machinen.node-artifact-integrity-manifest",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted:
      coverage.claimAllowed === true &&
      coverage.directionRequirementCounts.supportedMissing === 0 &&
      coverage.directionRequirementCounts.refusedMissing === 0 &&
      coverage.rowCounts.notProvenRows === 0 &&
      missingArtifactCount === 0,
    artifactCount: artifacts.length,
    missingArtifactCount,
    supportedDirectionArtifacts: supportedArtifacts.length,
    refusalArtifacts: refusalArtifacts.length,
    totalBytes,
    artifactsSha256: sha256(
      JSON.stringify(artifacts.map(({ path, sha256 }) => ({ path, sha256 }))),
    ),
    artifacts,
    policy: {
      retainedArtifactsRequired: true,
      checkedSummariesAloneAccepted: false,
      metadataOnlySuccessAccepted: false,
      sourceIsaEmulationAccepted: false,
      sidecarRuntimeAccepted: false,
    },
  };
}

function artifact(role: string, path: string, required: boolean): ArtifactEntry {
  const resolved = resolve(path);
  const exists = existsSync(resolved) && statSync(resolved).isFile();
  const bytes = exists ? statSync(resolved).size : 0;
  return {
    role,
    path: displayPath(resolved),
    required,
    exists,
    bytes,
    sha256: exists ? sha256(readFileSync(resolved)) : "missing",
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
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
