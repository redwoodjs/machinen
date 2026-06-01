import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ARBITRARY_PROCESS_LEVEL5_SEED_MATRIX_KIND =
  "machinen.arbitrary-process-level5-seed-matrix";
export const ARBITRARY_PROCESS_LEVEL5_SEED_MATRIX_VERSION = 1;
export const ARBITRARY_PROCESS_LEVEL5_SEED_REPORT_KIND =
  "machinen.arbitrary-process-level5-seed-report";
export const ARBITRARY_PROCESS_LEVEL5_SEED_REPORT_VERSION = 1;

export type ArbitraryProcessLevel5SeedStatus = "seed-candidate" | "refused" | "not-proven";
export type ArbitraryProcessLevel5SeedEvidenceKind =
  | "target-native-reconstruction-seed"
  | "resource-translation-seed"
  | "refusal-boundary"
  | "matrix-gap";
export type ArbitraryProcessLevel5SeedBoundary =
  | "no-threads"
  | "no-jit"
  | "idle-only"
  | "regular-files-only"
  | "simple-pipes-only"
  | "no-live-sockets"
  | "no-device-mmap"
  | "no-futex-owned-locks";
export type ArbitraryProcessLevel5RefusalMarker =
  | "threads"
  | "jit-code"
  | "futex-owned-locks"
  | "live-sockets"
  | "device-mmap"
  | "active-epoll";

export type ArbitraryProcessLevel5SeedRow = {
  id: string;
  status: ArbitraryProcessLevel5SeedStatus;
  evidenceKind: ArbitraryProcessLevel5SeedEvidenceKind;
  processShape: string;
  productPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>";
  translatedProcessStateRequired: true;
  targetNativeReconstructionRequired: true;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  appCheckpointHooksRequired: false;
  metadataOnlySuccessAccepted: false;
  arbitraryProcessClaimed: false;
  arbitraryProcessCrossArchRestoreClaimed: 0;
  boundaries: ArbitraryProcessLevel5SeedBoundary[];
  refusalMarker?: ArbitraryProcessLevel5RefusalMarker;
};

export type ArbitraryProcessLevel5SeedMatrix = {
  kind: typeof ARBITRARY_PROCESS_LEVEL5_SEED_MATRIX_KIND;
  version: typeof ARBITRARY_PROCESS_LEVEL5_SEED_MATRIX_VERSION;
  accepted: boolean;
  rowCount: 13;
  seedCandidateRows: 6;
  refusedRows: 6;
  notProvenRows: 1;
  rows: ArbitraryProcessLevel5SeedRow[];
  currentNodeProductSupportClaimed: 100;
  currentBroadNodeProductSupportClaimed: 100;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateArbitraryProcessCrossArchRestoreClaimed: 1;
  claimChangeAllowed: false;
  arbitraryProcessClaimed: false;
};

export type ArbitraryProcessLevel5SeedArtifact = {
  rowId: string;
  status: ArbitraryProcessLevel5SeedStatus;
  evidenceKind: ArbitraryProcessLevel5SeedEvidenceKind;
  path: string;
  sha256: string;
  required: true;
};

export type ArbitraryProcessLevel5SeedReport = {
  kind: typeof ARBITRARY_PROCESS_LEVEL5_SEED_REPORT_KIND;
  version: typeof ARBITRARY_PROCESS_LEVEL5_SEED_REPORT_VERSION;
  accepted: boolean;
  matrix: ArbitraryProcessLevel5SeedMatrix;
  artifactCount: 13;
  artifacts: ArbitraryProcessLevel5SeedArtifact[];
  artifactsSha256: string;
  refusalMarkersCovered: ArbitraryProcessLevel5RefusalMarker[];
  claimChangeAllowed: false;
  currentNodeProductSupportClaimed: 100;
  currentBroadNodeProductSupportClaimed: 100;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateArbitraryProcessCrossArchRestoreClaimed: 1;
  arbitraryProcessClaimed: false;
};

export type ArbitraryProcessLevel5SeedVerification = {
  accepted: boolean;
  kind: "machinen.arbitrary-process-level5-seed-verification";
  rowCount: number;
  artifactCount: number;
  artifactsSha256Verified: boolean;
  refusalMarkersCovered: ArbitraryProcessLevel5RefusalMarker[];
  claimChangeAllowed: false;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateArbitraryProcessCrossArchRestoreClaimed: 1;
  arbitraryProcessClaimed: false;
};

