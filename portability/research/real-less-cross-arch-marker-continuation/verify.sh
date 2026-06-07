#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../../.." && pwd)
RETAINED_DIR="$SCRIPT_DIR/retained"
AMD64_HOST=${REAL_LESS_AMD64_HOST:-root@192.168.0.8}
ARM64_HOST=${REAL_LESS_ARM64_HOST:-friend@100.126.46.90}
RUN_ID=${REAL_LESS_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
AMD64_REMOTE_BASE=${REAL_LESS_AMD64_REMOTE_BASE:-/mnt/shared-500G}
ARM64_REMOTE_BASE=${REAL_LESS_ARM64_REMOTE_BASE:-/tmp}
AMD64_WORK=${REAL_LESS_AMD64_WORK:-$AMD64_REMOTE_BASE/machinen-real-less-cross-arch-amd64-$RUN_ID}
ARM64_WORK=${REAL_LESS_ARM64_WORK:-$ARM64_REMOTE_BASE/machinen-real-less-cross-arch-arm64-$RUN_ID}
SCRIPT_NAME=real_less_cross_arch_marker_continuation.py
BUILDER_NAME=known_less_builder.py

mkdir -p "$RETAINED_DIR"
rm -f "$RETAINED_DIR"/*.json

setup_remote() {
  local host=$1
  local work=$2
  ssh -o BatchMode=yes "$host" "rm -rf '$work' && mkdir -p '$work/retained' '$work/known-less'"
  scp -q "$SCRIPT_DIR/$SCRIPT_NAME" "$host:$work/$SCRIPT_NAME"
  scp -q "$REPO_ROOT/portability/research/real-less-detector/$BUILDER_NAME" "$host:$work/$BUILDER_NAME"
}

build_remote_less() {
  local host=$1
  local work=$2
  ssh -o BatchMode=yes "$host" "python3 '$work/$BUILDER_NAME' '$work/known-less' '$work/retained'"
}

run_remote() {
  local host=$1
  local work=$2
  local mode=$3
  local role=$4
  local output=$5
  ssh -o BatchMode=yes "$host" "python3 '$work/$SCRIPT_NAME' remote '$mode' '$role' '$work/known-less/prefix/bin/less' '$work/retained/known-less-build.json' '$work/retained/$output'"
}

copy_remote_json() {
  local host=$1
  local work=$2
  local remote_name=$3
  local local_name=$4
  scp -q "$host:$work/retained/$remote_name" "$RETAINED_DIR/$local_name"
}

cleanup_remote() {
  local host=$1
  local work=$2
  ssh -o BatchMode=yes "$host" "rm -rf '$work'" >/dev/null 2>&1 || true
}

setup_remote "$AMD64_HOST" "$AMD64_WORK"
setup_remote "$ARM64_HOST" "$ARM64_WORK"
build_remote_less "$AMD64_HOST" "$AMD64_WORK"
build_remote_less "$ARM64_HOST" "$ARM64_WORK"

run_remote "$AMD64_HOST" "$AMD64_WORK" capture source amd64-to-arm64-source.json
run_remote "$ARM64_HOST" "$ARM64_WORK" continue target amd64-to-arm64-target.json
run_remote "$ARM64_HOST" "$ARM64_WORK" capture source arm64-to-amd64-source.json
run_remote "$AMD64_HOST" "$AMD64_WORK" continue target arm64-to-amd64-target.json

copy_remote_json "$AMD64_HOST" "$AMD64_WORK" known-less-build.json amd64-known-less-build.json
copy_remote_json "$ARM64_HOST" "$ARM64_WORK" known-less-build.json arm64-known-less-build.json
copy_remote_json "$AMD64_HOST" "$AMD64_WORK" amd64-to-arm64-source.json amd64-to-arm64-source.json
copy_remote_json "$ARM64_HOST" "$ARM64_WORK" amd64-to-arm64-target.json amd64-to-arm64-target.json
copy_remote_json "$ARM64_HOST" "$ARM64_WORK" arm64-to-amd64-source.json arm64-to-amd64-source.json
copy_remote_json "$AMD64_HOST" "$AMD64_WORK" arm64-to-amd64-target.json arm64-to-amd64-target.json

python3 "$SCRIPT_DIR/$SCRIPT_NAME" combine \
  amd64-to-arm64 \
  "$RETAINED_DIR/amd64-to-arm64-source.json" \
  "$RETAINED_DIR/amd64-to-arm64-target.json" \
  "$RETAINED_DIR/amd64-to-arm64.json" \
  "$RETAINED_DIR/report.json"
python3 "$SCRIPT_DIR/$SCRIPT_NAME" combine \
  arm64-to-amd64 \
  "$RETAINED_DIR/arm64-to-amd64-source.json" \
  "$RETAINED_DIR/arm64-to-amd64-target.json" \
  "$RETAINED_DIR/arm64-to-amd64.json" \
  "$RETAINED_DIR/report.json"

cleanup_remote "$AMD64_HOST" "$AMD64_WORK"
cleanup_remote "$ARM64_HOST" "$ARM64_WORK"

for json in "$RETAINED_DIR"/*.json; do
  python3 -m json.tool "$json" >/dev/null
done

echo "Real less cross-arch marker continuation proof passed"
echo "Retained report: $RETAINED_DIR/report.json"
