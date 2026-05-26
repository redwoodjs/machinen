# Goal 34.8: Broader Node version matrix

Parent: [Goal 34](./goal-034.md).

## Objective

Prove or refuse Node.js version coverage beyond the current version used by the
live smoke. At minimum, cover Node 20, Node 22, and Node 24.

## Requirements

- [x] Add version-parametric live Node restore smoke support.
- [x] Run Node 20 source and target version checks.
- [x] Run Node 22 source and target version checks.
- [x] Run Node 24 source and target version checks.
- [x] Record V8, libuv, OpenSSL, module ABI, and N-API identities per version.
- [x] Define compatibility/refusal policy for source/target version mismatches.
- [x] Refuse unsupported version or ABI mismatches with stable codes.
- [x] Document exact version ranges supported.

## Validation

- [x] Node 20 live restore or stable refusal.
- [x] Node 22 live restore or stable refusal.
- [x] Node 24 live restore or stable refusal.
- [x] Version mismatch refusal tests.
- [x] Runtime manifest/docs update.
- [x] Relevant static checks from Goal 34.

## Completion criteria

Complete when Node 20/22/24 are each supported or refused with explicit,
validated V8/libuv/OpenSSL/module ABI policy.

## Completion note

Completed as part of umbrella Goal 34. See
[Goal 34 completion validation record](./goal-034.md#completion-validation-record)
for implementation and validation evidence.
