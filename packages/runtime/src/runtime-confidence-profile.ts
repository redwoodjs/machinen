import { createHash } from "node:crypto";

export const RUNTIME_CONFIDENCE_PROFILE_KIND =
  "machinen.cross-arch-criu.runtime-confidence-profile" as const;

export const runtimeConfidenceClassifications = [
  "product-supported",
  "proof-only-feasibility",
  "stretch-demo",
  "refused",
] as const;

export const runtimeConfidenceRefusalCodes = [
  "active-sockets-unsupported",
  "native-library-ambiguity",
  "unmodeled-signal-or-timer-state",
  "jvm-private-jit-state-unsupported",
  "unsupported-process-topology",
  "source-target-abi-mismatch",
  "missing-target-runtime-or-dynamic-library-provenance",
  "target-verifier-missing-or-ambiguous",
] as const;

export type RuntimeConfidenceRuntime = "c" | "java";
export type RuntimeConfidenceClassification = (typeof runtimeConfidenceClassifications)[number];
export type RuntimeConfidenceRefusalCode = (typeof runtimeConfidenceRefusalCodes)[number];
export type RuntimeConfidenceStateModel =
  | "preserved"
  | "recreated"
  | "drained"
  | "dropped-irrelevant"
  | "logically-restored"
  | "refused";
export type RuntimeConfidenceArch = "arm64" | "amd64";

export interface RuntimeConfidenceProfileInput {
  runtime: RuntimeConfidenceRuntime;
  profile: string;
  classification: RuntimeConfidenceClassification;
  sourceArch: RuntimeConfidenceArch;
  targetArch: RuntimeConfidenceArch;
  stateModel: RuntimeConfidenceStateModel;
  artifactDigests: Record<string, string>;
  runtimeVersion: string;
  verifierOutput: string;
  migrationCompleted?: boolean;
  refusalCode?: RuntimeConfidenceRefusalCode;
  remediation?: string;
  evidence?: Record<string, unknown>;
}

export interface RuntimeConfidenceProfileRow extends RuntimeConfidenceProfileInput {
  kind: typeof RUNTIME_CONFIDENCE_PROFILE_KIND;
  migrationCompleted: boolean;
  scope: {
    targetNativeVerifierRequired: true;
    crossIsaRegisterReplayClaimed: false;
    productSupportClaimed: boolean;
  };
}

export interface RuntimeConfidenceProfileSummary {
  kind: "machinen.cross-arch-criu.runtime-confidence-profile-matrix";
  state: "completed" | "failed";
  pass: boolean;
  rows: RuntimeConfidenceProfileRow[];
  rowCount: number;
  byRuntime: Record<RuntimeConfidenceRuntime, number>;
  byClassification: Record<RuntimeConfidenceClassification, number>;
  failures: string[];
}

export function buildRuntimeConfidenceProfileRow(
  input: RuntimeConfidenceProfileInput,
): RuntimeConfidenceProfileRow {
  const refused = input.classification === "refused" || input.stateModel === "refused";
  return {
    ...input,
    kind: RUNTIME_CONFIDENCE_PROFILE_KIND,
    migrationCompleted: refused ? false : input.migrationCompleted === true,
    scope: {
      targetNativeVerifierRequired: true,
      crossIsaRegisterReplayClaimed: false,
      productSupportClaimed: input.classification === "product-supported",
    },
  };
}

export function buildRuntimeConfidenceProfileMatrix(): RuntimeConfidenceProfileSummary {
  return summarizeRuntimeConfidenceProfiles(runtimeConfidenceProfileFixtures());
}

export function summarizeRuntimeConfidenceProfiles(
  rows: RuntimeConfidenceProfileRow[],
): RuntimeConfidenceProfileSummary {
  const failures = validateRuntimeConfidenceProfiles(rows);
  return {
    kind: "machinen.cross-arch-criu.runtime-confidence-profile-matrix",
    state: failures.length === 0 ? "completed" : "failed",
    pass: failures.length === 0,
    rows,
    rowCount: rows.length,
    byRuntime: {
      c: rows.filter((row) => row.runtime === "c").length,
      java: rows.filter((row) => row.runtime === "java").length,
    },
    byClassification: Object.fromEntries(
      runtimeConfidenceClassifications.map((classification) => [
        classification,
        rows.filter((row) => row.classification === classification).length,
      ]),
    ) as Record<RuntimeConfidenceClassification, number>,
    failures,
  };
}

