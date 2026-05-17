#!/usr/bin/env bash
# Vmstate timer smoke repros (#366).

set -euo pipefail
# shellcheck source=./common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

vmstate_smoke_init timers

TIMER_MS=${MACHINEN_VMSTATE_TIMER_MS:-6000}
HOST_SLEEP=${MACHINEN_VMSTATE_TIMER_HOST_SLEEP:-10}
HOST_SLEEP_MS=$((HOST_SLEEP * 1000))
TIMER_MIN_MS=$((TIMER_MS - 1000))
TIMER_MAX_MS=$((TIMER_MS + 3000))
if (( TIMER_MIN_MS < 1 )); then TIMER_MIN_MS=1; fi

field() {
  local key=$1
  awk -v key="$key" '{ for (i = 1; i <= NF; i++) { split($i, a, "="); if (a[1] == key) { print a[2]; exit } } }'
}

assert_between() {
  local label=$1 value=$2 min=$3 max=$4
  if (( value < min || value > max )); then
    fail "$label $value ms outside expected range [$min, $max] ms"
  fi
  pass "$label $value ms within [$min, $max] ms"
}

section "TIMER-1 monotonic clock does not rewind or include full host downtime"
MONO_NAME="vmstate-timer-mono-$$"
MONO_LOG="$FIXTURE/mono-source.log"
MONO_SNAP="$FIXTURE/mono.snap"
MONO_SNAP_LOG="$FIXTURE/mono-snapshot.log"
MONO_RESTORE_LOG="$FIXTURE/mono-restore.log"
boot_bg "$MONO_NAME" "$MONO_LOG" \
  --mount "$HELPERS_DIR:/mnt/helpers" -- \
  /bin/sh -c 'while :; do sleep 1; done' >/dev/null
if ! wait_for_vm "$MONO_NAME" 45; then
  tail -80 "$MONO_LOG" >&2 || true
  fail "$MONO_NAME never registered"
fi
pass "source VM registered"

MONO_T0_OUT=$(cli exec "$MONO_NAME" -- /mnt/helpers/vmstate-timer-probe monotonic)
MONO_T0=$(printf '%s\n' "$MONO_T0_OUT" | field now_ms)
[[ -n "$MONO_T0" ]] || fail "could not parse monotonic T0 from: $MONO_T0_OUT"
snapshot_vm "$MONO_NAME" "$MONO_SNAP" "$MONO_SNAP_LOG"
pass "snapshot captured at guest monotonic T0=$MONO_T0 ms"

sleep "$HOST_SLEEP"
restore_bg "$MONO_RESTORE_LOG" "$MONO_SNAP" >/dev/null
MONO_RESTORED=""
if ! wait_for_restore_child "$MONO_NAME" MONO_RESTORED 60; then
  tail -120 "$MONO_RESTORE_LOG" >&2 || true
  fail "monotonic restored VM never registered"
fi
if ! wait_for_reseed "$MONO_RESTORED" 60; then
  tail -120 "$MONO_RESTORE_LOG" >&2 || true
  fail "monotonic restored VM did not report vmstate entropy reseed marker"
fi
MONO_T1_OUT=$(cli exec "$MONO_RESTORED" -- /mnt/helpers/vmstate-timer-probe monotonic)
MONO_T1=$(printf '%s\n' "$MONO_T1_OUT" | field now_ms)
[[ -n "$MONO_T1" ]] || fail "could not parse monotonic T1 from: $MONO_T1_OUT"
if (( MONO_T1 < MONO_T0 )); then
  fail "guest CLOCK_MONOTONIC rewound across restore ($MONO_T0 -> $MONO_T1)"
fi
MONO_DELTA=$((MONO_T1 - MONO_T0))
if (( MONO_DELTA >= HOST_SLEEP_MS )); then
  fail "guest CLOCK_MONOTONIC included full host downtime (${MONO_DELTA}ms >= ${HOST_SLEEP_MS}ms)"
fi
pass "guest monotonic advanced ${MONO_DELTA}ms, less than host sleep ${HOST_SLEEP_MS}ms"

section "TIMER-2 suspended nanosleep resumes with remaining guest time"
NANO_NAME="vmstate-timer-nano-$$"
NANO_LOG="$FIXTURE/nano-source.log"
NANO_SNAP="$FIXTURE/nano.snap"
NANO_SNAP_LOG="$FIXTURE/nano-snapshot.log"
NANO_RESTORE_LOG="$FIXTURE/nano-restore.log"
boot_bg "$NANO_NAME" "$NANO_LOG" \
  --mount "$HELPERS_DIR:/mnt/helpers" -- \
  /mnt/helpers/vmstate-timer-probe nanosleep "$TIMER_MS" >/dev/null
