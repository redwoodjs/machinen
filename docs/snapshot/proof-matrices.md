# Portable machine proof matrices

The one-command matrix runner is:

```sh
pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --json --summary ./proof-matrix.json
```

Selection options can be combined:

```sh
pnpm --silent portable-machine-proof-matrix -- --support-status graduated-support --json
pnpm --silent portable-machine-proof-matrix -- --capability fd:regular-file --json
pnpm --silent portable-machine-proof-matrix -- --unsafe-family socket --json
pnpm --silent portable-machine-proof-matrix -- --profile file-readv --profile socket-transfer-refusal --json
```

Presets:

- `baseline-success` — the 11 original positive profiles;
- `graduated-support` — the 79 graduated support profiles;
- `positive` / `all-positive` — all positive profiles;
- `refusal` / `refusal-matrix` — all intentional and permanent refusals;
- `foundation-full` / `goal-6-7-full-foundation` — all profiles;
- `real-workload` — all profiles sourced from real workloads;
- `real-workload-positive` — positive real-workload profiles only;
- `goal21`, `goal21-positive`, `goal21-refusal` — the Goal 21 graduation
  profiles and their target-native negative neighbors.

The summary JSON has a stable top-level shape:

- `profileCounts` by support status and expected result;
- `results[]` with pass/fail state, elapsed time, workdir, summary source,
  reusable summary path, refusal code, target gates, and runner summary;
- `refusalCodes`, `targetGates`, `workdirs`, `remoteHostDetails`, `timings`,
  `summarySources`, `savedSummaries`, and `artifactInventory`;
- `shard` when `--shard index/count` is used;
- `schemaValidation` for capability/profile schema drift.

## Validation scale features

Matrices can be sharded deterministically by selected-profile order:

```sh
pnpm --silent portable-machine-proof-matrix -- --preset refusal --shard 1/4 --json
pnpm --silent portable-machine-proof-matrix -- --preset refusal --shard 2/4 --json
```

Reusable smoke summaries can be cached and rechecked without rerunning remote
proofs. Existing `<profile>.json` files in `--summary-cache-dir` are used as
checked summaries; newly run profiles save their smoke summaries back into that
directory.

```sh
pnpm --silent portable-machine-proof-matrix -- \
  --preset refusal \
  --summary-cache-dir ./proof-summary-cache \
  --artifact-inventory ./artifact-inventory.json \
  --json --summary ./refusals.json --continue-on-fail
```

`--save-summary-dir` writes reusable smoke summaries without reading from the
directory first. `--artifact-inventory` writes the flattened inventory of local
and remote bundles, logs, descriptors, continuations, and provenance artifacts
for every profile in the matrix summary.

## Local synthetic proof runs

Synthetic refusal profiles and the Goal 8/9 declarative positive profiles do not
need remotes:

```sh
pnpm --silent portable-machine-proof-matrix -- --preset refusal --json --summary ./refusals.json --continue-on-fail
```

Expected refusal result: `pass=true`, each selected refusal has its exact
`expectedRefusalCode`, `migrationCompleted=false`, no source text replay, no
source-ISA emulation, and no sidecar success path. Expected synthetic positive
result: `migrationCompleted=true`, descriptor and verifier gates pass, and the
artifact records target-native proof metadata without source text replay,
source-ISA emulation, sidecar runtime success, or app hooks.

## Remote arm64 -> amd64 target-native run

```sh
PORTABLE_ARM64_SSH=friend@100.126.46.90 \
PORTABLE_AMD64_SSH=root@192.168.0.8 \
PORTABLE_AMD64_REPO=/work/machinen \
PORTABLE_MACHINE_TARGET_VM_IMAGE=/work/assets/rootfs-debian-amd64.tar.gz \
pnpm --silent portable-machine-proof-matrix -- \
  --preset positive \
  --amd64-vmm /work/machinen/packages/microvm/zig-out/bin/microvm \
  --amd64-kernel /work/assets/bzImage-x86_64 \
  --amd64-assets-dir /work/assets \
  --json --summary ./positive-remote.json --continue-on-fail
```

Expected result: every positive profile has `migrationCompleted=true`,
`descriptorGateCompleted=true`, target-native amd64 completion, and all expected
gates passed. The runner records target guest architecture, artifact identities,
continuation/descriptor hashes when local files are visible, target executable
provenance, tool versions, and remote host details.
