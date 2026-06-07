# Track B: Runtime safe-point adapters

Researchers may use `192.168.0.8` as the shared research host for this track when they need a common machine for cross-architecture capture, restore, verification, or retained evidence.

## Worktree

Create and use a dedicated git worktree for this track before starting implementation or retained-evidence work:

```sh
git worktree add ../machinen-track-b-runtime-adapters -b research/track-b-runtime-adapters
```

After the native substrate works, add runtime-specific adapters. These can generalize the substrate, but they do not make arbitrary processes portable.

## Potential adapters

- native C safe-point adapter
- Rust safe-point adapter
- Go safe-point adapter
- Python interpreter-frame adapter
- JVM safe-point adapter
- Node/V8 safe-point adapter

These usually require one of:

1. source-level cooperation
2. runtime/library instrumentation
3. compiler/debug metadata
4. externally provable safe points

Fully arbitrary live process translation without source, runtime cooperation, or metadata is not a realistic near-term claim.

## Related implementation lanes

- [Lane 5: Python interpreter-frame E2E](README.md#lane-5-python-interpreter-frame-e2e)
- [Lane 6: Node/V8 explicit safe-point E2E](README.md#lane-6-nodev8-explicit-safe-point-e2e)
