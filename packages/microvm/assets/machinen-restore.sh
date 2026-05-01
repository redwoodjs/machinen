#!/bin/sh
# /sbin/machinen-restore — restores a CRIU dump from /dev/vda and
# supervises the restored workload until it exits.
#
# Invoked as /init's direct child (via cmd=["/sbin/machinen-restore"]
# synthesized by the runtime when boot() gets an opts.snapshot but
# no opts.cmd). Counterpart of /sbin/machinen-supervisor — same
# "restore vsock + wait + poweroff" shape, just with the workload
# coming from a CRIU image set instead of a fresh fork+execve.

set -eu

# Debian's dash defaults PATH to /usr/bin:/bin when unset, which
# leaves criu (in /usr/sbin) unreachable. Export a broad PATH
# regardless of what /init's envp carried.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# Bring up loopback so the restored processes see a live lo interface.
# Some workloads fail their first syscall after restore if lo is DOWN
# (TCP kerndat, IPv6 probes, etc.).
/sbin/machinen-lo-up || echo "machinen-restore: lo-up failed" >&2

# /tmp must exist for CRIU's kerndat probes (kerndat_has_move_mount_set_group
# mkdirs `/tmp/.criu.move_mount_set_group.XXXXXX`). The base rootfs ships
# /tmp 1777, but be defensive in case a layered image (app.tar.gz) stripped
# it — without /tmp here, criu restore fails kerndat init, exits 1, and
# /init dying with that exit code panics the kernel ("Attempted to kill
# init!"), which is a much more confusing failure than a clean error.
mkdir -p /tmp /run
chmod 1777 /tmp 2>/dev/null || true

# Spawn a fresh exec-agent so vm.exec / vm.snapshot work on the
# restored VM. The original dump tree did NOT include exec-agent —
# that was a sibling under the supervisor, not a descendant of the
# workload — so vsock port 1978 is unclaimed after restore.
/exec-agent </dev/null >/dev/null 2>&1 &
AGENT_PID=$!

# winsize-agent (vsock 1974, see #177) — sibling of the restored
# workload, mirrors what the supervisor does on a fresh boot. Optional.
WINSIZE_PID=""
if [ -x /sbin/machinen-winsize-agent ]; then
    /sbin/machinen-winsize-agent </dev/null >/dev/null 2>&1 &
    WINSIZE_PID=$!
fi

# Mount the CRIU image store. Pick /dev/vdb when virtio-blk-root booted
# (rootfs took /dev/vda); else /dev/vda for the legacy single-disk
# layout. See #114.
if [ -b /dev/vdb ]; then
    SCRATCH=/dev/vdb
else
    SCRATCH=/dev/vda
fi

# Mount the bundle disk at /mnt/snap-src (NOT /mnt/snap) so a future
# `machinen snapshot` against the restored VM can use /mnt/snap as its
# own scratch mountpoint without colliding (#207). machinen-dump.sh
# unmounts /mnt/snap-src before re-formatting the disk for the new dump;
# see that script for the cleanup.
mkdir -p /mnt/snap-src
if ! blkid "$SCRATCH" 2>/dev/null | grep -q ext4; then
    echo "machinen-restore: $SCRATCH is not ext4 — aborting" >&2
    exit 1
fi
mount -o ro "$SCRATCH" /mnt/snap-src
if [ ! -d /mnt/snap-src/img ] || [ -z "$(ls -A /mnt/snap-src/img 2>/dev/null)" ]; then
    echo "machinen-restore: no images at /mnt/snap-src/img — aborting" >&2
    exit 1
fi

echo "machinen-restore: starting criu restore"
# No `unshare --pid` (#207): the original layout put criu in a fresh
# PID namespace so dumped PIDs couldn't collide with anything in the
# restore container, but that left the restored workload one namespace
# below where /sbin/machinen-dump runs — making it impossible to dump
# again. We're PID 1 with only exec-agent / winsize-agent (low PIDs)
# alongside us, dumped workload PIDs are typically much higher, so
# collisions are rare in practice. If they happen, criu surfaces a
# clear error instead of corrupting state.
#
# --pidfile writes the restored task's host PID to a file we can hand
# to a future `criu dump --tree <pid>`. Counterpart of what
# machinen-supervisor.sh writes from its inner sh -c on a fresh boot;
# same path so machinen-dump finds either flavor uniformly.
#
# No -d: block until the restored tree's session leader exits, so this
# shell (PID 1) stays alive for the life of the workload and can
# trigger a clean poweroff afterwards.
if ! criu restore \
        --images-dir /mnt/snap-src/img \
        --shell-job \
        --tcp-established \
        --pidfile /run/machinen-workload.pid \
        -v3 \
        -o restore.log; then
    echo "machinen-restore: CRIU restore failed — tail of restore.log:" >&2
    tail -40 /mnt/snap-src/img/restore.log >&2 || true
    kill -TERM "$AGENT_PID" 2>/dev/null || true
    if [ -n "$WINSIZE_PID" ]; then
        kill -TERM "$WINSIZE_PID" 2>/dev/null || true
    fi
    exit 1
fi

# Restored tree exited cleanly. Stop the agents and power off.
kill -TERM "$AGENT_PID" 2>/dev/null || true
wait "$AGENT_PID" 2>/dev/null || true
if [ -n "$WINSIZE_PID" ]; then
    kill -TERM "$WINSIZE_PID" 2>/dev/null || true
    wait "$WINSIZE_PID" 2>/dev/null || true
fi
exec /sbin/machinen-poweroff
