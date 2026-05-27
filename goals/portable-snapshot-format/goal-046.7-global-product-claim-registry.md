# Goal 46.7: Global product claim registry, discovery, docs, and guidance

## Objective

Expose a global product registry so users can distinguish implemented product
support, stable product refusals, proof-only fixtures, and obsolete/invalid
claims.

## Completion record

Completed with:

- Runtime API: `buildProductClaimRegistry`, `filterProductClaimRegistry`,
  `productClaimRefusalSummary`, product claim types and constants.
- CLI discovery: `machinen support` with `--family`, `--runtime`, `--status`,
  `--profile`, `--resource-family`, `--refusal-code`, and `--json`.
- Matrix: `scripts/product-claim-registry-matrix.mjs` and package script
  `pnpm run product-claim-registry-matrix`.
- Smoke: `scripts/smoke/product-support-discovery.sh` and package script
  `pnpm run smoke-product-support-discovery`.
- Docs: `docs/snapshot/product-claim-registry.md`, API docs, CLI help,
  completions, and `docs/snapshot/proof-matrices.md`.
- Checked summaries:
  `docs/snapshot/checked-summaries/product-claim-registry/`.
