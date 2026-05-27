# Goal 40: Hard runtime-state boundaries beyond current non-Node proofs

Parent context: Goals 38-39 established local and cross-architecture proof-backed
non-Node envelopes for Python and Go, plus fail-closed JVM/Ruby boundaries. Goal
40 defines the next hard-state investigations that are intentionally not claimed
today.

## Objective

Evaluate whether Machinen can safely support, or must continue to fail closed
for, the hardest managed/native runtime states that remain outside the current
portable restore envelope:

- live preservation of active sockets and TLS sessions;
- opaque native extension state across cgo, JNI, native gems, and C extensions;
- arbitrary Go goroutine scheduler state.

The goal is complete only when each linked subgoal has concrete audited fixtures,
proof profiles, checked summaries, stable refusal codes where needed, docs, and
validation.

## Phased subgoals

Complete these linked subgoals before marking Goal 40 complete:

- [x] [Goal 40.1: Live active socket and TLS session preservation](./goal-040.1-active-socket-tls-session-preservation.md)
      — prove a narrow reconnect/resume/preserve policy or fail closed for
      active TCP, HTTP keep-alive, WebSocket, and TLS session state.
- [x] [Goal 40.2: Opaque native extension state boundaries](./goal-040.2-opaque-native-extension-state-boundaries.md)
      — prove explicit-contract native state or stable refusal for cgo, JNI,
      Ruby native gems, and Python C extensions.
- [x] [Goal 40.3: Arbitrary Go goroutine scheduler state](./goal-040.3-go-arbitrary-goroutine-scheduler-state.md)
      — prove a bounded goroutine continuation subset or stable refusal for
      scheduler queues, parked goroutines, channel/select races, timers, and
      stack growth.

## Umbrella completion criteria

- [x] Each subgoal has at least one audited fixture and one unsafe-neighbor
      refusal fixture.
- [x] Positive profiles, if any, reach `migrationCompleted=true` only through
      target-native restore paths.
- [x] Refusals use stable codes and keep `migrationCompleted=false`.
- [x] No source-ISA emulation, source-text replay, sidecar runtime, app hook, or
      metadata-only shortcut is accepted as support.
- [x] Runtime manifests, proof profiles, checked summaries, support-envelope
      docs, and user guidance are updated.
- [x] Cross-architecture routes are included when the state is claimed portable.
- [x] Existing Node, refusal, foundation, runtime-support, and non-Node matrices
      continue to pass.

## Required final validation

Run and record timing for:

- [x] active socket/TLS preservation-or-refusal smoke;
- [x] opaque native extension support-or-refusal smoke;
- [x] Go arbitrary goroutine scheduler support-or-refusal smoke;
- [x] relevant cross-architecture smoke routes;
- [x] full runtime support matrix;
- [x] full refusal matrix;
- [x] full foundation matrix;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs`;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`;
- [x] full VM smoke tests if VM, rootfs, CLI, live mount, or restore runtime
      implementation behavior changes.

## Completion record

Completed with `scripts/goal40-hard-runtime-state-proof.mjs`, `scripts/smoke/goal40-hard-runtime-state.sh`, checked summaries in `docs/snapshot/checked-summaries/goal40-hard-state/`, proof profiles, matrix presets, runtime manifest updates, and `docs/snapshot/hard-runtime-state-boundaries.md`. Final validation passed on 2026-05-25.
