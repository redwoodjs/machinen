#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOADER="$ROOT/node_modules/tsx/dist/loader.mjs"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-product-run-corpus.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

node --import "$LOADER" "$ROOT/scripts/node-level5-real-app-product-run-corpus.ts" \
  --out "$WORKDIR/run" \
  --json > "$WORKDIR/summary.json"
export NODE_LEVEL5_PRODUCT_RUN_CORPUS_SUMMARY="$WORKDIR/summary.json"

for proof in $(seq 721 760); do
  node --import "$LOADER" "$ROOT/proof/$proof/smoke.ts"
done
