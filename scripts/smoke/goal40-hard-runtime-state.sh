#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WORK=${GOAL40_HARD_STATE_WORK_DIR:-}
SUBGOAL=${GOAL40_HARD_STATE_SUBGOAL:-all}
JSON=0
KEEP=0
usage() { echo "usage: bash scripts/smoke/goal40-hard-runtime-state.sh [--json] [--keep] [--work-dir path] [--subgoal active-socket-tls|native-extension|go-scheduler|all]" >&2; exit 2; }
while (($# > 0)); do
  case "$1" in
    --json) JSON=1; shift ;;
    --keep) KEEP=1; shift ;;
    --work-dir) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; WORK=$1; shift ;;
    --subgoal) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; SUBGOAL=$1; shift ;;
    *) usage ;;
  esac
done
if [[ -z "$WORK" ]]; then WORK=$(mktemp -d); else rm -rf "$WORK"; mkdir -p "$WORK"; fi
cleanup() { if [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; fi; }
trap cleanup EXIT

node "$ROOT/scripts/goal40-hard-runtime-state-proof.mjs" run-suite \
  --subgoal "$SUBGOAL" \
  --out "$WORK/summary.json" \
  --work-dir "$WORK/work"

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); console.log('goal40-hard-runtime-state-proof: '+s.state+' '+Object.keys(s.subgoals).join(','))"
fi
