# Node service 100 / 100 / 0 unverified

Status: `partial-proof`

Track: `node-service`

Proof directory: `proofs/nodejs/100-100-0`

The previous `100 / 100 / 0` Node service claim is not accepted as a public claim until retained real cross-architecture VM E2E artifacts are audited or produced.

## Current public claim numbers

```json
{
  "productSupport": 0,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Why this is downgraded

The repository contains extensive Node matrices, release gates, product snapshot facade tests, and refusal rows. During this audit, those were not enough to prove the top-level `100 / 100 / 0` claim because the claim row did not point to retained real VM E2E bundles for every claimed supported row and both architecture directions.

## Required gate

See `../real-cross-arch-e2e-gate/`.

A future Node claim must retain:

- real `machinen snapshot <vm-name>` / `machinen restore <dir>` artifacts;
- amd64 -> arm64 and arm64 -> amd64 runs;
- source and target behavior transcripts;
- restore summaries and target-native verifier output;
- refusal artifacts for unsupported live/runtime states;
- no raw CPU restore, source-ISA emulation, app hooks, sidecars, or metadata-only success.
