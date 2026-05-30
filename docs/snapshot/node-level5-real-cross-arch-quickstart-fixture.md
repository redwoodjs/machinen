# Node selected-state cross-arch quickstart harness

Goal 022 keeps the quickstart counter as a useful public `machinen snapshot` / `machinen restore` harness, but it is **not** Level 5 product support.

The harness uses the Node HTTP profile name `node-v8-libuv-single-thread-http-v1` and the selected-state descriptor `node-http-counter-selected-state-v1`. That descriptor is app-specific: it says the source counter had reached `2` and the target harness should serve `3`. Because the input is not reconstructed source process/runtime/native state, this cannot be claimed as proper Level 5 continuation.

Target workflow:

```sh
# source
curl localhost:3000 # { "count": 1 }
curl localhost:3000 # { "count": 2 }
machinen snapshot counter ./counter.snap

# target
machinen restore ./counter.snap -p 3000:3000
curl target:3000 # { "count": 3 }
```

## What is captured

Snapshot records `node-level5-runtime-profile.json`. When the HTTP root response is a JSON counter, snapshot records selected state:

```json
{
  "kind": "node-http-counter-selected-state-v1",
  "captureMethod": "http-root-json-next-count",
  "observedNextCount": 3,
  "restoredInitialCount": 2
}
```

This is selected-state reconstruction, not arbitrary V8 heap/native stack restore and not proper Level 5.

## What restore does

`machinen restore` routes the profile through `node-level5-http-runtime-adapter`. If selected counter state is present, restore boots a target VM, starts target-native Node, injects the captured counter value before accepting user traffic, verifies through a non-mutating verifier endpoint, and leaves the server running. The first user request to `/` returns the continued count.

The restore summary records:

- `productSupport=not-yet-supported`;
- `implementationLevel=not-implemented`;
- `migrationCompleted=false`;
- `selectedStateReconstructionHarnessCompleted=true` when the harness succeeds;
- `notProperLevel5Reason=app-specific-selected-state-descriptor`;
- target runtime is Node;
- no source ISA emulation;
- no sidecar output;
- no metadata-only success.

## Boundary

Harness covers:

- one target-native Node process;
- one HTTP listener from the profile;
- `/` returns JSON in the shape `{ "count": <safe integer> }`;
- snapshot has observed the next counter value and restore seeds target-native Node so the first target user hit returns that value;
- no source ISA emulation, no sidecar output, and no metadata-only replay.

Not supported / not claimed:

- Level 5 product support;
- arbitrary Node programs;
- captured source process memory/runtime/native-state reconstruction;
- arbitrary V8 heap/native stack continuation;
- non-counter application state;
- in-flight requests or streams;
- any state outside the explicit selected-state descriptor.

## Refusals preserved

The profile still refuses with `migrationCompleted=false`:

- arbitrary V8 heap/native stack continuation;
- native addons;
- worker threads;
- inspector/debug state;
- active HTTP requests;
- active TCP streams;
- active syscalls/restart blocks;
- unsupported timers/async handles;
- unsupported module/runtime state;
- missing target-native Node;
- source-ISA emulation;
- sidecar output;
- metadata-only success.

## Checked evidence

- Runtime profile: `packages/runtime/src/node-level5-http-profile.ts`
- CLI adapter: `packages/cli/src/level5-runtime-adapters.ts`
- Harness smoke: `scripts/smoke/node-level5-http-harness-proof.sh`
- Checked summary: `docs/snapshot/checked-summaries/level4-graduation/goal-022-real-cross-arch-quickstart-fixture.json`
