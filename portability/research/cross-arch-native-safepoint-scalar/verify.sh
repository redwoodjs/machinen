#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RETAINED_DIR="$SCRIPT_DIR/retained"
ARM64_HOST=${TRACK_A_ARM64_HOST:-friend@100.126.46.90}
AMD64_HOST=${TRACK_A_AMD64_HOST:-root@192.168.0.8}
RUN_ID=${TRACK_A_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
LOCAL_WORK=${TRACK_A_LOCAL_WORK:-/tmp/machinen-track-a-scalar-$RUN_ID}
ARM64_WORK=${TRACK_A_ARM64_WORK:-/tmp/machinen-track-a-scalar-$RUN_ID}
AMD64_WORK=${TRACK_A_AMD64_WORK:-/tmp/machinen-track-a-scalar-$RUN_ID}

mkdir -p "$LOCAL_WORK" "$RETAINED_DIR"

cleanup() {
  rm -rf "$LOCAL_WORK"
  ssh -o BatchMode=yes "$ARM64_HOST" "rm -rf '$ARM64_WORK'" >/dev/null 2>&1 || true
  ssh -o BatchMode=yes "$AMD64_HOST" "rm -rf '$AMD64_WORK'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

run_ssh() {
  local host=$1
  shift
  ssh -o BatchMode=yes "$host" "$@"
}

copy_to_host() {
  local source=$1
  local host=$2
  local target=$3
  scp -q "$source" "$host:$target"
}

copy_from_host() {
  local host=$1
  local source=$2
  local target=$3
  scp -q "$host:$source" "$target"
}

require_host() {
  local host=$1
  local expected=$2
  local actual
  actual=$(run_ssh "$host" "uname -m")
  case "$expected:$actual" in
    arm64:aarch64|arm64:arm64|amd64:x86_64|amd64:amd64) ;;
    *)
      echo "expected $host to be $expected, got $actual" >&2
      exit 2
      ;;
  esac
}

compile_fixture() {
  local host=$1
  local arch=$2
  local work=$3
  run_ssh "$host" "mkdir -p '$work'"
  copy_to_host "$SCRIPT_DIR/fixture.c" "$host" "$work/fixture.c"
  run_ssh "$host" "cc -std=c11 -Wall -Wextra -Werror -O2 -DTRACK_A_ARCH=\\\"$arch\\\" '$work/fixture.c' -o '$work/track-a-scalar'"
}

expect_refusal() {
  local host=$1
  local binary=$2
  local ir=$3
  local log=$4
  set +e
  run_ssh "$host" "'$binary' restore '$ir'" >"$log" 2>&1
  local status=$?
  set -e
  if [[ $status -eq 0 ]]; then
    echo "expected refusal for $ir on $host" >&2
    cat "$log" >&2
    exit 1
  fi
  if ! grep -q "REFUSED:" "$log"; then
    echo "expected REFUSED output for $ir on $host" >&2
    cat "$log" >&2
    exit 1
  fi
}

write_refusal_ir() {
  local path=$1
  local source_arch=$2
  local target_arch=$3
  local extra=$4
  cat >"$path" <<JSON
{
  "kind": "machinen.research.continuation-ir",
  "version": 1,
  $extra
  "sourceArch": "$source_arch",
  "targetArch": "$target_arch",
  "safePoint": "after_increment",
  "entrySymbol": "continue_from_safepoint",
  "capture": {
    "binaryArch": "$source_arch",
    "declaredSafePoint": true,
    "activeSyscall": false,
    "threads": 0,
    "sockets": 0
  },
  "state": {
    "counter": 41,
    "message": "hello"
  },
  "claimGuard": {
    "arbitraryProcessRestoreClaimed": false,
    "rawVmReplayUsed": false,
    "sourceIsaEmulationUsed": false,
    "metadataOnlySuccess": false
  },
  "refusalCase": true
}
JSON
}

require_host "$ARM64_HOST" arm64
require_host "$AMD64_HOST" amd64
compile_fixture "$ARM64_HOST" arm64 "$ARM64_WORK"
compile_fixture "$AMD64_HOST" amd64 "$AMD64_WORK"

run_ssh "$ARM64_HOST" "'$ARM64_WORK/track-a-scalar' capture arm64 amd64 '$ARM64_WORK/arm64-to-amd64.ir.json'" >"$LOCAL_WORK/capture-arm64-to-amd64.log"
copy_from_host "$ARM64_HOST" "$ARM64_WORK/arm64-to-amd64.ir.json" "$LOCAL_WORK/arm64-to-amd64.ir.json"
copy_to_host "$LOCAL_WORK/arm64-to-amd64.ir.json" "$AMD64_HOST" "$AMD64_WORK/arm64-to-amd64.ir.json"
run_ssh "$AMD64_HOST" "'$AMD64_WORK/track-a-scalar' restore '$AMD64_WORK/arm64-to-amd64.ir.json'" >"$LOCAL_WORK/restore-arm64-to-amd64.log"
grep -q "hello:42" "$LOCAL_WORK/restore-arm64-to-amd64.log"
grep -q "RESTORE_OK source=arm64 target=amd64" "$LOCAL_WORK/restore-arm64-to-amd64.log"

