#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RETAINED_DIR="$SCRIPT_DIR/retained"
AMD64_HOST=${REAL_NODE_POSTGRES_AMD64_HOST:-root@192.168.0.8}
ARM64_HOST=${REAL_NODE_POSTGRES_ARM64_HOST:-friend@100.126.46.90}
RUN_ID=${REAL_NODE_POSTGRES_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
AMD64_BASE=${REAL_NODE_POSTGRES_AMD64_REMOTE_BASE:-/mnt/shared-500G}
ARM64_BASE=${REAL_NODE_POSTGRES_ARM64_REMOTE_BASE:-/tmp}
AMD64_WORK=${REAL_NODE_POSTGRES_AMD64_WORK:-$AMD64_BASE/machinen-real-node-postgres-amd64-$RUN_ID}
ARM64_WORK=${REAL_NODE_POSTGRES_ARM64_WORK:-$ARM64_BASE/machinen-real-node-postgres-arm64-$RUN_ID}
mkdir -p "$RETAINED_DIR"
rm -f "$RETAINED_DIR"/*.json
setup() {
  local host=$1 work=$2
  ssh -o BatchMode=yes "$host" "rm -rf '$work' && mkdir -p '$work/retained'"
  scp -q "$SCRIPT_DIR/real_node_postgres_continuation_ladder.py" "$host:$work/"
  scp -q "$SCRIPT_DIR/../native-continuation-classifier/classify.py" "$host:$work/classify.py"
  scp -q "$SCRIPT_DIR/../native-continuation-app-adapters/app_adapters.py" "$host:$work/app_adapters.py"
}
remote_run() { local host=$1 work=$2; shift 2; ssh -o BatchMode=yes "$host" "cd '$work' && $*"; }
capture_support() { local host=$1 work=$2 case=$3 out=$4; remote_run "$host" "$work" "python3 real_node_postgres_continuation_ladder.py capture-support '$case' 'retained/$out'"; }
materialize_support() { local host=$1 work=$2 case=$3 descriptor=$4 out=$5; remote_run "$host" "$work" "python3 real_node_postgres_continuation_ladder.py materialize-support '$case' 'retained/$descriptor' 'retained/$out'"; }
capture_refusal() { local host=$1 work=$2 case=$3 out=$4; remote_run "$host" "$work" "python3 real_node_postgres_continuation_ladder.py capture-refusal '$case' 'retained/$out'"; }
copy_json() { local host=$1 work=$2 remote=$3; scp -q "$host:$work/retained/$remote" "$RETAINED_DIR/$remote"; }
send_json() { local host=$1 work=$2 local_json=$3 remote=$4; scp -q "$RETAINED_DIR/$local_json" "$host:$work/retained/$remote"; }
cleanup() { local host=$1 work=$2; ssh -o BatchMode=yes "$host" "rm -rf '$work'" >/dev/null 2>&1 || true; }
setup "$AMD64_HOST" "$AMD64_WORK"
setup "$ARM64_HOST" "$ARM64_WORK"
SUPPORT_CASES=()
while IFS= read -r case; do SUPPORT_CASES+=("$case"); done < <(python3 "$SCRIPT_DIR/real_node_postgres_continuation_ladder.py" list-support-cases)
REFUSAL_CASES=()
while IFS= read -r case; do REFUSAL_CASES+=("$case"); done < <(python3 "$SCRIPT_DIR/real_node_postgres_continuation_ladder.py" list-refusal-cases)
for case in "${SUPPORT_CASES[@]}"; do
  capture_support "$AMD64_HOST" "$AMD64_WORK" "$case" "same-$case-source.json"
  copy_json "$AMD64_HOST" "$AMD64_WORK" "same-$case-source.json"
  materialize_support "$AMD64_HOST" "$AMD64_WORK" "$case" "same-$case-source.json" "same-$case-target.json"
  copy_json "$AMD64_HOST" "$AMD64_WORK" "same-$case-target.json"

  capture_support "$AMD64_HOST" "$AMD64_WORK" "$case" "amd64-to-arm64-$case-source.json"
  copy_json "$AMD64_HOST" "$AMD64_WORK" "amd64-to-arm64-$case-source.json"
  send_json "$ARM64_HOST" "$ARM64_WORK" "amd64-to-arm64-$case-source.json" "amd64-to-arm64-$case-source.json"
  materialize_support "$ARM64_HOST" "$ARM64_WORK" "$case" "amd64-to-arm64-$case-source.json" "amd64-to-arm64-$case-target.json"
  copy_json "$ARM64_HOST" "$ARM64_WORK" "amd64-to-arm64-$case-target.json"

  capture_support "$ARM64_HOST" "$ARM64_WORK" "$case" "arm64-to-amd64-$case-source.json"
  copy_json "$ARM64_HOST" "$ARM64_WORK" "arm64-to-amd64-$case-source.json"
  send_json "$AMD64_HOST" "$AMD64_WORK" "arm64-to-amd64-$case-source.json" "arm64-to-amd64-$case-source.json"
  materialize_support "$AMD64_HOST" "$AMD64_WORK" "$case" "arm64-to-amd64-$case-source.json" "arm64-to-amd64-$case-target.json"
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
python3 "$SCRIPT_DIR/real_node_postgres_continuation_ladder.py" combine "$RETAINED_DIR"
cleanup "$AMD64_HOST" "$AMD64_WORK"
cleanup "$ARM64_HOST" "$ARM64_WORK"
for json in "$RETAINED_DIR"/*.json; do python3 -m json.tool "$json" >/dev/null; done
echo "Real Node.js/PostgreSQL continuation ladder completed"
echo "Retained report: $RETAINED_DIR/report.json"
