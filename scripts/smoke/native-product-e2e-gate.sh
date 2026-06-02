#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${NATIVE_PRODUCT_E2E_GATE_DIR:-$ROOT/proofs/native-process-substrate/product-e2e-gate/retained}"
mkdir -p "$OUT"
cd "$ROOT"

pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null

pnpm exec tsx "$ROOT/proofs/native-process-substrate/scripts/native-product-e2e-gate.ts" \
  --out-dir "$OUT" >/dev/null

pnpm exec oxfmt \
  "$OUT/native-product-e2e-gate-report.json" \
  "$OUT"/*/*.json \
  "$OUT"/*/*/*.json >/dev/null

cat "$OUT/native-product-e2e-gate-report.json"