run_ssh "$AMD64_HOST" "'$AMD64_WORK/track-a-scalar' capture amd64 arm64 '$AMD64_WORK/amd64-to-arm64.ir.json'" >"$LOCAL_WORK/capture-amd64-to-arm64.log"
copy_from_host "$AMD64_HOST" "$AMD64_WORK/amd64-to-arm64.ir.json" "$LOCAL_WORK/amd64-to-arm64.ir.json"
copy_to_host "$LOCAL_WORK/amd64-to-arm64.ir.json" "$ARM64_HOST" "$ARM64_WORK/amd64-to-arm64.ir.json"
run_ssh "$ARM64_HOST" "'$ARM64_WORK/track-a-scalar' restore '$ARM64_WORK/amd64-to-arm64.ir.json'" >"$LOCAL_WORK/restore-amd64-to-arm64.log"
grep -q "hello:42" "$LOCAL_WORK/restore-amd64-to-arm64.log"
grep -q "RESTORE_OK source=amd64 target=arm64" "$LOCAL_WORK/restore-amd64-to-arm64.log"

write_refusal_ir "$LOCAL_WORK/refuse-active-syscall.ir.json" arm64 amd64 '"activeSyscall": true,'
write_refusal_ir "$LOCAL_WORK/refuse-threads.ir.json" arm64 amd64 '"hasThreads": true,'
write_refusal_ir "$LOCAL_WORK/refuse-socket.ir.json" arm64 amd64 '"hasSocket": true,'
write_refusal_ir "$LOCAL_WORK/refuse-source-isa-emulation.ir.json" arm64 amd64 '"sourceIsaEmulationUsed": true,'
write_refusal_ir "$LOCAL_WORK/refuse-metadata-only.ir.json" arm64 amd64 '"metadataOnlySuccess": true,'
write_refusal_ir "$LOCAL_WORK/refuse-stack-frame.ir.json" arm64 amd64 '"unsupportedStackFrame": true,'
write_refusal_ir "$LOCAL_WORK/refuse-target-mismatch.ir.json" arm64 arm64 '"note": "target mismatch",'
cp "$LOCAL_WORK/refuse-active-syscall.ir.json" "$LOCAL_WORK/refuse-missing-safe-point.ir.json"
python3 - "$LOCAL_WORK/refuse-missing-safe-point.ir.json" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
path.write_text(path.read_text().replace('"safePoint": "after_increment"', '"safePoint": "not_declared"'))
PY

for ir in "$LOCAL_WORK"/refuse-*.ir.json; do
  base=$(basename "$ir" .ir.json)
  copy_to_host "$ir" "$AMD64_HOST" "$AMD64_WORK/$base.ir.json"
  expect_refusal "$AMD64_HOST" "$AMD64_WORK/track-a-scalar" "$AMD64_WORK/$base.ir.json" "$LOCAL_WORK/$base.amd64.log"
done

for ir in "$LOCAL_WORK"/*.ir.json "$LOCAL_WORK"/*.log; do
  cp "$ir" "$RETAINED_DIR/$(basename "$ir")"
done

arm64_uname=$(run_ssh "$ARM64_HOST" "uname -a")
amd64_uname=$(run_ssh "$AMD64_HOST" "uname -a")
cat >"$RETAINED_DIR/report.json" <<JSON
{
  "kind": "machinen.research.track-a.native-scalar.report",
  "version": 1,
  "runId": "$RUN_ID",
  "arm64Host": "$ARM64_HOST",
  "amd64Host": "$AMD64_HOST",
  "arm64Uname": "$arm64_uname",
  "amd64Uname": "$amd64_uname",
  "sharedResearchHost": "192.168.0.8",
  "proofs": [
    {
      "direction": "arm64 -> amd64",
      "sourceCapture": "retained/arm64-to-amd64.ir.json",
      "targetRestoreLog": "retained/restore-arm64-to-amd64.log",
      "result": "hello:42"
    },
    {
      "direction": "amd64 -> arm64",
      "sourceCapture": "retained/amd64-to-arm64.ir.json",
      "targetRestoreLog": "retained/restore-amd64-to-arm64.log",
      "result": "hello:42"
    }
  ],
  "claimGuard": {
    "arbitraryProcessRestoreClaimed": false,
    "rawVmReplayUsed": false,
    "sourceIsaEmulationUsed": false,
    "metadataOnlySuccess": false
  },
  "refusalCases": [
    "active syscall",
    "threads",
    "socket",
    "source-ISA emulation",
    "metadata-only success",
    "unsupported stack frame",
    "target architecture mismatch",
    "missing declared safe point"
  ],
  "status": "passed"
}
JSON

echo "Track A native scalar safe-point proof passed"
echo "Retained report: $RETAINED_DIR/report.json"
