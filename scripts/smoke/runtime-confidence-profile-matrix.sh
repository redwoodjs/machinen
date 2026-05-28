#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-runtime-confidence.XXXXXX")}"
JSON=0
mkdir -p "$WORK"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --work-dir) WORK="$2"; mkdir -p "$WORK"; shift 2 ;;
    *) echo "usage: bash scripts/smoke/runtime-confidence-profile-matrix.sh [--json] [--work-dir path]" >&2; exit 2 ;;
  esac
done

pnpm exec tsx "$ROOT/scripts/runtime-confidence-profile-matrix.ts" \
  --summary "$WORK/summary.json" \
  --json >"$WORK/stdout.json"

node --input-type=module - "$WORK/summary.json" <<'NODE'
import { readFileSync } from 'node:fs';
const summary = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!summary.pass) throw new Error(`runtime confidence matrix failed: ${summary.failures.join('; ')}`);
if (summary.rowCount !== 14) throw new Error(`expected 14 rows, got ${summary.rowCount}`);
if (summary.byRuntime.c !== 12 || summary.byRuntime.java !== 2) throw new Error('unexpected runtime counts');
if (!summary.rows.some((row) => row.profile === 'c-static-binary' && row.classification === 'proof-only-feasibility')) throw new Error('missing static C proof-only row');
if (!summary.rows.some((row) => row.profile === 'c-dynamic-binary' && row.refusalCode === 'missing-target-runtime-or-dynamic-library-provenance')) throw new Error('missing dynamic C provenance refusal');
if (!summary.rows.some((row) => row.profile === 'java-loop-service' && row.refusalCode === 'missing-target-runtime-or-dynamic-library-provenance')) throw new Error('missing Java runtime refusal');
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); console.log('runtime-confidence-profile-matrix: '+s.state+' rows='+s.rowCount+' refused='+s.byClassification.refused+' work=$WORK')"
fi
