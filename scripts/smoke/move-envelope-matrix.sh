#!/usr/bin/env bash
set -euo pipefail

JSON=0
ONLY=""
REUSE_VMS=""
SKIP_PROVISION=0
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
        echo "usage: $0 [--json] [--only proof[,proof...]] [--reuse-vms SRC:TGT] [--skip-provision]" >&2
        exit 2
      fi
      shift 2
      ;;
    --only=*)
      ONLY="${1#--only=}"
      if [[ -z "$ONLY" ]]; then
        echo "usage: $0 [--json] [--only proof[,proof...]] [--reuse-vms SRC:TGT] [--skip-provision]" >&2
        exit 2
      fi
      shift
      ;;
    --reuse-vms)
      REUSE_VMS="${2:-}"
      if [[ -z "$REUSE_VMS" ]]; then
        echo "usage: $0 [--json] [--only proof[,proof...]] [--reuse-vms SRC:TGT] [--skip-provision]" >&2
        exit 2
      fi
      shift 2
      ;;
    --reuse-vms=*)
      REUSE_VMS="${1#--reuse-vms=}"
      if [[ -z "$REUSE_VMS" ]]; then
        echo "usage: $0 [--json] [--only proof[,proof...]] [--reuse-vms SRC:TGT] [--skip-provision]" >&2
        exit 2
      fi
      shift
      ;;
    --skip-provision)
      SKIP_PROVISION=1
      shift
      ;;
    *)
      echo "unknown move envelope matrix option: $1" >&2
      exit 2
      ;;
  esac
done
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
  rm -rf "$WORK"
}
trap cleanup EXIT

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

boot_pair() {
  $CLI boot --name "$SRC" --detach --json -- sleep infinity >/dev/null
  $CLI boot --name "$TGT" --detach --json -- sleep infinity >/dev/null
  ensure_proof_tools "$SRC"
  ensure_proof_tools "$TGT"
}

ensure_proof_tools() {
  local vm="$1"
  $CLI exec "$vm" -- 'set -eu
export DEBIAN_FRONTEND=noninteractive
if ! python3 -V >/dev/null 2>&1 || ! command -v watch >/dev/null 2>&1 || ! command -v less >/dev/null 2>&1 || ! command -v vi >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1 || ! command -v busybox >/dev/null 2>&1 || ! command -v nc >/dev/null 2>&1 || ! command -v go >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
  apt-get update -qq >/tmp/machinen-move-proof-apt.log 2>&1
  apt-get install -y --no-install-recommends --reinstall \
    libpython3.11-minimal python3.11-minimal libpython3.11-stdlib \
    python3.11 python3-minimal python3 procps less vim-tiny nodejs busybox netcat-openbsd golang-go rustc \
    >>/tmp/machinen-move-proof-apt.log 2>&1 || { cat /tmp/machinen-move-proof-apt.log; exit 1; }
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
command -v rustc >/dev/null'
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

save_http_bundle() {
  local name="$1" port="$2" cwd="$3" bundle="$4"
  $CLI exec "$SRC" -- "mkdir -p '$cwd'; printf 'hello-http\n' >'$cwd/index.html'; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd '$cwd'; exec python3 -m http.server $port --bind 127.0.0.1 >/tmp/${name}.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
}

save_http_directory_bundle() {
  local name="$1" port="$2" directory="$3" bundle="$4"
  $CLI exec "$SRC" -- "mkdir -p '$directory'; printf 'hello-http-directory\n' >'$directory/index.html'; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; cd /; exec python3 -m http.server --directory '$directory' $port --bind 127.0.0.1 >/tmp/${name}.log 2>&1' </dev/null >/dev/null 2>&1 & echo \$!" | tail -1 | tr -d '\r'
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
  $CLI exec "$SRC" -- "python3 - <<'PY' >/tmp/http-active-client.log 2>&1 &
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
  $CLI exec "$TGT" -- "mkdir -p /tmp/web-conflict; printf 'busy\n' >/tmp/web-conflict/index.html; cd /tmp/web-conflict && python3 -m http.server 8125 --bind 127.0.0.1 >/tmp/http-conflict-target.log 2>&1 &" >/dev/null
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
  $CLI exec "$TGT" -- "mkdir -p /tmp/web-directory; printf 'hello-http-directory\n' >/tmp/web-directory/index.html" >/dev/null
  sleep 1
  $CLI move save "$SRC" "$pid" "$bundle" --json >"$WORK/http-directory.save.json"
  $CLI move load "$TGT" "$bundle" --json >"$WORK/http-directory.load.json"
  sleep 2
  $CLI exec "$TGT" -- "python3 - <<'PY'
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
assert save['descriptor']['resourcePlan']['capture']['httpState']['directory'] == '/tmp/web-directory'
assert out == 'hello-http-directory\\n'
print(json.dumps({'name':'python-http-directory','state':'passed','httpState':save['descriptor']['resourcePlan']['capture']['httpState'],'response':out.strip()}))
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
  cp-offset
  unsafe-cp-refusal
  mv-rename
  unsafe-mv-refusal
  sort-file
  unsafe-sort-refusal
  wc-line
  unsafe-wc-refusal
  sha256sum-file
  unsafe-sha256sum-refusal
  dd-offset
  unsafe-dd-refusal
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
  python-http-active-refusal
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
  "cp offset"
  "unsafe cp refusal"
  "mv rename"
  "unsafe mv refusal"
  "sort file"
  "unsafe sort refusal"
  "wc line"
  "unsafe wc refusal"
  "sha256sum file"
  "unsafe sha256sum refusal"
  "dd offset"
  "unsafe dd refusal"
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
  "http active request refusal"
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
  prove_cp_offset
  prove_unsafe_cp_refusal
  prove_mv_rename
  prove_unsafe_mv_refusal
  prove_sort_file
  prove_unsafe_sort_refusal
  prove_wc_line
  prove_unsafe_wc_refusal
  prove_sha256sum_file
  prove_unsafe_sha256sum_refusal
  prove_dd_offset
  prove_unsafe_dd_refusal
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
  prove_http_active_request_refusal
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
  if [[ -n "$REUSE_VMS" ]]; then
    if [[ "$SKIP_PROVISION" != "1" ]]; then
      ensure_proof_tools "$SRC"
      ensure_proof_tools "$TGT"
    fi
  else
    boot_pair
  fi
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

validate_only
start_pair
results=()
for i in "${!PROOF_NAMES[@]}"; do
  if proof_selected "${PROOF_NAMES[$i]}"; then
    echo "proving ${PROOF_LABELS[$i]}" >&2
    results+=("$(${PROOF_FUNCS[$i]})")
  fi
done

if [[ "${#results[@]}" == "0" ]]; then
  echo "no proofs selected" >&2
  exit 2
fi

if [[ "$JSON" == "1" ]]; then
  printf '%s\n' "${results[@]}" | python3 -c 'import json, sys; print(json.dumps({"state":"passed","proofs":[json.loads(line) for line in sys.stdin if line.strip()]}, indent=2))'
else
  printf '%s\n' "${results[@]}"
fi
