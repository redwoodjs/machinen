# Goal 43: PostgreSQL in-Machinen snapshot/restore proof

Parent context: Goals 34-42 established proof-backed runtime envelopes for Node,
non-Node runtimes, hard runtime-state boundaries, and expanded Go quiescent
support. Goal 43 moves from runtime-shaped fixtures to a real stateful database
service running inside Machinen.

## Objective

Run PostgreSQL inside a Machinen microVM, take a snapshot, restore it, and prove
which PostgreSQL states are portable and safe. The goal must distinguish clean,
quiesced database restore from unsafe states such as active client sessions,
unflushed WAL, in-flight transactions, replication slots, and dirty filesystem
state.

This goal is not complete with a documentation-only plan. It requires a real
Machinen PostgreSQL fixture, snapshot/restore execution, target verification,
checked summaries, stable refusal profiles for unsafe neighbors, docs, and
validation.

## Supported-state target

The first positive support claim should be narrow:

- PostgreSQL runs inside a Machinen VM from a pinned local fixture/image/rootfs
  path.
- Database is initialized from audited local SQL fixtures, with no network fetch
  or unpinned package install during proof execution.
- Workload performs create/insert/update/query operations.
- PostgreSQL reaches a quiesced checkpointed state before snapshot:
  - no active client transaction;
  - no active client connection that must survive restore;
  - WAL is flushed/checkpointed;
  - database files are synced;
  - postmaster state is either restored safely or service is restarted/reopened
    by an explicit target-native policy.
- Restore verifies the same logical database state on the target.
- Positive profiles reach `migrationCompleted=true` only after target-native
  verification.

## Unsafe-neighbor refusal target

Add stable refusal profiles for PostgreSQL states that are not safely portable:

- active client transaction at snapshot time;
- active query/session that must survive restore;
- dirty/uncheckpointed WAL state without a safe replay boundary;
- torn data directory or unsynced fs state;
- replication slot / logical decoding state not captured in the descriptor;
- hot standby/streaming replication connection;
- external extension/native plugin state without explicit contract;
- host-mounted data directory with ambiguous flush/ownership semantics.

Every refusal must keep `migrationCompleted=false`, report target state
`refused`, and reject source-ISA emulation, source text replay, sidecar runtime
success, app hooks, and metadata-only continuation.

## Requirements

- [x] Add an audited PostgreSQL fixture under `scripts/fixtures/` or equivalent
      local test asset with schema, seed data, workload, and verifier.
- [x] Add a smoke/proof script that boots PostgreSQL in Machinen, runs workload,
      snapshots, restores, and verifies logical database state.
- [x] Prove at least one clean/quiesced PostgreSQL snapshot/restore path with
      `migrationCompleted=true`.
- [x] Add stable refusal fixtures/profiles for unsafe PostgreSQL neighboring
      states listed above.
- [x] Capture PostgreSQL provenance: - PostgreSQL version; - architecture; - data directory digest or manifest; - WAL/checkpoint evidence; - init SQL digest; - workload digest; - target verifier output digest.
- [x] Document the exact supported subset and operational workflow for users.
- [x] Update proof profiles, checked summaries, docs, matrix presets, and tests.
- [x] If VM/rootfs/restore behavior changes, run full VM smoke tests.

## Required final validation

Run and record timing for:

- [x] PostgreSQL clean/quiesced snapshot/restore smoke;
- [x] PostgreSQL unsafe-neighbor refusal matrix;
- [x] PostgreSQL proof matrix preset;
- [x] full runtime support matrix if manifests change;
- [x] full refusal matrix;
- [x] full foundation matrix;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs` if docs/public API changed;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`;
- [x] `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` if VM,
      rootfs, CLI, snapshot/restore, or live mount behavior changes.

## Completion criteria

Complete when a real PostgreSQL service running in Machinen has a verified
snapshot/restore proof for a clean/quiesced subset, unsafe neighboring states are
stable refusals, and the user-facing docs clearly explain how to use the
supported workflow and avoid unsupported database states.

## Completion record

Completed with `scripts/postgres-machinen-restore-proof.mjs`,
`scripts/smoke/postgres-machinen-restore.sh`, audited SQL fixtures in
`scripts/fixtures/postgres-machinen/`, checked summaries in
`docs/snapshot/checked-summaries/postgres-machinen/`, proof profiles, matrix
presets, tests, and `docs/snapshot/postgres-machinen-restore-claims.md`. Final
validation passed on 2026-05-27.
