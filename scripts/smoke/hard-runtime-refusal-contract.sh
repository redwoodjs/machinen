#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WORK=${GOAL41_REFUSAL_WORK_DIR:-}
JSON=0
KEEP=0
usage() { echo "usage: bash scripts/smoke/hard-runtime-refusal-contract.sh [--json] [--keep] [--work-dir path]" >&2; exit 2; }
while (($# > 0)); do
  case "$1" in
    --json) JSON=1; shift ;;
    --keep) KEEP=1; shift ;;
    --work-dir) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; WORK=$1; shift ;;
    *) usage ;;
  esac
done
if [[ -z "$WORK" ]]; then WORK=$(mktemp -d); elif [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; mkdir -p "$WORK"; else mkdir -p "$WORK"; fi
cleanup() { if [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; fi; }
trap cleanup EXIT
node "$ROOT/scripts/hard-runtime-refusal-contract.mjs" run-suite --out "$WORK/summary.json" --summary-dir "$WORK/summaries" --work-dir "$WORK/work"
if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); console.log('hard-runtime-refusal-contract: '+s.state+' refusals='+s.refusalCount)"
fi
