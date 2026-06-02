#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RETAINED="${WHOLE_VM_WORKLOAD_CORPUS_PROOF_RETAINED_DIR:-$ROOT/proofs/linux-vm-workload/corpus-proof/retained}"
cd "$ROOT"

pnpm exec tsx "$ROOT/proofs/linux-vm-workload/scripts/whole-vm-workload-corpus-proof.ts" \
  --retained-dir "$RETAINED" >/dev/null

pnpm exec oxfmt "$RETAINED"/*.json >/dev/null

cat "$RETAINED/whole-vm-workload-corpus-proof-report.json"
