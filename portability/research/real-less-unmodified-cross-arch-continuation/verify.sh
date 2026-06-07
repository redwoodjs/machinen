#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RETAINED_DIR="$SCRIPT_DIR/retained"
AMD64_HOST=${REAL_LESS_AMD64_HOST:-root@192.168.0.8}
ARM64_HOST=${REAL_LESS_ARM64_HOST:-friend@100.126.46.90}
RUN_ID=${REAL_LESS_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
AMD64_BASE=${REAL_LESS_AMD64_REMOTE_BASE:-/mnt/shared-500G}
ARM64_BASE=${REAL_LESS_ARM64_REMOTE_BASE:-/tmp}
AMD64_WORK=${REAL_LESS_AMD64_WORK:-$AMD64_BASE/machinen-real-less-unmodified-cross-amd64-$RUN_ID}
ARM64_WORK=${REAL_LESS_ARM64_WORK:-$ARM64_BASE/machinen-real-less-unmodified-cross-arm64-$RUN_ID}
SCRIPT=real_less_unmodified_cross_arch_continuation.py
mkdir -p "$RETAINED_DIR"; rm -f "$RETAINED_DIR"/*.json
setup(){ local host=$1 work=$2; ssh -o BatchMode=yes "$host" "rm -rf '$work' && mkdir -p '$work/retained'"; scp -q "$SCRIPT_DIR/$SCRIPT" "$host:$work/$SCRIPT"; }
run_remote(){ local host=$1 work=$2 mode=$3 role=$4 out=$5; ssh -o BatchMode=yes "$host" "python3 '$work/$SCRIPT' remote '$mode' '$role' '$work/retained/$out'"; }
copy_json(){ local host=$1 work=$2 remote=$3 local_name=$4; scp -q "$host:$work/retained/$remote" "$RETAINED_DIR/$local_name"; }
cleanup(){ local host=$1 work=$2; ssh -o BatchMode=yes "$host" "rm -rf '$work'" >/dev/null 2>&1 || true; }
setup "$AMD64_HOST" "$AMD64_WORK"; setup "$ARM64_HOST" "$ARM64_WORK"
run_remote "$AMD64_HOST" "$AMD64_WORK" capture source amd64-to-arm64-source.json
run_remote "$ARM64_HOST" "$ARM64_WORK" continue target amd64-to-arm64-target.json
run_remote "$ARM64_HOST" "$ARM64_WORK" capture source arm64-to-amd64-source.json
run_remote "$AMD64_HOST" "$AMD64_WORK" continue target arm64-to-amd64-target.json
copy_json "$AMD64_HOST" "$AMD64_WORK" amd64-to-arm64-source.json amd64-to-arm64-source.json
copy_json "$ARM64_HOST" "$ARM64_WORK" amd64-to-arm64-target.json amd64-to-arm64-target.json
copy_json "$ARM64_HOST" "$ARM64_WORK" arm64-to-amd64-source.json arm64-to-amd64-source.json
copy_json "$AMD64_HOST" "$AMD64_WORK" arm64-to-amd64-target.json arm64-to-amd64-target.json
python3 "$SCRIPT_DIR/$SCRIPT" combine amd64-to-arm64 "$RETAINED_DIR/amd64-to-arm64-source.json" "$RETAINED_DIR/amd64-to-arm64-target.json" "$RETAINED_DIR/amd64-to-arm64.json" "$RETAINED_DIR/report.json"
python3 "$SCRIPT_DIR/$SCRIPT" combine arm64-to-amd64 "$RETAINED_DIR/arm64-to-amd64-source.json" "$RETAINED_DIR/arm64-to-amd64-target.json" "$RETAINED_DIR/arm64-to-amd64.json" "$RETAINED_DIR/report.json"
cleanup "$AMD64_HOST" "$AMD64_WORK"; cleanup "$ARM64_HOST" "$ARM64_WORK"
for json in "$RETAINED_DIR"/*.json; do python3 -m json.tool "$json" >/dev/null; done
echo "Real less unmodified cross-arch continuation proof passed"
echo "Retained report: $RETAINED_DIR/report.json"
