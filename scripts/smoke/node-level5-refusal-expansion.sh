#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOADER="$ROOT/node_modules/tsx/dist/loader.mjs"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-refusal-expansion.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

node --import "$LOADER" "$ROOT/proofs/nodejs/scripts/node-level5-real-app-refusal-corpus.ts" \
  --out "$WORKDIR/run" \
  --json > "$WORKDIR/summary.json"
export NODE_LEVEL5_REFUSAL_EXPANSION_SUMMARY="$WORKDIR/summary.json"

for proof in $(seq 1001 1040); do
  node --import "$LOADER" "$ROOT/proofs/by-id/$proof/smoke.ts"
done
