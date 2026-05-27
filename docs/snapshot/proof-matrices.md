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
- `graduated-support` — the 626 graduated support profiles;
- `positive` / `all-positive` — all positive profiles;
- `refusal` / `refusal-matrix` — all intentional and permanent refusals;
- `foundation-full` / `goal-6-7-full-foundation` — all profiles;
- `real-workload` — all profiles sourced from real workloads;
- `real-workload-positive` — positive real-workload profiles only;
- `goal21`, `goal21-positive`, `goal21-refusal` — the Goal 21 graduation
  profiles and their target-native negative neighbors;
- `goal26`, `goal26-positive`, `goal26-refusal` — the Goal 26 remaining-backlog
  graduation profiles and their live-capture negative neighbors;
- `node`, `node-positive`, `node-refusal` — the Node.js runtime support set.
  `node-refusal` is now empty after all 73 remaining `runtime:node:*` refusals
  were graduated to support;
- `invalidation`, `invalidation-positive`, `invalidation-refusal` — the Goal 28
  stale descriptor/state invalidation baselines, working refresh profiles, and
  paired refusals;
- `invalidation-work`, `invalidation-work-positive` — the Goal 28 profiles that
  make invalidation cases work by refreshing target-native provenance and
  completing after revalidation;
- `node-invalidation`, `node-invalidation-refusal`, `node-invalidation-work` —
  the Goal 28 Node-specific invalidation refusal and working refresh profiles;
- `node-apps`, `node-apps-supported`, `node-real-apps`,
  `node-real-apps-positive` — representative proof-backed Node application
  workloads with real fixtures, app harnesses, target output verifiers, and
  checked summaries;
- `node-real-cli`, `node-real-cjs`, `node-real-esm`,
  `node-real-timers-async`, `node-real-fs-stdio`, `node-real-http-tcp`,
  `node-real-udp-dns`, `node-real-worker`, `node-real-native-addon`, and
  `node-real-crypto-tls` — individual real Node application smoke workloads;
- `pnpm smoke-node-real-app-cross-arch -- --source all --json` — live
  cross-architecture Node app smoke across the local arm64 source, the arm64
  remote builder source, and the Proxmox amd64 target. It executes all ten real
  Node app fixtures on each source, executes them again on the amd64 target, and
  compares source-capture and target-restore summaries while requiring different
  source/target architectures and target output verification;
- `node-live`, `node-live-positive`, `node-live-refusal`, `node-live-apps`,
  `node-live-real-world`, `node-live-local-to-proxmox`, and
  `node-live-remote-builder-to-proxmox` — Goal 33 live Node capture/restore
  graduation presets. The positive presets cover the ten live Node app classes;
  `node-live-refusal` is intentionally empty unless a future live refusal profile
  is promoted into the checked-in profile inventory because Goal 33's live smoke
  records unsafe-neighbor refusals in the live route summary;
- `pnpm smoke-node-production-restore -- --keep --work-dir /tmp/machinen-node-production`
  — Goal 34 production-shaped Node proof with dependencies, config, HTTP routes,
  file writes, durable JSONL database/log state, real compiled `.node` addon
  provenance, local arm64 and remote-builder arm64 source routes, Proxmox amd64
  target routes, and Node 20/22/24 version coverage;
- `pnpm smoke-node-production-repeatability -- --keep --work-dir /tmp/machinen-node-production-repeat`
  — Goal 34 repeatability proof with a 100% pass-rate requirement;
- `pnpm smoke-node-expanded-restore -- --keep --work-dir /tmp/machinen-node-expanded`
  — Goal 35 expanded Node proof for arbitrary existing processes, active
  HTTP/TCP preservation, child process/IPC trees, inspector policy, ambiguous
  dirty-state policy, broad native addon/ABI coverage, and the amd64 -> arm64
  route across Node 20/22/24;
- `node scripts/portable-machine-proof-matrix.mjs --preset node-expanded --check-summary-dir docs/snapshot/checked-summaries/node-expanded --json`
  — Goal 35 checked-summary matrix for the expanded Node claims;
- `pnpm smoke-node-complex-restore -- --keep --work-dir /tmp/machinen-node-complex`
  — Goal 36 complex Node proof for framework apps, real persistence, WebSocket
  and TLS/keep-alive networking, cluster/worker/supervisor topology, published
  native package layouts, concurrent load/failure injection, and Node 18/20/22/24
  bidirectional architecture coverage;
- `node scripts/portable-machine-proof-matrix.mjs --preset node-complex --check-summary-dir docs/snapshot/checked-summaries/node-complex --json`
  — Goal 36 checked-summary matrix for complex Node claims;
