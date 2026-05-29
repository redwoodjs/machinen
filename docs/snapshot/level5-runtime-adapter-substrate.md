# Level 5 runtime adapter substrate

Goal 020 defines the shared substrate for cross-architecture Level 5 runtime continuation. The substrate is not app-specific and does not claim arbitrary process support. It gives runtime families a common adapter contract for public `machinen snapshot` / `machinen restore` routing, artifact status fields, target-native verifier evidence, and fail-closed refusal envelopes.

## Adapter contract

A `Level5RuntimeAdapter` owns one runtime family/profile and implements:

- `detect` — decide whether a snapshot/restore bundle belongs to the adapter;
- `quiesce` — prove the source is safe to capture or return stable refusals;
- `capture` — record runtime state and Level 4 resource descriptors;
- `validate` — reject unsupported source/target pairs and unsafe neighbors;
- `planRestore` — build a target-native restore plan;
- `restoreTargetNative` — launch or enter target-native runtime code;
- `verify` — prove output came from the target-side runtime;
- `refuse` — produce stable refusal envelopes with `migrationCompleted=false`.

## Required status fields

Every Level 5 artifact keeps these fields separate:

| Field                   | Meaning                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `evidenceStatus`        | proof/support/refusal status                                     |
| `productSupport`        | whether users can rely on this as product support                |
| `implementationLevel`   | implemented substrate/profile level                              |
| `graduationTargetLevel` | target level, normally `level-5-cross-arch-process-continuation` |
| `migrationCompleted`    | true only when the actual supported workload continued           |

Proof rows remain `productSupport=not-yet-supported`. Refusal rows remain `productSupport=unsupported` and `migrationCompleted=false`.

## Public routing

The CLI now has a Level 5 adapter registry. The existing selected Node Level 5 proof path is represented by the `node-level5-proof-runtime-adapter` profile:

`node-http-clean-root-v1-with-level4-event-loop-map`

`machinen snapshot` writes the Node proof composition through the adapter-compatible capture path. `machinen restore` detects `node-level5-proof-composition.json` through the registry, runs the target-native proof verifier by default, and still returns the proof-only `node-level5-proof-only-not-product` refusal unless proof automation explicitly allows exit code 0.

## Stable substrate refusals

The substrate defines common fail-closed refusal codes for:

- unsupported runtime family;
- unsupported runtime profile;
- missing target-native runtime;
- unsupported source/target architecture pair;
- source-ISA emulation;
- sidecar output;
- metadata-only success;
- active syscalls;
- active TCP streams;
- unsupported thread state;
- unsupported kernel resources;
- unsupported runtime heap/stack state.

## Checked evidence

- Interface and registry: `packages/runtime/src/level5-runtime-adapter.ts`
- CLI registry path: `packages/cli/src/level5-runtime-adapters.ts`
- Checked summary: `docs/snapshot/checked-summaries/level4-graduation/goal-020-level5-runtime-adapter-substrate.json`
- Runtime tests: `packages/runtime/src/__tests__/level5-runtime-adapter.test.ts`
- CLI tests: `packages/cli/src/__tests__/node-level5-default-proof-restore.test.ts`
