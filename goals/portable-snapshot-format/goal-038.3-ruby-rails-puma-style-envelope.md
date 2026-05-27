# Goal 38.3: Ruby Rails/Puma-style envelope

Parent: [Goal 38](./goal-038.md).

## Objective

Evaluate Ruby Rails/Puma-style portable restore behavior with audited local
fixtures and stable refusal boundaries for dynamic Ruby runtime state.

## Requirements

- [x] Add an audited local Ruby fixture with Rails-like routing, ActiveRecord-like
      persistence, Puma-style threaded request handling, autoloading, and cache
      behavior.
- [x] Record Ruby version, architecture, gem graph, autoload/load path state,
      object heap/GC policy, fiber/thread state, native gem boundary, and
      database/session policy.
- [x] Support or refuse Bootsnap/cache drift, autoloading ambiguity, native gem
      state, thread/fiber scheduler state, open DB transactions, and file locks.
- [x] Prove target-native restore for supported subsets or stable refusal with
      `migrationCompleted=false`.
- [x] Avoid live third-party gem installs unless separately approved.

## Validation

- [x] Ruby Rails/Puma-style support-or-refusal smoke.
- [x] Ruby unsafe-neighbor refusal matrix.
- [x] Runtime manifest and checked summaries.
- [x] No-third-party-install sandbox evidence.
- [x] Relevant static checks from Goal 38.

## Completion criteria

Complete when Ruby Rails/Puma-style behavior is either proven for a concrete
subset or fail-closed with stable gem/autoload/thread/native refusal codes.

## Completion record

Completed with `scripts/non-node-runtime-proof.mjs`, `scripts/smoke/non-node-runtime-proof.sh`, non-Node checked summaries, runtime manifest updates, proof profiles, matrix presets, and user guidance in `docs/snapshot/non-node-runtime-restore-claims.md`. Final validation passed on 2026-05-25.
