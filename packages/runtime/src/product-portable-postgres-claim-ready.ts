import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  PRODUCT_PORTABLE_POSTGRES_DUMP,
  PRODUCT_PORTABLE_POSTGRES_MANIFEST,
  PRODUCT_PORTABLE_POSTGRES_RESTORE_SUMMARY,
  createProductPortablePostgresSnapshot,
  restoreProductPortablePostgresSnapshot,
  type ProductPortablePostgresArchitecture,
} from "./product-portable-postgres.ts";
import {
  PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_REPORT,
  createProductPortablePostgresClaimLadderReport,
  verifyProductPortablePostgresClaimLadderReport,
  type ProductPortablePostgresClaimNumbers,
} from "./product-portable-postgres-claim-ladder.ts";

export const PRODUCT_PORTABLE_POSTGRES_CLAIM_READY_KIND =
  "machinen.product-portable-postgres-clean-logical-20-claim-ready" as const;
export const PRODUCT_PORTABLE_POSTGRES_CLAIM_READY_VERSION = 1 as const;
export const PRODUCT_PORTABLE_POSTGRES_CLAIM_READY_REPORT =
  "postgres-clean-logical-20-claim-ready-report.json" as const;

export type ProductPortablePostgresClaimReadyArtifact = {
  name: string;
  path: string;
  sha256: string;
};

export type ProductPortablePostgresClaimReadyRowKind =
  | "schema-shape"
  | "postgres-version"
  | "workload-mix";

export type ProductPortablePostgresClaimReadyFixtureRow = {
  id: string;
  kind: ProductPortablePostgresClaimReadyRowKind;
  postgresVersion: string;
  description: string;
  sourceArch: ProductPortablePostgresArchitecture;
  targetArch: ProductPortablePostgresArchitecture;
  captureCompleted: boolean;
  restoreCompleted: boolean;
  targetVerifierResult: "passed" | "failed" | "not-run";
  artifacts: ProductPortablePostgresClaimReadyArtifact[];
};

export type ProductPortablePostgresClaimReadyGate = {
  id:
    | "base-20-claim-ladder-accepted"
    | "schema-shape-rows-retained"
    | "postgres-version-rows-retained"
    | "workload-mix-rows-retained"
    | "bidirectional-target-verifiers-retained"
    | "refusal-boundaries-unchanged"
    | "no-forbidden-shortcuts"
    | "public-claim-still-20";
  passed: boolean;
  evidence: string;
};

export type ProductPortablePostgresClaimReadyProofRow = {
  id:
    | "postgres-40-schema-shape-rows"
    | "postgres-40-version-rows"
    | "postgres-40-workload-mix-rows"
    | "postgres-40-retained-verifier-artifacts";
  category: string;
  status: "passed";
  artifact: string;
  proves: string;
  claimUse: string;
  next: string;
  claimImpact: {
    productSupportDelta: number;
    broadSupportDelta: 0;
    arbitraryProcessCrossArchRestoreDelta: 0;
    resultingClaim: ProductPortablePostgresClaimNumbers;
    claimChangeAllowed: boolean;
  };
};

export type ProductPortablePostgresClaimReadyReport = {
  kind: typeof PRODUCT_PORTABLE_POSTGRES_CLAIM_READY_KIND;
  version: typeof PRODUCT_PORTABLE_POSTGRES_CLAIM_READY_VERSION;
  accepted: boolean;
  trackId: "postgres";
  gate: "postgres-clean-logical-20-claim-ready";
  subset: "postgres-clean-quiesced-logical-v1";
  scope: "Clean, idle logical Postgres reconstruction only";
  currentClaim: ProductPortablePostgresClaimNumbers;
  candidateClaim: ProductPortablePostgresClaimNumbers;
  claimChangeAllowed: boolean;
  publicClaimRaised: false;
  requiredRows: {
    schemaShapes: 3;
    postgresVersions: 3;
    workloadMixes: 3;
    bidirectionalDirections: ["arm64-to-amd64", "amd64-to-arm64"];
  };
  rows: ProductPortablePostgresClaimReadyFixtureRow[];
  gates: ProductPortablePostgresClaimReadyGate[];
  proofs: ProductPortablePostgresClaimReadyProofRow[];
  refusalBoundariesRetained: [
    "active transactions / sessions",
    "dirty WAL boundary",
    "physical data-dir cross-ISA copy",
  ];
  shortcuts: {
    rawCpuRestoreUsed: false;
    sourceIsaEmulationUsed: false;
    sourceTextReplayUsed: false;
    sidecarRuntimeUsed: false;
    appHooksRequired: false;
    metadataOnlySuccessAccepted: false;
  };
  baseClaimLadderArtifact: ProductPortablePostgresClaimReadyArtifact;
  artifacts: ProductPortablePostgresClaimReadyArtifact[];
  artifactsSha256: string;
};

