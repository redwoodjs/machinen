export const NESTED_VIRTUALIZATION_STRETCH_PROOF_KIND =
  "machinen.architecture-portable-snapshot.nested-virtualization-stretch-proof" as const;

export const nestedVirtualizationStretchProofClassifications = [
  "stretch-demo",
  "refused",
  "skipped",
] as const;

export const nestedVirtualizationStretchProofRefusalCodes = [
  "nested-virtualization-unavailable",
  "nested-smoke-failed",
  "nested-verifier-ambiguous",
  "nested-snapshot-fork-unsafe",
] as const;

export type NestedVirtualizationStretchProofClassification =
  (typeof nestedVirtualizationStretchProofClassifications)[number];
export type NestedVirtualizationStretchProofRefusalCode =
  (typeof nestedVirtualizationStretchProofRefusalCodes)[number];

export interface NestedVirtualizationStretchProofInput {
  classification: NestedVirtualizationStretchProofClassification;
  l0HostArch: string;
  l1GuestArch: string;
  l2GuestArch: string;
  providerMode: string;
  accelerated: boolean;
  emulated: boolean;
  nestedVerifierOutput: string;
  refusalCode?: NestedVirtualizationStretchProofRefusalCode;
  remediation?: string;
  snapshotForkRefusalCode: string;
  snapshotForkRemediation: string;
  evidence?: Record<string, unknown>;
}

export interface NestedVirtualizationStretchProofRow extends NestedVirtualizationStretchProofInput {
  kind: typeof NESTED_VIRTUALIZATION_STRETCH_PROOF_KIND;
  migrationCompleted: false;
  scope: {
    productSupportClaimed: false;
    portableSnapshotRequirement: false;
    providerSnapshotForkSafe: false;
  };
}

export interface NestedVirtualizationStretchProofSummary {
  kind: "machinen.architecture-portable-snapshot.nested-virtualization-stretch-proof-summary";
  state: "completed" | "failed";
  pass: boolean;
  rows: NestedVirtualizationStretchProofRow[];
  rowCount: number;
  failures: string[];
}

export function buildNestedVirtualizationStretchProofRow(
  input: NestedVirtualizationStretchProofInput,
): NestedVirtualizationStretchProofRow {
  return {
    ...input,
    kind: NESTED_VIRTUALIZATION_STRETCH_PROOF_KIND,
    migrationCompleted: false,
    scope: {
      productSupportClaimed: false,
      portableSnapshotRequirement: false,
      providerSnapshotForkSafe: false,
    },
  };
}

export function summarizeNestedVirtualizationStretchProofRows(
  rows: NestedVirtualizationStretchProofRow[],
): NestedVirtualizationStretchProofSummary {
  const failures = validateNestedVirtualizationStretchProofRows(rows);
  return {
    kind: "machinen.architecture-portable-snapshot.nested-virtualization-stretch-proof-summary",
    state: failures.length === 0 ? "completed" : "failed",
    pass: failures.length === 0,
    rows,
    rowCount: rows.length,
    failures,
  };
}

// fallow-ignore-next-line complexity
export function validateNestedVirtualizationStretchProofRows(
  rows: NestedVirtualizationStretchProofRow[],
): string[] {
  const failures: string[] = [];
  if (rows.length === 0) {
    failures.push("missing nested virtualization proof row");
  }
  for (const row of rows) {
    if (row.kind !== NESTED_VIRTUALIZATION_STRETCH_PROOF_KIND) {
      failures.push("nested row has wrong kind");
    }
    if (!row.l0HostArch || !row.l1GuestArch || !row.l2GuestArch || !row.providerMode) {
      failures.push("nested row is missing architecture or provider mode");
    }
    if (!row.nestedVerifierOutput) {
      failures.push("nested row is missing verifier output");
    }
    if (row.emulated && row.accelerated) {
      failures.push("nested row cannot be both accelerated and emulated");
    }
    if (row.classification === "stretch-demo") {
      if (!row.accelerated || row.emulated) {
        failures.push("stretch nested row must be accelerated and not labeled emulated");
      }
      if (!row.nestedVerifierOutput.includes("firecracker-nested-ok")) {
        failures.push("stretch nested row is missing Firecracker L2 success marker");
      }
    }
    if (row.classification !== "stretch-demo" && (!row.refusalCode || !row.remediation)) {
      failures.push("non-stretch nested row is missing refusal code or remediation");
    }
    if (row.snapshotForkRefusalCode !== "BOOT_VMSTATE_UNSUPPORTED") {
      failures.push("nested row is missing provider snapshot/fork refusal code");
    }
    if (!row.snapshotForkRemediation) {
      failures.push("nested row is missing snapshot/fork remediation");
    }
    if (
      row.migrationCompleted ||
      row.scope.productSupportClaimed ||
      row.scope.portableSnapshotRequirement ||
      row.scope.providerSnapshotForkSafe
    ) {
      failures.push("nested row incorrectly claims product support or provider snapshot safety");
    }
  }
  return failures;
}
