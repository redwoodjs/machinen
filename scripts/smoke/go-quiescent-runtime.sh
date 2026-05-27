#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WORK=${GO_QUIESCENT_RUNTIME_WORK_DIR:-}
SUBSET=${GO_QUIESCENT_RUNTIME_SUBSET:-all}
ITERATIONS=${GO_QUIESCENT_RUNTIME_ITERATIONS:-3}
ARM_HOST=${GO_QUIESCENT_RUNTIME_ARM_HOST:-friend@100.126.46.90}
AMD_HOST=${GO_QUIESCENT_RUNTIME_AMD_HOST:-root@192.168.0.8}
JSON=0
KEEP=0
usage() { echo "usage: bash scripts/smoke/go-quiescent-runtime.sh [--json] [--keep] [--work-dir path] [--subset http|worker|channel|timer|all] [--iterations n] [--arm-host host] [--amd-host host]" >&2; exit 2; }
while (($# > 0)); do
  case "$1" in
    --json) JSON=1; shift ;;
    --keep) KEEP=1; shift ;;
    --work-dir) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; WORK=$1; shift ;;
    --subset) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; SUBSET=$1; shift ;;
    --iterations) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; ITERATIONS=$1; shift ;;
    --arm-host) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; ARM_HOST=$1; shift ;;
    --amd-host) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; AMD_HOST=$1; shift ;;
    *) usage ;;
  esac
done
if [[ -z "$WORK" ]]; then WORK=$(mktemp -d); else rm -rf "$WORK"; mkdir -p "$WORK"; fi
cleanup() { if [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; fi; }
trap cleanup EXIT

node "$ROOT/scripts/go-quiescent-runtime-proof.mjs" run-suite \
  --subset "$SUBSET" \
  --iterations "$ITERATIONS" \
  --arm-host "$ARM_HOST" \
  --amd-host "$AMD_HOST" \
  --out "$WORK/summary.json" \
  --work-dir "$WORK/work"

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); console.log('go-quiescent-runtime-proof: '+s.state+' '+Object.keys(s.subsets).join(','))"
fi
