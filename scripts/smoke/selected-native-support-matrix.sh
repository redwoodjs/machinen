#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${SELECTED_NATIVE_SUPPORT_MATRIX_DIR:-$ROOT/proofs/native-process-substrate/selected-native-support-matrix/retained}"
mkdir -p "$OUT"
cd "$ROOT"

# The matrix invokes the built product CLI so it verifies the public command surface.
pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null

pnpm exec tsx "$ROOT/proofs/native-process-substrate/scripts/selected-native-support-matrix.ts" \
  --out-dir "$OUT" >/dev/null

pnpm exec oxfmt \
  "$OUT/selected-native-support-matrix-report.json" \
  "$OUT"/*/*/*.json \
  "$OUT"/*/*/*/*.json >/dev/null

cat "$OUT/selected-native-support-matrix-report.json"
