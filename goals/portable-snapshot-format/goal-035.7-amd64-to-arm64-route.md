# Goal 35.7: amd64 source to arm64 target route

Parent: [Goal 35](./goal-035.md).

## Objective

Prove the reverse cross-architecture route that Goal 34 did not claim: live amd64
source capture restored to target-native arm64 execution.

## Requirements

- [x] Add or select a live amd64 source host suitable for Node process capture.
- [x] Add an arm64 target restore route that verifies target-native arm64 code
      execution with no source-ISA emulation.
- [x] Run the existing Node app and production-shaped service envelopes over the
      amd64 -> arm64 route.
- [x] Cover Node 20, 22, and 24 for the reverse route.
- [x] Verify runtime manifest, portable bundle, descriptor gates, target app
      output, and shortcut/security inspection for every supported reverse-route
      case.
- [x] Add refusal profiles for route-specific unsupported states such as missing
      target-native module bytes, unavailable arm64 dependency artifacts, or
      mismatched kernel/runtime capabilities.

## Validation

- [x] amd64 source -> arm64 target smoke for the ten real Node app fixtures.
- [x] amd64 source -> arm64 target smoke for the production-shaped service.
- [x] Node 20/22/24 reverse-route matrix.
- [x] Reverse-route native addon provenance check.
- [x] Security inspection proving no source-ISA emulation or sidecar runtime.
- [x] Relevant static checks and full smoke tests from Goal 35.

## Completion criteria

Complete when amd64 -> arm64 portable Node restore is proven for the claimed app
and production-service envelopes, with stable refusal codes for route-specific
unsupported states.

## Completion note

Completed as part of umbrella Goal 35. See
[Goal 35 completion validation record](./goal-035.md#completion-validation-record)
for implementation and validation evidence.
