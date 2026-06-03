# Node memory scalar reconstruction proof

This proof covers one narrow memory-only Node.js state row:

- source app keeps `count = 41` only in V8 process memory
- capture reads source guest `/proc/<pid>/mem`
- capture scans V8 context memory for the anchored Smi value
- target starts a fresh target-native Node process initialized with the captured scalar
- verifier observes `41` and then `42` after increment

The retained cross-architecture artifact is:

- `retained/node-memory-scalar-reconstruction-arm64-to-amd64-report.json`

## Claim boundary

This is **not** arbitrary Node process restore. It does not restore a raw V8 heap,
PID, active requests, sockets, worker threads, native addons, child processes, or
source ISA execution.

The claim is only:

> one controlled memory-only Node count scalar was captured from source process
> memory and reconstructed target-native across `arm64 -> amd64`.
