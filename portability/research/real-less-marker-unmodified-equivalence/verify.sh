#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../../.." && pwd)
RETAINED_DIR="$SCRIPT_DIR/retained"
AMD64_HOST=${REAL_LESS_AMD64_HOST:-root@192.168.0.8}
RUN_ID=${REAL_LESS_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
REMOTE_BASE=${REAL_LESS_REMOTE_BASE:-/mnt/shared-500G}
REMOTE_WORK=${REAL_LESS_REMOTE_WORK:-$REMOTE_BASE/machinen-real-less-marker-unmodified-equivalence-$RUN_ID}
mkdir -p "$RETAINED_DIR"
ssh -o BatchMode=yes "$AMD64_HOST" "rm -rf '$REMOTE_WORK' && mkdir -p '$REMOTE_WORK/retained' '$REMOTE_WORK/known-less'"
scp -q "$SCRIPT_DIR/real_less_marker_unmodified_equivalence.py" "$AMD64_HOST:$REMOTE_WORK/real_less_marker_unmodified_equivalence.py"
scp -q "$REPO_ROOT/portability/research/real-less-detector/known_less_builder.py" "$AMD64_HOST:$REMOTE_WORK/known_less_builder.py"
ssh -o BatchMode=yes "$AMD64_HOST" "python3 '$REMOTE_WORK/known_less_builder.py' '$REMOTE_WORK/known-less' '$REMOTE_WORK/retained'"
ssh -o BatchMode=yes "$AMD64_HOST" "python3 '$REMOTE_WORK/real_less_marker_unmodified_equivalence.py' '$REMOTE_WORK/known-less/prefix/bin/less' '$REMOTE_WORK/retained'"
rm -f "$RETAINED_DIR"/*.json
scp -q "$AMD64_HOST:$REMOTE_WORK/retained/"'*.json' "$RETAINED_DIR/"
ssh -o BatchMode=yes "$AMD64_HOST" "rm -rf '$REMOTE_WORK'" >/dev/null 2>&1 || true
for json in "$RETAINED_DIR"/*.json; do python3 -m json.tool "$json" >/dev/null; done
echo "Real less marker/unmodified equivalence proof passed"
echo "Retained report: $RETAINED_DIR/report.json"
