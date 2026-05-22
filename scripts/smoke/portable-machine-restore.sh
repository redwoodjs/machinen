#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ARM64_SSH=${PORTABLE_ARM64_SSH:-friend@100.126.46.90}
AMD64_SSH=${PORTABLE_AMD64_SSH:-root@192.168.0.8}
TARGET_IMAGE=${PORTABLE_MACHINE_TARGET_VM_IMAGE:-${MACHINEN_TARGET_VM_IMAGE:-}}
REQUIRE_REMOTES=${PORTABLE_MACHINE_SMOKE_REQUIRE_REMOTES:-0}
KEEP=0
JSON=0
DRY_RUN=0
WORK=${PORTABLE_MACHINE_SMOKE_WORK_DIR:-}

usage() {
  echo "usage: bash scripts/smoke/portable-machine-restore.sh [--json] [--dry-run] [--keep] [--work-dir path]" >&2
  exit 2
}

while (($# > 0)); do
  case "$1" in
    --) shift ;;
    --json) JSON=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --keep) KEEP=1; shift ;;
    --work-dir)
      shift
      [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage
      WORK=$1
      shift
      ;;
    *) usage ;;
  esac
done

if [[ -z "$WORK" ]]; then
  WORK=$(mktemp -d)
else
  rm -rf "$WORK"
  mkdir -p "$WORK"
fi
NATIVE_BUNDLE="$WORK/native-process"
PORTABLE_BUNDLE="$WORK/portable-machine"
TARGET_DIR="$PORTABLE_BUNDLE/target"
TARGET_CODE="$TARGET_DIR/continuation.bin"
SUMMARY="$WORK/summary.json"
TARGET_LOG="$WORK/target-restore.json"
TIMINGS=()
STATE="running"
SKIP_REASON=""
FAILURE=""

now_ms() {
  node -e 'console.log(Date.now())'
}

json_escape() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]).slice(1, -1))' "$1"
}

record_timing() {
  local name=$1 status=$2 start=$3 detail=${4:-}
  local end elapsed
  end=$(now_ms)
  elapsed=$((end - start))
  TIMINGS+=("{\"name\":\"$(json_escape "$name")\",\"status\":\"$(json_escape "$status")\",\"ms\":$elapsed,\"detail\":\"$(json_escape "$detail")\"}")
  if [[ $JSON -eq 0 ]]; then
    echo "portable-machine-restore: $name $status (${elapsed}ms)${detail:+ — $detail}"
  fi
}

write_summary() {
  local timings joined
  joined=$(IFS=,; echo "${TIMINGS[*]}")
  cat >"$SUMMARY" <<JSON_SUMMARY
{
  "profile": "portable-machine-restore",
  "state": "$(json_escape "$STATE")",
  "skipReason": "$(json_escape "$SKIP_REASON")",
  "failure": "$(json_escape "$FAILURE")",
  "workDir": "$(json_escape "$WORK")",
  "nativeProcessBundle": "$(json_escape "$NATIVE_BUNDLE")",
  "portableMachineBundle": "$(json_escape "$PORTABLE_BUNDLE")",
  "targetCodeFile": "$(json_escape "$TARGET_CODE")",
  "targetImage": "$(json_escape "$TARGET_IMAGE")",
  "timings": [$joined]
}
JSON_SUMMARY
  if [[ $JSON -eq 1 ]]; then
    cat "$SUMMARY"
  else
    echo "portable-machine-restore: state=$STATE workDir=$WORK"
  fi
}

finish_success() {
  STATE="completed"
  write_summary
  if [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; fi
  exit 0
}

finish_skip() {
  SKIP_REASON=$1
  STATE="skipped"
  write_summary
  if [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; fi
  exit 0
}

finish_failure() {
  FAILURE=$1
  STATE="failed"
  KEEP=1
  write_summary
  echo "portable-machine-restore: FAIL — $FAILURE" >&2
  echo "portable-machine-restore: preserving workDir=$WORK" >&2
  exit 1
}

check_ssh() {
  local label=$1 host=$2 start
  start=$(now_ms)
  if ssh -o BatchMode=yes -o ConnectTimeout=5 "$host" 'true' >/dev/null 2>&1; then
    record_timing "$label" "ok" "$start" "$host reachable"
    return 0
  fi
  record_timing "$label" "skipped" "$start" "$host unreachable"
  return 1
}

preflight() {
  local start
  start=$(now_ms)
  if [[ $REQUIRE_REMOTES == "1" ]]; then
    check_ssh "arm64-remote" "$ARM64_SSH" || return 10
    check_ssh "amd64-remote" "$AMD64_SSH" || return 11
  fi
  if [[ $DRY_RUN -eq 0 ]]; then
    if [[ -z "$TARGET_IMAGE" || ! -f "$TARGET_IMAGE" ]]; then
      record_timing "preflight" "skipped" "$start" "PORTABLE_MACHINE_TARGET_VM_IMAGE or MACHINEN_TARGET_VM_IMAGE is required"
      return 12
    fi
    case "$(uname -s):$(uname -m)" in
      Linux:x86_64|Linux:amd64) ;;
      *)
        record_timing "preflight" "skipped" "$start" "target VM restore requires Linux/amd64 host"
        return 13
        ;;
    esac
  fi
  record_timing "preflight" "ok" "$start" "target image and host gates satisfied"
  return 0
}

