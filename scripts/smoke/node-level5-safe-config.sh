#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOADER="$ROOT/node_modules/tsx/dist/loader.mjs"
SUMMARY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-safe-config.XXXXXX")"
trap 'rm -rf "$SUMMARY_DIR"' EXIT
node --import "$LOADER" "$ROOT/scripts/node-level5-installed-third-party-app-corpus.ts" --out "$SUMMARY_DIR/corpus" --json > "$SUMMARY_DIR/summary.json"
for proof in $(seq 1361 1400); do
  NODE_LEVEL5_SAFE_CONFIG_SUMMARY="$SUMMARY_DIR/summary.json" node --import "$LOADER" "$ROOT/proof/$proof/smoke.ts"
done
