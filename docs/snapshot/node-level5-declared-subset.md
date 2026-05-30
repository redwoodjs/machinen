# Experimental Node Level 5 declared subset

Machinen has a guarded, experimental Node Level 5 declared-subset path. It is not broad Node product support.

## Supported candidate subset

The current declared subset is limited to:

- Node `22.x`.
- V8 `12.x` with pointer compression.
- Idle event-loop state only.
- Selected V8 state families: strings, arrays, plain objects, and closure contexts.
- Selected libuv/resource families: timers, TCP listeners, pipes, stdio, and readonly files.

Unsupported neighbors refuse with stable errors. That includes worker threads, active requests, pending microtasks, external memory, Wasm modules, native addons, custom signal handlers, raw CPU restore, and source-ISA emulation.

## Guarded commands

Capture is behind an explicit experimental flag:

```sh
machinen capture node-level5 \
  --experimental-node-level5 \
  --out ./node-level5-capture \
  --source-arch arm64 \
  --target-arch amd64
```

Restore consumes the manifest emitted by capture:

```sh
machinen restore node-level5 \
  --experimental-node-level5 \
  ./node-level5-capture/node-level5-declared-subset-manifest.json
```

Both commands emit machine-readable summaries with `--json`.

## Product boundary

This path is a guarded experimental candidate. It does not claim broad Node Level 5 support, and it does not claim arbitrary process cross-architecture restore.

Cross-architecture continuation must use translated continuation. Raw CPU/register/PC/stack restore and source fd copying are refused.
