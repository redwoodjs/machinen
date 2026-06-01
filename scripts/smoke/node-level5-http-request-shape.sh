#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOADER="$ROOT/node_modules/tsx/dist/loader.mjs"
SUMMARY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-http-request-shape.XXXXXX")"
trap 'rm -rf "$SUMMARY_DIR"' EXIT

node --import "$LOADER" "$ROOT/proofs/nodejs/scripts/node-level5-installed-third-party-app-corpus.ts" \
  --out "$SUMMARY_DIR/corpus" \
  --json > "$SUMMARY_DIR/summary.json"

for proof in $(seq 1201 1240); do
  NODE_LEVEL5_HTTP_REQUEST_SHAPE_SUMMARY="$SUMMARY_DIR/summary.json" \
    node --import "$LOADER" "$ROOT/proofs/by-id/$proof/smoke.ts"
done
