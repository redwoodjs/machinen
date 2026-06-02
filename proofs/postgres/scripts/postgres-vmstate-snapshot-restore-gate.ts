import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Artifact = {
  path: string;
  exists: boolean;
  bytes: number;
  sha256: string;
};

type Check = { id: string; passed: boolean; message: string };

type PostgresVmstateSnapshotRestoreGateReport = {
  kind: "machinen.postgres-vmstate-snapshot-restore-gate-report";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  verifiedScope: {
    runtime: "postgresql";
    interface: "psql";
    subset: "postgres-clean-quiesced-checkpointed-vmstate";
    sourceGuestArch: "arm64";
    targetGuestArch: "arm64";
    crossArchitecture: false;
    snapshotEngine: "vmstate";
  };
  publicPortablePostgresClaimAllowed: false;
  publicClaim: {
    productSupport: 0;
    broadSupport: 0;
    arbitraryProcessCrossArchRestore: 0;
  };
  guarantees: string[];
  nonGuarantees: string[];
  postgres: {
    version: string;
    architecture: string;
    walCheckpointLsn: string;
    activeTransactionsAtSnapshot: number;
    sourceVerifierOutputSha256: string;
    targetVerifierOutputSha256: string;
    sourceTargetVerifierMatch: boolean;
  };
  noShortcutPolicy: {
    sourceIsaEmulationUsed: false;
    sourceTextReplayAccepted: false;
    sidecarRuntimeUsed: false;
    appHooksRequired: false;
    metadataOnlyShortcutAccepted: false;
    targetNativeExecutionRequired: true;
  };
  refusalBoundaries: string[];
  checks: Check[];
  artifacts: Artifact[];
};

const retainedFiles = [
  "postgres-vmstate-snapshot-restore-summary.json",
  "source/product-command.txt",
  "source/source-psql-transcript.txt",
  "source/snapshot-meta.json",
  "target/product-command.txt",
  "target/restore.log",
  "target/target-psql-verifier.txt",
];

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildPostgresVmstateSnapshotRestoreGateReport(options.root);
  const verifierPath = join(
    resolve(options.root),
    "proofs/postgres/vmstate-snapshot-restore/retained/target/verifier.json",
  );
  mkdirSync(dirname(verifierPath), { recursive: true });
  writeFileSync(verifierPath, `${JSON.stringify(targetVerifier(report), null, 2)}\n`);
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `postgres vmstate snapshot/restore gate: accepted=${report.accepted} scope=${report.verifiedScope.subset}\n`,
    );
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

