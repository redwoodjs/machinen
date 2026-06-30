# Smoke suite

This directory contains product smoke-test entrypoints only.

Active `smoke-*` package scripts are reserved for product/release confidence
checks. Proof, research, architecture-gauntlet, and archived restore harnesses
are intentionally not exposed through `package.json`.

See `scripts/smoke/manifest.json` for the product smoke inventory.

## Classes

- `product-smoke` — validates a current product or release contract.
- `helper` — sourced by another smoke script and not runnable by itself.
