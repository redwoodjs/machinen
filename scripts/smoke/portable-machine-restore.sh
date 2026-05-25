#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ARM64_SSH=${PORTABLE_ARM64_SSH:-friend@100.126.46.90}
AMD64_SSH=${PORTABLE_AMD64_SSH:-root@192.168.0.8}
TARGET_IMAGE=${PORTABLE_MACHINE_TARGET_VM_IMAGE:-${MACHINEN_TARGET_VM_IMAGE:-}}
REQUIRE_REMOTES=${PORTABLE_MACHINE_SMOKE_REQUIRE_REMOTES:-0}
AMD64_REPO=${PORTABLE_AMD64_REPO:-}
ARM64_NODE=${PORTABLE_ARM64_NODE:-node}
AMD64_PNPM=${PORTABLE_AMD64_PNPM:-pnpm}
AMD64_PATH_PREFIX=${PORTABLE_AMD64_PATH_PREFIX:-}
AMD64_VMM=${PORTABLE_AMD64_VMM:-${MACHINEN_VMM:-}}
AMD64_KERNEL=${PORTABLE_AMD64_KERNEL:-${MACHINEN_KERNEL:-}}
AMD64_ASSETS_DIR=${PORTABLE_AMD64_ASSETS_DIR:-${MACHINEN_ASSETS_DIR:-}}
REMOTE_SOURCE_TARGET=${PORTABLE_MACHINE_REMOTE_SOURCE_TARGET:-two-thread-ppoll}
KEEP=0
JSON=0
DRY_RUN=0
REMOTE_E2E=0
WORK=${PORTABLE_MACHINE_SMOKE_WORK_DIR:-}
REMOTE_STAMP=${PORTABLE_MACHINE_REMOTE_WORK_STAMP:-$$}
ARM64_REMOTE_WORK=${PORTABLE_MACHINE_ARM64_WORK_DIR:-/tmp/machinen-portable-machine-restore-arm64-$REMOTE_STAMP}
AMD64_REMOTE_WORK=${PORTABLE_MACHINE_AMD64_WORK_DIR:-/tmp/machinen-portable-machine-restore-amd64-$REMOTE_STAMP}
REMOTE_PORTABLE_BUNDLE="$AMD64_REMOTE_WORK/portable-machine"
REMOTE_TARGET_CODE="$REMOTE_PORTABLE_BUNDLE/target/continuation.bin"

usage() {
  echo "usage: bash scripts/smoke/portable-machine-restore.sh [--json] [--dry-run] [--remote-e2e] [--keep] [--work-dir path]" >&2
  exit 2
}

while (($# > 0)); do
  case "$1" in
    --) shift ;;
    --json) JSON=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --remote-e2e) REMOTE_E2E=1; shift ;;
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
REMOTE_PREFLIGHT_READY=0

now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
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

