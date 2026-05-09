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

# Label the guest with the VM's name so an interactive shell prompt
# (\h in bash's default Debian PS1) shows which VM is attached. The
# runtime injects MACHINEN_VM_NAME via machinen-config.json when the
# caller passed --name; nameless boots leave the hostname unchanged.
# `hostname` here is a no-op if the binary is missing or the value
# fails validation — we never want a prompt cosmetic to break boot.
if [ -n "${MACHINEN_VM_NAME:-}" ]; then
    hostname "$MACHINEN_VM_NAME" 2>/dev/null || true
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

# Tell the user what we're about to run. Goes to /dev/ttyAMA0 alongside
# the kernel's init checkpoints so it shows up in the boot stream.
printf 'supervisor: starting cmd=%s\n' "$*" > /dev/ttyAMA0

# /sbin/machinen-no-iou: seccomp-bpf shim that returns ENOSYS for the
# io_uring_setup/_enter/_register triple. Wraps every workload because
# Node 24+'s libuv opens an io_uring instance unconditionally on
# recent kernels, and CRIU (master through v4.2) has no support for
# dumping anon_inode:[io_uring] mappings — proc_parse.c bails with
# "Unknown shit … anon_inode:[io_uring]" mid-dump. With the shim,
# libuv's startup probe gets ENOSYS, falls back to its epoll +
# threadpool path (the only path that existed pre-libuv-1.45), and
# the process becomes dumpable. Filter is inherited across execve
# and into every fork, so the user cmd and all its children are
# covered. Cost on workloads that never call io_uring: a couple of
# BPF compare instructions per syscall — unmeasurable.
#
# Run the workload under `setsid -c -w` with stdio bound to /dev/ttyAMA0:
#
#   - `setsid` puts the workload in a brand-new session as leader.
#     The session leader IS the dump tree's root, so CRIU has the
#     full session info in-tree and we don't need --shell-job.
#   - `-c` (TIOCSCTTY) claims the tty on fd 0 as the new session's
#     controlling terminal. Without this, backgrounding with `&` puts
#     the workload in a process group that isn't the tty's foreground
#     PG — `/bin/sh -i` reads return EIO (orphaned pgrp), it prints
#     the prompt once and exits, the supervisor's `wait` returns, and
#     machinen-poweroff fires before the user types anything.
#   - We bind to **/dev/ttyAMA0** (the real PL011 tty), not
#     /dev/console (the kernel's virtual console proxy). CRIU can't
#     reliably round-trip the foreground-PG state on /dev/console:
#     a forked VM ended up with `tpgid=-1` so VINTR/VSUSP fired in
#     the kernel but went nowhere — Ctrl-C/Ctrl-Z became no-ops in
#     the restored shell. /dev/ttyAMA0 is a regular tty inode that
#     CRIU restores cleanly.
#   - `-w` makes setsid(1) `wait` for the workload after the fork
#     it has to perform when invoked from a process-group leader (we
#     are one, courtesy of `&`). Without `-w`, the parent setsid
#     forks, exits immediately, and `wait "$!"` returns before the
#     workload starts — orphaning it under PID 1 and dropping the
#     trap target.
#   - Explicit </dev/ttyAMA0 redirect ensures fd 0 is a tty when
#     setsid runs (`-c` reads ctty from stdin).
#
# The inner `sh -c` writes /run/machinen-workload.pid using its own
# $$ — which, because it then `exec`s the no-iou shim (which then
# execvp's the user cmd), IS the workload's PID. Both `exec` calls
# preserve the pid, so the value in the pidfile is what `criu dump
# --tree` ends up dumping. Doing it here (rather than from the
# supervisor with $!) is essential: $! points at the parent setsid,
# which has already exited. Wrong pid = CRIU dumps a dead pid and
# bails with exit 32.
/usr/bin/setsid -c -w sh -c \
    'printf "%s" "$$" > /run/machinen-workload.pid; exec /sbin/machinen-no-iou "$@"' \
    inner "$@" </dev/ttyAMA0 >/dev/ttyAMA0 2>/dev/ttyAMA0 &
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
