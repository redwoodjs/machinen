# Proper Node Level 5 without runtime profiles

Machinen Level 5 is cross-architecture process continuation from captured source machine/process state. It is not a runtime-level profile, app checkpoint, selected-state descriptor, sidecar replay, source-ISA emulation, or metadata-only claim.

## Acceptance contract

Proper Node Level 5 requires:

- **Input:** captured source process state. This includes source memory mappings, memory bytes for accepted ranges, register/thread state, fd table, and kernel/resource descriptors. It must not be an app-exported checkpoint or selected-state descriptor.
- **Target runtime:** target-native Node. The target must execute native code for the target architecture.
- **State source:** reconstructed runtime/native state. The continued behavior must come from recovered process memory/runtime/native structures.
- **No checkpoint substrate:** no CRIU-style runtime checkpoint hooks, app checkpoint APIs, app restore APIs, or framework-level state export/import.
- **No app-specific extraction:** no counter descriptor, no route-specific parser, no sidecar output, and no metadata-only success.
- **Stable refusals:** unknown or unsafe states refuse with stable codes and `migrationCompleted=false`.

## Real implementation track

### 1. Source process memory/runtime inspection

Implemented for the first narrow proof. `pnpm run proof-node-proper-level5-proof` boots a real Node counter VM, hits `{ "count": 1 }` and `{ "count": 2 }`, externally stops the process with `SIGSTOP`, captures `/proc/<pid>` state, dumps accepted small writable mappings from `/proc/<pid>/mem`, records fds/socket state, emits an IR/refusal summary, starts target-native Node, recovers count `2` from raw captured memory bytes, materializes equivalent JS/libuv state, and proves the target returns `{ "count": 3 }`.

The inspection target is source Node process state:

- `/proc/<pid>/maps` mapping boundaries, permissions, file identity, and anonymous ranges;
- stack, heap, executable, shared-object, JIT/code, and anonymous regions;
- thread list and register capture requirements;
- fd table and socket/listener descriptors;
- V8 isolate / heap root candidates;
- libuv loop / handle candidates.

### 2. Runtime/native recovery

The first proof recovers enough state to describe the accepted proof target. Proof 024 replaces response-string recovery with structural V8 closure/context recovery: `recoverNodeProperLevel5V8ClosureCounterCell` walks V8 heap graph edges from closure → context → `count`, while `recoverNodeProperLevel5RawV8ContextSmiCounter` decodes raw pointer-compressed V8 Smi slots near retained closure-context anchors. The smoke asserts the recovered value came from `raw-v8-context-smi-near-closure-anchor`, not from prior `{"count":2}` output.

- JS global/module state for a single mutable counter;
- V8 heap objects necessary to represent that state;
- libuv loop and one HTTP listener;
- no active requests, no active streams, no workers, no native addons.

### 3. Target-native materialization

The controlled loader materializes equivalent target-native state:

- create/enter a target-native Node process;
- recreate accepted JS objects and native/libuv handles;
- bind one HTTP listener;
- enter the target event loop.

### 4. First proof target

The first real proof target is intentionally small:

- single-thread Node;
- no native addons;
- no workers;
- one HTTP listener;
- one simple mutable JS object/closure counter;
- quiescent between requests;
- target returns `{ "count": 3 }` because recovered runtime/native state says the source count was `2`.

## What Goal 022 is now

Goal 022 is a public `machinen snapshot` / `machinen restore` harness proof. It captures `node-http-counter-selected-state-v1` and proves target-native Node can serve `{ "count": 3 }`, but it remains:

- `productSupport=not-yet-supported`;
- `implementationLevel=not-implemented`;
- `migrationCompleted=false`.

It is useful regression evidence, not Level 5 product support.

## References

- Goal definition: `goals/023.md`
- Source process inspection start: `packages/runtime/src/node-proper-level5-source-inspection.ts`
- Live source-state translation/materialization proof: `scripts/smoke/node-proper-level5-source-capture.sh`
- Public proof command: `pnpm run proof-node-proper-level5-proof`
- Harness proof: `docs/snapshot/node-level5-real-cross-arch-quickstart-fixture.md`
- Checked start summary: `docs/snapshot/checked-summaries/node-level5/goal-023-proper-node-level5-track.json`
