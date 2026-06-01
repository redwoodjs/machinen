# Claim-organized proofs

This directory groups proof artifacts by the product claim they support or block.

Top-level product claim folders include:

- `nodejs/`
- `postgres/`
- `bun/`
- `generic-linux-service/`
- `arbitrary-linux-binaries/`
- `linux-vm-workload/`
- `network-resources/`

Historical numbered proofs are physically grouped under product folders such as
`proofs/nodejs/proper-level5-numbered/<id>/` and
`proofs/nodejs/app-corpus-numbered/<id>/`. Shared Node proof helpers live in
`proofs/nodejs/utils/`. The `proofs/by-id/<id>` symlink index preserves proof-id
lookup for older matrices and smoke scripts without keeping numbered proof
directories at the root.

New claim-facing proof summaries should live under the product claim folders above.

The dashboard source of truth is `docs/snapshot/claim-progress.json`; each
claim group here has a `claim.json` copy plus a readable `README.md`.

- [Node service 100 / 100 / 0](./nodejs/100-100-0/README.md) — `claimed`
- [Postgres clean logical product track](./postgres/logical-product-track/README.md) — `product-track-existing`
- [Bun service support not started](./bun/not-started/README.md) — `not-started`
- [Generic Linux service support not started](./generic-linux-service/not-started/README.md) — `not-started`
- [Level 4 ping resource continuation](./network-resources/level4-ping-resource-continuation/README.md) — `proven-resource`
- [Arbitrary process 0% / candidate 1% locked](./arbitrary-linux-binaries/0-seed-1-locked/README.md) — `partial-proof`
- [Whole Linux VM workload portability not started](./linux-vm-workload/not-started/README.md) — `not-started`
