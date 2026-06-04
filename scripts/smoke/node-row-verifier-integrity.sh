#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${NODE_ROW_VERIFIER_INTEGRITY_REPORT:-$ROOT/proofs/nodejs/claim-evidence-index/retained/node-row-verifier-integrity-report.json}"

pnpm exec tsx "$ROOT/proofs/nodejs/scripts/node-row-verifier-integrity.ts" \
  --root "$ROOT/proofs/nodejs" \
  --out "$OUT" \
  --json

pnpm exec oxfmt "$OUT" >/dev/null
