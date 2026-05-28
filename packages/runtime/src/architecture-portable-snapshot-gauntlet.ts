import { createHash } from "node:crypto";

export const ARCHITECTURE_PORTABLE_SNAPSHOT_GAUNTLET_KIND =
  "machinen.architecture-portable-snapshot.final-proof-gauntlet" as const;

export const ARCHITECTURE_PORTABLE_SNAPSHOT_GAUNTLET_ROW_KIND =
  "machinen.architecture-portable-snapshot.final-proof-gauntlet-row" as const;

export const architecturePortableSnapshotGauntletClassifications = [
  "product-supported",
  "proof-only-feasibility",
  "stretch-demo",
  "refused",
  "skipped",
] as const;

export const architecturePortableSnapshotTargetExecutions = [
  "native",
  "accelerated",
  "emulated",
  "not-applicable",
] as const;

export type ArchitecturePortableSnapshotGauntletClassification =
  (typeof architecturePortableSnapshotGauntletClassifications)[number];
export type ArchitecturePortableSnapshotTargetExecution =
  (typeof architecturePortableSnapshotTargetExecutions)[number];

export interface ArchitecturePortableSnapshotGauntletRowInput {
  claimId: string;
  claimName: string;
  classification: ArchitecturePortableSnapshotGauntletClassification;
  sourceArch: string;
  targetArch: string;
  hostArch: string;
  providerMode: string;
  targetExecution: ArchitecturePortableSnapshotTargetExecution;
  stateModel: string;
  stateDecisions: string[];
  verifierCommand: string;
  verifierOutput: string;
  artifactDigests: Record<string, string>;
  provenance: Record<string, unknown>;
  migrationCompleted: boolean;
  refusalCode?: string;
  remediation?: string;
}

export interface ArchitecturePortableSnapshotGauntletRow extends ArchitecturePortableSnapshotGauntletRowInput {
  kind: typeof ARCHITECTURE_PORTABLE_SNAPSHOT_GAUNTLET_ROW_KIND;
}

export interface ArchitecturePortableSnapshotGauntletSummary {
  kind: typeof ARCHITECTURE_PORTABLE_SNAPSHOT_GAUNTLET_KIND;
  state: "completed" | "failed";
  pass: boolean;
  rowCount: number;
  rows: ArchitecturePortableSnapshotGauntletRow[];
  byClassification: Record<ArchitecturePortableSnapshotGauntletClassification, number>;
  failures: string[];
}

export function buildArchitecturePortableSnapshotGauntletRow(
  input: ArchitecturePortableSnapshotGauntletRowInput,
): ArchitecturePortableSnapshotGauntletRow {
  return { ...input, kind: ARCHITECTURE_PORTABLE_SNAPSHOT_GAUNTLET_ROW_KIND };
}

export function summarizeArchitecturePortableSnapshotGauntletRows(
  rows: ArchitecturePortableSnapshotGauntletRow[],
): ArchitecturePortableSnapshotGauntletSummary {
  const failures = validateArchitecturePortableSnapshotGauntletRows(rows);
  return {
    kind: ARCHITECTURE_PORTABLE_SNAPSHOT_GAUNTLET_KIND,
    state: failures.length === 0 ? "completed" : "failed",
    pass: failures.length === 0,
    rowCount: rows.length,
    rows,
    byClassification: countByClassification(rows),
    failures,
  };
}

export function validateArchitecturePortableSnapshotGauntletRows(
  rows: ArchitecturePortableSnapshotGauntletRow[],
): string[] {
  return [
    ...validateArchitecturePortableSnapshotGauntletSchema(rows),
    ...validateArchitecturePortableSnapshotGauntletInvariants(rows),
  ];
}

export function validateArchitecturePortableSnapshotGauntletSchema(
  rows: ArchitecturePortableSnapshotGauntletRow[],
): string[] {
  const failures: string[] = [];
  for (const id of requiredArchitecturePortableSnapshotClaimIds) {
    if (!rows.some((row) => row.claimId === id)) {
      failures.push(`missing final gauntlet claim ${id}`);
    }
  }
  for (const row of rows) {
    failures.push(...validateArchitecturePortableSnapshotGauntletRowShape(row));
  }
  return failures;
}

