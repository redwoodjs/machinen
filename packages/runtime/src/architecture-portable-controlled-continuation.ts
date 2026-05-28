import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_KIND =
  "machinen.architecture-portable-snapshot.controlled-continuation" as const;

export const ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_FORMAT_VERSION = 1 as const;

export const architecturePortableControlledContinuationClassifications = [
  "proof-only-feasibility",
  "refused",
  "skipped",
] as const;

export const architecturePortableControlledContinuationRefusalCodes = [
  "target-unavailable",
  "bundle-invalid",
  "target-arch-mismatch",
  "target-artifact-digest-mismatch",
  "target-verifier-failed",
  "sidecar-output-refused",
  "metadata-only-continuation-refused",
  "unsupported-state",
] as const;

export type ArchitecturePortableControlledContinuationClassification =
  (typeof architecturePortableControlledContinuationClassifications)[number];
export type ArchitecturePortableControlledContinuationRefusalCode =
  (typeof architecturePortableControlledContinuationRefusalCodes)[number];
export type ArchitecturePortableControlledContinuationArch = "arm64" | "amd64";

export interface ArchitecturePortableControlledContinuationUnsupportedState {
  category:
    | "file"
    | "socket"
    | "thread"
    | "signal"
    | "timer"
    | "dynamic-library"
    | "runtime-private";
  decision: "refused";
  reason: string;
}

export interface ArchitecturePortableControlledContinuationBundleInput {
  sourceArch: ArchitecturePortableControlledContinuationArch;
  targetArch: ArchitecturePortableControlledContinuationArch;
  capturedCounter: number;
  continuationLabel: string;
  sourceVerifierOutput: string;
  targetBinaryRelativePath: string;
  targetBinarySha256: string;
  targetBinaryProvenance: Record<string, unknown>;
  verifierCommand: string;
  unsupportedStates?: ArchitecturePortableControlledContinuationUnsupportedState[];
}

export interface ArchitecturePortableControlledContinuationManifest {
  kind: typeof ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_KIND;
  formatVersion: typeof ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_FORMAT_VERSION;
  stateModel: "translated-controlled-continuation";
  workloadProfile: "controlled-c-counter";
  sourceArch: ArchitecturePortableControlledContinuationArch;
  targetArch: ArchitecturePortableControlledContinuationArch;
  targetExecution: "native";
  continuation: {
    label: string;
    safePoint: "counter-after-observed-line";
    capturedCounter: number;
    nextCounter: number;
  };
  sourceCapture: {
    verifierOutput: string;
  };
  targetArtifact: {
    relativePath: string;
    sha256: string;
    provenance: Record<string, unknown>;
  };
  verifier: {
    command: string;
    expectedMarker: "target-native-continuation-ok";
  };
  shortcuts: {
    sourceIsaEmulationUsed: false;
    sourceTextReusedAsTargetCode: false;
    sidecarRuntimeUsed: false;
    metadataOnlyContinuation: false;
    rawCheckpointImageReplayUsed: false;
  };
  artifactDigests: Record<string, string>;
}

export interface ArchitecturePortableControlledContinuationState {
  continuationLabel: string;
  capturedCounter: number;
  nextCounter: number;
}

export interface ArchitecturePortableControlledContinuationBundle {
  manifest: ArchitecturePortableControlledContinuationManifest;
  state: ArchitecturePortableControlledContinuationState;
  unsupportedStates: ArchitecturePortableControlledContinuationUnsupportedState[];
}

export interface ArchitecturePortableControlledContinuationRowInput {
  classification: ArchitecturePortableControlledContinuationClassification;
  sourceArch: ArchitecturePortableControlledContinuationArch;
  targetArch: ArchitecturePortableControlledContinuationArch;
  hostArch: string;
  providerMode: string;
  targetExecution: "native" | "not-applicable";
  verifierCommand: string;
  verifierOutput: string;
  artifactDigests: Record<string, string>;
  provenance: Record<string, unknown>;
  migrationCompleted: boolean;
  refusalCode?: ArchitecturePortableControlledContinuationRefusalCode;
  remediation?: string;
}

