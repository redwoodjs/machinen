# Goal 33.1: Live Node capture harness

Parent: [Goal 33](./goal-033.md) — full live Node.js portable snapshot/restore
proof.

## Objective

Build the live Node process capture foundation. Completion means the local arm64
machine and the arm64 remote builder can start long-running real Node workloads,
capture real process state from those running processes, and emit audited capture
artifacts without using synthetic metadata as a success path.

## Scope

This phase does not require amd64 VM restore. It proves the source-side live
capture path only.

## Requirements

- [x] Add a live Node capture smoke command.
- [x] Support source routes:
  - [x] local arm64;
  - [x] remote-builder arm64.
- [x] Start every workload as a long-running Node process before capture.
- [x] Capture from the running process with the native/process capture path.
- [x] Record source architecture and host identity.
- [x] Record Node version, module ABI, V8, libuv, OpenSSL, and platform identity.
- [x] Record argv/env/cwd.
- [x] Record package/module graph provenance.
- [x] Record file descriptors and active libuv handles.
- [x] Record worker/thread state where present.
- [x] Record workload-specific resources for the ten existing app classes.
- [x] Emit capture artifact hashes for process docs, memory, resources, and logs.
- [x] Fail closed if capture falls back to metadata-only proof.
- [x] Fail closed if source ISA emulation, source text replay, sidecars, or app
      hooks are required for capture success.

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

## Tests and validation

- [x] Focused unit tests for capture manifest/schema validation.
- [x] Local arm64 live Node capture smoke.
- [x] Remote-builder arm64 live Node capture smoke.
- [x] `pnpm run format:check`.
- [x] `pnpm run lint`.
- [x] `pnpm run typecheck`.
- [x] Focused Vitest coverage.
- [x] `pnpm exec fallow audit --changed-since origin/main`.
- [x] `git diff --check`.

## Completion criteria

Goal 33.1 is complete when both arm64 source routes produce real live-process
capture artifacts for the required Node app classes and all metadata-only or
shortcut capture paths fail closed.

## Completion note

Completed as part of umbrella Goal 33 one-shot execution. See
[Goal 33 completion validation record](./goal-033.md#goal-33-completion-validation-record)
for route-level and final validation evidence.