write_native_process_bundle() {
  local start=$1
  node --input-type=module - "$NATIVE_BUNDLE" <<'NODE'
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
const refusals = { vocabularyVersion: 1, refusals: [] };
const zeroArm64 = {
  arch: 'arm64', pc: '0x0', sp: '0x1000', pstate: '0x0',
  x: Array.from({ length: 31 }, () => '0x0'),
};
writeFileSync(join(dir, 'native-process.json'), JSON.stringify({
  formatVersion: 1,
  kind: 'machinen.native-process-image',
  capture: { method: 'external-ptrace-procfs', sourceArch: 'arm64', pid: 593 },
  target: { mode: 'native-cross-isa', arch: 'amd64', abi: 'linux-user' },
  process: { exe: '/bin/true', argv: ['true'], env: {}, cwd: '/' },
  refusals,
}, null, 2));
writeFileSync(join(dir, 'native-mappings.json'), JSON.stringify({
  formatVersion: 1,
  mappings: [{
    id: 'mapping:stack', kind: 'stack', sourceStart: '0x1000', sourceEnd: '0x2000', sizeBytes: 4096,
    permissions: { read: true, write: true, execute: false, private: true, shared: false },
    captured: { file: 'native-memory.bin', offset: 0, sizeBytes: 16 },
    target: { materialization: 'translate' },
  }],
  refusals,
}, null, 2));
writeFileSync(join(dir, 'native-threads.json'), JSON.stringify({
  formatVersion: 1,
  threads: [{
    id: 'thread:1', lwpid: 593, state: 'stopped', stopReason: 'ptrace-stop', stackMapping: 'mapping:stack',
    sourceRegisters: zeroArm64,
    syscall: { state: 'outside-syscall' },
    signal: { blocked: [], pending: [], activeFrame: false, altStack: { state: 'disabled' } },
    tls: { threadPointer: '0x0', rseq: { state: 'absent' } },
  }],
  refusals,
}, null, 2));
writeFileSync(join(dir, 'native-resources.json'), JSON.stringify({ formatVersion: 1, resources: [], refusals }, null, 2));
writeFileSync(join(dir, 'native-translation.json'), JSON.stringify({
  formatVersion: 1, mode: 'native-cross-isa', sourceArch: 'arm64', targetArch: 'amd64',
  codeLocations: [], threads: [], memoryRelocations: [], refusals,
}, null, 2));
writeFileSync(join(dir, 'native-memory.bin'), Buffer.alloc(16));
NODE
  record_timing "capture" "ok" "$start" "arm64 native-process bundle synthesized"
}

create_portable_bundle() {
  local start=$1
  pnpm --silent portable-machine-snapshot -- --native-process-bundle "$NATIVE_BUNDLE" --out-dir "$PORTABLE_BUNDLE" --json >"$WORK/portable-machine-snapshot.json"
  mkdir -p "$TARGET_DIR"
  # amd64: mov eax,60; xor edi,edi; syscall
  printf '\270\074\000\000\000\061\377\017\005' >"$TARGET_CODE"
  record_timing "bundle" "ok" "$start" "portable bundle validated and target bytes staged"
}

transfer_bundle() {
  local start=$1
  # The current product-shaped proof runs on the target host filesystem. Keep a
  # separate transfer phase so remote-copy timing can replace this no-op without
  # changing smoke output shape.
  record_timing "transfer" "ok" "$start" "bundle local to target VM runner"
}

run_target_restore() {
  local start=$1
  if [[ $DRY_RUN -eq 1 ]]; then
    record_timing "target-boot-restore" "skipped" "$start" "dry run"
    return 20
  fi
  if ! pnpm --silent portable-machine-vm-restore-proof -- \
    --bundle-dir "$PORTABLE_BUNDLE" \
    --target-code-file "$TARGET_CODE" \
    --image "$TARGET_IMAGE" \
    --json >"$TARGET_LOG" 2>"$WORK/target-restore.stderr"; then
    record_timing "target-boot-restore" "failed" "$start" "runner failed"
    return 21
  fi
  if node --input-type=module - "$TARGET_LOG" <<'NODE'
import { readFileSync } from 'node:fs';
const result = JSON.parse(readFileSync(process.argv[2], 'utf8'));
process.exit(result.state === 'completed' && result.migrationCompleted === true ? 0 : 1);
NODE
  then
    record_timing "target-boot-restore" "ok" "$start" "target-native completion observed"
    return 0
  fi
  record_timing "target-boot-restore" "failed" "$start" "target did not report completion"
  return 22
}

completion_phase() {
  local start=$1
  record_timing "completion" "ok" "$start" "logs and bundle paths recorded"
}

preflight_rc=0
preflight || preflight_rc=$?
if [[ $preflight_rc -ne 0 ]]; then
  finish_skip "preflight skipped with code $preflight_rc"
fi

start=$(now_ms); write_native_process_bundle "$start"
start=$(now_ms); create_portable_bundle "$start"
start=$(now_ms); transfer_bundle "$start"
start=$(now_ms)
target_rc=0
run_target_restore "$start" || target_rc=$?
if [[ $target_rc -eq 20 ]]; then
  finish_skip "dry run"
elif [[ $target_rc -ne 0 ]]; then
  finish_failure "target restore failed with code $target_rc"
fi
start=$(now_ms); completion_phase "$start"
finish_success
