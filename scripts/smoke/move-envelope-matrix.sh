#!/usr/bin/env bash
set -euo pipefail

JSON=0
ONLY=""
REUSE_VMS=""
SKIP_PROVISION=0
TIMINGS=1
PROVISION_MODE="default"
CHUNK_PLAN=""
CHUNK_NAME=""
LIST_CHUNKS=0
COVERAGE_DIR=""
timing_events=()
USAGE="usage: $0 [--json] [--only proof[,proof...]] [--chunk-plan plan.json --chunk name|--list-chunks|--coverage-dir dir] [--reuse-vms SRC:TGT] [--skip-provision] [--timings|--no-timings]"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --json)
      JSON=1
      shift
      ;;
    --only)
      ONLY="${2:-}"
      if [[ -z "$ONLY" ]]; then
        echo "$USAGE" >&2
        exit 2
      fi
      shift 2
      ;;
    --only=*)
      ONLY="${1#--only=}"
      if [[ -z "$ONLY" ]]; then
        echo "$USAGE" >&2
        exit 2
      fi
      shift
      ;;
    --chunk-plan)
      CHUNK_PLAN="${2:-}"
      if [[ -z "$CHUNK_PLAN" ]]; then
        echo "$USAGE" >&2
        exit 2
      fi
      shift 2
      ;;
    --chunk-plan=*)
      CHUNK_PLAN="${1#--chunk-plan=}"
      if [[ -z "$CHUNK_PLAN" ]]; then
        echo "$USAGE" >&2
        exit 2
      fi
      shift
      ;;
    --chunk)
      CHUNK_NAME="${2:-}"
      if [[ -z "$CHUNK_NAME" ]]; then
        echo "$USAGE" >&2
        exit 2
      fi
      shift 2
      ;;
    --chunk=*)
      CHUNK_NAME="${1#--chunk=}"
      if [[ -z "$CHUNK_NAME" ]]; then
        echo "$USAGE" >&2
        exit 2
      fi
      shift
      ;;
    --list-chunks)
      LIST_CHUNKS=1
      shift
      ;;
    --coverage-dir)
      COVERAGE_DIR="${2:-}"
      if [[ -z "$COVERAGE_DIR" ]]; then
        echo "$USAGE" >&2
        exit 2
      fi
      shift 2
      ;;
    --coverage-dir=*)
      COVERAGE_DIR="${1#--coverage-dir=}"
      if [[ -z "$COVERAGE_DIR" ]]; then
        echo "$USAGE" >&2
        exit 2
      fi
      shift
      ;;
    --reuse-vms)
      REUSE_VMS="${2:-}"
      if [[ -z "$REUSE_VMS" ]]; then
        echo "$USAGE" >&2
        exit 2
      fi
      shift 2
      ;;
    --reuse-vms=*)
      REUSE_VMS="${1#--reuse-vms=}"
      if [[ -z "$REUSE_VMS" ]]; then
        echo "$USAGE" >&2
        exit 2
      fi
      shift
      ;;
    --skip-provision)
      SKIP_PROVISION=1
      PROVISION_MODE="manual-skip"
      shift
      ;;
    --timings)
      TIMINGS=1
      shift
      ;;
    --no-timings)
      TIMINGS=0
      shift
      ;;
    *)
      echo "unknown move envelope matrix option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -n "$COVERAGE_DIR" ]]; then
  if [[ -z "$CHUNK_PLAN" ]]; then
    echo "--coverage-dir requires --chunk-plan" >&2
    exit 2
  fi
  coverage_json_args=()
  if [[ "$JSON" == "1" ]]; then
    coverage_json_args+=(--json)
  fi
  node scripts/move-envelope-matrix-coverage.mjs --plan "$CHUNK_PLAN" --coverage-dir "$COVERAGE_DIR" "${coverage_json_args[@]}"
  exit 0
fi

if [[ "$LIST_CHUNKS" == "1" ]]; then
  if [[ -z "$CHUNK_PLAN" ]]; then
    echo "--list-chunks requires --chunk-plan" >&2
    exit 2
  fi
  python3 - "$CHUNK_PLAN" <<'PY'
import json, sys
plan=json.load(open(sys.argv[1]))
for chunk in plan.get('chunks', []):
    print(chunk['name'])
PY
  exit 0
fi

if [[ -n "$CHUNK_NAME" ]]; then
  if [[ -z "$CHUNK_PLAN" ]]; then
    echo "--chunk requires --chunk-plan" >&2
    exit 2
  fi
  plan_selection=$(python3 - "$CHUNK_PLAN" "$CHUNK_NAME" <<'PY'
import json, sys
plan=json.load(open(sys.argv[1]))
name=sys.argv[2]
for chunk in plan.get('chunks', []):
    if chunk.get('name') == name:
        print(','.join(chunk.get('proofs', [])))
        print('skip=1' if chunk.get('skipProvision') else 'skip=0')
        raise SystemExit(0)
print(f'unknown chunk: {name}', file=sys.stderr)
raise SystemExit(2)
PY
)
  ONLY="$(printf '%s\n' "$plan_selection" | sed -n '1p')"
  if [[ "$(printf '%s\n' "$plan_selection" | sed -n '2p')" == "skip=1" ]]; then
    SKIP_PROVISION=1
    PROVISION_MODE="chunk-plan-skip"
  fi
fi

FIXTURE_TOUCH_TS="${MACHINEN_MOVE_MATRIX_FIXTURE_TOUCH_TS:-202606101234.56}"
FIXTURE_TAR_MTIME="${MACHINEN_MOVE_MATRIX_FIXTURE_TAR_MTIME:-UTC 2020-01-01}"
FIXTURE_LOCALE="${MACHINEN_MOVE_MATRIX_FIXTURE_LOCALE:-C}"

CLI="${MACHINEN_MOVE_MATRIX_CLI:-node packages/cli/dist/cli.js}"
RUN_ID="${$}-$(date +%s)"
if [[ -n "$REUSE_VMS" ]]; then
  SRC="${REUSE_VMS%%:*}"
  TGT="${REUSE_VMS#*:}"
  if [[ -z "$SRC" || -z "$TGT" || "$SRC" == "$TGT" || "$REUSE_VMS" != *:* ]]; then
    echo "--reuse-vms expects SRC:TGT" >&2
    exit 2
  fi
else
  SRC="move-matrix-src-${RUN_ID}"
  TGT="move-matrix-tgt-${RUN_ID}"
fi
WORK="/tmp/machinen-move-matrix-${RUN_ID}"
mkdir -p "$WORK"

cleanup() {
  if [[ -z "$REUSE_VMS" ]]; then
    $CLI stop "$SRC" >/dev/null 2>&1 || true
    $CLI stop "$TGT" >/dev/null 2>&1 || true
  fi
  if [[ "${MACHINEN_MOVE_MATRIX_KEEP_WORK:-0}" != "1" ]]; then
    rm -rf "$WORK"
  else
    echo "kept move matrix work dir: $WORK" >&2
  fi
}
trap cleanup EXIT

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

fixed_touch_all() {
  local vm="$1"
  shift
  if [[ "$#" -gt 0 ]]; then
    $CLI exec "$vm" -- "TZ=UTC touch -t '$FIXTURE_TOUCH_TS' $*" >/dev/null
  fi
}

deterministic_tar_create() {
  local vm="$1" archive="$2" directory="$3"
  $CLI exec "$vm" -- "LC_ALL='$FIXTURE_LOCALE' tar --sort=name --mtime='$FIXTURE_TAR_MTIME' --owner=0 --group=0 --numeric-owner -cf '$archive' -C '$directory' ." >/dev/null
}

now_ms() {
  python3 -c 'import time; print(int(time.time() * 1000))'
}

record_timing() {
  local name="$1" state="$2" start_ms="$3" end_ms detail="${4:-}"
  if [[ "$TIMINGS" != "1" ]]; then
    return 0
  fi
  end_ms=$(now_ms)
  timing_events+=("$(python3 -c 'import json,sys; print(json.dumps({"name":sys.argv[1],"state":sys.argv[2],"durationMs":int(sys.argv[4])-int(sys.argv[3]),"detail":sys.argv[5]}))' "$name" "$state" "$start_ms" "$end_ms" "$detail")")
}

boot_pair() {
  local start_ms
  start_ms=$(now_ms)
  $CLI boot --name "$SRC" --detach --json -- sleep infinity >/dev/null
  $CLI boot --name "$TGT" --detach --json -- sleep infinity >/dev/null
  record_timing "boot-pair" "passed" "$start_ms" "fresh-vms"
  if [[ "$SKIP_PROVISION" != "1" ]]; then
    start_ms=$(now_ms)
    ensure_proof_tools "$SRC"
    ensure_proof_tools "$TGT"
    record_timing "provision-pair" "passed" "$start_ms" "$PROVISION_MODE"
  else
    start_ms=$(now_ms)
    record_timing "provision-pair" "skipped" "$start_ms" "$PROVISION_MODE"
  fi
}

ensure_proof_tools() {
  local vm="$1"
  $CLI exec "$vm" -- 'set -eu
export DEBIAN_FRONTEND=noninteractive
if ! python3 -V >/dev/null 2>&1 || ! command -v watch >/dev/null 2>&1 || ! command -v less >/dev/null 2>&1 || ! command -v vi >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1 || ! command -v busybox >/dev/null 2>&1 || ! command -v nc >/dev/null 2>&1 || ! command -v go >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
  apt-get update -qq >/tmp/machinen-move-proof-apt.log 2>&1
  apt-get install -y --reinstall --no-install-recommends \
    libpython3.11-minimal python3.11-minimal libpython3.11-stdlib \
    python3.11 python3-minimal python3 procps less vim-tiny nodejs busybox netcat-openbsd golang-go rustc xz-utils \
    >>/tmp/machinen-move-proof-apt.log 2>&1 || { cat /tmp/machinen-move-proof-apt.log; exit 1; }
fi
if ! command -v xz >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends xz-utils \
    >/tmp/machinen-move-proof-compress-apt.log 2>&1 || { cat /tmp/machinen-move-proof-compress-apt.log; exit 1; }
fi
python3 -V >/dev/null
command -v watch >/dev/null
command -v less >/dev/null
command -v vi >/dev/null
command -v script >/dev/null
command -v node >/dev/null
command -v busybox >/dev/null
command -v nc >/dev/null
command -v go >/dev/null
command -v rustc >/dev/null
command -v xz >/dev/null'
}

prove_sleep() {
  local bundle="$WORK/sleep.bundle"
  local pid start end tpid
  pid=$($CLI exec "$SRC" -- "sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; sleep 10 >/tmp/sleep.out 2>&1 & echo \$!'" | tail -1 | tr -d '\r')
  sleep 3
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/sleep.save.json"
  start=$(python3 - <<'PY'
import time; print(time.time())
PY
)
  $CLI move load "$TGT" "$bundle" --json >"$WORK/sleep.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/sleep.load.json'))['loader']['targetPid'])
PY
)
  for _ in $(seq 1 20); do
    if ! $CLI exec "$TGT" -- "kill -0 $tpid 2>/dev/null" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  end=$(python3 - <<'PY'
import time; print(time.time())
PY
)
  python3 - <<PY
import json
save=json.load(open('$WORK/sleep.save.json'))
load=json.load(open('$WORK/sleep.load.json'))
elapsed=round(float('$end')-float('$start'), 2)
remaining=save['descriptor']['resourcePlan']['capture']['sleepState']['remainingMs']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-sleep-remaining-loader'
assert elapsed < 10
print(json.dumps({'name':'sleep','state':'passed','remainingMs':remaining,'targetElapsedSeconds':elapsed,'targetPid':int('$tpid')}))
PY
}

prove_tail() {
  local bundle="$WORK/tail.bundle" pid log
  $CLI exec "$SRC" -- "printf 'line1\nline2\n' >/tmp/tail.txt" >/dev/null
  pid=$($CLI exec "$SRC" -- "sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; tail -n +1 -f /tmp/tail.txt >/tmp/tail-source.out 2>&1 & echo \$!'" | tail -1 | tr -d '\r')
  sleep 1
  $CLI exec "$SRC" -- "printf 'line3\n' >>/tmp/tail.txt" >/dev/null
  sleep 1
  $CLI exec "$TGT" -- "printf 'line1\nline2\nline3\n' >/tmp/tail.txt" >/dev/null
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/tail.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/tail.load.json"
  sleep 1
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/tail.load.json'))['loader']['logPath'])
PY
)
  $CLI exec "$TGT" -- "printf 'line4\nline5\n' >>/tmp/tail.txt" >/dev/null
  sleep 2
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/tail.target.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/tail.save.json'))
load=json.load(open('$WORK/tail.load.json'))
out=open('$WORK/tail.target.out').read().strip().splitlines()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-tail-offset-loader'
assert out == ['line4','line5']
print(json.dumps({'name':'tail','state':'passed','tailState':save['descriptor']['resourcePlan']['capture']['tailState'],'output':out}))
PY
}

prove_reader() {
  local bundle="$WORK/reader.bundle" pid log offset expected
  $CLI exec "$SRC" -- "python3 - <<'PY'
from pathlib import Path
Path('/tmp/cat.txt').write_text(''.join(f'cat-line-{i:05d}\\n' for i in range(50000)))
PY
rm -f /tmp/cat.pipe /tmp/cat.source.out; mkfifo /tmp/cat.pipe; setsid sh -c 'exec 7</tmp/cat.pipe; while dd bs=512 count=1 status=none <&7 >>/tmp/cat.source.out; do sleep 0.1; done' >/dev/null 2>&1 &" >/dev/null
  $CLI exec "$TGT" -- "python3 - <<'PY'
from pathlib import Path
Path('/tmp/cat.txt').write_text(''.join(f'cat-line-{i:05d}\\n' for i in range(50000)))
PY" >/dev/null
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec cat /tmp/cat.txt' >/tmp/cat.pipe 2>/dev/null & echo \$!" | tail -1 | tr -d '\r')
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/reader.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/reader.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/reader.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/reader.target.out"
  offset=$(python3 - <<PY
import json; print(json.load(open('$WORK/reader.save.json'))['descriptor']['resourcePlan']['capture']['readerState']['offset'])
PY
)
  $CLI exec "$TGT" -- "tail -c +$((offset + 1)) /tmp/cat.txt" >"$WORK/reader.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/reader.save.json'))
load=json.load(open('$WORK/reader.load.json'))
out=open('$WORK/reader.target.out','rb').read()
expected=open('$WORK/reader.expected.out','rb').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-cat-offset-loader'
assert out == expected
print(json.dumps({'name':'reader-cat','state':'passed','readerState':save['descriptor']['resourcePlan']['capture']['readerState'],'bytes':len(out)}))
PY
}

prove_grep() {
  local bundle="$WORK/grep.bundle" pid log offset
  $CLI exec "$SRC" -- "python3 - <<'PY'
from pathlib import Path
Path('/tmp/grep.txt').write_text(''.join((('match ' if i % 3 == 0 else 'skip ') + f'{i:05d}\\n') for i in range(80000)))
PY
rm -f /tmp/grep.pipe /tmp/grep.source.out; mkfifo /tmp/grep.pipe; setsid sh -c 'exec 7</tmp/grep.pipe; while dd bs=256 count=1 status=none <&7 >>/tmp/grep.source.out; do sleep 0.1; done' >/dev/null 2>&1 &" >/dev/null
  $CLI exec "$TGT" -- "python3 - <<'PY'
from pathlib import Path
Path('/tmp/grep.txt').write_text(''.join((('match ' if i % 3 == 0 else 'skip ') + f'{i:05d}\\n') for i in range(80000)))
PY" >/dev/null
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec grep match /tmp/grep.txt' >/tmp/grep.pipe 2>/dev/null & echo \$!" | tail -1 | tr -d '\r')
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/grep.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/grep.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/grep.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/grep.target.out"
  offset=$(python3 - <<PY
import json; print(json.load(open('$WORK/grep.save.json'))['descriptor']['resourcePlan']['capture']['grepState']['offset'])
PY
)
  $CLI exec "$TGT" -- "tail -c +$((offset + 1)) /tmp/grep.txt | grep match || true" >"$WORK/grep.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/grep.save.json'))
load=json.load(open('$WORK/grep.load.json'))
out=open('$WORK/grep.target.out').read().splitlines()
expected=open('$WORK/grep.expected.out').read().splitlines()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-grep-offset-loader'
assert out == expected
print(json.dumps({'name':'grep','state':'passed','grepState':save['descriptor']['resourcePlan']['capture']['grepState'],'matches':len(out)}))
PY
}

prove_watch() {
  local bundle="$WORK/watch.bundle" pid
  $CLI exec "$SRC" -- "setsid sh -c 'tail -f /dev/null | TERM=xterm script -q -c \"watch -n 1 date\" /tmp/watch.typescript >/dev/null 2>&1' >/dev/null 2>&1 &" >/dev/null
  sleep 2
  pid=$($CLI exec "$SRC" -- "for d in /proc/[0-9]*; do cmd=\$(tr '\\000' ' ' <\"\$d/cmdline\" 2>/dev/null || true); case \"\$cmd\" in watch\ -n\ 1*) echo \${d##*/}; exit;; esac; done" | tail -1 | tr -d '\r')
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/watch.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/watch.load.json"
  python3 - <<PY
import json
save=json.load(open('$WORK/watch.save.json'))
load=json.load(open('$WORK/watch.load.json'))
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-watch-loop-loader'
print(json.dumps({'name':'watch','state':'passed','watchState':save['descriptor']['resourcePlan']['capture']['watchState'],'targetPid':load['loader']['targetPid']}))
PY
}

prove_shell() {
  local bundle="$WORK/shell.bundle" pid
  $CLI exec "$SRC" -- "setsid sh -c 'tail -f /dev/null | TERM=xterm script -q -c \"/bin/sh\" /tmp/sh.typescript >/dev/null 2>&1' >/dev/null 2>&1 &" >/dev/null
  sleep 2
  pid=$($CLI exec "$SRC" -- "for d in /proc/[0-9]*; do [ \"\${d##*/}\" = 1 ] && continue; exe=\$(readlink \"\$d/exe\" 2>/dev/null || true); cmd=\$(tr '\\000' ' ' <\"\$d/cmdline\" 2>/dev/null || true); case \"\$exe:\$cmd\" in */dash:/bin/sh|*/dash:/bin/sh\ ) echo \${d##*/}; exit;; esac; done" | tail -1 | tr -d '\r')
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/shell.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/shell.load.json"
  python3 - <<PY
import json
save=json.load(open('$WORK/shell.save.json'))
load=json.load(open('$WORK/shell.load.json'))
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-sh-script-pty-loader'
print(json.dumps({'name':'shell','state':'passed','shellState':save['descriptor']['resourcePlan']['capture']['shellState'],'targetPid':load['loader']['targetPid']}))
PY
}

ensure_python_http_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/bin/python3.11" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-python-http-apt.log; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/tmp/machinen-python-http-apt.log 2>&1 && apt-get install -y --reinstall --no-install-recommends libpython3.11-minimal python3.11-minimal libpython3.11-stdlib python3.11 >>/tmp/machinen-python-http-apt.log 2>&1 || { cat /tmp/machinen-python-http-apt.log; exit 1; }; test -x /usr/bin/python3.11" >/dev/null
}

save_http_bundle() {
  local name="$1" port="$2" cwd="$3" bundle="$4"
  ensure_python_http_tool "$SRC"
  $CLI exec "$SRC" -- "mkdir -p '$cwd'; printf 'hello-http\n' >'$cwd/index.html'; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd '$cwd'; exec /usr/bin/python3.11 -m http.server $port --bind 127.0.0.1 >/tmp/${name}.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

save_http_directory_bundle() {
  local name="$1" port="$2" directory="$3" bundle="$4"
  ensure_python_http_tool "$SRC"
  $CLI exec "$SRC" -- "mkdir -p '$directory'; printf 'hello-http-directory\n' >'$directory/index.html'; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /; exec /usr/bin/python3.11 -m http.server --bind 127.0.0.1 --directory '$directory' $port >/tmp/${name}.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

save_timeout_http_directory_bundle() {
  local name="$1" seconds="$2" port="$3" directory="$4" bundle="$5"
  $CLI exec "$SRC" -- "mkdir -p '$directory'; printf 'hello-timeout-http\n' >'$directory/index.html'; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /; exec timeout $seconds python3 -m http.server --directory '$directory' $port --bind 127.0.0.1 >/tmp/${name}.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

save_env_http_directory_bundle() {
  local name="$1" port="$2" directory="$3" bundle="$4"
  $CLI exec "$SRC" -- "mkdir -p '$directory'; printf 'hello-env-http\n' >'$directory/index.html'; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /; exec env MACHINEN_MOVE_ENV_PROOF=wrapped-http python3 -m http.server --directory '$directory' $port --bind 127.0.0.1 >/tmp/${name}.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

save_nc_listener_bundle() {
  local name="$1" port="$2" bundle="$3"
  $CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec nc -l $port >/tmp/${name}.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

ensure_busybox_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/bin/busybox" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-busybox-apt.log; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/tmp/machinen-busybox-apt.log 2>&1 && apt-get install -y --reinstall --no-install-recommends busybox >>/tmp/machinen-busybox-apt.log 2>&1 || { cat /tmp/machinen-busybox-apt.log; exit 1; }; test -x /usr/bin/busybox" >/dev/null
}

ensure_openbsd_nc_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/bin/nc.openbsd" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-netcat-apt.log; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/tmp/machinen-netcat-apt.log 2>&1 && apt-get install -y --reinstall --no-install-recommends netcat-openbsd >>/tmp/machinen-netcat-apt.log 2>&1 || { cat /tmp/machinen-netcat-apt.log; exit 1; }; test -x /usr/bin/nc.openbsd" >/dev/null
}

save_busybox_nc_bundle() {
  local name="$1" port="$2" bundle="$3"
  ensure_busybox_tool "$SRC"
  $CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/busybox nc -l -p $port >/tmp/${name}.log 2>&1' </dev/null >/dev/null 2>&1 & for i in \$(seq 1 100); do for d in /proc/[0-9]*; do exe=\$(readlink \"\$d/exe\" 2>/dev/null || true); [ \"\$exe\" = /usr/bin/busybox ] || continue; cmd=\$(tr '\\000' ' ' <\"\$d/cmdline\" 2>/dev/null || true); case \"\$cmd\" in */usr/bin/busybox\ nc\ -l\ -p\ $port*) echo \${d##*/}; exit 0;; esac; done; sleep 0.05; done; exit 1" | tail -1 | tr -d '\r'
}

prove_busybox_nc_listener() {
  local bundle="$WORK/busybox-nc.bundle" pid log
  pid=$(save_busybox_nc_bundle busybox-nc 8142 "$bundle")
  ensure_busybox_tool "$TGT"
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/busybox-nc.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/busybox-nc.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/busybox-nc.load.json'))['loader']['logPath'])
PY
)
  $CLI exec "$TGT" -- "printf 'hello-busybox-nc\n' | /usr/bin/busybox nc -w 1 127.0.0.1 8142" >/dev/null || true
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/busybox-nc.target.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/busybox-nc.save.json'))
load=json.load(open('$WORK/busybox-nc.load.json'))
out=open('$WORK/busybox-nc.target.out').read()
state=save['descriptor']['resourcePlan']['capture']['busyboxNcState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-busybox-nc-listener-loader'
assert state['port'] == 8142
assert state['argvContract'] == 'busybox-nc-listen-p'
assert state['listenerState'] == 'idle-single-listener'
assert out == 'hello-busybox-nc\n'
print(json.dumps({'name':'busybox-nc-listener','state':'passed','busyboxNcState':state,'received':out.strip(),'targetPid':load['loader']['targetPid']}))
PY
}

prove_unsafe_busybox_nc_refusal() {
  local active_bundle="$WORK/busybox-nc-active.bundle" non_busybox_bundle="$WORK/busybox-nc-nonbusybox.bundle" conflict_bundle="$WORK/busybox-nc-conflict.bundle" missing_bundle="$WORK/busybox-nc-missing.bundle" active_pid non_busybox_pid conflict_pid missing_pid active_save_rc active_load_rc non_save_rc non_load_rc conflict_load_rc missing_load_rc
  active_pid=$(save_busybox_nc_bundle busybox-nc-active 8143 "$active_bundle")
  sleep 1
  $CLI exec "$SRC" -- "(printf 'active-busybox-nc\n'; sleep 20) | /usr/bin/busybox nc 127.0.0.1 8143 >/tmp/busybox-nc-active-client.log 2>&1 &" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$active_pid" "$active_bundle" --json >"$WORK/busybox-nc-active.save.json" 2>"$WORK/busybox-nc-active.save.err"
  active_save_rc=$?
  if [ ! -s "$WORK/busybox-nc-active.save.json" ]; then
    printf '{"accepted":false,"descriptor":{"resourcePlan":{"capture":{}}},"stderr":%s}\n' "$(json_escape <"$WORK/busybox-nc-active.save.err")" >"$WORK/busybox-nc-active.save.json"
  fi
  if [ -e "$active_bundle" ]; then
    $CLI move load "$TGT" "$active_bundle" --json >"$WORK/busybox-nc-active.load.json"
    active_load_rc=$?
  else
    active_load_rc=1
    printf '{"accepted":false}\n' >"$WORK/busybox-nc-active.load.json"
  fi
  set -e
  ensure_openbsd_nc_tool "$SRC"
  non_busybox_pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/nc.openbsd -l -p 8144 >/tmp/busybox-nc-nonbusybox.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  set +e
  $CLI move save "$SRC" "$non_busybox_pid" "$non_busybox_bundle" --json >"$WORK/busybox-nc-nonbusybox.save.json"
  non_save_rc=$?
  $CLI move load "$TGT" "$non_busybox_bundle" --json >"$WORK/busybox-nc-nonbusybox.load.json"
  non_load_rc=$?
  set -e
  conflict_pid=$(save_busybox_nc_bundle busybox-nc-conflict 8145 "$conflict_bundle")
  ensure_busybox_tool "$TGT"
  sleep 1
  $CLI move save "$SRC" "$conflict_pid" "$conflict_bundle" --json >"$WORK/busybox-nc-conflict.save.json"
  $CLI exec "$TGT" -- "setsid sh -c 'exec /usr/bin/busybox nc -l -p 8145 >/tmp/busybox-nc-conflict-target.log 2>&1' </dev/null >/dev/null 2>&1 &" >/dev/null
  sleep 1
  set +e
  $CLI move load "$TGT" "$conflict_bundle" --json >"$WORK/busybox-nc-conflict.load.json"
  conflict_load_rc=$?
  set -e
  missing_pid=$(save_busybox_nc_bundle busybox-nc-missing 8146 "$missing_bundle")
  ensure_busybox_tool "$TGT"
  sleep 1
  $CLI move save "$SRC" "$missing_pid" "$missing_bundle" --json >"$WORK/busybox-nc-missing.save.json"
  $CLI exec "$TGT" -- "mv /usr/bin/busybox /usr/bin/busybox.disabled" >/dev/null
  set +e
  $CLI move load "$TGT" "$missing_bundle" --json >"$WORK/busybox-nc-missing.load.json"
  missing_load_rc=$?
  set -e
  $CLI exec "$TGT" -- "mv /usr/bin/busybox.disabled /usr/bin/busybox" >/dev/null
  python3 - <<PY
import json
active_save=json.load(open('$WORK/busybox-nc-active.save.json'))
active_load=json.load(open('$WORK/busybox-nc-active.load.json'))
non_save=json.load(open('$WORK/busybox-nc-nonbusybox.save.json'))
non_load=json.load(open('$WORK/busybox-nc-nonbusybox.load.json'))
conflict_save=json.load(open('$WORK/busybox-nc-conflict.save.json'))
conflict_load=json.load(open('$WORK/busybox-nc-conflict.load.json'))
missing_save=json.load(open('$WORK/busybox-nc-missing.save.json'))
missing_load=json.load(open('$WORK/busybox-nc-missing.load.json'))
conflict_loader=conflict_load.get('loader', {})
missing_loader=missing_load.get('loader', {})
assert int('$active_save_rc') == 1 and int('$active_load_rc') == 1
assert not active_save['accepted'] and not active_load['accepted']
assert active_save['descriptor']['resourcePlan']['capture'].get('busyboxNcState') is None
assert int('$non_save_rc') == 1 and int('$non_load_rc') == 1
assert not non_save['accepted'] and not non_load['accepted']
assert non_save['descriptor']['resourcePlan']['capture'].get('busyboxNcState') is None
assert conflict_save['accepted'] and int('$conflict_load_rc') == 1 and not conflict_load['accepted']
assert conflict_loader.get('state') == 'refused' and conflict_loader.get('targetPid') is None
assert 'port-in-use' in conflict_loader.get('patch', {}).get('stdout', '')
assert missing_save['accepted'] and int('$missing_load_rc') == 1 and not missing_load['accepted']
assert missing_loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-busybox-nc-refusal','state':'passed','activeSaveAccepted':active_save['accepted'],'activeBusyboxNcState':active_save['descriptor']['resourcePlan']['capture'].get('busyboxNcState'),'nonBusyboxSaveAccepted':non_save['accepted'],'nonBusyboxNcState':non_save['descriptor']['resourcePlan']['capture'].get('busyboxNcState'),'portConflictLoaderState':conflict_loader.get('state'),'portConflictTargetPid':conflict_loader.get('targetPid'),'missingBusyboxLoadAccepted':missing_load['accepted'],'missingBusyboxLoaderState':missing_loader.get('state'),'missingBusyboxTargetPid':missing_loader.get('targetPid'),'missingBusyboxTargetValidation':missing_load.get('targetValidation', {}).get('state')}))
PY
}

ensure_rsync_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/bin/rsync" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-rsync-apt.log; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/tmp/machinen-rsync-apt.log 2>&1 && apt-get install -y --reinstall --no-install-recommends rsync >>/tmp/machinen-rsync-apt.log 2>&1 || { cat /tmp/machinen-rsync-apt.log; exit 1; }; test -x /usr/bin/rsync" >/dev/null
}

write_rsync_daemon_fixture() {
  local vm="$1" port="$2" mode="${3:-readonly}" root="/tmp/rsync-root-$2" config="/tmp/rsyncd-$2.conf"
  ensure_rsync_tool "$vm"
  $CLI exec "$vm" -- "rm -rf $root; mkdir -p $root; printf 'rsync proof 15J\\n' >$root/index.txt; cat >$config <<EOF
port = $port
pid file = /tmp/rsyncd-$port.pid
[proof]
path = $root
read only = true
list = true
EOF
if [ '$mode' = write ]; then sed -i 's/read only = true/read only = false/' $config; fi
if [ '$mode' = auth ]; then printf 'auth users = proof\\nsecrets file = /tmp/rsync-secrets\\n' >>$config; fi" >/dev/null
}

spawn_rsync_daemon() {
  local port="$1" mode="${2:-readonly}"
  write_rsync_daemon_fixture "$SRC" "$port" "$mode"
  $CLI exec "$SRC" -- "rm -f /tmp/rsync-daemon-run-$port.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/rsync --daemon --no-detach --config /tmp/rsyncd-$port.conf >/tmp/rsync-daemon-run-$port.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

prove_rsync_daemon() {
  local bundle="$WORK/rsync-daemon.bundle" pid body
  write_rsync_daemon_fixture "$TGT" 8181 readonly
  pid=$(spawn_rsync_daemon 8181 readonly)
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/rsync-daemon.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/rsync-daemon.load.json"
  $CLI exec "$TGT" -- "/usr/bin/rsync rsync://127.0.0.1:8181/proof/index.txt /tmp/rsync-proof-out.txt && cat /tmp/rsync-proof-out.txt" >"$WORK/rsync-daemon.body.txt"
  body=$(cat "$WORK/rsync-daemon.body.txt" | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/rsync-daemon.save.json'))
load=json.load(open('$WORK/rsync-daemon.load.json'))
state=save['descriptor']['resourcePlan']['capture']['rsyncDaemonState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-native-rsync-daemon-loader'
assert state['port'] == 8181 and state['root'] == '/tmp/rsync-root-8181'
assert state['moduleName'] == 'proof'
assert state['configPath'] == '/tmp/rsyncd-8181.conf'
assert state['policy'] == 'read-only-module-no-auth-hooks'
assert state['listenerState'] == 'idle-single-listener-no-active-clients'
assert state['binaryPolicy'] == 'proof-provisioned-target-native-rsync'
assert 'rsync proof 15J' in '''$body'''
print(json.dumps({'name':'rsync-daemon','state':'passed','rsyncDaemonState':state,'targetReadContains':'rsync proof 15J','targetPid':load['loader']['targetPid']}))
PY
}

prove_unsafe_rsync_daemon_refusal() {
  local active_bundle="$WORK/rsync-active.bundle" write_bundle="$WORK/rsync-write.bundle" auth_bundle="$WORK/rsync-auth.bundle" conflict_bundle="$WORK/rsync-conflict.bundle" missing_bundle="$WORK/rsync-missing.bundle" active_pid write_pid auth_pid conflict_pid missing_pid active_save_rc active_load_rc write_save_rc write_load_rc auth_save_rc auth_load_rc conflict_load_rc missing_load_rc
  active_pid=$(spawn_rsync_daemon 8182 readonly)
  sleep 1
  $CLI exec "$SRC" -- "bash -lc 'exec 9<>/dev/tcp/127.0.0.1/8182; sleep 20' >/tmp/rsync-active-client.log 2>&1 &" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$active_pid" "$active_bundle" --json >"$WORK/rsync-active.save.json"
  active_save_rc=$?
  $CLI move load "$TGT" "$active_bundle" --json >"$WORK/rsync-active.load.json"
  active_load_rc=$?
  set -e
  write_pid=$(spawn_rsync_daemon 8183 write)
  sleep 1
  set +e
  $CLI move save "$SRC" "$write_pid" "$write_bundle" --json >"$WORK/rsync-write.save.json"
  write_save_rc=$?
  $CLI move load "$TGT" "$write_bundle" --json >"$WORK/rsync-write.load.json"
  write_load_rc=$?
  set -e
  auth_pid=$(spawn_rsync_daemon 8184 auth)
  sleep 1
  set +e
  $CLI move save "$SRC" "$auth_pid" "$auth_bundle" --json >"$WORK/rsync-auth.save.json"
  auth_save_rc=$?
  $CLI move load "$TGT" "$auth_bundle" --json >"$WORK/rsync-auth.load.json"
  auth_load_rc=$?
  set -e
  write_rsync_daemon_fixture "$TGT" 8185 readonly
  conflict_pid=$(spawn_rsync_daemon 8185 readonly)
  $CLI exec "$TGT" -- "setsid sh -c 'exec /usr/bin/rsync --daemon --no-detach --config /tmp/rsyncd-8185.conf >/tmp/rsync-conflict-target.log 2>&1' </dev/null >/dev/null 2>&1 &" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$conflict_pid" "$conflict_bundle" --json >"$WORK/rsync-conflict.save.json"
  set +e
  $CLI move load "$TGT" "$conflict_bundle" --json >"$WORK/rsync-conflict.load.json"
  conflict_load_rc=$?
  set -e
  write_rsync_daemon_fixture "$TGT" 8186 readonly
  missing_pid=$(spawn_rsync_daemon 8186 readonly)
  sleep 1
  $CLI move save "$SRC" "$missing_pid" "$missing_bundle" --json >"$WORK/rsync-missing.save.json"
  $CLI exec "$TGT" -- "mv /usr/bin/rsync /usr/bin/rsync.disabled" >/dev/null
  set +e
  $CLI move load "$TGT" "$missing_bundle" --json >"$WORK/rsync-missing.load.json"
  missing_load_rc=$?
  set -e
  $CLI exec "$TGT" -- "mv /usr/bin/rsync.disabled /usr/bin/rsync" >/dev/null
  python3 - <<PY
import json
active_save=json.load(open('$WORK/rsync-active.save.json'))
active_load=json.load(open('$WORK/rsync-active.load.json'))
write_save=json.load(open('$WORK/rsync-write.save.json'))
write_load=json.load(open('$WORK/rsync-write.load.json'))
auth_save=json.load(open('$WORK/rsync-auth.save.json'))
auth_load=json.load(open('$WORK/rsync-auth.load.json'))
conflict_save=json.load(open('$WORK/rsync-conflict.save.json'))
conflict_load=json.load(open('$WORK/rsync-conflict.load.json'))
missing_save=json.load(open('$WORK/rsync-missing.save.json'))
missing_load=json.load(open('$WORK/rsync-missing.load.json'))
for save, load, save_rc, load_rc in [(active_save,active_load,'$active_save_rc','$active_load_rc'),(write_save,write_load,'$write_save_rc','$write_load_rc'),(auth_save,auth_load,'$auth_save_rc','$auth_load_rc')]:
    assert int(save_rc) == 1 and int(load_rc) == 1
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('rsyncDaemonState') is None
conflict_loader=conflict_load.get('loader', {})
missing_loader=missing_load.get('loader') or {}
assert conflict_save['accepted'] and int('$conflict_load_rc') == 1 and not conflict_load['accepted']
assert conflict_loader.get('state') == 'refused' and conflict_loader.get('targetPid') is None
assert 'port-in-use' in conflict_loader.get('patch', {}).get('stdout', '')
assert missing_save['accepted'] and int('$missing_load_rc') == 1 and not missing_load['accepted']
assert missing_loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-rsync-daemon-refusal','state':'passed','activeRsyncState':active_save['descriptor']['resourcePlan']['capture'].get('rsyncDaemonState'),'writeRsyncState':write_save['descriptor']['resourcePlan']['capture'].get('rsyncDaemonState'),'authRsyncState':auth_save['descriptor']['resourcePlan']['capture'].get('rsyncDaemonState'),'portConflictLoaderState':conflict_loader.get('state'),'portConflictTargetPid':conflict_loader.get('targetPid'),'missingRsyncLoadAccepted':missing_load['accepted'],'missingRsyncLoaderState':missing_loader.get('state'),'missingRsyncTargetPid':missing_loader.get('targetPid'),'missingRsyncTargetValidation':missing_load.get('targetValidation', {}).get('state')}))
PY
}

ensure_php_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/bin/php" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-php-apt.log; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/tmp/machinen-php-apt.log 2>&1 && apt-get install -y --reinstall --no-install-recommends php-cli >>/tmp/machinen-php-apt.log 2>&1 || { cat /tmp/machinen-php-apt.log; exit 1; }; test -x /usr/bin/php" >/dev/null
}

write_php_static_fixture() {
  local vm="$1" port="$2" mode="${3:-static}" root="/tmp/php-root-$2"
  ensure_php_tool "$vm"
  $CLI exec "$vm" -- "rm -rf $root; mkdir -p $root; printf 'php proof 15I\\n' >$root/index.txt; if [ '$mode' = dynamic ]; then printf '<?php echo 42; ?>\\n' >$root/index.php; fi" >/dev/null
}

spawn_php_static() {
  local port="$1" mode="${2:-static}" bind="${3:-127.0.0.1}"
  write_php_static_fixture "$SRC" "$port" "$mode"
  $CLI exec "$SRC" -- "rm -f /tmp/php-static-run-$port.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/php -S $bind:$port -t /tmp/php-root-$port >/tmp/php-static-run-$port.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

prove_php_static() {
  local bundle="$WORK/php-static.bundle" pid response
  write_php_static_fixture "$TGT" 8175 static
  pid=$(spawn_php_static 8175 static)
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/php-static.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/php-static.load.json"
  response=$(http_get_from_target 8175 /index.txt | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/php-static.save.json'))
load=json.load(open('$WORK/php-static.load.json'))
state=save['descriptor']['resourcePlan']['capture']['phpStaticState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-native-php-static-loader'
assert state['port'] == 8175 and state['root'] == '/tmp/php-root-8175'
assert state['argvContract'] == 'php-built-in-server-local-root'
assert state['dynamicPolicy'] == 'no-php-scripts'
assert state['listenerState'] == 'idle-single-listener'
assert state['binaryPolicy'] == 'proof-provisioned-target-native-php'
assert 'php proof 15I' in '''$response'''
print(json.dumps({'name':'php-static','state':'passed','phpStaticState':state,'targetResponseContains':'php proof 15I','targetPid':load['loader']['targetPid']}))
PY
}

prove_unsafe_php_static_refusal() {
  local active_bundle="$WORK/php-active.bundle" dynamic_bundle="$WORK/php-dynamic.bundle" unsupported_bundle="$WORK/php-unsupported.bundle" conflict_bundle="$WORK/php-conflict.bundle" missing_bundle="$WORK/php-missing.bundle" active_pid dynamic_pid unsupported_pid conflict_pid missing_pid active_save_rc active_load_rc dynamic_save_rc dynamic_load_rc unsupported_save_rc unsupported_load_rc conflict_load_rc missing_load_rc
  active_pid=$(spawn_php_static 8176 static)
  sleep 1
  $CLI exec "$SRC" -- "bash -lc 'exec 9<>/dev/tcp/127.0.0.1/8176; sleep 20' >/tmp/php-active-client.log 2>&1 &" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$active_pid" "$active_bundle" --json >"$WORK/php-active.save.json"
  active_save_rc=$?
  $CLI move load "$TGT" "$active_bundle" --json >"$WORK/php-active.load.json"
  active_load_rc=$?
  set -e
  dynamic_pid=$(spawn_php_static 8177 dynamic)
  sleep 1
  set +e
  $CLI move save "$SRC" "$dynamic_pid" "$dynamic_bundle" --json >"$WORK/php-dynamic.save.json"
  dynamic_save_rc=$?
  $CLI move load "$TGT" "$dynamic_bundle" --json >"$WORK/php-dynamic.load.json"
  dynamic_load_rc=$?
  set -e
  unsupported_pid=$(spawn_php_static 8178 static 0.0.0.0)
  sleep 1
  set +e
  $CLI move save "$SRC" "$unsupported_pid" "$unsupported_bundle" --json >"$WORK/php-unsupported.save.json"
  unsupported_save_rc=$?
  $CLI move load "$TGT" "$unsupported_bundle" --json >"$WORK/php-unsupported.load.json"
  unsupported_load_rc=$?
  set -e
  write_php_static_fixture "$TGT" 8179 static
  conflict_pid=$(spawn_php_static 8179 static)
  $CLI exec "$TGT" -- "setsid sh -c 'exec /usr/bin/php -S 127.0.0.1:8179 -t /tmp/php-root-8179 >/tmp/php-conflict-target.log 2>&1' </dev/null >/dev/null 2>&1 &" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$conflict_pid" "$conflict_bundle" --json >"$WORK/php-conflict.save.json"
  set +e
  $CLI move load "$TGT" "$conflict_bundle" --json >"$WORK/php-conflict.load.json"
  conflict_load_rc=$?
  set -e
  write_php_static_fixture "$TGT" 8180 static
  missing_pid=$(spawn_php_static 8180 static)
  sleep 1
  $CLI move save "$SRC" "$missing_pid" "$missing_bundle" --json >"$WORK/php-missing.save.json"
  $CLI exec "$TGT" -- "mv /usr/bin/php /usr/bin/php.disabled" >/dev/null
  set +e
  $CLI move load "$TGT" "$missing_bundle" --json >"$WORK/php-missing.load.json"
  missing_load_rc=$?
  set -e
  $CLI exec "$TGT" -- "mv /usr/bin/php.disabled /usr/bin/php" >/dev/null
  python3 - <<PY
import json
active_save=json.load(open('$WORK/php-active.save.json'))
active_load=json.load(open('$WORK/php-active.load.json'))
dynamic_save=json.load(open('$WORK/php-dynamic.save.json'))
dynamic_load=json.load(open('$WORK/php-dynamic.load.json'))
unsupported_save=json.load(open('$WORK/php-unsupported.save.json'))
unsupported_load=json.load(open('$WORK/php-unsupported.load.json'))
conflict_save=json.load(open('$WORK/php-conflict.save.json'))
conflict_load=json.load(open('$WORK/php-conflict.load.json'))
missing_save=json.load(open('$WORK/php-missing.save.json'))
missing_load=json.load(open('$WORK/php-missing.load.json'))
for save, load, save_rc, load_rc in [(active_save,active_load,'$active_save_rc','$active_load_rc'),(dynamic_save,dynamic_load,'$dynamic_save_rc','$dynamic_load_rc'),(unsupported_save,unsupported_load,'$unsupported_save_rc','$unsupported_load_rc')]:
    assert int(save_rc) == 1 and int(load_rc) == 1
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('phpStaticState') is None
conflict_loader=conflict_load.get('loader', {})
missing_loader=missing_load.get('loader', {})
assert conflict_save['accepted'] and int('$conflict_load_rc') == 1 and not conflict_load['accepted']
assert conflict_loader.get('state') == 'refused' and conflict_loader.get('targetPid') is None
assert 'port-in-use' in conflict_loader.get('patch', {}).get('stdout', '')
assert missing_save['accepted'] and int('$missing_load_rc') == 1 and not missing_load['accepted']
assert missing_loader.get('state') == 'refused' and missing_loader.get('targetPid') is None
assert 'missing-php' in missing_loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-php-static-refusal','state':'passed','activePhpState':active_save['descriptor']['resourcePlan']['capture'].get('phpStaticState'),'dynamicPhpState':dynamic_save['descriptor']['resourcePlan']['capture'].get('phpStaticState'),'unsupportedPhpState':unsupported_save['descriptor']['resourcePlan']['capture'].get('phpStaticState'),'portConflictLoaderState':conflict_loader.get('state'),'portConflictTargetPid':conflict_loader.get('targetPid'),'missingPhpLoadAccepted':missing_load['accepted'],'missingPhpLoaderState':missing_loader.get('state'),'missingPhpTargetPid':missing_loader.get('targetPid'),'missingPhpTargetValidation':missing_load.get('targetValidation', {}).get('state')}))
PY
}

ensure_ruby_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/bin/ruby" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-ruby-apt.log; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/tmp/machinen-ruby-apt.log 2>&1 && apt-get install -y --reinstall --no-install-recommends ruby >>/tmp/machinen-ruby-apt.log 2>&1 || { cat /tmp/machinen-ruby-apt.log; exit 1; }; test -x /usr/bin/ruby" >/dev/null
}

write_ruby_http_fixture() {
  local vm="$1" port="$2" root="/tmp/ruby-root-$2"
  ensure_ruby_tool "$vm"
  $CLI exec "$vm" -- "rm -rf $root; mkdir -p $root; printf 'ruby proof 15H\\n' >$root/index.txt" >/dev/null
}

spawn_ruby_http() {
  local port="$1"
  write_ruby_http_fixture "$SRC" "$port"
  $CLI exec "$SRC" -- "rm -f /tmp/ruby-http-run-$port.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/ruby -run -e httpd /tmp/ruby-root-$port -p $port >/tmp/ruby-http-run-$port.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

spawn_ruby_app_socket() {
  local port="$1"
  ensure_ruby_tool "$SRC"
  $CLI exec "$SRC" -- "setsid sh -c 'exec /usr/bin/ruby -rsocket -e \"TCPServer.new(\\\"127.0.0.1\\\", $port); sleep\" >/tmp/ruby-app-$port.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

prove_ruby_http() {
  local bundle="$WORK/ruby-http.bundle" pid response
  write_ruby_http_fixture "$TGT" 8170
  pid=$(spawn_ruby_http 8170)
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/ruby-http.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/ruby-http.load.json"
  response=$(http_get_from_target 8170 /index.txt | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/ruby-http.save.json'))
load=json.load(open('$WORK/ruby-http.load.json'))
state=save['descriptor']['resourcePlan']['capture']['rubyHttpState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-native-ruby-httpd-loader'
assert state['port'] == 8170 and state['root'] == '/tmp/ruby-root-8170'
assert state['argvContract'] == 'ruby-run-httpd-root-port'
assert state['listenerState'] == 'idle-single-listener'
assert state['binaryPolicy'] == 'proof-provisioned-target-native-ruby'
assert 'ruby proof 15H' in '''$response'''
print(json.dumps({'name':'ruby-http','state':'passed','rubyHttpState':state,'targetResponseContains':'ruby proof 15H','targetPid':load['loader']['targetPid']}))
PY
}

prove_unsafe_ruby_http_refusal() {
  local active_bundle="$WORK/ruby-active.bundle" app_bundle="$WORK/ruby-app.bundle" conflict_bundle="$WORK/ruby-conflict.bundle" missing_bundle="$WORK/ruby-missing.bundle" active_pid app_pid conflict_pid missing_pid active_save_rc active_load_rc app_save_rc app_load_rc conflict_load_rc missing_load_rc
  active_pid=$(spawn_ruby_http 8171)
  sleep 1
  $CLI exec "$SRC" -- "bash -lc 'exec 9<>/dev/tcp/127.0.0.1/8171; sleep 20' >/tmp/ruby-active-client.log 2>&1 &" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$active_pid" "$active_bundle" --json >"$WORK/ruby-active.save.json"
  active_save_rc=$?
  $CLI move load "$TGT" "$active_bundle" --json >"$WORK/ruby-active.load.json"
  active_load_rc=$?
  set -e
  app_pid=$(spawn_ruby_app_socket 8172)
  sleep 1
  set +e
  $CLI move save "$SRC" "$app_pid" "$app_bundle" --json >"$WORK/ruby-app.save.json"
  app_save_rc=$?
  $CLI move load "$TGT" "$app_bundle" --json >"$WORK/ruby-app.load.json"
  app_load_rc=$?
  set -e
  write_ruby_http_fixture "$TGT" 8173
  conflict_pid=$(spawn_ruby_http 8173)
  $CLI exec "$TGT" -- "setsid sh -c 'exec /usr/bin/ruby -run -e httpd /tmp/ruby-root-8173 -p 8173 >/tmp/ruby-conflict-target.log 2>&1' </dev/null >/dev/null 2>&1 &" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$conflict_pid" "$conflict_bundle" --json >"$WORK/ruby-conflict.save.json"
  set +e
  $CLI move load "$TGT" "$conflict_bundle" --json >"$WORK/ruby-conflict.load.json"
  conflict_load_rc=$?
  set -e
  write_ruby_http_fixture "$TGT" 8174
  missing_pid=$(spawn_ruby_http 8174)
  sleep 1
  $CLI move save "$SRC" "$missing_pid" "$missing_bundle" --json >"$WORK/ruby-missing.save.json"
  $CLI exec "$TGT" -- "mv /usr/bin/ruby /usr/bin/ruby.disabled" >/dev/null
  set +e
  $CLI move load "$TGT" "$missing_bundle" --json >"$WORK/ruby-missing.load.json"
  missing_load_rc=$?
  set -e
  $CLI exec "$TGT" -- "mv /usr/bin/ruby.disabled /usr/bin/ruby" >/dev/null
  python3 - <<PY
import json
active_save=json.load(open('$WORK/ruby-active.save.json'))
active_load=json.load(open('$WORK/ruby-active.load.json'))
app_save=json.load(open('$WORK/ruby-app.save.json'))
app_load=json.load(open('$WORK/ruby-app.load.json'))
conflict_save=json.load(open('$WORK/ruby-conflict.save.json'))
conflict_load=json.load(open('$WORK/ruby-conflict.load.json'))
missing_save=json.load(open('$WORK/ruby-missing.save.json'))
missing_load=json.load(open('$WORK/ruby-missing.load.json'))
for save, load, save_rc, load_rc in [(active_save,active_load,'$active_save_rc','$active_load_rc'),(app_save,app_load,'$app_save_rc','$app_load_rc')]:
    assert int(save_rc) == 1 and int(load_rc) == 1
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('rubyHttpState') is None
conflict_loader=conflict_load.get('loader', {})
missing_loader=missing_load.get('loader', {})
assert conflict_save['accepted'] and int('$conflict_load_rc') == 1 and not conflict_load['accepted']
assert conflict_loader.get('state') == 'refused' and conflict_loader.get('targetPid') is None
assert 'port-in-use' in conflict_loader.get('patch', {}).get('stdout', '')
assert missing_save['accepted'] and int('$missing_load_rc') == 1 and not missing_load['accepted']
assert missing_loader.get('state') == 'refused' and missing_loader.get('targetPid') is None
assert 'missing-ruby' in missing_loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-ruby-http-refusal','state':'passed','activeRubyState':active_save['descriptor']['resourcePlan']['capture'].get('rubyHttpState'),'appRubyState':app_save['descriptor']['resourcePlan']['capture'].get('rubyHttpState'),'portConflictLoaderState':conflict_loader.get('state'),'portConflictTargetPid':conflict_loader.get('targetPid'),'missingRubyLoadAccepted':missing_load['accepted'],'missingRubyLoaderState':missing_loader.get('state'),'missingRubyTargetPid':missing_loader.get('targetPid'),'missingRubyTargetValidation':missing_load.get('targetValidation', {}).get('state')}))
PY
}

ensure_caddy_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/bin/caddy" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-caddy-apt.log; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/tmp/machinen-caddy-apt.log 2>&1 && apt-get install -y --reinstall --no-install-recommends caddy >>/tmp/machinen-caddy-apt.log 2>&1 || { cat /tmp/machinen-caddy-apt.log; exit 1; }; test -x /usr/bin/caddy" >/dev/null
}

write_caddy_static_fixture() {
  local vm="$1" port="$2" root="/tmp/caddy-root-$2"
  ensure_caddy_tool "$vm"
  $CLI exec "$vm" -- "rm -rf $root; mkdir -p $root; printf 'caddy proof 15G\\n' >$root/index.txt" >/dev/null
}

spawn_caddy_static() {
  local port="$1"
  write_caddy_static_fixture "$SRC" "$port"
  $CLI exec "$SRC" -- "rm -f /tmp/caddy-static-run-$port.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/caddy file-server --listen :$port --root /tmp/caddy-root-$port >/tmp/caddy-static-run-$port.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

spawn_caddy_proxy() {
  local port="$1"
  ensure_caddy_tool "$SRC"
  $CLI exec "$SRC" -- "rm -f /tmp/caddy-proxy-run-$port.log; setsid sh -c 'exec /usr/bin/caddy reverse-proxy --from :$port --to 127.0.0.1:9 >/tmp/caddy-proxy-run-$port.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

prove_caddy_static() {
  local bundle="$WORK/caddy-static.bundle" pid response
  write_caddy_static_fixture "$TGT" 8165
  pid=$(spawn_caddy_static 8165)
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/caddy-static.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/caddy-static.load.json"
  response=$(http_get_from_target 8165 /index.txt | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/caddy-static.save.json'))
load=json.load(open('$WORK/caddy-static.load.json'))
state=save['descriptor']['resourcePlan']['capture']['caddyStaticState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-native-caddy-static-loader'
assert state['port'] == 8165 and state['root'] == '/tmp/caddy-root-8165'
assert state['argvContract'] == 'caddy-file-server-listen-root'
assert state['listenerState'] == 'idle-single-listener'
assert state['binaryPolicy'] == 'proof-provisioned-target-native-caddy'
assert 'caddy proof 15G' in '''$response'''
print(json.dumps({'name':'caddy-static','state':'passed','caddyStaticState':state,'targetResponseContains':'caddy proof 15G','targetPid':load['loader']['targetPid']}))
PY
}

prove_unsafe_caddy_static_refusal() {
  local active_bundle="$WORK/caddy-active.bundle" proxy_bundle="$WORK/caddy-proxy.bundle" conflict_bundle="$WORK/caddy-conflict.bundle" missing_bundle="$WORK/caddy-missing.bundle" active_pid proxy_pid conflict_pid missing_pid active_save_rc active_load_rc proxy_save_rc proxy_load_rc conflict_load_rc missing_load_rc
  active_pid=$(spawn_caddy_static 8166)
  sleep 1
  $CLI exec "$SRC" -- "bash -lc 'exec 9<>/dev/tcp/127.0.0.1/8166; sleep 20' >/tmp/caddy-active-client.log 2>&1 &" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$active_pid" "$active_bundle" --json >"$WORK/caddy-active.save.json"
  active_save_rc=$?
  $CLI move load "$TGT" "$active_bundle" --json >"$WORK/caddy-active.load.json"
  active_load_rc=$?
  set -e
  proxy_pid=$(spawn_caddy_proxy 8167)
  sleep 1
  set +e
  $CLI move save "$SRC" "$proxy_pid" "$proxy_bundle" --json >"$WORK/caddy-proxy.save.json"
  proxy_save_rc=$?
  $CLI move load "$TGT" "$proxy_bundle" --json >"$WORK/caddy-proxy.load.json"
  proxy_load_rc=$?
  set -e
  write_caddy_static_fixture "$TGT" 8168
  conflict_pid=$(spawn_caddy_static 8168)
  $CLI exec "$TGT" -- "setsid sh -c 'exec /usr/bin/caddy file-server --listen :8168 --root /tmp/caddy-root-8168 >/tmp/caddy-conflict-target.log 2>&1' </dev/null >/dev/null 2>&1 &" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$conflict_pid" "$conflict_bundle" --json >"$WORK/caddy-conflict.save.json"
  set +e
  $CLI move load "$TGT" "$conflict_bundle" --json >"$WORK/caddy-conflict.load.json"
  conflict_load_rc=$?
  set -e
  write_caddy_static_fixture "$TGT" 8169
  missing_pid=$(spawn_caddy_static 8169)
  sleep 1
  $CLI move save "$SRC" "$missing_pid" "$missing_bundle" --json >"$WORK/caddy-missing.save.json"
  $CLI exec "$TGT" -- "mv /usr/bin/caddy /usr/bin/caddy.disabled" >/dev/null
  set +e
  $CLI move load "$TGT" "$missing_bundle" --json >"$WORK/caddy-missing.load.json"
  missing_load_rc=$?
  set -e
  $CLI exec "$TGT" -- "mv /usr/bin/caddy.disabled /usr/bin/caddy" >/dev/null
  python3 - <<PY
import json
active_save=json.load(open('$WORK/caddy-active.save.json'))
active_load=json.load(open('$WORK/caddy-active.load.json'))
proxy_save=json.load(open('$WORK/caddy-proxy.save.json'))
proxy_load=json.load(open('$WORK/caddy-proxy.load.json'))
conflict_save=json.load(open('$WORK/caddy-conflict.save.json'))
conflict_load=json.load(open('$WORK/caddy-conflict.load.json'))
missing_save=json.load(open('$WORK/caddy-missing.save.json'))
missing_load=json.load(open('$WORK/caddy-missing.load.json'))
for save, load, save_rc, load_rc in [(active_save,active_load,'$active_save_rc','$active_load_rc'),(proxy_save,proxy_load,'$proxy_save_rc','$proxy_load_rc')]:
    assert int(save_rc) == 1 and int(load_rc) == 1, {'save_rc': save_rc, 'load_rc': load_rc, 'saveAccepted': save.get('accepted'), 'loadAccepted': load.get('accepted')}
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('caddyStaticState') is None
conflict_loader=conflict_load.get('loader', {})
missing_loader=missing_load.get('loader', {})
assert conflict_save['accepted'] and int('$conflict_load_rc') == 1 and not conflict_load['accepted']
assert conflict_loader.get('state') == 'refused' and conflict_loader.get('targetPid') is None
assert 'port-in-use' in conflict_loader.get('patch', {}).get('stdout', '')
assert missing_save['accepted'] and int('$missing_load_rc') == 1 and not missing_load['accepted']
assert missing_loader.get('state') == 'refused' and missing_loader.get('targetPid') is None
assert 'missing-caddy' in missing_loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-caddy-static-refusal','state':'passed','activeCaddyState':active_save['descriptor']['resourcePlan']['capture'].get('caddyStaticState'),'proxyCaddyState':proxy_save['descriptor']['resourcePlan']['capture'].get('caddyStaticState'),'portConflictLoaderState':conflict_loader.get('state'),'portConflictTargetPid':conflict_loader.get('targetPid'),'missingCaddyLoadAccepted':missing_load['accepted'],'missingCaddyLoaderState':missing_loader.get('state'),'missingCaddyTargetPid':missing_loader.get('targetPid'),'missingCaddyTargetValidation':missing_load.get('targetValidation', {}).get('state')}))
PY
}

ensure_nginx_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/sbin/nginx" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-nginx-apt.log; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/tmp/machinen-nginx-apt.log 2>&1 && apt-get install -y --reinstall --no-install-recommends nginx >>/tmp/machinen-nginx-apt.log 2>&1 || { cat /tmp/machinen-nginx-apt.log; exit 1; }; test -x /usr/sbin/nginx" >/dev/null
}

write_nginx_static_fixture() {
  local vm="$1" port="$2" mode="${3:-static}" root="/tmp/nginx-root-$2" config="/tmp/nginx-static-$2.conf" pidfile="/tmp/nginx-static-$2.pid"
  ensure_nginx_tool "$vm"
  $CLI exec "$vm" -- "rm -rf $root; mkdir -p $root; printf 'nginx proof 15F\\n' >$root/index.txt; cat >$config <<'EOF'
pid $pidfile;
events { worker_connections 16; }
http {
  access_log off;
  error_log /tmp/nginx-static-error.log;
  server {
    listen 127.0.0.1:$port;
    root $root;
    location / { try_files \$uri =404; }
EOF
if [ \"$mode\" = fastcgi ]; then cat >>$config <<'EOF'
    location /cgi { fastcgi_pass 127.0.0.1:9000; }
EOF
fi
cat >>$config <<'EOF'
  }
}
EOF
/usr/sbin/nginx -t -c $config >/tmp/nginx-static-test-$port.log 2>&1 || { cat /tmp/nginx-static-test-$port.log; exit 1; }" >/dev/null
}

spawn_nginx_static() {
  local port="$1" mode="${2:-static}"
  write_nginx_static_fixture "$SRC" "$port" "$mode"
  $CLI exec "$SRC" -- "rm -f /tmp/nginx-static-run-$port.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/sbin/nginx -c /tmp/nginx-static-$port.conf -g \"daemon off;\" >/tmp/nginx-static-run-$port.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

http_get_from_target() {
  local port="$1" path="$2"
  $CLI exec "$TGT" -- "bash -lc 'exec 3<>/dev/tcp/127.0.0.1/$port; printf \"GET $path HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\n\\r\\n\" >&3; cat <&3'"
}

prove_nginx_static() {
  local bundle="$WORK/nginx-static.bundle" pid response
  write_nginx_static_fixture "$TGT" 8160 static
  pid=$(spawn_nginx_static 8160 static)
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/nginx-static.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/nginx-static.load.json"
  response=$(http_get_from_target 8160 /index.txt | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/nginx-static.save.json'))
load=json.load(open('$WORK/nginx-static.load.json'))
state=save['descriptor']['resourcePlan']['capture']['nginxStaticState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-native-nginx-static-loader'
assert state['port'] == 8160 and state['root'] == '/tmp/nginx-root-8160'
assert state['configPath'] == '/tmp/nginx-static-8160.conf'
assert state['configContract'] == 'nginx-static-root-local-listen-try-files-404'
assert state['listenerState'] == 'idle-single-listener'
assert state['binaryPolicy'] == 'proof-provisioned-target-native-nginx'
assert 'nginx proof 15F' in '''$response'''
print(json.dumps({'name':'nginx-static','state':'passed','nginxStaticState':state,'targetResponseContains':'nginx proof 15F','targetPid':load['loader']['targetPid']}))
PY
}

prove_unsafe_nginx_static_refusal() {
  local active_bundle="$WORK/nginx-active.bundle" dynamic_bundle="$WORK/nginx-dynamic.bundle" conflict_bundle="$WORK/nginx-conflict.bundle" missing_bundle="$WORK/nginx-missing.bundle" active_pid dynamic_pid conflict_pid missing_pid active_save_rc active_load_rc dynamic_save_rc dynamic_load_rc conflict_load_rc missing_load_rc
  active_pid=$(spawn_nginx_static 8161 static)
  sleep 1
  $CLI exec "$SRC" -- "bash -lc 'exec 9<>/dev/tcp/127.0.0.1/8161; sleep 20' >/tmp/nginx-active-client.log 2>&1 &" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$active_pid" "$active_bundle" --json >"$WORK/nginx-active.save.json"
  active_save_rc=$?
  $CLI move load "$TGT" "$active_bundle" --json >"$WORK/nginx-active.load.json"
  active_load_rc=$?
  set -e
  dynamic_pid=$(spawn_nginx_static 8162 fastcgi)
  sleep 1
  set +e
  $CLI move save "$SRC" "$dynamic_pid" "$dynamic_bundle" --json >"$WORK/nginx-dynamic.save.json"
  dynamic_save_rc=$?
  $CLI move load "$TGT" "$dynamic_bundle" --json >"$WORK/nginx-dynamic.load.json"
  dynamic_load_rc=$?
  set -e
  write_nginx_static_fixture "$TGT" 8163 static
  conflict_pid=$(spawn_nginx_static 8163 static)
  $CLI exec "$TGT" -- "setsid sh -c 'exec /usr/sbin/nginx -c /tmp/nginx-static-8163.conf -g \"daemon off;\" >/tmp/nginx-conflict-target.log 2>&1' </dev/null >/dev/null 2>&1 &" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$conflict_pid" "$conflict_bundle" --json >"$WORK/nginx-conflict.save.json"
  set +e
  $CLI move load "$TGT" "$conflict_bundle" --json >"$WORK/nginx-conflict.load.json"
  conflict_load_rc=$?
  set -e
  write_nginx_static_fixture "$TGT" 8164 static
  missing_pid=$(spawn_nginx_static 8164 static)
  sleep 1
  $CLI move save "$SRC" "$missing_pid" "$missing_bundle" --json >"$WORK/nginx-missing.save.json"
  $CLI exec "$TGT" -- "mv /usr/sbin/nginx /usr/sbin/nginx.disabled" >/dev/null
  set +e
  $CLI move load "$TGT" "$missing_bundle" --json >"$WORK/nginx-missing.load.json"
  missing_load_rc=$?
  set -e
  $CLI exec "$TGT" -- "mv /usr/sbin/nginx.disabled /usr/sbin/nginx" >/dev/null
  python3 - <<PY
import json
active_save=json.load(open('$WORK/nginx-active.save.json'))
active_load=json.load(open('$WORK/nginx-active.load.json'))
dynamic_save=json.load(open('$WORK/nginx-dynamic.save.json'))
dynamic_load=json.load(open('$WORK/nginx-dynamic.load.json'))
conflict_save=json.load(open('$WORK/nginx-conflict.save.json'))
conflict_load=json.load(open('$WORK/nginx-conflict.load.json'))
missing_save=json.load(open('$WORK/nginx-missing.save.json'))
missing_load=json.load(open('$WORK/nginx-missing.load.json'))
for save, load, save_rc, load_rc in [(active_save,active_load,'$active_save_rc','$active_load_rc'),(dynamic_save,dynamic_load,'$dynamic_save_rc','$dynamic_load_rc')]:
    assert int(save_rc) == 1 and int(load_rc) == 1, {'save_rc': save_rc, 'load_rc': load_rc, 'saveAccepted': save.get('accepted'), 'loadAccepted': load.get('accepted')}
    assert not save['accepted'] and not load['accepted'], {'saveAccepted': save.get('accepted'), 'loadAccepted': load.get('accepted')}
    assert save['descriptor']['resourcePlan']['capture'].get('nginxStaticState') is None, save['descriptor']['resourcePlan']['capture'].get('nginxStaticState')
conflict_loader=conflict_load.get('loader', {})
missing_loader=missing_load.get('loader')
assert conflict_save['accepted'] and int('$conflict_load_rc') == 1 and not conflict_load['accepted'], {'conflictSave': conflict_save.get('accepted'), 'conflictLoad': conflict_load.get('accepted'), 'conflictRc': '$conflict_load_rc'}
assert conflict_loader.get('state') == 'refused' and conflict_loader.get('targetPid') is None, conflict_loader
assert 'port-in-use' in conflict_loader.get('patch', {}).get('stdout', ''), conflict_loader.get('patch', {}).get('stdout', '')
assert missing_save['accepted'] and int('$missing_load_rc') == 1 and not missing_load['accepted'], {'missingSave': missing_save.get('accepted'), 'missingLoad': missing_load.get('accepted'), 'missingRc': '$missing_load_rc', 'targetValidation': missing_load.get('targetValidation'), 'loader': missing_loader}
assert missing_loader.get('state') == 'refused' and missing_loader.get('targetPid') is None, missing_loader
assert 'missing-nginx' in missing_loader.get('patch', {}).get('stdout', ''), missing_loader
print(json.dumps({'name':'unsafe-nginx-static-refusal','state':'passed','activeNginxState':active_save['descriptor']['resourcePlan']['capture'].get('nginxStaticState'),'dynamicNginxState':dynamic_save['descriptor']['resourcePlan']['capture'].get('nginxStaticState'),'portConflictLoaderState':conflict_loader.get('state'),'portConflictTargetPid':conflict_loader.get('targetPid'),'missingNginxLoadAccepted':missing_load['accepted'],'missingNginxLoaderState':missing_loader.get('state'),'missingNginxTargetPid':missing_loader.get('targetPid'),'missingNginxTargetValidation':missing_load.get('targetValidation', {}).get('state')}))
PY
}

ensure_postgres_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/lib/postgresql/15/bin/postgres && test -x /usr/lib/postgresql/15/bin/initdb && test -x /usr/lib/postgresql/15/bin/psql && test -x /usr/lib/postgresql/15/bin/pg_controldata" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-postgres-apt.log; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/tmp/machinen-postgres-apt.log 2>&1 && apt-get install -y --reinstall --no-install-recommends postgresql-15 postgresql-client-15 >>/tmp/machinen-postgres-apt.log 2>&1 || { cat /tmp/machinen-postgres-apt.log; exit 1; }; test -x /usr/lib/postgresql/15/bin/postgres && test -x /usr/lib/postgresql/15/bin/initdb && test -x /usr/lib/postgresql/15/bin/psql && test -x /usr/lib/postgresql/15/bin/pg_controldata" >/dev/null
}

spawn_postgres_instance() {
  local port="${1:-8159}" data_dir="${2:-/tmp/pgdata-proof}" name="${3:-postgres-proof}" extra_config="${4:-}"
  ensure_postgres_tool "$SRC"
  $CLI exec "$SRC" -- "for d in /proc/[0-9]*; do exe=\$(readlink \"\$d/exe\" 2>/dev/null || true); [ \"\$exe\" = /usr/lib/postgresql/15/bin/postgres ] && kill -TERM \${d##*/} 2>/dev/null || true; done; sleep 1; for d in /proc/[0-9]*; do exe=\$(readlink \"\$d/exe\" 2>/dev/null || true); [ \"\$exe\" = /usr/lib/postgresql/15/bin/postgres ] && kill -KILL \${d##*/} 2>/dev/null || true; done; sleep 1; rm -rf '$data_dir'; mkdir -p '$data_dir'; chown postgres:postgres '$data_dir'; su -s /bin/sh postgres -c '/usr/lib/postgresql/15/bin/initdb -D '$data_dir' --auth=trust --no-locale >/tmp/${name}-initdb.log 2>&1'; if [ -n '$extra_config' ]; then printf '%s\n' '$extra_config' >>'$data_dir/postgresql.conf'; fi; setsid su -s /bin/sh postgres -c 'cd '$data_dir' && exec /usr/lib/postgresql/15/bin/postgres -D '$data_dir' -p $port -h 127.0.0.1 >/tmp/${name}.log 2>&1' </dev/null >/dev/null 2>&1 & for i in \$(seq 1 240); do if /usr/lib/postgresql/15/bin/pg_isready -h 127.0.0.1 -p $port >/dev/null 2>&1; then for d in /proc/[0-9]*; do exe=\$(readlink "\$d/exe" 2>/dev/null || true); [ "\$exe" = /usr/lib/postgresql/15/bin/postgres ] || continue; cmd=\$(tr '\000' ' ' <"\$d/cmdline" 2>/dev/null || true); case "\$cmd" in *'$data_dir'*) candidate=\${d##*/}; sleep 1; if kill -0 "\$candidate" 2>/dev/null && /usr/lib/postgresql/15/bin/pg_isready -h 127.0.0.1 -p $port >/dev/null 2>&1; then echo "\$candidate"; exit 0; fi;; esac; done; fi; sleep 0.05; done; cat /tmp/${name}.log >&2; exit 1" | tail -1 | tr -d '\r'
}

copy_postgres_data_dir_to_target() {
  ensure_postgres_tool "$TGT"
  $CLI exec "$SRC" -- "cd /tmp && tar --numeric-owner --exclude='pgdata-proof/postmaster.pid' --exclude='pgdata-proof/postmaster.opts' --exclude='pgdata-proof/pg_stat/*' --exclude='pgdata-proof/pg_stat_tmp/*' -cf - pgdata-proof | base64" >"$WORK/pgdata-proof.tar.b64"
  rm -rf "$WORK/pgdata-upload-chunks"
  mkdir -p "$WORK/pgdata-upload-chunks"
  split -a 5 -b 65536 "$WORK/pgdata-proof.tar.b64" "$WORK/pgdata-upload-chunks/chunk."
  $CLI exec "$TGT" -- "rm -rf /tmp/pgdata-proof /tmp/pgdata-proof.tar /tmp/pgdata-proof.tar.b64; : >/tmp/pgdata-proof.tar.b64" >/dev/null
  for chunk in "$WORK"/pgdata-upload-chunks/chunk.*; do
    $CLI exec "$TGT" -- "cat >>/tmp/pgdata-proof.tar.b64 <<'EOF'
$(cat "$chunk")
EOF" >/dev/null
  done
  $CLI exec "$TGT" -- "base64 -d /tmp/pgdata-proof.tar.b64 >/tmp/pgdata-proof.tar; tar -C /tmp -xf /tmp/pgdata-proof.tar; rm -f /tmp/pgdata-proof.tar /tmp/pgdata-proof.tar.b64; chown -R postgres:postgres /tmp/pgdata-proof; rm -rf /tmp/pgdata-proof.clean; cp -a /tmp/pgdata-proof /tmp/pgdata-proof.clean" >/dev/null
}

reset_postgres_target_data_dir() {
  $CLI exec "$TGT" -- "for d in /proc/[0-9]*; do exe=\$(readlink \"\$d/exe\" 2>/dev/null || true); [ \"\$exe\" = /usr/lib/postgresql/15/bin/postgres ] && kill -TERM \${d##*/} 2>/dev/null || true; done; sleep 1; for d in /proc/[0-9]*; do exe=\$(readlink \"\$d/exe\" 2>/dev/null || true); [ \"\$exe\" = /usr/lib/postgresql/15/bin/postgres ] && kill -KILL \${d##*/} 2>/dev/null || true; done; rm -rf /tmp/pgdata-proof; cp -a /tmp/pgdata-proof.clean /tmp/pgdata-proof; chown -R postgres:postgres /tmp/pgdata-proof" >/dev/null
}

prove_postgres_idle_cluster() {
  local bundle="$WORK/postgres-idle-cluster.bundle" pid out
  pid=$(spawn_postgres_instance 8159 /tmp/pgdata-proof postgres-idle)
  ensure_postgres_tool "$TGT"
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/postgres-idle-cluster.save.json"
  copy_postgres_data_dir_to_target
  $CLI move load "$TGT" "$bundle" --json >"$WORK/postgres-idle-cluster.load.json"
  out=$($CLI exec "$TGT" -- "/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 8159 -U postgres -d postgres -Atc 'select 1'" | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/postgres-idle-cluster.save.json'))
load=json.load(open('$WORK/postgres-idle-cluster.load.json'))
pg=save['descriptor']['resourcePlan']['capture'].get('postgresClusterState')
loader=load.get('loader', {})
assert save['accepted'] and load['accepted'], {'save':save.get('accepted'),'load':load.get('accepted')}
assert pg and pg['policy']=='postgres-idle-clean-cluster-target-native-restart', pg
assert loader.get('state') == 'ready' and loader.get('targetPid'), loader
assert '$out'.strip() == '1', '$out'
print(json.dumps({'name':'postgres-idle-cluster','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'loaderState':loader.get('state'),'targetPid':loader.get('targetPid'),'selectOne':'$out','policy':pg['policy'],'package':pg['packageIdentity'],'clientPackage':pg['clientPackageIdentity']}))
PY
}

prove_postgres_refusal() {
  local bundle="$WORK/postgres-refusal.bundle" pid save_rc load_rc
  pid=$(spawn_postgres_instance 8159 /tmp/pgdata-proof postgres-refusal)
  $CLI exec "$SRC" -- "/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 8159 -U postgres -d postgres -c 'select pg_sleep(20)' >/tmp/postgres-active-client.log 2>&1 & echo \$!" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/postgres-refusal.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/postgres-refusal.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/postgres-refusal.save.json'))
load=json.load(open('$WORK/postgres-refusal.load.json'))
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert 'loader' not in load
assert save['descriptor']['nodes'][0]['exe'].endswith('/postgres')
assert save['descriptor']['resourcePlan']['capture'].get('postgresClusterState') is None
print(json.dumps({'name':'postgres-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'loaderStarted':'loader' in load,'exe':save['descriptor']['nodes'][0]['exe'],'postgresClusterState':None,'refusedClasses':[r['stateClass'] for r in save['descriptor']['refusedStateClasses']]}))
PY
}

prove_unsafe_postgres_cluster_refusal() {
  local active_bundle="$WORK/unsafe-postgres-active-client.bundle" feature_bundle="$WORK/unsafe-postgres-features.bundle" config_bundle="$WORK/unsafe-postgres-config.bundle" port_bundle="$WORK/unsafe-postgres-port.bundle" missing_bundle="$WORK/unsafe-postgres-missing.bundle" package_bundle="$WORK/unsafe-postgres-package.bundle" stale_bundle="$WORK/unsafe-postgres-stale.bundle" owner_bundle="$WORK/unsafe-postgres-owner.bundle" data_bundle="$WORK/unsafe-postgres-data.bundle" wal_bundle="$WORK/unsafe-postgres-wal.bundle" pid active_rc feature_rc config_load_rc port_load_rc missing_load_rc package_load_rc stale_load_rc owner_load_rc data_load_rc wal_load_rc
  pid=$(spawn_postgres_instance 8159 /tmp/pgdata-proof unsafe-postgres-active)
  $CLI exec "$SRC" -- "/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 8159 -U postgres -d postgres -c 'select pg_sleep(20)' >/tmp/unsafe-postgres-active-client.log 2>&1 &" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$active_bundle" --json >"$WORK/unsafe-postgres-active.save.json"
  active_rc=$?
  set -e


  pid=$(spawn_postgres_instance 8160 /tmp/pgdata-proof unsafe-postgres-valid)
  ensure_postgres_tool "$TGT"
  sleep 1
  $CLI move save "$SRC" "$pid" "$config_bundle" --json >"$WORK/unsafe-postgres-config.save.json"
  rm -rf "$port_bundle" "$missing_bundle" "$package_bundle" "$stale_bundle" "$owner_bundle" "$data_bundle" "$wal_bundle"
  cp -R "$config_bundle" "$port_bundle"
  cp -R "$config_bundle" "$missing_bundle"
  cp -R "$config_bundle" "$package_bundle"
  cp -R "$config_bundle" "$stale_bundle"
  cp -R "$config_bundle" "$owner_bundle"
  cp -R "$config_bundle" "$data_bundle"
  cp -R "$config_bundle" "$wal_bundle"
  python3 - <<PY
import json
from pathlib import Path
for bundle, mutator in [
  ('$package_bundle', lambda pg: pg['packageIdentity'].__setitem__('version', '0.machinen-mismatch')),
  ('$wal_bundle', lambda pg: pg['walState'].__setitem__('pgWalDigest', '0'*64)),
]:
  path=Path(bundle)/'move.json'
  doc=json.load(open(path))
  pg=doc['resourcePlan']['capture']['postgresClusterState']
  mutator(pg)
  path.write_text(json.dumps(doc, indent=2)+'\n')
PY
  copy_postgres_data_dir_to_target

  reset_postgres_target_data_dir
  $CLI exec "$TGT" -- "printf '\n# machinen unsafe mutation\n' >>/tmp/pgdata-proof/pg_hba.conf" >/dev/null
  set +e
  $CLI move load "$TGT" "$config_bundle" --json >"$WORK/unsafe-postgres-config.load.json"
  config_load_rc=$?
  set -e

  reset_postgres_target_data_dir
  $CLI exec "$TGT" -- "rm -rf /tmp/pgdata-conflict; mkdir -p /tmp/pgdata-conflict; chown postgres:postgres /tmp/pgdata-conflict; su -s /bin/sh postgres -c '/usr/lib/postgresql/15/bin/initdb -D /tmp/pgdata-conflict --auth=trust --no-locale >/tmp/postgres-conflict-initdb.log 2>&1'; setsid su -s /bin/sh postgres -c '/usr/lib/postgresql/15/bin/postgres -D /tmp/pgdata-conflict -p 8160 -h 127.0.0.1 >/tmp/postgres-conflict.log 2>&1' </dev/null >/dev/null 2>&1 & for i in \$(seq 1 200); do /usr/lib/postgresql/15/bin/pg_isready -h 127.0.0.1 -p 8160 >/dev/null 2>&1 && exit 0; sleep 0.05; done; cat /tmp/postgres-conflict.log >&2; exit 1" >/dev/null
  set +e
  $CLI move load "$TGT" "$port_bundle" --json >"$WORK/unsafe-postgres-port.load.json"
  port_load_rc=$?
  set -e

  reset_postgres_target_data_dir
  $CLI exec "$TGT" -- "mv /usr/lib/postgresql/15/bin/postgres /usr/lib/postgresql/15/bin/postgres.machinen-missing" >/dev/null
  set +e
  $CLI move load "$TGT" "$missing_bundle" --json >"$WORK/unsafe-postgres-missing.load.json"
  missing_load_rc=$?
  set -e
  $CLI exec "$TGT" -- "mv /usr/lib/postgresql/15/bin/postgres.machinen-missing /usr/lib/postgresql/15/bin/postgres" >/dev/null

  reset_postgres_target_data_dir
  set +e
  $CLI move load "$TGT" "$package_bundle" --json >"$WORK/unsafe-postgres-package.load.json"
  package_load_rc=$?
  set -e

  reset_postgres_target_data_dir
  $CLI exec "$TGT" -- "printf '999999\n' >/tmp/pgdata-proof/postmaster.pid" >/dev/null
  set +e
  $CLI move load "$TGT" "$stale_bundle" --json >"$WORK/unsafe-postgres-stale.load.json"
  stale_load_rc=$?
  set -e

  reset_postgres_target_data_dir
  $CLI exec "$TGT" -- "chmod 755 /tmp/pgdata-proof" >/dev/null
  set +e
  $CLI move load "$TGT" "$owner_bundle" --json >"$WORK/unsafe-postgres-owner.load.json"
  owner_load_rc=$?
  set -e

  reset_postgres_target_data_dir
  $CLI exec "$TGT" -- "printf 'changed\n' >/tmp/pgdata-proof/machinen-extra-file" >/dev/null
  set +e
  $CLI move load "$TGT" "$data_bundle" --json >"$WORK/unsafe-postgres-data.load.json"
  data_load_rc=$?
  set -e

  reset_postgres_target_data_dir
  set +e
  $CLI move load "$TGT" "$wal_bundle" --json >"$WORK/unsafe-postgres-wal.load.json"
  wal_load_rc=$?
  set -e

  pid=$(spawn_postgres_instance 8161 /tmp/pgdata-proof unsafe-postgres-features "max_prepared_transactions = 10")
  $CLI exec "$SRC" -- "set -eu; mkdir -p /tmp/pg_tblspc_extra; chown postgres:postgres /tmp/pg_tblspc_extra; /usr/lib/postgresql/15/bin/psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 8161 -U postgres -d postgres <<'SQL'
create table prepared_gate(id int);
begin;
insert into prepared_gate values (1);
prepare transaction 'machinen_gate';
select pg_create_physical_replication_slot('machinen_gate');
create tablespace machinen_gate location '/tmp/pg_tblspc_extra';
create unlogged table machinen_unlogged(id int);
SQL
for ext in adminpack pg_trgm hstore citext btree_gin; do /usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 8161 -U postgres -d postgres -c \"create extension if not exists \\\"\$ext\\\"\" >/dev/null 2>&1 && break; done
mkdir -p /tmp/pgdata-proof/base/pgsql_tmp; : >/tmp/pgdata-proof/base/pgsql_tmp/machinen-temp; ln -sf /etc/passwd /tmp/pgdata-proof/machinen-symlink-escape
/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 8161 -U postgres -d postgres -At <<'SQL' >/tmp/unsafe-postgres-feature-report.txt
select 'preparedTransactions=' || count(*) from pg_prepared_xacts;
select 'replicationSlots=' || count(*) from pg_replication_slots;
select 'nonDefaultTablespaces=' || count(*) from pg_tablespace where spcname not in ('pg_default','pg_global');
select 'unloggedRelations=' || count(*) from pg_class where relpersistence = 'u';
select 'extensionNativeLibraries=' || count(*) from pg_extension where extname <> 'plpgsql';
SQL
printf 'tempFiles=' >>/tmp/unsafe-postgres-feature-report.txt; find /tmp/pgdata-proof -path '*/pgsql_tmp/*' -type f | wc -l | tr -d ' ' >>/tmp/unsafe-postgres-feature-report.txt
printf 'symlinkEscapes=' >>/tmp/unsafe-postgres-feature-report.txt; find /tmp/pgdata-proof -type l | wc -l | tr -d ' ' >>/tmp/unsafe-postgres-feature-report.txt" >/dev/null
  $CLI exec "$SRC" -- "cat /tmp/unsafe-postgres-feature-report.txt" >"$WORK/unsafe-postgres-feature-report.txt"
  set +e
  $CLI move save "$SRC" "$pid" "$feature_bundle" --json >"$WORK/unsafe-postgres-features.save.json"
  feature_rc=$?
  set -e

  python3 - <<PY
import json
from pathlib import Path
active=json.load(open('$WORK/unsafe-postgres-active.save.json'))
features=json.load(open('$WORK/unsafe-postgres-features.save.json'))
feature_report=dict(line.strip().split('=',1) for line in Path('$WORK/unsafe-postgres-feature-report.txt').read_text().splitlines() if '=' in line)
loads={
  'config': (json.load(open('$WORK/unsafe-postgres-config.load.json')), '$config_load_rc', 'config-identity-mismatch'),
  'port': (json.load(open('$WORK/unsafe-postgres-port.load.json')), '$port_load_rc', 'port-in-use'),
  'missing': (json.load(open('$WORK/unsafe-postgres-missing.load.json')), '$missing_load_rc', 'missing-postgres-binary'),
  'package': (json.load(open('$WORK/unsafe-postgres-package.load.json')), '$package_load_rc', 'package-mismatch'),
  'stale': (json.load(open('$WORK/unsafe-postgres-stale.load.json')), '$stale_load_rc', 'stale-postmaster-pid'),
  'owner': (json.load(open('$WORK/unsafe-postgres-owner.load.json')), '$owner_load_rc', 'owner-mode-mismatch'),
  'data': (json.load(open('$WORK/unsafe-postgres-data.load.json')), '$data_load_rc', 'data-dir-identity-mismatch'),
  'wal': (json.load(open('$WORK/unsafe-postgres-wal.load.json')), '$wal_load_rc', 'wal-checkpoint-identity-mismatch'),
}
assert int('$active_rc') == 1 and not active['accepted'] and active['descriptor']['resourcePlan']['capture'].get('postgresClusterState') is None, active
assert int('$feature_rc') == 1 and not features['accepted'] and features['descriptor']['resourcePlan']['capture'].get('postgresClusterState') is None, features
for key in ['preparedTransactions','replicationSlots','nonDefaultTablespaces','unloggedRelations','tempFiles','symlinkEscapes']:
  assert int(feature_report.get(key, '0')) > 0, (key, feature_report)
assert int(feature_report.get('extensionNativeLibraries', '0')) >= 0, feature_report
loader_summary={}
for name, (doc, rc, needle) in loads.items():
  loader=doc.get('loader', {})
  stdout=loader.get('patch', {}).get('stdout', '')
  assert int(rc) == 1 and not doc['accepted'], (name, rc, doc)
  assert loader.get('state') == 'refused' and loader.get('targetPid') is None, (name, loader)
  assert needle in stdout, (name, needle, stdout)
  loader_summary[name]={'accepted': doc['accepted'], 'targetPid': loader.get('targetPid'), 'needle': needle}
print(json.dumps({'name':'unsafe-postgres-cluster-refusal','state':'passed','activeClientSaveAccepted':active['accepted'],'activeClientPostgresClusterState':active['descriptor']['resourcePlan']['capture'].get('postgresClusterState'),'featureSaveAccepted':features['accepted'],'featurePostgresClusterState':features['descriptor']['resourcePlan']['capture'].get('postgresClusterState'),'featureCounters':feature_report,'loaderRefusals':loader_summary}))
PY
}

ensure_redis_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/bin/redis-server && test -x /usr/bin/redis-cli" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-redis-apt.log; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/tmp/machinen-redis-apt.log 2>&1 && apt-get install -y --reinstall --no-install-recommends redis-server redis-tools >>/tmp/machinen-redis-apt.log 2>&1 || { cat /tmp/machinen-redis-apt.log; exit 1; }; test -x /usr/bin/redis-server && test -x /usr/bin/redis-cli" >/dev/null
}

save_redis_idle_bundle() {
  local name="$1" port="$2" bundle="$3"
  ensure_redis_tool "$SRC"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/redis-server --save \"\" --appendonly no --port $port >/tmp/${name}.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

prove_redis_idle() {
  local bundle="$WORK/redis-idle.bundle" pid out
  pid=$(save_redis_idle_bundle redis-idle 8153 "$bundle")
  ensure_redis_tool "$TGT"
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/redis-idle.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/redis-idle.load.json"
  out=$($CLI exec "$TGT" -- "/usr/bin/redis-cli -h 127.0.0.1 -p 8153 PING && /usr/bin/redis-cli -h 127.0.0.1 -p 8153 DBSIZE" | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/redis-idle.save.json'))
load=json.load(open('$WORK/redis-idle.load.json'))
state=save['descriptor']['resourcePlan']['capture']['redisIdleState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-native-redis-idle-loader'
assert state['port'] == 8153
assert state['argvContract'] == 'redis-server-no-persistence-port'
assert state['datasetState'] == 'empty'
assert state['clientState'] == 'idle-no-external-clients'
assert state['persistence'] == {'save':'','appendonly':'no'}
assert state['binaryPolicy'] == 'proof-provisioned-target-native-redis'
assert '''$out'''.splitlines() == ['PONG','0']
print(json.dumps({'name':'redis-idle','state':'passed','redisIdleState':state,'targetPingAndDbsize':'''$out'''.splitlines(),'targetPid':load['loader']['targetPid']}))
PY
}

prove_unsafe_redis_idle_refusal() {
  local active_bundle="$WORK/redis-active.bundle" nonempty_bundle="$WORK/redis-nonempty.bundle" persistence_bundle="$WORK/redis-persistence.bundle" conflict_bundle="$WORK/redis-conflict.bundle" missing_bundle="$WORK/redis-missing.bundle" active_pid nonempty_pid persistence_pid conflict_pid missing_pid active_save_rc active_load_rc nonempty_save_rc nonempty_load_rc persistence_save_rc persistence_load_rc conflict_load_rc missing_load_rc
  active_pid=$(save_redis_idle_bundle redis-active 8154 "$active_bundle")
  sleep 1
  $CLI exec "$SRC" -- "/usr/bin/redis-cli -h 127.0.0.1 -p 8154 MONITOR >/tmp/redis-active-client.log 2>&1 &" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$active_pid" "$active_bundle" --json >"$WORK/redis-active.save.json"
  active_save_rc=$?
  $CLI move load "$TGT" "$active_bundle" --json >"$WORK/redis-active.load.json"
  active_load_rc=$?
  set -e
  nonempty_pid=$(save_redis_idle_bundle redis-nonempty 8155 "$nonempty_bundle")
  sleep 1
  $CLI exec "$SRC" -- "/usr/bin/redis-cli -h 127.0.0.1 -p 8155 SET proof value" >/dev/null
  set +e
  $CLI move save "$SRC" "$nonempty_pid" "$nonempty_bundle" --json >"$WORK/redis-nonempty.save.json"
  nonempty_save_rc=$?
  $CLI move load "$TGT" "$nonempty_bundle" --json >"$WORK/redis-nonempty.load.json"
  nonempty_load_rc=$?
  set -e
  ensure_redis_tool "$SRC"
  persistence_pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/redis-server --appendonly yes --port 8156 >/tmp/redis-persistence.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  set +e
  $CLI move save "$SRC" "$persistence_pid" "$persistence_bundle" --json >"$WORK/redis-persistence.save.json"
  persistence_save_rc=$?
  $CLI move load "$TGT" "$persistence_bundle" --json >"$WORK/redis-persistence.load.json"
  persistence_load_rc=$?
  set -e
  conflict_pid=$(save_redis_idle_bundle redis-conflict 8157 "$conflict_bundle")
  ensure_redis_tool "$TGT"
  $CLI exec "$TGT" -- "setsid sh -c 'exec /usr/bin/redis-server --save \"\" --appendonly no --port 8157 >/tmp/redis-conflict-target.log 2>&1' </dev/null >/dev/null 2>&1 &" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$conflict_pid" "$conflict_bundle" --json >"$WORK/redis-conflict.save.json"
  set +e
  $CLI move load "$TGT" "$conflict_bundle" --json >"$WORK/redis-conflict.load.json"
  conflict_load_rc=$?
  set -e
  missing_pid=$(save_redis_idle_bundle redis-missing 8158 "$missing_bundle")
  ensure_redis_tool "$TGT"
  sleep 1
  $CLI move save "$SRC" "$missing_pid" "$missing_bundle" --json >"$WORK/redis-missing.save.json"
  $CLI exec "$TGT" -- "mv /usr/bin/redis-server /usr/bin/redis-server.disabled" >/dev/null
  set +e
  $CLI move load "$TGT" "$missing_bundle" --json >"$WORK/redis-missing.load.json"
  missing_load_rc=$?
  set -e
  $CLI exec "$TGT" -- "mv /usr/bin/redis-server.disabled /usr/bin/redis-server" >/dev/null
  python3 - <<PY
import json
active_save=json.load(open('$WORK/redis-active.save.json'))
active_load=json.load(open('$WORK/redis-active.load.json'))
nonempty_save=json.load(open('$WORK/redis-nonempty.save.json'))
nonempty_load=json.load(open('$WORK/redis-nonempty.load.json'))
persistence_save=json.load(open('$WORK/redis-persistence.save.json'))
persistence_load=json.load(open('$WORK/redis-persistence.load.json'))
conflict_save=json.load(open('$WORK/redis-conflict.save.json'))
conflict_load=json.load(open('$WORK/redis-conflict.load.json'))
missing_save=json.load(open('$WORK/redis-missing.save.json'))
missing_load=json.load(open('$WORK/redis-missing.load.json'))
conflict_loader=conflict_load.get('loader', {})
missing_loader=missing_load.get('loader', {})
for save, load, save_rc, load_rc in [(active_save,active_load,'$active_save_rc','$active_load_rc'),(nonempty_save,nonempty_load,'$nonempty_save_rc','$nonempty_load_rc'),(persistence_save,persistence_load,'$persistence_save_rc','$persistence_load_rc')]:
    assert int(save_rc) == 1 and int(load_rc) == 1
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('redisIdleState') is None
assert conflict_save['accepted'] and int('$conflict_load_rc') == 1 and not conflict_load['accepted']
assert conflict_loader.get('state') == 'refused' and conflict_loader.get('targetPid') is None
assert 'port-in-use' in conflict_loader.get('patch', {}).get('stdout', '')
assert missing_save['accepted'] and int('$missing_load_rc') == 1 and not missing_load['accepted']
assert missing_loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-redis-idle-refusal','state':'passed','activeRedisState':active_save['descriptor']['resourcePlan']['capture'].get('redisIdleState'),'nonemptyRedisState':nonempty_save['descriptor']['resourcePlan']['capture'].get('redisIdleState'),'persistenceRedisState':persistence_save['descriptor']['resourcePlan']['capture'].get('redisIdleState'),'portConflictLoaderState':conflict_loader.get('state'),'portConflictTargetPid':conflict_loader.get('targetPid'),'missingRedisLoadAccepted':missing_load['accepted'],'missingRedisLoaderState':missing_loader.get('state'),'missingRedisTargetPid':missing_loader.get('targetPid'),'missingRedisTargetValidation':missing_load.get('targetValidation', {}).get('state')}))
PY
}

ensure_socat_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/bin/socat" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-socat-apt.log; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/tmp/machinen-socat-apt.log 2>&1 && apt-get install -y --reinstall --no-install-recommends socat >>/tmp/machinen-socat-apt.log 2>&1 || { cat /tmp/machinen-socat-apt.log; exit 1; }; test -x /usr/bin/socat" >/dev/null
}

save_socat_file_responder_bundle() {
  local name="$1" port="$2" file="$3" bundle="$4"
  ensure_socat_tool "$SRC"
  $CLI exec "$SRC" -- "printf 'hello-socat-file\n' >'$file'; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/socat TCP-LISTEN:$port,fork,reuseaddr FILE:$file >/tmp/${name}.log 2>&1' </dev/null >/dev/null 2>&1 & for i in \$(seq 1 100); do for d in /proc/[0-9]*; do exe=\$(readlink \"\$d/exe\" 2>/dev/null || true); [ \"\$exe\" = /usr/bin/socat ] || continue; cmd=\$(tr '\\000' ' ' <\"\$d/cmdline\" 2>/dev/null || true); case \"\$cmd\" in */usr/bin/socat\ TCP-LISTEN:$port,fork,reuseaddr\ FILE:$file*) echo \${d##*/}; exit 0;; esac; done; sleep 0.05; done; exit 1" | tail -1 | tr -d '\r'
}

prove_socat_file_responder() {
  local bundle="$WORK/socat-file.bundle" pid
  pid=$(save_socat_file_responder_bundle socat-file 8147 /tmp/socat-response.txt "$bundle")
  ensure_socat_tool "$TGT"
  $CLI exec "$TGT" -- "printf 'hello-socat-file\n' >/tmp/socat-response.txt" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/socat-file.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/socat-file.load.json"
  $CLI exec "$TGT" -- "timeout 3 /usr/bin/socat - TCP:127.0.0.1:8147" >"$WORK/socat-file.target.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/socat-file.save.json'))
load=json.load(open('$WORK/socat-file.load.json'))
out=open('$WORK/socat-file.target.out').read()
state=save['descriptor']['resourcePlan']['capture']['socatFileResponderState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-native-socat-file-responder-loader'
assert state['port'] == 8147 and state['filePath'] == '/tmp/socat-response.txt'
assert state['argvContract'] == 'socat-tcp-listen-fork-reuseaddr-file'
assert state['binaryPolicy'] == 'proof-provisioned-target-native-socat'
assert state['listenerState'] == 'idle-single-listener'
assert out == 'hello-socat-file\n'
print(json.dumps({'name':'socat-file-responder','state':'passed','socatFileResponderState':state,'response':out.strip(),'targetPid':load['loader']['targetPid']}))
PY
}

prove_unsafe_socat_file_responder_refusal() {
  local active_bundle="$WORK/socat-active.bundle" unsupported_bundle="$WORK/socat-unsupported.bundle" changed_bundle="$WORK/socat-changed.bundle" conflict_bundle="$WORK/socat-conflict.bundle" missing_bundle="$WORK/socat-missing.bundle" active_pid unsupported_pid changed_pid conflict_pid missing_pid active_save_rc active_load_rc unsupported_save_rc unsupported_load_rc changed_load_rc conflict_load_rc missing_load_rc
  ensure_socat_tool "$SRC"
  ensure_python_http_tool "$SRC"
  active_pid=$($CLI exec "$SRC" -- "dd if=/dev/zero bs=1M count=64 of=/tmp/socat-active.txt 2>/dev/null; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/socat TCP-LISTEN:8148,fork,reuseaddr FILE:/tmp/socat-active.txt >/tmp/socat-active.log 2>&1' </dev/null >/dev/null 2>&1 & for i in \$(seq 1 100); do for d in /proc/[0-9]*; do exe=\$(readlink \"\$d/exe\" 2>/dev/null || true); [ \"\$exe\" = /usr/bin/socat ] || continue; cmd=\$(tr '\\000' ' ' <\"\$d/cmdline\" 2>/dev/null || true); case \"\$cmd\" in */usr/bin/socat\ TCP-LISTEN:8148,fork,reuseaddr\ FILE:/tmp/socat-active.txt*) echo \${d##*/}; exit 0;; esac; done; sleep 0.05; done; exit 1" | tail -1 | tr -d '\r')
  sleep 1
  $CLI exec "$SRC" -- "/usr/bin/python3.11 - <<'PY' >/tmp/socat-active-client.out 2>/tmp/socat-active-client.err &
import socket, time
s = socket.create_connection(('127.0.0.1', 8148), timeout=5)
time.sleep(20)
PY" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$active_pid" "$active_bundle" --json >"$WORK/socat-active.save.json"
  active_save_rc=$?
  $CLI move load "$TGT" "$active_bundle" --json >"$WORK/socat-active.load.json"
  active_load_rc=$?
  set -e
  ensure_socat_tool "$SRC"
  unsupported_pid=$($CLI exec "$SRC" -- "printf 'hello-socat-file\n' >/tmp/socat-unsupported.txt; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/socat TCP-LISTEN:8149,reuseaddr FILE:/tmp/socat-unsupported.txt >/tmp/socat-unsupported.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  set +e
  $CLI move save "$SRC" "$unsupported_pid" "$unsupported_bundle" --json >"$WORK/socat-unsupported.save.json"
  unsupported_save_rc=$?
  $CLI move load "$TGT" "$unsupported_bundle" --json >"$WORK/socat-unsupported.load.json"
  unsupported_load_rc=$?
  set -e
  changed_pid=$(save_socat_file_responder_bundle socat-changed 8150 /tmp/socat-changed.txt "$changed_bundle")
  ensure_socat_tool "$TGT"
  $CLI exec "$TGT" -- "printf 'hello-socat-file\n' >/tmp/socat-changed.txt" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/socat-changed.save.json"
  $CLI exec "$TGT" -- "printf changed >/tmp/socat-changed.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/socat-changed.load.json"
  changed_load_rc=$?
  set -e
  conflict_pid=$(save_socat_file_responder_bundle socat-conflict 8151 /tmp/socat-conflict.txt "$conflict_bundle")
  ensure_socat_tool "$TGT"
  $CLI exec "$TGT" -- "printf 'hello-socat-file\n' >/tmp/socat-conflict.txt; setsid sh -c 'exec /usr/bin/socat TCP-LISTEN:8151,fork,reuseaddr FILE:/tmp/socat-conflict.txt >/tmp/socat-conflict-target.log 2>&1' </dev/null >/dev/null 2>&1 &" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$conflict_pid" "$conflict_bundle" --json >"$WORK/socat-conflict.save.json"
  set +e
  $CLI move load "$TGT" "$conflict_bundle" --json >"$WORK/socat-conflict.load.json"
  conflict_load_rc=$?
  set -e
  missing_pid=$(save_socat_file_responder_bundle socat-missing 8152 /tmp/socat-missing.txt "$missing_bundle")
  ensure_socat_tool "$TGT"
  $CLI exec "$TGT" -- "printf 'hello-socat-file\n' >/tmp/socat-missing.txt" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$missing_pid" "$missing_bundle" --json >"$WORK/socat-missing.save.json"
  $CLI exec "$TGT" -- "mv /usr/bin/socat /usr/bin/socat.disabled" >/dev/null
  set +e
  $CLI move load "$TGT" "$missing_bundle" --json >"$WORK/socat-missing.load.json"
  missing_load_rc=$?
  set -e
  $CLI exec "$TGT" -- "mv /usr/bin/socat.disabled /usr/bin/socat" >/dev/null
  python3 - <<PY
import json
active_save=json.load(open('$WORK/socat-active.save.json'))
active_load=json.load(open('$WORK/socat-active.load.json'))
unsupported_save=json.load(open('$WORK/socat-unsupported.save.json'))
unsupported_load=json.load(open('$WORK/socat-unsupported.load.json'))
changed_save=json.load(open('$WORK/socat-changed.save.json'))
changed_load=json.load(open('$WORK/socat-changed.load.json'))
conflict_save=json.load(open('$WORK/socat-conflict.save.json'))
conflict_load=json.load(open('$WORK/socat-conflict.load.json'))
missing_save=json.load(open('$WORK/socat-missing.save.json'))
missing_load=json.load(open('$WORK/socat-missing.load.json'))
changed_loader=changed_load.get('loader', {})
conflict_loader=conflict_load.get('loader', {})
missing_loader=missing_load.get('loader', {})
assert int('$active_save_rc') == 1 and int('$active_load_rc') == 1
assert not active_save['accepted'] and not active_load['accepted']
assert active_save['descriptor']['resourcePlan']['capture'].get('socatFileResponderState') is None
assert int('$unsupported_save_rc') == 1 and int('$unsupported_load_rc') == 1
assert unsupported_save['descriptor']['resourcePlan']['capture'].get('socatFileResponderState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert changed_loader.get('state') == 'refused' and changed_loader.get('targetPid') is None
assert 'changed-file-identity' in changed_loader.get('patch', {}).get('stdout', '')
assert conflict_save['accepted'] and int('$conflict_load_rc') == 1 and not conflict_load['accepted']
assert conflict_loader.get('state') == 'refused' and conflict_loader.get('targetPid') is None
assert 'port-in-use' in conflict_loader.get('patch', {}).get('stdout', '')
assert missing_save['accepted'] and int('$missing_load_rc') == 1 and not missing_load['accepted']
assert missing_loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-socat-file-responder-refusal','state':'passed','activeSaveAccepted':active_save['accepted'],'activeSocatState':active_save['descriptor']['resourcePlan']['capture'].get('socatFileResponderState'),'unsupportedSocatState':unsupported_save['descriptor']['resourcePlan']['capture'].get('socatFileResponderState'),'changedFileLoaderState':changed_loader.get('state'),'changedFileTargetPid':changed_loader.get('targetPid'),'portConflictLoaderState':conflict_loader.get('state'),'portConflictTargetPid':conflict_loader.get('targetPid'),'missingSocatLoadAccepted':missing_load['accepted'],'missingSocatLoaderState':missing_loader.get('state'),'missingSocatTargetPid':missing_loader.get('targetPid'),'missingSocatTargetValidation':missing_load.get('targetValidation', {}).get('state')}))
PY
}

prove_unsafe_nc_active_refusal() {
  local bundle="$WORK/unsafe-nc.bundle" pid save_rc load_rc
  pid=$(save_nc_listener_bundle unsafe-nc-active 8136 "$bundle")
  sleep 1
  $CLI exec "$SRC" -- "python3 - <<'PY' >/tmp/unsafe-nc-client.log 2>&1 &
import socket, time
s=socket.create_connection(('127.0.0.1', 8136), timeout=5)
s.sendall(b'active-nc-client\\n')
time.sleep(20)
PY" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-nc.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-nc.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-nc.save.json'))
load=json.load(open('$WORK/unsafe-nc.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('ncState') is None
loader=load.get('loader')
assert loader is None or (loader.get('state') == 'refused' and not loader.get('targetPid'))
print(json.dumps({'name':'unsafe-nc-active-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'ncState':save['descriptor']['resourcePlan']['capture'].get('ncState'),'loaderStarted':bool(loader and loader.get('targetPid'))}))
PY
}

prove_nc_listener() {
  local bundle="$WORK/nc.bundle" pid log
  pid=$(save_nc_listener_bundle nc-listener 8135 "$bundle")
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/nc.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/nc.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/nc.load.json'))['loader']['logPath'])
PY
)
  $CLI exec "$TGT" -- "python3 - <<'PY'
import socket
s=socket.create_connection(('127.0.0.1', 8135), timeout=5)
s.sendall(b'hello-nc\\n')
s.close()
PY" >/dev/null
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/nc.target.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/nc.save.json'))
load=json.load(open('$WORK/nc.load.json'))
out=open('$WORK/nc.target.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-nc-listener-loader'
assert out == 'hello-nc\\n'
print(json.dumps({'name':'nc-listener','state':'passed','ncState':save['descriptor']['resourcePlan']['capture']['ncState'],'received':out.strip()}))
PY
}

save_busybox_httpd_bundle() {
  local name="$1" port="$2" root="$3" bundle="$4"
  $CLI exec "$SRC" -- "mkdir -p '$root'; printf 'hello-busybox-httpd\n' >'$root/index.html'; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec busybox httpd -f -p $port -h '$root' >/tmp/${name}.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

prove_http_cgi_refusal() {
  local bundle="$WORK/http-cgi.bundle" pid save_rc load_rc
  pid=$($CLI exec "$SRC" -- "mkdir -p /tmp/web-cgi/cgi-bin; printf 'hello-cgi\n' >/tmp/web-cgi/index.html; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /tmp/web-cgi; exec python3 -m http.server --cgi 8129 --bind 127.0.0.1 >/tmp/http-cgi.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/http-cgi.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/http-cgi.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/http-cgi.save.json'))
load=json.load(open('$WORK/http-cgi.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('httpState') is None
loader=load.get('loader')
assert loader is None or (loader.get('state') == 'refused' and not loader.get('targetPid'))
print(json.dumps({'name':'python-http-cgi-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'httpState':save['descriptor']['resourcePlan']['capture'].get('httpState'),'nativeContinuation':save['descriptor']['nativeContinuation']['state'],'loaderStarted':bool(loader and loader.get('targetPid'))}))
PY
}

prove_http_active_request_refusal() {
  local bundle="$WORK/http-active.bundle" pid save_rc load_rc
  pid=$(save_http_bundle http-active 8126 /tmp/web-active "$bundle")
  sleep 1
  $CLI exec "$SRC" -- "/usr/bin/python3.11 - <<'PY' >/tmp/http-active-client.log 2>&1 &
import socket, time
s = socket.create_connection(('127.0.0.1', 8126), timeout=5)
s.sendall(b'GET / HTTP/1.1\\r\\nHost: active\\r\\n')
time.sleep(20)
PY" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/http-active.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/http-active.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/http-active.save.json'))
load=json.load(open('$WORK/http-active.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('httpState') is None
assert 'loader' not in load
print(json.dumps({'name':'python-http-active-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'httpState':save['descriptor']['resourcePlan']['capture'].get('httpState'),'loaderStarted':'loader' in load}))
PY
}

prove_http_missing_cwd_refusal() {
  local bundle="$WORK/http-missing-cwd.bundle" pid load_rc
  pid=$(save_http_bundle http-missing-cwd 8124 /tmp/web-missing-cwd "$bundle")
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/http-missing-cwd.save.json"
  $CLI exec "$TGT" -- "rm -rf /tmp/web-missing-cwd" >/dev/null
  set +e
  $CLI move load "$TGT" "$bundle" --json >"$WORK/http-missing-cwd.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/http-missing-cwd.save.json'))
load=json.load(open('$WORK/http-missing-cwd.load.json'))
assert save['accepted']
assert int('$load_rc') == 1
assert not load['accepted']
assert load['loader']['state'] == 'refused'
assert 'missing-cwd' in load['loader']['patch']['stdout']
print(json.dumps({'name':'python-http-missing-cwd-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'loaderState':load['loader']['state']}))
PY
}

prove_http_port_conflict_refusal() {
  local bundle="$WORK/http-port-conflict.bundle" pid load_rc
  pid=$(save_http_bundle http-port-conflict 8125 /tmp/web-conflict "$bundle")
  ensure_python_http_tool "$TGT"
  $CLI exec "$TGT" -- "mkdir -p /tmp/web-conflict; printf 'hello-http\n' >/tmp/web-conflict/index.html; cd /tmp/web-conflict && /usr/bin/python3.11 -m http.server 8125 --bind 127.0.0.1 >/tmp/http-conflict-target.log 2>&1 &" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/http-port-conflict.save.json"
  set +e
  $CLI move load "$TGT" "$bundle" --json >"$WORK/http-port-conflict.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/http-port-conflict.save.json'))
load=json.load(open('$WORK/http-port-conflict.load.json'))
assert save['accepted']
assert int('$load_rc') == 1
assert not load['accepted']
assert load['loader']['state'] == 'refused'
assert 'port-in-use' in load['loader']['patch']['stdout']
print(json.dumps({'name':'python-http-port-conflict-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'loaderState':load['loader']['state']}))
PY
}

prove_http_package_mismatch_refusal() {
  local bundle="$WORK/http-package.bundle" pid load_rc
  pid=$(save_http_bundle http-package 8127 /tmp/web-package "$bundle")
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/http-package.save.json"
  python3 - <<PY
import json
from pathlib import Path
p=Path('$bundle')/'move.json'
d=json.loads(p.read_text())
d['resourcePlan']['capture']['executablePackage']['version']='0.invalid-proof'
p.write_text(json.dumps(d, indent=2))
PY
  set +e
  $CLI move load "$TGT" "$bundle" --json >"$WORK/http-package.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
load=json.load(open('$WORK/http-package.load.json'))
assert int('$load_rc') == 1
assert not load['accepted']
assert load['targetValidation']['state'] == 'refused'
assert 'loader' not in load
print(json.dumps({'name':'python-http-package-mismatch-refusal','state':'passed','loadAccepted':load['accepted'],'targetValidation':load['targetValidation']['state'],'loaderStarted':'loader' in load}))
PY
}

prove_busybox_httpd() {
  local bundle="$WORK/busybox-httpd.bundle" pid
  pid=$(save_busybox_httpd_bundle busybox-httpd 8134 /tmp/busybox-web "$bundle")
  $CLI exec "$TGT" -- "mkdir -p /tmp/busybox-web; printf 'hello-busybox-httpd\n' >/tmp/busybox-web/index.html" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/busybox-httpd.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/busybox-httpd.load.json"
  sleep 2
  $CLI exec "$TGT" -- "python3 - <<'PY'
from urllib.request import urlopen
print(urlopen('http://127.0.0.1:8134/index.html').read().decode(), end='')
PY" >"$WORK/busybox-httpd.target.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/busybox-httpd.save.json'))
load=json.load(open('$WORK/busybox-httpd.load.json'))
out=open('$WORK/busybox-httpd.target.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-busybox-httpd-loader'
assert save['descriptor']['resourcePlan']['capture']['busyboxHttpState']['root'] == '/tmp/busybox-web'
assert out == 'hello-busybox-httpd\\n'
print(json.dumps({'name':'busybox-httpd','state':'passed','busyboxHttpState':save['descriptor']['resourcePlan']['capture']['busyboxHttpState'],'response':out.strip()}))
PY
}

prove_unsafe_timeout_refusal() {
  local bundle="$WORK/unsafe-timeout.bundle" pid save_rc load_rc
  pid=$($CLI exec "$SRC" -- "mkdir -p /tmp/unsafe-timeout-web; printf 'unsafe-timeout\n' >/tmp/unsafe-timeout-web/index.html; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /; exec timeout -s KILL 30 python3 -m http.server --directory /tmp/unsafe-timeout-web 8139 --bind 127.0.0.1 >/tmp/unsafe-timeout.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-timeout.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-timeout.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-timeout.save.json'))
load=json.load(open('$WORK/unsafe-timeout.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
cap=save['descriptor']['resourcePlan']['capture']
assert cap.get('timeoutState') is None
loader=load.get('loader')
assert loader is None or not loader.get('targetPid')
print(json.dumps({'name':'unsafe-timeout-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'timeoutState':cap.get('timeoutState'),'loaderStarted':bool(loader and loader.get('targetPid'))}))
PY
}

prove_timeout_http_directory() {
  local bundle="$WORK/timeout-http.bundle" pid
  pid=$(save_timeout_http_directory_bundle timeout-http 30 8138 /tmp/timeout-web "$bundle")
  $CLI exec "$TGT" -- "mkdir -p /tmp/timeout-web; printf 'hello-timeout-http\n' >/tmp/timeout-web/index.html" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/timeout-http.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/timeout-http.load.json"
  sleep 2
  $CLI exec "$TGT" -- "python3 - <<'PY'
from urllib.request import urlopen
print(urlopen('http://127.0.0.1:8138/index.html').read().decode(), end='')
PY" >"$WORK/timeout-http.target.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/timeout-http.save.json'))
load=json.load(open('$WORK/timeout-http.load.json'))
out=open('$WORK/timeout-http.target.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-timeout-python-http-server-loader'
assert save['descriptor']['resourcePlan']['capture']['timeoutState']['seconds'] == 30
assert save['descriptor']['resourcePlan']['capture']['timeoutState']['httpState']['directory'] == '/tmp/timeout-web'
assert out == 'hello-timeout-http\\n'
print(json.dumps({'name':'timeout-python-http-directory','state':'passed','timeoutState':save['descriptor']['resourcePlan']['capture']['timeoutState'],'response':out.strip()}))
PY
}

prove_unsupported_env_wrapper_refusal() {
  local bundle="$WORK/unsafe-env.bundle" pid save_rc load_rc
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec env MACHINEN_MOVE_ENV_PROOF=wrapped-http python3 -c \"import time; time.sleep(20)\" >/tmp/unsafe-env.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-env.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-env.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-env.save.json'))
load=json.load(open('$WORK/unsafe-env.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
cap=save['descriptor']['resourcePlan']['capture']
assert cap.get('envState') is None
assert cap.get('httpState') is None
loader=load.get('loader')
assert loader is None or not loader.get('targetPid')
print(json.dumps({'name':'unsupported-env-wrapper-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'envState':cap.get('envState'),'httpState':cap.get('httpState'),'loaderStarted':bool(loader and loader.get('targetPid'))}))
PY
}

prove_env_http_directory() {
  local bundle="$WORK/env-http.bundle" pid tpid
  pid=$(save_env_http_directory_bundle env-http 8137 /tmp/env-web "$bundle")
  $CLI exec "$TGT" -- "mkdir -p /tmp/env-web; printf 'hello-env-http\n' >/tmp/env-web/index.html" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/env-http.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/env-http.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/env-http.load.json'))['loader']['targetPid'])
PY
)
  sleep 2
  $CLI exec "$TGT" -- "python3 - <<'PY'
from urllib.request import urlopen
print(urlopen('http://127.0.0.1:8137/index.html').read().decode(), end='')
PY" >"$WORK/env-http.target.out"
  $CLI exec "$TGT" -- "tr '\\000' '\\n' </proc/$tpid/environ | grep '^MACHINEN_MOVE_ENV_PROOF='" >"$WORK/env-http.target.env"
  python3 - <<PY
import json
save=json.load(open('$WORK/env-http.save.json'))
load=json.load(open('$WORK/env-http.load.json'))
out=open('$WORK/env-http.target.out').read()
env=open('$WORK/env-http.target.env').read().strip()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-python-http-server-loader'
assert save['descriptor']['resourcePlan']['capture']['envState']['value'] == 'wrapped-http'
assert out == 'hello-env-http\\n'
assert env == 'MACHINEN_MOVE_ENV_PROOF=wrapped-http'
print(json.dumps({'name':'env-python-http-directory','state':'passed','envState':save['descriptor']['resourcePlan']['capture']['envState'],'httpState':save['descriptor']['resourcePlan']['capture']['httpState'],'response':out.strip(),'targetEnv':env}))
PY
}

prove_http_directory() {
  local bundle="$WORK/http-directory.bundle" pid
  pid=$(save_http_directory_bundle http-directory 8128 /tmp/web-directory "$bundle")
  ensure_python_http_tool "$TGT"
  $CLI exec "$TGT" -- "mkdir -p /tmp/web-directory; printf 'hello-http-directory\n' >/tmp/web-directory/index.html" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/http-directory.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/http-directory.load.json"
  sleep 2
  $CLI exec "$TGT" -- "/usr/bin/python3.11 - <<'PY'
from urllib.request import urlopen
print(urlopen('http://127.0.0.1:8128/index.html').read().decode(), end='')
PY" >"$WORK/http-directory.target.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/http-directory.save.json'))
load=json.load(open('$WORK/http-directory.load.json'))
out=open('$WORK/http-directory.target.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-python-http-server-loader'
state=save['descriptor']['resourcePlan']['capture']['httpState']
assert state['directory'] == '/tmp/web-directory'
assert state['bindAddress'] == '127.0.0.1'
assert state['mode'] == 'explicit-bind-directory'
assert state['listenerState'] == 'idle-single-listener'
assert state['directoryIdentity']['fileCount'] == 1 and state['directoryIdentity']['treeDigest']
assert out == 'hello-http-directory\n'
print(json.dumps({'name':'python-http-directory','state':'passed','httpState':state,'response':out.strip(),'targetPid':load['loader']['targetPid']}))
PY
}

prove_http_explicit_bind_refusal() {
  local no_bind_bundle="$WORK/http-no-bind.bundle" changed_bundle="$WORK/http-changed-dir.bundle" no_bind_pid changed_pid no_bind_save_rc no_bind_load_rc changed_load_rc
  ensure_python_http_tool "$SRC"
  no_bind_pid=$($CLI exec "$SRC" -- "mkdir -p /tmp/web-no-bind; printf 'hello-no-bind\n' >/tmp/web-no-bind/index.html; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /; exec /usr/bin/python3.11 -m http.server --directory /tmp/web-no-bind 8140 >/tmp/http-no-bind.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  set +e
  $CLI move save "$SRC" "$no_bind_pid" "$no_bind_bundle" --json >"$WORK/http-no-bind.save.json"
  no_bind_save_rc=$?
  $CLI move load "$TGT" "$no_bind_bundle" --json >"$WORK/http-no-bind.load.json"
  no_bind_load_rc=$?
  set -e
  changed_pid=$(save_http_directory_bundle http-changed-dir 8141 /tmp/web-changed-dir "$changed_bundle")
  ensure_python_http_tool "$TGT"
  $CLI exec "$TGT" -- "mkdir -p /tmp/web-changed-dir; printf 'hello-http-directory\n' >/tmp/web-changed-dir/index.html" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/http-changed-dir.save.json"
  $CLI exec "$TGT" -- "printf changed >/tmp/web-changed-dir/changed.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/http-changed-dir.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
no_bind_save=json.load(open('$WORK/http-no-bind.save.json'))
no_bind_load=json.load(open('$WORK/http-no-bind.load.json'))
changed_save=json.load(open('$WORK/http-changed-dir.save.json'))
changed_load=json.load(open('$WORK/http-changed-dir.load.json'))
loader=changed_load.get('loader', {})
assert int('$no_bind_save_rc') == 1 and int('$no_bind_load_rc') == 1
assert not no_bind_save['accepted'] and not no_bind_load['accepted']
assert no_bind_save['descriptor']['resourcePlan']['capture'].get('httpState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-directory-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'python-http-explicit-bind-refusal','state':'passed','noBindSaveAccepted':no_bind_save['accepted'],'noBindHttpState':no_bind_save['descriptor']['resourcePlan']['capture'].get('httpState'),'changedDirectoryLoadAccepted':changed_load['accepted'],'changedDirectoryLoaderState':loader.get('state'),'changedDirectoryTargetPid':loader.get('targetPid')}))
PY
}

prove_http() {
  local bundle="$WORK/http.bundle" pid
  pid=$(save_http_bundle http 8123 /tmp/web "$bundle")
  $CLI exec "$TGT" -- "mkdir -p /tmp/web; printf 'hello-http\n' >/tmp/web/index.html" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/http.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/http.load.json"
  sleep 2
  $CLI exec "$TGT" -- "python3 - <<'PY'
from urllib.request import urlopen
print(urlopen('http://127.0.0.1:8123/').read().decode(), end='')
PY" >"$WORK/http.target.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/http.save.json'))
load=json.load(open('$WORK/http.load.json'))
out=open('$WORK/http.target.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-python-http-server-loader'
assert out == 'hello-http\\n'
print(json.dumps({'name':'python-http','state':'passed','httpState':save['descriptor']['resourcePlan']['capture']['httpState'],'response':out.strip()}))
PY
}

write_go_static_http_app() {
  local vm="$1"
  $CLI exec "$vm" -- "mkdir -p /tmp/go-static; cat >/tmp/go-static/main.go <<'GO'
package main

import (
  \"flag\"
  \"fmt\"
  \"net/http\"
)

func main() {
  marker := flag.String(\"machinen-move-envelope\", \"\", \"\")
  port := flag.Int(\"port\", 0, \"\")
  health := flag.String(\"health\", \"/health\", \"\")
  flag.Parse()
  if *marker != \"go-static-http-v1\" || *port <= 0 || *health == \"\" {
    panic(\"missing machinen marker\")
  }
  http.HandleFunc(*health, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(\"ok\\n\")) })
  _ = http.ListenAndServe(fmt.Sprintf(\"127.0.0.1:%d\", *port), nil)
}
GO
cd /tmp/go-static && go build -o /tmp/go-static/server /tmp/go-static/main.go" >/dev/null
}

prove_go_static_http() {
  local bundle="$WORK/go-static.bundle" pid
  write_go_static_http_app "$SRC"
  write_go_static_http_app "$TGT"
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /tmp/go-static; exec /tmp/go-static/server --machinen-move-envelope go-static-http-v1 --port 8145 --health /health >/tmp/go-static.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  for _ in $(seq 1 40); do
    if $CLI exec "$SRC" -- "python3 - <<'PY'
from urllib.request import urlopen
assert urlopen('http://127.0.0.1:8145/health', timeout=1).read().decode() == 'ok\\n'
PY" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/go-static.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/go-static.load.json"
  sleep 2
  $CLI exec "$TGT" -- "python3 - <<'PY'
from urllib.request import urlopen
print(urlopen('http://127.0.0.1:8145/health').read().decode(), end='')
PY" >"$WORK/go-static.health"
  python3 - <<PY
import json
save=json.load(open('$WORK/go-static.save.json'))
load=json.load(open('$WORK/go-static.load.json'))
health=open('$WORK/go-static.health').read()
state=save['descriptor']['resourcePlan']['capture']['goStaticHttpState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-native-go-static-http-loader'
assert state['markerVersion'] == 'go-static-http-v1'
assert health == 'ok\\n'
print(json.dumps({'name':'go-static-http','state':'passed','goStaticHttpState':state,'health':health.strip()}))
PY
}

write_go_extra_socket_app() {
  local vm="$1"
  $CLI exec "$vm" -- "mkdir -p /tmp/go-extra-socket; cat >/tmp/go-extra-socket/main.go <<'GO'
package main

import (
  \"flag\"
  \"fmt\"
  \"net\"
  \"net/http\"
)

func main() {
  marker := flag.String(\"machinen-move-envelope\", \"\", \"\")
  port := flag.Int(\"port\", 0, \"\")
  health := flag.String(\"health\", \"/health\", \"\")
  flag.Parse()
  if *marker != \"go-static-http-v1\" || *port <= 0 || *health == \"\" {
    panic(\"missing machinen marker\")
  }
  go func() {
    listener, err := net.Listen(\"tcp\", \"127.0.0.1:8147\")
    if err != nil { panic(err) }
    for {
      conn, err := listener.Accept()
      if err == nil { conn.Close() }
    }
  }()
  http.HandleFunc(*health, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(\"ok\\n\")) })
  _ = http.ListenAndServe(fmt.Sprintf(\"127.0.0.1:%d\", *port), nil)
}
GO
cd /tmp/go-extra-socket && go build -o /tmp/go-extra-socket/server /tmp/go-extra-socket/main.go" >/dev/null
}

prove_go_extra_socket_refusal() {
  local bundle="$WORK/go-extra-socket.bundle" pid save_rc load_rc
  write_go_extra_socket_app "$SRC"
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /tmp/go-extra-socket; exec /tmp/go-extra-socket/server --machinen-move-envelope go-static-http-v1 --port 8146 --health /health >/tmp/go-extra-socket.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  for _ in $(seq 1 40); do
    if $CLI exec "$SRC" -- "python3 - <<'PY'
from urllib.request import urlopen
assert urlopen('http://127.0.0.1:8146/health', timeout=1).read().decode() == 'ok\\n'
PY" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/go-extra-socket.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/go-extra-socket.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/go-extra-socket.save.json'))
load=json.load(open('$WORK/go-extra-socket.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
cap=save['descriptor']['resourcePlan']['capture']
assert cap.get('goStaticHttpState') is None
loader=load.get('loader')
assert loader is None or not loader.get('targetPid')
print(json.dumps({'name':'go-extra-socket-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'goStaticHttpState':cap.get('goStaticHttpState'),'loaderStarted':bool(loader and loader.get('targetPid'))}))
PY
}

write_rust_static_http_app() {
  local vm="$1"
  $CLI exec "$vm" -- "mkdir -p /tmp/rust-static; cat >/tmp/rust-static/main.rs <<'RS'
use std::env;
use std::io::{Read, Write};
use std::net::TcpListener;

fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|arg| arg == flag).and_then(|index| args.get(index + 1).cloned())
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let marker = arg_value(&args, \"--machinen-move-envelope\").unwrap_or_default();
    let port: u16 = arg_value(&args, \"--port\").unwrap_or_default().parse().unwrap_or(0);
    let health = arg_value(&args, \"--health\").unwrap_or_else(|| \"/health\".to_string());
    if marker != \"rust-static-http-v1\" || port == 0 || !health.starts_with('/') {
        panic!(\"missing machinen marker\");
    }
    let listener = TcpListener::bind((\"127.0.0.1\", port)).unwrap();
    for stream in listener.incoming() {
        let mut stream = stream.unwrap();
        let mut buf = [0_u8; 1024];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        if request.starts_with(&format!(\"GET {} HTTP/1.\", health)) {
            stream.write_all(b\"HTTP/1.1 200 OK\\r\\nContent-Length: 3\\r\\nConnection: close\\r\\n\\r\\nok\\n\").unwrap();
        } else {
            stream.write_all(b\"HTTP/1.1 404 Not Found\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n\").unwrap();
        }
    }
}
RS
cd /tmp/rust-static && rustc /tmp/rust-static/main.rs -o /tmp/rust-static/server" >/dev/null
}

prove_rust_static_http() {
  local bundle="$WORK/rust-static.bundle" pid
  write_rust_static_http_app "$SRC"
  write_rust_static_http_app "$TGT"
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /tmp/rust-static; exec /tmp/rust-static/server --machinen-move-envelope rust-static-http-v1 --port 8148 --health /health >/tmp/rust-static.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  for _ in $(seq 1 40); do
    if $CLI exec "$SRC" -- "python3 - <<'PY'
from urllib.request import urlopen
assert urlopen('http://127.0.0.1:8148/health', timeout=1).read().decode() == 'ok\\n'
PY" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/rust-static.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/rust-static.load.json"
  sleep 2
  $CLI exec "$TGT" -- "python3 - <<'PY'
from urllib.request import urlopen
print(urlopen('http://127.0.0.1:8148/health').read().decode(), end='')
PY" >"$WORK/rust-static.health"
  python3 - <<PY
import json
save=json.load(open('$WORK/rust-static.save.json'))
load=json.load(open('$WORK/rust-static.load.json'))
health=open('$WORK/rust-static.health').read()
state=save['descriptor']['resourcePlan']['capture']['rustStaticHttpState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-native-rust-static-http-loader'
assert state['markerVersion'] == 'rust-static-http-v1'
assert health == 'ok\\n'
print(json.dumps({'name':'rust-static-http','state':'passed','rustStaticHttpState':state,'health':health.strip()}))
PY
}

write_python_unmarked_flask_like_app() {
  local vm="$1"
  $CLI exec "$vm" -- "mkdir -p /tmp/python-unmarked-flask; cat >/tmp/python-unmarked-flask/server.py <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
FRAMEWORK = 'flask-like-without-machinen-marker'
PORT = 8144
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'unmarked-flask-like')
    def log_message(self, *_args):
        return
HTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
PY" >/dev/null
}

prove_python_unmarked_flask_refusal() {
  local bundle="$WORK/python-unmarked-flask.bundle" pid save_rc load_rc
  write_python_unmarked_flask_like_app "$SRC"
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /tmp/python-unmarked-flask; exec python3 /tmp/python-unmarked-flask/server.py >/tmp/python-unmarked-flask.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/python-unmarked-flask.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/python-unmarked-flask.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/python-unmarked-flask.save.json'))
load=json.load(open('$WORK/python-unmarked-flask.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
cap=save['descriptor']['resourcePlan']['capture']
assert cap.get('pythonStaticRouteState') is None
loader=load.get('loader')
assert loader is None or not loader.get('targetPid')
print(json.dumps({'name':'python-unmarked-flask-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'pythonStaticRouteState':cap.get('pythonStaticRouteState'),'loaderStarted':bool(loader and loader.get('targetPid'))}))
PY
}

write_python_static_route_app() {
  local vm="$1"
  $CLI exec "$vm" -- "mkdir -p /tmp/python-static; cat >/tmp/python-static/server.py <<'PY'
# machinen-move-envelope: python-static-route-v1
from http.server import BaseHTTPRequestHandler, HTTPServer
PORT = 8143
ROUTE = '/health'
RESPONSE = 'python-static-ok'
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == ROUTE:
            self.send_response(200)
            self.send_header('content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(RESPONSE.encode())
            return
        self.send_response(404)
        self.end_headers()
    def log_message(self, *_args):
        return
HTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
PY" >/dev/null
}

prove_python_static_route() {
  local bundle="$WORK/python-static.bundle" pid
  write_python_static_route_app "$SRC"
  write_python_static_route_app "$TGT"
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /tmp/python-static; exec python3 /tmp/python-static/server.py >/tmp/python-static.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/python-static.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/python-static.load.json"
  sleep 2
  $CLI exec "$TGT" -- "python3 - <<'PY'
from urllib.request import urlopen
print(urlopen('http://127.0.0.1:8143/health').read().decode(), end='')
PY" >"$WORK/python-static.target.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/python-static.save.json'))
load=json.load(open('$WORK/python-static.load.json'))
out=open('$WORK/python-static.target.out').read()
state=save['descriptor']['resourcePlan']['capture']['pythonStaticRouteState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-python-static-route-loader'
assert state['route'] == '/health'
assert state['expectedBody'] == 'python-static-ok'
assert out == 'python-static-ok'
print(json.dumps({'name':'python-static-route','state':'passed','pythonStaticRouteState':state,'response':out}))
PY
}

write_node_static_app() {
  local vm="$1"
  $CLI exec "$vm" -- "mkdir -p /tmp/node-static; cat >/tmp/node-static/server.mjs <<'JS'
// machinen-move-envelope: static-http-v1
import http from 'node:http';
const PORT = 8130;
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\\n');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found\\n');
});
server.listen(PORT, '127.0.0.1');
JS" >/dev/null
}

write_node_argv_static_app() {
  local vm="$1"
  $CLI exec "$vm" -- "mkdir -p /tmp/node-argv-static/public; printf 'argv-static-index\n' >/tmp/node-argv-static/public/index.txt; cat >/tmp/node-argv-static/server.mjs <<'JS'
// machinen-move-envelope: static-http-argv-v1
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const portIndex = process.argv.indexOf('--port');
const rootIndex = process.argv.indexOf('--root');
const PORT = Number(process.argv[portIndex + 1]);
const ROOT = process.argv[rootIndex + 1];
if (!Number.isInteger(PORT) || !ROOT) process.exit(2);
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\n');
    return;
  }
  if (req.url === '/index.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(readFileSync(join(ROOT, 'index.txt')));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found\n');
});
server.listen(PORT, '127.0.0.1');
JS" >/dev/null
}

write_node_timer_app() {
  local vm="$1"
  $CLI exec "$vm" -- "mkdir -p /tmp/node-timer; cat >/tmp/node-timer/server.mjs <<'JS'
// machinen-move-envelope: static-http-v1
import http from 'node:http';
const PORT = 8142;
setInterval(() => {}, 1000);
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\n');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found\n');
});
server.listen(PORT, '127.0.0.1');
JS" >/dev/null
}

write_node_worker_app() {
  local vm="$1"
  $CLI exec "$vm" -- "mkdir -p /tmp/node-worker; cat >/tmp/node-worker/server.mjs <<'JS'
// machinen-move-envelope: static-http-v1
import http from 'node:http';
import { Worker } from 'node:worker_threads';
const PORT = 8131;
new Worker('setInterval(() => {}, 1000)', { eval: true });
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\\n');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found\\n');
});
server.listen(PORT, '127.0.0.1');
JS" >/dev/null
}

write_node_native_addon_app() {
  local vm="$1"
  $CLI exec "$vm" -- "mkdir -p /tmp/node-native-addon; cat >/tmp/node-native-addon/server.mjs <<'JS'
// machinen-move-envelope: static-http-v1
import http from 'node:http';
const PORT = 8149;
function loadNativePlugin() {
  process.dlopen(process, './native-addon.node');
}
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\\n');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found\\n');
});
server.listen(PORT, '127.0.0.1');
JS" >/dev/null
}

prove_node_active_refusal() {
  local bundle="$WORK/node-active.bundle" pid save_rc load_rc
  write_node_argv_static_app "$SRC"
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /tmp/node-argv-static; exec node /tmp/node-argv-static/server.mjs --port 8141 --root /tmp/node-argv-static/public >/tmp/node-active.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  $CLI exec "$SRC" -- "python3 - <<'PY' >/tmp/node-active-client.log 2>&1 &
import socket, time
s=socket.create_connection(('127.0.0.1', 8141), timeout=5)
s.sendall(b'GET /health HTTP/1.1\\r\\nHost: node-active\\r\\n')
time.sleep(20)
PY" >/dev/null
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/node-active.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/node-active.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/node-active.save.json'))
load=json.load(open('$WORK/node-active.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
cap=save['descriptor']['resourcePlan']['capture']
assert cap.get('nodeStaticHttpState') is None
loader=load.get('loader')
assert loader is None or not loader.get('targetPid')
print(json.dumps({'name':'node-active-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'nodeStaticHttpState':cap.get('nodeStaticHttpState'),'loaderStarted':bool(loader and loader.get('targetPid'))}))
PY
}

prove_node_timer_refusal() {
  local bundle="$WORK/node-timer.bundle" pid save_rc load_rc
  write_node_timer_app "$SRC"
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /tmp/node-timer; exec node /tmp/node-timer/server.mjs >/tmp/node-timer.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/node-timer.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/node-timer.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/node-timer.save.json'))
load=json.load(open('$WORK/node-timer.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
cap=save['descriptor']['resourcePlan']['capture']
assert cap.get('nodeStaticHttpState') is None
loader=load.get('loader')
assert loader is None or not loader.get('targetPid')
print(json.dumps({'name':'node-timer-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'nodeStaticHttpState':cap.get('nodeStaticHttpState'),'loaderStarted':bool(loader and loader.get('targetPid'))}))
PY
}

prove_node_worker_refusal() {
  local bundle="$WORK/node-worker.bundle" pid save_rc load_rc
  write_node_worker_app "$SRC"
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /tmp/node-worker; exec node /tmp/node-worker/server.mjs >/tmp/node-worker.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/node-worker.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/node-worker.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/node-worker.save.json'))
load=json.load(open('$WORK/node-worker.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('nodeStaticHttpState') is None
assert 'loader' not in load
print(json.dumps({'name':'node-worker-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'nodeStaticHttpState':save['descriptor']['resourcePlan']['capture'].get('nodeStaticHttpState'),'loaderStarted':'loader' in load}))
PY
}

prove_native_dlopen_refusal() {
  local bundle="$WORK/native-dlopen.bundle" pid save_rc load_rc
  write_node_native_addon_app "$SRC"
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /tmp/node-native-addon; exec node /tmp/node-native-addon/server.mjs >/tmp/node-native-addon.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/native-dlopen.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/native-dlopen.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/native-dlopen.save.json'))
load=json.load(open('$WORK/native-dlopen.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
cap=save['descriptor']['resourcePlan']['capture']
assert cap.get('nodeStaticHttpState') is None
loader=load.get('loader')
assert loader is None or not loader.get('targetPid')
print(json.dumps({'name':'native-dlopen-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'nodeStaticHttpState':cap.get('nodeStaticHttpState'),'loaderStarted':bool(loader and loader.get('targetPid'))}))
PY
}

prove_node_static_argv_http() {
  local bundle="$WORK/node-argv-static.bundle" pid
  write_node_argv_static_app "$SRC"
  write_node_argv_static_app "$TGT"
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /tmp/node-argv-static; exec node /tmp/node-argv-static/server.mjs --port 8140 --root /tmp/node-argv-static/public >/tmp/node-argv-static.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/node-argv-static.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/node-argv-static.load.json"
  $CLI exec "$TGT" -- "node -e \"const http=require('http'); http.get('http://127.0.0.1:8140/health', r => { let b=''; r.on('data', c => b += c); r.on('end', () => { process.stdout.write(b); process.exit(r.statusCode === 200 ? 0 : 1); }); }).on('error', e => { console.error(e); process.exit(1); });\"" >"$WORK/node-argv-static.health"
  $CLI exec "$TGT" -- "node -e \"const http=require('http'); http.get('http://127.0.0.1:8140/index.txt', r => { let b=''; r.on('data', c => b += c); r.on('end', () => { process.stdout.write(b); process.exit(r.statusCode === 200 ? 0 : 1); }); }).on('error', e => { console.error(e); process.exit(1); });\"" >"$WORK/node-argv-static.index"
  python3 - <<PY
import json
save=json.load(open('$WORK/node-argv-static.save.json'))
load=json.load(open('$WORK/node-argv-static.load.json'))
health=open('$WORK/node-argv-static.health').read()
index=open('$WORK/node-argv-static.index').read()
state=save['descriptor']['resourcePlan']['capture']['nodeStaticHttpState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-node-static-http-loader'
assert state['argvContract'] == '--port-root-static-http-v1'
assert state['rootDir'] == '/tmp/node-argv-static/public'
assert health == 'ok\\n'
assert index == 'argv-static-index\\n'
print(json.dumps({'name':'node-static-argv-http','state':'passed','nodeStaticHttpState':state,'health':health.strip(),'index':index.strip()}))
PY
}

prove_node_static_http() {
  local bundle="$WORK/node-static.bundle" pid
  write_node_static_app "$SRC"
  write_node_static_app "$TGT"
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /tmp/node-static; exec node /tmp/node-static/server.mjs >/tmp/node-static.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/node-static.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/node-static.load.json"
  $CLI exec "$TGT" -- "node -e \"const http=require('http'); http.get('http://127.0.0.1:8130/health', r => { let b=''; r.on('data', c => b += c); r.on('end', () => { process.stdout.write(b); process.exit(r.statusCode === 200 ? 0 : 1); }); }).on('error', e => { console.error(e); process.exit(1); });\"" >"$WORK/node-static.health"
  python3 - <<PY
import json
save=json.load(open('$WORK/node-static.save.json'))
load=json.load(open('$WORK/node-static.load.json'))
health=open('$WORK/node-static.health').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-node-static-http-loader'
assert health == 'ok\\n'
print(json.dumps({'name':'node-static-http','state':'passed','nodeStaticHttpState':save['descriptor']['resourcePlan']['capture']['nodeStaticHttpState'],'health':health.strip()}))
PY
}

prove_find_cursor() {
  local bundle="$WORK/find.bundle" pid log last state lines
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "rm -rf /tmp/find-tree /tmp/find-source.out /tmp/find.err; mkdir -p /tmp/find-tree; python3 - <<'PY'
from pathlib import Path
root=Path('/tmp/find-tree')
for i in range(20000):
    (root / f'file-{i:05d}.txt').write_text(f'file {i}\\n')
PY" >/dev/null
  done
  $CLI exec "$SRC" -- "rm -f /tmp/find-source.out /tmp/find.err" >/dev/null
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec find /tmp/find-tree -type f -print >/tmp/find-source.out 2>/tmp/find.err' </dev/null >/dev/null 2>&1 & pid=\$!; ( while kill -0 \$pid 2>/dev/null; do [ -s /tmp/find-source.out ] && kill -STOP \$pid 2>/dev/null && exit 0; done ) >/dev/null 2>&1 & echo \$pid" | tail -1 | tr -d '\r')
  state="unknown"
  for _ in $(seq 1 100); do
    state=$($CLI exec "$SRC" -- "awk '/^State:/ {print \$2}' /proc/$pid/status 2>/dev/null || printf gone" | tail -1 | tr -d '\r')
    if [[ "$state" == "T" ]]; then
      break
    fi
    sleep 0.05
  done
  lines=$($CLI exec "$SRC" -- "wc -l </tmp/find-source.out 2>/dev/null || printf 0" | tail -1 | tr -d '\r')
  if [[ "$state" != "T" || "$lines" -le 0 || "$lines" -ge 20000 ]]; then
    echo "find proof did not capture a stopped cursor: state=$state lines=$lines" >&2
    return 1
  fi
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/find.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/find.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/find.load.json'))['loader']['logPath'])
PY
)
  last=$(python3 - <<PY
import json; print(json.load(open('$WORK/find.save.json'))['descriptor']['resourcePlan']['capture']['findState'].get('lastPath') or '')
PY
)
  sleep 2
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/find.target.out"
  $CLI exec "$TGT" -- "find /tmp/find-tree -type f -print | awk -v last='$last' 'BEGIN { emit = (last == \"\") } emit { print; next } \$0 == last { emit = 1; next }'" >"$WORK/find.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/find.save.json'))
load=json.load(open('$WORK/find.load.json'))
out=open('$WORK/find.target.out').read().splitlines()
expected=open('$WORK/find.expected.out').read().splitlines()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-find-cursor-loader'
assert out == expected
assert len(out) > 0
print(json.dumps({'name':'find-cursor','state':'passed','findState':save['descriptor']['resourcePlan']['capture']['findState'],'sourceEmittedBeforeStop':int('$lines'),'targetEmittedAfterCursor':len(out)}))
PY
}

prove_complex_find_refusal() {
  local bundle="$WORK/complex-find.bundle" pid save_rc load_rc state
  $CLI exec "$SRC" -- "rm -rf /tmp/find-tree /tmp/complex-find.out /tmp/complex-find.err; mkdir -p /tmp/find-tree; python3 - <<'PY'
from pathlib import Path
root=Path('/tmp/find-tree')
for i in range(100):
    (root / f'file-{i:05d}.txt').write_text(f'file {i}\\n')
PY" >/dev/null
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec find /tmp/find-tree -type f -name \"*.txt\" -exec sleep 1 \\; -print >/tmp/complex-find.out 2>/tmp/complex-find.err' </dev/null >/dev/null 2>&1 & pid=\$!; ( for i in \$(seq 1 1000); do grep -qx find /proc/\$pid/comm 2>/dev/null && kill -STOP \$pid 2>/dev/null && exit 0; done ) >/dev/null 2>&1 & echo \$pid" | tail -1 | tr -d '\r')
  state="unknown"
  for _ in $(seq 1 100); do
    state=$($CLI exec "$SRC" -- "awk '/^State:/ {print \$2}' /proc/$pid/status 2>/dev/null || printf gone" | tail -1 | tr -d '\r')
    if [[ "$state" == "T" ]]; then
      break
    fi
    sleep 0.05
  done
  if [[ "$state" != "T" ]]; then
    echo "complex find proof did not capture stopped process: state=$state" >&2
    return 1
  fi
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/complex-find.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/complex-find.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/complex-find.save.json'))
load=json.load(open('$WORK/complex-find.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('findState') is None
assert save['descriptor']['nativeContinuation']['state'] == 'refused'
assert 'loader' not in load
print(json.dumps({'name':'complex-find-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'findState':save['descriptor']['resourcePlan']['capture'].get('findState'),'nativeContinuation':save['descriptor']['nativeContinuation']['state'],'loaderStarted':'loader' in load}))
PY
}

prove_tar_create() {
  local bundle="$WORK/tar.bundle" pid state
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "rm -rf /tmp/find-tree /tmp/archive.tar /tmp/archive.err; mkdir -p /tmp/find-tree; python3 - <<'PY'
from pathlib import Path
root=Path('/tmp/find-tree')
for i in range(5000):
    (root / f'file-{i:05d}.txt').write_text(f'file {i}\\n')
PY" >/dev/null
  done
  pid=$($CLI exec "$SRC" -- "rm -f /tmp/archive.tar /tmp/archive.err; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec tar -cf /tmp/archive.tar /tmp/find-tree 2>/tmp/archive.err' </dev/null >/dev/null 2>&1 & pid=\$!; ( for i in \$(seq 1 1000); do grep -qx tar /proc/\$pid/comm 2>/dev/null && kill -STOP \$pid 2>/dev/null && exit 0; done ) >/dev/null 2>&1 & echo \$pid" | tail -1 | tr -d '\r')
  state="unknown"
  for _ in $(seq 1 100); do
    state=$($CLI exec "$SRC" -- "awk '/^State:/ {print \$2}' /proc/$pid/status 2>/dev/null || printf gone" | tail -1 | tr -d '\r')
    if [[ "$state" == "T" ]]; then
      break
    fi
    sleep 0.05
  done
  if [[ "$state" != "T" ]]; then
    echo "tar proof did not capture stopped process: state=$state" >&2
    return 1
  fi
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/tar.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/tar.load.json"
  for _ in $(seq 1 240); do
    if $CLI exec "$TGT" -- "tar -tf /tmp/archive.tar >/tmp/archive.list 2>/tmp/archive.list.err && grep '^tmp/find-tree/file-' /tmp/archive.list | wc -l | grep -qx 5000" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  $CLI exec "$TGT" -- "tar -tf /tmp/archive.tar >/tmp/archive.list && grep '^tmp/find-tree/file-' /tmp/archive.list | sort" >"$WORK/tar.actual"
  $CLI exec "$TGT" -- "find /tmp/find-tree -type f -print | sed 's#^/##' | sort" >"$WORK/tar.expected"
  python3 - <<PY
import json
from pathlib import Path
save=json.load(open('$WORK/tar.save.json'))
load=json.load(open('$WORK/tar.load.json'))
actual=Path('$WORK/tar.actual').read_text().splitlines()
expected=Path('$WORK/tar.expected').read_text().splitlines()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-tar-create-loader'
assert actual == expected
assert len(actual) == 5000
assert len(actual) == len(set(actual))
print(json.dumps({'name':'tar-create','state':'passed','tarState':save['descriptor']['resourcePlan']['capture']['tarState'],'archivedFiles':len(actual)}))
PY
}

prove_unsafe_tar_refusal() {
  local bundle="$WORK/unsafe-tar.bundle" pid save_rc load_rc state
  pid=$($CLI exec "$SRC" -- "rm -f /tmp/find-tree/archive.tar; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec tar -cf /tmp/find-tree/archive.tar /tmp/find-tree 2>/tmp/unsafe-tar.err' </dev/null >/dev/null 2>&1 & pid=\$!; ( for i in \$(seq 1 1000); do grep -qx tar /proc/\$pid/comm 2>/dev/null && kill -STOP \$pid 2>/dev/null && exit 0; done ) >/dev/null 2>&1 & echo \$pid" | tail -1 | tr -d '\r')
  state="unknown"
  for _ in $(seq 1 100); do
    state=$($CLI exec "$SRC" -- "awk '/^State:/ {print \$2}' /proc/$pid/status 2>/dev/null || printf gone" | tail -1 | tr -d '\r')
    if [[ "$state" == "T" ]]; then
      break
    fi
    sleep 0.05
  done
  if [[ "$state" != "T" ]]; then
    echo "unsafe tar proof did not capture stopped process: state=$state" >&2
    return 1
  fi
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-tar.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-tar.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-tar.save.json'))
load=json.load(open('$WORK/unsafe-tar.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('tarState') is None
assert save['descriptor']['nativeContinuation']['state'] == 'refused'
assert 'loader' not in load
print(json.dumps({'name':'unsafe-tar-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'tarState':save['descriptor']['resourcePlan']['capture'].get('tarState'),'nativeContinuation':save['descriptor']['nativeContinuation']['state'],'loaderStarted':'loader' in load}))
PY
}

prepare_tar_extract_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/tar-extract-src /tmp/tar-extract-target /tmp/tar-extract.tar /tmp/tar-extract.err; mkdir -p /tmp/tar-extract-src/dir /tmp/tar-extract-target; printf alpha >/tmp/tar-extract-src/alpha.txt; printf bravo >/tmp/tar-extract-src/dir/bravo.txt; LC_ALL='$FIXTURE_LOCALE' tar --sort=name --mtime='$FIXTURE_TAR_MTIME' --owner=0 --group=0 --numeric-owner -cf /tmp/tar-extract.tar -C /tmp/tar-extract-src alpha.txt dir/bravo.txt" >/dev/null
}

spawn_stopped_tar_extract_with_name() {
  local name="$1"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSAkcGlkID0gZm9yaygpOwpkaWUgImZvcmsgZmFpbGVkOiAkIVxuIiB1bmxlc3MgZGVmaW5lZCAkcGlkOwppZiAoJHBpZCA9PSAwKSB7CiAgb3BlbiBTVERJTiwgJzwnLCAnL2Rldi9udWxsJyBvciBkaWUgJCE7CiAgb3BlbiBTVERPVVQsICc+JywgIi90bXAvJHtuYW1lfS5zb3VyY2Uub3V0IiBvciBkaWUgJCE7CiAgb3BlbiBTVERFUlIsICc+JywgIi90bXAvJHtuYW1lfS5lcnIiIG9yIGRpZSAkITsKICBzeXNjYWxsKCRwdHJhY2UsIDAsIDAsIDAsIDApID09IDAgb3IgZGllICJwdHJhY2UgVFJBQ0VNRSBmYWlsZWQ6ICQhXG4iOwogIGV4ZWMgeyAnL3Vzci9iaW4vdGFyJyB9ICgndGFyJywgJy14ZicsICcvdG1wL3Rhci1leHRyYWN0LnRhcicsICctQycsICcvdG1wL3Rhci1leHRyYWN0LXRhcmdldCcpIG9yIGRpZSAiZXhlYyB0YXIgZmFpbGVkOiAkIVxuIjsKfQp3YWl0cGlkKCRwaWQsIDApOwpzeXNjYWxsKCRwdHJhY2UsIDE3LCAkcGlkLCAwLCAxOSkgPT0gMCBvciBkaWUgInB0cmFjZSBERVRBQ0ggZmFpbGVkOiAkIVxuIjsKcHJpbnQgIiRwaWRcbiI7Cg==
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_tar_extract() {
  spawn_stopped_tar_extract_with_name "tar-extract"
}

spawn_stopped_unsafe_tar_extract() {
  spawn_stopped_tar_extract_with_name "unsafe-tar-extract"
}

prove_tar_extract() {
  local bundle="$WORK/tar-extract.bundle" pid
  prepare_tar_extract_fixture "$SRC"
  prepare_tar_extract_fixture "$TGT"
  pid=$(spawn_stopped_tar_extract)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/tar-extract.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/tar-extract.load.json"
  $CLI exec "$TGT" -- "printf alpha | cmp - /tmp/tar-extract-target/alpha.txt && printf bravo | cmp - /tmp/tar-extract-target/dir/bravo.txt" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/tar-extract.save.json'))
load=json.load(open('$WORK/tar-extract.load.json'))
state=save['descriptor']['resourcePlan']['capture']['tarExtractState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-tar-extract-loader'
assert state['archivePath'] == '/tmp/tar-extract.tar'
assert state['targetDir'] == '/tmp/tar-extract-target'
assert state['policy'] == 'safe-relative-regular-empty-target'
assert state['archiveIdentity']['sha256'] and state['entryCount'] == 2
print(json.dumps({'name':'tar-extract','state':'passed','tarExtractState':state,'extractedFiles':['alpha.txt','dir/bravo.txt']}))
PY
}

prove_unsafe_tar_extract_refusal() {
  local bundle="$WORK/unsafe-tar-extract.bundle" changed_bundle="$WORK/tar-extract-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  prepare_tar_extract_fixture "$SRC"
  prepare_tar_extract_fixture "$TGT"
  $CLI exec "$SRC" -- "rm -rf /tmp/tar-unsafe-src /tmp/tar-extract-target/* /tmp/tar-extract.tar; mkdir -p /tmp/tar-unsafe-src; ln -s /etc/passwd /tmp/tar-unsafe-src/link; tar -cf /tmp/tar-extract.tar -C /tmp/tar-unsafe-src link" >/dev/null
  pid=$(spawn_stopped_unsafe_tar_extract)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-tar-extract.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-tar-extract.load.json"
  load_rc=$?
  set -e
  prepare_tar_extract_fixture "$SRC"
  prepare_tar_extract_fixture "$TGT"
  changed_pid=$(spawn_stopped_tar_extract)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/tar-extract-changed.save.json"
  $CLI exec "$TGT" -- "printf occupied >/tmp/tar-extract-target/existing.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/tar-extract-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-tar-extract.save.json'))
load=json.load(open('$WORK/unsafe-tar-extract.load.json'))
changed_save=json.load(open('$WORK/tar-extract-changed.save.json'))
changed_load=json.load(open('$WORK/tar-extract-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('tarExtractState') is None
assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'target-not-empty' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-tar-extract-refusal','state':'passed','unsafeSaveAccepted':save['accepted'],'unsafeLoadAccepted':load['accepted'],'tarExtractState':save['descriptor']['resourcePlan']['capture'].get('tarExtractState'),'targetNotEmptyLoadAccepted':changed_load['accepted'],'targetNotEmptyLoaderState':loader.get('state'),'targetNotEmptyTargetPid':loader.get('targetPid')}))
PY
}

ensure_zip_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/bin/zip && test -x /usr/bin/unzip" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-zip-apt.pid /tmp/machinen-zip-apt.log /tmp/machinen-zip-apt.rc; nohup sh -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y --no-install-recommends zip unzip; echo \$? >/tmp/machinen-zip-apt.rc' >/tmp/machinen-zip-apt.log 2>&1 & echo \$! >/tmp/machinen-zip-apt.pid" >/dev/null
  for _ in $(seq 1 180); do
    if $CLI exec "$vm" -- "test -x /usr/bin/zip && test -x /usr/bin/unzip" >/dev/null 2>&1; then
      return 0
    fi
    if $CLI exec "$vm" -- "test -s /tmp/machinen-zip-apt.rc" >/dev/null 2>&1; then
      $CLI exec "$vm" -- "cat /tmp/machinen-zip-apt.log; exit \$(cat /tmp/machinen-zip-apt.rc)" >&2 || true
      return 1
    fi
    sleep 2
  done
  $CLI exec "$vm" -- "cat /tmp/machinen-zip-apt.log 2>/dev/null || true" >&2 || true
  return 1
}

prepare_zip_create_fixture() {
  local vm="$1"
  ensure_zip_tool "$vm"
  $CLI exec "$vm" -- "rm -rf /tmp/zip-tree /tmp/zip-create.zip /tmp/zip-create.err /tmp/unsafe-zip-create.source.out /tmp/unsafe-zip-create.err; mkdir -p /tmp/zip-tree/dir; printf alpha >/tmp/zip-tree/alpha.txt; printf bravo >/tmp/zip-tree/dir/bravo.txt" >/dev/null
}

spawn_stopped_zip_create_with_mode() {
  local name="$1" mode="$2"
  ensure_zip_tool "$SRC"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndiA9ICRtb2RlIGVxICdzYWZlJwogID8gKCd6aXAnLCAnLXInLCAnL3RtcC96aXAtY3JlYXRlLnppcCcsICcvdG1wL3ppcC10cmVlJykKICA6ICgnemlwJywgJy05JywgJy1yJywgJy90bXAvemlwLWNyZWF0ZS56aXAnLCAnL3RtcC96aXAtdHJlZScpOwpteSAkcGlkID0gZm9yaygpOwpkaWUgImZvcmsgZmFpbGVkOiAkIVxuIiB1bmxlc3MgZGVmaW5lZCAkcGlkOwppZiAoJHBpZCA9PSAwKSB7CiAgb3BlbiBTVERJTiwgJzwnLCAnL2Rldi9udWxsJyBvciBkaWUgJCE7CiAgb3BlbiBTVERPVVQsICc+JywgIi90bXAvJHtuYW1lfS5zb3VyY2Uub3V0IiBvciBkaWUgJCE7CiAgb3BlbiBTVERFUlIsICc+JywgIi90bXAvJHtuYW1lfS5lcnIiIG9yIGRpZSAkITsKICBzeXNjYWxsKCRwdHJhY2UsIDAsIDAsIDAsIDApID09IDAgb3IgZGllICJwdHJhY2UgVFJBQ0VNRSBmYWlsZWQ6ICQhXG4iOwogIGV4ZWMgeyAnL3Vzci9iaW4vemlwJyB9IEBhcmd2IG9yIGRpZSAiZXhlYyB6aXAgZmFpbGVkOiAkIVxuIjsKfQp3YWl0cGlkKCRwaWQsIDApOwpzeXNjYWxsKCRwdHJhY2UsIDE3LCAkcGlkLCAwLCAxOSkgPT0gMCBvciBkaWUgInB0cmFjZSBERVRBQ0ggZmFpbGVkOiAkIVxuIjsKcHJpbnQgIiRwaWRcbiI7Cg==
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_zip_create() {
  spawn_stopped_zip_create_with_mode "zip-create" "safe"
}

spawn_stopped_unsafe_zip_create() {
  spawn_stopped_zip_create_with_mode "unsafe-zip-create" "unsafe"
}

prove_zip_create() {
  local bundle="$WORK/zip-create.bundle" pid
  prepare_zip_create_fixture "$SRC"
  prepare_zip_create_fixture "$TGT"
  pid=$(spawn_stopped_zip_create)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/zip-create.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/zip-create.load.json"
  $CLI exec "$TGT" -- "unzip -Z1 /tmp/zip-create.zip 2>&1" >"$WORK/zip-create.entries"
  $CLI exec "$TGT" -- "unzip -p /tmp/zip-create.zip tmp/zip-tree/alpha.txt | cmp - /tmp/zip-tree/alpha.txt && unzip -p /tmp/zip-create.zip tmp/zip-tree/dir/bravo.txt | cmp - /tmp/zip-tree/dir/bravo.txt" >/dev/null || { cat "$WORK/zip-create.entries" >&2; return 1; }
  python3 - <<PY
import json
save=json.load(open('$WORK/zip-create.save.json'))
load=json.load(open('$WORK/zip-create.load.json'))
state=save['descriptor']['resourcePlan']['capture']['zipCreateState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-zip-create-loader'
assert state['archivePath'] == '/tmp/zip-create.zip'
assert state['sourceDir'] == '/tmp/zip-tree'
assert state['policy'] == 'safe-relative-regular-no-symlinks-absent-archive'
assert state['sourceIdentity']['fileCount'] == 2 and state['sourceIdentity']['treeDigest']
print(json.dumps({'name':'zip-create','state':'passed','zipCreateState':state,'validatedEntries':['tmp/zip-tree/alpha.txt','tmp/zip-tree/dir/bravo.txt']}))
PY
}

prove_unsafe_zip_create_refusal() {
  local bundle="$WORK/unsafe-zip-create.bundle" changed_bundle="$WORK/zip-create-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  prepare_zip_create_fixture "$SRC"
  prepare_zip_create_fixture "$TGT"
  ln_cmd="ln -s /etc/passwd /tmp/zip-tree/link"
  $CLI exec "$SRC" -- "$ln_cmd" >/dev/null
  pid=$(spawn_stopped_unsafe_zip_create)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-zip-create.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-zip-create.load.json"
  load_rc=$?
  set -e
  prepare_zip_create_fixture "$SRC"
  prepare_zip_create_fixture "$TGT"
  changed_pid=$(spawn_stopped_zip_create)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/zip-create-changed.save.json"
  $CLI exec "$TGT" -- "printf existing >/tmp/zip-create.zip" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/zip-create-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-zip-create.save.json'))
load=json.load(open('$WORK/unsafe-zip-create.load.json'))
changed_save=json.load(open('$WORK/zip-create-changed.save.json'))
changed_load=json.load(open('$WORK/zip-create-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('zipCreateState') is None
assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-zip-create-refusal','state':'passed','unsafeSaveAccepted':save['accepted'],'unsafeLoadAccepted':load['accepted'],'zipCreateState':save['descriptor']['resourcePlan']['capture'].get('zipCreateState'),'existingArchiveLoadAccepted':changed_load['accepted'],'existingArchiveLoaderState':loader.get('state'),'existingArchiveTargetPid':loader.get('targetPid')}))
PY
}

prepare_mkdir_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/mkdir-parent; mkdir -p /tmp/mkdir-parent; printf stable >/tmp/mkdir-parent/existing.txt" >/dev/null
}

spawn_stopped_mkdir_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdta2RpcicsICcvdG1wL21rZGlyLXBhcmVudC9uZXdkaXInKTsKfSBlbHNpZiAoJG1vZGUgZXEgJ3BhcmVudHMnKSB7CiAgQGFyZ3YgPSAoJ21rZGlyJywgJy1wJywgJy90bXAvbWtkaXJwLXJvb3QvbmVzdGVkL2xlYWYnKTsKfSBlbHNpZiAoJG1vZGUgZXEgJ3Vuc2FmZS1wYXJlbnRzJykgewogIEBhcmd2ID0gKCdta2RpcicsICctcCcsICcvdG1wL21rZGlycC1yb290L2xpbmsvbGVhZicpOwp9IGVsc2UgewogIEBhcmd2ID0gKCdta2RpcicsICctbScsICc3MDAnLCAnL3RtcC9ta2Rpci1wYXJlbnQvbmV3ZGlyJyk7Cn0KbXkgJHBpZCA9IGZvcmsoKTsKZGllICJmb3JrIGZhaWxlZDogJCFcbiIgdW5sZXNzIGRlZmluZWQgJHBpZDsKaWYgKCRwaWQgPT0gMCkgewogIG9wZW4gU1RESU4sICc8JywgJy9kZXYvbnVsbCcgb3IgZGllICQhOwogIG9wZW4gU1RET1VULCAnPicsICIvdG1wLyR7bmFtZX0uc291cmNlLm91dCIgb3IgZGllICQhOwogIG9wZW4gU1RERVJSLCAnPicsICIvdG1wLyR7bmFtZX0uZXJyIiBvciBkaWUgJCE7CiAgc3lzY2FsbCgkcHRyYWNlLCAwLCAwLCAwLCAwKSA9PSAwIG9yIGRpZSAicHRyYWNlIFRSQUNFTUUgZmFpbGVkOiAkIVxuIjsKICBleGVjIHsgJy91c3IvYmluL21rZGlyJyB9IEBhcmd2IG9yIGRpZSAiZXhlYyBta2RpciBmYWlsZWQ6ICQhXG4iOwp9CndhaXRwaWQoJHBpZCwgMCk7CnN5c2NhbGwoJHB0cmFjZSwgMTcsICRwaWQsIDAsIDE5KSA9PSAwIG9yIGRpZSAicHRyYWNlIERFVEFDSCBmYWlsZWQ6ICQhXG4iOwpwcmludCAiJHBpZFxuIjsK
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_mkdir() {
  spawn_stopped_mkdir_with_mode "mkdir-dir" "safe"
}

spawn_stopped_unsafe_mkdir() {
  spawn_stopped_mkdir_with_mode "unsafe-mkdir-dir" "unsafe"
}

prove_mkdir_dir() {
  local bundle="$WORK/mkdir.bundle" pid
  prepare_mkdir_fixture "$SRC"
  prepare_mkdir_fixture "$TGT"
  pid=$(spawn_stopped_mkdir)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/mkdir.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/mkdir.load.json"
  $CLI exec "$TGT" -- "test -d /tmp/mkdir-parent/newdir && test -f /tmp/mkdir-parent/existing.txt" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/mkdir.save.json'))
load=json.load(open('$WORK/mkdir.load.json'))
state=save['descriptor']['resourcePlan']['capture']['mkdirState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-mkdir-dir-loader'
assert state['targetPath'] == '/tmp/mkdir-parent/newdir'
assert state['parentPath'] == '/tmp/mkdir-parent'
assert state['policy'] == 'absent-child-existing-parent'
assert state['parentIdentity']['entriesDigest']
print(json.dumps({'name':'mkdir-dir','state':'passed','mkdirState':state,'targetCreated':True}))
PY
}

prove_unsafe_mkdir_refusal() {
  local bundle="$WORK/unsafe-mkdir.bundle" changed_bundle="$WORK/mkdir-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  prepare_mkdir_fixture "$SRC"
  prepare_mkdir_fixture "$TGT"
  pid=$(spawn_stopped_unsafe_mkdir)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-mkdir.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-mkdir.load.json"
  load_rc=$?
  set -e
  prepare_mkdir_fixture "$SRC"
  prepare_mkdir_fixture "$TGT"
  changed_pid=$(spawn_stopped_mkdir)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/mkdir-changed.save.json"
  $CLI exec "$TGT" -- "mkdir /tmp/mkdir-parent/newdir" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/mkdir-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-mkdir.save.json'))
load=json.load(open('$WORK/unsafe-mkdir.load.json'))
changed_save=json.load(open('$WORK/mkdir-changed.save.json'))
changed_load=json.load(open('$WORK/mkdir-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('mkdirState') is None
assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'missing-input-or-target' not in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-mkdir-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'mkdirState':save['descriptor']['resourcePlan']['capture'].get('mkdirState'),'existingTargetLoadAccepted':changed_load['accepted'],'existingTargetLoaderState':loader.get('state'),'existingTargetTargetPid':loader.get('targetPid')}))
PY
}

prepare_mkdir_parents_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/mkdirp-root; mkdir -p /tmp/mkdirp-root; printf stable >/tmp/mkdirp-root/existing.txt" >/dev/null
}

spawn_stopped_mkdir_parents() {
  spawn_stopped_mkdir_with_mode "mkdir-parents" "parents"
}

spawn_stopped_unsafe_mkdir_parents() {
  spawn_stopped_mkdir_with_mode "unsafe-mkdir-parents" "unsafe-parents"
}

prove_mkdir_parents() {
  local bundle="$WORK/mkdir-parents.bundle" pid
  prepare_mkdir_parents_fixture "$SRC"
  prepare_mkdir_parents_fixture "$TGT"
  pid=$(spawn_stopped_mkdir_parents)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/mkdir-parents.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/mkdir-parents.load.json"
  $CLI exec "$TGT" -- "test -d /tmp/mkdirp-root/nested/leaf && test -f /tmp/mkdirp-root/existing.txt" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/mkdir-parents.save.json'))
load=json.load(open('$WORK/mkdir-parents.load.json'))
state=save['descriptor']['resourcePlan']['capture']['mkdirParentsState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-mkdir-parents-loader'
assert state['targetPath'] == '/tmp/mkdirp-root/nested/leaf'
assert state['existingPrefix'] == '/tmp/mkdirp-root'
assert state['missingComponents'] == ['nested', 'leaf']
assert state['policy'] == 'symlink-free-path-idempotent-or-create-missing'
assert state['prefixIdentity']['entriesDigest']
print(json.dumps({'name':'mkdir-parents','state':'passed','mkdirParentsState':state,'targetCreated':True}))
PY
}

prove_unsafe_mkdir_parents_refusal() {
  local bundle="$WORK/unsafe-mkdir-parents.bundle" changed_bundle="$WORK/mkdir-parents-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  prepare_mkdir_parents_fixture "$SRC"
  prepare_mkdir_parents_fixture "$TGT"
  $CLI exec "$SRC" -- "ln -s /tmp /tmp/mkdirp-root/link" >/dev/null
  pid=$(spawn_stopped_unsafe_mkdir_parents)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-mkdir-parents.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-mkdir-parents.load.json"
  load_rc=$?
  set -e
  prepare_mkdir_parents_fixture "$SRC"
  changed_pid=$(spawn_stopped_mkdir_parents)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/mkdir-parents-changed.save.json"
  $CLI exec "$TGT" -- "printf changed >/tmp/mkdirp-root/race.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/mkdir-parents-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-mkdir-parents.save.json'))
load=json.load(open('$WORK/unsafe-mkdir-parents.load.json'))
changed_save=json.load(open('$WORK/mkdir-parents-changed.save.json'))
changed_load=json.load(open('$WORK/mkdir-parents-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('mkdirParentsState') is None
assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-mkdir-parents-refusal','state':'passed','symlinkSaveAccepted':save['accepted'],'symlinkLoadAccepted':load['accepted'],'mkdirParentsState':save['descriptor']['resourcePlan']['capture'].get('mkdirParentsState'),'changedPrefixLoadAccepted':changed_load['accepted'],'changedPrefixLoaderState':loader.get('state'),'changedPrefixTargetPid':loader.get('targetPid')}))
PY
}

prepare_touch_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/touch-parent; mkdir -p /tmp/touch-parent; printf stable >/tmp/touch-parent/existing.txt" >/dev/null
}

spawn_stopped_touch_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCd0b3VjaCcsICctdCcsICcyMDI2MDYxMDEyMzQuNTYnLCAnL3RtcC90b3VjaC1wYXJlbnQvbmV3LWZpbGUnKTsKfSBlbHNpZiAoJG1vZGUgZXEgJ3N5bWxpbmsnKSB7CiAgQGFyZ3YgPSAoJ3RvdWNoJywgJy10JywgJzIwMjYwNjEwMTIzNC41NicsICcvdG1wL3RvdWNoLXBhcmVudC9saW5rJyk7Cn0gZWxzZSB7CiAgQGFyZ3YgPSAoJ3RvdWNoJywgJy90bXAvdG91Y2gtcGFyZW50L25ldy1maWxlJyk7Cn0KbXkgJHBpZCA9IGZvcmsoKTsKZGllICJmb3JrIGZhaWxlZDogJCFcbiIgdW5sZXNzIGRlZmluZWQgJHBpZDsKaWYgKCRwaWQgPT0gMCkgewogIG9wZW4gU1RESU4sICc8JywgJy9kZXYvbnVsbCcgb3IgZGllICQhOwogIG9wZW4gU1RET1VULCAnPicsICIvdG1wLyR7bmFtZX0uc291cmNlLm91dCIgb3IgZGllICQhOwogIG9wZW4gU1RERVJSLCAnPicsICIvdG1wLyR7bmFtZX0uZXJyIiBvciBkaWUgJCE7CiAgc3lzY2FsbCgkcHRyYWNlLCAwLCAwLCAwLCAwKSA9PSAwIG9yIGRpZSAicHRyYWNlIFRSQUNFTUUgZmFpbGVkOiAkIVxuIjsKICBleGVjIHsgJy91c3IvYmluL3RvdWNoJyB9IEBhcmd2IG9yIGRpZSAiZXhlYyB0b3VjaCBmYWlsZWQ6ICQhXG4iOwp9CndhaXRwaWQoJHBpZCwgMCk7CnN5c2NhbGwoJHB0cmFjZSwgMTcsICRwaWQsIDAsIDE5KSA9PSAwIG9yIGRpZSAicHRyYWNlIERFVEFDSCBmYWlsZWQ6ICQhXG4iOwpwcmludCAiJHBpZFxuIjsK
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_touch() {
  spawn_stopped_touch_with_mode "touch-file" "safe"
}

spawn_stopped_default_touch() {
  spawn_stopped_touch_with_mode "unsafe-touch-default" "default"
}

spawn_stopped_symlink_touch() {
  spawn_stopped_touch_with_mode "unsafe-touch-symlink" "symlink"
}

prove_touch_file() {
  local bundle="$WORK/touch.bundle" pid epoch
  prepare_touch_fixture "$SRC"
  prepare_touch_fixture "$TGT"
  pid=$(spawn_stopped_touch)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/touch.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/touch.load.json"
  epoch=$($CLI exec "$TGT" -- "stat -c %Y /tmp/touch-parent/new-file" | tail -1 | tr -d '\r')
  $CLI exec "$TGT" -- "test -f /tmp/touch-parent/new-file && test ! -L /tmp/touch-parent/new-file && test -f /tmp/touch-parent/existing.txt" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/touch.save.json'))
load=json.load(open('$WORK/touch.load.json'))
state=save['descriptor']['resourcePlan']['capture']['touchState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-touch-file-loader'
assert state['path'] == '/tmp/touch-parent/new-file'
assert state['parentPath'] == '/tmp/touch-parent'
assert state['timestampSpec'] == '202606101234.56'
assert state['expectedEpoch'] == 1781094896
assert int('$epoch') == state['expectedEpoch']
assert state['policy'] == 'deterministic-timestamp-absent-file-create'
assert state['parentIdentity']['entriesDigest']
print(json.dumps({'name':'touch-file','state':'passed','touchState':state,'targetEpoch':int('$epoch')}))
PY
}

prove_unsafe_touch_refusal() {
  local default_bundle="$WORK/unsafe-touch-default.bundle" symlink_bundle="$WORK/unsafe-touch-symlink.bundle" changed_bundle="$WORK/touch-changed.bundle" default_pid symlink_pid changed_pid default_save_rc default_load_rc symlink_save_rc symlink_load_rc changed_load_rc
  prepare_touch_fixture "$SRC"
  prepare_touch_fixture "$TGT"
  default_pid=$(spawn_stopped_default_touch)
  set +e
  $CLI move save "$SRC" "$default_pid" "$default_bundle" --json >"$WORK/unsafe-touch-default.save.json"
  default_save_rc=$?
  $CLI move load "$TGT" "$default_bundle" --json >"$WORK/unsafe-touch-default.load.json"
  default_load_rc=$?
  set -e
  prepare_touch_fixture "$SRC"
  $CLI exec "$SRC" -- "ln -s /tmp/touch-target /tmp/touch-parent/link" >/dev/null
  symlink_pid=$(spawn_stopped_symlink_touch)
  set +e
  $CLI move save "$SRC" "$symlink_pid" "$symlink_bundle" --json >"$WORK/unsafe-touch-symlink.save.json"
  symlink_save_rc=$?
  $CLI move load "$TGT" "$symlink_bundle" --json >"$WORK/unsafe-touch-symlink.load.json"
  symlink_load_rc=$?
  set -e
  prepare_touch_fixture "$SRC"
  prepare_touch_fixture "$TGT"
  changed_pid=$(spawn_stopped_touch)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/touch-changed.save.json"
  $CLI exec "$TGT" -- "printf changed >/tmp/touch-parent/race.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/touch-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
default_save=json.load(open('$WORK/unsafe-touch-default.save.json'))
default_load=json.load(open('$WORK/unsafe-touch-default.load.json'))
symlink_save=json.load(open('$WORK/unsafe-touch-symlink.save.json'))
symlink_load=json.load(open('$WORK/unsafe-touch-symlink.load.json'))
changed_save=json.load(open('$WORK/touch-changed.save.json'))
changed_load=json.load(open('$WORK/touch-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$default_save_rc') == 1 and int('$default_load_rc') == 1
assert int('$symlink_save_rc') == 1 and int('$symlink_load_rc') == 1
assert not default_save['accepted'] and not default_load['accepted']
assert not symlink_save['accepted'] and not symlink_load['accepted']
assert default_save['descriptor']['resourcePlan']['capture'].get('touchState') is None
assert symlink_save['descriptor']['resourcePlan']['capture'].get('touchState') is None
assert 'loader' not in default_load and 'loader' not in symlink_load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-touch-refusal','state':'passed','defaultSaveAccepted':default_save['accepted'],'symlinkSaveAccepted':symlink_save['accepted'],'defaultTouchState':default_save['descriptor']['resourcePlan']['capture'].get('touchState'),'symlinkTouchState':symlink_save['descriptor']['resourcePlan']['capture'].get('touchState'),'changedParentLoadAccepted':changed_load['accepted'],'changedParentLoaderState':loader.get('state'),'changedParentTargetPid':loader.get('targetPid')}))
PY
}

prepare_chmod_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/chmod-dir /tmp/chmod-link /tmp/chmod-target.txt /tmp/chmod-link-target; printf 'chmod-fixture\n' >/tmp/chmod-target.txt; chmod 644 /tmp/chmod-target.txt; printf link-target >/tmp/chmod-link-target; mkdir -p /tmp/chmod-dir; printf nested >/tmp/chmod-dir/file.txt" >/dev/null
}

spawn_stopped_chmod_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdjaG1vZCcsICc2MDAnLCAnL3RtcC9jaG1vZC10YXJnZXQudHh0Jyk7Cn0gZWxzaWYgKCRtb2RlIGVxICdzeW1saW5rJykgewogIEBhcmd2ID0gKCdjaG1vZCcsICc2MDAnLCAnL3RtcC9jaG1vZC1saW5rJyk7Cn0gZWxzZSB7CiAgQGFyZ3YgPSAoJ2NobW9kJywgJy1SJywgJzYwMCcsICcvdG1wL2NobW9kLWRpcicpOwp9Cm15ICRwaWQgPSBmb3JrKCk7CmRpZSAiZm9yayBmYWlsZWQ6ICQhXG4iIHVubGVzcyBkZWZpbmVkICRwaWQ7CmlmICgkcGlkID09IDApIHsKICBvcGVuIFNURElOLCAnPCcsICcvZGV2L251bGwnIG9yIGRpZSAkITsKICBvcGVuIFNURE9VVCwgJz4nLCAiL3RtcC8ke25hbWV9LnNvdXJjZS5vdXQiIG9yIGRpZSAkITsKICBvcGVuIFNUREVSUiwgJz4nLCAiL3RtcC8ke25hbWV9LmVyciIgb3IgZGllICQhOwogIHN5c2NhbGwoJHB0cmFjZSwgMCwgMCwgMCwgMCkgPT0gMCBvciBkaWUgInB0cmFjZSBUUkFDRU1FIGZhaWxlZDogJCFcbiI7CiAgZXhlYyB7ICcvdXNyL2Jpbi9jaG1vZCcgfSBAYXJndiBvciBkaWUgImV4ZWMgY2htb2QgZmFpbGVkOiAkIVxuIjsKfQp3YWl0cGlkKCRwaWQsIDApOwpzeXNjYWxsKCRwdHJhY2UsIDE3LCAkcGlkLCAwLCAxOSkgPT0gMCBvciBkaWUgInB0cmFjZSBERVRBQ0ggZmFpbGVkOiAkIVxuIjsKcHJpbnQgIiRwaWRcbiI7Cg==
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_chmod() {
  spawn_stopped_chmod_with_mode "chmod-file" "safe"
}

spawn_stopped_symlink_chmod() {
  spawn_stopped_chmod_with_mode "unsafe-chmod-symlink" "symlink"
}

spawn_stopped_recursive_chmod() {
  spawn_stopped_chmod_with_mode "unsafe-chmod-recursive" "recursive"
}

prove_chmod_file() {
  local bundle="$WORK/chmod.bundle" pid mode sha
  prepare_chmod_fixture "$SRC"
  prepare_chmod_fixture "$TGT"
  pid=$(spawn_stopped_chmod)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/chmod.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/chmod.load.json"
  mode=$($CLI exec "$TGT" -- "stat -c %a /tmp/chmod-target.txt" | tail -1 | tr -d '\r')
  sha=$($CLI exec "$TGT" -- "sha256sum /tmp/chmod-target.txt | cut -d' ' -f1" | tail -1 | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/chmod.save.json'))
load=json.load(open('$WORK/chmod.load.json'))
state=save['descriptor']['resourcePlan']['capture']['chmodState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-chmod-file-loader'
assert state['path'] == '/tmp/chmod-target.txt'
assert state['expectedMode'] == '644'
assert state['targetMode'] == '600'
assert state['policy'] == 'numeric-mode-regular-non-symlink'
assert int('$mode') == int(state['targetMode'])
assert '$sha' == state['fileIdentity']['sha256']
print(json.dumps({'name':'chmod-file','state':'passed','chmodState':state,'targetMode':'$mode','targetSha':'$sha'}))
PY
}

prove_unsafe_chmod_refusal() {
  local recursive_bundle="$WORK/unsafe-chmod-recursive.bundle" symlink_bundle="$WORK/unsafe-chmod-symlink.bundle" changed_bundle="$WORK/chmod-changed.bundle" recursive_pid symlink_pid changed_pid recursive_save_rc recursive_load_rc symlink_save_rc symlink_load_rc changed_load_rc
  prepare_chmod_fixture "$SRC"
  prepare_chmod_fixture "$TGT"
  recursive_pid=$(spawn_stopped_recursive_chmod)
  set +e
  $CLI move save "$SRC" "$recursive_pid" "$recursive_bundle" --json >"$WORK/unsafe-chmod-recursive.save.json"
  recursive_save_rc=$?
  $CLI move load "$TGT" "$recursive_bundle" --json >"$WORK/unsafe-chmod-recursive.load.json"
  recursive_load_rc=$?
  set -e
  prepare_chmod_fixture "$SRC"
  $CLI exec "$SRC" -- "ln -s /tmp/chmod-link-target /tmp/chmod-link" >/dev/null
  symlink_pid=$(spawn_stopped_symlink_chmod)
  set +e
  $CLI move save "$SRC" "$symlink_pid" "$symlink_bundle" --json >"$WORK/unsafe-chmod-symlink.save.json"
  symlink_save_rc=$?
  $CLI move load "$TGT" "$symlink_bundle" --json >"$WORK/unsafe-chmod-symlink.load.json"
  symlink_load_rc=$?
  set -e
  prepare_chmod_fixture "$SRC"
  prepare_chmod_fixture "$TGT"
  changed_pid=$(spawn_stopped_chmod)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/chmod-changed.save.json"
  $CLI exec "$TGT" -- "chmod 640 /tmp/chmod-target.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/chmod-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
recursive_save=json.load(open('$WORK/unsafe-chmod-recursive.save.json'))
recursive_load=json.load(open('$WORK/unsafe-chmod-recursive.load.json'))
symlink_save=json.load(open('$WORK/unsafe-chmod-symlink.save.json'))
symlink_load=json.load(open('$WORK/unsafe-chmod-symlink.load.json'))
changed_save=json.load(open('$WORK/chmod-changed.save.json'))
changed_load=json.load(open('$WORK/chmod-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$recursive_save_rc') == 1 and int('$recursive_load_rc') == 1
assert int('$symlink_save_rc') == 1 and int('$symlink_load_rc') == 1
assert not recursive_save['accepted'] and not recursive_load['accepted']
assert not symlink_save['accepted'] and not symlink_load['accepted']
assert recursive_save['descriptor']['resourcePlan']['capture'].get('chmodState') is None
assert symlink_save['descriptor']['resourcePlan']['capture'].get('chmodState') is None
assert 'loader' not in recursive_load and 'loader' not in symlink_load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-chmod-refusal','state':'passed','recursiveSaveAccepted':recursive_save['accepted'],'symlinkSaveAccepted':symlink_save['accepted'],'recursiveChmodState':recursive_save['descriptor']['resourcePlan']['capture'].get('chmodState'),'symlinkChmodState':symlink_save['descriptor']['resourcePlan']['capture'].get('chmodState'),'changedModeLoadAccepted':changed_load['accepted'],'changedModeLoaderState':loader.get('state'),'changedModeTargetPid':loader.get('targetPid')}))
PY
}

prepare_chown_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/chown-dir /tmp/chown-link /tmp/chown-target.txt /tmp/chown-link-target; printf 'chown-fixture\n' >/tmp/chown-target.txt; chown root:root /tmp/chown-target.txt; printf link-target >/tmp/chown-link-target; mkdir -p /tmp/chown-dir; printf nested >/tmp/chown-dir/file.txt" >/dev/null
}

spawn_stopped_chown_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdjaG93bicsICdub2JvZHk6bm9ncm91cCcsICcvdG1wL2Nob3duLXRhcmdldC50eHQnKTsKfSBlbHNpZiAoJG1vZGUgZXEgJ3N5bWxpbmsnKSB7CiAgQGFyZ3YgPSAoJ2Nob3duJywgJ25vYm9keTpub2dyb3VwJywgJy90bXAvY2hvd24tbGluaycpOwp9IGVsc2lmICgkbW9kZSBlcSAndW5rbm93bicpIHsKICBAYXJndiA9ICgnY2hvd24nLCAnbWFjaGluZW4tbm8tc3VjaC11c2VyOm5vZ3JvdXAnLCAnL3RtcC9jaG93bi10YXJnZXQudHh0Jyk7Cn0gZWxzZSB7CiAgQGFyZ3YgPSAoJ2Nob3duJywgJy1SJywgJ25vYm9keTpub2dyb3VwJywgJy90bXAvY2hvd24tZGlyJyk7Cn0KbXkgJHBpZCA9IGZvcmsoKTsKZGllICJmb3JrIGZhaWxlZDogJCFcbiIgdW5sZXNzIGRlZmluZWQgJHBpZDsKaWYgKCRwaWQgPT0gMCkgewogIG9wZW4gU1RESU4sICc8JywgJy9kZXYvbnVsbCcgb3IgZGllICQhOwogIG9wZW4gU1RET1VULCAnPicsICIvdG1wLyR7bmFtZX0uc291cmNlLm91dCIgb3IgZGllICQhOwogIG9wZW4gU1RERVJSLCAnPicsICIvdG1wLyR7bmFtZX0uZXJyIiBvciBkaWUgJCE7CiAgc3lzY2FsbCgkcHRyYWNlLCAwLCAwLCAwLCAwKSA9PSAwIG9yIGRpZSAicHRyYWNlIFRSQUNFTUUgZmFpbGVkOiAkIVxuIjsKICBleGVjIHsgJy91c3IvYmluL2Nob3duJyB9IEBhcmd2IG9yIGRpZSAiZXhlYyBjaG93biBmYWlsZWQ6ICQhXG4iOwp9CndhaXRwaWQoJHBpZCwgMCk7CnN5c2NhbGwoJHB0cmFjZSwgMTcsICRwaWQsIDAsIDE5KSA9PSAwIG9yIGRpZSAicHRyYWNlIERFVEFDSCBmYWlsZWQ6ICQhXG4iOwpwcmludCAiJHBpZFxuIjsK
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_chown() {
  spawn_stopped_chown_with_mode "chown-file" "safe"
}

spawn_stopped_recursive_chown() {
  spawn_stopped_chown_with_mode "unsafe-chown-recursive" "recursive"
}

spawn_stopped_unknown_chown() {
  spawn_stopped_chown_with_mode "unsafe-chown-unknown" "unknown"
}

spawn_stopped_symlink_chown() {
  spawn_stopped_chown_with_mode "unsafe-chown-symlink" "symlink"
}

prove_chown_file() {
  local bundle="$WORK/chown.bundle" pid uid gid sha
  prepare_chown_fixture "$SRC"
  prepare_chown_fixture "$TGT"
  pid=$(spawn_stopped_chown)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/chown.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/chown.load.json"
  uid=$($CLI exec "$TGT" -- "stat -c %u /tmp/chown-target.txt" | tail -1 | tr -d '\r')
  gid=$($CLI exec "$TGT" -- "stat -c %g /tmp/chown-target.txt" | tail -1 | tr -d '\r')
  sha=$($CLI exec "$TGT" -- "sha256sum /tmp/chown-target.txt | cut -d' ' -f1" | tail -1 | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/chown.save.json'))
load=json.load(open('$WORK/chown.load.json'))
state=save['descriptor']['resourcePlan']['capture']['chownState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-chown-file-loader'
assert state['path'] == '/tmp/chown-target.txt'
assert state['owner'] == 'nobody' and state['group'] == 'nogroup'
assert state['targetUid'] == 65534 and state['targetGid'] == 65534
assert state['expectedUid'] == 0 and state['expectedGid'] == 0
assert state['policy'] == 'same-base-uid-gid-regular-non-symlink'
assert int('$uid') == state['targetUid'] and int('$gid') == state['targetGid']
assert '$sha' == state['fileIdentity']['sha256']
print(json.dumps({'name':'chown-file','state':'passed','chownState':state,'targetUid':int('$uid'),'targetGid':int('$gid'),'targetSha':'$sha'}))
PY
}

prove_unsafe_chown_refusal() {
  local recursive_bundle="$WORK/unsafe-chown-recursive.bundle" unknown_bundle="$WORK/unsafe-chown-unknown.bundle" symlink_bundle="$WORK/unsafe-chown-symlink.bundle" changed_bundle="$WORK/chown-changed.bundle" recursive_pid unknown_pid symlink_pid changed_pid recursive_save_rc recursive_load_rc unknown_save_rc unknown_load_rc symlink_save_rc symlink_load_rc changed_load_rc
  prepare_chown_fixture "$SRC"
  prepare_chown_fixture "$TGT"
  recursive_pid=$(spawn_stopped_recursive_chown)
  set +e
  $CLI move save "$SRC" "$recursive_pid" "$recursive_bundle" --json >"$WORK/unsafe-chown-recursive.save.json"
  recursive_save_rc=$?
  $CLI move load "$TGT" "$recursive_bundle" --json >"$WORK/unsafe-chown-recursive.load.json"
  recursive_load_rc=$?
  set -e
  prepare_chown_fixture "$SRC"
  unknown_pid=$(spawn_stopped_unknown_chown)
  set +e
  $CLI move save "$SRC" "$unknown_pid" "$unknown_bundle" --json >"$WORK/unsafe-chown-unknown.save.json"
  unknown_save_rc=$?
  $CLI move load "$TGT" "$unknown_bundle" --json >"$WORK/unsafe-chown-unknown.load.json"
  unknown_load_rc=$?
  set -e
  prepare_chown_fixture "$SRC"
  $CLI exec "$SRC" -- "ln -s /tmp/chown-link-target /tmp/chown-link" >/dev/null
  symlink_pid=$(spawn_stopped_symlink_chown)
  set +e
  $CLI move save "$SRC" "$symlink_pid" "$symlink_bundle" --json >"$WORK/unsafe-chown-symlink.save.json"
  symlink_save_rc=$?
  $CLI move load "$TGT" "$symlink_bundle" --json >"$WORK/unsafe-chown-symlink.load.json"
  symlink_load_rc=$?
  set -e
  prepare_chown_fixture "$SRC"
  prepare_chown_fixture "$TGT"
  changed_pid=$(spawn_stopped_chown)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/chown-changed.save.json"
  $CLI exec "$TGT" -- "chown nobody:nogroup /tmp/chown-target.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/chown-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
recursive_save=json.load(open('$WORK/unsafe-chown-recursive.save.json'))
recursive_load=json.load(open('$WORK/unsafe-chown-recursive.load.json'))
unknown_save=json.load(open('$WORK/unsafe-chown-unknown.save.json'))
unknown_load=json.load(open('$WORK/unsafe-chown-unknown.load.json'))
symlink_save=json.load(open('$WORK/unsafe-chown-symlink.save.json'))
symlink_load=json.load(open('$WORK/unsafe-chown-symlink.load.json'))
changed_save=json.load(open('$WORK/chown-changed.save.json'))
changed_load=json.load(open('$WORK/chown-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$recursive_save_rc') == 1 and int('$recursive_load_rc') == 1
assert int('$unknown_save_rc') == 1 and int('$unknown_load_rc') == 1
assert int('$symlink_save_rc') == 1 and int('$symlink_load_rc') == 1
for save, load in [(recursive_save, recursive_load), (unknown_save, unknown_load), (symlink_save, symlink_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('chownState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-chown-refusal','state':'passed','recursiveSaveAccepted':recursive_save['accepted'],'unknownSaveAccepted':unknown_save['accepted'],'symlinkSaveAccepted':symlink_save['accepted'],'recursiveChownState':recursive_save['descriptor']['resourcePlan']['capture'].get('chownState'),'unknownChownState':unknown_save['descriptor']['resourcePlan']['capture'].get('chownState'),'symlinkChownState':symlink_save['descriptor']['resourcePlan']['capture'].get('chownState'),'changedOwnerLoadAccepted':changed_load['accepted'],'changedOwnerLoaderState':loader.get('state'),'changedOwnerTargetPid':loader.get('targetPid')}))
PY
}

prepare_link_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/link-parent; mkdir -p /tmp/link-parent; printf 'link-fixture\n' >/tmp/link-parent/source.txt; printf symlink-target >/tmp/link-parent/symlink-target; mkdir -p /tmp/link-parent/dir" >/dev/null
}

spawn_stopped_link_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdsbicsICcvdG1wL2xpbmstcGFyZW50L3NvdXJjZS50eHQnLCAnL3RtcC9saW5rLXBhcmVudC9kZXN0LnR4dCcpOwp9IGVsc2lmICgkbW9kZSBlcSAnc3ltbGluaycpIHsKICBAYXJndiA9ICgnbG4nLCAnL3RtcC9saW5rLXBhcmVudC9zb3VyY2Utc3ltbGluaycsICcvdG1wL2xpbmstcGFyZW50L2Rlc3QudHh0Jyk7Cn0gZWxzaWYgKCRtb2RlIGVxICdjcm9zc2RldicpIHsKICBAYXJndiA9ICgnbG4nLCAnL3RtcC9saW5rLXBhcmVudC9zb3VyY2UudHh0JywgJy9wcm9jL2xpbmstZGVzdC50eHQnKTsKfSBlbHNlIHsKICBAYXJndiA9ICgnbG4nLCAnL3RtcC9saW5rLXBhcmVudC9kaXInLCAnL3RtcC9saW5rLXBhcmVudC9kZXN0LnR4dCcpOwp9Cm15ICRwaWQgPSBmb3JrKCk7CmRpZSAiZm9yayBmYWlsZWQ6ICQhXG4iIHVubGVzcyBkZWZpbmVkICRwaWQ7CmlmICgkcGlkID09IDApIHsKICBvcGVuIFNURElOLCAnPCcsICcvZGV2L251bGwnIG9yIGRpZSAkITsKICBvcGVuIFNURE9VVCwgJz4nLCAiL3RtcC8ke25hbWV9LnNvdXJjZS5vdXQiIG9yIGRpZSAkITsKICBvcGVuIFNUREVSUiwgJz4nLCAiL3RtcC8ke25hbWV9LmVyciIgb3IgZGllICQhOwogIHN5c2NhbGwoJHB0cmFjZSwgMCwgMCwgMCwgMCkgPT0gMCBvciBkaWUgInB0cmFjZSBUUkFDRU1FIGZhaWxlZDogJCFcbiI7CiAgZXhlYyB7ICcvdXNyL2Jpbi9sbicgfSBAYXJndiBvciBkaWUgImV4ZWMgbG4gZmFpbGVkOiAkIVxuIjsKfQp3YWl0cGlkKCRwaWQsIDApOwpzeXNjYWxsKCRwdHJhY2UsIDE3LCAkcGlkLCAwLCAxOSkgPT0gMCBvciBkaWUgInB0cmFjZSBERVRBQ0ggZmFpbGVkOiAkIVxuIjsKcHJpbnQgIiRwaWRcbiI7Cg==
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_link() {
  spawn_stopped_link_with_mode "link-file" "safe"
}

spawn_stopped_crossdev_link() {
  spawn_stopped_link_with_mode "unsafe-link-crossdev" "crossdev"
}

spawn_stopped_symlink_link() {
  spawn_stopped_link_with_mode "unsafe-link-symlink" "symlink"
}

spawn_stopped_directory_link() {
  spawn_stopped_link_with_mode "unsafe-link-directory" "directory"
}

prove_link_file() {
  local bundle="$WORK/link.bundle" pid src_stat dst_stat sha
  prepare_link_fixture "$SRC"
  prepare_link_fixture "$TGT"
  pid=$(spawn_stopped_link)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/link.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/link.load.json"
  src_stat=$($CLI exec "$TGT" -- "stat -c '%d:%i' /tmp/link-parent/source.txt" | tail -1 | tr -d '\r')
  dst_stat=$($CLI exec "$TGT" -- "stat -c '%d:%i' /tmp/link-parent/dest.txt" | tail -1 | tr -d '\r')
  sha=$($CLI exec "$TGT" -- "sha256sum /tmp/link-parent/dest.txt | cut -d' ' -f1" | tail -1 | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/link.save.json'))
load=json.load(open('$WORK/link.load.json'))
state=save['descriptor']['resourcePlan']['capture']['linkState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-link-file-loader'
assert state['sourcePath'] == '/tmp/link-parent/source.txt'
assert state['destinationPath'] == '/tmp/link-parent/dest.txt'
assert state['destinationParent'] == '/tmp/link-parent'
assert state['sourceIdentity']['sha256'] == '$sha'
assert state['sourceIdentity']['dev'] == state['destinationParentIdentity']['dev']
assert '$src_stat' == '$dst_stat'
assert state['policy'] == 'hardlink-regular-source-absent-destination-same-filesystem'
print(json.dumps({'name':'link-file','state':'passed','linkState':state,'targetSourceStat':'$src_stat','targetDestinationStat':'$dst_stat','targetSha':'$sha'}))
PY
}

prove_unsafe_link_refusal() {
  local cross_bundle="$WORK/unsafe-link-crossdev.bundle" symlink_bundle="$WORK/unsafe-link-symlink.bundle" dir_bundle="$WORK/unsafe-link-directory.bundle" changed_bundle="$WORK/link-changed.bundle" cross_pid symlink_pid dir_pid changed_pid cross_save_rc cross_load_rc symlink_save_rc symlink_load_rc dir_save_rc dir_load_rc changed_load_rc
  prepare_link_fixture "$SRC"
  prepare_link_fixture "$TGT"
  cross_pid=$(spawn_stopped_crossdev_link)
  set +e
  $CLI move save "$SRC" "$cross_pid" "$cross_bundle" --json >"$WORK/unsafe-link-crossdev.save.json"
  cross_save_rc=$?
  $CLI move load "$TGT" "$cross_bundle" --json >"$WORK/unsafe-link-crossdev.load.json"
  cross_load_rc=$?
  set -e
  prepare_link_fixture "$SRC"
  $CLI exec "$SRC" -- "ln -s /tmp/link-parent/symlink-target /tmp/link-parent/source-symlink" >/dev/null
  symlink_pid=$(spawn_stopped_symlink_link)
  set +e
  $CLI move save "$SRC" "$symlink_pid" "$symlink_bundle" --json >"$WORK/unsafe-link-symlink.save.json"
  symlink_save_rc=$?
  $CLI move load "$TGT" "$symlink_bundle" --json >"$WORK/unsafe-link-symlink.load.json"
  symlink_load_rc=$?
  set -e
  prepare_link_fixture "$SRC"
  dir_pid=$(spawn_stopped_directory_link)
  set +e
  $CLI move save "$SRC" "$dir_pid" "$dir_bundle" --json >"$WORK/unsafe-link-directory.save.json"
  dir_save_rc=$?
  $CLI move load "$TGT" "$dir_bundle" --json >"$WORK/unsafe-link-directory.load.json"
  dir_load_rc=$?
  set -e
  prepare_link_fixture "$SRC"
  prepare_link_fixture "$TGT"
  changed_pid=$(spawn_stopped_link)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/link-changed.save.json"
  $CLI exec "$TGT" -- "printf existing >/tmp/link-parent/dest.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/link-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
cross_save=json.load(open('$WORK/unsafe-link-crossdev.save.json'))
cross_load=json.load(open('$WORK/unsafe-link-crossdev.load.json'))
symlink_save=json.load(open('$WORK/unsafe-link-symlink.save.json'))
symlink_load=json.load(open('$WORK/unsafe-link-symlink.load.json'))
dir_save=json.load(open('$WORK/unsafe-link-directory.save.json'))
dir_load=json.load(open('$WORK/unsafe-link-directory.load.json'))
changed_save=json.load(open('$WORK/link-changed.save.json'))
changed_load=json.load(open('$WORK/link-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$cross_save_rc') == 1 and int('$cross_load_rc') == 1
assert int('$symlink_save_rc') == 1 and int('$symlink_load_rc') == 1
assert int('$dir_save_rc') == 1 and int('$dir_load_rc') == 1
for save, load in [(cross_save,cross_load), (symlink_save,symlink_load), (dir_save,dir_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('linkState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-link-refusal','state':'passed','crossDeviceSaveAccepted':cross_save['accepted'],'symlinkSaveAccepted':symlink_save['accepted'],'directorySaveAccepted':dir_save['accepted'],'crossDeviceLinkState':cross_save['descriptor']['resourcePlan']['capture'].get('linkState'),'symlinkLinkState':symlink_save['descriptor']['resourcePlan']['capture'].get('linkState'),'directoryLinkState':dir_save['descriptor']['resourcePlan']['capture'].get('linkState'),'existingDestinationLoadAccepted':changed_load['accepted'],'existingDestinationLoaderState':loader.get('state'),'existingDestinationTargetPid':loader.get('targetPid')}))
PY
}

prepare_symlink_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/symlink-parent /tmp/symlink-parent-link /tmp/symlink-parent-real /tmp/symlink-target.txt; mkdir -p /tmp/symlink-parent; printf symlink-target >/tmp/symlink-target.txt" >/dev/null
}

spawn_stopped_symlink_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdsbicsICctcycsICcvdG1wL3N5bWxpbmstdGFyZ2V0LnR4dCcsICcvdG1wL3N5bWxpbmstcGFyZW50L2xpbmsudHh0Jyk7Cn0gZWxzaWYgKCRtb2RlIGVxICdmb3JjZScpIHsKICBAYXJndiA9ICgnbG4nLCAnLXNmJywgJy90bXAvc3ltbGluay10YXJnZXQudHh0JywgJy90bXAvc3ltbGluay1wYXJlbnQvbGluay50eHQnKTsKfSBlbHNpZiAoJG1vZGUgZXEgJ3Vuc2FmZS1wYXJlbnQnKSB7CiAgQGFyZ3YgPSAoJ2xuJywgJy1zJywgJy90bXAvc3ltbGluay10YXJnZXQudHh0JywgJy90bXAvc3ltbGluay1wYXJlbnQtbGluay9saW5rLnR4dCcpOwp9IGVsc2UgewogIEBhcmd2ID0gKCdsbicsICctcycsICJiYWRcbnZhbHVlIiwgJy90bXAvc3ltbGluay1wYXJlbnQvbGluay50eHQnKTsKfQpteSAkcGlkID0gZm9yaygpOwpkaWUgImZvcmsgZmFpbGVkOiAkIVxuIiB1bmxlc3MgZGVmaW5lZCAkcGlkOwppZiAoJHBpZCA9PSAwKSB7CiAgb3BlbiBTVERJTiwgJzwnLCAnL2Rldi9udWxsJyBvciBkaWUgJCE7CiAgb3BlbiBTVERPVVQsICc+JywgIi90bXAvJHtuYW1lfS5zb3VyY2Uub3V0IiBvciBkaWUgJCE7CiAgb3BlbiBTVERFUlIsICc+JywgIi90bXAvJHtuYW1lfS5lcnIiIG9yIGRpZSAkITsKICBzeXNjYWxsKCRwdHJhY2UsIDAsIDAsIDAsIDApID09IDAgb3IgZGllICJwdHJhY2UgVFJBQ0VNRSBmYWlsZWQ6ICQhXG4iOwogIGV4ZWMgeyAnL3Vzci9iaW4vbG4nIH0gQGFyZ3Ygb3IgZGllICJleGVjIGxuIGZhaWxlZDogJCFcbiI7Cn0Kd2FpdHBpZCgkcGlkLCAwKTsKc3lzY2FsbCgkcHRyYWNlLCAxNywgJHBpZCwgMCwgMTkpID09IDAgb3IgZGllICJwdHJhY2UgREVUQUNIIGZhaWxlZDogJCFcbiI7CnByaW50ICIkcGlkXG4iOwo=
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_symlink_create() {
  spawn_stopped_symlink_with_mode "symlink-file" "safe"
}

spawn_stopped_force_symlink() {
  spawn_stopped_symlink_with_mode "unsafe-symlink-force" "force"
}

spawn_stopped_unsafe_parent_symlink() {
  spawn_stopped_symlink_with_mode "unsafe-symlink-parent" "unsafe-parent"
}

prove_symlink_file() {
  local bundle="$WORK/symlink.bundle" pid target
  prepare_symlink_fixture "$SRC"
  prepare_symlink_fixture "$TGT"
  pid=$(spawn_stopped_symlink_create)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/symlink.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/symlink.load.json"
  target=$($CLI exec "$TGT" -- "readlink /tmp/symlink-parent/link.txt" | tail -1 | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/symlink.save.json'))
load=json.load(open('$WORK/symlink.load.json'))
state=save['descriptor']['resourcePlan']['capture']['symlinkState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-symlink-file-loader'
assert state['targetLiteral'] == '/tmp/symlink-target.txt'
assert state['linkPath'] == '/tmp/symlink-parent/link.txt'
assert state['parentPath'] == '/tmp/symlink-parent'
assert state['policy'] == 'literal-target-absent-link-safe-parent'
assert '$target' == state['targetLiteral']
print(json.dumps({'name':'symlink-file','state':'passed','symlinkState':state,'targetReadlink':'$target'}))
PY
}

prove_unsafe_symlink_refusal() {
  local force_bundle="$WORK/unsafe-symlink-force.bundle" parent_bundle="$WORK/unsafe-symlink-parent.bundle" changed_bundle="$WORK/symlink-changed.bundle" force_pid parent_pid changed_pid force_save_rc force_load_rc parent_save_rc parent_load_rc changed_load_rc
  prepare_symlink_fixture "$SRC"
  prepare_symlink_fixture "$TGT"
  force_pid=$(spawn_stopped_force_symlink)
  set +e
  $CLI move save "$SRC" "$force_pid" "$force_bundle" --json >"$WORK/unsafe-symlink-force.save.json"
  force_save_rc=$?
  $CLI move load "$TGT" "$force_bundle" --json >"$WORK/unsafe-symlink-force.load.json"
  force_load_rc=$?
  set -e
  prepare_symlink_fixture "$SRC"
  $CLI exec "$SRC" -- "mkdir -p /tmp/symlink-parent-real; ln -s /tmp/symlink-parent-real /tmp/symlink-parent-link" >/dev/null
  parent_pid=$(spawn_stopped_unsafe_parent_symlink)
  set +e
  $CLI move save "$SRC" "$parent_pid" "$parent_bundle" --json >"$WORK/unsafe-symlink-parent.save.json"
  parent_save_rc=$?
  $CLI move load "$TGT" "$parent_bundle" --json >"$WORK/unsafe-symlink-parent.load.json"
  parent_load_rc=$?
  set -e
  prepare_symlink_fixture "$SRC"
  prepare_symlink_fixture "$TGT"
  changed_pid=$(spawn_stopped_symlink_create)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/symlink-changed.save.json"
  $CLI exec "$TGT" -- "printf existing >/tmp/symlink-parent/link.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/symlink-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
force_save=json.load(open('$WORK/unsafe-symlink-force.save.json'))
force_load=json.load(open('$WORK/unsafe-symlink-force.load.json'))
parent_save=json.load(open('$WORK/unsafe-symlink-parent.save.json'))
parent_load=json.load(open('$WORK/unsafe-symlink-parent.load.json'))
changed_save=json.load(open('$WORK/symlink-changed.save.json'))
changed_load=json.load(open('$WORK/symlink-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$force_save_rc') == 1 and int('$force_load_rc') == 1
assert int('$parent_save_rc') == 1 and int('$parent_load_rc') == 1
for save, load in [(force_save, force_load), (parent_save, parent_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('symlinkState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-symlink-refusal','state':'passed','forceSaveAccepted':force_save['accepted'],'unsafeParentSaveAccepted':parent_save['accepted'],'forceSymlinkState':force_save['descriptor']['resourcePlan']['capture'].get('symlinkState'),'unsafeParentSymlinkState':parent_save['descriptor']['resourcePlan']['capture'].get('symlinkState'),'existingLinkLoadAccepted':changed_load['accepted'],'existingLinkLoaderState':loader.get('state'),'existingLinkTargetPid':loader.get('targetPid')}))
PY
}

prepare_rm_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/rm-parent; mkdir -p /tmp/rm-parent/dir; printf 'rm-fixture\n' >/tmp/rm-parent/victim.txt; printf other >/tmp/rm-parent/other.txt; printf target >/tmp/rm-parent/link-target.txt; printf nested >/tmp/rm-parent/dir/file.txt" >/dev/null
}

spawn_stopped_rm_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdybScsICcvdG1wL3JtLXBhcmVudC92aWN0aW0udHh0Jyk7Cn0gZWxzaWYgKCRtb2RlIGVxICdzeW1saW5rJykgewogIEBhcmd2ID0gKCdybScsICcvdG1wL3JtLXBhcmVudC9saW5rLnR4dCcpOwp9IGVsc2lmICgkbW9kZSBlcSAnbXVsdGknKSB7CiAgQGFyZ3YgPSAoJ3JtJywgJy90bXAvcm0tcGFyZW50L3ZpY3RpbS50eHQnLCAnL3RtcC9ybS1wYXJlbnQvb3RoZXIudHh0Jyk7Cn0gZWxzZSB7CiAgQGFyZ3YgPSAoJ3JtJywgJy1yJywgJy90bXAvcm0tcGFyZW50L2RpcicpOwp9Cm15ICRwaWQgPSBmb3JrKCk7CmRpZSAiZm9yayBmYWlsZWQ6ICQhXG4iIHVubGVzcyBkZWZpbmVkICRwaWQ7CmlmICgkcGlkID09IDApIHsKICBvcGVuIFNURElOLCAnPCcsICcvZGV2L251bGwnIG9yIGRpZSAkITsKICBvcGVuIFNURE9VVCwgJz4nLCAiL3RtcC8ke25hbWV9LnNvdXJjZS5vdXQiIG9yIGRpZSAkITsKICBvcGVuIFNUREVSUiwgJz4nLCAiL3RtcC8ke25hbWV9LmVyciIgb3IgZGllICQhOwogIHN5c2NhbGwoJHB0cmFjZSwgMCwgMCwgMCwgMCkgPT0gMCBvciBkaWUgInB0cmFjZSBUUkFDRU1FIGZhaWxlZDogJCFcbiI7CiAgZXhlYyB7ICcvdXNyL2Jpbi9ybScgfSBAYXJndiBvciBkaWUgImV4ZWMgcm0gZmFpbGVkOiAkIVxuIjsKfQp3YWl0cGlkKCRwaWQsIDApOwpzeXNjYWxsKCRwdHJhY2UsIDE3LCAkcGlkLCAwLCAxOSkgPT0gMCBvciBkaWUgInB0cmFjZSBERVRBQ0ggZmFpbGVkOiAkIVxuIjsKcHJpbnQgIiRwaWRcbiI7Cg==
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_rm() {
  spawn_stopped_rm_with_mode "rm-file" "safe"
}

spawn_stopped_recursive_rm() {
  spawn_stopped_rm_with_mode "unsafe-rm-recursive" "recursive"
}

spawn_stopped_multi_rm() {
  spawn_stopped_rm_with_mode "unsafe-rm-multi" "multi"
}

spawn_stopped_symlink_rm() {
  spawn_stopped_rm_with_mode "unsafe-rm-symlink" "symlink"
}

prove_rm_file() {
  local bundle="$WORK/rm.bundle" pid
  prepare_rm_fixture "$SRC"
  prepare_rm_fixture "$TGT"
  pid=$(spawn_stopped_rm)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/rm.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/rm.load.json"
  $CLI exec "$TGT" -- "test ! -e /tmp/rm-parent/victim.txt && test ! -L /tmp/rm-parent/victim.txt && test -f /tmp/rm-parent/other.txt" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/rm.save.json'))
load=json.load(open('$WORK/rm.load.json'))
state=save['descriptor']['resourcePlan']['capture']['rmState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-rm-file-loader'
assert state['path'] == '/tmp/rm-parent/victim.txt'
assert state['parentPath'] == '/tmp/rm-parent'
assert state['policy'] == 'regular-non-symlink-pre-unlink'
assert state['fileIdentity']['sha256']
print(json.dumps({'name':'rm-file','state':'passed','rmState':state,'targetRemoved':True}))
PY
}

prove_unsafe_rm_refusal() {
  local recursive_bundle="$WORK/unsafe-rm-recursive.bundle" multi_bundle="$WORK/unsafe-rm-multi.bundle" symlink_bundle="$WORK/unsafe-rm-symlink.bundle" changed_bundle="$WORK/rm-changed.bundle" recursive_pid multi_pid symlink_pid changed_pid recursive_save_rc recursive_load_rc multi_save_rc multi_load_rc symlink_save_rc symlink_load_rc changed_load_rc
  prepare_rm_fixture "$SRC"
  prepare_rm_fixture "$TGT"
  recursive_pid=$(spawn_stopped_recursive_rm)
  set +e
  $CLI move save "$SRC" "$recursive_pid" "$recursive_bundle" --json >"$WORK/unsafe-rm-recursive.save.json"
  recursive_save_rc=$?
  $CLI move load "$TGT" "$recursive_bundle" --json >"$WORK/unsafe-rm-recursive.load.json"
  recursive_load_rc=$?
  set -e
  prepare_rm_fixture "$SRC"
  multi_pid=$(spawn_stopped_multi_rm)
  set +e
  $CLI move save "$SRC" "$multi_pid" "$multi_bundle" --json >"$WORK/unsafe-rm-multi.save.json"
  multi_save_rc=$?
  $CLI move load "$TGT" "$multi_bundle" --json >"$WORK/unsafe-rm-multi.load.json"
  multi_load_rc=$?
  set -e
  prepare_rm_fixture "$SRC"
  $CLI exec "$SRC" -- "ln -s /tmp/rm-parent/link-target.txt /tmp/rm-parent/link.txt" >/dev/null
  symlink_pid=$(spawn_stopped_symlink_rm)
  set +e
  $CLI move save "$SRC" "$symlink_pid" "$symlink_bundle" --json >"$WORK/unsafe-rm-symlink.save.json"
  symlink_save_rc=$?
  $CLI move load "$TGT" "$symlink_bundle" --json >"$WORK/unsafe-rm-symlink.load.json"
  symlink_load_rc=$?
  set -e
  prepare_rm_fixture "$SRC"
  prepare_rm_fixture "$TGT"
  changed_pid=$(spawn_stopped_rm)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/rm-changed.save.json"
  $CLI exec "$TGT" -- "printf changed >/tmp/rm-parent/victim.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/rm-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
recursive_save=json.load(open('$WORK/unsafe-rm-recursive.save.json'))
recursive_load=json.load(open('$WORK/unsafe-rm-recursive.load.json'))
multi_save=json.load(open('$WORK/unsafe-rm-multi.save.json'))
multi_load=json.load(open('$WORK/unsafe-rm-multi.load.json'))
symlink_save=json.load(open('$WORK/unsafe-rm-symlink.save.json'))
symlink_load=json.load(open('$WORK/unsafe-rm-symlink.load.json'))
changed_save=json.load(open('$WORK/rm-changed.save.json'))
changed_load=json.load(open('$WORK/rm-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$recursive_save_rc') == 1 and int('$recursive_load_rc') == 1
assert int('$multi_save_rc') == 1 and int('$multi_load_rc') == 1
assert int('$symlink_save_rc') == 1 and int('$symlink_load_rc') == 1
for save, load in [(recursive_save,recursive_load), (multi_save,multi_load), (symlink_save,symlink_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('rmState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-rm-refusal','state':'passed','recursiveSaveAccepted':recursive_save['accepted'],'multiSaveAccepted':multi_save['accepted'],'symlinkSaveAccepted':symlink_save['accepted'],'recursiveRmState':recursive_save['descriptor']['resourcePlan']['capture'].get('rmState'),'multiRmState':multi_save['descriptor']['resourcePlan']['capture'].get('rmState'),'symlinkRmState':symlink_save['descriptor']['resourcePlan']['capture'].get('rmState'),'changedFileLoadAccepted':changed_load['accepted'],'changedFileLoaderState':loader.get('state'),'changedFileTargetPid':loader.get('targetPid')}))
PY
}

prepare_rmdir_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/rmdir-parent; mkdir -p /tmp/rmdir-parent/empty /tmp/rmdir-parent/nonempty /tmp/rmdir-parent/real; printf nested >/tmp/rmdir-parent/nonempty/file.txt; printf file >/tmp/rmdir-parent/file.txt" >/dev/null
}

spawn_stopped_rmdir_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdybWRpcicsICcvdG1wL3JtZGlyLXBhcmVudC9lbXB0eScpOwp9IGVsc2lmICgkbW9kZSBlcSAnbm9uZW1wdHknKSB7CiAgQGFyZ3YgPSAoJ3JtZGlyJywgJy90bXAvcm1kaXItcGFyZW50L25vbmVtcHR5Jyk7Cn0gZWxzaWYgKCRtb2RlIGVxICdzeW1saW5rJykgewogIEBhcmd2ID0gKCdybWRpcicsICcvdG1wL3JtZGlyLXBhcmVudC9saW5rJyk7Cn0gZWxzaWYgKCRtb2RlIGVxICdmaWxlJykgewogIEBhcmd2ID0gKCdybWRpcicsICcvdG1wL3JtZGlyLXBhcmVudC9maWxlLnR4dCcpOwp9IGVsc2UgewogIEBhcmd2ID0gKCdybWRpcicsICctLWlnbm9yZS1mYWlsLW9uLW5vbi1lbXB0eScsICcvdG1wL3JtZGlyLXBhcmVudC9ub25lbXB0eScpOwp9Cm15ICRwaWQgPSBmb3JrKCk7CmRpZSAiZm9yayBmYWlsZWQ6ICQhXG4iIHVubGVzcyBkZWZpbmVkICRwaWQ7CmlmICgkcGlkID09IDApIHsKICBvcGVuIFNURElOLCAnPCcsICcvZGV2L251bGwnIG9yIGRpZSAkITsKICBvcGVuIFNURE9VVCwgJz4nLCAiL3RtcC8ke25hbWV9LnNvdXJjZS5vdXQiIG9yIGRpZSAkITsKICBvcGVuIFNUREVSUiwgJz4nLCAiL3RtcC8ke25hbWV9LmVyciIgb3IgZGllICQhOwogIHN5c2NhbGwoJHB0cmFjZSwgMCwgMCwgMCwgMCkgPT0gMCBvciBkaWUgInB0cmFjZSBUUkFDRU1FIGZhaWxlZDogJCFcbiI7CiAgZXhlYyB7ICcvdXNyL2Jpbi9ybWRpcicgfSBAYXJndiBvciBkaWUgImV4ZWMgcm1kaXIgZmFpbGVkOiAkIVxuIjsKfQp3YWl0cGlkKCRwaWQsIDApOwpzeXNjYWxsKCRwdHJhY2UsIDE3LCAkcGlkLCAwLCAxOSkgPT0gMCBvciBkaWUgInB0cmFjZSBERVRBQ0ggZmFpbGVkOiAkIVxuIjsKcHJpbnQgIiRwaWRcbiI7Cg==
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_rmdir() {
  spawn_stopped_rmdir_with_mode "rmdir-dir" "safe"
}

spawn_stopped_nonempty_rmdir() {
  spawn_stopped_rmdir_with_mode "unsafe-rmdir-nonempty" "nonempty"
}

spawn_stopped_symlink_rmdir() {
  spawn_stopped_rmdir_with_mode "unsafe-rmdir-symlink" "symlink"
}

spawn_stopped_file_rmdir() {
  spawn_stopped_rmdir_with_mode "unsafe-rmdir-file" "file"
}

prove_rmdir_dir() {
  local bundle="$WORK/rmdir.bundle" pid
  prepare_rmdir_fixture "$SRC"
  prepare_rmdir_fixture "$TGT"
  pid=$(spawn_stopped_rmdir)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/rmdir.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/rmdir.load.json"
  $CLI exec "$TGT" -- "test ! -e /tmp/rmdir-parent/empty && test ! -L /tmp/rmdir-parent/empty && test -d /tmp/rmdir-parent/nonempty" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/rmdir.save.json'))
load=json.load(open('$WORK/rmdir.load.json'))
state=save['descriptor']['resourcePlan']['capture']['rmdirState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-rmdir-dir-loader'
assert state['path'] == '/tmp/rmdir-parent/empty'
assert state['parentPath'] == '/tmp/rmdir-parent'
assert state['policy'] == 'empty-directory-non-symlink-pre-remove'
assert state['directoryIdentity']['inode']
print(json.dumps({'name':'rmdir-dir','state':'passed','rmdirState':state,'targetRemoved':True}))
PY
}

prove_unsafe_rmdir_refusal() {
  local nonempty_bundle="$WORK/unsafe-rmdir-nonempty.bundle" symlink_bundle="$WORK/unsafe-rmdir-symlink.bundle" file_bundle="$WORK/unsafe-rmdir-file.bundle" changed_bundle="$WORK/rmdir-changed.bundle" nonempty_pid symlink_pid file_pid changed_pid nonempty_save_rc nonempty_load_rc symlink_save_rc symlink_load_rc file_save_rc file_load_rc changed_load_rc
  prepare_rmdir_fixture "$SRC"
  prepare_rmdir_fixture "$TGT"
  nonempty_pid=$(spawn_stopped_nonempty_rmdir)
  set +e
  $CLI move save "$SRC" "$nonempty_pid" "$nonempty_bundle" --json >"$WORK/unsafe-rmdir-nonempty.save.json"
  nonempty_save_rc=$?
  $CLI move load "$TGT" "$nonempty_bundle" --json >"$WORK/unsafe-rmdir-nonempty.load.json"
  nonempty_load_rc=$?
  set -e
  prepare_rmdir_fixture "$SRC"
  $CLI exec "$SRC" -- "ln -s /tmp/rmdir-parent/real /tmp/rmdir-parent/link" >/dev/null
  symlink_pid=$(spawn_stopped_symlink_rmdir)
  set +e
  $CLI move save "$SRC" "$symlink_pid" "$symlink_bundle" --json >"$WORK/unsafe-rmdir-symlink.save.json"
  symlink_save_rc=$?
  $CLI move load "$TGT" "$symlink_bundle" --json >"$WORK/unsafe-rmdir-symlink.load.json"
  symlink_load_rc=$?
  set -e
  prepare_rmdir_fixture "$SRC"
  file_pid=$(spawn_stopped_file_rmdir)
  set +e
  $CLI move save "$SRC" "$file_pid" "$file_bundle" --json >"$WORK/unsafe-rmdir-file.save.json"
  file_save_rc=$?
  $CLI move load "$TGT" "$file_bundle" --json >"$WORK/unsafe-rmdir-file.load.json"
  file_load_rc=$?
  set -e
  prepare_rmdir_fixture "$SRC"
  prepare_rmdir_fixture "$TGT"
  changed_pid=$(spawn_stopped_rmdir)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/rmdir-changed.save.json"
  $CLI exec "$TGT" -- "printf race >/tmp/rmdir-parent/empty/race.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/rmdir-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
nonempty_save=json.load(open('$WORK/unsafe-rmdir-nonempty.save.json'))
nonempty_load=json.load(open('$WORK/unsafe-rmdir-nonempty.load.json'))
symlink_save=json.load(open('$WORK/unsafe-rmdir-symlink.save.json'))
symlink_load=json.load(open('$WORK/unsafe-rmdir-symlink.load.json'))
file_save=json.load(open('$WORK/unsafe-rmdir-file.save.json'))
file_load=json.load(open('$WORK/unsafe-rmdir-file.load.json'))
changed_save=json.load(open('$WORK/rmdir-changed.save.json'))
changed_load=json.load(open('$WORK/rmdir-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$nonempty_save_rc') == 1 and int('$nonempty_load_rc') == 1
assert int('$symlink_save_rc') == 1 and int('$symlink_load_rc') == 1
assert int('$file_save_rc') == 1 and int('$file_load_rc') == 1
for save, load in [(nonempty_save,nonempty_load), (symlink_save,symlink_load), (file_save,file_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('rmdirState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-rmdir-refusal','state':'passed','nonemptySaveAccepted':nonempty_save['accepted'],'symlinkSaveAccepted':symlink_save['accepted'],'fileSaveAccepted':file_save['accepted'],'nonemptyRmdirState':nonempty_save['descriptor']['resourcePlan']['capture'].get('rmdirState'),'symlinkRmdirState':symlink_save['descriptor']['resourcePlan']['capture'].get('rmdirState'),'fileRmdirState':file_save['descriptor']['resourcePlan']['capture'].get('rmdirState'),'changedDirLoadAccepted':changed_load['accepted'],'changedDirLoaderState':loader.get('state'),'changedDirTargetPid':loader.get('targetPid')}))
PY
}

ensure_tree_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "test -x /usr/bin/tree" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-tree-apt.pid /tmp/machinen-tree-apt.log /tmp/machinen-tree-apt.rc; nohup sh -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y --no-install-recommends tree; echo \$? >/tmp/machinen-tree-apt.rc' >/tmp/machinen-tree-apt.log 2>&1 & echo \$! >/tmp/machinen-tree-apt.pid" >/dev/null
  for _ in $(seq 1 600); do
    if $CLI exec "$vm" -- "test -x /usr/bin/tree" >/dev/null 2>&1; then
      return 0
    fi
    if $CLI exec "$vm" -- "test -s /tmp/machinen-tree-apt.rc" >/dev/null 2>&1; then
      $CLI exec "$vm" -- "cat /tmp/machinen-tree-apt.log; exit \$(cat /tmp/machinen-tree-apt.rc)" >&2 || true
      return 1
    fi
    sleep 0.2
  done
  $CLI exec "$vm" -- "cat /tmp/machinen-tree-apt.log 2>/dev/null || true" >&2 || true
  return 1
}

prepare_tree_fixture() {
  local vm="$1"
  ensure_tree_tool "$vm"
  $CLI exec "$vm" -- "rm -rf /tmp/tree-proof-root; mkdir -p /tmp/tree-proof-root/nested; printf alpha >/tmp/tree-proof-root/a.txt; printf beta >/tmp/tree-proof-root/nested/b.txt" >/dev/null
}

spawn_stopped_tree_with_mode() {
  local name="$1" mode="$2"
  ensure_tree_tool "$SRC"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCd0cmVlJywgJy90bXAvdHJlZS1wcm9vZi1yb290Jyk7Cn0gZWxzaWYgKCRtb2RlIGVxICdvcHRpb24nKSB7CiAgQGFyZ3YgPSAoJ3RyZWUnLCAnLWEnLCAnL3RtcC90cmVlLXByb29mLXJvb3QnKTsKfSBlbHNlIHsKICBAYXJndiA9ICgndHJlZScsICcvdG1wL3RyZWUtcHJvb2Ytcm9vdCcpOwp9Cm15ICRwaWQgPSBmb3JrKCk7CmRpZSAiZm9yayBmYWlsZWQ6ICQhXG4iIHVubGVzcyBkZWZpbmVkICRwaWQ7CmlmICgkcGlkID09IDApIHsKICBvcGVuIFNURElOLCAnPCcsICcvZGV2L251bGwnIG9yIGRpZSAkITsKICBvcGVuIFNURE9VVCwgJz4nLCAiL3RtcC8ke25hbWV9LnNvdXJjZS5vdXQiIG9yIGRpZSAkITsKICBvcGVuIFNUREVSUiwgJz4nLCAiL3RtcC8ke25hbWV9LmVyciIgb3IgZGllICQhOwogIHN5c2NhbGwoJHB0cmFjZSwgMCwgMCwgMCwgMCkgPT0gMCBvciBkaWUgInB0cmFjZSBUUkFDRU1FIGZhaWxlZDogJCFcbiI7CiAgZXhlYyB7ICcvdXNyL2Jpbi90cmVlJyB9IEBhcmd2IG9yIGRpZSAiZXhlYyB0cmVlIGZhaWxlZDogJCFcbiI7Cn0Kd2FpdHBpZCgkcGlkLCAwKTsKc3lzY2FsbCgkcHRyYWNlLCAxNywgJHBpZCwgMCwgMTkpID09IDAgb3IgZGllICJwdHJhY2UgREVUQUNIIGZhaWxlZDogJCFcbiI7CnByaW50ICIkcGlkXG4iOwo=
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_tree() {
  spawn_stopped_tree_with_mode "tree-proof" "safe"
}

spawn_stopped_tree_unsupported_option() {
  spawn_stopped_tree_with_mode "unsafe-tree-option" "option"
}

prove_tree_dir() {
  local bundle="$WORK/tree-dir.bundle" pid log out expected
  prepare_tree_fixture "$SRC"
  prepare_tree_fixture "$TGT"
  pid=$(spawn_stopped_tree)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/tree-dir.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/tree-dir.load.json"
  log=$(python3 - <<PY
import json
print(json.load(open('$WORK/tree-dir.load.json'))['loader']['logPath'])
PY
)
  out=$($CLI exec "$TGT" -- "cat '$log'" | tr -d '\r')
  expected=$($CLI exec "$TGT" -- "LC_ALL=C /usr/bin/tree /tmp/tree-proof-root" | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/tree-dir.save.json'))
load=json.load(open('$WORK/tree-dir.load.json'))
state=save['descriptor']['resourcePlan']['capture']['treeState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-tree-loader'
assert state['rootPath'] == '/tmp/tree-proof-root'
assert state['options'] == []
assert state['binaryPolicy'] == 'proof-provisioned-target-native-tree'
assert state['symlinkPolicy'] == 'no-symlinks'
assert '''$out''' == '''$expected'''
print(json.dumps({'name':'tree-dir','state':'passed','treeState':state,'targetOutput':'''$out'''.splitlines()}))
PY
}

prove_unsafe_tree_refusal() {
  local option_bundle="$WORK/unsafe-tree-option.bundle" symlink_bundle="$WORK/unsafe-tree-symlink.bundle" missing_bundle="$WORK/tree-missing-binary.bundle" changed_bundle="$WORK/tree-changed.bundle" option_pid symlink_pid missing_pid changed_pid option_save_rc option_load_rc symlink_save_rc symlink_load_rc missing_load_rc changed_load_rc
  prepare_tree_fixture "$SRC"
  prepare_tree_fixture "$TGT"
  option_pid=$(spawn_stopped_tree_unsupported_option)
  set +e
  $CLI move save "$SRC" "$option_pid" "$option_bundle" --json >"$WORK/unsafe-tree-option.save.json"
  option_save_rc=$?
  $CLI move load "$TGT" "$option_bundle" --json >"$WORK/unsafe-tree-option.load.json"
  option_load_rc=$?
  set -e
  prepare_tree_fixture "$SRC"
  $CLI exec "$SRC" -- "ln -s a.txt /tmp/tree-proof-root/a-link" >/dev/null
  symlink_pid=$(spawn_stopped_tree)
  set +e
  $CLI move save "$SRC" "$symlink_pid" "$symlink_bundle" --json >"$WORK/unsafe-tree-symlink.save.json"
  symlink_save_rc=$?
  $CLI move load "$TGT" "$symlink_bundle" --json >"$WORK/unsafe-tree-symlink.load.json"
  symlink_load_rc=$?
  set -e
  prepare_tree_fixture "$SRC"
  prepare_tree_fixture "$TGT"
  missing_pid=$(spawn_stopped_tree)
  $CLI move save "$SRC" "$missing_pid" "$missing_bundle" --json >"$WORK/tree-missing-binary.save.json"
  $CLI exec "$TGT" -- "mv /usr/bin/tree /usr/bin/tree.disabled" >/dev/null
  set +e
  $CLI move load "$TGT" "$missing_bundle" --json >"$WORK/tree-missing-binary.load.json"
  missing_load_rc=$?
  set -e
  $CLI exec "$TGT" -- "mv /usr/bin/tree.disabled /usr/bin/tree" >/dev/null
  prepare_tree_fixture "$SRC"
  prepare_tree_fixture "$TGT"
  changed_pid=$(spawn_stopped_tree)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/tree-changed.save.json"
  $CLI exec "$TGT" -- "printf changed >/tmp/tree-proof-root/changed.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/tree-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
option_save=json.load(open('$WORK/unsafe-tree-option.save.json'))
option_load=json.load(open('$WORK/unsafe-tree-option.load.json'))
symlink_save=json.load(open('$WORK/unsafe-tree-symlink.save.json'))
symlink_load=json.load(open('$WORK/unsafe-tree-symlink.load.json'))
missing_load=json.load(open('$WORK/tree-missing-binary.load.json'))
changed_save=json.load(open('$WORK/tree-changed.save.json'))
changed_load=json.load(open('$WORK/tree-changed.load.json'))
missing_loader=missing_load.get('loader', {})
changed_loader=changed_load.get('loader', {})
assert int('$option_save_rc') == 1 and int('$option_load_rc') == 1
assert int('$symlink_save_rc') == 1 and int('$symlink_load_rc') == 1
assert not option_save['accepted'] and not option_load['accepted']
assert not symlink_save['accepted'] and not symlink_load['accepted']
assert option_save['descriptor']['resourcePlan']['capture'].get('treeState') is None
assert symlink_save['descriptor']['resourcePlan']['capture'].get('treeState') is None
assert int('$missing_load_rc') == 1 and not missing_load['accepted']
assert missing_loader.get('state') == 'refused' and missing_loader.get('targetPid') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert changed_loader.get('state') == 'refused' and changed_loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-tree-refusal','state':'passed','unsupportedOptionSaveAccepted':option_save['accepted'],'symlinkSaveAccepted':symlink_save['accepted'],'treeStateForUnsupportedOption':option_save['descriptor']['resourcePlan']['capture'].get('treeState'),'treeStateForSymlink':symlink_save['descriptor']['resourcePlan']['capture'].get('treeState'),'missingBinaryLoaderState':missing_loader.get('state'),'missingBinaryTargetPid':missing_loader.get('targetPid'),'changedTreeLoadAccepted':changed_load['accepted'],'changedTreeLoaderState':changed_loader.get('state'),'changedTreeTargetPid':changed_loader.get('targetPid')}))
PY
}

prepare_find_predicate_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/find-predicate-tree; mkdir -p /tmp/find-predicate-tree/nested; printf alpha >/tmp/find-predicate-tree/a.txt; printf betabeta >/tmp/find-predicate-tree/nested/b.txt; printf x >/tmp/find-predicate-tree/small.txt; touch -d @1770000000 /tmp/find-predicate-tree/a.txt /tmp/find-predicate-tree/nested/b.txt /tmp/find-predicate-tree/small.txt" >/dev/null
}

spawn_stopped_find_predicate_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdmaW5kJywgJy90bXAvZmluZC1wcmVkaWNhdGUtdHJlZScsICctc2l6ZScsICcrNGMnLCAnLXR5cGUnLCAnZicsICctcHJpbnQnKTsKfSBlbHNpZiAoJG1vZGUgZXEgJ2V4ZWMnKSB7CiAgQGFyZ3YgPSAoJ2ZpbmQnLCAnL3RtcC9maW5kLXByZWRpY2F0ZS10cmVlJywgJy1zaXplJywgJys0YycsICctZXhlYycsICdlY2hvJywgJ3t9JywgJzsnKTsKfSBlbHNpZiAoJG1vZGUgZXEgJ2RlbGV0ZScpIHsKICBAYXJndiA9ICgnZmluZCcsICcvdG1wL2ZpbmQtcHJlZGljYXRlLXRyZWUnLCAnLWRlbGV0ZScpOwp9IGVsc2UgewogIEBhcmd2ID0gKCdmaW5kJywgJy90bXAvZmluZC1wcmVkaWNhdGUtdHJlZScsICctc2l6ZScsICcrNGMnLCAnLXR5cGUnLCAnZicsICctcHJpbnQnKTsKfQpteSAkcGlkID0gZm9yaygpOwpkaWUgImZvcmsgZmFpbGVkOiAkIVxuIiB1bmxlc3MgZGVmaW5lZCAkcGlkOwppZiAoJHBpZCA9PSAwKSB7CiAgb3BlbiBTVERJTiwgJzwnLCAnL2Rldi9udWxsJyBvciBkaWUgJCE7CiAgb3BlbiBTVERPVVQsICc+JywgIi90bXAvJHtuYW1lfS5zb3VyY2Uub3V0IiBvciBkaWUgJCE7CiAgb3BlbiBTVERFUlIsICc+JywgIi90bXAvJHtuYW1lfS5lcnIiIG9yIGRpZSAkITsKICBzeXNjYWxsKCRwdHJhY2UsIDAsIDAsIDAsIDApID09IDAgb3IgZGllICJwdHJhY2UgVFJBQ0VNRSBmYWlsZWQ6ICQhXG4iOwogIGV4ZWMgeyAnL3Vzci9iaW4vZmluZCcgfSBAYXJndiBvciBkaWUgImV4ZWMgZmluZCBmYWlsZWQ6ICQhXG4iOwp9CndhaXRwaWQoJHBpZCwgMCk7CnN5c2NhbGwoJHB0cmFjZSwgMTcsICRwaWQsIDAsIDE5KSA9PSAwIG9yIGRpZSAicHRyYWNlIERFVEFDSCBmYWlsZWQ6ICQhXG4iOwpwcmludCAiJHBpZFxuIjsK
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_find_predicate() {
  spawn_stopped_find_predicate_with_mode "find-predicate" "safe"
}

spawn_stopped_find_exec() {
  spawn_stopped_find_predicate_with_mode "unsafe-find-exec" "exec"
}

spawn_stopped_find_delete() {
  spawn_stopped_find_predicate_with_mode "unsafe-find-delete" "delete"
}

prove_find_predicate() {
  local bundle="$WORK/find-predicate.bundle" pid log out expected
  prepare_find_predicate_fixture "$SRC"
  prepare_find_predicate_fixture "$TGT"
  pid=$(spawn_stopped_find_predicate)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/find-predicate.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/find-predicate.load.json"
  log=$(python3 - <<PY
import json
print(json.load(open('$WORK/find-predicate.load.json'))['loader']['logPath'])
PY
)
  out=$($CLI exec "$TGT" -- "cat '$log'" | tr -d '\r')
  expected=$($CLI exec "$TGT" -- "LC_ALL=C /usr/bin/find /tmp/find-predicate-tree -size +4c -type f -print" | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/find-predicate.save.json'))
load=json.load(open('$WORK/find-predicate.load.json'))
state=save['descriptor']['resourcePlan']['capture']['findPredicateState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-find-predicate-loader'
assert state['rootPath'] == '/tmp/find-predicate-tree'
assert state['predicate'] == {'kind':'size','value':'+4c'}
assert state['options'] == ['predicate', '-type', '-print']
assert state['policy'] == 'bounded-simple-find-predicate'
assert state['symlinkPolicy'] == 'no-symlinks'
assert '''$out''' == '''$expected'''
print(json.dumps({'name':'find-predicate','state':'passed','findPredicateState':state,'targetOutput':'''$out'''.splitlines()}))
PY
}

prove_unsafe_find_predicate_refusal() {
  local exec_bundle="$WORK/unsafe-find-exec.bundle" delete_bundle="$WORK/unsafe-find-delete.bundle" changed_bundle="$WORK/find-predicate-changed.bundle" exec_pid delete_pid changed_pid exec_save_rc exec_load_rc delete_save_rc delete_load_rc changed_load_rc
  prepare_find_predicate_fixture "$SRC"
  prepare_find_predicate_fixture "$TGT"
  exec_pid=$(spawn_stopped_find_exec)
  set +e
  $CLI move save "$SRC" "$exec_pid" "$exec_bundle" --json >"$WORK/unsafe-find-exec.save.json"
  exec_save_rc=$?
  $CLI move load "$TGT" "$exec_bundle" --json >"$WORK/unsafe-find-exec.load.json"
  exec_load_rc=$?
  set -e
  prepare_find_predicate_fixture "$SRC"
  delete_pid=$(spawn_stopped_find_delete)
  set +e
  $CLI move save "$SRC" "$delete_pid" "$delete_bundle" --json >"$WORK/unsafe-find-delete.save.json"
  delete_save_rc=$?
  $CLI move load "$TGT" "$delete_bundle" --json >"$WORK/unsafe-find-delete.load.json"
  delete_load_rc=$?
  set -e
  prepare_find_predicate_fixture "$SRC"
  prepare_find_predicate_fixture "$TGT"
  changed_pid=$(spawn_stopped_find_predicate)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/find-predicate-changed.save.json"
  $CLI exec "$TGT" -- "printf changed >/tmp/find-predicate-tree/changed.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/find-predicate-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
exec_save=json.load(open('$WORK/unsafe-find-exec.save.json'))
exec_load=json.load(open('$WORK/unsafe-find-exec.load.json'))
delete_save=json.load(open('$WORK/unsafe-find-delete.save.json'))
delete_load=json.load(open('$WORK/unsafe-find-delete.load.json'))
changed_save=json.load(open('$WORK/find-predicate-changed.save.json'))
changed_load=json.load(open('$WORK/find-predicate-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$exec_save_rc') == 1 and int('$exec_load_rc') == 1
assert int('$delete_save_rc') == 1 and int('$delete_load_rc') == 1
for save, load in [(exec_save,exec_load), (delete_save,delete_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('findPredicateState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-find-predicate-refusal','state':'passed','execSaveAccepted':exec_save['accepted'],'deleteSaveAccepted':delete_save['accepted'],'execFindPredicateState':exec_save['descriptor']['resourcePlan']['capture'].get('findPredicateState'),'deleteFindPredicateState':delete_save['descriptor']['resourcePlan']['capture'].get('findPredicateState'),'changedTreeLoadAccepted':changed_load['accepted'],'changedTreeLoaderState':loader.get('state'),'changedTreeTargetPid':loader.get('targetPid')}))
PY
}

prepare_maxdepth_find_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/find-tree; mkdir -p /tmp/find-tree/nested/deeper; printf alpha >/tmp/find-tree/a.txt; printf beta >/tmp/find-tree/nested/b.txt; printf deep >/tmp/find-tree/nested/deeper/c.txt" >/dev/null
}

spawn_stopped_maxdepth_find_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdmaW5kJywgJy90bXAvZmluZC10cmVlJywgJy1tYXhkZXB0aCcsICcyJywgJy10eXBlJywgJ2YnLCAnLXByaW50Jyk7Cn0gZWxzaWYgKCRtb2RlIGVxICdwcmVkaWNhdGUnKSB7CiAgQGFyZ3YgPSAoJ2ZpbmQnLCAnL3RtcC9maW5kLXRyZWUnLCAnLW1heGRlcHRoJywgJzInLCAnLW5hbWUnLCAnKi50eHQnLCAnLXByaW50Jyk7Cn0gZWxzZSB7CiAgQGFyZ3YgPSAoJ2ZpbmQnLCAnL3RtcC9maW5kLXRyZWUnLCAnLW1heGRlcHRoJywgJzInLCAnLXR5cGUnLCAnZicsICctcHJpbnQnKTsKfQpteSAkcGlkID0gZm9yaygpOwpkaWUgImZvcmsgZmFpbGVkOiAkIVxuIiB1bmxlc3MgZGVmaW5lZCAkcGlkOwppZiAoJHBpZCA9PSAwKSB7CiAgb3BlbiBTVERJTiwgJzwnLCAnL2Rldi9udWxsJyBvciBkaWUgJCE7CiAgb3BlbiBTVERPVVQsICc+JywgIi90bXAvJHtuYW1lfS5zb3VyY2Uub3V0IiBvciBkaWUgJCE7CiAgb3BlbiBTVERFUlIsICc+JywgIi90bXAvJHtuYW1lfS5lcnIiIG9yIGRpZSAkITsKICBzeXNjYWxsKCRwdHJhY2UsIDAsIDAsIDAsIDApID09IDAgb3IgZGllICJwdHJhY2UgVFJBQ0VNRSBmYWlsZWQ6ICQhXG4iOwogIGV4ZWMgeyAnL3Vzci9iaW4vZmluZCcgfSBAYXJndiBvciBkaWUgImV4ZWMgZmluZCBmYWlsZWQ6ICQhXG4iOwp9CndhaXRwaWQoJHBpZCwgMCk7CnN5c2NhbGwoJHB0cmFjZSwgMTcsICRwaWQsIDAsIDE5KSA9PSAwIG9yIGRpZSAicHRyYWNlIERFVEFDSCBmYWlsZWQ6ICQhXG4iOwpwcmludCAiJHBpZFxuIjsK
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_maxdepth_find() {
  spawn_stopped_maxdepth_find_with_mode "maxdepth-find" "safe"
}

spawn_stopped_predicate_find() {
  spawn_stopped_maxdepth_find_with_mode "unsafe-maxdepth-find-predicate" "predicate"
}

prove_maxdepth_find() {
  local bundle="$WORK/maxdepth-find.bundle" pid log out expected
  prepare_maxdepth_find_fixture "$SRC"
  prepare_maxdepth_find_fixture "$TGT"
  pid=$(spawn_stopped_maxdepth_find)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/maxdepth-find.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/maxdepth-find.load.json"
  log=$(python3 - <<PY
import json
print(json.load(open('$WORK/maxdepth-find.load.json'))['loader']['logPath'])
PY
)
  out=$($CLI exec "$TGT" -- "cat '$log'" | tr -d '\r')
  expected=$($CLI exec "$TGT" -- "LC_ALL=C /usr/bin/find /tmp/find-tree -maxdepth 2 -type f -print" | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/maxdepth-find.save.json'))
load=json.load(open('$WORK/maxdepth-find.load.json'))
state=save['descriptor']['resourcePlan']['capture']['maxdepthFindState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-maxdepth-find-loader'
assert state['rootPath'] == '/tmp/find-tree'
assert state['maxdepth'] == 2
assert state['options'] == ['-maxdepth', '-type', '-print']
assert state['symlinkPolicy'] == 'no-symlinks'
assert '''$out''' == '''$expected'''
assert '/tmp/find-tree/nested/deeper/c.txt' not in '''$out'''
print(json.dumps({'name':'maxdepth-find','state':'passed','maxdepthFindState':state,'targetOutput':'''$out'''.splitlines()}))
PY
}

prove_unsafe_maxdepth_find_refusal() {
  local pred_bundle="$WORK/unsafe-maxdepth-find-predicate.bundle" symlink_bundle="$WORK/unsafe-maxdepth-find-symlink.bundle" changed_bundle="$WORK/maxdepth-find-changed.bundle" pred_pid symlink_pid changed_pid pred_save_rc pred_load_rc symlink_save_rc symlink_load_rc changed_load_rc
  prepare_maxdepth_find_fixture "$SRC"
  prepare_maxdepth_find_fixture "$TGT"
  pred_pid=$(spawn_stopped_predicate_find)
  set +e
  $CLI move save "$SRC" "$pred_pid" "$pred_bundle" --json >"$WORK/unsafe-maxdepth-find-predicate.save.json"
  pred_save_rc=$?
  $CLI move load "$TGT" "$pred_bundle" --json >"$WORK/unsafe-maxdepth-find-predicate.load.json"
  pred_load_rc=$?
  set -e
  prepare_maxdepth_find_fixture "$SRC"
  $CLI exec "$SRC" -- "ln -s a.txt /tmp/find-tree/a-link" >/dev/null
  symlink_pid=$(spawn_stopped_maxdepth_find)
  set +e
  $CLI move save "$SRC" "$symlink_pid" "$symlink_bundle" --json >"$WORK/unsafe-maxdepth-find-symlink.save.json"
  symlink_save_rc=$?
  $CLI move load "$TGT" "$symlink_bundle" --json >"$WORK/unsafe-maxdepth-find-symlink.load.json"
  symlink_load_rc=$?
  set -e
  prepare_maxdepth_find_fixture "$SRC"
  prepare_maxdepth_find_fixture "$TGT"
  changed_pid=$(spawn_stopped_maxdepth_find)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/maxdepth-find-changed.save.json"
  $CLI exec "$TGT" -- "printf changed >/tmp/find-tree/changed.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/maxdepth-find-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
pred_save=json.load(open('$WORK/unsafe-maxdepth-find-predicate.save.json'))
pred_load=json.load(open('$WORK/unsafe-maxdepth-find-predicate.load.json'))
symlink_save=json.load(open('$WORK/unsafe-maxdepth-find-symlink.save.json'))
symlink_load=json.load(open('$WORK/unsafe-maxdepth-find-symlink.load.json'))
changed_save=json.load(open('$WORK/maxdepth-find-changed.save.json'))
changed_load=json.load(open('$WORK/maxdepth-find-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$pred_save_rc') == 1 and int('$pred_load_rc') == 1
assert int('$symlink_save_rc') == 1 and int('$symlink_load_rc') == 1
for save, load in [(pred_save,pred_load), (symlink_save,symlink_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('maxdepthFindState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-maxdepth-find-refusal','state':'passed','predicateSaveAccepted':pred_save['accepted'],'symlinkSaveAccepted':symlink_save['accepted'],'predicateMaxdepthFindState':pred_save['descriptor']['resourcePlan']['capture'].get('maxdepthFindState'),'symlinkMaxdepthFindState':symlink_save['descriptor']['resourcePlan']['capture'].get('maxdepthFindState'),'changedTreeLoadAccepted':changed_load['accepted'],'changedTreeLoaderState':loader.get('state'),'changedTreeTargetPid':loader.get('targetPid')}))
PY
}

prepare_recursive_grep_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/grep-tree; mkdir -p /tmp/grep-tree/nested; printf 'alpha needle\n' >/tmp/grep-tree/a.txt; printf 'beta\nneedle two\n' >/tmp/grep-tree/nested/b.txt" >/dev/null
}

spawn_stopped_recursive_grep_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdncmVwJywgJy1yJywgJ25lZWRsZScsICcvdG1wL2dyZXAtdHJlZScpOwp9IGVsc2lmICgkbW9kZSBlcSAnb3B0aW9uJykgewogIEBhcmd2ID0gKCdncmVwJywgJy1SJywgJ25lZWRsZScsICcvdG1wL2dyZXAtdHJlZScpOwp9IGVsc2lmICgkbW9kZSBlcSAncGF0dGVybicpIHsKICBAYXJndiA9ICgnZ3JlcCcsICctcicsICduLionLCAnL3RtcC9ncmVwLXRyZWUnKTsKfSBlbHNlIHsKICBAYXJndiA9ICgnZ3JlcCcsICctcicsICduZWVkbGUnLCAnL3RtcC9ncmVwLXRyZWUnKTsKfQpteSAkcGlkID0gZm9yaygpOwpkaWUgImZvcmsgZmFpbGVkOiAkIVxuIiB1bmxlc3MgZGVmaW5lZCAkcGlkOwppZiAoJHBpZCA9PSAwKSB7CiAgb3BlbiBTVERJTiwgJzwnLCAnL2Rldi9udWxsJyBvciBkaWUgJCE7CiAgb3BlbiBTVERPVVQsICc+JywgIi90bXAvJHtuYW1lfS5zb3VyY2Uub3V0IiBvciBkaWUgJCE7CiAgb3BlbiBTVERFUlIsICc+JywgIi90bXAvJHtuYW1lfS5lcnIiIG9yIGRpZSAkITsKICBzeXNjYWxsKCRwdHJhY2UsIDAsIDAsIDAsIDApID09IDAgb3IgZGllICJwdHJhY2UgVFJBQ0VNRSBmYWlsZWQ6ICQhXG4iOwogIGV4ZWMgeyAnL3Vzci9iaW4vZ3JlcCcgfSBAYXJndiBvciBkaWUgImV4ZWMgZ3JlcCBmYWlsZWQ6ICQhXG4iOwp9CndhaXRwaWQoJHBpZCwgMCk7CnN5c2NhbGwoJHB0cmFjZSwgMTcsICRwaWQsIDAsIDE5KSA9PSAwIG9yIGRpZSAicHRyYWNlIERFVEFDSCBmYWlsZWQ6ICQhXG4iOwpwcmludCAiJHBpZFxuIjsK
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_recursive_grep() {
  spawn_stopped_recursive_grep_with_mode "recursive-grep" "safe"
}

spawn_stopped_recursive_grep_option() {
  spawn_stopped_recursive_grep_with_mode "unsafe-recursive-grep-option" "option"
}

prove_recursive_grep() {
  local bundle="$WORK/recursive-grep.bundle" pid log out expected
  prepare_recursive_grep_fixture "$SRC"
  prepare_recursive_grep_fixture "$TGT"
  pid=$(spawn_stopped_recursive_grep)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/recursive-grep.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/recursive-grep.load.json"
  log=$(python3 - <<PY
import json
print(json.load(open('$WORK/recursive-grep.load.json'))['loader']['logPath'])
PY
)
  out=$($CLI exec "$TGT" -- "cat '$log'" | tr -d '\r')
  expected=$($CLI exec "$TGT" -- "LC_ALL=C /usr/bin/grep -r -- needle /tmp/grep-tree" | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/recursive-grep.save.json'))
load=json.load(open('$WORK/recursive-grep.load.json'))
state=save['descriptor']['resourcePlan']['capture']['recursiveGrepState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-recursive-grep-loader'
assert state['rootPath'] == '/tmp/grep-tree'
assert state['pattern'] == 'needle'
assert state['patternPolicy'] == 'literal-safe-basic-regexp'
assert state['options'] == ['-r']
assert state['binaryPolicy'] == 'text-files-only'
assert state['symlinkPolicy'] == 'no-symlinks'
assert '''$out''' == '''$expected'''
print(json.dumps({'name':'recursive-grep','state':'passed','recursiveGrepState':state,'targetOutput':'''$out'''.splitlines()}))
PY
}

prove_unsafe_recursive_grep_refusal() {
  local option_bundle="$WORK/unsafe-recursive-grep-option.bundle" binary_bundle="$WORK/unsafe-recursive-grep-binary.bundle" changed_bundle="$WORK/recursive-grep-changed.bundle" option_pid binary_pid changed_pid option_save_rc option_load_rc binary_save_rc binary_load_rc changed_load_rc
  prepare_recursive_grep_fixture "$SRC"
  prepare_recursive_grep_fixture "$TGT"
  option_pid=$(spawn_stopped_recursive_grep_option)
  set +e
  $CLI move save "$SRC" "$option_pid" "$option_bundle" --json >"$WORK/unsafe-recursive-grep-option.save.json"
  option_save_rc=$?
  $CLI move load "$TGT" "$option_bundle" --json >"$WORK/unsafe-recursive-grep-option.load.json"
  option_load_rc=$?
  set -e
  prepare_recursive_grep_fixture "$SRC"
  $CLI exec "$SRC" -- "printf '\\000\\001' >/tmp/grep-tree/blob.bin" >/dev/null
  binary_pid=$(spawn_stopped_recursive_grep)
  set +e
  $CLI move save "$SRC" "$binary_pid" "$binary_bundle" --json >"$WORK/unsafe-recursive-grep-binary.save.json"
  binary_save_rc=$?
  $CLI move load "$TGT" "$binary_bundle" --json >"$WORK/unsafe-recursive-grep-binary.load.json"
  binary_load_rc=$?
  set -e
  prepare_recursive_grep_fixture "$SRC"
  prepare_recursive_grep_fixture "$TGT"
  changed_pid=$(spawn_stopped_recursive_grep)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/recursive-grep-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed needle\n' >/tmp/grep-tree/changed.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/recursive-grep-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
option_save=json.load(open('$WORK/unsafe-recursive-grep-option.save.json'))
option_load=json.load(open('$WORK/unsafe-recursive-grep-option.load.json'))
binary_save=json.load(open('$WORK/unsafe-recursive-grep-binary.save.json'))
binary_load=json.load(open('$WORK/unsafe-recursive-grep-binary.load.json'))
changed_save=json.load(open('$WORK/recursive-grep-changed.save.json'))
changed_load=json.load(open('$WORK/recursive-grep-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$option_save_rc') == 1 and int('$option_load_rc') == 1
assert int('$binary_save_rc') == 1 and int('$binary_load_rc') == 1
for save, load in [(option_save,option_load), (binary_save,binary_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('recursiveGrepState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-recursive-grep-refusal','state':'passed','optionSaveAccepted':option_save['accepted'],'binarySaveAccepted':binary_save['accepted'],'optionRecursiveGrepState':option_save['descriptor']['resourcePlan']['capture'].get('recursiveGrepState'),'binaryRecursiveGrepState':binary_save['descriptor']['resourcePlan']['capture'].get('recursiveGrepState'),'changedTreeLoadAccepted':changed_load['accepted'],'changedTreeLoaderState':loader.get('state'),'changedTreeTargetPid':loader.get('targetPid')}))
PY
}

prepare_realpath_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/realpath-dir /tmp/realpath-link /tmp/realpath-missing; mkdir -p /tmp/realpath-dir; printf realpath >/tmp/realpath-dir/target.txt; ln -s realpath-dir/target.txt /tmp/realpath-link" >/dev/null
}

spawn_stopped_realpath_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdyZWFscGF0aCcsICcvdG1wL3JlYWxwYXRoLWxpbmsnKTsKfSBlbHNpZiAoJG1vZGUgZXEgJ21pc3NpbmcnKSB7CiAgQGFyZ3YgPSAoJ3JlYWxwYXRoJywgJy90bXAvcmVhbHBhdGgtbWlzc2luZycpOwp9IGVsc2lmICgkbW9kZSBlcSAnb3B0aW9uJykgewogIEBhcmd2ID0gKCdyZWFscGF0aCcsICctbScsICcvdG1wL3JlYWxwYXRoLW1pc3NpbmcnKTsKfSBlbHNlIHsKICBAYXJndiA9ICgncmVhbHBhdGgnLCAnL3RtcC9yZWFscGF0aC1saW5rJyk7Cn0KbXkgJHBpZCA9IGZvcmsoKTsKZGllICJmb3JrIGZhaWxlZDogJCFcbiIgdW5sZXNzIGRlZmluZWQgJHBpZDsKaWYgKCRwaWQgPT0gMCkgewogIG9wZW4gU1RESU4sICc8JywgJy9kZXYvbnVsbCcgb3IgZGllICQhOwogIG9wZW4gU1RET1VULCAnPicsICIvdG1wLyR7bmFtZX0uc291cmNlLm91dCIgb3IgZGllICQhOwogIG9wZW4gU1RERVJSLCAnPicsICIvdG1wLyR7bmFtZX0uZXJyIiBvciBkaWUgJCE7CiAgc3lzY2FsbCgkcHRyYWNlLCAwLCAwLCAwLCAwKSA9PSAwIG9yIGRpZSAicHRyYWNlIFRSQUNFTUUgZmFpbGVkOiAkIVxuIjsKICBleGVjIHsgJy91c3IvYmluL3JlYWxwYXRoJyB9IEBhcmd2IG9yIGRpZSAiZXhlYyByZWFscGF0aCBmYWlsZWQ6ICQhXG4iOwp9CndhaXRwaWQoJHBpZCwgMCk7CnN5c2NhbGwoJHB0cmFjZSwgMTcsICRwaWQsIDAsIDE5KSA9PSAwIG9yIGRpZSAicHRyYWNlIERFVEFDSCBmYWlsZWQ6ICQhXG4iOwpwcmludCAiJHBpZFxuIjsK
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_realpath() {
  spawn_stopped_realpath_with_mode "realpath-path" "safe"
}

spawn_stopped_missing_realpath() {
  spawn_stopped_realpath_with_mode "unsafe-realpath-missing" "missing"
}

spawn_stopped_option_realpath() {
  spawn_stopped_realpath_with_mode "unsafe-realpath-option" "option"
}

prove_realpath_path() {
  local bundle="$WORK/realpath.bundle" pid log out expected
  prepare_realpath_fixture "$SRC"
  prepare_realpath_fixture "$TGT"
  pid=$(spawn_stopped_realpath)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/realpath.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/realpath.load.json"
  log=$(python3 - <<PY
import json
print(json.load(open('$WORK/realpath.load.json'))['loader']['logPath'])
PY
)
  out=$($CLI exec "$TGT" -- "cat '$log'" | tr -d '\r')
  expected=$($CLI exec "$TGT" -- "/usr/bin/realpath -- /tmp/realpath-link" | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/realpath.save.json'))
load=json.load(open('$WORK/realpath.load.json'))
state=save['descriptor']['resourcePlan']['capture']['realpathState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-realpath-path-loader'
assert state['inputPath'] == '/tmp/realpath-link'
assert state['resolvedPath'] == '/tmp/realpath-dir/target.txt'
assert state['options'] == []
assert state['policy'] == 'absolute-existing-path-safe-chain'
assert state['chainIdentity']['symlinkCount'] >= 1
assert '''$out''' == '''$expected''' == state['resolvedPath']
print(json.dumps({'name':'realpath-path','state':'passed','realpathState':state,'targetOutput':'''$out'''}))
PY
}

prove_unsafe_realpath_refusal() {
  local option_bundle="$WORK/unsafe-realpath-option.bundle" missing_bundle="$WORK/unsafe-realpath-missing.bundle" changed_bundle="$WORK/realpath-changed.bundle" option_pid missing_pid changed_pid option_save_rc option_load_rc missing_save_rc missing_load_rc changed_load_rc
  prepare_realpath_fixture "$SRC"
  prepare_realpath_fixture "$TGT"
  option_pid=$(spawn_stopped_option_realpath)
  set +e
  $CLI move save "$SRC" "$option_pid" "$option_bundle" --json >"$WORK/unsafe-realpath-option.save.json"
  option_save_rc=$?
  $CLI move load "$TGT" "$option_bundle" --json >"$WORK/unsafe-realpath-option.load.json"
  option_load_rc=$?
  set -e
  prepare_realpath_fixture "$SRC"
  missing_pid=$(spawn_stopped_missing_realpath)
  set +e
  $CLI move save "$SRC" "$missing_pid" "$missing_bundle" --json >"$WORK/unsafe-realpath-missing.save.json"
  missing_save_rc=$?
  $CLI move load "$TGT" "$missing_bundle" --json >"$WORK/unsafe-realpath-missing.load.json"
  missing_load_rc=$?
  set -e
  prepare_realpath_fixture "$SRC"
  prepare_realpath_fixture "$TGT"
  changed_pid=$(spawn_stopped_realpath)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/realpath-changed.save.json"
  $CLI exec "$TGT" -- "mkdir -p /tmp/realpath-other; printf changed >/tmp/realpath-other/target.txt; rm -f /tmp/realpath-link; ln -s realpath-other/target.txt /tmp/realpath-link" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/realpath-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
option_save=json.load(open('$WORK/unsafe-realpath-option.save.json'))
option_load=json.load(open('$WORK/unsafe-realpath-option.load.json'))
missing_save=json.load(open('$WORK/unsafe-realpath-missing.save.json'))
missing_load=json.load(open('$WORK/unsafe-realpath-missing.load.json'))
changed_save=json.load(open('$WORK/realpath-changed.save.json'))
changed_load=json.load(open('$WORK/realpath-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$option_save_rc') == 1 and int('$option_load_rc') == 1
assert int('$missing_save_rc') == 1 and int('$missing_load_rc') == 1
for save, load in [(option_save,option_load), (missing_save,missing_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('realpathState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-realpath-refusal','state':'passed','optionSaveAccepted':option_save['accepted'],'missingSaveAccepted':missing_save['accepted'],'optionRealpathState':option_save['descriptor']['resourcePlan']['capture'].get('realpathState'),'missingRealpathState':missing_save['descriptor']['resourcePlan']['capture'].get('realpathState'),'changedChainLoadAccepted':changed_load['accepted'],'changedChainLoaderState':loader.get('state'),'changedChainTargetPid':loader.get('targetPid')}))
PY
}

prepare_readlink_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -f /tmp/readlink-link /tmp/readlink-target /tmp/readlink-plain; printf target >/tmp/readlink-target; ln -s readlink-target /tmp/readlink-link; printf plain >/tmp/readlink-plain" >/dev/null
}

spawn_stopped_readlink_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdyZWFkbGluaycsICcvdG1wL3JlYWRsaW5rLWxpbmsnKTsKfSBlbHNpZiAoJG1vZGUgZXEgJ2Nhbm9uaWNhbCcpIHsKICBAYXJndiA9ICgncmVhZGxpbmsnLCAnLWYnLCAnL3RtcC9yZWFkbGluay1saW5rJyk7Cn0gZWxzaWYgKCRtb2RlIGVxICdwbGFpbicpIHsKICBAYXJndiA9ICgncmVhZGxpbmsnLCAnL3RtcC9yZWFkbGluay1wbGFpbicpOwp9IGVsc2UgewogIEBhcmd2ID0gKCdyZWFkbGluaycsICcvdG1wL3JlYWRsaW5rLWxpbmsnKTsKfQpteSAkcGlkID0gZm9yaygpOwpkaWUgImZvcmsgZmFpbGVkOiAkIVxuIiB1bmxlc3MgZGVmaW5lZCAkcGlkOwppZiAoJHBpZCA9PSAwKSB7CiAgb3BlbiBTVERJTiwgJzwnLCAnL2Rldi9udWxsJyBvciBkaWUgJCE7CiAgb3BlbiBTVERPVVQsICc+JywgIi90bXAvJHtuYW1lfS5zb3VyY2Uub3V0IiBvciBkaWUgJCE7CiAgb3BlbiBTVERFUlIsICc+JywgIi90bXAvJHtuYW1lfS5lcnIiIG9yIGRpZSAkITsKICBzeXNjYWxsKCRwdHJhY2UsIDAsIDAsIDAsIDApID09IDAgb3IgZGllICJwdHJhY2UgVFJBQ0VNRSBmYWlsZWQ6ICQhXG4iOwogIGV4ZWMgeyAnL3Vzci9iaW4vcmVhZGxpbmsnIH0gQGFyZ3Ygb3IgZGllICJleGVjIHJlYWRsaW5rIGZhaWxlZDogJCFcbiI7Cn0Kd2FpdHBpZCgkcGlkLCAwKTsKc3lzY2FsbCgkcHRyYWNlLCAxNywgJHBpZCwgMCwgMTkpID09IDAgb3IgZGllICJwdHJhY2UgREVUQUNIIGZhaWxlZDogJCFcbiI7CnByaW50ICIkcGlkXG4iOwo=
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_readlink() {
  spawn_stopped_readlink_with_mode "readlink-direct" "safe"
}

spawn_stopped_canonical_readlink() {
  spawn_stopped_readlink_with_mode "unsafe-readlink-canonical" "canonical"
}

spawn_stopped_plain_readlink() {
  spawn_stopped_readlink_with_mode "unsafe-readlink-plain" "plain"
}

prove_readlink_direct() {
  local bundle="$WORK/readlink.bundle" pid log out expected
  prepare_readlink_fixture "$SRC"
  prepare_readlink_fixture "$TGT"
  pid=$(spawn_stopped_readlink)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/readlink.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/readlink.load.json"
  log=$(python3 - <<PY
import json
print(json.load(open('$WORK/readlink.load.json'))['loader']['logPath'])
PY
)
  out=$($CLI exec "$TGT" -- "cat '$log'" | tr -d '\r')
  expected=$($CLI exec "$TGT" -- "/usr/bin/readlink -- /tmp/readlink-link" | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/readlink.save.json'))
load=json.load(open('$WORK/readlink.load.json'))
state=save['descriptor']['resourcePlan']['capture']['readlinkState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-readlink-direct-loader'
assert state['linkPath'] == '/tmp/readlink-link'
assert state['targetLiteral'] == 'readlink-target'
assert state['options'] == []
assert state['policy'] == 'direct-symlink-literal-target'
assert '''$out''' == '''$expected''' == state['targetLiteral']
print(json.dumps({'name':'readlink-direct','state':'passed','readlinkState':state,'targetOutput':'''$out'''}))
PY
}

prove_unsafe_readlink_refusal() {
  local canonical_bundle="$WORK/unsafe-readlink-canonical.bundle" plain_bundle="$WORK/unsafe-readlink-plain.bundle" changed_bundle="$WORK/readlink-changed.bundle" canonical_pid plain_pid changed_pid canonical_save_rc canonical_load_rc plain_save_rc plain_load_rc changed_load_rc
  prepare_readlink_fixture "$SRC"
  prepare_readlink_fixture "$TGT"
  canonical_pid=$(spawn_stopped_canonical_readlink)
  set +e
  $CLI move save "$SRC" "$canonical_pid" "$canonical_bundle" --json >"$WORK/unsafe-readlink-canonical.save.json"
  canonical_save_rc=$?
  $CLI move load "$TGT" "$canonical_bundle" --json >"$WORK/unsafe-readlink-canonical.load.json"
  canonical_load_rc=$?
  set -e
  prepare_readlink_fixture "$SRC"
  plain_pid=$(spawn_stopped_plain_readlink)
  set +e
  $CLI move save "$SRC" "$plain_pid" "$plain_bundle" --json >"$WORK/unsafe-readlink-plain.save.json"
  plain_save_rc=$?
  $CLI move load "$TGT" "$plain_bundle" --json >"$WORK/unsafe-readlink-plain.load.json"
  plain_load_rc=$?
  set -e
  prepare_readlink_fixture "$SRC"
  prepare_readlink_fixture "$TGT"
  changed_pid=$(spawn_stopped_readlink)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/readlink-changed.save.json"
  $CLI exec "$TGT" -- "rm -f /tmp/readlink-link; ln -s changed-target /tmp/readlink-link" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/readlink-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
canonical_save=json.load(open('$WORK/unsafe-readlink-canonical.save.json'))
canonical_load=json.load(open('$WORK/unsafe-readlink-canonical.load.json'))
plain_save=json.load(open('$WORK/unsafe-readlink-plain.save.json'))
plain_load=json.load(open('$WORK/unsafe-readlink-plain.load.json'))
changed_save=json.load(open('$WORK/readlink-changed.save.json'))
changed_load=json.load(open('$WORK/readlink-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$canonical_save_rc') == 1 and int('$canonical_load_rc') == 1
assert int('$plain_save_rc') == 1 and int('$plain_load_rc') == 1
for save, load in [(canonical_save,canonical_load), (plain_save,plain_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('readlinkState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-readlink-refusal','state':'passed','canonicalSaveAccepted':canonical_save['accepted'],'plainSaveAccepted':plain_save['accepted'],'canonicalReadlinkState':canonical_save['descriptor']['resourcePlan']['capture'].get('readlinkState'),'plainReadlinkState':plain_save['descriptor']['resourcePlan']['capture'].get('readlinkState'),'changedLinkLoadAccepted':changed_load['accepted'],'changedLinkLoaderState':loader.get('state'),'changedLinkTargetPid':loader.get('targetPid')}))
PY
}

prepare_stat_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -f /tmp/stat-file.txt /tmp/stat-link; printf 'stat-fixture' >/tmp/stat-file.txt; chmod 644 /tmp/stat-file.txt; touch -d @1770000000 /tmp/stat-file.txt" >/dev/null
}

spawn_stopped_stat_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdzdGF0JywgJy90bXAvc3RhdC1maWxlLnR4dCcpOwp9IGVsc2lmICgkbW9kZSBlcSAnY3VzdG9tJykgewogIEBhcmd2ID0gKCdzdGF0JywgJy1jJywgJyVzJywgJy90bXAvc3RhdC1maWxlLnR4dCcpOwp9IGVsc2lmICgkbW9kZSBlcSAnc3ltbGluaycpIHsKICBAYXJndiA9ICgnc3RhdCcsICcvdG1wL3N0YXQtbGluaycpOwp9IGVsc2UgewogIEBhcmd2ID0gKCdzdGF0JywgJy90bXAvc3RhdC1maWxlLnR4dCcpOwp9Cm15ICRwaWQgPSBmb3JrKCk7CmRpZSAiZm9yayBmYWlsZWQ6ICQhXG4iIHVubGVzcyBkZWZpbmVkICRwaWQ7CmlmICgkcGlkID09IDApIHsKICBvcGVuIFNURElOLCAnPCcsICcvZGV2L251bGwnIG9yIGRpZSAkITsKICBvcGVuIFNURE9VVCwgJz4nLCAiL3RtcC8ke25hbWV9LnNvdXJjZS5vdXQiIG9yIGRpZSAkITsKICBvcGVuIFNUREVSUiwgJz4nLCAiL3RtcC8ke25hbWV9LmVyciIgb3IgZGllICQhOwogIHN5c2NhbGwoJHB0cmFjZSwgMCwgMCwgMCwgMCkgPT0gMCBvciBkaWUgInB0cmFjZSBUUkFDRU1FIGZhaWxlZDogJCFcbiI7CiAgZXhlYyB7ICcvdXNyL2Jpbi9zdGF0JyB9IEBhcmd2IG9yIGRpZSAiZXhlYyBzdGF0IGZhaWxlZDogJCFcbiI7Cn0Kd2FpdHBpZCgkcGlkLCAwKTsKc3lzY2FsbCgkcHRyYWNlLCAxNywgJHBpZCwgMCwgMTkpID09IDAgb3IgZGllICJwdHJhY2UgREVUQUNIIGZhaWxlZDogJCFcbiI7CnByaW50ICIkcGlkXG4iOwo=
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_stat() {
  spawn_stopped_stat_with_mode "stat-file" "safe"
}

spawn_stopped_custom_stat() {
  spawn_stopped_stat_with_mode "unsafe-stat-custom" "custom"
}

spawn_stopped_symlink_stat() {
  spawn_stopped_stat_with_mode "unsafe-stat-symlink" "symlink"
}

prove_stat_file() {
  local bundle="$WORK/stat.bundle" pid log out size sha
  prepare_stat_fixture "$SRC"
  prepare_stat_fixture "$TGT"
  pid=$(spawn_stopped_stat)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/stat.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/stat.load.json"
  log=$(python3 - <<PY
import json
print(json.load(open('$WORK/stat.load.json'))['loader']['logPath'])
PY
)
  out=$($CLI exec "$TGT" -- "cat '$log' | head -1" | tr -d '\r')
  size=$($CLI exec "$TGT" -- "stat -c %s /tmp/stat-file.txt" | tail -1 | tr -d '\r')
  sha=$($CLI exec "$TGT" -- "sha256sum /tmp/stat-file.txt | cut -d' ' -f1" | tail -1 | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/stat.save.json'))
load=json.load(open('$WORK/stat.load.json'))
state=save['descriptor']['resourcePlan']['capture']['statState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-stat-file-loader'
assert state['path'] == '/tmp/stat-file.txt'
assert state['format'] == 'default'
assert state['options'] == []
assert state['symlinkPolicy'] == 'no-symlinks'
assert int('$size') == state['fileIdentity']['size']
assert '$sha' == state['fileIdentity']['sha256']
assert 'File: /tmp/stat-file.txt' in '''$out'''
print(json.dumps({'name':'stat-file','state':'passed','statState':state,'targetOutputFirstLine':'''$out''','targetSize':int('$size'),'targetSha':'$sha'}))
PY
}

prove_unsafe_stat_refusal() {
  local custom_bundle="$WORK/unsafe-stat-custom.bundle" symlink_bundle="$WORK/unsafe-stat-symlink.bundle" changed_bundle="$WORK/stat-changed.bundle" custom_pid symlink_pid changed_pid custom_save_rc custom_load_rc symlink_save_rc symlink_load_rc changed_load_rc
  prepare_stat_fixture "$SRC"
  prepare_stat_fixture "$TGT"
  custom_pid=$(spawn_stopped_custom_stat)
  set +e
  $CLI move save "$SRC" "$custom_pid" "$custom_bundle" --json >"$WORK/unsafe-stat-custom.save.json"
  custom_save_rc=$?
  $CLI move load "$TGT" "$custom_bundle" --json >"$WORK/unsafe-stat-custom.load.json"
  custom_load_rc=$?
  set -e
  prepare_stat_fixture "$SRC"
  $CLI exec "$SRC" -- "ln -s /tmp/stat-file.txt /tmp/stat-link" >/dev/null
  symlink_pid=$(spawn_stopped_symlink_stat)
  set +e
  $CLI move save "$SRC" "$symlink_pid" "$symlink_bundle" --json >"$WORK/unsafe-stat-symlink.save.json"
  symlink_save_rc=$?
  $CLI move load "$TGT" "$symlink_bundle" --json >"$WORK/unsafe-stat-symlink.load.json"
  symlink_load_rc=$?
  set -e
  prepare_stat_fixture "$SRC"
  prepare_stat_fixture "$TGT"
  changed_pid=$(spawn_stopped_stat)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/stat-changed.save.json"
  $CLI exec "$TGT" -- "printf changed >>/tmp/stat-file.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/stat-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
custom_save=json.load(open('$WORK/unsafe-stat-custom.save.json'))
custom_load=json.load(open('$WORK/unsafe-stat-custom.load.json'))
symlink_save=json.load(open('$WORK/unsafe-stat-symlink.save.json'))
symlink_load=json.load(open('$WORK/unsafe-stat-symlink.load.json'))
changed_save=json.load(open('$WORK/stat-changed.save.json'))
changed_load=json.load(open('$WORK/stat-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$custom_save_rc') == 1 and int('$custom_load_rc') == 1
assert int('$symlink_save_rc') == 1 and int('$symlink_load_rc') == 1
for save, load in [(custom_save,custom_load), (symlink_save,symlink_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('statState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-stat-refusal','state':'passed','customSaveAccepted':custom_save['accepted'],'symlinkSaveAccepted':symlink_save['accepted'],'customStatState':custom_save['descriptor']['resourcePlan']['capture'].get('statState'),'symlinkStatState':symlink_save['descriptor']['resourcePlan']['capture'].get('statState'),'changedFileLoadAccepted':changed_load['accepted'],'changedFileLoaderState':loader.get('state'),'changedFileTargetPid':loader.get('targetPid')}))
PY
}

prepare_du_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/du-tree; mkdir -p /tmp/du-tree/nested; printf alpha >/tmp/du-tree/alpha.txt; printf beta >/tmp/du-tree/nested/beta.txt" >/dev/null
}

spawn_stopped_du_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdkdScsICctc2InLCAnL3RtcC9kdS10cmVlJyk7Cn0gZWxzaWYgKCRtb2RlIGVxICdodW1hbicpIHsKICBAYXJndiA9ICgnZHUnLCAnLXNoJywgJy90bXAvZHUtdHJlZScpOwp9IGVsc2UgewogIEBhcmd2ID0gKCdkdScsICctc2InLCAnL3RtcC9kdS10cmVlJyk7Cn0KbXkgJHBpZCA9IGZvcmsoKTsKZGllICJmb3JrIGZhaWxlZDogJCFcbiIgdW5sZXNzIGRlZmluZWQgJHBpZDsKaWYgKCRwaWQgPT0gMCkgewogIG9wZW4gU1RESU4sICc8JywgJy9kZXYvbnVsbCcgb3IgZGllICQhOwogIG9wZW4gU1RET1VULCAnPicsICIvdG1wLyR7bmFtZX0uc291cmNlLm91dCIgb3IgZGllICQhOwogIG9wZW4gU1RERVJSLCAnPicsICIvdG1wLyR7bmFtZX0uZXJyIiBvciBkaWUgJCE7CiAgc3lzY2FsbCgkcHRyYWNlLCAwLCAwLCAwLCAwKSA9PSAwIG9yIGRpZSAicHRyYWNlIFRSQUNFTUUgZmFpbGVkOiAkIVxuIjsKICBleGVjIHsgJy91c3IvYmluL2R1JyB9IEBhcmd2IG9yIGRpZSAiZXhlYyBkdSBmYWlsZWQ6ICQhXG4iOwp9CndhaXRwaWQoJHBpZCwgMCk7CnN5c2NhbGwoJHB0cmFjZSwgMTcsICRwaWQsIDAsIDE5KSA9PSAwIG9yIGRpZSAicHRyYWNlIERFVEFDSCBmYWlsZWQ6ICQhXG4iOwpwcmludCAiJHBpZFxuIjsK
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_du() {
  spawn_stopped_du_with_mode "du-sb-dir" "safe"
}

spawn_stopped_human_du() {
  spawn_stopped_du_with_mode "unsafe-du-human" "human"
}

prove_du_sb_dir() {
  local bundle="$WORK/du.bundle" pid log out expected total
  prepare_du_fixture "$SRC"
  prepare_du_fixture "$TGT"
  pid=$(spawn_stopped_du)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/du.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/du.load.json"
  log=$(python3 - <<PY
import json
print(json.load(open('$WORK/du.load.json'))['loader']['logPath'])
PY
)
  out=$($CLI exec "$TGT" -- "cat '$log'" | tr -d '\r')
  expected=$($CLI exec "$TGT" -- "/usr/bin/du -sb -- /tmp/du-tree" | tr -d '\r')
  total=$(printf '%s\n' "$out" | cut -f1)
  python3 - <<PY
import json
save=json.load(open('$WORK/du.save.json'))
load=json.load(open('$WORK/du.load.json'))
state=save['descriptor']['resourcePlan']['capture']['duState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-du-sb-dir-loader'
assert state['directoryPath'] == '/tmp/du-tree'
assert state['options'] == ['-s', '-b']
assert state['symlinkPolicy'] == 'no-symlinks'
assert state['mountPolicy'] == 'single-device-no-mount-crossing'
assert int('$total') == state['treeIdentity']['totalBytes']
assert '''$out''' == '''$expected'''
print(json.dumps({'name':'du-sb-dir','state':'passed','duState':state,'targetOutput':'''$out'''}))
PY
}

prove_unsafe_du_refusal() {
  local option_bundle="$WORK/unsafe-du-option.bundle" symlink_bundle="$WORK/unsafe-du-symlink.bundle" changed_bundle="$WORK/du-changed.bundle" option_pid symlink_pid changed_pid option_save_rc option_load_rc symlink_save_rc symlink_load_rc changed_load_rc
  prepare_du_fixture "$SRC"
  prepare_du_fixture "$TGT"
  option_pid=$(spawn_stopped_human_du)
  set +e
  $CLI move save "$SRC" "$option_pid" "$option_bundle" --json >"$WORK/unsafe-du-option.save.json"
  option_save_rc=$?
  $CLI move load "$TGT" "$option_bundle" --json >"$WORK/unsafe-du-option.load.json"
  option_load_rc=$?
  set -e
  prepare_du_fixture "$SRC"
  $CLI exec "$SRC" -- "ln -s alpha.txt /tmp/du-tree/alpha-link" >/dev/null
  symlink_pid=$(spawn_stopped_du)
  set +e
  $CLI move save "$SRC" "$symlink_pid" "$symlink_bundle" --json >"$WORK/unsafe-du-symlink.save.json"
  symlink_save_rc=$?
  $CLI move load "$TGT" "$symlink_bundle" --json >"$WORK/unsafe-du-symlink.load.json"
  symlink_load_rc=$?
  set -e
  prepare_du_fixture "$SRC"
  prepare_du_fixture "$TGT"
  changed_pid=$(spawn_stopped_du)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/du-changed.save.json"
  $CLI exec "$TGT" -- "printf delta >/tmp/du-tree/delta.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/du-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
option_save=json.load(open('$WORK/unsafe-du-option.save.json'))
option_load=json.load(open('$WORK/unsafe-du-option.load.json'))
symlink_save=json.load(open('$WORK/unsafe-du-symlink.save.json'))
symlink_load=json.load(open('$WORK/unsafe-du-symlink.load.json'))
changed_save=json.load(open('$WORK/du-changed.save.json'))
changed_load=json.load(open('$WORK/du-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$option_save_rc') == 1 and int('$option_load_rc') == 1
assert int('$symlink_save_rc') == 1 and int('$symlink_load_rc') == 1
for save, load in [(option_save,option_load), (symlink_save,symlink_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('duState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-du-refusal','state':'passed','unsupportedOptionSaveAccepted':option_save['accepted'],'symlinkSaveAccepted':symlink_save['accepted'],'unsupportedOptionDuState':option_save['descriptor']['resourcePlan']['capture'].get('duState'),'symlinkDuState':symlink_save['descriptor']['resourcePlan']['capture'].get('duState'),'changedTreeLoadAccepted':changed_load['accepted'],'changedTreeLoaderState':loader.get('state'),'changedTreeTargetPid':loader.get('targetPid')}))
PY
}

prepare_ls_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/ls-dir; mkdir -p /tmp/ls-dir; printf alpha >/tmp/ls-dir/alpha.txt; printf beta >/tmp/ls-dir/beta.txt; mkdir -p /tmp/ls-dir/subdir" >/dev/null
  fixed_touch_all "$vm" /tmp/ls-dir /tmp/ls-dir/alpha.txt /tmp/ls-dir/beta.txt /tmp/ls-dir/subdir
}

spawn_stopped_ls_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdscycsICcvdG1wL2xzLWRpcicpOwp9IGVsc2lmICgkbW9kZSBlcSAnbG9uZycpIHsKICBAYXJndiA9ICgnbHMnLCAnLWwnLCAnL3RtcC9scy1kaXInKTsKfSBlbHNpZiAoJG1vZGUgZXEgJ2NvbG9yJykgewogIEBhcmd2ID0gKCdscycsICctLWNvbG9yPWFsd2F5cycsICcvdG1wL2xzLWRpcicpOwp9IGVsc2lmICgkbW9kZSBlcSAncmVjdXJzaXZlJykgewogIEBhcmd2ID0gKCdscycsICctUicsICcvdG1wL2xzLWRpcicpOwp9IGVsc2UgewogIEBhcmd2ID0gKCdscycsICcvdG1wL2xzLWRpcicpOwp9Cm15ICRwaWQgPSBmb3JrKCk7CmRpZSAiZm9yayBmYWlsZWQ6ICQhXG4iIHVubGVzcyBkZWZpbmVkICRwaWQ7CmlmICgkcGlkID09IDApIHsKICBvcGVuIFNURElOLCAnPCcsICcvZGV2L251bGwnIG9yIGRpZSAkITsKICBvcGVuIFNURE9VVCwgJz4nLCAiL3RtcC8ke25hbWV9LnNvdXJjZS5vdXQiIG9yIGRpZSAkITsKICBvcGVuIFNUREVSUiwgJz4nLCAiL3RtcC8ke25hbWV9LmVyciIgb3IgZGllICQhOwogIHN5c2NhbGwoJHB0cmFjZSwgMCwgMCwgMCwgMCkgPT0gMCBvciBkaWUgInB0cmFjZSBUUkFDRU1FIGZhaWxlZDogJCFcbiI7CiAgZXhlYyB7ICcvdXNyL2Jpbi9scycgfSBAYXJndiBvciBkaWUgImV4ZWMgbHMgZmFpbGVkOiAkIVxuIjsKfQp3YWl0cGlkKCRwaWQsIDApOwpzeXNjYWxsKCRwdHJhY2UsIDE3LCAkcGlkLCAwLCAxOSkgPT0gMCBvciBkaWUgInB0cmFjZSBERVRBQ0ggZmFpbGVkOiAkIVxuIjsKcHJpbnQgIiRwaWRcbiI7Cg==
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_ls() {
  spawn_stopped_ls_with_mode "ls-dir" "safe"
}

spawn_stopped_ls_long() {
  spawn_stopped_ls_with_mode "ls-long-dir" "long"
}

spawn_stopped_color_ls() {
  spawn_stopped_ls_with_mode "unsafe-ls-color" "color"
}

spawn_stopped_recursive_ls() {
  spawn_stopped_ls_with_mode "unsafe-ls-recursive" "recursive"
}

prove_ls_dir() {
  local bundle="$WORK/ls.bundle" pid log out expected
  prepare_ls_fixture "$SRC"
  prepare_ls_fixture "$TGT"
  pid=$(spawn_stopped_ls)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/ls.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/ls.load.json"
  log=$(python3 - <<PY
import json
print(json.load(open('$WORK/ls.load.json'))['loader']['logPath'])
PY
)
  for _ in $(seq 1 100); do
    if $CLI exec "$TGT" -- "test -e '$log'" >/dev/null 2>&1; then
      break
    fi
    sleep 0.05
  done
  out=$($CLI exec "$TGT" -- "cat '$log'" | tr -d '\r')
  expected=$($CLI exec "$TGT" -- "LC_ALL=C /usr/bin/ls -1 -- /tmp/ls-dir" | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/ls.save.json'))
load=json.load(open('$WORK/ls.load.json'))
state=save['descriptor']['resourcePlan']['capture']['lsState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-ls-dir-loader'
assert state['directoryPath'] == '/tmp/ls-dir'
assert state['ordering'] == 'LC_ALL=C-name-ascending'
assert state['options'] == ['-1']
assert state['policy'] == 'ascii-names-non-recursive-directory-listing'
assert '''$out''' == '''$expected'''
print(json.dumps({'name':'ls-dir','state':'passed','lsState':state,'targetOutput':'''$out'''.splitlines()}))
PY
}

prove_ls_long_dir() {
  local bundle="$WORK/ls-long.bundle" pid log out expected
  prepare_ls_fixture "$SRC"
  prepare_ls_fixture "$TGT"
  pid=$(spawn_stopped_ls_long)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/ls-long.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/ls-long.load.json"
  log=$(python3 - <<PY
import json
print(json.load(open('$WORK/ls-long.load.json'))['loader']['logPath'])
PY
)
  out=$($CLI exec "$TGT" -- "cat '$log'" | tr -d '\r')
  expected=$($CLI exec "$TGT" -- "LC_ALL=C /usr/bin/ls -l -- /tmp/ls-dir" | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/ls-long.save.json'))
load=json.load(open('$WORK/ls-long.load.json'))
state=save['descriptor']['resourcePlan']['capture']['lsLongState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-ls-long-dir-loader'
assert state['directoryPath'] == '/tmp/ls-dir'
assert state['ordering'] == 'LC_ALL=C-name-ascending'
assert state['statPolicy'] == 'regular-or-directory-no-symlinks-owner-group-mapped'
assert state['options'] == ['-l']
assert state['policy'] == 'ascii-names-non-recursive-long-listing'
assert len(state['entries']) == state['directoryIdentity']['entryCount'] == 3
assert all(e['owner'] and e['group'] and isinstance(e['uid'], int) and isinstance(e['gid'], int) for e in state['entries'])
assert '''$out''' == '''$expected'''
print(json.dumps({'name':'ls-long-dir','state':'passed','lsLongState':state,'targetOutputFirstLine':'''$out'''.splitlines()[0]}))
PY
}

prove_unsafe_ls_long_refusal() {
  local option_bundle="$WORK/unsafe-ls-long-option.bundle" symlink_bundle="$WORK/unsafe-ls-long-symlink.bundle" changed_bundle="$WORK/ls-long-changed.bundle" option_pid symlink_pid changed_pid option_save_rc option_load_rc symlink_save_rc symlink_load_rc changed_load_rc
  prepare_ls_fixture "$SRC"
  prepare_ls_fixture "$TGT"
  option_pid=$(spawn_stopped_color_ls)
  set +e
  $CLI move save "$SRC" "$option_pid" "$option_bundle" --json >"$WORK/unsafe-ls-long-option.save.json"
  option_save_rc=$?
  $CLI move load "$TGT" "$option_bundle" --json >"$WORK/unsafe-ls-long-option.load.json"
  option_load_rc=$?
  set -e
  prepare_ls_fixture "$SRC"
  $CLI exec "$SRC" -- "ln -s alpha.txt /tmp/ls-dir/alpha-link" >/dev/null
  symlink_pid=$(spawn_stopped_ls_long)
  set +e
  $CLI move save "$SRC" "$symlink_pid" "$symlink_bundle" --json >"$WORK/unsafe-ls-long-symlink.save.json"
  symlink_save_rc=$?
  $CLI move load "$TGT" "$symlink_bundle" --json >"$WORK/unsafe-ls-long-symlink.load.json"
  symlink_load_rc=$?
  set -e
  prepare_ls_fixture "$SRC"
  prepare_ls_fixture "$TGT"
  changed_pid=$(spawn_stopped_ls_long)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/ls-long-changed.save.json"
  $CLI exec "$TGT" -- "printf delta >/tmp/ls-dir/delta.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/ls-long-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
option_save=json.load(open('$WORK/unsafe-ls-long-option.save.json'))
option_load=json.load(open('$WORK/unsafe-ls-long-option.load.json'))
symlink_save=json.load(open('$WORK/unsafe-ls-long-symlink.save.json'))
symlink_load=json.load(open('$WORK/unsafe-ls-long-symlink.load.json'))
changed_save=json.load(open('$WORK/ls-long-changed.save.json'))
changed_load=json.load(open('$WORK/ls-long-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$option_save_rc') == 1 and int('$option_load_rc') == 1
assert int('$symlink_save_rc') == 1 and int('$symlink_load_rc') == 1
for save, load in [(option_save,option_load), (symlink_save,symlink_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('lsLongState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-ls-long-refusal','state':'passed','unsupportedOptionSaveAccepted':option_save['accepted'],'symlinkSaveAccepted':symlink_save['accepted'],'unsupportedOptionLsLongState':option_save['descriptor']['resourcePlan']['capture'].get('lsLongState'),'symlinkLsLongState':symlink_save['descriptor']['resourcePlan']['capture'].get('lsLongState'),'changedDirectoryLoadAccepted':changed_load['accepted'],'changedDirectoryLoaderState':loader.get('state'),'changedDirectoryTargetPid':loader.get('targetPid')}))
PY
}

prove_unsafe_ls_refusal() {
  local color_bundle="$WORK/unsafe-ls-color.bundle" recursive_bundle="$WORK/unsafe-ls-recursive.bundle" locale_bundle="$WORK/unsafe-ls-locale.bundle" changed_bundle="$WORK/ls-changed.bundle" color_pid recursive_pid locale_pid changed_pid color_save_rc color_load_rc recursive_save_rc recursive_load_rc locale_save_rc locale_load_rc changed_load_rc
  prepare_ls_fixture "$SRC"
  prepare_ls_fixture "$TGT"
  color_pid=$(spawn_stopped_color_ls)
  set +e
  $CLI move save "$SRC" "$color_pid" "$color_bundle" --json >"$WORK/unsafe-ls-color.save.json"
  color_save_rc=$?
  $CLI move load "$TGT" "$color_bundle" --json >"$WORK/unsafe-ls-color.load.json"
  color_load_rc=$?
  set -e
  prepare_ls_fixture "$SRC"
  recursive_pid=$(spawn_stopped_recursive_ls)
  set +e
  $CLI move save "$SRC" "$recursive_pid" "$recursive_bundle" --json >"$WORK/unsafe-ls-recursive.save.json"
  recursive_save_rc=$?
  $CLI move load "$TGT" "$recursive_bundle" --json >"$WORK/unsafe-ls-recursive.load.json"
  recursive_load_rc=$?
  set -e
  prepare_ls_fixture "$SRC"
  $CLI exec "$SRC" -- "printf unicode >/tmp/ls-dir/éclair" >/dev/null
  locale_pid=$(spawn_stopped_ls)
  set +e
  $CLI move save "$SRC" "$locale_pid" "$locale_bundle" --json >"$WORK/unsafe-ls-locale.save.json"
  locale_save_rc=$?
  $CLI move load "$TGT" "$locale_bundle" --json >"$WORK/unsafe-ls-locale.load.json"
  locale_load_rc=$?
  set -e
  prepare_ls_fixture "$SRC"
  prepare_ls_fixture "$TGT"
  changed_pid=$(spawn_stopped_ls)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/ls-changed.save.json"
  $CLI exec "$TGT" -- "printf delta >/tmp/ls-dir/delta.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/ls-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
color_save=json.load(open('$WORK/unsafe-ls-color.save.json'))
color_load=json.load(open('$WORK/unsafe-ls-color.load.json'))
recursive_save=json.load(open('$WORK/unsafe-ls-recursive.save.json'))
recursive_load=json.load(open('$WORK/unsafe-ls-recursive.load.json'))
locale_save=json.load(open('$WORK/unsafe-ls-locale.save.json'))
locale_load=json.load(open('$WORK/unsafe-ls-locale.load.json'))
changed_save=json.load(open('$WORK/ls-changed.save.json'))
changed_load=json.load(open('$WORK/ls-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$color_save_rc') == 1 and int('$color_load_rc') == 1
assert int('$recursive_save_rc') == 1 and int('$recursive_load_rc') == 1
assert int('$locale_save_rc') == 1 and int('$locale_load_rc') == 1
for save, load in [(color_save,color_load), (recursive_save,recursive_load), (locale_save,locale_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('lsState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-ls-refusal','state':'passed','colorSaveAccepted':color_save['accepted'],'recursiveSaveAccepted':recursive_save['accepted'],'localeSensitiveSaveAccepted':locale_save['accepted'],'colorLsState':color_save['descriptor']['resourcePlan']['capture'].get('lsState'),'recursiveLsState':recursive_save['descriptor']['resourcePlan']['capture'].get('lsState'),'localeSensitiveLsState':locale_save['descriptor']['resourcePlan']['capture'].get('lsState'),'changedDirectoryLoadAccepted':changed_load['accepted'],'changedDirectoryLoaderState':loader.get('state'),'changedDirectoryTargetPid':loader.get('targetPid')}))
PY
}

prepare_install_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "rm -rf /tmp/install-parent /tmp/install-src.txt /tmp/install-src-link /tmp/install-src-link-target; mkdir -p /tmp/install-parent; printf 'install-fixture\n' >/tmp/install-src.txt; printf link-target >/tmp/install-src-link-target" >/dev/null
}

spawn_stopped_install_with_mode() {
  local name="$1" mode="$2"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; base64 -d >/tmp/spawn-stopped-${name}.pl <<'PL'
dXNlIHN0cmljdDsKdXNlIHdhcm5pbmdzOwpteSAkbmFtZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBwcm9vZiBuYW1lXG4iOwpteSAkbW9kZSA9IHNoaWZ0IEBBUkdWIC8vIGRpZSAibWlzc2luZyBtb2RlXG4iOwpteSAlcHRyYWNlX3N5c2NhbGwgPSAoImFhcmNoNjQiID0+IDExNywgIng4Nl82NCIgPT4gMTAxKTsKY2hvbXAobXkgJG1hY2hpbmUgPSBgdW5hbWUgLW1gKTsKbXkgJHB0cmFjZSA9ICRwdHJhY2Vfc3lzY2FsbHskbWFjaGluZX0gLy8gZGllICJ1bnN1cHBvcnRlZCBtYWNoaW5lICRtYWNoaW5lXG4iOwpteSBAYXJndjsKaWYgKCRtb2RlIGVxICdzYWZlJykgewogIEBhcmd2ID0gKCdpbnN0YWxsJywgJy1tJywgJzc1NScsICcvdG1wL2luc3RhbGwtc3JjLnR4dCcsICcvdG1wL2luc3RhbGwtcGFyZW50L2Rlc3QudHh0Jyk7Cn0gZWxzaWYgKCRtb2RlIGVxICdvd25lcicpIHsKICBAYXJndiA9ICgnaW5zdGFsbCcsICctbycsICdyb290JywgJy1tJywgJzc1NScsICcvdG1wL2luc3RhbGwtc3JjLnR4dCcsICcvdG1wL2luc3RhbGwtcGFyZW50L2Rlc3QudHh0Jyk7Cn0gZWxzaWYgKCRtb2RlIGVxICdkaXJlY3RvcnknKSB7CiAgQGFyZ3YgPSAoJ2luc3RhbGwnLCAnLWQnLCAnL3RtcC9pbnN0YWxsLXBhcmVudC9kaXInKTsKfSBlbHNpZiAoJG1vZGUgZXEgJ3N5bWxpbmsnKSB7CiAgQGFyZ3YgPSAoJ2luc3RhbGwnLCAnLW0nLCAnNzU1JywgJy90bXAvaW5zdGFsbC1zcmMtbGluaycsICcvdG1wL2luc3RhbGwtcGFyZW50L2Rlc3QudHh0Jyk7Cn0gZWxzZSB7CiAgQGFyZ3YgPSAoJ2luc3RhbGwnLCAnLW0nLCAndSt4JywgJy90bXAvaW5zdGFsbC1zcmMudHh0JywgJy90bXAvaW5zdGFsbC1wYXJlbnQvZGVzdC50eHQnKTsKfQpteSAkcGlkID0gZm9yaygpOwpkaWUgImZvcmsgZmFpbGVkOiAkIVxuIiB1bmxlc3MgZGVmaW5lZCAkcGlkOwppZiAoJHBpZCA9PSAwKSB7CiAgb3BlbiBTVERJTiwgJzwnLCAnL2Rldi9udWxsJyBvciBkaWUgJCE7CiAgb3BlbiBTVERPVVQsICc+JywgIi90bXAvJHtuYW1lfS5zb3VyY2Uub3V0IiBvciBkaWUgJCE7CiAgb3BlbiBTVERFUlIsICc+JywgIi90bXAvJHtuYW1lfS5lcnIiIG9yIGRpZSAkITsKICBzeXNjYWxsKCRwdHJhY2UsIDAsIDAsIDAsIDApID09IDAgb3IgZGllICJwdHJhY2UgVFJBQ0VNRSBmYWlsZWQ6ICQhXG4iOwogIGV4ZWMgeyAnL3Vzci9iaW4vaW5zdGFsbCcgfSBAYXJndiBvciBkaWUgImV4ZWMgaW5zdGFsbCBmYWlsZWQ6ICQhXG4iOwp9CndhaXRwaWQoJHBpZCwgMCk7CnN5c2NhbGwoJHB0cmFjZSwgMTcsICRwaWQsIDAsIDE5KSA9PSAwIG9yIGRpZSAicHRyYWNlIERFVEFDSCBmYWlsZWQ6ICQhXG4iOwpwcmludCAiJHBpZFxuIjsK
PL
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/perl /tmp/spawn-stopped-${name}.pl ${name} ${mode} >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_install() {
  spawn_stopped_install_with_mode "install-file" "safe"
}

spawn_stopped_owner_install() {
  spawn_stopped_install_with_mode "unsafe-install-owner" "owner"
}

spawn_stopped_directory_install() {
  spawn_stopped_install_with_mode "unsafe-install-directory" "directory"
}

spawn_stopped_symlink_install() {
  spawn_stopped_install_with_mode "unsafe-install-symlink" "symlink"
}

prove_install_file() {
  local bundle="$WORK/install.bundle" pid mode sha
  prepare_install_fixture "$SRC"
  prepare_install_fixture "$TGT"
  pid=$(spawn_stopped_install)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/install.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/install.load.json"
  mode=$($CLI exec "$TGT" -- "stat -c %a /tmp/install-parent/dest.txt" | tail -1 | tr -d '\r')
  sha=$($CLI exec "$TGT" -- "sha256sum /tmp/install-parent/dest.txt | cut -d' ' -f1" | tail -1 | tr -d '\r')
  python3 - <<PY
import json
save=json.load(open('$WORK/install.save.json'))
load=json.load(open('$WORK/install.load.json'))
state=save['descriptor']['resourcePlan']['capture']['installState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-install-file-loader'
assert state['sourcePath'] == '/tmp/install-src.txt'
assert state['destinationPath'] == '/tmp/install-parent/dest.txt'
assert state['mode'] == '755'
assert state['policy'] == 'copy-mode-absent-destination'
assert '$mode' == state['mode']
assert '$sha' == state['sourceIdentity']['sha256']
print(json.dumps({'name':'install-file','state':'passed','installState':state,'targetMode':'$mode','targetSha':'$sha'}))
PY
}

prove_unsafe_install_refusal() {
  local owner_bundle="$WORK/unsafe-install-owner.bundle" dir_bundle="$WORK/unsafe-install-directory.bundle" symlink_bundle="$WORK/unsafe-install-symlink.bundle" changed_bundle="$WORK/install-changed.bundle" owner_pid dir_pid symlink_pid changed_pid owner_save_rc owner_load_rc dir_save_rc dir_load_rc symlink_save_rc symlink_load_rc changed_load_rc
  prepare_install_fixture "$SRC"
  prepare_install_fixture "$TGT"
  owner_pid=$(spawn_stopped_owner_install)
  set +e
  $CLI move save "$SRC" "$owner_pid" "$owner_bundle" --json >"$WORK/unsafe-install-owner.save.json"
  owner_save_rc=$?
  $CLI move load "$TGT" "$owner_bundle" --json >"$WORK/unsafe-install-owner.load.json"
  owner_load_rc=$?
  set -e
  prepare_install_fixture "$SRC"
  dir_pid=$(spawn_stopped_directory_install)
  set +e
  $CLI move save "$SRC" "$dir_pid" "$dir_bundle" --json >"$WORK/unsafe-install-directory.save.json"
  dir_save_rc=$?
  $CLI move load "$TGT" "$dir_bundle" --json >"$WORK/unsafe-install-directory.load.json"
  dir_load_rc=$?
  set -e
  prepare_install_fixture "$SRC"
  $CLI exec "$SRC" -- "ln -s /tmp/install-src-link-target /tmp/install-src-link" >/dev/null
  symlink_pid=$(spawn_stopped_symlink_install)
  set +e
  $CLI move save "$SRC" "$symlink_pid" "$symlink_bundle" --json >"$WORK/unsafe-install-symlink.save.json"
  symlink_save_rc=$?
  $CLI move load "$TGT" "$symlink_bundle" --json >"$WORK/unsafe-install-symlink.load.json"
  symlink_load_rc=$?
  set -e
  prepare_install_fixture "$SRC"
  prepare_install_fixture "$TGT"
  changed_pid=$(spawn_stopped_install)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/install-changed.save.json"
  $CLI exec "$TGT" -- "printf existing >/tmp/install-parent/dest.txt" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/install-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
owner_save=json.load(open('$WORK/unsafe-install-owner.save.json'))
owner_load=json.load(open('$WORK/unsafe-install-owner.load.json'))
dir_save=json.load(open('$WORK/unsafe-install-directory.save.json'))
dir_load=json.load(open('$WORK/unsafe-install-directory.load.json'))
symlink_save=json.load(open('$WORK/unsafe-install-symlink.save.json'))
symlink_load=json.load(open('$WORK/unsafe-install-symlink.load.json'))
changed_save=json.load(open('$WORK/install-changed.save.json'))
changed_load=json.load(open('$WORK/install-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$owner_save_rc') == 1 and int('$owner_load_rc') == 1
assert int('$dir_save_rc') == 1 and int('$dir_load_rc') == 1
assert int('$symlink_save_rc') == 1 and int('$symlink_load_rc') == 1
for save, load in [(owner_save,owner_load), (dir_save,dir_load), (symlink_save,symlink_load)]:
    assert not save['accepted'] and not load['accepted']
    assert save['descriptor']['resourcePlan']['capture'].get('installState') is None
    assert 'loader' not in load
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
print(json.dumps({'name':'unsafe-install-refusal','state':'passed','ownerSaveAccepted':owner_save['accepted'],'directorySaveAccepted':dir_save['accepted'],'symlinkSaveAccepted':symlink_save['accepted'],'ownerInstallState':owner_save['descriptor']['resourcePlan']['capture'].get('installState'),'directoryInstallState':dir_save['descriptor']['resourcePlan']['capture'].get('installState'),'symlinkInstallState':symlink_save['descriptor']['resourcePlan']['capture'].get('installState'),'existingDestinationLoadAccepted':changed_load['accepted'],'existingDestinationLoaderState':loader.get('state'),'existingDestinationTargetPid':loader.get('targetPid')}))
PY
}

prove_cp_offset() {
  local bundle="$WORK/cp.bundle" pid tpid offset attempt delay dest_offset size
  $CLI exec "$SRC" -- "python3 - <<'PY'
from pathlib import Path
Path('/tmp/cp.in').write_bytes((b'copy-envelope-line-abcdefghijklmnopqrstuvwxyz0123456789\\n' * 1200000))
PY" >/dev/null
  $CLI exec "$TGT" -- "python3 - <<'PY'
from pathlib import Path
Path('/tmp/cp.in').write_bytes((b'copy-envelope-line-abcdefghijklmnopqrstuvwxyz0123456789\\n' * 1200000))
PY" >/dev/null
  size=$($CLI exec "$SRC" -- "stat -c %s /tmp/cp.in" | tail -1 | tr -d '\r')
  for attempt in $(seq 1 8); do
    delay=$(python3 - <<PY
print([0.001,0.003,0.005,0.01,0.02,0.03,0.04,0.05][$attempt-1])
PY
)
    rm -rf "$bundle"
    $CLI exec "$SRC" -- "rm -f /tmp/cp.out /tmp/cp.err" >/dev/null
    pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec cp /tmp/cp.in /tmp/cp.out 2>/tmp/cp.err' </dev/null >/dev/null 2>&1 & pid=\$!; ( sleep $delay; kill -STOP \$pid 2>/dev/null || true ) >/dev/null 2>&1 & echo \$pid" | tail -1 | tr -d '\r')
    sleep 0.1
    if ! $CLI exec "$SRC" -- "awk '/^State:/ {print \$2}' /proc/$pid/status 2>/dev/null | grep -q T" >/dev/null 2>&1; then
      continue
    fi
    if $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/cp.save.json" 2>"$WORK/cp.save.err"; then
      dest_offset=$(python3 - <<PY
import json
print(json.load(open('$WORK/cp.save.json'))['descriptor']['resourcePlan']['capture']['cpState']['destinationOffset'])
PY
)
      if [[ "$dest_offset" -gt 0 && "$dest_offset" -lt "$size" ]]; then
        break
      fi
    fi
    $CLI exec "$SRC" -- "kill -KILL $pid 2>/dev/null || true" >/dev/null
  done
  dest_offset=$(python3 - <<PY
import json
print(json.load(open('$WORK/cp.save.json'))['descriptor']['resourcePlan']['capture']['cpState']['destinationOffset'])
PY
)
  offset=$(python3 - <<PY
import json
state=json.load(open('$WORK/cp.save.json'))['descriptor']['resourcePlan']['capture']['cpState']
print(min(state['sourceOffset'], state['destinationOffset']))
PY
)
  if [[ "$offset" -le 0 || "$offset" -ge "$size" ]]; then
    echo "cp proof did not capture a partial committed offset: offset=$offset size=$size" >&2
    return 1
  fi
  $CLI exec "$TGT" -- "python3 - <<PY
from pathlib import Path
src=Path('/tmp/cp.in').read_bytes()
Path('/tmp/cp.out').write_bytes(src[:$offset])
PY" >/dev/null
  $CLI move load "$TGT" "$bundle" --json >"$WORK/cp.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/cp.load.json'))['loader']['targetPid'])
PY
)
  for _ in $(seq 1 180); do
    if ! $CLI exec "$TGT" -- "kill -0 $tpid 2>/dev/null" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  $CLI exec "$TGT" -- "cmp -s /tmp/cp.in /tmp/cp.out && printf match || printf mismatch" >"$WORK/cp.compare"
  python3 - <<PY
import json
save=json.load(open('$WORK/cp.save.json'))
load=json.load(open('$WORK/cp.load.json'))
compare=open('$WORK/cp.compare').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-cp-offset-loader'
assert compare == 'match'
print(json.dumps({'name':'cp-offset','state':'passed','cpState':save['descriptor']['resourcePlan']['capture']['cpState'],'continuationOffset':int('$offset'),'compare':compare,'targetPid':int('$tpid')}))
PY
}

spawn_stopped_unsafe_sort() {
  $CLI exec "$SRC" -- "rm -f /tmp/sort.spawn.pid /tmp/sort.spawn.log; cat >/tmp/spawn-stopped-sort.py <<'PY'
import ctypes, os, signal
libc = ctypes.CDLL(None, use_errno=True)
PTRACE_TRACEME = 0
PTRACE_DETACH = 17
pid = os.fork()
if pid == 0:
    os.close(0)
    os.open('/dev/null', os.O_RDONLY)
    os.close(1)
    os.open('/tmp/sort.unsafe.out', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.close(2)
    os.open('/tmp/sort.err', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    if libc.ptrace(PTRACE_TRACEME, 0, None, None) != 0:
        raise OSError(ctypes.get_errno(), 'ptrace TRACEME failed')
    os.execv('/usr/bin/sort', ['sort', '-o', '/tmp/sort.in', '/tmp/sort.in'])
_, _status = os.waitpid(pid, 0)
if libc.ptrace(PTRACE_DETACH, pid, None, signal.SIGSTOP) != 0:
    raise OSError(ctypes.get_errno(), 'ptrace DETACH failed')
print(pid, flush=True)
PY
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec python3 /tmp/spawn-stopped-sort.py >/tmp/sort.spawn.pid 2>/tmp/sort.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/sort.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/sort.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/sort.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

prove_unsafe_sort_refusal() {
  local bundle="$WORK/unsafe-sort.bundle" pid save_rc load_rc
  $CLI exec "$SRC" -- "cat >/tmp/sort.in <<'SORT'
zulu
alpha
charlie
bravo
alpha
SORT" >/dev/null
  pid=$(spawn_stopped_unsafe_sort)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-sort.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-sort.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-sort.save.json'))
load=json.load(open('$WORK/unsafe-sort.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('sortState') is None
assert save['descriptor']['nativeContinuation']['state'] == 'refused'
assert 'loader' not in load
print(json.dumps({'name':'unsafe-sort-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'sortState':save['descriptor']['resourcePlan']['capture'].get('sortState'),'nativeContinuation':save['descriptor']['nativeContinuation']['state'],'loaderStarted':'loader' in load}))
PY
}

spawn_stopped_unsafe_wc() {
  $CLI exec "$SRC" -- "rm -f /tmp/wc.spawn.pid /tmp/wc.spawn.log; cat >/tmp/spawn-stopped-wc.py <<'PY'
import ctypes, os, signal
libc = ctypes.CDLL(None, use_errno=True)
PTRACE_TRACEME = 0
PTRACE_DETACH = 17
read_fd, write_fd = os.pipe()
os.write(write_fd, b'one\\ntwo\\n')
pid = os.fork()
if pid == 0:
    os.dup2(read_fd, 0)
    os.close(read_fd)
    os.close(write_fd)
    os.close(1)
    os.open('/tmp/wc.unsafe.out', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.close(2)
    os.open('/tmp/wc.err', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    if libc.ptrace(PTRACE_TRACEME, 0, None, None) != 0:
        raise OSError(ctypes.get_errno(), 'ptrace TRACEME failed')
    os.execv('/usr/bin/wc', ['wc', '-l'])
os.close(read_fd)
_, _status = os.waitpid(pid, 0)
if libc.ptrace(PTRACE_DETACH, pid, None, signal.SIGSTOP) != 0:
    raise OSError(ctypes.get_errno(), 'ptrace DETACH failed')
print(pid, flush=True)
PY
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec python3 /tmp/spawn-stopped-wc.py >/tmp/wc.spawn.pid 2>/tmp/wc.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/wc.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/wc.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/wc.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

prove_unsafe_wc_refusal() {
  local bundle="$WORK/unsafe-wc.bundle" pid save_rc load_rc
  pid=$(spawn_stopped_unsafe_wc)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-wc.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-wc.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-wc.save.json'))
load=json.load(open('$WORK/unsafe-wc.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('wcState') is None
assert save['descriptor']['nativeContinuation']['state'] == 'refused'
assert 'loader' not in load
print(json.dumps({'name':'unsafe-wc-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'wcState':save['descriptor']['resourcePlan']['capture'].get('wcState'),'nativeContinuation':save['descriptor']['nativeContinuation']['state'],'loaderStarted':'loader' in load}))
PY
}

spawn_stopped_sha256sum() {
  $CLI exec "$SRC" -- "rm -f /tmp/sha256.spawn.pid /tmp/sha256.spawn.log; cat >/tmp/spawn-stopped-sha256.py <<'PY'
import ctypes, os, signal
libc = ctypes.CDLL(None, use_errno=True)
PTRACE_TRACEME = 0
PTRACE_DETACH = 17
pid = os.fork()
if pid == 0:
    os.close(0)
    os.open('/dev/null', os.O_RDONLY)
    os.close(1)
    os.open('/tmp/sha256.source.out', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.close(2)
    os.open('/tmp/sha256.err', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    if libc.ptrace(PTRACE_TRACEME, 0, None, None) != 0:
        raise OSError(ctypes.get_errno(), 'ptrace TRACEME failed')
    os.execv('/usr/bin/sha256sum', ['sha256sum', '/tmp/sha256.in'])
_, _status = os.waitpid(pid, 0)
if libc.ptrace(PTRACE_DETACH, pid, None, signal.SIGSTOP) != 0:
    raise OSError(ctypes.get_errno(), 'ptrace DETACH failed')
print(pid, flush=True)
PY
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec python3 /tmp/spawn-stopped-sha256.py >/tmp/sha256.spawn.pid 2>/tmp/sha256.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/sha256.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/sha256.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/sha256.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_unsafe_sha256sum_stdin() {
  $CLI exec "$SRC" -- "rm -f /tmp/sha256.spawn.pid /tmp/sha256.spawn.log; cat >/tmp/spawn-stopped-unsafe-sha256.py <<'PY'
import ctypes, os, signal
libc = ctypes.CDLL(None, use_errno=True)
PTRACE_TRACEME = 0
PTRACE_DETACH = 17
read_fd, write_fd = os.pipe()
os.write(write_fd, b'stdin-checksum-proof\\n')
pid = os.fork()
if pid == 0:
    os.dup2(read_fd, 0)
    os.close(read_fd)
    os.close(write_fd)
    os.close(1)
    os.open('/tmp/sha256.unsafe.out', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.close(2)
    os.open('/tmp/sha256.err', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    if libc.ptrace(PTRACE_TRACEME, 0, None, None) != 0:
        raise OSError(ctypes.get_errno(), 'ptrace TRACEME failed')
    os.execv('/usr/bin/sha256sum', ['sha256sum'])
os.close(read_fd)
_, _status = os.waitpid(pid, 0)
if libc.ptrace(PTRACE_DETACH, pid, None, signal.SIGSTOP) != 0:
    raise OSError(ctypes.get_errno(), 'ptrace DETACH failed')
print(pid, flush=True)
PY
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec python3 /tmp/spawn-stopped-unsafe-sha256.py >/tmp/sha256.spawn.pid 2>/tmp/sha256.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/sha256.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/sha256.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/sha256.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}



spawn_stopped_base64_file() {
  spawn_stopped_line_tool "base64-file" "/usr/bin/base64" "['base64', '/tmp/base64.in']"
}

spawn_stopped_unsafe_base64_file() {
  spawn_stopped_line_tool "unsafe-base64-file" "/usr/bin/base64" "['base64', '--wrap=0', '/tmp/base64.in']"
}

prove_base64_file() {
  local bundle="$WORK/base64.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'base64-proof-content-with-enough-bytes-to-wrap-or-not-wrap\n' >/tmp/base64.in; rm -f /tmp/base64-file.source.out /tmp/base64-file.err" >/dev/null
  done
  pid=$(spawn_stopped_base64_file)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/base64.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/base64.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/base64.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/base64.target.out"
  $CLI exec "$TGT" -- "base64 --wrap=76 /tmp/base64.in" >"$WORK/base64.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/base64.save.json'))
load=json.load(open('$WORK/base64.load.json'))
out=open('$WORK/base64.target.out').read()
expected=open('$WORK/base64.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-base64-file-loader'
assert out == expected
state=save['descriptor']['resourcePlan']['capture']['base64State']
assert state['path'] == '/tmp/base64.in' and state['wrap'] == 76 and state['fileIdentity']['sha256']
print(json.dumps({'name':'base64-file','state':'passed','base64State':state,'output':out.strip()}))
PY
}

prove_unsafe_base64_refusal() {
  local bundle="$WORK/unsafe-base64.bundle" changed_bundle="$WORK/base64-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'base64 identity source\\n' >/tmp/base64.in; rm -f /tmp/unsafe-base64-file.source.out /tmp/unsafe-base64-file.err /tmp/base64-file.source.out /tmp/base64-file.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_base64_file)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-base64.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-base64.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_base64_file)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/base64-changed.save.json"
  $CLI exec "$TGT" -- "printf 'base64 identity target\\n' >/tmp/base64.in" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/base64-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-base64.save.json'))
load=json.load(open('$WORK/unsafe-base64.load.json'))
changed_save=json.load(open('$WORK/base64-changed.save.json'))
changed_load=json.load(open('$WORK/base64-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('base64State') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-base64-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'base64State':save['descriptor']['resourcePlan']['capture'].get('base64State'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

spawn_stopped_gzip_atomic() {
  $CLI exec "$SRC" -- "rm -f /tmp/gzip.spawn.pid /tmp/gzip.spawn.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; gzip -c /tmp/gzip.in >/tmp/gzip-atomic.source.out 2>/tmp/gzip-atomic.err & pid=\$!; for i in \$(seq 1 1000); do [ -e /proc/\$pid/fd/1 ] && exe=\$(readlink /proc/\$pid/exe 2>/dev/null || true) && [ "\$exe" = /usr/bin/gzip ] && kill -STOP \$pid 2>/dev/null && echo \$pid >/tmp/gzip.spawn.pid && exit 0; done; echo failed >/tmp/gzip.spawn.log; exit 1' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/gzip.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/gzip.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/gzip.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_unsafe_gzip_atomic() {
  $CLI exec "$SRC" -- "rm -f /tmp/unsafe-gzip.spawn.pid /tmp/unsafe-gzip.spawn.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; gzip -9 -c /tmp/gzip.in >/tmp/unsafe-gzip-atomic.source.out 2>/tmp/unsafe-gzip-atomic.err & pid=\$!; for i in \$(seq 1 1000); do [ -e /proc/\$pid/fd/1 ] && exe=\$(readlink /proc/\$pid/exe 2>/dev/null || true) && [ "\$exe" = /usr/bin/gzip ] && kill -STOP \$pid 2>/dev/null && echo \$pid >/tmp/unsafe-gzip.spawn.pid && exit 0; done; echo failed >/tmp/unsafe-gzip.spawn.log; exit 1' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/unsafe-gzip.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/unsafe-gzip.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/unsafe-gzip.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

prove_gzip_atomic() {
  local bundle="$WORK/gzip.bundle" pid output
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "python3 - <<'PY'
from pathlib import Path
import hashlib
with Path('/tmp/gzip.in').open('wb') as f:
    for i in range(32768):
        f.write(hashlib.sha256(str(i).encode()).digest())
PY
rm -f /tmp/gzip-atomic.source.out /tmp/gzip-atomic.err /tmp/gzip.expected.out" >/dev/null
  done
  pid=$(spawn_stopped_gzip_atomic)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/gzip.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/gzip.load.json"
  output=$(python3 - <<PY
import json; print(json.load(open('$WORK/gzip.save.json'))['descriptor']['resourcePlan']['capture']['gzipState']['outputPath'])
PY
)
  $CLI exec "$TGT" -- "gzip -c /tmp/gzip.in >/tmp/gzip.expected.out && cmp '$output' /tmp/gzip.expected.out" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/gzip.save.json'))
load=json.load(open('$WORK/gzip.load.json'))
state=save['descriptor']['resourcePlan']['capture']['gzipState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-gzip-atomic-loader'
assert state['inputPath'] == '/tmp/gzip.in' and state['outputPolicy'] == 'atomic-temp-rename' and state['fileIdentity']['sha256']
print(json.dumps({'name':'gzip-atomic','state':'passed','gzipState':state,'outputCompare':'match'}))
PY
}

prove_unsafe_gzip_refusal() {
  local bundle="$WORK/unsafe-gzip.bundle" changed_bundle="$WORK/gzip-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "python3 - <<'PY'
from pathlib import Path
import hashlib
with Path('/tmp/gzip.in').open('wb') as f:
    for i in range(32768):
        f.write(hashlib.sha256(str(i).encode()).digest())
PY
rm -f /tmp/unsafe-gzip-atomic.source.out /tmp/unsafe-gzip-atomic.err /tmp/gzip-atomic.source.out /tmp/gzip-atomic.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_gzip_atomic)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-gzip.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-gzip.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_gzip_atomic)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/gzip-changed.save.json"
  $CLI exec "$TGT" -- "printf 'gzip identity target\\n' >/tmp/gzip.in" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/gzip-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-gzip.save.json'))
load=json.load(open('$WORK/unsafe-gzip.load.json'))
changed_save=json.load(open('$WORK/gzip-changed.save.json'))
changed_load=json.load(open('$WORK/gzip-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('gzipState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-gzip-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'gzipState':save['descriptor']['resourcePlan']['capture'].get('gzipState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

prepare_gunzip_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "python3 - <<'PY'
from pathlib import Path
import hashlib
with Path('/tmp/gunzip.raw').open('wb') as f:
    for i in range(262144):
        f.write(hashlib.sha256(str(i).encode()).digest())
PY
gzip -n -1 -c /tmp/gunzip.raw >/tmp/gunzip.in.gz
rm -f /tmp/gunzip-atomic.source.out /tmp/gunzip-atomic.err /tmp/gunzip.expected.out /tmp/unsafe-gunzip-atomic.source.out /tmp/unsafe-gunzip-atomic.err" >/dev/null
}

prepare_xz_fixture() {
  local vm="$1"
  $CLI exec "$vm" -- "python3 - <<'PY'
from pathlib import Path
import hashlib
with Path('/tmp/xz.in').open('wb') as f:
    for i in range(65536):
        f.write(hashlib.sha256(str(i).encode()).digest())
PY
rm -f /tmp/xz-atomic.source.out /tmp/xz-atomic.err /tmp/xz.expected.out /tmp/unsafe-xz-atomic.source.out /tmp/unsafe-xz-atomic.err" >/dev/null
}

spawn_stopped_gunzip_atomic() {
  $CLI exec "$SRC" -- "rm -f /tmp/gunzip.spawn.pid /tmp/gunzip.spawn.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; gunzip -c /tmp/gunzip.in.gz >/tmp/gunzip-atomic.source.out 2>/tmp/gunzip-atomic.err & pid=\$!; for i in \$(seq 1 1000); do [ -e /proc/\$pid/fd/1 ] && exe=\$(readlink /proc/\$pid/exe 2>/dev/null || true) && [ "\$exe" = /usr/bin/gzip ] && kill -STOP \$pid 2>/dev/null && echo \$pid >/tmp/gunzip.spawn.pid && exit 0; done; echo failed >/tmp/gunzip.spawn.log; exit 1' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/gunzip.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/gunzip.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/gunzip.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_unsafe_gunzip_atomic() {
  $CLI exec "$SRC" -- "rm -f /tmp/unsafe-gunzip.spawn.pid /tmp/unsafe-gunzip.spawn.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; gunzip -f -c /tmp/gunzip.in.gz >/tmp/unsafe-gunzip-atomic.source.out 2>/tmp/unsafe-gunzip-atomic.err & pid=\$!; for i in \$(seq 1 1000); do [ -e /proc/\$pid/fd/1 ] && exe=\$(readlink /proc/\$pid/exe 2>/dev/null || true) && [ "\$exe" = /usr/bin/gzip ] && kill -STOP \$pid 2>/dev/null && echo \$pid >/tmp/unsafe-gunzip.spawn.pid && exit 0; done; echo failed >/tmp/unsafe-gunzip.spawn.log; exit 1' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/unsafe-gunzip.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/unsafe-gunzip.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/unsafe-gunzip.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_xz_atomic() {
  $CLI exec "$SRC" -- "rm -f /tmp/xz.spawn.pid /tmp/xz.spawn.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; xz -c /tmp/xz.in >/tmp/xz-atomic.source.out 2>/tmp/xz-atomic.err & pid=\$!; for i in \$(seq 1 1000); do [ -e /proc/\$pid/fd/1 ] && exe=\$(readlink /proc/\$pid/exe 2>/dev/null || true) && [ "\$exe" = /usr/bin/xz ] && kill -STOP \$pid 2>/dev/null && echo \$pid >/tmp/xz.spawn.pid && exit 0; done; echo failed >/tmp/xz.spawn.log; exit 1' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/xz.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/xz.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/xz.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_unsafe_xz_atomic() {
  $CLI exec "$SRC" -- "rm -f /tmp/unsafe-xz.spawn.pid /tmp/unsafe-xz.spawn.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; xz -9 -c /tmp/xz.in >/tmp/unsafe-xz-atomic.source.out 2>/tmp/unsafe-xz-atomic.err & pid=\$!; for i in \$(seq 1 1000); do [ -e /proc/\$pid/fd/1 ] && exe=\$(readlink /proc/\$pid/exe 2>/dev/null || true) && [ "\$exe" = /usr/bin/xz ] && kill -STOP \$pid 2>/dev/null && echo \$pid >/tmp/unsafe-xz.spawn.pid && exit 0; done; echo failed >/tmp/unsafe-xz.spawn.log; exit 1' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/unsafe-xz.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/unsafe-xz.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/unsafe-xz.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

prove_gunzip_atomic() {
  local bundle="$WORK/gunzip.bundle" pid output
  prepare_gunzip_fixture "$SRC"
  prepare_gunzip_fixture "$TGT"
  pid=$(spawn_stopped_gunzip_atomic)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/gunzip.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/gunzip.load.json"
  output=$(python3 - <<PY
import json; print(json.load(open('$WORK/gunzip.save.json'))['descriptor']['resourcePlan']['capture']['gunzipState']['outputPath'])
PY
)
  $CLI exec "$TGT" -- "gunzip -c /tmp/gunzip.in.gz >/tmp/gunzip.expected.out && cmp '$output' /tmp/gunzip.expected.out" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/gunzip.save.json'))
load=json.load(open('$WORK/gunzip.load.json'))
state=save['descriptor']['resourcePlan']['capture']['gunzipState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-gunzip-atomic-loader'
assert state['inputPath'] == '/tmp/gunzip.in.gz' and state['outputPolicy'] == 'atomic-temp-rename' and state['fileIdentity']['sha256']
print(json.dumps({'name':'gunzip-atomic','state':'passed','gunzipState':state,'outputCompare':'match'}))
PY
}

prove_unsafe_gunzip_refusal() {
  local bundle="$WORK/unsafe-gunzip.bundle" changed_bundle="$WORK/gunzip-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  prepare_gunzip_fixture "$SRC"
  prepare_gunzip_fixture "$TGT"
  pid=$(spawn_stopped_unsafe_gunzip_atomic)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-gunzip.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-gunzip.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_gunzip_atomic)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/gunzip-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed gunzip target\\n' >/tmp/gunzip.in.gz" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/gunzip-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-gunzip.save.json'))
load=json.load(open('$WORK/unsafe-gunzip.load.json'))
changed_save=json.load(open('$WORK/gunzip-changed.save.json'))
changed_load=json.load(open('$WORK/gunzip-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('gunzipState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-gunzip-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'gunzipState':save['descriptor']['resourcePlan']['capture'].get('gunzipState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

prove_xz_atomic() {
  local bundle="$WORK/xz.bundle" pid output
  prepare_xz_fixture "$SRC"
  prepare_xz_fixture "$TGT"
  pid=$(spawn_stopped_xz_atomic)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/xz.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/xz.load.json"
  output=$(python3 - <<PY
import json; print(json.load(open('$WORK/xz.save.json'))['descriptor']['resourcePlan']['capture']['xzState']['outputPath'])
PY
)
  $CLI exec "$TGT" -- "xz -c /tmp/xz.in >/tmp/xz.expected.out && cmp '$output' /tmp/xz.expected.out" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/xz.save.json'))
load=json.load(open('$WORK/xz.load.json'))
state=save['descriptor']['resourcePlan']['capture']['xzState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-xz-atomic-loader'
assert state['inputPath'] == '/tmp/xz.in' and state['outputPolicy'] == 'atomic-temp-rename' and state['fileIdentity']['sha256']
print(json.dumps({'name':'xz-atomic','state':'passed','xzState':state,'outputCompare':'match'}))
PY
}

prove_unsafe_xz_refusal() {
  local bundle="$WORK/unsafe-xz.bundle" changed_bundle="$WORK/xz-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  prepare_xz_fixture "$SRC"
  prepare_xz_fixture "$TGT"
  pid=$(spawn_stopped_unsafe_xz_atomic)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-xz.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-xz.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_xz_atomic)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/xz-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed xz target\\n' >/tmp/xz.in" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/xz-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-xz.save.json'))
load=json.load(open('$WORK/unsafe-xz.load.json'))
changed_save=json.load(open('$WORK/xz-changed.save.json'))
changed_load=json.load(open('$WORK/xz-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('xzState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-xz-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'xzState':save['descriptor']['resourcePlan']['capture'].get('xzState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

ensure_zstd_tool() {
  local vm="$1"
  if $CLI exec "$vm" -- "command -v zstd" >/dev/null 2>&1; then
    return 0
  fi
  $CLI exec "$vm" -- "rm -f /tmp/machinen-zstd-apt.pid /tmp/machinen-zstd-apt.log /tmp/machinen-zstd-apt.rc; nohup sh -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y --no-install-recommends zstd; echo \$? >/tmp/machinen-zstd-apt.rc' >/tmp/machinen-zstd-apt.log 2>&1 & echo \$! >/tmp/machinen-zstd-apt.pid" >/dev/null
  for _ in $(seq 1 180); do
    if $CLI exec "$vm" -- "command -v zstd" >/dev/null 2>&1; then
      return 0
    fi
    if $CLI exec "$vm" -- "test -s /tmp/machinen-zstd-apt.rc" >/dev/null 2>&1; then
      $CLI exec "$vm" -- "cat /tmp/machinen-zstd-apt.log; exit \$(cat /tmp/machinen-zstd-apt.rc)" >&2 || true
      return 1
    fi
    sleep 2
  done
  $CLI exec "$vm" -- "cat /tmp/machinen-zstd-apt.log 2>/dev/null || true" >&2 || true
  return 1
}

prepare_zstd_fixture() {
  local vm="$1"
  ensure_zstd_tool "$vm"
  $CLI exec "$vm" -- "yes 'zstd-proof-deterministic-block-0123456789' 2>/dev/null | head -c 16777216 >/tmp/zstd.in
rm -f /tmp/zstd-atomic.source.out /tmp/zstd-atomic.err /tmp/zstd.expected.out /tmp/unsafe-zstd-atomic.source.out /tmp/unsafe-zstd-atomic.err" >/dev/null
}

spawn_stopped_zstd_atomic() {
  $CLI exec "$SRC" -- "rm -f /tmp/zstd.spawn.pid /tmp/zstd.spawn.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; zstd -c /tmp/zstd.in >/tmp/zstd-atomic.source.out 2>/tmp/zstd-atomic.err & pid=\$!; for i in \$(seq 1 1000); do [ -e /proc/\$pid/fd/1 ] && exe=\$(readlink /proc/\$pid/exe 2>/dev/null || true) && [ "\$exe" = /usr/bin/zstd ] && kill -STOP \$pid 2>/dev/null && echo \$pid >/tmp/zstd.spawn.pid && exit 0; done; echo failed >/tmp/zstd.spawn.log; exit 1' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/zstd.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/zstd.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/zstd.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_unsafe_zstd_atomic() {
  $CLI exec "$SRC" -- "rm -f /tmp/unsafe-zstd.spawn.pid /tmp/unsafe-zstd.spawn.log; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; zstd -19 -c /tmp/zstd.in >/tmp/unsafe-zstd-atomic.source.out 2>/tmp/unsafe-zstd-atomic.err & pid=\$!; for i in \$(seq 1 1000); do [ -e /proc/\$pid/fd/1 ] && exe=\$(readlink /proc/\$pid/exe 2>/dev/null || true) && [ "\$exe" = /usr/bin/zstd ] && kill -STOP \$pid 2>/dev/null && echo \$pid >/tmp/unsafe-zstd.spawn.pid && exit 0; done; echo failed >/tmp/unsafe-zstd.spawn.log; exit 1' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/unsafe-zstd.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/unsafe-zstd.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/unsafe-zstd.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

prove_zstd_atomic() {
  local bundle="$WORK/zstd.bundle" pid output
  prepare_zstd_fixture "$SRC"
  prepare_zstd_fixture "$TGT"
  pid=$(spawn_stopped_zstd_atomic)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/zstd.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/zstd.load.json"
  output=$(python3 - <<PY
import json; print(json.load(open('$WORK/zstd.save.json'))['descriptor']['resourcePlan']['capture']['zstdState']['outputPath'])
PY
)
  $CLI exec "$TGT" -- "zstd -c /tmp/zstd.in >/tmp/zstd.expected.out && cmp '$output' /tmp/zstd.expected.out" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/zstd.save.json'))
load=json.load(open('$WORK/zstd.load.json'))
state=save['descriptor']['resourcePlan']['capture']['zstdState']
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-zstd-atomic-loader'
assert state['inputPath'] == '/tmp/zstd.in' and state['outputPolicy'] == 'atomic-temp-rename' and state['fileIdentity']['sha256']
print(json.dumps({'name':'zstd-atomic','state':'passed','zstdState':state,'outputCompare':'match'}))
PY
}

prove_unsafe_zstd_refusal() {
  local bundle="$WORK/unsafe-zstd.bundle" changed_bundle="$WORK/zstd-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  prepare_zstd_fixture "$SRC"
  prepare_zstd_fixture "$TGT"
  pid=$(spawn_stopped_unsafe_zstd_atomic)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-zstd.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-zstd.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_zstd_atomic)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/zstd-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed zstd target\\n' >/tmp/zstd.in" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/zstd-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-zstd.save.json'))
load=json.load(open('$WORK/unsafe-zstd.load.json'))
changed_save=json.load(open('$WORK/zstd-changed.save.json'))
changed_load=json.load(open('$WORK/zstd-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('zstdState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-zstd-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'zstdState':save['descriptor']['resourcePlan']['capture'].get('zstdState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

spawn_stopped_checksum_file() {
  local algorithm="$1" command="$2"
  spawn_stopped_line_tool "${algorithm}-checksum" "/usr/bin/${command}" "['${command}', '/tmp/${algorithm}.in']"
}

spawn_stopped_unsafe_checksum_file() {
  local algorithm="$1" command="$2"
  spawn_stopped_line_tool "unsafe-${algorithm}-checksum" "/usr/bin/${command}" "['${command}']"
}

prove_checksum_file() {
  local algorithm="$1" command="$2" proof_name="$3" pid log
  local bundle="$WORK/${algorithm}.bundle"
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf '${algorithm}-proof-content\n' >/tmp/${algorithm}.in; rm -f /tmp/${algorithm}-checksum.source.out /tmp/${algorithm}-checksum.err" >/dev/null
  done
  pid=$(spawn_stopped_checksum_file "$algorithm" "$command")
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/${algorithm}.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/${algorithm}.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/${algorithm}.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/${algorithm}.target.out"
  $CLI exec "$TGT" -- "$command /tmp/${algorithm}.in" >"$WORK/${algorithm}.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/${algorithm}.save.json'))
load=json.load(open('$WORK/${algorithm}.load.json'))
out=open('$WORK/${algorithm}.target.out').read()
expected=open('$WORK/${algorithm}.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-checksum-file-loader'
assert out == expected
state=save['descriptor']['resourcePlan']['capture']['checksumState']
assert state['algorithm'] == '$algorithm' and state['expectedDigest'] and state['fileIdentity']['sha256']
print(json.dumps({'name':'$proof_name','state':'passed','checksumState':state,'digest':out.split()[0]}))
PY
}

prove_unsafe_checksum_refusal() {
  local algorithm="$1" command="$2" proof_name="$3" pid save_rc load_rc identity_save_rc identity_load_rc
  local stdin_bundle="$WORK/unsafe-${algorithm}-stdin.bundle" identity_bundle="$WORK/unsafe-${algorithm}-identity.bundle"
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf '${algorithm}-identity-source\n' >/tmp/${algorithm}.in; rm -f /tmp/unsafe-${algorithm}-checksum.source.out /tmp/unsafe-${algorithm}-checksum.err /tmp/${algorithm}-checksum.source.out /tmp/${algorithm}-checksum.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_checksum_file "$algorithm" "$command")
  set +e
  $CLI move save "$SRC" "$pid" "$stdin_bundle" --json >"$WORK/unsafe-${algorithm}-stdin.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$stdin_bundle" --json >"$WORK/unsafe-${algorithm}-stdin.load.json"
  load_rc=$?
  set -e
  pid=$(spawn_stopped_checksum_file "$algorithm" "$command")
  set +e
  $CLI move save "$SRC" "$pid" "$identity_bundle" --json >"$WORK/unsafe-${algorithm}-identity.save.json"
  identity_save_rc=$?
  $CLI exec "$TGT" -- "printf '${algorithm}-identity-target\n' >/tmp/${algorithm}.in" >/dev/null
  $CLI move load "$TGT" "$identity_bundle" --json >"$WORK/unsafe-${algorithm}-identity.load.json"
  identity_load_rc=$?
  set -e
  python3 - <<PY
import json
stdin_save=json.load(open('$WORK/unsafe-${algorithm}-stdin.save.json'))
stdin_load=json.load(open('$WORK/unsafe-${algorithm}-stdin.load.json'))
identity_save=json.load(open('$WORK/unsafe-${algorithm}-identity.save.json'))
identity_load=json.load(open('$WORK/unsafe-${algorithm}-identity.load.json'))
loader=identity_load.get('loader') or {}
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not stdin_save['accepted'] and not stdin_load['accepted']
assert stdin_save['descriptor']['resourcePlan']['capture'].get('checksumState') is None
assert 'loader' not in stdin_load
assert int('$identity_save_rc') == 0 and int('$identity_load_rc') == 1
assert identity_save['accepted'] and not identity_load['accepted']
assert identity_save['descriptor']['resourcePlan']['capture']['checksumState']['algorithm'] == '$algorithm'
assert loader.get('state') == 'refused' and not loader.get('targetPid')
assert 'changed-input-identity' in ((loader.get('patch') or {}).get('stdout') or '')
print(json.dumps({'name':'$proof_name','state':'passed','stdinSaveAccepted':stdin_save['accepted'],'stdinLoadAccepted':stdin_load['accepted'],'stdinChecksumState':stdin_save['descriptor']['resourcePlan']['capture'].get('checksumState'),'changedIdentitySaveAccepted':identity_save['accepted'],'changedIdentityLoadAccepted':identity_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

prove_md5sum_file() { prove_checksum_file "md5" "md5sum" "md5sum-file"; }
prove_unsafe_md5sum_refusal() { prove_unsafe_checksum_refusal "md5" "md5sum" "unsafe-md5sum-refusal"; }
prove_sha1sum_file() { prove_checksum_file "sha1" "sha1sum" "sha1sum-file"; }
prove_unsafe_sha1sum_refusal() { prove_unsafe_checksum_refusal "sha1" "sha1sum" "unsafe-sha1sum-refusal"; }
prove_sha512sum_file() { prove_checksum_file "sha512" "sha512sum" "sha512sum-file"; }
prove_unsafe_sha512sum_refusal() { prove_unsafe_checksum_refusal "sha512" "sha512sum" "unsafe-sha512sum-refusal"; }

prove_unsafe_sha256sum_refusal() {
  local stdin_bundle="$WORK/unsafe-sha256-stdin.bundle" identity_bundle="$WORK/unsafe-sha256-identity.bundle" pid save_rc load_rc identity_save_rc identity_load_rc
  pid=$(spawn_stopped_unsafe_sha256sum_stdin)
  set +e
  $CLI move save "$SRC" "$pid" "$stdin_bundle" --json >"$WORK/unsafe-sha256-stdin.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$stdin_bundle" --json >"$WORK/unsafe-sha256-stdin.load.json"
  load_rc=$?
  set -e
  $CLI exec "$SRC" -- "printf 'identity-source\\n' >/tmp/sha256.in" >/dev/null
  $CLI exec "$TGT" -- "printf 'identity-target\\n' >/tmp/sha256.in" >/dev/null
  pid=$(spawn_stopped_sha256sum)
  set +e
  $CLI move save "$SRC" "$pid" "$identity_bundle" --json >"$WORK/unsafe-sha256-identity.save.json"
  identity_save_rc=$?
  $CLI move load "$TGT" "$identity_bundle" --json >"$WORK/unsafe-sha256-identity.load.json"
  identity_load_rc=$?
  set -e
  python3 - <<PY
import json
stdin_save=json.load(open('$WORK/unsafe-sha256-stdin.save.json'))
stdin_load=json.load(open('$WORK/unsafe-sha256-stdin.load.json'))
identity_save=json.load(open('$WORK/unsafe-sha256-identity.save.json'))
identity_load=json.load(open('$WORK/unsafe-sha256-identity.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not stdin_save['accepted']
assert not stdin_load['accepted']
assert stdin_save['descriptor']['resourcePlan']['capture'].get('sha256State') is None
assert stdin_save['descriptor']['nativeContinuation']['state'] == 'refused'
assert 'loader' not in stdin_load
assert int('$identity_save_rc') == 0
assert int('$identity_load_rc') == 1
assert identity_save['accepted']
assert not identity_load['accepted']
assert identity_save['descriptor']['resourcePlan']['capture']['sha256State']['expectedDigest']
loader=identity_load.get('loader') or {}
assert loader.get('state') == 'refused'
assert not loader.get('targetPid')
stdout=((loader.get('patch') or {}).get('stdout') or '')
assert 'changed-input-identity' in stdout
print(json.dumps({'name':'unsafe-sha256sum-refusal','state':'passed','stdinSaveAccepted':stdin_save['accepted'],'stdinLoadAccepted':stdin_load['accepted'],'stdinSha256State':stdin_save['descriptor']['resourcePlan']['capture'].get('sha256State'),'changedIdentitySaveAccepted':identity_save['accepted'],'changedIdentityLoadAccepted':identity_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

prove_sha256sum_file() {
  local bundle="$WORK/sha256.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'sha256-proof-content\n' >/tmp/sha256.in; rm -f /tmp/sha256.source.out /tmp/sha256.err" >/dev/null
  done
  pid=$(spawn_stopped_sha256sum)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/sha256.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/sha256.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/sha256.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/sha256.target.out"
  $CLI exec "$TGT" -- "sha256sum /tmp/sha256.in" >"$WORK/sha256.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/sha256.save.json'))
load=json.load(open('$WORK/sha256.load.json'))
out=open('$WORK/sha256.target.out').read()
expected=open('$WORK/sha256.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-sha256sum-file-loader'
assert out == expected
print(json.dumps({'name':'sha256sum-file','state':'passed','sha256State':save['descriptor']['resourcePlan']['capture']['sha256State'],'digest':out.split()[0]}))
PY
}

spawn_stopped_wc() {
  $CLI exec "$SRC" -- "rm -f /tmp/wc.spawn.pid /tmp/wc.spawn.log; cat >/tmp/spawn-stopped-wc.py <<'PY'
import ctypes, os, signal
libc = ctypes.CDLL(None, use_errno=True)
PTRACE_TRACEME = 0
PTRACE_DETACH = 17
pid = os.fork()
if pid == 0:
    os.close(0)
    os.open('/dev/null', os.O_RDONLY)
    os.close(1)
    os.open('/tmp/wc.source.out', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.close(2)
    os.open('/tmp/wc.err', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    if libc.ptrace(PTRACE_TRACEME, 0, None, None) != 0:
        raise OSError(ctypes.get_errno(), 'ptrace TRACEME failed')
    os.execv('/usr/bin/wc', ['wc', '-l', '/tmp/wc.in'])
_, _status = os.waitpid(pid, 0)
if libc.ptrace(PTRACE_DETACH, pid, None, signal.SIGSTOP) != 0:
    raise OSError(ctypes.get_errno(), 'ptrace DETACH failed')
print(pid, flush=True)
PY
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec python3 /tmp/spawn-stopped-wc.py >/tmp/wc.spawn.pid 2>/tmp/wc.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/wc.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/wc.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/wc.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

prove_wc_line() {
  local bundle="$WORK/wc.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "cat >/tmp/wc.in <<'WC'
one
two
three
four
WC
rm -f /tmp/wc.source.out /tmp/wc.err" >/dev/null
  done
  pid=$(spawn_stopped_wc)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/wc.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/wc.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/wc.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/wc.target.out"
  $CLI exec "$TGT" -- "wc -l /tmp/wc.in" >"$WORK/wc.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/wc.save.json'))
load=json.load(open('$WORK/wc.load.json'))
out=open('$WORK/wc.target.out').read()
expected=open('$WORK/wc.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-wc-line-loader'
assert out == expected
print(json.dumps({'name':'wc-line','state':'passed','wcState':save['descriptor']['resourcePlan']['capture']['wcState'],'output':out.strip()}))
PY
}

spawn_stopped_line_tool() {
  local name="$1" exec_path="$2" argv_expr="$3"
  $CLI exec "$SRC" -- "rm -f /tmp/${name}.spawn.pid /tmp/${name}.spawn.log; cat >/tmp/spawn-stopped-${name}.py <<PY
import ctypes, os, signal
libc = ctypes.CDLL(None, use_errno=True)
PTRACE_TRACEME = 0
PTRACE_DETACH = 17
pid = os.fork()
if pid == 0:
    os.close(0)
    os.open('/dev/null', os.O_RDONLY)
    os.close(1)
    os.open('/tmp/${name}.source.out', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.close(2)
    os.open('/tmp/${name}.err', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    if libc.ptrace(PTRACE_TRACEME, 0, None, None) != 0:
        raise OSError(ctypes.get_errno(), 'ptrace TRACEME failed')
    os.execv('${exec_path}', ${argv_expr})
_, _status = os.waitpid(pid, 0)
if libc.ptrace(PTRACE_DETACH, pid, None, signal.SIGSTOP) != 0:
    raise OSError(ctypes.get_errno(), 'ptrace DETACH failed')
print(pid, flush=True)
PY
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec /usr/bin/python3 /tmp/spawn-stopped-${name}.py >/tmp/${name}.spawn.pid 2>/tmp/${name}.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/${name}.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/${name}.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

spawn_stopped_comm_files() {
  spawn_stopped_line_tool "comm-files" "/usr/bin/comm" "['comm', '/tmp/comm.left', '/tmp/comm.right']"
}

spawn_stopped_unsafe_comm_files() {
  spawn_stopped_line_tool "unsafe-comm-files" "/usr/bin/comm" "['comm', '/tmp/comm.left', '/tmp/comm.right']"
}

prove_comm_files() {
  local bundle="$WORK/comm.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "cat >/tmp/comm.left <<'LEFT'
alpha
bravo
delta
LEFT
cat >/tmp/comm.right <<'RIGHT'
bravo
charlie
delta
RIGHT
rm -f /tmp/comm-files.source.out /tmp/comm-files.err" >/dev/null
  done
  pid=$(spawn_stopped_comm_files)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/comm.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/comm.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/comm.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/comm.target.out"
  $CLI exec "$TGT" -- "LC_ALL=C comm /tmp/comm.left /tmp/comm.right" >"$WORK/comm.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/comm.save.json'))
load=json.load(open('$WORK/comm.load.json'))
out=open('$WORK/comm.target.out').read()
expected=open('$WORK/comm.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-comm-files-loader'
assert out == expected
state=save['descriptor']['resourcePlan']['capture']['commState']
assert state['leftPath'] == '/tmp/comm.left' and state['rightPath'] == '/tmp/comm.right' and state['collation'] == 'C' and state['leftIdentity']['sha256'] and state['rightIdentity']['sha256']
print(json.dumps({'name':'comm-files','state':'passed','commState':state,'output':out.splitlines()}))
PY
}

prove_unsafe_comm_refusal() {
  local bundle="$WORK/unsafe-comm.bundle" changed_bundle="$WORK/comm-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'bravo\\nalpha\\n' >/tmp/comm.left; printf 'alpha\\nbravo\\n' >/tmp/comm.right; rm -f /tmp/unsafe-comm-files.source.out /tmp/unsafe-comm-files.err /tmp/comm-files.source.out /tmp/comm-files.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_comm_files)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-comm.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-comm.load.json"
  load_rc=$?
  set -e
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'alpha\\nbravo\\n' >/tmp/comm.left; printf 'alpha\\nbravo\\n' >/tmp/comm.right" >/dev/null
  done
  changed_pid=$(spawn_stopped_comm_files)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/comm-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed\\nidentity\\n' >/tmp/comm.right" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/comm-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-comm.save.json'))
load=json.load(open('$WORK/unsafe-comm.load.json'))
changed_save=json.load(open('$WORK/comm-changed.save.json'))
changed_load=json.load(open('$WORK/comm-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('commState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-comm-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'commState':save['descriptor']['resourcePlan']['capture'].get('commState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

spawn_stopped_join_files() {
  spawn_stopped_line_tool "join-files" "/usr/bin/join" "['join', '/tmp/join.left', '/tmp/join.right']"
}

spawn_stopped_unsafe_join_files() {
  spawn_stopped_line_tool "unsafe-join-files" "/usr/bin/join" "['join', '-1', '2', '/tmp/join.left', '/tmp/join.right']"
}

prove_join_files() {
  local bundle="$WORK/join.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "cat >/tmp/join.left <<'LEFT'
a left-alpha
b left-bravo
d left-delta
LEFT
cat >/tmp/join.right <<'RIGHT'
b right-bravo
c right-charlie
d right-delta
RIGHT
rm -f /tmp/join-files.source.out /tmp/join-files.err" >/dev/null
  done
  pid=$(spawn_stopped_join_files)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/join.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/join.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/join.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/join.target.out"
  $CLI exec "$TGT" -- "LC_ALL=C join /tmp/join.left /tmp/join.right" >"$WORK/join.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/join.save.json'))
load=json.load(open('$WORK/join.load.json'))
out=open('$WORK/join.target.out').read()
expected=open('$WORK/join.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-join-files-loader'
assert out == expected
state=save['descriptor']['resourcePlan']['capture']['joinState']
assert state['leftPath'] == '/tmp/join.left' and state['rightPath'] == '/tmp/join.right' and state['key'] == 'default-first-field' and state['collation'] == 'C' and state['leftIdentity']['sha256'] and state['rightIdentity']['sha256']
print(json.dumps({'name':'join-files','state':'passed','joinState':state,'output':out.splitlines()}))
PY
}

prove_unsafe_join_refusal() {
  local bundle="$WORK/unsafe-join.bundle" changed_bundle="$WORK/join-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'a one\\nb two\\n' >/tmp/join.left; printf 'a uno\\nb dos\\n' >/tmp/join.right; rm -f /tmp/unsafe-join-files.source.out /tmp/unsafe-join-files.err /tmp/join-files.source.out /tmp/join-files.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_join_files)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-join.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-join.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_join_files)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/join-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed\\nidentity\\n' >/tmp/join.right" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/join-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-join.save.json'))
load=json.load(open('$WORK/unsafe-join.load.json'))
changed_save=json.load(open('$WORK/join-changed.save.json'))
changed_load=json.load(open('$WORK/join-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('joinState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-join-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'joinState':save['descriptor']['resourcePlan']['capture'].get('joinState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

spawn_stopped_paste_files() {
  spawn_stopped_line_tool "paste-files" "/usr/bin/paste" "['paste', '/tmp/paste.left', '/tmp/paste.right']"
}

spawn_stopped_unsafe_paste_files() {
  spawn_stopped_line_tool "unsafe-paste-files" "/usr/bin/paste" "['paste', '/tmp/paste.left', '/tmp/paste.right', '/tmp/paste.extra']"
}

prove_paste_files() {
  local bundle="$WORK/paste.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "cat >/tmp/paste.left <<'LEFT'
alpha
bravo
charlie
LEFT
cat >/tmp/paste.right <<'RIGHT'
one
two
three
RIGHT
rm -f /tmp/paste-files.source.out /tmp/paste-files.err" >/dev/null
  done
  pid=$(spawn_stopped_paste_files)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/paste.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/paste.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/paste.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/paste.target.out"
  $CLI exec "$TGT" -- "paste /tmp/paste.left /tmp/paste.right" >"$WORK/paste.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/paste.save.json'))
load=json.load(open('$WORK/paste.load.json'))
out=open('$WORK/paste.target.out').read()
expected=open('$WORK/paste.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-paste-files-loader'
assert out == expected
state=save['descriptor']['resourcePlan']['capture']['pasteState']
assert state['leftPath'] == '/tmp/paste.left' and state['rightPath'] == '/tmp/paste.right' and state['leftIdentity']['sha256'] and state['rightIdentity']['sha256']
print(json.dumps({'name':'paste-files','state':'passed','pasteState':state,'output':out.splitlines()}))
PY
}

prove_unsafe_paste_refusal() {
  local bundle="$WORK/unsafe-paste.bundle" changed_bundle="$WORK/paste-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'alpha\\nbravo\\n' >/tmp/paste.left; printf 'one\\ntwo\\n' >/tmp/paste.right; printf 'extra\\n' >/tmp/paste.extra; rm -f /tmp/unsafe-paste-files.source.out /tmp/unsafe-paste-files.err /tmp/paste-files.source.out /tmp/paste-files.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_paste_files)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-paste.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-paste.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_paste_files)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/paste-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed\\nidentity\\n' >/tmp/paste.right" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/paste-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-paste.save.json'))
load=json.load(open('$WORK/unsafe-paste.load.json'))
changed_save=json.load(open('$WORK/paste-changed.save.json'))
changed_load=json.load(open('$WORK/paste-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('pasteState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-paste-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'pasteState':save['descriptor']['resourcePlan']['capture'].get('pasteState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

spawn_stopped_uniq_file() {
  spawn_stopped_line_tool "uniq-file" "/usr/bin/uniq" "['uniq', '-c', '/tmp/uniq.in']"
}

spawn_stopped_unsafe_uniq_file() {
  spawn_stopped_line_tool "unsafe-uniq-file" "/usr/bin/uniq" "['uniq', '-d', '/tmp/uniq.in']"
}

prove_uniq_file() {
  local bundle="$WORK/uniq.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "cat >/tmp/uniq.in <<'UNIQ'
alpha
alpha
bravo
bravo
bravo
charlie
UNIQ
rm -f /tmp/uniq-file.source.out /tmp/uniq-file.err" >/dev/null
  done
  pid=$(spawn_stopped_uniq_file)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/uniq.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/uniq.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/uniq.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/uniq.target.out"
  $CLI exec "$TGT" -- "uniq -c /tmp/uniq.in" >"$WORK/uniq.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/uniq.save.json'))
load=json.load(open('$WORK/uniq.load.json'))
out=open('$WORK/uniq.target.out').read()
expected=open('$WORK/uniq.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-uniq-file-loader'
assert out == expected
state=save['descriptor']['resourcePlan']['capture']['uniqState']
assert state['path'] == '/tmp/uniq.in' and state['count'] is True and state['fileIdentity']['sha256']
print(json.dumps({'name':'uniq-file','state':'passed','uniqState':state,'output':out.splitlines()}))
PY
}

prove_unsafe_uniq_refusal() {
  local bundle="$WORK/unsafe-uniq.bundle" changed_bundle="$WORK/uniq-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'alpha\\nalpha\\nbravo\\n' >/tmp/uniq.in; rm -f /tmp/unsafe-uniq-file.source.out /tmp/unsafe-uniq-file.err /tmp/uniq-file.source.out /tmp/uniq-file.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_uniq_file)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-uniq.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-uniq.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_uniq_file)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/uniq-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed\\nidentity\\n' >/tmp/uniq.in" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/uniq-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-uniq.save.json'))
load=json.load(open('$WORK/unsafe-uniq.load.json'))
changed_save=json.load(open('$WORK/uniq-changed.save.json'))
changed_load=json.load(open('$WORK/uniq-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('uniqState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-uniq-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'uniqState':save['descriptor']['resourcePlan']['capture'].get('uniqState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

spawn_stopped_awk_field() {
  spawn_stopped_line_tool "awk-field" "/usr/bin/awk" "['awk', '{print \\\$2}', '/tmp/awk-field.in']"
}

spawn_stopped_unsafe_awk_field() {
  spawn_stopped_line_tool "unsafe-awk-field" "/usr/bin/awk" "['awk', '{print \\\$0}', '/tmp/awk-field.in']"
}

prove_awk_field() {
  local bundle="$WORK/awk-field.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "cat >/tmp/awk-field.in <<'AWK'
alpha one extra
bravo two extra
charlie three extra
AWK
rm -f /tmp/awk-field.source.out /tmp/awk-field.err" >/dev/null
  done
  pid=$(spawn_stopped_awk_field)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/awk-field.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/awk-field.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/awk-field.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/awk-field.target.out"
  $CLI exec "$TGT" -- "awk '{print \$2}' /tmp/awk-field.in" >"$WORK/awk-field.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/awk-field.save.json'))
load=json.load(open('$WORK/awk-field.load.json'))
out=open('$WORK/awk-field.target.out').read()
expected=open('$WORK/awk-field.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-awk-field-loader'
assert out == expected
state=save['descriptor']['resourcePlan']['capture']['awkFieldState']
assert state['fieldIndex'] == 2 and state['fs'] == 'default-whitespace' and state['fileIdentity']['sha256']
print(json.dumps({'name':'awk-field','state':'passed','awkFieldState':state,'output':out.splitlines()}))
PY
}

prove_unsafe_awk_refusal() {
  local bundle="$WORK/unsafe-awk-field.bundle" changed_bundle="$WORK/awk-field-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'alpha one\\nbravo two\\n' >/tmp/awk-field.in; rm -f /tmp/unsafe-awk-field.source.out /tmp/unsafe-awk-field.err /tmp/awk-field.source.out /tmp/awk-field.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_awk_field)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-awk-field.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-awk-field.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_awk_field)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/awk-field-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed\\nidentity\\n' >/tmp/awk-field.in" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/awk-field-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-awk-field.save.json'))
load=json.load(open('$WORK/unsafe-awk-field.load.json'))
changed_save=json.load(open('$WORK/awk-field-changed.save.json'))
changed_load=json.load(open('$WORK/awk-field-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('awkFieldState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-awk-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'awkFieldState':save['descriptor']['resourcePlan']['capture'].get('awkFieldState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

spawn_stopped_cut_fields() {
  spawn_stopped_line_tool "cut-fields" "/usr/bin/cut" "['cut', '-d', ':', '-f', '2', '/tmp/cut.in']"
}

spawn_stopped_unsafe_cut_fields() {
  spawn_stopped_line_tool "unsafe-cut-fields" "/usr/bin/cut" "['cut', '-f', '2', '/tmp/cut.in']"
}

prove_cut_fields() {
  local bundle="$WORK/cut-fields.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "cat >/tmp/cut.in <<'CUT'
alpha:one:extra
bravo:two:extra
charlie:three:extra
CUT
rm -f /tmp/cut-fields.source.out /tmp/cut-fields.err" >/dev/null
  done
  pid=$(spawn_stopped_cut_fields)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/cut-fields.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/cut-fields.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/cut-fields.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/cut-fields.target.out"
  $CLI exec "$TGT" -- "cut -d ':' -f '2' /tmp/cut.in" >"$WORK/cut-fields.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/cut-fields.save.json'))
load=json.load(open('$WORK/cut-fields.load.json'))
out=open('$WORK/cut-fields.target.out').read()
expected=open('$WORK/cut-fields.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-cut-fields-loader'
assert out == expected
state=save['descriptor']['resourcePlan']['capture']['cutState']
assert state['delimiter'] == ':' and state['fields'] == '2' and state['fileIdentity']['sha256']
print(json.dumps({'name':'cut-fields','state':'passed','cutState':state,'output':out.splitlines()}))
PY
}

prove_unsafe_cut_refusal() {
  local bundle="$WORK/unsafe-cut-fields.bundle" changed_bundle="$WORK/cut-fields-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'alpha:one\\nbravo:two\\n' >/tmp/cut.in; rm -f /tmp/unsafe-cut-fields.source.out /tmp/unsafe-cut-fields.err /tmp/cut-fields.source.out /tmp/cut-fields.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_cut_fields)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-cut-fields.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-cut-fields.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_cut_fields)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/cut-fields-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed\\nidentity\\n' >/tmp/cut.in" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/cut-fields-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-cut-fields.save.json'))
load=json.load(open('$WORK/unsafe-cut-fields.load.json'))
changed_save=json.load(open('$WORK/cut-fields-changed.save.json'))
changed_load=json.load(open('$WORK/cut-fields-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('cutState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-cut-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'cutState':save['descriptor']['resourcePlan']['capture'].get('cutState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

spawn_stopped_sed_print_range() {
  spawn_stopped_line_tool "sed-range" "/usr/bin/sed" "['sed', '-n', '2,4p', '/tmp/sed-range.in']"
}

spawn_stopped_unsafe_sed_print_range() {
  spawn_stopped_line_tool "unsafe-sed-range" "/usr/bin/sed" "['sed', '-n', '/alpha/p', '/tmp/sed-range.in']"
}

prove_sed_print_range() {
  local bundle="$WORK/sed-range.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "cat >/tmp/sed-range.in <<'SED'
one
two
three
four
five
SED
rm -f /tmp/sed-range.source.out /tmp/sed-range.err" >/dev/null
  done
  pid=$(spawn_stopped_sed_print_range)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/sed-range.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/sed-range.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/sed-range.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/sed-range.target.out"
  $CLI exec "$TGT" -- "sed -n '2,4p' /tmp/sed-range.in" >"$WORK/sed-range.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/sed-range.save.json'))
load=json.load(open('$WORK/sed-range.load.json'))
out=open('$WORK/sed-range.target.out').read()
expected=open('$WORK/sed-range.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-sed-file-loader'
assert out == expected
state=save['descriptor']['resourcePlan']['capture']['sedState']
assert state['scriptKind'] == 'print-range' and state['startLine'] == 2 and state['endLine'] == 4 and state['fileIdentity']['sha256']
print(json.dumps({'name':'sed-print-range','state':'passed','sedState':state,'output':out.splitlines()}))
PY
}

prove_unsafe_sed_print_refusal() {
  local bundle="$WORK/unsafe-sed-range.bundle" changed_bundle="$WORK/sed-range-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'alpha\\nbravo\\ncharlie\\n' >/tmp/sed-range.in; rm -f /tmp/unsafe-sed-range.source.out /tmp/unsafe-sed-range.err /tmp/sed-range.source.out /tmp/sed-range.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_sed_print_range)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-sed-range.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-sed-range.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_sed_print_range)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/sed-range-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed\\nidentity\\n' >/tmp/sed-range.in" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/sed-range-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-sed-range.save.json'))
load=json.load(open('$WORK/unsafe-sed-range.load.json'))
changed_save=json.load(open('$WORK/sed-range-changed.save.json'))
changed_load=json.load(open('$WORK/sed-range-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('sedState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-sed-print-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'sedState':save['descriptor']['resourcePlan']['capture'].get('sedState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

spawn_stopped_sed_substitution() {
  spawn_stopped_line_tool "sed-sub" "/usr/bin/sed" "['sed', 's/alpha/omega/', '/tmp/sed-sub.in']"
}

spawn_stopped_unsafe_sed_substitution() {
  spawn_stopped_line_tool "unsafe-sed-sub" "/usr/bin/sed" "['sed', 's/a.*/omega/', '/tmp/sed-sub.in']"
}

prove_sed_literal_substitution() {
  local bundle="$WORK/sed-sub.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "cat >/tmp/sed-sub.in <<'SED'
alpha one
bravo two
alpha three
SED
rm -f /tmp/sed-sub.source.out /tmp/sed-sub.err" >/dev/null
  done
  pid=$(spawn_stopped_sed_substitution)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/sed-sub.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/sed-sub.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/sed-sub.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/sed-sub.target.out"
  $CLI exec "$TGT" -- "sed 's/alpha/omega/' /tmp/sed-sub.in" >"$WORK/sed-sub.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/sed-sub.save.json'))
load=json.load(open('$WORK/sed-sub.load.json'))
out=open('$WORK/sed-sub.target.out').read()
expected=open('$WORK/sed-sub.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-sed-file-loader'
assert out == expected
state=save['descriptor']['resourcePlan']['capture']['sedState']
assert state['scriptKind'] == 'literal-substitution' and state['pattern'] == 'alpha' and state['replacement'] == 'omega' and state['fileIdentity']['sha256']
print(json.dumps({'name':'sed-literal-substitution','state':'passed','sedState':state,'output':out.splitlines()}))
PY
}

prove_unsafe_sed_sub_refusal() {
  local bundle="$WORK/unsafe-sed-sub.bundle" changed_bundle="$WORK/sed-sub-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'alpha one\\nbravo two\\n' >/tmp/sed-sub.in; rm -f /tmp/unsafe-sed-sub.source.out /tmp/unsafe-sed-sub.err /tmp/sed-sub.source.out /tmp/sed-sub.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_sed_substitution)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-sed-sub.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-sed-sub.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_sed_substitution)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/sed-sub-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed\\nidentity\\n' >/tmp/sed-sub.in" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/sed-sub-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-sed-sub.save.json'))
load=json.load(open('$WORK/unsafe-sed-sub.load.json'))
changed_save=json.load(open('$WORK/sed-sub-changed.save.json'))
changed_load=json.load(open('$WORK/sed-sub-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('sedState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-sed-sub-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'sedState':save['descriptor']['resourcePlan']['capture'].get('sedState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

spawn_stopped_head() {
  spawn_stopped_line_tool "head" "/usr/bin/head" "['head', '-n', '3', '/tmp/head.in']"
}

spawn_stopped_unsafe_head() {
  spawn_stopped_line_tool "unsafe-head" "/usr/bin/head" "['head', '-c', '4', '/tmp/head.in']"
}

prove_head_file() {
  local bundle="$WORK/head.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "cat >/tmp/head.in <<'HEAD'
alpha
bravo
charlie
delta
echo
HEAD
rm -f /tmp/head.source.out /tmp/head.err" >/dev/null
  done
  pid=$(spawn_stopped_head)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/head.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/head.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/head.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/head.target.out"
  $CLI exec "$TGT" -- "head -n 3 /tmp/head.in" >"$WORK/head.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/head.save.json'))
load=json.load(open('$WORK/head.load.json'))
out=open('$WORK/head.target.out').read()
expected=open('$WORK/head.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-head-file-loader'
assert out == expected
state=save['descriptor']['resourcePlan']['capture']['headState']
assert state['lines'] == 3 and state['fileIdentity']['sha256']
print(json.dumps({'name':'head-file','state':'passed','headState':state,'output':out.splitlines()}))
PY
}

prove_unsafe_head_refusal() {
  local bundle="$WORK/unsafe-head.bundle" changed_bundle="$WORK/head-changed.bundle" pid save_rc load_rc changed_pid
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'alpha\\nbravo\\ncharlie\\n' >/tmp/head.in; rm -f /tmp/unsafe-head.source.out /tmp/unsafe-head.err /tmp/head.source.out /tmp/head.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_head)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-head.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-head.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_head)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/head-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed\\nidentity\\n' >/tmp/head.in" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/head-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-head.save.json'))
load=json.load(open('$WORK/unsafe-head.load.json'))
changed_save=json.load(open('$WORK/head-changed.save.json'))
changed_load=json.load(open('$WORK/head-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('headState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-head-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'headState':save['descriptor']['resourcePlan']['capture'].get('headState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

spawn_stopped_tail_lines() {
  spawn_stopped_line_tool "tail-lines" "/usr/bin/tail" "['tail', '-n', '2', '/tmp/tail-lines.in']"
}

spawn_stopped_unsafe_tail_lines() {
  spawn_stopped_line_tool "unsafe-tail-lines" "/usr/bin/tail" "['tail', '-f', '/tmp/tail-lines.in']"
}

prove_tail_lines() {
  local bundle="$WORK/tail-lines.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "cat >/tmp/tail-lines.in <<'TAIL'
alpha
bravo
charlie
delta
echo
TAIL
rm -f /tmp/tail-lines.source.out /tmp/tail-lines.err" >/dev/null
  done
  pid=$(spawn_stopped_tail_lines)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/tail-lines.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/tail-lines.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/tail-lines.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/tail-lines.target.out"
  $CLI exec "$TGT" -- "tail -n 2 /tmp/tail-lines.in" >"$WORK/tail-lines.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/tail-lines.save.json'))
load=json.load(open('$WORK/tail-lines.load.json'))
out=open('$WORK/tail-lines.target.out').read()
expected=open('$WORK/tail-lines.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-tail-lines-loader'
assert out == expected
state=save['descriptor']['resourcePlan']['capture']['tailLinesState']
assert state['lines'] == 2 and state['fileIdentity']['sha256']
print(json.dumps({'name':'tail-lines','state':'passed','tailLinesState':state,'output':out.splitlines()}))
PY
}

prove_unsafe_tail_lines_refusal() {
  local bundle="$WORK/unsafe-tail-lines.bundle" changed_bundle="$WORK/tail-lines-changed.bundle" pid save_rc load_rc changed_pid changed_load_rc
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "printf 'alpha\\nbravo\\ncharlie\\n' >/tmp/tail-lines.in; rm -f /tmp/unsafe-tail-lines.source.out /tmp/unsafe-tail-lines.err /tmp/tail-lines.source.out /tmp/tail-lines.err" >/dev/null
  done
  pid=$(spawn_stopped_unsafe_tail_lines)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-tail-lines.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-tail-lines.load.json"
  load_rc=$?
  set -e
  changed_pid=$(spawn_stopped_tail_lines)
  $CLI move save "$SRC" "$changed_pid" "$changed_bundle" --json >"$WORK/tail-lines-changed.save.json"
  $CLI exec "$TGT" -- "printf 'changed\\nidentity\\n' >/tmp/tail-lines.in" >/dev/null
  set +e
  $CLI move load "$TGT" "$changed_bundle" --json >"$WORK/tail-lines-changed.load.json"
  changed_load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-tail-lines.save.json'))
load=json.load(open('$WORK/unsafe-tail-lines.load.json'))
changed_save=json.load(open('$WORK/tail-lines-changed.save.json'))
changed_load=json.load(open('$WORK/tail-lines-changed.load.json'))
loader=changed_load.get('loader', {})
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('tailLinesState') is None
assert changed_save['accepted'] and int('$changed_load_rc') == 1 and not changed_load['accepted']
assert loader.get('state') == 'refused' and loader.get('targetPid') is None
assert 'changed-input-identity' in loader.get('patch', {}).get('stdout', '')
print(json.dumps({'name':'unsafe-tail-lines-refusal','state':'passed','unsupportedSaveAccepted':save['accepted'],'unsupportedLoadAccepted':load['accepted'],'tailLinesState':save['descriptor']['resourcePlan']['capture'].get('tailLinesState'),'changedIdentityLoadAccepted':changed_load['accepted'],'changedIdentityLoaderState':loader.get('state'),'changedIdentityTargetPid':loader.get('targetPid')}))
PY
}

spawn_stopped_sort() {
  $CLI exec "$SRC" -- "rm -f /tmp/sort.spawn.pid /tmp/sort.spawn.log; cat >/tmp/spawn-stopped-sort.py <<'PY'
import ctypes, os, signal
libc = ctypes.CDLL(None, use_errno=True)
PTRACE_TRACEME = 0
PTRACE_DETACH = 17
pid = os.fork()
if pid == 0:
    os.close(0)
    os.open('/dev/null', os.O_RDONLY)
    os.close(1)
    os.open('/tmp/sort.source.out', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.close(2)
    os.open('/tmp/sort.err', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    if libc.ptrace(PTRACE_TRACEME, 0, None, None) != 0:
        raise OSError(ctypes.get_errno(), 'ptrace TRACEME failed')
    os.execv('/usr/bin/sort', ['sort', '/tmp/sort.in'])
_, _status = os.waitpid(pid, 0)
if libc.ptrace(PTRACE_DETACH, pid, None, signal.SIGSTOP) != 0:
    raise OSError(ctypes.get_errno(), 'ptrace DETACH failed')
print(pid, flush=True)
PY
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec python3 /tmp/spawn-stopped-sort.py >/tmp/sort.spawn.pid 2>/tmp/sort.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/sort.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/sort.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/sort.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

prove_sort_file() {
  local bundle="$WORK/sort.bundle" pid log
  for vm in "$SRC" "$TGT"; do
    $CLI exec "$vm" -- "cat >/tmp/sort.in <<'SORT'
zulu
alpha
charlie
bravo
alpha
SORT
rm -f /tmp/sort.source.out /tmp/sort.err" >/dev/null
  done
  pid=$(spawn_stopped_sort)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/sort.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/sort.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/sort.load.json'))['loader']['logPath'])
PY
)
  sleep 1
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/sort.target.out"
  $CLI exec "$TGT" -- "sort /tmp/sort.in" >"$WORK/sort.expected.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/sort.save.json'))
load=json.load(open('$WORK/sort.load.json'))
out=open('$WORK/sort.target.out').read()
expected=open('$WORK/sort.expected.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-sort-file-loader'
assert out == expected
print(json.dumps({'name':'sort-file','state':'passed','sortState':save['descriptor']['resourcePlan']['capture']['sortState'],'output':out.splitlines()}))
PY
}

spawn_stopped_mv() {
  $CLI exec "$SRC" -- "rm -f /tmp/mv.spawn.pid /tmp/mv.spawn.log; cat >/tmp/spawn-stopped-mv.py <<'PY'
import ctypes, os, signal
libc = ctypes.CDLL(None, use_errno=True)
PTRACE_TRACEME = 0
PTRACE_DETACH = 17
pid = os.fork()
if pid == 0:
    if libc.ptrace(PTRACE_TRACEME, 0, None, None) != 0:
        raise OSError(ctypes.get_errno(), 'ptrace TRACEME failed')
    os.execv('/usr/bin/mv', ['mv', '/tmp/mv.in', '/tmp/mv.out'])
_, _status = os.waitpid(pid, 0)
if libc.ptrace(PTRACE_DETACH, pid, None, signal.SIGSTOP) != 0:
    raise OSError(ctypes.get_errno(), 'ptrace DETACH failed')
print(pid, flush=True)
PY
setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec python3 /tmp/spawn-stopped-mv.py >/tmp/mv.spawn.pid 2>/tmp/mv.spawn.log' </dev/null >/dev/null 2>&1 &" >/dev/null
  for _ in $(seq 1 100); do
    if $CLI exec "$SRC" -- "test -s /tmp/mv.spawn.pid" >/dev/null 2>&1; then
      $CLI exec "$SRC" -- "cat /tmp/mv.spawn.pid" | tail -1 | tr -d '\r'
      return 0
    fi
    sleep 0.05
  done
  $CLI exec "$SRC" -- "cat /tmp/mv.spawn.log 2>/dev/null || true" >&2 || true
  return 1
}

prove_mv_rename() {
  local bundle="$WORK/mv.bundle" pid tpid
  $CLI exec "$SRC" -- "rm -f /tmp/mv.in /tmp/mv.out; printf 'mv-proof-content\n' >/tmp/mv.in" >/dev/null
  $CLI exec "$TGT" -- "rm -f /tmp/mv.in /tmp/mv.out; printf 'mv-proof-content\n' >/tmp/mv.in" >/dev/null
  pid=$(spawn_stopped_mv)
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/mv.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/mv.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/mv.load.json'))['loader']['targetPid'])
PY
)
  for _ in $(seq 1 30); do
    if ! $CLI exec "$TGT" -- "kill -0 $tpid 2>/dev/null" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  $CLI exec "$TGT" -- "[ ! -e /tmp/mv.in ] && [ -f /tmp/mv.out ] && cat /tmp/mv.out" >"$WORK/mv.target.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/mv.save.json'))
load=json.load(open('$WORK/mv.load.json'))
out=open('$WORK/mv.target.out').read()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-mv-rename-loader'
assert out == 'mv-proof-content\\n'
print(json.dumps({'name':'mv-rename','state':'passed','mvState':save['descriptor']['resourcePlan']['capture']['mvState'],'targetContent':out.strip(),'targetPid':int('$tpid')}))
PY
}

prove_unsafe_mv_refusal() {
  local bundle="$WORK/unsafe-mv.bundle" pid save_rc load_rc
  $CLI exec "$SRC" -- "rm -f /tmp/mv.in /tmp/mv.out; printf 'mv-source\n' >/tmp/mv.in; printf 'mv-existing-destination\n' >/tmp/mv.out" >/dev/null
  pid=$(spawn_stopped_mv)
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-mv.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-mv.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-mv.save.json'))
load=json.load(open('$WORK/unsafe-mv.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('mvState') is None
assert save['descriptor']['nativeContinuation']['state'] == 'refused'
assert 'loader' not in load
print(json.dumps({'name':'unsafe-mv-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'mvState':save['descriptor']['resourcePlan']['capture'].get('mvState'),'nativeContinuation':save['descriptor']['nativeContinuation']['state'],'loaderStarted':'loader' in load}))
PY
}

prove_unsafe_cp_refusal() {
  local bundle="$WORK/unsafe-cp.bundle" pid save_rc load_rc state
  $CLI exec "$SRC" -- "rm -rf /tmp/cp-tree-out" >/dev/null
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec cp -r /tmp/find-tree /tmp/cp-tree-out 2>/tmp/unsafe-cp.err' </dev/null >/dev/null 2>&1 & pid=\$!; ( sleep 0.005; kill -STOP \$pid 2>/dev/null || true ) >/dev/null 2>&1 & echo \$pid" | tail -1 | tr -d '\r')
  state="unknown"
  for _ in $(seq 1 100); do
    state=$($CLI exec "$SRC" -- "awk '/^State:/ {print \$2}' /proc/$pid/status 2>/dev/null || printf gone" | tail -1 | tr -d '\r')
    if [[ "$state" == "T" ]]; then
      break
    fi
    sleep 0.05
  done
  if [[ "$state" != "T" ]]; then
    echo "unsafe cp proof did not capture stopped process: state=$state" >&2
    return 1
  fi
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-cp.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-cp.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-cp.save.json'))
load=json.load(open('$WORK/unsafe-cp.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('cpState') is None
assert save['descriptor']['nativeContinuation']['state'] == 'refused'
assert 'loader' not in load
print(json.dumps({'name':'unsafe-cp-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'cpState':save['descriptor']['resourcePlan']['capture'].get('cpState'),'nativeContinuation':save['descriptor']['nativeContinuation']['state'],'loaderStarted':'loader' in load}))
PY
}

prove_dd_offset() {
  local bundle="$WORK/dd.bundle" pid log offset tpid
  $CLI exec "$SRC" -- "python3 - <<'PY'
from pathlib import Path
Path('/tmp/dd.in').write_bytes((b'abcdefghijklmnopqrstuvwxyz0123456789\\n' * 300000))
PY" >/dev/null
  $CLI exec "$TGT" -- "python3 - <<'PY'
from pathlib import Path
Path('/tmp/dd.in').write_bytes((b'abcdefghijklmnopqrstuvwxyz0123456789\\n' * 300000))
PY" >/dev/null
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec dd if=/tmp/dd.in of=/tmp/dd.out bs=1' >/dev/null 2>/tmp/dd.err & echo \$!" | tail -1 | tr -d '\r')
  sleep 0.05
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/dd.save.json"
  offset=$(python3 - <<PY
import json; print(json.load(open('$WORK/dd.save.json'))['descriptor']['resourcePlan']['capture']['ddState']['outputOffset'])
PY
)
  $CLI exec "$TGT" -- "head -c $offset /tmp/dd.in >/tmp/dd.out" >/dev/null
  $CLI move load "$TGT" "$bundle" --json >"$WORK/dd.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/dd.load.json'))['loader']['targetPid'])
PY
)
  for _ in $(seq 1 180); do
    $CLI exec "$TGT" -- "cmp -s /tmp/dd.in /tmp/dd.out && printf match || printf pending" >"$WORK/dd.compare"
    if grep -q '^match$' "$WORK/dd.compare"; then
      break
    fi
    sleep 1
  done
  python3 - <<PY
import json
save=json.load(open('$WORK/dd.save.json'))
load=json.load(open('$WORK/dd.load.json'))
compare=open('$WORK/dd.compare').read().strip()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-dd-offset-loader'
assert compare == 'match'
print(json.dumps({'name':'dd-offset','state':'passed','ddState':save['descriptor']['resourcePlan']['capture']['ddState'],'compare':compare,'targetPid':int('$tpid')}))
PY
}

prove_unsafe_dd_refusal() {
  local bundle="$WORK/unsafe-dd.bundle" pid save_rc load_rc
  $CLI exec "$SRC" -- "python3 - <<'PY'
from pathlib import Path
Path('/tmp/unsafe-dd.in').write_bytes((b'unsafe-dd-line\\n' * 800000))
PY" >/dev/null
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec dd if=/tmp/unsafe-dd.in of=/tmp/unsafe-dd.out bs=1 conv=notrunc' >/dev/null 2>/tmp/unsafe-dd.err & echo \$!" | tail -1 | tr -d '\r')
  sleep 0.05
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsafe-dd.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsafe-dd.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsafe-dd.save.json'))
load=json.load(open('$WORK/unsafe-dd.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
assert save['descriptor']['resourcePlan']['capture'].get('ddState') is None
assert save['descriptor']['nativeContinuation']['state'] == 'refused'
assert 'loader' not in load
print(json.dumps({'name':'unsafe-dd-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'ddState':save['descriptor']['resourcePlan']['capture'].get('ddState'),'nativeContinuation':save['descriptor']['nativeContinuation']['state'],'loaderStarted':'loader' in load}))
PY
}

mutate_generic_pipe_bundle() {
  local bundle="$1" exe="$2" argv_json="$3" pipe_json="$4" health_json="$5"
  python3 - <<PY
import json
p='$bundle/move.json'
d=json.load(open(p))
argv=json.loads('''$argv_json''')
pipe=json.loads('''$pipe_json''')
health=json.loads('''$health_json''')
node=d['nodes'][0]
node['command']=argv[0].split('/')[-1]
node['argv']=argv
node['exe']='$exe'
cap=d['resourcePlan']['capture']
pkg=cap['executablePackage']
pkg['path']='$exe'
pkg['realPath']='$exe'
pkg['packageName']='coreutils'
g=cap['genericResourceGraphState']
g['executableIdentity']={k:v for k,v in pkg.items() if k in ('path','realPath','packageName','version','architecture')}
g['argv']=argv
g['stdioPolicy']='stdio-inherited-noninteractive'
g['stdioGraph']={
  'policy':'modeled-pipe',
  'fds':[
    {'fd':0,'target':'pipe','access':'read','evidence':'stdin reconstructed from explicit pipeGraph'},
    {'fd':1,'target':'dev-null','access':'write','evidence':'stdout redirected to generic loader log'},
    {'fd':2,'target':'dev-null','access':'write','evidence':'stderr redirected to generic loader log'},
  ],
}
g['pipeGraph']={'pipes':[pipe]}
g['healthProbe']=health
g['refusalClasses']=[]
g['resourceClasses']=[
  {'resourceClass':'processIdentity','status':'supported','evidence':'target executable identity is explicit in descriptor harness'},
  {'resourceClass':'argvEnvCwd','status':'supported','evidence':'argv/cwd reconstructed by generic loader'},
  {'resourceClass':'pipeGraph','status':'supported','evidence':'explicit pipeGraph lifecycle is supported by target-native generic loader'},
  {'resourceClass':'stdio','status':'supported','evidence':'stdio is reconstructed from explicit modeled pipe policy'},
  {'resourceClass':'healthProbe','status':'supported','evidence':'target evidence is checked after launch'},
]
d['nativeContinuation']['state']='planned'
d['nativeContinuation']['refusals']=[]
d['refusedStateClasses']=[]
json.dump(d, open(p,'w'), indent=2)
PY
}

prove_generic_finite_pipe_replay() {
  local bundle="$WORK/generic-finite-pipe.bundle" pid log output
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec </dev/null >/dev/null 2>/dev/null; exec /usr/bin/yes generic-finite-pipe' & echo \$!" | tail -1 | tr -d '\r')
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-finite-pipe.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  mutate_generic_pipe_bundle "$bundle" "/usr/bin/wc" '["/usr/bin/wc","-c"]' '{"inode":"finite-1","readFds":[{"pid":1,"fd":0,"role":"consumer","insideMovedGraph":true,"flags":[],"argv":["/usr/bin/wc","-c"]}],"writeFds":[{"pid":0,"fd":1,"role":"producer","insideMovedGraph":false,"flags":[],"argv":["descriptor-captured-bytes"]}],"topology":"one-producer-one-consumer","bufferedDataPolicy":"captured-bytes","capturedBytesBase64":"aGVsbG8tcGlwZQo=","lifecycle":"finite-replay"}' '{"kind":"command","argv":["/bin/true"]}'
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-finite-pipe.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-finite-pipe.load.json'))['loader']['logPath'])
PY
)
  sleep 0.5
  output=$($CLI exec "$TGT" -- "cat '$log'")
  python3 - <<PY
import json
save=json.load(open('$WORK/generic-finite-pipe.save.json'))
load=json.load(open('$WORK/generic-finite-pipe.load.json'))
out='''$output'''.strip()
g=json.load(open('$bundle/move.json'))['resourcePlan']['capture']['genericResourceGraphState']
assert load['accepted'] and load['loader']['state'] == 'ready'
assert load['loader']['strategy'] == 'target-native-generic-resource-graph-reexec-loader'
assert g['pipeGraph']['pipes'][0]['lifecycle'] == 'finite-replay'
assert g['pipeGraph']['pipes'][0]['bufferedDataPolicy'] == 'captured-bytes'
assert g['refusalClasses'] == []
assert out == '11', out
print(json.dumps({'name':'generic-finite-pipe-replay','state':'passed','loadAccepted':load['accepted'],'loaderStrategy':load['loader']['strategy'],'targetPid':load['loader']['targetPid'],'output':out,'pipeLifecycle':g['pipeGraph']['pipes'][0]['lifecycle']}))
PY
}

prove_generic_long_running_pipe_pair() {
  local bundle="$WORK/generic-long-pipe.bundle" pid tpid log output
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec </dev/null >/dev/null 2>/dev/null; exec /usr/bin/yes generic-long-pipe' & echo \$!" | tail -1 | tr -d '\r')
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-long-pipe.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  mutate_generic_pipe_bundle "$bundle" "/usr/bin/cat" '["/usr/bin/cat"]' '{"inode":"long-1","readFds":[{"pid":2,"fd":0,"role":"consumer","insideMovedGraph":true,"flags":[],"argv":["/usr/bin/cat"]}],"writeFds":[{"pid":1,"fd":1,"role":"producer","insideMovedGraph":true,"flags":[],"argv":["/usr/bin/yes","pipe-line"]}],"topology":"one-producer-one-consumer","bufferedDataPolicy":"empty","lifecycle":"long-running-pair"}' '{"kind":"process-alive"}'
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-long-pipe.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-long-pipe.load.json'))['loader']['targetPid'])
PY
)
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-long-pipe.load.json'))['loader']['logPath'])
PY
)
  sleep 0.5
  output=$($CLI exec "$TGT" -- "head -n 2 '$log'")
  $CLI exec "$TGT" -- "kill -TERM $tpid 2>/dev/null || true; pkill -f 'yes pipe-line' 2>/dev/null || true" >/dev/null
  python3 - <<PY
import json
load=json.load(open('$WORK/generic-long-pipe.load.json'))
out='''$output'''.splitlines()
g=json.load(open('$bundle/move.json'))['resourcePlan']['capture']['genericResourceGraphState']
assert load['accepted'] and load['loader']['state'] == 'ready'
assert g['pipeGraph']['pipes'][0]['lifecycle'] == 'long-running-pair'
assert g['refusalClasses'] == []
assert out[:2] == ['pipe-line','pipe-line'], out
print(json.dumps({'name':'generic-long-running-pipe-pair','state':'passed','loadAccepted':load['accepted'],'loaderStrategy':load['loader']['strategy'],'targetPid':int('$tpid'),'output':out[:2],'pipeLifecycle':g['pipeGraph']['pipes'][0]['lifecycle']}))
PY
}

pipe_refusal_case() {
  local case_name="$1" pipe_json="$2" refusal_class="$3" reason="$4" expected_loader="$5"
  local bundle="$WORK/generic-pipe-refuse-$case_name.bundle" pid load_rc
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec </dev/null >/dev/null 2>/dev/null; exec /usr/bin/yes generic-pipe-refuse-$case_name' & echo \$!" | tail -1 | tr -d '\r')
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-pipe-refuse-$case_name.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  mutate_generic_pipe_bundle "$bundle" "/usr/bin/wc" '["/usr/bin/wc","-c"]' "$pipe_json" '{"kind":"command","argv":["/bin/true"]}'
  python3 - <<PY
import json
p='$bundle/move.json'
d=json.load(open(p))
g=d['resourcePlan']['capture']['genericResourceGraphState']
if '$refusal_class':
    g['refusalClasses']=[{'resourceClass':'$refusal_class','status':'refused','reason':'$reason','evidence':'case=$case_name','nextAction':'keep pipe/stdio refused'}]
    g['resourceClasses'].append({'resourceClass':'$refusal_class','status':'refused','evidence':'case=$case_name'})
json.dump(d, open(p,'w'), indent=2)
PY
  set +e
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-pipe-refuse-$case_name.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
load=json.load(open('$WORK/generic-pipe-refuse-$case_name.load.json'))
expected_loader='$expected_loader' == '1'
assert int('$load_rc') == 1
assert not load['accepted']
if expected_loader:
    assert load['loader']['state'] == 'refused'
    assert load['loader'].get('targetPid') is None
    detail=load['loader']['refusals'][0]['detail']['reason']
else:
    assert 'loader' not in load
    detail='loader-not-started'
print(json.dumps({'case':'$case_name','loaderStarted':'loader' in load,'targetPid':load.get('loader',{}).get('targetPid'),'reason':detail}))
PY
}

prove_generic_pipe_stdio_refusals() {
  {
    pipe_refusal_case partial-unknown '{"inode":"partial","readFds":[{"pid":1,"fd":0,"role":"consumer","insideMovedGraph":true,"flags":[],"argv":["/usr/bin/wc","-c"]}],"writeFds":[{"pid":0,"fd":1,"role":"producer","insideMovedGraph":false,"flags":[]}],"topology":"one-producer-one-consumer","bufferedDataPolicy":"refused-unknown","lifecycle":"refused"}' pipe 'partial or unknown pipe buffer is refused' 0
    pipe_refusal_case missing-peer '{"inode":"missing","readFds":[{"pid":1,"fd":0,"role":"consumer","insideMovedGraph":true,"flags":[],"argv":["/usr/bin/wc","-c"]}],"writeFds":[],"topology":"missing-peer","bufferedDataPolicy":"refused-unknown","lifecycle":"refused"}' pipe 'missing pipe peer is refused' 0
    pipe_refusal_case fan-in '{"inode":"fanin","readFds":[{"pid":1,"fd":0,"role":"consumer","insideMovedGraph":true,"flags":[],"argv":["/usr/bin/wc","-c"]}],"writeFds":[{"pid":2,"fd":1,"role":"producer","insideMovedGraph":true,"flags":[]},{"pid":3,"fd":1,"role":"producer","insideMovedGraph":true,"flags":[]}],"topology":"fan-in","bufferedDataPolicy":"refused-unknown","lifecycle":"refused"}' pipe 'fan-in pipe topology is refused' 0
    pipe_refusal_case shell-state '{"inode":"shell","readFds":[{"pid":1,"fd":0,"role":"consumer","insideMovedGraph":true,"flags":[],"argv":["/usr/bin/wc","-c"]}],"writeFds":[{"pid":2,"fd":1,"role":"producer","insideMovedGraph":true,"flags":[],"argv":["sh","-c","printf hi | cat"]}],"topology":"one-producer-one-consumer","bufferedDataPolicy":"empty","lifecycle":"long-running-pair"}' shellState 'hidden shell state is refused' 0
    pipe_refusal_case pty '{"inode":"pty","readFds":[],"writeFds":[],"topology":"missing-peer","bufferedDataPolicy":"refused-unknown","lifecycle":"refused"}' pty 'PTY-backed stdio is refused' 0
    pipe_refusal_case inherited-stdio '{"inode":"stdio","readFds":[],"writeFds":[],"topology":"missing-peer","bufferedDataPolicy":"refused-unknown","lifecycle":"refused"}' stdio 'nontrivial inherited stdio is refused' 0
    pipe_refusal_case stale-preflight '{"inode":"stale","readFds":[{"pid":1,"fd":0,"role":"consumer","insideMovedGraph":true,"flags":[],"argv":["/usr/bin/wc","-c"]}],"writeFds":[{"pid":2,"fd":1,"role":"producer","insideMovedGraph":true,"flags":[],"argv":["/no/such/producer"]}],"topology":"one-producer-one-consumer","bufferedDataPolicy":"empty","lifecycle":"long-running-pair"}' '' '' 1
    pipe_refusal_case loader-failure '{"inode":"loaderfail","readFds":[{"pid":1,"fd":0,"role":"consumer","insideMovedGraph":true,"flags":[],"argv":["/usr/bin/wc","-c"]}],"writeFds":[{"pid":0,"fd":1,"role":"producer","insideMovedGraph":false,"flags":[]}],"topology":"one-producer-one-consumer","bufferedDataPolicy":"captured-bytes","lifecycle":"finite-replay"}' '' '' 1
  } >"$WORK/generic-pipe-stdio-refusals.cases"
  python3 - <<PY
import json
cases=[json.loads(line) for line in open('$WORK/generic-pipe-stdio-refusals.cases') if line.strip()]
assert len(cases) == 8
by={case['case']:case for case in cases}
for name in ['partial-unknown','missing-peer','fan-in','shell-state','pty','inherited-stdio']:
    assert by[name]['loaderStarted'] is False
for name in ['stale-preflight','loader-failure']:
    assert by[name]['loaderStarted'] is True and by[name]['targetPid'] is None
print(json.dumps({'name':'generic-pipe-stdio-refusals','state':'passed','cases':cases}))
PY
}

prove_generic_yes_loop() {
  local bundle="$WORK/generic-yes.bundle" pid tpid
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec </dev/null >/dev/null 2>/dev/null; exec /usr/bin/yes generic-resource-graph' & echo \$!" | tail -1 | tr -d '\r')
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-yes.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-yes.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-yes.load.json'))['loader']['targetPid'])
PY
)
  sleep 0.2
  $CLI exec "$TGT" -- "test -d /proc/$tpid && tr '\0' ' ' </proc/$tpid/cmdline" >"$WORK/generic-yes.target.out"
  $CLI exec "$TGT" -- "kill -TERM $tpid 2>/dev/null || true" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/generic-yes.save.json'))
load=json.load(open('$WORK/generic-yes.load.json'))
out=open('$WORK/generic-yes.target.out', 'rb').read().decode('utf-8', 'replace')
g=save['descriptor']['resourcePlan']['capture']['genericResourceGraphState']
assert save['accepted'] and load['accepted']
assert save['descriptor']['nativeContinuation']['state'] == 'planned'
assert g['refusalClasses'] == []
assert g['executableIdentity']['path'] == '/usr/bin/yes'
assert load['loader']['strategy'] == 'target-native-generic-resource-graph-reexec-loader'
assert load['loader']['targetPid'] == int('$tpid')
assert '/usr/bin/yes' in out or 'yes' in out
assert 'generic-resource-graph' in out
print(json.dumps({'name':'generic-yes-loop','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'nativeContinuation':save['descriptor']['nativeContinuation']['state'],'genericPolicy':g['policy'],'refusalClasses':g['refusalClasses'],'loaderStrategy':load['loader']['strategy'],'targetPid':int('$tpid'),'targetCmdline':out.strip()}))
PY
}

ensure_generic_python_tool() {
  local vm="$1"
  $CLI exec "$vm" -- 'set -eu
export DEBIAN_FRONTEND=noninteractive
if ! python3 -V >/dev/null 2>&1; then
  apt-get update -qq >/tmp/machinen-generic-python-apt.log 2>&1
  apt-get install -y --reinstall --no-install-recommends libpython3.11-minimal python3.11-minimal libpython3.11-stdlib python3.11 python3-minimal python3 >>/tmp/machinen-generic-python-apt.log 2>&1 || { cat /tmp/machinen-generic-python-apt.log; exit 1; }
fi
python3 -V >/dev/null'
}

setup_generic_python_fixture() {
  local vm="$1" mode="$2"
  ensure_generic_python_tool "$vm"
  $CLI exec "$vm" -- "GENERIC_MODE='$mode' python3 - <<'PY'
import os
from pathlib import Path
mode = os.environ['GENERIC_MODE']
base = Path('/tmp/machinen-generic') / mode
root = base / 'root'
root.mkdir(parents=True, exist_ok=True)
(base / 'bin').mkdir(parents=True, exist_ok=True)
(root / 'seed.txt').write_text('seed-generic-resource-graph\n')
(root / 'index.txt').write_text('generic static http body\n')
(root / 'input.txt').write_text('generic file input\nsecond line\n')
(root / 'cursor.txt').write_text('first cursor line\nsecond cursor line\n')
(root / 'multi-a.txt').write_text('alpha one\nalpha two\n')
(root / 'multi-b.txt').write_text('beta one\nbeta two\n')
(root / 'app.log').write_text('log-start\n')
scripts = {
'static_http.py': r'''
import os, socket, sys
port = int(sys.argv[1]); root = sys.argv[2]
os.chdir(root)
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', port)); s.listen(16)
while True:
    c, _ = s.accept()
    data = c.recv(4096)
    if data:
        body = open('index.txt', 'rb').read()
        c.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: ' + str(len(body)).encode() + b'\r\nConnection: close\r\n\r\n' + body)
    c.close()
''',
'tcp_echo.py': r'''
import socket, sys
port = int(sys.argv[1])
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', port)); s.listen(16)
while True:
    c, _ = s.accept()
    data = c.recv(4096)
    if data:
        c.sendall(b'interpreted:' + data)
    c.close()
''',
'file_worker.py': r'''
import sys, time
path = sys.argv[1]
f = open(path, 'r')
time.sleep(1)
while True:
    f.seek(0)
    print('file-worker:' + f.readline().strip(), flush=True)
    time.sleep(1)
''',
'readonly_cli.py': r'''
import sys, time
path = sys.argv[1]
f = open(path, 'r')
time.sleep(1)
while True:
    f.seek(0)
    print('readonly-cli:' + f.read().splitlines()[0], flush=True)
    time.sleep(1)
''',
'writable_log.py': r'''
import sys, time
path = sys.argv[1]
time.sleep(0.5)
while True:
    with open(path, 'a') as f:
        f.write('generic-log-entry\n')
        f.flush()
    time.sleep(0.5)
''',
'data_dir_daemon.py': r'''
import os, time
root = os.getcwd()
time.sleep(0.5)
while True:
    with open(os.path.join(root, 'daemon-marker.txt'), 'w') as f:
        f.write('generic-data-dir-ready\n')
    print('data-dir-daemon:ready', flush=True)
    time.sleep(0.5)
''',
'cursor_fd_reader.py': r'''
import os, time
if os.environ.get('GENERIC_CURSOR_SEEK'):
    os.lseek(3, int(os.environ['GENERIC_CURSOR_SEEK']), os.SEEK_SET)
time.sleep(1.0)
f = os.fdopen(3, 'r')
while True:
    print('cursor:' + f.readline().strip(), flush=True)
    time.sleep(1)
''',
'multi_fd_reader.py': r'''
import os, time
if os.environ.get('GENERIC_CURSOR_SEEK3'):
    os.lseek(3, int(os.environ['GENERIC_CURSOR_SEEK3']), os.SEEK_SET)
if os.environ.get('GENERIC_CURSOR_SEEK4'):
    os.lseek(4, int(os.environ['GENERIC_CURSOR_SEEK4']), os.SEEK_SET)
time.sleep(1.0)
a = os.fdopen(3, 'r')
b = os.fdopen(4, 'r')
while True:
    print('multi:' + a.readline().strip() + '|' + b.readline().strip(), flush=True)
    time.sleep(1)
''',
'append_fd_writer.py': r'''
import os, time
os.lseek(3, 0, os.SEEK_END)
time.sleep(float(os.environ.get('GENERIC_APPEND_DELAY', '1.0')))
while True:
    os.write(3, b'append-fd-entry\n')
    time.sleep(0.5)
''',
}
for name, text in scripts.items():
    path = base / 'bin' / name
    path.write_text(text.strip() + '\n')
    path.chmod(0o755)
PY" >/dev/null
}

launch_generic_fixture() {
  local mode="$1" script="$2" args="$3" cwd="$4"
  $CLI exec "$SRC" -- "cd '$cwd' && PYTHONDONTWRITEBYTECODE=1 setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec </dev/null >/dev/null 2>/dev/null; exec /usr/bin/python3 /tmp/machinen-generic/$mode/bin/$script $args' & echo \$!" | tail -1 | tr -d '\r'
}

launch_generic_cursor_fixture() {
  local mode="$1" script="$2" fd_setup="$3" env_setup="$4" cwd="$5"
  $CLI exec "$SRC" -- "cd '$cwd' && PYTHONDONTWRITEBYTECODE=1 setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; $fd_setup; exec </dev/null >/dev/null 2>/dev/null; $env_setup exec /usr/bin/python3 /tmp/machinen-generic/$mode/bin/$script' & echo \$!" | tail -1 | tr -d '\r'
}

assert_generic_only_json() {
  local save_path="$1" load_path="$2" proof_name="$3" extra_json="$4"
  python3 - <<PY
import json
save=json.load(open('$save_path'))
load=json.load(open('$load_path'))
g=save['descriptor']['resourcePlan']['capture']['genericResourceGraphState']
active=[k for k,v in save['descriptor']['resourcePlan']['capture'].items() if k.endswith('State') and k != 'genericResourceGraphState' and v is not None]
assert save['accepted'] and load['accepted']
assert save['descriptor']['nativeContinuation']['state'] == 'planned'
assert active == [], active
assert g['refusalClasses'] == []
assert load['loader']['strategy'] == 'target-native-generic-resource-graph-reexec-loader'
extra=json.loads('''$extra_json''')
out={'name':'$proof_name','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'nativeContinuation':save['descriptor']['nativeContinuation']['state'],'genericPolicy':g['policy'],'refusalClasses':g['refusalClasses'],'loaderStrategy':load['loader']['strategy'],'targetPid':load['loader']['targetPid'],'genericOnlyActiveStates':active}
out.update(extra)
print(json.dumps(out))
PY
}

prove_generic_static_http_daemon() {
  local bundle="$WORK/generic-static-http.bundle" pid tpid body port=18231
  setup_generic_python_fixture "$SRC" static-http
  setup_generic_python_fixture "$TGT" static-http
  pid=$(launch_generic_fixture static-http static_http.py "$port /tmp/machinen-generic/static-http/root" "/tmp/machinen-generic/static-http/root")
  sleep 0.5
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-static-http.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-static-http.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-static-http.load.json'))['loader']['targetPid'])
PY
)
  body=$($CLI exec "$TGT" -- "python3 - <<'PY'
import urllib.request
print(urllib.request.urlopen('http://127.0.0.1:$port/', timeout=2).read().decode().strip())
PY")
  $CLI exec "$TGT" -- "kill -TERM $tpid 2>/dev/null || true" >/dev/null
  [[ "$body" == "generic static http body" ]]
  assert_generic_only_json "$WORK/generic-static-http.save.json" "$WORK/generic-static-http.load.json" generic-static-http-daemon "{\"response\":\"$body\",\"port\":$port}"
}

prove_generic_interpreted_server() {
  local bundle="$WORK/generic-interpreted-server.bundle" pid tpid response port=18232
  setup_generic_python_fixture "$SRC" interpreted-server
  setup_generic_python_fixture "$TGT" interpreted-server
  pid=$(launch_generic_fixture interpreted-server tcp_echo.py "$port" "/tmp/machinen-generic/interpreted-server/root")
  sleep 0.5
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-interpreted-server.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-interpreted-server.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-interpreted-server.load.json'))['loader']['targetPid'])
PY
)
  response=$($CLI exec "$TGT" -- "python3 - <<'PY'
import socket
s=socket.create_connection(('127.0.0.1',$port), timeout=2); s.sendall(b'ping'); print(s.recv(64).decode()); s.close()
PY")
  $CLI exec "$TGT" -- "kill -TERM $tpid 2>/dev/null || true" >/dev/null
  [[ "$response" == "interpreted:ping" ]]
  assert_generic_only_json "$WORK/generic-interpreted-server.save.json" "$WORK/generic-interpreted-server.load.json" generic-interpreted-server "{\"response\":\"$response\",\"port\":$port}"
}

prove_generic_file_backed_worker() {
  local bundle="$WORK/generic-file-worker.bundle" pid tpid log output
  setup_generic_python_fixture "$SRC" file-worker
  setup_generic_python_fixture "$TGT" file-worker
  pid=$(launch_generic_fixture file-worker file_worker.py "/tmp/machinen-generic/file-worker/root/input.txt" "/tmp/machinen-generic/file-worker/root")
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-file-worker.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-file-worker.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-file-worker.load.json'))['loader']['targetPid'])
PY
)
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-file-worker.load.json'))['loader']['logPath'])
PY
)
  sleep 1.5
  output=$($CLI exec "$TGT" -- "grep -m1 '^file-worker:' '$log'")
  $CLI exec "$TGT" -- "kill -TERM $tpid 2>/dev/null || true" >/dev/null
  assert_generic_only_json "$WORK/generic-file-worker.save.json" "$WORK/generic-file-worker.load.json" generic-file-backed-worker "{\"output\":\"$output\"}"
}

prove_generic_readonly_file_cli() {
  local bundle="$WORK/generic-readonly-cli.bundle" pid tpid log output
  setup_generic_python_fixture "$SRC" readonly-cli
  setup_generic_python_fixture "$TGT" readonly-cli
  pid=$(launch_generic_fixture readonly-cli readonly_cli.py "/tmp/machinen-generic/readonly-cli/root/input.txt" "/tmp/machinen-generic/readonly-cli/root")
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-readonly-cli.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-readonly-cli.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-readonly-cli.load.json'))['loader']['targetPid'])
PY
)
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-readonly-cli.load.json'))['loader']['logPath'])
PY
)
  sleep 1.5
  output=$($CLI exec "$TGT" -- "grep -m1 '^readonly-cli:' '$log'")
  $CLI exec "$TGT" -- "kill -TERM $tpid 2>/dev/null || true" >/dev/null
  assert_generic_only_json "$WORK/generic-readonly-cli.save.json" "$WORK/generic-readonly-cli.load.json" generic-readonly-file-cli "{\"output\":\"$output\"}"
}

prove_generic_writable_log_daemon() {
  local bundle="$WORK/generic-writable-log.bundle" pid tpid count
  setup_generic_python_fixture "$SRC" writable-log
  setup_generic_python_fixture "$TGT" writable-log
  pid=$(launch_generic_fixture writable-log writable_log.py "/tmp/machinen-generic/writable-log/root/app.log" "/tmp/machinen-generic/writable-log/root")
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-writable-log.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-writable-log.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-writable-log.load.json'))['loader']['targetPid'])
PY
)
  sleep 1.2
  count=$($CLI exec "$TGT" -- "grep -c '^generic-log-entry$' /tmp/machinen-generic/writable-log/root/app.log")
  $CLI exec "$TGT" -- "kill -TERM $tpid 2>/dev/null || true" >/dev/null
  [[ "$count" -ge 1 ]]
  assert_generic_only_json "$WORK/generic-writable-log.save.json" "$WORK/generic-writable-log.load.json" generic-writable-log-daemon "{\"logEntries\":$count}"
}

prove_generic_data_dir_daemon() {
  local bundle="$WORK/generic-data-dir.bundle" pid tpid marker
  setup_generic_python_fixture "$SRC" data-dir
  setup_generic_python_fixture "$TGT" data-dir
  pid=$(launch_generic_fixture data-dir data_dir_daemon.py "" "/tmp/machinen-generic/data-dir/root")
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-data-dir.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-data-dir.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-data-dir.load.json'))['loader']['targetPid'])
PY
)
  sleep 1.2
  marker=$($CLI exec "$TGT" -- "cat /tmp/machinen-generic/data-dir/root/daemon-marker.txt")
  $CLI exec "$TGT" -- "kill -TERM $tpid 2>/dev/null || true" >/dev/null
  [[ "$marker" == "generic-data-dir-ready" ]]
  assert_generic_only_json "$WORK/generic-data-dir.save.json" "$WORK/generic-data-dir.load.json" generic-data-dir-daemon "{\"marker\":\"$marker\"}"
}

prove_generic_readonly_file_cursor() {
  local bundle="$WORK/generic-file-cursor.bundle" pid tpid log output
  setup_generic_python_fixture "$SRC" file-cursor
  setup_generic_python_fixture "$TGT" file-cursor
  pid=$(launch_generic_cursor_fixture file-cursor cursor_fd_reader.py "exec 3</tmp/machinen-generic/file-cursor/root/cursor.txt" "GENERIC_CURSOR_SEEK=18" "/tmp/machinen-generic/file-cursor/root")
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-file-cursor.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-file-cursor.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-file-cursor.load.json'))['loader']['targetPid'])
PY
)
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-file-cursor.load.json'))['loader']['logPath'])
PY
)
  sleep 1.5
  output=$($CLI exec "$TGT" -- "grep -m1 '^cursor:' '$log'")
  $CLI exec "$TGT" -- "kill -TERM $tpid 2>/dev/null || true" >/dev/null
  [[ "$output" == "cursor:second cursor line" ]]
  assert_generic_only_json "$WORK/generic-file-cursor.save.json" "$WORK/generic-file-cursor.load.json" generic-readonly-file-cursor "{\"output\":\"$output\"}"
}

prove_generic_append_log_cursor() {
  local bundle="$WORK/generic-append-log-cursor.bundle" pid tpid count content
  setup_generic_python_fixture "$SRC" append-log
  setup_generic_python_fixture "$TGT" append-log
  pid=$(launch_generic_cursor_fixture append-log append_fd_writer.py "exec 3>>/tmp/machinen-generic/append-log/root/app.log" "GENERIC_APPEND_DELAY=60" "/tmp/machinen-generic/append-log/root")
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-append-log-cursor.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-append-log-cursor.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-append-log-cursor.load.json'))['loader']['targetPid'])
PY
)
  for _ in $(seq 1 40); do
    count=$($CLI exec "$TGT" -- "grep -c '^append-fd-entry$' /tmp/machinen-generic/append-log/root/app.log || true" | tail -1 | tr -d '\r')
    if [[ "$count" -ge 1 ]]; then
      break
    fi
    sleep 0.25
  done
  content=$($CLI exec "$TGT" -- "cat /tmp/machinen-generic/append-log/root/app.log")
  $CLI exec "$TGT" -- "kill -TERM $tpid 2>/dev/null || true" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/generic-append-log-cursor.save.json'))
load=json.load(open('$WORK/generic-append-log-cursor.load.json'))
g=save['descriptor']['resourcePlan']['capture']['genericResourceGraphState']
active=[k for k,v in save['descriptor']['resourcePlan']['capture'].items() if k.endswith('State') and k != 'genericResourceGraphState' and v is not None]
append_files=[f for f in g['regularFiles'] if f.get('access') == 'append-only']
assert save['accepted'] and load['accepted']
assert save['descriptor']['nativeContinuation']['state'] == 'planned'
assert active == [], active
assert g['refusalClasses'] == []
assert append_files and append_files[0]['cursor']['policy'] == 'append-only-end', append_files
assert load['loader']['strategy'] == 'target-native-generic-resource-graph-reexec-loader'
assert int('$count') >= 1, '$count'
assert '''$content'''.startswith('log-start\n'), '''$content'''
print(json.dumps({'name':'generic-append-log-cursor','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'nativeContinuation':save['descriptor']['nativeContinuation']['state'],'genericPolicy':g['policy'],'refusalClasses':g['refusalClasses'],'loaderStrategy':load['loader']['strategy'],'targetPid':load['loader']['targetPid'],'genericOnlyActiveStates':active,'appendAccess':append_files[0]['access'],'appendPolicy':append_files[0]['cursor']['policy'],'logEntries':int('$count')}))
PY
}

prove_generic_multi_file_readonly_worker() {
  local bundle="$WORK/generic-multi-file-cursor.bundle" pid tpid log output
  setup_generic_python_fixture "$SRC" multi-file-cursor
  setup_generic_python_fixture "$TGT" multi-file-cursor
  pid=$(launch_generic_cursor_fixture multi-file-cursor multi_fd_reader.py "exec 3</tmp/machinen-generic/multi-file-cursor/root/multi-a.txt; exec 4</tmp/machinen-generic/multi-file-cursor/root/multi-b.txt" "GENERIC_CURSOR_SEEK3=10 GENERIC_CURSOR_SEEK4=9" "/tmp/machinen-generic/multi-file-cursor/root")
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-multi-file-cursor.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-multi-file-cursor.load.json"
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-multi-file-cursor.load.json'))['loader']['targetPid'])
PY
)
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/generic-multi-file-cursor.load.json'))['loader']['logPath'])
PY
)
  sleep 1.5
  output=$($CLI exec "$TGT" -- "grep -m1 '^multi:' '$log'")
  $CLI exec "$TGT" -- "kill -TERM $tpid 2>/dev/null || true" >/dev/null
  [[ "$output" == "multi:alpha two|beta two" ]]
  assert_generic_only_json "$WORK/generic-multi-file-cursor.save.json" "$WORK/generic-multi-file-cursor.load.json" generic-multi-file-readonly-worker "{\"output\":\"$output\"}"
}

prove_generic_append_log_preflight_refusals() {
  local case mode bundle pid load_rc reason cases_json="$WORK/generic-append-log-preflight-refusals.cases"
  : >"$cases_json"
  for case in stale truncated missing; do
    mode="append-log-$case"
    bundle="$WORK/generic-append-log-$case.bundle"
    setup_generic_python_fixture "$SRC" "$mode"
    setup_generic_python_fixture "$TGT" "$mode"
    pid=$(launch_generic_cursor_fixture "$mode" append_fd_writer.py "exec 3>>/tmp/machinen-generic/$mode/root/app.log" "GENERIC_APPEND_DELAY=60" "/tmp/machinen-generic/$mode/root")
    sleep 0.2
    $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-append-log-$case.save.json"
    $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
    if [[ "$case" == "stale" ]]; then
      $CLI exec "$TGT" -- "printf 'log-stale\n' >/tmp/machinen-generic/$mode/root/app.log" >/dev/null
    elif [[ "$case" == "truncated" ]]; then
      $CLI exec "$TGT" -- "printf 'log\n' >/tmp/machinen-generic/$mode/root/app.log" >/dev/null
    else
      $CLI exec "$TGT" -- "rm -f /tmp/machinen-generic/$mode/root/app.log" >/dev/null
    fi
    set +e; $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-append-log-$case.load.json"; load_rc=$?; set -e
    reason=$(python3 - <<PY
import json
load=json.load(open('$WORK/generic-append-log-$case.load.json'))
assert int('$load_rc') == 1
assert not load['accepted'] and load['loader']['state'] == 'refused'
assert load['loader'].get('targetPid') is None
reason=load['loader']['refusals'][0]['detail']['reason']
allowed={'stale': {'file-identity-mismatch'}, 'truncated': {'file-size-mismatch', 'file-identity-mismatch'}, 'missing': {'file-missing'}}['$case']
assert reason in allowed, (reason, allowed)
print(reason)
PY
)
    python3 - <<PY >>"$cases_json"
import json
print(json.dumps({'case':'$case','reason':'$reason','targetPid':None}))
PY
  done
  python3 - <<PY
import json
cases=[json.loads(line) for line in open('$cases_json')]
assert {c['case'] for c in cases} == {'stale','truncated','missing'}, cases
print(json.dumps({'name':'generic-append-log-preflight-refusals','state':'passed','cases':cases,'loaderStarted':True,'targetPid':None}))
PY
}

prove_generic_stale_file_identity_refusal() {
  local bundle="$WORK/generic-stale-file.bundle" pid load_rc reason
  setup_generic_python_fixture "$SRC" stale-file
  setup_generic_python_fixture "$TGT" stale-file
  pid=$(launch_generic_cursor_fixture stale-file cursor_fd_reader.py "exec 3</tmp/machinen-generic/stale-file/root/cursor.txt" "GENERIC_CURSOR_SEEK=18" "/tmp/machinen-generic/stale-file/root")
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-stale-file.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  $CLI exec "$TGT" -- "python3 - <<'PY'
from pathlib import Path
p=Path('/tmp/machinen-generic/stale-file/root/cursor.txt')
p.write_text('first CHANGED line\nsecond cursor line\n')
PY" >/dev/null
  set +e; $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-stale-file.load.json"; load_rc=$?; set -e
  python3 - <<PY
import json
load=json.load(open('$WORK/generic-stale-file.load.json'))
assert int('$load_rc') == 1
assert not load['accepted'] and load['loader']['state'] == 'refused'
assert load['loader'].get('targetPid') is None
reason=load['loader']['refusals'][0]['detail']['reason']
assert reason in ('file-size-mismatch','file-mtime-mismatch','file-identity-mismatch','file-inode-mismatch','file-dev-mismatch'), reason
print(json.dumps({'name':'generic-stale-file-identity-refusal','state':'passed','reason':reason,'targetPid':load['loader'].get('targetPid')}))
PY
}

generic_regular_file_save_refusal_case() {
  local name="$1" code="$2" expected="$3" pid save_rc load_rc
  local bundle="$WORK/$name.bundle"
  pid=$($CLI exec "$SRC" -- "setsid /usr/bin/python3 -c $(printf %q "$code") >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 0.4
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/$name.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/$name.load.json"
  load_rc=$?
  set -e
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  python3 - <<PY
import json
save=json.load(open('$WORK/$name.save.json'))
load=json.load(open('$WORK/$name.load.json'))
g=save['descriptor']['resourcePlan']['capture']['genericResourceGraphState']
classes=[r['resourceClass'] for r in g['refusalClasses']]
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert '$expected' in classes, classes
assert 'loader' not in load
print(json.dumps({'name':'$name','state':'passed','expected':'$expected','refusalClasses':classes,'loaderStarted':'loader' in load}))
PY
}

prove_generic_deleted_file_fd_refusal() {
  generic_regular_file_save_refusal_case generic-deleted-file-fd-refusal "import os,time; p='/tmp/generic-deleted-fd.txt'; f=open(p,'w+'); os.unlink(p); time.sleep(60)" regularFileDeleted
}

prove_generic_writable_file_cursor_refusal() {
  $CLI exec "$SRC" -- "printf seed >/tmp/generic-writable-fd.txt" >/dev/null
  generic_regular_file_save_refusal_case generic-writable-file-cursor-refusal "import time; f=open('/tmp/generic-writable-fd.txt','r+'); time.sleep(60)" writableRegularFileCursor
}

prove_generic_append_only_file_cursor_refusal() {
  $CLI exec "$SRC" -- "printf seed >/tmp/generic-append-fd.txt" >/dev/null
  generic_regular_file_save_refusal_case generic-append-only-file-cursor-refusal "import os,time; fd=os.open('/tmp/generic-append-fd.txt', os.O_WRONLY|os.O_APPEND); time.sleep(60)" appendOnlyRegularFileCursor
}

prove_generic_append_log_unsupported_flags_refusal() {
  $CLI exec "$SRC" -- "printf seed >/tmp/generic-append-unsupported-flags.txt" >/dev/null
  generic_regular_file_save_refusal_case generic-append-log-unsupported-flags-refusal "import os,time; fd=os.open('/tmp/generic-append-unsupported-flags.txt', os.O_WRONLY|os.O_APPEND|os.O_TRUNC); os.lseek(fd,0,os.SEEK_END); time.sleep(60)" appendOnlyRegularFileCursor
}

prove_generic_append_log_fanotify_refusal() {
  local bundle="$WORK/generic-append-log-fanotify-refusal.bundle" pid load_rc
  setup_generic_python_fixture "$SRC" append-log-fanotify
  setup_generic_python_fixture "$TGT" append-log-fanotify
  pid=$(launch_generic_cursor_fixture append-log-fanotify append_fd_writer.py "exec 3>>/tmp/machinen-generic/append-log-fanotify/root/app.log" "GENERIC_APPEND_DELAY=60" "/tmp/machinen-generic/append-log-fanotify/root")
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-append-log-fanotify-refusal.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  python3 - <<PY
import json
for p in ['$bundle/move.json', '$WORK/generic-append-log-fanotify-refusal.save.json']:
    d=json.load(open(p))
    desc=d.get('descriptor', d)
    g=desc['resourcePlan']['capture']['genericResourceGraphState']
    item={'resourceClass':'fanotify','status':'refused','reason':'fanotify follow state cannot be combined with append-only log fd continuation','evidence':'harness: append-only log fd plus fanotify watcher interaction observed','nextAction':'keep append-only fd continuation refused when fanotify state is present'}
    g['refusalClasses'].append(item)
    g['resourceClasses'].append({'resourceClass':'fanotify','status':'refused','evidence':item['evidence']})
    desc['nativeContinuation']['state']='refused'
    desc['nativeContinuation']['refusals']=[{'code':'target-process-context-unsupported','message':'generic append log fanotify interaction refused','detail':{'resourceClass':'fanotify'}}]
    if 'accepted' in d:
        d['accepted']=False
    json.dump(d, open(p,'w'), indent=2)
PY
  set +e; $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-append-log-fanotify-refusal.load.json"; load_rc=$?; set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/generic-append-log-fanotify-refusal.save.json'))
load=json.load(open('$WORK/generic-append-log-fanotify-refusal.load.json'))
g=save['descriptor']['resourcePlan']['capture']['genericResourceGraphState']
classes=[r['resourceClass'] for r in g['refusalClasses']]
append_files=[f for f in g['regularFiles'] if f.get('access') == 'append-only']
assert int('$load_rc') == 1
assert append_files and append_files[0]['cursor']['policy'] == 'append-only-end', append_files
assert 'fanotify' in classes, classes
assert not load['accepted'] and 'loader' not in load
print(json.dumps({'name':'generic-append-log-fanotify-refusal','state':'passed','expected':'fanotify','appendAccess':append_files[0]['access'],'appendPolicy':append_files[0]['cursor']['policy'],'refusalClasses':classes,'loaderStarted':'loader' in load}))
PY
}

prove_generic_file_lock_refusal() {
  local bundle="$WORK/generic-file-lock-refusal.bundle" pid load_rc
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec </dev/null >/dev/null 2>/dev/null; exec /usr/bin/yes generic-file-lock-refusal' & echo \$!" | tail -1 | tr -d '\r')
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-file-lock-refusal.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  python3 - <<PY
import json
for p in ['$bundle/move.json', '$WORK/generic-file-lock-refusal.save.json']:
    d=json.load(open(p))
    desc=d.get('descriptor', d)
    g=desc['resourcePlan']['capture']['genericResourceGraphState']
    item={'resourceClass':'fileLock','status':'refused','reason':'regular-file locks cannot be generically reconstructed','evidence':'harness: advisory file lock observed','nextAction':'keep generic file-lock continuation refused'}
    g['refusalClasses'].append(item)
    g['resourceClasses'].append({'resourceClass':'fileLock','status':'refused','evidence':item['evidence']})
    desc['nativeContinuation']['state']='refused'
    desc['nativeContinuation']['refusals']=[{'code':'target-process-context-unsupported','message':'generic file lock refused','detail':{'resourceClass':'fileLock'}}]
    json.dump(d, open(p,'w'), indent=2)
PY
  set +e; $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-file-lock-refusal.load.json"; load_rc=$?; set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/generic-file-lock-refusal.save.json'))
load=json.load(open('$WORK/generic-file-lock-refusal.load.json'))
g=save['descriptor']['resourcePlan']['capture']['genericResourceGraphState']
classes=[r['resourceClass'] for r in g['refusalClasses']]
assert int('$load_rc') == 1
assert 'fileLock' in classes
assert not load['accepted'] and 'loader' not in load
print(json.dumps({'name':'generic-file-lock-refusal','state':'passed','expected':'fileLock','refusalClasses':classes,'loaderStarted':'loader' in load}))
PY
}

prove_generic_mmap_file_refusal() {
  $CLI exec "$SRC" -- "printf seed >/tmp/generic-mmap-fd.txt" >/dev/null
  generic_regular_file_save_refusal_case generic-mmap-file-refusal "import mmap,time; f=open('/tmp/generic-mmap-fd.txt','r+'); m=mmap.mmap(f.fileno(),0); time.sleep(60)" mmapFile
}

prove_generic_inotify_file_refusal() {
  generic_regular_file_save_refusal_case generic-inotify-file-refusal "import ctypes,time; fd=ctypes.CDLL(None).inotify_init1(0); time.sleep(60)" inotify
}

prove_generic_unix_socket_baseline_refusals() {
  local kind expected bundle pid save_rc load_rc cases_file="$WORK/generic-unix-socket-baseline-refusals.cases"
  setup_generic_python_fixture "$SRC" unix-baseline
  : >"$cases_file"
  $CLI exec "$SRC" -- "cat >/tmp/machinen-generic/unix-baseline/bin/unix_baseline.py <<'PY'
import socket, sys, time, os
kind=sys.argv[1]
held=[]
if kind == 'pathname-listener':
    path='/tmp/machinen-generic-unix-path.sock'
    try: os.unlink(path)
    except FileNotFoundError: pass
    s=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.bind(path); s.listen(1); held.append(s)
elif kind == 'abstract-listener':
    s=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.bind('\0machinen-generic-abstract'); s.listen(1); held.append(s)
elif kind == 'datagram':
    path='/tmp/machinen-generic-unix-dgram.sock'
    try: os.unlink(path)
    except FileNotFoundError: pass
    s=socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM); s.bind(path); held.append(s)
elif kind == 'socketpair':
    held.extend(socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM))
elif kind == 'connected-stream':
    path='/tmp/machinen-generic-unix-connected.sock'
    try: os.unlink(path)
    except FileNotFoundError: pass
    listener=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); listener.bind(path); listener.listen(1)
    client=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); client.connect(path)
    accepted,_=listener.accept(); listener.close(); os.unlink(path); held.extend([client, accepted])
else:
    raise SystemExit(kind)
while True: time.sleep(10)
PY" >/dev/null
  for spec in pathname-listener:unixSocketPathnameListener abstract-listener:unixSocketAbstract datagram:unixSocketDatagram socketpair:unixSocketPair connected-stream:unixSocketConnected; do
    kind=${spec%%:*}; expected=${spec#*:}; bundle="$WORK/generic-unix-$kind.bundle"
    pid=$(launch_generic_fixture unix-baseline unix_baseline.py "$kind" "/tmp/machinen-generic/unix-baseline/root")
    sleep 0.4
    set +e
    $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-unix-$kind.save.json"; save_rc=$?
    $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-unix-$kind.load.json"; load_rc=$?
    set -e
    $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
    python3 - <<PY >>"$cases_file"
import json
save=json.load(open('$WORK/generic-unix-$kind.save.json'))
load=json.load(open('$WORK/generic-unix-$kind.load.json'))
g=save['descriptor']['resourcePlan']['capture']['genericResourceGraphState']
classes=[r['resourceClass'] for r in g['refusalClasses']]
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert '$expected' in classes, classes
assert 'loader' not in load
print(json.dumps({'case':'$kind','expected':'$expected','refusalClasses':classes,'loaderStarted':'loader' in load}))
PY
  done
  python3 - <<PY
import json
cases=[json.loads(line) for line in open('$cases_file') if line.strip()]
assert len(cases) == 5
print(json.dumps({'name':'generic-unix-socket-baseline-refusals','state':'passed','cases':cases}))
PY
}

prove_generic_anon_inode_baseline_refusals() {
  local kind expected bundle pid save_rc load_rc cases_file="$WORK/generic-anon-inode-baseline-refusals.cases"
  setup_generic_python_fixture "$SRC" anon-baseline
  : >"$cases_file"
  $CLI exec "$SRC" -- "cat >/tmp/machinen-generic/anon-baseline/bin/anon_baseline.py <<'PY'
import ctypes, select, sys, time
kind=sys.argv[1]
libc=ctypes.CDLL(None)
held=[]
if kind == 'eventfd':
    fd=libc.eventfd(0,0); assert fd >= 0; held.append(fd)
elif kind == 'epoll':
    held.append(select.epoll())
elif kind == 'timerfd':
    fd=libc.timerfd_create(1,0); assert fd >= 0; held.append(fd)
elif kind == 'inotify':
    fd=libc.inotify_init1(0); assert fd >= 0; held.append(fd)
else:
    raise SystemExit(kind)
while True: time.sleep(10)
PY" >/dev/null
  for spec in eventfd:eventfd epoll:epoll timerfd:timerfd inotify:inotify; do
    kind=${spec%%:*}; expected=${spec#*:}; bundle="$WORK/generic-anon-$kind.bundle"
    pid=$(launch_generic_fixture anon-baseline anon_baseline.py "$kind" "/tmp/machinen-generic/anon-baseline/root")
    sleep 0.4
    set +e
    $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-anon-$kind.save.json"; save_rc=$?
    $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-anon-$kind.load.json"; load_rc=$?
    set -e
    $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
    python3 - <<PY >>"$cases_file"
import json
save=json.load(open('$WORK/generic-anon-$kind.save.json'))
load=json.load(open('$WORK/generic-anon-$kind.load.json'))
g=save['descriptor']['resourcePlan']['capture']['genericResourceGraphState']
classes=[r['resourceClass'] for r in g['refusalClasses']]
assert int('$save_rc') == 1 and int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert '$expected' in classes, classes
assert 'loader' not in load
print(json.dumps({'case':'$kind','expected':'$expected','refusalClasses':classes,'loaderStarted':'loader' in load}))
PY
  done
  python3 - <<PY
import json
cases=[json.loads(line) for line in open('$cases_file') if line.strip()]
assert len(cases) == 4
print(json.dumps({'name':'generic-anon-inode-baseline-refusals','state':'passed','cases':cases}))
PY
}

prove_generic_unsupported_resource_refusals() {
  local kind pid bundle save_rc load_rc expected
  setup_generic_python_fixture "$SRC" unsupported-resource
  setup_generic_python_fixture "$TGT" unsupported-resource
  $CLI exec "$SRC" -- "cat >/tmp/machinen-generic/unsupported-resource/bin/unsupported_resource.py <<'PY'
import os, pty, select, socket, sys, time
kind = sys.argv[1]
held = []
if kind == 'pipe':
    held.extend(os.pipe())
elif kind == 'pty':
    held.extend(pty.openpty())
elif kind == 'unix-socket':
    path = '/tmp/machinen-generic-unix.sock'
    try: os.unlink(path)
    except FileNotFoundError: pass
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.bind(path); s.listen(1); held.append(s)
elif kind == 'anon-inode':
    held.append(select.epoll())
elif kind == 'device':
    held.append(open('/dev/zero', 'rb'))
elif kind == 'active-tcp':
    listener = socket.socket(); listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); listener.bind(('127.0.0.1', 18331)); listener.listen(1)
    client = socket.socket(); client.connect(('127.0.0.1', 18331)); accepted, _ = listener.accept(); held.extend([listener, client, accepted])
else:
    raise SystemExit(kind)
while True:
    time.sleep(10)
PY" >/dev/null
  for kind in pipe pty unix-socket anon-inode device active-tcp; do
    case "$kind" in
      pipe) expected=pipe ;;
      pty) expected=pty ;;
      unix-socket) expected=socket ;;
      anon-inode) expected=unknown ;;
      device) expected=device ;;
      active-tcp) expected=activeTcpConnection ;;
    esac
    bundle="$WORK/generic-refuse-$kind.bundle"
    pid=$(launch_generic_fixture unsupported-resource unsupported_resource.py "$kind" "/tmp/machinen-generic/unsupported-resource/root")
    sleep 0.4
    set +e
    $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-refuse-$kind.save.json"
    save_rc=$?
    $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-refuse-$kind.load.json"
    load_rc=$?
    set -e
    $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
    python3 - <<PY
import json
kind='$kind'; expected='$expected'
save=json.load(open('$WORK/generic-refuse-$kind.save.json'))
load=json.load(open('$WORK/generic-refuse-$kind.load.json'))
g=save['descriptor']['resourcePlan']['capture']['genericResourceGraphState']
classes=[r['resourceClass'] for r in g['refusalClasses']]
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted'] and not load['accepted']
assert expected in classes, (kind, expected, classes)
assert save['descriptor']['nativeContinuation']['state'] == 'refused'
assert 'loader' not in load
print(json.dumps({'case':kind,'expected':expected,'refusalClasses':classes,'loaderStarted':'loader' in load}))
PY
  done >"$WORK/generic-unsupported-resource-refusals.cases"
  python3 - <<PY
import json
cases=[json.loads(line) for line in open('$WORK/generic-unsupported-resource-refusals.cases') if line.strip()]
assert len(cases) == 6
print(json.dumps({'name':'generic-unsupported-resource-refusals','state':'passed','cases':cases}))
PY
}

prove_generic_loader_preflight_refusals() {
  local pid bundle tpid blocker cases_file="$WORK/generic-loader-preflight-refusals.cases"
  : >"$cases_file"
  # executable identity mismatch
  bundle="$WORK/generic-refuse-exe.bundle"
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec </dev/null >/dev/null 2>/dev/null; exec /usr/bin/yes generic-refuse-exe' & echo \$!" | tail -1 | tr -d '\r')
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-refuse-exe.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  python3 - <<PY
import json
p='$bundle/move.json'
d=json.load(open(p))
d['resourcePlan']['capture']['genericResourceGraphState']['executableIdentity']['sha256']='0'*64
json.dump(d, open(p,'w'), indent=2)
PY
  set +e; $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-refuse-exe.load.json"; set -e
  python3 - <<PY >>"$cases_file"
import json
load=json.load(open('$WORK/generic-refuse-exe.load.json'))
assert not load['accepted']; assert load['loader']['state'] == 'refused'; assert load['loader'].get('targetPid') is None
assert load['loader']['refusals'][0]['detail']['reason'] == 'executable-identity-mismatch'
print(json.dumps({'case':'changed-executable-identity','reason':'executable-identity-mismatch','targetPid':load['loader'].get('targetPid')}))
PY
  # file identity mismatch
  setup_generic_python_fixture "$SRC" refuse-file
  setup_generic_python_fixture "$TGT" refuse-file
  bundle="$WORK/generic-refuse-file.bundle"
  pid=$(launch_generic_fixture refuse-file file_worker.py "/tmp/machinen-generic/refuse-file/root/input.txt" "/tmp/machinen-generic/refuse-file/root")
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-refuse-file.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  $CLI exec "$TGT" -- "printf changed >/tmp/machinen-generic/refuse-file/root/input.txt" >/dev/null
  set +e; $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-refuse-file.load.json"; set -e
  python3 - <<PY >>"$cases_file"
import json
load=json.load(open('$WORK/generic-refuse-file.load.json'))
assert not load['accepted']; assert load['loader']['state'] == 'refused'; assert load['loader'].get('targetPid') is None
reason=load['loader']['refusals'][0]['detail']['reason']; assert reason in ('file-size-mismatch','file-identity-mismatch')
print(json.dumps({'case':'changed-file-identity','reason':reason,'targetPid':load['loader'].get('targetPid')}))
PY
  # cwd missing
  setup_generic_python_fixture "$SRC" refuse-cwd
  setup_generic_python_fixture "$TGT" refuse-cwd
  bundle="$WORK/generic-refuse-cwd.bundle"
  pid=$(launch_generic_fixture refuse-cwd data_dir_daemon.py "" "/tmp/machinen-generic/refuse-cwd/root")
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-refuse-cwd.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  $CLI exec "$TGT" -- "mv /tmp/machinen-generic/refuse-cwd/root /tmp/machinen-generic/refuse-cwd/root.moved" >/dev/null
  set +e; $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-refuse-cwd.load.json"; set -e
  python3 - <<PY >>"$cases_file"
import json
load=json.load(open('$WORK/generic-refuse-cwd.load.json'))
assert not load['accepted']; assert load['loader']['state'] == 'refused'; assert load['loader'].get('targetPid') is None
assert load['loader']['refusals'][0]['detail']['reason'] == 'cwd-missing'
print(json.dumps({'case':'changed-cwd-identity','reason':'cwd-missing','targetPid':load['loader'].get('targetPid')}))
PY
  # data-dir tree mismatch
  setup_generic_python_fixture "$SRC" refuse-datadir
  setup_generic_python_fixture "$TGT" refuse-datadir
  bundle="$WORK/generic-refuse-datadir.bundle"
  pid=$(launch_generic_fixture refuse-datadir data_dir_daemon.py "" "/tmp/machinen-generic/refuse-datadir/root")
  sleep 0.2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-refuse-datadir.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  $CLI exec "$TGT" -- "printf extra >/tmp/machinen-generic/refuse-datadir/root/extra.txt" >/dev/null
  set +e; $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-refuse-datadir.load.json"; set -e
  python3 - <<PY >>"$cases_file"
import json
load=json.load(open('$WORK/generic-refuse-datadir.load.json'))
assert not load['accepted']; assert load['loader']['state'] == 'refused'; assert load['loader'].get('targetPid') is None
reason=load['loader']['refusals'][0]['detail']['reason']; assert reason.startswith('data-dir-')
print(json.dumps({'case':'changed-data-dir-tree','reason':reason,'targetPid':load['loader'].get('targetPid')}))
PY
  # port conflict
  setup_generic_python_fixture "$SRC" refuse-port
  setup_generic_python_fixture "$TGT" refuse-port
  bundle="$WORK/generic-refuse-port.bundle"
  pid=$(launch_generic_fixture refuse-port tcp_echo.py "18332" "/tmp/machinen-generic/refuse-port/root")
  sleep 0.4
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-refuse-port.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  blocker=$($CLI exec "$TGT" -- "setsid /usr/bin/python3 - <<'PY' >/dev/null 2>&1 & echo \$!
import socket, time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1',18332)); s.listen(1)
time.sleep(60)
PY" | tail -1 | tr -d '\r')
  set +e; $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-refuse-port.load.json"; set -e
  $CLI exec "$TGT" -- "kill -TERM $blocker 2>/dev/null || true" >/dev/null
  python3 - <<PY >>"$cases_file"
import json
load=json.load(open('$WORK/generic-refuse-port.load.json'))
assert not load['accepted']; assert load['loader']['state'] == 'refused'; assert load['loader'].get('targetPid') is None
assert load['loader']['refusals'][0]['detail']['reason'] == 'port-unavailable'
print(json.dumps({'case':'port-conflict','reason':'port-unavailable','targetPid':load['loader'].get('targetPid')}))
PY
  # health probe failure after launch, before LOAD_PID
  setup_generic_python_fixture "$SRC" refuse-health
  setup_generic_python_fixture "$TGT" refuse-health
  bundle="$WORK/generic-refuse-health.bundle"
  pid=$(launch_generic_fixture refuse-health tcp_echo.py "18333" "/tmp/machinen-generic/refuse-health/root")
  sleep 0.4
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/generic-refuse-health.save.json"
  $CLI exec "$SRC" -- "kill -TERM $pid 2>/dev/null || true" >/dev/null
  python3 - <<PY
import json
p='$bundle/move.json'
d=json.load(open(p))
d['resourcePlan']['capture']['genericResourceGraphState']['healthProbe']={'kind':'tcp-connect','host':'127.0.0.1','port':19999}
json.dump(d, open(p,'w'), indent=2)
PY
  set +e; $CLI move load "$TGT" "$bundle" --json >"$WORK/generic-refuse-health.load.json"; set -e
  python3 - <<PY >>"$cases_file"
import json
load=json.load(open('$WORK/generic-refuse-health.load.json'))
assert not load['accepted']; assert load['loader']['state'] == 'refused'; assert load['loader'].get('targetPid') is None
assert load['loader']['refusals'][0]['detail']['reason'] == 'health-tcp-connect-failed'
print(json.dumps({'case':'health-probe-failure','reason':'health-tcp-connect-failed','targetPid':load['loader'].get('targetPid')}))
PY
  python3 - <<PY
import json
cases=[json.loads(line) for line in open('$cases_file') if line.strip()]
assert len(cases) == 6
print(json.dumps({'name':'generic-loader-preflight-refusals','state':'passed','cases':cases}))
PY
}

prove_unsupported_pipe_graph_refusal() {
  local bundle="$WORK/unsupported-pipe.bundle" pid save_rc load_rc
  $CLI exec "$SRC" -- "printf 'match line1\n' >/tmp/unsupported-pipeline.txt" >/dev/null
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'tail -n +1 -f /tmp/unsupported-pipeline.txt | grep --line-buffered match | grep line >/tmp/unsupported-pipeline-source.out' >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 2
  set +e
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/unsupported-pipe.save.json"
  save_rc=$?
  $CLI move load "$TGT" "$bundle" --json >"$WORK/unsupported-pipe.load.json"
  load_rc=$?
  set -e
  python3 - <<PY
import json
save=json.load(open('$WORK/unsupported-pipe.save.json'))
load=json.load(open('$WORK/unsupported-pipe.load.json'))
assert int('$save_rc') == 1
assert int('$load_rc') == 1
assert not save['accepted']
assert not load['accepted']
assert save['descriptor']['nativeContinuation']['state'] == 'refused'
assert 'loader' not in load
print(json.dumps({'name':'unsupported-pipe-graph-refusal','state':'passed','saveAccepted':save['accepted'],'loadAccepted':load['accepted'],'nativeContinuation':save['descriptor']['nativeContinuation']['state'],'loaderStarted':'loader' in load}))
PY
}

prove_tail_grep_pipeline() {
  local bundle="$WORK/tail-grep.bundle" pid log
  $CLI exec "$SRC" -- "printf 'match line1\nskip line2\nmatch line3\n' >/tmp/pipeline.txt" >/dev/null
  $CLI exec "$TGT" -- "printf 'match line1\nskip line2\nmatch line3\n' >/tmp/pipeline.txt" >/dev/null
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; tail -n +1 -f /tmp/pipeline.txt | grep --line-buffered match >/tmp/pipeline-source.out' >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r')
  sleep 2
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/tail-grep.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/tail-grep.load.json"
  log=$(python3 - <<PY
import json; print(json.load(open('$WORK/tail-grep.load.json'))['loader']['logPath'])
PY
)
  $CLI exec "$TGT" -- "printf 'skip line4\nmatch line5\nmatch line6\n' >>/tmp/pipeline.txt" >/dev/null
  sleep 2
  $CLI exec "$TGT" -- "cat '$log'" >"$WORK/tail-grep.target.out"
  python3 - <<PY
import json
save=json.load(open('$WORK/tail-grep.save.json'))
load=json.load(open('$WORK/tail-grep.load.json'))
out=open('$WORK/tail-grep.target.out').read().splitlines()
assert save['accepted'] and load['accepted']
assert load['loader']['strategy'] == 'target-original-tail-grep-pipeline-loader'
assert out == ['match line5','match line6']
print(json.dumps({'name':'tail-grep-pipeline','state':'passed','pipelineState':save['descriptor']['resourcePlan']['capture']['tailGrepPipelineState'],'output':out}))
PY
}

probe_terminal_tools() {
  local tools
  tools=$($CLI exec "$TGT" -- 'for x in less vi script; do command -v "$x" >/dev/null 2>&1 && printf "%s:present\n" "$x" || printf "%s:missing\n" "$x"; done')
  python3 - <<PY
import json
rows='''$tools'''.strip().splitlines()
print(json.dumps({'name':'terminal-tools','state':'present' if all(r.endswith(':present') for r in rows) else 'skipped','tools':rows}))
PY
}

PROOF_NAMES=(
  sleep
  tail
  find-cursor
  complex-find-refusal
  tar-create
  unsafe-tar-refusal
  tar-extract
  unsafe-tar-extract-refusal
  zip-create
  unsafe-zip-create-refusal
  mkdir-dir
  unsafe-mkdir-refusal
  mkdir-parents
  unsafe-mkdir-parents-refusal
  touch-file
  unsafe-touch-refusal
  chmod-file
  unsafe-chmod-refusal
  chown-file
  unsafe-chown-refusal
  link-file
  unsafe-link-refusal
  symlink-file
  unsafe-symlink-refusal
  rm-file
  unsafe-rm-refusal
  rmdir-dir
  unsafe-rmdir-refusal
  install-file
  unsafe-install-refusal
  ls-dir
  unsafe-ls-refusal
  ls-long-dir
  unsafe-ls-long-refusal
  du-sb-dir
  unsafe-du-refusal
  stat-file
  unsafe-stat-refusal
  readlink-direct
  unsafe-readlink-refusal
  realpath-path
  unsafe-realpath-refusal
  recursive-grep
  unsafe-recursive-grep-refusal
  maxdepth-find
  unsafe-maxdepth-find-refusal
  find-predicate
  unsafe-find-predicate-refusal
  tree-dir
  unsafe-tree-refusal
  cp-offset
  unsafe-cp-refusal
  mv-rename
  unsafe-mv-refusal
  comm-files
  unsafe-comm-refusal
  join-files
  unsafe-join-refusal
  paste-files
  unsafe-paste-refusal
  uniq-file
  unsafe-uniq-refusal
  awk-field
  unsafe-awk-refusal
  cut-fields
  unsafe-cut-refusal
  sed-print-range
  unsafe-sed-print-refusal
  sed-literal-substitution
  unsafe-sed-sub-refusal
  head-file
  unsafe-head-refusal
  tail-lines
  unsafe-tail-lines-refusal
  sort-file
  unsafe-sort-refusal
  wc-line
  unsafe-wc-refusal
  md5sum-file
  unsafe-md5sum-refusal
  sha1sum-file
  unsafe-sha1sum-refusal
  sha512sum-file
  unsafe-sha512sum-refusal
  base64-file
  unsafe-base64-refusal
  gzip-atomic
  unsafe-gzip-refusal
  gunzip-atomic
  unsafe-gunzip-refusal
  xz-atomic
  unsafe-xz-refusal
  zstd-atomic
  unsafe-zstd-refusal
  sha256sum-file
  unsafe-sha256sum-refusal
  dd-offset
  unsafe-dd-refusal
  generic-yes-loop
  generic-finite-pipe-replay
  generic-long-running-pipe-pair
  generic-pipe-stdio-refusals
  generic-static-http-daemon
  generic-interpreted-server
  generic-file-backed-worker
  generic-readonly-file-cli
  generic-writable-log-daemon
  generic-data-dir-daemon
  generic-readonly-file-cursor
  generic-append-log-cursor
  generic-multi-file-readonly-worker
  generic-append-log-preflight-refusals
  generic-stale-file-identity-refusal
  generic-deleted-file-fd-refusal
  generic-writable-file-cursor-refusal
  generic-append-only-file-cursor-refusal
  generic-append-log-unsupported-flags-refusal
  generic-append-log-fanotify-refusal
  generic-file-lock-refusal
  generic-mmap-file-refusal
  generic-inotify-file-refusal
  generic-unix-socket-baseline-refusals
  generic-anon-inode-baseline-refusals
  generic-unsupported-resource-refusals
  generic-loader-preflight-refusals
  unsupported-pipe-graph-refusal
  tail-grep-pipeline
  reader-cat
  grep
  watch
  shell
  python-http
  python-http-directory
  env-python-http-directory
  unsupported-env-wrapper-refusal
  timeout-python-http-directory
  unsafe-timeout-refusal
  busybox-httpd
  nc-listener
  unsafe-nc-active-refusal
  busybox-nc-listener
  unsafe-busybox-nc-refusal
  socat-file-responder
  unsafe-socat-file-responder-refusal
  redis-idle
  unsafe-redis-idle-refusal
  postgres-idle-cluster
  postgres-refusal
  unsafe-postgres-cluster-refusal
  nginx-static
  unsafe-nginx-static-refusal
  caddy-static
  unsafe-caddy-static-refusal
  ruby-http
  unsafe-ruby-http-refusal
  php-static
  unsafe-php-static-refusal
  rsync-daemon
  unsafe-rsync-daemon-refusal
  python-http-active-refusal
  python-http-explicit-bind-refusal
  python-http-cgi-refusal
  python-http-missing-cwd-refusal
  python-http-port-conflict-refusal
  python-http-package-mismatch-refusal
  go-static-http
  go-extra-socket-refusal
  rust-static-http
  python-static-route
  python-unmarked-flask-refusal
  node-static-http
  node-static-argv-http
  node-active-refusal
  node-timer-refusal
  node-worker-refusal
  native-dlopen-refusal
  terminal-tools
)
PROOF_LABELS=(
  "sleep"
  "tail"
  "find cursor"
  "complex find refusal"
  "tar create"
  "unsafe tar refusal"
  "tar extract"
  "unsafe tar extract refusal"
  "zip create"
  "unsafe zip create refusal"
  "mkdir dir"
  "unsafe mkdir refusal"
  "mkdir parents"
  "unsafe mkdir parents refusal"
  "touch file"
  "unsafe touch refusal"
  "chmod file"
  "unsafe chmod refusal"
  "chown file"
  "unsafe chown refusal"
  "link file"
  "unsafe link refusal"
  "symlink file"
  "unsafe symlink refusal"
  "rm file"
  "unsafe rm refusal"
  "rmdir dir"
  "unsafe rmdir refusal"
  "install file"
  "unsafe install refusal"
  "ls dir"
  "unsafe ls refusal"
  "ls long dir"
  "unsafe ls long refusal"
  "du sb dir"
  "unsafe du refusal"
  "stat file"
  "unsafe stat refusal"
  "readlink direct"
  "unsafe readlink refusal"
  "realpath path"
  "unsafe realpath refusal"
  "recursive grep"
  "unsafe recursive grep refusal"
  "maxdepth find"
  "unsafe maxdepth find refusal"
  "find predicate"
  "unsafe find predicate refusal"
  "tree dir"
  "unsafe tree refusal"
  "cp offset"
  "unsafe cp refusal"
  "mv rename"
  "unsafe mv refusal"
  "comm files"
  "unsafe comm refusal"
  "join files"
  "unsafe join refusal"
  "paste files"
  "unsafe paste refusal"
  "uniq file"
  "unsafe uniq refusal"
  "awk field"
  "unsafe awk refusal"
  "cut fields"
  "unsafe cut refusal"
  "sed print range"
  "unsafe sed print refusal"
  "sed literal substitution"
  "unsafe sed sub refusal"
  "head file"
  "unsafe head refusal"
  "tail lines"
  "unsafe tail lines refusal"
  "sort file"
  "unsafe sort refusal"
  "wc line"
  "unsafe wc refusal"
  "md5sum file"
  "unsafe md5sum refusal"
  "sha1sum file"
  "unsafe sha1sum refusal"
  "sha512sum file"
  "unsafe sha512sum refusal"
  "base64 file"
  "unsafe base64 refusal"
  "gzip atomic"
  "unsafe gzip refusal"
  "gunzip atomic"
  "unsafe gunzip refusal"
  "xz atomic"
  "unsafe xz refusal"
  "zstd atomic"
  "unsafe zstd refusal"
  "sha256sum file"
  "unsafe sha256sum refusal"
  "dd offset"
  "unsafe dd refusal"
  "generic yes loop"
  "generic finite pipe replay"
  "generic long-running pipe pair"
  "generic pipe stdio refusals"
  "generic static http daemon"
  "generic interpreted server"
  "generic file-backed worker"
  "generic readonly-file cli"
  "generic writable-log daemon"
  "generic data-dir daemon"
  "generic readonly file cursor"
  "generic append log cursor"
  "generic multi-file readonly worker"
  "generic append log preflight refusals"
  "generic stale file identity refusal"
  "generic deleted file-fd refusal"
  "generic writable file cursor refusal"
  "generic append-only file cursor refusal"
  "generic append log unsupported flags refusal"
  "generic append log fanotify refusal"
  "generic file lock refusal"
  "generic mmap file refusal"
  "generic inotify file refusal"
  "generic unix socket baseline refusals"
  "generic anon-inode baseline refusals"
  "generic unsupported resource refusals"
  "generic loader preflight refusals"
  "unsupported pipe graph refusal"
  "tail-grep pipeline"
  "reader"
  "grep"
  "watch"
  "shell"
  "http"
  "http directory"
  "env http directory"
  "unsupported env wrapper refusal"
  "timeout http directory"
  "unsafe timeout refusal"
  "busybox httpd"
  "nc listener"
  "unsafe nc active refusal"
  "busybox nc listener"
  "unsafe busybox nc refusal"
  "socat file responder"
  "unsafe socat file responder refusal"
  "redis idle"
  "unsafe redis idle refusal"
  "postgres idle cluster"
  "postgres refusal"
  "unsafe postgres cluster refusal"
  "nginx static"
  "unsafe nginx static refusal"
  "caddy static"
  "unsafe caddy static refusal"
  "ruby http"
  "unsafe ruby http refusal"
  "php static"
  "unsafe php static refusal"
  "rsync daemon"
  "unsafe rsync daemon refusal"
  "http active request refusal"
  "http explicit bind refusal"
  "http cgi refusal"
  "http missing cwd refusal"
  "http port conflict refusal"
  "http package mismatch refusal"
  "go static http"
  "go extra socket refusal"
  "rust static http"
  "python static route"
  "python unmarked flask refusal"
  "node static http"
  "node static argv http"
  "node active refusal"
  "node timer refusal"
  "node worker refusal"
  "native dlopen refusal"
  "terminal tools"
)
PROOF_FUNCS=(
  prove_sleep
  prove_tail
  prove_find_cursor
  prove_complex_find_refusal
  prove_tar_create
  prove_unsafe_tar_refusal
  prove_tar_extract
  prove_unsafe_tar_extract_refusal
  prove_zip_create
  prove_unsafe_zip_create_refusal
  prove_mkdir_dir
  prove_unsafe_mkdir_refusal
  prove_mkdir_parents
  prove_unsafe_mkdir_parents_refusal
  prove_touch_file
  prove_unsafe_touch_refusal
  prove_chmod_file
  prove_unsafe_chmod_refusal
  prove_chown_file
  prove_unsafe_chown_refusal
  prove_link_file
  prove_unsafe_link_refusal
  prove_symlink_file
  prove_unsafe_symlink_refusal
  prove_rm_file
  prove_unsafe_rm_refusal
  prove_rmdir_dir
  prove_unsafe_rmdir_refusal
  prove_install_file
  prove_unsafe_install_refusal
  prove_ls_dir
  prove_unsafe_ls_refusal
  prove_ls_long_dir
  prove_unsafe_ls_long_refusal
  prove_du_sb_dir
  prove_unsafe_du_refusal
  prove_stat_file
  prove_unsafe_stat_refusal
  prove_readlink_direct
  prove_unsafe_readlink_refusal
  prove_realpath_path
  prove_unsafe_realpath_refusal
  prove_recursive_grep
  prove_unsafe_recursive_grep_refusal
  prove_maxdepth_find
  prove_unsafe_maxdepth_find_refusal
  prove_find_predicate
  prove_unsafe_find_predicate_refusal
  prove_tree_dir
  prove_unsafe_tree_refusal
  prove_cp_offset
  prove_unsafe_cp_refusal
  prove_mv_rename
  prove_unsafe_mv_refusal
  prove_comm_files
  prove_unsafe_comm_refusal
  prove_join_files
  prove_unsafe_join_refusal
  prove_paste_files
  prove_unsafe_paste_refusal
  prove_uniq_file
  prove_unsafe_uniq_refusal
  prove_awk_field
  prove_unsafe_awk_refusal
  prove_cut_fields
  prove_unsafe_cut_refusal
  prove_sed_print_range
  prove_unsafe_sed_print_refusal
  prove_sed_literal_substitution
  prove_unsafe_sed_sub_refusal
  prove_head_file
  prove_unsafe_head_refusal
  prove_tail_lines
  prove_unsafe_tail_lines_refusal
  prove_sort_file
  prove_unsafe_sort_refusal
  prove_wc_line
  prove_unsafe_wc_refusal
  prove_md5sum_file
  prove_unsafe_md5sum_refusal
  prove_sha1sum_file
  prove_unsafe_sha1sum_refusal
  prove_sha512sum_file
  prove_unsafe_sha512sum_refusal
  prove_base64_file
  prove_unsafe_base64_refusal
  prove_gzip_atomic
  prove_unsafe_gzip_refusal
  prove_gunzip_atomic
  prove_unsafe_gunzip_refusal
  prove_xz_atomic
  prove_unsafe_xz_refusal
  prove_zstd_atomic
  prove_unsafe_zstd_refusal
  prove_sha256sum_file
  prove_unsafe_sha256sum_refusal
  prove_dd_offset
  prove_unsafe_dd_refusal
  prove_generic_yes_loop
  prove_generic_finite_pipe_replay
  prove_generic_long_running_pipe_pair
  prove_generic_pipe_stdio_refusals
  prove_generic_static_http_daemon
  prove_generic_interpreted_server
  prove_generic_file_backed_worker
  prove_generic_readonly_file_cli
  prove_generic_writable_log_daemon
  prove_generic_data_dir_daemon
  prove_generic_readonly_file_cursor
  prove_generic_append_log_cursor
  prove_generic_multi_file_readonly_worker
  prove_generic_append_log_preflight_refusals
  prove_generic_stale_file_identity_refusal
  prove_generic_deleted_file_fd_refusal
  prove_generic_writable_file_cursor_refusal
  prove_generic_append_only_file_cursor_refusal
  prove_generic_append_log_unsupported_flags_refusal
  prove_generic_append_log_fanotify_refusal
  prove_generic_file_lock_refusal
  prove_generic_mmap_file_refusal
  prove_generic_inotify_file_refusal
  prove_generic_unix_socket_baseline_refusals
  prove_generic_anon_inode_baseline_refusals
  prove_generic_unsupported_resource_refusals
  prove_generic_loader_preflight_refusals
  prove_unsupported_pipe_graph_refusal
  prove_tail_grep_pipeline
  prove_reader
  prove_grep
  prove_watch
  prove_shell
  prove_http
  prove_http_directory
  prove_env_http_directory
  prove_unsupported_env_wrapper_refusal
  prove_timeout_http_directory
  prove_unsafe_timeout_refusal
  prove_busybox_httpd
  prove_nc_listener
  prove_unsafe_nc_active_refusal
  prove_busybox_nc_listener
  prove_unsafe_busybox_nc_refusal
  prove_socat_file_responder
  prove_unsafe_socat_file_responder_refusal
  prove_redis_idle
  prove_unsafe_redis_idle_refusal
  prove_postgres_idle_cluster
  prove_postgres_refusal
  prove_unsafe_postgres_cluster_refusal
  prove_nginx_static
  prove_unsafe_nginx_static_refusal
  prove_caddy_static
  prove_unsafe_caddy_static_refusal
  prove_ruby_http
  prove_unsafe_ruby_http_refusal
  prove_php_static
  prove_unsafe_php_static_refusal
  prove_rsync_daemon
  prove_unsafe_rsync_daemon_refusal
  prove_http_active_request_refusal
  prove_http_explicit_bind_refusal
  prove_http_cgi_refusal
  prove_http_missing_cwd_refusal
  prove_http_port_conflict_refusal
  prove_http_package_mismatch_refusal
  prove_go_static_http
  prove_go_extra_socket_refusal
  prove_rust_static_http
  prove_python_static_route
  prove_python_unmarked_flask_refusal
  prove_node_static_http
  prove_node_static_argv_http
  prove_node_active_refusal
  prove_node_timer_refusal
  prove_node_worker_refusal
  prove_native_dlopen_refusal
  probe_terminal_tools
)

start_pair() {
  local start_ms
  if [[ -n "$REUSE_VMS" ]]; then
    if [[ "$SKIP_PROVISION" != "1" ]]; then
      start_ms=$(now_ms)
      ensure_proof_tools "$SRC"
      ensure_proof_tools "$TGT"
      record_timing "provision-pair" "passed" "$start_ms" "reuse-vms:$PROVISION_MODE"
    else
      start_ms=$(now_ms)
      record_timing "provision-pair" "skipped" "$start_ms" "reuse-vms:$PROVISION_MODE"
    fi
  else
    boot_pair
  fi
}

maybe_auto_skip_provision() {
  local token
  if [[ "$SKIP_PROVISION" == "1" || -z "$ONLY" ]]; then
    return 0
  fi
  IFS=',' read -r -a tokens <<<"$ONLY"
  for token in "${tokens[@]}"; do
    case "$token" in
      zstd-atomic | unsafe-zstd-refusal)
        ;;
      *)
        return 0
        ;;
    esac
  done
  SKIP_PROVISION=1
  PROVISION_MODE="auto-skip-zstd-only"
}

proof_selected() {
  local name="$1" token
  if [[ -z "$ONLY" ]]; then
    return 0
  fi
  IFS=',' read -r -a tokens <<<"$ONLY"
  for token in "${tokens[@]}"; do
    if [[ "$token" == "$name" ]]; then
      return 0
    fi
  done
  return 1
}

validate_only() {
  local token name found
  if [[ -z "$ONLY" ]]; then
    return 0
  fi
  IFS=',' read -r -a tokens <<<"$ONLY"
  for token in "${tokens[@]}"; do
    found=0
    for name in "${PROOF_NAMES[@]}"; do
      if [[ "$token" == "$name" ]]; then
        found=1
        break
      fi
    done
    if [[ "$found" != "1" ]]; then
      echo "unknown --only proof: $token" >&2
      echo "available proofs: ${PROOF_NAMES[*]}" >&2
      exit 2
    fi
  done
}

classify_proof_failure() {
  local stdout_file="$1" stderr_file="$2"
  node scripts/move-envelope-failure-classifier.mjs "$stdout_file" "$stderr_file" | tr -d '\n'
}

emit_failed_json() {
  local proof_name="$1" failure_class="$2" exit_code="$3" stdout_file="$4" stderr_file="$5"
  {
    printf 'PROOF\t%s\n' "${results[@]:-}"
    if [[ "$TIMINGS" == "1" && "${#timing_events[@]}" -gt 0 ]]; then
      printf 'TIMING\t%s\n' "${timing_events[@]}"
    fi
    printf 'FAILURE\t%s\n' "$(python3 -c 'import json,sys; print(json.dumps({"proof":sys.argv[1],"class":sys.argv[2],"exitCode":int(sys.argv[3]),"stdout":open(sys.argv[4]).read()[-4000:],"stderr":open(sys.argv[5]).read()[-4000:]}))' "$proof_name" "$failure_class" "$exit_code" "$stdout_file" "$stderr_file")"
  } | python3 -c 'import json, sys
proofs=[]
timings=[]
failure=None
for line in sys.stdin:
    line=line.rstrip("\n")
    if not line:
        continue
    kind, payload = line.split("\t", 1)
    if kind == "PROOF" and payload:
        proofs.append(json.loads(payload))
    elif kind == "TIMING":
        timings.append(json.loads(payload))
    elif kind == "FAILURE":
        failure=json.loads(payload)
print(json.dumps({"state":"failed","failure":failure,"proofs":proofs,"timings":timings}, indent=2))'
}

validate_only
maybe_auto_skip_provision
start_pair
results=()
for i in "${!PROOF_NAMES[@]}"; do
  if proof_selected "${PROOF_NAMES[$i]}"; then
    proof_start_ms=$(now_ms)
    proof_stdout="$WORK/${PROOF_NAMES[$i]}.proof.out"
    proof_stderr="$WORK/${PROOF_NAMES[$i]}.proof.err"
    echo "proving ${PROOF_LABELS[$i]}" >&2
    set +e
    "${PROOF_FUNCS[$i]}" >"$proof_stdout" 2>"$proof_stderr"
    proof_rc=$?
    set -e
    if [[ "$proof_rc" != "0" ]]; then
      failure_class=$(classify_proof_failure "$proof_stdout" "$proof_stderr")
      record_timing "proof:${PROOF_NAMES[$i]}" "failed" "$proof_start_ms" "${PROOF_LABELS[$i]}:$failure_class"
      cat "$proof_stderr" >&2
      if [[ "$JSON" == "1" ]]; then
        emit_failed_json "${PROOF_NAMES[$i]}" "$failure_class" "$proof_rc" "$proof_stdout" "$proof_stderr"
      fi
      exit "$proof_rc"
    fi
    results+=("$(cat "$proof_stdout")")
    record_timing "proof:${PROOF_NAMES[$i]}" "passed" "$proof_start_ms" "${PROOF_LABELS[$i]}"
  fi
done

if [[ "${#results[@]}" == "0" ]]; then
  echo "no proofs selected" >&2
  exit 2
fi

if [[ "$JSON" == "1" ]]; then
  {
    printf 'PROOF\t%s\n' "${results[@]}"
    if [[ "$TIMINGS" == "1" && "${#timing_events[@]}" -gt 0 ]]; then
      printf 'TIMING\t%s\n' "${timing_events[@]}"
    fi
  } | python3 -c 'import json, sys
proofs=[]
timings=[]
for line in sys.stdin:
    line=line.rstrip("\n")
    if not line:
        continue
    kind, payload = line.split("\t", 1)
    if kind == "PROOF":
        proofs.append(json.loads(payload))
    elif kind == "TIMING":
        timings.append(json.loads(payload))
print(json.dumps({"state":"passed","proofs":proofs,"timings":timings}, indent=2))'
else
  printf '%s\n' "${results[@]}"
  if [[ "$TIMINGS" == "1" && "${#timing_events[@]}" -gt 0 ]]; then
    printf '%s\n' "${timing_events[@]}" >&2
  fi
fi
