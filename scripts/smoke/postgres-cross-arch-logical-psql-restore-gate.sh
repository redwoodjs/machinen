#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${POSTGRES_CROSS_ARCH_LOGICAL_PSQL_RESTORE_GATE_REPORT:-$ROOT/proofs/postgres/cross-arch-logical-psql-restore/retained/postgres-cross-arch-logical-psql-restore-gate-report.json}"

pnpm exec tsx "$ROOT/proofs/postgres/scripts/postgres-cross-arch-logical-psql-restore-gate.ts" \
  --root "$ROOT" \
  --out "$OUT" \
  --json

pnpm exec oxfmt \
  "$OUT" \
  "$ROOT/proofs/postgres/cross-arch-logical-psql-restore/retained/arm64-to-amd64/verifier.json" \
  "$ROOT/proofs/postgres/cross-arch-logical-psql-restore/retained/amd64-to-arm64/verifier.json" \
  >/dev/null
