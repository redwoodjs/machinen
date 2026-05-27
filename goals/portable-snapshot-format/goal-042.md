# Goal 42: Go quiescent runtime support expansion

Parent context: Goals 39-40 proved a minimal Go cross-architecture envelope and
bounded quiescent goroutine/channel/timer boundary, while keeping arbitrary Go
scheduler, netpoll, and cgo states refused.

## Objective

Expand Go support from a single bounded scheduler fixture into a small suite of
production-shaped, quiescent Go runtime states that can be verified
bidirectionally across `arm64 <-> amd64` without source-ISA emulation, source
text replay, sidecar runtime success, app hooks, or metadata-only shortcuts.

## Requirements

- [x] Add audited Go fixtures for: - quiesced HTTP service restore/recreate policy; - drained worker pool; - drained channels; - deterministic timers; - static no-cgo target-native binaries.
- [x] Define and enforce a Go quiescence contract: - no goroutine blocked on channel send/receive; - no pending `select` race; - no active netpoll waiters; - timers are stopped, expired, or serializable; - no cgo; - no runtime-private stack continuation is required.
- [x] Prove every positive subset with bidirectional `arm64 <-> amd64` routes,
      repeated semantic fingerprints, and `migrationCompleted=true`.
- [x] Keep unsafe neighbors refused with stable codes and
      `migrationCompleted=false`: - active netpoll sockets; - channel waiters; - select races; - cgo goroutines; - runtime-private frames; - arbitrary scheduler queues.
- [x] Update runtime manifests, proof profiles, checked summaries, docs, and
      matrix presets.
- [x] Existing Goal 40 boundaries, non-Node matrices, Node matrix, refusal
      matrix, and foundation matrix continue to pass.

## Required final validation

Run and record timing for:

- [x] Go quiescent runtime support smoke;
- [x] Go quiescent cross-architecture smoke;
- [x] Go quiescent matrix;
- [x] Goal 40 hard-state matrix;
- [x] full runtime support matrix;
- [x] full refusal matrix;
- [x] full foundation matrix;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs`;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`.

## Completion record

Completed with `scripts/go-quiescent-runtime-proof.mjs`, `scripts/smoke/go-quiescent-runtime.sh`, checked summaries in `docs/snapshot/checked-summaries/go-quiescent-runtime/`, proof profiles, matrix presets, Go runtime manifest updates, and `docs/snapshot/go-quiescent-runtime-claims.md`. Final validation passed on 2026-05-25.
