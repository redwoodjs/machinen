# Goal 43: PostgreSQL cross-architecture restore proof

Parent context: Goals 34-42 established proof-backed runtime envelopes for Node,
non-Node runtimes, hard runtime-state boundaries, and expanded Go quiescent
support. Goal 43 moves from runtime-shaped fixtures to a real stateful database
service with a portable, cross-architecture restore contract.

## Objective

Run real PostgreSQL on arm64 and amd64, capture clean logical database state from
one architecture, restore it into target-native PostgreSQL on the other
architecture, and prove which PostgreSQL states are portable and safe. The goal
must distinguish clean, quiesced logical restore from unsafe states such as
active client sessions, unflushed WAL, in-flight transactions, replication slots,
dirty filesystem state, and physical data-directory byte-copy across
architectures.

This goal is not complete with a documentation-only plan. It requires a real
PostgreSQL fixture, bidirectional cross-architecture execution, target
verification, checked summaries, stable refusal profiles for unsafe neighbors,
docs, and validation.

## Supported-state target

The first positive support claim is narrow:

- PostgreSQL 15 runs target-natively on the source and target hosts.
- The default arm64 host is this MacBook Docker host (`--arm-host local`).
- The default amd64 host is the local Proxmox server
  (`--amd-host root@192.168.0.8`).
- Database is initialized from audited local SQL fixtures.
- Workload performs create/insert/update/query operations.
- PostgreSQL reaches a quiesced checkpointed state before capture:
  - no active client transaction;
  - no active client connection that must survive restore;
  - WAL/checkpoint boundary is recorded;
  - physical data-directory byte-copy is not used as the portable unit.
- Capture uses a target-neutral logical PostgreSQL dump/descriptor.
- Restore imports that logical state into target-native PostgreSQL on the other
  architecture.
- Both `arm64 -> amd64` and `amd64 -> arm64` routes verify the same logical
  database fingerprint.
- Positive profiles reach `migrationCompleted=true` only after target-native
  verification.

## Unsafe-neighbor refusal target

Add stable refusal profiles for PostgreSQL states that are not safely portable:

- active client transaction at capture time;
- active query/session that must survive restore;
- dirty/uncheckpointed WAL state without a safe replay boundary;
- torn data directory or unsynced fs state;
- replication slot / logical decoding state not captured in the descriptor;
- hot standby/streaming replication connection;
- external extension/native plugin state without explicit contract;
- host-mounted data directory with ambiguous flush/ownership semantics;
- physical data-directory/WAL byte-copy across architectures.

Every refusal must keep `migrationCompleted=false`, report target state
`refused`, and reject source-ISA emulation, source text replay, sidecar runtime
success, app hooks, and metadata-only continuation.

## Requirements

- [x] Add an audited PostgreSQL fixture under `scripts/fixtures/` or equivalent
      local test asset with schema, seed data, workload, and verifier.
- [x] Add a smoke/proof script that runs PostgreSQL on arm64 and amd64, runs the
      workload, captures a clean logical descriptor/dump, restores it on the
      opposite architecture, and verifies logical database state.
- [x] Prove bidirectional clean/quiesced PostgreSQL cross-architecture restore
      with `migrationCompleted=true`.
- [x] Add stable refusal fixtures/profiles for unsafe PostgreSQL neighboring
      states listed above.
- [x] Capture PostgreSQL provenance: source/target PostgreSQL versions,
      architectures, logical dump digest, checkpoint evidence, init SQL digest,
      workload digest, and target verifier output digest.
- [x] Document the exact supported subset and operational workflow for users.
- [x] Update proof profiles, checked summaries, docs, matrix presets, and tests.
- [x] If VM/rootfs/restore behavior changes, run full VM smoke tests.

## Required final validation

Run and record timing for:

- [x] PostgreSQL clean/quiesced cross-architecture restore smoke;
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

Complete when real PostgreSQL has a verified bidirectional arm64/amd64 logical
restore proof for a clean/quiesced subset, unsafe neighboring states are stable
refusals, and the user-facing docs clearly explain how to use the supported
workflow and avoid unsupported database states.

## Completion record

Completed with `scripts/postgres-cross-arch-restore-proof.mjs`,
`scripts/smoke/postgres-cross-arch-restore.sh`, audited SQL fixtures in
`scripts/fixtures/postgres-machinen/`, checked summaries in
`docs/snapshot/checked-summaries/postgres-machinen/`, proof profiles, matrix
presets, tests, and `docs/snapshot/postgres-machinen-restore-claims.md`. Final
validation passed on 2026-05-27.