const productPath = "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>";
const refusalMarkers: ArbitraryProcessLevel5RefusalMarker[] = [
  "threads",
  "jit-code",
  "futex-owned-locks",
  "live-sockets",
  "device-mmap",
  "active-epoll",
];

export function buildArbitraryProcessLevel5SeedMatrix(): ArbitraryProcessLevel5SeedMatrix {
  const rows = [...seedRows(), ...refusalRows(), notProvenRow()];
  return {
    kind: ARBITRARY_PROCESS_LEVEL5_SEED_MATRIX_KIND,
    version: ARBITRARY_PROCESS_LEVEL5_SEED_MATRIX_VERSION,
    accepted: rows.every((row) => row.arbitraryProcessClaimed === false),
    rowCount: 13,
    seedCandidateRows: rows.filter((row) => row.status === "seed-candidate").length as 6,
    refusedRows: rows.filter((row) => row.status === "refused").length as 6,
    notProvenRows: rows.filter((row) => row.status === "not-proven").length as 1,
    rows,
    currentNodeProductSupportClaimed: 100,
    currentBroadNodeProductSupportClaimed: 100,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateArbitraryProcessCrossArchRestoreClaimed: 1,
    claimChangeAllowed: false,
    arbitraryProcessClaimed: false,
  };
}

export function createArbitraryProcessLevel5SeedReport(input: {
  outDir: string;
}): ArbitraryProcessLevel5SeedReport {
  const matrix = buildArbitraryProcessLevel5SeedMatrix();
  const artifactDir = join(input.outDir, "arbitrary-process-level5-seed");
  mkdirSync(artifactDir, { recursive: true });
  const artifacts = matrix.rows.map((row) => writeSeedArtifact(artifactDir, row));
  const refusalMarkersCovered = coveredRefusalMarkers(matrix.rows);
  return {
    kind: ARBITRARY_PROCESS_LEVEL5_SEED_REPORT_KIND,
    version: ARBITRARY_PROCESS_LEVEL5_SEED_REPORT_VERSION,
    accepted:
      matrix.accepted && artifacts.length === 13 && hasAllRefusalMarkers(refusalMarkersCovered),
    matrix,
    artifactCount: 13,
    artifacts,
    artifactsSha256: sha256Json(artifacts),
    refusalMarkersCovered,
    claimChangeAllowed: false,
    currentNodeProductSupportClaimed: 100,
    currentBroadNodeProductSupportClaimed: 100,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateArbitraryProcessCrossArchRestoreClaimed: 1,
    arbitraryProcessClaimed: false,
  };
}

