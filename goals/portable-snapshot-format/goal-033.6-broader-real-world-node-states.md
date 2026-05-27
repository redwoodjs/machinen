# Goal 33.6: Broader real-world Node app states

Parent: [Goal 33](./goal-033.md). Depends on the first complete live restore path
from Goal 33.3 and should build on the ten-class coverage from Goal 33.4.

## Objective

Extend live Node portable snapshot/restore beyond the original ten representative
fixtures into more realistic app states. Each state must either complete through
live capture -> portable bundle -> Proxmox amd64 VM restore/resume or refuse with
a stable code if it remains unsafe.

## Required broader states

- [x] npm package install / dependency tree with `node_modules` provenance.
- [x] target-compiled native addon ABI provenance.
- [x] long-lived HTTP server restored while listening.
- [x] active HTTP/TCP connection restore or stable refusal.
- [x] database/file workload with open descriptors and dirty file-backed state.
- [x] child process state restore or stable refusal.
- [x] inspector/debug session restore or stable refusal.
- [x] dynamic loader / custom ESM loader hook restore or stable refusal.

## Requirements

- [x] Each broader state has a real app fixture.
- [x] Each broader state has source-route capture on local arm64 and
      remote-builder arm64.
- [x] Each broader state has portable bundle generation or stable bundle-time
      refusal.
- [x] Each supported state restores through the Proxmox amd64 target VM.
- [x] Each supported state has post-restore behavioral verification.
- [x] Each refused state records a stable refusal code and `migrationCompleted=false`.
- [x] Native addons record target ABI and compile/provenance details.
- [x] Package workloads record lockfile/package graph provenance.
- [x] Network workloads record listener/connection/socket provenance.
- [x] File/database workloads record descriptor, file identity, dirty-state, and
      durability semantics.

## Tests and validation

- [x] `node-live-real-world` matrix preset.
- [x] Positive checked summaries for supported broader states.
- [x] Refusal checked summaries for unsafe broader states.
- [x] Focused tests for package graph drift, native addon ABI drift, active
      connection ambiguity, child process ambiguity, inspector ambiguity, and
      loader-hook dependency.
- [x] Full Node matrix.
- [x] Full refusal matrix.
- [x] Full foundation matrix.
- [x] `pnpm run format:check`.
- [x] `pnpm run lint`.
- [x] `pnpm run build:docs`.
- [x] `pnpm run typecheck`.
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`.
- [x] `pnpm exec fallow audit --changed-since origin/main`.
- [x] `git diff --check`.
- [x] Full smoke tests if VM/runtime behavior changes.

## Completion criteria

Goal 33.6 is complete when each broader real-world Node state is either proved as
a working live cross-architecture restore or explicitly guarded by a live refusal
with a stable code.

## Completion note

Completed as part of umbrella Goal 33 one-shot execution. See
[Goal 33 completion validation record](./goal-033.md#goal-33-completion-validation-record)
for route-level and final validation evidence.