export interface ArchitecturePortableControlledContinuationRow extends ArchitecturePortableControlledContinuationRowInput {
  kind: typeof ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_KIND;
  claimId: "controlled-c-translated-continuation";
  claimName: "controlled C translated continuation";
  stateModel: "translated-controlled-continuation";
  stateDecisions: [
    "architecture-portable-state-bundle",
    "target-native-artifact-verified",
    "source-isa-emulation-refused",
    "raw-checkpoint-replay-refused",
    "metadata-only-continuation-refused",
  ];
  scope: {
    arbitraryProcessRestoreClaimed: false;
    rawCheckpointReplayClaimed: false;
    sourceIsaEmulationUsed: false;
    sidecarRuntimeUsed: false;
    metadataOnlyContinuation: false;
  };
}

export interface ArchitecturePortableControlledContinuationSummary {
  kind: "machinen.architecture-portable-snapshot.controlled-continuation-summary";
  state: "completed" | "failed";
  pass: boolean;
  rows: ArchitecturePortableControlledContinuationRow[];
  rowCount: number;
  failures: string[];
}

export function buildArchitecturePortableControlledContinuationBundle(
  input: ArchitecturePortableControlledContinuationBundleInput,
): ArchitecturePortableControlledContinuationBundle {
  const state = {
    continuationLabel: input.continuationLabel,
    capturedCounter: input.capturedCounter,
    nextCounter: input.capturedCounter + 1,
  };
  const unsupportedStates =
    input.unsupportedStates ?? defaultControlledContinuationUnsupportedStates();
  const artifactDigests = {
    targetBinary: input.targetBinarySha256,
    state: stableControlledContinuationDigest(state),
    unsupportedStates: stableControlledContinuationDigest(unsupportedStates),
    sourceCapture: stableControlledContinuationDigest(input.sourceVerifierOutput),
  };
  return {
    manifest: {
      kind: ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_KIND,
      formatVersion: ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_FORMAT_VERSION,
      stateModel: "translated-controlled-continuation",
      workloadProfile: "controlled-c-counter",
      sourceArch: input.sourceArch,
      targetArch: input.targetArch,
      targetExecution: "native",
      continuation: {
        label: input.continuationLabel,
        safePoint: "counter-after-observed-line",
        capturedCounter: input.capturedCounter,
        nextCounter: input.capturedCounter + 1,
      },
      sourceCapture: { verifierOutput: input.sourceVerifierOutput },
      targetArtifact: {
        relativePath: input.targetBinaryRelativePath,
        sha256: input.targetBinarySha256,
        provenance: input.targetBinaryProvenance,
      },
      verifier: {
        command: input.verifierCommand,
        expectedMarker: "target-native-continuation-ok",
      },
      shortcuts: {
        sourceIsaEmulationUsed: false,
        sourceTextReusedAsTargetCode: false,
        sidecarRuntimeUsed: false,
        metadataOnlyContinuation: false,
        rawCheckpointImageReplayUsed: false,
      },
      artifactDigests,
    },
    state,
    unsupportedStates,
  };
}

export function writeArchitecturePortableControlledContinuationBundle(
  dir: string,
  bundle: ArchitecturePortableControlledContinuationBundle,
): void {
  writeJson(join(dir, "manifest.json"), bundle.manifest);
  writeJson(join(dir, "state.json"), bundle.state);
  writeJson(join(dir, "refusals.json"), bundle.unsupportedStates);
  writeFileSync(join(dir, "target.env"), targetEnv(bundle), { mode: 0o644 });
}

export function readArchitecturePortableControlledContinuationBundle(
  dir: string,
): ArchitecturePortableControlledContinuationBundle {
  return {
    manifest: JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")),
    state: JSON.parse(readFileSync(join(dir, "state.json"), "utf8")),
    unsupportedStates: JSON.parse(readFileSync(join(dir, "refusals.json"), "utf8")),
  };
}

export function validateArchitecturePortableControlledContinuationBundle(dir: string): string[] {
  const failures: string[] = [];
  for (const file of ["manifest.json", "state.json", "refusals.json", "target.env"]) {
    if (!existsSync(join(dir, file))) {
      failures.push(`missing bundle file ${file}`);
    }
  }
  if (failures.length > 0) {
    return failures;
  }
  let bundle: ArchitecturePortableControlledContinuationBundle;
  try {
    bundle = readArchitecturePortableControlledContinuationBundle(dir);
  } catch (err) {
    return [`bundle JSON could not be parsed: ${err instanceof Error ? err.message : String(err)}`];
  }
  failures.push(...validateArchitecturePortableControlledContinuationBundleShape(bundle));
  const targetPath = join(dir, bundle.manifest.targetArtifact.relativePath);
  if (!existsSync(targetPath)) {
    failures.push("target artifact is missing");
  } else if (sha256File(targetPath) !== bundle.manifest.targetArtifact.sha256) {
    failures.push("target artifact digest mismatch");
  }
  return failures;
}

