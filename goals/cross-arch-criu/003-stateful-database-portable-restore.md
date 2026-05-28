# Goal 003: Stateful database portable restore proof

Parent: [`FINAL-GOAL.md`](./FINAL-GOAL.md)

## Motivation

Stateful databases are the practical credibility bar for CRIU-like restore. A
service can restart, but users care whether durable data, schema, indexes, and
transaction boundaries survive honestly across architectures.

This goal places PostgreSQL and SQLite in the roadmap: they are **Level 2
semantic continuation / logical restore** profiles, not live process teleportation.

## Objective

Prove stateful database workloads cross architectures through explicit portable
state models and target-native verification.

Required database families:

- PostgreSQL clean/quiesced logical portable restore;
- SQLite rollback-journal and WAL-checkpoint restore.

## PostgreSQL required support

- [x] `amd64 -> arm64` logical restore.
- [x] `arm64 -> amd64` logical restore.
- [x] Record PostgreSQL version.
- [x] Record schema/data digest.
- [x] Record dump/checkpoint digest.
- [x] Record source architecture.
- [x] Record target architecture.
- [x] Record target verifier output.
- [x] Report `migrationCompleted=true` only after target-native verification.

## PostgreSQL required refusals

Refuse with `migrationCompleted=false` and stable product-visible codes for:

- [x] active transaction;
- [x] active session that could observe continuity ambiguity;
- [x] dirty WAL / uncheckpointed durable state outside the logical model;
- [x] host-mounted data directory without safe provenance;
- [x] physical data-directory/WAL byte-copy when logical restore is required;
- [x] verifier mismatch;
- [x] extension/plugin/native-library ambiguity.

## SQLite required support

- [x] Rollback-journal restore with target-native verifier.
- [x] WAL-checkpoint restore with target-native verifier.
- [x] Record SQLite version.
- [x] Record schema/data digest.
- [x] Record journal/WAL policy.
- [x] Record source and target architecture.

## SQLite required refusals

Refuse with stable wording for:

- [x] dirty rollback journal outside supported policy;
- [x] dirty WAL outside supported checkpoint policy;
- [x] active writer transaction;
- [x] mmap or lock state that cannot be modeled;
- [x] verifier mismatch.

## Machine-readable output

Each row must include:

- `kind: machinen.cross-arch-criu.stateful-database-restore`
- `database: postgresql | sqlite`
- `stateModel: logical-dump | checkpoint | rollback-journal | wal-checkpoint`
- `sourceArch`
- `targetArch`
- `databaseVersion`
- `artifactDigest`
- `logicalDataDigest`
- `targetVerifierOutput`
- `migrationCompleted`
- refusal code/remediation when refused

## Tests and smokes

- [x] PostgreSQL positive bidirectional smoke.
- [x] PostgreSQL refusal smoke matrix.
- [x] SQLite rollback-journal positive smoke.
- [x] SQLite WAL-checkpoint positive smoke.
- [x] SQLite dirty/in-flight refusal smoke.
- [x] Unit tests for summary and refusal classification.

## Documentation

- [x] Explain why this is semantic continuation, not live Postgres/SQLite process
      teleportation.
- [x] Explain supported clean/quiesced states.
- [x] Explain remediation for active transactions, dirty WAL, and host mounts.

## Validation

Run and record timing for:

- [x] stateful database smokes;
- [x] product claim matrix;
- [x] relevant unit tests;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run typecheck`;
- [x] `pnpm exec fallow audit --changed-since origin/main`.
