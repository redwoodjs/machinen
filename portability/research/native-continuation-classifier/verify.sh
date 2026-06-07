#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RETAINED_DIR="$SCRIPT_DIR/retained"
AMD64_HOST=${NATIVE_CONTINUATION_CLASSIFIER_AMD64_HOST:-root@192.168.0.8}
ARM64_HOST=${NATIVE_CONTINUATION_CLASSIFIER_ARM64_HOST:-friend@100.126.46.90}
RUN_ID=${NATIVE_CONTINUATION_CLASSIFIER_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
AMD64_BASE=${NATIVE_CONTINUATION_CLASSIFIER_AMD64_REMOTE_BASE:-/mnt/shared-500G}
ARM64_BASE=${NATIVE_CONTINUATION_CLASSIFIER_ARM64_REMOTE_BASE:-/tmp}
AMD64_WORK=${NATIVE_CONTINUATION_CLASSIFIER_AMD64_WORK:-$AMD64_BASE/machinen-native-continuation-classifier-amd64-$RUN_ID}
ARM64_WORK=${NATIVE_CONTINUATION_CLASSIFIER_ARM64_WORK:-$ARM64_BASE/machinen-native-continuation-classifier-arm64-$RUN_ID}
mkdir -p "$RETAINED_DIR"
setup() {
  local host=$1 work=$2
  ssh -o BatchMode=yes "$host" "rm -rf '$work' && mkdir -p '$work/retained'"
  scp -q "$SCRIPT_DIR/classify.py" "$SCRIPT_DIR/verify_classifier.py" "$host:$work/"
}
run_remote() {
  local host=$1 work=$2 out=$3
  ssh -o BatchMode=yes "$host" "cd '$work' && python3 verify_classifier.py 'retained/$out'"
  scp -q "$host:$work/retained/$out" "$RETAINED_DIR/$out"
}
cleanup() {
  local host=$1 work=$2
  ssh -o BatchMode=yes "$host" "rm -rf '$work'" >/dev/null 2>&1 || true
}
setup "$AMD64_HOST" "$AMD64_WORK"
setup "$ARM64_HOST" "$ARM64_WORK"
run_remote "$AMD64_HOST" "$AMD64_WORK" "amd64-report.json"
run_remote "$ARM64_HOST" "$ARM64_WORK" "arm64-report.json"
cleanup "$AMD64_HOST" "$AMD64_WORK"
cleanup "$ARM64_HOST" "$ARM64_WORK"
python3 - <<'PY' "$RETAINED_DIR"
import json, sys
from pathlib import Path
retained=Path(sys.argv[1])
reports=[json.loads((retained/name).read_text()) for name in ("amd64-report.json","arm64-report.json")]
combined={
  "kind":"machinen.research.native-continuation-classifier.combined-report",
  "version":1,
  "status":"passed" if all(r["status"]=="passed" for r in reports) else "failed",
  "claimGuard": reports[0]["claimGuard"],
  "reports": reports,
}
(retained/"report.json").write_text(json.dumps(combined,indent=2)+"\n")
print(json.dumps({"status":combined["status"],"hosts":[r["hostArch"] for r in reports],"rows":sum(len(r["rows"]) for r in reports)},indent=2))
if combined["status"] != "passed":
  raise SystemExit(1)
PY
for json in "$RETAINED_DIR"/*.json; do python3 -m json.tool "$json" >/dev/null; done
echo "Native continuation classifier verification completed"
echo "Retained report: $RETAINED_DIR/report.json"