// fallow-ignore-next-line complexity
export function validateArchitecturePortableControlledContinuationBundleShape(
  bundle: ArchitecturePortableControlledContinuationBundle,
): string[] {
  const failures: string[] = [];
  const { manifest, state, unsupportedStates } = bundle;
  if (manifest.kind !== ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_KIND) {
    failures.push("manifest has wrong kind");
  }
  if (manifest.formatVersion !== ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_FORMAT_VERSION) {
    failures.push("manifest has unsupported formatVersion");
  }
  if (manifest.sourceArch === manifest.targetArch) {
    failures.push("sourceArch and targetArch must differ");
  }
  if (manifest.stateModel !== "translated-controlled-continuation") {
    failures.push("manifest has wrong stateModel");
  }
  if (manifest.targetExecution !== "native") {
    failures.push("manifest targetExecution must be native");
  }
  if (manifest.continuation.capturedCounter + 1 !== manifest.continuation.nextCounter) {
    failures.push("continuation nextCounter must follow capturedCounter");
  }
  if (state.capturedCounter !== manifest.continuation.capturedCounter) {
    failures.push("state capturedCounter does not match manifest");
  }
  if (state.nextCounter !== manifest.continuation.nextCounter) {
    failures.push("state nextCounter does not match manifest");
  }
  if (state.continuationLabel !== manifest.continuation.label) {
    failures.push("state continuationLabel does not match manifest");
  }
  if (Object.values(manifest.shortcuts).some((value) => value !== false)) {
    failures.push("manifest has forbidden shortcut enabled");
  }
  if (!manifest.targetArtifact.relativePath || !manifest.targetArtifact.sha256) {
    failures.push("manifest target artifact is incomplete");
  }
  if (unsupportedStates.length === 0) {
    failures.push("unsupported state refusal inventory is empty");
  }
  for (const item of unsupportedStates) {
    if (item.decision !== "refused" || !item.reason) {
      failures.push(`unsupported state ${item.category} is missing refusal reason`);
    }
  }
  return failures;
}

export function buildArchitecturePortableControlledContinuationRow(
  input: ArchitecturePortableControlledContinuationRowInput,
): ArchitecturePortableControlledContinuationRow {
  return {
    ...input,
    kind: ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_KIND,
    claimId: "controlled-c-translated-continuation",
    claimName: "controlled C translated continuation",
    stateModel: "translated-controlled-continuation",
    stateDecisions: [
      "architecture-portable-state-bundle",
      "target-native-artifact-verified",
      "source-isa-emulation-refused",
      "raw-checkpoint-replay-refused",
      "metadata-only-continuation-refused",
    ],
    scope: {
      arbitraryProcessRestoreClaimed: false,
      rawCheckpointReplayClaimed: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      metadataOnlyContinuation: false,
    },
  };
}

export function summarizeArchitecturePortableControlledContinuationRows(
  rows: ArchitecturePortableControlledContinuationRow[],
): ArchitecturePortableControlledContinuationSummary {
  const failures = validateArchitecturePortableControlledContinuationRows(rows);
  return {
    kind: "machinen.architecture-portable-snapshot.controlled-continuation-summary",
    state: failures.length === 0 ? "completed" : "failed",
    pass: failures.length === 0,
    rows,
    rowCount: rows.length,
    failures,
  };
}

export function validateArchitecturePortableControlledContinuationRows(
  rows: ArchitecturePortableControlledContinuationRow[],
): string[] {
  const failures: string[] = [];
  if (rows.length === 0) {
    failures.push("missing controlled continuation row");
  }
  for (const row of rows) {
    failures.push(...validateArchitecturePortableControlledContinuationRow(row));
  }
  return failures;
}

