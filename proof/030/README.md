# Proof 030 — VM-pause atomic source capture

## TL;DR

Replace process-only `SIGSTOP` capture with whole-VM pause capture for the proper Node proof track. This is **not** full restore by itself. It is a cleaner external quiesce point so process memory, registers, `/proc`, fd tables, and socket state are captured from one frozen machine instant.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/030/`. The proof smoke test may be written in TypeScript, for example `proof/030/smoke.ts`, with an optional `proof/030/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proof/030/smoke.ts`.

## Goal

Prove that the source VM can be paused externally, captured, and unpaused while preserving the current proper Node source-state proof behavior. The target must still reconstruct target-native state from captured evidence. Active or ambiguous HTTP request state must still refuse.

## Tasks

- [ ] Add a proof-local VM pause/unpause capture flow around the existing Zig guest capture tool.
- [ ] Capture source process `/proc`, memory mappings, fd/socket state, and thread state while the VM is frozen.
- [ ] Record pause/resume evidence in the source-state IR.
- [ ] Prove the source VM resumes after capture and can still answer requests.
- [ ] Prove quiescent target-native reconstruction still returns `{count:3}`.
- [ ] Keep active in-flight HTTP request state refused; VM pause must not downgrade semantic safety rules.
- [ ] Assert no app hook, checkpoint API, selected-state descriptor, sidecar replay, source ISA emulation, or metadata-only success.

## Validation

- [ ] Run `pnpm exec tsx proof/030/smoke.ts`.
- [ ] Assert source returns `{count:1}`, `{count:2}` before pause capture.
- [ ] Assert source VM answers after unpause.
- [ ] Assert target returns `{count:3}` from target-native reconstruction.
- [ ] Assert capture evidence says `externalQuiesce.method = "vm-pause"` or equivalent.
- [ ] Assert active request capture still refuses.
- [ ] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
