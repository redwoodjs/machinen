#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${WHOLE_VM_WORKLOAD_SMOKE_MATRIX_DIR:-$ROOT/proofs/linux-vm-workload/smoke-matrix/retained}"
GUEST_ARCH="${MACHINEN_GUEST_ARCH:-arm64}"
mkdir -p "$OUT"
cd "$ROOT"

pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null

pnpm exec tsx "$ROOT/proofs/linux-vm-workload/scripts/whole-vm-workload-smoke-matrix.ts" \
  --out-dir "$OUT" \
  --guest-arch "$GUEST_ARCH" >/dev/null

pnpm exec oxfmt "$OUT"/*.json "$OUT"/*.c "$OUT"/*.sh >/dev/null

cat "$OUT/whole-vm-workload-smoke-matrix-report.json"
