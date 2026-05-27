# Goal 37.5: Ecosystem-equivalent app restore smoke

Parent: [Goal 37](./goal-037.md).

## Objective

Restore a Node app that uses the audited local package registry fixtures across
both architecture directions and Node 18/20/22/24.

## Requirements

- [x] Build an ecosystem-equivalent app that imports/uses the local audited
      packages, including transitive, peer, optional, conditional export,
      ESM/CJS, and native prebuild fixtures.
- [x] Capture and restore the app target-natively in both architecture
      directions: arm64 -> amd64 and amd64 -> arm64.
- [x] Cover Node 18, 20, 22, and 24.
- [x] Verify app output, dependency graph, native artifact selection, lockfile
      provenance, SBOM provenance, and sandbox policy after restore.
- [x] Prove no source-ISA emulation, source text replay, sidecar runtime,
      app restore hooks, live third-party fetches, or lifecycle scripts are used.
- [x] Add checked summaries, matrix presets, runtime manifest entries, and docs.

## Validation

- [x] Ecosystem-equivalent app bidirectional Node 18/20/22/24 smoke.
- [x] Target-native app output verifier.
- [x] Security/sandbox artifact inspection.
- [x] Node matrix and foundation matrix include the new profiles.
- [x] Relevant static checks and full smoke tests from Goal 37.

## Completion criteria

Complete when the ecosystem-equivalent app restores across the required routes
and versions using only audited local package fixtures and offline provenance.

## Completion note

Completed as part of umbrella Goal 37. See
[Goal 37 completion validation record](./goal-037.md#completion-validation-record)
for implementation and validation evidence.