export function validateArchitecturePortableSnapshotGauntletInvariants(
  rows: ArchitecturePortableSnapshotGauntletRow[],
): string[] {
  const failures: string[] = [];
  for (const row of rows) {
    if (row.classification === "product-supported") {
      failures.push(...validateProductSupportedGauntletRow(row));
    }
    if (row.classification === "refused" && row.migrationCompleted) {
      failures.push(`${row.claimId} refused row has migrationCompleted=true`);
    }
    if (row.classification === "skipped" && row.migrationCompleted) {
      failures.push(`${row.claimId} skipped row has migrationCompleted=true`);
    }
  }
  return failures;
}

export const requiredArchitecturePortableSnapshotClaimIds = [
  "opposite-isa-vm-execution",
  "postgres-bidirectional-logical-restore",
  "postgres-unsafe-neighbor-refusals",
  "sqlite-rollback-journal-restore",
  "sqlite-wal-checkpoint-restore",
  "sqlite-dirty-inflight-refusals",
  "guest-checkpoint-c-simple",
  "guest-checkpoint-jvm-simple",
  "portable-snapshot-guest-checkpoint-composition",
  "runtime-confidence-c",
  "runtime-confidence-java",
  "advanced-linux-seccomp",
  "advanced-linux-ebpf",
  "advanced-linux-namespace-cgroup-capability",
  "nested-virtualization-stretch-proof",
] as const;

function validateArchitecturePortableSnapshotGauntletRowShape(
  row: ArchitecturePortableSnapshotGauntletRow,
): string[] {
  const failures: string[] = [];
  for (const field of requiredStringFields) {
    if (!row[field]) {
      failures.push(`${row.claimId || "<missing>"} missing ${field}`);
    }
  }
  if (row.kind !== ARCHITECTURE_PORTABLE_SNAPSHOT_GAUNTLET_ROW_KIND) {
    failures.push(`${row.claimId} has wrong kind`);
  }
  if (row.stateDecisions.length === 0) {
    failures.push(`${row.claimId} missing stateDecisions`);
  }
  if (Object.keys(row.artifactDigests).length === 0) {
    failures.push(`${row.claimId} missing artifactDigests`);
  }
  if (Object.keys(row.provenance).length === 0) {
    failures.push(`${row.claimId} missing provenance`);
  }
  if ((row.classification === "refused" || row.classification === "skipped") && !row.refusalCode) {
    failures.push(`${row.claimId} missing refusalCode`);
  }
  if ((row.classification === "refused" || row.classification === "skipped") && !row.remediation) {
    failures.push(`${row.claimId} missing remediation`);
  }
  return failures;
}

const requiredStringFields = [
  "claimId",
  "claimName",
  "sourceArch",
  "targetArch",
  "hostArch",
  "providerMode",
  "stateModel",
  "verifierCommand",
  "verifierOutput",
] as const satisfies ReadonlyArray<keyof ArchitecturePortableSnapshotGauntletRow>;

function validateProductSupportedGauntletRow(
  row: ArchitecturePortableSnapshotGauntletRow,
): string[] {
  const failures: string[] = [];
  if (row.targetExecution !== "native") {
    failures.push(`${row.claimId} product-supported row is not target-native`);
  }
  if (row.stateDecisions.includes("raw-cross-isa-checkpoint-image-replay")) {
    failures.push(`${row.claimId} reports raw source checkpoint image replay as product success`);
  }
  if (row.stateDecisions.includes("sidecar-runtime-used")) {
    failures.push(`${row.claimId} reports sidecar success as workload restore success`);
  }
  if (row.stateModel === "metadata-only-continuation") {
    failures.push(`${row.claimId} reports metadata-only continuation as product restore success`);
  }
  if (!row.verifierOutput) {
    failures.push(`${row.claimId} product-supported row lacks target-native verifier output`);
  }
  if (Object.keys(row.artifactDigests).length === 0 || Object.keys(row.provenance).length === 0) {
    failures.push(`${row.claimId} product-supported row lacks artifact digests or provenance`);
  }
  return failures;
}

function countByClassification(
  rows: ArchitecturePortableSnapshotGauntletRow[],
): Record<ArchitecturePortableSnapshotGauntletClassification, number> {
  return Object.fromEntries(
    architecturePortableSnapshotGauntletClassifications.map((classification) => [
      classification,
      rows.filter((row) => row.classification === classification).length,
    ]),
  ) as Record<ArchitecturePortableSnapshotGauntletClassification, number>;
}

export function stableGauntletDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
