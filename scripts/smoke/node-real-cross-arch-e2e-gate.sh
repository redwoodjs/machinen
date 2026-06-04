#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RETAINED="${NODE_REAL_CROSS_ARCH_E2E_RETAINED:-$ROOT/proofs/nodejs/real-cross-arch-e2e-gate/retained}"
OUT="${NODE_REAL_CROSS_ARCH_E2E_REPORT:-$ROOT/proofs/nodejs/real-cross-arch-e2e-gate/retained/node-real-cross-arch-e2e-gate-report.json}"

pnpm exec tsx "$ROOT/proofs/nodejs/scripts/node-real-cross-arch-e2e-gate.ts" \
  --root "$RETAINED" \
  --out "$OUT" \
  --json

pnpm exec oxfmt "$OUT" >/dev/null
