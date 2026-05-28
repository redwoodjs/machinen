#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildArchitecturePortableSnapshotGauntletRow,
  requiredArchitecturePortableSnapshotClaimIds,
  stableGauntletDigest,
  summarizeArchitecturePortableSnapshotGauntletRows,
  type ArchitecturePortableSnapshotGauntletClassification,
  type ArchitecturePortableSnapshotGauntletRow,
  type ArchitecturePortableSnapshotTargetExecution,
} from "../packages/runtime/src/index.ts";

interface Args {
  out: string;
  fixture: boolean;
}

type Json = Record<string, any>;

const DEFAULT_OUT =
  "docs/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json";

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

function rowsFromLiveSmokes(): ArchitecturePortableSnapshotGauntletRow[] {
  const opposite = smokeJson(
    "scripts/smoke/opposite-isa-vm-execution.sh",
    "opposite-isa-vm-execution-smoke",
  );
  const db = smokeJson(
    "scripts/smoke/stateful-database-portable-restore.sh",
    "stateful-database-restore-smoke",
  );
  const guestCheckpoint = smokeJson(
    "scripts/smoke/guest-checkpoint-substrate.sh",
    "guest-checkpoint-substrate-smoke",
  );
  const composition = smokeJson(
    "scripts/smoke/portable-snapshot-guest-checkpoint-composition.sh",
    "portable-snapshot-guest-checkpoint-composition-smoke",
  );
  const runtime = smokeJson(
    "scripts/smoke/runtime-confidence-profile-matrix.sh",
    "runtime-confidence-profile-matrix",
  );
  const advanced = smokeJson(
    "scripts/smoke/advanced-linux-facility-probe.sh",
    "advanced-linux-facility-probe-matrix",
  );
  const nested = smokeJson(
    "scripts/smoke/nested-virtualization-stretch-proof.sh",
    "nested-virtualization-stretch-proof-summary",
  );

  return [
    oppositeIsaRow(opposite),
    postgresRestoreRow(db),
    postgresRefusalRow(db),
    sqliteRollbackRow(db),
    sqliteWalRow(db),
    sqliteRefusalRow(db),
    guestCheckpointRow(guestCheckpoint, "c-simple"),
    guestCheckpointRow(guestCheckpoint, "jvm-simple"),
    compositionRow(composition),
    runtimeRow(runtime, "c"),
    runtimeRow(runtime, "java"),
    advancedFacilityRow(advanced, "seccomp", "advanced-linux-seccomp", "seccomp proof/refusal"),
    advancedFacilityRow(advanced, "ebpf", "advanced-linux-ebpf", "eBPF proof/refusal"),
    advancedCombinedRow(advanced),
    nestedRow(nested),
  ];
}

function smokeJson(script: string, kindSuffix: string): Json {
  return smokeJsonWithArgs(script, ["--json"], kindSuffix);
}

function smokeJsonWithArgs(script: string, args: string[], kindSuffix: string): Json {
  const result = spawnSync("bash", [script, ...args], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`${script} failed with ${result.status}: ${output.slice(-4000)}`);
  }
  return parseJsonObject(output, kindSuffix);
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
  const classification = route.state === "completed" ? "proof-only-feasibility" : route.state;
  return row({
    claimId: "opposite-isa-vm-execution",
    claimName: "opposite-ISA VM execution",
    classification,
    sourceArch: route.hostArch,
    targetArch: route.guestArch,
    hostArch: route.hostArch,
    providerMode: route.providerMode,
    targetExecution: executionFrom(route),
    stateModel: "provider-guest-boot",
    stateDecisions: ["guest-verifier-required", "host-sidecar-output-refused"],
    verifierCommand: "bash scripts/smoke/opposite-isa-vm-execution.sh --json",
    verifierOutput: route.verifierOutput || route.refusalCode || "opposite route checked",
    artifactDigests: digestMap(route),
    provenance: { family: "opposite-isa-vm-execution", liveRequested: summary.liveRequested },
    migrationCompleted: false,
    refusalCode: route.refusalCode,
    remediation: route.remediation,
  });
}

function postgresRestoreRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  const rows = summary.rows.filter(
    (r: Json) => r.database === "postgresql" && r.state === "completed",
  );
  return aggregateDatabaseRow(
    "postgres-bidirectional-logical-restore",
    "PostgreSQL bidirectional logical restore",
    rows,
    "logical-dump",
    true,
  );
}

function postgresRefusalRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  const rows = summary.rows.filter(
    (r: Json) => r.database === "postgresql" && r.state === "refused",
  );
  return aggregateRefusalRow(
    "postgres-unsafe-neighbor-refusals",
    "PostgreSQL unsafe-neighbor refusals",
    rows,
    "postgres-refusal-matrix",
  );
}

function sqliteRollbackRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  const rows = summary.rows.filter(
    (r: Json) =>
      r.database === "sqlite" && r.stateModel === "rollback-journal" && r.state === "completed",
  );
  return aggregateDatabaseRow(
    "sqlite-rollback-journal-restore",
    "SQLite rollback-journal restore",
    rows,
    "rollback-journal",
    true,
  );
}

function sqliteWalRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  const rows = summary.rows.filter(
    (r: Json) =>
      r.database === "sqlite" && r.stateModel === "wal-checkpoint" && r.state === "completed",
  );
  return aggregateDatabaseRow(
    "sqlite-wal-checkpoint-restore",
    "SQLite WAL-checkpoint restore",
    rows,
    "wal-checkpoint",
    true,
  );
}

function sqliteRefusalRow(summary: Json): ArchitecturePortableSnapshotGauntletRow {
  const rows = summary.rows.filter((r: Json) => r.database === "sqlite" && r.state === "refused");
  return aggregateRefusalRow(
    "sqlite-dirty-inflight-refusals",
    "SQLite dirty/in-flight refusals",
    rows,
    "sqlite-refusal-matrix",
  );
}

function aggregateDatabaseRow(
  claimId: string,
  claimName: string,
  rows: Json[],
  stateModel: string,
  migrationCompleted: boolean,
): ArchitecturePortableSnapshotGauntletRow {
  return row({
    claimId,
    claimName,
    classification: "proof-only-feasibility",
    sourceArch: arches(rows, "sourceArch"),
    targetArch: arches(rows, "targetArch"),
    hostArch: hostArch(),
    providerMode: "logical-target-native-verifier",
    targetExecution: "native",
    stateModel,
    stateDecisions: [
      "logical-artifact-restored",
      "target-verifier-passed",
      "raw-checkpoint-image-not-used",
    ],
    verifierCommand: "bash scripts/smoke/stateful-database-portable-restore.sh --json",
    verifierOutput: rows.map((r) => r.targetVerifierOutput).join(" | "),
    artifactDigests: digestMap(rows),
    provenance: { family: "stateful-database-portable-restore", rowCount: rows.length },
    migrationCompleted,
  });
}

