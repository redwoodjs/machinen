# Goal 37.1: Local audited package registry fixtures

Parent: [Goal 37](./goal-037.md).

## Objective

Create a local, audited, no-network package fixture registry that models common
npm ecosystem complexity without fetching or executing third-party code.

## Requirements

- [x] Add local package fixtures for transitive dependencies, peer dependencies,
      optional dependencies, conditional exports, and ESM/CJS dual packages.
- [x] Add lifecycle-script hazard fixtures (`preinstall`, `install`,
      `postinstall`, `prepare`) that must refuse by default.
- [x] Ensure every fixture is small, human-readable, checked into the repo, and
      uses no third-party code or binary blobs.
- [x] Add fixture manifests with package name, version, dependency edges,
      expected resolution, and security policy.
- [x] Verify dependency graph resolution against the local fixture registry only.

## Validation

- [x] Local audited package registry smoke.
- [x] Dependency graph resolution tests.
- [x] Lifecycle-script refusal tests.
- [x] Docs list every fixture and hazard class.
- [x] Relevant static checks from Goal 37.

## Completion criteria

Complete when local audited fixtures cover the required npm ecosystem shapes and
unsafe lifecycle behavior fails closed.

## Completion note

Completed as part of umbrella Goal 37. See
[Goal 37 completion validation record](./goal-037.md#completion-validation-record)
for implementation and validation evidence.
