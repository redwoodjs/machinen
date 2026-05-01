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
# leaves criu-ns (in /usr/sbin) unreachable. Export a broad PATH
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
mkdir -p /tmp
chmod 1777 /tmp 2>/dev/null || true

# Spawn a fresh exec-agent so vm.exec / vm.snapshot work on the
# restored VM. The original dump tree did NOT include exec-agent —
# that was a sibling under the supervisor, not a descendant of the
# workload — so vsock port 1978 is unclaimed after restore.
/exec-agent </dev/null >/dev/null 2>&1 &
AGENT_PID=$!

# Mount the CRIU image store. Pick /dev/vdb when virtio-blk-root booted
# (rootfs took /dev/vda); else /dev/vda for the legacy single-disk
# layout. See #114.
if [ -b /dev/vdb ]; then
    SCRATCH=/dev/vdb
else
    SCRATCH=/dev/vda
fi

mkdir -p /mnt/snap
if ! blkid "$SCRATCH" 2>/dev/null | grep -q ext4; then
    echo "machinen-restore: $SCRATCH is not ext4 — aborting" >&2
    exit 1
fi
mount "$SCRATCH" /mnt/snap
if [ ! -d /mnt/snap/img ] || [ -z "$(ls -A /mnt/snap/img 2>/dev/null)" ]; then
    echo "machinen-restore: no images at /mnt/snap/img — aborting" >&2
    exit 1
fi

echo "machinen-restore: starting criu restore in a fresh pid namespace"
# `criu-ns` is a Python wrapper that unshare's PID+mount namespaces
# and then execves criu. The base rootfs strips Python to save
# ~30 MB (see scripts/build-base-assets.sh), so we use util-linux's
# `unshare` to do the same thing without Python.
#
# --pid --fork --mount-proc gives the restored tree its own PID
# namespace (so PIDs don't collide with our live /init-ish chain)
# and re-mounts /proc to reflect it.
#
# No -d: block until the restored tree's session leader exits, so
# this shell (PID 1) stays alive for the life of the workload and
# can trigger a clean poweroff afterwards.
#
# --shell-job + --tcp-established mirror what machinen-dump set at
# dump time; CRIU needs them again on restore.
if ! unshare --pid --fork --mount-proc -- \
        criu restore \
            --images-dir /mnt/snap/img \
            --shell-job \
            --tcp-established \
            -v3 \
            -o restore.log; then
    echo "machinen-restore: CRIU restore failed — tail of restore.log:" >&2
    tail -40 /mnt/snap/img/restore.log >&2 || true
    kill -TERM "$AGENT_PID" 2>/dev/null || true
    exit 1
fi

# Restored tree exited cleanly. Stop the agent and power off.
kill -TERM "$AGENT_PID" 2>/dev/null || true
wait "$AGENT_PID" 2>/dev/null || true
exec /sbin/machinen-poweroff
