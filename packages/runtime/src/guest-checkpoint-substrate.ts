export const GUEST_CHECKPOINT_SUBSTRATE_KIND =
  "machinen.architecture-portable-snapshot.guest-checkpoint-substrate" as const;

export const guestCheckpointSubstrateRefusalCodes = [
  "guest-checkpoint-check-unavailable",
  "c-checkpoint-dump-restore-failed",
  "jvm-runtime-unavailable",
  "jvm-checkpoint-runtime-state-unsupported",
  "jvm-checkpoint-dump-restore-failed",
] as const;

export type GuestCheckpointSubstrateProfile = "c-simple" | "jvm-simple";
export type GuestCheckpointSubstrateState = "completed" | "refused" | "skipped";
export type GuestCheckpointSubstrateRefusalCode =
  (typeof guestCheckpointSubstrateRefusalCodes)[number];

export interface GuestCheckpointSubstrateInput {
  guestArch: string;
  kernelVersion: string;
  checkpointToolVersion: string;
  kernelFeatureProbeOutput: string;
  profile: GuestCheckpointSubstrateProfile;
  checkpointLog: string;
  restoreLog: string;
  verifierOutput: string;
  state?: GuestCheckpointSubstrateState;
  refusalCode?: GuestCheckpointSubstrateRefusalCode;
  remediation?: string;
  evidence?: Record<string, unknown>;
}

export interface GuestCheckpointSubstrateRow {
  kind: typeof GUEST_CHECKPOINT_SUBSTRATE_KIND;
  guestArch: string;
  kernelVersion: string;
  checkpointToolVersion: string;
  kernelFeatureProbeOutput: string;
  profile: GuestCheckpointSubstrateProfile;
  checkpointLog: string;
  restoreLog: string;
  verifierOutput: string;
  state: GuestCheckpointSubstrateState;
  refusalCode?: GuestCheckpointSubstrateRefusalCode;
  remediation?: string;
  evidence: Record<string, unknown>;
  scope: {
    sameGuest: true;
    sameIsa: true;
    crossIsaCheckpointReplay: false;
    sourceIsaEmulationUsed: false;
  };
}

export interface GuestCheckpointSubstrateSummary {
  kind: "machinen.architecture-portable-snapshot.guest-checkpoint-substrate-smoke";
  state: "completed" | "failed";
  pass: boolean;
  rows: GuestCheckpointSubstrateRow[];
  completedRows: number;
  refusedRows: number;
  skippedRows: number;
  failures: string[];
}

export function buildGuestCheckpointSubstrateRow(
  input: GuestCheckpointSubstrateInput,
): GuestCheckpointSubstrateRow {
  const state = input.state ?? (input.refusalCode ? "refused" : "completed");
  return {
    kind: GUEST_CHECKPOINT_SUBSTRATE_KIND,
    guestArch: input.guestArch,
    kernelVersion: input.kernelVersion,
    checkpointToolVersion: input.checkpointToolVersion,
    kernelFeatureProbeOutput: input.kernelFeatureProbeOutput,
    profile: input.profile,
    checkpointLog: input.checkpointLog,
    restoreLog: input.restoreLog,
    verifierOutput: input.verifierOutput,
    state,
    refusalCode: input.refusalCode,
    remediation: input.remediation,
    evidence: input.evidence ?? {},
    scope: {
      sameGuest: true,
      sameIsa: true,
      crossIsaCheckpointReplay: false,
      sourceIsaEmulationUsed: false,
    },
  };
}

export function summarizeGuestCheckpointSubstrateRows(
  rows: GuestCheckpointSubstrateRow[],
): GuestCheckpointSubstrateSummary {
  const failures = validateGuestCheckpointSubstrateRows(rows);
  return {
    kind: "machinen.architecture-portable-snapshot.guest-checkpoint-substrate-smoke",
    state: failures.length === 0 ? "completed" : "failed",
    pass: failures.length === 0,
    rows,
    completedRows: rows.filter((row) => row.state === "completed").length,
    refusedRows: rows.filter((row) => row.state === "refused").length,
    skippedRows: rows.filter((row) => row.state === "skipped").length,
    failures,
  };
}

// fallow-ignore-next-line complexity
export function validateGuestCheckpointSubstrateRows(
  rows: GuestCheckpointSubstrateRow[],
): string[] {
  const failures: string[] = [];
  if (rows.length === 0) {
    failures.push("guest checkpoint substrate summary has no rows");
  }
  for (const row of rows) {
    if (row.kind !== GUEST_CHECKPOINT_SUBSTRATE_KIND) {
      failures.push(`${row.profile} row has wrong kind`);
    }
    if (!row.guestArch || !row.kernelVersion || !row.checkpointToolVersion) {
      failures.push(
        `${row.profile} row is missing guest architecture, kernel, or checkpoint tool version`,
      );
    }
    if (!row.kernelFeatureProbeOutput) {
      failures.push(`${row.profile} row is missing kernel feature probe output`);
    }
    if (
      row.state === "completed" &&
      (!row.checkpointLog || !row.restoreLog || !row.verifierOutput)
    ) {
      failures.push(`${row.profile} completed row is missing logs or verifier output`);
    }
    if (row.state !== "completed" && (!row.refusalCode || !row.remediation)) {
      failures.push(`${row.profile} refused/skipped row is missing refusal code or remediation`);
    }
    if (row.profile === "c-simple" && row.state === "completed") {
      const pre = Number(row.evidence.preCheckpointProgress);
      const post = Number(row.evidence.postRestoreProgress);
      if (!Number.isFinite(pre) || !Number.isFinite(post) || post <= pre) {
        failures.push(`${row.profile} verifier did not prove post-restore progress`);
      }
    }
    if (row.scope.crossIsaCheckpointReplay || row.scope.sourceIsaEmulationUsed) {
      failures.push(
        `${row.profile} row incorrectly claims cross-ISA checkpoint replay or source emulation`,
      );
    }
  }
  return failures;
}
