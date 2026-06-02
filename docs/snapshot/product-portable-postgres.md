# Product portable PostgreSQL cross-architecture restore

There is now a scoped public Postgres no-dump product claim for selected clean quiesced PostgreSQL service capture/restore.

The claim is backed by retained `machinen capture postgres` / `machinen restore` artifacts in both architecture directions. The product command generates internal PostgreSQL evidence without requiring a user-provided dump, restores into target-native PostgreSQL, and runs `psql` verification on the target.

## Current public claim

```json
{
  "productSupport": 100,
  "broadSupport": 100,
  "arbitraryProcessCrossArchRestore": 0
}
```

Scope: selected clean quiesced PostgreSQL service capture/restore only. Arbitrary PostgreSQL states and arbitrary Linux process restore remain unclaimed.

## What exists

A retained same-architecture VM-state proof now verifies PostgreSQL/psql snapshot/restore for a clean quiesced PostgreSQL 15 service inside an `arm64` Machinen VM:

- proof folder: `proofs/postgres/vmstate-snapshot-restore/`;
- source schema/data/workload were loaded through `psql`;
- `machinen snapshot` used the `vmstate` engine;
- `machinen restore` completed;
- target `psql` verifier output matched source output;
- no source ISA emulation, sidecar, app hook, source-text replay, or metadata-only shortcut was accepted.

This proves a narrow same-arch PostgreSQL/psql VM-state restore. It does **not** prove portable PostgreSQL cross-architecture support.

A retained bidirectional native logical proof also verifies cross-architecture PostgreSQL/psql logical restore:

- proof folder: `proofs/postgres/cross-arch-logical-psql-restore/`;
- native `arm64` PostgreSQL and native `amd64` PostgreSQL hosts were used;
- `arm64 -> amd64` and `amd64 -> arm64` both passed;
- target-native `psql` verifier output matched source output in both directions;
- retained logical SQL dump hashes matched the route summaries;
- no source ISA emulation, sidecar, app hook, or metadata-only shortcut was accepted.

This proves bidirectional target-native PostgreSQL logical restore and remains useful substrate for the no-dump product gate.

The older fixture path describes `postgres-clean-quiesced-logical-v1`:

- source and target architectures are `arm64` and `amd64` in either direction;
- PostgreSQL has no active client transaction or session that must survive;
- capture uses a logical dump artifact;
- target restore compares target-native verifier output with the source verifier output;
- unsafe neighbors fail closed in descriptor-level tests.

This is useful implementation substrate, but it is not the claim-bearing no-dump product gate.

## Real E2E gate

The public scoped Postgres claim requires `proofs/postgres/real-cross-arch-e2e-gate/` to pass with retained artifacts:

1. Start real PostgreSQL on amd64.
2. Load schema, data, and workload.
3. Capture through the product command without a user-supplied dump; any logical dump is internally produced and retained as implementation evidence.
4. Restore on arm64 target-native PostgreSQL.
5. Run verifier queries and app workload.
6. Retain source transcript, target transcript, manifest, restore summary, verifier outputs, and workload results.
7. Repeat arm64 -> amd64.
8. Retain refusal artifacts for active sessions/transactions, dirty WAL, physical data-dir copy, replication/failover state, source-ISA emulation, sidecars, app hooks, and metadata-only success.

That gate now passes for the selected clean quiesced PostgreSQL product scope and is required to remain accepted before the PostgreSQL claim can stay at 100 / 100 / 0.

## Stable refusals until proven otherwise

- active client transactions;
- active client sessions;
- dirty WAL without a clean checkpoint boundary;
- physical data-directory/WAL byte-copy across ISA;
- live connection/socket continuation;
- replication/failover state;
- source-ISA emulation;
- sidecar replay;
- app checkpoint hooks;
- metadata-only success;
- arbitrary Linux process restore.
