#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${NODE_ARTIFACT_INTEGRITY_MANIFEST:-$ROOT/proofs/nodejs/claim-evidence-index/retained/node-artifact-integrity-manifest.json}"

pnpm exec tsx "$ROOT/proofs/nodejs/scripts/node-artifact-integrity-manifest.ts" \
  --root "$ROOT/proofs/nodejs" \
  --out "$OUT" \
  --json

pnpm exec oxfmt "$OUT" >/dev/null
