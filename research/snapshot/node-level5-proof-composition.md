# Node Level 5 proof composition

Goal 009 starts the selected Node Level 5 proof path. This is not product support for arbitrary Node continuation. It composes checked native/process proof ingredients with the Goal 008 Level 4 event-loop resource map.

## Selected subset

The selected proof subset is:

`node-http-clean-root-v1-with-level4-event-loop-map`

It remains proof evidence with:

- `evidenceStatus=proof`;
- `productSupport=not-yet-supported`;
- `implementationLevel=not-implemented`;
- `graduationTargetLevel=level-5-cross-arch-process-continuation`.

## Required ingredients

The composition requires:

- register translation;
- stack and return-chain translation;
- private memory materialization;
- executable/target module materialization;
- target restore loader;
- Goal 008 Level 4 event-loop resource map;
- target-native verifier evidence.

The proof is not ready unless the Level 4 event-loop map and target-native verifier are both present.

## Proof runner

Run the checked proof runner with:

```sh
pnpm node-level5-proof-composition -- --out research/snapshot/checked-summaries/node-level5/goal-009-proof-run.json
```

The runner emits a real `machinen.node-level5-proof-composition` artifact. It reads the native register, stack/return-chain, memory materialization, restore-loader, Goal 008 event-loop map, and target-native verifier evidence before marking the proof ready.

Pass `--include-target-proof` to run or read the concrete target-side proof fixture:

```sh
pnpm node-level5-proof-composition -- \
  --out research/snapshot/checked-summaries/node-level5/goal-009-proof-run.json \
  --include-target-proof \
  --target-proof research/snapshot/checked-summaries/node-level5/goal-009-target-side-continuation.json
```

That fixture starts a small target-native Node HTTP app, captures a continuation token, asks the target-side harness to fetch `/continuation`, and records verifier output from the running Node process.

The default public restore behavior is recorded in `research/snapshot/checked-summaries/node-level5/goal-019-node-level5-default-public-restore.json`.

## Public verb routing

Selected Node snapshots now write `node-level5-proof-composition.json` and the Goal 021 `node-level5-runtime-profile.json` next to the portable Node bundle. `machinen restore` detects those files through the Level 5 adapter registry, runs the target-side proof verifier by default, writes a proof/profile restore summary, and returns a stable proof-only refusal. Non-JSON restore output prints a concise proof-verifier line so the target-native Node continuation evidence is visible. `--allow-proof-only-success` is only for proof automation: it may return exit code 0 for a passed proof, but it does not change `productSupport=not-yet-supported`, `implementationLevel=not-implemented`, or `migrationCompleted=false`.

## Refusals

The composition keeps unsafe Level 5 neighbors fail-closed:

- TLS/rseq;
- SIMD/FPU;
- active signal frames and pending signal queues;
- active syscalls and restart blocks;
- active TCP streams and in-flight network I/O;
- Node worker threads;
- multi-thread state;
- unsupported memory mappings;
- unsupported kernel resources;
- native addon ABI state;
- inspector/debug state;
- unsupported V8/libuv state;
- arbitrary V8 heap/native stack continuation.

Every refusal keeps `migrationCompleted=false`, `productSupport=unsupported`, and `implementationLevel=level-0-fail-closed-discovery`.
