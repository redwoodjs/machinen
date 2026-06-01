#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

for proof in $(seq 246 275); do
  pnpm exec tsx "proofs/${proof}/smoke.ts"
done
