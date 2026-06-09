#!/usr/bin/env bash
set -euo pipefail

JSON=0
for arg in "$@"; do
  if [[ "$arg" == "--json" ]]; then
    JSON=1
  fi
done
CLI="${MACHINEN_MOVE_MATRIX_CLI:-node packages/cli/dist/cli.js}"
RUN_ID="${$}-$(date +%s)"
SRC="move-matrix-src-${RUN_ID}"
TGT="move-matrix-tgt-${RUN_ID}"
WORK="/tmp/machinen-move-matrix-${RUN_ID}"
mkdir -p "$WORK"

cleanup() {
  $CLI stop "$SRC" >/dev/null 2>&1 || true
  $CLI stop "$TGT" >/dev/null 2>&1 || true
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
if ! python3 -V >/dev/null 2>&1 || ! command -v watch >/dev/null 2>&1 || ! command -v less >/dev/null 2>&1 || ! command -v vi >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  apt-get update -qq >/tmp/machinen-move-proof-apt.log 2>&1
  apt-get install -y --no-install-recommends --reinstall \
    libpython3.11-minimal python3.11-minimal libpython3.11-stdlib \
    python3.11 python3-minimal python3 procps less vim-tiny nodejs \
    >>/tmp/machinen-move-proof-apt.log 2>&1 || { cat /tmp/machinen-move-proof-apt.log; exit 1; }
fi
python3 -V >/dev/null
command -v watch >/dev/null
command -v less >/dev/null
command -v vi >/dev/null
command -v script >/dev/null
command -v node >/dev/null'
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
for i in range(60000):
    (root / f'file-{i:05d}.txt').write_text(f'file {i}\\n')
PY" >/dev/null
  done
  pid=""
  state="unknown"
  lines=0
  for delay in 0.001 0.005 0.01 0.015 0.02 0.03 0.04 0.05; do
    $CLI exec "$SRC" -- "rm -f /tmp/find-source.out /tmp/find.err" >/dev/null
    pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec find /tmp/find-tree -type f -print >/tmp/find-source.out 2>/tmp/find.err' </dev/null >/dev/null 2>&1 & pid=\$!; ( sleep $delay; kill -STOP \$pid 2>/dev/null || true ) >/dev/null 2>&1 & echo \$pid" | tail -1 | tr -d '\r')
    state="unknown"
    for _ in $(seq 1 100); do
      state=$($CLI exec "$SRC" -- "awk '/^State:/ {print \$2}' /proc/$pid/status 2>/dev/null || printf gone" | tail -1 | tr -d '\r')
      if [[ "$state" == "T" ]]; then
        break
      fi
      sleep 0.05
    done
    lines=$($CLI exec "$SRC" -- "wc -l </tmp/find-source.out 2>/dev/null || printf 0" | tail -1 | tr -d '\r')
    if [[ "$state" == "T" && "$lines" -gt 0 && "$lines" -lt 60000 ]]; then
      break
    fi
    if [[ "$state" == "T" ]]; then
      $CLI exec "$SRC" -- "kill -KILL $pid 2>/dev/null || true" >/dev/null
    fi
  done
  if [[ "$state" != "T" || "$lines" -le 0 || "$lines" -ge 60000 ]]; then
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
  pid=$($CLI exec "$SRC" -- "setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec find /tmp/find-tree -type f -name \"*.txt\" -print >/tmp/complex-find.out 2>/tmp/complex-find.err' </dev/null >/dev/null 2>&1 & pid=\$!; ( sleep 0.02; kill -STOP \$pid 2>/dev/null || true ) >/dev/null 2>&1 & echo \$pid" | tail -1 | tr -d '\r')
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
  local bundle="$WORK/tar.bundle" pid tpid state
  pid=$($CLI exec "$SRC" -- "rm -f /tmp/archive.tar /tmp/archive.err; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec tar -cf /tmp/archive.tar /tmp/find-tree 2>/tmp/archive.err' </dev/null >/dev/null 2>&1 & pid=\$!; ( sleep 0.02; kill -STOP \$pid 2>/dev/null || true ) >/dev/null 2>&1 & echo \$pid" | tail -1 | tr -d '\r')
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
  tpid=$(python3 - <<PY
import json; print(json.load(open('$WORK/tar.load.json'))['loader']['targetPid'])
PY
)
  for _ in $(seq 1 180); do
    if ! $CLI exec "$TGT" -- "kill -0 $tpid 2>/dev/null" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  $CLI exec "$TGT" -- "tar -tf /tmp/archive.tar | grep '^tmp/find-tree/file-' | sort" >"$WORK/tar.actual"
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
assert len(actual) == 60000
assert len(actual) == len(set(actual))
print(json.dumps({'name':'tar-create','state':'passed','tarState':save['descriptor']['resourcePlan']['capture']['tarState'],'archivedFiles':len(actual),'targetPid':int('$tpid')}))
PY
}

