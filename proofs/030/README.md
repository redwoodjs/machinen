# Proof 030 — VM-pause atomic source capture

## TL;DR

Add a whole-VM pause boundary to the proper Node proof track before guest capture proceeds. This is **not** full restore by itself. It proves the host can externally stop and resume the VMM around capture setup, then continue with source-state capture and target-native reconstruction.

## Track objective

The actual goal is a cleaner capture boundary for the same source-state IR path. VM pause should make the capture handoff more explicit, but it does not turn the proof into full VM restore. The target still reconstructs only supported state target-natively, and unsafe active state still refuses.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/030/`. The proof smoke test may be written in TypeScript, for example `proofs/030/smoke.ts`, with an optional `proofs/030/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proofs/030/smoke.ts`.

## Goal

Prove that the source VM can hit a proof-local capture barrier, be paused externally by the host, be unpaused, and then complete source-state capture while preserving the current proper Node proof behavior. The target must still reconstruct target-native state from captured evidence. Active or ambiguous HTTP request state must still refuse.

## Tasks

- [x] Add a proof-local VM pause/unpause capture flow around the existing Zig guest capture tool.
- [x] Pause the host VMM process at a guest capture barrier, resume it, then capture source process `/proc`, memory mappings, fd/socket state, and thread state with the source Node process still externally stopped.
- [x] Record pause/resume evidence in the source-state IR.
- [x] Prove the source VM resumes after capture and can still answer requests.
- [x] Prove idle target-native reconstruction still returns `{count:3}`.
- [x] Keep active in-flight HTTP request state refused; VM pause must not downgrade semantic safety rules.
- [x] Assert no app hook, checkpoint API, selected-state descriptor, sidecar replay, source ISA emulation, or metadata-only success.

## Proof result

`pnpm exec tsx proofs/030/smoke.ts` now proves:

- active in-flight `/hold` request state still refuses with `node-proper-level5-http-active-request-unsupported`;
- idle source returns `{ "count": 1 }`, then `{ "count": 2 }`;
- the guest capture tool writes a ready barrier, the host pauses the VMM with `SIGSTOP`, observes stopped process state, resumes it with `SIGCONT`, and records that evidence in `externalQuiesce.vmPauseEvidence`;
- after resume and capture, the source VM still answers `/state` with `{ "count": 2 }`;
- target-native Node reconstructs count from raw V8 context Smi state and returns `{ "count": 3 }`;
- no app hook, checkpoint API, selected-state descriptor, source ISA emulation, sidecar replay, or metadata-only success is used.

## Validation

- [x] Run `pnpm exec tsx proofs/030/smoke.ts`.
- [x] Assert source returns `{count:1}`, `{count:2}` before pause capture.
- [x] Assert source VM answers after unpause.
- [x] Assert target returns `{count:3}` from target-native reconstruction.
- [x] Assert capture evidence says `externalQuiesce.method = "vm-pause-barrier+process-freeze"` and records stopped/resumed VMM states.
- [x] Assert active request capture still refuses.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
