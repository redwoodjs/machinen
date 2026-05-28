export const PORTABLE_SNAPSHOT_GUEST_CHECKPOINT_COMPOSITION_KIND =
  "machinen.architecture-portable-snapshot.portable-snapshot-guest-checkpoint-composition" as const;

export const portableSnapshotGuestCheckpointCompositionRefusalCodes = [
  "guest-checkpoint-capability-unavailable",
  "guest-checkpoint-storage-unsupported-or-dirty",
  "cross-isa-checkpoint-image-restore-unsupported",
  "machinen-restore-path-unsupported",
  "composition-verifier-missing-or-ambiguous",
  "stored-checkpoint-image-unreadable-after-restore",
] as const;

export type PortableSnapshotGuestCheckpointCompositionRefusalCode =
  (typeof portableSnapshotGuestCheckpointCompositionRefusalCodes)[number];
export type PortableSnapshotGuestCheckpointCompositionState = "completed" | "refused" | "skipped";
export type PortableSnapshotGuestCheckpointMachinenStateModel =
  | "same-arch-vmstate"
  | "cross-arch-semantic-restore"
  | "unsupported-cross-isa-checkpoint-replay"
  | "other-supported";

export interface PortableSnapshotGuestCheckpointCompositionInput {
  sourceArch: string;
  targetArch: string;
  machinenStateModel: PortableSnapshotGuestCheckpointMachinenStateModel;
  guestCheckpointVersion: string;
  preSnapshotGuestCheckpointVerifier: string;
  postRestoreGuestCheckpointVerifier: string;
  storedCheckpointImageDigest: string;
  storedCheckpointImageReadableAfterRestore: boolean;
  migrationCompleted?: boolean;
  refusalCode?: PortableSnapshotGuestCheckpointCompositionRefusalCode;
  remediation?: string;
  evidence?: Record<string, unknown>;
}

export interface PortableSnapshotGuestCheckpointCompositionRow extends PortableSnapshotGuestCheckpointCompositionInput {
  kind: typeof PORTABLE_SNAPSHOT_GUEST_CHECKPOINT_COMPOSITION_KIND;
  state: PortableSnapshotGuestCheckpointCompositionState;
  migrationCompleted: boolean;
  scope: {
    guestCheckpointSameIsaOnly: true;
    crossIsaCheckpointImageRestoreClaimed: false;
    machinenRestoreRequired: true;
  };
}

export interface PortableSnapshotGuestCheckpointCompositionSummary {
  kind: "machinen.architecture-portable-snapshot.portable-snapshot-guest-checkpoint-composition-smoke";
  state: "completed" | "failed";
  pass: boolean;
  rows: PortableSnapshotGuestCheckpointCompositionRow[];
  completedRows: number;
  refusedRows: number;
  failures: string[];
}

export function buildPortableSnapshotGuestCheckpointCompositionRow(
  input: PortableSnapshotGuestCheckpointCompositionInput,
): PortableSnapshotGuestCheckpointCompositionRow {
  const refusal = input.refusalCode ?? classifyCompositionRefusal(input);
  const state = refusal ? "refused" : "completed";
  return {
    ...input,
    kind: PORTABLE_SNAPSHOT_GUEST_CHECKPOINT_COMPOSITION_KIND,
    state,
    migrationCompleted: state === "completed" ? input.migrationCompleted !== false : false,
    refusalCode: refusal,
    remediation: refusal ? (input.remediation ?? remediationFor(refusal)) : input.remediation,
    evidence: input.evidence ?? {},
    scope: {
      guestCheckpointSameIsaOnly: true,
      crossIsaCheckpointImageRestoreClaimed: false,
      machinenRestoreRequired: true,
    },
  };
}

