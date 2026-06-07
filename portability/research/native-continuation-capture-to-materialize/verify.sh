#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RETAINED_DIR="$SCRIPT_DIR/retained"
AMD64_HOST=${NATIVE_CONTINUATION_C2M_AMD64_HOST:-root@192.168.0.8}
ARM64_HOST=${NATIVE_CONTINUATION_C2M_ARM64_HOST:-friend@100.126.46.90}
RUN_ID=${NATIVE_CONTINUATION_C2M_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
AMD64_BASE=${NATIVE_CONTINUATION_C2M_AMD64_REMOTE_BASE:-/mnt/shared-500G}
ARM64_BASE=${NATIVE_CONTINUATION_C2M_ARM64_REMOTE_BASE:-/tmp}
AMD64_WORK=${NATIVE_CONTINUATION_C2M_AMD64_WORK:-$AMD64_BASE/machinen-native-continuation-c2m-amd64-$RUN_ID}
ARM64_WORK=${NATIVE_CONTINUATION_C2M_ARM64_WORK:-$ARM64_BASE/machinen-native-continuation-c2m-arm64-$RUN_ID}
mkdir -p "$RETAINED_DIR"
rm -f "$RETAINED_DIR"/*.json
setup() {
  local host=$1 work=$2
  ssh -o BatchMode=yes "$host" "rm -rf '$work' && mkdir -p '$work/retained'"
  scp -q "$SCRIPT_DIR/capture_to_materialize.py" "$host:$work/capture_to_materialize.py"
  scp -q "$SCRIPT_DIR/../native-continuation-classifier/classify.py" "$host:$work/classify.py"
  scp -q "$SCRIPT_DIR/../native-continuation-materializer/materializer.py" "$host:$work/materializer.py"
}
capture_support() { local host=$1 work=$2 case=$3 out=$4; ssh -o BatchMode=yes "$host" "cd '$work' && python3 capture_to_materialize.py capture-support '$case' 'retained/$out'"; }
capture_refusal() { local host=$1 work=$2 case=$3 out=$4; ssh -o BatchMode=yes "$host" "cd '$work' && python3 capture_to_materialize.py capture-refusal '$case' 'retained/$out'"; }
materialize() { local host=$1 work=$2 case=$3 out=$4 descriptor=$5; ssh -o BatchMode=yes "$host" "cd '$work' && python3 materializer.py remote '$case' target target 'retained/$out' 'retained/$descriptor'"; }
copy_json() { local host=$1 work=$2 remote=$3; scp -q "$host:$work/retained/$remote" "$RETAINED_DIR/$remote"; }
send_json() { local host=$1 work=$2 local_json=$3 remote=$4; scp -q "$RETAINED_DIR/$local_json" "$host:$work/retained/$remote"; }
cleanup() { local host=$1 work=$2; ssh -o BatchMode=yes "$host" "rm -rf '$work'" >/dev/null 2>&1 || true; }
setup "$AMD64_HOST" "$AMD64_WORK"
setup "$ARM64_HOST" "$ARM64_WORK"
SUPPORT_CASES=()
while IFS= read -r case; do SUPPORT_CASES+=("$case"); done < <(python3 "$SCRIPT_DIR/capture_to_materialize.py" list-support-cases)
REFUSAL_CASES=()
while IFS= read -r case; do REFUSAL_CASES+=("$case"); done < <(python3 "$SCRIPT_DIR/capture_to_materialize.py" list-refusal-cases)
for case in "${SUPPORT_CASES[@]}"; do
  mat_case=$(python3 - <<'PY' "$SCRIPT_DIR/capture_to_materialize.py" "$case"
import importlib.util, sys
spec=importlib.util.spec_from_file_location('c2m', sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m.CASES[sys.argv[2]]['materializerCase'])
PY
)
  capture_support "$AMD64_HOST" "$AMD64_WORK" "$case" "same-$case-source.json"
  copy_json "$AMD64_HOST" "$AMD64_WORK" "same-$case-source.json"
  materialize "$AMD64_HOST" "$AMD64_WORK" "$mat_case" "same-$case-target.json" "same-$case-source.json"
  copy_json "$AMD64_HOST" "$AMD64_WORK" "same-$case-target.json"

  capture_support "$AMD64_HOST" "$AMD64_WORK" "$case" "amd64-to-arm64-$case-source.json"
  copy_json "$AMD64_HOST" "$AMD64_WORK" "amd64-to-arm64-$case-source.json"
  send_json "$ARM64_HOST" "$ARM64_WORK" "amd64-to-arm64-$case-source.json" "amd64-to-arm64-$case-source.json"
  materialize "$ARM64_HOST" "$ARM64_WORK" "$mat_case" "amd64-to-arm64-$case-target.json" "amd64-to-arm64-$case-source.json"
  copy_json "$ARM64_HOST" "$ARM64_WORK" "amd64-to-arm64-$case-target.json"

  capture_support "$ARM64_HOST" "$ARM64_WORK" "$case" "arm64-to-amd64-$case-source.json"
  copy_json "$ARM64_HOST" "$ARM64_WORK" "arm64-to-amd64-$case-source.json"
  send_json "$AMD64_HOST" "$AMD64_WORK" "arm64-to-amd64-$case-source.json" "arm64-to-amd64-$case-source.json"
  materialize "$AMD64_HOST" "$AMD64_WORK" "$mat_case" "arm64-to-amd64-$case-target.json" "arm64-to-amd64-$case-source.json"
  copy_json "$AMD64_HOST" "$AMD64_WORK" "arm64-to-amd64-$case-target.json"
done
for case in "${REFUSAL_CASES[@]}"; do
  capture_refusal "$AMD64_HOST" "$AMD64_WORK" "$case" "same-$case.json"
  copy_json "$AMD64_HOST" "$AMD64_WORK" "same-$case.json"
  capture_refusal "$AMD64_HOST" "$AMD64_WORK" "$case" "amd64-to-arm64-$case-source.json"
  copy_json "$AMD64_HOST" "$AMD64_WORK" "amd64-to-arm64-$case-source.json"
  capture_refusal "$ARM64_HOST" "$ARM64_WORK" "$case" "arm64-to-amd64-$case-source.json"
  copy_json "$ARM64_HOST" "$ARM64_WORK" "arm64-to-amd64-$case-source.json"
done
python3 "$SCRIPT_DIR/capture_to_materialize.py" combine "$RETAINED_DIR"
cleanup "$AMD64_HOST" "$AMD64_WORK"
cleanup "$ARM64_HOST" "$ARM64_WORK"
for json in "$RETAINED_DIR"/*.json; do python3 -m json.tool "$json" >/dev/null; done
echo "Native continuation capture-to-materialize verification completed"
echo "Retained report: $RETAINED_DIR/report.json"
