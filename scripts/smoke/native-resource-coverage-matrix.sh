#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${NATIVE_RESOURCE_COVERAGE_DIR:-$ROOT/proofs/native-process-substrate/resource-coverage/retained}"
mkdir -p "$OUT"
cd "$ROOT"

pnpm exec tsx "$ROOT/proofs/native-process-substrate/scripts/native-resource-coverage-matrix.ts" \
  --out-dir "$OUT" >/dev/null

pnpm exec oxfmt \
  "$OUT/native-resource-coverage-matrix-report.json" \
  "$OUT"/row-proofs/*/row-proof.json >/dev/null

cat "$OUT/native-resource-coverage-matrix-report.json"
