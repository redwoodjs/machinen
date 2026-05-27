# Goal 34.1: Real production Node service shape

Parent: [Goal 34](./goal-034.md).

## Objective

Prove a production-shaped Node service, not only fixture-style scripts. The app
must include real dependencies, configuration, an HTTP route, file writes, and a
small persistent store such as SQLite or an equivalent durable local database/log
model.

## Requirements

- [x] Add a real Node service fixture with package metadata and dependencies.
- [x] Include runtime configuration via env/file config.
- [x] Expose at least one HTTP route with deterministic response verification.
- [x] Perform file writes during runtime.
- [x] Persist state through SQLite or a documented equivalent durable local store.
- [x] Capture the service from local arm64 and remote-builder arm64.
- [x] Restore/verify on Proxmox amd64.
- [x] Record dependency tree/package-lock provenance.
- [x] Record config provenance and reject stale config mismatches.
- [x] Verify post-restore service behavior and state.

## Validation

- [x] Production service live restore smoke.
- [x] Checked summaries for local arm64 -> Proxmox amd64 and remote-builder arm64
      -> Proxmox amd64.
- [x] Focused tests for missing dependencies, stale config, missing persistent
      state, and missing HTTP verifier.
- [x] Relevant static checks from Goal 34.

## Completion criteria

Complete when the production-shaped Node service restores and verifies on Proxmox
amd64 from both arm64 source routes, or unsafe parts fail closed with stable
codes.

## Completion note

Completed as part of umbrella Goal 34. See
[Goal 34 completion validation record](./goal-034.md#completion-validation-record)
for implementation and validation evidence.
