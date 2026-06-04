#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${NATIVE_SELECTED_WORKLOAD_E2E_DIR:-$ROOT/proofs/native-process-substrate/selected-workload-e2e/retained}"
AMD64_RUNNER="${NATIVE_SELECTED_WORKLOAD_AMD64_RUNNER:-root@192.168.0.8}"
ARM64_RUNNER="${NATIVE_SELECTED_WORKLOAD_ARM64_RUNNER:-friend@100.126.46.90}"
mkdir -p "$OUT"
cd "$ROOT"

pnpm exec tsx "$ROOT/proofs/native-process-substrate/scripts/native-selected-workload-e2e.ts" \
  --out-dir "$OUT" \
  --amd64-runner "$AMD64_RUNNER" \
  --arm64-runner "$ARM64_RUNNER" >/dev/null

pnpm exec oxfmt \
  "$OUT/native-selected-workload-e2e-report.json" \
  "$OUT"/*/*.json >/dev/null

cat "$OUT/native-selected-workload-e2e-report.json"
