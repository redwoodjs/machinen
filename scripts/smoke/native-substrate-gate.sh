#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RETAINED="$ROOT/proofs/native-process-substrate/retained"
RAW="$RETAINED/raw"
OUT="${NATIVE_SUBSTRATE_GATE_REPORT:-$RETAINED/native-substrate-gate-report.json}"
mkdir -p "$RAW"

pnpm exec tsx "$ROOT/scripts/native-register-translate.ts" verify --json --out-dir "${TMPDIR:-/tmp}/native-register-translate-gate" > "$RAW/native-register-translate.json"
pnpm exec tsx "$ROOT/scripts/native-memory-translate.ts" verify --json --out-dir "${TMPDIR:-/tmp}/native-memory-translate-gate" > "$RAW/native-memory-translate.json"
pnpm exec tsx "$ROOT/scripts/native-stack-translate.ts" verify --json --out-dir "${TMPDIR:-/tmp}/native-stack-translate-gate" > "$RAW/native-stack-translate.json"
pnpm exec tsx "$ROOT/scripts/native-thread-refusal-matrix.ts" verify --json --out-dir "${TMPDIR:-/tmp}/native-thread-refusal-matrix-gate" > "$RAW/native-thread-refusal-matrix.json"
pnpm exec tsx "$ROOT/scripts/native-boundary-check.ts" verify --json --out-dir "${TMPDIR:-/tmp}/native-boundary-check-gate" > "$RAW/native-boundary-check.json"
pnpm exec tsx "$ROOT/scripts/native-active-syscall-policy.ts" verify --json --out-dir "${TMPDIR:-/tmp}/native-active-syscall-policy-gate" > "$RAW/native-active-syscall-policy.json"
pnpm exec tsx "$ROOT/scripts/native-controlled-restore.ts" verify --json --out-dir "${TMPDIR:-/tmp}/native-controlled-restore-gate" > "$RAW/native-controlled-restore.json"

pnpm exec tsx "$ROOT/proofs/native-process-substrate/scripts/native-substrate-gate.ts" \
  --root "$ROOT" \
  --out "$OUT" >/dev/null

pnpm exec oxfmt \
  "$OUT" \
  "$RAW"/*.json \
  "$RETAINED"/row-proofs/*/row-proof.json >/dev/null

cat "$OUT"
