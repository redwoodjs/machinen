#!/usr/bin/env tsx
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildStatefulDatabaseRestoreSummary,
  postgresLogicalRestoreInput,
  sqliteRollbackJournalRestoreInput,
  sqliteWalCheckpointRestoreInput,
  type StatefulDatabaseRestoreSummary,
} from "../packages/runtime/src/index.ts";

interface Options {
  json: boolean;
  summary?: string;
}

function usage(): never {
  console.error(
    "usage: tsx scripts/stateful-database-portable-restore.ts [--json] [--summary file]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const pending = [...argv];
  const options: Options = { json: false };
  while (pending.length > 0) {
    const arg = pending.shift();
    switch (arg) {
      case "--json":
        options.json = true;
        break;
      case "--summary":
        options.summary = requiredValue(pending.shift());
        break;
      default:
        usage();
    }
  }
  return options;
}

function requiredValue(value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) {
    usage();
  }
  return value;
}

const postgresFixture = {
  databaseVersion: "PostgreSQL 16.3 fixture",
  artifactBytes:
    "pg_dump --format=plain: create table events(id integer primary key, value text); insert two rows; create index events_value_idx;",
  logicalData: "postgres schema=events rows=2 indexes=events_pkey,events_value_idx",
  sourceVerifierOutput: "postgres verifier: events=2 values=alpha,beta indexes=2",
  targetVerifierOutput: "postgres verifier: events=2 values=alpha,beta indexes=2",
  postgres: { checkpointLsn: "0/16B6C50" },
};

const sqliteFixture = {
  databaseVersion: "SQLite 3.45.1 fixture",
  artifactBytes:
    "sqlite db bytes: create table items(id integer primary key, name text); insert two rows; create index items_name_idx;",
  logicalData: "sqlite schema=items rows=2 indexes=items_name_idx",
  sourceVerifierOutput: "sqlite verifier: items=2 names=alpha,beta indexes=1",
  targetVerifierOutput: "sqlite verifier: items=2 names=alpha,beta indexes=1",
};

function postgresPositiveRows(): StatefulDatabaseRestoreSummary[] {
  return [
    buildStatefulDatabaseRestoreSummary(
      postgresLogicalRestoreInput({
        ...postgresFixture,
        sourceArch: "arm64",
        targetArch: "amd64",
      }),
    ),
    buildStatefulDatabaseRestoreSummary(
      postgresLogicalRestoreInput({
        ...postgresFixture,
        sourceArch: "amd64",
        targetArch: "arm64",
      }),
    ),
  ];
}

function postgresRefusalRows(): StatefulDatabaseRestoreSummary[] {
  return [
    { activeTransactions: 1 },
    { activeSessions: 1 },
    { dirtyWal: true },
    { hostMountedDataDir: true },
    { physicalDataDirCopy: true },
    { extensionNativeState: true },
  ]
    .map((postgres) =>
      buildStatefulDatabaseRestoreSummary(
        postgresLogicalRestoreInput({
          ...postgresFixture,
          sourceArch: "arm64",
          targetArch: "amd64",
          postgres,
        }),
      ),
    )
    .concat(
      buildStatefulDatabaseRestoreSummary(
        postgresLogicalRestoreInput({
          ...postgresFixture,
          sourceArch: "arm64",
          targetArch: "amd64",
          targetVerifierOutput: "postgres verifier: wrong target result",
        }),
      ),
    );
}

function sqlitePositiveRows(): StatefulDatabaseRestoreSummary[] {
  return [
    buildStatefulDatabaseRestoreSummary(
      sqliteRollbackJournalRestoreInput({
        ...sqliteFixture,
        sourceArch: "arm64",
        targetArch: "amd64",
        sqlite: { journalPolicy: "rollback-clean-close" },
      }),
    ),
    buildStatefulDatabaseRestoreSummary(
      sqliteWalCheckpointRestoreInput({
        ...sqliteFixture,
        sourceArch: "amd64",
        targetArch: "arm64",
        sqlite: { journalPolicy: "wal-checkpoint-truncate" },
      }),
    ),
  ];
}

function sqliteRefusalRows(): StatefulDatabaseRestoreSummary[] {
  return [
    { dirtyRollbackJournal: true },
    { dirtyWal: true },
    { activeWriterTransaction: true },
    { mmapOrLockState: true },
  ]
    .map((sqlite) =>
      buildStatefulDatabaseRestoreSummary(
        sqliteRollbackJournalRestoreInput({
          ...sqliteFixture,
          sourceArch: "arm64",
          targetArch: "amd64",
          sqlite,
        }),
      ),
    )
    .concat(
      buildStatefulDatabaseRestoreSummary(
        sqliteWalCheckpointRestoreInput({
          ...sqliteFixture,
          sourceArch: "arm64",
          targetArch: "amd64",
          targetVerifierOutput: "sqlite verifier: wrong target result",
        }),
      ),
    );
}

// fallow-ignore-next-line complexity
function validateRows(rows: StatefulDatabaseRestoreSummary[]): string[] {
  const failures: string[] = [];
  const completed = rows.filter((row) => row.state === "completed");
  const refused = rows.filter((row) => row.state === "refused");
  if (completed.length !== 4) {
    failures.push(`expected 4 completed rows, got ${completed.length}`);
  }
  if (refused.length !== 12) {
    failures.push(`expected 12 refusal rows, got ${refused.length}`);
  }
  if (
    completed.some(
      (row) => row.migrationCompleted !== true || row.targetVerifierResult !== "passed",
    )
  ) {
    failures.push("completed rows must have migrationCompleted=true after target verifier pass");
  }
  if (
    refused.some((row) => row.migrationCompleted !== false || !row.refusalCode || !row.remediation)
  ) {
    failures.push("refused rows must carry migrationCompleted=false, refusalCode, and remediation");
  }
  if (
    !completed.some(
      (row) =>
        row.database === "postgresql" && row.sourceArch === "arm64" && row.targetArch === "amd64",
    )
  ) {
    failures.push("missing PostgreSQL arm64 -> amd64 row");
  }
  if (
    !completed.some(
      (row) =>
        row.database === "postgresql" && row.sourceArch === "amd64" && row.targetArch === "arm64",
    )
  ) {
    failures.push("missing PostgreSQL amd64 -> arm64 row");
  }
  if (
    !completed.some((row) => row.database === "sqlite" && row.stateModel === "rollback-journal")
  ) {
    failures.push("missing SQLite rollback-journal row");
  }
  if (!completed.some((row) => row.database === "sqlite" && row.stateModel === "wal-checkpoint")) {
    failures.push("missing SQLite WAL-checkpoint row");
  }
  return failures;
}

const options = parseArgs(process.argv.slice(2));
const rows = [
  ...postgresPositiveRows(),
  ...postgresRefusalRows(),
  ...sqlitePositiveRows(),
  ...sqliteRefusalRows(),
];
const failures = validateRows(rows);
const summary = {
  kind: "machinen.architecture-portable-snapshot.stateful-database-restore-smoke",
  state: failures.length === 0 ? "completed" : "failed",
  pass: failures.length === 0,
  completedRows: rows.filter((row) => row.state === "completed").length,
  refusedRows: rows.filter((row) => row.state === "refused").length,
  rows,
  failures,
};

const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
if (options.summary) {
  writeFileSync(resolve(options.summary), summaryText);
}
process.stdout.write(
  options.json
    ? summaryText
    : `stateful database portable restore smoke: ${summary.state} completed=${summary.completedRows} refused=${summary.refusedRows}\n`,
);
process.exit(summary.pass ? 0 : 1);
