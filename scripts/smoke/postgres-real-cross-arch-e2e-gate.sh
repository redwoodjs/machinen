#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${POSTGRES_REAL_CROSS_ARCH_E2E_GATE_REPORT:-$ROOT/proofs/postgres/real-cross-arch-e2e-gate/retained/postgres-real-cross-arch-e2e-gate-report.json}"

pnpm exec tsx "$ROOT/proofs/postgres/scripts/postgres-real-cross-arch-e2e-gate.ts" \
  --root "$ROOT" \
  --out "$OUT" \
  --json

pnpm exec oxfmt "$OUT" >/dev/null
