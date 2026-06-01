#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LOADER="$ROOT/node_modules/tsx/dist/loader.mjs"
WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-safe-outbound.XXXXXX")
trap 'rm -rf "$WORKDIR"' EXIT
node --import "$LOADER" "$ROOT/proofs/nodejs/scripts/node-level5-installed-third-party-app-corpus.ts" --out "$WORKDIR/run" --json > "$WORKDIR/summary.json"
for proof in $(seq 1161 1200); do
  NODE_LEVEL5_SAFE_OUTBOUND_RECONNECT_SUMMARY="$WORKDIR/summary.json" \
    node --import "$LOADER" "$ROOT/proofs/by-id/$proof/smoke.ts"
done
