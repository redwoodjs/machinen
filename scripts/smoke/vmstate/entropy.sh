#!/usr/bin/env bash
# Vmstate entropy smoke repros (#366).

set -euo pipefail
# shellcheck source=./common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

vmstate_smoke_init entropy

field() {
  local key=$1
  awk -v key="$key" '{ for (i = 1; i <= NF; i++) { split($i, a, "="); if (a[1] == key) { print a[2]; exit } } }'
}

entropy_hex() {
  local name=$1
  local kind=$2
  local out hex
  out=$(cli exec "$name" -- /mnt/helpers/vmstate-entropy-probe "$kind" 64)
  hex=$(printf '%s\n' "$out" | field hex)
  if [[ -z "$hex" ]]; then
    echo "$out" >&2
    fail "could not parse $kind entropy output from $name"
  fi
  printf '%s' "$hex"
}

assert_distinct() {
  local label=$1 a=$2 b=$3
  if [[ "$a" == "$b" ]]; then
    fail "$label produced duplicate random stream $a"
  fi
  pass "$label produced distinct random streams"
}

section "ENTROPY-1 restore-time vmstate reseed marker is present"
SRC_NAME="vmstate-entropy-src-$$"
SRC_LOG="$FIXTURE/entropy-source.log"
SNAP_DIR="$FIXTURE/entropy.snap"
SNAP_LOG="$FIXTURE/entropy-snapshot.log"
boot_bg "$SRC_NAME" "$SRC_LOG" \
  --mount "$HELPERS_DIR:/mnt/helpers" -- \
  /bin/sh -c 'while :; do sleep 1; done' >/dev/null
if ! wait_for_vm "$SRC_NAME" 45; then
  tail -100 "$SRC_LOG" >&2 || true
  fail "entropy source VM never registered"
fi
pass "source VM registered before any post-restore random read"
snapshot_vm "$SRC_NAME" "$SNAP_DIR" "$SNAP_LOG"
pass "vmstate bundle captured"

section "ENTROPY-2 restoring the same bundle twice diverges /dev/urandom"
R1="vmstate-entropy-restore-a-$$"
R2="vmstate-entropy-restore-b-$$"
R1_LOG="$FIXTURE/entropy-restore-a.log"
R2_LOG="$FIXTURE/entropy-restore-b.log"
restore_bg "$R1_LOG" "$SNAP_DIR" --name "$R1" >/dev/null
register_vm_name "$R1"
restore_bg "$R2_LOG" "$SNAP_DIR" --name "$R2" >/dev/null
register_vm_name "$R2"
if ! wait_for_vm "$R1" 60 || ! wait_for_vm "$R2" 60; then
  tail -120 "$R1_LOG" >&2 || true
  tail -120 "$R2_LOG" >&2 || true
  fail "one of the entropy restores did not register"
fi
if ! wait_for_reseed "$R1" 60 || ! wait_for_reseed "$R2" 60; then
  tail -120 "$R1_LOG" >&2 || true
  tail -120 "$R2_LOG" >&2 || true
  fail "restore-time entropy reseed marker missing"
fi
pass "both restored VMs have /run/machinen-vmstate-reseed"
R1_URANDOM=$(entropy_hex "$R1" urandom)
R2_URANDOM=$(entropy_hex "$R2" urandom)
assert_distinct "/dev/urandom duplicate-restore check" "$R1_URANDOM" "$R2_URANDOM"

section "ENTROPY-3 restoring the same bundle twice diverges getrandom(2)"
R1_GETRANDOM=$(entropy_hex "$R1" getrandom)
R2_GETRANDOM=$(entropy_hex "$R2" getrandom)
assert_distinct "getrandom(2) duplicate-restore check" "$R1_GETRANDOM" "$R2_GETRANDOM"

section "ENTROPY-4 vmstate forks from the same source point diverge"
FORK_A="vmstate-entropy-fork-a-$$"
FORK_B="vmstate-entropy-fork-b-$$"
FORK_A_LOG="$FIXTURE/entropy-fork-a.log"
FORK_B_LOG="$FIXTURE/entropy-fork-b.log"
FORK_A_BUNDLE="$FIXTURE/entropy-fork-a.snap"
FORK_B_BUNDLE="$FIXTURE/entropy-fork-b.snap"
fork_detached "$SRC_NAME" "$FORK_A" "$FORK_A_LOG" --out-dir "$FORK_A_BUNDLE"
fork_detached "$SRC_NAME" "$FORK_B" "$FORK_B_LOG" --out-dir "$FORK_B_BUNDLE"
if ! wait_for_vm "$FORK_A" 60 || ! wait_for_vm "$FORK_B" 60; then
  tail -120 "$FORK_A_LOG" >&2 || true
  tail -120 "$FORK_B_LOG" >&2 || true
  fail "one of the entropy forks did not register"
fi
if ! wait_for_reseed "$FORK_A" 60 || ! wait_for_reseed "$FORK_B" 60; then
  tail -120 "$FORK_A_LOG" >&2 || true
  tail -120 "$FORK_B_LOG" >&2 || true
  fail "fork restore-time entropy reseed marker missing"
fi
FORK_A_RANDOM=$(entropy_hex "$FORK_A" getrandom)
FORK_B_RANDOM=$(entropy_hex "$FORK_B" getrandom)
assert_distinct "vmstate fork getrandom(2) check" "$FORK_A_RANDOM" "$FORK_B_RANDOM"
if [[ "$FORK_A_RANDOM" == "$R1_GETRANDOM" || "$FORK_B_RANDOM" == "$R1_GETRANDOM" ]]; then
  fail "fork random stream matched an earlier restore stream"
fi
pass "fork streams also differ from earlier restore stream"

section "entropy smoke complete"
pass "vmstate entropy smoke repros passed"
