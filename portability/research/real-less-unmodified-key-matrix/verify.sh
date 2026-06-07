#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RETAINED_DIR="$SCRIPT_DIR/retained"
AMD64_HOST=${REAL_LESS_AMD64_HOST:-root@192.168.0.8}
ARM64_HOST=${REAL_LESS_ARM64_HOST:-friend@100.126.46.90}
RUN_ID=${REAL_LESS_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
AMD64_BASE=${REAL_LESS_AMD64_REMOTE_BASE:-/mnt/shared-500G}
ARM64_BASE=${REAL_LESS_ARM64_REMOTE_BASE:-/tmp}
AMD64_WORK=${REAL_LESS_AMD64_WORK:-$AMD64_BASE/machinen-real-less-key-matrix-amd64-$RUN_ID}
ARM64_WORK=${REAL_LESS_ARM64_WORK:-$ARM64_BASE/machinen-real-less-key-matrix-arm64-$RUN_ID}
SCRIPT=real_less_unmodified_key_matrix.py
mkdir -p "$RETAINED_DIR"; rm -f "$RETAINED_DIR"/*.json
setup(){ local host=$1 work=$2; ssh -o BatchMode=yes "$host" "rm -rf '$work' && mkdir -p '$work/retained'"; scp -q "$SCRIPT_DIR/$SCRIPT" "$host:$work/$SCRIPT"; }
run_remote(){ local host=$1 work=$2 case=$3 mode=$4 role=$5 out=$6; ssh -o BatchMode=yes "$host" "python3 '$work/$SCRIPT' remote '$case' '$mode' '$role' '$work/retained/$out'"; }
copy_json(){ local host=$1 work=$2 remote=$3; scp -q "$host:$work/retained/$remote" "$RETAINED_DIR/$remote"; }
cleanup(){ local host=$1 work=$2; ssh -o BatchMode=yes "$host" "rm -rf '$work'" >/dev/null 2>&1 || true; }
setup "$AMD64_HOST" "$AMD64_WORK"; setup "$ARM64_HOST" "$ARM64_WORK"
CASES=()
while IFS= read -r case; do
  CASES+=("$case")
done < <(python3 "$SCRIPT_DIR/$SCRIPT" list-cases)
for case in "${CASES[@]}"; do
  run_remote "$AMD64_HOST" "$AMD64_WORK" "$case" same same "same-$case.json"
  run_remote "$AMD64_HOST" "$AMD64_WORK" "$case" source source "amd64-to-arm64-$case-source.json"
  run_remote "$ARM64_HOST" "$ARM64_WORK" "$case" target target "amd64-to-arm64-$case-target.json"
  run_remote "$ARM64_HOST" "$ARM64_WORK" "$case" source source "arm64-to-amd64-$case-source.json"
  run_remote "$AMD64_HOST" "$AMD64_WORK" "$case" target target "arm64-to-amd64-$case-target.json"
  copy_json "$AMD64_HOST" "$AMD64_WORK" "same-$case.json"
  copy_json "$AMD64_HOST" "$AMD64_WORK" "amd64-to-arm64-$case-source.json"
  copy_json "$ARM64_HOST" "$ARM64_WORK" "amd64-to-arm64-$case-target.json"
  copy_json "$ARM64_HOST" "$ARM64_WORK" "arm64-to-amd64-$case-source.json"
  copy_json "$AMD64_HOST" "$AMD64_WORK" "arm64-to-amd64-$case-target.json"
done
python3 "$SCRIPT_DIR/$SCRIPT" combine "$RETAINED_DIR" "${CASES[@]}"
cleanup "$AMD64_HOST" "$AMD64_WORK"; cleanup "$ARM64_HOST" "$ARM64_WORK"
for json in "$RETAINED_DIR"/*.json; do python3 -m json.tool "$json" >/dev/null; done
echo "Real less unmodified key matrix experiment completed"
echo "Retained report: $RETAINED_DIR/report.json"
