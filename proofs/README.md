# Claim-organized proofs

This directory groups proof artifacts by the product claim they support or block.

Top-level product claim folders include:

- `nodejs/`
- `postgres/`
- `bun/`
- `generic-linux-service/`
- `arbitrary-linux-binaries/`
- `native-process-substrate/`
- `linux-vm-workload/`
- `network-resources/`

Historical numbered proofs are physically grouped under product folders such as
`proofs/nodejs/proper-level5-numbered/<id>/` and
`proofs/nodejs/app-corpus-numbered/<id>/`. Shared Node proof helpers live in
`proofs/nodejs/utils/`, Node proof/evidence runners live in
`proofs/nodejs/scripts/`, arbitrary-process proof runners live in
`proofs/arbitrary-linux-binaries/scripts/`, and Level 4 network-resource runners
live in `proofs/network-resources/scripts/`. The `proofs/by-id/<id>` symlink
index preserves proof-id lookup for older matrices and smoke scripts without
keeping numbered proof directories at the root.

New claim-facing proof summaries should live under the product claim folders above.

The dashboard source of truth is `docs/snapshot/claim-progress.json`; each
claim group here has a `claim.json` copy plus a readable `README.md`.

- [Node claim evidence index](./nodejs/claim-evidence-index/README.md) — `claim-facing-index-verified`
- [Node service 100 / 100 / 0 selected service claim](./nodejs/100-100-0/README.md) — `verified`
- [Node real cross-architecture E2E gate](./nodejs/real-cross-arch-e2e-gate/README.md) — `partial-proof`
- [Postgres clean logical descriptor fixture](./postgres/20-0-0/README.md) — `partial-proof`
- [Postgres / psql VM-state snapshot/restore](./postgres/vmstate-snapshot-restore/README.md) — `verified`
- [Postgres / psql bidirectional cross-arch logical restore](./postgres/cross-arch-logical-psql-restore/README.md) — `verified`
- [Postgres real cross-architecture no-dump product E2E gate](./postgres/real-cross-arch-e2e-gate/README.md) — `verified`
- [Bun service support not started](./bun/not-started/README.md) — `not-started`
- [Generic Linux service support not started](./generic-linux-service/not-started/README.md) — `not-started`
- [Level 4 ping resource continuation](./network-resources/level4-ping-resource-continuation/README.md) — `proven-resource`
- [Native process substrate proof gate](./native-process-substrate/README.md) — `verified`
- [Native regular-file FD bidirectional proof](./native-process-substrate/regular-file-fd-bidirectional/README.md) — `verified`
- [Native resource coverage matrix](./native-process-substrate/resource-coverage/README.md) — `verified`
- [Selected native workload E2E harness](./native-process-substrate/selected-workload-e2e/README.md) — `verified`
- [Selected native product-path E2E gate](./native-process-substrate/product-e2e-gate/README.md) — `verified`
- [Selected native support matrix](./native-process-substrate/selected-native-support-matrix/README.md) — `verified`
- [Arbitrary process 0% / candidate 1% locked](./arbitrary-linux-binaries/0-seed-1-locked/README.md) — `partial-proof`
- [Whole Linux VM workload portability taxonomy](./linux-vm-workload/not-started/README.md) — `defined`
- [Whole VM workload boundary matrix](./linux-vm-workload/boundary-matrix/README.md) — `verified`
- [Whole VM workload smoke matrix](./linux-vm-workload/smoke-matrix/README.md) — `verified`
- [Selected whole VM workload support matrix](./linux-vm-workload/selected-whole-vm-workload/README.md) — `verified`
- [Whole VM workload next corpus](./linux-vm-workload/next-corpus/README.md) — `defined`
