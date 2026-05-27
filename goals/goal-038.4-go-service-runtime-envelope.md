# Goal 38.4: Go service/runtime envelope

Parent: [Goal 38](./goal-038.md).

## Objective

Evaluate Go service portable restore behavior, including goroutines, runtime
scheduler, netpoller, TLS, static/dynamic binaries, and cgo boundaries.

## Requirements

- [x] Add an audited local Go service fixture with HTTP routes, goroutines,
      timers, channels, TLS policy, persistence/file state, and config.
- [x] Record Go version, architecture, module graph, binary build mode,
      static/dynamic linkage, cgo usage, goroutine inventory, scheduler/netpoller
      policy, and TLS/crypto state.
- [x] Support or refuse goroutine stack/scheduler state, channel/select state,
      active netpoller sockets, TLS sessions, cgo/native state, and open file/DB
      state.
- [x] Prove target-native restore for supported subsets or stable refusal with
      `migrationCompleted=false`.
- [x] Cover static vs dynamic binary boundaries and cgo/no-cgo policy.

## Validation

- [x] Go service support-or-refusal smoke.
- [x] Go unsafe-neighbor refusal matrix.
- [x] Runtime manifest and checked summaries.
- [x] Target-native binary/linkage inspection.
- [x] Relevant static checks from Goal 38.

## Completion criteria

Complete when Go service behavior is either proven for a concrete subset or
fail-closed with stable goroutine/netpoller/TLS/cgo refusal codes.

## Completion record

Completed with `scripts/non-node-runtime-proof.mjs`, `scripts/smoke/non-node-runtime-proof.sh`, non-Node checked summaries, runtime manifest updates, proof profiles, matrix presets, and user guidance in `docs/snapshot/non-node-runtime-restore-claims.md`. Final validation passed on 2026-05-25.