target_restore_details() {
  if [[ ! -f "$TARGET_LOG" ]]; then
    echo '{}'
    return
  fi
  node --input-type=module - "$TARGET_LOG" <<'NODE'
import { readFileSync } from 'node:fs';
try {
  const result = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(JSON.stringify({
    state: result.state ?? 'not-run',
    migrationCompleted: result.migrationCompleted ?? false,
    descriptorGateCompleted: result.descriptorGateCompleted ?? false,
    descriptorMemoryEntryCount: result.descriptorMemoryEntryCount ?? 0,
    descriptorFdRecipeCount: result.descriptorFdRecipeCount ?? 0,
    descriptorResourceKinds: result.descriptorResourceKinds ?? [],
    targetArch: result.targetArch ?? result.targetGuestArch ?? 'amd64',
    targetVerifierResult: result.targetVerifierResult ?? 'not-run',
    targetContinuationKind: result.targetContinuationKind ?? 'unknown',
    targetContinuationStatus: result.targetContinuationStatus ?? '',
    targetContinuationReturnValue: result.targetContinuationReturnValue ?? '',
    targetModuleBytesSource: result.targetModuleBytesSource ?? '',
    targetStateConsumptionResult: result.targetStateConsumptionResult ?? '',
    targetResourceStatuses: result.targetResourceStatuses ?? [],
    targetReturnChainResult: result.targetReturnChainResult ?? '',
    targetTranslatedReturnAddress: result.targetTranslatedReturnAddress ?? '',
    targetFrameRestoreResult: result.targetFrameRestoreResult ?? '',
    targetTranslatedFramePointer: result.targetTranslatedFramePointer ?? '',
    targetRegisterRestoreResult: result.targetRegisterRestoreResult ?? '',
    targetRflagsRestoreResult: result.targetRflagsRestoreResult ?? '',
    targetTlsRestoreResult: result.targetTlsRestoreResult ?? '',
    targetStackWindowMaterializationResult: result.targetStackWindowMaterializationResult ?? '',
    targetPrivateMemoryRestoreResult: result.targetPrivateMemoryRestoreResult ?? '',
    targetExecutableMappingResult: result.targetExecutableMappingResult ?? '',
    targetProcessContextRestoreResult: result.targetProcessContextRestoreResult ?? '',
    targetSignalRestoreResult: result.targetSignalRestoreResult ?? '',
    targetActiveSyscallRestoreResult: result.targetActiveSyscallRestoreResult ?? '',
    targetThreadRestoreResult: result.targetThreadRestoreResult ?? '',
    targetThreadRestoreThreadId: result.targetThreadRestoreThreadId ?? '',
    targetResumePathResult: result.targetResumePathResult ?? '',
    targetResumePathMode: result.targetResumePathMode ?? '',
    refusal: result.refusal ?? null,
    refusals: result.refusals ?? [],
    sourceTextReusedAsTargetCode: result.sourceTextReusedAsTargetCode ?? false,
    sourceIsaEmulationUsed: result.sourceIsaEmulationUsed ?? false,
    sidecarRuntimeUsed: result.sidecarRuntimeUsed ?? false,
  }));
} catch {
  process.stdout.write('{}');
}
NODE
}

remote_file_identity_json() {
  local path=$1 out size sha kind
  if [[ -z "$path" || $REMOTE_E2E -eq 0 || $DRY_RUN -eq 1 ]]; then
    echo 'null'
    return
  fi
  out=$(ssh "$AMD64_SSH" "if [ -f '$path' ]; then size=\$(stat -c %s '$path'); sha=\$(sha256sum '$path' | awk '{print \$1}'); kind=\$(file -b '$path'); printf '%s\t%s\t%s' \"\$size\" \"\$sha\" \"\$kind\"; else printf 'missing\t\t'; fi" 2>/dev/null || true)
  IFS=$'\t' read -r size sha kind <<<"$out"
  if [[ "$size" == "missing" || -z "$size" ]]; then
    printf '{"path":"%s","exists":false}' "$(json_escape "$path")"
    return
  fi
  printf '{"path":"%s","exists":true,"sizeBytes":%s,"sha256":"%s","file":"%s"}' "$(json_escape "$path")" "$size" "$(json_escape "$sha")" "$(json_escape "$kind")"
}

remote_preflight_details() {
  local init_path="" exec_agent_path="" arch
  if [[ $REMOTE_E2E -eq 0 || $DRY_RUN -eq 1 || $REMOTE_PREFLIGHT_READY -eq 0 ]]; then
    echo 'null'
    return
  fi
  if [[ -n "$AMD64_ASSETS_DIR" ]]; then
    init_path="$AMD64_ASSETS_DIR/init"
    exec_agent_path="$AMD64_ASSETS_DIR/exec-agent"
  fi
  arch=$(ssh "$AMD64_SSH" 'uname -m' 2>/dev/null || true)
  printf '{"host":"%s","hostArch":"%s","kernel":%s,"rootfs":%s,"vmm":%s,"targetInit":%s,"targetExecAgent":%s,"targetContinuation":%s,"restoreDescriptor":%s}' \
    "$(json_escape "$AMD64_SSH")" \
    "$(json_escape "$arch")" \
    "$(remote_file_identity_json "$AMD64_KERNEL")" \
    "$(remote_file_identity_json "$TARGET_IMAGE")" \
    "$(remote_file_identity_json "$AMD64_VMM")" \
    "$(remote_file_identity_json "$init_path")" \
    "$(remote_file_identity_json "$exec_agent_path")" \
    "$(remote_file_identity_json "$REMOTE_TARGET_CODE")" \
    "$(remote_file_identity_json "$REMOTE_PORTABLE_BUNDLE/target/combined-target-restore.desc")"
}

