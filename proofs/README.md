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
- [Postgres real cross-architecture E2E gate](./postgres/real-cross-arch-e2e-gate/README.md) — `blocked-by-missing-real-e2e-artifacts`
- [Bun service support not started](./bun/not-started/README.md) — `not-started`
- [Generic Linux service support not started](./generic-linux-service/not-started/README.md) — `not-started`
- [Level 4 ping resource continuation](./network-resources/level4-ping-resource-continuation/README.md) — `proven-resource`
- [Arbitrary process 0% / candidate 1% locked](./arbitrary-linux-binaries/0-seed-1-locked/README.md) — `partial-proof`
- [Whole Linux VM workload portability not started](./linux-vm-workload/not-started/README.md) — `not-started`
