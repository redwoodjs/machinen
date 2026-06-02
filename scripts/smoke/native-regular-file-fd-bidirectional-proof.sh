#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${NATIVE_REGULAR_FILE_FD_PROOF_DIR:-$ROOT/proofs/native-process-substrate/regular-file-fd-bidirectional/retained}"
mkdir -p "$OUT"
cd "$ROOT"

pnpm exec tsx "$ROOT/proofs/native-process-substrate/scripts/native-regular-file-fd-bidirectional-proof.ts" \
  --out-dir "$OUT" >/dev/null

pnpm exec oxfmt \
  "$OUT"/native-regular-file-fd-bidirectional-proof-report.json \
  "$OUT"/*/*.json >/dev/null

cat "$OUT/native-regular-file-fd-bidirectional-proof-report.json"
