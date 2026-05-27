# Goal 38.2: Python Django/Celery-style envelope

Parent: [Goal 38](./goal-038.md).

## Objective

Evaluate Python web/worker portable restore behavior using an audited local
Django/Celery-style fixture without relying on live third-party installs.

## Requirements

- [x] Add an audited local Python fixture with web routes, ORM/database-style
      persistence, background worker/task queue behavior, config, and import
      graph complexity.
- [x] Record Python version, architecture, virtualenv/site-packages model,
      import graph, bytecode/cache policy, GIL/thread state, async/task state,
      and database/session state.
- [x] Support or refuse C-extension/native module state, pickle/serializer state,
      pending tasks, async loop state, DB transactions, file locks, and external
      broker state.
- [x] Prove target-native restore for supported subsets or stable refusal with
      `migrationCompleted=false`.
- [x] Avoid live third-party package install/execute paths unless separately
      approved.

## Validation

- [x] Python Django/Celery-style support-or-refusal smoke.
- [x] Python unsafe-neighbor refusal matrix.
- [x] Runtime manifest and checked summaries.
- [x] No-third-party-install sandbox evidence.
- [x] Relevant static checks from Goal 38.

## Completion criteria

Complete when Python web/worker behavior is either proven for a concrete subset
or fail-closed with stable import/worker/C-extension/database refusal codes.

## Completion record

Completed with `scripts/non-node-runtime-proof.mjs`, `scripts/smoke/non-node-runtime-proof.sh`, non-Node checked summaries, runtime manifest updates, proof profiles, matrix presets, and user guidance in `docs/snapshot/non-node-runtime-restore-claims.md`. Final validation passed on 2026-05-25.
