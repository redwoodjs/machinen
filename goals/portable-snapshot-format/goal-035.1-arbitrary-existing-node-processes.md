# Goal 35.1: Arbitrary existing Node process capture

Parent: [Goal 35](./goal-035.md).

## Objective

Prove that portable restore can attach to and evaluate already-running Node.js
processes that were not launched by a purpose-built Machinen proof harness.
Support claims must come from live process discovery and target-native restore,
not from curated metadata or source replay.

## Requirements

- [x] Add discovery tooling for existing Node processes by PID and command line.
- [x] Capture runtime provenance from `/proc` or platform-equivalent live process
      state: executable, argv, cwd, env envelope, open files, loaded mappings,
      active handles, package roots, and Node/V8/libuv/OpenSSL versions.
- [x] Prove at least three existing-process classes:
      long-running HTTP service, CLI daemon/worker loop, and dependency-backed
      package app.
- [x] Require no app-side restore hook, loader hook, source text replay, sidecar
      runtime, or source-ISA emulation.
- [x] Refuse unsupported existing-process states with stable codes and
      `migrationCompleted=false`.
- [x] Add checked summaries and proof matrix presets for existing-process
      support and refusal cases.

## Validation

- [x] Existing Node process live capture smoke on local arm64.
- [x] Existing Node process live capture smoke on remote-builder arm64.
- [x] Target-native Proxmox amd64 restore smoke for supported cases.
- [x] Refusal tests for unsupported discovery gaps and unsafe live state.
- [x] Runtime manifest and support-envelope docs updated.
- [x] Relevant static checks from Goal 35.

## Completion criteria

Complete when arbitrary already-running Node processes in the claimed subset can
be captured and restored cross-architecture, and neighboring unsafe states refuse
with stable codes.

## Completion note

Completed as part of umbrella Goal 35. See
[Goal 35 completion validation record](./goal-035.md#completion-validation-record)
for implementation and validation evidence.