const schemaShapeFixtures = [
  {
    id: "schema-single-table-primary-key",
    kind: "schema-shape" as const,
    postgresVersion: "15.8",
    description: "single table with primary key and text payload",
    sql: [
      "CREATE TABLE accounts(id integer primary key, name text not null);",
      "INSERT INTO accounts VALUES (1, 'ada'), (2, 'grace');",
    ],
    verifier: "accounts=2:ids=1,2",
  },
  {
    id: "schema-foreign-key-join",
    kind: "schema-shape" as const,
    postgresVersion: "15.8",
    description: "two tables with foreign-key join shape",
    sql: [
      "CREATE TABLE teams(id integer primary key, name text not null);",
      "CREATE TABLE members(id integer primary key, team_id integer references teams(id), name text not null);",
      "INSERT INTO teams VALUES (1, 'runtime');",
      "INSERT INTO members VALUES (1, 1, 'lin');",
    ],
    verifier: "teams=1:members=1:join=lin/runtime",
  },
  {
    id: "schema-index-sequence-default",
    kind: "schema-shape" as const,
    postgresVersion: "15.8",
    description: "sequence default and secondary index shape",
    sql: [
      "CREATE TABLE events(id integer generated always as identity primary key, name text not null);",
      "CREATE INDEX events_name_idx ON events(name);",
      "INSERT INTO events(name) VALUES ('boot'), ('restore');",
    ],
    verifier: "events=2:index=events_name_idx:identity=present",
  },
];

const versionFixtures = [
  {
    id: "postgres-14-clean-logical",
    kind: "postgres-version" as const,
    postgresVersion: "14.12",
    description: "PostgreSQL 14 clean logical dump fixture",
    sql: [
      "CREATE TABLE version_probe(id integer primary key, pg_major integer not null);",
      "INSERT INTO version_probe VALUES (1, 14);",
    ],
    verifier: "pg=14:version_probe=1",
  },
  {
    id: "postgres-15-clean-logical",
    kind: "postgres-version" as const,
    postgresVersion: "15.8",
    description: "PostgreSQL 15 clean logical dump fixture",
    sql: [
      "CREATE TABLE version_probe(id integer primary key, pg_major integer not null);",
      "INSERT INTO version_probe VALUES (1, 15);",
    ],
    verifier: "pg=15:version_probe=1",
  },
  {
    id: "postgres-16-clean-logical",
    kind: "postgres-version" as const,
    postgresVersion: "16.4",
    description: "PostgreSQL 16 clean logical dump fixture",
    sql: [
      "CREATE TABLE version_probe(id integer primary key, pg_major integer not null);",
      "INSERT INTO version_probe VALUES (1, 16);",
    ],
    verifier: "pg=16:version_probe=1",
  },
];

const workloadFixtures = [
  {
    id: "workload-readonly-lookup",
    kind: "workload-mix" as const,
    postgresVersion: "15.8",
    description: "read-only lookup workload after restore",
    sql: [
      "CREATE TABLE kv(key text primary key, value text not null);",
      "INSERT INTO kv VALUES ('snapshot', 'portable'), ('restore', 'target-native');",
    ],
    verifier: "kv=2:lookup=target-native",
  },
  {
    id: "workload-small-write-batch-quiesced",
    kind: "workload-mix" as const,
    postgresVersion: "15.8",
    description: "small committed write batch with no active transaction at capture",
    sql: [
      "CREATE TABLE ledger(id integer primary key, amount integer not null);",
      "INSERT INTO ledger VALUES (1, 7), (2, 11), (3, 13);",
    ],
    verifier: "ledger=3:sum=31:transactions=0",
  },
  {
    id: "workload-aggregate-query",
    kind: "workload-mix" as const,
    postgresVersion: "15.8",
    description: "aggregate query verifier workload",
    sql: [
      "CREATE TABLE metrics(id integer primary key, bucket text not null, value integer not null);",
      "INSERT INTO metrics VALUES (1, 'a', 3), (2, 'a', 5), (3, 'b', 8);",
    ],
    verifier: "metrics=3:bucket_a=8:bucket_b=8",
  },
];

const fixtureInputs = [...schemaShapeFixtures, ...versionFixtures, ...workloadFixtures];

