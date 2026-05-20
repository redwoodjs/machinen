# JavaScript module and build identity sidecar

Issue #436 defines the JavaScript build identity sidecar used by runtime adapters before restore.

A runtime adapter must not replay semantic state into the wrong code. The sidecar records:

- entrypoints
- source file SHA-256 digests
- package manifest digest
- lockfile digest
- module graph digest
- optional built artifact digest

The public helpers are:

```ts
const sidecar = captureJsBuildIdentity({ rootDir, entrypoints: ["src/index.ts"] });
const result = verifyJsBuildIdentity(sidecar, { rootDir, entrypoints: ["src/index.ts"] });
```

`sidecar.build` is shaped as a `RuntimeAdapterBuild`, so it can be embedded directly in `runtime-adapter.json`.

## Mismatch policy

Restore checks the sidecar before replaying state. If source, package, lockfile, module graph, or artifact identity changes, verification refuses with `target-build-mismatch`.

This is architecture-neutral: matching arm64 and amd64 builds can share the same source/module identity, while stale or different targets refuse before state replay.
