# Node proof corpus

This directory keeps the Node proof corpus sharded by proof family, plus a single claim-facing evidence index.

## Claim-facing folders

- `claim-evidence-index/` — consolidated index/gate for public Node claims.
- `real-cross-arch-e2e-gate/` — retained bidirectional clean Node HTTP product E2E seed.
- `100-100-0/` — historical previous claim folder, now unverified.

## Numbered proof buckets

- `proper-level5-numbered/` — proper Level 5 low-level/runtime/state proofs.
- `product-path-numbered/` — product-path and product-surface proofs.
- `product-support-numbered/` — Node product-support ladder substrate.
- `app-corpus-numbered/` — app corpus, real-app, and refusal corpus rows.
- `http-behavior-numbered/` — HTTP/framework behavior rows.
- `release-gates-numbered/` — release-gate proof rows.
- `misc-numbered/` — miscellaneous historical Node proofs.

## Policy

Do not collapse the numbered proofs into one giant proof. Keep them sharded for regression/debugging, and consolidate their claim status through `claim-evidence-index/`.

A public claim raise requires retained source/target product artifacts, not just checked summaries or claim metadata.