// fallow-ignore-next-line complexity
export function validateArchitecturePortableControlledContinuationRow(
  row: ArchitecturePortableControlledContinuationRow,
): string[] {
  const failures: string[] = [];
  if (row.kind !== ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_KIND) {
    failures.push("controlled continuation row has wrong kind");
  }
  if (row.sourceArch === row.targetArch) {
    failures.push("controlled continuation row must be opposite-ISA");
  }
  if (row.classification === "proof-only-feasibility" && row.migrationCompleted) {
    if (row.targetExecution !== "native") {
      failures.push("completed controlled continuation must be target-native");
    }
    if (!row.verifierOutput.includes("target-native-continuation-ok")) {
      failures.push("completed controlled continuation lacks target verifier marker");
    }
  }
  if (
    (row.classification === "refused" || row.classification === "skipped") &&
    row.migrationCompleted
  ) {
    failures.push("refused/skipped controlled continuation cannot complete migration");
  }
  if ((row.classification === "refused" || row.classification === "skipped") && !row.refusalCode) {
    failures.push("refused/skipped controlled continuation missing refusalCode");
  }
  if ((row.classification === "refused" || row.classification === "skipped") && !row.remediation) {
    failures.push("refused/skipped controlled continuation missing remediation");
  }
  if (row.scope.arbitraryProcessRestoreClaimed || row.scope.rawCheckpointReplayClaimed) {
    failures.push("controlled continuation row overclaims restore scope");
  }
  if (
    row.scope.sourceIsaEmulationUsed ||
    row.scope.sidecarRuntimeUsed ||
    row.scope.metadataOnlyContinuation
  ) {
    failures.push("controlled continuation row used a forbidden shortcut");
  }
  return failures;
}

export function defaultControlledContinuationUnsupportedStates(): ArchitecturePortableControlledContinuationUnsupportedState[] {
  return [
    { category: "file", decision: "refused", reason: "no open file descriptor state is modeled" },
    {
      category: "socket",
      decision: "refused",
      reason: "active sockets are outside the controlled C profile",
    },
    {
      category: "thread",
      decision: "refused",
      reason: "only a single controlled thread is accepted",
    },
    { category: "signal", decision: "refused", reason: "pending signal state is not modeled" },
    { category: "timer", decision: "refused", reason: "timerfd/deadline state is not modeled" },
    {
      category: "dynamic-library",
      decision: "refused",
      reason: "target artifact must be provenance-checked",
    },
    {
      category: "runtime-private",
      decision: "refused",
      reason: "no runtime-private state is accepted",
    },
  ];
}

export function normalizeControlledContinuationArch(
  value: string,
): ArchitecturePortableControlledContinuationArch | "unknown" {
  const lower = value.toLowerCase();
  if (lower === "arm64" || lower === "aarch64") {
    return "arm64";
  }
  if (lower === "amd64" || lower === "x64" || lower === "x86_64") {
    return "amd64";
  }
  return "unknown";
}

export function oppositeControlledContinuationArch(
  sourceArch: ArchitecturePortableControlledContinuationArch,
): ArchitecturePortableControlledContinuationArch {
  return sourceArch === "arm64" ? "amd64" : "arm64";
}

export function stableControlledContinuationDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function sha256File(path: string): string {
  const file = readFileSync(path);
  return createHash("sha256").update(file).digest("hex");
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
}

function targetEnv(bundle: ArchitecturePortableControlledContinuationBundle): string {
  const manifest = bundle.manifest;
  const state = bundle.state;
  return [
    `SOURCE_ARCH=${shellQuote(manifest.sourceArch)}`,
    `TARGET_ARCH=${shellQuote(manifest.targetArch)}`,
    `CAPTURED_COUNTER=${shellQuote(String(state.capturedCounter))}`,
    `NEXT_COUNTER=${shellQuote(String(state.nextCounter))}`,
    `CONTINUATION_LABEL=${shellQuote(state.continuationLabel)}`,
    `TARGET_BINARY_REL=${shellQuote(manifest.targetArtifact.relativePath)}`,
    `TARGET_BINARY_SHA256=${shellQuote(manifest.targetArtifact.sha256)}`,
    "SOURCE_ISA_EMULATION_USED=0",
    "SIDECAR_RUNTIME_USED=0",
    "METADATA_ONLY_CONTINUATION=0",
    "RAW_CHECKPOINT_IMAGE_REPLAY_USED=0",
    "",
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function fileSize(path: string): number {
  return statSync(path).size;
}
