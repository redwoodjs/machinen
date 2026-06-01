#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOADER="$ROOT/node_modules/tsx/dist/loader.mjs"

for proof in $(seq 881 920); do
  node --import "$LOADER" "$ROOT/proofs/$proof/smoke.ts"
done
