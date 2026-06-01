# Product portable PostgreSQL cross-architecture restore

Goal 45 productizes one narrow `amd64 <-> arm64` path: clean, quiesced
PostgreSQL logical state. This is not arbitrary VM memory portability. The
portable unit is a logical PostgreSQL dump plus provenance and verifier output;
the target must import it into target-native PostgreSQL and pass the verifier
before `migrationCompleted=true` is reported.

## Implemented product subset

`postgres-clean-quiesced-logical-v1` is implemented product support when all of
these are true:

- source and target architectures are `arm64` and `amd64` in either direction;
- PostgreSQL has no active client transaction or session that must survive;
- the source records a clean checkpoint/WAL boundary;
- capture uses a logical dump, not a physical data-directory/WAL byte-copy;
- target restore runs on target-native PostgreSQL;
- target verifier output exactly matches the source verifier output.

The CLI/API surfaces are:

```sh
machinen capture postgres \
  --out ./pg.portable \
  --source-arch arm64 \
  --target-arch amd64 \
  --dump ./pg.dump \
  --source-verifier-output ./source.verify.txt \
  --postgres-version 15 \
  --checkpoint-lsn 0/16B6C50 \
  --init-sql ./init.sql \
  --workload-sql ./workload.sql \
  --verifier-sql ./verify.sql \
  --data-manifest ./data-manifest.txt \
  --json

# After importing pg.portable/postgres.logical.dump into target-native PostgreSQL
# and running the same verifier SQL on the target:
machinen restore ./pg.portable \
  --target-arch amd64 \
  --target-verifier-output ./target.verify.txt \
  --json
```

## Descriptor contract

The bundle contains:

- `portable-product.json` — descriptor with `formatVersion`, support level,
  source/target architecture, PostgreSQL version, checkpoint LSN, digest
  provenance, shortcut gates, and the source verifier output;
- `postgres.logical.dump` — logical dump artifact;
- `restore-summary.json` — written by product restore.

Successful descriptors set:

- `kind="machinen.product-portable-snapshot"`;
- `supportLevel="implemented-product-support"`;
- `subset="postgres-clean-quiesced-logical-v1"`;
- shortcut gates disallow source-ISA emulation, source text replay, sidecar
  runtime success, app hooks, and metadata-only continuation.

## Percent-style claim ladder

The clean logical subset now has a retained 20 / 0 / 0 claim ladder:

- product support claim: `20%`;
- broad service/workload claim: `0%`;
- arbitrary Linux process restore claim: `0%`.

The retained ladder lives in
`proofs/postgres/20-0-0/retained/postgres-claim-ladder-report.json`. It keeps
per-proof claim impact rows, bidirectional logical restore bundles, source and
target verifier output, restore summaries, and an unsafe-state refusal artifact.

The 20% -> 40% claim-ready gate is satisfied by
`proofs/postgres/20-0-0/retained/postgres-clean-logical-20-claim-ready-report.json`
and its retained fixture directory. That report adds schema-shape rows,
PostgreSQL 14/15/16 version rows, and clean workload-mix rows with bidirectional
target verifier artifacts. It unlocks a candidate 40% product-support decision,
but the public Postgres claim remains `20 / 0 / 0` until a separate claim-change
PR raises it.

## Stable product refusals

Product capture/restore keeps unsupported neighbors fail-closed with
`migrationCompleted=false`:

- `postgres-active-transaction-unsupported`;
- `postgres-active-session-unsupported`;
- `postgres-dirty-wal-boundary-unsupported`;
- `postgres-host-mounted-data-dir-ambiguous`;
- `postgres-physical-data-dir-cross-isa-unsupported`;
- `postgres-target-arch-mismatch`;
- `postgres-logical-dump-integrity-mismatch`;
- `postgres-target-verifier-mismatch`;
- `postgres-refused-source-state`.

Existing Node, non-Node, Go, native-resource, ping/ICMP/socket, and broader
stateful-service cross-architecture profiles remain proof-only fixtures or stable
product refusals unless a future goal adds a product descriptor and target-native
verifier for them. The Goal 45 PostgreSQL claim classification is
`docs/snapshot/product-cross-arch-claim-inventory.json` and is checked by
`pnpm run product-portable-claim-matrix`. The full Goal 46 product-status
registry is described in `docs/snapshot/product-claim-registry.md` and checked by
`pnpm run product-claim-registry-matrix`.

## Validation

Focused product validation:

```sh
pnpm build
pnpm run smoke-product-portable-postgres
pnpm run product-portable-claim-matrix
```

Broader matrices (runtime support, refusal, foundation, and relevant PostgreSQL
proof matrices) continue to guard the proof envelope.
