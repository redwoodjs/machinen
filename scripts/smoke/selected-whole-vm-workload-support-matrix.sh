#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RETAINED="${SELECTED_WHOLE_VM_WORKLOAD_RETAINED_DIR:-$ROOT/proofs/linux-vm-workload/selected-whole-vm-workload/retained}"
cd "$ROOT"

pnpm exec tsx "$ROOT/proofs/linux-vm-workload/scripts/selected-whole-vm-workload-support-matrix.ts" \
  --retained-dir "$RETAINED" >/dev/null

pnpm exec oxfmt "$RETAINED"/*.json >/dev/null

cat "$RETAINED/selected-whole-vm-workload-support-matrix-report.json"
