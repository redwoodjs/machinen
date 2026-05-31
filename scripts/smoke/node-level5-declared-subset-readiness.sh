#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

for proof in $(seq -w 181 211); do
  pnpm exec tsx "proof/${proof}/smoke.ts"
done
