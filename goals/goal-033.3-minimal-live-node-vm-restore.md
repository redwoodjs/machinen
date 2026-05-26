# Goal 33.3: Minimal live Node amd64 VM restore

Parent: [Goal 33](./goal-033.md) — full live Node.js portable snapshot/restore
proof. Depends on [Goal 33.1](./goal-033.1-live-node-capture-harness.md) and
[Goal 33.2](./goal-033.2-portable-node-bundle-generation.md).

## Objective

Prove the first real end-to-end live Node path: capture one simple long-running
Node process on arm64, generate a portable bundle, restore it through the Proxmox
amd64 target VM path, resume execution, and verify output after restore.

## Initial workload

Use the smallest workload that can remain alive until capture and produce a
post-restore verifier signal:

- [x] CLI/timers hybrid fixture, or
- [x] timers/async fixture if it gives the cleanest resume point.

## Required routes

- [x] local arm64 source -> Proxmox amd64 target VM.
- [x] remote-builder arm64 source -> Proxmox amd64 target VM.

## Requirements

- [x] Start a real long-running Node source process.
- [x] Capture the live source process on arm64.
- [x] Generate a portable bundle from the capture.
- [x] Transfer the bundle to the Proxmox amd64 target route.
- [x] Boot the real amd64 target VM restore path.
- [x] Materialize target-native Node/process state.
- [x] Resume execution without source ISA emulation.
- [x] Verify post-restore output.
- [x] Verify `migrationCompleted=true`.
- [x] Verify `descriptorGateCompleted=true`.
- [x] Verify target gates:
  - [x] resources;
  - [x] verifier;
  - [x] state-consumption;
  - [x] return-chain;
  - [x] frame;
  - [x] registers;
  - [x] TLS;
  - [x] stack-window;
  - [x] private-memory;
  - [x] executable;
  - [x] process-context;
  - [x] signal;
  - [x] active-syscall;
  - [x] controlled-thread;
  - [x] resume-path;
  - [x] Node app output.
- [x] Verify forbidden success paths remain false:
  - [x] `sourceIsaEmulationUsed=false`;
  - [x] `sourceTextReusedAsTargetCode=false`;
  - [x] `sidecarRuntimeUsed=false`;
  - [x] `appHooksRequired=false`.

## Tests and validation

- [x] Minimal live Node VM restore smoke, local arm64 -> Proxmox amd64.
- [x] Minimal live Node VM restore smoke, remote-builder arm64 -> Proxmox amd64.
- [x] Checked summaries for both routes.
- [x] Focused tests that fail if the minimal success path uses metadata-only,
      synthetic, replay, sidecar, hook, or emulation shortcuts.
- [x] `pnpm run format:check`.
- [x] `pnpm run lint`.
- [x] `pnpm run build:docs` if docs/API change.
- [x] `pnpm run typecheck`.
- [x] Focused Vitest coverage.
- [x] `pnpm exec fallow audit --changed-since origin/main`.
- [x] `git diff --check`.

Because this phase touches the real target VM restore path, run full smoke tests
unless a failure is unrelated and explicitly documented:

- [x] `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`.

## Completion criteria

Goal 33.3 is complete when one live Node workload completes capture -> portable
bundle -> Proxmox amd64 VM restore/resume with verified post-restore output on
both source routes.

## Completion note

Completed as part of umbrella Goal 33 one-shot execution. See
[Goal 33 completion validation record](./goal-033.md#goal-33-completion-validation-record)
for route-level and final validation evidence.
