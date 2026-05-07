#!/bin/sh
# /sbin/machinen-dump — dumps the user workload with CRIU and streams
# the resulting image set out to the host as a tar archive on stdout.
#
# Runs inside the guest, invoked by `vm.snapshot()` via vsock exec.
# The host's `performSnapshot` consumes our stdout into a host-side
# `tar x` and (for destructive snapshots) follows up with a separate
# `/sbin/machinen-poweroff` exec to bring the VM down.
#
# All log lines go to stderr so stdout stays exclusively for tar bytes.
#
# Bundle format (#266): the host receives a directory of CRIU images
# (`pages-*.img`, `pagemap-*.img`, `core-*.img`, `dump.log`, ...). The
# scratch disk inside the guest is just transient working space; the
# host no longer keeps the ext4 image, only the directory of files.
#
# Env knobs:
#   MACHINEN_DUMP_TCP_CLOSE=1       omit --tcp-established. Default
#                                   (no env / unset) keeps it. Fork
#                                   sets this so the cloned VM doesn't
#                                   share live TCP state with the parent.
#
# Note: this script ALWAYS passes `--leave-running` to `criu dump`.
# That keeps the supervisor's `wait` blocked on the workload (so the
# exec-agent and our stdout pipe stay alive while we tar), which is
# essential for the tar-on-stdout transport. The host decides whether
# to kill the workload afterwards by issuing /sbin/machinen-poweroff
# in destructive snapshots; `vm.fork()` skips the poweroff so the
# source survives.
#
# Scratch disk lives at /dev/vdb when the VM was booted with virtio-blk
# root (/dev/vda is the rootfs in that case — see #114). On legacy
# initramfs-as-rootfs boots there's only one virtio-blk device and it
# lands at /dev/vda, so we fall back to that. The first existing path
# wins.

set -eu

# Debian's dash defaults PATH to /usr/bin:/bin when unset — criu,
# blkid, mkfs.ext4, and nsenter all live under /usr/sbin or /usr/bin,
# so export a broad PATH regardless of what /init's envp carried.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# Recursive-self-exec marker: when we re-enter via `nsenter` for the
# chained-restore case (#215), the second pass skips the discovery
# logic and trusts the in-NS pid passed on the command line.
IN_SUB_NS=0
case "${1:-}" in
    --in-sub-ns)
        IN_SUB_NS=1
        shift
        ;;
esac

TCP_CLOSE=0
if [ "${MACHINEN_DUMP_TCP_CLOSE:-0}" = "1" ]; then
    TCP_CLOSE=1
fi

# Pick the scratch disk: /dev/vdb when virtio-blk-root booted (rootfs
# took /dev/vda); else /dev/vda for the legacy single-disk layout.
if [ -b /dev/vdb ]; then
    SCRATCH=/dev/vdb
else
    SCRATCH=/dev/vda
fi

if [ "$IN_SUB_NS" -eq 1 ]; then
    # Inside the sub-PID-NS now. The first arg is the in-NS pid that
    # criu restore wrote via --pidfile.
    DUMP_PID="${1:-}"
    SUB_NS_HOST_PID=""
