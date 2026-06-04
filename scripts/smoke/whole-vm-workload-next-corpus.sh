#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${WHOLE_VM_WORKLOAD_NEXT_CORPUS_DIR:-$ROOT/proofs/linux-vm-workload/next-corpus/retained}"
mkdir -p "$OUT"
cd "$ROOT"

pnpm exec tsx "$ROOT/proofs/linux-vm-workload/scripts/whole-vm-workload-next-corpus.ts" \
  --out-dir "$OUT" >/dev/null

pnpm exec oxfmt "$OUT"/*.json >/dev/null

cat "$OUT/whole-vm-workload-next-corpus-report.json"
