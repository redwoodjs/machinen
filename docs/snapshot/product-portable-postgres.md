# Product portable PostgreSQL cross-architecture restore

There is currently **no public Postgres no-dump `machinen snapshot` / `machinen restore` claim**.

The existing PostgreSQL work is proof-only fixture evidence for a logical descriptor path. It uses a logical dump artifact and verifier output; it does not prove that a user can point Machinen at a live PostgreSQL service and restore it cross-architecture without providing a dump.

## Current public claim

```json
{
  "productSupport": 0,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

## What exists

The fixture path describes `postgres-clean-quiesced-logical-v1`:

- source and target architectures are `arm64` and `amd64` in either direction;
- PostgreSQL has no active client transaction or session that must survive;
- capture uses a logical dump artifact;
- target restore compares target-native verifier output with the source verifier output;
- unsafe neighbors fail closed in descriptor-level tests.

This is useful implementation substrate, but it is not enough for a public product or broad service/workload claim.

## Required real E2E gate

A public Postgres claim requires `proofs/postgres/real-cross-arch-e2e-gate/` to pass with retained artifacts:

1. Start real PostgreSQL on amd64.
2. Load schema, data, and workload.
3. Capture through the product command without a user-supplied dump; any logical dump is internally produced and retained as implementation evidence.
4. Restore on arm64 target-native PostgreSQL.
5. Run verifier queries and app workload.
6. Retain source transcript, target transcript, manifest, restore summary, verifier outputs, and workload results.
7. Repeat arm64 -> amd64.
8. Retain refusal artifacts for active sessions/transactions, dirty WAL, physical data-dir copy, replication/failover state, source-ISA emulation, sidecars, app hooks, and metadata-only success.

Only after that gate passes can Postgres product or broad service/workload percentages move above 0.

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