write_summary() {
  local timings joined target_details remote_preflight
  joined=$(IFS=,; echo "${TIMINGS[*]}")
  target_details=$(target_restore_details)
  remote_preflight=$(remote_preflight_details)
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
  "remoteE2e": $REMOTE_E2E,
  "arm64Ssh": "$(json_escape "$ARM64_SSH")",
  "amd64Ssh": "$(json_escape "$AMD64_SSH")",
  "amd64Repo": "$(json_escape "$AMD64_REPO")",
  "arm64Node": "$(json_escape "$ARM64_NODE")",
  "amd64Pnpm": "$(json_escape "$AMD64_PNPM")",
  "amd64Vmm": "$(json_escape "$AMD64_VMM")",
  "amd64Kernel": "$(json_escape "$AMD64_KERNEL")",
  "amd64AssetsDir": "$(json_escape "$AMD64_ASSETS_DIR")",
  "remotePortableMachineBundle": "$(json_escape "$REMOTE_PORTABLE_BUNDLE")",
  "remoteTargetCodeFile": "$(json_escape "$REMOTE_TARGET_CODE")",
  "remoteSourceTarget": "$(json_escape "$REMOTE_SOURCE_TARGET")",
  "remotePreflight": $remote_preflight,
  "targetRestore": $target_details,
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
  if [[ $DRY_RUN -eq 0 && $REMOTE_E2E -eq 1 ]]; then
    check_ssh "arm64-remote" "$ARM64_SSH" || return 10
    check_ssh "amd64-remote" "$AMD64_SSH" || return 11
    if [[ -z "$AMD64_REPO" ]]; then
      record_timing "preflight" "skipped" "$start" "PORTABLE_AMD64_REPO is required for remote e2e target restore"
      return 14
    fi
    if [[ -z "$TARGET_IMAGE" ]]; then
      record_timing "preflight" "skipped" "$start" "PORTABLE_MACHINE_TARGET_VM_IMAGE or MACHINEN_TARGET_VM_IMAGE is required"
      return 12
    fi
    if ! ssh "$AMD64_SSH" "test -d '$AMD64_REPO' && test -f '$TARGET_IMAGE'" >/dev/null 2>&1; then
      record_timing "preflight" "skipped" "$start" "amd64 repo or target image is missing on $AMD64_SSH"
      return 15
    fi
    if ! ssh "$AMD64_SSH" "set -e; test \"\$(uname -m)\" = x86_64; command -v '$AMD64_PNPM'; command -v node; command -v cc; command -v file; command -v sha256sum; if [ -n '$AMD64_VMM' ]; then test -f '$AMD64_VMM'; file -b '$AMD64_VMM' | grep -Eq 'ELF.*x86-64'; fi; if [ -n '$AMD64_KERNEL' ]; then test -f '$AMD64_KERNEL'; fi; if [ -n '$AMD64_ASSETS_DIR' ]; then test -f '$AMD64_ASSETS_DIR/init'; test -f '$AMD64_ASSETS_DIR/exec-agent'; file -b '$AMD64_ASSETS_DIR/init' | grep -Eq 'ELF.*x86-64'; file -b '$AMD64_ASSETS_DIR/exec-agent' | grep -Eq 'ELF.*x86-64'; fi" >"$WORK/remote-preflight.stdout" 2>"$WORK/remote-preflight.stderr"; then
      record_timing "preflight" "skipped" "$start" "amd64 remote preflight failed; expected x86_64 tools, VMM, kernel/rootfs, and guest helpers"
      return 16
    fi
    REMOTE_PREFLIGHT_READY=1
  elif [[ $DRY_RUN -eq 0 ]]; then
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
    captured: { file: 'native-memory.bin', offset: 0, sizeBytes: 4096 },
    target: { materialization: 'translate', targetStart: '0x600000000000' },
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
const memory = Buffer.alloc(4096);
memory[0] = 'M'.charCodeAt(0);
writeFileSync(join(dir, 'native-memory.bin'), memory);
NODE
  record_timing "capture" "ok" "$start" "arm64 native-process bundle synthesized"
}

