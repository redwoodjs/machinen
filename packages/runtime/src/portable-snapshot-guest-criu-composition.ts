export const PORTABLE_SNAPSHOT_GUEST_CRIU_COMPOSITION_KIND =
  "machinen.cross-arch-criu.portable-snapshot-guest-criu-composition" as const;

export const portableSnapshotGuestCriuCompositionRefusalCodes = [
  "guest-criu-capability-unavailable",
  "guest-criu-storage-unsupported-or-dirty",
  "cross-isa-criu-image-restore-unsupported",
  "machinen-restore-path-unsupported",
  "composition-verifier-missing-or-ambiguous",
  "stored-criu-image-unreadable-after-restore",
] as const;

export type PortableSnapshotGuestCriuCompositionRefusalCode =
  (typeof portableSnapshotGuestCriuCompositionRefusalCodes)[number];
export type PortableSnapshotGuestCriuCompositionState = "completed" | "refused" | "skipped";
export type PortableSnapshotGuestCriuMachinenStateModel =
  | "same-arch-vmstate"
  | "cross-arch-semantic-restore"
  | "unsupported-cross-isa-criu-replay"
  | "other-supported";

export interface PortableSnapshotGuestCriuCompositionInput {
  sourceArch: string;
  targetArch: string;
  machinenStateModel: PortableSnapshotGuestCriuMachinenStateModel;
  guestCriuVersion: string;
  preSnapshotGuestCriuVerifier: string;
  postRestoreGuestCriuVerifier: string;
  storedCriuImageDigest: string;
  storedCriuImageReadableAfterRestore: boolean;
  migrationCompleted?: boolean;
  refusalCode?: PortableSnapshotGuestCriuCompositionRefusalCode;
  remediation?: string;
  evidence?: Record<string, unknown>;
}

export interface PortableSnapshotGuestCriuCompositionRow extends PortableSnapshotGuestCriuCompositionInput {
  kind: typeof PORTABLE_SNAPSHOT_GUEST_CRIU_COMPOSITION_KIND;
  state: PortableSnapshotGuestCriuCompositionState;
  migrationCompleted: boolean;
  scope: {
    guestCriuSameIsaOnly: true;
    crossIsaCriuImageRestoreClaimed: false;
    machinenRestoreRequired: true;
  };
}

export interface PortableSnapshotGuestCriuCompositionSummary {
  kind: "machinen.cross-arch-criu.portable-snapshot-guest-criu-composition-smoke";
  state: "completed" | "failed";
  pass: boolean;
  rows: PortableSnapshotGuestCriuCompositionRow[];
  completedRows: number;
  refusedRows: number;
  failures: string[];
}

export function buildPortableSnapshotGuestCriuCompositionRow(
  input: PortableSnapshotGuestCriuCompositionInput,
): PortableSnapshotGuestCriuCompositionRow {
  const refusal = input.refusalCode ?? classifyCompositionRefusal(input);
  const state = refusal ? "refused" : "completed";
  return {
    ...input,
    kind: PORTABLE_SNAPSHOT_GUEST_CRIU_COMPOSITION_KIND,
    state,
    migrationCompleted: state === "completed" ? input.migrationCompleted !== false : false,
    refusalCode: refusal,
    remediation: refusal ? (input.remediation ?? remediationFor(refusal)) : input.remediation,
    evidence: input.evidence ?? {},
    scope: {
      guestCriuSameIsaOnly: true,
      crossIsaCriuImageRestoreClaimed: false,
      machinenRestoreRequired: true,
    },
  };
}

export function summarizePortableSnapshotGuestCriuCompositionRows(
  rows: PortableSnapshotGuestCriuCompositionRow[],
): PortableSnapshotGuestCriuCompositionSummary {
  const failures = validatePortableSnapshotGuestCriuCompositionRows(rows);
  return {
    kind: "machinen.cross-arch-criu.portable-snapshot-guest-criu-composition-smoke",
    state: failures.length === 0 ? "completed" : "failed",
    pass: failures.length === 0,
    rows,
    completedRows: rows.filter((row) => row.state === "completed").length,
    refusedRows: rows.filter((row) => row.state === "refused").length,
    failures,
  };
}

// fallow-ignore-next-line complexity
export function validatePortableSnapshotGuestCriuCompositionRows(
  rows: PortableSnapshotGuestCriuCompositionRow[],
): string[] {
  const failures: string[] = [];
  if (rows.length === 0) {
    failures.push("composition summary has no rows");
  }
  for (const row of rows) {
    if (row.kind !== PORTABLE_SNAPSHOT_GUEST_CRIU_COMPOSITION_KIND) {
      failures.push("composition row has wrong kind");
    }
    if (!row.sourceArch || !row.targetArch || !row.machinenStateModel) {
      failures.push("composition row is missing architecture or Machinen state model");
    }
    if (!row.guestCriuVersion) {
      failures.push("composition row is missing guest CRIU version");
    }
    if (!row.preSnapshotGuestCriuVerifier || !row.postRestoreGuestCriuVerifier) {
      failures.push("composition row is missing pre/post guest CRIU verifier output");
    }
    if (!row.storedCriuImageDigest) {
      failures.push("composition row is missing stored CRIU image digest");
    }
    if (row.state === "completed") {
      if (!row.migrationCompleted || !row.storedCriuImageReadableAfterRestore) {
        failures.push("completed composition row did not complete migration or image readability");
      }
    } else if (!row.refusalCode || !row.remediation || row.migrationCompleted) {
      failures.push("refused composition row is missing refusal details or completed migration");
    }
    if (row.scope.crossIsaCriuImageRestoreClaimed) {
      failures.push("composition row claimed cross-ISA CRIU image restore");
    }
  }
  return failures;
}

function classifyCompositionRefusal(
  input: PortableSnapshotGuestCriuCompositionInput,
): PortableSnapshotGuestCriuCompositionRefusalCode | undefined {
  if (input.machinenStateModel === "unsupported-cross-isa-criu-replay") {
    return "cross-isa-criu-image-restore-unsupported";
  }
  if (!input.preSnapshotGuestCriuVerifier || !input.postRestoreGuestCriuVerifier) {
    return "composition-verifier-missing-or-ambiguous";
  }
  if (!input.storedCriuImageReadableAfterRestore) {
    return "stored-criu-image-unreadable-after-restore";
  }
  return undefined;
}

function remediationFor(code: PortableSnapshotGuestCriuCompositionRefusalCode): string {
  switch (code) {
    case "guest-criu-capability-unavailable":
      return "Run the guest CRIU substrate proof first and require CRIU checks to pass.";
    case "guest-criu-storage-unsupported-or-dirty":
      return "Store the guest CRIU image on supported guest-owned storage and quiesce it before Machinen snapshot.";
    case "cross-isa-criu-image-restore-unsupported":
      return "Do not restore source-ISA CRIU images after an ISA-changing Machinen restore; treat them as readable artifacts only.";
    case "machinen-restore-path-unsupported":
      return "Use a supported Machinen restore path before claiming composition.";
    case "composition-verifier-missing-or-ambiguous":
      return "Record unambiguous pre-snapshot and post-restore guest CRIU verifier output.";
    case "stored-criu-image-unreadable-after-restore":
      return "Verify the stored guest CRIU image digest can be read after Machinen restore.";
  }
}
