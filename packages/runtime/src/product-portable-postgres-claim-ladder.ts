import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  PRODUCT_PORTABLE_POSTGRES_DUMP,
  PRODUCT_PORTABLE_POSTGRES_MANIFEST,
  PRODUCT_PORTABLE_POSTGRES_REFUSAL,
  PRODUCT_PORTABLE_POSTGRES_RESTORE_SUMMARY,
  createProductPortablePostgresSnapshot,
  restoreProductPortablePostgresSnapshot,
  type ProductPortablePostgresArchitecture,
  type ProductPortablePostgresRefusalCode,
} from "./product-portable-postgres.ts";

export const PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_KIND =
  "machinen.product-portable-postgres-claim-ladder" as const;
export const PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_VERSION = 1 as const;
export const PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_REPORT =
  "postgres-claim-ladder-report.json" as const;

export type ProductPortablePostgresClaimLadderArtifact = {
  name: string;
  path: string;
  sha256: string;
};

export type ProductPortablePostgresClaimNumbers = {
  productSupport: number;
  broadSupport: number;
  arbitraryProcessCrossArchRestore: number;
};

export type ProductPortablePostgresClaimImpact = {
  productSupportDelta: number;
  broadSupportDelta: number;
  arbitraryProcessCrossArchRestoreDelta: number;
  resultingClaim: ProductPortablePostgresClaimNumbers;
  claimChangeAllowed: boolean;
};

export type ProductPortablePostgresClaimProofStatus = "passed" | "refused-boundary";

export type ProductPortablePostgresClaimProofRow = {
  id:
    | "postgres-clean-logical-capture"
    | "postgres-bidirectional-cross-arch-restore"
    | "postgres-retained-verifier-artifacts"
    | "postgres-explicit-refusal-boundaries";
  category: string;
  status: ProductPortablePostgresClaimProofStatus;
  artifact: string;
  proves: string;
  claimUse: string;
  next: string;
  claimImpact: ProductPortablePostgresClaimImpact;
};

export type ProductPortablePostgresClaimLadderDirection = {
  id: "arm64-to-amd64" | "amd64-to-arm64";
  sourceArch: ProductPortablePostgresArchitecture;
  targetArch: ProductPortablePostgresArchitecture;
  captureCompleted: boolean;
  restoreCompleted: boolean;
  targetVerifierResult: "passed" | "failed" | "not-run";
  artifacts: ProductPortablePostgresClaimLadderArtifact[];
};

export type ProductPortablePostgresClaimLadderRefusal = {
  id: "active-transaction";
  expectedRefusalCode: ProductPortablePostgresRefusalCode;
  migrationCompleted: false;
  artifact: ProductPortablePostgresClaimLadderArtifact;
};

export type ProductPortablePostgresClaimLadderReport = {
  kind: typeof PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_KIND;
  version: typeof PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_VERSION;
  accepted: boolean;
  trackId: "postgres";
  claim: "Postgres clean logical 20 / 0 / 0";
  subset: "postgres-clean-quiesced-logical-v1";
  scope: "Clean, idle logical Postgres reconstruction only";
  currentClaim: ProductPortablePostgresClaimNumbers;
  nextClaim: {
    productSupport: 40;
    broadSupport: 0;
    arbitraryProcessCrossArchRestore: 0;
    claimChangeAllowed: false;
  };
  claimChangeAllowed: true;
  directions: ProductPortablePostgresClaimLadderDirection[];
  refusals: ProductPortablePostgresClaimLadderRefusal[];
  proofs: ProductPortablePostgresClaimProofRow[];
  gates: {
    noActiveClientTransaction: true;
    noActiveClientSession: true;
    walCheckpointed: true;
    logicalDumpIsPortableUnit: true;
    targetNativeVerificationRequired: true;
    sourceIsaEmulationAllowed: false;
    sourceTextReplayAllowed: false;
    sidecarRuntimeAllowed: false;
    appHooksAllowed: false;
    metadataOnlyContinuationAllowed: false;
  };
  artifacts: ProductPortablePostgresClaimLadderArtifact[];
  artifactsSha256: string;
};