export function summarizePortableSnapshotGuestCheckpointCompositionRows(
  rows: PortableSnapshotGuestCheckpointCompositionRow[],
): PortableSnapshotGuestCheckpointCompositionSummary {
  const failures = validatePortableSnapshotGuestCheckpointCompositionRows(rows);
  return {
    kind: "machinen.architecture-portable-snapshot.portable-snapshot-guest-checkpoint-composition-smoke",
    state: failures.length === 0 ? "completed" : "failed",
    pass: failures.length === 0,
    rows,
    completedRows: rows.filter((row) => row.state === "completed").length,
    refusedRows: rows.filter((row) => row.state === "refused").length,
    failures,
  };
}

// fallow-ignore-next-line complexity
export function validatePortableSnapshotGuestCheckpointCompositionRows(
  rows: PortableSnapshotGuestCheckpointCompositionRow[],
): string[] {
  const failures: string[] = [];
  if (rows.length === 0) {
    failures.push("composition summary has no rows");
  }
  for (const row of rows) {
    if (row.kind !== PORTABLE_SNAPSHOT_GUEST_CHECKPOINT_COMPOSITION_KIND) {
      failures.push("composition row has wrong kind");
    }
    if (!row.sourceArch || !row.targetArch || !row.machinenStateModel) {
      failures.push("composition row is missing architecture or Machinen state model");
    }
    if (!row.guestCheckpointVersion) {
      failures.push("composition row is missing guest checkpoint version");
    }
    if (!row.preSnapshotGuestCheckpointVerifier || !row.postRestoreGuestCheckpointVerifier) {
      failures.push("composition row is missing pre/post guest checkpoint verifier output");
    }
    if (!row.storedCheckpointImageDigest) {
      failures.push("composition row is missing stored checkpoint image digest");
    }
    if (row.state === "completed") {
      if (!row.migrationCompleted || !row.storedCheckpointImageReadableAfterRestore) {
        failures.push("completed composition row did not complete migration or image readability");
      }
    } else if (!row.refusalCode || !row.remediation || row.migrationCompleted) {
      failures.push("refused composition row is missing refusal details or completed migration");
    }
    if (row.scope.crossIsaCheckpointImageRestoreClaimed) {
      failures.push("composition row claimed cross-ISA checkpoint image restore");
    }
  }
  return failures;
}

function classifyCompositionRefusal(
  input: PortableSnapshotGuestCheckpointCompositionInput,
): PortableSnapshotGuestCheckpointCompositionRefusalCode | undefined {
  if (input.machinenStateModel === "unsupported-cross-isa-checkpoint-replay") {
    return "cross-isa-checkpoint-image-restore-unsupported";
  }
  if (!input.preSnapshotGuestCheckpointVerifier || !input.postRestoreGuestCheckpointVerifier) {
    return "composition-verifier-missing-or-ambiguous";
  }
  if (!input.storedCheckpointImageReadableAfterRestore) {
    return "stored-checkpoint-image-unreadable-after-restore";
  }
  return undefined;
}

function remediationFor(code: PortableSnapshotGuestCheckpointCompositionRefusalCode): string {
  switch (code) {
    case "guest-checkpoint-capability-unavailable":
      return "Run the guest checkpoint substrate proof first and require CRIU checks to pass.";
    case "guest-checkpoint-storage-unsupported-or-dirty":
      return "Store the guest checkpoint image on supported guest-owned storage and quiesce it before Machinen snapshot.";
    case "cross-isa-checkpoint-image-restore-unsupported":
      return "Do not restore source-ISA checkpoint images after an ISA-changing Machinen restore; treat them as readable artifacts only.";
    case "machinen-restore-path-unsupported":
      return "Use a supported Machinen restore path before claiming composition.";
    case "composition-verifier-missing-or-ambiguous":
      return "Record unambiguous pre-snapshot and post-restore guest checkpoint verifier output.";
    case "stored-checkpoint-image-unreadable-after-restore":
      return "Verify the stored guest checkpoint image digest can be read after Machinen restore.";
  }
}
