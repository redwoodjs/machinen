# Cooperative Node runtime adapter

Issue #433 turns the runtime adapter protocol into a small cooperative Node adapter.

The adapter is intentionally semantic. It walks explicit roots supplied by the workload and emits `runtime-adapter.json` graph data. It does not read raw V8 heap memory and does not claim full unmodified process restore.

## Captured values

The initial adapter supports:

- primitive roots: `undefined`, `null`, booleans, finite numbers, bigints, strings
- plain objects with enumerable properties
- arrays
- `Map` and `Set`
- `Date`, `RegExp`, and `Error` metadata
- `Buffer`, `ArrayBuffer`, and typed-array bytes
- cycles and shared references through stable object ids

The public helper is:

```ts
captureNodeRuntimeAdapterDocument({ rootName: value });
```

Restore uses:

```ts
restoreNodeRuntimeAdapterRoots(document);
```

## Identity

Each object receives an id like `object:1`. Roots and nested references point to those ids. This preserves identity across restore:

- two properties pointing at one object still point at one object
- maps can use restored objects as keys
- sets keep object membership
- self-cycles point back to the restored object

## Refusals

Unsupported JS values, such as functions and symbols, become opaque graph nodes with an `object-unsupported` refusal. Restore refuses those documents with `NodeRuntimeAdapterUnsupportedError` instead of pretending to recreate runtime internals.

Full live Node process restore still reports `runtime-heap-unsupported`. Later issues add native resource recipes and async continuation metadata.
