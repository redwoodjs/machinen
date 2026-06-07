# Stateful database portable restore

Stateful database profiles are Level 2 semantic continuation / logical restore
proofs. They preserve durable database meaning through explicit artifacts and
verifiers. They do not teleport a live PostgreSQL or SQLite process.

## Machine-readable row shape

Each proof row uses:

```json
{
  "kind": "machinen.architecture-portable-snapshot.stateful-database-restore",
  "database": "postgresql",
  "stateModel": "logical-dump",
  "sourceArch": "arm64",
  "targetArch": "amd64",
  "databaseVersion": "PostgreSQL 16.3 fixture",
  "artifactDigest": "...",
  "logicalDataDigest": "...",
  "targetVerifierOutput": "postgres verifier: events=2 values=alpha,beta indexes=2",
  "migrationCompleted": true,
  "state": "completed",
  "targetVerifierResult": "passed"
}
```

`migrationCompleted=true` is only valid after target-native verification passes.
Refused rows use `migrationCompleted=false`, a stable `refusalCode`, and
`remediation`.

## PostgreSQL profile

Supported model: `logical-dump`.

The accepted PostgreSQL profile records:

- source and target architecture, including both `arm64 -> amd64` and
  `amd64 -> arm64` routes;
- PostgreSQL version;
- logical dump/checkpoint artifact digest;
- schema/data digest;
- checkpoint LSN evidence when available;
- target verifier output.

The verifier is the contract. For example, the fixture verifier checks that the
restored target still has two `events` rows, values `alpha,beta`, and the expected
indexes. If the target says `events=1` or has a different index result, the row
refuses with `postgres-target-verifier-mismatch`.

PostgreSQL refusals:

- `postgres-active-transaction-unsupported` — commit or roll back active
  transactions before capture.
- `postgres-active-session-unsupported` — drain client sessions that could
  observe ambiguous continuity.
- `postgres-dirty-wal-boundary-unsupported` — checkpoint WAL and use a logical
  dump instead of dirty WAL bytes.
- `postgres-host-mounted-data-dir-ambiguous` — use a guest-owned data directory
  or add immutable host-mount provenance.
- `postgres-physical-data-dir-cross-isa-unsupported` — physical data-directory
  and WAL byte-copy is not portable across ISAs.
- `postgres-extension-native-state-unsupported` — extension/plugin native state
  needs an explicit model before support.
- `postgres-target-verifier-mismatch` — target-native verification did not match
  the source verifier output.

## SQLite profiles

Supported models:

- `rollback-journal` after clean close;
- `wal-checkpoint` after an explicit checkpoint, such as
  `wal_checkpoint(TRUNCATE)`.

The accepted SQLite profiles record SQLite version, schema/data digest,
journal/WAL policy, source architecture, target architecture, artifact digest,
and target verifier output. For example, the fixture verifier checks two `items`
rows, names `alpha,beta`, and the expected index count.

SQLite refusals:

- `sqlite-dirty-rollback-journal-unsupported` — hot rollback journals are outside
  the clean close model.
- `sqlite-dirty-wal-checkpoint-unsupported` — dirty WAL must be checkpointed into
  the modeled artifact first.
- `sqlite-active-writer-transaction-unsupported` — commit or roll back the writer
  transaction before capture.
- `sqlite-mmap-or-lock-state-unsupported` — mmap and lock state need their own
  descriptor before support.
- `sqlite-target-verifier-mismatch` — target-native verification did not match
  the source verifier output.

## What this proves

The smoke proves that Machinen can produce machine-readable Level 2 rows for:

- PostgreSQL logical restore in both architecture directions;
- SQLite rollback-journal restore;
- SQLite WAL-checkpoint restore;
- stable PostgreSQL and SQLite refusal rows.

## What this does not prove

This does not preserve a live database process, backend PIDs, shared buffers,
locks, active client sockets, prepared transactions, extension-private native
memory, mmap state, or dirty WAL/journal bytes. It does not run a real PostgreSQL
server or SQLite CLI in the smoke; the smoke is a deterministic product-contract
fixture. Use the broader stateful-services smoke when real local database tools
are required.

## Running the smoke

```sh
pnpm run proof-stateful-database-portable-restore
```

The smoke writes a summary with four completed rows and twelve refusal rows.
