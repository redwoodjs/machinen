# Goal 19: Validation-scale proof infrastructure

Parent context: [`goal-018.md`](./goal-018.md) identifies validation scale as the
first cross-cutting blocker for approaching broad portable snapshot/restore.
Remote target-native proofs are intentionally expensive, and the refusal matrix
will keep growing as unsupported kernel-visible state is modeled fail-closed.

## Objective

Make proof validation faster and easier to audit by adding matrix sharding,
reusable summary caching, artifact inventory output, and real-workload suite
selection. This goal does not change runtime support. It improves proof
infrastructure so later kernel/network/memory/threading goals can run larger
matrices continuously.

## Outcome

Implemented in `scripts/portable-machine-proof-matrix.mjs`:

- [x] matrix sharding via `--shard index/count`;
- [x] reusable smoke-summary cache via `--summary-cache-dir`;
- [x] write-only reusable summary output via `--save-summary-dir`;
- [x] automatic artifact inventory in every matrix summary;
- [x] standalone artifact inventory file via `--artifact-inventory`;
- [x] real workload presets: - `real-workload`; - `real-workload-positive`;
- [x] matrix summary fields for `summarySources`, `savedSummaries`, and `shard`.

## Deferred batching work

Batching multiple target-native negative proofs into one VM boot is still not
implemented. This goal adds the cache/shard/inventory pieces needed first. A
future batching goal should add a target-side parent summary with per-profile
child gate results and then wire that into the matrix runner.

## Validation

- [x] schema validation: `pnpm --silent portable-machine-proof-runner -- --validate-schema --json` — 0.158s.
- [x] focused Vitest coverage for sharded cached summaries and artifact inventory
      output: `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run packages/runtime/src/__tests__/portable-machine-proof-matrix.test.ts packages/runtime/src/__tests__/portable-machine-proof-runner.test.ts` — 3.333s.
- [x] matrix CLI smoke checked with `--summary-cache-dir`, `--artifact-inventory`, and `--shard 2/2` — 0.181s.
- [x] `pnpm run format:check` — 0.616s.
- [x] `pnpm run lint` — 0.184s.
- [x] `pnpm run build:docs` — 1.540s.
- [x] `pnpm run typecheck` — 2.020s.
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 26.792s.
- [x] `pnpm exec fallow audit --changed-since origin/main` — 0.348s.
- [x] `git diff --check` — 0.015s.
- [x] docs updated in `docs/snapshot/proof-matrices.md`.

Full smoke tests were not run because this change touches proof matrix orchestration,
summary caching, artifact inventory, tests, and docs only; it does not change
VM/VMM, rootfs/base assets, CLI boot/exec/mount, snapshot/restore runtime
behavior, virtio devices, memory/ballooning, or FUSE/live mounts.

## Completion criteria

- [x] Matrix sharding is deterministic and reported in summary JSON.
- [x] Existing smoke summaries can be reused without rerunning profiles.
- [x] Newly run profiles can save reusable smoke summaries.
- [x] Artifact inventories are generated automatically and can be written to a
      standalone JSON file.
- [x] Real-workload proof suites can be selected without hand-maintaining profile
      lists.
