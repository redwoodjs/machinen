import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_KIND =
  "machinen.architecture-portable-snapshot.controlled-continuation" as const;

export const ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_FORMAT_VERSION = 1 as const;

export const ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_BUNDLE_FILES = [
  "manifest.json",
  "state.json",
  "refusals.json",
  "target.env",
] as const;

export const controlledContinuationUnsupportedStateCategories = [
  "file",
  "socket",
  "thread",
  "signal",
  "timer",
  "dynamic-library",
  "runtime-private",
] as const;

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
  category: (typeof controlledContinuationUnsupportedStateCategories)[number];
  decision: "refused";
  reason: string;
  refusalCode: "unsupported-state";
  remediation: string;
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
  targetExecution: "native" | "emulated" | "not-applicable";
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
    state: sha256Text(jsonText(state)),
    refusals: sha256Text(jsonText(unsupportedStates)),
    targetEnv: sha256Text(targetEnvFromValues(input, state)),
    targetArtifactProvenance: stableControlledContinuationDigest(input.targetBinaryProvenance),
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
  for (const file of ARCHITECTURE_PORTABLE_CONTROLLED_CONTINUATION_BUNDLE_FILES) {
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
  failures.push(...validateBundleFileDigests(dir, bundle));
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
  if (!hasRequiredTargetArtifactProvenance(manifest.targetArtifact.provenance)) {
    failures.push("manifest target artifact provenance is incomplete");
  }
  const missingCategories = controlledContinuationUnsupportedStateCategories.filter(
    (category) => !unsupportedStates.some((item) => item.category === category),
  );
  for (const category of missingCategories) {
    failures.push(`unsupported state inventory missing ${category}`);
  }
  if (unsupportedStates.length === 0) {
    failures.push("unsupported state refusal inventory is empty");
  }
  for (const item of unsupportedStates) {
    if (item.decision !== "refused" || !item.reason) {
      failures.push(`unsupported state ${item.category} is missing refusal reason`);
    }
    if (item.refusalCode !== "unsupported-state" || !item.remediation) {
      failures.push(`unsupported state ${item.category} is missing refusal code or remediation`);
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
  if (row.migrationCompleted) {
    if (row.sourceArch === row.targetArch) {
      failures.push("completed controlled continuation must be opposite-ISA");
    }
    if (row.targetExecution !== "native") {
      failures.push("completed controlled continuation must be target-native");
    }
    if (!row.verifierOutput.includes("target-native-continuation-ok")) {
      failures.push("completed controlled continuation lacks target verifier marker");
    }
    failures.push(...validateCompletedVerifierOutput(row));
    failures.push(...validateCompletedArtifactDigests(row));
    if (row.provenance.mode !== "live") {
      failures.push("completed controlled continuation must come from a live target proof");
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
    unsupportedState(
      "file",
      "no open file descriptor state is modeled",
      "Close or model file descriptor state before continuation.",
    ),
    unsupportedState(
      "socket",
      "active sockets are outside the controlled C profile",
      "Drain, reconnect, or explicitly model sockets before continuation.",
    ),
    unsupportedState(
      "thread",
      "only a single controlled thread is accepted",
      "Reach a single-threaded safe point or add thread-state modeling.",
    ),
    unsupportedState(
      "signal",
      "pending signal state is not modeled",
      "Drain or explicitly model pending signals before continuation.",
    ),
    unsupportedState(
      "timer",
      "timerfd/deadline state is not modeled",
      "Cancel, recreate, or explicitly model timer state before continuation.",
    ),
    unsupportedState(
      "dynamic-library",
      "target artifact must be provenance-checked",
      "Use a fully provenance-checked target artifact or model dynamic library state.",
    ),
    unsupportedState(
      "runtime-private",
      "no runtime-private state is accepted",
      "Use a runtime adapter that exposes portable state at a safe point.",
    ),
  ];
}

function validateBundleFileDigests(
  dir: string,
  bundle: ArchitecturePortableControlledContinuationBundle,
): string[] {
  const expected = bundle.manifest.artifactDigests;
  const checks = [
    ["state", join(dir, "state.json")],
    ["refusals", join(dir, "refusals.json")],
    ["targetEnv", join(dir, "target.env")],
  ] as const;
  const failures: string[] = [];
  for (const [name, path] of checks) {
    if (!expected[name]) {
      failures.push(`manifest artifactDigests missing ${name}`);
    } else if (sha256File(path) !== expected[name]) {
      failures.push(`${name} digest mismatch`);
    }
  }
  if (
    expected.targetArtifactProvenance !==
    stableControlledContinuationDigest(bundle.manifest.targetArtifact.provenance)
  ) {
    failures.push("target artifact provenance digest mismatch");
  }
  return failures;
}

function hasRequiredTargetArtifactProvenance(provenance: Record<string, unknown>): boolean {
  return ["compiler", "target", "sourceSha256", "targetBinaryBytes"].every((field) =>
    Boolean(provenance[field]),
  );
}

function validateCompletedVerifierOutput(
  row: ArchitecturePortableControlledContinuationRow,
): string[] {
  const parsed = parseVerifierOutput(row.verifierOutput);
  const failures: string[] = [];
  if (parsed.sourceArch !== row.sourceArch) {
    failures.push("completed controlled continuation verifier sourceArch mismatch");
  }
  if (parsed.targetArch !== row.targetArch) {
    failures.push("completed controlled continuation verifier targetArch mismatch");
  }
  if (parsed.capturedCounter === undefined || parsed.restoredCounter === undefined) {
    failures.push("completed controlled continuation lacks captured/restored counter evidence");
  } else if (parsed.restoredCounter !== parsed.capturedCounter + 1) {
    failures.push("completed controlled continuation did not advance from captured state");
  }
  return failures;
}

function validateCompletedArtifactDigests(
  row: ArchitecturePortableControlledContinuationRow,
): string[] {
  const required = ["manifest", "state", "refusals", "targetEnv", "targetBinary"];
  return required
    .filter((name) => !row.artifactDigests[name])
    .map((name) => `completed controlled continuation missing ${name} digest`);
}

function parseVerifierOutput(output: string): {
  sourceArch?: string;
  targetArch?: string;
  capturedCounter?: number;
  restoredCounter?: number;
} {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const [key, ...rest] = line.split("=");
    if (rest.length > 0) {
      values.set(key, rest.join("="));
    }
  }
  return {
    sourceArch: values.get("sourceArch"),
    targetArch: values.get("targetArch"),
    capturedCounter: numberFrom(values.get("capturedCounter")),
    restoredCounter: numberFrom(values.get("restoredCounter")),
  };
}

function numberFrom(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function unsupportedState(
  category: ArchitecturePortableControlledContinuationUnsupportedState["category"],
  reason: string,
  remediation: string,
): ArchitecturePortableControlledContinuationUnsupportedState {
  return { category, decision: "refused", reason, refusalCode: "unsupported-state", remediation };
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
  writeFileSync(path, jsonText(value), { mode: 0o644 });
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function targetEnv(bundle: ArchitecturePortableControlledContinuationBundle): string {
  const manifest = bundle.manifest;
  const state = bundle.state;
  return targetEnvFromValues(
    {
      sourceArch: manifest.sourceArch,
      targetArch: manifest.targetArch,
      continuationLabel: state.continuationLabel,
      targetBinaryRelativePath: manifest.targetArtifact.relativePath,
      targetBinarySha256: manifest.targetArtifact.sha256,
      targetBinaryProvenance: manifest.targetArtifact.provenance,
    },
    state,
  );
}

function targetEnvFromValues(
  input: Pick<
    ArchitecturePortableControlledContinuationBundleInput,
    | "sourceArch"
    | "targetArch"
    | "continuationLabel"
    | "targetBinaryRelativePath"
    | "targetBinarySha256"
    | "targetBinaryProvenance"
  >,
  state: ArchitecturePortableControlledContinuationState,
): string {
  return [
    `SOURCE_ARCH=${shellQuote(input.sourceArch)}`,
    `TARGET_ARCH=${shellQuote(input.targetArch)}`,
    `CAPTURED_COUNTER=${shellQuote(String(state.capturedCounter))}`,
    `NEXT_COUNTER=${shellQuote(String(state.nextCounter))}`,
    `CONTINUATION_LABEL=${shellQuote(state.continuationLabel)}`,
    `TARGET_BINARY_REL=${shellQuote(input.targetBinaryRelativePath)}`,
    `TARGET_BINARY_SHA256=${shellQuote(input.targetBinarySha256)}`,
    `TARGET_ARTIFACT_PROVENANCE_SHA256=${shellQuote(stableControlledContinuationDigest(input.targetBinaryProvenance))}`,
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
