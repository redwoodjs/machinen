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

## Readiness gates

The declared subset has a 100% readiness gate only for this narrow experimental path. The gate is made from:

- Bidirectional guarded CLI capture/restore evidence for `arm64 -> amd64` and `amd64 -> arm64` manifests.
- CI-style artifact retention for manifests, summaries, and refusal rows.
- Stable public refusal codes for unsafe neighbors.
- Public docs that keep the support boundary visible.
- A final audit that keeps broad Node product support claimed at `0%`.

The broader Node proof matrix is also allowed to reach 100% only as a proof matrix: unsupported V8, libuv, worker/thread, native-addon, Wasm, active-request, raw-CPU, and source-ISA-emulation neighbors must refuse before target start.

## Product boundary

This path is a guarded experimental candidate. It does not claim broad Node Level 5 support, and it does not claim arbitrary process cross-architecture restore.

Cross-architecture continuation must use translated continuation. Raw CPU/register/PC/stack restore and source fd copying are refused.
