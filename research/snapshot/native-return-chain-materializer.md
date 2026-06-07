# Native return-chain materializer

Issue #655 turns a validated bounded return-chain plan into concrete target stack
writes.

`materializeNativeReturnChainFrames()` accepts only a materialized
`NativeReturnChainPlan`. It emits little-endian 64-bit writes for:

- each non-terminal frame's caller frame-pointer link;
- each frame's return-address slot.

The materialization also exposes the initial frame pointer that the target resume
path should load. Refused return-chain plans remain refused and cannot produce
writes. This prepares multi-frame return chains for target loader/trampoline
consumption without claiming arbitrary source stack reuse.
