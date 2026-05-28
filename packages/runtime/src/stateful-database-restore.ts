import { createHash } from "node:crypto";

export const STATEFUL_DATABASE_RESTORE_KIND =
  "machinen.architecture-portable-snapshot.stateful-database-restore" as const;

export const statefulDatabaseRestoreRefusalCodes = [
  "postgres-active-transaction-unsupported",
  "postgres-active-session-unsupported",
  "postgres-dirty-wal-boundary-unsupported",
  "postgres-host-mounted-data-dir-ambiguous",
  "postgres-physical-data-dir-cross-isa-unsupported",
  "postgres-target-verifier-mismatch",
  "postgres-extension-native-state-unsupported",
  "sqlite-dirty-rollback-journal-unsupported",
  "sqlite-dirty-wal-checkpoint-unsupported",
  "sqlite-active-writer-transaction-unsupported",
  "sqlite-mmap-or-lock-state-unsupported",
  "sqlite-target-verifier-mismatch",
] as const;

export type StatefulDatabaseRestoreRefusalCode =
  (typeof statefulDatabaseRestoreRefusalCodes)[number];
export type StatefulDatabaseRestoreArch = "arm64" | "amd64";
export type StatefulDatabaseRestoreDatabase = "postgresql" | "sqlite";
export type StatefulDatabaseRestoreStateModel =
  | "logical-dump"
  | "checkpoint"
  | "rollback-journal"
  | "wal-checkpoint";
export type StatefulDatabaseRestoreState = "completed" | "refused";

export interface StatefulDatabaseRestoreInput {
  database: StatefulDatabaseRestoreDatabase;
  stateModel: StatefulDatabaseRestoreStateModel;
  sourceArch: StatefulDatabaseRestoreArch;
  targetArch: StatefulDatabaseRestoreArch;
  databaseVersion: string;
  artifactBytes: Buffer | string;
  logicalData: Buffer | string;
  sourceVerifierOutput: string;
  targetVerifierOutput: string;
  postgres?: {
    activeTransactions?: number;
    activeSessions?: number;
    dirtyWal?: boolean;
    hostMountedDataDir?: boolean;
    physicalDataDirCopy?: boolean;
    extensionNativeState?: boolean;
    checkpointLsn?: string;
  };
  sqlite?: {
    journalPolicy?: "rollback-clean-close" | "wal-checkpoint-truncate";
    dirtyRollbackJournal?: boolean;
    dirtyWal?: boolean;
    activeWriterTransaction?: boolean;
    mmapOrLockState?: boolean;
  };
}

export interface StatefulDatabaseRestoreSummary {
  kind: typeof STATEFUL_DATABASE_RESTORE_KIND;
  database: StatefulDatabaseRestoreDatabase;
  stateModel: StatefulDatabaseRestoreStateModel;
  sourceArch: StatefulDatabaseRestoreArch;
  targetArch: StatefulDatabaseRestoreArch;
  databaseVersion: string;
  artifactDigest: string;
  logicalDataDigest: string;
  targetVerifierOutput: string;
  migrationCompleted: boolean;
  state: StatefulDatabaseRestoreState;
  targetVerifierResult: "passed" | "failed" | "not-run";
  refusalCode?: StatefulDatabaseRestoreRefusalCode;
  remediation?: string;
  evidence: Record<string, unknown>;
  shortcutInspection: {
    sourceIsaEmulationUsed: false;
    sourceTextReusedAsTargetCode: false;
    sidecarRuntimeUsed: false;
    metadataOnlyShortcutAccepted: false;
  };
}

export function buildStatefulDatabaseRestoreSummary(
  input: StatefulDatabaseRestoreInput,
): StatefulDatabaseRestoreSummary {
  const artifactDigest = sha256(input.artifactBytes);
  const logicalDataDigest = sha256(input.logicalData);
  const refusal = classifyStatefulDatabaseRefusal(input);
  const base = {
    kind: STATEFUL_DATABASE_RESTORE_KIND,
    database: input.database,
    stateModel: input.stateModel,
    sourceArch: input.sourceArch,
    targetArch: input.targetArch,
    databaseVersion: input.databaseVersion,
    artifactDigest,
    logicalDataDigest,
    targetVerifierOutput: input.targetVerifierOutput,
    evidence: evidenceFor(input),
    shortcutInspection: shortcutInspection(),
  } satisfies Omit<
    StatefulDatabaseRestoreSummary,
    "state" | "migrationCompleted" | "targetVerifierResult" | "refusalCode" | "remediation"
  >;
  if (refusal) {
    return {
      ...base,
      state: "refused",
      migrationCompleted: false,
      targetVerifierResult: refusal.verifierResult,
      refusalCode: refusal.code,
      remediation: refusal.remediation,
    };
  }
  return {
    ...base,
    state: "completed",
    migrationCompleted: true,
    targetVerifierResult: "passed",
  };
}

export function postgresLogicalRestoreInput(
  input: Omit<StatefulDatabaseRestoreInput, "database" | "stateModel">,
): StatefulDatabaseRestoreInput {
  return { ...input, database: "postgresql", stateModel: "logical-dump" };
}

export function sqliteRollbackJournalRestoreInput(
  input: Omit<StatefulDatabaseRestoreInput, "database" | "stateModel">,
): StatefulDatabaseRestoreInput {
  return { ...input, database: "sqlite", stateModel: "rollback-journal" };
}

export function sqliteWalCheckpointRestoreInput(
  input: Omit<StatefulDatabaseRestoreInput, "database" | "stateModel">,
): StatefulDatabaseRestoreInput {
  return { ...input, database: "sqlite", stateModel: "wal-checkpoint" };
}

