# Node Level 5 single-thread HTTP profile

Goal 021 added the first Node runtime adapter profile on top of the generic Level 5 substrate. Goal 022 adds a selected-state reconstruction harness for the quickstart counter, but it is not Level 5 product support.

Profile:

`node-v8-libuv-single-thread-http-v1`

This is a runtime-level profile, not broad arbitrary Node support. The safe `node-http-counter-selected-state-v1` counter fixture is a proof/harness only because it uses an app-specific selected-state descriptor; profile captures without that selected state remain proof-only/refused for product restore.

## Supported shape

The profile records a narrow Node/V8/libuv HTTP shape:

- one Node process;
- single-thread requirement;
- target-native Node required on restore;
- HTTP listener represented by a Level 4 TCP listener profile;
- no active requests;
- no active TCP streams;
- no worker threads;
- no native addons;
- no inspector/debug session;
- no active syscalls/restart blocks;
- bounded V8/libuv state only.

## Snapshot artifact

Selected Node snapshots now write:

- `node-level5-proof-composition.json` — Goal 009/019 proof composition;
- `node-level5-runtime-profile.json` — Goal 021 Node HTTP runtime profile.

The profile artifact records Node runtime identity, argv/cwd/entrypoint, selected V8 state policy, libuv handle inventory, HTTP listener descriptors, target-native verifier requirements, and stable refusals.

## Restore routing

`machinen restore` routes bundles containing `node-level5-runtime-profile.json` through `node-level5-http-runtime-adapter`. Restore runs the target-side Node verifier and writes `node-level5-runtime-profile-restore-summary.json`.

For the selected-state counter fixture, restore can complete the harness and leave target-native Node serving `{ "count": 3 }`, but the status remains proof-only:

```json
{
  "productSupport": "not-yet-supported",
  "implementationLevel": "not-implemented",
  "migrationCompleted": false,
  "refusal": { "code": "node-level5-http-profile-proof-only-not-product" }
}
```

## Stable refusals

The profile fails closed for:

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

Every refusal keeps `productSupport=unsupported` and `migrationCompleted=false`.

## Checked evidence

- Runtime profile model: `packages/runtime/src/node-level5-http-profile.ts`
- CLI adapter: `packages/cli/src/level5-runtime-adapters.ts`
- Goal 021 checked summary: `docs/snapshot/checked-summaries/level4-graduation/goal-021-node-level5-http-profile.json`
- Goal 022 selected-state harness checked summary: `docs/snapshot/checked-summaries/level4-graduation/goal-022-real-cross-arch-quickstart-fixture.json`
- Runtime tests: `packages/runtime/src/__tests__/node-level5-http-profile.test.ts`
- CLI restore test: `packages/cli/src/__tests__/node-level5-default-proof-restore.test.ts`
