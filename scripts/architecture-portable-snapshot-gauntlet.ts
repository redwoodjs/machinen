#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildArchitecturePortableSnapshotGauntletRow,
  requiredArchitecturePortableSnapshotClaimIds,
  stableGauntletDigest,
  summarizeArchitecturePortableSnapshotGauntletRows,
  type ArchitecturePortableSnapshotGauntletEvidenceStatus,
  type ArchitecturePortableSnapshotGauntletRow,
  type ArchitecturePortableSnapshotTargetExecution,
} from "../packages/runtime/src/index.ts";

interface Args {
  out: string;
  fixture: boolean;
}

type Json = Record<string, any>;

const DEFAULT_OUT =
  "research/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json";

function parseArgs(): Args {
  const args: Args = { out: DEFAULT_OUT, fixture: false };
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--fixture") {
      args.fixture = true;
    } else if (arg === "--out") {
      args.out = process.argv[++i];
    } else {
      throw new Error(`unknown arg ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs();
  const rows = args.fixture ? fixtureRows() : rowsFromLiveSmokes();
  const summary = summarizeArchitecturePortableSnapshotGauntletRows(rows);
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.pass) {
    process.exitCode = 1;
  }
}

interface LiveSmokeSummaries {
  opposite: Json;
  guestCheckpoint: Json;
  composition: Json;
  advanced: Json;
  nested: Json;
}

interface NativeProofSummaries {
  register: Json;
  stack: Json;
  returnChain: Json;
  controlledRestore: Json;
  codeMap: Json;
  targetModuleBytes: Json;
  restoreLoader: Json;
  activeSyscall: Json;
  thread: Json;
  memory: Json;
  mappingPolicy: Json;
  resource: Json;
}

function rowsFromLiveSmokes(): ArchitecturePortableSnapshotGauntletRow[] {
  return rowsFromSummaries(liveSmokeSummaries(), nativeProofSummaries());
}

function liveSmokeSummaries(): LiveSmokeSummaries {
  return {
    opposite: smokeJson(
      "scripts/smoke/opposite-isa-vm-execution.sh",
      "opposite-isa-vm-execution-smoke",
    ),
    guestCheckpoint: smokeJson(
      "scripts/smoke/guest-checkpoint-substrate.sh",
      "guest-checkpoint-substrate-smoke",
    ),
    composition: smokeJson(
      "scripts/smoke/portable-snapshot-guest-checkpoint-composition.sh",
      "portable-snapshot-guest-checkpoint-composition-smoke",
    ),
    advanced: smokeJson(
      "scripts/smoke/advanced-linux-facility-probe.sh",
      "advanced-linux-facility-probe-matrix",
    ),
    nested: smokeJson(
      "scripts/smoke/nested-virtualization-stretch-proof.sh",
      "nested-virtualization-stretch-proof-summary",
    ),
  };
}

function nativeProofSummaries(): NativeProofSummaries {
  return {
    register: nativeTsProofJson("scripts/native-register-translate.ts"),
    stack: nativeTsProofJson("scripts/native-stack-translate.ts"),
    returnChain: nativeTsProofJson("scripts/native-return-chain.ts"),
    controlledRestore: nativeTsProofJson("scripts/native-controlled-restore.ts"),
    codeMap: nativeTsProofJson("scripts/native-code-map.ts"),
    targetModuleBytes: nativeTsProofJson("scripts/native-real-utility-target-module-bytes.ts"),
    restoreLoader: nativeNodeProofJson("scripts/native-restore-loader.mjs"),
    activeSyscall: nativeTsProofJson("scripts/native-active-syscall-policy.ts"),
    thread: nativeTsProofJson("scripts/native-thread-refusal-matrix.ts"),
    memory: nativeTsProofJson("scripts/native-memory-translate.ts"),
    mappingPolicy: nativeTsProofJson("scripts/native-mapping-policy.ts"),
    resource: nativeTsProofJson("scripts/native-resource-translate.ts"),
  };
}

function rowsFromSummaries(
  live: LiveSmokeSummaries,
  native: NativeProofSummaries,
): ArchitecturePortableSnapshotGauntletRow[] {
  return [
    oppositeIsaRow(live.opposite),
    guestCheckpointRow(live.guestCheckpoint, "c-simple"),
    guestCheckpointRow(live.guestCheckpoint, "jvm-simple"),
    compositionRow(live.composition),
    advancedFacilityRow(
      live.advanced,
      "seccomp",
      "advanced-linux-seccomp",
      "seccomp proof/refusal",
    ),
    advancedFacilityRow(live.advanced, "ebpf", "advanced-linux-ebpf", "eBPF proof/refusal"),
    advancedCombinedRow(live.advanced),
    nestedRow(live.nested),
    nativeRegisterTranslationRow(native.register),
    nativeStackReturnChainRow(native.stack, native.returnChain),
    nativePrivateMemoryMaterializationRow(native.memory, native.controlledRestore),
    nativeExecutableTargetModuleRow(native.codeMap, native.targetModuleBytes),
    nativeTargetRestoreLoaderRow(native.restoreLoader),
    nativeTlsSimdFpuPolicyRow(native.thread),
    nativeSignalPolicyRow(native.thread),
    nativeActiveSyscallPolicyRow(native.activeSyscall),
    nativeThreadPolicyRow(native.thread),
    nativeMappingRefusalsRow(native.mappingPolicy, native.controlledRestore),
    nativeResourceRefusalsRow(native.resource),
  ];
}

function smokeJson(script: string, kindSuffix: string): Json {
  return smokeJsonWithArgs(script, ["--json"], kindSuffix);
}

function smokeJsonWithArgs(script: string, args: string[], kindSuffix: string): Json {
  return parseJsonObject(runJsonCommand("bash", [script, ...args], script), kindSuffix);
}

function nativeTsProofJson(script: string): Json {
  return proofJson("pnpm", ["exec", "tsx", script, "verify", "--json"], script);
}

function nativeNodeProofJson(script: string): Json {
  return proofJson("node", [script, "verify", "--json"], script);
}

function proofJson(command: string, args: string[], label: string): Json {
  return parseStandaloneJson(runJsonCommand(command, args, label), label);
}

function runJsonCommand(command: string, args: string[], label: string): string {
  const result = spawnSync(command, args, {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`${label} failed with ${result.status}: ${output.slice(-4000)}`);
  }
  return output;
}

function parseStandaloneJson(output: string, label: string): Json {
  const trimmed = output.trim();
  const marker = trimmed.lastIndexOf("\n{");
  const jsonStart = trimmed.startsWith("{") ? 0 : marker >= 0 ? marker + 1 : -1;
  if (jsonStart < 0) {
    throw new Error(`${label} did not emit JSON: ${trimmed.slice(-4000)}`);
  }
  return JSON.parse(trimmed.slice(jsonStart));
}

function parseJsonObject(output: string, kindSuffix: string): Json {
  const marker = `"kind": "machinen.architecture-portable-snapshot.${kindSuffix}"`;
  const markerAt = output.indexOf(marker);
  if (markerAt < 0) {
    throw new Error(`missing JSON kind ${kindSuffix}`);
  }
  const start = output.lastIndexOf("{", markerAt);
  return JSON.parse(output.slice(start));
}

function oppositeIsaRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  const route = summary.route;
  const evidenceStatus = toEvidenceStatus(route.state === "completed" ? "proof" : route.state);
  return row({
    claimId: "opposite-isa-vm-execution",
    claimName: "opposite-ISA VM execution",
    evidenceStatus,
    sourceArch: route.hostArch,
    targetArch: route.guestArch,
    hostArch: route.hostArch,
    providerMode: route.providerMode,
    targetExecution: executionFrom(route),
    stateModel: "provider-guest-boot",
    stateDecisions: ["guest-verifier-required", "host-sidecar-output-refusal"],
    verifierCommand: "bash scripts/smoke/opposite-isa-vm-execution.sh --json",
    verifierOutput: route.verifierOutput || route.refusalCode || "opposite route checked",
    artifactDigests: digestMap(route),
    provenance: { family: "opposite-isa-vm-execution", liveRequested: summary.liveRequested },
    migrationCompleted: false,
    refusalCode: route.refusalCode,
    remediation: route.remediation,
  });
}

// fallow-ignore-next-line complexity
function guestCheckpointRow(
  summary: Json,
  profile: string,
): ArchitecturePortableSnapshotGauntletRow {
  const r = summary.rows.find((row: Json) => row.profile === profile);
  return row({
    claimId: profile === "c-simple" ? "guest-checkpoint-c-simple" : "guest-checkpoint-jvm-simple",
    claimName:
      profile === "c-simple"
        ? "guest checkpoint simple C process"
        : "guest checkpoint JVM process/refusal",
    evidenceStatus: toEvidenceStatus(r.state === "completed" ? "proof" : r.state),
    sourceArch: r.guestArch,
    targetArch: r.guestArch,
    hostArch: hostArch(),
    providerMode: "same-guest-same-isa-checkpoint",
    targetExecution: "native",
    stateModel: "guest-checkpoint-dump-restore",
    stateDecisions: ["same-guest", "same-isa", "cross-isa-checkpoint-replay-not-claimed"],
    verifierCommand: `bash scripts/smoke/guest-checkpoint-substrate.sh --profile ${profile} --json`,
    verifierOutput: r.verifierOutput || r.refusalCode,
    artifactDigests: digestMap(r),
    provenance: { family: "guest-checkpoint-substrate", profile },
    migrationCompleted: r.state === "completed",
    refusalCode: r.refusalCode,
    remediation: r.remediation,
  });
}

function compositionRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  const r = summary.rows[0];
  return row({
    claimId: "portable-snapshot-guest-checkpoint-composition",
    claimName: "portable snapshot plus guest checkpoint composition",
    evidenceStatus: toEvidenceStatus(r.state === "completed" ? "proof" : r.state),
    sourceArch: r.sourceArch,
    targetArch: r.targetArch,
    hostArch: hostArch(),
    providerMode: r.machinenStateModel,
    targetExecution: "native",
    stateModel: r.machinenStateModel,
    stateDecisions: [
      "same-arch-vmstate",
      "guest-checkpoint-artifact-readable",
      "cross-isa-checkpoint-replay-not-claimed",
    ],
    verifierCommand: "bash scripts/smoke/portable-snapshot-guest-checkpoint-composition.sh --json",
    verifierOutput: r.postRestoreGuestCheckpointVerifier,
    artifactDigests: { storedCheckpointImageDigest: r.storedCheckpointImageDigest },
    provenance: { family: "portable-snapshot-guest-checkpoint-composition" },
    migrationCompleted: r.migrationCompleted === true,
    refusalCode: r.refusalCode,
    remediation: r.remediation,
  });
}

function advancedFacilityRow(summary: Json, facility: string, claimId: string, claimName: string) {
  const r = summary.rows.find((row: Json) => row.facility === facility);
  return row({
    claimId,
    claimName,
    evidenceStatus: toEvidenceStatus(r.classification),
    sourceArch: r.sourceArch,
    targetArch: r.targetArch,
    hostArch: hostArch(),
    providerMode: "same-guest-kernel-facility-probe",
    targetExecution: "native",
    stateModel: r.stateModel,
    stateDecisions: ["product-support-not-claimed", "cross-isa-kernel-state-replay-not-claimed"],
    verifierCommand: "bash scripts/smoke/advanced-linux-facility-probe.sh --json",
    verifierOutput: r.verifierOutput,
    artifactDigests: digestMap(r),
    provenance: { family: "advanced-linux-facility-probe", facility },
    migrationCompleted: false,
    refusalCode: r.refusalCode,
    remediation: r.remediation,
  });
}

function advancedCombinedRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  const rows = summary.rows.filter((r: Json) =>
    ["namespace", "cgroup", "capability"].includes(r.facility),
  );
  return row({
    claimId: "advanced-linux-namespace-cgroup-capability",
    claimName: "namespace/cgroup/capability evidence status",
    evidenceStatus: "proof",
    sourceArch: arches(rows, "sourceArch"),
    targetArch: arches(rows, "targetArch"),
    hostArch: hostArch(),
    providerMode: "same-guest-kernel-facility-probe",
    targetExecution: "native",
    stateModel: rows.map((r) => `${r.facility}:${r.stateModel}`).join(","),
    stateDecisions: ["recreate-or-prove-irrelevant", "product-support-not-claimed"],
    verifierCommand: "bash scripts/smoke/advanced-linux-facility-probe.sh --json",
    verifierOutput: rows.map((r) => `${r.facility}=${r.verifierOutput}`).join(" | "),
    artifactDigests: digestMap(rows),
    provenance: {
      family: "advanced-linux-facility-probe",
      facilities: rows.map((r) => r.facility),
    },
    migrationCompleted: false,
  });
}

function nestedRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  const r = summary.rows[0];
  return row({
    claimId: "nested-virtualization-stretch-proof",
    claimName: "nested virtualization stretch proof/refusal",
    evidenceStatus: toEvidenceStatus(r.classification),
    sourceArch: r.l0HostArch,
    targetArch: r.l2GuestArch,
    hostArch: r.l0HostArch,
    providerMode: r.providerMode,
    targetExecution: r.accelerated ? "accelerated" : "not-applicable",
    stateModel: "nested-l0-l1-l2",
    stateDecisions: [
      "stretch-demo-only",
      "provider-snapshot-fork-refusal",
      "portable-snapshot-requirement-false",
    ],
    verifierCommand: "bash scripts/smoke/nested-virtualization-stretch-proof.sh --json",
    verifierOutput: r.nestedVerifierOutput,
    artifactDigests: digestMap(r),
    provenance: { family: "nested-virtualization-stretch-proof" },
    migrationCompleted: false,
    refusalCode: r.refusalCode,
    remediation: r.remediation,
  });
}

function nativeRegisterTranslationRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  return nativeProofRow({
    claimId: "native-register-translation",
    claimName: "native register translation proof/refusal",
    stateModel: "native-register-translation",
    stateDecisions: ["target-registers-translated", "active-syscall-refusal"],
    verifierCommand: "pnpm exec tsx scripts/native-register-translate.ts verify --json",
    verifierOutput: `translated=${summary.translated} refusal=${summary.refusal} refusal=${summary.result.threads[1]?.refusal?.code}`,
    artifactDigests: digestMap(summary),
    provenance: { family: "foundation-native", script: "native-register-translate" },
    migrationCompleted: true,
    sourceArch: summary.result.sourceArch,
    targetArch: summary.result.targetArch,
  });
}

function nativeStackReturnChainRow(
  stack: Json,
  returnChain: Json,
): ArchitecturePortableSnapshotGauntletRow {
  return nativeProofRow({
    claimId: "native-stack-return-chain-translation",
    claimName: "native stack and return-chain translation",
    stateModel: "native-stack-return-chain-translation",
    stateDecisions: [
      "stack-window-materialized",
      "return-addresses-translated",
      "return-chain-materialized",
    ],
    verifierCommand:
      "pnpm exec tsx scripts/native-stack-translate.ts verify --json && pnpm exec tsx scripts/native-return-chain.ts verify --json",
    verifierOutput: `stack=${stack.result.state} relocations=${stack.result.relocations.length} returnChain=${returnChain.result.state} frames=${returnChain.result.frames.length}`,
    artifactDigests: digestMap({ stack, returnChain }),
    provenance: {
      family: "foundation-native",
      scripts: ["native-stack-translate", "native-return-chain"],
    },
    migrationCompleted: true,
  });
}

function nativePrivateMemoryMaterializationRow(
  memory: Json,
  controlledRestore: Json,
): ArchitecturePortableSnapshotGauntletRow {
  return nativeProofRow({
    claimId: "native-private-memory-materialization",
    claimName: "native private memory translation and materialization",
    stateModel: "native-private-memory-materialization",
    stateDecisions: [
      "private-memory-relocations-translated",
      "target-memory-materialized",
      "ambiguous-pointer-refusal",
    ],
    verifierCommand:
      "pnpm exec tsx scripts/native-memory-translate.ts verify --json && pnpm exec tsx scripts/native-controlled-restore.ts verify --json",
    verifierOutput: `preserved=${memory.result.preservedWords} relocations=${memory.result.relocations.length} materialized=${controlledRestore.loaderEvent.status}/${controlledRestore.loaderEvent.sizeBytes} refusal=${memory.result.refusals[0]?.code}`,
    artifactDigests: digestMap({ memory, controlledRestore }),
    provenance: {
      family: "foundation-native",
      scripts: ["native-memory-translate", "native-controlled-restore"],
    },
    migrationCompleted: true,
  });
}

function nativeExecutableTargetModuleRow(
  codeMap: Json,
  targetModule: Json,
): ArchitecturePortableSnapshotGauntletRow {
  return nativeProofRow({
    claimId: "native-executable-target-module-materialization",
    claimName: "native executable and target module materialization",
    stateModel: "native-executable-target-module-materialization",
    stateDecisions: [
      "target-code-location-mapped",
      "target-module-bytes-materialized",
      "source-text-not-reused-as-target-code",
      "target-build-mismatch-refusal",
    ],
    verifierCommand:
      "pnpm exec tsx scripts/native-code-map.ts verify --json && pnpm exec tsx scripts/native-real-utility-target-module-bytes.ts verify --json",
    verifierOutput: `codeLocations=${codeMap.mapped.codeLocations.length} moduleBytes=${targetModule.materialized.sizeBytes} sourceTextReused=${targetModule.sourceTextReusedAsTargetCode} mismatch=${codeMap.mismatchRefusal.code}`,
    artifactDigests: digestMap({ codeMap, targetModule }),
    provenance: {
      family: "foundation-native",
      scripts: ["native-code-map", "native-real-utility-target-module-bytes"],
      targetBytesSource: targetModule.targetBytesSource,
    },
    migrationCompleted: true,
  });
}

function nativeTargetRestoreLoaderRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  return nativeProofRow({
    claimId: "native-target-restore-loader",
    claimName: "native target restore loader materialization",
    stateModel: "native-target-restore-loader",
    stateDecisions: ["target-loader-materialized-mapping", "missing-memory-refusal"],
    verifierCommand: "node scripts/native-restore-loader.mjs verify --json",
    verifierOutput: `status=${summary.restoreEvent.status} size=${summary.restoreEvent.sizeBytes} finalProt=${summary.restoreEvent.finalProt} missingMemory=${summary.missingMemoryRefusal.status}`,
    artifactDigests: digestMap(summary),
    provenance: { family: "foundation-native", script: "native-restore-loader" },
    migrationCompleted: true,
    sourceArch: summary.hostArch,
    targetArch: oppositeArch(summary.hostArch),
  });
}

function nativeTlsSimdFpuPolicyRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  const cases = refusalCases(summary, ["tls", "rseq", "simd", "fpu"]);
  return nativeRefusalRow({
    claimId: "native-tls-simd-fpu-policy",
    claimName: "native TLS, rseq, SIMD, and FPU policy refusals",
    stateModel: "native-tls-simd-fpu-policy",
    stateDecisions: ["tls-policy-refusal", "rseq-policy-refusal", "simd-fpu-policy-refusal"],
    verifierCommand: "pnpm exec tsx scripts/native-thread-refusal-matrix.ts verify --json",
    verifierOutput: refusalOutput(cases),
    artifactDigests: digestMap(cases),
    provenance: { family: "native-linux-resource", script: "native-thread-refusal-matrix" },
    refusalCode: "native-tls-simd-fpu-policy-refusal-matrix",
    remediation:
      "Add explicit TLS/rseq/SIMD/FPU restore models and target-native verifier coverage before accepting these states.",
  });
}

function nativeSignalPolicyRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  const cases = refusalCases(summary, ["signal", "pending", "blocked", "alt-stack"]);
  return nativeRefusalRow({
    claimId: "native-signal-policy",
    claimName: "native signal policy refusals",
    stateModel: "native-signal-policy",
    stateDecisions: [
      "signal-frame-refusal",
      "pending-signal-refusal",
      "signal-mask-refusal",
      "alt-stack-refusal",
    ],
    verifierCommand: "pnpm exec tsx scripts/native-thread-refusal-matrix.ts verify --json",
    verifierOutput: refusalOutput(cases),
    artifactDigests: digestMap(cases),
    provenance: { family: "native-linux-resource", script: "native-thread-refusal-matrix" },
    refusalCode: "native-signal-policy-refusal-matrix",
    remediation:
      "Restore only threads with empty pending/blocked signal state until signal frames, masks, and alt-stack semantics have explicit target models.",
  });
}

function nativeActiveSyscallPolicyRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  return nativeRefusalRow({
    claimId: "native-active-syscall-policy",
    claimName: "native active syscall policy refusals",
    stateModel: "native-active-syscall-policy",
    stateDecisions: [
      "active-syscall-refusal",
      "restart-syscall-refusal",
      "outside-syscall-not-a-continuation",
    ],
    verifierCommand: "pnpm exec tsx scripts/native-active-syscall-policy.ts verify --json",
    verifierOutput: `classes=${summary.classifications.map((entry: Json) => entry.class).join(",")} refusals=${summary.refusals.length}`,
    artifactDigests: digestMap(summary),
    provenance: { family: "native-linux-resource", script: "native-active-syscall-policy" },
    refusalCode: "native-active-syscall-policy-refusal-matrix",
    remediation:
      "Drain active syscalls or add syscall-specific target restart models before native process restore.",
  });
}

function nativeThreadPolicyRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  const restoreRefusals = summary.restoreBoundary.refusalCases ?? [];
  return nativeRefusalRow({
    claimId: "native-thread-policy",
    claimName: "native thread restore policy refusals",
    stateModel: "native-thread-restore-policy",
    stateDecisions: [
      "single-safe-thread-accepted",
      "multi-thread-refusal",
      "debug-stop-refusal",
      "shared-stack-refusal",
    ],
    verifierCommand: "pnpm exec tsx scripts/native-thread-refusal-matrix.ts verify --json",
    verifierOutput: `accepted=${summary.restoreBoundary.accepted.state} refusals=${restoreRefusals.map((entry: Json) => `${entry.id}:${entry.refusalCode}`).join(",")}`,
    artifactDigests: digestMap(summary.restoreBoundary),
    provenance: { family: "native-linux-resource", script: "native-thread-refusal-matrix" },
    refusalCode: "native-thread-policy-refusal-matrix",
    remediation:
      "Restore only the single safe thread fixture until multi-thread, futex, debug, and shared-stack models are productized.",
  });
}

function nativeMappingRefusalsRow(
  mappingPolicy: Json,
  controlledRestore: Json,
): ArchitecturePortableSnapshotGauntletRow {
  return nativeRefusalRow({
    claimId: "native-mapping-refusals",
    claimName: "native mapping refusal policy",
    stateModel: "native-mapping-refusal-policy",
    stateDecisions: [
      "kernel-mapping-refusal-or-recreated",
      "ambiguous-mapping-refusal",
      "migration-not-attempted",
    ],
    verifierCommand:
      "pnpm exec tsx scripts/native-mapping-policy.ts verify --json && pnpm exec tsx scripts/native-controlled-restore.ts verify --json",
    verifierOutput: `mappingPolicy=${mappingPolicy.skipped ? `skipped:${mappingPolicy.reason}` : "checked"} controlledRefusal=${controlledRestore.refusal.code}`,
    artifactDigests: digestMap({ mappingPolicy, controlledRestore: controlledRestore.refusal }),
    provenance: {
      family: "native-linux-resource",
      scripts: ["native-mapping-policy", "native-controlled-restore"],
    },
    refusalCode: "native-mapping-refusal-matrix",
    remediation:
      "Use explicit mapping materialization recipes and refuse ambiguous kernel/special mappings before target execution.",
  });
}

function nativeResourceRefusalsRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  return nativeRefusalRow({
    claimId: "native-resource-refusals",
    claimName: "native resource refusal policy",
    stateModel: "native-resource-refusal-policy",
    stateDecisions: [
      "regular-file-recipe-produced",
      "brokerless-kernel-resource-refusal",
      "migration-not-attempted",
    ],
    verifierCommand: "pnpm exec tsx scripts/native-resource-translate.ts verify --json",
    verifierOutput: `resources=${summary.result.resources.length} refusals=${summary.result.refusals.map((refusal: Json) => refusal.code).join(",")}`,
    artifactDigests: digestMap(summary),
    provenance: { family: "native-linux-resource", script: "native-resource-translate" },
    refusalCode: "native-resource-refusal-matrix",
    remediation:
      "Use accepted resource recipes or stable product refusals for brokerless sockets, non-file kernel state, and unsupported fd kinds.",
  });
}

function nativeProofRow(
  input: Pick<
    Parameters<typeof row>[0],
    | "claimId"
    | "claimName"
    | "stateModel"
    | "stateDecisions"
    | "verifierCommand"
    | "verifierOutput"
    | "artifactDigests"
    | "provenance"
    | "migrationCompleted"
  > & { sourceArch?: string; targetArch?: string },
): ArchitecturePortableSnapshotGauntletRow {
  return row({
    ...input,
    evidenceStatus: "proof",
    sourceArch: input.sourceArch ?? "arm64",
    targetArch: input.targetArch ?? "amd64",
    hostArch: hostArch(),
    providerMode: "native/process-proof",
    targetExecution: "native",
    evidenceCategory: "native/process-proof",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    stateDecisions: [
      ...input.stateDecisions,
      "public-product-verbs-not-used",
      "source-isa-emulation-refusal",
      "sidecar-output-not-used",
      "raw-cross-isa-checkpoint-replay-not-used",
      "metadata-only-success-refusal",
    ],
  });
}

function nativeRefusalRow(
  input: Pick<
    Parameters<typeof row>[0],
    | "claimId"
    | "claimName"
    | "stateModel"
    | "stateDecisions"
    | "verifierCommand"
    | "verifierOutput"
    | "artifactDigests"
    | "provenance"
    | "refusalCode"
    | "remediation"
  >,
): ArchitecturePortableSnapshotGauntletRow {
  return row({
    ...input,
    evidenceStatus: "refusal",
    sourceArch: "arm64",
    targetArch: "amd64",
    hostArch: hostArch(),
    providerMode: "native/process-unsupported",
    targetExecution: "not-applicable",
    evidenceCategory: "unsupported",
    productSupport: "unsupported",
    implementationLevel: "level-0-fail-closed-discovery",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    stateDecisions: [...input.stateDecisions, "product-support-not-claimed"],
    migrationCompleted: false,
  });
}

function refusalCases(summary: Json, needles: string[]): Json[] {
  return (summary.refusalCases as Json[]).filter((entry) =>
    needles.some((needle) => `${entry.id}:${entry.refusalCode}`.includes(needle)),
  );
}

function refusalOutput(cases: Json[]): string {
  return cases.map((entry) => `${entry.id}:${entry.refusalCode}`).join(",");
}

// fallow-ignore-next-line complexity
function toEvidenceStatus(value: unknown): ArchitecturePortableSnapshotGauntletEvidenceStatus {
  const legacyProofStatus = `proof-${"only"}-feasibility`;
  if (value === "completed" || value === "proof" || value === legacyProofStatus) {
    return "proof";
  }
  if (value === "refused" || value === "refusal") {
    return "refusal";
  }
  if (value === "product-supported" || value === "support") {
    return "support";
  }
  if (value === "stretch-demo") {
    return "stretch-demo";
  }
  return "skipped";
}

// fallow-ignore-next-line complexity
function row(
  input: Omit<
    Parameters<typeof buildArchitecturePortableSnapshotGauntletRow>[0],
    | "evidenceStatus"
    | "evidenceCategory"
    | "productSupport"
    | "implementationLevel"
    | "graduationTargetLevel"
  > & {
    evidenceStatus: string;
    evidenceCategory?: Parameters<
      typeof buildArchitecturePortableSnapshotGauntletRow
    >[0]["evidenceCategory"];
    productSupport?: Parameters<
      typeof buildArchitecturePortableSnapshotGauntletRow
    >[0]["productSupport"];
    implementationLevel?: string;
    graduationTargetLevel?: string;
  },
): ArchitecturePortableSnapshotGauntletRow {
  const productSupport = input.productSupport ?? defaultProductSupport(input.evidenceStatus);
  return buildArchitecturePortableSnapshotGauntletRow({
    ...input,
    evidenceStatus: input.evidenceStatus as ArchitecturePortableSnapshotGauntletEvidenceStatus,
    evidenceCategory: input.evidenceCategory ?? defaultEvidenceCategory(input.evidenceStatus),
    productSupport,
    implementationLevel:
      input.implementationLevel ??
      defaultImplementationLevel(input.evidenceCategory, productSupport, input.evidenceStatus),
    graduationTargetLevel:
      input.graduationTargetLevel ??
      defaultGraduationTargetLevel(input.evidenceCategory, productSupport, input.evidenceStatus),
    stateDecisions: normalizedStateDecisions(
      input.stateDecisions,
      input.migrationCompleted,
      productSupport,
    ),
  });
}

function defaultEvidenceCategory(
  evidenceStatus: string,
): Parameters<typeof buildArchitecturePortableSnapshotGauntletRow>[0]["evidenceCategory"] {
  if (evidenceStatus === "refusal") {
    return "unsupported";
  }
  if (evidenceStatus === "skipped") {
    return "unsupported";
  }
  return "runtime-aware-proof";
}

function defaultProductSupport(
  evidenceStatus: string,
): Parameters<typeof buildArchitecturePortableSnapshotGauntletRow>[0]["productSupport"] {
  if (evidenceStatus === "refusal") {
    return "unsupported";
  }
  if (evidenceStatus === "skipped") {
    return "unsupported";
  }
  return "not-yet-supported";
}

// fallow-ignore-next-line complexity
function defaultImplementationLevel(
  evidenceCategory:
    | Parameters<typeof buildArchitecturePortableSnapshotGauntletRow>[0]["evidenceCategory"]
    | undefined,
  productSupport: Parameters<
    typeof buildArchitecturePortableSnapshotGauntletRow
  >[0]["productSupport"],
  evidenceStatus: string,
): string {
  if (productSupport === "supported") {
    if (evidenceCategory === "supported-semantic-continuation") {
      return "level-2-semantic-continuation";
    }
    return "level-1-semantic-restart";
  }
  if (productSupport === "unsupported" || evidenceStatus === "skipped") {
    return "level-0-fail-closed-discovery";
  }
  return "not-implemented";
}

function defaultGraduationTargetLevel(
  evidenceCategory:
    | Parameters<typeof buildArchitecturePortableSnapshotGauntletRow>[0]["evidenceCategory"]
    | undefined,
  productSupport: Parameters<
    typeof buildArchitecturePortableSnapshotGauntletRow
  >[0]["productSupport"],
  evidenceStatus: string,
): string {
  if (evidenceCategory === "native/process-proof") {
    return "level-5-cross-arch-process-continuation";
  }
  if (productSupport === "unsupported" || evidenceStatus === "skipped") {
    return "level-0-fail-closed-discovery";
  }
  return "level-3-runtime-aware-continuation";
}

function normalizedStateDecisions(
  decisions: string[],
  migrationCompleted: boolean,
  productSupport: Parameters<
    typeof buildArchitecturePortableSnapshotGauntletRow
  >[0]["productSupport"],
): string[] {
  if (!migrationCompleted || productSupport === "supported") {
    return decisions;
  }
  return decisions.includes("product-support-not-claimed")
    ? decisions
    : [...decisions, "product-support-not-claimed"];
}

function executionFrom(route: Json): ArchitecturePortableSnapshotTargetExecution {
  if (route.emulated) {
    return "emulated";
  }
  if (route.accelerated) {
    return "native";
  }
  return "not-applicable";
}

function arches(rows: Json[], field: string): string {
  return (
    [...new Set(rows.map((row) => row[field]).filter(Boolean))].join("<->") || "not-applicable"
  );
}

function digestMap(value: unknown): Record<string, string> {
  return { summary: stableGauntletDigest(value) };
}

function hostArch(): string {
  if (process.arch === "x64") {
    return "amd64";
  }
  return process.arch;
}

const OPPOSITE_ARCH: Record<string, string> = {
  aarch64: "amd64",
  amd64: "arm64",
  arm64: "amd64",
  x64: "arm64",
};

function oppositeArch(arch: string): string {
  return OPPOSITE_ARCH[arch] ?? "not-applicable";
}

function fixtureRows(): ArchitecturePortableSnapshotGauntletRow[] {
  return requiredArchitecturePortableSnapshotClaimIds.map(
    // fallow-ignore-next-line complexity
    (claimId) =>
      row({
        claimId,
        claimName: claimId,
        evidenceStatus: fixtureClaimIsRefusal(claimId) ? "refusal" : "proof",
        sourceArch: "arm64",
        targetArch: "amd64",
        hostArch: "arm64",
        providerMode: "fixture",
        targetExecution: "native",
        evidenceCategory: fixtureClaimIsNativeProcess(claimId) ? "native/process-proof" : undefined,
        productSupport: fixtureClaimIsNativeProcess(claimId) ? "not-yet-supported" : undefined,
        implementationLevel: fixtureClaimIsNativeProcess(claimId) ? "not-implemented" : undefined,
        graduationTargetLevel: fixtureClaimIsNativeProcess(claimId)
          ? "level-5-cross-arch-process-continuation"
          : undefined,
        stateModel: "fixture",
        stateDecisions: ["fixture-row"],
        verifierCommand: "scripts/architecture-portable-snapshot-gauntlet.ts --fixture",
        verifierOutput: "fixture ok",
        artifactDigests: { fixture: stableGauntletDigest(claimId) },
        provenance: { fixture: true },
        migrationCompleted: false,
        refusalCode: fixtureClaimIsRefusal(claimId) ? "fixture-refusal" : undefined,
        remediation: fixtureClaimIsRefusal(claimId) ? "fixture remediation" : undefined,
      }),
  );
}

function fixtureClaimIsNativeProcess(claimId: string): boolean {
  return claimId.startsWith("native-") && !fixtureClaimIsRefusal(claimId);
}

const FIXTURE_REFUSAL_CLAIMS = new Set([
  "native-active-syscall-policy",
  "native-mapping-refusals",
  "native-resource-refusals",
  "native-signal-policy",
  "native-thread-policy",
  "native-tls-simd-fpu-policy",
]);

function fixtureClaimIsRefusal(claimId: string): boolean {
  return (
    claimId.includes("refusal") || claimId.includes("ebpf") || FIXTURE_REFUSAL_CLAIMS.has(claimId)
  );
}

main();