capture_remote_native_process_bundle() {
  local start=$1
  ssh "$ARM64_SSH" "rm -rf '$ARM64_REMOTE_WORK' && mkdir -p '$ARM64_REMOTE_WORK/repo' '$ARM64_REMOTE_WORK/capture/bundle' '$ARM64_REMOTE_WORK/bin'"
  tar -czf - -C "$ROOT" \
    packages/microvm/assets/native-process-capture.c \
    packages/microvm/assets/native-eventfd-read-target.c \
    packages/microvm/assets/native-file-read-target.c \
    packages/microvm/assets/native-file-readv-target.c \
    packages/microvm/assets/native-file-pread-target.c \
    packages/microvm/assets/native-file-pwrite-target.c \
    packages/microvm/assets/native-file-write-target.c \
    packages/microvm/assets/native-file-writev-target.c \
    packages/microvm/assets/native-private-multi-range-file-target.c \
    packages/microvm/assets/native-tcp-listener-target.c \
    packages/microvm/assets/native-tcp-active-target.c \
    packages/microvm/assets/native-pipe-read-target.c \
    packages/microvm/assets/native-ppoll-timeout-target.c \
    packages/microvm/assets/native-timerfd-read-target.c \
    packages/microvm/assets/native-two-thread-ppoll-target.c | \
    ssh "$ARM64_SSH" "tar -xzf - -C '$ARM64_REMOTE_WORK/repo'"
  local target_binary target_detail
  case "$REMOTE_SOURCE_TARGET" in
    two-thread-ppoll)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-two-thread-ppoll-target"
      target_detail="remote arm64 two-thread ppoll native-process bundle captured from $ARM64_SSH"
      ;;
    pipe-read)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-pipe-read-target"
      target_detail="remote arm64 pipe read native-process bundle captured from $ARM64_SSH"
      ;;
    eventfd-read)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-eventfd-read-target"
      target_detail="remote arm64 eventfd read native-process bundle captured from $ARM64_SSH"
      ;;
    file-read)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-file-read-target"
      target_detail="remote arm64 regular-file read native-process bundle captured from $ARM64_SSH"
      ;;
    file-pread)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-file-pread-target"
      target_detail="remote arm64 regular-file pread64 native-process bundle captured from $ARM64_SSH"
      ;;
    file-readv)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-file-readv-target"
      target_detail="remote arm64 regular-file readv native-process bundle captured from $ARM64_SSH"
      ;;
    file-write)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-file-write-target"
      target_detail="remote arm64 regular-file write native-process bundle captured from $ARM64_SSH"
      ;;
    file-pwrite)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-file-pwrite-target"
      target_detail="remote arm64 regular-file pwrite64 native-process bundle captured from $ARM64_SSH"
      ;;
    file-writev)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-file-writev-target"
      target_detail="remote arm64 regular-file writev native-process bundle captured from $ARM64_SSH"
      ;;
    real-private-multi-range-file-recreate)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-private-multi-range-file-target"
      target_detail="remote arm64 real private multi-range regular-file native-process bundle captured from $ARM64_SSH"
      ;;
    real-tcp-listener-recreate|real-tcp-listener-readiness-recreate)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-tcp-listener-target"
      target_detail="remote arm64 real loopback tcp listener native-process bundle captured from $ARM64_SSH"
      ;;
    real-tcp-active-connection-transport-recreate)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-tcp-active-target"
      target_detail="remote arm64 real active tcp stream native-process bundle captured from $ARM64_SSH"
      ;;
    timerfd-read)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-timerfd-read-target"
      target_detail="remote arm64 timerfd read native-process bundle captured from $ARM64_SSH"
      ;;
    process-context)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-ppoll-timeout-target"
      target_detail="remote arm64 process-context native-process bundle captured from $ARM64_SSH"
      ;;
    eventfd-counter-recreate)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-pipe-read-target"
      target_detail="remote arm64 pipe read bundle with target eventfd counter descriptor proof captured from $ARM64_SSH"
      ;;
    eventfd-readiness-pollin-recreate)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-pipe-read-target"
      target_detail="remote arm64 pipe read bundle with target eventfd readiness poll proof captured from $ARM64_SSH"
      ;;
    regular-file-duplicate-fd-recreate)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-pipe-read-target"
      target_detail="remote arm64 pipe read bundle with target regular-file duplicate fd proof captured from $ARM64_SSH"
      ;;
    target-auxv-at-random)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-ppoll-timeout-target"
      target_detail="remote arm64 process-context bundle with target-owned AT_RANDOM proof captured from $ARM64_SSH"
      ;;
    private-anonymous-data-range-recreate)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-pipe-read-target"
      target_detail="remote arm64 pipe read bundle with target private anonymous data range proof captured from $ARM64_SSH"
      ;;
    signal-mask-blocked-recreate)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-pipe-read-target"
      target_detail="remote arm64 pipe read bundle with target blocked signal-mask proof captured from $ARM64_SSH"
      ;;
    timerfd-descriptor-recreate)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-pipe-read-target"
      target_detail="remote arm64 pipe read bundle with target timerfd descriptor proof captured from $ARM64_SSH"
      ;;
    pipe-pair-recreate)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-pipe-read-target"
      target_detail="remote arm64 pipe read bundle with target pipe pair descriptor proof captured from $ARM64_SSH"
      ;;
    epoll-recreate)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-pipe-read-target"
      target_detail="remote arm64 pipe read bundle with target epoll reconstruction proof captured from $ARM64_SSH"
      ;;
    signalfd-recreate)
      target_binary="$ARM64_REMOTE_WORK/bin/machinen-native-pipe-read-target"
      target_detail="remote arm64 pipe read bundle with target signalfd descriptor proof captured from $ARM64_SSH"
      ;;
    *)
      finish_failure "unsupported PORTABLE_MACHINE_REMOTE_SOURCE_TARGET=$REMOTE_SOURCE_TARGET"
      ;;
  esac
  local capture_command="'$ARM64_REMOTE_WORK/bin/machinen-native-process-capture' --output '$ARM64_REMOTE_WORK/capture/bundle' --target-arch amd64 --settle-ms 150 -- '$target_binary'"
  if [[ "$REMOTE_SOURCE_TARGET" == "process-context" || "$REMOTE_SOURCE_TARGET" == "target-auxv-at-random" ]]; then
    capture_command="cd / && env -i MACHINEN_CONTEXT_TOKEN=process-context '$ARM64_REMOTE_WORK/bin/machinen-native-process-capture' --output '$ARM64_REMOTE_WORK/capture/bundle' --target-arch amd64 --settle-ms 150 -- '$target_binary' --machinen-argv-token"
  elif [[ "$REMOTE_SOURCE_TARGET" == "file-read" ]]; then
    capture_command="'$ARM64_REMOTE_WORK/bin/machinen-native-process-capture' --output '$ARM64_REMOTE_WORK/capture/bundle' --target-arch amd64 --trace-syscall read --trace-syscall-fd 38 -- '$target_binary'"
  elif [[ "$REMOTE_SOURCE_TARGET" == "file-pread" ]]; then
    capture_command="'$ARM64_REMOTE_WORK/bin/machinen-native-process-capture' --output '$ARM64_REMOTE_WORK/capture/bundle' --target-arch amd64 --trace-syscall pread64 --trace-syscall-fd 40 -- '$target_binary'"
  elif [[ "$REMOTE_SOURCE_TARGET" == "file-readv" ]]; then
    capture_command="'$ARM64_REMOTE_WORK/bin/machinen-native-process-capture' --output '$ARM64_REMOTE_WORK/capture/bundle' --target-arch amd64 --trace-syscall readv --trace-syscall-fd 42 -- '$target_binary'"
  elif [[ "$REMOTE_SOURCE_TARGET" == "file-write" ]]; then
    capture_command="'$ARM64_REMOTE_WORK/bin/machinen-native-process-capture' --output '$ARM64_REMOTE_WORK/capture/bundle' --target-arch amd64 --trace-syscall write --trace-syscall-fd 39 -- '$target_binary'"
  elif [[ "$REMOTE_SOURCE_TARGET" == "file-pwrite" ]]; then
    capture_command="'$ARM64_REMOTE_WORK/bin/machinen-native-process-capture' --output '$ARM64_REMOTE_WORK/capture/bundle' --target-arch amd64 --trace-syscall pwrite64 --trace-syscall-fd 41 -- '$target_binary'"
  elif [[ "$REMOTE_SOURCE_TARGET" == "file-writev" ]]; then
    capture_command="'$ARM64_REMOTE_WORK/bin/machinen-native-process-capture' --output '$ARM64_REMOTE_WORK/capture/bundle' --target-arch amd64 --trace-syscall writev --trace-syscall-fd 43 -- '$target_binary'"
  elif [[ "$REMOTE_SOURCE_TARGET" == "real-private-multi-range-file-recreate" ]]; then
    capture_command="'$ARM64_REMOTE_WORK/bin/machinen-native-process-capture' --output '$ARM64_REMOTE_WORK/capture/bundle' --target-arch amd64 --trace-syscall read --trace-syscall-fd 38 -- '$target_binary'"
  elif [[ "$REMOTE_SOURCE_TARGET" == "real-tcp-listener-recreate" || "$REMOTE_SOURCE_TARGET" == "real-tcp-listener-readiness-recreate" || "$REMOTE_SOURCE_TARGET" == "real-tcp-active-connection-transport-recreate" ]]; then
    capture_command="'$ARM64_REMOTE_WORK/bin/machinen-native-process-capture' --output '$ARM64_REMOTE_WORK/capture/bundle' --target-arch amd64 --trace-syscall read --trace-syscall-fd 38 -- '$target_binary'"
  fi
  ssh "$ARM64_SSH" \
    "cd '$ARM64_REMOTE_WORK/repo' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-process-capture.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-process-capture' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-eventfd-read-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-eventfd-read-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-file-read-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-file-read-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-file-readv-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-file-readv-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-file-pread-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-file-pread-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-file-pwrite-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-file-pwrite-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-file-write-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-file-write-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-file-writev-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-file-writev-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-private-multi-range-file-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-private-multi-range-file-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-tcp-listener-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-tcp-listener-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-tcp-active-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-tcp-active-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-pipe-read-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-pipe-read-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-ppoll-timeout-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-ppoll-timeout-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror packages/microvm/assets/native-timerfd-read-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-timerfd-read-target' && cc -std=c11 -O0 -g -Wall -Wextra -Werror -pthread packages/microvm/assets/native-two-thread-ppoll-target.c -o '$ARM64_REMOTE_WORK/bin/machinen-native-two-thread-ppoll-target' && $capture_command > '$ARM64_REMOTE_WORK/capture.log'"
  mkdir -p "$NATIVE_BUNDLE"
  ssh "$ARM64_SSH" "cat '$ARM64_REMOTE_WORK/capture.log'" >"$WORK/arm64-capture.log"
  ssh "$ARM64_SSH" "tar -czf - -C '$ARM64_REMOTE_WORK/capture/bundle' ." | \
    tar -xzf - -C "$NATIVE_BUNDLE"
  record_timing "capture" "ok" "$start" "$target_detail"
}

