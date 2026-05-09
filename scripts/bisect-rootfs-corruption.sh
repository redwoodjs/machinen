#!/usr/bin/env bash
# Bisect the snapshot/restore cycle to find which step introduces
# rootfs corruption. Boots a fresh VM, snapshots/restores it twice,
# and at every generation:
#   • hashes a curated file list from inside the guest
#   • runs e2fsck (read-only) against the host-side rootdisk reflink
#   • debugfs-cats /usr/bin/dd's first 64 bytes from the host's view
# The hash file at each generation is diff'd against the previous so
# the offending step pops out as the first non-empty diff.
#
# Usage: bash scripts/bisect-rootfs-corruption.sh

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CLI="$ROOT/packages/cli/dist/cli.js"
ASSETS="$ROOT/release-assets"
TARBALL="${1:-$ASSETS/rootfs-debian-arm64.tar.gz}"
WORKLOAD_CMD="${WORKLOAD_CMD:-/bin/sh -c 'while true; do sleep 60; done'}"
DEBUGFS=/opt/homebrew/opt/e2fsprogs/sbin/debugfs
E2FSCK=/opt/homebrew/opt/e2fsprogs/sbin/e2fsck

[[ -f "$CLI"     ]] || { echo "missing $CLI — pnpm build first" >&2; exit 1; }
[[ -f "$TARBALL" ]] || { echo "missing $TARBALL — bash scripts/build-base-assets.sh" >&2; exit 1; }
[[ -x "$DEBUGFS" ]] || { echo "missing $DEBUGFS — brew install e2fsprogs" >&2; exit 1; }

export MACHINEN_ASSETS_DIR="$ASSETS"
export MACHINEN_REGISTRY_DIR="${MACHINEN_REGISTRY_DIR:-$(mktemp -d)/registry}"
mkdir -p "$MACHINEN_REGISTRY_DIR"

WORK=$(mktemp -d)
echo "work dir: $WORK"

NAME=""; REST_A=""; REST_B=""
cleanup() {
  for n in "$NAME" "$REST_A" "$REST_B"; do
    [[ -n "$n" ]] && node "$CLI" stop --name "$n" 2>/dev/null || true
  done
}
trap cleanup EXIT

cli() { node "$CLI" "$@"; }

# Find the per-boot rootdisk reflink for a given vm name. The runtime
# names them `machinen-rootdisk-<owner-pid>-<rand>.img`; we resolve via
# lsof against the live VMM.
rootdisk_for() {
  local pid
  pid=$(cli ls 2>/dev/null | awk -v n="$1" 'NR>1 && $2==n {print $1; exit}')
  [[ -z "$pid" ]] && { echo "" ; return; }
  local vmm_pid
  vmm_pid=$(pgrep -P "$pid" 2>/dev/null | head -1)
  [[ -z "$vmm_pid" ]] && vmm_pid=$pid
  lsof -p "$vmm_pid" 2>/dev/null \
    | awk '/machinen-rootdisk-.*\.img/ {print $NF; exit}'
}

# Hash the same curated set inside the guest at each generation.
# We use cat | md5sum so a broken md5sum surfaces as a hash of empty
# input ("d41d..."), not a script abort.
HASH_CMD='for f in /etc/passwd /etc/hostname /etc/debian_version /etc/os-release /usr/bin/dd /usr/bin/cat /usr/bin/ls /usr/bin/sh /usr/bin/tail /usr/bin/head /usr/bin/df /usr/bin/du /usr/bin/sync /usr/bin/wc /usr/bin/od /usr/bin/stat /sbin/machinen-dump /sbin/machinen-restore /init /exec-agent /fuse-agent; do if [ -e "$f" ]; then h=$(cat "$f" 2>/dev/null | md5sum 2>/dev/null | cut -d" " -f1); s=$(stat -c %s "$f" 2>/dev/null || echo "?"); else h="<missing>"; s="-"; fi; printf "%s %10s %s\n" "$h" "$s" "$f"; done'

# Capture all the per-generation diagnostics into one file and tee a
# short summary to stdout.
collect() {
  local label=$1 vm=$2
  echo
  echo "================ $label (vm=$vm) ================"
  # Registry registration races the supervisor + exec-agent boot.
  # Poll exec until it answers or 10s elapses.
  local probe_deadline=$((SECONDS + 15))
  while (( SECONDS < probe_deadline )); do
    cli exec --name "$vm" -- true >/dev/null 2>&1 && break
    sleep 0.5
  done
  local out="$WORK/$label.txt"
  {
    echo "--- guest hashes ---"
    cli exec --name "$vm" -- "$HASH_CMD" 2>&1 || echo "<exec failed>"
    echo
    local img
    img=$(rootdisk_for "$vm")
    echo "--- host rootdisk: $img ---"
    if [[ -n "$img" && -f "$img" ]]; then
      ls -la "$img"
      echo
      echo "--- debugfs: stat /usr/bin/dd ---"
      $DEBUGFS -R 'stat /usr/bin/dd' "$img" 2>&1 | tail -8 || true
      echo
      echo "--- debugfs: cat /usr/bin/dd | first 16 bytes (host view, want 7f45 4c46…) ---"
      $DEBUGFS -R 'cat /usr/bin/dd' "$img" 2>/dev/null | head -c 16 | xxd || true
      echo
      echo "--- e2fsck -fn (read-only, may be noisy on a live FS) ---"
      $E2FSCK -fn "$img" 2>&1 | head -10 || true
    else
      echo "<no rootdisk lsof match>"
    fi
  } > "$out"
  cat "$out"
}

