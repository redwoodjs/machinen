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

# Spawn winsize-agent (vsock 1974, see #177) as a SIBLING of the
# workload — never as a descendant. CRIU 3.17 has no AF_VSOCK dump
# support; any vsock fd inside the workload tree breaks `criu dump`
# with "BUG! Unknown socket collected (family 40)". Putting the agent
# here, alongside exec-agent, keeps it outside `criu dump --tree
# <workload-pid>` so snapshot just works on VMs that asked the runtime
# to bridge in:1974. Optional — older rootfs builds (or callers that
# didn't include the agent) just skip this. Same /dev/null teardown
# pattern as exec-agent so workload stdout stays clean.
WINSIZE_PID=""
if [ -x /sbin/machinen-winsize-agent ]; then
    /sbin/machinen-winsize-agent </dev/null >/dev/null 2>&1 &
    WINSIZE_PID=$!
fi

mkdir -p /run 2>/dev/null || true
# /tmp is required by CRIU's kerndat probes (mkdir under /tmp on every
# `criu dump` AND `criu restore`), and by lots of other software that
# expects a sticky-writable scratch dir. The base rootfs ships it 1777,
# but layered images (app.tar.gz produced by provision.ts intentionally
# excludes ./tmp) drop it on the floor — without this `machinen
# snapshot` and any restore both fail kerndat init. Universal fix: make
# the supervisor responsible for the directory's existence so any
# rootfs the runtime boots gets a usable /tmp before the workload runs.
mkdir -p /tmp /var/tmp 2>/dev/null || true
chmod 1777 /tmp /var/tmp 2>/dev/null || true

# `--session` is the legacy "run under setsid" toggle from when CRIU
# dumps required it but interactive boots didn't. Both modes now go
# through the same `setsid -c -w` path below — see the rationale block —
# so the flag is just consumed and discarded for back-compat.
if [ "${1:-}" = "--session" ]; then
    shift
fi

# Run the workload under `setsid -c -w` with stdio bound to /dev/console:
#
#   - `setsid` puts the workload in a brand-new session as leader.
#     Required for CRIU `--shell-job` to dump cleanly: without it the
#     session leader (supervisor) lives outside the dump tree and
#     CRIU bails with "A session leader of N(N) is outside of its
#     pid namespace".
#   - `-c` (TIOCSCTTY) claims /dev/console as the new session's
#     controlling terminal. Without this, backgrounding with `&` puts
#     the workload in a process group that isn't the foreground of
#     /dev/console — `/bin/sh -i` reads return EIO (orphaned pgrp),
#     it prints the prompt once and exits, the supervisor's `wait`
#     returns, and machinen-poweroff fires before the user types
#     anything.
#   - `-w` makes setsid(1) `wait` for the workload after the fork
#     it has to perform when invoked from a process-group leader (we
#     are one, courtesy of `&`). Without `-w`, the parent setsid
#     forks, exits immediately, and `wait "$!"` returns before the
#     workload starts — orphaning it under PID 1 and dropping the
#     trap target.
#   - Explicit </dev/console redirect ensures fd 0 is a tty when
#     setsid runs (`-c` reads ctty from stdin).
#
# The inner `sh -c` writes /run/machinen-workload.pid using its own
# $$ — which, because it then `exec`s the workload, IS the workload's
# PID. Doing it here (rather than from the supervisor with $!) is
# essential: $! points at the parent setsid, which has already exited.
# That PID is what machinen-dump feeds to `criu dump --tree`, so
# getting it wrong dumps a dead PID and CRIU bails with exit 32.
/usr/bin/setsid -c -w sh -c \
    'printf "%s" "$$" > /run/machinen-workload.pid; exec "$@"' \
    inner "$@" </dev/console >/dev/console 2>/dev/console &
PID=$!

# Propagate SIGTERM / SIGINT to the workload so host-side vm.kill()
# and Ctrl-C from the console signal the right process. Read the pid
# from the file rather than $! because $! is the setsid wrapper, not
# the workload (see comment above).
trap 'kill -TERM "$(cat /run/machinen-workload.pid 2>/dev/null)" 2>/dev/null; wait "$PID"' TERM INT

wait "$PID"

# Workload exited — stop the agents and power off cleanly.
kill -TERM "$AGENT_PID" 2>/dev/null || true
wait "$AGENT_PID" 2>/dev/null || true
if [ -n "$WINSIZE_PID" ]; then
    kill -TERM "$WINSIZE_PID" 2>/dev/null || true
    wait "$WINSIZE_PID" 2>/dev/null || true
fi
exec /sbin/machinen-poweroff
