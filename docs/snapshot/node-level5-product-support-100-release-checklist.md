# Node Level 5 100 / 100 / 0 release checklist — blocked

Do not publish the Node 100 / 100 / 0 claim unless `proofs/nodejs/real-cross-arch-e2e-gate/` passes for every supported row and refusal boundary. The current retained gate is only a bidirectional clean HTTP seed.

Required retained evidence:

- real `machinen snapshot <vm-name> --out <dir>` and `machinen restore <dir>` runs;
- amd64 -> arm64 and arm64 -> amd64 directions;
- source and target behavior transcripts;
- target-native verifier output;
- restore summaries and logs;
- refusal artifacts for unsupported live/runtime states;
- no raw CPU restore, source-ISA emulation, app hooks, sidecars, or metadata-only success.

Validate the retained seed with:

```sh
bash scripts/smoke/node-real-cross-arch-e2e-gate.sh
```

Until full row coverage exists, Node remains `0 / 0 / 0` in the public claim dashboard.
