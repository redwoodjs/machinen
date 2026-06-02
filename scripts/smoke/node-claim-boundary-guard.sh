#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${NODE_CLAIM_BOUNDARY_GUARD_REPORT:-$ROOT/proofs/nodejs/claim-evidence-index/retained/node-claim-boundary-guard-report.json}"

pnpm exec tsx "$ROOT/proofs/nodejs/scripts/node-claim-boundary-guard.ts" \
  --root "$ROOT" \
  --out "$OUT" \
  --json

pnpm exec oxfmt "$OUT" >/dev/null
