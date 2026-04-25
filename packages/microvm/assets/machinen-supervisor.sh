#!/bin/sh
# /sbin/machinen-supervisor — runs the user workload under a tiny
# shell supervisor so the whole dump/restore story works.
#
# Why this exists:
#   1. CRIU can't cleanly dump a process that's PID 1 in its namespace.
#      By keeping the supervisor as PID 1 and running the user
#      workload as its child, `/sbin/machinen-dump` gets a tree it
#      can capture with `criu dump --tree <pid>`.
#   2. The exec-agent (vsock listener on port 1978) needs to stay
#      alive alongside the workload so vm.exec / vm.snapshot from
#      the host work for any cmd — not just when the user cmd
#      happens to be /exec-agent itself. This script spawns it.
#   3. Clean power-off on workload exit replaces kernel-panic-on-
#      /init-exit. The VMM exits with code 0 instead of the kernel
#      re-resetting us.
#
# Invocation: the runtime synthesizes machinen-config.json with
# cmd=["/sbin/machinen-supervisor", ...userCmd]. /init exec's this
# script with the user argv appended.
#
# Skipped when the user cmd is /exec-agent directly (the provision
# flow) — in that case the user cmd IS the vsock agent and we don't
# want to double-spawn. The runtime handles that decision; we just
# do the work.

set -u

# Spawn exec-agent in the background. Stderr from the agent isn't
# interesting to the end user during normal use; redirect to /dev/null
# so it doesn't interleave with the workload's output. If it dies
# early (bind failure, etc.) the workload still runs — vm.exec just
# won't answer, which is the same failure mode as today.
/exec-agent </dev/null >/dev/null 2>&1 &
AGENT_PID=$!

# `--session` runs the workload under setsid so CRIU can dump it.
# Without its own session, the workload inherits the supervisor's,
# and `criu dump --shell-job` fails with "A session leader of N(N)
# is outside of its pid namespace" because the session leader
# (supervisor) lives outside the dump tree. The runtime passes
# --session when opts.snapshot is set (the VM is going to be
# dumped); interactive boots skip it so Ctrl-C / job-control still
# work against the console.
USE_SETSID=0
if [ "${1:-}" = "--session" ]; then
    USE_SETSID=1
    shift
fi

if [ "$USE_SETSID" = "1" ]; then
    /usr/bin/setsid "$@" &
else
    "$@" &
fi
PID=$!
mkdir -p /run 2>/dev/null || true
printf '%s' "$PID" > /run/machinen-workload.pid 2>/dev/null || true

# Propagate SIGTERM / SIGINT to the workload so host-side vm.kill()
# and Ctrl-C from the console signal the right process.
trap 'kill -TERM "$PID" 2>/dev/null; wait "$PID"' TERM INT

wait "$PID"

# Workload exited — stop the agent and power off cleanly.
kill -TERM "$AGENT_PID" 2>/dev/null || true
wait "$AGENT_PID" 2>/dev/null || true
exec /sbin/machinen-poweroff
