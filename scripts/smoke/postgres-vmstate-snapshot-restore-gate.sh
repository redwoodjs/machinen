#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${POSTGRES_VMSTATE_SNAPSHOT_RESTORE_GATE_REPORT:-$ROOT/proofs/postgres/vmstate-snapshot-restore/retained/postgres-vmstate-snapshot-restore-gate-report.json}"

pnpm exec tsx "$ROOT/proofs/postgres/scripts/postgres-vmstate-snapshot-restore-gate.ts" \
  --root "$ROOT" \
  --out "$OUT" \
  --json

pnpm exec oxfmt "$OUT" "$ROOT/proofs/postgres/vmstate-snapshot-restore/retained/target/verifier.json" >/dev/null
