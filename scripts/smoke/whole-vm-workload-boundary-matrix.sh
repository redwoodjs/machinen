#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${WHOLE_VM_WORKLOAD_BOUNDARY_MATRIX_DIR:-$ROOT/proofs/linux-vm-workload/boundary-matrix/retained}"
mkdir -p "$OUT"
cd "$ROOT"

pnpm exec tsx "$ROOT/proofs/linux-vm-workload/scripts/whole-vm-workload-boundary-matrix.ts" \
  --taxonomy "$ROOT/docs/snapshot/whole-linux-vm-workload-taxonomy.json" \
  --out-dir "$OUT" >/dev/null

pnpm exec oxfmt "$OUT/whole-vm-workload-boundary-matrix-report.json" >/dev/null

cat "$OUT/whole-vm-workload-boundary-matrix-report.json"