if ! wait_for_vm "$NANO_NAME" 45 || ! wait_log "$NANO_LOG" "VMSTATE_TIMER_READY kind=nanosleep" 45; then
  tail -120 "$NANO_LOG" >&2 || true
  fail "nanosleep source VM did not reach READY"
fi
pass "nanosleep armed inside guest"
snapshot_vm "$NANO_NAME" "$NANO_SNAP" "$NANO_SNAP_LOG"
sleep "$HOST_SLEEP"
restore_bg "$NANO_RESTORE_LOG" "$NANO_SNAP" >/dev/null
NANO_RESTORED=""
if ! wait_for_restore_child "$NANO_NAME" NANO_RESTORED 60; then
  tail -120 "$NANO_RESTORE_LOG" >&2 || true
  fail "nanosleep restored VM never registered"
fi
if ! wait_log "$NANO_RESTORE_LOG" "VMSTATE_TIMER_DONE kind=nanosleep" $((HOST_SLEEP + TIMER_MS / 1000 + 45)); then
  tail -160 "$NANO_RESTORE_LOG" >&2 || true
  fail "nanosleep did not complete after restore"
fi
NANO_DONE=$(grep "VMSTATE_TIMER_DONE kind=nanosleep" "$NANO_RESTORE_LOG" | tail -1)
NANO_ELAPSED=$(printf '%s\n' "$NANO_DONE" | field elapsed_ms)
[[ -n "$NANO_ELAPSED" ]] || fail "could not parse nanosleep elapsed_ms from: $NANO_DONE"
assert_between "nanosleep guest elapsed" "$NANO_ELAPSED" "$TIMER_MIN_MS" "$TIMER_MAX_MS"

section "TIMER-3 timerfd deadline waits after restore instead of firing immediately"
TFD_NAME="vmstate-timerfd-$$"
TFD_LOG="$FIXTURE/timerfd-source.log"
TFD_SNAP="$FIXTURE/timerfd.snap"
TFD_SNAP_LOG="$FIXTURE/timerfd-snapshot.log"
TFD_RESTORE_LOG="$FIXTURE/timerfd-restore.log"
boot_bg "$TFD_NAME" "$TFD_LOG" \
  --mount "$HELPERS_DIR:/mnt/helpers" -- \
  /mnt/helpers/vmstate-timer-probe timerfd "$TIMER_MS" >/dev/null
if ! wait_for_vm "$TFD_NAME" 45 || ! wait_log "$TFD_LOG" "VMSTATE_TIMER_READY kind=timerfd" 45; then
  tail -120 "$TFD_LOG" >&2 || true
  fail "timerfd source VM did not reach READY"
fi
pass "timerfd armed inside guest"
snapshot_vm "$TFD_NAME" "$TFD_SNAP" "$TFD_SNAP_LOG"
sleep "$HOST_SLEEP"
restore_bg "$TFD_RESTORE_LOG" "$TFD_SNAP" >/dev/null
TFD_RESTORED=""
if ! wait_for_restore_child "$TFD_NAME" TFD_RESTORED 60; then
  tail -120 "$TFD_RESTORE_LOG" >&2 || true
  fail "timerfd restored VM never registered"
fi
if ! wait_log "$TFD_RESTORE_LOG" "VMSTATE_TIMER_DONE kind=timerfd" $((HOST_SLEEP + TIMER_MS / 1000 + 45)); then
  tail -160 "$TFD_RESTORE_LOG" >&2 || true
  fail "timerfd did not fire after restore"
fi
TFD_DONE=$(grep "VMSTATE_TIMER_DONE kind=timerfd" "$TFD_RESTORE_LOG" | tail -1)
TFD_ELAPSED=$(printf '%s\n' "$TFD_DONE" | field elapsed_ms)
TFD_EXP=$(printf '%s\n' "$TFD_DONE" | field expirations)
[[ -n "$TFD_ELAPSED" ]] || fail "could not parse timerfd elapsed_ms from: $TFD_DONE"
[[ "$TFD_EXP" == "1" ]] || fail "timerfd reported expirations=$TFD_EXP, expected 1"
assert_between "timerfd guest elapsed" "$TFD_ELAPSED" "$TIMER_MIN_MS" "$TIMER_MAX_MS"

section "timer smoke complete"
pass "vmstate timer smoke repros passed"