// fallow-ignore-next-line complexity
function classifyStatefulDatabaseRefusal(input: StatefulDatabaseRestoreInput):
  | {
      code: StatefulDatabaseRestoreRefusalCode;
      remediation: string;
      verifierResult: "failed" | "not-run";
    }
  | undefined {
  if (input.database === "postgresql") {
    return postgresRefusal(input);
  }
  return sqliteRefusal(input);
}

// fallow-ignore-next-line complexity
function postgresRefusal(input: StatefulDatabaseRestoreInput):
  | {
      code: StatefulDatabaseRestoreRefusalCode;
      remediation: string;
      verifierResult: "failed" | "not-run";
    }
  | undefined {
  const pg = input.postgres ?? {};
  if ((pg.activeTransactions ?? 0) > 0) {
    return refused(
      "postgres-active-transaction-unsupported",
      "Commit or roll back active PostgreSQL transactions, then capture a fresh logical dump.",
    );
  }
  if ((pg.activeSessions ?? 0) > 0) {
    return refused(
      "postgres-active-session-unsupported",
      "Drain active PostgreSQL client sessions before capture so no client observes ambiguous continuity.",
    );
  }
  if (pg.dirtyWal === true) {
    return refused(
      "postgres-dirty-wal-boundary-unsupported",
      "Checkpoint WAL and capture through the logical dump model instead of dirty WAL bytes.",
    );
  }
  if (pg.hostMountedDataDir === true) {
    return refused(
      "postgres-host-mounted-data-dir-ambiguous",
      "Use a guest-owned data directory or provide an immutable host-mount provenance model before capture.",
    );
  }
  if (pg.physicalDataDirCopy === true) {
    return refused(
      "postgres-physical-data-dir-cross-isa-unsupported",
      "Use pg_dump/pg_restore logical state; physical data-directory and WAL byte-copy is not portable restore.",
    );
  }
  if (pg.extensionNativeState === true) {
    return refused(
      "postgres-extension-native-state-unsupported",
      "Remove or model extension/plugin native-library state before claiming portable restore.",
    );
  }
  if (input.targetVerifierOutput !== input.sourceVerifierOutput) {
    return refused(
      "postgres-target-verifier-mismatch",
      "Run the target-native verifier after logical restore and require it to match the source verifier output.",
      "failed",
    );
  }
  return undefined;
}

function sqliteRefusal(input: StatefulDatabaseRestoreInput):
  | {
      code: StatefulDatabaseRestoreRefusalCode;
      remediation: string;
      verifierResult: "failed" | "not-run";
    }
  | undefined {
  const sqlite = input.sqlite ?? {};
  if (sqlite.dirtyRollbackJournal === true) {
    return refused(
      "sqlite-dirty-rollback-journal-unsupported",
      "Close or recover the SQLite rollback journal before capture; hot journals are outside this model.",
    );
  }
  if (sqlite.dirtyWal === true) {
    return refused(
      "sqlite-dirty-wal-checkpoint-unsupported",
      "Run a supported WAL checkpoint before capture so WAL bytes are inside the modeled artifact.",
    );
  }
  if (sqlite.activeWriterTransaction === true) {
    return refused(
      "sqlite-active-writer-transaction-unsupported",
      "Commit or roll back the active SQLite writer transaction before capture.",
    );
  }
  if (sqlite.mmapOrLockState === true) {
    return refused(
      "sqlite-mmap-or-lock-state-unsupported",
      "Disable or drain mmap/lock state before capture, or add a descriptor for that state.",
    );
  }
  if (input.targetVerifierOutput !== input.sourceVerifierOutput) {
    return refused(
      "sqlite-target-verifier-mismatch",
      "Run the target-native SQLite verifier and require it to match the source verifier output.",
      "failed",
    );
  }
  return undefined;
}

function refused(
  code: StatefulDatabaseRestoreRefusalCode,
  remediation: string,
  verifierResult: "failed" | "not-run" = "not-run",
) {
  return { code, remediation, verifierResult };
}

// fallow-ignore-next-line complexity
function evidenceFor(input: StatefulDatabaseRestoreInput): Record<string, unknown> {
  if (input.database === "postgresql") {
    return {
      checkpointLsn: input.postgres?.checkpointLsn,
      activeTransactions: input.postgres?.activeTransactions ?? 0,
      activeSessions: input.postgres?.activeSessions ?? 0,
      dirtyWal: input.postgres?.dirtyWal === true,
      hostMountedDataDir: input.postgres?.hostMountedDataDir === true,
      physicalDataDirCopy: input.postgres?.physicalDataDirCopy === true,
      extensionNativeState: input.postgres?.extensionNativeState === true,
      sourceVerifierOutputSha256: sha256(input.sourceVerifierOutput),
      targetVerifierOutputSha256: sha256(input.targetVerifierOutput),
    };
  }
  return {
    journalPolicy: input.sqlite?.journalPolicy,
    dirtyRollbackJournal: input.sqlite?.dirtyRollbackJournal === true,
    dirtyWal: input.sqlite?.dirtyWal === true,
    activeWriterTransaction: input.sqlite?.activeWriterTransaction === true,
    mmapOrLockState: input.sqlite?.mmapOrLockState === true,
    sourceVerifierOutputSha256: sha256(input.sourceVerifierOutput),
    targetVerifierOutputSha256: sha256(input.targetVerifierOutput),
  };
}

function shortcutInspection(): StatefulDatabaseRestoreSummary["shortcutInspection"] {
  return {
    sourceIsaEmulationUsed: false,
    sourceTextReusedAsTargetCode: false,
    sidecarRuntimeUsed: false,
    metadataOnlyShortcutAccepted: false,
  };
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
