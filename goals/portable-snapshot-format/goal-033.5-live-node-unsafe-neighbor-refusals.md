# Goal 33.5: Live Node unsafe-neighbor refusals

Parent: [Goal 33](./goal-033.md). Can proceed after the live capture and bundle
paths from Goals 33.1 and 33.2 are available; should be reconciled with Goal 33.4
positive support.

## Objective

Add live negative proofs for unsafe Node states that cannot be restored safely in
the current support envelope. Completion means unsupported live Node states refuse
with stable codes and `migrationCompleted=false` instead of passing through
metadata-only, replay, sidecar, hook, or emulation paths.

## Required refusal families

- [x] Active unresolved source-only libuv handles.
- [x] Opaque V8/JIT frames.
- [x] Unsupported native addon ABI mismatch.
- [x] Unverified active network connections.
- [x] Stale package/module graph.
- [x] Source text replay attempt.
- [x] Sidecar runtime attempt.
- [x] Source ISA emulation attempt.
- [x] App hook / loader hook dependency.
- [x] Child process state, if not restored by Goal 33.6.
- [x] Inspector/debug session state, if not restored by Goal 33.6.

## Requirements

- [x] Each refusal has a live source fixture or live captured descriptor.
- [x] Each refusal records the unsafe state that caused refusal.
- [x] Each refusal has a stable `expectedRefusalCode`.
- [x] Each refusal reports `migrationCompleted=false`.
- [x] Each refusal reports whether descriptor validation failed, target restore
      planning failed, or target VM restore refused.
- [x] Refusal summaries must not report target output success.
- [x] Refusal summaries must not claim `migrationCompleted=true`.
- [x] Refusal tests must fail if a forbidden shortcut path turns the refusal into
      a success.

## Tests and validation

- [x] `node-live-refusal` matrix preset.
- [x] Per-family focused tests for stable refusal codes.
- [x] Checked summaries for refusal profiles.
- [x] Full Node matrix includes positive live restore profiles and refusal
      neighbors.
- [x] Full refusal matrix.
- [x] Full foundation matrix.
- [x] `pnpm run format:check`.
- [x] `pnpm run lint`.
- [x] `pnpm run build:docs`.
- [x] `pnpm run typecheck`.
- [x] Focused Vitest coverage.
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` if refusal runner logic is
      broad.
- [x] `pnpm exec fallow audit --changed-since origin/main`.
- [x] `git diff --check`.

## Completion criteria

Goal 33.5 is complete when every tracked unsafe live Node neighbor either has a
working positive restore in another Goal 33 phase or a live negative proof with a
stable refusal code and `migrationCompleted=false`.

## Completion note

Completed as part of umbrella Goal 33 one-shot execution. See
[Goal 33 completion validation record](./goal-033.md#goal-33-completion-validation-record)
for route-level and final validation evidence.