- `pnpm smoke-node-ecosystem-restore -- --keep --work-dir /tmp/machinen-node-ecosystem`
  — Goal 37 audited third-party ecosystem-equivalent proof with local registry
  fixtures, native prebuild layout simulation, lockfile/SBOM provenance,
  no-network/no-scripts sandbox policy, and Node 18/20/22/24 bidirectional
  architecture coverage without third-party installs;
- `node scripts/portable-machine-proof-matrix.mjs --preset node-ecosystem --check-summary-dir docs/snapshot/checked-summaries/node-ecosystem --json`
  — Goal 37 checked-summary matrix for audited no-install ecosystem claims;
- `pnpm smoke-non-node-runtime-proof -- --keep --work-dir /tmp/machinen-non-node-runtime`
  — Goal 38 non-Node runtime proof-or-refusal smoke for JVM/Spring-style,
  Python Django/Celery-style, Ruby Rails/Puma-style, Go service/runtime, and the
  cross-runtime comparison;
- `node scripts/portable-machine-proof-matrix.mjs --preset non-node-runtimes --check-summary-dir docs/snapshot/checked-summaries/non-node-runtimes --json`
  — Goal 38 checked-summary matrix for non-Node runtime claims;
- `pnpm smoke-non-node-cross-arch -- --keep --work-dir /tmp/goal39-cross --iterations 3`
  — Goal 39 live bidirectional arm64/amd64 repeatability proof for Python and
  Go;
- `node scripts/portable-machine-proof-matrix.mjs --preset non-node-cross-arch --check-summary-dir docs/snapshot/checked-summaries/non-node-cross-arch --json`
  — Goal 39 checked-summary matrix for Python/Go cross-architecture claims;
- `pnpm smoke-goal40-hard-runtime-state -- --keep --work-dir /tmp/goal40-hard-state`
  — Goal 40 hard runtime-state support-or-refusal smoke for active sockets/TLS,
  opaque native extensions, and arbitrary Go scheduler state;
- `node scripts/portable-machine-proof-matrix.mjs --preset goal40-hard-state --check-summary-dir docs/snapshot/checked-summaries/goal40-hard-state --json`
  — Goal 40 checked-summary/refusal matrix for hard runtime-state boundaries;
- `pnpm smoke-hard-runtime-refusal-contract -- --keep --work-dir /tmp/goal41-refusals`
  — Goal 41 user-facing hard-runtime refusal contract smoke;
- `node scripts/portable-machine-proof-matrix.mjs --preset goal41-refusal --check-summary-dir docs/snapshot/checked-summaries/goal41-refusals --json`
  — Goal 41 checked-summary matrix for stable hard-runtime refusals;
- `pnpm smoke-go-quiescent-runtime -- --keep --work-dir /tmp/goal42-go --iterations 3`
  — Goal 42 bidirectional arm64/amd64 proof for Go quiesced HTTP, drained
  workers, drained channels, and deterministic timers;
- `node scripts/portable-machine-proof-matrix.mjs --preset go-quiescent-runtime --check-summary-dir docs/snapshot/checked-summaries/go-quiescent-runtime --json`
  — Goal 42 checked-summary/refusal matrix for Go quiescent runtime claims;
- `pnpm smoke-postgres-cross-arch-restore -- --keep --work-dir /tmp/goal43-postgres-cross-arch`
  — Goal 43 bidirectional arm64/amd64 PostgreSQL clean/quiesced logical restore proof;
- `node scripts/portable-machine-proof-matrix.mjs --preset postgres-machinen --check-summary-dir docs/snapshot/checked-summaries/postgres-machinen --json`
  — Goal 43 checked-summary/refusal matrix for PostgreSQL claims;
- `pnpm smoke-stateful-services-proof -- --keep --work-dir /tmp/goal44-stateful`
  — Goal 44 Redis, SQLite, PostgreSQL, MariaDB, durable queue, and filesystem
  stateful-services restore proof smoke;
- `node scripts/portable-machine-proof-matrix.mjs --preset stateful-services --check-summary-dir docs/snapshot/checked-summaries/stateful-services --json`
  — Goal 44 aggregate checked-summary/refusal matrix;
- `node-blockers`, `node-blockers-refusal`, `node-blockers-supported` — the Goal
  29 Node blocker profiles. `node-blockers-refusal` is now empty after the 81
  broad blocker refusals were graduated; `node-blockers-supported` contains the
  170 working blocker support profiles;
- `node-native-addon`, `node-workers`, `node-async`, `node-timers`,
  `node-network`, `node-fs-stdio`, `node-v8-heap`, `node-module-graph`,
  `node-process-signal`, and `node-identity-invalidation` — Goal 29 family-level
  Node blocker matrices.

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
