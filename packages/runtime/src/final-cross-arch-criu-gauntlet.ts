import { createHash } from "node:crypto";

export const FINAL_CROSS_ARCH_CRIU_GAUNTLET_KIND =
  "machinen.cross-arch-criu.final-proof-gauntlet" as const;

export const FINAL_CROSS_ARCH_CRIU_GAUNTLET_ROW_KIND =
  "machinen.cross-arch-criu.final-proof-gauntlet-row" as const;

export const finalCrossArchCriuGauntletClassifications = [
  "product-supported",
  "proof-only-feasibility",
  "stretch-demo",
  "refused",
  "skipped",
] as const;

export const finalCrossArchCriuTargetExecutions = [
  "native",
  "accelerated",
  "emulated",
  "not-applicable",
] as const;

export type FinalCrossArchCriuGauntletClassification =
  (typeof finalCrossArchCriuGauntletClassifications)[number];
export type FinalCrossArchCriuTargetExecution = (typeof finalCrossArchCriuTargetExecutions)[number];

export interface FinalCrossArchCriuGauntletRowInput {
  claimId: string;
  claimName: string;
  classification: FinalCrossArchCriuGauntletClassification;
  sourceArch: string;
  targetArch: string;
  hostArch: string;
  providerMode: string;
  targetExecution: FinalCrossArchCriuTargetExecution;
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

export interface FinalCrossArchCriuGauntletRow extends FinalCrossArchCriuGauntletRowInput {
  kind: typeof FINAL_CROSS_ARCH_CRIU_GAUNTLET_ROW_KIND;
}

export interface FinalCrossArchCriuGauntletSummary {
  kind: typeof FINAL_CROSS_ARCH_CRIU_GAUNTLET_KIND;
  state: "completed" | "failed";
  pass: boolean;
  rowCount: number;
  rows: FinalCrossArchCriuGauntletRow[];
  byClassification: Record<FinalCrossArchCriuGauntletClassification, number>;
  failures: string[];
}

export function buildFinalCrossArchCriuGauntletRow(
  input: FinalCrossArchCriuGauntletRowInput,
): FinalCrossArchCriuGauntletRow {
  return { ...input, kind: FINAL_CROSS_ARCH_CRIU_GAUNTLET_ROW_KIND };
}

export function summarizeFinalCrossArchCriuGauntletRows(
  rows: FinalCrossArchCriuGauntletRow[],
): FinalCrossArchCriuGauntletSummary {
  const failures = validateFinalCrossArchCriuGauntletRows(rows);
  return {
    kind: FINAL_CROSS_ARCH_CRIU_GAUNTLET_KIND,
    state: failures.length === 0 ? "completed" : "failed",
    pass: failures.length === 0,
    rowCount: rows.length,
    rows,
    byClassification: countByClassification(rows),
    failures,
  };
}

export function validateFinalCrossArchCriuGauntletRows(
  rows: FinalCrossArchCriuGauntletRow[],
): string[] {
  return [
    ...validateFinalCrossArchCriuGauntletSchema(rows),
    ...validateFinalCrossArchCriuGauntletInvariants(rows),
  ];
}

export function validateFinalCrossArchCriuGauntletSchema(
  rows: FinalCrossArchCriuGauntletRow[],
): string[] {
  const failures: string[] = [];
  for (const id of requiredFinalCrossArchCriuClaimIds) {
    if (!rows.some((row) => row.claimId === id)) {
      failures.push(`missing final gauntlet claim ${id}`);
    }
  }
  for (const row of rows) {
    failures.push(...validateFinalCrossArchCriuGauntletRowShape(row));
  }
  return failures;
}

export function validateFinalCrossArchCriuGauntletInvariants(
  rows: FinalCrossArchCriuGauntletRow[],
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

export const requiredFinalCrossArchCriuClaimIds = [
  "opposite-isa-vm-execution",
  "postgres-bidirectional-logical-restore",
  "postgres-unsafe-neighbor-refusals",
  "sqlite-rollback-journal-restore",
  "sqlite-wal-checkpoint-restore",
  "sqlite-dirty-inflight-refusals",
  "guest-criu-c-simple",
  "guest-criu-jvm-simple",
  "portable-snapshot-guest-criu-composition",
  "runtime-confidence-c",
  "runtime-confidence-java",
  "advanced-linux-seccomp",
  "advanced-linux-ebpf",
  "advanced-linux-namespace-cgroup-capability",
  "nested-virtualization-stretch-proof",
] as const;

function validateFinalCrossArchCriuGauntletRowShape(row: FinalCrossArchCriuGauntletRow): string[] {
  const failures: string[] = [];
  for (const field of requiredStringFields) {
    if (!row[field]) {
      failures.push(`${row.claimId || "<missing>"} missing ${field}`);
    }
  }
  if (row.kind !== FINAL_CROSS_ARCH_CRIU_GAUNTLET_ROW_KIND) {
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
] as const satisfies ReadonlyArray<keyof FinalCrossArchCriuGauntletRow>;

function validateProductSupportedGauntletRow(row: FinalCrossArchCriuGauntletRow): string[] {
  const failures: string[] = [];
  if (row.targetExecution !== "native") {
    failures.push(`${row.claimId} product-supported row is not target-native`);
  }
  if (row.stateDecisions.includes("raw-cross-isa-criu-image-replay")) {
    failures.push(`${row.claimId} reports raw cross-ISA CRIU image replay as product success`);
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
  rows: FinalCrossArchCriuGauntletRow[],
): Record<FinalCrossArchCriuGauntletClassification, number> {
  return Object.fromEntries(
    finalCrossArchCriuGauntletClassifications.map((classification) => [
      classification,
      rows.filter((row) => row.classification === classification).length,
    ]),
  ) as Record<FinalCrossArchCriuGauntletClassification, number>;
}

export function stableGauntletDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
