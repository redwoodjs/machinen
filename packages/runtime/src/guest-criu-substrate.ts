export const GUEST_CRIU_SUBSTRATE_KIND = "machinen.cross-arch-criu.guest-criu-substrate" as const;

export const guestCriuSubstrateRefusalCodes = [
  "guest-criu-check-unavailable",
  "c-criu-dump-restore-failed",
  "jvm-runtime-unavailable",
  "jvm-criu-runtime-state-unsupported",
  "jvm-criu-dump-restore-failed",
] as const;

export type GuestCriuSubstrateProfile = "c-simple" | "jvm-simple";
export type GuestCriuSubstrateState = "completed" | "refused" | "skipped";
export type GuestCriuSubstrateRefusalCode = (typeof guestCriuSubstrateRefusalCodes)[number];

export interface GuestCriuSubstrateInput {
  guestArch: string;
  kernelVersion: string;
  criuVersion: string;
  kernelFeatureProbeOutput: string;
  profile: GuestCriuSubstrateProfile;
  checkpointLog: string;
  restoreLog: string;
  verifierOutput: string;
  state?: GuestCriuSubstrateState;
  refusalCode?: GuestCriuSubstrateRefusalCode;
  remediation?: string;
  evidence?: Record<string, unknown>;
}

export interface GuestCriuSubstrateRow {
  kind: typeof GUEST_CRIU_SUBSTRATE_KIND;
  guestArch: string;
  kernelVersion: string;
  criuVersion: string;
  kernelFeatureProbeOutput: string;
  profile: GuestCriuSubstrateProfile;
  checkpointLog: string;
  restoreLog: string;
  verifierOutput: string;
  state: GuestCriuSubstrateState;
  refusalCode?: GuestCriuSubstrateRefusalCode;
  remediation?: string;
  evidence: Record<string, unknown>;
  scope: {
    sameGuest: true;
    sameIsa: true;
    crossIsaCriuReplay: false;
    sourceIsaEmulationUsed: false;
  };
}

export interface GuestCriuSubstrateSummary {
  kind: "machinen.cross-arch-criu.guest-criu-substrate-smoke";
  state: "completed" | "failed";
  pass: boolean;
  rows: GuestCriuSubstrateRow[];
  completedRows: number;
  refusedRows: number;
  skippedRows: number;
  failures: string[];
}

export function buildGuestCriuSubstrateRow(input: GuestCriuSubstrateInput): GuestCriuSubstrateRow {
  const state = input.state ?? (input.refusalCode ? "refused" : "completed");
  return {
    kind: GUEST_CRIU_SUBSTRATE_KIND,
    guestArch: input.guestArch,
    kernelVersion: input.kernelVersion,
    criuVersion: input.criuVersion,
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
      crossIsaCriuReplay: false,
      sourceIsaEmulationUsed: false,
    },
  };
}

export function summarizeGuestCriuSubstrateRows(
  rows: GuestCriuSubstrateRow[],
): GuestCriuSubstrateSummary {
  const failures = validateGuestCriuSubstrateRows(rows);
  return {
    kind: "machinen.cross-arch-criu.guest-criu-substrate-smoke",
    state: failures.length === 0 ? "completed" : "failed",
    pass: failures.length === 0,
    rows,
    completedRows: rows.filter((row) => row.state === "completed").length,
    refusedRows: rows.filter((row) => row.state === "refused").length,
    skippedRows: rows.filter((row) => row.state === "skipped").length,
    failures,
  };
}

export function validateGuestCriuSubstrateRows(rows: GuestCriuSubstrateRow[]): string[] {
  const failures: string[] = [];
  if (rows.length === 0) {
    failures.push("guest CRIU substrate summary has no rows");
  }
  for (const row of rows) {
    if (row.kind !== GUEST_CRIU_SUBSTRATE_KIND) {
      failures.push(`${row.profile} row has wrong kind`);
    }
    if (!row.guestArch || !row.kernelVersion || !row.criuVersion) {
      failures.push(`${row.profile} row is missing guest architecture, kernel, or CRIU version`);
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
    if (row.scope.crossIsaCriuReplay || row.scope.sourceIsaEmulationUsed) {
      failures.push(
        `${row.profile} row incorrectly claims cross-ISA CRIU replay or source emulation`,
      );
    }
  }
  return failures;
}
