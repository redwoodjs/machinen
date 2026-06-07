#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RETAINED_DIR="$SCRIPT_DIR/retained"
ARM64_HOST=${TRACK_A_ARM64_HOST:-friend@100.126.46.90}
AMD64_HOST=${TRACK_A_AMD64_HOST:-root@192.168.0.8}
RUN_ID=${TRACK_A_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
LOCAL_WORK=${TRACK_A_LOCAL_WORK:-/tmp/machinen-track-a-cpu-memory-final-jump-$RUN_ID}
ARM64_WORK=${TRACK_A_ARM64_WORK:-/tmp/machinen-track-a-cpu-memory-final-jump-$RUN_ID}
AMD64_WORK=${TRACK_A_AMD64_WORK:-/tmp/machinen-track-a-cpu-memory-final-jump-$RUN_ID}

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
  run_ssh "$host" "cc -std=gnu11 -Wall -Wextra -Werror -O2 -DTRACK_A_ARCH=\\\"$arch\\\" '$work/fixture.c' -o '$work/track-a-final-jump'"
}

run_direction() {
  local source_host=$1
  local source_arch=$2
  local source_work=$3
  local target_host=$4
  local target_arch=$5
  local target_work=$6
  local name="$source_arch-to-$target_arch"

  run_ssh "$source_host" "'$source_work/track-a-final-jump' capture '$source_arch' '$target_arch' '$source_work/$name.ir.json'" >"$LOCAL_WORK/capture-$name.log"
  copy_from_host "$source_host" "$source_work/$name.ir.json" "$LOCAL_WORK/$name.ir.json"
  copy_to_host "$LOCAL_WORK/$name.ir.json" "$target_host" "$target_work/$name.ir.json"
  run_ssh "$target_host" "'$target_work/track-a-final-jump' restore '$target_work/$name.ir.json'" >"$LOCAL_WORK/restore-$name.log"
  grep -q "hello:42" "$LOCAL_WORK/restore-$name.log"
  grep -q "FINAL_JUMP_OK source=$source_arch target=$target_arch" "$LOCAL_WORK/restore-$name.log"
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

require_host "$ARM64_HOST" arm64
require_host "$AMD64_HOST" amd64
compile_fixture "$ARM64_HOST" arm64 "$ARM64_WORK"
compile_fixture "$AMD64_HOST" amd64 "$AMD64_WORK"

run_direction "$ARM64_HOST" arm64 "$ARM64_WORK" "$AMD64_HOST" amd64 "$AMD64_WORK"
run_direction "$AMD64_HOST" amd64 "$AMD64_WORK" "$ARM64_HOST" arm64 "$ARM64_WORK"

python3 - "$LOCAL_WORK/arm64-to-amd64.ir.json" "$LOCAL_WORK/refuse-bad-relocation.ir.json" "$LOCAL_WORK/refuse-source-isa-emulation.ir.json" <<'PY'
import pathlib
import sys
source = pathlib.Path(sys.argv[1]).read_text()
pathlib.Path(sys.argv[2]).write_text(source.replace('"targetOffset": 16', '"targetOffset": 24'))
pathlib.Path(sys.argv[3]).write_text(source.replace('"sourceIsaEmulationUsed": false', '"sourceIsaEmulationUsed": true'))
PY

for ir in "$LOCAL_WORK"/refuse-*.ir.json; do
  base=$(basename "$ir" .ir.json)
  copy_to_host "$ir" "$AMD64_HOST" "$AMD64_WORK/$base.ir.json"
  expect_refusal "$AMD64_HOST" "$AMD64_WORK/track-a-final-jump" "$AMD64_WORK/$base.ir.json" "$LOCAL_WORK/$base.amd64.log"
done

rm -f "$RETAINED_DIR"/*
for artifact in "$LOCAL_WORK"/*.ir.json "$LOCAL_WORK"/*.log; do
  cp "$artifact" "$RETAINED_DIR/$(basename "$artifact")"
done

arm64_uname=$(run_ssh "$ARM64_HOST" "uname -a")
amd64_uname=$(run_ssh "$AMD64_HOST" "uname -a")
cat >"$RETAINED_DIR/report.json" <<JSON
{
  "kind": "machinen.research.track-a.cpu-memory-final-jump.report",
  "version": 1,
  "runId": "$RUN_ID",
  "arm64Host": "$ARM64_HOST",
  "amd64Host": "$AMD64_HOST",
  "arm64Uname": "$arm64_uname",
  "amd64Uname": "$amd64_uname",
  "sharedResearchHost": "192.168.0.8",
  "provedSteps": [
    "source CPU register capture: pc, sp, arg0",
    "declared heap memory capture with raw bytes",
    "source-to-target pointer relocation",
    "target-native heap and stack reconstruction",
    "target CPU plan: pc symbol, stack pointer, argument register",
    "assembly final jump into target-native code"
  ],
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
  "refusalCases": ["bad pointer relocation", "source-ISA emulation"],
  "status": "passed"
}
JSON

python3 -m json.tool "$RETAINED_DIR/report.json" >/dev/null

echo "Track A CPU/memory/final-jump proof passed"
echo "Retained report: $RETAINED_DIR/report.json"
