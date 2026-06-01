#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

for proof in $(seq 361 380); do
  pnpm exec tsx "proofs/by-id/${proof}/smoke.ts"
done
