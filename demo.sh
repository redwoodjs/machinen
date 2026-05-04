#!/usr/bin/env bash
# Handoff demo automation. Three panes:
#
#   Pane A (this Mac)  — pnpm vm, then inside the VM:
#                          cd ~
#                          tmux new -s c -- claude
#                        seed claude with: "Remember the secret word: kingfisher."
#                        leave the tmux session attached so the audience sees it.
#
#   Pane B (this Mac)  — ./demo.sh
#                        Auto-detects the VM, snapshots, scp's, polls for the
#                        restore on the remote, then sends the question to the
#                        restored claude and prints its answer.
#
#   Pane C (remote)    — ssh friend@100.126.46.90; when this script tells you to,
#                        run `machinen restore /tmp/machinen-handoff` and watch
#                        claude wake up on the new host.
#
# CWD warning: pnpm vm auto-cd's into /mnt/workspace, a live FUSE mount. Snapshot
# fails on restore if the workload's CWD is on that mount. `cd ~` first.
set -euo pipefail

REMOTE="${REMOTE:-friend@100.126.46.90}"
TMUX_SESSION="${TMUX_SESSION:-c}"
QUESTION="${QUESTION:-what was the secret word?}"
REMOTE_DIR="${REMOTE_DIR:-/tmp/machinen-handoff}"
ANSWER_WAIT="${ANSWER_WAIT:-8}"

cyan()  { printf "\033[36m==> %s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m!! %s\033[0m\n" "$*" >&2; }

cyan "preflight"

PID=$(pgrep -f 'node vm.ts' | head -n1 || true)
if [[ -z "$PID" ]]; then
  red "no source VM running (pgrep -f 'node vm.ts' empty)"
  red "start one in pane A: pnpm vm"
  exit 1
fi
echo "   source VM pid: $PID"

if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "$REMOTE" true 2>/dev/null; then
  red "ssh $REMOTE failed (Tailscale up? key authorized?)"
  exit 1
fi
echo "   ssh $REMOTE: ok"

if ! ssh "$REMOTE" 'command -v machinen >/dev/null'; then
  red "machinen CLI missing on $REMOTE"
  red "install: ssh $REMOTE 'npm i -g @machinen/cli'"
  exit 1
fi
echo "   machinen on remote: ok"

# Snapshot the set of running VMs on the remote BEFORE the restore so we
# can spot the new entry that appears after pane C runs `machinen restore`.
BASELINE_PIDS="$(ssh "$REMOTE" "machinen ls 2>/dev/null | awk 'NR>1 {print \$1}'" | sort -u || true)"
echo "   remote VMs already running: $(echo "$BASELINE_PIDS" | grep -c . || echo 0)"

cyan "snapshot pid=$PID (--keep-alive)"
LOCAL_DIR="$(mktemp -d -t machinen-handoff-XXXX)"
machinen snapshot --pid "$PID" --out-dir "$LOCAL_DIR" --keep-alive
echo "   bundle: $LOCAL_DIR ($(du -sh "$LOCAL_DIR" | cut -f1))"

cyan "scp -> $REMOTE:$REMOTE_DIR"
ssh "$REMOTE" "rm -rf $REMOTE_DIR && mkdir -p $REMOTE_DIR"
scp -rq "$LOCAL_DIR"/. "$REMOTE:$REMOTE_DIR/"

echo
green "  >>> in pane C, run:  machinen restore $REMOTE_DIR"
echo

cyan "polling $REMOTE for the restored VM..."
REMOTE_PID=""
for _ in $(seq 1 120); do
  CURRENT_PIDS="$(ssh "$REMOTE" "machinen ls 2>/dev/null | awk 'NR>1 {print \$1}'" | sort -u || true)"
  NEW="$(comm -13 <(echo "$BASELINE_PIDS") <(echo "$CURRENT_PIDS") | grep . || true)"
  if [[ -n "$NEW" ]]; then
    REMOTE_PID="$(echo "$NEW" | head -n1)"
    break
  fi
  sleep 1
done
if [[ -z "$REMOTE_PID" ]]; then
  red "timed out after 120s waiting for restore on $REMOTE"
  exit 1
fi
echo "   restored remote pid: $REMOTE_PID"

# Give the restored kernel/process tree a beat to settle before driving claude.
sleep 2

cyan "asking claude (tmux session '$TMUX_SESSION'): $QUESTION"
ssh "$REMOTE" "machinen exec --pid $REMOTE_PID -- bash -lc \"tmux send-keys -t $TMUX_SESSION $(printf %q "$QUESTION") Enter\""

cyan "waiting ${ANSWER_WAIT}s for claude to answer..."
sleep "$ANSWER_WAIT"

echo
green "remote claude pane:"
echo "----------------------------------------"
ssh "$REMOTE" "machinen exec --pid $REMOTE_PID -- bash -lc \"tmux capture-pane -t $TMUX_SESSION -p\"" | tail -40
echo "----------------------------------------"