prove_unsafe_tar_refusal() {
  local bundle="$WORK/unsafe-tar.bundle" pid save_rc load_rc state
  pid=$($CLI exec "$SRC" -- "rm -f /tmp/find-tree/archive.tar; setsid sh -c 'exec 3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-; exec tar -cf /tmp/find-tree/archive.tar /tmp/find-tree 2>/tmp/unsafe-tar.err' </dev/null >/dev/null 2>&1 & pid=\$!; ( sleep 0.02; kill -STOP \$pid 2>/dev/null || true ) >/dev/null 2>&1 & echo \$pid" | tail -1 | tr -d '\r')
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

boot_pair
echo "proving sleep" >&2
sleep_result=$(prove_sleep)
echo "proving tail" >&2
tail_result=$(prove_tail)
echo "proving find cursor" >&2
find_result=$(prove_find_cursor)
echo "proving complex find refusal" >&2
complex_find_result=$(prove_complex_find_refusal)
echo "proving tar create" >&2
tar_result=$(prove_tar_create)
echo "proving unsafe tar refusal" >&2
unsafe_tar_result=$(prove_unsafe_tar_refusal)
echo "proving dd offset" >&2
dd_result=$(prove_dd_offset)
echo "proving unsafe dd refusal" >&2
unsafe_dd_result=$(prove_unsafe_dd_refusal)
echo "proving unsupported pipe graph refusal" >&2
unsupported_pipe_result=$(prove_unsupported_pipe_graph_refusal)
echo "proving tail-grep pipeline" >&2
tail_grep_result=$(prove_tail_grep_pipeline)
echo "proving reader" >&2
reader_result=$(prove_reader)
echo "proving grep" >&2
grep_result=$(prove_grep)
echo "proving watch" >&2
watch_result=$(prove_watch)
echo "proving shell" >&2
shell_result=$(prove_shell)
echo "proving http" >&2
http_result=$(prove_http)
echo "proving http active request refusal" >&2
http_active_result=$(prove_http_active_request_refusal)
echo "proving http missing cwd refusal" >&2
http_missing_cwd_result=$(prove_http_missing_cwd_refusal)
echo "proving http port conflict refusal" >&2
http_port_conflict_result=$(prove_http_port_conflict_refusal)
echo "proving http package mismatch refusal" >&2
http_package_result=$(prove_http_package_mismatch_refusal)
echo "proving node static http" >&2
node_static_result=$(prove_node_static_http)
echo "proving node worker refusal" >&2
node_worker_result=$(prove_node_worker_refusal)
echo "probing terminal tools" >&2
terminal_result=$(probe_terminal_tools)

if [[ "$JSON" == "1" ]]; then
  python3 - <<PY
import json
print(json.dumps({'state':'passed','proofs':[json.loads('''$sleep_result'''), json.loads('''$tail_result'''), json.loads('''$find_result'''), json.loads('''$complex_find_result'''), json.loads('''$tar_result'''), json.loads('''$unsafe_tar_result'''), json.loads('''$dd_result'''), json.loads('''$unsafe_dd_result'''), json.loads('''$unsupported_pipe_result'''), json.loads('''$tail_grep_result'''), json.loads('''$reader_result'''), json.loads('''$grep_result'''), json.loads('''$watch_result'''), json.loads('''$shell_result'''), json.loads('''$http_result'''), json.loads('''$http_active_result'''), json.loads('''$http_missing_cwd_result'''), json.loads('''$http_port_conflict_result'''), json.loads('''$http_package_result'''), json.loads('''$node_static_result'''), json.loads('''$node_worker_result'''), json.loads('''$terminal_result''')]}, indent=2))
PY
else
  printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$sleep_result" "$tail_result" "$find_result" "$complex_find_result" "$tar_result" "$unsafe_tar_result" "$dd_result" "$unsafe_dd_result" "$unsupported_pipe_result" "$tail_grep_result" "$reader_result" "$grep_result" "$watch_result" "$shell_result" "$http_result" "$http_active_result" "$http_missing_cwd_result" "$http_port_conflict_result" "$http_package_result" "$node_static_result" "$node_worker_result" "$terminal_result"
fi
