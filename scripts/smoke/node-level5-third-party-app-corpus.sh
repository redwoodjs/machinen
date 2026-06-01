#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOADER="$ROOT/node_modules/tsx/dist/loader.mjs"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-third-party-app-corpus.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

node --import "$LOADER" "$ROOT/scripts/node-level5-third-party-app-corpus.ts" \
  --out "$WORKDIR/run" \
  --json > "$WORKDIR/summary.json"
export NODE_LEVEL5_THIRD_PARTY_APP_CORPUS_SUMMARY="$WORKDIR/summary.json"

for proof in $(seq 801 840); do
  node --import "$LOADER" "$ROOT/proofs/$proof/smoke.ts"
done
