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
