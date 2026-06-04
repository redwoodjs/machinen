#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WORK=${POSTGRES_NO_DUMP_PRODUCT_WORK_DIR:-}
ARM_HOST=${POSTGRES_NO_DUMP_PRODUCT_ARM_HOST:-local}
AMD_HOST=${POSTGRES_NO_DUMP_PRODUCT_AMD_HOST:-root@192.168.0.8}
IMAGE=${POSTGRES_NO_DUMP_PRODUCT_IMAGE:-postgres:15-bookworm}
JSON=0
KEEP=0
usage() { echo "usage: bash scripts/smoke/postgres-no-dump-product-proof.sh [--json] [--keep] [--work-dir path] [--arm-host local|user@host] [--amd-host user@host] [--image postgres:tag]" >&2; exit 2; }
while (($# > 0)); do
  case "$1" in
    --json) JSON=1; shift ;;
    --keep) KEEP=1; shift ;;
    --work-dir) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; WORK=$1; shift ;;
    --arm-host) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; ARM_HOST=$1; shift ;;
    --amd-host) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; AMD_HOST=$1; shift ;;
    --image) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; IMAGE=$1; shift ;;
    *) usage ;;
  esac
done
if [[ -z "$WORK" ]]; then WORK=$(mktemp -d); elif [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; mkdir -p "$WORK"; else mkdir -p "$WORK"; fi
cleanup() { if [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; fi; }
trap cleanup EXIT

pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null
node "$ROOT/scripts/postgres-no-dump-product-proof.mjs" run-suite \
  --out "$WORK/summary.json" \
  --work-dir "$WORK/work" \
  --arm-host "$ARM_HOST" \
  --amd-host "$AMD_HOST" \
  --image "$IMAGE" \
  ${KEEP:+--keep}

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); console.log('postgres-no-dump-product-proof: '+s.state+' routes='+s.postgres.routes.map(r=>r.route).join(',')+' fingerprint='+s.postgres.logicalFingerprint)"
fi
