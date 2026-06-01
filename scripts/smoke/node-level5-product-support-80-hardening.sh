#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

for proof in $(seq 321 340); do
  pnpm exec tsx "proofs/${proof}/smoke.ts"
done
