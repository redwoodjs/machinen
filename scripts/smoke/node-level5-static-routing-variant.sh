#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOADER="$ROOT/node_modules/tsx/dist/loader.mjs"
SUMMARY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-static-routing.XXXXXX")"
trap 'rm -rf "$SUMMARY_DIR"' EXIT
node --import "$LOADER" "$ROOT/scripts/node-level5-installed-third-party-app-corpus.ts" --out "$SUMMARY_DIR/corpus" --json > "$SUMMARY_DIR/summary.json"
for proof in $(seq 1321 1360); do
  NODE_LEVEL5_STATIC_ROUTING_VARIANT_SUMMARY="$SUMMARY_DIR/summary.json" node --import "$LOADER" "$ROOT/proofs/$proof/smoke.ts"
done
