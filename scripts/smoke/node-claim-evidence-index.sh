#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${NODE_CLAIM_EVIDENCE_INDEX_REPORT:-$ROOT/proofs/nodejs/claim-evidence-index/retained/node-claim-evidence-index-report.json}"

pnpm exec tsx "$ROOT/proofs/nodejs/scripts/node-claim-evidence-index.ts" \
  --root "$ROOT/proofs/nodejs" \
  --out "$OUT" \
  --json

pnpm exec oxfmt "$OUT" >/dev/null