// fallow-ignore-next-line complexity
export function validateRuntimeConfidenceProfiles(rows: RuntimeConfidenceProfileRow[]): string[] {
  const failures: string[] = [];
  const requiredProfiles = [
    "c-static-binary",
    "c-dynamic-binary",
    "c-file-io",
    "c-timer",
    "c-signal",
    "c-tcp-listener",
    "java-loop-service",
  ];
  for (const profile of requiredProfiles) {
    if (!rows.some((row) => row.profile === profile)) {
      failures.push(`missing required profile ${profile}`);
    }
  }
  for (const row of rows) {
    if (row.kind !== RUNTIME_CONFIDENCE_PROFILE_KIND) {
      failures.push(`${row.profile} has wrong kind`);
    }
    if (!row.sourceArch || !row.targetArch || !row.stateModel) {
      failures.push(`${row.profile} is missing architecture or state model`);
    }
    if (Object.keys(row.artifactDigests).length === 0) {
      failures.push(`${row.profile} has no artifact digests`);
    }
    if (!row.runtimeVersion || !row.verifierOutput) {
      failures.push(`${row.profile} is missing runtime version or verifier output`);
    }
    if (row.classification === "refused") {
      if (row.migrationCompleted || !row.refusalCode || !row.remediation) {
        failures.push(`${row.profile} refusal missing migration=false, code, or remediation`);
      }
    }
    if (row.classification !== "product-supported" && row.scope.productSupportClaimed) {
      failures.push(`${row.profile} claims product support with non-product classification`);
    }
    if (row.scope.crossIsaRegisterReplayClaimed) {
      failures.push(`${row.profile} incorrectly claims cross-ISA register replay`);
    }
  }
  return failures;
}

export function runtimeConfidenceProfileFixtures(): RuntimeConfidenceProfileRow[] {
  const routes: Array<[RuntimeConfidenceArch, RuntimeConfidenceArch]> = [
    ["arm64", "amd64"],
    ["amd64", "arm64"],
  ];
  return routes.flatMap(([sourceArch, targetArch]) => [
    cStatic(sourceArch, targetArch),
    cDynamic(sourceArch, targetArch),
    cFileIo(sourceArch, targetArch),
    cTimer(sourceArch, targetArch),
    cSignal(sourceArch, targetArch),
    cTcpListener(sourceArch, targetArch),
    javaLoopService(sourceArch, targetArch),
  ]);
}

function cStatic(sourceArch: RuntimeConfidenceArch, targetArch: RuntimeConfidenceArch) {
  return buildRuntimeConfidenceProfileRow({
    runtime: "c",
    profile: "c-static-binary",
    classification: "proof-only-feasibility",
    sourceArch,
    targetArch,
    stateModel: "recreated",
    artifactDigests: fixtureDigests("c-static-binary-v1"),
    runtimeVersion: "C ABI fixture; static ELF target-native rebuild required",
    verifierOutput:
      "target-native static C verifier: argv/env and integer counter match fixture expectation",
    migrationCompleted: false,
    evidence: { stateDisposition: "recreated", targetNativeRebuildRequired: true },
  });
}

function cDynamic(sourceArch: RuntimeConfidenceArch, targetArch: RuntimeConfidenceArch) {
  return buildRuntimeConfidenceProfileRow({
    runtime: "c",
    profile: "c-dynamic-binary",
    classification: "refused",
    sourceArch,
    targetArch,
    stateModel: "refused",
    artifactDigests: fixtureDigests("c-dynamic-binary-v1"),
    runtimeVersion: "glibc dynamic ELF fixture; target libc/ld provenance unavailable",
    verifierOutput: "refused before target execution: dynamic library provenance missing",
    refusalCode: "missing-target-runtime-or-dynamic-library-provenance",
    remediation:
      "Record target dynamic loader, libc, shared-object digests, and ABI policy before accepting dynamic C restore.",
    evidence: { stateDisposition: "refused", requiredLibraries: ["ld-linux", "libc.so"] },
  });
}

