import { describe, expect, it } from "vitest";

import {
  buildStatefulDatabaseRestoreSummary,
  postgresLogicalRestoreInput,
  sqliteRollbackJournalRestoreInput,
  sqliteWalCheckpointRestoreInput,
} from "../stateful-database-restore.ts";

const pgBase = {
  sourceArch: "arm64" as const,
  targetArch: "amd64" as const,
  databaseVersion: "PostgreSQL 16.3",
  artifactBytes: "pg_dump: create table events(id int primary key, value text);",
  logicalData: "schema:events;rows:2;indexes:events_pkey",
  sourceVerifierOutput: "events=2;sum=3;index=events_pkey",
  targetVerifierOutput: "events=2;sum=3;index=events_pkey",
  postgres: { checkpointLsn: "0/16B6C50" },
};

const sqliteBase = {
  sourceArch: "amd64" as const,
  targetArch: "arm64" as const,
  databaseVersion: "SQLite 3.45.1",
  artifactBytes: "sqlite database bytes",
  logicalData: "schema=items;rows=2;index=items_name",
  sourceVerifierOutput: "items=2;checksum=7f",
  targetVerifierOutput: "items=2;checksum=7f",
};

describe("stateful database portable restore summaries", () => {
  it("completes PostgreSQL logical restore in both architecture directions", () => {
    expect(buildStatefulDatabaseRestoreSummary(postgresLogicalRestoreInput(pgBase))).toMatchObject({
      kind: "machinen.architecture-portable-snapshot.stateful-database-restore",
      database: "postgresql",
      stateModel: "logical-dump",
      sourceArch: "arm64",
      targetArch: "amd64",
      migrationCompleted: true,
      targetVerifierResult: "passed",
      state: "completed",
    });
    expect(
      buildStatefulDatabaseRestoreSummary(
        postgresLogicalRestoreInput({ ...pgBase, sourceArch: "amd64", targetArch: "arm64" }),
      ),
    ).toMatchObject({
      sourceArch: "amd64",
      targetArch: "arm64",
      migrationCompleted: true,
    });
  });

  it("refuses PostgreSQL unsafe states with migrationCompleted=false", () => {
    for (const [postgres, refusalCode] of [
      [{ activeTransactions: 1 }, "postgres-active-transaction-unsupported"],
      [{ activeSessions: 1 }, "postgres-active-session-unsupported"],
      [{ dirtyWal: true }, "postgres-dirty-wal-boundary-unsupported"],
      [{ hostMountedDataDir: true }, "postgres-host-mounted-data-dir-ambiguous"],
      [{ physicalDataDirCopy: true }, "postgres-physical-data-dir-cross-isa-unsupported"],
      [{ extensionNativeState: true }, "postgres-extension-native-state-unsupported"],
    ] as const) {
      expect(
        buildStatefulDatabaseRestoreSummary(postgresLogicalRestoreInput({ ...pgBase, postgres })),
      ).toMatchObject({ state: "refused", migrationCompleted: false, refusalCode });
    }
    expect(
      buildStatefulDatabaseRestoreSummary(
        postgresLogicalRestoreInput({ ...pgBase, targetVerifierOutput: "wrong" }),
      ),
    ).toMatchObject({
      state: "refused",
      migrationCompleted: false,
      targetVerifierResult: "failed",
      refusalCode: "postgres-target-verifier-mismatch",
    });
  });

  it("completes SQLite rollback-journal and WAL-checkpoint profiles", () => {
    expect(
      buildStatefulDatabaseRestoreSummary(
        sqliteRollbackJournalRestoreInput({
          ...sqliteBase,
          sqlite: { journalPolicy: "rollback-clean-close" },
        }),
      ),
    ).toMatchObject({
      database: "sqlite",
      stateModel: "rollback-journal",
      migrationCompleted: true,
      targetVerifierResult: "passed",
    });
    expect(
      buildStatefulDatabaseRestoreSummary(
        sqliteWalCheckpointRestoreInput({
          ...sqliteBase,
          sqlite: { journalPolicy: "wal-checkpoint-truncate" },
        }),
      ),
    ).toMatchObject({
      database: "sqlite",
      stateModel: "wal-checkpoint",
      migrationCompleted: true,
      targetVerifierResult: "passed",
    });
  });

  it("refuses SQLite dirty or in-flight state and verifier mismatches", () => {
    for (const [sqlite, refusalCode] of [
      [{ dirtyRollbackJournal: true }, "sqlite-dirty-rollback-journal-unsupported"],
      [{ dirtyWal: true }, "sqlite-dirty-wal-checkpoint-unsupported"],
      [{ activeWriterTransaction: true }, "sqlite-active-writer-transaction-unsupported"],
      [{ mmapOrLockState: true }, "sqlite-mmap-or-lock-state-unsupported"],
    ] as const) {
      expect(
        buildStatefulDatabaseRestoreSummary(
          sqliteRollbackJournalRestoreInput({ ...sqliteBase, sqlite }),
        ),
      ).toMatchObject({ state: "refused", migrationCompleted: false, refusalCode });
    }
    expect(
      buildStatefulDatabaseRestoreSummary(
        sqliteWalCheckpointRestoreInput({ ...sqliteBase, targetVerifierOutput: "wrong" }),
      ),
    ).toMatchObject({
      state: "refused",
      migrationCompleted: false,
      targetVerifierResult: "failed",
      refusalCode: "sqlite-target-verifier-mismatch",
    });
  });
});