else
    # /init writes the workload's PID after fork. Wait briefly for it
    # to land — the dump can race the supervisor's setsid+printf
    # wrapper if other vsock-execs (e.g. the runtime's post-boot
    # `hostname` call) warm the agent before the workload is up. Fall
    # back to PID 2 only after the wait expires; that's what's produced
    # by the supervisor spawning the workload as its first background job.
    PIDFILE=/run/machinen-workload.pid
    i=0
    while [ ! -f "$PIDFILE" ] && [ "$i" -lt 50 ]; do
        sleep 0.1
        i=$((i + 1))
    done
    if [ -f "$PIDFILE" ]; then
        DUMP_PID=$(cat "$PIDFILE")
    else
        echo "machinen-dump: $PIDFILE missing after 5s; falling back to PID 2" >&2
        DUMP_PID=2
    fi

    # /sbin/machinen-restore writes the host PID of the criu restorer
    # when the restored workload was placed in a sub-PID-namespace
    # (#215). Presence of this file means we're in the chained-restore
    # case: we need to re-enter the sub-NS via nsenter, because criu
    # walks /proc and /proc reflects the parent NS out here.
    SUB_NS_HOST_PID_FILE=/run/machinen-workload-host.pid
    SUB_NS_HOST_PID=""
    if [ -s "$SUB_NS_HOST_PID_FILE" ]; then
        candidate=$(cat "$SUB_NS_HOST_PID_FILE")
        case "$candidate" in
            ''|*[!0-9]*)
                echo "machinen-dump: invalid pid in $SUB_NS_HOST_PID_FILE: $candidate" >&2
                exit 1
                ;;
            *)
                if [ -d "/proc/$candidate" ]; then
                    SUB_NS_HOST_PID="$candidate"
                else
                    echo "machinen-dump: criu host PID $candidate is gone — sub-NS died" >&2
                    exit 1
                fi
                ;;
        esac
    fi
fi

case "$DUMP_PID" in
    ''|*[!0-9]*)
        echo "machinen-dump: invalid dump pid: $DUMP_PID" >&2
        exit 1
        ;;
esac

echo "machinen-dump: preparing (pid=$DUMP_PID, sub_ns=${SUB_NS_HOST_PID:-none}, in_sub_ns=$IN_SUB_NS)" >&2

if [ "$IN_SUB_NS" -eq 0 ] && [ -n "$SUB_NS_HOST_PID" ]; then
    # Chained dump: the workload lives in a sub-PID-namespace. Re-exec
    # ourselves through nsenter so criu sees the sub-NS's /proc.
    #
    # With --leave-running (always, see header), the sub-NS workload
    # survives the dump and the sub-NS stays alive, so nsenter returns
    # cleanly with the in-sub-ns child's exit status (no SIGKILL race
    # like the old destructive flow had).
    #
    # The in-sub-ns half tars to its stdout, which nsenter forwards to
    # our stdout, which the exec-agent forwards over vsock to the host.
    # We drop the parent's read-only bundle mount first because the
    # in-sub-ns half re-mounts the scratch disk in its own NS for the
    # criu output; leaving our copy attached is harmless but noisy.
    if mountpoint -q /mnt/snap-src 2>/dev/null; then
        umount /mnt/snap-src 2>/dev/null || umount -l /mnt/snap-src
    fi

    # /usr/sbin/machinen-dump (not /sbin/...) — Debian's /sbin →
    # /usr/sbin merge is a top-level symlink and CRIU may have pivoted
    # into a private root that doesn't see it. `--root` switches the
    # process's fs root to the target's root before exec; without it,
    # path lookup into the new mount NS misses everything (every
    # "/usr/sbin/foo" comes back ENOENT) — the rootfs IS there, just
    # not at the path our chroot points to. `--wd /` is belt-and-braces
    # in case the parent's cwd doesn't exist in the target NS.
    exec nsenter --target "$SUB_NS_HOST_PID" --pid --mount --root --wd=/ -- \
        /usr/sbin/machinen-dump --in-sub-ns "$DUMP_PID"
fi

# CRIU's kerndat_tcp_repair probe fails with ENETUNREACH if `lo` is
# still DOWN. /init doesn't bring it up; we do it here so snapshot is
# self-contained. (lo-up is idempotent and the network NS is shared
# with the parent, so this is a no-op when we're inside the sub-NS.)
/sbin/machinen-lo-up >&2 || {
    echo "machinen-dump: lo-up failed" >&2
    exit 1
}

# CRIU's kerndat_has_move_mount_set_group probe creates a throwaway dir
# under /tmp (`/tmp/.criu.move_mount_set_group.XXXXXX`); a rootfs with
# no /tmp (older app.tar.gz layers, minimal images) makes it fail with
# ENOENT and aborts the dump before it touches the workload.
mkdir -p /tmp
chmod 1777 /tmp 2>/dev/null || true