export function buildPostgresVmstateSnapshotRestoreGateReport(
  root: string,
): PostgresVmstateSnapshotRestoreGateReport {
  const resolvedRoot = resolve(root);
  const retainedRoot = join(resolvedRoot, "proofs/postgres/vmstate-snapshot-restore/retained");
  const summaryPath = join(retainedRoot, "postgres-vmstate-snapshot-restore-summary.json");
  const summary = readJson(summaryPath) as any;
  const meta = readJson(join(retainedRoot, "source/snapshot-meta.json")) as any;
  const sourceTranscript = readText(join(retainedRoot, "source/source-psql-transcript.txt"));
  const targetTranscript = readText(join(retainedRoot, "target/target-psql-verifier.txt"));
  const checks: Check[] = [
    check(
      "summary-completed",
      summary?.state === "completed",
      "Machinen PostgreSQL proof summary completed",
    ),
    check("runtime-postgresql", summary?.runtime === "postgresql", "summary runtime is PostgreSQL"),
    check(
      "snapshot-engine-vmstate",
      summary?.machinen?.snapshotEngine === "vmstate" && meta?.engine === "vmstate",
      "snapshot used Machinen vmstate engine",
    ),
    check(
      "same-arm64-guest-scope",
      summary?.machinen?.guestArch === "arm64" && meta?.vmstate?.guestArch === "arm64",
      "verified scope is same-guest-architecture arm64 VM-state restore",
    ),
    check(
      "target-restore-passed",
      summary?.targetRestore?.migrationCompleted === true &&
        summary?.targetRestore?.targetVerifierResult === "passed",
      "target restore completed and verifier passed",
    ),
    check(
      "source-target-psql-match",
      sourceTranscript.trim() === targetTranscript.trim() &&
        sourceTranscript.trim() === summary?.postgres?.sourceVerifierOutput &&
        targetTranscript.trim() === summary?.postgres?.targetVerifierOutput,
      "source and target psql verifier transcripts match retained summary",
    ),
    check(
      "expected-database-shape",
      parsedVerifierValue(targetTranscript, "rowCount") === 4 &&
        parsedVerifierValue(targetTranscript, "valueSum") === 105,
      "target psql verifier shows expected rows and aggregate",
    ),
    check(
      "no-active-transactions",
      summary?.postgres?.activeTransactionsAtSnapshot === 0 &&
        summary?.supportedSubset?.noActiveClientTransaction === true,
      "snapshot was taken with no active PostgreSQL client transaction",
    ),
    check(
      "wal-checkpointed",
      typeof summary?.postgres?.walCheckpointLsn === "string" &&
        summary?.supportedSubset?.walCheckpointed === true,
      "WAL checkpoint boundary is recorded",
    ),
    check(
      "no-shortcuts",
      summary?.securityInspection?.passed === true &&
        summary?.securityInspection?.sourceIsaEmulationArtifactFound === false &&
        summary?.securityInspection?.sourceTextReplayArtifactFound === false &&
        summary?.securityInspection?.sidecarRuntimeArtifactFound === false &&
        summary?.securityInspection?.appHookArtifactFound === false &&
        summary?.securityInspection?.metadataOnlyShortcutAccepted === false,
      "no source ISA emulation, source text replay, sidecar, app hook, or metadata-only shortcut was accepted",
    ),
  ];
  const artifacts = retainedFiles.map((path) => artifact(join(retainedRoot, path)));
  checks.push(
    check(
      "retained-artifacts-present",
      artifacts.every((entry) => entry.exists),
      "all required retained PostgreSQL VM-state proof artifacts exist",
    ),
  );
  const accepted = checks.every((row) => row.passed);
  return {
    kind: "machinen.postgres-vmstate-snapshot-restore-gate-report",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted,
    verifiedScope: {
      runtime: "postgresql",
      interface: "psql",
      subset: "postgres-clean-quiesced-checkpointed-vmstate",
      sourceGuestArch: "arm64",
      targetGuestArch: "arm64",
      crossArchitecture: false,
      snapshotEngine: "vmstate",
    },
    publicPortablePostgresClaimAllowed: false,
    publicClaim: {
      productSupport: 0,
      broadSupport: 0,
      arbitraryProcessCrossArchRestore: 0,
    },
    guarantees: [
      "A real PostgreSQL 15 service booted in a Machinen arm64 VM.",
      "Schema/data/workload were loaded through psql before snapshot.",
      "Machinen vmstate snapshot and restore completed for the clean quiesced VM.",
      "Target psql verifier output matched source psql verifier output after restore.",
      "The retained target verifier shows rowCount=4, valueSum=105, and expected payload/value arrays.",
    ],
    nonGuarantees: [
      "Does not prove amd64 -> arm64 PostgreSQL restore.",
      "Does not prove arm64 -> amd64 PostgreSQL restore.",
      "Does not prove no-dump product-level portable PostgreSQL capture/restore.",
      "Does not prove physical PostgreSQL data-directory portability across ISA.",
      "Does not support active sessions, active transactions, dirty WAL, replication/failover state, app hooks, sidecars, source ISA emulation, or metadata-only success.",
    ],
    postgres: {
      version: String(summary?.postgres?.version ?? "unknown"),
      architecture: String(summary?.postgres?.architecture ?? "unknown"),
      walCheckpointLsn: String(summary?.postgres?.walCheckpointLsn ?? "unknown"),
      activeTransactionsAtSnapshot: Number(summary?.postgres?.activeTransactionsAtSnapshot ?? -1),
      sourceVerifierOutputSha256: sha256(sourceTranscript.trim()),
      targetVerifierOutputSha256: sha256(targetTranscript.trim()),
      sourceTargetVerifierMatch: sourceTranscript.trim() === targetTranscript.trim(),
    },
    noShortcutPolicy: {
      sourceIsaEmulationUsed: false,
      sourceTextReplayAccepted: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
      metadataOnlyShortcutAccepted: false,
      targetNativeExecutionRequired: true,
    },
    refusalBoundaries: (summary?.refusals ?? []).map((row: any) => String(row.expectedRefusalCode)),
    checks,
    artifacts,
  };
}

function targetVerifier(report: PostgresVmstateSnapshotRestoreGateReport): unknown {
  return {
    kind: "machinen.postgres-vmstate-target-verifier",
    accepted: report.accepted,
    runtime: report.verifiedScope.runtime,
    interface: report.verifiedScope.interface,
    subset: report.verifiedScope.subset,
    crossArchitecture: report.verifiedScope.crossArchitecture,
    sourceGuestArch: report.verifiedScope.sourceGuestArch,
    targetGuestArch: report.verifiedScope.targetGuestArch,
    targetNativeExecutionRequired: report.noShortcutPolicy.targetNativeExecutionRequired,
    sourceTargetVerifierMatch: report.postgres.sourceTargetVerifierMatch,
    sourceVerifierOutputSha256: report.postgres.sourceVerifierOutputSha256,
    targetVerifierOutputSha256: report.postgres.targetVerifierOutputSha256,
    forbiddenShortcuts: report.noShortcutPolicy,
  };
}

function parsedVerifierValue(text: string, key: string): unknown {
  try {
    return JSON.parse(text.trim())[key];
  } catch {
    return undefined;
  }
}

function check(id: string, passed: boolean, message: string): Check {
  return { id, passed, message };
}

function artifact(path: string): Artifact {
  const resolved = resolve(path);
  const exists = existsSync(resolved) && statSync(resolved).isFile();
  return {
    path: displayPath(resolved),
    exists,
    bytes: exists ? statSync(resolved).size : 0,
    sha256: exists ? sha256(readFileSync(resolved)) : "missing",
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readText(path));
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function displayPath(path: string): string {
  return path.replace(`${process.cwd()}/`, "");
}

function parseArgs(args: string[]): { root: string; out?: string; json: boolean } {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, "../../..");
  const parsed: { root: string; out?: string; json: boolean } = { root: repoRoot, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--root") {
      parsed.root = takeValue(args, ++index, arg);
      continue;
    }
    if (arg === "--out") {
      parsed.out = takeValue(args, ++index, arg);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