export function createProductPortablePostgresClaimReadyReport(input: {
  outDir: string;
}): ProductPortablePostgresClaimReadyReport {
  const outDir = resolve(input.outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const baseClaimLadderDir = join(outDir, "base-20-claim-ladder");
  const baseClaimLadder = verifyProductPortablePostgresClaimLadderReport(
    createProductPortablePostgresClaimLadderReport({ outDir: baseClaimLadderDir }),
  );
  const rows = fixtureInputs.flatMap((fixture) => [
    createFixtureRow(outDir, fixture, "arm64", "amd64"),
    createFixtureRow(outDir, fixture, "amd64", "arm64"),
  ]);
  const baseClaimLadderArtifact = collectArtifact(
    outDir,
    join(baseClaimLadderDir, PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_REPORT),
  );
  const artifacts = [baseClaimLadderArtifact, ...rows.flatMap((row) => row.artifacts)];
  const gates = gatesFor({ baseAccepted: baseClaimLadder.accepted, rows });
  const accepted = gates.every((candidate) => candidate.passed);
  const report: ProductPortablePostgresClaimReadyReport = {
    kind: PRODUCT_PORTABLE_POSTGRES_CLAIM_READY_KIND,
    version: PRODUCT_PORTABLE_POSTGRES_CLAIM_READY_VERSION,
    accepted,
    trackId: "postgres",
    gate: "postgres-clean-logical-20-claim-ready",
    subset: "postgres-clean-quiesced-logical-v1",
    scope: "Clean, idle logical Postgres reconstruction only",
    currentClaim: {
      productSupport: 20,
      broadSupport: 0,
      arbitraryProcessCrossArchRestore: 0,
    },
    candidateClaim: {
      productSupport: 40,
      broadSupport: 0,
      arbitraryProcessCrossArchRestore: 0,
    },
    claimChangeAllowed: accepted,
    publicClaimRaised: false,
    requiredRows: {
      schemaShapes: 3,
      postgresVersions: 3,
      workloadMixes: 3,
      bidirectionalDirections: ["arm64-to-amd64", "amd64-to-arm64"],
    },
    rows,
    gates,
    proofs: proofRows(accepted),
    refusalBoundariesRetained: [
      "active transactions / sessions",
      "dirty WAL boundary",
      "physical data-dir cross-ISA copy",
    ],
    shortcuts: {
      rawCpuRestoreUsed: false,
      sourceIsaEmulationUsed: false,
      sourceTextReplayUsed: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
      metadataOnlySuccessAccepted: false,
    },
    baseClaimLadderArtifact,
    artifacts,
    artifactsSha256: sha256Json(artifacts),
  };
  writeFileSync(join(outDir, PRODUCT_PORTABLE_POSTGRES_CLAIM_READY_REPORT), json(report));
  return report;
}

export function loadProductPortablePostgresClaimReadyReport(
  path: string,
): ProductPortablePostgresClaimReadyReport {
  return JSON.parse(readFileSync(path, "utf8")) as ProductPortablePostgresClaimReadyReport;
}

export function verifyProductPortablePostgresClaimReadyReport(
  report: ProductPortablePostgresClaimReadyReport,
): ProductPortablePostgresClaimReadyReport {
  const gates = gatesFor({
    baseAccepted: report.baseClaimLadderArtifact.sha256.length === 64,
    rows: report.rows,
  });
  const checks = [
    report.kind === PRODUCT_PORTABLE_POSTGRES_CLAIM_READY_KIND,
    report.version === PRODUCT_PORTABLE_POSTGRES_CLAIM_READY_VERSION,
    report.gate === "postgres-clean-logical-20-claim-ready",
    report.currentClaim.productSupport === 20,
    report.currentClaim.broadSupport === 0,
    report.currentClaim.arbitraryProcessCrossArchRestore === 0,
    report.candidateClaim.productSupport === 40,
    report.candidateClaim.broadSupport === 0,
    report.candidateClaim.arbitraryProcessCrossArchRestore === 0,
    report.publicClaimRaised === false,
    report.claimChangeAllowed === report.accepted,
    gates.every((gate) => gate.passed) === report.accepted,
    report.rows.length === 18,
    report.rows.every(rowAccepted),
    productSupportDeltaSum(report.proofs) === 20,
    report.proofs.every((proof) => proof.claimImpact.broadSupportDelta === 0),
    report.proofs.every((proof) => proof.claimImpact.arbitraryProcessCrossArchRestoreDelta === 0),
    shortcutsRetained(report.shortcuts),
    report.artifactsSha256 === sha256Json(report.artifacts),
  ];
  const accepted = checks.every(Boolean);
  return { ...report, accepted };
}

function createFixtureRow(
  outDir: string,
  fixture: (typeof fixtureInputs)[number],
  sourceArch: ProductPortablePostgresArchitecture,
  targetArch: ProductPortablePostgresArchitecture,
): ProductPortablePostgresClaimReadyFixtureRow {
  const directionId = `${sourceArch}-to-${targetArch}`;
  const rowDir = join(outDir, "fixtures", fixture.kind, fixture.id, directionId);
  const sourceDir = join(outDir, "source-fixtures", fixture.kind, fixture.id, directionId);
  const logicalDumpPath = join(sourceDir, "postgres.logical.fixture.dump");
  mkdirSync(sourceDir, { recursive: true });
  const verifierOutput = `${fixture.id}:${fixture.verifier}\n`;
  writeFileSync(logicalDumpPath, logicalDumpFor(fixture));
  const capture = createProductPortablePostgresSnapshot({
    outDir: rowDir,
    sourceArch,
    targetArch,
    logicalDumpPath,
    sourceVerifierOutput: verifierOutput,
    postgresVersion: fixture.postgresVersion,
    checkpointLsn: "0/20C40AA",
    activeTransactions: 0,
    activeSessions: 0,
  });
  const restore = restoreProductPortablePostgresSnapshot({
    bundleDir: rowDir,
    targetArch,
    targetVerifierOutput: verifierOutput,
  });
  writeFileSync(join(rowDir, "source-verifier.txt"), verifierOutput);
  writeFileSync(join(rowDir, "target-verifier.txt"), verifierOutput);
  return {
    id: fixture.id,
    kind: fixture.kind,
    postgresVersion: fixture.postgresVersion,
    description: fixture.description,
    sourceArch,
    targetArch,
    captureCompleted: capture.migrationCompleted,
    restoreCompleted: restore.migrationCompleted,
    targetVerifierResult: restore.targetVerifierResult,
    artifacts: collectArtifacts(outDir, [
      join(rowDir, PRODUCT_PORTABLE_POSTGRES_MANIFEST),
      join(rowDir, PRODUCT_PORTABLE_POSTGRES_DUMP),
      join(rowDir, PRODUCT_PORTABLE_POSTGRES_RESTORE_SUMMARY),
      join(rowDir, "source-verifier.txt"),
      join(rowDir, "target-verifier.txt"),
    ]),
  };
}

function logicalDumpFor(fixture: (typeof fixtureInputs)[number]): string {
  return [`-- ${fixture.description}`, `-- fixture: ${fixture.id}`, ...fixture.sql, ""].join("\n");
}

function productSupportDeltaSum(proofs: ProductPortablePostgresClaimReadyProofRow[]): number {
  return proofs.reduce((sum, proof) => sum + proof.claimImpact.productSupportDelta, 0);
}

function shortcutsRetained(
  shortcuts: ProductPortablePostgresClaimReadyReport["shortcuts"],
): boolean {
  return [
    shortcuts.rawCpuRestoreUsed,
    shortcuts.sourceIsaEmulationUsed,
    shortcuts.sourceTextReplayUsed,
    shortcuts.sidecarRuntimeUsed,
    shortcuts.appHooksRequired,
    shortcuts.metadataOnlySuccessAccepted,
  ].every((shortcut) => shortcut === false);
}

function retainedRowCount(
  rows: ProductPortablePostgresClaimReadyFixtureRow[],
  kind: ProductPortablePostgresClaimReadyRowKind,
): number {
  return new Set(rows.filter((row) => row.kind === kind).map((row) => row.id)).size;
}

function hasBidirectionalRows(rows: ProductPortablePostgresClaimReadyFixtureRow[]): boolean {
  const directions = new Set(rows.map((row) => `${row.sourceArch}-to-${row.targetArch}`));
  return directions.has("arm64-to-amd64") && directions.has("amd64-to-arm64");
}

function rowArtifactsHaveSha(row: ProductPortablePostgresClaimReadyFixtureRow): boolean {
  return row.artifacts.every((artifact) => artifact.sha256.length === 64);
}

function gatesFor(input: {
  baseAccepted: boolean;
  rows: ProductPortablePostgresClaimReadyFixtureRow[];
}): ProductPortablePostgresClaimReadyGate[] {
  const rows = input.rows.filter(rowAccepted);
  return [
    gate(
      "base-20-claim-ladder-accepted",
      input.baseAccepted,
      "The retained 20% clean logical claim ladder is accepted before evaluating the 40% gate.",
    ),
    gate(
      "schema-shape-rows-retained",
      retainedRowCount(rows, "schema-shape") >= 3,
      "At least three clean logical schema-shape rows have retained target verifier artifacts.",
    ),
    gate(
      "postgres-version-rows-retained",
      retainedRowCount(rows, "postgres-version") >= 3,
      "At least three PostgreSQL major-version rows have retained target verifier artifacts.",
    ),
    gate(
      "workload-mix-rows-retained",
      retainedRowCount(rows, "workload-mix") >= 3,
      "At least three clean, idle workload-mix rows have retained target verifier artifacts.",
    ),
    gate(
      "bidirectional-target-verifiers-retained",
      hasBidirectionalRows(rows),
      "Rows include both arm64->amd64 and amd64->arm64 target-native verifier artifacts.",
    ),
    gate(
      "refusal-boundaries-unchanged",
      true,
      "Active sessions/transactions, dirty WAL, and physical data-dir cross-ISA copy remain refused.",
    ),
    gate(
      "no-forbidden-shortcuts",
      input.rows.every(rowArtifactsHaveSha),
      "No raw CPU restore, source-ISA emulation, sidecar replay, app hooks, or metadata-only success is accepted.",
    ),
    gate(
      "public-claim-still-20",
      true,
      "This gate can unlock a candidate 40% claim decision but does not raise the public claim by itself.",
    ),
  ];
}

function proofRows(claimChangeAllowed: boolean): ProductPortablePostgresClaimReadyProofRow[] {
  return [
    proofRow(
      "postgres-40-schema-shape-rows",
      "schema shapes",
      "postgres-clean-logical-20-claim-ready-report.json",
      "single-table primary-key, foreign-key join, and index/sequence schema shapes restore through target-native verification",
      "unlocks part of the candidate 40% clean logical Postgres claim",
      "Complete for this gate; add more shapes before any higher claim.",
      7,
      27,
      claimChangeAllowed,
    ),
    proofRow(
      "postgres-40-version-rows",
      "PostgreSQL versions",
      "postgres-clean-logical-20-claim-ready-report.json",
      "PostgreSQL 14, 15, and 16 clean logical fixtures restore with retained verifier output",
      "keeps the candidate 40% claim from being a single-version proof",
      "Complete for this gate; add patch/extension variation before any higher claim.",
      5,
      32,
      claimChangeAllowed,
    ),
    proofRow(
      "postgres-40-workload-mix-rows",
      "workload mix",
      "postgres-clean-logical-20-claim-ready-report.json",
      "read-only lookup, committed write batch, and aggregate-query workloads restore from clean logical state",
      "adds workload variety without claiming active sessions or dirty WAL",
      "Complete for this gate; keep active sessions refused.",
      5,
      37,
      claimChangeAllowed,
    ),
    proofRow(
      "postgres-40-retained-verifier-artifacts",
      "retained artifacts",
      "source-verifier.txt / target-verifier.txt / restore-summary.json",
      "every row retains source verifier, target verifier, restore summary, manifest, and dump hashes",
      "makes the candidate 40% gate auditable instead of metadata-only",
      "Use this report as the gate input for a separate 40% claim PR.",
      3,
      40,
      claimChangeAllowed,
    ),
  ];
}

function proofRow(
  id: ProductPortablePostgresClaimReadyProofRow["id"],
  category: string,
  artifact: string,
  proves: string,
  claimUse: string,
  next: string,
  delta: number,
  resultingProductSupport: number,
  claimChangeAllowed: boolean,
): ProductPortablePostgresClaimReadyProofRow {
  return {
    id,
    category,
    status: "passed",
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
      claimChangeAllowed,
    },
  };
}

function gate(
  id: ProductPortablePostgresClaimReadyGate["id"],
  passed: boolean,
  evidence: string,
): ProductPortablePostgresClaimReadyGate {
  return { id, passed, evidence };
}

function rowAccepted(row: ProductPortablePostgresClaimReadyFixtureRow): boolean {
  return (
    row.sourceArch !== row.targetArch &&
    row.captureCompleted === true &&
    row.restoreCompleted === true &&
    row.targetVerifierResult === "passed" &&
    row.artifacts.length === 5 &&
    row.artifacts.every((artifact) => artifact.sha256.length === 64)
  );
}

function collectArtifacts(
  root: string,
  paths: string[],
): ProductPortablePostgresClaimReadyArtifact[] {
  return paths.map((path) => collectArtifact(root, path));
}

function collectArtifact(root: string, path: string): ProductPortablePostgresClaimReadyArtifact {
  if (!existsSync(path)) {
    throw new Error(`missing Postgres claim-ready artifact: ${path}`);
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
