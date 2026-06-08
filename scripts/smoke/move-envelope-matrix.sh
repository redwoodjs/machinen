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
sleep_result=$(prove_sleep)
tail_result=$(prove_tail)
terminal_result=$(probe_terminal_tools)

if [[ "$JSON" == "1" ]]; then
  python3 - <<PY
import json
print(json.dumps({'state':'passed','proofs':[json.loads('''$sleep_result'''), json.loads('''$tail_result'''), json.loads('''$terminal_result''')]}, indent=2))
PY
else
  printf '%s\n%s\n%s\n' "$sleep_result" "$tail_result" "$terminal_result"
fi
