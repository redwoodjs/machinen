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
  $CLI rm "$SRC" >/dev/null 2>&1 || true
  $CLI rm "$TGT" >/dev/null 2>&1 || true
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
if ! python3 -V >/dev/null 2>&1 || ! command -v watch >/dev/null 2>&1 || ! command -v less >/dev/null 2>&1 || ! command -v vi >/dev/null 2>&1; then
  apt-get update -qq >/tmp/machinen-move-proof-apt.log 2>&1
  apt-get install -y --no-install-recommends --reinstall \
    libpython3.11-minimal python3.11-minimal libpython3.11-stdlib \
    python3.11 python3-minimal python3 procps less vim-tiny \
    >>/tmp/machinen-move-proof-apt.log 2>&1 || { cat /tmp/machinen-move-proof-apt.log; exit 1; }
fi
python3 -V >/dev/null
command -v watch >/dev/null
command -v less >/dev/null
command -v vi >/dev/null
command -v script >/dev/null'
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

prove_http() {
  local bundle="$WORK/http.bundle" pid
  $CLI exec "$SRC" -- "mkdir -p /tmp/web; printf 'hello-http\n' >/tmp/web/index.html; cd /tmp/web && python3 -m http.server 8123 --bind 127.0.0.1 >/tmp/http.log 2>&1 & echo \$!" >/tmp/http.pid
  pid=$(tail -1 /tmp/http.pid | tr -d '\r')
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
echo "probing terminal tools" >&2
terminal_result=$(probe_terminal_tools)

if [[ "$JSON" == "1" ]]; then
  python3 - <<PY
import json
print(json.dumps({'state':'passed','proofs':[json.loads('''$sleep_result'''), json.loads('''$tail_result'''), json.loads('''$reader_result'''), json.loads('''$grep_result'''), json.loads('''$watch_result'''), json.loads('''$shell_result'''), json.loads('''$http_result'''), json.loads('''$terminal_result''')]}, indent=2))
PY
else
  printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$sleep_result" "$tail_result" "$reader_result" "$grep_result" "$watch_result" "$shell_result" "$http_result" "$terminal_result"
fi
