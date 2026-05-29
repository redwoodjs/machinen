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
pnpm node-level5-proof-composition -- --out docs/snapshot/checked-summaries/level4-graduation/goal-009-proof-run.json
```

The runner emits a real `machinen.node-level5-proof-composition` artifact. It reads the native register, stack/return-chain, memory materialization, restore-loader, Goal 008 event-loop map, and target-native verifier evidence before marking the proof ready.

Pass `--include-target-proof` to run or read the concrete target-side proof fixture:

```sh
pnpm node-level5-proof-composition -- \
  --out docs/snapshot/checked-summaries/level4-graduation/goal-009-proof-run.json \
  --include-target-proof \
  --target-proof docs/snapshot/checked-summaries/level4-graduation/goal-009-target-side-continuation.json
```

That fixture starts a small target-native Node HTTP app, captures a continuation token, asks the target-side harness to fetch `/continuation`, and records verifier output from the running Node process.

## Public verb routing

Selected Node snapshots now write `node-level5-proof-composition.json` next to the portable Node bundle. `machinen restore` detects that file and writes `node-level5-proof-restore-summary.json`, but returns the stable `node-level5-proof-only-not-product` refusal. This proves the public route is wired without claiming product restore support.

## Refusals

The composition keeps unsafe Level 5 neighbors fail-closed:

- TLS/rseq;
- SIMD/FPU;
- active signal frames and pending signal queues;
- active syscalls and restart blocks;
- multi-thread state;
- unsupported memory mappings;
- unsupported kernel resources;
- native addon ABI state;
- inspector/debug state;
- unsupported V8/libuv state;
- arbitrary V8 heap/native stack continuation.

Every refusal keeps `migrationCompleted=false`, `productSupport=unsupported`, and `implementationLevel=level-0-fail-closed-discovery`.
