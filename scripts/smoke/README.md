# Smoke suite audit

This directory now has an explicit support boundary. The active `smoke-*`
package scripts are reserved for product/release confidence checks. Research
proofs and architecture guardrails moved to `proof-*` package scripts. Stale
runtime-profile restore scripts were removed from the smoke surface and exposed
only as `archive-*` aliases that fail by default.

See `scripts/smoke/manifest.json` for the full per-script classification.

## Classes

- `product-smoke` — validates a current product or release contract. These are
  the only scripts that should be cited as smoke-test evidence.
- `proof-audit` — useful architecture evidence, refusal checks, or proof-only
  harnesses. These must not be cited as broad product snapshot/restore support.
- `archived` — stale runtime-profile/app-level restore claims or superseded
  harnesses. The files are kept for archaeology/debugging only.
- `helper` — sourced by another script and not runnable by itself.

## Archived scripts

`archive-*` package scripts run through `scripts/archived-smoke.mjs`. They print
why the old script is not active and exit non-zero. To intentionally run one for
archaeology/debugging, set `MACHINEN_RUN_ARCHIVED_SMOKE=1`.
