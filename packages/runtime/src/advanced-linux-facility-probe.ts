export const ADVANCED_LINUX_FACILITY_PROBE_KIND =
  "machinen.architecture-portable-snapshot.advanced-linux-facility-probe" as const;

export const advancedLinuxFacilityProbeFacilities = [
  "seccomp",
  "ebpf",
  "namespace",
  "cgroup",
  "capability",
] as const;

export const advancedLinuxFacilityProbeClassifications = [
  "product-supported",
  "proof-only-feasibility",
  "stretch-demo",
  "refused",
] as const;

export const advancedLinuxFacilityProbeRefusalCodes = [
  "kernel-feature-unavailable",
  "insufficient-privileges",
  "unsafe-bpf-state-unsupported",
  "namespace-cgroup-mismatch",
  "capability-mismatch",
  "facility-verifier-ambiguous",
] as const;

export type AdvancedLinuxFacilityProbeFacility =
  (typeof advancedLinuxFacilityProbeFacilities)[number];
export type AdvancedLinuxFacilityProbeClassification =
  (typeof advancedLinuxFacilityProbeClassifications)[number];
export type AdvancedLinuxFacilityProbeRefusalCode =
  (typeof advancedLinuxFacilityProbeRefusalCodes)[number];
export type AdvancedLinuxFacilityProbeStateModel =
  | "preserved"
  | "recreated"
  | "proven-irrelevant"
  | "refused";

export interface AdvancedLinuxFacilityProbeInput {
  facility: AdvancedLinuxFacilityProbeFacility;
  stateModel: AdvancedLinuxFacilityProbeStateModel;
  sourceArch: string;
  targetArch: string;
  kernelVersion: string;
  requiredCapabilities: string[];
  verifierOutput: string;
  classification: AdvancedLinuxFacilityProbeClassification;
  migrationCompleted?: boolean;
  refusalCode?: AdvancedLinuxFacilityProbeRefusalCode;
  remediation?: string;
  evidence?: Record<string, unknown>;
}

export interface AdvancedLinuxFacilityProbeRow extends AdvancedLinuxFacilityProbeInput {
  kind: typeof ADVANCED_LINUX_FACILITY_PROBE_KIND;
  migrationCompleted: boolean;
  scope: {
    productSupportClaimed: boolean;
    crossIsaKernelStateReplayClaimed: false;
  };
}

export interface AdvancedLinuxFacilityProbeSummary {
  kind: "machinen.architecture-portable-snapshot.advanced-linux-facility-probe-matrix";
  state: "completed" | "failed";
  pass: boolean;
  rows: AdvancedLinuxFacilityProbeRow[];
  rowCount: number;
  failures: string[];
}

export function buildAdvancedLinuxFacilityProbeRow(
  input: AdvancedLinuxFacilityProbeInput,
): AdvancedLinuxFacilityProbeRow {
  const refused = input.classification === "refused" || input.stateModel === "refused";
  return {
    ...input,
    kind: ADVANCED_LINUX_FACILITY_PROBE_KIND,
    migrationCompleted: refused ? false : input.migrationCompleted === true,
    scope: {
      productSupportClaimed: input.classification === "product-supported",
      crossIsaKernelStateReplayClaimed: false,
    },
  };
}

export function summarizeAdvancedLinuxFacilityProbeRows(
  rows: AdvancedLinuxFacilityProbeRow[],
): AdvancedLinuxFacilityProbeSummary {
  const failures = validateAdvancedLinuxFacilityProbeRows(rows);
  return {
    kind: "machinen.architecture-portable-snapshot.advanced-linux-facility-probe-matrix",
    state: failures.length === 0 ? "completed" : "failed",
    pass: failures.length === 0,
    rows,
    rowCount: rows.length,
    failures,
  };
}

// fallow-ignore-next-line complexity
export function validateAdvancedLinuxFacilityProbeRows(
  rows: AdvancedLinuxFacilityProbeRow[],
): string[] {
  const failures: string[] = [];
  for (const facility of advancedLinuxFacilityProbeFacilities) {
    if (!rows.some((row) => row.facility === facility)) {
      failures.push(`missing facility ${facility}`);
    }
  }
  for (const row of rows) {
    if (row.kind !== ADVANCED_LINUX_FACILITY_PROBE_KIND) {
      failures.push(`${row.facility} row has wrong kind`);
    }
    if (!row.sourceArch || !row.targetArch || !row.kernelVersion) {
      failures.push(`${row.facility} row is missing architecture or kernel version`);
    }
    if (!row.verifierOutput) {
      failures.push(`${row.facility} row is missing verifier output`);
    }
    if (row.classification === "refused") {
      if (row.migrationCompleted || !row.refusalCode || !row.remediation) {
        failures.push(`${row.facility} refusal missing migration=false, code, or remediation`);
      }
    }
    if (row.classification !== "product-supported" && row.scope.productSupportClaimed) {
      failures.push(`${row.facility} row claims product support with non-product classification`);
    }
    if (row.scope.crossIsaKernelStateReplayClaimed) {
      failures.push(`${row.facility} row claims cross-ISA kernel-state replay`);
    }
  }
  return failures;
}