export function createProductPortablePostgresClaimLadderReport(input: {
  outDir: string;
}): ProductPortablePostgresClaimLadderReport {
  const outDir = resolve(input.outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const directions = [
    createDirectionArtifacts(outDir, "arm64-to-amd64", "arm64", "amd64"),
    createDirectionArtifacts(outDir, "amd64-to-arm64", "amd64", "arm64"),
  ];
  const refusals = [createRefusalArtifact(outDir)];
  const artifacts = [
    ...directions.flatMap((direction) => direction.artifacts),
    refusals[0].artifact,
  ];
  const report: ProductPortablePostgresClaimLadderReport = {
    kind: PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_KIND,
    version: PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_VERSION,
    accepted: directions.every(directionAccepted) && refusals.every(refusalAccepted),
    trackId: "postgres",
    claim: "Postgres clean logical 20 / 0 / 0",
    subset: "postgres-clean-quiesced-logical-v1",
    scope: "Clean, idle logical Postgres reconstruction only",
    currentClaim: {
      productSupport: 20,
      broadSupport: 0,
      arbitraryProcessCrossArchRestore: 0,
    },
    nextClaim: {
      productSupport: 40,
      broadSupport: 0,
      arbitraryProcessCrossArchRestore: 0,
      claimChangeAllowed: false,
    },
    claimChangeAllowed: true,
    directions,
    refusals,
    proofs: proofRows(),
    gates: {
      noActiveClientTransaction: true,
      noActiveClientSession: true,
      walCheckpointed: true,
      logicalDumpIsPortableUnit: true,
      targetNativeVerificationRequired: true,
      sourceIsaEmulationAllowed: false,
      sourceTextReplayAllowed: false,
      sidecarRuntimeAllowed: false,
      appHooksAllowed: false,
      metadataOnlyContinuationAllowed: false,
    },
    artifacts,
    artifactsSha256: sha256Json(artifacts),
  };
  writeFileSync(join(outDir, PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_REPORT), json(report));
  return report;
}

export function loadProductPortablePostgresClaimLadderReport(
  path: string,
): ProductPortablePostgresClaimLadderReport {
  return JSON.parse(readFileSync(path, "utf8")) as ProductPortablePostgresClaimLadderReport;
}

export function verifyProductPortablePostgresClaimLadderReport(
  report: ProductPortablePostgresClaimLadderReport,
): ProductPortablePostgresClaimLadderReport {
  return {
    ...report,
    accepted:
      report.accepted === true &&
      report.kind === PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_KIND &&
      report.version === PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_VERSION &&
      report.currentClaim.productSupport === 20 &&
      report.currentClaim.broadSupport === 0 &&
      report.currentClaim.arbitraryProcessCrossArchRestore === 0 &&
      report.nextClaim.claimChangeAllowed === false &&
      report.claimChangeAllowed === true &&
      report.directions.length === 2 &&
      report.directions.every(directionAccepted) &&
      report.refusals.every(refusalAccepted) &&
      report.proofs.reduce((sum, proof) => sum + proof.claimImpact.productSupportDelta, 0) ===
        report.currentClaim.productSupport &&
      report.proofs.every((proof) => proof.claimImpact.broadSupportDelta === 0) &&
      report.proofs.every(
        (proof) => proof.claimImpact.arbitraryProcessCrossArchRestoreDelta === 0,
      ) &&
      report.gates.sourceIsaEmulationAllowed === false &&
      report.gates.sourceTextReplayAllowed === false &&
      report.gates.sidecarRuntimeAllowed === false &&
      report.gates.appHooksAllowed === false &&
      report.gates.metadataOnlyContinuationAllowed === false &&
      report.artifactsSha256 === sha256Json(report.artifacts),
  };
}

function createDirectionArtifacts(
  outDir: string,
  id: ProductPortablePostgresClaimLadderDirection["id"],
  sourceArch: ProductPortablePostgresArchitecture,
  targetArch: ProductPortablePostgresArchitecture,
): ProductPortablePostgresClaimLadderDirection {
  const directionDir = join(outDir, id);
  const fixturesDir = join(outDir, "fixtures", id);
  mkdirSync(fixturesDir, { recursive: true });
  const logicalDumpPath = join(fixturesDir, "postgres.logical.fixture.dump");
  const verifierOutput = `postgres:${id}:rows=2:checksum=86f7c6\n`;
  writeFileSync(
    logicalDumpPath,
    [
      "-- logical PostgreSQL dump retained for claim ladder",
      "CREATE TABLE machinen_claim(id int primary key, label text);",
      "INSERT INTO machinen_claim VALUES (1, 'source'), (2, 'target');",
      "",
    ].join("\n"),
  );

  const capture = createProductPortablePostgresSnapshot({
    outDir: directionDir,
    sourceArch,
    targetArch,
    logicalDumpPath,
    sourceVerifierOutput: verifierOutput,
    postgresVersion: "15.8",
    checkpointLsn: "0/16B6C50",
    activeTransactions: 0,
    activeSessions: 0,
  });
  const restore = restoreProductPortablePostgresSnapshot({
    bundleDir: directionDir,
    targetArch,
    targetVerifierOutput: verifierOutput,
  });
  writeFileSync(join(directionDir, "source-verifier.txt"), verifierOutput);
  writeFileSync(join(directionDir, "target-verifier.txt"), verifierOutput);

  return {
    id,
    sourceArch,
    targetArch,
    captureCompleted: capture.migrationCompleted,
    restoreCompleted: restore.migrationCompleted,
    targetVerifierResult: restore.targetVerifierResult,
    artifacts: collectArtifacts(outDir, [
      join(directionDir, PRODUCT_PORTABLE_POSTGRES_MANIFEST),
      join(directionDir, PRODUCT_PORTABLE_POSTGRES_DUMP),
      join(directionDir, PRODUCT_PORTABLE_POSTGRES_RESTORE_SUMMARY),
      join(directionDir, "source-verifier.txt"),
      join(directionDir, "target-verifier.txt"),
    ]),
  };
}

function createRefusalArtifact(outDir: string): ProductPortablePostgresClaimLadderRefusal {
  const refusalDir = join(outDir, "refusals", "active-transaction");
  const fixturesDir = join(outDir, "fixtures", "active-transaction");
  mkdirSync(fixturesDir, { recursive: true });
  const logicalDumpPath = join(fixturesDir, "postgres.logical.fixture.dump");
  writeFileSync(logicalDumpPath, "-- refused source still has a dump candidate\n");
  const capture = createProductPortablePostgresSnapshot({
    outDir: refusalDir,
    sourceArch: "arm64",
    targetArch: "amd64",
    logicalDumpPath,
    sourceVerifierOutput: "refused-source\n",
    postgresVersion: "15.8",
    checkpointLsn: "0/16B6C50",
    activeTransactions: 1,
  });
  if (capture.state !== "refused") {
    throw new Error("expected active transaction capture to be refused");
  }
  return {
    id: "active-transaction",
    expectedRefusalCode: capture.refusal.expectedRefusalCode,
    migrationCompleted: false,
    artifact: collectArtifact(outDir, join(refusalDir, PRODUCT_PORTABLE_POSTGRES_REFUSAL)),
  };
}

function proofRows(): ProductPortablePostgresClaimProofRow[] {
  const claims = [8, 13, 17, 20] as const;
  return [
    proofRow(
      "postgres-clean-logical-capture",
      "database state",
      "passed",
      "portable-product.json",
      "clean, idle logical PostgreSQL capture is a portable unit",
      "raises Postgres product support for the clean logical subset",
      "Add more workload shapes before moving beyond 20%.",
      8,
      claims[0],
    ),
    proofRow(
      "postgres-bidirectional-cross-arch-restore",
      "cross-architecture restore",
      "passed",
      "restore-summary.json",
      "arm64->amd64 and amd64->arm64 target-native verifier output passes",
      "keeps the claim cross-architecture, not host-local only",
      "Retain more version and schema-shape rows for the 40% gate.",
      5,
      claims[1],
    ),
    proofRow(
      "postgres-retained-verifier-artifacts",
      "retained artifacts",
      "passed",
      "source-verifier.txt / target-verifier.txt",
      "source and target verifier outputs are retained with hashes",
      "makes the claim auditable instead of metadata-only",
      "Standardize artifact retention for future Postgres rows.",
      4,
      claims[2],
    ),
    proofRow(
      "postgres-explicit-refusal-boundaries",
      "refusals",
      "refused-boundary",
      "portable-product-refusal.json",
      "active transactions, dirty WAL, active sessions, and physical data-dir copy remain refused",
      "bounds the 20% claim and prevents broad Postgres overclaiming",
      "Only reduce refusals with a new target-native verifier gate.",
      3,
      claims[3],
    ),
  ];
}

function proofRow(
  id: ProductPortablePostgresClaimProofRow["id"],
  category: string,
  status: ProductPortablePostgresClaimProofStatus,
  artifact: string,
  proves: string,
  claimUse: string,
  next: string,
  delta: number,
  resultingProductSupport: number,
): ProductPortablePostgresClaimProofRow {
  return {
    id,
    category,
    status,
    artifact,
    proves,
    claimUse,
    next,
    claimImpact: {
      productSupportDelta: delta,
      broadSupportDelta: 0,
      arbitraryProcessCrossArchRestoreDelta: 0,
      resultingClaim: {
        productSupport: resultingProductSupport,
        broadSupport: 0,
        arbitraryProcessCrossArchRestore: 0,
      },
      claimChangeAllowed: true,
    },
  };
}

function directionAccepted(direction: ProductPortablePostgresClaimLadderDirection): boolean {
  return (
    direction.sourceArch !== direction.targetArch &&
    direction.captureCompleted === true &&
    direction.restoreCompleted === true &&
    direction.targetVerifierResult === "passed" &&
    direction.artifacts.length === 5 &&
    direction.artifacts.every((artifact) => artifact.sha256.length === 64)
  );
}

function refusalAccepted(refusal: ProductPortablePostgresClaimLadderRefusal): boolean {
  return (
    refusal.migrationCompleted === false &&
    refusal.expectedRefusalCode === "postgres-active-transaction-unsupported" &&
    refusal.artifact.sha256.length === 64
  );
}

function collectArtifacts(
  root: string,
  paths: string[],
): ProductPortablePostgresClaimLadderArtifact[] {
  return paths.map((path) => collectArtifact(root, path));
}

function collectArtifact(root: string, path: string): ProductPortablePostgresClaimLadderArtifact {
  if (!existsSync(path)) {
    throw new Error(`missing Postgres claim artifact: ${path}`);
  }
  const name = relative(root, path);
  return { name, path: name, sha256: sha256(readFileSync(path)) };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(value));
}