capture_native_process_bundle() {
  local start=$1
  if [[ $REMOTE_E2E -eq 1 && $DRY_RUN -eq 0 ]]; then
    capture_remote_native_process_bundle "$start"
  else
    write_native_process_bundle "$start"
  fi
}

create_portable_bundle() {
  local start=$1
  pnpm --silent portable-machine-snapshot -- --native-process-bundle "$NATIVE_BUNDLE" --out-dir "$PORTABLE_BUNDLE" --json >"$WORK/portable-machine-snapshot.json"
  mkdir -p "$TARGET_DIR"
  # Placeholder target bytes. The restore proof replaces these with a
  # generated amd64 verifier when --combined-descriptor is used.
  printf '\270\074\000\000\000\061\377\017\005' >"$TARGET_CODE"
  record_timing "bundle" "ok" "$start" "portable bundle validated and target byte slot staged"
}

transfer_bundle() {
  local start=$1
  if [[ $REMOTE_E2E -eq 1 && $DRY_RUN -eq 0 ]]; then
    ssh "$AMD64_SSH" "rm -rf '$AMD64_REMOTE_WORK' && mkdir -p '$REMOTE_PORTABLE_BUNDLE'"
    tar -czf - -C "$PORTABLE_BUNDLE" . | \
      ssh "$AMD64_SSH" "tar -xzf - -C '$REMOTE_PORTABLE_BUNDLE'"
    record_timing "transfer" "ok" "$start" "portable bundle copied to $AMD64_SSH:$REMOTE_PORTABLE_BUNDLE"
  else
    record_timing "transfer" "ok" "$start" "bundle local to target VM runner"
  fi
}