# Drop the read-only bundle mount in our current NS.
# /sbin/machinen-restore mounts the bundle's images at /mnt/snap-src
# (read-only) and doesn't unmount when restore returns. We don't need
# the parent bundle's images anymore; clear the mount so the kernel
# will let us re-format $SCRATCH (mkfs.ext4 -F refuses if the device
# is mounted anywhere visible).
if mountpoint -q /mnt/snap-src 2>/dev/null; then
    umount /mnt/snap-src 2>/dev/null || umount -l /mnt/snap-src
fi

# Format the scratch disk ext4 on first use. Subsequent snapshots just
# remount and `rm -rf /mnt/snap/img` below clears any prior images.
# -F: force (existing data is a scratch allocation; we're overwriting).
# -q: quiet; noisy output confuses the host-side log tee.
if ! blkid "$SCRATCH" 2>/dev/null | grep -q ext4; then
    echo "machinen-dump: formatting $SCRATCH as ext4" >&2
    mkfs.ext4 -F -q "$SCRATCH" >&2
fi
mkdir -p /mnt/snap
mount "$SCRATCH" /mnt/snap

# Clear previous images so a rerun doesn't mix core-*.img files across
# generations. The CRIU restore side globs core-*.img for PID discovery,
# so leftover images would confuse it.
rm -rf /mnt/snap/img
mkdir -p /mnt/snap/img

echo "machinen-dump: dumping tree rooted at pid=$DUMP_PID (tcp_close=$TCP_CLOSE)" >&2
# --tree recurses automatically.
# We DO NOT pass --shell-job. The supervisor's `setsid -c` makes the
# workload its own session leader, and that session leader IS the
# dump tree's root — so CRIU has all the session info it needs in-tree.
# --tcp-established keeps TCP sockets across the dump. Omitted when
#   MACHINEN_DUMP_TCP_CLOSE=1 — fork sets that so the new VM doesn't
#   share live TCP sockets with the source.
# --leave-running: ALWAYS set. CRIU normally SIGKILLs the dumped tree
#   on success, but we need the workload (and the supervisor's wait, and
#   the exec-agent it shares a process tree with) alive long enough to
#   tar the images out to stdout. The host follows up with poweroff for
#   destructive snapshots; vm.fork() skips that so the source survives.
# -v3 + log file: if dump fails, tail /mnt/snap/img/dump.log on stderr.
DUMP_ARGS="--tree $DUMP_PID --images-dir /mnt/snap/img -v3 -o dump.log --leave-running"
if [ "$TCP_CLOSE" -eq 0 ]; then
    DUMP_ARGS="$DUMP_ARGS --tcp-established"
fi
# shellcheck disable=SC2086 # word splitting on DUMP_ARGS is intentional
if ! criu dump $DUMP_ARGS >&2; then
    echo "machinen-dump: CRIU dump failed — tail of dump.log:" >&2
    tail -40 /mnt/snap/img/dump.log >&2 || true
    exit 1
fi

echo "machinen-dump: dump OK — flushing + streaming bundle" >&2
sync

# Stream the image directory out to the host as a tar archive on
# stdout. The host pipes our stdout into `tar x -C <snapDir>/img` to
# materialize the directory bundle. Logs are on stderr so they don't
# corrupt the tar stream.
#
# `tar c .` from /mnt/snap/img produces a relative-path archive (no
# leading /mnt/snap/img/ prefix), which is what host-side `tar x -C
# <snapDir>/img` expects.
tar -c -C /mnt/snap/img . || {
    echo "machinen-dump: tar of /mnt/snap/img failed" >&2
    exit 1
}

# Don't unmount /mnt/snap or poweroff. The host issues poweroff via a
# separate vsock-exec when it wants the VM down (destructive snapshot);
# vm.fork() leaves the VM running.
exit 0