# 1. Boot a fresh VM that runs forever.
NAME="bisect-$$"
LOG_BG="$WORK/boot.log"
echo "tarball : $TARBALL"
echo "workload: $WORKLOAD_CMD"
# shellcheck disable=SC2086 # WORKLOAD_CMD is intentional bare expansion
eval "node \"$CLI\" boot \"$TARBALL\" --name \"$NAME\" --memory 2048 -- $WORKLOAD_CMD" \
     >"$LOG_BG" 2>&1 &
BOOT_PID=$!

# Wait for VM to register.
deadline=$((SECONDS + 60))
while (( SECONDS < deadline )); do
  cli ls 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$NAME" && break
  sleep 1
done
cli ls 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$NAME" || {
  echo "VM $NAME never registered" >&2
  tail -40 "$LOG_BG" >&2
  exit 1
}

collect gen0-fresh-boot "$NAME"

# 2. Snapshot to bundle A. This stops the VM.
SNAP_A="$WORK/snap-A"
echo
echo "+++ snapshot $NAME -> $SNAP_A"
cli snapshot --name "$NAME" --out-dir "$SNAP_A" 2>&1 | tail -5
wait "$BOOT_PID" 2>/dev/null || true

# 3. Restore from A.
REST_A="restored-A-$$"
echo
echo "+++ restore $SNAP_A (lazy default)"
node "$CLI" restore "$SNAP_A" --name "$REST_A" \
     >"$WORK/restore-A.log" 2>&1 &
RESTORE_A_PID=$!

deadline=$((SECONDS + 60))
while (( SECONDS < deadline )); do
  cli ls 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$REST_A" && break
  sleep 1
done
cli ls 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$REST_A" || {
  echo "restored VM $REST_A never registered" >&2
  tail -40 "$WORK/restore-A.log" >&2
  exit 1
}

collect gen1-restored-from-A "$REST_A"

# 4. Snapshot the restored VM (chained) to bundle B.
SNAP_B="$WORK/snap-B"
echo
echo "+++ chained snapshot $REST_A -> $SNAP_B"
cli snapshot --name "$REST_A" --out-dir "$SNAP_B" 2>&1 | tail -10 || {
  echo "<chained snapshot failed — diffs below stop here>"
  REST_B=""
}
wait "$RESTORE_A_PID" 2>/dev/null || true

# 5. Restore from B (only if snapshot succeeded).
REST_B=""
if [[ -d "$SNAP_B/img" ]] && ls "$SNAP_B/img"/core-*.img >/dev/null 2>&1; then
  REST_B="restored-B-$$"
  echo
  echo "+++ restore $SNAP_B"
  node "$CLI" restore "$SNAP_B" --name "$REST_B" \
       >"$WORK/restore-B.log" 2>&1 &
  RESTORE_B_PID=$!

  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    cli ls 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$REST_B" && break
    sleep 1
  done
  if cli ls 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$REST_B"; then
    collect gen2-restored-from-B "$REST_B"
  else
    echo "restored-from-B VM never registered" >&2
    tail -40 "$WORK/restore-B.log" >&2
  fi
fi

# 6. Diff the guest-hash blocks across generations.
echo
echo "================ summary diffs (guest hash columns only) ================"
extract() { sed -n '/^--- guest hashes ---$/,/^$/p' "$1" | sed '1d;$d'; }

g0="$WORK/gen0-fresh-boot.txt"
g1="$WORK/gen1-restored-from-A.txt"
g2="$WORK/gen2-restored-from-B.txt"
[[ -f "$g0" ]] && extract "$g0" >"$WORK/h0.txt"
[[ -f "$g1" ]] && extract "$g1" >"$WORK/h1.txt"
[[ -f "$g2" ]] && extract "$g2" >"$WORK/h2.txt"

if [[ -f "$WORK/h0.txt" && -f "$WORK/h1.txt" ]]; then
  echo "--- gen0 vs gen1 (snapshot A → restore A) ---"
  diff "$WORK/h0.txt" "$WORK/h1.txt" || true
fi
if [[ -f "$WORK/h1.txt" && -f "$WORK/h2.txt" ]]; then
  echo "--- gen1 vs gen2 (chained snapshot B → restore B) ---"
  diff "$WORK/h1.txt" "$WORK/h2.txt" || true
fi

echo
echo "all per-gen diagnostics in: $WORK"