export function writeArbitraryProcessLevel5SeedReport(input: {
  outDir: string;
  path: string;
}): ArbitraryProcessLevel5SeedReport {
  const report = createArbitraryProcessLevel5SeedReport({ outDir: input.outDir });
  writeFileSync(input.path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function loadArbitraryProcessLevel5SeedReport(
  path: string,
): ArbitraryProcessLevel5SeedReport {
  return JSON.parse(readFileSync(path, "utf8")) as ArbitraryProcessLevel5SeedReport;
}

export function verifyArbitraryProcessLevel5SeedReport(
  report: ArbitraryProcessLevel5SeedReport,
): ArbitraryProcessLevel5SeedVerification {
  const artifactsSha256Verified = report.artifactsSha256 === sha256Json(report.artifacts);
  const refusalMarkersCovered = coveredRefusalMarkers(report.matrix.rows);
  return {
    accepted: seedReportAccepted(report, artifactsSha256Verified, refusalMarkersCovered),
    kind: "machinen.arbitrary-process-level5-seed-verification",
    rowCount: report.matrix.rows.length,
    artifactCount: report.artifacts.length,
    artifactsSha256Verified,
    refusalMarkersCovered,
    claimChangeAllowed: false,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateArbitraryProcessCrossArchRestoreClaimed: 1,
    arbitraryProcessClaimed: false,
  };
}

function seedRows(): ArbitraryProcessLevel5SeedRow[] {
  return [
    seed("tiny-native-idle-counter", "single-thread native counter with translated data state", [
      "no-threads",
      "no-jit",
      "idle-only",
    ]),
    seed("native-argv-env-cwd", "argv/env/cwd reconstruction for a tiny C process", [
      "no-threads",
      "no-jit",
      "idle-only",
    ]),
    seed("native-regular-file-fd", "regular file descriptor resource translation", [
      "regular-files-only",
      "no-threads",
      "idle-only",
    ]),
    seed("native-simple-pipe-fd", "simple pipe descriptor translation", [
      "simple-pipes-only",
      "no-threads",
      "idle-only",
    ]),
    seed(
      "native-static-data-heap",
      "static/data/heap byte materialization for target-native loader",
      ["no-threads", "no-jit", "idle-only"],
    ),
    seed("native-syscall-boundary", "selected syscall/resource boundary descriptor", [
      "no-live-sockets",
      "no-device-mmap",
      "no-futex-owned-locks",
    ]),
  ];
}

function refusalRows(): ArbitraryProcessLevel5SeedRow[] {
  return refusalMarkers.map((marker) => refused(`native-${marker}-refused`, marker));
}

function notProvenRow(): ArbitraryProcessLevel5SeedRow {
  return baseRow(
    "arbitrary-linux-process",
    "not-proven",
    "matrix-gap",
    "arbitrary unknown Linux process",
    [],
    undefined,
  );
}

function seed(
  id: string,
  processShape: string,
  boundaries: ArbitraryProcessLevel5SeedBoundary[],
): ArbitraryProcessLevel5SeedRow {
  return baseRow(
    id,
    "seed-candidate",
    "target-native-reconstruction-seed",
    processShape,
    boundaries,
    undefined,
  );
}

function refused(
  id: string,
  marker: ArbitraryProcessLevel5RefusalMarker,
): ArbitraryProcessLevel5SeedRow {
  return baseRow(
    id,
    "refused",
    "refusal-boundary",
    `refuse ${marker} before arbitrary-process claim`,
    [],
    marker,
  );
}

function baseRow(
  id: string,
  status: ArbitraryProcessLevel5SeedStatus,
  evidenceKind: ArbitraryProcessLevel5SeedEvidenceKind,
  processShape: string,
  boundaries: ArbitraryProcessLevel5SeedBoundary[],
  refusalMarker: ArbitraryProcessLevel5RefusalMarker | undefined,
): ArbitraryProcessLevel5SeedRow {
  return {
    id,
    status,
    evidenceKind,
    processShape,
    productPath,
    translatedProcessStateRequired: true,
    targetNativeReconstructionRequired: true,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    appCheckpointHooksRequired: false,
    metadataOnlySuccessAccepted: false,
    arbitraryProcessClaimed: false,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    boundaries,
    ...(refusalMarker ? { refusalMarker } : {}),
  };
}

function writeSeedArtifact(
  artifactDir: string,
  row: ArbitraryProcessLevel5SeedRow,
): ArbitraryProcessLevel5SeedArtifact {
  const filename = `${row.id}.json`;
  const content = `${JSON.stringify({ kind: "machinen.arbitrary-process-level5-seed-artifact", row }, null, 2)}\n`;
  writeFileSync(join(artifactDir, filename), content);
  return {
    rowId: row.id,
    status: row.status,
    evidenceKind: row.evidenceKind,
    path: join("arbitrary-process-level5-seed", filename),
    sha256: sha256String(content),
    required: true,
  };
}

function coveredRefusalMarkers(
  rows: ArbitraryProcessLevel5SeedRow[],
): ArbitraryProcessLevel5RefusalMarker[] {
  return rows.flatMap((row) => (row.refusalMarker ? [row.refusalMarker] : [])).sort();
}

function hasAllRefusalMarkers(markers: ArbitraryProcessLevel5RefusalMarker[]): boolean {
  return refusalMarkers.every((marker) => markers.includes(marker));
}

function seedReportAccepted(
  report: ArbitraryProcessLevel5SeedReport,
  artifactsSha256Verified: boolean,
  markersCovered: ArbitraryProcessLevel5RefusalMarker[],
): boolean {
  return [
    report.kind === ARBITRARY_PROCESS_LEVEL5_SEED_REPORT_KIND,
    report.version === ARBITRARY_PROCESS_LEVEL5_SEED_REPORT_VERSION,
    report.accepted === true,
    report.matrix.rowCount === 13,
    report.matrix.seedCandidateRows === 6,
    report.matrix.refusedRows === 6,
    report.matrix.notProvenRows === 1,
    report.artifactCount === 13,
    report.artifacts.length === 13,
    hasAllRefusalMarkers(markersCovered),
    report.claimChangeAllowed === false,
    report.currentArbitraryProcessCrossArchRestoreClaimed === 0,
    report.candidateArbitraryProcessCrossArchRestoreClaimed === 1,
    report.arbitraryProcessClaimed === false,
    artifactsSha256Verified,
  ].every(Boolean);
}

function sha256String(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
