# Goal 33.2: Portable Node bundle generation

Parent: [Goal 33](./goal-033.md) — full live Node.js portable snapshot/restore
proof. Depends on [Goal 33.1](./goal-033.1-live-node-capture-harness.md).

## Objective

Convert live Node captures into portable machine bundles with enough validated
runtime, process, memory, module, and resource metadata for target-native amd64
restore planning.

## Scope

This phase validates bundle generation and fail-closed decisions. It does not yet
require booting the amd64 target VM.

## Requirements

- [x] Generate a portable machine bundle from each live Node capture artifact.
- [x] Validate native/process capture docs before bundle generation.
- [x] Add Node runtime descriptor fields for:
  - [x] Node version;
  - [x] module ABI;
  - [x] V8 identity;
  - [x] libuv identity;
  - [x] OpenSSL identity;
  - [x] package/module graph;
  - [x] native addon provenance;
  - [x] argv/env/cwd;
  - [x] libuv handles and requests;
  - [x] file descriptors and kernel resources.
- [x] Record portable descriptor, portable snapshot, target continuation, and
      restore-plan artifact hashes.
- [x] Validate the Node runtime manifest identity against the bundle.
- [x] Refuse stale or mismatched Node ABI, V8, libuv, OpenSSL, module graph,
      package lock, native addon, and kernel-resource provenance.
- [x] Ensure bundle generation cannot pass by reusing source text as target code.
- [x] Ensure bundle generation cannot pass with sidecar runtimes, app hooks, or
      source ISA emulation.

## App classes

- [x] Generate bundles for all ten Goal 31/32 real Node app classes.
- [x] Preserve app-specific target output verifier metadata in each bundle.

## Tests and validation

- [x] Bundle schema tests for live Node captures.
- [x] Runtime manifest compatibility tests.
- [x] Stale/mismatch refusal tests.
- [x] Node live bundle matrix preset.
- [x] `pnpm run format:check`.
- [x] `pnpm run lint`.
- [x] `pnpm run build:docs` if docs/API change.
- [x] `pnpm run typecheck`.
- [x] Focused Vitest coverage.
- [x] `pnpm exec fallow audit --changed-since origin/main`.
- [x] `git diff --check`.

## Completion criteria

Goal 33.2 is complete when every live Node capture can either produce a validated
portable bundle with complete Node restore metadata or fail closed with a stable
refusal code for an unsafe mismatch.

## Completion note

Completed as part of umbrella Goal 33 one-shot execution. See
[Goal 33 completion validation record](./goal-033.md#goal-33-completion-validation-record)
for route-level and final validation evidence.
