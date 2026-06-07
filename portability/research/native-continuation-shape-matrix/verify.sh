#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RETAINED_DIR="$SCRIPT_DIR/retained"
AMD64_HOST=${NATIVE_CONTINUATION_MATRIX_AMD64_HOST:-root@192.168.0.8}
ARM64_HOST=${NATIVE_CONTINUATION_MATRIX_ARM64_HOST:-friend@100.126.46.90}
RUN_ID=${NATIVE_CONTINUATION_MATRIX_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
AMD64_BASE=${NATIVE_CONTINUATION_MATRIX_AMD64_REMOTE_BASE:-/mnt/shared-500G}
ARM64_BASE=${NATIVE_CONTINUATION_MATRIX_ARM64_REMOTE_BASE:-/tmp}
AMD64_WORK=${NATIVE_CONTINUATION_MATRIX_AMD64_WORK:-$AMD64_BASE/machinen-native-continuation-shape-matrix-amd64-$RUN_ID}
ARM64_WORK=${NATIVE_CONTINUATION_MATRIX_ARM64_WORK:-$ARM64_BASE/machinen-native-continuation-shape-matrix-arm64-$RUN_ID}
PROBE=probe-native-continuation-shapes.py
mkdir -p "$RETAINED_DIR"
if [[ ! -f "$SCRIPT_DIR/../native-continuation-classifier/retained/report.json" ]]; then
  "$SCRIPT_DIR/../native-continuation-classifier/verify.sh"
fi
node "$SCRIPT_DIR/verify-matrix.mjs"
setup() {
  local host=$1 work=$2
  ssh -o BatchMode=yes "$host" "rm -rf '$work' && mkdir -p '$work/retained'"
  scp -q "$SCRIPT_DIR/$PROBE" "$host:$work/$PROBE"
}
run_probe() {
  local host=$1 work=$2 out=$3
  ssh -o BatchMode=yes "$host" "python3 '$work/$PROBE' '$work/retained/$out'"
  scp -q "$host:$work/retained/$out" "$RETAINED_DIR/$out"
}
cleanup() {
  local host=$1 work=$2
  ssh -o BatchMode=yes "$host" "rm -rf '$work'" >/dev/null 2>&1 || true
}
setup "$AMD64_HOST" "$AMD64_WORK"
setup "$ARM64_HOST" "$ARM64_WORK"
run_probe "$AMD64_HOST" "$AMD64_WORK" "probe-amd64.json"
run_probe "$ARM64_HOST" "$ARM64_WORK" "probe-arm64.json"
cleanup "$AMD64_HOST" "$AMD64_WORK"
cleanup "$ARM64_HOST" "$ARM64_WORK"
python3 - <<'PY' "$RETAINED_DIR"
import json, sys
from pathlib import Path
retained=Path(sys.argv[1])
reports=[json.loads((retained/name).read_text()) for name in ("probe-amd64.json","probe-arm64.json")]
combined={
  "kind":"machinen.research.native-continuation-shape-probes.combined-report",
  "version":1,
  "status":"passed" if all(r["status"]=="passed" for r in reports) else "failed",
  "reports":reports,
}
(retained/"probe-report.json").write_text(json.dumps(combined,indent=2)+"\n")
print(json.dumps({"probeStatus":combined["status"],"hosts":[r["hostArch"] for r in reports]},indent=2))
if combined["status"] != "passed":
  raise SystemExit(1)
PY
for json in "$RETAINED_DIR"/*.json; do python3 -m json.tool "$json" >/dev/null; done
echo "Native continuation shape matrix verification completed"
echo "Retained reports: $RETAINED_DIR/report.json and $RETAINED_DIR/probe-report.json"