function aggregateRefusalRow(
  claimId: string,
  claimName: string,
  rows: Json[],
  stateModel: string,
): ArchitecturePortableSnapshotGauntletRow {
  return row({
    claimId,
    claimName,
    classification: "refused",
    sourceArch: arches(rows, "sourceArch"),
    targetArch: arches(rows, "targetArch"),
    hostArch: hostArch(),
    providerMode: "logical-target-native-verifier",
    targetExecution: "not-applicable",
    stateModel,
    stateDecisions: ["unsafe-neighbor-refused", "migration-not-attempted"],
    verifierCommand: "bash scripts/smoke/stateful-database-portable-restore.sh --json",
    verifierOutput: rows.map((r) => r.refusalCode).join(", "),
    artifactDigests: digestMap(rows),
    provenance: { family: "stateful-database-portable-restore", rowCount: rows.length },
    migrationCompleted: false,
    refusalCode: "unsafe-state-refusal-matrix",
    remediation: "Drain unsafe database state or use a logical/checkpoint boundary before restore.",
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
    classification: r.state === "completed" ? "proof-only-feasibility" : r.state,
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
    classification: r.state === "completed" ? "proof-only-feasibility" : r.state,
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

// fallow-ignore-next-line complexity
function runtimeRow(summary: Json, runtime: "c" | "java"): ArchitecturePortableSnapshotGauntletRow {
  const rows = summary.rows.filter((r: Json) => r.runtime === runtime);
  const refused = rows.filter((r) => r.classification === "refused").length;
  return row({
    claimId: runtime === "c" ? "runtime-confidence-c" : "runtime-confidence-java",
    claimName:
      runtime === "c" ? "C runtime confidence profiles" : "Java/JVM runtime confidence profiles",
    classification: refused === rows.length ? "refused" : "proof-only-feasibility",
    sourceArch: arches(rows, "sourceArch"),
    targetArch: arches(rows, "targetArch"),
    hostArch: hostArch(),
    providerMode: "runtime-confidence-matrix",
    targetExecution: "native",
    stateModel: "runtime-profile-classification",
    stateDecisions: ["product-support-not-claimed", "target-native-verifier-required"],
    verifierCommand: "bash scripts/smoke/runtime-confidence-profile-matrix.sh --json",
    verifierOutput: `${runtime} rows=${rows.length} refused=${refused}`,
    artifactDigests: digestMap(rows),
    provenance: { family: "runtime-confidence-profile-matrix", runtime, rowCount: rows.length },
    migrationCompleted: false,
    refusalCode: refused === rows.length ? "runtime-profile-refusal-matrix" : undefined,
    remediation:
      refused === rows.length
        ? "Satisfy the runtime-specific verifier and provenance requirements."
        : undefined,
  });
}

function advancedFacilityRow(summary: Json, facility: string, claimId: string, claimName: string) {
  const r = summary.rows.find((row: Json) => row.facility === facility);
  return row({
    claimId,
    claimName,
    classification: r.classification,
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
    claimName: "namespace/cgroup/capability classification",
    classification: "proof-only-feasibility",
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
    classification: r.classification,
    sourceArch: r.l0HostArch,
    targetArch: r.l2GuestArch,
    hostArch: r.l0HostArch,
    providerMode: r.providerMode,
    targetExecution: r.accelerated ? "accelerated" : "not-applicable",
    stateModel: "nested-l0-l1-l2",
    stateDecisions: [
      "stretch-demo-only",
      "provider-snapshot-fork-refused",
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

function row(
  input: Omit<
    Parameters<typeof buildArchitecturePortableSnapshotGauntletRow>[0],
    "classification"
  > & {
    classification: string;
  },
): ArchitecturePortableSnapshotGauntletRow {
  return buildArchitecturePortableSnapshotGauntletRow({
    ...input,
    classification: input.classification as ArchitecturePortableSnapshotGauntletClassification,
  });
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

function fixtureRows(): ArchitecturePortableSnapshotGauntletRow[] {
  return requiredArchitecturePortableSnapshotClaimIds.map(
    // fallow-ignore-next-line complexity
    (claimId) =>
      row({
        claimId,
        claimName: claimId,
        classification:
          claimId.includes("refusal") || claimId.includes("ebpf")
            ? "refused"
            : "proof-only-feasibility",
        sourceArch: "arm64",
        targetArch: "amd64",
        hostArch: "arm64",
        providerMode: "fixture",
        targetExecution: "native",
        stateModel: "fixture",
        stateDecisions: ["fixture-row"],
        verifierCommand: "scripts/architecture-portable-snapshot-gauntlet.ts --fixture",
        verifierOutput: "fixture ok",
        artifactDigests: { fixture: stableGauntletDigest(claimId) },
        provenance: { fixture: true },
        migrationCompleted: false,
        refusalCode:
          claimId.includes("refusal") || claimId.includes("ebpf") ? "fixture-refusal" : undefined,
        remediation:
          claimId.includes("refusal") || claimId.includes("ebpf")
            ? "fixture remediation"
            : undefined,
      }),
  );
}

main();
