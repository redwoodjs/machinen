# Stateful services restore claims

> **Status: proof-audit.** This is proof/refusal evidence only unless the product claim registry advertises a product route. Use `pnpm run proof-stateful-services` only with this status in mind.

Goal 44 adds a broad stateful-services proof matrix. Supported states are clean,
quiesced persistence artifacts verified by target-native logical checks. Unsafe
neighboring states remain stable refusals.

## Validated smoke

```bash
pnpm run proof-stateful-services -- --keep --work-dir /tmp/goal44-stateful
```

The smoke writes checked summaries to a work directory. The committed summaries
live in `docs/snapshot/checked-summaries/stateful-services/`.

## Supported subsets

- Redis 7 RDB/AOF clean restore after `SAVE`, AOF rewrite, and `appendfsync
always` boundary. Verifies strings, hashes, lists, and streams.
- SQLite rollback-journal clean restore. Verifies indexes, constraints, committed
  transactions, and deterministic query output.
- SQLite WAL restore after `wal_checkpoint(TRUNCATE)`.
- PostgreSQL expanded logical restore with multiple databases, schemas, indexes,
  constraints, sequences, views, and larger row counts.
- MariaDB 11.4 InnoDB logical restore after committed transaction plus
  `FLUSH TABLES`/`FLUSH LOGS` boundary.
- Durable JSONL queue fixture with persisted messages and ack log at a
  no-in-flight boundary.
- Filesystem-backed patterns: fsynced append-only log, fsynced atomic
  rename/checkpoint, and nested directory manifest restore.

All positive summaries require `migrationCompleted=true`, descriptor/resource
/verifier gates, and no source-ISA emulation, source text replay, sidecar runtime
success, app hooks, or metadata-only continuation.

## Refused unsafe neighbors

Goal 44 adds stable refusals for:

- Redis active clients, pub/sub, blocking commands, dirty AOF, replication,
  modules/native state, and host-mounted data dirs.
- SQLite active transactions, hot WAL, hot rollback journals, locks, mmap-backed
  ambiguity, unsynced data files, and host-mounted DB files.
- PostgreSQL prepared/session state, advisory locks, active transactions, dirty
  WAL, replication slots, extension/native plugin state, and host-mounted data
  dirs.
- MariaDB active transactions/sessions, dirty redo, replication/binlog ambiguity,
  plugin/native state, unsynced data dirs, and host-mounted data dirs.
- Durable queue in-flight deliveries, unacked messages, active consumers,
  ephemeral queues/subscriptions, cluster/replication state, plugin/native state,
  and host-mounted data dirs.
- Filesystem mmap dirty state, lock state, unsynced append/temp files, partial
  rename boundaries, host-mounted path ambiguity, and external watcher/inotify
  state.

Each refusal keeps `migrationCompleted=false` and `targetRestore.state=refused`.

## Matrix presets

```bash
node scripts/portable-machine-proof-matrix.mjs --preset stateful-services --check-summary-dir docs/snapshot/checked-summaries/stateful-services --json
node scripts/portable-machine-proof-matrix.mjs --preset stateful-services-positive --check-summary-dir docs/snapshot/checked-summaries/stateful-services --json
node scripts/portable-machine-proof-matrix.mjs --preset stateful-services-refusal --check-summary-dir docs/snapshot/checked-summaries/stateful-services --json
```

Focused presets are available for `stateful-redis`, `stateful-sqlite`,
`stateful-postgres`, `stateful-mariadb`, `stateful-queue`, and
`stateful-filesystem`.
