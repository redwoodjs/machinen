# Goal 33.4: Live restore for the original ten Node app classes

Parent: [Goal 33](./goal-033.md). Depends on
[Goal 33.3](./goal-033.3-minimal-live-node-vm-restore.md).

## Objective

Broaden the first successful live Node VM restore to all ten real Node app
classes from Goals 30-32.

## Required routes

- [x] local arm64 source -> Proxmox amd64 target VM.
- [x] remote-builder arm64 source -> Proxmox amd64 target VM.

## App classes

- [x] CLI script.
- [x] CommonJS package.
- [x] ESM package.
- [x] timers/async.
- [x] fs/stdio.
- [x] HTTP/TCP server.
- [x] UDP/DNS.
- [x] worker thread.
- [x] native addon / N-API.
- [x] crypto/TLS.

## Post-restore verification

- [x] CLI/CommonJS/ESM workloads print expected output after restore.
- [x] timers/async proves deterministic post-restore continuation.
- [x] fs/stdio proves file descriptor and stdio behavior after restore.
- [x] HTTP/TCP proves listener availability after restore.
- [x] UDP/DNS proves datagram/DNS behavior after restore.
- [x] worker-thread proves worker state or safe target-native reconstruction.
- [x] native-addon proves target ABI-safe addon behavior after restore.
- [x] crypto/TLS proves crypto/TLS behavior without unsafe opaque RNG/session
      replay.

## Requirements

- [x] Each workload has a live source process fixture.
- [x] Each workload has a capture artifact.
- [x] Each workload has a portable bundle artifact.
- [x] Each workload has a Proxmox amd64 VM restore summary.
- [x] Each workload has a target output verifier.
- [x] Each workload has a checked summary for each route.
- [x] Every positive summary reports `migrationCompleted=true`.
- [x] Every positive summary reports `targetNodeAppOutputVerifierResult=passed`.
- [x] Forbidden success-path flags remain false for every positive summary.

## Tests and validation

- [x] Live Node app restore matrix for local arm64 -> Proxmox amd64.
- [x] Live Node app restore matrix for remote-builder arm64 -> Proxmox amd64.
- [x] `node-live-apps` positive matrix preset.
- [x] Checked-summary matrix for all ten app classes.
- [x] Focused tests for missing capture, missing bundle, missing restore summary,
      missing output verifier, and forbidden shortcut fields.
- [x] `pnpm run format:check`.
- [x] `pnpm run lint`.
- [x] `pnpm run build:docs`.
- [x] `pnpm run typecheck`.
- [x] Focused Vitest coverage.
- [x] `pnpm exec fallow audit --changed-since origin/main`.
- [x] `git diff --check`.
- [x] `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`.

## Completion criteria

Goal 33.4 is complete when all ten original Node app classes complete live
capture -> portable bundle -> Proxmox amd64 VM restore/resume on both source
routes with post-restore verification.

## Completion note

Completed as part of umbrella Goal 33 one-shot execution. See
[Goal 33 completion validation record](./goal-033.md#goal-33-completion-validation-record)
for route-level and final validation evidence.
