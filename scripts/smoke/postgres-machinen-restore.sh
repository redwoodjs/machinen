#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WORK=${POSTGRES_MACHINEN_WORK_DIR:-}
IMAGE=${POSTGRES_MACHINEN_IMAGE:-}
JSON=0
KEEP=0
usage() { echo "usage: bash scripts/smoke/postgres-machinen-restore.sh [--json] [--keep] [--work-dir path] [--image path]" >&2; exit 2; }
while (($# > 0)); do
  case "$1" in
    --json) JSON=1; shift ;;
    --keep) KEEP=1; shift ;;
    --work-dir) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; WORK=$1; shift ;;
    --image) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; IMAGE=$1; shift ;;
    *) usage ;;
  esac
done
if [[ -z "$WORK" ]]; then WORK=$(mktemp -d); elif [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; mkdir -p "$WORK"; else mkdir -p "$WORK"; fi
cleanup() { if [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; fi; }
trap cleanup EXIT

pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null
args=("$ROOT/scripts/postgres-machinen-restore-proof.mjs" run-suite --out "$WORK/summary.json" --work-dir "$WORK/work")
if [[ -n "$IMAGE" ]]; then args+=(--image "$IMAGE"); fi
if [[ $KEEP -eq 1 ]]; then args+=(--keep); fi
node "${args[@]}"

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); console.log('postgres-machinen-restore-proof: '+s.state+' '+s.supportedSubset.name+' rows='+JSON.parse(s.postgres.targetVerifierOutput).rowCount)"
fi