function cFileIo(sourceArch: RuntimeConfidenceArch, targetArch: RuntimeConfidenceArch) {
  return buildRuntimeConfidenceProfileRow({
    runtime: "c",
    profile: "c-file-io",
    classification: "proof-only-feasibility",
    sourceArch,
    targetArch,
    stateModel: "logically-restored",
    artifactDigests: fixtureDigests("c-file-io-v1"),
    runtimeVersion: "C file-IO fixture; POSIX regular file content digest contract",
    verifierOutput: "target-native file verifier: file digest and append cursor contract match",
    migrationCompleted: false,
    evidence: { stateDisposition: "logically-restored", fileDigestRequired: true },
  });
}

function cTimer(sourceArch: RuntimeConfidenceArch, targetArch: RuntimeConfidenceArch) {
  return buildRuntimeConfidenceProfileRow({
    runtime: "c",
    profile: "c-timer",
    classification: "refused",
    sourceArch,
    targetArch,
    stateModel: "refused",
    artifactDigests: fixtureDigests("c-timer-v1"),
    runtimeVersion: "C timerfd/interval timer fixture",
    verifierOutput: "refused: remaining timer deadline and signal delivery order are not modeled",
    refusalCode: "unmodeled-signal-or-timer-state",
    remediation:
      "Drain timers or add an explicit target deadline/clock descriptor before accepting timer restore.",
    evidence: { stateDisposition: "refused", unsafeState: "active timer" },
  });
}

function cSignal(sourceArch: RuntimeConfidenceArch, targetArch: RuntimeConfidenceArch) {
  return buildRuntimeConfidenceProfileRow({
    runtime: "c",
    profile: "c-signal",
    classification: "refused",
    sourceArch,
    targetArch,
    stateModel: "refused",
    artifactDigests: fixtureDigests("c-signal-v1"),
    runtimeVersion: "C signal handler/pending signal fixture",
    verifierOutput: "refused: pending signal mask/frame/handler edge state is not modeled",
    refusalCode: "unmodeled-signal-or-timer-state",
    remediation:
      "Drain pending signals and model signal mask/handler state before accepting signal restore.",
    evidence: { stateDisposition: "refused", unsafeState: "pending signal" },
  });
}

function cTcpListener(sourceArch: RuntimeConfidenceArch, targetArch: RuntimeConfidenceArch) {
  return buildRuntimeConfidenceProfileRow({
    runtime: "c",
    profile: "c-tcp-listener",
    classification: "refused",
    sourceArch,
    targetArch,
    stateModel: "refused",
    artifactDigests: fixtureDigests("c-tcp-listener-v1"),
    runtimeVersion: "C TCP listener fixture",
    verifierOutput: "refused: active listener/socket identity is not a modeled portable resource",
    refusalCode: "active-sockets-unsupported",
    remediation:
      "Use a clean service restart contract with a new listener, or add a socket descriptor and target network policy.",
    evidence: { stateDisposition: "refused", unsafeState: "active TCP listener" },
  });
}

function javaLoopService(sourceArch: RuntimeConfidenceArch, targetArch: RuntimeConfidenceArch) {
  return buildRuntimeConfidenceProfileRow({
    runtime: "java",
    profile: "java-loop-service",
    classification: "refused",
    sourceArch,
    targetArch,
    stateModel: "refused",
    artifactDigests: {
      ...fixtureDigests("java-loop-service-v1"),
      classpath: sha256("LoopService.classpath:target-controlled-empty"),
    },
    runtimeVersion: "JVM unavailable in base guest; vendor/version not recorded",
    verifierOutput:
      "refused: command -v java produced no target runtime path; JVM-private/JIT/thread state not modeled",
    refusalCode: "missing-target-runtime-or-dynamic-library-provenance",
    remediation:
      "Install a controlled target JVM, record vendor/version/classpath/native libraries, and model JIT/thread state before accepting JVM restore.",
    evidence: {
      stateDisposition: "refused",
      classpathProvenance: "fixture source only; no target JVM runtime present",
      loadedNativeLibraries: ["not-inspected: target JVM unavailable"],
      unsupportedState: ["JVM-private state", "JIT/code cache", "runtime threads"],
    },
  });
}

function fixtureDigests(name: string): Record<string, string> {
  return {
    source: sha256(`${name}:source`),
    verifier: sha256(`${name}:target-native-verifier`),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
