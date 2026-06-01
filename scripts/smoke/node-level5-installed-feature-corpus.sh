#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOADER="$ROOT/node_modules/tsx/dist/loader.mjs"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-installed-feature-corpus.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

node --import "$LOADER" "$ROOT/scripts/node-level5-installed-third-party-app-corpus.ts" \
  --out "$WORKDIR/run" \
  --json > "$WORKDIR/summary.json"
export NODE_LEVEL5_INSTALLED_FEATURE_CORPUS_SUMMARY="$WORKDIR/summary.json"

for proof in $(seq 961 1000); do
  node --import "$LOADER" "$ROOT/proofs/by-id/$proof/smoke.ts"
done
