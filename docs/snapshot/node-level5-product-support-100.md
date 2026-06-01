# Node Level 5 100 / 100 / 0 support — unverified

The previous Node `100 / 100 / 0` public claim is no longer accepted by the claim dashboard.

## Current public claim

```json
{
  "nodeProductSupportClaimed": 0,
  "broadNodeProductSupportClaimed": 0,
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

## Why this was downgraded

The repository has extensive Node matrices, product snapshot facades, release gates, and refusal rows. Those are useful proof substrate, but the current audit did not find a complete retained real-VM E2E artifact chain for every claimed supported row and both architecture directions.

A real public claim requires proof artifacts, not just claim registries or facade/unit reports.

## Required gate

See `proofs/nodejs/real-cross-arch-e2e-gate/`.

Before raising Node again, retain:

- real `machinen snapshot <vm-name> --out <dir>` artifacts;
- real `machinen restore <dir>` artifacts;
- amd64 -> arm64 and arm64 -> amd64 target-native verifier output;
- source and target behavior transcripts;
- restore summaries and logs;
- refusal artifacts for workers, native addons, Wasm/external memory, TLS active state, active async work, child process live state, raw CPU restore, source ISA emulation, app hooks, sidecars, and metadata-only success.

Arbitrary Linux process cross-architecture restore remains `0%`.