run_target_restore() {
  local start=$1
  if [[ $DRY_RUN -eq 1 ]]; then
    record_timing "target-boot-restore" "skipped" "$start" "dry run"
    return 20
  fi
  local process_context_restore_args=()
  local process_context_restore_args_text=""
  local resource_model_args=()
  local resource_model_args_text=""
  if [[ "$REMOTE_SOURCE_TARGET" == "process-context" || "$REMOTE_SOURCE_TARGET" == "target-auxv-at-random" ]]; then
    process_context_restore_args=(--process-context-restore apply-target-initial-stack)
    process_context_restore_args_text="${process_context_restore_args[*]}"
  fi
  if [[ "$REMOTE_SOURCE_TARGET" == "eventfd-counter-recreate" ]]; then
    resource_model_args=(--include-eventfd-counter-proof)
    resource_model_args_text="${resource_model_args[*]}"
  elif [[ "$REMOTE_SOURCE_TARGET" == "eventfd-readiness-pollin-recreate" ]]; then
    resource_model_args=(--include-readiness-eventfd-poll-proof)
    resource_model_args_text="${resource_model_args[*]}"
  elif [[ "$REMOTE_SOURCE_TARGET" == "regular-file-duplicate-fd-recreate" ]]; then
    resource_model_args=(--include-regular-file-duplicate-fd-proof)
    resource_model_args_text="${resource_model_args[*]}"
  elif [[ "$REMOTE_SOURCE_TARGET" == "target-auxv-at-random" ]]; then
    resource_model_args=(--include-target-auxv-at-random-proof)
    resource_model_args_text="${resource_model_args[*]}"
  elif [[ "$REMOTE_SOURCE_TARGET" == "private-anonymous-data-range-recreate" || "$REMOTE_SOURCE_TARGET" == "real-private-multi-range-file-recreate" ]]; then
    resource_model_args=(--include-private-layout-proof)
    resource_model_args_text="${resource_model_args[*]}"
  elif [[ "$REMOTE_SOURCE_TARGET" == "signal-mask-blocked-recreate" ]]; then
    resource_model_args=(--include-signal-mask-blocked-proof)
    resource_model_args_text="${resource_model_args[*]}"
  elif [[ "$REMOTE_SOURCE_TARGET" == "timerfd-descriptor-recreate" ]]; then
    resource_model_args=(--include-timerfd-descriptor-proof)
    resource_model_args_text="${resource_model_args[*]}"
  elif [[ "$REMOTE_SOURCE_TARGET" == "pipe-pair-recreate" ]]; then
    resource_model_args=(--include-pipe-pair-proof)
    resource_model_args_text="${resource_model_args[*]}"
  elif [[ "$REMOTE_SOURCE_TARGET" == "epoll-recreate" ]]; then
    resource_model_args=(--include-epoll-proof)
    resource_model_args_text="${resource_model_args[*]}"
  elif [[ "$REMOTE_SOURCE_TARGET" == "signalfd-recreate" ]]; then
    resource_model_args=(--include-signalfd-proof)
    resource_model_args_text="${resource_model_args[*]}"
  elif [[ "$REMOTE_SOURCE_TARGET" == "real-tcp-listener-recreate" ]]; then
    resource_model_args=(--include-tcp-listener-proof)
    resource_model_args_text="${resource_model_args[*]}"
  elif [[ "$REMOTE_SOURCE_TARGET" == "real-tcp-listener-readiness-recreate" ]]; then
    resource_model_args=(--include-tcp-listener-readiness-proof)
    resource_model_args_text="${resource_model_args[*]}"
  elif [[ "$REMOTE_SOURCE_TARGET" == "real-tcp-active-connection-transport-recreate" ]]; then
    resource_model_args=(--include-tcp-active-broker-proof)
    resource_model_args_text="${resource_model_args[*]}"
  fi
  if [[ $REMOTE_E2E -eq 1 ]]; then
    local remote_path_assignment="PATH=\$PATH"
    if [[ -n "$AMD64_PATH_PREFIX" ]]; then
      remote_path_assignment="PATH='$AMD64_PATH_PREFIX':\$PATH"
    fi
    if ! ssh "$AMD64_SSH" \
      "cd '$AMD64_REPO' && $remote_path_assignment MACHINEN_VMM='$AMD64_VMM' MACHINEN_KERNEL='$AMD64_KERNEL' MACHINEN_ASSETS_DIR='$AMD64_ASSETS_DIR' '$AMD64_PNPM' --silent portable-machine-vm-restore-proof -- --bundle-dir '$REMOTE_PORTABLE_BUNDLE' --target-code-file '$REMOTE_TARGET_CODE' --image '$TARGET_IMAGE' --combined-descriptor --real-utility-continuation $process_context_restore_args_text $resource_model_args_text --json" \
      >"$TARGET_LOG" 2>"$WORK/target-restore.stderr"; then
      record_timing "target-boot-restore" "failed" "$start" "remote runner failed"
      return 21
    fi
  elif ! pnpm --silent portable-machine-vm-restore-proof -- \
    --bundle-dir "$PORTABLE_BUNDLE" \
    --target-code-file "$TARGET_CODE" \
    --image "$TARGET_IMAGE" \
    --combined-descriptor \
    --real-utility-continuation \
    "${process_context_restore_args[@]}" \
    "${resource_model_args[@]}" \
    --json >"$TARGET_LOG" 2>"$WORK/target-restore.stderr"; then
    record_timing "target-boot-restore" "failed" "$start" "runner failed"
    return 21
  fi
  if node --input-type=module - "$TARGET_LOG" "$REMOTE_E2E" "$REMOTE_SOURCE_TARGET" <<'NODE'
import { readFileSync } from 'node:fs';
const result = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const remoteE2e = process.argv[3] === '1';
const sourceTarget = process.argv[4];
process.exit(
  result.state === 'completed' &&
  result.migrationCompleted === true &&
  result.descriptorGateCompleted === true &&
  result.targetVerifierResult === 'passed' &&
  result.targetStateConsumptionResult === 'passed' &&
  Array.isArray(result.targetResourceStatuses) &&
  result.targetResourceStatuses.every((entry) => entry?.status === 'passed') &&
  result.targetReturnChainResult === 'passed' &&
  result.targetFrameRestoreResult === 'passed' &&
  result.targetRegisterRestoreResult === 'passed' &&
  result.targetRflagsRestoreResult === 'passed' &&
  result.targetTlsRestoreResult === 'passed' &&
  result.targetStackWindowMaterializationResult === 'passed' &&
  result.targetPrivateMemoryRestoreResult === 'passed' &&
  result.targetExecutableMappingResult === 'passed' &&
  ((sourceTarget !== 'process-context' && sourceTarget !== 'target-auxv-at-random') || result.targetProcessContextRestoreResult === 'passed') &&
  result.targetSignalRestoreResult === 'passed' &&
  (!remoteE2e || sourceTarget === 'process-context' || sourceTarget === 'target-auxv-at-random' || result.targetActiveSyscallRestoreResult === 'passed') &&
  (!remoteE2e || sourceTarget !== 'two-thread-ppoll' || result.targetThreadRestoreResult === 'passed') &&
  result.targetResumePathResult === 'passed'
    ? 0
    : 1,
);
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

start=$(now_ms); capture_native_process_bundle "$start"
start=$(now_ms); create_portable_bundle "$start"
start=$(now_ms); transfer_bundle "$start"
start=$(now_ms)
if [[ $DRY_RUN -eq 1 ]]; then
  record_timing "target-boot-restore" "skipped" "$start" "dry run"
  finish_skip "dry run"
fi
target_rc=0
run_target_restore "$start" || target_rc=$?
if [[ $target_rc -ne 0 ]]; then
  finish_failure "target restore failed with code $target_rc"
fi
start=$(now_ms); completion_phase "$start"
finish_success
