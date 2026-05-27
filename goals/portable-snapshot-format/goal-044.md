# Goal 44: Stateful services snapshot/restore coverage matrix

Parent context: Goal 43 proved a real PostgreSQL clean/quiesced snapshot/restore
path inside Machinen. Goal 44 broadens that pattern across common stateful
services and filesystem-backed state patterns.

## Objective

Build a broad stateful-services proof matrix that covers clean/quiesced
snapshot/restore support and unsafe-neighbor refusals for production-shaped
services. Each supported subset must be verified by logical target checks, not by
metadata-only claims.

## Phased subgoals

Complete these linked subgoals before marking Goal 44 complete:

- [x] [Goal 44.1: Redis clean/quiesced restore](./goal-044.1-redis-clean-quiesced-restore.md)
      — prove Redis RDB/AOF clean restore and refuse active clients, pub/sub,
      dirty AOF, and ambiguous fsync states.
- [x] [Goal 44.2: SQLite WAL and rollback journal restore](./goal-044.2-sqlite-wal-rollback-restore.md)
      — prove SQLite rollback-journal and WAL checkpoint restore, and refuse
      active transactions, hot WAL, locks, and mmap ambiguity.
- [x] [Goal 44.3: PostgreSQL expanded repeatability](./goal-044.3-postgres-expanded-repeatability.md)
      — expand Goal 43 with repeatability, larger datasets, indexes, multiple
      databases/tables, prepared statement/session refusals, and host-mounted
      data-dir refusal proof.
- [x] [Goal 44.4: MySQL/MariaDB clean restore](./goal-044.4-mysql-mariadb-clean-restore.md)
      — prove a clean InnoDB checkpointed restore subset and refuse active
      transactions, redo-log ambiguity, replication, plugins, and dirty data
      directory states.
- [x] [Goal 44.5: Durable queue service boundaries](./goal-044.5-durable-queue-service-boundaries.md)
      — prove at least one durable queue clean restore subset and refuse
      in-flight deliveries, active consumers, ack ambiguity, and ephemeral queue
      states.
- [x] [Goal 44.6: Filesystem-backed state patterns](./goal-044.6-filesystem-backed-state-patterns.md)
      — prove append-only logs, atomic rename/checkpoint patterns, and directory
      manifest verification; refuse mmap, lockfile, unsynced, and host-mounted
      ambiguity.

## Umbrella completion criteria

- [x] Every service has an audited local fixture under `scripts/fixtures/` or an
      equivalent local test asset.
- [x] Each positive service profile reaches `migrationCompleted=true` only after
      target-native logical verification.
- [x] Each unsafe neighbor has a stable refusal code and keeps
      `migrationCompleted=false`.
- [x] No source-ISA emulation, source text replay, sidecar runtime success, app
      hooks, or metadata-only continuation is accepted as support.
- [x] Each service records provenance: version, architecture, fixture digest,
      workload digest, persistence/checkpoint evidence, data manifest, and target
      verifier digest.
- [x] Proof profiles, checked summaries, docs, matrix presets, tests, and user
      guidance are updated.
- [x] Existing Node, non-Node, Go, PostgreSQL, refusal, foundation, and runtime
      support matrices continue to pass.

## Required final validation

Run and record timing for:

- [x] Redis clean/quiesced restore smoke and refusal matrix;
- [x] SQLite WAL/rollback restore smoke and refusal matrix;
- [x] PostgreSQL expanded repeatability smoke and refusal matrix;
- [x] MySQL/MariaDB clean restore smoke and refusal matrix;
- [x] durable queue clean restore smoke and refusal matrix;
- [x] filesystem-backed state pattern smoke and refusal matrix;
- [x] stateful services aggregate matrix;
- [x] full runtime support matrix if manifests change;
- [x] full refusal matrix;
- [x] full foundation matrix;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs`;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`;
- [x] full VM smoke tests if VM/rootfs/CLI/snapshot/restore/live-mount behavior
      changes.

## Completion criteria

Complete when Machinen has a broad, proof-backed stateful service matrix with
clean/quiesced restore support for multiple real services and stable refusals for
in-flight or ambiguous state.
